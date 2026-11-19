using Microsoft.EntityFrameworkCore;
using Costing.Application.Common;
using Costing.Application.Company;
using Costing.Application.InterBranch;
using Costing.Application.Purchases;
using Costing.Application.RawMaterials;
using Costing.Application.Recipes;
using Costing.Application.Sales;
using Costing.Application.Suppliers;
using Costing.Application.Treasury;
using Costing.Domain.Common;
using Costing.Domain.Company;
using Costing.Domain.InterBranch;
using Costing.Domain.Purchases;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;
using Costing.Domain.Sales;
using Costing.Domain.StockMovements;
using Costing.Domain.Treasury;
using Costing.Infrastructure.Reports;

namespace Costing.Infrastructure.Tests;

// Phase 4 on a real database: the P&L of each branch and of the company as a whole. The central
// kitchen buys tomato sauce at L.E 100 a kilo and sends Tanta five kilos at L.E 110; Tanta, with
// five kilos of its own at L.E 80, sells ten burgers of 200 g each, throws away a kilo, and is
// sent two kilos more, of which half a kilo never arrives. Each branch's P&L is at its own
// prices; the company's takes out what they sold and bought each other, and costs the sauce at
// what the company paid for it.
public class ConsolidatedPnlTests
{
    private static async Task BoughtAsync(TestSystem node, Guid branch, Guid supplier, Guid material, decimal kilos, decimal cost)
    {
        node.Branch.ChosenBranchId = branch;
        var id = Guid.NewGuid();
        await node.Send(new SavePurchaseInvoiceCommand(id, supplier, $"F-{id:N}"[..8], DateOnly.FromDateTime(DateTime.UtcNow),
            [new PurchaseInvoiceLineEntry(material, kilos, "kg", 1000, cost)], "Omar", PurchasePaymentMethod.Credit));
        await node.Send(new PostPurchaseInvoiceCommand(id, "Omar", "staff-omar"));
    }

    [Fact]
    public async Task Each_branch_is_measured_at_its_own_prices_and_the_company_without_what_its_branches_sold_each_other()
    {
        await using var node = await TestSystem.StartAsync();
        Assert.True(await TestSystem.WaitFor(() => node.Db(db => db.MenuItems.AnyAsync())));
        var ct = TestContext.Current.CancellationToken;
        var sauce = (await node.Send(new CreateRawMaterialCommand("Tomato sauce", UnitOfMeasure.Gram, PurchaseUnit: "kg", PurchaseUnitSize: 1000))).Id;
        var supplier = (await node.Send(new SaveSupplierCommand(Guid.NewGuid(), "Nile Farms"))).Id;
        await node.Send(new SetRecipeCommand(RecipeTargetKind.MenuItem, TestMenu.Burger, null, [new(sauce, 200)]));

        await node.Send(new ChangeOperatingModeCommand(SystemOperatingMode.MultiBranch_CentralKitchen, "user-1", "Wagdy"));
        var (kitchen, tanta) = (Guid.NewGuid(), Guid.NewGuid());
        await node.Send(new SaveBranchCommand(kitchen, "Central Kitchen", "المطبخ المركزي", BranchType.CentralKitchen));
        await node.Send(new SaveBranchCommand(tanta, "Tanta", "طنطا", BranchType.Restaurant));
        await BoughtAsync(node, tanta, supplier, sauce, 5, 400);
        await BoughtAsync(node, kitchen, supplier, sauce, 10, 1_000);
        using var scope = node.Scope();
        var today = node.Service<IBusinessCalendar>(scope).BusinessDateOf(DateTime.UtcNow);

        // Five kilos at L.E 110 a kilo; Tanta receives them all: its average (400 + 550) / 10 kg =
        // L.E 95, the company's cost of them (400 + 500) / 10 kg = L.E 90.
        node.Branch.ChosenBranchId = kitchen;
        DispatchShipmentCommand Dispatch(decimal grams) => new(
            Guid.NewGuid(), null, tanta, null, TransferPricing.WithMarkupOrCustomPrice, 10, [new DispatchLineInput(sauce, grams)], null, "user-3", "Hany");
        var first = await node.Send(Dispatch(5_000));
        node.Branch.ChosenBranchId = tanta;
        await node.Send(new ReceiveShipmentCommand(Guid.NewGuid(), first.Id, null, null, null, "user-2", "Mona"));
        var tantaCost = await node.Db(db => db.MaterialBranchStocks.SingleAsync(s => s.RawMaterialId == sauce && s.BranchId == tanta, ct));
        Assert.Equal(((decimal?)0.095m, (decimal?)0.09m), (tantaCost.AverageCost, tantaCost.CompanyAverageCost));
        var receiptIn = await node.Db(db => db.StockMovements.SingleAsync(m => m.Reason == StockMovementReason.InterBranchReceiptIn, ct));
        Assert.Equal(((decimal?)0.11m, (decimal?)0.1m), (receiptIn.UnitCost, receiptIn.CompanyUnitCost));
        // The company's stock at what it cost the company: the kitchen's five kilos at L.E 100 and
        // Tanta's ten at L.E 90, not the L.E 95 Tanta paid.
        Assert.Equal(1_400m / 15_000m, await node.Db(db => db.RawMaterials.Where(m => m.Id == sauce).Select(m => m.AverageCost!.Value).SingleAsync(ct)), 6);

        // Tanta's month: ten burgers sold, 1,000 taken; a kilo spoiled; its wages 300.
        await node.Send(new RecordSaleCommand(new SaleInput(Guid.NewGuid(), null, today, null, SalesChannel.DineIn, PaymentMethod.Cash,
            [new SaleLineInput(TestMenu.Burger, null, 10)]), "Mona"));
        await node.Send(new RecordSpoilageCommand(Guid.NewGuid(), [new SpoilageLine(sauce, 1_000, "Burnt")], "Mona"));
        var sold = await node.Db(db => db.StockMovements.SingleAsync(m => m.Reason == StockMovementReason.Sale, ct));
        Assert.Equal((tanta, (decimal?)0.095m, (decimal?)0.09m), (sold.BranchId, sold.UnitCost, sold.CompanyUnitCost));
        await node.Send(new RecordSafeVoucherCommand(Guid.NewGuid(),
            new SafeVoucher(Guid.NewGuid(), SafeTransactionKind.RevenueTransfer, 1_000, today, RevenueDate: today), null, "staff-mona", "Mona", CanApprove: true));
        var kpis = node.Service<KpiService>(scope);
        await kpis.SaveExpensesAsync(today.Year, today.Month, new MonthlyExpensesDto(300, null, null, null, null, null), "Mona", ct, tanta);
        // The company's wages wait for every branch that traded: the kitchen has not entered its own.
        var waiting = await kpis.GetAsync(today.Year, today.Month, ct);
        Assert.Equal(((decimal?)null, 300m), (waiting.Statement.Ebitda, waiting.Statement.OperatingExpenses));
        Assert.Equal("Enter Central Kitchen's wages and benefits on its own P&L. · أدخل رواتب الفرع.",
            waiting.Kpis.Single(k => k.Key == "LabourCost").Missing);
        await kpis.SaveExpensesAsync(today.Year, today.Month, new MonthlyExpensesDto(100, null, null, null, null, null), "Hany", ct, kitchen);

        // Two kilos more; half a kilo never arrives: L.E 55 billed for it, L.E 50 of the company's.
        node.Branch.ChosenBranchId = kitchen;
        var second = await node.Send(Dispatch(2_000));
        node.Branch.ChosenBranchId = tanta;
        await node.Send(new ReceiveShipmentCommand(Guid.NewGuid(), second.Id, null, [new ReceiptLineInput(sauce, 1_500)], "A tub split", "user-2", "Mona"));

        // The kitchen's P&L: 770 sold to Tanta, at a cost of 700.
        var k = await kpis.GetAsync(today.Year, today.Month, ct, kitchen);
        Assert.Equal((PnlView.Branch, "Central Kitchen"), (k.Scope!.View, k.Scope.Branch));
        Assert.Equal((770m, 770m, 700m, 700m, 70m, (decimal?)-30m),
            (k.Statement.Revenue, k.Statement.InterBranchSales, k.Statement.InterBranchCostOfGoods, k.Statement.CostOfSales, k.Statement.GrossProfit, k.Statement.Ebitda));
        Assert.Equal(new InterBranchFigures(770, 700, 70, 2, 0, 0, 0), k.InterBranch);

        // Tanta's: its 1,000, its burgers at the L.E 95 it paid (190), the spoiled kilo (95) and
        // the half kilo that never came (55).
        var t = await kpis.GetAsync(today.Year, today.Month, ct, tanta);
        Assert.Equal((1_000m, 0m, 190m, 95m, 55m, 340m, 660m, (decimal?)360m),
            (t.Statement.Revenue, t.Statement.InterBranchSales, t.Statement.FoodRecipeCost, t.Statement.Spoilage, t.Statement.TransitLosses,
                t.Statement.CostOfSales, t.Statement.GrossProfit, t.Statement.Ebitda));
        Assert.Equal((770m, 55m, 2), (t.InterBranch!.Purchases, t.InterBranch.TransitLosses, t.InterBranch.Receipts));
        Assert.Equal((300m, (decimal?)300m), (t.Statement.WagesAndBenefits!.Value, t.Expenses.WagesAndBenefits));
        Assert.Equal(190m, t.Items.Single().Cost);

        // The company's: Tanta's 1,000 alone; the sauce at what the company paid: 180 for the
        // burgers, 90 for the spoiled kilo, 50 for what never arrived. Nothing sold or bought
        // between branches; both branches' wages.
        var c = await kpis.GetAsync(today.Year, today.Month, ct);
        Assert.Equal(PnlView.Consolidated, c.Scope!.View);
        Assert.Equal((1_000m, 0m, 0m, 180m, 90m, 50m, 320m, 680m, (decimal?)400m, (decimal?)280m),
            (c.Statement.Revenue, c.Statement.InterBranchSales, c.Statement.InterBranchCostOfGoods, c.Statement.FoodRecipeCost, c.Statement.Spoilage,
                c.Statement.TransitLosses, c.Statement.CostOfSales, c.Statement.GrossProfit, c.Expenses.WagesAndBenefits, c.Statement.Ebitda));
        Assert.Equal(180m, c.Items.Single().Cost);

        // What it took out: the 770 sold, and the 720 bought: what the goods cost the kitchen (700)
        // and the markup on what Tanta sold, spoiled and never received (10 + 5 + 5).
        Assert.Equal(new Eliminations(770, 700, 20, 0, 720, -50), c.Eliminations);

        // The table by branch adds up to it: the first branch (nothing this month), the kitchen,
        // Tanta, the company's own costs, and the eliminations.
        var columns = c.Columns!;
        Assert.Equal(["Otantik", "Central Kitchen", "Tanta", "Company costs", "Eliminations", "Consolidated"],
            columns.Select(col => col.Kind == PnlColumnKind.Branch && col.BranchId == Branch.DefaultId ? "Otantik" : col.Name));
        var parts = columns.Where(col => col.Kind != PnlColumnKind.Consolidated).ToList();
        var whole = columns.Single(col => col.Kind == PnlColumnKind.Consolidated);
        Assert.Equal((whole.Revenue, whole.CostOfSales, whole.GrossProfit, whole.OperatingExpenses),
            (parts.Sum(p => p.Revenue), parts.Sum(p => p.CostOfSales), parts.Sum(p => p.GrossProfit), parts.Sum(p => p.OperatingExpenses)));
        Assert.Equal((-770m, -720m, -50m), (columns[4].Revenue, columns[4].CostOfSales, columns[4].GrossProfit));

        // The P&L lines name what was between branches.
        Assert.Contains(ProfitAndLoss.Of(k).Lines, l => l is { Key: "interBranchSales", Amount: 770 });
        Assert.Contains(ProfitAndLoss.Of(t).Lines, l => l is { Key: "transitLosses", Amount: 55 });
        Assert.DoesNotContain(ProfitAndLoss.Of(c).Lines, l => l.Key is "interBranchSales" or "interBranchCostOfGoods");
        Assert.Equal((-50m, 720m), (ProfitAndLoss.Of(c).Eliminations!.GrossProfit, ProfitAndLoss.Of(c).Eliminations!.InterBranchPurchases));

        // A user kept to Tanta reads Tanta's alone, and enters its costs alone.
        node.Branch.AssignedBranchId = tanta;
        Assert.Equal(tanta, await kpis.BranchToReadAsync(null, ct));
        Assert.Contains("your own branch", (await Assert.ThrowsAsync<ForbiddenException>(() => kpis.BranchToReadAsync(kitchen, ct))).Message);
        Assert.Equal(tanta, await kpis.BranchToEnterAsync(null, ct));
        node.Branch.AssignedBranchId = null;
        // One who works every branch enters a branch's costs on its own P&L, never the company's.
        Assert.Contains("Choose the branch", (await Assert.ThrowsAsync<DomainException>(() => kpis.BranchToEnterAsync(null, ct))).Message);
        Assert.Null(await kpis.BranchToReadAsync(null, ct));
    }

    // Back to one branch, the P&L is the company's, as it always was: the first branch's records, no
    // table by branch, its costs entered as before.
    [Fact]
    public async Task With_one_branch_the_company_is_its_one_branch_and_nothing_is_taken_out()
    {
        await using var node = await TestSystem.StartAsync();
        var ct = TestContext.Current.CancellationToken;
        using var scope = node.Scope();
        var today = node.Service<IBusinessCalendar>(scope).BusinessDateOf(DateTime.UtcNow);
        await node.Send(new RecordSafeVoucherCommand(Guid.NewGuid(),
            new SafeVoucher(Guid.NewGuid(), SafeTransactionKind.RevenueTransfer, 500, today, RevenueDate: today), null, "staff-omar", "Omar", CanApprove: true));
        var kpis = node.Service<KpiService>(scope);
        Assert.Null(await kpis.BranchToReadAsync(Guid.NewGuid(), ct));
        Assert.Equal(Branch.DefaultId, await kpis.BranchToEnterAsync(null, ct));
        await kpis.SaveExpensesAsync(today.Year, today.Month, new MonthlyExpensesDto(100, null, null, null, null, null), "Omar", ct);

        var report = await kpis.GetAsync(today.Year, today.Month, ct, Guid.NewGuid());
        Assert.Equal((PnlView.Company, false), (report.Scope!.View, report.Scope.CanChoose));
        Assert.Equal((500m, (decimal?)100m, (decimal?)400m), (report.Statement.Revenue, report.Expenses.WagesAndBenefits, report.Statement.Ebitda));
        Assert.Null(report.Eliminations);
        Assert.Null(report.Columns);
        Assert.Equal(Branch.DefaultId, await node.Db(db => db.MonthlyExpenses.Select(e => e.BranchId).SingleAsync(ct)));
    }
}
