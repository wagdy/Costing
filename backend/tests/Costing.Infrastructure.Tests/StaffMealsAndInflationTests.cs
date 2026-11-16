using Microsoft.EntityFrameworkCore;
using ClosedXML.Excel;
using Costing.Application.Approvals;
using Costing.Application.Categories;
using Costing.Application.RawMaterials;
using Costing.Application.Recipes;
using Costing.Application.Sales;
using Costing.Application.Waste;
using Costing.Domain.Approvals;
using Costing.Domain.Categories;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;
using Costing.Domain.StockMovements;
using Costing.Infrastructure.Excel;
using Costing.Infrastructure.Reports;

namespace Costing.Infrastructure.Tests;

public class StaffMealsAndInflationTests
{
    // Ten patties bought at 20; two burgers eaten by the staff and a patty given to a guest. The
    // stock moved by 3 patties, all of them accounted for: none unexplained, none spoilage.
    [Fact]
    public async Task Staff_meals_and_hospitality_are_logged_apart_from_loss_and_carried_where_they_belong()
    {
        await using var node = await TestSystem.StartAsync();
        var ct = TestContext.Current.CancellationToken;
        using var scope = node.Scope();
        var today = node.Service<IntelligenceService>(scope).Today;
        var patty = (await node.Send(new CreateRawMaterialCommand("Patty", UnitOfMeasure.Piece, PurchaseUnit: "piece", PurchaseUnitSize: 1))).Id;
        await node.Send(new ReceivePurchaseCommand(Guid.NewGuid(), [new(patty, 10, 200)]));
        await node.Send(new SetRecipeCommand(RecipeTargetKind.MenuItem, TestMenu.Burger, null, [new(patty, 1)]));
        var burger = await node.Db(db => db.Recipes.Where(r => r.CatalogItemId == TestMenu.Burger).Select(r => r.Id).SingleAsync());

        var meal = Guid.NewGuid();
        await node.Send(new RecordStaffConsumptionCommand(meal, StaffConsumptionKind.StaffMeal, [new(null, burger, 2)], "Lunch", "Omar"));
        await node.Send(new RecordStaffConsumptionCommand(meal, StaffConsumptionKind.StaffMeal, [new(null, burger, 2)], "Lunch", "Omar"));
        await node.Send(new RecordStaffConsumptionCommand(Guid.NewGuid(), StaffConsumptionKind.Hospitality, [new(patty, null, 1)], "Owner's guest", "Omar"));
        await Assert.ThrowsAsync<Costing.Domain.Common.DomainException>(() =>
            node.Send(new RecordStaffConsumptionCommand(Guid.NewGuid(), StaffConsumptionKind.StaffMeal, [new(null, burger, 1.5m)], null, "Omar")));
        Assert.Equal(7m, await node.Db(db => db.RawMaterials.Where(m => m.Id == patty).Select(m => m.QuantityOnHand).SingleAsync()));

        // Theoretical against actual: 10 bought, 7 left, 3 taken on purpose; nothing unexplained.
        var consumption = await node.Service<IntelligenceService>(scope).GetConsumptionAsync(today, today, ct);
        var row = Assert.Single(consumption.Rows);
        Assert.Equal((0m, 3m, 0m, 0m), (row.Waste, row.StaffMeals, row.ActualUsage, row.UnexplainedQuantity));
        Assert.Equal((60m, 0m, 0m), (consumption.StaffMealsValue, consumption.WasteValue, consumption.UnexplainedValue));

        // The P&L: the staff's 40 with the wages, the guest's 20 a line of its own.
        var statement = (await node.Service<KpiService>(scope).GetAsync(today.Year, today.Month, ct)).Statement;
        Assert.Equal((40m, 20m, 0m, 0m), (statement.StaffMeals, statement.Hospitality, statement.RecipeTasting, statement.Spoilage));

        // The day against a 30 budget for staff meals: over.
        await node.Service<CostingService>(scope).SaveSettingsAsync(new CostingSettingsDto(30, StaffMeals: new StaffMealSettingsDto(30)), ct);
        var service = node.Service<StaffMealsService>(scope);
        var report = await service.GetAsync(today, today, ct);
        Assert.Equal(((decimal?)30m, 40m, 20m, 1), (report.DailyBudget, report.StaffMeals, report.Hospitality, report.DaysOverBudget));
        Assert.Equal([(today, 40m, 20m, true)], report.Days.Select(d => (d.Date, d.StaffMeals, d.Hospitality, d.OverBudget)));
        var logged = report.Entries.Single(e => e.EntryId == meal);
        Assert.Equal((StockMovementReason.StaffMeal, "2 × Burger · Lunch", 40m, "Omar"), (logged.Kind, logged.Note, logged.Value, logged.RecordedBy));

        // Voided like a waste entry: its stock back, out of the report.
        await node.Send(new RequestDeletionCommand(Guid.NewGuid(), ApprovalModule.Waste, meal, "Entered twice", "staff-omar", "Omar", CanApprove: true));
        Assert.Equal(9m, await node.Db(db => db.RawMaterials.Where(m => m.Id == patty).Select(m => m.QuantityOnHand).SingleAsync()));
        Assert.Equal((0m, 20m, 0), ((await service.GetAsync(today, today, ct)).StaffMeals, (await service.GetAsync(today, today, ct)).Hospitality,
            (await service.GetAsync(today, today, ct)).DaysOverBudget));
    }

    // A burger at 120: a 20 patty (Meat) and 50 g of mozzarella at 300 a kg (Dairy): 35, 29.2%.
    // Thirty sold today. What if everything rose 10%, dairy 50%, and the patty went to 30?
    [Fact]
    public async Task The_simulator_costs_every_dish_at_the_prices_given_and_saves_nothing()
    {
        await using var node = await TestSystem.StartAsync();
        Assert.True(await TestSystem.WaitFor(() => node.Db(db => db.MenuItems.AnyAsync())));
        var ct = TestContext.Current.CancellationToken;
        using var scope = node.Scope();
        var today = node.Service<IntelligenceService>(scope).Today;
        async Task<Guid> Category(string name) =>
            (await node.Send(new SavePurchaseCategoryCommand(Guid.NewGuid(), name, null, ExpenseLine.Controllable, CategoryKind.RawMaterials))).Id;
        var (meat, dairy) = (await Category("Meat"), await Category("Dairy"));
        var patty = (await node.Send(new CreateRawMaterialCommand("Patty", UnitOfMeasure.Piece, CategoryId: meat, PurchaseUnit: "piece", PurchaseUnitSize: 1,
            CostPerPurchaseUnit: 20))).Id;
        var cheese = (await node.Send(new CreateRawMaterialCommand("Mozzarella", UnitOfMeasure.Gram, CategoryId: dairy, PurchaseUnit: "kg", PurchaseUnitSize: 1000,
            CostPerPurchaseUnit: 300))).Id;
        await node.Send(new CreateRawMaterialCommand("Salt", UnitOfMeasure.Gram, PurchaseUnit: "kg", PurchaseUnitSize: 1000, CostPerPurchaseUnit: 10));
        await node.Send(new SetRecipeCommand(RecipeTargetKind.MenuItem, TestMenu.Burger, null, [new(patty, 1), new(cheese, 50)]));
        await node.Send(new RecordDailySalesCommand(Guid.NewGuid(), today, [new(TestMenu.Burger, null, 30)], "Omar"));

        var costing = node.Service<CostingService>(scope);
        var report = await costing.SimulateInflationAsync(new InflationScenario(10, [new(dairy, 50)], [new(patty, 30)]), ct);
        var burger = report.Items.Single(i => i.Kind == SimulatedItemKind.Dish && i.ItemCode == "1");
        Assert.Equal(((decimal?)120m, 35m, 52.5m, 17.5m, (decimal?)50m, (decimal?)29.2m, (decimal?)43.8m, true, true),
            (burger.SellingPrice, burger.CurrentCost, burger.SimulatedCost, burger.Change, burger.ChangePercent, burger.CurrentFoodCostPercent,
                burger.SimulatedFoodCostPercent, burger.AboveTarget, burger.NewlyAboveTarget));
        // To keep 29.2%: 120 × 52.5 ÷ 35; to keep the 85 left a plate: 137.50. Not repriced, 30 plates lose 17.50 each.
        Assert.Equal(((decimal?)180m, (decimal?)137.5m, 30m, (decimal?)-525m), (burger.SuggestedPriceKeepFoodCost, burger.SuggestedPriceKeepMargin,
            burger.QuantityLast30Days, burger.MonthlyProfitImpact));
        Assert.Equal((3, 1, -525m), (report.MaterialsChanged, report.NewlyAboveTarget, report.MonthlyProfitImpact));
        Assert.Equal(
            [("Mozzarella", (decimal?)300m, 450m, (decimal?)50m), ("Patty", 20m, 30m, 50m), ("Salt", 10m, 11m, 10m)],
            report.Materials.Select(m => (m.Material, m.CurrentPrice, m.SimulatedPrice, m.ChangePercent)));

        // Nothing saved.
        Assert.Equal(20m, await node.Db(db => db.RawMaterials.Where(m => m.Id == patty).Select(m => m.AverageCost).SingleAsync()));
        Assert.Equal(35m, (await costing.SimulateInflationAsync(new InflationScenario(null, null, null), ct)).Items.Single(i => i.ItemCode == "1").SimulatedCost);
        await Assert.ThrowsAsync<Costing.Domain.Common.DomainException>(() => costing.SimulateInflationAsync(new InflationScenario(-95, null, null), ct));

        using var book = new XLWorkbook(InflationWorkbook.Build(report));
        Assert.Equal(["Simulation", "Prices"], book.Worksheets.Select(w => w.Name));
    }
}
