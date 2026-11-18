using Microsoft.EntityFrameworkCore;
using Costing.Domain.Categories;
using Costing.Domain.Stations;
using Costing.Domain.StockMovements;
using static Costing.Infrastructure.Reports.CostingService;

namespace Costing.Infrastructure.Reports;

// Station-level variance (تحليل الهدر والانحراف حسب أقسام المطبخ والبار): the theoretical against
// actual consumption, each material held against the station that keeps it (the shared station's
// when it has none), so a manager sees which section of the kitchen or bar loses the food cost.
// Each station: what its materials should have been used for by the sales (through the prep items,
// with what is held in them) and what was used (opening + purchases − logged waste − staff meals,
// hospitality and tastings − closing), both at the average cost now; the unexplained between them
// and its share of the theoretical; the waste held against it, by the station responsible for each
// entry (a dish voided after the kitchen: the station that made it), at the cost then; its three
// materials losing the most; and how it stands against its tolerance (its own, or the settings').

public enum StationStatus
{
    // Within three quarters of its tolerance, or ahead.
    WithinTarget = 1,

    // Past three quarters of its tolerance: near it.
    Watch = 2,

    // Past its tolerance: losing more than it should; or using what no sale accounts for.
    HighLoss = 3,
}

public sealed record StationLossMaterial(Guid RawMaterialId, string Material, decimal VarianceCost, decimal? VariancePercent);

// StationId: the station's, or null for the shared group when there is no shared station.
public sealed record StationVariance(
    Guid? StationId,
    string Station,
    string? StationAr,
    string? Code,
    bool IsShared,
    bool IsActive,
    decimal TolerancePercent,
    int Materials,
    decimal TheoreticalConsumptionCost,
    decimal ActualConsumptionCost,
    decimal LoggedSpoilageWasteCost,
    decimal StaffMealsCost,
    decimal UnexplainedVarianceCost,
    decimal? UnexplainedVariancePercent,
    int OverTolerance,
    StationStatus Status,
    IReadOnlyList<StationLossMaterial> TopLossMaterials);

// Rows: each material's consumption, its KitchenStationId the station it is reported under.
public sealed record StationVarianceReport(
    DateOnly From,
    DateOnly To,
    decimal TolerancePercent,
    decimal WatchSharePercent,
    IReadOnlyList<StationVariance> Stations,
    IReadOnlyList<ConsumptionRow> Rows,
    decimal TheoreticalValue,
    decimal ActualValue,
    decimal UnexplainedValue,
    decimal WasteValue);

public sealed partial class IntelligenceService
{
    // A station is watched once its unexplained loss passes this share of its tolerance.
    public const decimal WatchShare = 0.75m;

    // Waste held against a station: spoilage logged, dishes voided after the kitchen, less refunds put back.
    private static readonly StockMovementReason[] StationWaste = [StockMovementReason.Waste, StockMovementReason.Spoilage, StockMovementReason.VoidReturn];

    public async Task<StationVarianceReport> GetStationVarianceAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken)
    {
        var (fromUtc, toUtc) = Period(from, to);
        var consumption = await GetConsumptionAsync(from, to, cancellationToken);
        var stations = await db.KitchenStations.AsNoTracking().ToListAsync(cancellationToken);
        var byId = stations.ToDictionary(s => s.Id);
        var shared = stations.Where(s => s.IsShared).OrderBy(s => s.DisplayOrder).FirstOrDefault();
        // A station that is not there (taken away since) falls to the shared one.
        Guid? Resolve(Guid? id) => id is { } known && byId.ContainsKey(known) ? known : shared?.Id;

        var rows = consumption.Rows.Select(r => r with { KitchenStationId = Resolve(r.KitchenStationId) }).ToList();

        // The waste held against each station, at the cost then: the station named on the entry, its material's otherwise.
        var materials = await db.RawMaterials.AsNoTracking()
            .Select(m => new { m.Id, m.KitchenStationId, m.AverageCost })
            .ToDictionaryAsync(m => m.Id, cancellationToken);
        var wasted = await db.StockMovements.AsNoTracking()
            .Where(m => StationWaste.Contains(m.Reason) && m.OccurredAtUtc >= fromUtc && m.OccurredAtUtc < toUtc)
            .Select(m => new { m.RawMaterialId, m.ResponsibleStationId, m.Quantity, m.UnitCost })
            .ToListAsync(cancellationToken);
        var waste = wasted
            .GroupBy(m => Resolve(m.ResponsibleStationId ?? materials.GetValueOrDefault(m.RawMaterialId)?.KitchenStationId))
            .ToDictionary(g => g.Key ?? Guid.Empty, g => Money(g.Sum(m => -m.Quantity * (m.UnitCost ?? materials.GetValueOrDefault(m.RawMaterialId)?.AverageCost ?? 0))));

        var tolerance = consumption.TolerancePercent;
        var keys = stations.Where(s => s.IsActive).Select(s => (Guid?)s.Id)
            .Concat(rows.Select(r => r.KitchenStationId))
            .Concat(waste.Keys.Select(k => k == Guid.Empty ? (Guid?)null : k))
            .Distinct()
            .ToList();
        var report = keys
            .Select(key =>
            {
                var station = key is { } id ? byId[id] : null;
                var own = rows.Where(r => r.KitchenStationId == key).ToList();
                var measured = own.Where(r => r.Evaluation != VarianceEvaluation.SharedCost).ToList();
                decimal Worth(Func<ConsumptionRow, decimal> quantity) => Money(measured.Sum(r => quantity(r) * (r.UnitCost ?? 0)));
                var theoretical = Worth(r => r.TheoreticalUsage);
                var unexplained = Money(measured.Sum(r => r.VarianceCost ?? 0));
                decimal? percent = theoretical > 0 ? Math.Round(unexplained / theoretical * 100, 2, MidpointRounding.AwayFromZero) : null;
                var limit = station?.ToleranceOr(tolerance) ?? tolerance;
                var status = percent is { } p
                    ? p > limit ? StationStatus.HighLoss : p > limit * WatchShare ? StationStatus.Watch : StationStatus.WithinTarget
                    : unexplained > 0 ? StationStatus.HighLoss : StationStatus.WithinTarget;
                return new StationVariance(
                    key, station?.Name ?? KitchenStation.SharedName, station is null ? KitchenStation.SharedNameAr : station.NameAr,
                    station?.Code ?? KitchenStation.SharedCode, station?.IsShared ?? true, station?.IsActive ?? true, limit, own.Count,
                    theoretical, Worth(r => r.ActualUsage), waste.GetValueOrDefault(key ?? Guid.Empty), Worth(r => r.StaffMeals), unexplained, percent,
                    measured.Count(r => r.Evaluation == VarianceEvaluation.Unfavourable), status,
                    measured.Where(r => r.VarianceCost > 0).OrderByDescending(r => r.VarianceCost).Take(3)
                        .Select(r => new StationLossMaterial(r.RawMaterialId, r.Material, r.VarianceCost!.Value, r.UnexplainedPercent)).ToList());
            })
            // In the kitchen's order, the shared group last.
            .OrderBy(s => s.StationId is { } id ? byId[id].DisplayOrder : int.MaxValue)
            .ThenBy(s => s.Station, StringComparer.CurrentCultureIgnoreCase)
            .ToList();

        return new StationVarianceReport(
            from, to, tolerance, WatchShare * 100, report, rows,
            report.Sum(s => s.TheoreticalConsumptionCost), report.Sum(s => s.ActualConsumptionCost), report.Sum(s => s.UnexplainedVarianceCost),
            report.Sum(s => s.LoggedSpoilageWasteCost));
    }
}
