using ClosedXML.Excel;
using Costing.Application.Expenses;
using Costing.Application.RawMaterials;
using Costing.Infrastructure.Excel;

namespace Costing.Infrastructure.Tests;

// The menu's, the sales', the raw materials' and the expense items' sheets: their templates filled
// in and read back, the lists written out and read back as they were, columns found by their
// headings in English or Arabic, wherever they are.
public class WorkbookTests
{
    private static Stream Filled(Stream template, string sheetName, object[][] rows, Action<IXLWorksheet>? change = null)
    {
        using var workbook = new XLWorkbook(template);
        var sheet = workbook.Worksheet(sheetName);
        change?.Invoke(sheet);
        for (var r = 0; r < rows.Length; r++)
            for (var c = 0; c < rows[r].Length; c++)
                sheet.Cell(r + 2, c + 1).Value = XLCellValue.FromObject(rows[r][c]);
        var stream = new MemoryStream();
        workbook.SaveAs(stream);
        stream.Position = 0;
        return stream;
    }

    [Fact]
    public void A_menu_sheet_is_read_by_its_headings()
    {
        var rows = MenuWorkbook.Read(Filled(MenuWorkbook.Build(), MenuWorkbook.DataSheetName,
        [
            [6201, "Cheese crepe", "كريب جبنة", "Crepes", "كريب", 95, "", "", ""],
            [6301, "Mixed grill", "", "Grill", "", "", "Kilo", "كيلو", 500],
        ]));

        Assert.Equal(2, rows.Count);
        Assert.Equal((2, (int?)6201, "Cheese crepe", "كريب جبنة", "Crepes", (decimal?)95), (rows[0].Row, rows[0].Number, rows[0].Name, rows[0].NameAr, rows[0].Category, rows[0].Price));
        Assert.Equal(("Kilo", "كيلو", (decimal?)500), (rows[1].Size, rows[1].SizeAr, rows[1].SizePrice));
    }

    [Fact]
    public void A_sales_sheet_headed_in_arabic_with_its_columns_moved_is_read_as_written()
    {
        using var workbook = new XLWorkbook();
        var sheet = workbook.Worksheets.Add("Export");
        string[] headings = ["الكمية", "الصنف", "رقم الفاتورة", "التاريخ", "طريقة الدفع", "ملغي"];
        for (var i = 0; i < headings.Length; i++)
            sheet.Cell(1, i + 1).Value = headings[i];
        sheet.Cell(2, 1).Value = 3;
        sheet.Cell(2, 2).Value = "Burger";
        sheet.Cell(2, 3).Value = "R-9";
        sheet.Cell(2, 4).Value = new DateTime(2026, 10, 12);
        sheet.Cell(2, 5).Value = "فيزا";
        sheet.Cell(2, 6).Value = "بعد المطبخ";
        var stream = new MemoryStream();
        workbook.SaveAs(stream);
        stream.Position = 0;

        var row = Assert.Single(SalesWorkbook.Read(stream));
        Assert.Equal(((decimal?)3, "Burger", "R-9", (DateOnly?)new DateOnly(2026, 10, 12), "فيزا", "بعد المطبخ"),
            (row.Quantity, row.Item, row.Reference, row.Date, row.Payment, row.Voided));
    }

    // A sheet of the headings given, in that order, and its rows.
    private static Stream Sheet(string[] headings, params object[][] rows)
    {
        using var workbook = new XLWorkbook();
        var sheet = workbook.Worksheets.Add("Sheet1");
        for (var i = 0; i < headings.Length; i++)
            sheet.Cell(1, i + 1).Value = headings[i];
        for (var r = 0; r < rows.Length; r++)
            for (var c = 0; c < rows[r].Length; c++)
                sheet.Cell(r + 2, c + 1).Value = XLCellValue.FromObject(rows[r][c]);
        var stream = new MemoryStream();
        workbook.SaveAs(stream);
        stream.Position = 0;
        return stream;
    }

    [Fact]
    public void The_raw_materials_written_out_read_back_as_they_were()
    {
        RawMaterialSheetLine[] lines =
        [
            new("POU-1", "Chicken breast", "Poultry", "Kg", "kg", 1, 185.5m, 5, 85),
            new(null, "بيض", "Dairy", "Piece", "tray", 30, null, 0, 100),
            new("007", "Milk", "Dairy", "Liter", "carton", 12, 504.1234m, 2.5m, 100),
        ];
        using var written = RawMaterialWorkbook.Build(["Dairy", "Poultry"], lines);

        var rows = RawMaterialWorkbook.Read(written);

        Assert.Equal(
            [
                new RawMaterialSheetRow(2, "Chicken breast", "Poultry", "Kg", "185.5", "POU-1", "kg", "1", "5", "85"),
                new RawMaterialSheetRow(3, "بيض", "Dairy", "Piece", null, null, "tray", "30", "0", "100"),
                // A code of digits stays as it is written, its leading zeros too.
                new RawMaterialSheetRow(4, "Milk", "Dairy", "Liter", "504.1234", "007", "carton", "12", "2.5", "100"),
            ],
            rows);
    }

    [Fact]
    public void A_raw_materials_sheet_headed_in_arabic_or_the_earlier_template_is_read_as_written()
    {
        // Arabic headings only, the columns moved, and 85% typed as a percentage.
        using var arabic = new XLWorkbook();
        var sheet = arabic.Worksheets.Add("الخامات");
        string[] headings = ["التكلفة", "الوحدة", "الاسم", "الكود", "نسبة الصافي", "القسم"];
        for (var i = 0; i < headings.Length; i++)
            sheet.Cell(1, i + 1).Value = headings[i];
        sheet.Cell(2, 1).Value = 42.5;
        sheet.Cell(2, 2).Value = "لتر";
        sheet.Cell(2, 3).Value = "لبن";
        sheet.Cell(2, 4).Value = "DAI-1";
        sheet.Cell(2, 5).Value = 0.85;
        sheet.Cell(2, 5).Style.NumberFormat.Format = "0%";
        sheet.Cell(2, 6).Value = "ألبان";
        var stream = new MemoryStream();
        arabic.SaveAs(stream);
        stream.Position = 0;

        var row = Assert.Single(RawMaterialWorkbook.Read(stream));
        Assert.Equal(new RawMaterialSheetRow(2, "لبن", "ألبان", "لتر", "42.5", "DAI-1", null, null, null, "85%"), row);

        // The earlier template's four columns: its Initial Cost is the cost per kg, litre or piece.
        var earlier = Assert.Single(RawMaterialWorkbook.Read(Sheet(
            ["Material Name · اسم الخامة", "Category · القسم", "Unit of Measure · وحدة القياس", "Initial Cost · التكلفة المبدئية"],
            ["Rice", "Dry goods", "Kg", 30])));
        Assert.Equal(new RawMaterialSheetRow(2, "Rice", "Dry goods", "Kg", "30"), earlier);
    }

    [Fact]
    public void The_template_and_the_export_offer_the_categories_and_units_and_say_how_to_fill_them()
    {
        using var template = new XLWorkbook(RawMaterialWorkbook.Build(["Dairy", "Poultry"]));
        var sheet = template.Worksheet(RawMaterialWorkbook.DataSheetName);
        Assert.Equal(
            [RawMaterialWorkbook.CodeHeader, RawMaterialWorkbook.NameHeader, RawMaterialWorkbook.CategoryHeader, RawMaterialWorkbook.UnitHeader,
             RawMaterialWorkbook.PurchaseUnitHeader, RawMaterialWorkbook.HoldsHeader, RawMaterialWorkbook.CostHeader, RawMaterialWorkbook.ReorderHeader,
             RawMaterialWorkbook.YieldHeader],
            sheet.Row(1).CellsUsed().Select(c => c.GetString()));
        // Nothing to import on the template itself; the examples are on its own sheet.
        Assert.Empty(sheet.RowsUsed().Skip(1));
        Assert.Equal(XLWorksheetVisibility.Hidden, template.Worksheet("Lists").Visibility);
        Assert.Equal(["Dairy", "Poultry"], template.Worksheet("Lists").Column(1).CellsUsed().Skip(1).Select(c => c.GetString()));
        Assert.Contains("How to fill", template.Worksheets.Select(w => w.Name));
        Assert.Empty(RawMaterialWorkbook.Read(RawMaterialWorkbook.Build(["Dairy"])));
    }

    [Fact]
    public void The_expense_items_written_out_read_back_as_they_were()
    {
        ExpenseItemSheetLine[] lines = [new("Electricity", "الكهرباء", "Utilities", "month"), new("Bank fees", null, "General expenses", null)];

        var rows = ExpenseItemWorkbook.Read(ExpenseItemWorkbook.Build(["General expenses", "Utilities"], lines));

        Assert.Equal(
            [new ExpenseItemSheetRow(2, "Electricity", "الكهرباء", "Utilities", "month"), new ExpenseItemSheetRow(3, "Bank fees", null, "General expenses", null)],
            rows);
        // Headed in Arabic, its Arabic name apart from its name.
        var arabic = Assert.Single(ExpenseItemWorkbook.Read(Sheet(["الوحدة", "الاسم بالعربي", "اسم المصروف", "القسم"], ["زيارة", "صيانة", "Maintenance", "Repairs"])));
        Assert.Equal(new ExpenseItemSheetRow(2, "Maintenance", "صيانة", "Repairs", "زيارة"), arabic);
    }

    [Fact]
    public void A_file_that_is_not_a_sheet_or_has_no_name_column_is_refused_in_both_languages()
    {
        var notExcel = Assert.Throws<Costing.Domain.Common.DomainException>(() => RawMaterialWorkbook.Read(new MemoryStream("not a workbook"u8.ToArray())));
        Assert.Contains("could not be read as an Excel workbook", notExcel.Message);
        Assert.Contains("تعذّرت قراءة الملف", notExcel.Message);
        var noName = Assert.Throws<Costing.Domain.Common.DomainException>(() => ExpenseItemWorkbook.Read(Sheet(["Category", "Unit"], ["Repairs", "visit"])));
        Assert.StartsWith("No sheet has the Expense Name heading.", noName.Message);
    }
}
