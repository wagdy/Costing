using Costing.Domain.Common;
using Costing.Domain.Treasury;

namespace Costing.Domain.FixedAssets;

// What kind of asset it is, as the register groups it.
public enum FixedAssetCategory
{
    // Ovens, fryers, espresso machines, fridges (معدات المطبخ).
    KitchenEquipment = 1,

    // Tables, chairs, counters (الأثاث).
    Furniture = 2,

    Vehicles = 3,

    // Computers, the POS terminals, printers, screens (أجهزة الحاسب ونقاط البيع).
    ItAndPos = 4,

    // The place's fit-out: decoration, flooring, ducts (تجهيزات وديكورات المكان).
    FitOut = 5,

    Other = 6,
}

// Where an asset stands. Active and FullyDepreciated are worked out from its age as of a month
// (StatusAsOf); Disposed and Sold are what was done with it. Kept: Active, Disposed or Sold.
public enum FixedAssetStatus
{
    Active = 1,

    // Still in use, its whole cost less its salvage value depreciated: nothing more to charge.
    FullyDepreciated = 2,

    // Thrown away, scrapped or given away (استبعاد): what was left of its cost written off as a loss.
    Disposed = 3,

    // Sold (بيع): what it brought in, into the safe or the bank, set against what was left of its cost.
    Sold = 4,
}

// A fixed asset (أصل ثابت): equipment, furniture, a vehicle, the POS, the place's fit-out. Capital
// spending (CAPEX), not an expense: what it cost leaves the safe or the bank the day it is bought,
// but the profit and loss takes it a month at a time over its useful life, straight-line:
//
//   Monthly depreciation     = (purchase cost − salvage value) ÷ useful life in months
//   Accumulated depreciation = monthly depreciation × the months charged, at most the useful life
//   Net book value           = purchase cost − accumulated depreciation
//
// A month is charged in full: the month it was bought is the first, the month it is disposed of or
// sold is not charged. The last month of its life takes what the rounding left, so the depreciation
// adds up to the cost less the salvage value exactly. Disposed of or sold, the net book value then
// left is set against what it brought in: the gain or loss is the disposal month's.
//
// Paid (PaidFrom), it is bought by a safe entry (AssetPurchase, PurchaseTransactionId) out of the
// safe or the bank; owned already when the register started, by none. Removed from the register,
// it is only marked so (VoidedAtUtc), its payment voided with it.
public sealed class FixedAsset : AggregateRoot
{
    public const int MaxNameLength = 120;
    public const int MaxLocationLength = 80;
    public const int MaxNotesLength = 500;
    public const int MaxUsefulLifeMonths = 600;

    private FixedAsset() { }

    public FixedAsset(
        Guid id, int number, string name, FixedAssetCategory category, string? location, string? notes, DateOnly purchaseDate, decimal purchaseCost,
        decimal salvageValue, int usefulLifeMonths, CashFund? paidFrom, Guid? purchaseTransactionId, string by)
    {
        if (number <= 0)
            throw new DomainException("An asset's number is 1 or more.");
        if (paidFrom is not (null or CashFund.Safe or CashFund.Bank))
            throw new DomainException("An asset is paid from the safe or the bank. · يدفع الأصل من الخزنة أو البنك.");
        if ((paidFrom is null) != (purchaseTransactionId is null))
            throw new DomainException("A paid asset names the entry that paid it.");
        Id = id;
        Number = number;
        AssetCode = CodeOf(number);
        PaidFrom = paidFrom;
        PurchaseTransactionId = purchaseTransactionId;
        CreatedAtUtc = DateTime.UtcNow;
        CreatedBy = by;
        SetCost(purchaseDate, purchaseCost);
        Change(name, category, location, notes, salvageValue, usefulLifeMonths, by);
        UpdatedAtUtc = null;
        UpdatedBy = null;
    }

    // FA-0001, FA-0002: by the order they were entered.
    public int Number { get; private set; }
    public string AssetCode { get; private set; } = string.Empty;

    public string Name { get; private set; } = string.Empty;
    public FixedAssetCategory Category { get; private set; }

    // Where it is: the kitchen, the bar, the dining room, a branch.
    public string? Location { get; private set; }
    public string? Notes { get; private set; }

    public DateOnly PurchaseDate { get; private set; }

    // What it cost to buy and put in place, all of it (تكلفة الشراء).
    public decimal PurchaseCost { get; private set; }

    // What it should still be worth at the end of its life (القيمة التخريدية): never depreciated.
    public decimal SalvageValue { get; private set; }

    // How many months it is expected to serve (العمر الإنتاجي): 60 for five years.
    public int UsefulLifeMonths { get; private set; }

    // Active, Disposed or Sold: what was done with it. As of a month, see StatusAsOf.
    public FixedAssetStatus Status { get; private set; } = FixedAssetStatus.Active;

    // Paid out of the safe or the bank, by that entry; neither for an asset owned already.
    public CashFund? PaidFrom { get; private set; }
    public Guid? PurchaseTransactionId { get; private set; }

    // Disposed of or sold: when, what it brought in and where that went (the safe or the bank, by
    // that entry), why, and who did it.
    public DateOnly? DisposalDate { get; private set; }
    public decimal? SaleProceeds { get; private set; }
    public CashFund? SaleFund { get; private set; }
    public Guid? SaleTransactionId { get; private set; }
    public string? DisposalNotes { get; private set; }
    public string? DisposedBy { get; private set; }

    public DateTime CreatedAtUtc { get; private set; }
    public string CreatedBy { get; private set; } = string.Empty;
    public DateTime? UpdatedAtUtc { get; private set; }
    public string? UpdatedBy { get; private set; }

    // Off the register: entered by mistake, or its purchase voided.
    public DateTime? VoidedAtUtc { get; private set; }
    public string? VoidedBy { get; private set; }
    public bool IsVoided => VoidedAtUtc is not null;

    public bool IsOwnedAlready => PaidFrom is null;
    public bool IsGone => Status is FixedAssetStatus.Disposed or FixedAssetStatus.Sold;

    public static string CodeOf(int number) => $"FA-{number:0000}";

    // ---- Depreciation ----

    public decimal DepreciableAmount => PurchaseCost - SalvageValue;

    // (purchase cost − salvage value) ÷ useful life, to the piastre.
    public decimal MonthlyDepreciation => Round(DepreciableAmount / UsefulLifeMonths);

    public DateOnly FirstMonth => MonthOf(PurchaseDate);

    // The months charged up to and including `month` (any day of it): from the month it was bought,
    // never the month it was disposed of or after, never more than its useful life.
    public int MonthsChargedThrough(DateOnly month)
    {
        if (IsVoided)
            return 0;
        var through = MonthsBetween(FirstMonth, MonthOf(month)) + 1;
        if (IsGone && DisposalDate is { } gone)
            through = Math.Min(through, MonthsBetween(FirstMonth, MonthOf(gone)));
        return Math.Clamp(through, 0, UsefulLifeMonths);
    }

    // Depreciated by the end of `month`: the months charged at the monthly rate, the whole
    // depreciable amount once its life is through.
    public decimal AccumulatedThrough(DateOnly month) => Accumulated(MonthsChargedThrough(month));

    // What `month`'s profit and loss is charged for it.
    public decimal DepreciationFor(DateOnly month) => AccumulatedThrough(month) - AccumulatedThrough(MonthOf(month).AddMonths(-1));

    // Its cost less what is depreciated by the end of `month`.
    public decimal NetBookValueThrough(DateOnly month) => PurchaseCost - AccumulatedThrough(month);

    // Disposed of or sold: its cost less what was depreciated by then, and what it brought in less that.
    public decimal? NetBookValueAtDisposal => IsGone ? PurchaseCost - Accumulated(MonthsChargedThrough(DisposalDate!.Value)) : null;
    public decimal? GainOrLoss => NetBookValueAtDisposal is { } left ? (SaleProceeds ?? 0) - left : null;

    // As it stood at the end of `month`: gone once it was disposed of or sold in or before it;
    // fully depreciated once its life is charged; otherwise active.
    public FixedAssetStatus StatusAsOf(DateOnly month)
    {
        if (IsGone && DisposalDate is { } gone && MonthOf(gone) <= MonthOf(month))
            return Status;
        return MonthsChargedThrough(month) >= UsefulLifeMonths ? FixedAssetStatus.FullyDepreciated : FixedAssetStatus.Active;
    }

    private decimal Accumulated(int months) =>
        months >= UsefulLifeMonths ? DepreciableAmount : Math.Min(DepreciableAmount, MonthlyDepreciation * months);

    // ---- Changes ----

    // Its details and what its depreciation is worked out from. A change to the life or the salvage
    // value restates every month's depreciation, past ones too: a correction.
    public void Change(string name, FixedAssetCategory category, string? location, string? notes, decimal salvageValue, int usefulLifeMonths, string by)
    {
        EnsureOnRegister();
        if (IsGone)
            throw new DomainException("This asset is disposed of: undo that first to change it. · الأصل مستبعد.");
        var trimmed = name?.Trim() ?? string.Empty;
        if (trimmed.Length == 0)
            throw new DomainException("Name the asset. · اكتب اسم الأصل.");
        if (trimmed.Length > MaxNameLength)
            throw new DomainException($"Keep the name under {MaxNameLength} characters.");
        if (!Enum.IsDefined(category))
            throw new DomainException("Choose the asset's category. · اختر فئة الأصل.");
        if (location?.Trim().Length > MaxLocationLength)
            throw new DomainException($"Keep the location under {MaxLocationLength} characters.");
        if (notes?.Trim().Length > MaxNotesLength)
            throw new DomainException($"Keep the notes under {MaxNotesLength} characters.");
        if (usefulLifeMonths is < 1 or > MaxUsefulLifeMonths)
            throw new DomainException($"The useful life is 1 to {MaxUsefulLifeMonths} months. · العمر الإنتاجي من 1 إلى {MaxUsefulLifeMonths} شهرًا.");
        var salvage = Round(salvageValue);
        if (salvage < 0)
            throw new DomainException("The salvage value is zero or more. · القيمة التخريدية صفر أو أكثر.");
        if (salvage >= PurchaseCost)
            throw new DomainException("The salvage value is less than what the asset cost. · القيمة التخريدية أقل من التكلفة.");

        Name = trimmed;
        Category = category;
        Location = string.IsNullOrWhiteSpace(location) ? null : location.Trim();
        Notes = string.IsNullOrWhiteSpace(notes) ? null : notes.Trim();
        SalvageValue = salvage;
        UsefulLifeMonths = usefulLifeMonths;
        UpdatedAtUtc = DateTime.UtcNow;
        UpdatedBy = by;
    }

    // An asset owned already: when it was bought and what it cost, corrected, with the salvage value
    // it is to keep. A paid one's are its payment's: void the purchase and enter it again.
    public void Recost(DateOnly purchaseDate, decimal purchaseCost, decimal salvageValue, string by)
    {
        EnsureOnRegister();
        if (!IsOwnedAlready)
            throw new DomainException("What a paid asset cost is its payment's: void the purchase and enter it again. · ألغِ الشراء وأدخله من جديد.");
        if (IsGone)
            throw new DomainException("This asset is disposed of: undo that first to change it. · الأصل مستبعد.");
        if (Round(salvageValue) >= Round(purchaseCost))
            throw new DomainException("The salvage value is less than what the asset cost. · القيمة التخريدية أقل من التكلفة.");
        SetCost(purchaseDate, purchaseCost);
        SalvageValue = Math.Max(Round(salvageValue), 0);
        UpdatedAtUtc = DateTime.UtcNow;
        UpdatedBy = by;
    }

    // Disposed of with nothing for it (استبعاد): what was left of its cost is the month's loss.
    public void WriteOff(DateOnly date, string? notes, string by) => Dispose(date, null, null, null, notes, by);

    // Sold (بيع): what it brought in went into the safe or the bank by that entry.
    public void Sell(DateOnly date, decimal proceeds, CashFund fund, Guid saleTransactionId, string? notes, string by)
    {
        if (proceeds <= 0)
            throw new DomainException("Enter what the asset was sold for, more than nothing. · أدخل قيمة البيع.");
        if (fund is not (CashFund.Safe or CashFund.Bank))
            throw new DomainException("A sale is paid into the safe or the bank. · تورد قيمة البيع للخزنة أو البنك.");
        Dispose(date, Round(proceeds), fund, saleTransactionId, notes, by);
    }

    // Back in use: a write-off undone, or a sale whose entry was voided. Depreciated again from where it stopped.
    public void Reinstate(string by)
    {
        EnsureOnRegister();
        if (!IsGone)
            throw new DomainException("This asset is in use already.");
        Status = FixedAssetStatus.Active;
        DisposalDate = null;
        SaleProceeds = null;
        SaleFund = null;
        SaleTransactionId = null;
        DisposalNotes = null;
        DisposedBy = null;
        UpdatedAtUtc = DateTime.UtcNow;
        UpdatedBy = by;
    }

    // Off the register. A sold or disposed one is brought back first: its sale undone.
    public void Void(string by)
    {
        EnsureOnRegister();
        if (Status == FixedAssetStatus.Sold)
            throw new DomainException("This asset is sold: void its sale first. · ألغِ بيع الأصل أولًا.");
        VoidedAtUtc = DateTime.UtcNow;
        VoidedBy = by;
    }

    private void Dispose(DateOnly date, decimal? proceeds, CashFund? fund, Guid? saleTransactionId, string? notes, string by)
    {
        EnsureOnRegister();
        if (IsGone)
            throw new DomainException("This asset is disposed of already. · الأصل مستبعد بالفعل.");
        if (date < PurchaseDate)
            throw new DomainException("An asset is disposed of on the day it was bought or after. · تاريخ الاستبعاد بعد تاريخ الشراء.");
        if (notes?.Trim().Length > MaxNotesLength)
            throw new DomainException($"Keep the notes under {MaxNotesLength} characters.");
        Status = proceeds is null ? FixedAssetStatus.Disposed : FixedAssetStatus.Sold;
        DisposalDate = date;
        SaleProceeds = proceeds;
        SaleFund = fund;
        SaleTransactionId = saleTransactionId;
        DisposalNotes = string.IsNullOrWhiteSpace(notes) ? null : notes.Trim();
        DisposedBy = by;
        UpdatedAtUtc = DateTime.UtcNow;
        UpdatedBy = by;
    }

    private void SetCost(DateOnly purchaseDate, decimal purchaseCost)
    {
        var cost = Round(purchaseCost);
        if (cost <= 0)
            throw new DomainException("Enter what the asset cost, more than nothing. · أدخل تكلفة الأصل.");
        PurchaseDate = purchaseDate;
        PurchaseCost = cost;
    }

    private void EnsureOnRegister()
    {
        if (IsVoided)
            throw new DomainException("This asset is off the register. · الأصل محذوف من السجل.");
    }

    public static DateOnly MonthOf(DateOnly day) => new(day.Year, day.Month, 1);

    private static int MonthsBetween(DateOnly from, DateOnly to) => (to.Year - from.Year) * 12 + to.Month - from.Month;

    private static decimal Round(decimal amount) => Math.Round(amount, 2, MidpointRounding.AwayFromZero);
}

public interface IFixedAssetRepository : IRepository<FixedAsset>
{
    // Every asset on the register, voided ones left out.
    Task<IReadOnlyList<FixedAsset>> GetAllAsync(CancellationToken cancellationToken = default);

    // The asset a safe entry bought or sold, if any.
    Task<FixedAsset?> GetByTransactionAsync(Guid transactionId, CancellationToken cancellationToken = default);

    // The next asset's number: one more than the highest so far, voided ones counted.
    Task<int> NextNumberAsync(CancellationToken cancellationToken = default);
}
