using Microsoft.EntityFrameworkCore;
using Costing.Application.Integrations;
using Costing.Application.Menu;
using Costing.Application.RawMaterials;
using Costing.Application.Recipes;
using Costing.Application.Sales;
using Costing.Application.Treasury;
using Costing.Domain.Common;
using Costing.Domain.Integrations;
using Costing.Domain.Menu;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;
using Costing.Domain.Sales;
using Costing.Domain.Treasury;
using Costing.Infrastructure.Reports;

namespace Costing.Infrastructure.Tests;

// Combo offers built from the recipes the kitchen already has, costed and sold through them; and a
// day's discounts, from the Z report to the margin they erode.
public class CombosAndDiscountsTests
{
    // A burger (120) of 250 g of dough at 20 a kg and 100 g of cheese at 300 a kg: 35. A lemonade (30)
    // of 40 g of syrup at 50 a kg: 2. Plenty of each in stock.
    private sealed record Kitchen(Guid Dough, Guid Cheese, Guid Syrup, Guid Burger, Guid Lemonade);

    private static async Task<Kitchen> SetUpAsync(TestSystem node)
    {
        Assert.True(await TestSystem.WaitFor(() => node.Db(db => db.MenuItems.AnyAsync())));
        async Task<Guid> Bought(string name, decimal perKg) =>
            (await node.Send(new CreateRawMaterialCommand(name, UnitOfMeasure.Gram, PurchaseUnit: "kg", PurchaseUnitSize: 1000, CostPerPurchaseUnit: perKg))).Id;
        var (dough, cheese, syrup) = (await Bought("Dough", 20), await Bought("Cheese", 300), await Bought("Syrup", 50));
        await node.Send(new ReceivePurchaseCommand(Guid.NewGuid(), [new(dough, 10_000, 200), new(cheese, 5_000, 1_500), new(syrup, 2_000, 100)]));
        var burger = await node.Send(new SetRecipeCommand(RecipeTargetKind.MenuItem, TestMenu.Burger, null, [new(dough, 250), new(cheese, 100)]));
        var lemonade = await node.Send(new SetRecipeCommand(RecipeTargetKind.MenuItem, TestMenu.Lemonade, null, [new(syrup, 40)]));
        return new Kitchen(dough, cheese, syrup, burger!.Id, lemonade!.Id);
    }

    private static Task<decimal> OnHand(TestSystem node, Guid material) =>
        node.Db(db => db.RawMaterials.Where(m => m.Id == material).Select(m => m.QuantityOnHand).SingleAsync());

    [Fact]
    public async Task A_combo_is_costed_by_its_dishes_sold_under_its_own_number_and_takes_their_stock()
    {
        await using var node = await TestSystem.StartAsync();
        var ct = TestContext.Current.CancellationToken;
        using var scope = node.Scope();
        var k = await SetUpAsync(node);
        var today = node.Service<IntelligenceService>(scope).Today;
        var costing = node.Service<CostingService>(scope);

        // Two burgers and two lemonades at 250 (300 apart): 74 of food, 29.6%.
        var id = Guid.NewGuid();
        var next = (await costing.GetComboOffersAsync(false, ct)).NextCode;
        Assert.Equal(1001, next);
        await node.Send(new SaveComboOfferCommand(id, 9001, "Burger duo", "ثنائي البرجر", 250, true, [new(k.Burger, 2), new(k.Lemonade, 2)]));
        var combo = Assert.Single((await costing.GetComboOffersAsync(false, ct)).Combos);
        Assert.Equal((9001, 74m, (decimal?)300m, (decimal?)50m, (decimal?)16.7m, (decimal?)29.6m, CostStatus.WithinTarget),
            (combo.Code, combo.TotalCost, combo.OriginalPrice, combo.Savings, combo.SavingsPercent, combo.FoodCostPercent, combo.Status));
        Assert.Equal([("Burger", 2, 35m, 70m, (decimal?)240m), ("Lemonade", 2, 2m, 4m, (decimal?)60m)],
            combo.Items.Select(i => (i.Dish, i.Quantity, i.CostPerPortion, i.LineCost, i.LinePrice)));

        // On the menu under its number, in its own category; its menu row costed by its dishes.
        var item = (await node.Send(new Costing.Application.Menu.GetMenuQuery())).Items.Single(i => i.Id == 9001);
        Assert.Equal(("Burger duo", ComboOffer.MenuCategory, 250m, true, (Guid?)id), (item.Name, item.Category, item.Price, item.IsAvailable, item.ComboOfferId));
        var card = (await costing.GetMenuCostsAsync(ct)).Single(c => c.CatalogItemId == 9001);
        Assert.Equal((true, 74m, (decimal?)29.6m, (Guid?)id), (card.HasRecipe, card.CostPerPortion, card.FoodCostPercentActual, card.ComboOfferId));

        // Its name, price and dishes are the combo's alone; its dishes stay while it has them.
        await Assert.ThrowsAsync<DomainException>(() => node.Send(new SaveMenuItemCommand(9001, null, "Duo", null, ComboOffer.MenuCategory, 10, false, true, null, null)));
        await Assert.ThrowsAsync<DomainException>(() => node.Send(new SetMenuItemDeletedCommand(9001, true)));
        await Assert.ThrowsAsync<DomainException>(() => node.Send(new SetRecipeCommand(RecipeTargetKind.MenuItem, 9001, null, [new(k.Dough, 1)])));
        await Assert.ThrowsAsync<DomainException>(() => node.Send(new DeleteRecipeCommand(k.Burger)));
        await Assert.ThrowsAsync<DomainException>(() => node.Send(new SaveComboOfferCommand(Guid.NewGuid(), TestMenu.Burger, "Taken", null, 10, true, [new(k.Burger, 2)])));
        await Assert.ThrowsAsync<DomainException>(() => node.Send(new SaveComboOfferCommand(id, 9002, "Burger duo", null, 250, true, [new(k.Burger, 2)])));

        // Three sold on the day's summary: six burgers' and six lemonades' stock.
        await node.Send(new RecordDailySalesCommand(Guid.NewGuid(), today, [new(9001, null, 3)], "Omar"));
        Assert.Equal((10_000m - 1_500m, 5_000m - 600m, 2_000m - 240m), (await OnHand(node, k.Dough), await OnHand(node, k.Cheese), await OnHand(node, k.Syrup)));
        var theoretical = await costing.GetTheoreticalCostAsync(today.Year, today.Month, ct);
        Assert.Equal(222m, theoretical.Rows.Single(r => r.MenuItemId == 9001).TheoreticalCost);

        // Changed: one lemonade, at 230; then off the menu and the list.
        await node.Send(new SaveComboOfferCommand(id, 9001, "Burger duo", null, 230, false, [new(k.Burger, 2), new(k.Lemonade, 1)]));
        combo = Assert.Single((await costing.GetComboOffersAsync(false, ct)).Combos);
        Assert.Equal((72m, (decimal?)31.3m, false), (combo.TotalCost, combo.FoodCostPercent, combo.IsActive));
        Assert.False((await node.Send(new Costing.Application.Menu.GetMenuQuery())).Items.Single(i => i.Id == 9001).IsAvailable);
        await node.Send(new DeleteComboOfferCommand(id, "Omar"));
        Assert.Empty((await costing.GetComboOffersAsync(false, ct)).Combos);
        Assert.True((await node.Send(new Costing.Application.Menu.GetMenuQuery())).Items.Single(i => i.Id == 9001).IsDeleted);
        await node.Send(new DeleteRecipeCommand(k.Lemonade));
    }

    [Fact]
    public async Task A_z_reports_discounts_reach_the_takings_the_summary_and_the_margin_they_erode()
    {
        await using var node = await TestSystem.StartAsync();
        var ct = TestContext.Current.CancellationToken;
        using var scope = node.Scope();
        var k = await SetUpAsync(node);
        var today = node.Service<IntelligenceService>(scope).Today;
        await node.Send(new SaveComboOfferCommand(Guid.NewGuid(), 9001, "Burger duo", null, 250, true, [new(k.Burger, 2), new(k.Lemonade, 2)]));

        // Two shifts: three combos and a burger sold (870 at the menu's prices), 750 collected after
        // 120 of discounts: loyalty 80 on two bills and 40 for the staff across both.
        var first = new ZReportInput(Guid.NewGuid(), today, 1,
            new ZReportTakings(400, 100, 0, 0, null, 80, [new("Loyalty", 60, 1), new("Staff", 20, 1)]), [new("9001", 2)]);
        var second = new ZReportInput(Guid.NewGuid(), today, 2,
            new ZReportTakings(250, 0, 0, 0, null, 40, [new("loyalty", 20, 1), new("Staff", 20)]), [new("9001", 1), new("1", 1)]);
        await node.Send(new ReceiveZReportCommand(first, "z-report"));
        var result = await node.Send(new ReceiveZReportCommand(second, "z-report"));
        Assert.Empty(result.Warnings);
        Assert.Equal(10_000m - 7 * 250m, await OnHand(node, k.Dough));

        var takings = await node.Db(db => db.SafeTransactions.SingleAsync(t => t.Id == result.TakingsId));
        Assert.Equal((750m, 120m), (takings.NetAmount, takings.DiscountsAmount));
        Assert.Equal([new DiscountReason("Loyalty", 80, 2), new DiscountReason("Staff", 40, 1)], takings.DiscountReasons);
        var summary = await node.Db(db => db.SalesReceipts.SingleAsync(r => r.Id == result.SaleId));
        Assert.Equal((870m, 120m, 2), (summary.BilledSubtotal, summary.DiscountAmount, summary.DiscountReasons.Count));
        var day = await node.Db(db => db.PosDays.SingleAsync(d => d.Date == today));
        Assert.Equal((120m, 2), (day.DiscountsAmount, day.DiscountReasons.Count));

        // The month: 257 of theoretical cost (three combos and a burger) on 750 collected, 870 at the
        // menu's prices: 34.3% actual, 29.5% standard, 4.8 points eroded; discounts 13.8% of the standard.
        var impact = (await node.Service<KpiService>(scope).GetAsync(today.Year, today.Month, ct)).Discounts!;
        Assert.Equal((120m, 750m, 870m, (decimal?)13.8m, 257m), (impact.Discounts, impact.ActualNetRevenue, impact.StandardGrossRevenue, impact.DiscountSharePercent, impact.TheoreticalCost));
        Assert.Equal(((decimal?)29.5m, (decimal?)34.3m, (decimal?)4.8m), (impact.StandardFoodCostPercent, impact.ActualFoodCostPercent, impact.ErosionPoints));
        Assert.Equal([new DiscountReason("Loyalty", 80, 2), new DiscountReason("Staff", 40, 1)], impact.Reasons);

        // A discount more than the items is refused whole, nothing recorded.
        var tooMuch = new ZReportInput(Guid.NewGuid(), today.AddDays(-1), 1, new ZReportTakings(100, 0, 0, 0, null, 50, [new("Loyalty", 60)]), [new("1", 1)]);
        await Assert.ThrowsAsync<DomainException>(() => node.Send(new ReceiveZReportCommand(tooMuch, "z-report")));
        Assert.Equal(1, await node.Db(db => db.PosDays.CountAsync()));
    }

    [Fact]
    public async Task Takings_entered_by_hand_carry_their_discounts_and_a_void_takes_them_out_of_the_month()
    {
        await using var node = await TestSystem.StartAsync();
        var ct = TestContext.Current.CancellationToken;
        using var scope = node.Scope();
        await SetUpAsync(node);
        var today = node.Service<IntelligenceService>(scope).Today;
        await node.Send(new RecordDailySalesCommand(Guid.NewGuid(), today, [new(TestMenu.Burger, null, 10)], "Omar"));

        var entered = await node.Send(new RecordSafeVoucherCommand(Guid.NewGuid(),
            new SafeVoucher(Guid.NewGuid(), SafeTransactionKind.RevenueTransfer, 1_000, today, RevenueDate: today, TaxAmount: 0,
                DiscountsAmount: 200, DiscountReasons: [new("Manager promo", 200, 5)]),
            null, "staff-omar", "Omar", true));
        Assert.Equal((200m, 1), (entered.Transaction!.DiscountsAmount, entered.Transaction.DiscountReasons!.Count));
        await Assert.ThrowsAsync<DomainException>(() => node.Send(new RecordSafeVoucherCommand(Guid.NewGuid(),
            new SafeVoucher(Guid.NewGuid(), SafeTransactionKind.ExpenseVoucher, 10, today, DiscountsAmount: 5), null, "staff-omar", "Omar", true)));

        var kpis = node.Service<KpiService>(scope);
        var impact = (await kpis.GetAsync(today.Year, today.Month, ct)).Discounts!;
        // 350 of burgers on 1,000 collected (1,200 at the menu's prices): 35.0% against 29.2%.
        Assert.Equal((200m, (decimal?)29.2m, (decimal?)35m, (decimal?)5.8m), (impact.Discounts, impact.StandardFoodCostPercent, impact.ActualFoodCostPercent, impact.ErosionPoints));

        await node.Send(new Costing.Application.Approvals.RequestDeletionCommand(
            Guid.NewGuid(), Costing.Domain.Approvals.ApprovalModule.Treasury, entered.Transaction.Id, "Typed twice", "staff-omar", "Omar", CanApprove: true));
        impact = (await kpis.GetAsync(today.Year, today.Month, ct)).Discounts!;
        Assert.Equal((0m, (decimal?)null, (decimal?)null), (impact.Discounts, impact.ActualFoodCostPercent, impact.ErosionPoints));
        Assert.Empty(impact.Reasons);
    }
}
