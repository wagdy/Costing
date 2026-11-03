using ClosedXML.Excel;
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
}
