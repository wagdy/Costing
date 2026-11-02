using System.Globalization;
using ClosedXML.Excel;
using Costing.Domain.Common;

namespace Costing.Infrastructure.Excel;

// A column of a sheet: its key in the code, its heading, every heading it may be found under (in
// English or Arabic, capitals and spacing aside), and the note on its heading. A number column
// may say how its numbers are written.
internal sealed record Column(string Key, string Header, string[] Names, string Note, string? NumberFormat = null);

// A column's dropdown: the values offered, from a hidden sheet, and what is said of one typed that
// is not on it. OthersAllowed: a warning that lets it stand (a new category); else it is refused.
internal sealed record SheetList(IReadOnlyList<string> Values, bool OthersAllowed, string Title, string Message);

// One cell as read: its value, and the text Excel shows for it. Copied out while the workbook is
// open, which it is not once the rows are read.
internal sealed record SheetCell(XLCellValue Value, string Formatted)
{
    public static SheetCell Of(IXLCell cell) => new(cell.Value, cell.GetFormattedString());
}

// One row read: each column's cell, by its key.
internal sealed class SheetRow(int row, IReadOnlyDictionary<string, SheetCell> cells)
{
    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

    public int Row => row;

    public bool IsBlank => cells.Values.All(c => c.Value.IsBlank || string.IsNullOrWhiteSpace(c.Formatted));

    public string? Text(string key)
    {
        if (!cells.TryGetValue(key, out var cell))
            return null;
        var value = cell.Value;
        var text = value.IsBlank ? null
            : value.IsNumber ? ((decimal)value.GetNumber()).ToString(Invariant)
            : value.IsText ? value.GetText()
            : cell.Formatted;
        return string.IsNullOrWhiteSpace(text) ? null : text.Trim();
    }

    // The cell as Excel shows it: "85%" for a percentage, where Text gives the 0.85 it holds.
    public string? Shown(string key) =>
        cells.TryGetValue(key, out var cell) && !string.IsNullOrWhiteSpace(cell.Formatted) ? cell.Formatted.Trim() : null;

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
        if (text is null)
            return null;
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
        if (text is null)
            return null;
        return TimeOnly.TryParse(text, Invariant, out var time) ? time : throw new DomainException($"Row {row}: \"{text}\" is not a time: write it 13:40.");
    }
}

// The sheets the system gives and takes (the menu, the sales, the raw materials, the expense
// items): one sheet of columns under bold headings, a sheet of how to fill it with examples, and
// reading one back by its headings wherever they are.
internal static class SheetBook
{
    public const string ContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    private const string HelpSheetName = "How to fill";
    private const string ListsSheetName = "Lists";
    private const int MaxRows = 20_000;

    // Rows the dropdowns and number formats cover past the rows written, for a sheet to grow into.
    private const int SpareRows = 1000;

    // rows: the sheet filled in (an export), in the columns' order; none for a template. lists: a
    // dropdown for a column, by its key.
    public static Stream Build(
        string sheetName, Column[] columns, string[] help, object[][] examples, IReadOnlyList<object?[]>? rows = null,
        IReadOnlyDictionary<string, SheetList>? lists = null)
    {
        using var workbook = new XLWorkbook();
        var sheet = workbook.Worksheets.Add(sheetName);
        rows ??= [];
        var lastRow = rows.Count + SpareRows + 1;
        for (var i = 0; i < columns.Length; i++)
        {
            var cell = sheet.Cell(1, i + 1);
            cell.Value = columns[i].Header;
            cell.Style.Font.Bold = true;
            cell.Style.Font.FontColor = XLColor.White;
            cell.Style.Fill.BackgroundColor = XLColor.FromArgb(63, 81, 181);
            cell.CreateComment().AddText(columns[i].Note);
            if (columns[i].NumberFormat is { } format)
                sheet.Range(2, i + 1, lastRow, i + 1).Style.NumberFormat.Format = format;
        }

        for (var r = 0; r < rows.Count; r++)
            for (var c = 0; c < columns.Length && c < rows[r].Length; c++)
                if (rows[r][c] is { } value)
                    sheet.Cell(r + 2, c + 1).Value = XLCellValue.FromObject(value);

        // Wide enough for the heading and the longest value written, by its length: measuring the
        // text would need fonts, which a server's container may not have.
        for (var i = 0; i < columns.Length; i++)
        {
            var longest = rows.Select(r => i < r.Length ? Convert.ToString(r[i], CultureInfo.InvariantCulture)?.Length ?? 0 : 0).DefaultIfEmpty(0).Max();
            sheet.Column(i + 1).Width = Math.Min(60, Math.Max(Math.Max(16, columns[i].Header.Length + 4), longest + 3));
        }
        sheet.SheetView.FreezeRows(1);
        if (rows.Count > 0)
            sheet.Range(1, 1, rows.Count + 1, columns.Length).SetAutoFilter();

        if (lists is { Count: > 0 })
            AddLists(workbook, sheet, columns, lists, lastRow);

        var helpSheet = workbook.Worksheets.Add(HelpSheetName);
        for (var i = 0; i < help.Length; i++)
            helpSheet.Cell(i + 1, 1).Value = help[i];
        helpSheet.Cell(1, 1).Style.Font.Bold = true;
        var first = help.Length + 2;
        helpSheet.Cell(first - 1, 1).Value = "For example · مثال:";
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

    // Each list on a hidden sheet, a column of it each, and a dropdown from it on its column.
    private static void AddLists(XLWorkbook workbook, IXLWorksheet sheet, Column[] columns, IReadOnlyDictionary<string, SheetList> lists, int lastRow)
    {
        var listsSheet = workbook.Worksheets.Add(ListsSheetName);
        var at = 0;
        foreach (var (key, list) in lists)
        {
            var column = Array.FindIndex(columns, c => c.Key == key) + 1;
            if (column == 0)
                continue;
            at++;
            listsSheet.Cell(1, at).Value = key;
            for (var i = 0; i < list.Values.Count; i++)
                listsSheet.Cell(i + 2, at).Value = list.Values[i];
            var letter = XLHelper.GetColumnLetterFromNumber(at);
            var validation = sheet.Range(2, column, lastRow, column).CreateDataValidation();
            validation.List($"'{ListsSheetName}'!${letter}$2:${letter}${Math.Max(list.Values.Count, 1) + 1}", true);
            validation.IgnoreBlanks = true;
            validation.ErrorStyle = list.OthersAllowed ? XLErrorStyle.Information : XLErrorStyle.Warning;
            validation.ErrorTitle = list.Title;
            validation.ErrorMessage = list.Message;
        }
        listsSheet.Visibility = XLWorksheetVisibility.Hidden;
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
            throw new DomainException(
                "That file could not be read as an Excel workbook (.xlsx). Download the template, fill it in, and import that. · " +
                "تعذّرت قراءة الملف كملف إكسل (.xlsx): نزّل النموذج واملأه ثم استورده.");
        }

        using (workbook)
        {
            var found = workbook.Worksheets
                .Where(s => s.Visibility == XLWorksheetVisibility.Visible)
                .Select(s => (Sheet: s, Map: Map(s, columns)))
                .FirstOrDefault(s => s.Map.ContainsKey(requiredKey));
            if (found.Sheet is null)
                throw new DomainException(
                    $"No sheet has the {requiredName} heading. Download the template, fill it in, and import that. · " +
                    "لا توجد ورقة بالعناوين المطلوبة: نزّل النموذج واملأه ثم استورده.");

            var used = found.Sheet.RowsUsed().Where(r => r.RowNumber() > 1).ToList();
            if (used.Count > MaxRows)
                throw new DomainException($"The sheet has {used.Count:N0} rows: import at most {MaxRows:N0} at a time. · الملف أكبر من المسموح: قسّمه.");
            return used
                .Select(r => new SheetRow(r.RowNumber(), found.Map.ToDictionary(m => m.Key, m => SheetCell.Of(r.Cell(m.Value)))))
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
