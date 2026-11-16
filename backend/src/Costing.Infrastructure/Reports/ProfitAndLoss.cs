using static Costing.Infrastructure.Reports.CostingService;

namespace Costing.Infrastructure.Reports;

// A line of the profit and loss: its amount and its share of the revenue. A total (IsTotal) sums
// what is above it; Level 1 is a line within a section.
public sealed record PnlLine(string Key, string En, string Ar, decimal? Amount, decimal? PercentOfRevenue, int Level = 0, bool IsTotal = false);

// The month's profit and loss (قائمة الدخل), from its KPI statement (MonthStatement):
//
//   Revenue (net sales, before tax)
// − Cost of sales (the recipes' cost of what was sold, and the losses)
// = Gross profit (مجمل الربح)
// − Operating expenses: wages and benefits, running costs, occupation, other fixed costs, hospitality
// = EBITDA (الربح التشغيلي قبل الفوائد والضرائب والإهلاك)
// − Interest
// − Depreciation (إهلاك الأصول الثابتة): the fixed assets register's, and any entered for the month
// ± Gains and losses on assets disposed of or sold
// = Net profit (صافي الربح النهائي)
//
// A fixed asset bought (CAPEX) is never on it: its cost left the safe or the bank, and comes here a
// month at a time as depreciation. EBITDA and the net profit are null until the month's wages are in
// (Missing says so): without them they would flatter.
public sealed record ProfitAndLoss(
    int Year,
    int Month,
    DateOnly From,
    DateOnly To,
    decimal Revenue,
    decimal CostOfSales,
    decimal GrossProfit,
    decimal OperatingExpenses,
    decimal? Ebitda,
    decimal Interest,
    decimal AssetDepreciation,
    decimal EnteredDepreciation,
    decimal Depreciation,
    decimal DisposalGainOrLoss,
    decimal? NetProfit,
    decimal? GrossMarginPercent,
    decimal? EbitdaMarginPercent,
    decimal? NetMarginPercent,
    IReadOnlyList<PnlLine> Lines,
    string? Missing)
{
    public static ProfitAndLoss Of(KpiReport report)
    {
        var s = report.Statement;
        decimal? Share(decimal? part) => part is { } p && s.Revenue > 0 ? Percent(p / s.Revenue) : null;
        PnlLine Line(string key, string en, string ar, decimal? amount, int level = 0, bool total = false) =>
            new(key, en, ar, Money(amount), Share(amount), level, total);

        var wages = s.WagesAndBenefits is null && s.LoggedWages == 0 ? (decimal?)null : (s.WagesAndBenefits ?? 0) + s.LoggedWages + s.StaffMeals;
        var interest = s.Interest ?? 0;
        var entered = s.Depreciation ?? 0;
        var lines = new List<PnlLine>
        {
            Line("revenue", "Revenue (net sales)", "الإيرادات (صافي المبيعات)", s.Revenue, total: true),
            Line("foodSales", "Food", "مأكولات", s.FoodSales, 1),
            Line("beverageSales", "Beverages", "مشروبات", s.BeverageSales, 1),
            Line("costOfSales", "Cost of sales", "تكلفة المبيعات", s.CostOfSales, total: true),
            Line("recipeCost", "Recipes' cost of what was sold", "تكلفة الوصفات المباعة", s.FoodRecipeCost + s.BeverageRecipeCost, 1),
            Line("losses", "Waste, spoilage and count differences", "الهالك والتالف وفروق الجرد", s.KitchenWaste + s.Spoilage + s.CountDifferences, 1),
            Line("grossProfit", "Gross profit", "مجمل الربح", s.GrossProfit, total: true),
            Line("operatingExpenses", "Operating expenses", "المصروفات التشغيلية", s.OperatingExpenses, total: true),
            Line("wages", "Wages & benefits", "الأجور والمزايا", wages, 1),
            Line("controllable", "Utilities & running costs", "المرافق ومصاريف التشغيل", (s.OtherControllableCosts ?? 0) + s.LoggedControllableCosts, 1),
            Line("occupation", "Rent & occupation", "الإيجار والمكان", (s.OccupationCost ?? 0) + s.LoggedOccupationCost, 1),
            Line("otherFixed", "Other fixed costs", "مصاريف ثابتة أخرى", s.LoggedOtherFixedCosts, 1),
            Line("hospitality", "Hospitality & recipe tastings", "الضيافة وتجارب الوصفات", s.Hospitality + s.RecipeTasting, 1),
            Line("ebitda", "EBITDA", "الربح التشغيلي قبل الفوائد والضرائب والإهلاك", s.Ebitda, total: true),
            Line("interest", "Interest", "الفوائد", interest),
            Line("depreciation", "Depreciation expense", "إهلاك الأصول الثابتة", s.DepreciationExpense),
            Line("assetDepreciation", "Fixed assets register", "سجل الأصول الثابتة", s.AssetDepreciation, 1),
            Line("enteredDepreciation", "Entered for the month", "مدخل للشهر", entered, 1),
            Line("disposals", "Gain / (loss) on asset disposals", "أرباح / (خسائر) استبعاد الأصول", s.DisposalGainOrLoss),
            Line("netProfit", "Net profit", "صافي الربح النهائي", s.NetProfit, total: true),
        };

        return new ProfitAndLoss(
            report.Year, report.Month, report.From, report.To, s.Revenue, s.CostOfSales, s.GrossProfit, s.OperatingExpenses, s.Ebitda, Money(interest),
            s.AssetDepreciation, Money(entered), s.DepreciationExpense, s.DisposalGainOrLoss, s.NetProfit,
            Share(s.GrossProfit), Share(s.Ebitda), Share(s.NetProfit), lines,
            s.Ebitda is null ? "Enter the month's wages and benefits: without them EBITDA and the net profit would flatter. · أدخل أجور الشهر." : null);
    }
}
