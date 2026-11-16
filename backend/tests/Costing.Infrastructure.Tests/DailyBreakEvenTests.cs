using Microsoft.EntityFrameworkCore;
using Costing.Application.RawMaterials;
using Costing.Application.Recipes;
using Costing.Application.Sales;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;
using Costing.Infrastructure.Reports;

namespace Costing.Infrastructure.Tests;

// The dynamic daily break-even: each month's fixed costs set at 1,000 a day (600 of wages and 400
// of rent a day, entered for the month), burgers (120, 20 of food) and steaks (300, 150) sold.
public class DailyBreakEvenTests
{
    [Fact]
    public async Task A_day_breaks_even_at_its_share_of_the_fixed_costs_over_the_margin_its_mix_leaves()
    {
        await using var node = await TestSystem.StartAsync();
        Assert.True(await TestSystem.WaitFor(() => node.Db(db => db.MenuItems.AnyAsync())));
        var ct = TestContext.Current.CancellationToken;
        using var scope = node.Scope();
        var today = node.Service<IntelligenceService>(scope).Today;
        await node.Db(db => db.Database.ExecuteSqlRawAsync("""
            INSERT INTO costing."MenuItems" ("Id", "Name", "Category", "Price", "IsAvailable", "IsPriceBasedOnAddons", "IsDeleted", "AddOnIds") VALUES
                (30, 'Steak', 'Mains', 300, true, false, false, ARRAY[]::integer[]);
            """, ct));
        async Task<Guid> Piece(string name, decimal cost) =>
            (await node.Send(new CreateRawMaterialCommand(name, UnitOfMeasure.Piece, PurchaseUnit: "piece", PurchaseUnitSize: 1, CostPerPurchaseUnit: cost))).Id;
        await node.Send(new SetRecipeCommand(RecipeTargetKind.MenuItem, TestMenu.Burger, null, [new(await Piece("Patty", 20), 1)]));
        await node.Send(new SetRecipeCommand(RecipeTargetKind.MenuItem, 30, null, [new(await Piece("Steak cut", 150), 1)]));

        // 1,000 a day of fixed costs in each month these days fall in.
        var kpis = node.Service<KpiService>(scope);
        foreach (var month in new[] { today, today.AddDays(-2) }.Select(d => new DateOnly(d.Year, d.Month, 1)).Distinct())
        {
            var days = month.AddMonths(1).AddDays(-1).Day;
            await kpis.SaveExpensesAsync(month.Year, month.Month, new MonthlyExpensesDto(600m * days, null, null, 400m * days, null, null), "Omar", ct);
        }

        // Two days ago, 10 burgers; today, 10 burgers, 5 steaks and 4 lemonades (no recipe).
        await node.Send(new RecordDailySalesCommand(Guid.NewGuid(), today.AddDays(-2), [new(TestMenu.Burger, null, 10)], "Omar"));
        await node.Send(new RecordDailySalesCommand(Guid.NewGuid(), today,
            [new(TestMenu.Burger, null, 10), new(30, null, 5), new(TestMenu.Lemonade, null, 4)], "Omar"));

        var service = node.Service<DailyBreakEvenService>(scope);
        var now = await service.GetAsync(null, ct);
        // 2,820 sold, 950 of food: 1,870 left, 66.3% of each pound; 1,000 ÷ 66.3% = 1,508.02 to break even.
        Assert.Equal((today, true, 1_000m, 2_820m, 950m, (decimal?)33.7m, 1_870m, (decimal?)66.3m, false),
            (now.Date, now.IsToday, now.DailyFixedCosts, now.NetSales, now.FoodCost, now.FoodCostPercent, now.ContributionMargin, now.WacmPercent,
                now.WacmEstimated));
        Assert.Equal(((decimal?)1_508.02m, (decimal?)0m, (decimal?)187m, true, 870m),
            (now.BreakEvenSales, now.StillToSell, now.ProgressPercent, now.BreakEvenReached, now.OperatingResult));
        Assert.Equal((19, 4, 120m), (now.Plates, now.PlatesWithoutRecipe, now.SalesWithoutRecipe));
        Assert.Equal(1_000m * now.DaysInMonth, now.MonthlyFixedCosts);
        Assert.Equal([("wagesEntered", 600m * now.DaysInMonth)], now.Labor.Parts.Select(p => (p.Key, p.Amount)));
        Assert.Equal([("occupation", 400m * now.DaysInMonth)], now.Overhead.Parts.Select(p => (p.Key, p.Amount)));

        // Yesterday, nothing sold: the target at the seven days before's margin, the burgers' 83.3%.
        var yesterday = await service.GetAsync(today.AddDays(-1), ct);
        Assert.Equal((false, 0m, true, (decimal?)83.3m, today.AddDays(-8), today.AddDays(-2)),
            (yesterday.IsToday, yesterday.NetSales, yesterday.WacmEstimated, yesterday.WacmPercent, yesterday.HistoryFrom, yesterday.HistoryTo));
        Assert.Equal(((decimal?)1_200m, (decimal?)1_200m, (decimal?)0m, false, -1_000m),
            (yesterday.BreakEvenSales, yesterday.StillToSell, yesterday.ProgressPercent, yesterday.BreakEvenReached, yesterday.OperatingResult));

        // A month with nothing recorded takes Cost settings' stand-ins; with no sales near it, no target.
        await node.Service<CostingService>(scope).SaveSettingsAsync(new CostingSettingsDto(30, PlateCost: new PlateCostSettingsDto(
            OverheadAllocationMethod.ActivityBasedPrepTime, 15, 30_000, 15_000)), ct);
        var quiet = new DateOnly(today.Year, today.Month, 1).AddMonths(-4);
        var standIn = await service.GetAsync(quiet, ct);
        var quietDays = quiet.AddMonths(1).AddDays(-1).Day;
        Assert.Equal((45_000m, Math.Round(45_000m / quietDays, 2), (decimal?)null, (decimal?)null, -Math.Round(45_000m / quietDays, 2)),
            (standIn.MonthlyFixedCosts, standIn.DailyFixedCosts, standIn.WacmPercent, standIn.BreakEvenSales, standIn.OperatingResult));
        Assert.Equal([$"{quiet:MMM yyyy}"], standIn.Labor.StandInMonths);

        await Assert.ThrowsAsync<Costing.Domain.Common.DomainException>(() => service.GetAsync(today.AddDays(1), ct));
    }
}
