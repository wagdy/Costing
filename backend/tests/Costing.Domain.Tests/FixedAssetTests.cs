using Costing.Domain.Common;
using Costing.Domain.FixedAssets;
using Costing.Domain.Treasury;

namespace Costing.Domain.Tests;

// The fixed assets register: straight-line depreciation a month at a time, what is left of the cost,
// and an asset disposed of or sold, with the gain or loss on it.
public class FixedAssetTests
{
    private static DateOnly Month(int year, int month) => new(year, month, 1);

    // An espresso machine bought on 15 March 2026 for 120,000, worth 12,000 at the end of five years:
    // (120,000 − 12,000) ÷ 60 = 1,800 a month.
    private static FixedAsset Espresso(CashFund? paidFrom = CashFund.Safe) => new(
        Guid.NewGuid(), 1, "La Marzocco espresso machine", FixedAssetCategory.KitchenEquipment, "Bar", null, new DateOnly(2026, 3, 15), 120_000, 12_000, 60,
        paidFrom, paidFrom is null ? null : Guid.NewGuid(), "Omar");

    [Fact]
    public void An_asset_is_depreciated_straight_line_a_month_at_a_time_from_the_month_it_was_bought()
    {
        var machine = Espresso();
        Assert.Equal(("FA-0001", 108_000m, 1_800m), (machine.AssetCode, machine.DepreciableAmount, machine.MonthlyDepreciation));

        // Bought in March: March is charged in full, February nothing.
        Assert.Equal((0m, 1_800m), (machine.DepreciationFor(Month(2026, 2)), machine.DepreciationFor(Month(2026, 3))));
        // By December, ten months: 18,000 of it, 102,000 left of its cost.
        Assert.Equal((10, 18_000m, 102_000m, FixedAssetStatus.Active),
            (machine.MonthsChargedThrough(Month(2026, 12)), machine.AccumulatedThrough(Month(2026, 12)), machine.NetBookValueThrough(Month(2026, 12)),
                machine.StatusAsOf(Month(2026, 12))));

        // Its sixtieth month is February 2031: then all of the cost less the salvage value, and no more.
        Assert.Equal((108_000m, 12_000m, FixedAssetStatus.FullyDepreciated, 1_800m, 0m),
            (machine.AccumulatedThrough(Month(2031, 2)), machine.NetBookValueThrough(Month(2031, 2)), machine.StatusAsOf(Month(2031, 2)),
                machine.DepreciationFor(Month(2031, 2)), machine.DepreciationFor(Month(2031, 3))));
        Assert.Equal(108_000m, machine.AccumulatedThrough(Month(2040, 1)));
    }

    [Fact]
    public void The_last_month_takes_what_the_rounding_left()
    {
        // 1,000 over 3 months: 333.33, 333.33, then 333.34.
        var till = new FixedAsset(Guid.NewGuid(), 2, "POS terminal", FixedAssetCategory.ItAndPos, null, null, new DateOnly(2026, 1, 31), 1_000, 0, 3, null, null, "Omar");
        Assert.Equal([333.33m, 333.33m, 333.34m, 0m],
            new[] { 1, 2, 3, 4 }.Select(m => till.DepreciationFor(Month(2026, m))));
        Assert.Equal(1_000m, till.AccumulatedThrough(Month(2026, 3)));
    }

    [Fact]
    public void Sold_its_depreciation_stops_and_what_it_brought_in_is_set_against_what_was_left()
    {
        var machine = Espresso();
        // Sold on 10 January 2027 for 95,000: charged March to December, 102,000 left of it, a loss of 7,000.
        machine.Sell(new DateOnly(2027, 1, 10), 95_000, CashFund.Bank, Guid.NewGuid(), "Upgraded", "Omar");
        Assert.Equal((FixedAssetStatus.Sold, (decimal?)102_000m, (decimal?)-7_000m), (machine.Status, machine.NetBookValueAtDisposal, machine.GainOrLoss));
        Assert.Equal((1_800m, 0m), (machine.DepreciationFor(Month(2026, 12)), machine.DepreciationFor(Month(2027, 1))));
        // As it stood in December it was in use; in January, sold.
        Assert.Equal((FixedAssetStatus.Active, FixedAssetStatus.Sold), (machine.StatusAsOf(Month(2026, 12)), machine.StatusAsOf(Month(2027, 1))));
        Assert.Throws<DomainException>(() => machine.WriteOff(new DateOnly(2027, 2, 1), null, "Omar"));
        // A sold one leaves the register only once its sale is undone.
        Assert.Throws<DomainException>(() => machine.Void("Omar"));

        // The sale voided: back in use, depreciated again from where it stopped.
        machine.Reinstate("Omar");
        Assert.Equal((FixedAssetStatus.Active, 1_800m, (decimal?)null), (machine.Status, machine.DepreciationFor(Month(2027, 1)), machine.GainOrLoss));

        // Written off with nothing for it the month it was bought: nothing charged, the whole cost lost.
        var chair = new FixedAsset(Guid.NewGuid(), 3, "Bar stool", FixedAssetCategory.Furniture, null, null, new DateOnly(2026, 5, 2), 600, 0, 36, null, null, "Omar");
        chair.WriteOff(new DateOnly(2026, 5, 20), "Broken", "Omar");
        Assert.Equal((FixedAssetStatus.Disposed, 0m, (decimal?)-600m), (chair.Status, chair.AccumulatedThrough(Month(2026, 12)), chair.GainOrLoss));
    }

    [Fact]
    public void Its_figures_are_checked_and_a_paid_ones_cost_is_its_payments()
    {
        FixedAsset Make(decimal cost, decimal salvage, int life, string name = "Oven") =>
            new(Guid.NewGuid(), 1, name, FixedAssetCategory.KitchenEquipment, null, null, new DateOnly(2026, 3, 1), cost, salvage, life, null, null, "Omar");
        Assert.Throws<DomainException>(() => Make(0, 0, 12));
        Assert.Throws<DomainException>(() => Make(1_000, 1_000, 12));
        Assert.Throws<DomainException>(() => Make(1_000, -1, 12));
        Assert.Throws<DomainException>(() => Make(1_000, 0, 0));
        Assert.Throws<DomainException>(() => Make(1_000, 0, 601));
        Assert.Throws<DomainException>(() => Make(1_000, 0, 12, " "));
        Assert.Throws<DomainException>(() => Espresso().Sell(new DateOnly(2026, 3, 1), 10, CashFund.Safe, Guid.NewGuid(), null, "Omar"));
        Assert.Throws<DomainException>(() => Espresso().Sell(new DateOnly(2026, 4, 1), 10, CashFund.DayRevenue, Guid.NewGuid(), null, "Omar"));

        // Owned already, its cost may be corrected; paid, it is its payment's.
        var owned = Make(1_000, 100, 12);
        owned.Recost(new DateOnly(2026, 1, 1), 2_400, 0, "Omar");
        Assert.Equal((200m, new DateOnly(2026, 1, 1)), (owned.MonthlyDepreciation, owned.PurchaseDate));
        Assert.Throws<DomainException>(() => Espresso().Recost(new DateOnly(2026, 3, 15), 100_000, 0, "Omar"));
    }

    [Fact]
    public void An_asset_is_bought_out_of_the_safe_or_the_bank_and_its_void_names_it_too()
    {
        var asset = Guid.NewGuid();
        var bought = SafeTransaction.AssetPurchase(Guid.NewGuid(), 120_000, new DateOnly(2026, 3, 15), asset, CashFund.Bank, null, "Omar");
        Assert.Equal((SafeTransactionKind.AssetPurchase, CashFund.Bank, -120_000m, (Guid?)asset), (bought.Kind, bought.Fund, bought.Amount, bought.FixedAssetId));
        var voided = bought.Void(Guid.NewGuid(), new DateOnly(2026, 3, 16), "Omar");
        Assert.Equal((CashFund.Bank, 120_000m, (Guid?)asset), (voided.Fund, voided.Amount, voided.FixedAssetId));

        var sold = SafeTransaction.AssetSale(Guid.NewGuid(), 95_000, new DateOnly(2027, 1, 10), asset, CashFund.Safe, null, "Omar");
        Assert.Equal((CashFund.Safe, 95_000m), (sold.Fund, sold.Amount));
        Assert.Throws<DomainException>(() => SafeTransaction.AssetPurchase(Guid.NewGuid(), 10, new DateOnly(2026, 3, 15), asset, CashFund.DayRevenue, null, "Omar"));
        Assert.Throws<DomainException>(() => SafeTransaction.AssetSale(Guid.NewGuid(), 0, new DateOnly(2026, 3, 15), asset, CashFund.Safe, null, "Omar"));
    }
}
