using Costing.Application.Approvals;
using Costing.Application.FixedAssets;
using Costing.Application.Treasury;
using Costing.Domain.Approvals;
using Costing.Domain.Common;
using Costing.Domain.FixedAssets;
using Costing.Domain.Treasury;
using Costing.Infrastructure.Reports;

namespace Costing.Infrastructure.Tests;

// Fixed assets bought out of the safe and the bank (CAPEX): the cash out on the day, never an
// expense; the register's straight-line depreciation on the profit and loss below EBITDA; and an
// asset sold, its gain there too, the money back in the safe.
public class FixedAssetsTests
{
    [Fact]
    public async Task Capex_leaves_the_safe_or_the_bank_and_the_profit_and_loss_takes_only_its_depreciation()
    {
        await using var node = await TestSystem.StartAsync();
        var ct = TestContext.Current.CancellationToken;
        using var scope = node.Scope();
        var treasury = node.Service<TreasuryService>(scope);
        var today = treasury.Today;
        var month = new DateOnly(today.Year, today.Month, 1);
        Task<SafeVoucherResultDto> Voucher(SafeVoucher voucher) => node.Send(new RecordSafeVoucherCommand(Guid.NewGuid(), voucher, null, "staff-omar", "Omar", true));

        // The month: 200,000 in the safe, 10,000 of takings, 2,000 of wages, 1,000 of rent, 100 of interest.
        await Voucher(new SafeVoucher(Guid.NewGuid(), SafeTransactionKind.OpeningBalance, 200_000, today, FundingSource.CarriedOver));
        await Voucher(new SafeVoucher(Guid.NewGuid(), SafeTransactionKind.RevenueTransfer, 10_000, today, RevenueDate: today, TaxAmount: 0));
        await node.Service<KpiService>(scope).SaveExpensesAsync(today.Year, today.Month, new MonthlyExpensesDto(2_000, null, null, 1_000, 100, null), "Omar", ct);

        // An espresso machine by the bank (120,000, 12,000 left after 60 months: 1,800 a month), a POS
        // terminal out of the safe (12,000 over 24 months: 500), and an oven owned two years already
        // (36,000 over 60 months: 600).
        var (espresso, terminal, oven) = (Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());
        var bought = await Voucher(new SafeVoucher(Guid.NewGuid(), SafeTransactionKind.AssetPurchase, 120_000, today, Fund: CashFund.Bank, FixedAssetId: espresso,
            Asset: new FixedAssetInput("La Marzocco espresso machine", FixedAssetCategory.KitchenEquipment, 60, 12_000, "Bar")));
        Assert.Equal((CashFund.Bank, -120_000m), (bought.Transaction!.Fund, bought.Transaction.Amount));
        var terminalBought = await Voucher(new SafeVoucher(Guid.NewGuid(), SafeTransactionKind.AssetPurchase, 12_000, today, FixedAssetId: terminal,
            Asset: new FixedAssetInput("POS terminal", FixedAssetCategory.ItAndPos, 24)));
        var saved = await node.Send(new RegisterOwnedAssetCommand(oven, new FixedAssetInput("Combi oven", FixedAssetCategory.KitchenEquipment, 60), month.AddMonths(-24),
            36_000, "Omar"));
        Assert.Equal("FA-0003", saved.AssetCode);
        // A retry finds the asset made; a bank payment is for fixed assets only.
        Assert.Equal("FA-0003", (await node.Send(new RegisterOwnedAssetCommand(oven, new FixedAssetInput("Combi oven", FixedAssetCategory.KitchenEquipment, 60),
            month.AddMonths(-24), 36_000, "Omar"))).AssetCode);
        await Assert.ThrowsAsync<DomainException>(() => Voucher(new SafeVoucher(Guid.NewGuid(), SafeTransactionKind.Funding, 10, today, FundingSource.Other, Fund: CashFund.Bank)));

        // The safe: only the terminal left it; the bank's purchase never touched it. Not an expense voucher.
        var safe = await treasury.GetSafeAsync(today.Year, today.Month, ct);
        Assert.Equal((198_000m, 12_000m, 12_000m), (safe.BalanceNow, safe.AssetPurchases, safe.TotalOut));
        Assert.Equal(0m, (await treasury.GetExpenseVouchersAsync(month, today, ct)).Total);
        var flows = await treasury.GetAnalyticsAsync(month, today, ct);
        Assert.Equal(12_000m, flows.Outflows.Single(l => l.Key == "capex").Amount);

        // The P&L: 10,000 of revenue, nothing sold by recipe; 3,000 to run it, 7,000 of EBITDA; then
        // 100 of interest and 2,900 of depreciation: 4,000 of net profit.
        var pnl = ProfitAndLoss.Of(await node.Service<KpiService>(scope).GetAsync(today.Year, today.Month, ct));
        Assert.Equal((10_000m, 10_000m, 3_000m, (decimal?)7_000m, 100m, 2_900m, 2_900m, (decimal?)4_000m, (decimal?)70m, (decimal?)40m),
            (pnl.Revenue, pnl.GrossProfit, pnl.OperatingExpenses, pnl.Ebitda, pnl.Interest, pnl.AssetDepreciation, pnl.Depreciation, pnl.NetProfit,
                pnl.EbitdaMarginPercent, pnl.NetMarginPercent));
        Assert.Equal(["revenue", "foodSales", "beverageSales", "costOfSales", "recipeCost", "losses", "grossProfit", "operatingExpenses", "wages",
                "controllable", "occupation", "otherFixed", "hospitality", "ebitda", "interest", "depreciation", "assetDepreciation", "enteredDepreciation",
                "disposals", "netProfit"],
            pnl.Lines.Select(l => l.Key));

        // The register at the end of the month: 168,000 held, the oven 25 months in (15,000), the others one.
        var assets = node.Service<FixedAssetService>(scope);
        var register = await assets.GetRegisterAsync(null, null, ct);
        Assert.Equal((168_000m, 17_300m, 150_700m, 2_900m, 3, 120_000m, 12_000m),
            (register.TotalCost, register.AccumulatedDepreciation, register.NetBookValue, register.DepreciationThisMonth, register.ActiveCount,
                register.BoughtFromBank, register.BoughtFromSafe));
        Assert.Equal([("FA-0001", 1_800m, 118_200m), ("FA-0002", 500m, 11_500m), ("FA-0003", 15_000m, 21_000m)],
            register.Assets.Select(a => (a.AssetCode, a.AccumulatedDepreciation, a.NetBookValue)));
        Assert.Equal(["Bar"], register.Locations);

        // The terminal sold this month for 13,000 into the safe: never charged, a gain of 1,000.
        var sold = await Voucher(new SafeVoucher(Guid.NewGuid(), SafeTransactionKind.AssetSale, 13_000, today, FixedAssetId: terminal));
        pnl = ProfitAndLoss.Of(await node.Service<KpiService>(scope).GetAsync(today.Year, today.Month, ct));
        Assert.Equal((2_400m, 1_000m, (decimal?)5_500m), (pnl.Depreciation, pnl.DisposalGainOrLoss, pnl.NetProfit));
        register = await assets.GetRegisterAsync(null, null, ct);
        Assert.Equal((156_000m, 1, 13_000m, 1_000m, FixedAssetStatus.Sold),
            (register.TotalCost, register.DisposedCount, register.SaleProceeds, register.DisposalGainOrLoss, register.Assets.Single(a => a.Id == terminal).Status));
        safe = await treasury.GetSafeAsync(today.Year, today.Month, ct);
        Assert.Equal((211_000m, 13_000m, safe.TotalIn - safe.TotalOut), (safe.BalanceNow, safe.AssetSales, safe.ClosingBalance));
        Assert.Equal(13_000m, (await treasury.GetAnalyticsAsync(month, today, ct)).Inflows.Single(l => l.Key == "assetSales").Amount);

        // Its purchase is voided only once its sale is: then it is back in use, and off the register.
        await Assert.ThrowsAsync<DomainException>(() => node.Send(new RequestDeletionCommand(
            Guid.NewGuid(), ApprovalModule.Treasury, terminalBought.Transaction!.Id, "Wrong", "staff-omar", "Omar", CanApprove: true)));
        await node.Send(new RequestDeletionCommand(Guid.NewGuid(), ApprovalModule.Treasury, sold.Transaction!.Id, "Wrong", "staff-omar", "Omar", CanApprove: true));
        Assert.Equal(FixedAssetStatus.Active, (await assets.GetRegisterAsync(null, null, ct)).Assets.Single(a => a.Id == terminal).Status);
        await node.Send(new RequestDeletionCommand(Guid.NewGuid(), ApprovalModule.Treasury, terminalBought.Transaction!.Id, "Wrong", "staff-omar", "Omar", CanApprove: true));
        register = await assets.GetRegisterAsync(null, null, ct);
        Assert.DoesNotContain(register.Assets, a => a.Id == terminal);
        Assert.Equal(200_000m + 10_000m, (await treasury.GetSafeAsync(today.Year, today.Month, ct)).BalanceNow);

        // The oven written off: its depreciation stops this month, what was left of it lost; undone.
        await node.Send(new WriteOffFixedAssetCommand(oven, today, "Cracked", "Omar"));
        var month1 = await assets.MonthAsync(today, ct);
        Assert.Equal((1_800m, -21_600m), (month1.Depreciation, month1.DisposalGainOrLoss));
        await node.Send(new ReinstateFixedAssetCommand(oven, "Omar"));
        // A paid asset is not taken off here, nor its cost changed: its purchase is voided instead.
        await Assert.ThrowsAsync<DomainException>(() => node.Send(new RemoveFixedAssetCommand(espresso, "Omar")));
        await Assert.ThrowsAsync<DomainException>(() => node.Send(new ChangeFixedAssetCommand(espresso,
            new FixedAssetInput("La Marzocco espresso machine", FixedAssetCategory.KitchenEquipment, 60, 12_000, "Bar"), today, 100_000, "Omar")));
        await node.Send(new ChangeFixedAssetCommand(oven, new FixedAssetInput("Combi oven", FixedAssetCategory.KitchenEquipment, 120, 0, "Kitchen"), null, null, "Omar"));
        Assert.Equal(300m, (await assets.GetRegisterAsync(null, null, ct)).Assets.Single(a => a.Id == oven).MonthlyDepreciation);
        await node.Send(new RemoveFixedAssetCommand(oven, "Omar"));
        Assert.Equal(["FA-0001"], (await assets.GetRegisterAsync(null, null, ct)).Assets.Select(a => a.AssetCode));
    }
}
