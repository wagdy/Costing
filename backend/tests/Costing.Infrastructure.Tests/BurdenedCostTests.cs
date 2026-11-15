using ClosedXML.Excel;
using Microsoft.EntityFrameworkCore;
using Costing.Application.Categories;
using Costing.Application.Expenses;
using Costing.Application.Production;
using Costing.Application.RawMaterials;
using Costing.Application.Recipes;
using Costing.Application.Sales;
using Costing.Application.Treasury;
using Costing.Domain.Categories;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;
using Costing.Domain.StockMovements;
using Costing.Domain.Treasury;
using Costing.Infrastructure.Excel;
using Costing.Infrastructure.Reports;

namespace Costing.Infrastructure.Tests;

// The fully burdened plate cost against a month: its labor (12,000 of wages entered) and its
// overheads (4,000 rent, 1,000 depreciation, 500 of controllable costs entered and an electricity
// bill of 500 paid by voucher: 6,000), over 100 burgers and 50 steaks.
//
//   Burger 120: a 20 patty and 250 g of a bun dough (6 kg of flour at 20 a kg makes 10 kg: 3), so
//               23 of food; 8.5 minutes of its own and 1.5 of the dough's 60-minute batch: 10.
//   Steak  300: a 150 cut; 20 minutes.
public class BurdenedCostTests
{
    [Fact]
    public async Task Each_plate_carries_its_food_its_share_of_the_labor_and_overheads_and_what_is_left()
    {
        await using var node = await TestSystem.StartAsync();
        Assert.True(await TestSystem.WaitFor(() => node.Db(db => db.MenuItems.AnyAsync())));
        var ct = TestContext.Current.CancellationToken;
        using var scope = node.Scope();
        var today = node.Service<IntelligenceService>(scope).Today;
        var (first, last) = (new DateOnly(today.Year, today.Month, 1), new DateOnly(today.Year, today.Month, 1).AddMonths(1).AddDays(-1));
        await node.Db(db => db.Database.ExecuteSqlRawAsync("""
            INSERT INTO costing."MenuItems" ("Id", "Name", "Category", "Price", "IsAvailable", "IsPriceBasedOnAddons", "IsDeleted", "AddOnIds") VALUES
                (30, 'Steak', 'Mains', 300, true, false, false, ARRAY[]::integer[]);
            """, ct));

        async Task<Guid> Bought(string name, UnitOfMeasure unit, string purchaseUnit, decimal size, decimal cost) =>
            (await node.Send(new CreateRawMaterialCommand(name, unit, PurchaseUnit: purchaseUnit, PurchaseUnitSize: size, CostPerPurchaseUnit: cost))).Id;
        var patty = await Bought("Patty", UnitOfMeasure.Piece, "piece", 1, 20);
        var cut = await Bought("Steak cut", UnitOfMeasure.Piece, "piece", 1, 150);
        var flour = await Bought("Flour", UnitOfMeasure.Gram, "kg", 1000, 20);
        var dough = (await node.Send(new SavePrepItemCommand(null, "Bun dough", UnitOfMeasure.Gram, 10_000, [new(flour, 6_000)],
            Activity: new PlateActivity(60, 1)))).Id;
        var kitchen = (await node.Send(new SaveRecipeCategoryCommand(Guid.NewGuid(), "Grill"))).Id;
        var burger = await node.Send(new SaveRecipeCommand(null, null, RecipeTargetKind.MenuItem, TestMenu.Burger, null, 1,
            [new(patty, 1), new(dough, 250)], kitchen, Activity: new PlateActivity(8.5m, 1)));
        var steak = await node.Send(new SaveRecipeCommand(null, null, RecipeTargetKind.MenuItem, 30, null, 1, [new(cut, 1)], kitchen,
            Activity: new PlateActivity(20, 1)));
        Assert.Equal((8.5m, 1m), (burger.PrepTimeMinutes!.Value, burger.ComplexityWeight));
        await node.Send(new RecordDailySalesCommand(Guid.NewGuid(), today, [new(TestMenu.Burger, null, 100), new(30, null, 50)], "Omar"));
        Assert.True(await TestSystem.WaitFor(async () => await node.Db(db => db.StockMovements.CountAsync(m => m.Reason == StockMovementReason.Sale)) >= 3));

        // The month's labor and overheads.
        await node.Service<KpiService>(scope).SaveExpensesAsync(today.Year, today.Month, new MonthlyExpensesDto(12_000, null, 500, 4_000, null, 1_000), "Omar", ct);
        var utilities = (await node.Send(new SavePurchaseCategoryCommand(Guid.NewGuid(), "Utilities", null, ExpenseLine.Controllable, CategoryKind.Expenses))).Id;
        var electricity = (await node.Send(new SaveExpenseItemCommand(Guid.NewGuid(), "Electricity", utilities))).Id;
        Task Voucher(SafeTransactionKind kind, decimal amount, FundingSource? source = null, Guid? expense = null) =>
            node.Send(new RecordSafeVoucherCommand(Guid.NewGuid(), new SafeVoucher(Guid.NewGuid(), kind, amount, today, source, ExpenseItemId: expense),
                null, "staff-omar", "Omar", true));
        await Voucher(SafeTransactionKind.OpeningBalance, 10_000, FundingSource.CarriedOver);
        await Voucher(SafeTransactionKind.ExpenseVoucher, 500, expense: electricity);

        var service = node.Service<BurdenedCostService>(scope);
        var byPlate = await service.GetAsync(first, last, OverheadAllocationMethod.ByQuantitySold, PoolSource.Actual, null, null, ct);
        Assert.Equal((12_000m, 6_000m, 150m, 27_000m, (decimal?)80m, (decimal?)40m),
            (byPlate.Labor.Total, byPlate.Overhead.Total, byPlate.PlatesSold, byPlate.Sales, byPlate.LaborPerPlate, byPlate.OverheadPerPlate));
        Assert.Equal([("wagesEntered", 12_000m)], byPlate.Labor.Parts.Select(p => (p.Key, p.Amount)));
        Assert.Equal([("occupation", 4_000m), ("controllable", 1_000m), ("depreciation", 1_000m)], byPlate.Overhead.Parts.Select(p => (p.Key, p.Amount)));
        Assert.Equal((12_000m, 6_000m, (decimal?)103m, (decimal?)-3m, -800m, 1),
            (byPlate.LaborAllocated, byPlate.OverheadAllocated, byPlate.AverageFullyBurdenedCostPercent, byPlate.AverageTrueNetMarginPercent,
                byPlate.TotalPeriodNetProfit, byPlate.DishesBleeding));
        BurdenedPlateRow Plate(BurdenedCostReport report, string dish) => report.Rows.Single(r => r.Dish == dish);
        var b = Plate(byPlate, "Burger");
        Assert.Equal(((decimal?)120m, (decimal?)23m, (decimal?)80m, (decimal?)103m, (decimal?)40m, (decimal?)143m, (decimal?)-23m, (decimal?)-19.2m, (decimal?)-2_300m),
            (b.SellingPrice, b.DirectFoodCost, b.AllocatedLaborCost, b.PrimeCost, b.AllocatedOverheadCost, b.FullyBurdenedCost, b.TrueNetProfitPerPlate,
                b.TrueNetMarginPercent, b.TotalPeriodNetProfit));
        // (23 + 80 + 40) ÷ 85%.
        Assert.Equal(((decimal?)168.24m, true, PlateStatus.Losing, 10m), (b.SuggestedPriceForTargetNetMargin, b.BleedingAfterOverhead, b.Status, b.WeightedMinutes));
        var s = Plate(byPlate, "Steak");
        Assert.Equal(((decimal?)270m, (decimal?)30m, (decimal?)10m, PlateStatus.Thin), (s.FullyBurdenedCost, s.TrueNetProfitPerPlate, s.TrueNetMarginPercent, s.Status));
        // Not sold: what a plate would carry; no recipe, no food cost.
        var lemonade = Plate(byPlate, "Lemonade");
        Assert.Equal((true, (decimal?)80m, (decimal?)null, PlateStatus.NoRecipe), (lemonade.Estimated, lemonade.AllocatedLaborCost, lemonade.FullyBurdenedCost, lemonade.Status));
        // The shawarma sells by its size alone: the size is a plate, the dish is not.
        Assert.Contains(byPlate.Rows, r => r.Dish == "Shawarma (Kilo tray)");
        Assert.DoesNotContain(byPlate.Rows, r => r.Dish == "Shawarma");

        // By the kitchen's time: 100 × 10 + 50 × 20 = 2,000 minutes, 6 of labor each.
        var byTime = await service.GetAsync(first, last, OverheadAllocationMethod.ActivityBasedPrepTime, PoolSource.Actual, null, null, ct);
        Assert.Equal(((decimal?)6m, (decimal?)60m, (decimal?)120m, (decimal?)123m, (decimal?)60m),
            (byTime.LaborPerWeightedMinute, Plate(byTime, "Burger").AllocatedLaborCost, Plate(byTime, "Steak").AllocatedLaborCost,
                Plate(byTime, "Burger").FullyBurdenedCost, Plate(byTime, "Lemonade").AllocatedLaborCost));
        Assert.Equal(12_000m, byTime.LaborAllocated);

        // By revenue: 27,000 of sales; a burger is 120 of them.
        var byRevenue = await service.GetAsync(first, last, OverheadAllocationMethod.ByRevenueShare, PoolSource.Actual, null, null, ct);
        Assert.Equal(((decimal?)53.33m, (decimal?)26.67m, (decimal?)133.33m, PlateStatus.Thin, PlateStatus.Losing),
            (Plate(byRevenue, "Burger").AllocatedLaborCost, Plate(byRevenue, "Burger").AllocatedOverheadCost, Plate(byRevenue, "Steak").AllocatedLaborCost,
                Plate(byRevenue, "Burger").Status, Plate(byRevenue, "Steak").Status));
        Assert.Equal((12_000m, 6_000m), (byRevenue.LaborAllocated, byRevenue.OverheadAllocated));

        // Simulated: 9,000 of labor and 3,000 of overheads a month, over the same plates.
        var simulated = await service.GetAsync(first, last, OverheadAllocationMethod.ByQuantitySold, PoolSource.Simulated, 9_000, 3_000, ct);
        Assert.Equal((PoolSource.Simulated, 9_000m, 3_000m, (decimal?)60m, (decimal?)20m),
            (simulated.Source, simulated.Labor.Total, simulated.Overhead.Total, Plate(simulated, "Burger").AllocatedLaborCost, Plate(simulated, "Burger").AllocatedOverheadCost));

        // The settings' method and margin, and the stand-in for a month with nothing recorded: last
        // month, its 30,000 of labor and 15,000 of overheads in full.
        await node.Service<CostingService>(scope).SaveSettingsAsync(new CostingSettingsDto(30, PlateCost: new PlateCostSettingsDto(
            OverheadAllocationMethod.ActivityBasedPrepTime, 20, 30_000, 15_000)), ct);
        var lastMonth = first.AddMonths(-1);
        var standIn = await service.GetAsync(lastMonth, first.AddDays(-1), null, PoolSource.Actual, null, null, ct);
        Assert.Equal((OverheadAllocationMethod.ActivityBasedPrepTime, 20m, 30_000m, 15_000m, 0m, (decimal?)null),
            (standIn.Method, standIn.TargetNetMarginPercent, standIn.Labor.Total, standIn.Overhead.Total, standIn.PlatesSold, standIn.LaborPerPlate));
        Assert.Equal([$"{lastMonth:MMM yyyy}"], standIn.Labor.StandInMonths);
        Assert.All(standIn.Rows.Where(r => r.Dish is "Burger" or "Steak"), r => Assert.Equal(PlateStatus.NotAllocated, r.Status));
        // A month with its own figures takes none.
        Assert.Empty((await service.GetAsync(first, last, null, PoolSource.Actual, null, null, ct)).Labor.StandInMonths);
        // Simulated with no figures: the stand-in's.
        Assert.Equal(30_000m, (await service.GetAsync(first, last, null, PoolSource.Simulated, null, null, ct)).Labor.Total);

        // The steak's card: the month so far, as the settings share it.
        var card = await service.GetForRecipeAsync(steak.Id, ct);
        Assert.Equal((OverheadAllocationMethod.ActivityBasedPrepTime, first, today, "Steak", 20m),
            (card.Method, card.From, card.To, card.Plate!.Dish, card.TargetNetMarginPercent));

        using var book = new XLWorkbook(BurdenedCostWorkbook.Build(byPlate));
        var plates = book.Worksheet("Burdened plate cost");
        Assert.Equal("Fully burdened plate cost · التكلفة الكلية للطبق", plates.Cell(1, 1).GetString());
        Assert.Contains(plates.RowsUsed(), r => r.Cell(2).GetString() == "Burger" && r.Cell(21).GetString() == "Losing after overhead · خاسر بعد التحميل");
        Assert.Contains(book.Worksheet("Cost pools").RowsUsed(), r => r.Cell(2).GetString() == "Labor pool · وعاء العمالة" && r.Cell(3).GetDouble() == 12_000);

        await Assert.ThrowsAsync<Costing.Domain.Common.DomainException>(() => service.GetAsync(last, first, null, PoolSource.Actual, null, null, ct));
    }

    [Fact]
    public async Task A_recipe_keeps_its_prep_time_through_a_save_that_does_not_send_one()
    {
        await using var node = await TestSystem.StartAsync();
        var kitchen = (await node.Send(new SaveRecipeCategoryCommand(Guid.NewGuid(), "Grill"))).Id;
        var patty = (await node.Send(new CreateRawMaterialCommand("Patty", UnitOfMeasure.Piece, PurchaseUnit: "piece", PurchaseUnitSize: 1, CostPerPurchaseUnit: 20))).Id;

        var made = await node.Send(new SaveRecipeCommand(null, "Slider", null, null, null, 1, [new(patty, 1)], kitchen));
        Assert.Equal((10m, 1m), (made.PrepTimeMinutes!.Value, made.ComplexityWeight));
        var timed = await node.Send(new SaveRecipeCommand(made.Id, "Slider", null, null, null, 1, [new(patty, 1)], kitchen, Activity: new PlateActivity(6, 1.5m)));
        Assert.Equal((6m, 1.5m), (timed.PrepTimeMinutes!.Value, timed.ComplexityWeight));
        var kept = await node.Send(new SaveRecipeCommand(made.Id, "Slider", null, null, null, 2, [new(patty, 2)], kitchen));
        Assert.Equal((6m, 1.5m, 2), (kept.PrepTimeMinutes!.Value, kept.ComplexityWeight, kept.Portions));
        await Assert.ThrowsAsync<Costing.Domain.Common.DomainException>(() =>
            node.Send(new SaveRecipeCommand(made.Id, "Slider", null, null, null, 1, [new(patty, 1)], kitchen, Activity: new PlateActivity(5, 0))));
    }
}
