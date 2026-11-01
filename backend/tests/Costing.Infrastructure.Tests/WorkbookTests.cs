using ClosedXML.Excel;
using Costing.Infrastructure.Excel;

namespace Costing.Infrastructure.Tests;

// The menu's and the sales' sheets: their templates filled in and read back, columns found by
// their headings in English or Arabic, wherever they are.
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
}
