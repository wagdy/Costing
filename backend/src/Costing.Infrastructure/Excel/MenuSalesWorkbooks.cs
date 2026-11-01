using System.Globalization;
using ClosedXML.Excel;
using Costing.Application.Menu;
using Costing.Application.Sales;
using Costing.Domain.Common;

namespace Costing.Infrastructure.Excel;

// The menu's spreadsheet and the sales': a template to fill in each, and reading one back for its
// import (ImportMenuCommand, ImportSalesCommand, which decide what each row becomes). Columns are
// found by their heading, in English or Arabic, not by position: a point of sale's own export,
// its columns renamed to these, imports as it is.
public static class MenuWorkbook
{
    public const string FileName = "menu-template.xlsx";
    public const string DataSheetName = "Menu";

    private static readonly Column[] Columns =
    [
        new("Number", "Item Number · رقم الصنف", ["item number", "number", "code", "item code", "رقم الصنف", "الكود", "الرقم"], "Optional: the item's code on the reports. Blank: the next one."),
        new("Name", "Item Name · اسم الصنف", ["item name", "item", "name", "اسم الصنف", "الصنف", "الاسم"], "Required."),
        new("NameAr", "Arabic Name · الاسم بالعربي", ["arabic name", "name ar", "الاسم بالعربي", "الاسم العربي"], "Optional."),
        new("Category", "Category · القسم", ["category", "القسم", "الفئة"], "Required for a new item: added when not on the menu."),
        new("CategoryAr", "Arabic Category · القسم بالعربي", ["arabic category", "category ar", "القسم بالعربي"], "Optional."),
        new("Price", "Price · السعر", ["price", "السعر", "سعر البيع"], "The item's price. With sizes, each size's below."),
        new("Size", "Size · الحجم", ["size", "variant", "الحجم", "المقاس"], "Optional: a size, on a row of its own under the item's number or name."),
        new("SizeAr", "Arabic Size · الحجم بالعربي", ["arabic size", "size ar", "الحجم بالعربي"], "Optional."),
        new("SizePrice", "Size Price · سعر الحجم", ["size price", "سعر الحجم"], "The size's price."),
    ];

    public static Stream Build() => SheetBook.Build(DataSheetName, Columns,
    [
        "Fill in one item a row on the Menu sheet. A size goes on a row of its own, with the item's number or name and the size.",
        "املأ صنفًا في كل صف. الحجم في صف مستقل برقم الصنف أو اسمه.",
        "",
        "An item already on the menu (by its number, or its name) is changed; a new one is added, and its category with it.",
    ],
    [
        [6101, "Margherita pizza", "بيتزا مارجريتا", "Pizza", "بيتزا", 140, "", "", ""],
        [6101, "Margherita pizza", "", "", "", "", "Large", "كبير", 180],
        [6201, "Cheese crepe", "كريب جبنة", "Crepes", "كريب", 95, "", "", ""],
    ]);

    public static IReadOnlyList<MenuImportRow> Read(Stream stream)
    {
        var rows = SheetBook.Read(stream, Columns, "Name", "Item Name");
        return rows.Select(r => new MenuImportRow(
                r.Row, r.Int("Number"), r.Text("Name"), r.Text("NameAr"), r.Text("Category"), r.Text("CategoryAr"), r.Number("Price"), r.Text("Size"),
                r.Text("SizeAr"), r.Number("SizePrice")))
            .ToList();
    }
}

public static class SalesWorkbook
{
    public const string FileName = "sales-template.xlsx";
    public const string DataSheetName = "Sales";

    private static readonly Column[] Columns =
    [
        new("Reference", "Receipt Number · رقم الفاتورة", ["receipt number", "receipt", "order number", "order", "invoice", "رقم الفاتورة", "رقم الطلب", "الفاتورة"],
            "The point of sale's own number. Blank: the row is part of a day's totals."),
        new("Date", "Date · التاريخ", ["date", "business date", "التاريخ", "اليوم"], "Required: the business day."),
        new("Time", "Time · الوقت", ["time", "paid at", "الوقت", "الساعة"], "Optional: when it was paid."),
        new("Channel", "Place · نوع الطلب", ["place", "channel", "order type", "type", "نوع الطلب", "النوع"], "Dine in, Takeaway, Delivery or Online. Blank: Dine in."),
        new("Payment", "Payment · طريقة الدفع", ["payment", "payment method", "paid by", "طريقة الدفع", "الدفع"], "Cash, Visa or Instapay. Blank: Cash."),
        new("Item", "Item · الصنف", ["item", "item name", "menu item", "item number", "الصنف", "اسم الصنف", "رقم الصنف"], "Required: its number or its name, as on Menu."),
        new("Size", "Size · الحجم", ["size", "variant", "الحجم"], "Required for an item sold by size."),
        new("AddOns", "Add-ons · الإضافات", ["add-ons", "addons", "extras", "الإضافات"], "Optional: add-on names, separated by commas."),
        new("Quantity", "Quantity · الكمية", ["quantity", "qty", "الكمية", "العدد"], "Required: a whole number."),
        new("LineTotal", "Line Total · إجمالي السطر", ["line total", "total", "amount", "net sales", "إجمالي السطر", "الإجمالي", "المبلغ"],
            "Optional: what the line came to. Blank: the menu's price."),
        new("Discount", "Discount · الخصم", ["discount", "الخصم"], "The receipt's discount, on its first row."),
        new("DeliveryFee", "Delivery Fee · رسوم التوصيل", ["delivery fee", "delivery", "رسوم التوصيل", "التوصيل"], "The receipt's, on its first row."),
        new("Tax", "Tax · الضريبة", ["tax", "vat", "الضريبة"], "The receipt's, on its first row."),
        new("Points", "Points · النقاط", ["points", "loyalty", "النقاط"], "Paid with loyalty points: the receipt's, on its first row."),
        new("Refunded", "Refunded · المرتجع", ["refunded", "refund", "المرتجع"], "Handed back after it was paid: the receipt's, on its first row."),
    ];

    public static Stream Build() => SheetBook.Build(DataSheetName, Columns,
    [
        "Fill in one line of a receipt a row on the Sales sheet; a receipt's other lines below it, with the same receipt number.",
        "املأ سطرًا من الفاتورة في كل صف؛ باقي سطور الفاتورة تحته بنفس رقم الفاتورة.",
        "",
        "A receipt already recorded (its number) is left out, so a sheet imported twice is recorded once.",
        "Rows with no receipt number are a day's totals: one sale for each day, place and way of paying.",
        "Each line takes its stock by its recipe, as a bill entered on Sales does.",
    ],
    [
        ["R-1001", "2026-10-12", "13:40", "Dine in", "Cash", 6101, "", "", 2, 280, 0, 0, 39.2, 0, 0],
        ["R-1001", "2026-10-12", "13:40", "Dine in", "Cash", 6201, "", "Extra cheese", 1, 110, "", "", "", "", ""],
        ["R-1002", "2026-10-12", "14:05", "Delivery", "Visa", 6101, "Large", "", 1, 180, 10, 25, 23.8, 0, 0],
    ]);

    public static IReadOnlyList<SaleImportRow> Read(Stream stream)
    {
        var rows = SheetBook.Read(stream, Columns, "Item", "Item");
        return rows.Select(r => new SaleImportRow(
                r.Row, r.Text("Reference"), r.Date("Date"), r.Time("Time"), r.Text("Channel"), r.Text("Payment"), r.Text("Item"), r.Text("Size"),
                r.Text("AddOns"), r.Number("Quantity"), r.Number("LineTotal"), r.Number("Discount"), r.Number("DeliveryFee"), r.Number("Tax"),
                r.Number("Points"), r.Number("Refunded")))
            .ToList();
    }
}

internal sealed record Column(string Key, string Header, string[] Names, string Note);

// One row read: each column's cell, by its key.
internal sealed class SheetRow(int row, IReadOnlyDictionary<string, IXLCell> cells)
{
    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

    public int Row => row;

    public bool IsBlank => cells.Values.All(c => c.Value.IsBlank || string.IsNullOrWhiteSpace(c.GetFormattedString()));

    public string? Text(string key)
    {
        if (!cells.TryGetValue(key, out var cell))
            return null;
        var value = cell.Value;
        var text = value.IsBlank ? null
            : value.IsNumber ? ((decimal)value.GetNumber()).ToString(Invariant)
            : value.IsText ? value.GetText()
            : cell.GetFormattedString();
        return string.IsNullOrWhiteSpace(text) ? null : text.Trim();
    }

    public decimal? Number(string key)
    {
        if (!cells.TryGetValue(key, out var cell) || cell.Value.IsBlank)
            return null;
        if (cell.Value.IsNumber)
            return (decimal)cell.Value.GetNumber();
        var text = Text(key);
        if (text is null)
            return null;
        return decimal.TryParse(text.Replace(",", ""), NumberStyles.Number, Invariant, out var number)
            ? number
            : throw new DomainException($"Row {row}: \"{text}\" is not a number.");
    }

    public int? Int(string key) => Number(key) is { } n ? (n == decimal.Truncate(n) && n > 0 ? (int)n : throw new DomainException($"Row {row}: an item's number is a whole number, 1 or more.")) : null;

    public DateOnly? Date(string key)
    {
        if (!cells.TryGetValue(key, out var cell) || cell.Value.IsBlank)
            return null;
        if (cell.Value.IsDateTime)
            return DateOnly.FromDateTime(cell.Value.GetDateTime());
        if (cell.Value.IsNumber)
            return DateOnly.FromDateTime(DateTime.FromOADate(cell.Value.GetNumber()));
        var text = Text(key);
        string[] formats = ["yyyy-MM-dd", "d/M/yyyy", "dd/MM/yyyy", "d-M-yyyy", "d.M.yyyy", "M/d/yyyy"];
        return DateOnly.TryParseExact(text, formats, Invariant, DateTimeStyles.None, out var date)
            ? date
            : throw new DomainException($"Row {row}: \"{text}\" is not a date: write it 2026-10-12.");
    }

    public TimeOnly? Time(string key)
    {
        if (!cells.TryGetValue(key, out var cell) || cell.Value.IsBlank)
            return null;
        if (cell.Value.IsDateTime)
            return TimeOnly.FromDateTime(cell.Value.GetDateTime());
        if (cell.Value.IsTimeSpan)
            return TimeOnly.FromTimeSpan(cell.Value.GetTimeSpan());
        if (cell.Value.IsNumber)
            return TimeOnly.FromTimeSpan(TimeSpan.FromDays(cell.Value.GetNumber() % 1));
        var text = Text(key);
        return TimeOnly.TryParse(text, Invariant, out var time) ? time : throw new DomainException($"Row {row}: \"{text}\" is not a time: write it 13:40.");
    }
}

internal static class SheetBook
{
    public const string ContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    private const string HelpSheetName = "How to fill";
    private const int MaxRows = 20_000;

    public static Stream Build(string sheetName, Column[] columns, string[] help, object[][] examples)
    {
        using var workbook = new XLWorkbook();
        var sheet = workbook.Worksheets.Add(sheetName);
        for (var i = 0; i < columns.Length; i++)
        {
            var cell = sheet.Cell(1, i + 1);
            cell.Value = columns[i].Header;
            cell.Style.Font.Bold = true;
            cell.Style.Font.FontColor = XLColor.White;
            cell.Style.Fill.BackgroundColor = XLColor.FromArgb(63, 81, 181);
            cell.CreateComment().AddText(columns[i].Note);
            sheet.Column(i + 1).Width = Math.Max(16, columns[i].Header.Length + 4);
        }
        sheet.SheetView.FreezeRows(1);

        var helpSheet = workbook.Worksheets.Add(HelpSheetName);
        for (var i = 0; i < help.Length; i++)
            helpSheet.Cell(i + 1, 1).Value = help[i];
        helpSheet.Cell(1, 1).Style.Font.Bold = true;
        var first = help.Length + 2;
        helpSheet.Cell(first - 1, 1).Value = "For example:";
        for (var c = 0; c < columns.Length; c++)
        {
            helpSheet.Cell(first, c + 1).Value = columns[c].Header;
            helpSheet.Cell(first, c + 1).Style.Font.Bold = true;
            helpSheet.Column(c + 1).Width = Math.Max(16, columns[c].Header.Length + 4);
        }
        for (var r = 0; r < examples.Length; r++)
            for (var c = 0; c < examples[r].Length; c++)
                helpSheet.Cell(first + r + 1, c + 1).Value = XLCellValue.FromObject(examples[r][c]);

        sheet.SetTabActive();
        var stream = new MemoryStream();
        workbook.SaveAs(stream);
        stream.Position = 0;
        return stream;
    }

    // The rows of a filled-in sheet: the first visible sheet with the required column. Blank rows
    // are left out.
    public static IReadOnlyList<SheetRow> Read(Stream stream, Column[] columns, string requiredKey, string requiredName)
    {
        XLWorkbook workbook;
        try
        {
            workbook = new XLWorkbook(stream);
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            throw new DomainException("That file could not be read as an Excel workbook (.xlsx). Download the template, fill it in, and import that.");
        }

        using (workbook)
        {
            var found = workbook.Worksheets
                .Where(s => s.Visibility == XLWorksheetVisibility.Visible)
                .Select(s => (Sheet: s, Map: Map(s, columns)))
                .FirstOrDefault(s => s.Map.ContainsKey(requiredKey));
            if (found.Sheet is null)
                throw new DomainException($"No sheet has an {requiredName} heading. Download the template, fill it in, and import that.");

            var used = found.Sheet.RowsUsed().Where(r => r.RowNumber() > 1).ToList();
            if (used.Count > MaxRows)
                throw new DomainException($"The sheet has {used.Count:N0} rows: import at most {MaxRows:N0} at a time.");
            return used
                .Select(r => new SheetRow(r.RowNumber(), found.Map.ToDictionary(m => m.Key, m => r.Cell(m.Value))))
                .Where(r => !r.IsBlank)
                .ToList();
        }
    }

    // Each column's place, by its heading in the first row; the first heading that matches wins.
    private static Dictionary<string, int> Map(IXLWorksheet sheet, Column[] columns)
    {
        var headings = sheet.Row(1).CellsUsed().Select(c => (Column: c.Address.ColumnNumber, Parts: Parts(c.GetFormattedString()))).ToList();
        var map = new Dictionary<string, int>();
        var taken = new HashSet<int>();
        foreach (var column in columns)
        {
            var at = headings.FirstOrDefault(h => !taken.Contains(h.Column) && h.Parts.Any(column.Names.Contains));
            if (at.Parts is null)
                continue;
            map[column.Key] = at.Column;
            taken.Add(at.Column);
        }

        return map;
    }

    private static string[] Parts(string heading) =>
        heading.Split(['·', '(', ')', '/', '|', ':'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(p => string.Join(' ', p.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)).ToLowerInvariant())
            .ToArray();
}
