using Microsoft.EntityFrameworkCore;
using Costing.Domain.Treasury;
using Costing.Application.Common;
using Costing.Domain.Common;
using Costing.Domain.Sales;
using Costing.Domain.Categories;
using Costing.Domain.StockMovements;
using Costing.Infrastructure.Common;
using Costing.Infrastructure.Persistence;
using static Costing.Infrastructure.Reports.CostingService;

namespace Costing.Infrastructure.Reports;

public enum KpiStatus
{
    // Within the template's healthy range.
    Healthy,
    Above,
    Below,

    // The template gives no range: it depends on the kind of restaurant.
    NoRange,

    // A figure it needs has not been entered (wages, hours) or does not exist (no drinks sold).
    Missing,
}

// One indicator of the template. Value is a percentage, or money for the average check and sales
// per labour hour. HighIsBad says which side of the range is the worry: above for a cost %,
// below for a margin.
public sealed record Kpi(string Key, decimal? Value, decimal? HealthyFrom, decimal? HealthyTo, bool HighIsBad, KpiStatus Status, string? Missing);

// The month as an income statement, the KPIs' ground. Revenue is the month's net sales: its takings
// as each day's Z report gave them, cash and card, less the tax collected in them, which is owed to
// the tax authority and never the restaurant's (Gross takings = Net sales + Tax). Split between
// food and drinks as the month's sales summaries are, at the menu's prices.
public sealed record MonthStatement(
    decimal FoodSales,
    decimal BeverageSales,
    decimal DeliveryFees,
    decimal Revenue,
    int PaidOrders,
    // What the sales took by their recipes, at cost when sold, shared costs such as frying oil included.
    decimal FoodRecipeCost,
    decimal BeverageRecipeCost,
    // Kitchen voids less refund returns, spoilage, and what counts found missing (or over).
    decimal KitchenWaste,
    decimal Spoilage,
    decimal CountDifferences,
    decimal CostOfSales,
    decimal GrossProfit,
    // As entered for the month: wages, and what is paid without a purchase invoice.
    decimal? WagesAndBenefits,
    decimal? OtherControllableCosts,
    decimal? OccupationCost,
    decimal? Interest,
    decimal? Depreciation,
    // Null until the wages are in: without them a net profit would flatter.
    decimal? NetProfit,
    // Expense items on the month's posted purchase invoices, on the line each category says,
    // added to what is entered above; and each category's part.
    decimal LoggedControllableCosts = 0,
    decimal LoggedOccupationCost = 0,
    decimal LoggedOtherFixedCosts = 0,
    IReadOnlyList<LoggedExpense>? LoggedExpenses = null,
    // Wages paid as expenses (vouchers, invoices under a Wages category) and the finalized payroll's
    // wages, added to the wages entered.
    decimal LoggedWages = 0,
    // Every overhead: wages, controllable, occupation, other fixed, interest and depreciation.
    decimal TotalExpenses = 0,
    // Consumable assets broken in the month (Costing → Waste's breakage), at their cost. Said, not
    // counted again: what they cost was counted when they were bought, as an expense.
    decimal Breakage = 0,
    // The month's takings: cash and card before tax, all that was collected with the tax on them, the
    // tax (a liability, not revenue), the voids and refunds said, and how many days' takings are entered.
    decimal CashTakings = 0,
    decimal CardTakings = 0,
    decimal GrossTakings = 0,
    decimal TaxCollected = 0,
    decimal Voids = 0,
    int TakingsDays = 0,
    // What the month's sales summaries come to at the menu's prices, before tax.
    decimal SalesAtMenuPrices = 0);

public sealed record MonthlyExpensesDto(
    decimal? WagesAndBenefits,
    decimal? LabourHours,
    decimal? OtherControllableCosts,
    decimal? OccupationCost,
    decimal? Interest,
    decimal? Depreciation,
    DateTime? UpdatedAtUtc = null,
    string? UpdatedBy = null);

// The template's item profitability: selling price − ingredient cost, over what was sold.
public sealed record ItemProfit(
    string ItemCode, string MenuItem, string? MenuItemAr, string Category, bool Beverage, decimal QuantitySold,
    decimal NetSales, decimal? Cost, decimal? Profit, decimal? ProfitPerUnit, decimal? MarginPercent);

public sealed record KpiReport(
    int Year,
    int Month,
    DateOnly From,
    DateOnly To,
    IReadOnlyList<string> BeverageCategories,
    MonthStatement Statement,
    MonthlyExpensesDto Expenses,
    IReadOnlyList<Kpi> Kpis,
    IReadOnlyList<ItemProfit> Items,
    // Sold with no recipe: in the sales at no ingredient cost, so the cost % reads low.
    int ItemsWithoutRecipe,
    decimal SalesWithoutRecipe);

// Pillar 4: the template's financial KPIs for a business month. Sales and recipe costs come
// from the till; losses from the stock ledger; wages, hours and overheads from what the manager
// enters for the month.
public sealed class KpiService(CostingDbContext db, IBusinessCalendar clock, CostingService costing, SalesLedger ledger, PurchaseSpendingService spending)
{
    // The template's healthy ranges.
    private static readonly (decimal From, decimal To) FoodCostRange = (28, 35);
    private static readonly (decimal From, decimal To) BeverageCostRange = (20, 25);
    private static readonly (decimal From, decimal To) LabourCostRange = (25, 35);
    private static readonly (decimal From, decimal To) GrossMarginRange = (60, 70);
    private static readonly (decimal From, decimal To) NetMarginRange = (5, 15);

    private static readonly StockMovementReason[] Losses =
        [StockMovementReason.Waste, StockMovementReason.VoidReturn, StockMovementReason.Spoilage, StockMovementReason.CountAdjustment];

    public async Task<KpiReport> GetAsync(int year, int month, CancellationToken cancellationToken)
    {
        // Checks the month, and gives what each dish sold and what its recipes cost.
        var theoretical = await costing.GetTheoreticalCostAsync(year, month, cancellationToken);
        var settings = await db.CostingSettings.AsNoTracking().SingleOrDefaultAsync(cancellationToken) ?? new CostingSettings();
        var beverages = settings.BeverageCategories.ToHashSet(StringComparer.OrdinalIgnoreCase);
        bool IsBeverage(string? category) => category is not null && beverages.Contains(category);

        var (from, _) = clock.Bounds(theoretical.From);
        var (_, to) = clock.Bounds(theoretical.To);

        // What was sold, at the menu's prices (a bill entered as printed: what it charged), less each
        // bill's promo discount shared over its lines by value, before VAT: how the revenue is
        // split between food and drinks.
        var orders = await ledger.GetAsync(from, to, cancellationToken);
        var categoryOf = await db.MenuItems.AsNoTracking().IgnoreQueryFilters()
            .ToDictionaryAsync(m => m.Id, m => m.Category, cancellationToken);
        decimal food = 0, drinks = 0, deliveryFees = 0;
        var paidOrders = 0;
        foreach (var order in orders)
        {
            var lines = order.Lines.Where(l => l.OnBill).ToList();
            if (lines.Count == 0)
                continue;
            paidOrders++;
            var billed = order.BilledSubtotal;
            var kept = billed > 0 ? 1 - Math.Min(order.DiscountAmount, billed) / billed : 1;
            foreach (var line in lines)
            {
                var revenue = line.LineTotal * kept;
                if (IsBeverage(categoryOf.GetValueOrDefault(line.MenuItemId)))
                    drinks += revenue;
                else
                    food += revenue;
            }
            deliveryFees += order.DeliveryFee;
        }
        var soldAtMenuPrices = food + drinks + deliveryFees;

        // Revenue: the month's net sales, the cash and card each day's Z report gave before the tax
        // collected on them, which is owed, never revenue. A voided day nets out with its reversal.
        var takings = await db.SafeTransactions.AsNoTracking()
            .Where(t => t.Kind == SafeTransactionKind.RevenueTransfer && t.RevenueDate >= theoretical.From && t.RevenueDate <= theoretical.To)
            .ToListAsync(cancellationToken);
        var revenueTotal = takings.Sum(t => t.NetAmount);
        var takingsDays = takings.Where(t => !t.IsReversal && !t.IsVoided).Select(t => t.RevenueDate).Distinct().Count();
        (food, drinks) = food + drinks > 0
            ? (revenueTotal * food / (food + drinks), revenueTotal - revenueTotal * food / (food + drinks))
            : (revenueTotal, 0m);
        var noTakings = revenueTotal == 0 ? "Enter the month's takings on Financials. · أدخل إيراد الشهر في الماليات." : null;

        var foodRecipe = theoretical.Rows.Where(r => !IsBeverage(r.Category)).Sum(r => r.TheoreticalCost);
        var drinksRecipe = theoretical.Rows.Where(r => IsBeverage(r.Category)).Sum(r => r.TheoreticalCost);

        // Losses from the ledger, valued at the cost when each happened. Shared-cost materials are
        // left out: their month is already in the recipe cost, as the shared cost per meal.
        var sharedMaterials = await db.SharedCosts.AsNoTracking()
            .Where(c => c.RawMaterialId != null).Select(c => c.RawMaterialId!.Value).ToListAsync(cancellationToken);
        var losses = await db.StockMovements.AsNoTracking()
            .Where(m => m.OccurredAtUtc >= from && m.OccurredAtUtc < to && Losses.Contains(m.Reason)
                && !sharedMaterials.Contains(m.RawMaterialId) && m.UnitCost != null)
            .GroupBy(m => m.Reason)
            .Select(g => new { Reason = g.Key, Value = g.Sum(m => -m.Quantity * m.UnitCost!.Value) })
            .ToListAsync(cancellationToken);
        decimal Loss(params StockMovementReason[] reasons) => Money(losses.Where(l => reasons.Contains(l.Reason)).Sum(l => l.Value));
        var kitchenWaste = Loss(StockMovementReason.Waste, StockMovementReason.VoidReturn);
        var spoilage = Loss(StockMovementReason.Spoilage);
        var countDifferences = Loss(StockMovementReason.CountAdjustment);
        var lossTotal = kitchenWaste + spoilage + countDifferences;

        var costOfSales = foodRecipe + drinksRecipe + lossTotal;
        var grossProfit = revenueTotal - costOfSales;

        var expenses = await db.MonthlyExpenses.AsNoTracking().SingleOrDefaultAsync(e => e.Year == year && e.Month == month, cancellationToken);
        // The month's expense invoices and vouchers, on top of what is entered: an electricity bill
        // logged as a purchase, or salaries paid by voucher, are not typed in again.
        var logged = await spending.LoggedExpensesAsync(theoretical.From, theoretical.To, cancellationToken);
        decimal Logged(ExpenseLine line) => Money(logged.Where(e => e.ExpenseLine == line).Sum(e => e.Amount));
        var (loggedControllable, loggedOccupation, loggedOtherFixed, loggedWages) =
            (Logged(ExpenseLine.Controllable), Logged(ExpenseLine.Occupation), Logged(ExpenseLine.OtherFixed), Logged(ExpenseLine.Wages));
        // The month's salaries paid from the safe (صرف راتب), by the payroll month they are for, a
        // voided one netted out by its reversal. Advances are settled against pay, not counted again.
        var payrollMonth = new DateOnly(year, month, 1);
        loggedWages += Money(-await db.SafeTransactions.AsNoTracking()
            .Where(t => t.Kind == SafeTransactionKind.SalaryPayment && t.PayrollMonth == payrollMonth)
            .SumAsync(t => t.Amount, cancellationToken));
        // Known once entered or paid: wages as entered plus wages paid as expenses.
        decimal? wages = expenses?.WagesAndBenefits is null && loggedWages == 0 ? null : (expenses?.WagesAndBenefits ?? 0) + loggedWages;
        var totalExpenses = (wages ?? 0) + (expenses?.OtherControllableCosts ?? 0) + (expenses?.OccupationCost ?? 0)
            + (expenses?.Interest ?? 0) + (expenses?.Depreciation ?? 0) + loggedControllable + loggedOccupation + loggedOtherFixed;
        decimal? netProfit = wages is not null ? grossProfit - totalExpenses : null;
        var breakage = Money(await db.BreakageEntries.AsNoTracking()
            .Where(b => b.BusinessDate >= theoretical.From && b.BusinessDate <= theoretical.To && b.VoidedAtUtc == null)
            .SumAsync(b => b.Cost, cancellationToken));

        decimal? Share(decimal part, decimal whole) => whole > 0 ? Percent(part / whole) : null;
        var kpis = new List<Kpi>
        {
            // Losses are counted against food: the stock they come from is mostly the kitchen's.
            Ranged("FoodCost", Share(foodRecipe + lossTotal, food), FoodCostRange, highIsBad: true,
                noTakings ?? (food > 0 ? null : "No food was sold this month.")),
            Ranged("BeverageCost", Share(drinksRecipe, drinks), BeverageCostRange, highIsBad: true,
                beverages.Count == 0 ? "Mark the drinks categories in Settings." : noTakings ?? (drinks > 0 ? null : "No drinks were sold this month.")),
            Ranged("LabourCost", wages is { } wage ? Share(wage, revenueTotal) : null, LabourCostRange, highIsBad: true,
                wages is null ? "Enter the month's wages and benefits." : noTakings),
            // Sales are entered as each day's totals: there are no bills to average.
            Unranged("AverageCheck", null, "Sales are entered as daily totals, not bills. · المبيعات تُسجل إجماليًا يوميًا."),
            Unranged("SalesPerLabourHour", expenses?.LabourHours is > 0 and var hours ? Money(revenueTotal / hours) : null,
                expenses?.LabourHours is > 0 ? null : "Enter the month's labour hours."),
            Ranged("GrossProfitMargin", Share(grossProfit, revenueTotal), GrossMarginRange, highIsBad: false, noTakings),
            Ranged("NetProfitMargin", netProfit is { } net ? Share(net, revenueTotal) : null, NetMarginRange, highIsBad: false,
                wages is null ? "Enter the month's wages and overheads." : null),
        };

        var items = theoretical.Rows
            .Select(r =>
            {
                var costed = r.Status != CostStatus.NoRecipe;
                decimal? profit = costed ? r.NetSales - r.TheoreticalCost : null;
                return new ItemProfit(
                    r.ItemCode, r.MenuItem, r.MenuItemAr, r.Category, IsBeverage(r.Category), r.QuantitySold, r.NetSales,
                    costed ? r.TheoreticalCost : null, profit, profit is { } p && r.QuantitySold > 0 ? Money(p / r.QuantitySold) : null,
                    profit is { } q && r.NetSales > 0 ? Percent(q / r.NetSales) : null);
            })
            .OrderByDescending(i => i.Profit ?? decimal.MinValue)
            .ThenByDescending(i => i.NetSales)
            .ToList();
        var withoutRecipe = theoretical.Rows.Where(r => r.Status == CostStatus.NoRecipe).ToList();

        return new KpiReport(
            year, month, theoretical.From, theoretical.To, settings.BeverageCategories,
            new MonthStatement(
                Money(food), Money(drinks), 0, Money(revenueTotal), paidOrders,
                Money(foodRecipe), Money(drinksRecipe), kitchenWaste, spoilage, countDifferences,
                Money(costOfSales), Money(grossProfit),
                expenses?.WagesAndBenefits, expenses?.OtherControllableCosts, expenses?.OccupationCost, expenses?.Interest, expenses?.Depreciation,
                Money(netProfit), loggedControllable, loggedOccupation, loggedOtherFixed, logged, loggedWages, Money(totalExpenses), breakage,
                Money(takings.Sum(t => t.GrossAmount ?? t.Amount)), Money(takings.Sum(t => t.CardAmount)), Money(takings.Sum(t => t.TakingsTotal)),
                Money(takings.Sum(t => t.TaxAmount)), Money(takings.Sum(t => t.VoidsAmount)),
                takingsDays, Money(soldAtMenuPrices)),
            ToDto(expenses), kpis, items,
            withoutRecipe.Count, withoutRecipe.Sum(r => r.NetSales));
    }

    public async Task<MonthlyExpensesDto> SaveExpensesAsync(int year, int month, MonthlyExpensesDto request, string? by, CancellationToken cancellationToken)
    {
        var row = await db.MonthlyExpenses.SingleOrDefaultAsync(e => e.Year == year && e.Month == month, cancellationToken);
        if (row is null)
            db.MonthlyExpenses.Add(row = new MonthlyExpenses { Year = year, Month = month });
        row.WagesAndBenefits = request.WagesAndBenefits;
        row.LabourHours = request.LabourHours;
        row.OtherControllableCosts = request.OtherControllableCosts;
        row.OccupationCost = request.OccupationCost;
        row.Interest = request.Interest;
        row.Depreciation = request.Depreciation;
        row.UpdatedAtUtc = DateTime.UtcNow;
        row.UpdatedBy = by;
        row.Validate();
        await db.SaveChangesAsync(cancellationToken);
        return ToDto(row);
    }

    private static MonthlyExpensesDto ToDto(MonthlyExpenses? e) =>
        new(e?.WagesAndBenefits, e?.LabourHours, e?.OtherControllableCosts, e?.OccupationCost, e?.Interest, e?.Depreciation, e?.UpdatedAtUtc, e?.UpdatedBy);

    private static Kpi Ranged(string key, decimal? value, (decimal From, decimal To) range, bool highIsBad, string? missing) =>
        new(key, missing is null ? value : null, range.From, range.To, highIsBad,
            missing is not null || value is null ? KpiStatus.Missing
            : value > range.To ? KpiStatus.Above
            : value < range.From ? KpiStatus.Below
            : KpiStatus.Healthy,
            missing ?? (value is null ? "Nothing to measure this month." : null));

    private static Kpi Unranged(string key, decimal? value, string? missing) =>
        new(key, missing is null ? value : null, null, null, false, missing is null && value is not null ? KpiStatus.NoRange : KpiStatus.Missing, missing);
}
