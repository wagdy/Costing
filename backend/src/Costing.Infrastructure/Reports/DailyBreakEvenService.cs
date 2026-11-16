using Microsoft.EntityFrameworkCore;
using Costing.Application.Common;
using Costing.Domain.Common;
using Costing.Domain.Production;
using Costing.Domain.Recipes;
using Costing.Infrastructure.Persistence;
using static Costing.Infrastructure.Reports.CostingService;

namespace Costing.Infrastructure.Reports;

// The dynamic daily break-even (نقطة التعادل اليومية الديناميكية): what a day must sell to cover its
// share of the month's fixed costs, at the contribution margin of what it actually sold.
//
//   Daily fixed cost        = the month's fixed costs ÷ its days
//   Net sales               = the day's sales at the menu's prices, less each bill's discount, before VAT
//   Food cost               = what those plates' recipes cost at today's costs (RecipeCosts)
//   Contribution margin     = net sales − food cost
//   WACM %                  = contribution margin ÷ net sales × 100   (the weighted average, by today's mix)
//   Break-even sales        = daily fixed cost ÷ WACM
//   Operating result        = contribution margin − daily fixed cost
//
// The month's fixed costs are the burdened plate cost's pools for the whole month: its labor
// (payroll, salaries, wages entered and paid as expenses) and its overheads (rent, controllable
// costs, interest, depreciation, and the expense invoices and vouchers under them). A month with
// nothing recorded for one takes its stand-in from Cost settings, so a day early in a month still
// has a target. A day with no sales yet takes the WACM of the seven days before it.
public sealed record DailyBreakEven(
    DateOnly Date,
    bool IsToday,
    int DaysInMonth,
    decimal MonthlyFixedCosts,
    decimal DailyFixedCosts,
    // The month's pools the fixed costs are made of, and the months that took a stand-in.
    CostPool Labor,
    CostPool Overhead,
    decimal NetSales,
    decimal FoodCost,
    decimal? FoodCostPercent,
    decimal ContributionMargin,
    // The margin the target is worked at: today's, or the seven days before's when nothing sold yet.
    decimal? WacmPercent,
    bool WacmEstimated,
    DateOnly? HistoryFrom,
    DateOnly? HistoryTo,
    decimal? BreakEvenSales,
    // Still to sell to break even; none once reached.
    decimal? StillToSell,
    // Sales against the target, as a percentage.
    decimal? ProgressPercent,
    bool BreakEvenReached,
    decimal OperatingResult,
    int Plates,
    // Sold with no recipe: in the sales at no food cost, so the margin reads high.
    int PlatesWithoutRecipe,
    decimal SalesWithoutRecipe,
    bool MissingPrices);

public sealed class DailyBreakEvenService(CostingDbContext db, IBusinessCalendar clock, SalesLedger ledger, BurdenedCostService pools)
{
    private const int HistoryDays = 7;

    // A day's sales by its mix: what was sold for, what its recipes cost now, and the plates.
    private sealed record DaySales(decimal NetSales, decimal FoodCost, int Plates, int PlatesWithoutRecipe, decimal SalesWithoutRecipe, bool MissingPrices);

    public async Task<DailyBreakEven> GetAsync(DateOnly? date, CancellationToken cancellationToken)
    {
        var today = clock.BusinessDateOf(DateTime.UtcNow);
        var day = date ?? today;
        if (day > today)
            throw new DomainException("Choose a day that has begun. · اختر يومًا بدأ.");
        if (day < today.AddYears(-5))
            throw new DomainException("Choose a day in the last five years. · اختر يومًا خلال خمس سنوات.");

        var settings = await db.CostingSettings.AsNoTracking().SingleOrDefaultAsync(cancellationToken) ?? new CostingSettings();
        var month = new DateOnly(day.Year, day.Month, 1);
        var monthEnd = month.AddMonths(1).AddDays(-1);
        var daysInMonth = monthEnd.Day;
        var (labor, overhead) = await pools.ActualAsync(month, monthEnd, settings, cancellationToken);
        var monthlyFixed = labor.Total + overhead.Total;
        var dailyFixed = monthlyFixed / daysInMonth;

        var historyFrom = day.AddDays(-HistoryDays);
        var sales = await SalesByDayAsync(historyFrom, day, cancellationToken);
        var sold = sales.GetValueOrDefault(day) ?? new DaySales(0, 0, 0, 0, 0, false);
        var margin = sold.NetSales - sold.FoodCost;

        decimal? wacm = sold.NetSales > 0 ? margin / sold.NetSales : null;
        var estimated = false;
        if (wacm is null)
        {
            var before = sales.Where(s => s.Key < day).Select(s => s.Value).ToList();
            var historySales = before.Sum(s => s.NetSales);
            if (historySales > 0)
            {
                wacm = (historySales - before.Sum(s => s.FoodCost)) / historySales;
                estimated = true;
            }
        }

        decimal? target = wacm > 0 ? dailyFixed / wacm.Value : null;
        var reached = target is { } t && sold.NetSales >= t && t >= 0;
        return new DailyBreakEven(
            day, day == today, daysInMonth, Money(monthlyFixed), Money(dailyFixed), labor, overhead,
            Money(sold.NetSales), Money(sold.FoodCost), sold.NetSales > 0 ? Percent(sold.FoodCost / sold.NetSales) : null, Money(margin),
            wacm is { } w ? Percent(w) : null, estimated, estimated ? historyFrom : null, estimated ? day.AddDays(-1) : null,
            Money(target), target is { } s ? Money(Math.Max(0, s - sold.NetSales)) : null,
            target > 0 ? Percent(sold.NetSales / target.Value) : null, reached,
            Money(margin - dailyFixed), sold.Plates, sold.PlatesWithoutRecipe, Money(sold.SalesWithoutRecipe), sold.MissingPrices);
    }

    // Each day's sales from first to last, at the menu's prices less each bill's discount shared
    // over its lines by value, before VAT; delivery fees are not food. Each line costed by the
    // recipes it sells by (its add-ons' too) at today's costs, prep items by RecipeCosts.
    private async Task<IReadOnlyDictionary<DateOnly, DaySales>> SalesByDayAsync(DateOnly first, DateOnly last, CancellationToken cancellationToken)
    {
        var (from, _) = clock.Bounds(first);
        var (_, to) = clock.Bounds(last);
        var orders = await ledger.GetAsync(from, to, cancellationToken);
        if (orders.Count == 0)
            return new Dictionary<DateOnly, DaySales>();

        var recipes = await db.Recipes.AsNoTracking().Include(r => r.Ingredients).Where(r => r.DeletedAtUtc == null).ToListAsync(cancellationToken);
        var combos = await db.ComboPartsAsync(cancellationToken);
        var materials = await db.RawMaterials.AsNoTracking().ToDictionaryAsync(m => m.Id, cancellationToken);
        var costs = new RecipeCosts(materials, await db.PrepRecipes.AsNoTracking().Include(r => r.Ingredients).ToListAsync(cancellationToken));

        return orders
            .Where(o => o.BusinessDate >= first && o.BusinessDate <= last)
            .GroupBy(o => o.BusinessDate)
            .ToDictionary(g => g.Key, g =>
            {
                decimal net = 0, food = 0, withoutRecipe = 0;
                int plates = 0, platesWithoutRecipe = 0;
                var missing = false;
                foreach (var order in g)
                {
                    var billed = order.BilledSubtotal;
                    var kept = billed > 0 ? 1 - Math.Min(order.DiscountAmount, billed) / billed : 1;
                    foreach (var line in order.Lines.Where(l => l.OnBill && l.Quantity > 0))
                    {
                        var revenue = line.LineTotal * kept;
                        net += revenue;
                        plates += line.Quantity;
                        var needs = StockRequirements.For(new SoldItem(line.MenuItemId, line.VariantId, line.AddOnIds, line.Quantity), recipes, combos);
                        if (needs.Count == 0)
                        {
                            platesWithoutRecipe += line.Quantity;
                            withoutRecipe += revenue;
                            continue;
                        }
                        food += needs.Sum(n => n.Value * (costs.Of(n.Key).PerUnit ?? 0));
                        missing |= needs.Keys.Any(id => costs.Of(id).PerUnit is null || costs.Of(id).Missing.Count > 0);
                    }
                }
                return new DaySales(net, food, plates, platesWithoutRecipe, withoutRecipe, missing);
            });
    }
}
