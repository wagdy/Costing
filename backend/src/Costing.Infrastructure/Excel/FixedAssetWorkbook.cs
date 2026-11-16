using Costing.Domain.FixedAssets;
using Costing.Domain.Treasury;
using Costing.Infrastructure.Reports;

namespace Costing.Infrastructure.Excel;

// The fixed assets register as a workbook (سجل الأصول الثابتة): every asset as the screen shows it at
// the end of the month, held ones totalled, then what each category holds.
public static class FixedAssetWorkbook
{
    public static string FileName(FixedAssetRegister register) => $"fixed-assets-{register.Year:0000}-{register.Month:00}.xlsx";

    public static Stream Build(FixedAssetRegister register)
    {
        var asOf = $"At {register.AsOf:d MMM yyyy} · straight-line: (cost − salvage value) ÷ useful life, a month at a time from the month bought";
        var held = register.Assets.Where(a => a.Status is FixedAssetStatus.Active or FixedAssetStatus.FullyDepreciated).ToList();
        var assets = new ReportSheet(
            "Register", "Fixed assets register · سجل الأصول الثابتة", asOf,
            [
                new("Asset code · كود الأصل"), new("Name · الاسم"), new("Category · الفئة"), new("Location · الموقع"),
                new("Purchase date · تاريخ الشراء", ReportWorkbook.Date), new("Cost · التكلفة", ReportWorkbook.Money),
                new("Salvage value · القيمة التخريدية", ReportWorkbook.Money), new("Useful life (months) · العمر الإنتاجي"),
                new("Monthly depr. · القسط الشهري", ReportWorkbook.Money), new("Months charged · الأشهر المحملة"),
                new("Depr. this month · إهلاك الشهر", ReportWorkbook.Money), new("Accumulated depr. · مجمع الإهلاك", ReportWorkbook.Money),
                new("Net book value · القيمة الدفترية", ReportWorkbook.Money), new("Status · الحالة"), new("Paid from · مصدر الدفع"),
                new("Disposed on · تاريخ الاستبعاد", ReportWorkbook.Date), new("Sold for · قيمة البيع", ReportWorkbook.Money),
                new("Gain / (loss) · ربح / (خسارة)", ReportWorkbook.Money),
            ],
            [
                .. register.Assets.Select(a => new ReportRow(
                    [a.AssetCode, a.Name, CategoryName(a.Category), a.Location, a.PurchaseDate, a.PurchaseCost, a.SalvageValue, a.UsefulLifeMonths,
                     a.MonthlyDepreciation, a.MonthsCharged, a.DepreciationThisMonth, a.AccumulatedDepreciation, a.NetBookValue, StatusName(a.Status),
                     PaidFromName(a.PaidFrom), a.DisposalDate, a.SaleProceeds, a.GainOrLoss],
                    Flagged: a.GainOrLoss < 0)),
                new ReportRow(
                    ["", "Held · الأصول القائمة", null, null, null, held.Sum(a => a.PurchaseCost), null, null, null, null,
                     register.DepreciationThisMonth, register.AccumulatedDepreciation, register.NetBookValue],
                    ReportRowKind.Total),
            ]);
        var categories = new ReportSheet(
            "By category", "What each category holds · الأصول حسب الفئة", asOf,
            [
                new("Category · الفئة"), new("Assets · العدد"), new("Cost · التكلفة", ReportWorkbook.Money),
                new("Accumulated depr. · مجمع الإهلاك", ReportWorkbook.Money), new("Net book value · القيمة الدفترية", ReportWorkbook.Money),
                new("Depr. this month · إهلاك الشهر", ReportWorkbook.Money),
            ],
            [
                .. register.Categories.Select(c => new ReportRow(
                    [CategoryName(c.Category), c.Count, c.Cost, c.AccumulatedDepreciation, c.NetBookValue, c.DepreciationThisMonth])),
                new ReportRow(
                    ["Total · الإجمالي", register.Categories.Sum(c => c.Count), register.TotalCost, register.AccumulatedDepreciation, register.NetBookValue,
                     register.Categories.Sum(c => c.DepreciationThisMonth)],
                    ReportRowKind.Total),
            ]);
        return ReportWorkbook.Build([assets, categories]);
    }

    private static string CategoryName(FixedAssetCategory category) => Costing.Application.Treasury.TreasuryNames.Category(category);

    private static string StatusName(FixedAssetStatus status) => status switch
    {
        FixedAssetStatus.Active => "Active · نشط",
        FixedAssetStatus.FullyDepreciated => "Fully depreciated · مهلك بالكامل",
        FixedAssetStatus.Disposed => "Disposed · مستبعد",
        _ => "Sold · مباع",
    };

    private static string PaidFromName(CashFund? fund) => fund switch
    {
        CashFund.Safe => "Safe · الخزنة",
        CashFund.Bank => "Bank · البنك",
        _ => "Owned already · أصل قائم",
    };
}
