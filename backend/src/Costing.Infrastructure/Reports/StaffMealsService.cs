using Microsoft.EntityFrameworkCore;
using Costing.Application.Common;
using Costing.Domain.Common;
using Costing.Domain.RawMaterials;
using Costing.Domain.StockMovements;
using Costing.Infrastructure.Persistence;
using static Costing.Infrastructure.Reports.CostingService;

namespace Costing.Infrastructure.Reports;

// Staff meals, hospitality and recipe tastings (وجبات العاملين والضيافة) over a period: each entry
// with what it took and its cost at the average when taken, each day's total against the daily
// staff meal budget, and the period's total of each.
public sealed record StaffMealLine(Guid RawMaterialId, string Material, string PurchaseUnit, decimal Quantity, decimal? Value, string? Note);

public sealed record StaffMealEntry(
    Guid EntryId, StockMovementReason Kind, DateOnly Date, DateTime RecordedAtUtc, string? RecordedBy, string? Note, IReadOnlyList<StaffMealLine> Lines,
    decimal Value);

// A day: what each kind came to, and whether the staff meals passed the budget.
public sealed record StaffMealDay(DateOnly Date, decimal StaffMeals, decimal Hospitality, decimal RecipeTasting, bool OverBudget);

public sealed record StaffMealReport(
    DateOnly From,
    DateOnly To,
    decimal? DailyBudget,
    decimal StaffMeals,
    decimal Hospitality,
    decimal RecipeTasting,
    int DaysOverBudget,
    IReadOnlyList<StaffMealDay> Days,
    IReadOnlyList<StaffMealEntry> Entries);

public sealed class StaffMealsService(CostingDbContext db, IBusinessCalendar clock)
{
    public async Task<StaffMealReport> GetAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken)
    {
        if (to < from)
            throw new DomainException("The first day must come before the last. · اليوم الأول قبل الأخير.");
        if (to > from.AddYears(1))
            throw new DomainException("Choose a year at most. · سنة على الأكثر.");
        var (fromUtc, _) = clock.Bounds(from);
        var (_, toUtc) = clock.Bounds(to);
        var reasons = StaffConsumption.Reasons;
        var movements = await db.StockMovements.AsNoTracking()
            .Where(m => reasons.Contains(m.Reason) && m.ReversalOf == null && m.OccurredAtUtc >= fromUtc && m.OccurredAtUtc < toUtc)
            .ToListAsync(cancellationToken);
        var sources = movements.Select(m => m.SourceId).Distinct().ToList();
        var voided = (await db.StockMovements.AsNoTracking()
                .Where(m => reasons.Contains(m.Reason) && m.ReversalOf != null && sources.Contains(m.SourceId))
                .Select(m => m.SourceId).Distinct().ToListAsync(cancellationToken))
            .ToHashSet();
        var ids = movements.Select(m => m.RawMaterialId).Distinct().ToList();
        var materials = await db.RawMaterials.AsNoTracking().Where(m => ids.Contains(m.Id)).ToDictionaryAsync(m => m.Id, cancellationToken);
        var settings = await db.CostingSettings.AsNoTracking().SingleOrDefaultAsync(cancellationToken) ?? new CostingSettings();

        var entries = movements
            .Where(m => !voided.Contains(m.SourceId))
            .GroupBy(m => m.SourceId)
            .Select(g =>
            {
                var lines = g.Select(m =>
                    {
                        var material = materials.GetValueOrDefault(m.RawMaterialId);
                        var size = material?.PurchaseUnitSize ?? 1;
                        return new StaffMealLine(
                            m.RawMaterialId, material?.Name ?? "A removed material", material?.PurchaseUnit ?? "", Math.Round(-m.Quantity / size, 3),
                            m.UnitCost is { } cost ? Money(-m.Quantity * cost) : null, m.Note);
                    })
                    .OrderBy(l => l.Material, StringComparer.CurrentCultureIgnoreCase)
                    .ToList();
                var first = g.MinBy(m => m.OccurredAtUtc)!;
                return new StaffMealEntry(
                    g.Key, first.Reason, clock.BusinessDateOf(first.OccurredAtUtc), first.OccurredAtUtc, first.RecordedBy,
                    lines.Select(l => l.Note).FirstOrDefault(n => n is not null), lines, Money(lines.Sum(l => l.Value ?? 0)));
            })
            .OrderByDescending(e => e.RecordedAtUtc)
            .ToList();

        decimal Of(IEnumerable<StaffMealEntry> those, StockMovementReason kind) => Money(those.Where(e => e.Kind == kind).Sum(e => e.Value));
        var budget = settings.DailyStaffMealBudget;
        var days = entries.GroupBy(e => e.Date)
            .Select(g => new StaffMealDay(
                g.Key, Of(g, StockMovementReason.StaffMeal), Of(g, StockMovementReason.Hospitality), Of(g, StockMovementReason.RecipeTasting),
                budget is { } b && Of(g, StockMovementReason.StaffMeal) > b))
            .OrderByDescending(d => d.Date)
            .ToList();
        return new StaffMealReport(
            from, to, budget, Of(entries, StockMovementReason.StaffMeal), Of(entries, StockMovementReason.Hospitality),
            Of(entries, StockMovementReason.RecipeTasting), days.Count(d => d.OverBudget), days, entries);
    }
}
