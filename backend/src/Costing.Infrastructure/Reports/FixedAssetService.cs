using Microsoft.EntityFrameworkCore;
using Costing.Application.Common;
using Costing.Domain.Common;
using Costing.Domain.FixedAssets;
using Costing.Domain.Treasury;
using Costing.Infrastructure.Persistence;
using static Costing.Infrastructure.Reports.CostingService;

namespace Costing.Infrastructure.Reports;

// One asset on the register as it stood at the end of a month (FixedAssetRegister.AsOf): what it
// cost, its straight-line depreciation (FixedAsset), what is charged of it so far and in the month,
// and what is left of its cost; how it was paid; and, disposed of or sold, when, for what, and the
// gain or loss on it.
public sealed record FixedAssetRow(
    Guid Id,
    string AssetCode,
    string Name,
    FixedAssetCategory Category,
    string? Location,
    string? Notes,
    DateOnly PurchaseDate,
    decimal PurchaseCost,
    decimal SalvageValue,
    int UsefulLifeMonths,
    decimal MonthlyDepreciation,
    int MonthsCharged,
    int MonthsLeft,
    decimal AccumulatedDepreciation,
    decimal NetBookValue,
    decimal DepreciationThisMonth,
    // The last month its life is charged in.
    DateOnly LastMonth,
    FixedAssetStatus Status,
    // Null: owned already when the register started, paid through no entry here.
    CashFund? PaidFrom,
    Guid? PurchaseTransactionId,
    DateOnly? DisposalDate,
    decimal? SaleProceeds,
    CashFund? SaleFund,
    Guid? SaleTransactionId,
    decimal? NetBookValueAtDisposal,
    decimal? GainOrLoss,
    string? DisposalNotes,
    string CreatedBy,
    DateTime CreatedAtUtc);

// What the register holds of one category at the end of the month.
public sealed record FixedAssetCategoryTotal(
    FixedAssetCategory Category, int Count, decimal Cost, decimal AccumulatedDepreciation, decimal NetBookValue, decimal DepreciationThisMonth);

// The fixed assets register (سجل الأصول الثابتة) at the end of a month. The cards count what was
// still held then (bought by then, not disposed of or sold by then):
//
//   Total assets cost        = Σ purchase cost
//   Accumulated depreciation = Σ depreciation charged up to and including the month
//   Net book value           = total assets cost − accumulated depreciation
//
// Depreciation this month is what the month's profit and loss is charged, every asset's share
// (FixedAsset.DepreciationFor): its monthly run rate. Below the operating profit with the disposals'
// gains and losses (DisposalGainOrLoss: what the assets disposed of or sold in the month brought
// in, less what was left of their cost then).
//
// The month's investing cash (CAPEX): what was paid for the assets bought in it, out of the safe and
// the bank, and what the assets sold in it brought in. Never in the profit and loss.
public sealed record FixedAssetRegister(
    int Year,
    int Month,
    DateOnly AsOf,
    decimal TotalCost,
    decimal AccumulatedDepreciation,
    decimal NetBookValue,
    decimal DepreciationThisMonth,
    int ActiveCount,
    int FullyDepreciatedCount,
    int DisposedCount,
    decimal BoughtFromSafe,
    decimal BoughtFromBank,
    decimal OwnedAlreadyAdded,
    decimal SaleProceeds,
    decimal DisposalGainOrLoss,
    IReadOnlyList<FixedAssetCategoryTotal> Categories,
    IReadOnlyList<FixedAssetRow> Assets,
    IReadOnlyList<string> Locations);

// One month's fixed assets on the profit and loss: their depreciation, and the gains and losses on
// what was disposed of or sold in it.
public sealed record AssetMonth(decimal Depreciation, decimal DisposalGainOrLoss, int Assets);

// The fixed assets register and what it puts on the profit and loss.
public sealed class FixedAssetService(CostingDbContext db, IBusinessCalendar clock)
{
    public async Task<FixedAssetRegister> GetRegisterAsync(int? year, int? month, CancellationToken cancellationToken)
    {
        var today = clock.BusinessDateOf(DateTime.UtcNow);
        var first = year is { } y && month is { } m
            ? (m is >= 1 and <= 12 && y is >= 2000 and <= 2100 ? new DateOnly(y, m, 1) : throw new DomainException("Choose a month."))
            : FixedAsset.MonthOf(today);
        var last = first.AddMonths(1).AddDays(-1);

        var assets = await db.FixedAssets.AsNoTracking().Where(a => a.VoidedAtUtc == null && a.PurchaseDate <= last)
            .OrderBy(a => a.Number).ToListAsync(cancellationToken);
        var rows = assets.Select(a => Row(a, first)).ToList();
        var held = rows.Where(r => r.Status is FixedAssetStatus.Active or FixedAssetStatus.FullyDepreciated).ToList();
        var boughtIn = assets.Where(a => a.PurchaseDate >= first).ToList();
        var goneIn = assets.Where(a => a is { IsGone: true, DisposalDate: { } d } && d >= first && d <= last).ToList();

        var categories = held.GroupBy(r => r.Category).OrderBy(g => g.Key)
            .Select(g => new FixedAssetCategoryTotal(
                g.Key, g.Count(), Money(g.Sum(r => r.PurchaseCost)), Money(g.Sum(r => r.AccumulatedDepreciation)), Money(g.Sum(r => r.NetBookValue)),
                Money(g.Sum(r => r.DepreciationThisMonth))))
            .ToList();
        var locations = await db.FixedAssets.AsNoTracking().Where(a => a.Location != null && a.VoidedAtUtc == null)
            .Select(a => a.Location!).Distinct().OrderBy(l => l).ToListAsync(cancellationToken);

        return new FixedAssetRegister(
            first.Year, first.Month, last,
            Money(held.Sum(r => r.PurchaseCost)), Money(held.Sum(r => r.AccumulatedDepreciation)), Money(held.Sum(r => r.NetBookValue)),
            Money(rows.Sum(r => r.DepreciationThisMonth)),
            held.Count(r => r.Status == FixedAssetStatus.Active), held.Count(r => r.Status == FixedAssetStatus.FullyDepreciated),
            rows.Count(r => r.Status is FixedAssetStatus.Disposed or FixedAssetStatus.Sold),
            Money(boughtIn.Where(a => a.PaidFrom == CashFund.Safe).Sum(a => a.PurchaseCost)),
            Money(boughtIn.Where(a => a.PaidFrom == CashFund.Bank).Sum(a => a.PurchaseCost)),
            Money(boughtIn.Where(a => a.PaidFrom == null).Sum(a => a.PurchaseCost)),
            Money(goneIn.Sum(a => a.SaleProceeds ?? 0)),
            Money(goneIn.Sum(a => a.GainOrLoss ?? 0)),
            categories, rows, locations);
    }

    // A month's depreciation and disposal gains and losses, for its profit and loss.
    public async Task<AssetMonth> MonthAsync(DateOnly anyDay, CancellationToken cancellationToken)
    {
        var first = FixedAsset.MonthOf(anyDay);
        var last = first.AddMonths(1).AddDays(-1);
        var assets = await db.FixedAssets.AsNoTracking().Where(a => a.VoidedAtUtc == null && a.PurchaseDate <= last).ToListAsync(cancellationToken);
        return new AssetMonth(
            Money(assets.Sum(a => a.DepreciationFor(first))),
            Money(assets.Where(a => a is { IsGone: true, DisposalDate: { } d } && d >= first && d <= last).Sum(a => a.GainOrLoss ?? 0)),
            assets.Count);
    }

    // An asset's code, once it is on the register.
    public async Task<string?> CodeOfAsync(Guid id, CancellationToken cancellationToken) =>
        await db.FixedAssets.AsNoTracking().Where(a => a.Id == id).Select(a => a.AssetCode).SingleOrDefaultAsync(cancellationToken);

    private static FixedAssetRow Row(FixedAsset a, DateOnly month)
    {
        var charged = a.MonthsChargedThrough(month);
        var status = a.StatusAsOf(month);
        var gone = status is FixedAssetStatus.Disposed or FixedAssetStatus.Sold;
        return new FixedAssetRow(
            a.Id, a.AssetCode, a.Name, a.Category, a.Location, a.Notes, a.PurchaseDate, a.PurchaseCost, a.SalvageValue, a.UsefulLifeMonths,
            a.MonthlyDepreciation, charged, gone ? 0 : a.UsefulLifeMonths - charged, Money(a.AccumulatedThrough(month)), Money(a.NetBookValueThrough(month)),
            Money(a.DepreciationFor(month)), a.FirstMonth.AddMonths(a.UsefulLifeMonths - 1), status, a.PaidFrom, a.PurchaseTransactionId,
            gone ? a.DisposalDate : null, gone ? a.SaleProceeds : null, gone ? a.SaleFund : null, gone ? a.SaleTransactionId : null,
            gone ? Money(a.NetBookValueAtDisposal) : null, gone ? Money(a.GainOrLoss) : null, gone ? a.DisposalNotes : null, a.CreatedBy, a.CreatedAtUtc);
    }
}
