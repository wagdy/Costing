using Microsoft.EntityFrameworkCore;
using Costing.Domain.Categories;
using Costing.Domain.Common;
using Costing.Domain.Recipes;
using Costing.Domain.Treasury;
using Costing.Infrastructure.Persistence;
using static Costing.Infrastructure.Reports.CostingService;

namespace Costing.Infrastructure.Reports;

// The fully burdened plate cost (محرك التكلفة الكلية للطبق): each dish's food, its share of the
// period's labor and of its overheads, and what is left of its price after all three.
//
//   Fully burdened cost  = food cost + allocated labor + allocated overheads
//   Prime cost           = food cost + allocated labor
//   True net profit      = selling price (before VAT) − fully burdened cost; × plates sold for the period
//   True net margin %    = true net profit ÷ selling price × 100
//
// The pools, for the days chosen. Each month is taken whole and spread evenly over its days, so a
// rent paid on the 1st, or a payroll approved on the 30th, is carried by every plate of the month,
// and a part of a month carries its share by days (15 of 30 days: half):
//
//   Labor     the month's payroll approved on HR (its labor cost), or the salaries paid from the safe
//             for it when HR sent none, the wages and benefits entered for it on the KPIs, and the
//             expense invoices and vouchers filed under a Wages category: as the KPIs' labor cost.
//   Overheads the month's occupation (rent), controllable costs (utilities, running costs),
//             interest and depreciation entered on the KPIs, and its expense invoices and vouchers
//             under an Occupation, Controllable or Other fixed category: the P&L's overheads.
//
// A month with nothing recorded for a pool takes the cost settings' stand-in monthly figure for it
// when one is set, and says so. Simulated, the pools are the monthly figures given instead, spread
// the same way. Food cost is each recipe card's cost per portion now: the moving averages, prep
// items by their batches (or their recipes before the first), and the shared costs.
public enum PoolSource
{
    Actual = 1,
    Simulated = 2,
}

public enum PlateStatus
{
    // At or above the target net margin.
    Healthy = 1,
    // Profitable, below the target.
    Thin = 2,
    // Losing money once labor and overheads are added.
    Losing = 3,
    NoRecipe = 4,
    NoPrice = 5,
    // Nothing was sold in the period to share the pools over.
    NotAllocated = 6,
}

// One part of a pool, as the screen and the sheet list them.
public sealed record CostPoolPart(string Key, string Label, string LabelAr, decimal Amount);

// A pool for the days: its parts, and the months that took the stand-in figure.
public sealed record CostPool(decimal Total, IReadOnlyList<CostPoolPart> Parts, IReadOnlyList<string> StandInMonths);

public sealed record BurdenedPlateRow(
    string ItemCode,
    int? MenuItemId,
    int? VariantId,
    Guid? RecipeId,
    string Dish,
    string? DishAr,
    string? Category,
    bool OnMenu,
    decimal QuantitySold,
    // Not sold in the period: its shares are what a plate of it would have carried.
    bool Estimated,
    decimal? SellingPrice,
    decimal? PrepTimeMinutes,
    decimal ComplexityWeight,
    decimal WeightedMinutes,
    bool PrepTimeAssumed,
    decimal? DirectFoodCost,
    decimal? FoodCostPercent,
    decimal? AllocatedLaborCost,
    decimal? LaborCostPercent,
    decimal? PrimeCost,
    decimal? PrimeCostPercent,
    decimal? AllocatedOverheadCost,
    decimal? OverheadCostPercent,
    decimal? FullyBurdenedCost,
    decimal? FullyBurdenedCostPercent,
    decimal? TrueNetProfitPerPlate,
    decimal? TrueNetMarginPercent,
    decimal? TotalPeriodNetProfit,
    decimal? SuggestedPriceForTargetNetMargin,
    // Above its food cost, below zero once labor and overheads are added (أطباق خاسرة بعد التحميل).
    bool BleedingAfterOverhead,
    bool MissingPrices,
    PlateStatus Status);

public sealed record BurdenedCostReport(
    DateOnly From,
    DateOnly To,
    int Days,
    OverheadAllocationMethod Method,
    PoolSource Source,
    decimal TargetNetMarginPercent,
    CostPool Labor,
    CostPool Overhead,
    decimal PlatesSold,
    decimal Sales,
    // The rates the pools were shared at: a plate, a pound of sales, a weighted minute.
    decimal? LaborPerPlate,
    decimal? LaborPerRevenue,
    decimal? LaborPerWeightedMinute,
    decimal? OverheadPerPlate,
    decimal? OverheadPerRevenue,
    // What the plates sold carried: each pool's allocated part, and on average a plate.
    decimal LaborAllocated,
    decimal? AverageLaborPerPlate,
    decimal OverheadAllocated,
    decimal? AverageOverheadPerPlate,
    // Over the plates sold, weighted by their sales.
    decimal? AverageFullyBurdenedCostPercent,
    decimal? AverageTrueNetMarginPercent,
    decimal TotalPeriodNetProfit,
    int DishesBleeding,
    IReadOnlyList<BurdenedPlateRow> Rows,
    IReadOnlyList<string> Categories);

// One recipe's burdened plate, for its card: the month so far, as the cost settings share it.
public sealed record BurdenedRecipeCost(
    DateOnly From, DateOnly To, OverheadAllocationMethod Method, decimal TargetNetMarginPercent, decimal PlatesSold, BurdenedPlateRow? Plate);

public sealed class BurdenedCostService(CostingDbContext db, Application.Common.IBusinessCalendar clock, CostingService costing, PurchaseSpendingService spending)
{
    private static readonly ExpenseLine[] OverheadLines = [ExpenseLine.Occupation, ExpenseLine.Controllable, ExpenseLine.OtherFixed];

    public async Task<BurdenedCostReport> GetAsync(
        DateOnly from, DateOnly to, OverheadAllocationMethod? method, PoolSource source, decimal? monthlyLabor, decimal? monthlyOverhead,
        CancellationToken cancellationToken)
    {
        if (to < from)
            throw new DomainException("The first day must come before the last. · اليوم الأول قبل الأخير.");
        if (to > from.AddYears(2))
            throw new DomainException("Choose two years at most. · سنتان على الأكثر.");
        if (method is { } m && !Enum.IsDefined(m))
            throw new DomainException("Choose how labor and overheads are shared. · اختر طريقة التحميل.");
        if (monthlyLabor < 0 || monthlyOverhead < 0)
            throw new DomainException("A month's labor or overheads cannot be negative. · المصاريف الشهرية لا تكون سالبة.");

        var settings = await db.CostingSettings.AsNoTracking().SingleOrDefaultAsync(cancellationToken) ?? new CostingSettings();
        var chosen = method ?? settings.DefaultOverheadAllocationMethod;
        var (labor, overhead) = source == PoolSource.Simulated
            ? Simulated(from, to, monthlyLabor ?? settings.FallbackMonthlyLaborCost ?? 0, monthlyOverhead ?? settings.FallbackMonthlyOverheadCost ?? 0)
            : await ActualAsync(from, to, settings, cancellationToken);

        var bases = await costing.PlateBasesAsync(from, to, cancellationToken);
        var rates = PlateCostAllocation.Rates(chosen, labor.Total, overhead.Total,
            bases.Select(b => new PlateDriver(b.QuantitySold, b.Price, b.Price is { } p ? p * b.QuantitySold : b.NetSales, b.WeightedMinutes)));
        var target = settings.TargetNetMarginPercent;
        var rows = bases.Select(b => Row(b, rates, target))
            .OrderByDescending(r => r.QuantitySold > 0)
            .ThenBy(r => r.TrueNetMarginPercent ?? decimal.MaxValue)
            .ThenBy(r => r.Dish, StringComparer.CurrentCultureIgnoreCase)
            .ToList();

        var sold = rows.Where(r => r.QuantitySold > 0).ToList();
        // What the plates sold carried, from their exact shares: the pool, to the piastre.
        var shares = bases.Where(x => x.QuantitySold > 0).Select(x => (x.QuantitySold, Share: rates.For(x.Price, x.WeightedMinutes))).ToList();
        var laborAllocated = shares.Sum(x => (x.Share.Labor ?? 0) * x.QuantitySold);
        var overheadAllocated = shares.Sum(x => (x.Share.Overhead ?? 0) * x.QuantitySold);
        var weighed = sold.Where(r => r is { SellingPrice: > 0, FullyBurdenedCost: not null }).ToList();
        var weighedSales = weighed.Sum(r => r.SellingPrice!.Value * r.QuantitySold);
        decimal? Weighted(Func<BurdenedPlateRow, decimal> value) =>
            weighedSales > 0 ? Percent(weighed.Sum(r => value(r) * r.QuantitySold) / weighedSales) : null;

        return new BurdenedCostReport(
            from, to, to.DayNumber - from.DayNumber + 1, chosen, source, target, labor, overhead, rates.PlatesSold, Money(rates.Revenue),
            Money(rates.LaborPerPlate), Round6(rates.LaborPerRevenue), Round6(rates.LaborPerWeightedMinute), Money(rates.OverheadPerPlate),
            Round6(rates.OverheadPerRevenue),
            Money(laborAllocated), rates.PlatesSold > 0 ? Money(laborAllocated / rates.PlatesSold) : null,
            Money(overheadAllocated), rates.PlatesSold > 0 ? Money(overheadAllocated / rates.PlatesSold) : null,
            Weighted(r => r.FullyBurdenedCost!.Value), Weighted(r => r.SellingPrice!.Value - r.FullyBurdenedCost!.Value),
            Money(sold.Sum(r => r.TotalPeriodNetProfit ?? 0)),
            rows.Count(r => r.BleedingAfterOverhead), rows,
            rows.Select(r => r.Category).OfType<string>().Distinct(StringComparer.OrdinalIgnoreCase).Order(StringComparer.CurrentCultureIgnoreCase).ToList());
    }

    // The recipe's plate over the month so far, actual pools, the settings' method: its card's box.
    public async Task<BurdenedRecipeCost> GetForRecipeAsync(Guid recipeId, CancellationToken cancellationToken)
    {
        var recipe = await db.Recipes.AsNoTracking().SingleOrDefaultAsync(r => r.Id == recipeId, cancellationToken)
            ?? throw new NotFoundException(nameof(Recipe), recipeId);
        var today = clock.BusinessDateOf(DateTime.UtcNow);
        var report = await GetAsync(new DateOnly(today.Year, today.Month, 1), today, null, PoolSource.Actual, null, null, cancellationToken);
        var plate = report.Rows.FirstOrDefault(r => recipe.Target is { } t
                ? r.MenuItemId == t.CatalogItemId && r.VariantId == t.VariantId
                : r.RecipeId == recipeId && r.MenuItemId is null);
        return new BurdenedRecipeCost(report.From, report.To, report.Method, report.TargetNetMarginPercent, report.PlatesSold, plate);
    }

    private static BurdenedPlateRow Row(PlateBase b, AllocationRates rates, decimal target)
    {
        var (laborExact, overheadExact) = rates.For(b.Price, b.WeightedMinutes);
        var food = b.FoodCost;
        var price = b.Price;
        decimal? Share(decimal? part) => part is { } p && price > 0 ? Percent(p / price.Value) : null;
        decimal? prime = food + laborExact;
        decimal? burdened = prime + overheadExact;
        decimal? profit = price - burdened;
        var status = !b.HasRecipe ? PlateStatus.NoRecipe
            : laborExact is null || overheadExact is null ? (price is null ? PlateStatus.NoPrice : PlateStatus.NotAllocated)
            : price is not > 0 ? PlateStatus.NoPrice
            : profit < 0 ? PlateStatus.Losing
            : profit / price * 100 < target ? PlateStatus.Thin
            : PlateStatus.Healthy;
        var suggested = food is { } f ? PlateCostAllocation.SuggestedPrice(rates, f, b.WeightedMinutes, target) : null;
        return new BurdenedPlateRow(
            b.ItemCode, b.MenuItemId, b.VariantId, b.RecipeId, b.Dish, b.DishAr, b.Category, b.OnMenu, b.QuantitySold, b.QuantitySold == 0,
            Money(price), b.PrepTimeMinutes, b.ComplexityWeight, Math.Round(b.WeightedMinutes, 2, MidpointRounding.AwayFromZero), b.PrepTimeAssumed,
            Money(food), Share(food), Money(laborExact), Share(laborExact), Money(prime), Share(prime), Money(overheadExact), Share(overheadExact),
            Money(burdened), Share(burdened), Money(profit), Share(profit), Money(profit * b.QuantitySold), Money(suggested),
            price - food > 0 && profit < 0, b.MissingPrices, status);
    }

    // Each month's figures, spread evenly over its days: the part of it the days chosen cover.
    private static IEnumerable<(DateOnly Month, decimal Share)> Months(DateOnly from, DateOnly to)
    {
        for (var month = new DateOnly(from.Year, from.Month, 1); month <= to; month = month.AddMonths(1))
        {
            var last = month.AddMonths(1).AddDays(-1);
            var first = from > month ? from : month;
            var end = to < last ? to : last;
            yield return (month, (decimal)(end.DayNumber - first.DayNumber + 1) / (last.DayNumber - month.DayNumber + 1));
        }
    }

    private static (CostPool Labor, CostPool Overhead) Simulated(DateOnly from, DateOnly to, decimal monthlyLabor, decimal monthlyOverhead)
    {
        var months = Months(from, to).Sum(m => m.Share);
        return (
            new CostPool(Money(monthlyLabor * months), [new("simulated", "Simulated monthly labor", "عمالة تقديرية شهرية", Money(monthlyLabor * months))], []),
            new CostPool(Money(monthlyOverhead * months), [new("simulated", "Simulated monthly overheads", "مصاريف تشغيل تقديرية شهرية", Money(monthlyOverhead * months))], []));
    }

    // The days' share of each pool, as recorded (a month with nothing recorded for one: its stand-in).
    // The daily break-even reads a whole month of them as its fixed costs.
    internal async Task<(CostPool Labor, CostPool Overhead)> ActualAsync(DateOnly from, DateOnly to, CostingSettings settings, CancellationToken cancellationToken)
    {
        var months = Months(from, to).ToList();
        var periods = months.Select(m => m.Month).ToList();
        var entered = await db.MonthlyExpenses.AsNoTracking()
            .Where(e => e.Year >= from.Year && e.Year <= to.Year)
            .ToListAsync(cancellationToken);
        var payrolls = await db.PayrollRuns.AsNoTracking().Where(r => periods.Contains(r.Period))
            .Select(r => new { r.Period, r.LaborCost }).ToListAsync(cancellationToken);
        var salaries = await db.SafeTransactions.AsNoTracking()
            .Where(t => t.Kind == SafeTransactionKind.SalaryPayment && t.PayrollMonth != null && periods.Contains(t.PayrollMonth.Value))
            .GroupBy(t => t.PayrollMonth!.Value)
            .Select(g => new { Month = g.Key, Paid = -g.Sum(t => t.Amount) })
            .ToListAsync(cancellationToken);

        decimal payroll = 0, salariesPaid = 0, wagesEntered = 0, wagesLogged = 0, laborStandIn = 0;
        decimal occupation = 0, controllable = 0, otherFixed = 0, interest = 0, depreciation = 0, overheadStandIn = 0;
        var laborStandInMonths = new List<string>();
        var overheadStandInMonths = new List<string>();
        foreach (var (month, share) in months)
        {
            var e = entered.SingleOrDefault(x => x.Year == month.Year && x.Month == month.Month);
            var logged = await spending.LoggedExpensesAsync(month, month.AddMonths(1).AddDays(-1), cancellationToken);
            decimal Logged(ExpenseLine line) => logged.Where(l => l.ExpenseLine == line).Sum(l => l.Amount);

            var run = payrolls.SingleOrDefault(r => r.Period == month);
            var paid = salaries.SingleOrDefault(s => s.Month == month)?.Paid ?? 0;
            var laborRecorded = run is not null || paid != 0 || e?.WagesAndBenefits is not null || Logged(ExpenseLine.Wages) != 0;
            if (!laborRecorded && settings.FallbackMonthlyLaborCost is { } laborFallback)
            {
                laborStandIn += laborFallback * share;
                laborStandInMonths.Add($"{month:MMM yyyy}");
            }
            else
            {
                if (run is not null)
                    payroll += run.LaborCost * share;
                else
                    salariesPaid += paid * share;
                wagesEntered += (e?.WagesAndBenefits ?? 0) * share;
                wagesLogged += Logged(ExpenseLine.Wages) * share;
            }

            var overheadRecorded = e is { OccupationCost: not null } or { OtherControllableCosts: not null } or { Interest: not null } or { Depreciation: not null }
                || OverheadLines.Any(l => Logged(l) != 0);
            if (!overheadRecorded && settings.FallbackMonthlyOverheadCost is { } overheadFallback)
            {
                overheadStandIn += overheadFallback * share;
                overheadStandInMonths.Add($"{month:MMM yyyy}");
            }
            else
            {
                occupation += ((e?.OccupationCost ?? 0) + Logged(ExpenseLine.Occupation)) * share;
                controllable += ((e?.OtherControllableCosts ?? 0) + Logged(ExpenseLine.Controllable)) * share;
                otherFixed += Logged(ExpenseLine.OtherFixed) * share;
                interest += (e?.Interest ?? 0) * share;
                depreciation += (e?.Depreciation ?? 0) * share;
            }
        }

        static CostPool Pool(IReadOnlyList<string> standIn, params CostPoolPart[] parts)
        {
            var kept = parts.Where(p => p.Amount != 0).Select(p => p with { Amount = Money(p.Amount) }).ToList();
            return new CostPool(kept.Sum(p => p.Amount), kept, standIn);
        }

        return (
            Pool(laborStandInMonths,
                new("payroll", "Payroll approved on HR", "مسير الرواتب المعتمد", payroll),
                new("salaries", "Salaries paid from the safe", "الرواتب المصروفة من الخزنة", salariesPaid),
                new("wagesEntered", "Wages & benefits entered", "الأجور والمزايا المدخلة", wagesEntered),
                new("wagesLogged", "Wages paid as expenses", "أجور مسجلة كمصروفات", wagesLogged),
                new("standIn", "Stand-in monthly labor", "عمالة شهرية تقديرية", laborStandIn)),
            Pool(overheadStandInMonths,
                new("occupation", "Rent & occupation", "الإيجار والمكان", occupation),
                new("controllable", "Utilities & running costs", "المرافق ومصاريف التشغيل", controllable),
                new("otherFixed", "Other fixed costs", "مصاريف ثابتة أخرى", otherFixed),
                new("interest", "Interest", "الفوائد", interest),
                new("depreciation", "Depreciation", "الإهلاك", depreciation),
                new("standIn", "Stand-in monthly overheads", "مصاريف تشغيل شهرية تقديرية", overheadStandIn)));
    }

    private static decimal? Round6(decimal? value) => value is { } v ? Math.Round(v, 6, MidpointRounding.AwayFromZero) : null;
}
