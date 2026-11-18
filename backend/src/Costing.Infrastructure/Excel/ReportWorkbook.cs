using ClosedXML.Excel;
using Costing.Domain.Recipes;
using Costing.Infrastructure.Reports;

namespace Costing.Infrastructure.Excel;

// A report's column: its heading, in English and Arabic, and how its numbers are written.
public sealed record ReportColumn(string Header, string? Format = null);

public enum ReportRowKind
{
    Line = 1,
    // A group's heading, above its lines (a category, a supplier).
    Group = 2,
    // A subtotal or the total.
    Total = 3,
}

// One row: its cells in the columns' order. Flagged: one to look at (a loss, a stockout), in red.
public sealed record ReportRow(IReadOnlyList<object?> Cells, ReportRowKind Kind = ReportRowKind.Line, bool Flagged = false);

public sealed record ReportSheet(string Name, string Title, string Subtitle, IReadOnlyList<ReportColumn> Columns, IReadOnlyList<ReportRow> Rows);

// A report as a workbook, to read, filter and print rather than import: each sheet its title and
// what it covers, then a bold header frozen above the rows, each column written as its numbers are,
// a group's heading and subtotal set apart, and the columns sized to fit.
public static class ReportWorkbook
{
    public const string ContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    public const string Money = "#,##0.00";
    public const string Quantity = "#,##0.###";
    public const string Percent = "0.0\"%\"";
    public const string Date = "d mmm yyyy";

    public static Stream Build(IReadOnlyList<ReportSheet> sheets)
    {
        using var book = new XLWorkbook();
        foreach (var report in sheets)
        {
            var sheet = book.Worksheets.Add(report.Name);
            sheet.Cell(1, 1).Value = report.Title;
            sheet.Cell(1, 1).Style.Font.Bold = true;
            sheet.Cell(1, 1).Style.Font.FontSize = 14;
            sheet.Cell(2, 1).Value = report.Subtitle;
            sheet.Cell(2, 1).Style.Font.FontColor = XLColor.Gray;

            const int header = 4;
            for (var c = 0; c < report.Columns.Count; c++)
            {
                var cell = sheet.Cell(header, c + 1);
                cell.Value = report.Columns[c].Header;
                cell.Style.Font.Bold = true;
                cell.Style.Font.FontColor = XLColor.White;
                cell.Style.Fill.BackgroundColor = XLColor.FromHtml("#4F46E5");
                cell.Style.Alignment.WrapText = true;
            }

            var row = header;
            foreach (var line in report.Rows)
            {
                row++;
                for (var c = 0; c < line.Cells.Count && c < report.Columns.Count; c++)
                {
                    var cell = sheet.Cell(row, c + 1);
                    cell.Value = line.Cells[c] switch
                    {
                        null => Blank.Value,
                        decimal d => d,
                        int i => i,
                        DateOnly day => day.ToDateTime(TimeOnly.MinValue),
                        bool b => b ? "Yes · نعم" : "",
                        var other => other.ToString(),
                    };
                    if (report.Columns[c].Format is { } format)
                        cell.Style.NumberFormat.Format = format;
                }
                var range = sheet.Range(row, 1, row, report.Columns.Count);
                if (line.Kind != ReportRowKind.Line)
                    range.Style.Font.Bold = true;
                if (line.Kind == ReportRowKind.Group)
                    range.Style.Fill.BackgroundColor = XLColor.FromHtml("#EEF2FF");
                if (line.Kind == ReportRowKind.Total)
                    range.Style.Border.TopBorder = XLBorderStyleValues.Thin;
                if (line.Flagged)
                    range.Style.Font.FontColor = XLColor.FromHtml("#B91C1C");
            }

            if (row > header)
                sheet.Range(header, 1, row, report.Columns.Count).SetAutoFilter();
            sheet.SheetView.FreezeRows(header);
            sheet.Columns(1, report.Columns.Count).AdjustToContents(header, row, 8, 48);
        }

        var stream = new MemoryStream();
        book.SaveAs(stream);
        stream.Position = 0;
        return stream;
    }
}

// The intelligence reports as sheets: each table as the screen shows it, in both languages.
public static class IntelligenceWorkbooks
{
    private static string Span(DateOnly from, DateOnly to) => $"{from:d MMM yyyy} – {to:d MMM yyyy}";

    public static Stream PriceVariance(PriceVarianceReport report, IReadOnlyList<PriceVarianceRow> rows)
    {
        var materials = new ReportSheet(
            "Price variance", "Purchase price variance · انحراف أسعار الخامات",
            $"{Span(report.From, report.To)} · baseline: the moving average each material came in with; latest: the last net price paid",
            [
                new("Code · الكود"), new("Material · الخامة"), new("Category · القسم"), new("Unit · الوحدة"),
                new("Baseline avg · متوسط السعر السابق", ReportWorkbook.Money), new("Latest net · آخر سعر صافي", ReportWorkbook.Money),
                new("Variance · فرق السعر", ReportWorkbook.Money), new("Change · نسبة التغير", ReportWorkbook.Percent),
                new("Bought · الكمية المشتراة", ReportWorkbook.Quantity), new("Impact · الأثر المالي", ReportWorkbook.Money),
                new("Recipes affected · الوصفات المتأثرة"), new("Latest supplier · آخر مورد"), new("Last bought · آخر شراء", ReportWorkbook.Date),
            ],
            [
                .. rows.Select(r => new ReportRow(
                    [r.Code, r.Material, r.Category, r.PurchaseUnit, r.BaselineCost, r.LatestCost, r.UnitVariance, r.ChangePercent, r.QuantityPurchased,
                     r.Impact, r.Affected.Count, r.LatestSupplier, r.LatestPurchasedOn],
                    Flagged: r.Impact > 0)),
                new ReportRow(["", "Total · الإجمالي", null, null, null, null, null, null, null, rows.Sum(r => r.Impact ?? 0)], ReportRowKind.Total),
            ]);
        var recipes = new ReportSheet(
            "Recipes affected", "What the price changes do to the recipes · أثر الأسعار على الوصفات",
            $"{Span(report.From, report.To)} · per portion of a dish, or per purchase unit of a prep item",
            [
                new("Material · الخامة"), new("Dish or prep item · الصنف"), new("Kind · النوع"), new("Per · لكل"),
                new("Quantity of the material · الكمية", ReportWorkbook.Quantity), new("Cost change · تغير التكلفة", ReportWorkbook.Money),
                new("Price or cost · السعر أو التكلفة", ReportWorkbook.Money), new("Points · النقاط", ReportWorkbook.Percent),
            ],
            rows.SelectMany(r => r.Affected.Select(a => new ReportRow(
                    [r.Material, a.Name, a.Kind == PriceImpactKind.Dish ? "Dish · طبق" : "Prep item · مُصنّع", a.Per, a.Quantity, a.CostChange, a.Against, a.Points],
                    Flagged: a.CostChange > 0)))
                .ToList());
        return ReportWorkbook.Build([materials, recipes]);
    }

    public static Stream OrderSheet(OrderSheet sheet)
    {
        var by = sheet.GroupBy == OrderSheetGrouping.Supplier ? "Supplier · المورد" : "Category · القسم";
        var other = sheet.GroupBy == OrderSheetGrouping.Supplier ? "Category · القسم" : "Last supplier · آخر مورد";
        var rows = new List<ReportRow>();
        foreach (var group in sheet.Rows.GroupBy(r => r.Group))
        {
            rows.Add(new ReportRow([group.Key], ReportRowKind.Group));
            rows.AddRange(group.Select(r => new ReportRow([r.Code, r.Material, r.PurchaseUnit, r.Quantity, r.UnitPrice, r.Cost, r.Other])));
            rows.Add(new ReportRow(["", $"{group.Key} · subtotal", null, null, null, group.Sum(r => r.Cost ?? 0)], ReportRowKind.Total));
        }
        rows.Add(new ReportRow(["", "Total · الإجمالي", null, null, null, sheet.Total], ReportRowKind.Total));
        return ReportWorkbook.Build([new ReportSheet(
            "Order", "Purchase order sheet · طلبية الشراء",
            $"{sheet.Today:d MMM yyyy}{(sheet.CoverageDays is { } days ? $" · for {days} days ahead" : "")} · by {by} · at the latest net price paid",
            [
                new("Code · الكود"), new("Material · الخامة"), new("Unit · الوحدة"), new("Quantity · الكمية المعتمدة", ReportWorkbook.Quantity),
                new("Unit price · سعر الوحدة", ReportWorkbook.Money), new("Estimated cost · التكلفة التقديرية", ReportWorkbook.Money), new(other),
            ],
            rows)]);
    }

    public static Stream Consumption(ConsumptionReport report) =>
        ReportWorkbook.Build([new ReportSheet(
            "Consumption", "Theoretical vs actual consumption · الاستهلاك النظري مقابل الفعلي",
            $"{Span(report.From, report.To)} · actual: opening + purchases − logged waste − closing; theoretical: the sales by the recipes, through the prep items",
            [
                new("Code · الكود"), new("Material · الخامة"), new("Category · القسم"), new("Unit · الوحدة"),
                new("Opening · أول المدة", ReportWorkbook.Quantity), new("Purchases · المشتريات", ReportWorkbook.Quantity),
                new("Logged waste · الهالك المسجل", ReportWorkbook.Quantity), new("Closing · آخر المدة", ReportWorkbook.Quantity),
                new("Actual usage · الاستهلاك الفعلي", ReportWorkbook.Quantity), new("Theoretical usage · الاستهلاك النظري", ReportWorkbook.Quantity),
                new("Of which held in prep · منه في المصنعات", ReportWorkbook.Quantity), new("Unexplained · الانحراف غير المبرر", ReportWorkbook.Quantity),
                new("Variance % · النسبة", ReportWorkbook.Percent), new("Avg cost · متوسط التكلفة", ReportWorkbook.Money),
                new("Variance cost · قيمة الانحراف", ReportWorkbook.Money),
            ],
            [
                .. report.Rows.Select(r => new ReportRow(
                    [r.Code, r.Material, r.Category, r.PurchaseUnit, r.Opening, r.Purchases, r.Waste, r.Closing, r.ActualUsage, r.TheoreticalUsage, r.HeldInPrep,
                     r.UnexplainedQuantity, r.UnexplainedPercent, r.UnitCost, r.VarianceCost],
                    Flagged: r.Evaluation == VarianceEvaluation.Unfavourable)),
                new ReportRow(["", "Total · الإجمالي", null, null, null, null, null, null, null, null, null, null, null, null, report.UnexplainedValue], ReportRowKind.Total),
            ])]);

    public static string StatusName(StationStatus status) => status switch
    {
        StationStatus.HighLoss => "High loss · عجز مرتفع",
        StationStatus.Watch => "Watch · تحت المراقبة",
        _ => "Within target · منضبط",
    };

    // Station-level variance: a summary a station, then each station's materials under it.
    public static Stream StationVariance(StationVarianceReport report)
    {
        var names = report.Stations.ToDictionary(s => s.StationId ?? Guid.Empty, s => s.StationAr is null ? s.Station : $"{s.Station} · {s.StationAr}");
        var span = $"{Span(report.From, report.To)} · tolerance {report.TolerancePercent:0.##}% unless a station has its own";
        return ReportWorkbook.Build(
        [
            new ReportSheet(
                "Station Summary", "Station-level variance · انحراف الأقسام", span,
                [
                    new("Station · القسم"), new("Status · الحالة"), new("Materials · الخامات", "0"), new("Theoretical cost · التكلفة النظرية", ReportWorkbook.Money),
                    new("Actual cost · التكلفة الفعلية", ReportWorkbook.Money), new("Unexplained variance · الانحراف غير المبرر", ReportWorkbook.Money),
                    new("Variance % · النسبة", ReportWorkbook.Percent), new("Tolerance % · السماح", ReportWorkbook.Percent),
                    new("Logged waste · الهالك المسجل", ReportWorkbook.Money), new("Staff meals · وجبات العاملين", ReportWorkbook.Money),
                    new("Top losing materials · أعلى الخامات عجزًا"),
                ],
                [
                    .. report.Stations.Select(s => new ReportRow(
                        [names[s.StationId ?? Guid.Empty], StatusName(s.Status), s.Materials, s.TheoreticalConsumptionCost, s.ActualConsumptionCost,
                         s.UnexplainedVarianceCost, s.UnexplainedVariancePercent, s.TolerancePercent, s.LoggedSpoilageWasteCost, s.StaffMealsCost,
                         string.Join(", ", s.TopLossMaterials.Select(m => m.Material))],
                        Flagged: s.Status == StationStatus.HighLoss)),
                    new ReportRow(
                        ["Total · الإجمالي", null, report.Stations.Sum(s => s.Materials), report.TheoreticalValue, report.ActualValue, report.UnexplainedValue,
                         report.TheoreticalValue > 0 ? Math.Round(report.UnexplainedValue / report.TheoreticalValue * 100, 2) : null, null, report.WasteValue,
                         report.Stations.Sum(s => s.StaffMealsCost), null],
                        ReportRowKind.Total),
                ]),
            new ReportSheet(
                "By Station", "Detailed breakdown by station · التفاصيل حسب القسم", span,
                [
                    new("Station · القسم"), new("Code · الكود"), new("Material · الخامة"), new("Unit · الوحدة"),
                    new("Opening · أول المدة", ReportWorkbook.Quantity), new("Purchases · المشتريات", ReportWorkbook.Quantity),
                    new("Logged waste · الهالك المسجل", ReportWorkbook.Quantity), new("Closing · آخر المدة", ReportWorkbook.Quantity),
                    new("Actual · الفعلي", ReportWorkbook.Quantity), new("Theoretical · النظري", ReportWorkbook.Quantity),
                    new("Unexplained · غير المبرر", ReportWorkbook.Quantity), new("Variance cost · قيمة الانحراف", ReportWorkbook.Money),
                    new("Variance % · النسبة", ReportWorkbook.Percent), new("Evaluation · التقييم"),
                ],
                [
                    .. report.Stations.SelectMany(s => (IEnumerable<ReportRow>)
                    [
                        new ReportRow([names[s.StationId ?? Guid.Empty], null, null, null, null, null, null, null, null, null, null, null, null, null], ReportRowKind.Group),
                        .. report.Rows.Where(r => r.KitchenStationId == s.StationId).Select(r => new ReportRow(
                            [names[s.StationId ?? Guid.Empty], r.Code, r.Material, r.PurchaseUnit, r.Opening, r.Purchases, r.Waste, r.Closing, r.ActualUsage,
                             r.TheoreticalUsage, r.UnexplainedQuantity, r.VarianceCost, r.UnexplainedPercent, Evaluation(r.Evaluation)],
                            Flagged: r.Evaluation == VarianceEvaluation.Unfavourable)),
                        new ReportRow([$"{s.Station} total", null, null, null, null, null, null, null, null, null, null, s.UnexplainedVarianceCost,
                            s.UnexplainedVariancePercent, StatusName(s.Status)], ReportRowKind.Total),
                    ]),
                ]),
        ]);
    }

    private static string Evaluation(VarianceEvaluation evaluation) => evaluation switch
    {
        VarianceEvaluation.Unfavourable => "Unfavourable · غير مبرر",
        VarianceEvaluation.Favourable => "Favourable · فائض",
        VarianceEvaluation.SharedCost => "Shared cost · تكلفة مشتركة",
        _ => "Within limit · ضمن الحد",
    };

    public static Stream Abc(AbcReport report) =>
        ReportWorkbook.Build([new ReportSheet(
            "ABC", "ABC classification & days on hand · تصنيف ABC وكفاية المخزون",
            $"{Span(report.From, report.To)} · {report.Days} days · A: the top 75% of what was used, B: the next 15%, C: the rest",
            [
                new("Class · الفئة"), new("Code · الكود"), new("Material · الخامة"), new("Category · القسم"), new("Unit · الوحدة"),
                new("Used · الاستهلاك", ReportWorkbook.Quantity), new("Worth · القيمة", ReportWorkbook.Money), new("Share · النسبة", ReportWorkbook.Percent),
                new("Cumulative · التراكمي", ReportWorkbook.Percent), new("On hand · الرصيد", ReportWorkbook.Quantity),
                new("Stock value · قيمة المخزون", ReportWorkbook.Money), new("A day · يوميًا", ReportWorkbook.Quantity),
                new("Days on hand · أيام الكفاية", "0.0"), new("Stockout risk · خطر النفاد"), new("Dead stock · راكد"),
            ],
            report.Rows.Select(r => new ReportRow(
                    [r.Class.ToString(), r.Code, r.Material, r.Category, r.PurchaseUnit, r.Consumption, r.ConsumptionValue, r.SharePercent, r.CumulativePercent,
                     r.OnHand, r.StockValue, r.AverageDaily, r.DaysOnHand, r.StockoutRisk, r.DeadStock],
                    Flagged: r.StockoutRisk || r.DeadStock))
                .ToList())]);

    private static string ClassName(MenuClass? c) => c switch
    {
        MenuClass.Star => "Star · نجم",
        MenuClass.Plowhorse => "Plowhorse · حصان عمل",
        MenuClass.Puzzle => "Puzzle · لغز",
        MenuClass.Dog => "Dog · صنف ضعيف",
        _ => "Not placed · غير مصنف",
    };

    public static Stream MenuEngineering(MenuEngineeringReport report) =>
        ReportWorkbook.Build([new ReportSheet(
            "Menu engineering", "Menu engineering & profitability · هندسة المنيو والربحية",
            $"{Span(report.From, report.To)}{(report.Category is { } c ? $" · {c}" : "")} · popular: menu mix ≥ {report.PopularityThresholdPercent:0.##}%; "
                + $"profitable: margin ≥ the average {report.AverageContribution:#,##0.00}; suggested price at a {report.FoodCostTargetPercent:0.#}% food cost",
            [
                new("Class · التصنيف"), new("Code · الكود"), new("Dish · الصنف"), new("Category · القسم"), new("Sold · المباع", ReportWorkbook.Quantity),
                new("Menu mix · نسبة المبيعات", "0.00\"%\""), new("Avg price · متوسط السعر", ReportWorkbook.Money),
                new("Food cost a portion · تكلفة الطبق", ReportWorkbook.Money), new("Food cost % · نسبة التكلفة", ReportWorkbook.Percent),
                new("Margin a portion · هامش المساهمة", ReportWorkbook.Money), new("Total margin · إجمالي المساهمة", ReportWorkbook.Money),
                new("Suggested price · السعر المقترح", ReportWorkbook.Money),
            ],
            [
                .. report.Rows.Select(r => new ReportRow(
                    [ClassName(r.Class), r.ItemCode, r.MenuItem, r.Category, r.QuantitySold, r.MenuMixPercent, r.AveragePrice, r.FoodCostPerPortion,
                     r.FoodCostPercent, r.ContributionMargin, r.TotalContribution, r.SuggestedPrice],
                    Flagged: r.Class == MenuClass.Dog)),
                new ReportRow(["", "", "Total · الإجمالي", null, report.QuantitySold, null, null, null, report.FoodCostPercent, report.AverageContribution,
                    report.TotalContribution, null], ReportRowKind.Total),
            ])]);
}

// The fully burdened plate cost as two sheets: each dish's food, labor, overheads and true net
// profit, as the screen shows them; and the pools and the rates they were shared at.
public static class BurdenedCostWorkbook
{
    public static string MethodName(OverheadAllocationMethod method) => method switch
    {
        OverheadAllocationMethod.ByQuantitySold => "Equal per plate · بالتساوي للطبق",
        OverheadAllocationMethod.ByRevenueShare => "By revenue % · بنسبة الإيراد",
        _ => "Activity-based (prep time) · حسب وقت التحضير",
    };

    public static string StatusName(PlateStatus status) => status switch
    {
        PlateStatus.Healthy => "Healthy net margin · ربح صافي جيد",
        PlateStatus.Thin => "Thin margin · هامش ضعيف",
        PlateStatus.Losing => "Losing after overhead · خاسر بعد التحميل",
        PlateStatus.NoRecipe => "No recipe · بدون وصفة",
        PlateStatus.NoPrice => "No price · بدون سعر",
        _ => "Not allocated · غير محمّل",
    };

    public static Stream Build(BurdenedCostReport report)
    {
        var source = report.Source == PoolSource.Simulated ? "simulated monthly labor & overheads" : "actual pools";
        var plates = new ReportSheet(
            "Burdened plate cost", "Fully burdened plate cost · التكلفة الكلية للطبق",
            $"{report.From:d MMM yyyy} – {report.To:d MMM yyyy} · {MethodName(report.Method)} · {source} · prices before VAT · "
                + $"suggested price at a {report.TargetNetMarginPercent:0.#}% net margin",
            [
                new("Code · الكود"), new("Dish · الصنف"), new("Category · القسم"), new("Sold · المباع", ReportWorkbook.Quantity),
                new("Prep min · دقائق التحضير", "0.##"), new("Selling price · سعر البيع", ReportWorkbook.Money),
                new("Food cost · الخامات", ReportWorkbook.Money), new("Food % · نسبة الخامات", ReportWorkbook.Percent),
                new("+ Labor · العمالة", ReportWorkbook.Money), new("Labor % · نسبة العمالة", ReportWorkbook.Percent),
                new("Prime cost · التكلفة الأولية", ReportWorkbook.Money), new("Prime % · النسبة الأولية", ReportWorkbook.Percent),
                new("+ Overhead · الإيجار والمرافق والإهلاك", ReportWorkbook.Money), new("Overhead % · نسبة التشغيل", ReportWorkbook.Percent),
                new("= Fully burdened · التكلفة الكلية", ReportWorkbook.Money), new("Burdened % · النسبة الكلية", ReportWorkbook.Percent),
                new("True net profit · صافي الربح", ReportWorkbook.Money), new("Net margin % · نسبة صافي الربح", ReportWorkbook.Percent),
                new("Period net profit · صافي ربح الفترة", ReportWorkbook.Money), new("Suggested price · السعر المقترح", ReportWorkbook.Money),
                new("Status · الحالة"),
            ],
            [
                .. report.Rows.Select(r => new ReportRow(
                    [r.ItemCode, r.Estimated ? $"{r.Dish} (not sold: estimated)" : r.Dish, r.Category, r.QuantitySold, r.WeightedMinutes, r.SellingPrice,
                     r.DirectFoodCost, r.FoodCostPercent, r.AllocatedLaborCost, r.LaborCostPercent, r.PrimeCost, r.PrimeCostPercent,
                     r.AllocatedOverheadCost, r.OverheadCostPercent, r.FullyBurdenedCost, r.FullyBurdenedCostPercent, r.TrueNetProfitPerPlate,
                     r.TrueNetMarginPercent, r.TotalPeriodNetProfit, r.SuggestedPriceForTargetNetMargin, StatusName(r.Status)],
                    Flagged: r.Status == PlateStatus.Losing)),
                new ReportRow(["", "Plates sold · الأطباق المباعة", null, report.PlatesSold, null, null, null, null, report.AverageLaborPerPlate, null, null, null,
                    report.AverageOverheadPerPlate, null, null, report.AverageFullyBurdenedCostPercent, null, report.AverageTrueNetMarginPercent,
                    report.TotalPeriodNetProfit, null, $"{report.DishesBleeding} bleeding after overhead"], ReportRowKind.Total),
            ]);
        var pools = new ReportSheet(
            "Cost pools", "Labor & overhead pools · وعاء العمالة والتشغيل",
            $"{report.From:d MMM yyyy} – {report.To:d MMM yyyy} · each month spread evenly over its days",
            [new("Pool · الوعاء"), new("Part · البند"), new("Amount · المبلغ", ReportWorkbook.Money)],
            [
                new ReportRow(["Labor · العمالة", null, null], ReportRowKind.Group),
                .. report.Labor.Parts.Select(p => new ReportRow(["", $"{p.Label} · {p.LabelAr}", p.Amount])),
                new ReportRow(["", "Labor pool · وعاء العمالة", report.Labor.Total], ReportRowKind.Total),
                new ReportRow(["Overheads · الإيجار والمرافق والإهلاك", null, null], ReportRowKind.Group),
                .. report.Overhead.Parts.Select(p => new ReportRow(["", $"{p.Label} · {p.LabelAr}", p.Amount])),
                new ReportRow(["", "Overhead pool · وعاء التشغيل", report.Overhead.Total], ReportRowKind.Total),
                new ReportRow(["Allocated · المحمّل", null, null], ReportRowKind.Group),
                new ReportRow(["", "Labor on the plates sold · العمالة المحملة", report.LaborAllocated]),
                new ReportRow(["", "Overheads on the plates sold · التشغيل المحمّل", report.OverheadAllocated]),
                new ReportRow(["", "Plates sold · الأطباق المباعة", report.PlatesSold]),
                new ReportRow(["", "Sales before VAT · المبيعات قبل الضريبة", report.Sales]),
            ]);
        return ReportWorkbook.Build([plates, pools]);
    }
}

// A supplier's account over a period (كشف حساب مورد): the summary, then each line with the
// running balance owed, as the screen lists it.
public static class SupplierAccountWorkbook
{
    private static string KindName(SupplierAccountEntryKind kind) => kind switch
    {
        SupplierAccountEntryKind.OpeningBalance => "Owed before · رصيد سابق",
        SupplierAccountEntryKind.CreditInvoice => "Credit invoice · فاتورة آجل",
        SupplierAccountEntryKind.CashInvoice => "Cash invoice · فاتورة نقدي",
        _ => "Payment · سداد",
    };

    public static Stream Build(SupplierAccount account) =>
        ReportWorkbook.Build([new ReportSheet(
            "Statement", $"{account.Supplier} · Statement of account · كشف حساب",
            $"{account.From:d MMM yyyy} – {account.To:d MMM yyyy} · pays in {account.PaymentTermsDays} days · "
                + $"opening {account.OpeningBalance:#,##0.00}, owed before {account.OwedBefore:#,##0.00}, credit invoices {account.CreditInvoices:#,##0.00}, cash invoices {account.CashInvoices:#,##0.00}, "
                + $"payments {account.Payments:#,##0.00}, closing {account.ClosingBalance:#,##0.00}",
            [
                new("Date · التاريخ", ReportWorkbook.Date), new("Document · المستند"), new("Reference · المرجع"), new("Description · البيان"),
                new("Paid (−) · مسدد", ReportWorkbook.Money), new("Owed (+) · مستحق", ReportWorkbook.Money), new("Balance owed · الرصيد", ReportWorkbook.Money),
            ],
            [
                new ReportRow([account.From, "Opening balance · رصيد أول المدة", null, null, null, null, account.OpeningBalance], ReportRowKind.Total),
                .. account.Lines.Select(l => new ReportRow(
                    [l.Date, KindName(l.Kind), l.Reference, l.Notes is null ? l.Description : $"{l.Description} — {l.Notes}",
                     l.Paid == 0 ? null : l.Paid, l.Owed == 0 ? null : l.Owed, l.Balance],
                    Flagged: l.IsReversal)),
                new ReportRow([account.To, "Closing balance · الرصيد المستحق", null, null, account.Payments + account.CashInvoices, account.OwedBefore + account.CreditInvoices + account.CashInvoices,
                    account.ClosingBalance], ReportRowKind.Total),
            ])]);
}

// The vendor price matrix: each material and its suppliers, cheapest first.
public static class VendorPriceWorkbook
{
    public static Stream Build(VendorPriceReport report) =>
        ReportWorkbook.Build([new ReportSheet(
            "Vendor prices", "Vendor price comparison · مقارنة أسعار الموردين",
            $"{report.From:d MMM yyyy} – {report.To:d MMM yyyy} · net prices per purchase unit, after every discount · best: the lowest last price",
            [
                new("Material · الخامة"), new("Unit · الوحدة"), new("Supplier · المورد"), new("Last price · آخر سعر", ReportWorkbook.Money),
                new("Last bought · آخر شراء", ReportWorkbook.Date), new("Lowest · الأقل", ReportWorkbook.Money), new("Highest · الأعلى", ReportWorkbook.Money),
                new("Weighted avg · المتوسط المرجح", ReportWorkbook.Money), new("Quantity · الكمية", ReportWorkbook.Quantity), new("Best price · الأقل سعراً"),
            ],
            [
                .. report.Rows.SelectMany(r => r.Suppliers.Select((v, i) => new ReportRow(
                    [i == 0 ? r.Material : "", i == 0 ? r.PurchaseUnit : "", v.Supplier, v.LastPrice, v.LastDate, v.LowestPrice, v.HighestPrice,
                     v.AveragePrice, v.Quantity, v.BestPrice ? "Best price · الأقل سعراً" : ""]))),
            ])]);
}

// The inflation simulation: what changed, then every dish, recipe and prep item at the new prices.
public static class InflationWorkbook
{
    private static string KindName(SimulatedItemKind kind) => kind switch
    {
        SimulatedItemKind.Dish => "Dish · طبق",
        SimulatedItemKind.OffMenuRecipe => "Off the menu · خارج المنيو",
        _ => "Prep item · مصنّع",
    };

    public static Stream Build(InflationReport report) =>
        ReportWorkbook.Build([
            new ReportSheet(
                "Simulation", "Inflation & pricing simulator · محاكي التضخم والتسعير",
                $"{report.MaterialsChanged} materials changed · food cost target {report.FoodCostTargetPercent:0.#}% · "
                    + $"monthly profit impact {report.MonthlyProfitImpact:#,##0.00} at the sales of {report.SalesFrom:d MMM} – {report.SalesTo:d MMM yyyy}",
                [
                    new("Kind · النوع"), new("Code · الكود"), new("Name · الاسم"), new("Category · القسم"), new("Price · السعر", ReportWorkbook.Money),
                    new("Cost now · التكلفة الحالية", ReportWorkbook.Money), new("Simulated · التكلفة المتوقعة", ReportWorkbook.Money),
                    new("Change · التغير", ReportWorkbook.Money), new("Food cost % now · النسبة الحالية", ReportWorkbook.Percent),
                    new("Simulated % · النسبة المتوقعة", ReportWorkbook.Percent), new("Price to keep food cost % · سعر للحفاظ على النسبة", ReportWorkbook.Money),
                    new("Price to keep margin · سعر للحفاظ على الهامش", ReportWorkbook.Money), new("Sold, 30 days · المباع", ReportWorkbook.Quantity),
                    new("Monthly profit impact · أثر الربح الشهري", ReportWorkbook.Money),
                ],
                [
                    .. report.Items.Select(i => new ReportRow(
                        [KindName(i.Kind), i.ItemCode, i.Name, i.Category, i.SellingPrice, i.CurrentCost, i.SimulatedCost, i.Change, i.CurrentFoodCostPercent,
                         i.SimulatedFoodCostPercent, i.SuggestedPriceKeepFoodCost, i.SuggestedPriceKeepMargin, i.QuantityLast30Days, i.MonthlyProfitImpact],
                        Flagged: i.NewlyAboveTarget)),
                    new ReportRow(["", "", "Monthly profit impact · أثر الربح الشهري", null, null, null, null, null, null, null, null, null, null,
                        report.MonthlyProfitImpact], ReportRowKind.Total),
                ]),
            new ReportSheet(
                "Prices", "The prices simulated · الأسعار المفترضة", "per purchase unit",
                [
                    new("Material · الخامة"), new("Unit · الوحدة"), new("Now · الحالي", ReportWorkbook.Money), new("Simulated · المفترض", ReportWorkbook.Money),
                    new("Change · التغير", ReportWorkbook.Percent),
                ],
                [.. report.Materials.Select(m => new ReportRow([m.Material, m.PurchaseUnit, m.CurrentPrice, m.SimulatedPrice, m.ChangePercent]))]),
        ]);
}

// A material's stock card as a sheet: the period's movements as the screen lists them, its balance
// opening and closing.
public static class StockCardWorkbook
{
    private static string TypeName(StockCardMovementType type) => type switch
    {
        StockCardMovementType.Opening => "Opening · افتتاحي",
        StockCardMovementType.Purchases => "Purchase · مشتريات",
        StockCardMovementType.Production => "Production · إنتاج",
        StockCardMovementType.Sales => "Sales · مبيعات",
        StockCardMovementType.Waste => "Waste · هالك",
        _ => "Count adjustment · تسوية جرد",
    };

    public static Stream Build(StockCard card)
    {
        var unit = card.PurchaseUnit;
        return ReportWorkbook.Build([new ReportSheet(
            "Stock card", $"{card.Material} · Stock card · كارتة الصنف",
            $"{card.From:d MMM yyyy} – {card.To:d MMM yyyy}{(card.Type is { } t ? $" · {TypeName(t)} only" : "")} · quantities in {unit}, prices per {unit}",
            [
                new("Date · التاريخ", ReportWorkbook.Date), new("Movement · الحركة"), new("Reference · المرجع"), new("Details · البيان"),
                new($"In · وارد ({unit})", ReportWorkbook.Quantity), new($"Out · منصرف ({unit})", ReportWorkbook.Quantity),
                new("Balance · الرصيد", ReportWorkbook.Quantity), new("Unit price · سعر الحركة", "#,##0.00##"),
                new("Value · القيمة", ReportWorkbook.Money), new("Moving average after · المتوسط بعد الحركة", "#,##0.00##"), new("By · بواسطة"),
            ],
            [
                new ReportRow([card.From, "Opening balance · رصيد أول المدة", null, null, null, null, card.OpeningBalance, null, null, card.OpeningAverageCost, null],
                    ReportRowKind.Group),
                .. card.Lines.Select(l => new ReportRow(
                    [l.Date, TypeName(l.Type), l.Reference, l.Details, l.QuantityIn == 0 ? null : l.QuantityIn, l.QuantityOut == 0 ? null : l.QuantityOut,
                     l.Balance, l.UnitCost, l.Value, l.AverageCostAfter, l.RecordedBy],
                    Flagged: l.IsReversal)),
                new ReportRow([card.To, "Closing balance · رصيد آخر المدة", null, null, card.TotalIn, card.TotalOut, card.ClosingBalance, null, card.ClosingValue,
                    card.ClosingAverageCost, null], ReportRowKind.Total),
            ])]);
    }
}
