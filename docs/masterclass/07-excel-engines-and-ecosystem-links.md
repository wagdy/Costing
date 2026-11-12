# الفصل 07: محركات الإكسيل والربط مع الأنظمة الأخرى

[← الفصل السابق](06-financials-safe-tax-and-intelligence.md) · [الفهرس](00-index-and-build-roadmap.md) · [الفصل التالي: نواة الفرونت إند وشاشات التشغيل →](08-frontend-core-and-operations-screens.md)

## 1. محركات الإكسيل

### 1.1 المبادئ

المطاعم تعيش على الإكسيل. النظام يحترم ذلك بقواعد صارمة:

1. **القالب = التصدير:** ما تصدّره بنفس أعمدة القالب، فتعدّله وتستورده كما هو (أو تنقله لتثبيت آخر).
2. **الأعمدة تُعرف بعنوانها لا بموقعها**، بالإنجليزية أو العربية، مع تجاهل الحروف الكبيرة والمسافات. نقل عمود أو إضافة عمود لا يكسر شيئًا.
3. **الاستيراد "Upsert":** يطابق بالكود ثم بالاسم؛ الخلية الفارغة تُترك كما هي (لا تمسح قيمة موجودة)؛ والتكلفة تُستبدل فقط إن اختلفت عند 4 خانات عشرية.
4. **لا شيء يُتخطى بصمت:** كل صف مرفوض يعود برقمه في الشيت وسببه بالعربية والإنجليزية.
5. **الأرقام العربية والتواريخ والوحدات** تُفهم كما يكتبها الإنسان (`SheetText`).

### 1.2 `SheetBook`: محرك مشترك

- `Column`: مفتاح في الكود، العنوان، **كل العناوين البديلة** التي قد يُوجد بها (عربي/إنجليزي)، ملاحظة العنوان، وكيف تُكتب أرقامه.
- `SheetList`: **قائمة منسدلة** على عمود: مصدرها نطاق في شيت مرجعي، و `Strict` ⇐ `XLErrorStyle.Stop` (لا يُقبل إلا من القائمة)، أو `Information`/`Warning` إن سُمح بغيرها.
- `ReferenceSheet(Hidden = true)`: شيت مرجعي **مخفي** (`XLWorksheetVisibility.Hidden`) يحمل قيم القوائم.
- القراءة: إيجاد الأعمدة بالعناوين، وقراءة الصفوف كخلايا نصية كما يراها الإنسان.

> 📄 **`backend/src/Costing.Infrastructure/Excel/SheetBook.cs`** — 302 سطر

```csharp
using System.Globalization;
using ClosedXML.Excel;
using Costing.Domain.Common;

namespace Costing.Infrastructure.Excel;

// A column of a sheet: its key in the code, its heading, every heading it may be found under (in
// English or Arabic, capitals and spacing aside), and the note on its heading. A number column
// may say how its numbers are written.
internal sealed record Column(string Key, string Header, string[] Names, string Note, string? NumberFormat = null);

// A column's dropdown: the values offered, from a hidden sheet, and what is said of one typed that
// is not on it. OthersAllowed: a note that lets it stand (a new category); else a warning, which
// still lets a person keep it (كيلو for Kg); Strict: refused outright (an ingredient not on the
// list). Reference: a reference sheet's column to offer instead of Values, as "Ingredients!A".
internal sealed record SheetList(
    IReadOnlyList<string> Values, bool OthersAllowed, string Title, string Message, string? Reference = null, bool Strict = false);

// A sheet of reference data the workbook carries (the ingredients and their units): its columns'
// headings and its rows, hidden unless it is meant to be read.
internal sealed record ReferenceSheet(string Name, string[] Headers, IReadOnlyList<object?[]> Rows, bool Hidden = true);

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
    // dropdown for a column, by its key. references: sheets of reference data a dropdown may offer.
    public static Stream Build(
        string sheetName, Column[] columns, string[] help, object[][] examples, IReadOnlyList<object?[]>? rows = null,
        IReadOnlyDictionary<string, SheetList>? lists = null, IReadOnlyList<ReferenceSheet>? references = null)
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

        foreach (var reference in references ?? [])
            AddReference(workbook, reference);
        if (lists is { Count: > 0 })
            AddLists(workbook, sheet, columns, lists, lastRow, references ?? []);

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

    // A reference sheet: bold headings, its rows, each column as wide as it needs; hidden unless meant to be read.
    private static void AddReference(XLWorkbook workbook, ReferenceSheet reference)
    {
        var sheet = workbook.Worksheets.Add(reference.Name);
        for (var c = 0; c < reference.Headers.Length; c++)
        {
            sheet.Cell(1, c + 1).Value = reference.Headers[c];
            sheet.Cell(1, c + 1).Style.Font.Bold = true;
            var longest = reference.Rows.Select(r => c < r.Length ? Convert.ToString(r[c], CultureInfo.InvariantCulture)?.Length ?? 0 : 0).DefaultIfEmpty(0).Max();
            sheet.Column(c + 1).Width = Math.Min(60, Math.Max(reference.Headers[c].Length + 4, longest + 3));
        }
        for (var r = 0; r < reference.Rows.Count; r++)
            for (var c = 0; c < reference.Rows[r].Length; c++)
                if (reference.Rows[r][c] is { } value)
                    sheet.Cell(r + 2, c + 1).Value = XLCellValue.FromObject(value);
        sheet.SheetView.FreezeRows(1);
        if (reference.Hidden)
            sheet.Visibility = XLWorksheetVisibility.Hidden;
    }

    // Each list on a hidden sheet, a column of it each, or a reference sheet's column; and a
    // dropdown from it on its column.
    private static void AddLists(
        XLWorkbook workbook, IXLWorksheet sheet, Column[] columns, IReadOnlyDictionary<string, SheetList> lists, int lastRow, IReadOnlyList<ReferenceSheet> references)
    {
        IXLWorksheet? listsSheet = null;
        var at = 0;
        foreach (var (key, list) in lists)
        {
            var column = Array.FindIndex(columns, c => c.Key == key) + 1;
            if (column == 0)
                continue;
            string range;
            if (list.Reference?.Split('!') is [var referenceName, var referenceColumn])
            {
                var count = references.Single(r => r.Name == referenceName).Rows.Count;
                range = $"'{referenceName}'!${referenceColumn}$2:${referenceColumn}${Math.Max(count, 1) + 1}";
            }
            else
            {
                listsSheet ??= workbook.Worksheets.Add(ListsSheetName);
                at++;
                listsSheet.Cell(1, at).Value = key;
                for (var i = 0; i < list.Values.Count; i++)
                    listsSheet.Cell(i + 2, at).Value = list.Values[i];
                var letter = XLHelper.GetColumnLetterFromNumber(at);
                range = $"'{ListsSheetName}'!${letter}$2:${letter}${Math.Max(list.Values.Count, 1) + 1}";
            }
            var validation = sheet.Range(2, column, lastRow, column).CreateDataValidation();
            validation.List(range, true);
            validation.IgnoreBlanks = true;
            validation.ErrorStyle = list.Strict ? XLErrorStyle.Stop : list.OthersAllowed ? XLErrorStyle.Information : XLErrorStyle.Warning;
            validation.ErrorTitle = list.Title;
            validation.ErrorMessage = list.Message;
        }
        if (listsSheet is not null)
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
```


> 📄 **`backend/src/Costing.Application/Common/SheetText.cs`** — 51 سطر

```csharp
using System.Globalization;
using System.Text;

namespace Costing.Application.Common;

// Cells of an imported spreadsheet, as a person reads them.
internal static class SheetText
{
    // Trimmed, runs of spaces made one, and null when empty.
    public static string? Clean(string? text) =>
        string.IsNullOrWhiteSpace(text) ? null : string.Join(' ', text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));

    // A number as written, in Western or Arabic digits, with or without thousands separators.
    public static decimal? Amount(string text) =>
        decimal.TryParse(Western(text), NumberStyles.Number, CultureInfo.InvariantCulture, out var amount) ? amount : null;

    // Arabic digits, and their decimal and thousands marks, written as Western ones.
    public static string Western(string text)
    {
        var western = new StringBuilder(text.Length);
        foreach (var c in text)
            western.Append(c switch
            {
                >= '٠' and <= '٩' => (char)('0' + (c - '٠')),
                >= '۰' and <= '۹' => (char)('0' + (c - '۰')),
                '٫' => '.',
                '٬' => ',',
                _ => c,
            });
        return western.ToString();
    }

    // A name as two spellings of it are compared: capitals and spacing aside, an underscore as a
    // space, without the stretching tatweel, and the Arabic letters written more than one way
    // (أ إ آ ا, ة ه, ى ي) as one. زبدة_فيرن_ and زبده فيرن are the same butter.
    public static string Key(string name)
    {
        var plain = new StringBuilder(name.Length);
        foreach (var c in name)
            plain.Append(c switch
            {
                '_' => ' ',
                'ـ' => '\0',
                'أ' or 'إ' or 'آ' => 'ا',
                'ة' => 'ه',
                'ى' => 'ي',
                _ => c,
            });
        return Clean(plain.ToString().Replace("\0", string.Empty))?.ToUpperInvariant() ?? string.Empty;
    }
}
```


### 1.3 الخامات والمصروفات

`RawMaterialSheet` + `RawMaterialWorkbook`: كل خامة بفئتها ووحدتها ووحدة شرائها وحجمها وتكلفة وحدة الشراء والـ Yield وحد الطلب. والمصروفات بنفس الأسلوب.

> 📄 **`backend/src/Costing.Application/RawMaterials/RawMaterialSheet.cs`** — 469 سطر

```csharp
using MediatR;
using Costing.Domain.Common;
using Costing.Application.Categories;
using Costing.Application.Common;
using Costing.Domain.Approvals;
using Costing.Domain.Categories;
using Costing.Domain.RawMaterials;

namespace Costing.Application.RawMaterials;

// Raw materials to and from a spreadsheet: the list written out (GetRawMaterialSheetQuery, the
// export), and a sheet read back in (ImportRawMaterialsCommand), the template's or an export
// edited, or one exported from another installation. Every one is a purchased stock item, for
// recipes, purchases and stock counts; never an expense item, which is a thing of its own, nor a
// prep item, which is made in the kitchen.
//
// A row is the material its code names, else the one its name does (capitals and spacing aside):
// that one is changed as the row says, and a row naming none is a new material. A blank cell
// leaves that detail as it is. Each row is checked on its own: a good one applied, a bad one
// skipped and said why, by its row number on the sheet, in English and Arabic. Never twice for
// one material: a second row for it, by its name or its code, is skipped. A category not on the
// list yet is added, once.
//
// The unit it is counted in is not changed here: that restates its stock, recipes and records, on
// Raw materials. The cost replaces the average only when it differs from the one written out, so
// an export imported back as it is leaves each average as it was, not rounded.

// One row as read from the sheet: its number there, and its cells as they were written.
// PurchaseUnitHolds is in the Unit's kg, litres or pieces; ReorderLevel in purchase units, as the
// material's own screen writes it.
public sealed record RawMaterialSheetRow(
    int Row,
    string? Name,
    string? Category,
    string? Unit,
    string? Cost,
    string? Code = null,
    string? PurchaseUnit = null,
    string? PurchaseUnitHolds = null,
    string? ReorderLevel = null,
    string? YieldPercent = null);

// A material as the sheet writes it, in the sheet's units.
public sealed record RawMaterialSheetLine(
    string? Code,
    string Name,
    string Category,
    string Unit,
    string PurchaseUnit,
    decimal PurchaseUnitHolds,
    decimal? Cost,
    decimal ReorderLevel,
    decimal YieldPercent);

// What the sheet is written from: the materials, and the raw materials categories for its dropdown.
public sealed record RawMaterialSheet(IReadOnlyList<RawMaterialSheetLine> Lines, IReadOnlyList<string> Categories);

public sealed record ImportedRawMaterial(
    int Row, Guid Id, string Name, string Category, UnitOfMeasure Unit, string PurchaseUnit, decimal? CostPerPurchaseUnit);

// One already there, changed by its row: what changed, by the sheet's column (Name, Code,
// Category, PurchaseUnit, Cost, ReorderLevel, Yield; NameAr and Unit for an expense item).
public sealed record UpdatedSheetItem(int Row, Guid Id, string Name, IReadOnlyList<string> Changes);

public sealed record SkippedSheetRow(int Row, string? Name, string Reason, string? ReasonAr = null);

public sealed record RawMaterialImportResult(
    IReadOnlyList<ImportedRawMaterial> Created,
    IReadOnlyList<UpdatedSheetItem> Updated,
    int Unchanged,
    IReadOnlyList<SkippedSheetRow> Skipped,
    IReadOnlyList<string> CategoriesAdded);

public sealed record ImportRawMaterialsCommand(IReadOnlyList<RawMaterialSheetRow> Rows) : IRequest<RawMaterialImportResult>;

public sealed record GetRawMaterialSheetQuery : IRequest<RawMaterialSheet>;

// The units the sheet takes, in English or Arabic: what a material is bought and priced in. A
// material bought by the kg is counted in grams, by the litre in millilitres, by the piece in
// pieces; its cost is per kg, litre or piece unless its purchase unit says otherwise.
public static class SheetUnits
{
    public static readonly IReadOnlyList<string> Names = ["Kg", "Liter", "Piece"];

    private static readonly Dictionary<string, UnitOfMeasure> ByName = new(StringComparer.OrdinalIgnoreCase)
    {
        ["kg"] = UnitOfMeasure.Gram,
        ["kgs"] = UnitOfMeasure.Gram,
        ["kilo"] = UnitOfMeasure.Gram,
        ["kilos"] = UnitOfMeasure.Gram,
        ["kilogram"] = UnitOfMeasure.Gram,
        ["kilograms"] = UnitOfMeasure.Gram,
        ["كيلو"] = UnitOfMeasure.Gram,
        ["كجم"] = UnitOfMeasure.Gram,
        ["كغ"] = UnitOfMeasure.Gram,
        ["كيلوجرام"] = UnitOfMeasure.Gram,
        ["كيلوغرام"] = UnitOfMeasure.Gram,
        ["liter"] = UnitOfMeasure.Millilitre,
        ["liters"] = UnitOfMeasure.Millilitre,
        ["litre"] = UnitOfMeasure.Millilitre,
        ["litres"] = UnitOfMeasure.Millilitre,
        ["l"] = UnitOfMeasure.Millilitre,
        ["lt"] = UnitOfMeasure.Millilitre,
        ["ltr"] = UnitOfMeasure.Millilitre,
        ["لتر"] = UnitOfMeasure.Millilitre,
        ["piece"] = UnitOfMeasure.Piece,
        ["pieces"] = UnitOfMeasure.Piece,
        ["pc"] = UnitOfMeasure.Piece,
        ["pcs"] = UnitOfMeasure.Piece,
        ["unit"] = UnitOfMeasure.Piece,
        ["units"] = UnitOfMeasure.Piece,
        ["قطعة"] = UnitOfMeasure.Piece,
        ["حبة"] = UnitOfMeasure.Piece,
        ["عدد"] = UnitOfMeasure.Piece,
    };

    public static UnitOfMeasure? Parse(string? text) =>
        text is null ? null : ByName.TryGetValue(text.Trim().TrimEnd('.'), out var unit) ? unit : null;

    // As the sheet writes it.
    public static string Name(UnitOfMeasure unit) => unit switch
    {
        UnitOfMeasure.Gram => "Kg",
        UnitOfMeasure.Millilitre => "Liter",
        _ => "Piece",
    };

    public static string NameAr(UnitOfMeasure unit) => unit switch
    {
        UnitOfMeasure.Gram => "كيلو",
        UnitOfMeasure.Millilitre => "لتر",
        _ => "قطعة",
    };

    // How many of the material's own unit one of the sheet's is: a kg is 1000 g.
    public static decimal Factor(UnitOfMeasure unit) => unit == UnitOfMeasure.Piece ? 1m : 1000m;
}

internal sealed class GetRawMaterialSheetHandler(IRawMaterialRepository materials, IPurchaseCategoryRepository categories)
    : IRequestHandler<GetRawMaterialSheetQuery, RawMaterialSheet>
{
    public async Task<RawMaterialSheet> Handle(GetRawMaterialSheetQuery request, CancellationToken cancellationToken)
    {
        var all = await categories.GetAllAsync(cancellationToken);
        var byId = all.ToDictionary(c => c.Id);
        var lines = (await materials.GetAllAsync(cancellationToken))
            .Where(m => !m.IsArchived && !m.IsPrepItem)
            .Select(m =>
            {
                var factor = SheetUnits.Factor(m.Unit);
                return new RawMaterialSheetLine(
                    m.Code,
                    m.Name,
                    byId.GetValueOrDefault(m.CategoryId)?.Name ?? PurchaseCategory.GeneralName,
                    SheetUnits.Name(m.Unit),
                    m.PurchaseUnit,
                    Math.Round(m.PurchaseUnitSize / factor, 3),
                    m.CostPerPurchaseUnit is { } cost ? Math.Round(cost, 4) : null,
                    Math.Round(m.ReorderLevel / m.PurchaseUnitSize, 3),
                    m.DefaultYieldPercent);
            })
            .OrderBy(l => l.Category, StringComparer.CurrentCultureIgnoreCase)
            .ThenBy(l => l.Name, StringComparer.CurrentCultureIgnoreCase)
            .ToList();
        var names = all.Where(c => c.Kind == CategoryKind.RawMaterials).Select(c => c.Name).OrderBy(n => n, StringComparer.CurrentCultureIgnoreCase).ToList();
        return new RawMaterialSheet(lines, names);
    }
}

internal sealed class ImportRawMaterialsHandler(
    IRawMaterialRepository materials, IPurchaseCategoryRepository categories, IApprovalRequestRepository approvals, IUnitOfWork unitOfWork)
    : IRequestHandler<ImportRawMaterialsCommand, RawMaterialImportResult>
{
    public const int MaxRows = 2000;
    private const int MaxNameLength = 200;
    private const int MaxCodeLength = 32;
    private const int MaxPurchaseUnitLength = 32;
    private const int MaxCategoryLength = 100;

    // A row checked: the material it is (none: a new one) and its cells read.
    private sealed record Plan(
        RawMaterial? Existing, string Name, string? Code, UnitOfMeasure Unit, string? Category, string? PurchaseUnit, decimal? Holds,
        decimal? Cost, decimal? ReorderLevel, decimal? Yield);

    private sealed record Problem(string Reason, string ReasonAr);

    public async Task<RawMaterialImportResult> Handle(ImportRawMaterialsCommand request, CancellationToken cancellationToken)
    {
        if (request.Rows.Count == 0)
            throw new DomainException("The sheet has no materials on it: fill in a row under the headings. · لا توجد خامات في الملف: املأ صفًا تحت العناوين.");
        if (request.Rows.Count > MaxRows)
            throw new DomainException($"Import at most {MaxRows:N0} materials at a time: split the sheet. · استورد {MaxRows:N0} خامة على الأكثر في المرة: قسّم الملف.");

        // Every material by its name and its code: deleted ones and prep items too, which a row
        // may name but not change.
        var all = await materials.GetAllAsync(cancellationToken);
        var byName = new Dictionary<string, RawMaterial>();
        foreach (var material in all)
            byName.TryAdd(PurchaseCategory.Normalize(material.Name), material);
        var byCode = all.Where(m => m.Code is not null).GroupBy(m => CodeKey(m.Code!)).ToDictionary(g => g.Key, g => g.ToList());
        var pending = (await approvals.GetPendingAsync(cancellationToken)).Select(r => r.RecordId).ToHashSet();
        // Categories by their name, English or Arabic.
        var known = new Dictionary<string, PurchaseCategory>();
        foreach (var category in await categories.GetAllAsync(cancellationToken))
        {
            known.TryAdd(PurchaseCategory.Normalize(category.Name), category);
            if (category.NameAr is { } ar)
                known.TryAdd(PurchaseCategory.Normalize(ar), category);
        }

        var created = new List<ImportedRawMaterial>();
        var updated = new List<UpdatedSheetItem>();
        var unchanged = 0;
        var skipped = new List<SkippedSheetRow>();
        var added = new List<string>();
        // Where each name, code and material was first on the sheet.
        var namesOnSheet = new Dictionary<string, int>();
        var codesOnSheet = new Dictionary<string, int>();
        var materialsOnSheet = new Dictionary<Guid, int>();
        foreach (var row in request.Rows.OrderBy(r => r.Row))
        {
            var name = SheetText.Clean(row.Name);
            var checkedRow = Check(row, name, byName, byCode, pending, known, namesOnSheet, codesOnSheet, materialsOnSheet);
            if (checkedRow.Problem is { } problem)
            {
                skipped.Add(new SkippedSheetRow(row.Row, name, problem.Reason, problem.ReasonAr));
                continue;
            }

            var plan = checkedRow.Plan!;
            var category = plan.Category is null ? null : await CategoryAsync(plan.Category, known, added, cancellationToken);
            RawMaterial material;
            if (plan.Existing is null)
            {
                material = new RawMaterial(plan.Name, plan.Unit);
                material.Describe(plan.Code, (category ?? await categories.ResolveAsync(null, CategoryKind.RawMaterials, null, cancellationToken)).Id);
                var factor = SheetUnits.Factor(plan.Unit);
                if (plan.PurchaseUnit is not null || plan.Holds is not null)
                    material.SetPurchaseUnit(plan.PurchaseUnit ?? material.PurchaseUnit, plan.Holds is { } holds ? holds * factor : material.PurchaseUnitSize);
                if (plan.Yield is { } yield)
                    material.SetDefaultYield(yield);
                if (plan.ReorderLevel is { } reorder)
                    material.SetReorderLevel(reorder * material.PurchaseUnitSize);
                if (plan.Cost is { } cost)
                    material.SetCost(cost);
                materials.Add(material);
                created.Add(new ImportedRawMaterial(
                    row.Row, material.Id, material.Name, category?.Name ?? PurchaseCategory.GeneralName, material.Unit, material.PurchaseUnit, plan.Cost));
            }
            else
            {
                material = plan.Existing;
                var changes = Apply(material, plan, category);
                if (changes.Count == 0)
                    unchanged++;
                else
                    updated.Add(new UpdatedSheetItem(row.Row, material.Id, material.Name, changes));
            }

            byName[PurchaseCategory.Normalize(material.Name)] = material;
            if (material.Code is { } code)
                byCode[CodeKey(code)] = [material];
            namesOnSheet[PurchaseCategory.Normalize(material.Name)] = row.Row;
            if (plan.Code is { } written)
                codesOnSheet[CodeKey(written)] = row.Row;
            materialsOnSheet[material.Id] = row.Row;
        }

        if (created.Count > 0 || updated.Count > 0)
            await unitOfWork.SaveChangesAsync(cancellationToken);
        return new RawMaterialImportResult(created, updated, unchanged, skipped, added);
    }

    // A row's cells read and checked against the materials and the rows above it.
    private static (Plan? Plan, Problem? Problem) Check(
        RawMaterialSheetRow row, string? name, Dictionary<string, RawMaterial> byName, Dictionary<string, List<RawMaterial>> byCode, HashSet<Guid> pending,
        Dictionary<string, PurchaseCategory> known, Dictionary<string, int> namesOnSheet, Dictionary<string, int> codesOnSheet,
        Dictionary<Guid, int> materialsOnSheet)
    {
        static (Plan?, Problem?) Skip(string reason, string reasonAr) => (null, new Problem(reason, reasonAr));

        if (name is null)
            return Skip("No material name.", "لا يوجد اسم للخامة.");
        if (name.Length > MaxNameLength)
            return Skip($"The name is longer than {MaxNameLength} characters.", $"الاسم أطول من {MaxNameLength} حرف.");
        var code = SheetText.Clean(row.Code);
        if (code?.Length > MaxCodeLength)
            return Skip($"The code is longer than {MaxCodeLength} characters.", $"الكود أطول من {MaxCodeLength} حرفًا.");
        if (code is not null && codesOnSheet.TryGetValue(CodeKey(code), out var codeRow))
            return Skip($"The code {code} is also on row {codeRow}, which is the one imported.", $"الكود {code} موجود أيضًا في الصف {codeRow}، وهو الذي استُورد.");
        if (namesOnSheet.TryGetValue(PurchaseCategory.Normalize(name), out var nameRow))
            return Skip($"Also on row {nameRow}, which is the one imported.", $"مكرر في الصف {nameRow}، وهو الذي استُورد.");

        // The material it is: its code's, else its name's; the two must be one.
        RawMaterial? byItsCode = null;
        if (code is not null && byCode.TryGetValue(CodeKey(code), out var coded))
        {
            if (coded.Count > 1)
                return Skip(
                    $"The code {code} is on more than one material ({string.Join(", ", coded.Select(m => m.Name))}): give each its own code on Raw materials first.",
                    $"الكود {code} مستخدم لأكثر من خامة: اجعل لكل خامة كودًا خاصًا بها أولًا.");
            byItsCode = coded[0];
        }
        var byItsName = byName.GetValueOrDefault(PurchaseCategory.Normalize(name));
        if (byItsCode is not null && byItsName is not null && byItsCode != byItsName)
            return Skip(
                $"The code {code} is {byItsCode.Name}'s, and {byItsName.Name} is another material: give the row one material's code and name.",
                $"الكود {code} خاص بـ {byItsCode.Name}، والاسم {byItsName.Name} لخامة أخرى: اجعل الكود والاسم لخامة واحدة.");
        var existing = byItsCode ?? byItsName;
        if (existing is not null)
        {
            if (existing.IsArchived)
                return Skip(
                    $"{existing.Name} was deleted: restore it from the deleted materials rather than import it again.",
                    $"{existing.Name} محذوفة: استرجعها من الخامات المحذوفة بدلًا من استيرادها.");
            if (existing.IsPrepItem)
                return Skip($"{existing.Name} is a prep item: change it under Recipes → Prep items.", $"{existing.Name} صنف مُصنَّع: عدّله من الوصفات ← المصنعات.");
            if (materialsOnSheet.TryGetValue(existing.Id, out var materialRow))
                return Skip($"{existing.Name} is also on row {materialRow}, which is the one imported.", $"{existing.Name} موجودة أيضًا في الصف {materialRow}، وهو الذي استُورد.");
            if (pending.Contains(existing.Id))
                return Skip(
                    $"{existing.Name} waits for a manager's approval: import it again once that is decided.",
                    $"{existing.Name} بانتظار موافقة المدير: استوردها مرة أخرى بعد البت فيها.");
        }

        // The unit: required for a new one; never another for one there already.
        var unitText = SheetText.Clean(row.Unit);
        var unit = SheetUnits.Parse(unitText);
        if (unitText is not null && unit is null)
            return Skip($"\"{unitText}\" is not a unit the system knows: Kg, Liter or Piece.", $"\"{unitText}\" ليست وحدة معروفة: كيلو أو لتر أو قطعة.");
        if (existing is null && unit is null)
            return Skip("No unit of measure: Kg, Liter or Piece.", "لا توجد وحدة قياس: كيلو أو لتر أو قطعة.");
        if (existing is not null && unit is { } other && other != existing.Unit)
            return Skip(
                $"{existing.Name} is counted by the {SheetUnits.Name(existing.Unit)}, not the {SheetUnits.Name(other)}: change its unit on Raw materials, which restates its stock and recipes.",
                $"{existing.Name} تُحسب بالـ{SheetUnits.NameAr(existing.Unit)} وليس بالـ{SheetUnits.NameAr(other)}: غيّر وحدتها من صفحة الخامات، فيُعاد حساب مخزونها ووصفاتها.");
        var counted = unit ?? existing!.Unit;

        if (Amount(row.Cost, "a cost", "تكلفة", out var cost) is { } costProblem)
            return (null, costProblem);
        if (cost < 0)
            return Skip("A cost cannot be negative.", "لا يمكن أن تكون التكلفة سالبة.");
        if (Amount(row.PurchaseUnitHolds, "how much the purchase unit holds", "سعة وحدة الشراء", out var holds) is { } holdsProblem)
            return (null, holdsProblem);
        if (holds <= 0)
            return Skip("A purchase unit holds more than nothing.", "يجب أن تكون سعة وحدة الشراء أكبر من صفر.");
        if (Amount(row.ReorderLevel, "a reorder level", "حد طلب", out var reorder) is { } reorderProblem)
            return (null, reorderProblem);
        if (reorder < 0)
            return Skip("A reorder level cannot be negative.", "لا يمكن أن يكون حد الطلب سالبًا.");
        if (Amount(row.YieldPercent?.TrimEnd('%', '٪', ' '), "a yield", "نسبة صافي", out var yield) is { } yieldProblem)
            return (null, yieldProblem);
        if (yield is not (null or (> 0m and <= 100m)))
            return Skip("The yield is more than 0% and at most 100%.", "نسبة الصافي أكبر من 0% وحتى 100%.");

        // The purchase unit: its name and what it holds go together for a new one, unless it is
        // the unit itself (a kg holds 1 kg).
        var purchaseUnit = SheetText.Clean(row.PurchaseUnit);
        if (purchaseUnit?.Length > MaxPurchaseUnitLength)
            return Skip($"The purchase unit's name is longer than {MaxPurchaseUnitLength} characters.", $"اسم وحدة الشراء أطول من {MaxPurchaseUnitLength} حرفًا.");
        if (existing is null && purchaseUnit is null && holds is not null)
            return Skip($"Name the purchase unit that holds {holds}.", $"اكتب اسم وحدة الشراء التي تحتوي {holds}.");
        if (existing is null && purchaseUnit is not null && holds is null)
        {
            if (!IsTheUnitItself(purchaseUnit, counted))
                return Skip(
                    $"Say how much a {purchaseUnit} holds, in {SheetUnits.Name(counted)}.",
                    $"اكتب كم تحتوي وحدة الشراء ({purchaseUnit}) بالـ{SheetUnits.NameAr(counted)}.");
            holds = 1;
        }

        // The category: a raw materials one, or a new name, which is added.
        var category = SheetText.Clean(row.Category);
        if (category?.Length > MaxCategoryLength)
            return Skip($"The category's name is longer than {MaxCategoryLength} characters.", $"اسم القسم أطول من {MaxCategoryLength} حرف.");
        if (category is not null && known.TryGetValue(PurchaseCategory.Normalize(category), out var filedUnder) && filedUnder.Kind != CategoryKind.RawMaterials)
            return Skip(
                $"{filedUnder.Name} is a general expenses category: give it a raw materials category.",
                $"{filedUnder.Name} قسم مصروفات عمومية: اختر قسمًا من أقسام الخامات.");

        return (new Plan(existing, name, code, counted, category, purchaseUnit, holds, cost, reorder, yield), null);
    }

    // A material there already, as its row says; what changed, by column. Its name and code as
    // they are written where only capitals or spacing differ: renamed only when found by its code
    // under another name.
    private static List<string> Apply(RawMaterial material, Plan plan, PurchaseCategory? category)
    {
        var changes = new List<string>();
        if (PurchaseCategory.Normalize(plan.Name) != PurchaseCategory.Normalize(material.Name))
        {
            material.Rename(plan.Name);
            changes.Add("Name");
        }
        if (plan.Code is not null && (material.Code is null || CodeKey(plan.Code) != CodeKey(material.Code)))
        {
            material.Describe(plan.Code, material.CategoryId);
            changes.Add("Code");
        }
        if (category is not null && category.Id != material.CategoryId)
        {
            material.MoveTo(category.Id);
            changes.Add("Category");
        }

        var factor = SheetUnits.Factor(material.Unit);
        var purchaseUnit = plan.PurchaseUnit ?? material.PurchaseUnit;
        var holds = plan.Holds ?? Math.Round(material.PurchaseUnitSize / factor, 3);
        if (purchaseUnit != material.PurchaseUnit || Math.Round(holds, 3) != Math.Round(material.PurchaseUnitSize / factor, 3))
        {
            material.SetPurchaseUnit(purchaseUnit, holds * factor);
            changes.Add("PurchaseUnit");
        }
        if (plan.Yield is { } yield && yield != material.DefaultYieldPercent)
        {
            material.SetDefaultYield(yield);
            changes.Add("Yield");
        }
        if (plan.ReorderLevel is { } reorder && Math.Round(reorder, 3) != Math.Round(material.ReorderLevel / material.PurchaseUnitSize, 3))
        {
            material.SetReorderLevel(reorder * material.PurchaseUnitSize);
            changes.Add("ReorderLevel");
        }
        // As the material's own screen does: an unchanged cost is left alone, so the average is
        // not reset to the rounded figure written out.
        if (plan.Cost is { } cost && (material.CostPerPurchaseUnit is not { } current || Math.Round(current, 4) != Math.Round(cost, 4)))
        {
            material.SetCost(cost);
            changes.Add("Cost");
        }

        return changes;
    }

    // A number cell: none when blank, a problem when it is not a number.
    private static Problem? Amount(string? text, string what, string whatAr, out decimal? amount)
    {
        amount = null;
        if (SheetText.Clean(text) is not { } written)
            return null;
        amount = SheetText.Amount(written);
        return amount is null
            ? new Problem($"\"{written}\" is not {what}: write a number, such as 85.50.", $"\"{written}\" ليست {whatAr}: اكتب رقمًا، مثل 85.50.")
            : null;
    }

    // A kg bought by the kg: the purchase unit is the unit itself, holding one.
    private static bool IsTheUnitItself(string purchaseUnit, UnitOfMeasure unit) =>
        SheetUnits.Parse(purchaseUnit) == unit
        || string.Equals(purchaseUnit, RawMaterial.DefaultPurchaseUnit(unit).Name, StringComparison.OrdinalIgnoreCase);

    private static string CodeKey(string code) => SheetText.Key(code);

    // The category of that name, English or Arabic; one added when there is none. General is the
    // default one, whatever it is called here, never a second of that name.
    private async Task<PurchaseCategory> CategoryAsync(
        string name, Dictionary<string, PurchaseCategory> known, List<string> added, CancellationToken cancellationToken)
    {
        if (known.TryGetValue(PurchaseCategory.Normalize(name), out var found))
            return found;
        if (PurchaseCategory.Normalize(name) == PurchaseCategory.Normalize(PurchaseCategory.GeneralName) || name == PurchaseCategory.GeneralNameAr)
            return known[PurchaseCategory.Normalize(name)] = await categories.ResolveAsync(null, CategoryKind.RawMaterials, null, cancellationToken);
        var category = new PurchaseCategory(Guid.NewGuid(), name);
        categories.Add(category);
        known[PurchaseCategory.Normalize(name)] = category;
        added.Add(category.Name);
        return category;
    }
}
```


> 📄 **`backend/src/Costing.Infrastructure/Excel/RawMaterialWorkbook.cs`** — 108 سطر

```csharp
using Costing.Application.RawMaterials;

namespace Costing.Infrastructure.Excel;

// The raw materials spreadsheet: the template to fill in, the list written out (the export, the
// same columns, so it imports back as it is: into this system after it is edited, or into
// another), and reading one back for the import (ImportRawMaterialsCommand, which decides what
// each row becomes). Plain data in and out, so it can be checked without a database.
//
// Columns are found by their heading, in English or Arabic, not by position: a sheet with its
// columns moved, headed in Arabic only, or the earlier template's four columns, still imports.
public static class RawMaterialWorkbook
{
    public const string FileName = "raw-materials-template.xlsx";
    public const string ExportFileName = "raw-materials.xlsx";
    public const string ContentType = SheetBook.ContentType;
    public const string DataSheetName = "Raw Materials";

    public const string CodeHeader = "Code · الكود";
    public const string NameHeader = "Material Name · اسم الخامة";
    public const string CategoryHeader = "Category · القسم";
    public const string UnitHeader = "Unit of Measure · وحدة القياس";
    public const string PurchaseUnitHeader = "Purchase Unit · وحدة الشراء";
    public const string HoldsHeader = "Purchase Unit Holds · سعة وحدة الشراء";
    public const string CostHeader = "Cost per Purchase Unit · تكلفة وحدة الشراء";
    public const string ReorderHeader = "Reorder Level · حد الطلب";
    public const string YieldHeader = "Yield % · نسبة الصافي";

    private static readonly Column[] Columns =
    [
        new("Code", CodeHeader, ["code", "material code", "sku", "الكود", "كود الخامة"],
            "Optional: how the reports name it, such as ING-001. A row with a code changes the material of that code."),
        new("Name", NameHeader, ["material name", "material", "name", "اسم الخامة", "الخامة", "الاسم"],
            "Required. A name already on the list changes that material; a new name adds one."),
        new("Category", CategoryHeader, ["category", "القسم", "الفئة"],
            "One on the list, or a new one, which is added. Blank: General for a new material, as it was for one there already."),
        new("Unit", UnitHeader, ["unit of measure", "unit", "uom", "وحدة القياس", "الوحدة"],
            "Kg, Liter or Piece: how it is counted. Required for a new material; one there already keeps its own."),
        new("PurchaseUnit", PurchaseUnitHeader, ["purchase unit", "bought in", "وحدة الشراء"],
            "Optional: what it is bought in, such as kg, carton or sack. Blank: the unit itself."),
        new("Holds", HoldsHeader, ["purchase unit holds", "holds", "pack size", "سعة وحدة الشراء", "العبوة"],
            "How many kg, litres or pieces one purchase unit holds: 1 for a kg, 30 for a carton of 30 eggs, 25 for a 25 kg sack."),
        new("Cost", CostHeader, ["cost per purchase unit", "initial cost", "cost", "تكلفة وحدة الشراء", "التكلفة المبدئية", "التكلفة"],
            "Optional: the price of one purchase unit. It replaces the average cost only when it differs; purchases move it from there.", "0.00##"),
        new("ReorderLevel", ReorderHeader, ["reorder level", "reorder at", "min stock", "حد الطلب", "حد إعادة الطلب"],
            "Optional: reorder when stock falls to this many purchase units."),
        new("Yield", YieldHeader, ["yield %", "yield", "default yield", "نسبة الصافي", "الصافي"],
            "Optional: what is left after trimming, 1 to 100. Blank: 100 for a new material."),
    ];

    private static readonly string[] Help =
    [
        "Fill in one material a row on the Raw Materials sheet, under the headings. · املأ خامة في كل صف في ورقة Raw Materials تحت العناوين.",
        "",
        "A row is the material of its code, else of its name: that material is changed as the row says. A new name adds a material.",
        "الصف يخص الخامة صاحبة الكود، وإلا صاحبة الاسم: فتُعدّل كما في الصف. والاسم الجديد يضيف خامة.",
        "A blank cell leaves that detail as it is. · الخلية الفارغة تترك البيان كما هو.",
        "",
        "Unit of Measure: Kg, Liter or Piece (كيلو، لتر، قطعة). A material on the list keeps the unit it is counted in.",
        "Purchase Unit and its Holds: what it is bought in and how many kg, litres or pieces that is, such as carton and 30.",
        "Cost per Purchase Unit: the price to start from. Purchases move the average cost from there.",
        "Stock on hand is not on the sheet: it comes in by purchases and stock counts. · الرصيد لا يُستورد: يأتي من المشتريات والجرد.",
        "",
        "Exported from Raw materials, the sheet is the list as it is: edit it and import it back, or import it into another installation.",
    ];

    private static readonly object[][] Examples =
    [
        ["ING-001", "Chicken breast", "Poultry", "Kg", "kg", 1, 185, 5, 85],
        ["ING-002", "Full-cream milk", "Dairy", "Liter", "carton", 12, 504, 2, ""],
        ["", "Eggs", "Dairy", "Piece", "tray", 30, 127.5, 4, 98],
        ["", "بقدونس", "Vegetables", "Kg", "", "", "", "", ""],
    ];

    // The template: the columns, with dropdowns for the category (the restaurant's own, a new name
    // allowed) and the unit. No rows on the sheet itself: examples there would be imported.
    public static Stream Build(IReadOnlyList<string> categories) => Build(categories, []);

    // The materials written out, under the template's columns.
    public static Stream Build(IReadOnlyList<string> categories, IReadOnlyList<RawMaterialSheetLine> lines) =>
        SheetBook.Build(DataSheetName, Columns, Help, Examples,
            lines.Select(l => new object?[]
            {
                l.Code, l.Name, l.Category, l.Unit, l.PurchaseUnit, l.PurchaseUnitHolds, l.Cost, l.ReorderLevel, l.YieldPercent,
            }).ToList(),
            new Dictionary<string, SheetList>
            {
                ["Category"] = new(categories, true, "A new category", "Not on the list yet: it is added on import. · قسم جديد يُضاف عند الاستيراد."),
                ["Unit"] = new(SheetUnits.Names, false, "Kg, Liter or Piece", "Write Kg, Liter or Piece (كيلو، لتر، قطعة)."),
            });

    // The rows of a filled-in sheet. Blank rows are left out.
    public static IReadOnlyList<RawMaterialSheetRow> Read(Stream stream) =>
        SheetBook.Read(stream, Columns, "Name", "Material Name")
            .Select(r => new RawMaterialSheetRow(
                r.Row,
                r.Text("Name"),
                r.Text("Category"),
                r.Text("Unit"),
                r.Text("Cost"),
                r.Text("Code"),
                r.Text("PurchaseUnit"),
                r.Text("Holds"),
                r.Text("ReorderLevel"),
                // 85% typed into a cell is 0.85 kept as a percentage: read as it shows.
                r.Shown("Yield") is { } shown && shown.EndsWith('%') ? shown : r.Text("Yield")))
            .ToList();
}
```


> 📄 **`backend/src/Costing.Application/Expenses/ExpenseItemSheet.cs`** — 188 سطر

```csharp
using MediatR;
using Costing.Domain.Common;
using Costing.Application.Categories;
using Costing.Application.Common;
using Costing.Application.RawMaterials;
using Costing.Domain.Categories;
using Costing.Domain.Expenses;

namespace Costing.Application.Expenses;

// Expense items to and from a spreadsheet, as the raw materials are (RawMaterialSheet): the list
// written out, and a sheet read back in, the template's, an export edited, or one exported from
// another installation. A row is the expense item of its name (capitals and spacing aside),
// changed as the row says; a row naming none is a new one. A blank cell leaves that detail as it
// is. A bad row is skipped and said why, in English and Arabic; a category not on the list yet is
// added as a general expenses one.

public sealed record ExpenseItemSheetRow(int Row, string? Name, string? NameAr, string? Category, string? Unit);

public sealed record ExpenseItemSheetLine(string Name, string? NameAr, string Category, string? Unit);

// What the sheet is written from: the expense items, and the general expenses categories for its
// dropdown.
public sealed record ExpenseItemSheet(IReadOnlyList<ExpenseItemSheetLine> Lines, IReadOnlyList<string> Categories);

public sealed record ImportedExpenseItem(int Row, Guid Id, string Name, string Category);

public sealed record ExpenseItemImportResult(
    IReadOnlyList<ImportedExpenseItem> Created,
    IReadOnlyList<UpdatedSheetItem> Updated,
    int Unchanged,
    IReadOnlyList<SkippedSheetRow> Skipped,
    IReadOnlyList<string> CategoriesAdded);

public sealed record ImportExpenseItemsCommand(IReadOnlyList<ExpenseItemSheetRow> Rows) : IRequest<ExpenseItemImportResult>;

public sealed record GetExpenseItemSheetQuery : IRequest<ExpenseItemSheet>;

internal sealed class GetExpenseItemSheetHandler(IExpenseItemRepository items, IPurchaseCategoryRepository categories)
    : IRequestHandler<GetExpenseItemSheetQuery, ExpenseItemSheet>
{
    public async Task<ExpenseItemSheet> Handle(GetExpenseItemSheetQuery request, CancellationToken cancellationToken)
    {
        var all = await categories.GetAllAsync(cancellationToken);
        var byId = all.ToDictionary(c => c.Id);
        var lines = (await items.GetAllAsync(cancellationToken))
            .Where(i => !i.IsArchived)
            .Select(i => new ExpenseItemSheetLine(i.Name, i.NameAr, byId.GetValueOrDefault(i.CategoryId)?.Name ?? PurchaseCategory.GeneralExpensesName, i.Unit))
            .OrderBy(l => l.Category, StringComparer.CurrentCultureIgnoreCase)
            .ThenBy(l => l.Name, StringComparer.CurrentCultureIgnoreCase)
            .ToList();
        var names = all.Where(c => c.Kind == CategoryKind.Expenses).Select(c => c.Name).OrderBy(n => n, StringComparer.CurrentCultureIgnoreCase).ToList();
        return new ExpenseItemSheet(lines, names);
    }
}

internal sealed class ImportExpenseItemsHandler(IExpenseItemRepository items, IPurchaseCategoryRepository categories, IUnitOfWork unitOfWork)
    : IRequestHandler<ImportExpenseItemsCommand, ExpenseItemImportResult>
{
    public const int MaxRows = 2000;
    private const int MaxNameLength = 200;
    private const int MaxUnitLength = 32;
    private const int MaxCategoryLength = 100;

    public async Task<ExpenseItemImportResult> Handle(ImportExpenseItemsCommand request, CancellationToken cancellationToken)
    {
        if (request.Rows.Count == 0)
            throw new DomainException("The sheet has no expense items on it: fill in a row under the headings. · لا توجد مصروفات في الملف: املأ صفًا تحت العناوين.");
        if (request.Rows.Count > MaxRows)
            throw new DomainException($"Import at most {MaxRows:N0} expense items at a time: split the sheet. · استورد {MaxRows:N0} بندًا على الأكثر في المرة: قسّم الملف.");

        var byName = new Dictionary<string, ExpenseItem>();
        foreach (var item in await items.GetAllAsync(cancellationToken))
            byName.TryAdd(item.NormalizedName, item);
        var known = new Dictionary<string, PurchaseCategory>();
        foreach (var category in await categories.GetAllAsync(cancellationToken))
        {
            known.TryAdd(PurchaseCategory.Normalize(category.Name), category);
            if (category.NameAr is { } ar)
                known.TryAdd(PurchaseCategory.Normalize(ar), category);
        }

        var created = new List<ImportedExpenseItem>();
        var updated = new List<UpdatedSheetItem>();
        var unchanged = 0;
        var skipped = new List<SkippedSheetRow>();
        var added = new List<string>();
        var onSheet = new Dictionary<string, int>();
        foreach (var row in request.Rows.OrderBy(r => r.Row))
        {
            var name = SheetText.Clean(row.Name);
            var nameAr = SheetText.Clean(row.NameAr);
            var unit = SheetText.Clean(row.Unit);
            var categoryName = SheetText.Clean(row.Category);
            void Skip(string reason, string reasonAr) => skipped.Add(new SkippedSheetRow(row.Row, name, reason, reasonAr));

            if (name is null)
            {
                Skip("No expense name.", "لا يوجد اسم للمصروف.");
                continue;
            }
            if (name.Length > MaxNameLength || nameAr?.Length > MaxNameLength)
            {
                Skip($"The name is longer than {MaxNameLength} characters.", $"الاسم أطول من {MaxNameLength} حرف.");
                continue;
            }
            if (unit?.Length > MaxUnitLength)
            {
                Skip($"The unit is longer than {MaxUnitLength} characters.", $"الوحدة أطول من {MaxUnitLength} حرفًا.");
                continue;
            }
            var key = ExpenseItem.Normalize(name);
            if (onSheet.TryGetValue(key, out var first))
            {
                Skip($"Also on row {first}, which is the one imported.", $"مكرر في الصف {first}، وهو الذي استُورد.");
                continue;
            }
            var existing = byName.GetValueOrDefault(key);
            if (existing is { IsArchived: true })
            {
                Skip(
                    $"{existing.Name} is archived: restore it on Expense items rather than import it again.",
                    $"{existing.Name} مؤرشف: استرجعه من صفحة المصروفات العمومية بدلًا من استيراده.");
                continue;
            }
            if (categoryName?.Length > MaxCategoryLength)
            {
                Skip($"The category's name is longer than {MaxCategoryLength} characters.", $"اسم القسم أطول من {MaxCategoryLength} حرف.");
                continue;
            }
            if (categoryName is not null && known.TryGetValue(PurchaseCategory.Normalize(categoryName), out var filedUnder) && filedUnder.Kind != CategoryKind.Expenses)
            {
                Skip(
                    $"{filedUnder.Name} is a raw materials category: give it a general expenses category.",
                    $"{filedUnder.Name} قسم خامات: اختر قسمًا من أقسام المصروفات العمومية.");
                continue;
            }

            var category = categoryName is null ? null : await CategoryAsync(categoryName, known, added, cancellationToken);
            onSheet[key] = row.Row;
            if (existing is null)
            {
                category ??= await categories.ResolveAsync(null, CategoryKind.Expenses, null, cancellationToken);
                var item = new ExpenseItem(Guid.NewGuid(), name, category.Id, nameAr, unit);
                items.Add(item);
                byName[key] = item;
                created.Add(new ImportedExpenseItem(row.Row, item.Id, item.Name, category.Name));
                continue;
            }

            // Found by its name: kept as it is written, whatever the row's capitals.
            var changes = new List<string>();
            if (nameAr is not null && nameAr != existing.NameAr)
                changes.Add("NameAr");
            if (unit is not null && unit != existing.Unit)
                changes.Add("Unit");
            if (category is not null && category.Id != existing.CategoryId)
                changes.Add("Category");
            if (changes.Count == 0)
            {
                unchanged++;
                continue;
            }
            existing.Update(existing.Name, category?.Id ?? existing.CategoryId, nameAr ?? existing.NameAr, unit ?? existing.Unit);
            updated.Add(new UpdatedSheetItem(row.Row, existing.Id, existing.Name, changes));
        }

        if (created.Count > 0 || updated.Count > 0)
            await unitOfWork.SaveChangesAsync(cancellationToken);
        return new ExpenseItemImportResult(created, updated, unchanged, skipped, added);
    }

    // The category of that name, English or Arabic; a general expenses one added when there is
    // none. General expenses is the default one, whatever it is called here, never a second.
    private async Task<PurchaseCategory> CategoryAsync(
        string name, Dictionary<string, PurchaseCategory> known, List<string> added, CancellationToken cancellationToken)
    {
        if (known.TryGetValue(PurchaseCategory.Normalize(name), out var found))
            return found;
        if (PurchaseCategory.Normalize(name) == PurchaseCategory.Normalize(PurchaseCategory.GeneralExpensesName) || name == PurchaseCategory.GeneralExpensesNameAr)
            return known[PurchaseCategory.Normalize(name)] = await categories.ResolveAsync(null, CategoryKind.Expenses, null, cancellationToken);
        var category = new PurchaseCategory(Guid.NewGuid(), name, kind: CategoryKind.Expenses);
        categories.Add(category);
        known[PurchaseCategory.Normalize(name)] = category;
        added.Add(category.Name);
        return category;
    }
}
```


> 📄 **`backend/src/Costing.Infrastructure/Excel/ExpenseItemWorkbook.cs`** — 60 سطر

```csharp
using Costing.Application.Expenses;

namespace Costing.Infrastructure.Excel;

// The expense items spreadsheet, as the raw materials' is: the template to fill in, the list
// written out under the same columns, and reading one back for the import
// (ImportExpenseItemsCommand). Columns are found by their heading, in English or Arabic.
public static class ExpenseItemWorkbook
{
    public const string FileName = "expense-items-template.xlsx";
    public const string ExportFileName = "expense-items.xlsx";
    public const string ContentType = SheetBook.ContentType;
    public const string DataSheetName = "Expense Items";

    public const string NameHeader = "Expense Name · اسم المصروف";
    public const string NameArHeader = "Arabic Name · الاسم بالعربي";
    public const string CategoryHeader = "Category · القسم";
    public const string UnitHeader = "Unit · الوحدة";

    private static readonly Column[] Columns =
    [
        new("Name", NameHeader, ["expense name", "expense item", "expense", "item", "name", "اسم المصروف", "المصروف", "البند", "الاسم"],
            "Required. A name already on the list changes that expense item; a new name adds one."),
        new("NameAr", NameArHeader, ["arabic name", "name ar", "الاسم بالعربي", "الاسم العربي"], "Optional."),
        new("Category", CategoryHeader, ["category", "القسم", "الفئة"],
            "A general expenses category on the list, or a new one, which is added. Blank: General expenses for a new item."),
        new("Unit", UnitHeader, ["unit", "counted in", "الوحدة"], "Optional: what a line of it is counted in, such as bottle, visit or month."),
    ];

    private static readonly string[] Help =
    [
        "Fill in one expense item a row on the Expense Items sheet, under the headings. · املأ بندًا في كل صف تحت العناوين.",
        "",
        "A name already on the list changes that expense item; a new name adds one. A blank cell leaves that detail as it is.",
        "الاسم الموجود يعدّل البند، والاسم الجديد يضيف بندًا. الخلية الفارغة تترك البيان كما هو.",
        "What they cost is on the purchase invoices, never here. · التكلفة تُسجل في فواتير الشراء.",
    ];

    private static readonly object[][] Examples =
    [
        ["Electricity", "الكهرباء", "Utilities", "month"],
        ["Cleaning spray", "منظف", "Cleaning", "bottle"],
        ["AC maintenance", "صيانة التكييف", "Repairs", "visit"],
    ];

    public static Stream Build(IReadOnlyList<string> categories) => Build(categories, []);

    public static Stream Build(IReadOnlyList<string> categories, IReadOnlyList<ExpenseItemSheetLine> lines) =>
        SheetBook.Build(DataSheetName, Columns, Help, Examples,
            lines.Select(l => new object?[] { l.Name, l.NameAr, l.Category, l.Unit }).ToList(),
            new Dictionary<string, SheetList>
            {
                ["Category"] = new(categories, true, "A new category", "Not on the list yet: it is added on import. · قسم جديد يُضاف عند الاستيراد."),
            });

    public static IReadOnlyList<ExpenseItemSheetRow> Read(Stream stream) =>
        SheetBook.Read(stream, Columns, "Name", "Expense Name")
            .Select(r => new ExpenseItemSheetRow(r.Row, r.Text("Name"), r.Text("NameAr"), r.Text("Category"), r.Text("Unit")))
            .ToList();
}
```


### 1.4 شيت الوصفات الذكي: القوائم المنسدلة المخفية

**المشكلة:** المستخدم يكتب "دقيق" والنظام فيه "Flour"، أو يكتب الكمية بالكيلو والنظام بالجرام. الحل:

- **صف لكل مكوّن**، واسم الوصفة على أول صفوفها (الاسم الفارغ = الصف الذي فوقه).
- **عمود المكوّن قائمة منسدلة صارمة** مصدرها شيت مخفي `Ingredients` فيه **تسمية** كل خامة ومصنّع **مع وحدة كتابة الكمية**: `"Flour (Kg)"`، `"Pizza dough · مصنّع (Kg)"`. فالمستخدم لا يخطئ في الاسم ولا الوحدة.
- **الكمية تُكتب بالكيلو/اللتر/القطعة** وتُحوّل للوحدة الأساسية (`SheetNumbers`, `IngredientLookup`).
- **عمود الوصفة** يقبل أكواد المنيو (`"6101-2 · Margherita (Large)"`, `"A3 · …"`) أو اسم وصفة خارج المنيو.
- **كل وصفة تُستبدل كاملة أو لا شيء**، ويُحتفظ بالـ Yield.
- النتيجة **مسعّرة** فورًا (`CostedSheetItem`) بأسعار اليوم.
- المصنعات: استيراد المدير يحفظها؛ استيراد غيره يصبح طلبات موافقة. والمصنعات الجديدة في نفس الشيت **مرتبة حسب الاعتماد** (مصنّع يدخل في آخر يُنشأ قبله).

> 📄 **`backend/src/Costing.Application/Recipes/IngredientSheet.cs`** — 171 سطر

```csharp
using System.Globalization;
using System.Text.RegularExpressions;
using Costing.Application.Common;
using Costing.Application.RawMaterials;
using Costing.Domain.RawMaterials;

namespace Costing.Application.Recipes;

// An ingredient as a recipes or prep items sheet offers it, in its dropdown: by its label, which
// says the unit its quantity is written in, "Flour (Kg)", and "Pizza dough · مصنّع (Kg)" for a
// prep item. The quantity is in kg, litres or pieces, never grams: 0.2 for 200 g.
public sealed record SheetIngredient(string Label, string Name, string? Code, bool IsPrepItem, string Unit, string UnitAr);

// What a recipe or a prep item costs now, by its ingredients at their average costs: its whole
// recipe or batch, and one portion or one kg, litre or piece of it ("portion", "Kg"). An
// ingredient with no price yet is named, and leaves the cost short of it. Notes: what to check,
// such as a quantity that reads as grams written as kilos.
public sealed record CostedSheetItem(
    int Row, string Name, int Ingredients, decimal? Cost, decimal? CostPer, string Per, IReadOnlyList<string> MissingPrices,
    IReadOnlyList<string> Notes, bool Requested = false);

// One line read: the material it names, in its own unit, or why not.
internal sealed record SheetLine(int Row, RawMaterial? Material, decimal Quantity, string? Reason, string? ReasonAr);

// The materials and prep items a sheet's ingredient cells are read against: by their label as the
// dropdown writes it, by name, or by code, the unit in brackets checked against the material's.
internal sealed partial class IngredientLookup
{
    public const string PrepMark = "مصنّع";

    private readonly Dictionary<string, RawMaterial> _byLabel = [];
    private readonly Dictionary<string, List<RawMaterial>> _byName = [];
    private readonly Dictionary<string, RawMaterial> _byCode = [];
    private readonly Dictionary<string, RawMaterial> _deleted = [];
    private readonly Dictionary<Guid, string> _labels = [];

    public IngredientLookup(IEnumerable<RawMaterial> materials)
    {
        var all = materials.ToList();
        var live = all.Where(m => !m.IsArchived)
            .OrderBy(m => m.IsPrepItem)
            .ThenBy(m => m.Name, StringComparer.CurrentCultureIgnoreCase)
            .ToList();
        var named = live.GroupBy(m => SheetText.Key(m.Name)).ToDictionary(g => g.Key, g => g.Count());
        var offered = new List<SheetIngredient>();
        foreach (var material in live)
        {
            // Two of one name are told apart by their codes, or else by a number.
            var label = Label(material, named[SheetText.Key(material.Name)] > 1 ? material.Code : null);
            for (var n = 2; _byLabel.ContainsKey(SheetText.Key(label)); n++)
                label = Label(material, $"{material.Code ?? ""}#{n}".TrimStart('#'));
            _byLabel[SheetText.Key(label)] = material;
            _labels[material.Id] = label;
            if (!_byName.TryGetValue(SheetText.Key(material.Name), out var same))
                _byName[SheetText.Key(material.Name)] = same = [];
            same.Add(material);
            if (material.Code is { } code)
                _byCode.TryAdd(SheetText.Key(code), material);
            offered.Add(new SheetIngredient(label, material.Name, material.Code, material.IsPrepItem, SheetUnits.Name(material.Unit), SheetUnits.NameAr(material.Unit)));
        }

        foreach (var material in all.Where(m => m.IsArchived))
            _deleted.TryAdd(SheetText.Key(material.Name), material);
        Offered = offered;
    }

    // In the dropdown's order: the bought materials, then the prep items, each by name.
    public IReadOnlyList<SheetIngredient> Offered { get; }

    public static string Label(RawMaterial material, string? tellApart = null) =>
        $"{material.Name}{(tellApart is null ? "" : $" [{tellApart}]")}{(material.IsPrepItem ? $" · {PrepMark}" : "")} ({SheetUnits.Name(material.Unit)})";

    // As the sheet writes it; one deleted since keeps its plain label.
    public string LabelOf(RawMaterial material) => _labels.GetValueOrDefault(material.Id) ?? Label(material);

    // The material a cell names, and the quantity written beside it in its own unit: a kg of a
    // material counted in grams is 1000 of them.
    public SheetLine Read(int row, string? ingredient, string? quantity)
    {
        var text = SheetText.Clean(ingredient);
        if (text is null)
            return new SheetLine(row, null, 0, "No ingredient: choose it from the list.", "لا يوجد مكوّن: اختره من القائمة.");
        var (material, reason, reasonAr) = Find(text);
        if (material is null)
            return new SheetLine(row, null, 0, reason, reasonAr);

        var written = SheetText.Clean(quantity);
        var unit = SheetUnits.Name(material.Unit);
        var unitAr = SheetUnits.NameAr(material.Unit);
        if (written is null)
            return new SheetLine(row, material, 0, $"No quantity of {material.Name}: write it in {unit}.", $"لا توجد كمية لـ {material.Name}: اكتبها بالـ{unitAr}.");
        if (SheetText.Amount(written) is not { } amount)
            return new SheetLine(row, material, 0, $"\"{written}\" is not a quantity: write a number of {unit}, such as 0.25.",
                $"\"{written}\" ليست كمية: اكتب رقمًا بالـ{unitAr}، مثل 0.25.");
        if (amount <= 0)
            return new SheetLine(row, material, 0, $"The quantity of {material.Name} is more than nothing.", $"كمية {material.Name} يجب أن تكون أكبر من صفر.");
        return new SheetLine(row, material, amount * SheetUnits.Factor(material.Unit), null, null);
    }

    // By its label, its code in brackets or on its own, or its name; then the unit in brackets
    // checked: a quantity is never written in grams here, nor in another unit than its own.
    private (RawMaterial? Material, string? Reason, string? ReasonAr) Find(string text)
    {
        if (_byLabel.TryGetValue(SheetText.Key(text), out var labelled))
            return (labelled, null, null);

        var name = text;
        string? unitText = null;
        if (Bracketed().Match(name) is { Success: true } unitMatch && (SheetUnits.Parse(unitMatch.Groups["unit"].Value) is not null || IsSmallUnit(unitMatch.Groups["unit"].Value)))
        {
            unitText = unitMatch.Groups["unit"].Value.Trim();
            name = unitMatch.Groups["name"].Value.Trim();
        }
        name = PrepSuffix().Replace(name, "").Trim();
        string? code = null;
        if (Coded().Match(name) is { Success: true } codeMatch)
        {
            code = codeMatch.Groups["code"].Value.Trim();
            name = codeMatch.Groups["name"].Value.Trim();
        }

        RawMaterial? found = null;
        if (code is not null)
            found = _byCode.GetValueOrDefault(SheetText.Key(code));
        found ??= _byCode.GetValueOrDefault(SheetText.Key(name));
        if (found is null && _byName.TryGetValue(SheetText.Key(name), out var named))
        {
            if (named.Count > 1)
                return (null, $"More than one material is called {name}: choose the one you mean from the list.",
                    $"يوجد أكثر من خامة باسم {name}: اختر المقصودة من القائمة.");
            found = named[0];
        }

        if (found is null)
            return _deleted.TryGetValue(SheetText.Key(name), out var deleted)
                ? (null, $"{deleted.Name} has been deleted from the raw materials: choose another.", $"{deleted.Name} محذوفة من الخامات: اختر غيرها.")
                : (null, $"\"{name}\" is not a raw material or a prep item: choose it from the list, or add it on Raw materials first.",
                    $"\"{name}\" ليست خامة ولا صنفًا مُصنَّعًا: اخترها من القائمة، أو أضفها في الخامات أولًا.");

        if (unitText is not null && (IsSmallUnit(unitText) || SheetUnits.Parse(unitText) != found.Unit))
            return (null,
                $"{found.Name} is written in {SheetUnits.Name(found.Unit)} on this sheet, not in {unitText}: choose it from the list and write 0.2 for 200 g.",
                $"{found.Name} تُكتب بالـ{SheetUnits.NameAr(found.Unit)} في هذا الملف وليس بـ{unitText}: اخترها من القائمة واكتب 0.2 لـ 200 جرام.");
        return (found, null, null);
    }

    // Grams and millilitres: the sheet writes kilos and litres.
    private static bool IsSmallUnit(string text) =>
        SheetText.Key(text).TrimEnd('.') is "G" or "GM" or "GR" or "GRAM" or "GRAMS" or "ML" or "جرام" or "جم" or "غرام" or "جرامات" or "مل" or "ملي" or "ملليلتر";

    [GeneratedRegex(@"^(?<name>.+?)\s*\((?<unit>[^()]+)\)\s*$")]
    private static partial Regex Bracketed();

    [GeneratedRegex(@"\s*·\s*(مصنّع|مصنع|prep)\s*$", RegexOptions.IgnoreCase)]
    private static partial Regex PrepSuffix();

    [GeneratedRegex(@"^(?<name>.+?)\s*\[(?<code>[^\[\]]+)\]\s*$")]
    private static partial Regex Coded();
}

internal static class SheetNumbers
{
    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

    // A quantity in the sheet's unit, as written out: 150 g is 0.15.
    public static decimal InSheetUnit(decimal quantity, UnitOfMeasure unit) => Math.Round(quantity / SheetUnits.Factor(unit), 6);

    public static string Plain(decimal value) => value.ToString("0.######", Invariant);

    public static decimal Money(decimal value) => Math.Round(value, 2, MidpointRounding.AwayFromZero);
}
```


> 📄 **`backend/src/Costing.Application/Recipes/RecipeSheet.cs`** — 416 سطر

```csharp
using System.Text.RegularExpressions;
using MediatR;
using Costing.Domain.Common;
using Costing.Application.Common;
using Costing.Application.RawMaterials;
using Costing.Domain.Approvals;
using Costing.Domain.Menu;
using Costing.Domain.Production;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;

namespace Costing.Application.Recipes;

// Recipes to and from a spreadsheet: every recipe written out a row per ingredient (the export,
// GetRecipeSheetQuery), and a sheet read back in (ImportRecipesCommand), the template's, an export
// edited, or one from another installation.
//
// A recipe is named on each of its rows (a blank name is the row above's): a menu item, a size of
// it or an add-on by its code as the dropdown writes it ("6101 · Margherita", "6101-2 · Margherita
// (Large)", "A3 · Extra cheese"), or by its name; else a recipe off the menu by its name, a new one
// for a name not used yet. Each ingredient is chosen from the materials and prep items, its
// quantity written in its own unit as its label says (Kg, Liter, Piece): 0.2 for 200 g.
//
// A recipe's rows replace its whole ingredient list; its portions and category, written on any of
// its rows, change only when given. A recipe with a row that cannot be read is left as it was,
// whole, and each such row said why in English and Arabic: never half its ingredients. Nothing on
// the sheet is a cost: what each recipe costs is worked out from its ingredients' prices now.

public sealed record RecipeSheetRow(int Row, string? Item, string? Ingredient, string? Quantity, string? Portions = null, string? Category = null);

// One row written out: the recipe as the sheet names it, an ingredient by its label, the quantity
// in that ingredient's unit; the portions and category on a recipe's first row.
public sealed record RecipeSheetLine(string Item, string Ingredient, decimal Quantity, int? Portions, string? Category);

// What the sheet is written from: its rows, and its dropdowns' lists (the recipes and menu items,
// the ingredients with their units, the kitchen's recipe categories).
public sealed record RecipeSheet(
    IReadOnlyList<RecipeSheetLine> Lines, IReadOnlyList<string> Items, IReadOnlyList<SheetIngredient> Ingredients, IReadOnlyList<string> Categories);

public sealed record ImportedSheetItem(int Row, Guid Id, string Name);

public sealed record RecipeImportResult(
    IReadOnlyList<ImportedSheetItem> Created,
    IReadOnlyList<UpdatedSheetItem> Updated,
    int Unchanged,
    IReadOnlyList<SkippedSheetRow> Skipped,
    IReadOnlyList<string> CategoriesAdded,
    IReadOnlyList<CostedSheetItem> Costed,
    int Requested = 0);

public sealed record GetRecipeSheetQuery : IRequest<RecipeSheet>;

public sealed record ImportRecipesCommand(IReadOnlyList<RecipeSheetRow> Rows) : IRequest<RecipeImportResult>;

// The menu's items, sizes and add-ons as a recipes sheet names them: by code and name, "6101 ·
// Margherita", or by name alone, in English or Arabic.
internal sealed partial class MenuTargets
{
    private readonly Dictionary<RecipeTarget, string> _labels = [];
    private readonly Dictionary<string, List<RecipeTarget>> _byName = [];
    private readonly HashSet<RecipeTarget> _live = [];

    public MenuTargets(IReadOnlyList<MenuItem> items, IReadOnlyList<AddOn> addOns)
    {
        foreach (var item in items.Where(i => !i.IsDeleted).OrderBy(i => i.Id))
        {
            Add(RecipeTarget.ForMenuItem(item.Id), $"{item.Id} · {item.Name}", item.Name, item.NameAr);
            foreach (var variant in item.Variants.OrderBy(v => v.DisplayOrder))
                Add(RecipeTarget.ForVariant(item.Id, variant.Id), $"{item.Id}-{variant.Id} · {item.Name} ({variant.Name})", $"{item.Name} ({variant.Name})",
                    item.NameAr is null ? null : $"{item.NameAr} ({variant.NameAr ?? variant.Name})");
        }
        foreach (var addOn in addOns.Where(a => !a.IsDeleted).OrderBy(a => a.Id))
            Add(RecipeTarget.ForAddOn(addOn.Id), $"A{addOn.Id} · {addOn.Name}", addOn.Name, addOn.NameAr);
    }

    public IReadOnlyCollection<string> Labels => _labels.Values;

    public string? LabelOf(RecipeTarget target) => _labels.GetValueOrDefault(target);

    // A menu target by its code, written as the dropdown does or alone; by its name else. Found:
    // the target; a code not on the menu or a name two share: why not; neither: no target.
    public (RecipeTarget? Target, string? Reason, string? ReasonAr) Find(string text)
    {
        if (Code().Match(text) is { Success: true } coded)
        {
            var code = coded.Groups["code"].Value;
            var target = code.StartsWith('A') || code.StartsWith('a')
                ? RecipeTarget.ForAddOn(int.Parse(code[1..]))
                : coded.Groups["variant"].Success
                    ? RecipeTarget.ForVariant(int.Parse(coded.Groups["item"].Value), int.Parse(coded.Groups["variant"].Value))
                    : RecipeTarget.ForMenuItem(int.Parse(coded.Groups["item"].Value));
            return _live.Contains(target)
                ? (target, null, null)
                : (null, $"{code.ToUpperInvariant()} is not on the menu: choose the item from the list, or add it on Menu first.",
                    $"{code.ToUpperInvariant()} ليس في المنيو: اختر الصنف من القائمة، أو أضفه في المنيو أولًا.");
        }

        if (_byName.TryGetValue(SheetText.Key(text), out var named))
            return named.Count == 1
                ? (named[0], null, null)
                : (null, $"More than one menu item is called {text}: choose the one you mean from the list, by its code.",
                    $"يوجد أكثر من صنف باسم {text}: اختر المقصود من القائمة بكوده.");
        return (null, null, null);
    }

    private void Add(RecipeTarget target, string label, string name, string? nameAr)
    {
        _labels[target] = label;
        _live.Add(target);
        foreach (var each in new[] { name, nameAr }.OfType<string>().Select(SheetText.Key).Distinct())
        {
            if (!_byName.TryGetValue(each, out var list))
                _byName[each] = list = [];
            list.Add(target);
        }
    }

    // 6101, 6101-2, A3, alone or before " · " and a name.
    [GeneratedRegex(@"^(?<code>(?<item>\d+)(-(?<variant>\d+))?|[Aa]\d+)(\s*·.*)?$")]
    private static partial Regex Code();
}

internal sealed class GetRecipeSheetHandler(
    IRecipeRepository recipes, IRecipeCategoryRepository categories, IRawMaterialRepository materials, IMenuRepository menu)
    : IRequestHandler<GetRecipeSheetQuery, RecipeSheet>
{
    public async Task<RecipeSheet> Handle(GetRecipeSheetQuery request, CancellationToken cancellationToken)
    {
        var all = await materials.GetAllAsync(cancellationToken);
        var byId = all.ToDictionary(m => m.Id);
        var lookup = new IngredientLookup(all);
        var targets = new MenuTargets(await menu.GetItemsAsync(cancellationToken), await menu.GetAddOnsAsync(cancellationToken));
        var kitchen = (await categories.GetAllAsync(cancellationToken)).OrderBy(c => c.Name, StringComparer.CurrentCultureIgnoreCase).ToList();
        var categoryNames = kitchen.ToDictionary(c => c.Id, c => c.Name);
        var active = (await recipes.GetAllAsync(cancellationToken)).Where(r => !r.IsDeleted).ToList();

        var lines = new List<RecipeSheetLine>();
        foreach (var (recipe, name) in active.Select(r => (r, Name: NameOf(r, targets))).OrderBy(x => x.Name, StringComparer.CurrentCultureIgnoreCase))
        {
            var first = true;
            foreach (var ingredient in recipe.Ingredients
                         .Where(i => byId.ContainsKey(i.RawMaterialId))
                         .OrderBy(i => byId[i.RawMaterialId].Name, StringComparer.CurrentCultureIgnoreCase))
            {
                var material = byId[ingredient.RawMaterialId];
                lines.Add(new RecipeSheetLine(
                    name, lookup.LabelOf(material), SheetNumbers.InSheetUnit(ingredient.Quantity, material.Unit),
                    first ? recipe.Portions : null,
                    first && recipe.RecipeCategoryId is { } category ? categoryNames.GetValueOrDefault(category) : null));
                first = false;
            }
        }

        var items = targets.Labels
            .Concat(active.Where(r => !r.IsLinked).Select(r => r.Name!))
            .Distinct()
            .OrderBy(n => n, StringComparer.CurrentCultureIgnoreCase)
            .ToList();
        return new RecipeSheet(lines, items, lookup.Offered, kitchen.Select(c => c.Name).ToList());
    }

    // As the sheet names it: its menu target's code and name, its own name off the menu. One
    // linked to an item no longer on the menu keeps its code, to be told so on import.
    internal static string NameOf(Recipe recipe, MenuTargets targets) =>
        recipe.Target is { } target
            ? targets.LabelOf(target) ?? $"{(target.Kind == RecipeTargetKind.AddOn ? $"A{target.CatalogItemId}" : target.VariantId is { } v ? $"{target.CatalogItemId}-{v}" : $"{target.CatalogItemId}")} · {recipe.Name ?? "not on the menu"}"
            : recipe.Name!;
}

internal sealed class ImportRecipesHandler(
    IRecipeRepository recipes,
    IRecipeCategoryRepository categories,
    IRawMaterialRepository materials,
    IPrepRecipeRepository prepRecipes,
    IMenuRepository menu,
    IApprovalRequestRepository approvals,
    IUnitOfWork unitOfWork)
    : IRequestHandler<ImportRecipesCommand, RecipeImportResult>
{
    public const int MaxRows = 5000;
    private const int MaxNameLength = 200;

    // A recipe's rows, by the name on its first.
    private sealed record Group(int Row, string Name, List<RecipeSheetRow> Rows);

    public async Task<RecipeImportResult> Handle(ImportRecipesCommand request, CancellationToken cancellationToken)
    {
        if (request.Rows.Count == 0)
            throw new DomainException("The sheet has no recipes on it: a recipe's name, an ingredient and its quantity on each row. · لا توجد وصفات في الملف.");
        if (request.Rows.Count > MaxRows)
            throw new DomainException($"Import at most {MaxRows:N0} rows at a time: split the sheet. · استورد {MaxRows:N0} صف على الأكثر في المرة.");

        var all = await materials.GetAllAsync(cancellationToken);
        var lookup = new IngredientLookup(all);
        var targets = new MenuTargets(await menu.GetItemsAsync(cancellationToken), await menu.GetAddOnsAsync(cancellationToken));
        var every = await recipes.GetAllAsync(cancellationToken);
        var byTarget = every.Where(r => !r.IsDeleted && r.Target is not null).ToDictionary(r => r.Target!.Value);
        var offMenu = every.Where(r => !r.IsLinked && r.Name is not null).GroupBy(r => SheetText.Key(r.Name!))
            .ToDictionary(g => g.Key, g => g.OrderBy(r => r.IsDeleted).First());
        var pending = (await approvals.GetPendingAsync(cancellationToken)).Select(r => r.RecordId).ToHashSet();
        var kitchen = new Dictionary<string, RecipeCategory>();
        foreach (var category in await categories.GetAllAsync(cancellationToken))
        {
            kitchen.TryAdd(RecipeCategory.Normalize(category.Name), category);
            if (category.NameAr is { } ar)
                kitchen.TryAdd(RecipeCategory.Normalize(ar), category);
        }

        var created = new List<ImportedSheetItem>();
        var updated = new List<UpdatedSheetItem>();
        var toCost = new List<(int Row, string Name, Recipe Recipe, List<string> Notes)>();
        var skipped = new List<SkippedSheetRow>();
        var added = new List<string>();
        var unchanged = 0;
        // Each recipe once: by what it is, the first group naming it.
        var seen = new Dictionary<string, int>();

        foreach (var group in Groups(request.Rows, skipped))
        {
            void Skip(string reason, string reasonAr) => skipped.Add(new SkippedSheetRow(group.Row, group.Name, reason, reasonAr));

            if (group.Name.Length > MaxNameLength)
            {
                Skip($"The name is longer than {MaxNameLength} characters.", $"الاسم أطول من {MaxNameLength} حرف.");
                continue;
            }

            // What it is: a menu target, a recipe off the menu, or a new one.
            var (target, targetReason, targetReasonAr) = targets.Find(group.Name);
            if (targetReason is not null)
            {
                Skip(targetReason, targetReasonAr!);
                continue;
            }

            Recipe? recipe;
            string identity;
            if (target is { } t)
            {
                recipe = byTarget.GetValueOrDefault(t);
                identity = $"T{t}";
            }
            else if (offMenu.TryGetValue(SheetText.Key(group.Name), out var own))
            {
                if (own.IsDeleted)
                {
                    Skip($"{own.Name} was deleted: restore it from the deleted recipes, or give the row another name.",
                        $"{own.Name} محذوفة: استرجعها من الوصفات المحذوفة، أو اكتب اسمًا آخر.");
                    continue;
                }
                recipe = own;
                identity = $"R{own.Id}";
            }
            else
            {
                recipe = null;
                identity = $"N{SheetText.Key(group.Name)}";
            }

            if (seen.TryGetValue(identity, out var firstRow))
            {
                Skip($"Also on row {firstRow}, which is the one imported.", $"مكرر في الصف {firstRow}، وهو الذي استُورد.");
                continue;
            }
            seen[identity] = group.Row;
            if (recipe is not null && pending.Contains(recipe.Id))
            {
                Skip($"{group.Name} waits for a manager's approval: import it again once that is decided.",
                    $"{group.Name} بانتظار موافقة المدير: استوردها مرة أخرى بعد البت فيها.");
                continue;
            }

            // Its portions and category, from any of its rows.
            var portionsText = group.Rows.Select(r => SheetText.Clean(r.Portions)).FirstOrDefault(p => p is not null);
            int? portions = null;
            if (portionsText is not null)
            {
                if (SheetText.Amount(portionsText) is not { } p || p < 1 || p != decimal.Truncate(p) || p > 10_000)
                {
                    Skip($"\"{portionsText}\" is not a number of portions: a whole number, 1 or more.", $"\"{portionsText}\" ليس عدد حصص: رقم صحيح 1 أو أكثر.");
                    continue;
                }
                portions = (int)p;
            }
            var categoryName = group.Rows.Select(r => SheetText.Clean(r.Category)).FirstOrDefault(c => c is not null);
            if (categoryName?.Length > 100)
            {
                Skip("The category's name is longer than 100 characters.", "اسم القسم أطول من 100 حرف.");
                continue;
            }

            // Its ingredients: every row read, or none of them taken.
            var lines = group.Rows.Where(r => SheetText.Clean(r.Ingredient) is not null || SheetText.Clean(r.Quantity) is not null)
                .Select(r => lookup.Read(r.Row, r.Ingredient, r.Quantity))
                .ToList();
            if (lines.Count == 0)
            {
                if (recipe is not null)
                    unchanged++;
                else
                    Skip("No ingredients under it: choose at least one, with its quantity.", "لا توجد مكونات: اختر مكوّنًا واحدًا على الأقل بكميته.");
                continue;
            }
            if (lines.Any(l => l.Reason is not null))
            {
                foreach (var bad in lines.Where(l => l.Reason is not null))
                    skipped.Add(new SkippedSheetRow(bad.Row, group.Name, $"{bad.Reason} The recipe is left as it was.", $"{bad.ReasonAr} لم تُغيَّر الوصفة."));
                continue;
            }

            // The same ingredient twice: its quantities added together, and said.
            var notes = new List<string>();
            var quantities = new Dictionary<Guid, decimal>();
            foreach (var line in lines)
            {
                if (quantities.ContainsKey(line.Material!.Id))
                    notes.Add($"{line.Material.Name} is on it twice: the quantities are added together. · المكوّن مكرر: جُمعت الكميات.");
                quantities[line.Material.Id] = quantities.GetValueOrDefault(line.Material.Id) + line.Quantity;
            }
            var byMaterial = lines.Select(l => l.Material!).DistinctBy(m => m.Id).ToDictionary(m => m.Id);
            var portionsNow = portions ?? recipe?.Portions ?? 1;
            foreach (var (id, quantity) in quantities)
            {
                var material = byMaterial[id];
                if (material.Unit != UnitOfMeasure.Piece && quantity / SheetUnits.Factor(material.Unit) / portionsNow > 5)
                    notes.Add($"{material.Name}: {SheetNumbers.Plain(quantity / SheetUnits.Factor(material.Unit) / portionsNow)} {SheetUnits.Name(material.Unit)} a portion. " +
                              $"Was it written in grams? On this sheet 0.2 is 200 g. · تأكد أن الكمية ليست بالجرام.");
            }

            // Its category: one of the kitchen's, or a new one, added.
            RecipeCategory? category = null;
            if (categoryName is not null && !kitchen.TryGetValue(RecipeCategory.Normalize(categoryName), out category))
            {
                category = new RecipeCategory(Guid.NewGuid(), categoryName);
                categories.Add(category);
                kitchen[RecipeCategory.Normalize(categoryName)] = category;
                added.Add(category.Name);
            }

            var ingredients = quantities.Select(q => new RecipeIngredientDto(q.Key, q.Value)).ToList();
            if (recipe is null)
            {
                recipe = target is { } linked ? new Recipe(null, category?.Id, null, linked) : new Recipe(group.Name, category?.Id, null, null);
                recipes.Add(recipe);
                if (recipe.Target is { } newTarget)
                    byTarget[newTarget] = recipe;
                else
                    offMenu[SheetText.Key(group.Name)] = recipe;
                await recipe.WriteAsync(materials, ingredients, portionsNow, cancellationToken);
                created.Add(new ImportedSheetItem(group.Row, recipe.Id, group.Name));
            }
            else
            {
                var changes = new List<string>();
                var before = recipe.Ingredients.ToDictionary(i => i.RawMaterialId, i => i.Quantity);
                if (before.Count != quantities.Count || quantities.Any(q => !before.TryGetValue(q.Key, out var was) || Math.Round(was, 4) != Math.Round(q.Value, 4)))
                    changes.Add("Ingredients");
                if (portionsNow != recipe.Portions)
                    changes.Add("Portions");
                if (category is not null && category.Id != recipe.RecipeCategoryId)
                {
                    recipe.MoveTo(category.Id);
                    changes.Add("Category");
                }
                if (changes.Count == 0)
                {
                    unchanged++;
                    continue;
                }
                await recipe.WriteAsync(materials, ingredients, portionsNow, cancellationToken);
                updated.Add(new UpdatedSheetItem(group.Row, recipe.Id, group.Name, changes));
            }

            toCost.Add((group.Row, group.Name, recipe, notes));
        }

        if (created.Count > 0 || updated.Count > 0)
            await unitOfWork.SaveChangesAsync(cancellationToken);
        var costs = new RecipeCosts(all.ToDictionary(m => m.Id), await prepRecipes.GetAllAsync(cancellationToken));
        var costed = toCost.Select(c => Cost(c.Row, c.Name, c.Recipe, costs, c.Notes)).ToList();
        return new RecipeImportResult(created, updated, unchanged, skipped.OrderBy(s => s.Row).ToList(), added, costed);
    }

    // The rows by recipe, in the order their names first come: a row with no name is the one
    // above's; ingredients above any name are said so.
    private static List<Group> Groups(IReadOnlyList<RecipeSheetRow> rows, List<SkippedSheetRow> skipped)
    {
        var groups = new Dictionary<string, Group>();
        Group? current = null;
        foreach (var row in rows.OrderBy(r => r.Row))
        {
            if (SheetText.Clean(row.Item) is { } name)
            {
                if (!groups.TryGetValue(SheetText.Key(name), out current))
                    groups[SheetText.Key(name)] = current = new Group(row.Row, name, []);
            }
            else if (current is null)
            {
                skipped.Add(new SkippedSheetRow(row.Row, null, "No recipe named on this row or above it.", "لا توجد وصفة مسماة في هذا الصف أو فوقه."));
                continue;
            }
            current.Rows.Add(row);
        }

        return groups.Values.ToList();
    }

    // What it costs now: each ingredient as purchased (its yield lost) at its average cost, a prep
    // item never made yet by its own recipe.
    private static CostedSheetItem Cost(int row, string name, Recipe recipe, RecipeCosts costs, List<string> notes)
    {
        var missing = recipe.Ingredients.SelectMany(i => costs.Of(i.RawMaterialId).Missing).Distinct().ToList();
        var cost = recipe.Ingredients.Sum(i => i.AsPurchasedQuantity * (costs.Of(i.RawMaterialId).PerUnit ?? 0));
        return new CostedSheetItem(row, name, recipe.Ingredients.Count, SheetNumbers.Money(cost), SheetNumbers.Money(cost / recipe.Portions), "portion", missing, notes);
    }
}
```


> 📄 **`backend/src/Costing.Application/Production/PrepRecipeSheet.cs`** — 457 سطر

```csharp
using MediatR;
using Costing.Domain.Common;
using Costing.Application.Approvals;
using Costing.Application.Categories;
using Costing.Application.Common;
using Costing.Application.RawMaterials;
using Costing.Application.Recipes;
using Costing.Domain.Approvals;
using Costing.Domain.Categories;
using Costing.Domain.Production;
using Costing.Domain.RawMaterials;

namespace Costing.Application.Production;

// Prep items' batch recipes to and from a spreadsheet, as the dishes' are (RecipeSheet): every
// prep item written out a row per ingredient, and a sheet read back in. A prep item is named on
// each of its rows (a blank name is the row above's): one already kept is changed, a new name
// adds one. Each ingredient is chosen from the materials and prep items, its quantity for one
// batch in its own unit as its label says: 0.2 for 200 g. What one batch makes, and the unit a new
// prep item is kept in (Kg unless said), go on any of its rows.
//
// A prep item's rows replace its whole recipe, each ingredient keeping its yield; a blank batch
// leaves it as it was, and a new one's is the weight of its ingredients. One with a row that
// cannot be read is left as it was, whole. A prep item made with another new one on the sheet is
// made after it. A manager's import saves at once; anyone else's asks a manager for each, as
// changing one by hand does. Nothing on the sheet is a cost: what a batch costs is worked out.

public sealed record PrepRecipeSheetRow(int Row, string? Item, string? Ingredient, string? Quantity, string? Makes = null, string? Unit = null);

// One row written out: the prep item, an ingredient by its label and its quantity for one batch;
// what a batch makes and the unit it is kept in on its first row. A prep item with no recipe yet
// is a row of its own, with no ingredient.
public sealed record PrepRecipeSheetLine(string Item, string? Ingredient, decimal? Quantity, decimal? Makes, string? Unit);

public sealed record PrepRecipeSheet(IReadOnlyList<PrepRecipeSheetLine> Lines, IReadOnlyList<string> Items, IReadOnlyList<SheetIngredient> Ingredients);

public sealed record GetPrepRecipeSheetQuery : IRequest<PrepRecipeSheet>;

public sealed record ImportPrepRecipesCommand(IReadOnlyList<PrepRecipeSheetRow> Rows, string StaffId, string StaffName, bool CanApprove)
    : IRequest<RecipeImportResult>;

internal sealed class GetPrepRecipeSheetHandler(IRawMaterialRepository materials, IPrepRecipeRepository recipes)
    : IRequestHandler<GetPrepRecipeSheetQuery, PrepRecipeSheet>
{
    public async Task<PrepRecipeSheet> Handle(GetPrepRecipeSheetQuery request, CancellationToken cancellationToken)
    {
        var all = await materials.GetAllAsync(cancellationToken);
        var byId = all.ToDictionary(m => m.Id);
        var lookup = new IngredientLookup(all);
        var byItem = (await recipes.GetAllAsync(cancellationToken)).ToDictionary(r => r.PrepItemId);
        var items = all.Where(m => m.IsPrepItem && !m.IsArchived).OrderBy(m => m.Name, StringComparer.CurrentCultureIgnoreCase).ToList();

        var lines = new List<PrepRecipeSheetLine>();
        foreach (var item in items)
        {
            var recipe = byItem.GetValueOrDefault(item.Id);
            var unit = SheetUnits.Name(item.Unit);
            var makes = recipe is null ? (decimal?)null : SheetNumbers.InSheetUnit(recipe.BatchQuantity, item.Unit);
            var ingredients = (recipe?.Ingredients ?? [])
                .Where(i => byId.ContainsKey(i.RawMaterialId))
                .OrderBy(i => byId[i.RawMaterialId].Name, StringComparer.CurrentCultureIgnoreCase)
                .ToList();
            if (ingredients.Count == 0)
            {
                lines.Add(new PrepRecipeSheetLine(item.Name, null, null, makes, unit));
                continue;
            }
            var first = true;
            foreach (var ingredient in ingredients)
            {
                var material = byId[ingredient.RawMaterialId];
                lines.Add(new PrepRecipeSheetLine(
                    item.Name, lookup.LabelOf(material), SheetNumbers.InSheetUnit(ingredient.Quantity, material.Unit), first ? makes : null, first ? unit : null));
                first = false;
            }
        }

        return new PrepRecipeSheet(lines, items.Select(i => i.Name).ToList(), lookup.Offered);
    }
}

internal sealed class ImportPrepRecipesHandler(
    IRawMaterialRepository materials,
    IPrepRecipeRepository recipes,
    IPurchaseCategoryRepository categories,
    IApprovalRequestRepository requests,
    PrepItemWriter writer,
    IUnitOfWork unitOfWork) : IRequestHandler<ImportPrepRecipesCommand, RecipeImportResult>
{
    public const int MaxRows = 5000;
    private const int MaxNameLength = 200;

    private sealed class Plan(int row, string name, RawMaterial? existing, UnitOfMeasure unit, decimal? makes, List<PrepRecipeSheetRow> rows)
    {
        public int Row { get; } = row;
        public string Name { get; } = name;
        public RawMaterial? Existing { get; } = existing;
        public UnitOfMeasure Unit { get; } = unit;
        public decimal? Makes { get; } = makes;
        public List<PrepRecipeSheetRow> Rows { get; } = rows;
        // Its id: the one kept, or the new one's, given now so that others on the sheet can name it.
        public Guid Id { get; } = existing?.Id ?? Guid.NewGuid();
        public List<SheetLine> Lines { get; set; } = [];
        public List<string> Notes { get; } = [];
    }

    public async Task<RecipeImportResult> Handle(ImportPrepRecipesCommand request, CancellationToken cancellationToken)
    {
        if (request.Rows.Count == 0)
            throw new DomainException("The sheet has no prep items on it: a prep item's name, an ingredient and its quantity on each row. · لا توجد أصناف مُصنَّعة في الملف.");
        if (request.Rows.Count > MaxRows)
            throw new DomainException($"Import at most {MaxRows:N0} rows at a time: split the sheet. · استورد {MaxRows:N0} صف على الأكثر في المرة.");

        var all = await materials.GetAllAsync(cancellationToken);
        var byName = new Dictionary<string, RawMaterial>();
        foreach (var material in all.OrderBy(m => m.IsArchived))
            byName.TryAdd(SheetText.Key(material.Name), material);
        var recipesById = (await recipes.GetAllAsync(cancellationToken)).ToDictionary(r => r.PrepItemId);
        var pendingRecords = new HashSet<Guid>();
        var pendingNames = new HashSet<string>();
        foreach (var pending in await requests.GetPendingAsync(cancellationToken))
        {
            pendingRecords.Add(pending.RecordId);
            if (pending is { Module: ApprovalModule.PrepItem, Action: ApprovalAction.Create })
                pendingNames.Add(SheetText.Key(ApprovalPayload.Read<PrepItemChange>(pending).Name));
        }

        var skipped = new List<SkippedSheetRow>();
        var plans = Plans(request.Rows, byName, pendingRecords, pendingNames, skipped);

        // Each new prep item named before its rows are read: another on the sheet may be made with it.
        var placeholders = plans.Where(p => p.Existing is null).Select(p => new RawMaterial(p.Name, p.Unit, kind: MaterialKind.Prep, id: p.Id)).ToList();
        var lookup = new IngredientLookup(all.Concat(placeholders));
        var newIds = placeholders.Select(p => p.Id).ToHashSet();
        foreach (var plan in plans.ToList())
        {
            plan.Lines = plan.Rows.Where(r => SheetText.Clean(r.Ingredient) is not null || SheetText.Clean(r.Quantity) is not null)
                .Select(r => lookup.Read(r.Row, r.Ingredient, r.Quantity))
                .Select(l => l.Material?.Id == plan.Id ? l with { Reason = "A prep item is not made from itself.", ReasonAr = "لا يُصنع الصنف من نفسه." } : l)
                .ToList();
            if (plan.Lines.Any(l => l.Reason is not null))
            {
                foreach (var bad in plan.Lines.Where(l => l.Reason is not null))
                    skipped.Add(new SkippedSheetRow(bad.Row, plan.Name, $"{bad.Reason} The prep item is left as it was.", $"{bad.ReasonAr} لم يُغيَّر الصنف."));
                plans.Remove(plan);
            }
            else if (plan.Lines.Count == 0 && plan.Existing is null)
            {
                skipped.Add(new SkippedSheetRow(plan.Row, plan.Name, "No ingredients under it: choose at least one, with its quantity for one batch.",
                    "لا توجد مكونات: اختر مكوّنًا واحدًا على الأقل بكميته في التشغيلة."));
                plans.Remove(plan);
            }
        }

        // The category new prep items are kept under, as the batch recipes sheet files them.
        PurchaseCategory? category = null;
        var added = new List<string>();
        if (plans.Any(p => p.Existing is null))
            category = await CategoryAsync(added, cancellationToken);

        var created = new List<ImportedSheetItem>();
        var updated = new List<UpdatedSheetItem>();
        var toCost = new List<(Plan Plan, decimal Batch, Dictionary<Guid, RawMaterial> Used, List<PrepIngredientEntry> Entries, bool Requested)>();
        var unchanged = 0;
        var requested = 0;
        var made = new HashSet<Guid>();
        var asked = new HashSet<Guid>();
        foreach (var plan in Ordered(plans, newIds, skipped))
        {
            void Skip(string reason, string reasonAr) => skipped.Add(new SkippedSheetRow(plan.Row, plan.Name, reason, reasonAr));

            // Made with a new one on the sheet: only once that one is made.
            var waitingOn = plan.Lines.Select(l => l.Material!).FirstOrDefault(m => newIds.Contains(m.Id) && !made.Contains(m.Id));
            if (waitingOn is not null)
            {
                if (asked.Contains(waitingOn.Id))
                    Skip($"Made with {waitingOn.Name}, which waits for a manager's approval: import the sheet again once it is approved.",
                        $"يُصنع من {waitingOn.Name} الذي ينتظر موافقة المدير: استورد الملف مرة أخرى بعد الموافقة.");
                else
                    Skip($"Made with {waitingOn.Name}, which was not imported.", $"يُصنع من {waitingOn.Name} الذي لم يُستورد.");
                continue;
            }

            var recipe = plan.Existing is null ? null : recipesById.GetValueOrDefault(plan.Existing.Id);
            if (plan.Lines.Count == 0)
            {
                unchanged++;
                continue;
            }

            // The same ingredient twice: added together, and said.
            var quantities = new Dictionary<Guid, decimal>();
            foreach (var line in plan.Lines)
            {
                if (quantities.ContainsKey(line.Material!.Id))
                    plan.Notes.Add($"{line.Material.Name} is on it twice: the quantities are added together. · المكوّن مكرر: جُمعت الكميات.");
                quantities[line.Material.Id] = quantities.GetValueOrDefault(line.Material.Id) + line.Quantity;
            }
            var used = plan.Lines.Select(l => l.Material!).DistinctBy(m => m.Id).ToDictionary(m => m.Id);

            // One batch: as written; as kept; or a new one's, the weight of its ingredients.
            decimal batch;
            if (plan.Makes is { } makes)
                batch = makes;
            else if (recipe is not null)
                batch = recipe.BatchQuantity;
            else if (plan.Unit == UnitOfMeasure.Piece)
            {
                Skip("Say how many pieces one batch makes, under Batch Makes.", "اكتب عدد القطع التي تنتجها التشغيلة في عمود كمية التشغيلة.");
                continue;
            }
            else
            {
                var weight = quantities.Where(q => used[q.Key].Unit != UnitOfMeasure.Piece).Sum(q => q.Value);
                if (weight <= 0)
                {
                    Skip("Say how much one batch makes, under Batch Makes.", "اكتب كمية التشغيلة في عمود كمية التشغيلة.");
                    continue;
                }
                batch = Math.Round(weight, 3);
                plan.Notes.Add($"Makes {SheetNumbers.Plain(batch / SheetUnits.Factor(plan.Unit))} {SheetUnits.Name(plan.Unit)} a batch: the weight of its ingredients. " +
                               "Correct it where cooking changes the weight. · كمية التشغيلة هي وزن مكوناتها: صحّحها إن تغيّر الوزن بالطهي.");
            }
            foreach (var (id, quantity) in quantities.Where(q => used[q.Key].Unit != UnitOfMeasure.Piece && q.Value / SheetUnits.Factor(used[q.Key].Unit) > 200))
                plan.Notes.Add($"{used[id].Name}: {SheetNumbers.Plain(quantity / SheetUnits.Factor(used[id].Unit))} {SheetUnits.Name(used[id].Unit)} in one batch. " +
                               "Was it written in grams? On this sheet 0.2 is 200 g. · تأكد أن الكمية ليست بالجرام.");

            // As kept: each ingredient keeping its yield on the recipe.
            var yields = recipe?.Ingredients.ToDictionary(i => i.RawMaterialId, i => i.YieldPercent) ?? [];
            var entries = quantities.Select(q => new PrepIngredientEntry(q.Key, q.Value, yields.TryGetValue(q.Key, out var y) ? y : null)).ToList();
            var item = plan.Existing;
            var change = item is null
                ? new PrepItemChange(plan.Name, plan.Unit, batch, entries, CategoryId: category!.Id)
                : new PrepItemChange(item.Name, item.Unit, batch, entries, item.Code, item.CategoryId, item.PurchaseUnit, item.PurchaseUnitSize, item.ReorderLevel,
                    recipe?.RecipeCategoryId);

            var changes = new List<string>();
            if (recipe is not null)
            {
                var before = recipe.Ingredients.ToDictionary(i => i.RawMaterialId, i => i.Quantity);
                if (before.Count != quantities.Count || quantities.Any(q => !before.TryGetValue(q.Key, out var was) || Math.Round(was, 4) != Math.Round(q.Value, 4)))
                    changes.Add("Ingredients");
                if (Math.Round(recipe.BatchQuantity, 4) != Math.Round(batch, 4))
                    changes.Add("Batch");
                if (changes.Count == 0)
                {
                    unchanged++;
                    continue;
                }
            }
            else if (item is not null)
            {
                changes.Add("Ingredients");
                changes.Add("Batch");
            }

            try
            {
                if (request.CanApprove)
                {
                    await writer.SaveAsync(change, item?.Id, item is null ? plan.Id : null, cancellationToken);
                    await unitOfWork.SaveChangesAsync(cancellationToken);
                    if (item is null)
                    {
                        made.Add(plan.Id);
                        created.Add(new ImportedSheetItem(plan.Row, plan.Id, plan.Name));
                    }
                    else
                    {
                        updated.Add(new UpdatedSheetItem(plan.Row, item.Id, item.Name, changes));
                    }
                }
                else
                {
                    await writer.CheckAsync(change, item?.Id, cancellationToken);
                    var (summary, described) = await writer.DescribeAsync(change, item?.Id, cancellationToken);
                    requests.Add(ApprovalRequest.AskToChange(
                        Guid.NewGuid(), ApprovalModule.PrepItem, item is null ? ApprovalAction.Create : ApprovalAction.Update, plan.Id, summary, described,
                        ApprovalPayload.Write(change), "Imported from Excel", request.StaffId, request.StaffName));
                    await unitOfWork.SaveChangesAsync(cancellationToken);
                    asked.Add(plan.Id);
                    requested++;
                }
            }
            catch (DomainException error)
            {
                Skip(error.Message, "لم يُستورد: راجع السبب بالإنجليزية.");
                continue;
            }

            toCost.Add((plan, batch, used, entries, !request.CanApprove));
        }

        // Costed once all are saved: one made with another new one on the sheet, by that one's recipe.
        var costs = new RecipeCosts((await materials.GetAllAsync(cancellationToken)).ToDictionary(m => m.Id), await recipes.GetAllAsync(cancellationToken));
        var costed = toCost.Select(c => Cost(c.Plan, c.Batch, c.Used, c.Entries, c.Requested, costs)).ToList();
        return new RecipeImportResult(created, updated, unchanged, skipped.OrderBy(s => s.Row).ToList(), added, costed, requested);
    }

    // The prep items to import, by their names: a row with no name is the one above's. A name
    // that is a bought material's, a deleted one's, one waiting for approval, or on the sheet
    // already is skipped and said why; so is a unit or a batch that cannot be read.
    private static List<Plan> Plans(
        IReadOnlyList<PrepRecipeSheetRow> rows, Dictionary<string, RawMaterial> byName, HashSet<Guid> pendingRecords, HashSet<string> pendingNames,
        List<SkippedSheetRow> skipped)
    {
        var groups = new List<(int Row, string Name, List<PrepRecipeSheetRow> Rows)>();
        var byKey = new Dictionary<string, int>();
        (int Row, string Name, List<PrepRecipeSheetRow> Rows)? current = null;
        foreach (var row in rows.OrderBy(r => r.Row))
        {
            if (SheetText.Clean(row.Item) is { } name)
            {
                if (byKey.TryGetValue(SheetText.Key(name), out var at))
                    current = groups[at];
                else
                {
                    byKey[SheetText.Key(name)] = groups.Count;
                    groups.Add((row.Row, name, []));
                    current = groups[^1];
                }
            }
            else if (current is null)
            {
                skipped.Add(new SkippedSheetRow(row.Row, null, "No prep item named on this row or above it.", "لا يوجد صنف مُصنَّع مسمى في هذا الصف أو فوقه."));
                continue;
            }
            current.Value.Rows.Add(row);
        }

        var plans = new List<Plan>();
        foreach (var (row, name, groupRows) in groups)
        {
            void Skip(string reason, string reasonAr) => skipped.Add(new SkippedSheetRow(row, name, reason, reasonAr));
            if (name.Length > MaxNameLength)
            {
                Skip($"The name is longer than {MaxNameLength} characters.", $"الاسم أطول من {MaxNameLength} حرف.");
                continue;
            }

            var existing = byName.GetValueOrDefault(SheetText.Key(name));
            if (existing is { IsPrepItem: false })
            {
                Skip($"{existing.Name} is a bought raw material: a prep item takes another name.", $"{existing.Name} خامة مشتراة: اختر للصنف المُصنَّع اسمًا آخر.");
                continue;
            }
            if (existing is { IsArchived: true })
            {
                Skip($"{existing.Name} was deleted: restore it rather than import it again.", $"{existing.Name} محذوف: استرجعه بدلًا من استيراده.");
                continue;
            }
            if (existing is not null ? pendingRecords.Contains(existing.Id) : pendingNames.Contains(SheetText.Key(name)))
            {
                Skip($"{name} waits for a manager's approval: import it again once that is decided.", $"{name} بانتظار موافقة المدير: استورده بعد البت فيه.");
                continue;
            }

            var unitText = groupRows.Select(r => SheetText.Clean(r.Unit)).FirstOrDefault(u => u is not null);
            var unit = SheetUnits.Parse(unitText);
            if (unitText is not null && unit is null)
            {
                Skip($"\"{unitText}\" is not a unit the system knows: Kg, Liter or Piece.", $"\"{unitText}\" ليست وحدة معروفة: كيلو أو لتر أو قطعة.");
                continue;
            }
            if (existing is not null && unit is { } other && other != existing.Unit)
            {
                Skip($"{existing.Name} is kept by the {SheetUnits.Name(existing.Unit)}, not the {SheetUnits.Name(other)}: its stock and batches are in it. Add a new prep item for another unit.",
                    $"{existing.Name} يُحفظ بالـ{SheetUnits.NameAr(existing.Unit)} وليس بالـ{SheetUnits.NameAr(other)}: أضف صنفًا جديدًا لوحدة أخرى.");
                continue;
            }
            var kept = existing?.Unit ?? unit ?? UnitOfMeasure.Gram;

            var makesText = groupRows.Select(r => SheetText.Clean(r.Makes)).FirstOrDefault(m => m is not null);
            decimal? makes = null;
            if (makesText is not null)
            {
                if (SheetText.Amount(makesText) is not { } amount || amount <= 0)
                {
                    Skip($"\"{makesText}\" is not what a batch makes: write a number of {SheetUnits.Name(kept)}, more than nothing.",
                        $"\"{makesText}\" ليست كمية تشغيلة: اكتب رقمًا بالـ{SheetUnits.NameAr(kept)} أكبر من صفر.");
                    continue;
                }
                makes = amount * SheetUnits.Factor(kept);
            }

            plans.Add(new Plan(row, name, existing, kept, makes, groupRows));
        }

        return plans;
    }

    // Each after the new ones on the sheet it is made with; ones made with each other skipped.
    private static List<Plan> Ordered(List<Plan> plans, HashSet<Guid> newIds, List<SkippedSheetRow> skipped)
    {
        var byId = plans.ToDictionary(p => p.Id);
        var ordered = new List<Plan>();
        var done = new Dictionary<Guid, bool>();
        bool Visit(Plan plan, HashSet<Guid> path)
        {
            if (done.TryGetValue(plan.Id, out var ok))
                return ok;
            if (!path.Add(plan.Id))
                return false;
            ok = true;
            foreach (var line in plan.Lines.Where(l => newIds.Contains(l.Material!.Id) && byId.ContainsKey(l.Material.Id)))
                ok &= Visit(byId[line.Material!.Id], path);
            path.Remove(plan.Id);
            done[plan.Id] = ok;
            if (ok)
                ordered.Add(plan);
            else
                skipped.Add(new SkippedSheetRow(plan.Row, plan.Name, "Made with a prep item that is itself made with it: put one of them right.",
                    "يُصنع من صنف يُصنع منه: صحّح أحدهما."));
            return ok;
        }

        foreach (var plan in plans)
            Visit(plan, []);
        return ordered;
    }

    // The batch recipes' category, المصنعات, added when not there.
    private async Task<PurchaseCategory> CategoryAsync(List<string> added, CancellationToken cancellationToken)
    {
        var key = PurchaseCategory.Normalize(ImportPrepItemsHandler.CategoryName);
        var category = (await categories.GetAllAsync(cancellationToken))
            .FirstOrDefault(c => PurchaseCategory.Normalize(c.Name) == key || (c.NameAr is { } ar && PurchaseCategory.Normalize(ar) == key));
        if (category is null)
        {
            categories.Add(category = new PurchaseCategory(Guid.NewGuid(), ImportPrepItemsHandler.CategoryName));
            added.Add(category.Name);
            await unitOfWork.SaveChangesAsync(cancellationToken);
        }
        else if (category.Kind != CategoryKind.RawMaterials)
        {
            throw new DomainException($"{category.Name} is a general expenses category: make it a raw materials category for the prep items first.");
        }

        return category;
    }

    // What one batch costs now, and one kg, litre or piece of it: each ingredient as purchased at
    // its average cost, a prep item never made yet by its own recipe.
    private static CostedSheetItem Cost(
        Plan plan, decimal batch, Dictionary<Guid, RawMaterial> used, List<PrepIngredientEntry> entries, bool requested, RecipeCosts costs)
    {
        // One not saved (a new prep item asked of a manager) has no price yet, by its name.
        var missing = entries
            .SelectMany(e => costs.Of(e.RawMaterialId) is { PerUnit: null, Missing.Count: 0 } ? [used[e.RawMaterialId].Name] : costs.Of(e.RawMaterialId).Missing)
            .Distinct()
            .ToList();
        var cost = entries.Sum(e => e.Quantity * 100 / (e.YieldPercent ?? used[e.RawMaterialId].DefaultYieldPercent) * (costs.Of(e.RawMaterialId).PerUnit ?? 0));
        return new CostedSheetItem(
            plan.Row, plan.Name, entries.Count, SheetNumbers.Money(cost), SheetNumbers.Money(cost / batch * SheetUnits.Factor(plan.Unit)),
            SheetUnits.Name(plan.Unit), missing, plan.Notes, requested);
    }
}
```


> 📄 **`backend/src/Costing.Infrastructure/Excel/RecipeWorkbooks.cs`** — 160 سطر

```csharp
using Costing.Application.Production;
using Costing.Application.Recipes;

namespace Costing.Infrastructure.Excel;

// The recipes' and the prep items' spreadsheets: a row per ingredient under its recipe's name, the
// ingredient chosen from a dropdown of every material and prep item with the unit its quantity is
// written in ("Flour (Kg)"), so that a name cannot be mistyped nor a quantity written in grams
// where kilos are meant. The dropdown's list is a hidden reference sheet, Ingredients: each
// material and prep item with its code, its kind and its system unit. No cost anywhere: what a
// recipe costs is worked out from its ingredients' prices when it is imported.
//
// The template is the export with no rows: the same columns and lists, so either imports back.
public static class RecipeWorkbook
{
    public const string FileName = "recipes-template.xlsx";
    public const string ExportFileName = "recipes.xlsx";
    public const string ContentType = SheetBook.ContentType;
    public const string DataSheetName = "Recipes";

    public const string ItemHeader = "Recipe · الوصفة";
    public const string IngredientHeader = "Ingredient · المكون";
    public const string QuantityHeader = "Quantity · الكمية";
    public const string PortionsHeader = "Portions · عدد الحصص";
    public const string CategoryHeader = "Recipe Category · قسم الوصفة";

    private static readonly Column[] Columns =
    [
        new("Item", ItemHeader, ["recipe", "recipe name", "item", "item name", "menu item", "dish", "product", "الوصفة", "الصنف", "المنتج", "اسم الصنف"],
            "The menu item, size or add-on by its code (choose it from the list), or a recipe off the menu by its name; a new name adds one. On each of its rows, or on its first only."),
        IngredientSheets.Ingredient,
        new("Quantity", QuantityHeader, ["quantity", "qty", "amount", "الكمية"],
            "For the whole recipe, in the ingredient's unit, as its name says: 0.2 for 200 g of something in Kg."),
        new("Portions", PortionsHeader, ["portions", "servings", "عدد الحصص", "الحصص"],
            "Optional, on any of its rows: how many portions the quantities make. Blank: as it was, or 1 for a new recipe.", "0"),
        new("Category", CategoryHeader, ["recipe category", "category", "قسم الوصفة", "القسم"],
            "Optional, on any of its rows: the kitchen's own category. A new name is added."),
    ];

    private static readonly string[] Help =
    [
        "One ingredient a row: the recipe, the ingredient chosen from its list, and the quantity. · مكوّن في كل صف: الوصفة، والمكوّن من القائمة، والكمية.",
        "",
        "Recipe: a menu item, size or add-on by its code from the list (6101 · Margherita), or a recipe off the menu by its name.",
        "A blank Recipe is the row above's. A recipe's rows replace its whole ingredient list. · الصف بدون اسم يتبع الصف الذي فوقه.",
        "Ingredient: always from the list. Its name says its unit: write the quantity in it, 0.2 for 200 g. · اكتب الكمية بوحدة المكوّن: 0.2 لـ 200 جرام.",
        "A recipe with a row that cannot be read is left as it was, and each such row is said why. · الوصفة التي بها صف خاطئ لا تُغيَّر.",
        "No prices: each recipe's cost is worked out from its ingredients' prices. · لا أسعار: التكلفة تُحسب من أسعار المكونات.",
        "Every material and prep item, with its unit, is on the hidden Ingredients sheet. · كل الخامات والمصنعات بوحداتها في ورقة Ingredients المخفية.",
    ];

    private static readonly object[][] Examples =
    [
        ["6101 · Margherita", "Pizza dough · مصنّع (Kg)", 0.25, 1, "Pizza"],
        ["", "Mozzarella (Kg)", 0.15, "", ""],
        ["", "Tomato sauce · مصنّع (Liter)", 0.08, "", ""],
        ["Staff meal", "Rice (Kg)", 2, 10, "Staff meals"],
    ];

    public static Stream Build(RecipeSheet sheet, bool withRows) =>
        SheetBook.Build(DataSheetName, Columns, Help, Examples,
            withRows ? sheet.Lines.Select(l => new object?[] { l.Item, l.Ingredient, l.Quantity, l.Portions, l.Category }).ToList() : [],
            new Dictionary<string, SheetList>
            {
                ["Item"] = new(sheet.Items, true, "A new recipe", "Not on the list: a recipe off the menu of that name is added. · وصفة جديدة بهذا الاسم."),
                ["Ingredient"] = IngredientSheets.List,
                ["Category"] = new(sheet.Categories, true, "A new category", "Not on the list yet: it is added on import. · قسم جديد يُضاف عند الاستيراد."),
            },
            [IngredientSheets.Reference(sheet.Ingredients)]);

    public static IReadOnlyList<RecipeSheetRow> Read(Stream stream) =>
        SheetBook.Read(stream, Columns, "Item", "Recipe")
            .Select(r => new RecipeSheetRow(r.Row, r.Text("Item"), r.Text("Ingredient"), r.Text("Quantity"), r.Text("Portions"), r.Text("Category")))
            .ToList();
}

// The prep items' batch recipes, as the dishes' are.
public static class PrepRecipeWorkbook
{
    public const string FileName = "prep-items-template.xlsx";
    public const string ExportFileName = "prep-items.xlsx";
    public const string ContentType = SheetBook.ContentType;
    public const string DataSheetName = "Prep Items";

    public const string ItemHeader = "Prep Item · الصنف المُصنَّع";
    public const string QuantityHeader = "Quantity per Batch · الكمية في التشغيلة";
    public const string MakesHeader = "Batch Makes · كمية التشغيلة";
    public const string UnitHeader = "Kept in · الوحدة";

    private static readonly Column[] Columns =
    [
        new("Item", ItemHeader, ["prep item", "prep", "sub-recipe", "sub recipe", "item", "name", "الصنف المُصنَّع", "الصنف المصنع", "المصنع", "الصنف", "الاسم"],
            "The prep item: one on the list is changed, a new name adds one. On each of its rows, or on its first only."),
        IngredientSheets.Ingredient,
        new("Quantity", QuantityHeader, ["quantity per batch", "quantity", "qty", "الكمية في التشغيلة", "الكمية"],
            "For one batch, in the ingredient's unit, as its name says: 0.2 for 200 g of something in Kg."),
        new("Makes", MakesHeader, ["batch makes", "makes", "batch", "batch quantity", "كمية التشغيلة", "التشغيلة", "الناتج"],
            "Optional, on any of its rows: what one batch makes, in the unit it is kept in. Blank: as it was, or the weight of its ingredients for a new one."),
        new("Unit", UnitHeader, ["kept in", "unit", "unit of measure", "الوحدة", "وحدة القياس"],
            "Kg, Liter or Piece: for a new prep item only, Kg when blank. One kept already keeps its own."),
    ];

    private static readonly string[] Help =
    [
        "One ingredient a row: the prep item, the ingredient chosen from its list, and the quantity for one batch. · مكوّن في كل صف بكميته في التشغيلة.",
        "",
        "Prep Item: one on the list is changed; a new name adds one, kept under مصنعات. A blank Prep Item is the row above's.",
        "A prep item's rows replace its whole recipe, each ingredient keeping its yield. · صفوف الصنف تحل محل وصفته كاملة.",
        "Ingredient: always from the list. Its name says its unit: write the quantity in it, 0.2 for 200 g. · اكتب الكمية بوحدة المكوّن.",
        "Batch Makes: what one batch makes, in Kg, Liter or Piece. · كمية التشغيلة بوحدة الصنف.",
        "A manager's import saves at once; anyone else's goes to a manager for approval. · استيراد غير المدير ينتظر موافقته.",
        "Every material and prep item, with its unit, is on the hidden Ingredients sheet. · كل الخامات والمصنعات بوحداتها في ورقة Ingredients المخفية.",
    ];

    private static readonly object[][] Examples =
    [
        ["Pizza dough", "Flour (Kg)", 6, 10, "Kg"],
        ["", "Water (Liter)", 3.5, "", ""],
        ["", "Dry yeast (Kg)", 0.1, "", ""],
        ["Tomato sauce", "Tomatoes (Kg)", 5, 4, "Liter"],
    ];

    public static Stream Build(PrepRecipeSheet sheet, bool withRows) =>
        SheetBook.Build(DataSheetName, Columns, Help, Examples,
            withRows ? sheet.Lines.Select(l => new object?[] { l.Item, l.Ingredient, l.Quantity, l.Makes, l.Unit }).ToList() : [],
            new Dictionary<string, SheetList>
            {
                ["Item"] = new(sheet.Items, true, "A new prep item", "Not on the list: a prep item of that name is added. · صنف مُصنَّع جديد بهذا الاسم."),
                ["Ingredient"] = IngredientSheets.List,
                ["Unit"] = new(Costing.Application.RawMaterials.SheetUnits.Names, false, "Kg, Liter or Piece", "Write Kg, Liter or Piece (كيلو، لتر، قطعة)."),
            },
            [IngredientSheets.Reference(sheet.Ingredients)]);

    public static IReadOnlyList<PrepRecipeSheetRow> Read(Stream stream) =>
        SheetBook.Read(stream, Columns, "Item", "Prep Item")
            .Select(r => new PrepRecipeSheetRow(r.Row, r.Text("Item"), r.Text("Ingredient"), r.Text("Quantity"), r.Text("Makes"), r.Text("Unit")))
            .ToList();
}

// The ingredient column both sheets share, and the hidden sheet its dropdown offers.
internal static class IngredientSheets
{
    public const string SheetName = "Ingredients";

    public static readonly Column Ingredient = new("Ingredient", "Ingredient · المكون",
        ["ingredient", "ingredient name", "material", "raw material", "المكون", "المكوّن", "الخامة", "المادة"],
        "Choose it from the list: its unit is in brackets, and the quantity is written in it. Every one is on the hidden Ingredients sheet.");

    // Only what is on the list: a name typed another way is refused there and then.
    public static readonly SheetList List = new([], false, "Choose from the list",
        "Choose the ingredient from the list: its name says the unit its quantity is written in. · اختر المكوّن من القائمة.",
        $"{SheetName}!A", Strict: true);

    public static ReferenceSheet Reference(IReadOnlyList<SheetIngredient> ingredients) => new(SheetName,
        ["Ingredient (as chosen) · المكون كما يُختار", "Name · الاسم", "Code · الكود", "Kind · النوع", "System Unit · وحدة النظام", "الوحدة"],
        ingredients.Select(i => new object?[]
        {
            i.Label, i.Name, i.Code, i.IsPrepItem ? "Prep item · مُصنَّع" : "Raw material · خامة", i.Unit, i.UnitAr,
        }).ToList());
}
```


### 1.5 شيت المصنعات القديم (مصنعات)

صيغة المطابخ والأنظمة القديمة: اسم المصنّع في صف وحده، صف عناوين (الصنف | الوحدة | الكمية)، ثم مكوناته. كل واحد مصنّع بالجرام ومسعّر بوصفته، والخامات الناقصة تُضاف.

> 📄 **`backend/src/Costing.Application/Production/PrepItemImport.cs`** — 380 سطر

```csharp
using System.Globalization;
using MediatR;
using Costing.Domain.Common;
using Costing.Application.Approvals;
using Costing.Application.Categories;
using Costing.Application.Common;
using Costing.Application.RawMaterials;
using Costing.Domain.Approvals;
using Costing.Domain.Categories;
using Costing.Domain.RawMaterials;

namespace Costing.Application.Production;

// Prep items brought in from a spreadsheet of batch recipes (المصنعات): each prep item named on a
// row of its own, then its ingredients, a unit and a quantity for one batch each.
//
// Every one is a prep item, counted in grams and costed per kg; its batch is the weight of its
// ingredients (litres taken as kilos), for the kitchen to correct where cooking changes it. It
// is filed under المصنعات, added when not there. An ingredient is a material already in the till,
// another prep item on the sheet (made first), or else added as a purchased raw material with no
// price yet, in the sheet's unit. A line the till cannot read or convert (salt kept in pieces,
// weighed in kilos) is left out and said, as is a line with no quantity.
//
// A prep item whose name is taken, or already asked for, is skipped; so is the same name again on
// the sheet. A manager's import makes them at once; anyone else's asks a manager for each, as
// adding one by hand does: one made from another that is waiting for approval is skipped, to be
// imported again once that is approved.

// The sheet as read: each prep item by the row its name is on (no name: ingredients above any),
// and its ingredient rows as written.
public sealed record PrepSheetLine(int Row, string? Ingredient, string? Unit, string? Quantity);

public sealed record PrepSheetItem(int Row, string? Name, IReadOnlyList<PrepSheetLine> Lines);

// One prep item made, or asked of a manager (Requested): its batch in grams, how many ingredients
// its recipe has, and what to check.
public sealed record ImportedPrepItem(
    int Row, Guid Id, string Name, decimal BatchQuantity, int Ingredients, bool Requested, IReadOnlyList<string> Notes);

public sealed record AddedRawMaterial(Guid Id, string Name, UnitOfMeasure Unit);

public sealed record PrepImportResult(
    IReadOnlyList<ImportedPrepItem> Imported,
    IReadOnlyList<SkippedSheetRow> Skipped,
    IReadOnlyList<AddedRawMaterial> MaterialsAdded,
    string? CategoryAdded);

public sealed record ImportPrepItemsCommand(IReadOnlyList<PrepSheetItem> Items, string StaffId, string StaffName, bool CanApprove)
    : IRequest<PrepImportResult>;

internal sealed class ImportPrepItemsHandler(
    IRawMaterialRepository materials,
    IPurchaseCategoryRepository categories,
    IApprovalRequestRepository requests,
    PrepItemWriter writer,
    IUnitOfWork unitOfWork) : IRequestHandler<ImportPrepItemsCommand, PrepImportResult>
{
    public const int MaxItems = 500;
    public const string CategoryName = "مصنعات";
    private const int MaxNameLength = 200;
    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

    private enum Source
    {
        Existing,
        Added,
        OnSheet,
    }

    // What one line of a recipe is made of, in its own unit.
    private sealed record Ingredient(Source Source, string Key, string Name, UnitOfMeasure Unit, RawMaterial? Material);

    private sealed class Plan(int row, string name, string key)
    {
        public int Row { get; } = row;
        public string Name { get; } = name;
        public string Key { get; } = key;
        public Dictionary<string, (Ingredient Ingredient, decimal Quantity)> Lines { get; } = [];
        public List<string> Notes { get; } = [];
        public string? Blocked { get; set; }
    }

    public async Task<PrepImportResult> Handle(ImportPrepItemsCommand request, CancellationToken cancellationToken)
    {
        if (request.Items.Count == 0)
            throw new DomainException("The sheet has no prep items on it: a prep item's name on a row of its own, then its ingredients.");
        if (request.Items.Count > MaxItems)
            throw new DomainException($"Import at most {MaxItems} prep items at a time: split the sheet.");

        // Names already taken, deleted materials' too; a live one before a deleted one of its name.
        var taken = new Dictionary<string, RawMaterial>();
        foreach (var material in (await materials.GetAllAsync(cancellationToken)).OrderBy(m => m.IsArchived))
            taken.TryAdd(SheetText.Key(material.Name), material);
        // Prep items already asked for and not decided yet.
        var asked = new HashSet<string>();
        foreach (var pending in await requests.GetPendingAsync(cancellationToken))
            if (pending is { Module: ApprovalModule.PrepItem, Action: ApprovalAction.Create })
                asked.Add(SheetText.Key(ApprovalPayload.Read<PrepItemChange>(pending).Name));

        var skipped = new List<SkippedSheetRow>();
        var plans = Plans(request.Items, taken, asked, skipped);
        var onSheet = plans.ToDictionary(p => p.Key);
        var added = new Dictionary<string, RawMaterial>();
        foreach (var plan in plans)
            Read(plan, request.Items.Single(i => i.Row == plan.Row), onSheet, taken, asked, added);

        var ordered = Ordered(plans, onSheet, skipped);
        foreach (var plan in ordered.Where(p => p.Blocked is not null).ToList())
        {
            skipped.Add(new SkippedSheetRow(plan.Row, plan.Name, plan.Blocked!));
            ordered.Remove(plan);
        }

        // The category and the materials the recipes need go in first: a recipe names them.
        var usedAdded = ordered.SelectMany(p => p.Lines.Values).Where(l => l.Ingredient.Source == Source.Added)
            .Select(l => l.Ingredient.Material!).Distinct().ToList();
        PurchaseCategory? category = null;
        string? categoryAdded = null;
        if (ordered.Count > 0)
        {
            var key = PurchaseCategory.Normalize(CategoryName);
            category = (await categories.GetAllAsync(cancellationToken))
                .FirstOrDefault(c => PurchaseCategory.Normalize(c.Name) == key || (c.NameAr is { } ar && PurchaseCategory.Normalize(ar) == key));
            if (category is null)
            {
                categories.Add(category = new PurchaseCategory(Guid.NewGuid(), CategoryName));
                categoryAdded = category.Name;
            }
            else if (category.Kind != CategoryKind.RawMaterials)
            {
                throw new DomainException($"{category.Name} is a general expenses category: make it a raw materials category for the prep items first.");
            }

            var general = await categories.ResolveAsync(null, CategoryKind.RawMaterials, null, cancellationToken);
            foreach (var material in usedAdded)
            {
                material.Describe(null, general.Id);
                materials.Add(material);
            }

            await unitOfWork.SaveChangesAsync(cancellationToken);
        }

        var imported = new List<ImportedPrepItem>();
        var made = new Dictionary<string, Guid>();
        var waiting = new HashSet<string>();
        foreach (var plan in ordered)
        {
            var entries = new List<PrepIngredientEntry>();
            string? missing = null;
            foreach (var (ingredient, quantity) in plan.Lines.Values)
            {
                if (ingredient.Source != Source.OnSheet)
                    entries.Add(new PrepIngredientEntry(ingredient.Material!.Id, quantity));
                else if (made.TryGetValue(ingredient.Key, out var id))
                    entries.Add(new PrepIngredientEntry(id, quantity));
                else
                    missing ??= waiting.Contains(ingredient.Key)
                        ? $"Made with {ingredient.Name}, which waits for a manager's approval: import the sheet again once it is approved."
                        : $"Made with {ingredient.Name}, which was not imported.";
            }

            if (missing is not null)
            {
                skipped.Add(new SkippedSheetRow(plan.Row, plan.Name, missing));
                continue;
            }

            var weight = plan.Lines.Values.Where(l => l.Ingredient.Unit != UnitOfMeasure.Piece).Sum(l => l.Quantity);
            var batch = weight > 0 ? Math.Round(weight, 3) : 1000m;
            plan.Notes.Insert(0, weight > 0
                ? $"Makes {PrepItemCosting.Readable(batch, UnitOfMeasure.Gram)} a batch: the weight of its ingredients. Correct it where cooking changes the weight."
                : "Nothing on its recipe to weigh: 1 kg a batch until it is set.");
            var change = new PrepItemChange(plan.Name, UnitOfMeasure.Gram, batch, entries, CategoryId: category!.Id);
            try
            {
                await writer.CheckAsync(change, null, cancellationToken);
                Guid id;
                if (request.CanApprove)
                {
                    var (item, _, _) = await writer.SaveAsync(change, null, Guid.NewGuid(), cancellationToken);
                    id = item.Id;
                    made[plan.Key] = id;
                }
                else
                {
                    var (summary, changes) = await writer.DescribeAsync(change, null, cancellationToken);
                    var asking = ApprovalRequest.AskToChange(
                        Guid.NewGuid(), ApprovalModule.PrepItem, ApprovalAction.Create, Guid.NewGuid(), summary, changes,
                        ApprovalPayload.Write(change), "Imported from Excel", request.StaffId, request.StaffName);
                    requests.Add(asking);
                    id = asking.RecordId;
                    waiting.Add(plan.Key);
                }

                await unitOfWork.SaveChangesAsync(cancellationToken);
                imported.Add(new ImportedPrepItem(plan.Row, id, plan.Name, batch, entries.Count, !request.CanApprove, plan.Notes));
            }
            catch (DomainException error)
            {
                skipped.Add(new SkippedSheetRow(plan.Row, plan.Name, error.Message));
            }
        }

        return new PrepImportResult(
            imported,
            skipped.OrderBy(s => s.Row).ToList(),
            usedAdded.Select(m => new AddedRawMaterial(m.Id, m.Name, m.Unit)).ToList(),
            categoryAdded);
    }

    // The prep items to make, by their names: a name taken, asked for, or on the sheet already is
    // skipped and said why.
    private static List<Plan> Plans(
        IReadOnlyList<PrepSheetItem> items, Dictionary<string, RawMaterial> taken, HashSet<string> asked, List<SkippedSheetRow> skipped)
    {
        var plans = new List<Plan>();
        var first = new Dictionary<string, int>();
        foreach (var item in items.OrderBy(i => i.Row))
        {
            var name = SheetText.Clean(item.Name);
            string? Problem()
            {
                if (name is null)
                    return "Ingredients with no prep item named above them.";
                if (name.Length > MaxNameLength)
                    return $"The name is longer than {MaxNameLength} characters.";
                var key = SheetText.Key(name);
                if (first.TryGetValue(key, out var row))
                    return $"Also on row {row}, which is the one imported.";
                first[key] = item.Row;
                if (taken.TryGetValue(key, out var existing))
                    return existing.IsArchived ? $"{existing.Name} was deleted: restore it rather than import it again."
                        : existing.IsPrepItem ? $"{existing.Name} is already a prep item."
                        : $"{existing.Name} is already a raw material: a prep item cannot take its name.";
                return asked.Contains(key) ? $"{name} is already waiting for a manager's approval." : null;
            }

            if (Problem() is { } reason)
                skipped.Add(new SkippedSheetRow(item.Row, name, reason));
            else
                plans.Add(new Plan(item.Row, name!, SheetText.Key(name!)));
        }

        return plans;
    }

    // Its recipe: each line's ingredient found or added, in its unit, the same one twice added
    // together; a line that cannot go on it is left out and said why.
    private static void Read(
        Plan plan, PrepSheetItem item, Dictionary<string, Plan> onSheet, Dictionary<string, RawMaterial> taken, HashSet<string> asked,
        Dictionary<string, RawMaterial> added)
    {
        foreach (var line in item.Lines)
        {
            var name = SheetText.Clean(line.Ingredient);
            var written = SheetText.Clean(line.Quantity);
            var unitText = SheetText.Clean(line.Unit);
            var said = $"{name} {written} {unitText}".Trim();
            if (name is null)
            {
                plan.Notes.Add($"Row {line.Row}: no ingredient named, left out.");
                continue;
            }

            if (written is null || SheetText.Amount(written) is not { } quantity || quantity <= 0)
            {
                plan.Notes.Add($"{said}: no quantity, left out.");
                continue;
            }

            if (Unit(unitText) is not { } unit)
            {
                plan.Notes.Add(unitText is null ? $"{said}: no unit, left out." : $"{said}: the till does not know the unit \"{unitText}\", left out.");
                continue;
            }

            if (unit.Unit == UnitOfMeasure.Gram && unit.Factor == 1 && quantity < 1)
                plan.Notes.Add($"{said}: taken as {quantity.ToString("0.###", Invariant)} g. Check it is not kilos.");

            var key = SheetText.Key(name);
            Ingredient ingredient;
            if (key == plan.Key)
            {
                plan.Notes.Add($"{said}: a prep item is not made from itself, left out.");
                continue;
            }

            if (onSheet.TryGetValue(key, out var other))
                ingredient = new Ingredient(Source.OnSheet, key, other.Name, UnitOfMeasure.Gram, null);
            else if (asked.Contains(key))
            {
                plan.Blocked ??= $"Made with {name}, which waits for a manager's approval: import the sheet again once it is approved.";
                continue;
            }
            else if (taken.TryGetValue(key, out var material))
            {
                if (material.IsArchived)
                {
                    plan.Notes.Add($"{said}: {material.Name} was deleted, left out.");
                    continue;
                }

                ingredient = new Ingredient(Source.Existing, key, material.Name, material.Unit, material);
            }
            else
            {
                if (!added.TryGetValue(key, out var adding))
                    added[key] = adding = new RawMaterial(name, unit.Unit);
                ingredient = new Ingredient(Source.Added, key, adding.Name, adding.Unit, adding);
            }

            // Weights and volumes go together, a litre as a kilo; pieces only with pieces.
            if ((ingredient.Unit == UnitOfMeasure.Piece) != (unit.Unit == UnitOfMeasure.Piece))
            {
                plan.Notes.Add($"{said}: the till keeps {ingredient.Name} in {Kept(ingredient.Unit)}, left out.");
                continue;
            }

            var amount = quantity * unit.Factor;
            if (plan.Lines.TryGetValue(key, out var before))
            {
                plan.Lines[key] = (ingredient, before.Quantity + amount);
                plan.Notes.Add($"{ingredient.Name} is on it twice: the quantities are added together.");
            }
            else
            {
                plan.Lines[key] = (ingredient, amount);
            }
        }
    }

    // Each prep item after those it is made with. Ones made with each other are skipped.
    private static List<Plan> Ordered(List<Plan> plans, Dictionary<string, Plan> onSheet, List<SkippedSheetRow> skipped)
    {
        var ordered = new List<Plan>();
        var state = new Dictionary<string, bool>();
        bool Visit(Plan plan, Stack<string> path)
        {
            if (state.TryGetValue(plan.Key, out var done))
                return done;
            if (path.Contains(plan.Key))
                return false;
            path.Push(plan.Key);
            var ok = true;
            foreach (var line in plan.Lines.Values.Where(l => l.Ingredient.Source == Source.OnSheet))
                ok &= Visit(onSheet[line.Ingredient.Key], path);
            path.Pop();
            state[plan.Key] = ok;
            if (ok)
                ordered.Add(plan);
            else
                skipped.Add(new SkippedSheetRow(plan.Row, plan.Name, "Made with a prep item that is itself made with it: put one of them right."));
            return ok;
        }

        foreach (var plan in plans)
            Visit(plan, new Stack<string>());
        return ordered;
    }

    // The units a recipe sheet is written in, English or Arabic: what the quantity is in, and how
    // many grams, millilitres or pieces one of it is.
    private static (UnitOfMeasure Unit, decimal Factor)? Unit(string? text) => text is null ? null : SheetText.Key(text).TrimEnd('.') switch
    {
        "كيلو" or "كجم" or "كغ" or "كيلوجرام" or "كيلوغرام" or "KG" or "KGS" or "KILO" or "KILOGRAM" => (UnitOfMeasure.Gram, 1000m),
        "جرام" or "جم" or "غرام" or "جرامات" or "G" or "GM" or "GRAM" or "GRAMS" => (UnitOfMeasure.Gram, 1m),
        "لتر" or "L" or "LT" or "LTR" or "LITER" or "LITRE" or "LITERS" or "LITRES" => (UnitOfMeasure.Millilitre, 1000m),
        "مل" or "ملي" or "ملليلتر" or "ML" => (UnitOfMeasure.Millilitre, 1m),
        "عدد" or "قطعه" or "حبه" or "ربطه" or "بالكو" or "علبه" or "كيس" or "PIECE" or "PIECES" or "PC" or "PCS" or "UNIT" => (UnitOfMeasure.Piece, 1m),
        _ => null,
    };

    private static string Kept(UnitOfMeasure unit) => unit switch
    {
        UnitOfMeasure.Gram => "grams",
        UnitOfMeasure.Millilitre => "millilitres",
        _ => "pieces",
    };
}
```


> 📄 **`backend/src/Costing.Infrastructure/Excel/PrepItemWorkbook.cs`** — 105 سطر

```csharp
using ClosedXML.Excel;
using Costing.Domain.Common;
using Costing.Application.Production;

namespace Costing.Infrastructure.Excel;

// A spreadsheet of batch recipes (المصنعات), as kitchens and older systems write them: each prep
// item's name on a row of its own, a heading row (الصنف | الوحدة | الكمية), then its ingredients,
// one a row, with the unit and the quantity for one batch. Read as plain data for
// ImportPrepItemsCommand, which decides what each becomes.
//
// The columns are found from the first heading row, in English or Arabic; without one they are
// the first three. A row with only a name starts a prep item; a heading row is passed over.
public static class PrepItemWorkbook
{
    private static readonly string[] ItemNames = ["الصنف", "الخامه", "المكون", "item", "ingredient", "material"];
    private static readonly string[] UnitNames = ["الوحده", "وحده القياس", "unit", "uom", "unit of measure"];
    private static readonly string[] QuantityNames = ["الكميه", "quantity", "qty"];

    // Most a sheet may hold: a kitchen's recipes run to hundreds of rows, not tens of thousands.
    private const int MaxRows = 20_000;

    public static IReadOnlyList<PrepSheetItem> Read(Stream stream)
    {
        XLWorkbook workbook;
        try
        {
            workbook = new XLWorkbook(stream);
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            throw new DomainException("That file could not be read as an Excel workbook (.xlsx).");
        }

        using (workbook)
        {
            var sheets = workbook.Worksheets.Where(s => s.Visibility == XLWorksheetVisibility.Visible).ToList();
            var (sheet, columns) = sheets.Select(s => (Sheet: s, Columns: Columns(s))).FirstOrDefault(s => s.Columns is not null);
            sheet ??= sheets.FirstOrDefault() ?? throw new DomainException("The workbook has no sheet to read.");
            var (item, unit, quantity) = columns ?? (1, 2, 3);

            var used = sheet.RowsUsed().ToList();
            if (used.Count > MaxRows)
                throw new DomainException($"The sheet has {used.Count:N0} rows: import at most {MaxRows:N0} at a time.");

            var items = new List<PrepSheetItem>();
            (int Row, string? Name, List<PrepSheetLine> Lines)? current = null;
            void Close()
            {
                if (current is { } open)
                    items.Add(new PrepSheetItem(open.Row, open.Name, open.Lines));
            }

            foreach (var row in used)
            {
                var (a, b, c) = (Text(row.Cell(item)), Text(row.Cell(unit)), Text(row.Cell(quantity)));
                if (a is null && b is null && c is null || IsHeading(a, b, c))
                    continue;
                if (a is not null && b is null && c is null)
                {
                    Close();
                    current = (row.RowNumber(), a, []);
                    continue;
                }

                // Ingredients before any prep item's name: kept apart, nameless, to be said so.
                current ??= (row.RowNumber(), null, []);
                current.Value.Lines.Add(new PrepSheetLine(row.RowNumber(), a, b, c));
            }

            Close();
            return items;
        }
    }

    // The item, unit and quantity columns, from the first row that heads them; null without one.
    private static (int Item, int Unit, int Quantity)? Columns(IXLWorksheet sheet)
    {
        foreach (var row in sheet.RowsUsed().Take(50))
        {
            var cells = row.CellsUsed().Select(c => (Column: c.Address.ColumnNumber, Text: Plain(c.GetFormattedString()))).ToList();
            int? Find(string[] names) => cells.Where(c => names.Contains(c.Text)).Select(c => (int?)c.Column).FirstOrDefault();
            if (Find(ItemNames) is { } item && Find(UnitNames) is { } unit && Find(QuantityNames) is { } quantity)
                return (item, unit, quantity);
        }

        return null;
    }

    private static bool IsHeading(string? item, string? unit, string? quantity) =>
        item is not null && ItemNames.Contains(Plain(item)) && (unit is null || UnitNames.Contains(Plain(unit)));

    // A heading as compared: lower case, spacing aside, ة as ه.
    private static string Plain(string text) =>
        string.Join(' ', text.Replace('ة', 'ه').Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)).ToLowerInvariant();

    // A cell as written: a number in the invariant culture, whatever the machine's; anything else as
    // Excel shows it, trimmed. Null when empty.
    private static string? Text(IXLCell cell)
    {
        var value = cell.Value;
        var text = value.IsNumber ? ((decimal)value.GetNumber()).ToString(System.Globalization.CultureInfo.InvariantCulture) : cell.GetFormattedString();
        return string.IsNullOrWhiteSpace(text) ? null : text.Trim();
    }
}
```


### 1.6 المنيو والمبيعات اليومية وشيتات التقارير

`MenuWorkbook` و `DailySalesWorkbook` (عمودان: الكود والكمية). و `ReportWorkbook`: محرك تقارير عام (أعمدة بعناوين عربية وإنجليزية وتنسيق أرقام، صفوف بأنواع: بيانات/إجمالي/عنوان مجموعة) تستخدمه شيتات التحليلات وورقة الطلب.

> 📄 **`backend/src/Costing.Infrastructure/Excel/MenuSalesWorkbooks.cs`** — 99 سطر

```csharp
using Costing.Application.Menu;
using Costing.Application.Sales;

namespace Costing.Infrastructure.Excel;

// The menu's spreadsheet and the day's sales': a template to fill in each, and reading one back for
// its import (ImportMenuCommand, ImportDailySalesCommand, which decide what each row becomes).
// Columns are found by their heading, in English or Arabic, not by position: a point of sale's own
// export, its columns renamed to these, imports as it is.
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

// The day's sales sheet (ملخص المبيعات اليومية): two columns, the item and how many sold, for the
// day chosen on import. The item is chosen from a dropdown of every menu item and size by its code
// ("6101-2 · Margherita (Large)"); its code or name typed alone is found as well.
public static class DailySalesWorkbook
{
    public const string FileName = "daily-sales-template.xlsx";
    public const string DataSheetName = "Daily Sales";

    public const string ItemHeader = "Item · الصنف";
    public const string QuantityHeader = "Quantity Sold · الكمية المباعة";

    private static readonly Column[] Columns =
    [
        new("Item", ItemHeader, ["item", "item name", "item code", "menu item", "product", "name", "code", "الصنف", "اسم الصنف", "كود الصنف", "المنتج"],
            "Choose it from the list: each item, and each size of one sold by size, by its code. Its code or name typed alone is found too."),
        new("Quantity", QuantityHeader, ["quantity sold", "quantity", "qty", "sold", "count", "الكمية المباعة", "الكمية", "العدد", "المباع"],
            "How many sold that day: a whole number, 1 or more.", "0"),
    ];

    private static readonly string[] Help =
    [
        "One item a row: the item chosen from its list, and how many sold. · صنف في كل صف: اختر الصنف من القائمة واكتب الكمية المباعة.",
        "",
        "The day is chosen when the sheet is imported: one sheet a day. · يُختار التاريخ عند الاستيراد: ملف لكل يوم.",
        "An item on two rows is counted once, both added up. · الصنف المكرر تُجمع كمياته.",
        "Each item sold takes its stock by its recipe. · كل صنف مباع يخصم المخزون بوصفته.",
        "No prices or money: the day's takings are entered on Financials. · لا أسعار: الإيراد يُسجل في الماليات.",
    ];

    private static readonly object[][] Examples =
    [
        ["6101 · Margherita", 24],
        ["6101-2 · Margherita (Large)", 9],
        ["6201 · Alfredo pasta", 17],
    ];

    public static Stream Build(DailySalesSheet sheet) =>
        SheetBook.Build(DataSheetName, Columns, Help, Examples, [],
            new Dictionary<string, SheetList>
            {
                ["Item"] = new(sheet.Items, false, "Choose from the list",
                    "Choose the item from the list: each size of one sold by size is its own. · اختر الصنف من القائمة."),
            });

    public static IReadOnlyList<DailySaleRow> Read(Stream stream) =>
        SheetBook.Read(stream, Columns, "Item", "Item")
            .Select(r => new DailySaleRow(r.Row, r.Text("Item"), r.Number("Quantity")))
            .ToList();
}
```


> 📄 **`backend/src/Costing.Infrastructure/Excel/ReportWorkbook.cs`** — 267 سطر

```csharp
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
```


### 1.7 واجهة الاستيراد

`SheetImportDialog`: نافذة واحدة لكل الاستيرادات (اسم ما في الشيت، قواعده، تنزيل القالب، الرفع، والنتيجة: المضاف، المحدّث، المتخطى بأسبابه). و `PrepImportDialog` لنتيجة المصنعات، و `recipeSheetRules` القواعد المشتركة.

> 📄 **`frontend/src/app/features/costing/sheet-import-dialog.ts`** — 407 سطر

```ts
import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Observable, firstValueFrom } from 'rxjs';
import { SheetChange, SheetImportResult } from '../../core/costing/costing.api';
import { errorMessage } from '../../core/http/error-message';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { saveBlob } from '../../core/ui/save-blob';

// What the dialog imports: its name for what is on the sheet, its rules, the template to start
// from, and the upload itself.
export interface SheetImportData {
  title: { en: string; ar: string };
  // "material", "materials", "خامة".
  noun: { one: string; many: string; ar: string };
  rules: { en: string; ar: string }[];
  templateName: string;
  template: () => Observable<Blob>;
  upload: (file: File) => Observable<SheetImportResult>;
}

export const sheetChangeLabels: Record<SheetChange, { en: string; ar: string }> = {
  Name: { en: 'name', ar: 'الاسم' },
  Code: { en: 'code', ar: 'الكود' },
  Category: { en: 'category', ar: 'القسم' },
  PurchaseUnit: { en: 'purchase unit', ar: 'وحدة الشراء' },
  Cost: { en: 'cost', ar: 'التكلفة' },
  ReorderLevel: { en: 'reorder level', ar: 'حد الطلب' },
  Yield: { en: 'yield', ar: 'نسبة الصافي' },
  NameAr: { en: 'Arabic name', ar: 'الاسم بالعربي' },
  Unit: { en: 'unit', ar: 'الوحدة' },
  Ingredients: { en: 'ingredients', ar: 'المكونات' },
  Portions: { en: 'portions', ar: 'عدد الحصص' },
  Batch: { en: 'batch', ar: 'كمية التشغيلة' },
};

// A costed row's unit as the table writes it: "a portion · للحصة", "a Kg · للكيلو".
const perLabels: Record<string, { en: string; ar: string }> = {
  portion: { en: 'a portion', ar: 'للحصة' },
  Kg: { en: 'a Kg', ar: 'للكيلو' },
  Liter: { en: 'a liter', ar: 'للتر' },
  Piece: { en: 'a piece', ar: 'للقطعة' },
};

// Importing from Excel (الاستيراد من إكسل): what a sheet does, its template, and the file dropped or
// chosen; then what it did: those added, those changed and in what, those as the sheet has them
// already, those sent for a manager's approval, what each recipe or prep item costs now, and each
// row skipped by its number on the sheet and why, for the sheet to be put right and imported again. Closes with whether anything was added or changed, for the list to be read
// again.
@Component({
  selector: 'app-sheet-import-dialog',
  imports: [MatButtonModule, MatDialogModule, MatIconModule, MatProgressBarModule, MoneyPipe],
  template: `
    <h2 mat-dialog-title>{{ data.title.en }} <span class="inline-ar">{{ data.title.ar }}</span></h2>
    <mat-dialog-content>
      @if (result(); as r) {
        <div class="counts" aria-label="What the import did">
          <span class="count added"><strong>{{ r.created.length }}</strong> added <span class="ar">أُضيف</span></span>
          <span class="count changed"><strong>{{ r.updated.length }}</strong> changed <span class="ar">عُدّل</span></span>
          <span class="count same"><strong>{{ r.unchanged }}</strong> unchanged <span class="ar">بلا تغيير</span></span>
          <span class="count skipped" [class.bad]="r.skipped.length"><strong>{{ r.skipped.length }}</strong> skipped <span class="ar">لم يُستورد</span></span>
          @if (r.requested) {
            <span class="count requested"><strong>{{ r.requested }}</strong> sent for approval <span class="ar">بانتظار موافقة المدير</span></span>
          }
        </div>
        @if (summary(r); as said) {
          <p class="summary">{{ said }}</p>
        }
        @if (r.categoriesAdded.length) {
          <p class="muted">New categories · أقسام جديدة: {{ r.categoriesAdded.join(', ') }}</p>
        }
        @if (r.requested) {
          <p class="muted">A manager approves each on Approvals; nothing changes until then. · يوافق المدير على كل منها من صفحة الطلبات المعلقة.</p>
        }
        @if (r.costed?.length) {
          <h3>What each costs now <span class="inline-ar">التكلفة الحالية</span></h3>
          <div class="table-wrap">
            <table class="grid costed-rows">
              <thead>
                <tr>
                  <th class="num">Row<span class="ar">الصف</span></th>
                  <th>{{ capital(data.noun.one) }}<span class="ar">{{ data.noun.ar }}</span></th>
                  <th class="num">Ingredients<span class="ar">المكونات</span></th>
                  <th class="num">Cost<span class="ar">التكلفة</span></th>
                  <th class="num">Cost per<span class="ar">تكلفة الوحدة</span></th>
                  <th>Check<span class="ar">للمراجعة</span></th>
                </tr>
              </thead>
              <tbody>
                @for (c of r.costed; track c.row) {
                  <tr>
                    <td class="num">{{ c.row }}</td>
                    <td>
                      {{ c.name }}
                      @if (c.requested) {
                        <div class="muted small">Sent for approval · بانتظار الموافقة</div>
                      }
                    </td>
                    <td class="num">{{ c.ingredients }}</td>
                    <td class="num">{{ c.cost ?? 0 | money }}</td>
                    <td class="num">{{ c.costPer ?? 0 | money }} <span class="muted small">{{ per(c.per) }}</span></td>
                    <td>
                      @if (c.missingPrices.length) {
                        <div class="warn-text">No price yet · لا يوجد سعر: {{ c.missingPrices.join(', ') }}</div>
                      }
                      @for (n of c.notes; track $index) {
                        <div class="small">{{ n }}</div>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
        @if (r.updated.length) {
          <h3>Changed <span class="inline-ar">ما تم تعديله</span></h3>
          <div class="table-wrap">
            <table class="grid changed-rows">
              <thead>
                <tr>
                  <th class="num">Row<span class="ar">الصف</span></th>
                  <th>{{ capital(data.noun.one) }}<span class="ar">{{ data.noun.ar }}</span></th>
                  <th>What changed<span class="ar">ما تغيّر</span></th>
                </tr>
              </thead>
              <tbody>
                @for (u of r.updated; track u.row) {
                  <tr>
                    <td class="num">{{ u.row }}</td>
                    <td>{{ u.name }}</td>
                    <td>{{ changes(u.changes) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
        @if (r.skipped.length) {
          <h3>{{ r.skipped.length === 1 ? '1 row skipped' : r.skipped.length + ' rows skipped' }} <span class="inline-ar">صفوف لم تُستورد</span></h3>
          <div class="table-wrap">
            <table class="grid skipped-rows">
              <thead>
                <tr>
                  <th class="num">Row<span class="ar">الصف</span></th>
                  <th>{{ capital(data.noun.one) }}<span class="ar">{{ data.noun.ar }}</span></th>
                  <th>Why<span class="ar">السبب</span></th>
                </tr>
              </thead>
              <tbody>
                @for (s of r.skipped; track s.row) {
                  <tr>
                    <td class="num">{{ s.row }}</td>
                    <td>{{ s.name ?? '—' }}</td>
                    <td>
                      {{ s.reason }}
                      @if (s.reasonAr) {
                        <div class="reason-ar" lang="ar" dir="rtl">{{ s.reasonAr }}</div>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <p class="muted">Put those rows right on the sheet and import it again: the rest are there already. · صحّح هذه الصفوف واستورد الملف مرة أخرى.</p>
        }
      } @else {
        <ul class="rules">
          @for (rule of data.rules; track rule.en) {
            <li>{{ rule.en }} <span class="rule-ar" lang="ar" dir="rtl">{{ rule.ar }}</span></li>
          }
        </ul>
        <div
          class="drop"
          [class.over]="dragging()"
          (dragover)="over($event)"
          (dragleave)="dragging.set(false)"
          (drop)="dropped($event)"
          role="group"
          aria-label="The Excel file to import"
        >
          <mat-icon>upload_file</mat-icon>
          <p>Drop the Excel file here, or choose it. <span class="inline-ar">اسحب ملف الإكسل هنا أو اختره.</span></p>
          <button mat-flat-button type="button" (click)="picker.click()" [disabled]="busy()">
            <mat-icon>folder_open</mat-icon> Choose a file <span class="inline-ar">اختر ملفًا</span>
          </button>
          <input #picker type="file" hidden accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" (change)="picked(picker)"
            aria-label="Excel file to import" />
        </div>
        @if (busy()) {
          <mat-progress-bar mode="indeterminate" />
          <p class="muted">Importing {{ fileName() }}… · جارٍ الاستيراد</p>
        }
        @if (error(); as message) {
          <p class="error" role="alert"><strong>The file could not be imported. · تعذّر استيراد الملف.</strong><br />{{ message }}</p>
        }
      }
    </mat-dialog-content>
    <mat-dialog-actions>
      <button mat-button type="button" class="template" (click)="downloadTemplate()" [disabled]="busy()">
        <mat-icon>download</mat-icon> Excel template <span class="inline-ar">نموذج إكسل</span>
      </button>
      <span class="spacer"></span>
      @if (result()) {
        <button mat-button type="button" (click)="again()">Import another file <span class="inline-ar">ملف آخر</span></button>
        <button mat-flat-button type="button" (click)="close()">Done <span class="inline-ar">تم</span></button>
      } @else {
        <button mat-button type="button" (click)="close()" [disabled]="busy()">Cancel <span class="inline-ar">إلغاء</span></button>
      }
    </mat-dialog-actions>
  `,
  styleUrl: './costing.scss',
  styles: `
    .rules {
      margin: 0 0 16px;
      padding-inline-start: 20px;

      li {
        margin-bottom: 6px;
      }
    }
    .rule-ar,
    .reason-ar {
      display: block;
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.92em;
    }
    .drop {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 24px 16px;
      margin-bottom: 12px;
      border: 2px dashed var(--app-line-strong);
      border-radius: 16px;
      text-align: center;
      transition:
        background 120ms,
        border-color 120ms;

      > mat-icon {
        width: 40px;
        height: 40px;
        font-size: 40px;
        color: var(--mat-sys-primary);
      }
      p {
        margin: 0;
      }
    }
    .drop.over {
      border-color: var(--mat-sys-primary);
      background: var(--mat-sys-primary-container);
    }
    .counts {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 8px;
    }
    .count {
      padding: 6px 12px;
      border-radius: 999px;
      background: var(--mat-sys-surface-container-high);
      font: var(--mat-sys-label-large);

      strong {
        font-size: 1.15em;
        margin-inline-end: 2px;
      }
      .ar {
        display: inline;
        margin-inline-start: 4px;
        opacity: 0.75;
      }
    }
    .count.bad {
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
    }
    .count.requested {
      background: var(--mat-sys-tertiary-container);
      color: var(--mat-sys-on-tertiary-container);
    }
    .small {
      font-size: 0.85em;
    }
    .warn-text {
      color: var(--mat-sys-error);
      font-size: 0.85em;
    }
    .summary {
      font: var(--mat-sys-title-small);
    }
    h3 {
      margin: 16px 0 8px;
      font: var(--mat-sys-title-small);
    }
    .spacer {
      flex: 1;
    }
  `,
})
export class SheetImportDialog {
  protected readonly data = inject<SheetImportData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<SheetImportDialog, boolean>>(MatDialogRef);

  protected readonly busy = signal(false);
  protected readonly dragging = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly fileName = signal('');
  protected readonly result = signal<SheetImportResult | null>(null);
  // Whether any import here added or changed something: the list behind is read again.
  private changed = false;

  protected over(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  protected dropped(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      void this.import(file);
    }
  }

  // The picker is cleared, so the same file can be chosen again once it is put right.
  protected picked(picker: HTMLInputElement): void {
    const file = picker.files?.[0];
    picker.value = '';
    if (file) {
      void this.import(file);
    }
  }

  protected async import(file: File): Promise<void> {
    if (this.busy()) {
      return;
    }
    if (!/\.xlsx$/i.test(file.name)) {
      this.error.set(`${file.name} is not an Excel file (.xlsx): save it as an Excel workbook first. · الملف ليس ملف إكسل (.xlsx).`);
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    this.fileName.set(file.name);
    try {
      const result = await firstValueFrom(this.data.upload(file));
      this.changed ||= result.created.length > 0 || result.updated.length > 0;
      this.result.set(result);
    } catch (error) {
      this.error.set(errorMessage(error, 'Please try again. · حاول مرة أخرى.'));
    } finally {
      this.busy.set(false);
    }
  }

  protected async downloadTemplate(): Promise<void> {
    this.busy.set(true);
    try {
      saveBlob(await firstValueFrom(this.data.template()), this.data.templateName);
    } catch (error) {
      this.error.set(errorMessage(error, 'The template could not be downloaded. · تعذّر تنزيل النموذج.'));
    } finally {
      this.busy.set(false);
    }
  }

  protected again(): void {
    this.result.set(null);
    this.error.set(null);
  }

  protected close(): void {
    this.ref.close(this.changed);
  }

  // Said only when nothing was added or changed: the counts above say the rest.
  protected summary(r: SheetImportResult): string | null {
    if (r.created.length || r.updated.length) {
      return null;
    }
    return r.unchanged
      ? `Nothing to change: the ${this.data.noun.many} are as the sheet has them. · لا شيء للتعديل: البيانات كما في الملف.`
      : `No ${this.data.noun.many} imported. · لم يُستورد شيء.`;
  }

  protected changes(changes: SheetChange[]): string {
    return changes.map((c) => `${sheetChangeLabels[c]?.en ?? c} · ${sheetChangeLabels[c]?.ar ?? ''}`).join('، ');
  }

  protected per(per: string): string {
    const label = perLabels[per] ?? { en: `a ${per}`, ar: '' };
    return `${label.en} · ${label.ar}`;
  }

  protected capital(word: string): string {
    return word.charAt(0).toUpperCase() + word.slice(1);
  }
}
```


> 📄 **`frontend/src/app/features/costing/prep-import-dialog.ts`** — 137 سطر

```ts
import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { PrepImportResult, unitLabels } from '../../core/costing/costing.api';

// What an import of batch recipes did: the prep items made (or asked of a manager), each with its
// batch and what to check on it; the raw materials added for their recipes; and each row skipped,
// by its number on the sheet, and why.
@Component({
  selector: 'app-prep-import-dialog',
  imports: [MatButtonModule, MatDialogModule],
  template: `
    <h2 mat-dialog-title>Imported from Excel <span class="inline-ar">استيراد المصنعات</span></h2>
    <mat-dialog-content>
      <p class="added">
        @if (made().length) {
          {{ made().length === 1 ? '1 prep item added.' : made().length + ' prep items added.' }}
          <span class="inline-ar">أُضيف {{ made().length }} صنف مصنع.</span>
        }
        @if (asked().length) {
          {{ asked().length === 1 ? '1 prep item' : asked().length + ' prep items' }} sent to a manager for approval: not made until then.
          <span class="inline-ar">أُرسل {{ asked().length }} للمدير للموافقة.</span>
        }
        @if (!data.imported.length) {
          No prep items added. <span class="inline-ar">لم يُضف أي صنف.</span>
        }
      </p>
      @if (data.categoryAdded) {
        <p class="muted">Filed under a new category: {{ data.categoryAdded }}.</p>
      }
      @if (data.materialsAdded.length) {
        <p class="muted">
          Raw materials added for their recipes, with no price yet: {{ materials() }}.
          <span class="inline-ar">خامات أُضيفت بدون سعر.</span>
        </p>
      }

      @if (data.imported.length) {
        <h3>Check each one <span class="inline-ar">للمراجعة</span></h3>
        <div class="table-wrap">
          <table class="grid">
            <thead>
              <tr>
                <th class="num">Row<span class="ar">الصف</span></th>
                <th>Prep item<span class="ar">الصنف</span></th>
                <th class="num">One batch<span class="ar">الدفعة</span></th>
                <th>To check<span class="ar">للمراجعة</span></th>
              </tr>
            </thead>
            <tbody>
              @for (p of data.imported; track p.row) {
                <tr>
                  <td class="num">{{ p.row }}</td>
                  <td>
                    {{ p.name }}
                    @if (p.requested) {
                      <div class="muted small">waiting for approval</div>
                    }
                  </td>
                  <td class="num nowrap">{{ batch(p.batchQuantity) }}</td>
                  <td>
                    <ul>
                      @for (n of p.notes; track $index) {
                        <li>{{ n }}</li>
                      }
                    </ul>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      @if (data.skipped.length) {
        <h3>{{ data.skipped.length === 1 ? '1 skipped' : data.skipped.length + ' skipped' }} <span class="inline-ar">لم تُستورد</span></h3>
        <div class="table-wrap">
          <table class="grid">
            <thead>
              <tr>
                <th class="num">Row<span class="ar">الصف</span></th>
                <th>Prep item<span class="ar">الصنف</span></th>
                <th>Why<span class="ar">السبب</span></th>
              </tr>
            </thead>
            <tbody>
              @for (s of data.skipped; track s.row) {
                <tr>
                  <td class="num">{{ s.row }}</td>
                  <td>{{ s.name ?? '—' }}</td>
                  <td>{{ s.reason }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-flat-button mat-dialog-close>Done</button>
    </mat-dialog-actions>
  `,
  styleUrl: './costing.scss',
  styles: `
    .added {
      font: var(--mat-sys-title-small);
    }
    h3 {
      margin: 16px 0 8px;
      font: var(--mat-sys-title-small);
    }
    ul {
      margin: 0;
      padding-left: 18px;
    }
    .small {
      font-size: 0.85em;
    }
    .nowrap {
      white-space: nowrap;
    }
  `,
})
export class PrepImportDialog {
  protected readonly data = inject<PrepImportResult>(MAT_DIALOG_DATA);
  protected readonly made = computed(() => this.data.imported.filter((p) => !p.requested));
  protected readonly asked = computed(() => this.data.imported.filter((p) => p.requested));

  protected materials(): string {
    return this.data.materialsAdded.map((m) => `${m.name} (${unitLabels[m.unit]})`).join(', ');
  }

  // A batch in grams, as a kitchen writes it: 75 g, 15.56 kg.
  protected batch(grams: number): string {
    return grams >= 1000 ? `${+(grams / 1000).toFixed(3)} kg` : `${+grams.toFixed(3)} g`;
  }
}
```


> 📄 **`frontend/src/app/features/costing/recipe-sheet-rules.ts`** — 15 سطر

```ts
// What the recipes' and the prep items' sheets have in common, as their import dialogs say it.
export const recipeSheetRules: { en: string; ar: string }[] = [
  {
    en: 'Each ingredient’s name says its unit, "Flour (Kg)": write the quantity in it, 0.2 for 200 g.',
    ar: 'اسم كل مكوّن يذكر وحدته، "دقيق (Kg)": اكتب الكمية بها، 0.2 لـ 200 جرام.',
  },
  {
    en: 'An item’s rows replace its whole list of ingredients. One with a row that cannot be read is left as it was.',
    ar: 'صفوف الصنف تحل محل كل مكوناته. والصنف الذي به صف خاطئ يبقى كما هو.',
  },
  {
    en: 'No prices on the sheet: what each costs is worked out from its ingredients’ prices now.',
    ar: 'لا أسعار في الملف: التكلفة تُحسب من أسعار المكونات الحالية.',
  },
];
```


---

## 2. ربط نقطة البيع (POS Link)

### 2.1 الفكرة

نقطة البيع (نظام منفصل) **تقرأ المنيو** من هنا، و **ترسل تقرير Z** لكل وردية. لا تلمس قاعدة البيانات أبدًا: HTTP فقط، بمفتاح.

| النداء | ماذا يفعل |
| --- | --- |
| `GET /api/integrations/pos/ping` | اختبار الربط |
| `GET /api/integrations/pos/menu` | المنيو: الفئات، الأصناف بأرقامها وأسعارها، الأحجام بأكوادها (`6101-17`)، الإضافات (`A3`) |
| `POST /api/integrations/pos/z-report` | تقرير وردية |
| `POST /api/integrations/pos/events` | ظرف أحداث الـ POS: `day.closed` يُقرأ كتقرير Z، وغيره يُرد بـ 202 ويُترك |

### 2.2 المفتاح

`cpk_` + 32 بايت عشوائية، يُعرض **مرة واحدة**، ويُخزن **SHA-256 فقط** مع آخر أربعة حروف للتمييز، ويُقارن بزمن ثابت. "مفتاح جديد" يُبطل القديم فورًا. يُرسل في `X-API-Key` (أو `X-Pos-Node-Key`)؛ خطأ ⇐ 401 ويُسجّل.

### 2.3 ماذا يصنع تقرير Z (شرح محاسبي)

```text
تقرير Z (وردية) ──► PosDay (يجمع كل ورديات اليوم)
                      ├─► ملخص مبيعات اليوم (DailySummary): كل صنف مُباع يخصم مخزونه بالوصفة
                      │      والأصناف الملغاة بعد المطبخ (wastedItems) ⇐ تخصم مخزونها كهالك (Waste)، بلا تحصيل
                      └─► توريد اليوم في الخزنة (RevenueTransfer): الكاش والفيزا قبل الضريبة + الضريبة،
                             والإلغاءات وأسبابها في الملاحظات
```

قواعد الـ Idempotency والتعديل:

1. **`zReportId`** معرّف الوردية في الـ POS، ثابت في كل إرسال.
2. **نفس المحتوى مرة أخرى** (نفس `PayloadHash`) ⇐ `Unchanged`، لا شيء يتغير.
3. **تقرير معدّل** (صُحّحت الوردية) ⇐ ما صنعه يُلغى (المخزون يعود، التوريد يُعكس) ويُعاد صنع اليوم كاملًا ⇐ `Updated`.
4. **ورديتان في يوم واحد** ⇐ ملخص واحد وتوريد واحد من كل تقارير اليوم؛ الوردية الثانية تعيد صنع اليوم بالاثنتين.
5. **الكل أو لا شيء:** الملخص والتوريد في حفظ واحد. سطر لا يُطابق المنيو (كود غير موجود، صنف بالأحجام بلا حجم) يرفض التقرير كله 422 مع تسمية كل سطر.
6. **يوم أُدخل يدويًا يُترك:** إن كان ملخص اليوم أو توريده مُدخلًا يدويًا (أو بالشيت)، يُرفض التقرير 422 مع تسمية ما يمنعه. ألغِ اليدوي لتسمح بالتقرير.
7. تصادم مع تعديل آخر في نفس اللحظة ⇐ يُعاد تلقائيًا؛ إن استمر ⇐ 503 فيعيد الـ POS الإرسال لاحقًا.

> 📄 **`backend/src/Costing.Domain/Integrations/PosIntegration.cs`** — 188 سطر

```csharp
using Costing.Domain.Common;

namespace Costing.Domain.Integrations;

// The restaurant's point of sale, linked (ربط نقطة البيع): it reads the menu from here and sends
// each shift's Z report, which becomes the day's sales summary (its stock taken by the recipes)
// and the day's takings in the safe. It proves itself by a key a manager makes here and pastes
// into the POS; only the key's hash is kept, never the key.
public sealed class PosLink : AggregateRoot
{
    public static readonly Guid SingletonId = new("7d3c1b2a-5e4f-4a6b-9c8d-0f1e2d3c4b5a");
    public const int HashLength = 64;
    public const int HintLength = 12;

    private PosLink() { }

    public static PosLink Create() => new() { Id = SingletonId };

    // SHA-256 of the key, hex; and its last characters, to tell which key the POS has.
    public string? KeyHash { get; private set; }
    public string? KeyHint { get; private set; }
    public DateTime? KeyCreatedAtUtc { get; private set; }
    public string? KeyCreatedBy { get; private set; }

    public bool HasKey => KeyHash is not null;

    // A new key: the one before stops working at once.
    public void SetKey(string hash, string hint, string by)
    {
        if (hash.Length != HashLength)
            throw new DomainException("A key's hash is 64 hex characters.");
        KeyHash = hash;
        KeyHint = hint.Length > HintLength ? hint[^HintLength..] : hint;
        KeyCreatedAtUtc = DateTime.UtcNow;
        KeyCreatedBy = by;
    }
}

// One shift's Z report as the POS sent it, by the POS's own id for it: sent again (the answer was
// lost), it is the same report; sent changed (the shift was corrected), it replaces what it was.
public sealed class PosZReport : AggregateRoot
{
    private PosZReport() { }

    public PosZReport(Guid id, DateOnly businessDate, int? shiftNumber, string source, string payloadHash, string payload)
    {
        if (id == Guid.Empty)
            throw new DomainException("A Z report needs its id from the POS.");
        Id = id;
        ReceivedAtUtc = DateTime.UtcNow;
        Set(businessDate, shiftNumber, source, payloadHash, payload);
        Revision = 1;
    }

    public DateOnly BusinessDate { get; private set; }
    public int? ShiftNumber { get; private set; }

    // Which endpoint it came by: z-report or events (day.closed).
    public string Source { get; private set; } = string.Empty;

    // SHA-256 of the report as read, to know a resend from a change.
    public string PayloadHash { get; private set; } = string.Empty;
    public string Payload { get; private set; } = string.Empty;
    public DateTime ReceivedAtUtc { get; private set; }
    public DateTime UpdatedAtUtc { get; private set; }
    public int Revision { get; private set; }

    public void Replace(DateOnly businessDate, int? shiftNumber, string source, string payloadHash, string payload)
    {
        Set(businessDate, shiftNumber, source, payloadHash, payload);
        Revision += 1;
    }

    private void Set(DateOnly businessDate, int? shiftNumber, string source, string payloadHash, string payload)
    {
        BusinessDate = businessDate;
        ShiftNumber = shiftNumber;
        Source = source;
        PayloadHash = payloadHash;
        Payload = payload;
        UpdatedAtUtc = DateTime.UtcNow;
    }
}

// A business day as the POS made it: the sales summary and the takings recorded from that day's Z
// reports (every shift's, together), so a report sent again or changed replaces exactly these and
// nothing a person entered.
public sealed class PosDay : AggregateRoot
{
    private PosDay() { }

    public PosDay(Guid id, DateOnly date)
    {
        Id = id;
        Date = date;
    }

    public DateOnly Date { get; private set; }
    public Guid? SaleId { get; private set; }
    public Guid? TakingsId { get; private set; }
    public DateTime UpdatedAtUtc { get; private set; }

    public void Recorded(Guid? saleId, Guid? takingsId)
    {
        SaleId = saleId;
        TakingsId = takingsId;
        UpdatedAtUtc = DateTime.UtcNow;
    }
}

public enum PosSyncOutcome
{
    // A Z report's day recorded for the first time.
    Recorded = 1,

    // A changed Z report: the day's records replaced.
    Updated = 2,

    // The same Z report sent again: nothing changed.
    Unchanged = 3,

    // Not taken, and nothing recorded: why is in the message (an item not on the menu, a day
    // entered by hand, the amounts).
    Refused = 4,

    // A wrong key, or none.
    Unauthorized = 5,

    // Failed on this side; nothing recorded.
    Failed = 6,

    // Read and answered: the menu, the link test, an event Costing does not use.
    Served = 7,
}

// Every call from the POS, as it went: when, what, the outcome and why. Kept apart from what the
// call recorded, so a call refused or failed is still in the log.
public sealed class PosSyncLog
{
    public const int MaxMessage = 1000;
    public const int MaxDetail = 4000;

    private PosSyncLog() { }

    public PosSyncLog(string endpoint, PosSyncOutcome outcome, string message, Guid? zReportId = null, DateOnly? businessDate = null, string? detail = null)
    {
        Id = Guid.NewGuid();
        AtUtc = DateTime.UtcNow;
        Endpoint = endpoint.Length > 60 ? endpoint[..60] : endpoint;
        Outcome = outcome;
        Message = message.Length > MaxMessage ? message[..MaxMessage] : message;
        ZReportId = zReportId;
        BusinessDate = businessDate;
        Detail = detail is { Length: > MaxDetail } ? detail[..MaxDetail] : detail;
    }

    public Guid Id { get; private set; }
    public DateTime AtUtc { get; private set; }
    public string Endpoint { get; private set; } = string.Empty;
    public PosSyncOutcome Outcome { get; private set; }
    public string Message { get; private set; } = string.Empty;
    public Guid? ZReportId { get; private set; }
    public DateOnly? BusinessDate { get; private set; }
    public string? Detail { get; private set; }
}

public interface IPosLinkStore
{
    Task<PosLink> GetAsync(CancellationToken cancellationToken = default);
}

public interface IPosZReportRepository : IRepository<PosZReport>
{
    Task<IReadOnlyList<PosZReport>> GetByDateAsync(DateOnly date, CancellationToken cancellationToken = default);
}

public interface IPosDayRepository : IRepository<PosDay>
{
    Task<PosDay?> GetByDateAsync(DateOnly date, CancellationToken cancellationToken = default);
}

// Written apart from the call's own work: a refused or failed call is logged all the same.
public interface IPosSyncJournal
{
    Task WriteAsync(PosSyncLog entry, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<PosSyncLog>> RecentAsync(int count, CancellationToken cancellationToken = default);
}
```


> 📄 **`backend/src/Costing.Application/Integrations/PosIntegration.cs`** — 517 سطر

```csharp
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using MediatR;
using Costing.Application.Approvals;
using Costing.Application.Common;
using Costing.Application.Recipes;
using Costing.Application.Sales;
using Costing.Application.Treasury;
using Costing.Domain.Approvals;
using Costing.Domain.Common;
using Costing.Domain.Integrations;
using Costing.Domain.Menu;
using Costing.Domain.Recipes;
using Costing.Domain.Sales;
using Costing.Domain.StockMovements;
using Costing.Domain.Treasury;

namespace Costing.Application.Integrations;

// The POS link (Settings → POS Integration): the key the POS proves itself by, the menu it reads
// from here, and each shift's Z report it sends, made into the day's sales summary (its stock
// taken by the recipes, what was voided after the kitchen taken as waste) and the day's takings in
// the safe; all of a report or none of it. A report sent again changes nothing; sent changed, it
// replaces what it made. A day whose sales or takings were entered by hand is left as it is: the
// report is refused, naming it.

// ---- The key ----

public static class PosKeys
{
    public const string Prefix = "cpk_";

    // 32 random bytes, URL-safe: shown once, kept only as its hash.
    public static string New() => Prefix + Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public static string Hash(string key) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(key.Trim()))).ToLowerInvariant();

    public static string Hint(string key) => "••••" + key[^4..];

    // In constant time, so the time taken says nothing of how close a wrong key came.
    public static bool Matches(string? key, string? hash)
    {
        if (string.IsNullOrWhiteSpace(key) || hash is null)
            return false;
        var given = Encoding.ASCII.GetBytes(Hash(key));
        var kept = Encoding.ASCII.GetBytes(hash);
        return CryptographicOperations.FixedTimeEquals(given, kept);
    }
}

public sealed record PosSyncLogDto(
    Guid Id, DateTime AtUtc, string Endpoint, PosSyncOutcome Outcome, string Message, Guid? ZReportId, DateOnly? BusinessDate, string? Detail)
{
    public static PosSyncLogDto From(PosSyncLog l) => new(l.Id, l.AtUtc, l.Endpoint, l.Outcome, l.Message, l.ZReportId, l.BusinessDate, l.Detail);
}

public sealed record PosIntegrationDto(bool HasKey, string? KeyHint, DateTime? KeyCreatedAtUtc, string? KeyCreatedBy, IReadOnlyList<PosSyncLogDto> Logs);

// The key in full, this once: the page shows it to be copied into the POS.
public sealed record PosKeyDto(string Key, string KeyHint, DateTime CreatedAtUtc, string CreatedBy);

public sealed record GetPosIntegrationQuery(int Logs = 200) : IRequest<PosIntegrationDto>;

public sealed record GeneratePosKeyCommand(string StaffName) : IRequest<PosKeyDto>, IRetryOnConflict;

public sealed record VerifyPosKeyQuery(string? Key) : IRequest<bool>;

internal sealed class GetPosIntegrationHandler(IPosLinkStore links, IPosSyncJournal journal) : IRequestHandler<GetPosIntegrationQuery, PosIntegrationDto>
{
    public async Task<PosIntegrationDto> Handle(GetPosIntegrationQuery request, CancellationToken cancellationToken)
    {
        var link = await links.GetAsync(cancellationToken);
        var logs = await journal.RecentAsync(Math.Clamp(request.Logs, 1, 1000), cancellationToken);
        return new PosIntegrationDto(link.HasKey, link.KeyHint, link.KeyCreatedAtUtc, link.KeyCreatedBy, logs.Select(PosSyncLogDto.From).ToList());
    }
}

internal sealed class GeneratePosKeyHandler(IPosLinkStore links, IUnitOfWork unitOfWork) : IRequestHandler<GeneratePosKeyCommand, PosKeyDto>
{
    public async Task<PosKeyDto> Handle(GeneratePosKeyCommand request, CancellationToken cancellationToken)
    {
        var link = await links.GetAsync(cancellationToken);
        var key = PosKeys.New();
        link.SetKey(PosKeys.Hash(key), PosKeys.Hint(key), request.StaffName);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return new PosKeyDto(key, link.KeyHint!, link.KeyCreatedAtUtc!.Value, request.StaffName);
    }
}

internal sealed class VerifyPosKeyHandler(IPosLinkStore links) : IRequestHandler<VerifyPosKeyQuery, bool>
{
    public async Task<bool> Handle(VerifyPosKeyQuery request, CancellationToken cancellationToken) =>
        PosKeys.Matches(request.Key, (await links.GetAsync(cancellationToken)).KeyHash);
}

// ---- The menu, as the POS reads it ----

// Codes as Costing's reports write them: an item by its number (6101), a size as the item's number
// and the size's (6101-17), an add-on as A and its number (A3).
public sealed record PosMenuSizeDto(string Code, int VariantId, string Name, string? NameAr, decimal Price);

public sealed record PosMenuItemDto(
    int Code, string Name, string? NameAr, string Category, decimal Price, bool IsAvailable, bool PricedByAddOns, bool HasRecipe,
    IReadOnlyList<PosMenuSizeDto> Sizes, IReadOnlyList<string> AddOnCodes);

public sealed record PosMenuCategoryDto(string Name, string? NameAr, int DisplayOrder);

public sealed record PosMenuAddOnDto(string Code, string Name, string? NameAr, decimal Price);

public sealed record PosMenuDto(DateTime AtUtc, IReadOnlyList<PosMenuCategoryDto> Categories, IReadOnlyList<PosMenuItemDto> Items, IReadOnlyList<PosMenuAddOnDto> AddOns);

public sealed record GetPosMenuQuery : IRequest<PosMenuDto>;

internal sealed class GetPosMenuHandler(IMenuRepository menu, IRecipeRepository recipes) : IRequestHandler<GetPosMenuQuery, PosMenuDto>
{
    public async Task<PosMenuDto> Handle(GetPosMenuQuery request, CancellationToken cancellationToken)
    {
        var categories = await menu.GetCategoriesAsync(cancellationToken);
        var items = (await menu.GetItemsAsync(cancellationToken)).Where(i => !i.IsDeleted).OrderBy(i => i.Id).ToList();
        var addOns = (await menu.GetAddOnsAsync(cancellationToken)).Where(a => !a.IsDeleted).OrderBy(a => a.Id).ToList();
        var targets = items.SelectMany(i => i.Variants.Select(v => RecipeTarget.ForVariant(i.Id, v.Id)).Prepend(RecipeTarget.ForMenuItem(i.Id))).ToList();
        var withRecipe = (await recipes.GetByTargetsAsync(targets, cancellationToken))
            .Where(r => !r.IsDeleted && r.Target is { Kind: RecipeTargetKind.MenuItem })
            .Select(r => r.Target!.Value.CatalogItemId).ToHashSet();
        var live = addOns.Select(a => a.Id).ToHashSet();

        return new PosMenuDto(
            DateTime.UtcNow,
            categories.OrderBy(c => c.DisplayOrder).ThenBy(c => c.Name).Select(c => new PosMenuCategoryDto(c.Name, c.NameAr, c.DisplayOrder)).ToList(),
            items.Select(i => new PosMenuItemDto(
                i.Id, i.Name, i.NameAr, i.Category, i.Price, i.IsAvailable, i.IsPriceBasedOnAddons, withRecipe.Contains(i.Id),
                i.Variants.OrderBy(v => v.DisplayOrder).Select(v => new PosMenuSizeDto($"{i.Id}-{v.Id}", v.Id, v.Name, v.NameAr, v.Price)).ToList(),
                i.AddOnIds.Where(live.Contains).Select(id => $"A{id}").ToList())).ToList(),
            addOns.Select(a => new PosMenuAddOnDto($"A{a.Id}", a.Name, a.NameAr, a.Price)).ToList());
    }
}

// ---- The Z report ----

// A line of it: the item by its code (6101, a size 6101-17) or name, and for an item sold by size
// without a size code, its size by name. Reason: why it was voided, for waste.
public sealed record ZReportItem(string ItemCode, int Quantity, string? Size = null, string? Name = null, string? Reason = null);

public sealed record ZReportVoidReason(string Reason, int Count, decimal Amount);

// The day's takings as the Z report gives them, as the safe keeps them: the cash and the card
// (Visa, wallets) before tax, the tax collected on them, and the voids and why.
public sealed record ZReportTakings(decimal Cash, decimal Card, decimal Tax, decimal VoidsAmount, IReadOnlyList<ZReportVoidReason>? VoidReasons = null);

// A shift's Z report: ZReportId is the POS's id for the shift, the same each time it is sent.
// WastedItems: voided after the kitchen had made them (waste): their stock taken as waste.
public sealed record ZReportInput(
    Guid ZReportId, DateOnly Date, int? ShiftNumber, ZReportTakings Takings, IReadOnlyList<ZReportItem> SoldItems,
    IReadOnlyList<ZReportItem>? WastedItems = null);

public sealed record ZReportResultDto(
    Guid ZReportId, DateOnly Date, PosSyncOutcome Outcome, Guid? SaleId, Guid? TakingsId, int Items, int Quantity, int Wasted,
    decimal SalesValue, decimal Cash, decimal Card, decimal Tax, IReadOnlyList<string> Warnings);

public sealed record ReceiveZReportCommand(ZReportInput Report, string Source) : IRequest<ZReportResultDto>, IRetryOnConflict;

internal sealed class ReceiveZReportHandler(
    IPosZReportRepository reports,
    IPosDayRepository days,
    IMenuRepository menu,
    IRecipeRepository recipes,
    ISalesReceiptRepository sales,
    ISafeTransactionRepository safe,
    IStockMovementRepository movements,
    SaleWriter saleWriter,
    TreasuryWriter treasury,
    DeletionTargets deletions,
    IBusinessCalendar calendar,
    IPosSyncJournal journal,
    IUnitOfWork unitOfWork) : IRequestHandler<ReceiveZReportCommand, ZReportResultDto>
{
    public const string By = "POS";
    public const int MaxLines = 2_000;

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter() } };
    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

    public async Task<ZReportResultDto> Handle(ReceiveZReportCommand request, CancellationToken cancellationToken)
    {
        var report = request.Report;
        var endpoint = request.Source;
        try
        {
            var result = await RecordAsync(report, request.Source, cancellationToken);
            await journal.WriteAsync(new PosSyncLog(endpoint, result.Outcome, Describe(result), report.ZReportId, report.Date,
                JsonSerializer.Serialize(result, Json)), cancellationToken);
            return result;
        }
        catch (DomainException ex)
        {
            await journal.WriteAsync(new PosSyncLog(endpoint, PosSyncOutcome.Refused, ex.Message, report.ZReportId, report.Date), cancellationToken);
            throw;
        }
        catch (NotFoundException ex)
        {
            await journal.WriteAsync(new PosSyncLog(endpoint, PosSyncOutcome.Refused, ex.Message, report.ZReportId, report.Date), cancellationToken);
            throw;
        }
        catch (ConflictException)
        {
            // Run again by the pipeline; logged if it fails for good.
            throw;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            await journal.WriteAsync(new PosSyncLog(endpoint, PosSyncOutcome.Failed, "It could not be recorded: " + ex.GetType().Name, report.ZReportId, report.Date),
                CancellationToken.None);
            throw;
        }
    }

    private async Task<ZReportResultDto> RecordAsync(ZReportInput report, string source, CancellationToken cancellationToken)
    {
        Check(report);
        CheckDate(report.Date);
        var payload = JsonSerializer.Serialize(report, Json);
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(payload))).ToLowerInvariant();

        var existing = await reports.GetByIdAsync(report.ZReportId, cancellationToken);
        if (existing is not null && existing.PayloadHash == hash)
        {
            // Sent again: what it made stands.
            var day = await days.GetByDateAsync(existing.BusinessDate, cancellationToken);
            return Result(report, PosSyncOutcome.Unchanged, day?.SaleId, day?.TakingsId, await SaleAsync(day?.SaleId, cancellationToken), []);
        }

        var known = await SaleWriter.Menu.LoadAsync(menu, cancellationToken);
        var targets = new MenuTargets(known.Items.Values.ToList(), known.AddOns.Values.ToList());

        // Every line placed on the menu first: a report with a line that cannot be is refused whole.
        Place(report, targets, known);

        var moved = existing is not null && existing.BusinessDate != report.Date ? existing.BusinessDate : (DateOnly?)null;
        if (existing is null)
        {
            existing = new PosZReport(report.ZReportId, report.Date, report.ShiftNumber, source, hash, payload);
            reports.Add(existing);
        }
        else
        {
            existing.Replace(report.Date, report.ShiftNumber, source, hash, payload);
        }

        // The day's records from every one of its shifts' reports; a report moved to another day
        // takes its lines off the day it was on.
        if (moved is { } before)
            await RebuildDayAsync(before, existing, targets, known, cancellationToken);
        var (saleId, takingsId, warnings) = await RebuildDayAsync(report.Date, existing, targets, known, cancellationToken);

        await unitOfWork.SaveChangesAsync(cancellationToken);
        var outcome = existing.Revision == 1 ? PosSyncOutcome.Recorded : PosSyncOutcome.Updated;
        return Result(report, outcome, saleId, takingsId, await SaleAsync(saleId, cancellationToken), warnings);
    }

    // The day's sales summary and takings, made again from the reports of that day: what the POS
    // made of it before voided (its stock put back, its takings reversed), the new ones recorded.
    private async Task<(Guid? SaleId, Guid? TakingsId, IReadOnlyList<string> Warnings)> RebuildDayAsync(
        DateOnly date, PosZReport current, MenuTargets targets, SaleWriter.Menu known, CancellationToken cancellationToken)
    {
        var day = await days.GetByDateAsync(date, cancellationToken);
        if (day is null)
        {
            day = new PosDay(Guid.NewGuid(), date);
            days.Add(day);
        }

        // Entered by hand: not the POS's to replace.
        if (await sales.GetDailySummaryAsync(date, cancellationToken) is { } summary && summary.Id != day.SaleId)
            throw new DomainException(
                $"The sales of {Day(date)} were entered by hand ({summary.Lines.Count} items): void them on Sales, then send the Z report again. · " +
                "مبيعات هذا اليوم مُدخلة يدويًا: ألغها من المبيعات ثم أعد إرسال تقرير Z.");
        if (await safe.GetTakingsAsync(date, cancellationToken) is { } takings && takings.Id != day.TakingsId)
            throw new DomainException(
                $"The takings of {Day(date)} were entered by hand ({SaleWriter.Money(takings.TakingsTotal):N2}): void them in the safe, then send the Z report again. · " +
                "إيراد هذا اليوم مُدخل يدويًا: ألغه من الخزنة ثم أعد إرسال تقرير Z.");

        // What the POS made of the day before: voided, unless someone voided it already.
        if (day.SaleId is { } oldSale && await sales.GetByIdAsync(oldSale, cancellationToken) is { IsVoided: false })
            foreach (var reversal in await deletions.DeleteAsync(ApprovalModule.Sale, oldSale, By, cancellationToken))
                movements.Add(reversal);
        if (day.TakingsId is { } oldTakings && await safe.GetByIdAsync(oldTakings, cancellationToken) is { } previous
            && previous.VoidedAtUtc is null && previous.ReversalOf is null)
            await treasury.VoidAsync(previous, By, cancellationToken);

        // Every report of the day: the one in hand as it is now, the rest as kept.
        var dayReports = (await reports.GetByDateAsync(date, cancellationToken))
            .Where(r => r.Id != current.Id)
            .Select(r => JsonSerializer.Deserialize<ZReportInput>(r.Payload, Json)!)
            .ToList();
        if (current.BusinessDate == date)
            dayReports.Add(JsonSerializer.Deserialize<ZReportInput>(current.Payload, Json)!);
        if (dayReports.Count == 0)
        {
            day.Recorded(null, null);
            return (null, null, []);
        }

        // The sales summary: each item sold, and each made and voided after the kitchen, as waste.
        var sold = new Dictionary<(int Item, int? Variant), int>();
        var wasted = new Dictionary<(int Item, int? Variant), int>();
        foreach (var each in dayReports)
        {
            foreach (var item in each.SoldItems)
                Add(sold, Place(item, targets, known), item.Quantity);
            foreach (var item in each.WastedItems ?? [])
                Add(wasted, Place(item, targets, known), item.Quantity);
        }
        var lines = sold.Select(s => new SaleLineInput(s.Key.Item, s.Key.Variant, s.Value))
            .Concat(wasted.Select(w => new SaleLineInput(w.Key.Item, w.Key.Variant, w.Value, Voided: LineVoid.AfterKitchen)))
            .ToList();

        var warnings = new List<string>();
        Guid? saleId = null;
        if (lines.Count > 0)
        {
            var shifts = string.Join(", ", dayReports.Select(r => r.ShiftNumber).OfType<int>().Order());
            var receipt = await saleWriter.RecordAsync(
                new SaleInput(Guid.NewGuid(), null, date, null, SalesChannel.DineIn, PaymentMethod.Cash, lines,
                    Notes: shifts.Length > 0 ? $"POS Z reports, shifts {shifts}" : "POS Z report"),
                SalesSource.DailySummary, By, known, cancellationToken);
            saleId = receipt.Id;
            warnings.AddRange(await WithoutRecipesAsync(lines, known, cancellationToken));
        }

        // The takings: the day's cash, card, tax and voids, every shift's together.
        var cash = dayReports.Sum(r => r.Takings.Cash);
        var card = dayReports.Sum(r => r.Takings.Card);
        var tax = dayReports.Sum(r => r.Takings.Tax);
        var voids = dayReports.Sum(r => r.Takings.VoidsAmount);
        Guid? takingsId = null;
        if (cash + card > 0)
        {
            var reasons = dayReports.SelectMany(r => r.Takings.VoidReasons ?? [])
                .GroupBy(r => r.Reason.Trim(), StringComparer.OrdinalIgnoreCase)
                .Select(g => $"{g.Key} ×{g.Sum(r => r.Count)} {g.Sum(r => r.Amount).ToString("N2", Invariant)}")
                .ToList();
            var notes = "From the POS" + (reasons.Count > 0 ? $" · voids: {string.Join("; ", reasons)}" : "");
            if (notes.Length > SafeTransaction.MaxNotesLength)
                notes = notes[..SafeTransaction.MaxNotesLength];
            var entry = SafeTransaction.RevenueTransfer(
                Guid.NewGuid(), cash, date, date, notes, By, null, null, await safe.PaidOutOfTakingsAsync(date, cancellationToken), card, tax, voids);
            safe.Add(entry);
            takingsId = entry.Id;
        }
        else if (tax > 0)
        {
            throw new DomainException("Tax was collected on a day with no cash or card takings: check the Z report. · ضريبة بدون إيراد.");
        }

        day.Recorded(saleId, takingsId);
        return (saleId, takingsId, warnings);
    }

    // Each line on the menu, or the report refused naming every line that is not.
    private static void Place(ZReportInput report, MenuTargets targets, SaleWriter.Menu known)
    {
        var problems = new List<string>();
        foreach (var item in report.SoldItems.Concat(report.WastedItems ?? []))
        {
            try
            {
                Place(item, targets, known);
            }
            catch (DomainException ex)
            {
                problems.Add(ex.Message);
            }
        }
        if (problems.Count > 0)
            throw new DomainException(
                $"{problems.Count} {(problems.Count == 1 ? "line" : "lines")} of the Z report could not be placed on the menu, so nothing was recorded: " +
                string.Join(" ", problems.Distinct().Take(20)) + " · لم يُسجل شيء: بعض الأصناف غير موجودة في المنيو.");
    }

    private static (int Item, int? Variant) Place(ZReportItem item, MenuTargets targets, SaleWriter.Menu known)
    {
        var code = item.ItemCode?.Trim();
        var label = string.IsNullOrEmpty(code) ? item.Name ?? "(no code)" : code;
        var (target, reason, _) = targets.Find(string.IsNullOrEmpty(code) ? item.Name ?? string.Empty : code);
        if (target is not { } found)
            throw new DomainException(reason ?? $"{label}{(item.Name is { } n && n != label ? $" ({n})" : "")} is not on the menu.");
        if (found.Kind != RecipeTargetKind.MenuItem)
            throw new DomainException($"{label} is an add-on: it is sold on an item, not by itself.");
        var menuItem = known.Items[found.CatalogItemId];
        if (found.VariantId is { } variant)
            return (menuItem.Id, variant);
        if (menuItem.Variants.Count == 0)
            return (menuItem.Id, null);
        // Sold by size, the size by its name.
        var size = item.Size?.Trim();
        var match = size is null ? null : menuItem.Variants.SingleOrDefault(v =>
            string.Equals(v.Name, size, StringComparison.OrdinalIgnoreCase) || string.Equals(v.NameAr, size, StringComparison.OrdinalIgnoreCase));
        return match is not null
            ? (menuItem.Id, match.Id)
            : throw new DomainException(size is null
                ? $"{label} ({menuItem.Name}) is sold by size: send its size code ({string.Join(", ", menuItem.Variants.Select(v => $"{menuItem.Id}-{v.Id} {v.Name}"))})."
                : $"{menuItem.Name} has no size {size}: its sizes are {string.Join(", ", menuItem.Variants.Select(v => v.Name))}.");
    }

    private static void Check(ZReportInput report)
    {
        if (report.ZReportId == Guid.Empty)
            throw new DomainException("A Z report needs its id (the POS shift's), so a resend is known for one.");
        if (report.Takings is null)
            throw new DomainException("A Z report needs its takings.");
        var t = report.Takings;
        if (t.Cash < 0 || t.Card < 0 || t.Tax < 0 || t.VoidsAmount < 0)
            throw new DomainException("The cash, card, tax and voids are zero or more. · المبالغ صفر أو أكثر.");
        if (t.Tax > t.Cash + t.Card)
            throw new DomainException("The tax collected cannot be more than the day's sales. · الضريبة لا تزيد عن إجمالي المبيعات.");
        var lines = report.SoldItems ?? throw new DomainException("A Z report lists its sold items (none: an empty list).");
        if (lines.Count + (report.WastedItems?.Count ?? 0) > MaxLines)
            throw new DomainException($"A Z report has {MaxLines:N0} lines at most.");
        if (lines.Concat(report.WastedItems ?? []).Any(l => l.Quantity < 1))
            throw new DomainException("Each item's quantity is 1 or more.");
    }

    private void CheckDate(DateOnly date)
    {
        var now = DateTime.UtcNow;
        var latest = new[] { calendar.BusinessDateOf(now), calendar.LocalDateOf(now) }.Max();
        if (date > latest)
            throw new DomainException($"{Day(date)} has not come yet here: check the POS's date and time zone.");
    }

    private async Task<IReadOnlyList<string>> WithoutRecipesAsync(IReadOnlyList<SaleLineInput> lines, SaleWriter.Menu known, CancellationToken cancellationToken)
    {
        var items = lines.Select(l => new SoldItem(l.MenuItemId, l.VariantId, [], l.Quantity)).ToList();
        var relevant = await recipes.GetByTargetsAsync(StockRequirements.TargetsFor(items), cancellationToken);
        return items.Where(i => StockRequirements.For(i, relevant).Count == 0)
            .Select(i => known.Items[i.MenuItemId] is var item && i.VariantId is { } v
                ? $"{item.Name} ({item.Variants.Single(x => x.Id == v).Name})"
                : known.Items[i.MenuItemId].Name)
            .Distinct()
            .Select(name => $"{name} has no recipe: no stock was taken for it.")
            .ToList();
    }

    private async Task<SalesReceipt?> SaleAsync(Guid? id, CancellationToken cancellationToken) =>
        id is { } saleId ? await sales.GetByIdAsync(saleId, cancellationToken) : null;

    private static ZReportResultDto Result(ZReportInput report, PosSyncOutcome outcome, Guid? saleId, Guid? takingsId, SalesReceipt? sale, IReadOnlyList<string> warnings) =>
        new(report.ZReportId, report.Date, outcome, saleId, takingsId,
            sale?.Lines.Count(l => l.OnBill) ?? 0, sale?.Lines.Where(l => l.OnBill).Sum(l => l.Quantity) ?? 0,
            sale?.Lines.Where(l => !l.OnBill).Sum(l => l.Quantity) ?? 0, sale?.BilledSubtotal ?? 0,
            report.Takings.Cash, report.Takings.Card, report.Takings.Tax, warnings);

    private static string Describe(ZReportResultDto r) => r.Outcome switch
    {
        PosSyncOutcome.Unchanged => $"Z report of {Day(r.Date)} sent again: nothing changed.",
        _ => $"Z report of {Day(r.Date)} {(r.Outcome == PosSyncOutcome.Updated ? "updated" : "recorded")}: {r.Quantity} sold of {r.Items} items" +
             (r.Wasted > 0 ? $", {r.Wasted} wasted" : "") +
             $"; takings {r.Cash.ToString("N2", Invariant)} cash, {r.Card.ToString("N2", Invariant)} card, {r.Tax.ToString("N2", Invariant)} tax" +
             (r.Warnings.Count > 0 ? $". {r.Warnings.Count} without a recipe." : "."),
    };

    private static void Add(Dictionary<(int, int?), int> into, (int, int?) key, int quantity) =>
        into[key] = into.GetValueOrDefault(key) + quantity;

    private static string Day(DateOnly date) => date.ToString("d MMM yyyy", Invariant);
}

// ---- The POS's own event envelope (POST …/events) ----

// What the POS sends every linked system: {id, kind, branchCode, occurredAtUtc, data}. Costing uses
// day.closed (a shift's Z report); any other kind is answered and left.
public static class PosEvents
{
    public const string DayClosed = "day.closed";

    public static ZReportInput DayClosedReport(JsonElement data)
    {
        var shiftId = Guid(data, "shiftId");
        var date = DateOnly.Parse(Text(data, "businessDate") ?? throw new DomainException("day.closed has no businessDate."), CultureInfo.InvariantCulture);
        var takings = data.TryGetProperty("takings", out var t) ? t : throw new DomainException("day.closed has no takings.");
        var before = Number(Child(takings, "voidsBefore"), "amount");
        var after = Child(takings, "voidsAfter");
        var reasons = new List<ZReportVoidReason>();
        if (after is { } a && a.TryGetProperty("reasons", out var listed) && listed.ValueKind == JsonValueKind.Array)
            reasons.AddRange(listed.EnumerateArray().Select(r =>
                new ZReportVoidReason(Text(r, "reason") ?? "No reason", (int)Number(r, "count"), Number(r, "amount"))));
        if (Number(Child(takings, "voidsBefore"), "count") is var count and > 0)
            reasons.Add(new ZReportVoidReason("Before kitchen", (int)count, before));

        return new ZReportInput(
            shiftId, date, data.TryGetProperty("shiftNumber", out var n) && n.ValueKind == JsonValueKind.Number ? n.GetInt32() : null,
            new ZReportTakings(Number(takings, "cash"), Number(takings, "card"), Number(takings, "tax"), before + Number(after, "amount"), reasons),
            Items(data, "soldItems"), Items(data, "waste"));
    }

    private static IReadOnlyList<ZReportItem> Items(JsonElement data, string name) =>
        data.TryGetProperty(name, out var list) && list.ValueKind == JsonValueKind.Array
            ? list.EnumerateArray().Select(i => new ZReportItem(
                Text(i, "itemCode") ?? (i.TryGetProperty("code", out var c) ? c.ToString() : string.Empty),
                (int)Number(i, "quantity"), Text(i, "size"), Text(i, "name"), Text(i, "reason"))).ToList()
            : [];

    private static JsonElement? Child(JsonElement element, string name) =>
        element.TryGetProperty(name, out var child) && child.ValueKind == JsonValueKind.Object ? child : null;

    private static string? Text(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static decimal Number(JsonElement? element, string name) =>
        element is { } e && e.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number ? value.GetDecimal() : 0;

    private static System.Guid Guid(JsonElement element, string name) =>
        Text(element, name) is { } text && System.Guid.TryParse(text, out var id) ? id : throw new DomainException($"day.closed has no {name}.");
}
```


> 📄 **`backend/src/Costing.Infrastructure/Persistence/PosIntegrationPersistence.cs`** — 109 سطر

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.Extensions.DependencyInjection;
using Costing.Domain.Integrations;
using Costing.Infrastructure.Persistence.Configurations;

namespace Costing.Infrastructure.Persistence;

internal sealed class PosLinkConfiguration : IEntityTypeConfiguration<PosLink>
{
    public void Configure(EntityTypeBuilder<PosLink> builder)
    {
        builder.ToTable("PosLinks", CostingDbContext.CostingSchema);
        builder.Property(l => l.KeyHash).HasMaxLength(PosLink.HashLength);
        builder.Property(l => l.KeyHint).HasMaxLength(PosLink.HintLength + 4);
        builder.Property(l => l.KeyCreatedBy).HasMaxLength(200);
        builder.Ignore(l => l.HasKey);
    }
}

internal sealed class PosZReportConfiguration : IEntityTypeConfiguration<PosZReport>
{
    public void Configure(EntityTypeBuilder<PosZReport> builder)
    {
        builder.ToTable("PosZReports", CostingDbContext.CostingSchema);
        builder.Property(r => r.Source).HasMaxLength(40);
        builder.Property(r => r.PayloadHash).HasMaxLength(64);
        builder.Property(r => r.Payload).HasColumnType("text");
        builder.HasIndex(r => r.BusinessDate);
    }
}

internal sealed class PosDayConfiguration : IEntityTypeConfiguration<PosDay>
{
    public void Configure(EntityTypeBuilder<PosDay> builder)
    {
        builder.ToTable("PosDays", CostingDbContext.CostingSchema);
        // One a business day.
        builder.HasIndex(d => d.Date).IsUnique();
    }
}

internal sealed class PosSyncLogConfiguration : IEntityTypeConfiguration<PosSyncLog>
{
    public void Configure(EntityTypeBuilder<PosSyncLog> builder)
    {
        builder.ToTable("PosSyncLogs", CostingDbContext.CostingSchema);
        builder.HasKey(l => l.Id);
        builder.Property(l => l.Id).ValueGeneratedNever();
        builder.Property(l => l.Endpoint).HasMaxLength(60);
        builder.Property(l => l.Outcome).IsEnumName();
        builder.Property(l => l.Message).HasMaxLength(PosSyncLog.MaxMessage);
        builder.Property(l => l.Detail).HasMaxLength(PosSyncLog.MaxDetail);
        builder.HasIndex(l => l.AtUtc);
    }
}

internal sealed class PosLinkStore(CostingDbContext db) : IPosLinkStore
{
    // Made the first time it is asked for, and kept by this unit of work.
    public async Task<PosLink> GetAsync(CancellationToken cancellationToken = default)
    {
        if (db.PosLinks.Local.FirstOrDefault() is { } local)
            return local;
        if (await db.PosLinks.SingleOrDefaultAsync(l => l.Id == PosLink.SingletonId, cancellationToken) is { } kept)
            return kept;
        var made = PosLink.Create();
        db.PosLinks.Add(made);
        return made;
    }
}

internal sealed class PosZReportRepository(CostingDbContext db) : IPosZReportRepository
{
    public Task<PosZReport?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        db.PosZReports.SingleOrDefaultAsync(r => r.Id == id, cancellationToken);

    public void Add(PosZReport aggregate) => db.PosZReports.Add(aggregate);

    public async Task<IReadOnlyList<PosZReport>> GetByDateAsync(DateOnly date, CancellationToken cancellationToken = default) =>
        await db.PosZReports.Where(r => r.BusinessDate == date).OrderBy(r => r.ReceivedAtUtc).ToListAsync(cancellationToken);
}

internal sealed class PosDayRepository(CostingDbContext db) : IPosDayRepository
{
    public Task<PosDay?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        db.PosDays.SingleOrDefaultAsync(d => d.Id == id, cancellationToken);

    public void Add(PosDay aggregate) => db.PosDays.Add(aggregate);

    public async Task<PosDay?> GetByDateAsync(DateOnly date, CancellationToken cancellationToken = default) =>
        db.PosDays.Local.FirstOrDefault(d => d.Date == date) ?? await db.PosDays.SingleOrDefaultAsync(d => d.Date == date, cancellationToken);
}

// The log, saved in a context of its own: what the call itself did is saved or thrown away with
// the call, and the log of it stays either way.
internal sealed class PosSyncJournal(IServiceScopeFactory scopes, CostingDbContext db) : IPosSyncJournal
{
    public async Task WriteAsync(PosSyncLog entry, CancellationToken cancellationToken = default)
    {
        await using var scope = scopes.CreateAsyncScope();
        var own = scope.ServiceProvider.GetRequiredService<CostingDbContext>();
        own.PosSyncLogs.Add(entry);
        await own.SaveChangesAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<PosSyncLog>> RecentAsync(int count, CancellationToken cancellationToken = default) =>
        await db.PosSyncLogs.AsNoTracking().OrderByDescending(l => l.AtUtc).Take(count).ToListAsync(cancellationToken);
}
```


`PosIntegrationController`: `PosKeyFilter` (Action Filter يتحقق من المفتاح ويسجل الرفض بلا المفتاح نفسه)، ونماذج الطلب، و `PosIntegrationSettingsController` لصفحة الإعدادات.

> 📄 **`backend/src/Costing.Api/Controllers/PosIntegrationController.cs`** — 155 سطر

```csharp
using System.Text.Json;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Costing.Api.Auth;
using Costing.Application.Company;
using Costing.Application.Integrations;
using Costing.Domain.Access;
using Costing.Domain.Common;
using Costing.Domain.Integrations;

namespace Costing.Api.Controllers;

// What the restaurant's POS calls (api/integrations/pos), proving itself with the key made on
// Settings → POS Integration, in X-API-Key (or X-Pos-Node-Key, as the POS also sends it):
//   GET  ping       the link test
//   GET  menu       the menu, for the POS to take as its own
//   POST z-report   a shift's Z report
//   POST events     the POS's own envelope; day.closed is a shift's Z report
// No user signs in for these. A wrong key, or none, is refused and logged.
[ApiController]
[Route("api/integrations/pos")]
[AllowAnonymous]
[TypeFilter(typeof(PosKeyFilter))]
public sealed class PosIntegrationController(ISender sender, IPosSyncJournal journal) : ControllerBase
{
    [HttpGet("ping")]
    public async Task<IActionResult> Ping(CancellationToken cancellationToken)
    {
        var company = await sender.Send(new GetCompanySettingsQuery(), cancellationToken);
        await journal.WriteAsync(new PosSyncLog("ping", PosSyncOutcome.Served, "Link tested from the POS."), cancellationToken);
        return Ok(new { ok = true, system = "Costing", company = company.Name, atUtc = DateTime.UtcNow });
    }

    [HttpGet("menu")]
    public async Task<PosMenuDto> Menu(CancellationToken cancellationToken)
    {
        var menu = await sender.Send(new GetPosMenuQuery(), cancellationToken);
        await journal.WriteAsync(new PosSyncLog("menu", PosSyncOutcome.Served,
            $"Menu read by the POS: {menu.Items.Count} items, {menu.Items.Sum(i => i.Sizes.Count)} sizes, {menu.Categories.Count} categories."), cancellationToken);
        return menu;
    }

    [HttpPost("z-report")]
    public Task<IActionResult> ZReport(ZReportRequest request, CancellationToken cancellationToken) =>
        ReceiveAsync(request.ToInput(), "z-report", cancellationToken);

    [HttpPost("events")]
    public async Task<IActionResult> Event(JsonElement envelope, CancellationToken cancellationToken)
    {
        var kind = envelope.TryGetProperty("kind", out var k) && k.ValueKind == JsonValueKind.String ? k.GetString() : null;
        if (kind != PosEvents.DayClosed || !envelope.TryGetProperty("data", out var data))
        {
            await journal.WriteAsync(new PosSyncLog("events", PosSyncOutcome.Served, $"Event {kind ?? "(no kind)"} received: Costing does not use it."), cancellationToken);
            return Accepted();
        }

        ZReportInput report;
        try
        {
            report = PosEvents.DayClosedReport(data);
        }
        catch (Exception ex) when (ex is DomainException or FormatException or InvalidOperationException)
        {
            await journal.WriteAsync(new PosSyncLog("events", PosSyncOutcome.Refused, "day.closed could not be read: " + ex.Message), cancellationToken);
            return UnprocessableEntity(new { errors = new[] { "day.closed could not be read: " + ex.Message } });
        }
        return await ReceiveAsync(report, "events", cancellationToken);
    }

    // Refused (a business rule): 422, and the POS keeps it as failed until it is sent again.
    // Collided with a change at the same time, for good: 503, so the POS tries again; a 409 would
    // tell it the report was had already.
    private async Task<IActionResult> ReceiveAsync(ZReportInput report, string source, CancellationToken cancellationToken)
    {
        try
        {
            return Ok(await sender.Send(new ReceiveZReportCommand(report, source), cancellationToken));
        }
        catch (ConflictException)
        {
            await journal.WriteAsync(new PosSyncLog(source, PosSyncOutcome.Failed, "Busy with another change: the POS will send it again.",
                report.ZReportId, report.Date), CancellationToken.None);
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { errors = new[] { "Busy: send it again in a moment." } });
        }
    }
}

// The key in X-API-Key, checked against the hash kept; a wrong one, or none, answered 401 and
// logged. Never logs the key.
public sealed class PosKeyFilter(ISender sender, IPosSyncJournal journal) : IAsyncActionFilter
{
    public static readonly string[] Headers = ["X-API-Key", "X-Pos-Node-Key"];

    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var request = context.HttpContext.Request;
        var key = Headers.Select(h => request.Headers[h].ToString()).FirstOrDefault(v => !string.IsNullOrWhiteSpace(v));
        if (!await sender.Send(new VerifyPosKeyQuery(key), context.HttpContext.RequestAborted))
        {
            var endpoint = request.Path.Value?.Split('/').LastOrDefault() ?? "pos";
            await journal.WriteAsync(new PosSyncLog(endpoint, PosSyncOutcome.Unauthorized,
                key is null ? "Refused: no X-API-Key." : "Refused: the X-API-Key is not this system's key (make one on Settings → POS Integration).",
                detail: $"From {context.HttpContext.Connection.RemoteIpAddress}"), context.HttpContext.RequestAborted);
            context.Result = new UnauthorizedObjectResult(new { errors = new[] { "Send this system's POS key in X-API-Key." } });
            return;
        }
        await next();
    }
}

// The Z report as the POS sends it here (POST z-report). The cash and card are before tax, the tax
// collected on them, as the safe keeps a day's takings. Codes: 6101, a size 6101-17 (or the item's
// code and its size by name).
public sealed record ZReportRequest(
    Guid ZReportId, DateOnly Date, int? ShiftNumber, ZReportTakingsRequest? Takings, IReadOnlyList<ZReportSoldItem>? SoldItems,
    IReadOnlyList<ZReportWastedItem>? WastedItems)
{
    public ZReportInput ToInput() => new(
        ZReportId, Date, ShiftNumber,
        Takings is { } t ? new ZReportTakings(t.TotalCash, t.TotalCard, t.TotalTax, t.VoidsAmount, t.VoidReasons) : null!,
        (SoldItems ?? []).Select(i => new ZReportItem(Code(i.ItemCode), i.QuantitySold, i.Size, i.Name)).ToList(),
        (WastedItems ?? []).Select(i => new ZReportItem(Code(i.ItemCode), i.Quantity, i.Size, i.Name, i.Reason)).ToList());

    // A code written as a number or as text.
    private static string Code(JsonElement? code) => code switch
    {
        { ValueKind: JsonValueKind.String } text => text.GetString() ?? string.Empty,
        { ValueKind: JsonValueKind.Number } number => number.GetRawText(),
        _ => string.Empty,
    };
}

public sealed record ZReportTakingsRequest(decimal TotalCash, decimal TotalCard, decimal TotalTax, decimal VoidsAmount, IReadOnlyList<ZReportVoidReason>? VoidReasons);

public sealed record ZReportSoldItem(JsonElement? ItemCode, int QuantitySold, string? Size = null, string? Name = null);

public sealed record ZReportWastedItem(JsonElement? ItemCode, int Quantity, string? Size = null, string? Name = null, string? Reason = null);

// Settings → POS Integration, a manager's: the key (made, or made again) and the sync log.
[ApiController]
[Route("api/settings/pos-integration")]
[Authorize(Policy = Permissions.SettingsManage)]
public sealed class PosIntegrationSettingsController(ISender sender) : ControllerBase
{
    [HttpGet]
    public Task<PosIntegrationDto> Get([FromQuery] int logs = 200, CancellationToken cancellationToken = default) =>
        sender.Send(new GetPosIntegrationQuery(logs), cancellationToken);

    // A new key, shown this once: the one before stops working.
    [HttpPost("key")]
    public Task<PosKeyDto> NewKey(CancellationToken cancellationToken) =>
        sender.Send(new GeneratePosKeyCommand(User.FindFirst(UserClaims.Name)?.Value ?? string.Empty), cancellationToken);
}
```


---

## 3. الربط ثنائي الاتجاه مع الموارد البشرية (HR Link)

### 3.1 الاتجاهان

| الاتجاه | النداء | متى |
| --- | --- | --- |
| HR ⇐ هنا | `GET {hr}/api/integrations/hr/employees` | قراءة الموظفين: عند التفعيل، كل 6 ساعات، أو "مزامنة الآن" |
| HR ⇐ هنا | `GET {hr}/api/integrations/costing/ping` | اختبار الاتصال |
| هنا ⇐ HR | `POST /api/integrations/hr/payroll-run` | HR اعتمد مسير شهر |
| هنا ⇐ HR | `GET /api/integrations/hr/ping` | اختبار من HR |
| HR ⇐ هنا (Outbox) | `POST {hr}/api/integrations/costing/employee-advance` | سلفة صُرفت من الخزنة (مع الإيصال) أو أُلغيت |
| HR ⇐ هنا (Outbox) | `POST {hr}/api/integrations/costing/employee-deduction` | عجز خزنة أو خصم، أو إلغاؤه |
| HR ⇐ هنا (Outbox) | `POST {hr}/api/integrations/costing/payroll-settled` | صُرف المسير من الخزنة، أو أُلغي الصرف |

**مغلق افتراضيًا:** بدون تفعيل، الموظفون يُدارون هنا، ولا شيء يُرسل أو يُستقبل.

### 3.2 مفتاحان، ومعاملتان مختلفتان

1. **مفتاحنا لـ HR (`chr_…`)**: نصنعه ونعرضه مرة، ونخزن **SHA-256 فقط**، ونقارن بزمن ثابت. (المفتاح 256 بت عشوائي، فالـ Hash السريع آمن؛ البطء ضروري لكلمات المرور الضعيفة فقط.)
2. **مفتاح HR لنا**: نحتاجه **كما هو** لنرسله في `X-API-Key`، فنخزنه **مشفّرًا بـ AES-GCM**:

```text
المفتاح = HKDF-SHA256(Auth:SigningKey, 32 بايت, info = "Costing.HrLink.Key")
التشفير: nonce عشوائي 12 بايت، tag 16 بايت
المخزّن = "v1." + Base64(nonce ‖ tag ‖ ciphertext)
```

- **GCM** يعطي سرية **وسلامة**: أي تعديل في النص المشفر يفشل عند فك التشفير (الـ tag).
- **HKDF** يشتق مفتاح تشفير مخصصًا لهذا الاستخدام من السر الموجود، بدل إعادة استخدام مفتاح توقيع JWT كما هو.
- **`v1.`** نسخة الصيغة، لتغيير الخوارزمية مستقبلًا مع قراءة القديم.
- تغيير `Auth:SigningKey` يجعل المفتاح غير مقروء ⇐ يُلصق من جديد (رسالة واضحة).

### 3.3 مزامنة الموظفين

`SyncHrEmployeesCommand`: كل موظف من HR يصبح `SyncedEmployee` مرتبطًا بـ `StaffMember` هنا (موظف محلي بنفس الاسم من قبل الربط **يُربط** بدل تكرار)، بكوده وقسمه، ويُحدّث عند التغير (والعدّاد "تغيّر" يحسب ما تغيّر فعلًا فقط)، ومن اختفى من قائمة HR يُعلَّم "ترك العمل". أثناء الربط: لا تعديل للموظفين هنا ولا إضافة محلية.

### 3.4 مسير الرواتب من HR

```json
{ "idempotencyKey": "…", "payrollPeriod": "2026-10", "employees": 3,
  "totalGrossWages": 18000, "totalAdditions": 0, "totalPenalties": 15680,
  "totalAdvancesDeducted": 0, "totalBroughtForward": 0, "netCashPayable": 2320,
  "departments": [{ "department": "Hall", "employees": 2, "...": "..." }] }
```

- **تكلفة العمالة** = الإجمالي + الإضافات − الجزاءات ⇐ أجور الشهر في الـ KPIs وقائمة الدخل **بدلًا** من الرواتب المصروفة (لا الاثنان).
- **صافي النقدية المستحق** يُصرف من الخزنة **مرة واحدة** بقيد `PayrollPayment` (المدير فورًا، غيره طلب).
- **لا خصم مزدوج للسلف:** السلف خرجت من الخزنة وقت صرفها، و HR خصمها من صافي الرواتب؛ فالمسير يُصرف بالصافي فقط، والسلف ليست مصروفًا أصلًا.
- نفس المسير مرة أخرى (نفس الـ hash) ⇐ `Unchanged`؛ معدّل قبل الصرف ⇐ يُستبدل (`Updated`، والمراجعة تزيد)؛ بعد الصرف ⇐ مرفوض.

### 3.5 `HrOutbox`: الطابور الصادر

**لماذا لا نستدعي HR مباشرة عند صرف السلفة؟** لأن HR قد يكون متوقفًا، أو تنقطع الشبكة بعد أن يستلم وقبل الرد. الحل **Transactional Outbox**:

```text
TreasuryWriter.ApplyAsync(سلفة) ──► قيد الخزنة + عنصر في HrOutbox  ← في نفس الحفظ (معًا أو لا شيء)
HrSyncWorker (كل 10 ثوانٍ) ──► HrOutboxSender.SendDueAsync():
    المستحق بالترتيب (25 كل مرة)، كلٌّ بـ Idempotency-Key = معرّف قيد الخزنة
    السلفة من تقفيل اليوم: يُقرأ إيصالها من EndOfDayPhotos ويُرسل Base64 مع الرسالة
    2xx أو 409 ⇐ Sent
    400/401/403/404/422 ⇐ Failed بسبب HR (ينتظر "أعد المحاولة")
    شبكة/5xx ⇐ إعادة بعد 15ث، تتضاعف حتى 10 دقائق، ويتوقف الباقي للحفاظ على الترتيب
```

ومع الـ Idempotency عند HR (يحفظ السلفة بنفس المعرّف)، "مرة على الأقل" تصبح عمليًا "مرة واحدة بالضبط". والإلغاء يُرسل بنفس المفتاح و `action: "void"`. **سجل المزامنة** (`HrSyncLogs`) يُكتب في Scope مستقل حتى يبقى سجل الرفض رغم إلغاء معاملة الطلب.

> 📄 **`backend/src/Costing.Domain/Integrations/HrIntegration.cs`** — 320 سطر

```csharp
using Costing.Domain.Common;

namespace Costing.Domain.Integrations;

// The HR & payroll system, linked (ربط الموارد البشرية), both ways and only when it is switched on:
// this system reads HR's employees and is sent each payroll run HR approves; HR is sent each
// advance paid out of the safe here, each deduction charged to an employee, and each payroll paid
// out of the safe. Unlinked, or switched off, nothing is sent or read, and every screen works on
// the staff kept here.
//
// Two keys, one each way: HR's (HrKey), made on HR and pasted here, which this system calls HR
// with, kept encrypted (HrKeyProtected, by the data protection keys of this server, never in
// plain); and this system's (KeyHash), made here and pasted into HR, which HR calls this system
// with, kept only as its hash.
public sealed class HrLink : AggregateRoot
{
    public static readonly Guid SingletonId = new("3b8a5f20-9c41-4e6d-8a77-2f10c4d9e6b1");
    public const int HashLength = 64;
    public const int HintLength = 12;
    public const int MaxUrlLength = 300;

    private HrLink() { }

    public static HrLink Create() => new() { Id = SingletonId };

    public bool Enabled { get; private set; }
    public string? BaseUrl { get; private set; }

    // HR's key, encrypted; and its last characters, to tell which one it is.
    public string? HrKeyProtected { get; private set; }
    public string? HrKeyHint { get; private set; }

    // This system's key for HR: its hash and its last characters.
    public string? KeyHash { get; private set; }
    public string? KeyHint { get; private set; }
    public DateTime? KeyCreatedAtUtc { get; private set; }
    public string? KeyCreatedBy { get; private set; }

    public DateTime? EmployeesSyncedAtUtc { get; private set; }
    public int EmployeesSynced { get; private set; }

    public DateTime? UpdatedAtUtc { get; private set; }
    public string? UpdatedBy { get; private set; }

    public bool HasKey => KeyHash is not null;

    // Ready to call HR: switched on, its address and its key given.
    public bool IsReady => Enabled && BaseUrl is not null && HrKeyProtected is not null;

    // Switched on or off, HR's address, and HR's key when a new one is given (kept as it was when
    // none is). Switched on, it needs both.
    public void Configure(bool enabled, string? baseUrl, string? hrKeyProtected, string? hrKeyHint, string by)
    {
        var url = string.IsNullOrWhiteSpace(baseUrl) ? null : baseUrl.Trim().TrimEnd('/');
        if (url is not null)
        {
            if (url.Length > MaxUrlLength)
                throw new DomainException("Keep HR's address under 300 characters.");
            if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
                throw new DomainException("HR's address starts with http:// or https://, as https://hr.example.com. · عنوان الموارد البشرية يبدأ بـ https://");
        }
        if (hrKeyProtected is not null)
            (HrKeyProtected, HrKeyHint) = (hrKeyProtected, hrKeyHint?.Length > HintLength ? hrKeyHint[^HintLength..] : hrKeyHint);
        if (enabled && (url is null || HrKeyProtected is null))
            throw new DomainException("To switch the link on, give HR's address and HR's key. · أدخل عنوان الموارد البشرية ومفتاحها أولاً.");
        Enabled = enabled;
        BaseUrl = url;
        UpdatedAtUtc = DateTime.UtcNow;
        UpdatedBy = by;
    }

    // A new key for HR: the one before stops working at once.
    public void SetKey(string hash, string hint, string by)
    {
        if (hash.Length != HashLength)
            throw new DomainException("A key's hash is 64 hex characters.");
        KeyHash = hash;
        KeyHint = hint.Length > HintLength ? hint[^HintLength..] : hint;
        KeyCreatedAtUtc = DateTime.UtcNow;
        KeyCreatedBy = by;
    }

    public void Synced(int employees)
    {
        EmployeesSynced = employees;
        EmployeesSyncedAtUtc = DateTime.UtcNow;
    }
}

// An employee as HR has them, kept here so the lists that choose one work at once, even with HR
// out of reach: their HR id and code, name, department, branch and whether they still work. Each
// is a staff member here too (StaffMemberId), as the safe's advances and salaries name staff.
public sealed class SyncedEmployee : AggregateRoot
{
    public const int MaxNameLength = 200;
    public const int MaxCodeLength = 50;

    private SyncedEmployee() { }

    public SyncedEmployee(Guid id, Guid hrEmployeeId, Guid staffMemberId)
    {
        if (hrEmployeeId == Guid.Empty)
            throw new DomainException("An employee from HR needs HR's id for them.");
        Id = id;
        HrEmployeeId = hrEmployeeId;
        StaffMemberId = staffMemberId;
    }

    public Guid HrEmployeeId { get; private set; }
    public Guid StaffMemberId { get; private set; }
    public string? Code { get; private set; }
    public string FullName { get; private set; } = string.Empty;
    public string? Department { get; private set; }
    public string? Branch { get; private set; }
    public bool IsActive { get; private set; }
    public DateTime SyncedAtUtc { get; private set; }

    // As HR has them now; whether anything changed.
    public bool Update(string? code, string fullName, string? department, string? branch, bool isActive)
    {
        var name = fullName?.Trim();
        if (string.IsNullOrEmpty(name))
            throw new DomainException("An employee from HR needs a name.");
        name = name.Length > MaxNameLength ? name[..MaxNameLength] : name;
        var (newCode, newDepartment, newBranch) = (Short(code, MaxCodeLength), Short(department, 100), Short(branch, 100));
        var changed = name != FullName || newCode != Code || newDepartment != Department || newBranch != Branch || isActive != IsActive;
        (FullName, Code, Department, Branch, IsActive) = (name, newCode, newDepartment, newBranch, isActive);
        SyncedAtUtc = DateTime.UtcNow;
        return changed;
    }

    // No longer on HR's list: left.
    public void Gone()
    {
        IsActive = false;
        SyncedAtUtc = DateTime.UtcNow;
    }

    private static string? Short(string? value, int max) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim() is { } v && v.Length > max ? v[..max] : value.Trim();
}

public enum HrSyncDirection
{
    // HR called this system.
    Inbound = 1,

    // This system called HR.
    Outbound = 2,
}

public enum HrSyncOutcome
{
    // Read: the link tested, the employees listed.
    Read = 1,

    // Taken in: a payroll run recorded, or the same one again (Unchanged), or changed (Updated).
    Recorded = 2,
    Unchanged = 3,
    Updated = 4,

    // Sent to HR, and HR took it.
    Sent = 5,

    // Not taken, and nothing recorded: why is in the message.
    Refused = 6,

    // Could not be done now: HR out of reach, or an error; tried again.
    Failed = 7,

    // A call without this system's key, or with a wrong one.
    Unauthorized = 8,
}

// Each call between the two systems, either way, refused ones too: what, when, how it went.
public sealed class HrSyncLog
{
    public const int MaxMessageLength = 500;

    private HrSyncLog() { }

    public HrSyncLog(HrSyncDirection direction, string call, HrSyncOutcome outcome, string message, Guid? reference = null, string? detail = null)
    {
        Id = Guid.NewGuid();
        AtUtc = DateTime.UtcNow;
        Direction = direction;
        Call = call.Length > 60 ? call[..60] : call;
        Outcome = outcome;
        Message = message.Length > MaxMessageLength ? message[..MaxMessageLength] : message;
        Reference = reference;
        Detail = detail is { Length: > 2000 } ? detail[..2000] : detail;
    }

    public Guid Id { get; private set; }
    public DateTime AtUtc { get; private set; }
    public HrSyncDirection Direction { get; private set; }
    public string Call { get; private set; } = string.Empty;
    public HrSyncOutcome Outcome { get; private set; }
    public string Message { get; private set; } = string.Empty;
    public Guid? Reference { get; private set; }
    public string? Detail { get; private set; }
}

public enum HrOutboxStatus
{
    // Waiting to be sent, or to be tried again (NextAttemptAtUtc).
    Pending = 1,

    // HR took it.
    Sent = 2,

    // HR refused it, saying why: kept, to be sent again by hand once put right.
    Failed = 3,
}

// What waits to be sent to HR, oldest first, each once: an advance, its void, a deduction, a
// payroll paid. IdempotencyKey is the record's own id here (the advance's safe entry, the
// deduction, the payroll run), the same each time it is sent, so HR keeps it once; Action says
// whether it is made or voided. Out of reach, it is tried again from 15 seconds, doubling, up to
// 10 minutes apart.
public sealed class HrOutboxItem : AggregateRoot
{
    public const int MaxSummaryLength = 200;

    private HrOutboxItem() { }

    public HrOutboxItem(Guid id, string kind, string action, Guid idempotencyKey, string payload, string summary)
    {
        Id = id;
        Kind = kind;
        Action = action;
        IdempotencyKey = idempotencyKey;
        Payload = payload;
        Summary = summary.Length > MaxSummaryLength ? summary[..MaxSummaryLength] : summary;
        Status = HrOutboxStatus.Pending;
        CreatedAtUtc = NextAttemptAtUtc = DateTime.UtcNow;
    }

    // employee-advance, employee-deduction or payroll-settled: the HR endpoint it goes to.
    public string Kind { get; private set; } = string.Empty;

    // create or void.
    public string Action { get; private set; } = string.Empty;
    public Guid IdempotencyKey { get; private set; }
    public string Payload { get; private set; } = string.Empty;
    public string Summary { get; private set; } = string.Empty;
    public HrOutboxStatus Status { get; private set; }
    public int Attempts { get; private set; }
    public DateTime NextAttemptAtUtc { get; private set; }
    public string? LastError { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime? SentAtUtc { get; private set; }

    public void Delivered()
    {
        Attempts++;
        Status = HrOutboxStatus.Sent;
        SentAtUtc = DateTime.UtcNow;
        LastError = null;
    }

    // Out of reach: again later, from 15 seconds, doubling, up to 10 minutes apart.
    public void Postponed(string error)
    {
        Attempts++;
        LastError = Trim(error);
        var wait = TimeSpan.FromSeconds(Math.Min(600, 15 * Math.Pow(2, Math.Min(Attempts - 1, 10))));
        NextAttemptAtUtc = DateTime.UtcNow + wait;
    }

    // Refused by HR: kept, to be sent again once put right.
    public void Refused(string error)
    {
        Attempts++;
        Status = HrOutboxStatus.Failed;
        LastError = Trim(error);
    }

    public void Retry()
    {
        if (Status == HrOutboxStatus.Sent)
            throw new DomainException("It was sent already.");
        Status = HrOutboxStatus.Pending;
        NextAttemptAtUtc = DateTime.UtcNow;
    }

    private static string Trim(string error) => error.Length > 500 ? error[..500] : error;
}

public interface IHrLinkStore
{
    // The link, made the first time it is asked for.
    Task<HrLink> GetAsync(CancellationToken cancellationToken = default);
}

public interface ISyncedEmployeeRepository : IRepository<SyncedEmployee>
{
    Task<IReadOnlyList<SyncedEmployee>> GetAllAsync(CancellationToken cancellationToken = default);

    Task<SyncedEmployee?> GetByStaffMemberAsync(Guid staffMemberId, CancellationToken cancellationToken = default);
}

public interface IHrOutboxRepository : IRepository<HrOutboxItem>
{
    // Due now, oldest first.
    Task<IReadOnlyList<HrOutboxItem>> GetDueAsync(DateTime nowUtc, int take, CancellationToken cancellationToken = default);

    // The latest, of every status, newest first.
    Task<IReadOnlyList<HrOutboxItem>> GetRecentAsync(int take, CancellationToken cancellationToken = default);

    Task<int> CountAsync(HrOutboxStatus status, CancellationToken cancellationToken = default);
}

// Written apart from the call's own work: a refused or failed call is logged all the same.
public interface IHrSyncJournal
{
    Task WriteAsync(HrSyncLog entry, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<HrSyncLog>> RecentAsync(int count, CancellationToken cancellationToken = default);
}
```


> 📄 **`backend/src/Costing.Application/Integrations/HrIntegration.cs`** — 675 سطر

```csharp
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using MediatR;
using Costing.Application.Approvals;
using Costing.Application.Common;
using Costing.Application.Treasury;
using Costing.Domain.Approvals;
using Costing.Domain.Common;
using Costing.Domain.EndOfDay;
using Costing.Domain.Integrations;
using Costing.Domain.Staff;
using Costing.Domain.Treasury;

namespace Costing.Application.Integrations;

// The HR & payroll link (Settings → HR Integration), both ways, only while it is switched on:
//
// From HR: its employees (read from HR, kept here as SyncedEmployees, each a staff member here so
// the safe's advances and salaries name them), and each payroll run HR approves (sent here): its
// labor cost for the month's profit and loss, and its net cash payable, to be paid out of the safe.
//
// To HR, through an outbox tried again until HR takes it: each advance paid out of the safe to an
// employee from HR (the end of the day's, with its signed receipt), and its void; each deduction
// charged to one (a till shortage, a staff charge), and its void; and each payroll paid out of the
// safe, and its void. Each is sent by its own id here, so HR keeps it once.
//
// Switched off, nothing is read or sent and every screen works on the staff kept here.

public static class HrKeys
{
    public const string Prefix = "chr_";

    // 32 random bytes, URL-safe: shown once, kept only as its hash.
    public static string New() => Prefix + Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public static string Hash(string key) => PosKeys.Hash(key);

    public static string Hint(string key) => "••••" + key.Trim()[^4..];

    public static bool Matches(string? key, string? hash) => PosKeys.Matches(key, hash);
}

// HR's key, kept encrypted here and read back only to call HR.
public interface IHrKeyProtector
{
    string Protect(string key);

    // Null when it cannot be read back (this server's secret changed): HR's key is pasted again.
    string? Unprotect(string protectedKey);
}

// An employee as HR lists them.
public sealed record HrEmployeeRecord(Guid EmployeeId, string? Code, string FullName, string? Department, string? Branch, bool IsActive);

public sealed record HrPingResult(string? System, string? Company);

public enum HrSendOutcome
{
    Delivered = 1,
    // HR answered no, saying why: tried again only once put right.
    Refused = 2,
    // HR out of reach, or answered with an error of its own: tried again later.
    Unavailable = 3,
}

public sealed record HrSendResult(HrSendOutcome Outcome, string Message);

// HR answered, and said no (a wrong key, a refusal).
public sealed class HrRefusedException(string message) : Exception(message);

// HR could not be reached, or failed.
public sealed class HrUnavailableException(string message) : Exception(message);

// The calls this system makes to HR, each with HR's key in X-API-Key.
public interface IHrGateway
{
    Task<HrPingResult> PingAsync(string baseUrl, string key, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<HrEmployeeRecord>> EmployeesAsync(string baseUrl, string key, CancellationToken cancellationToken = default);

    // One outbox item to HR's endpoint for its kind, with its idempotency key.
    Task<HrSendResult> SendAsync(string baseUrl, string key, string kind, string payload, Guid idempotencyKey, CancellationToken cancellationToken = default);
}

public sealed record HrSyncLogDto(
    Guid Id, DateTime AtUtc, HrSyncDirection Direction, string Call, HrSyncOutcome Outcome, string Message, Guid? Reference, string? Detail)
{
    public static HrSyncLogDto From(HrSyncLog l) => new(l.Id, l.AtUtc, l.Direction, l.Call, l.Outcome, l.Message, l.Reference, l.Detail);
}

public sealed record HrOutboxItemDto(
    Guid Id, string Kind, string Action, Guid IdempotencyKey, string Summary, HrOutboxStatus Status, int Attempts, DateTime NextAttemptAtUtc,
    string? LastError, DateTime CreatedAtUtc, DateTime? SentAtUtc)
{
    public static HrOutboxItemDto From(HrOutboxItem i) => new(
        i.Id, i.Kind, i.Action, i.IdempotencyKey, i.Summary, i.Status, i.Attempts, i.NextAttemptAtUtc, i.LastError, i.CreatedAtUtc, i.SentAtUtc);
}

public sealed record HrIntegrationDto(
    bool Enabled,
    string? BaseUrl,
    bool HasHrKey,
    string? HrKeyHint,
    bool HasKey,
    string? KeyHint,
    DateTime? KeyCreatedAtUtc,
    string? KeyCreatedBy,
    DateTime? EmployeesSyncedAtUtc,
    int EmployeesSynced,
    int Pending,
    int Failed,
    IReadOnlyList<HrSyncLogDto> Logs,
    IReadOnlyList<HrOutboxItemDto> Outbox);

public sealed record HrKeyDto(string Key, string KeyHint, DateTime CreatedAtUtc);

public sealed record HrTestResultDto(bool Ok, string Message);

public sealed record HrEmployeeSyncDto(int Received, int Added, int Updated, int Left, DateTime AtUtc);

// Whether the staff come from HR now, for the screens that choose one.
public sealed record HrStatusDto(bool Linked, DateTime? EmployeesSyncedAtUtc);

public sealed record GetHrIntegrationQuery : IRequest<HrIntegrationDto>;

public sealed record GetHrStatusQuery : IRequest<HrStatusDto>;

// Switched on or off, HR's address, and HR's key when a new one is pasted (null keeps it).
public sealed record SaveHrLinkCommand(bool Enabled, string? BaseUrl, string? HrKey, string StaffName) : IRequest<HrIntegrationDto>;

public sealed record GenerateHrKeyCommand(string StaffName) : IRequest<HrKeyDto>;

// HR's ping, with its address and key as saved (switched on or not).
public sealed record TestHrLinkCommand : IRequest<HrTestResultDto>;

public sealed record SyncHrEmployeesCommand : IRequest<HrEmployeeSyncDto>;

public sealed record RetryHrOutboxCommand(Guid ItemId) : IRequest<HrOutboxItemDto>;

public sealed record VerifyHrKeyQuery(string? Key) : IRequest<bool>;

internal sealed class GetHrIntegrationHandler(IHrLinkStore links, IHrSyncJournal journal, IHrOutboxRepository outbox)
    : IRequestHandler<GetHrIntegrationQuery, HrIntegrationDto>
{
    public async Task<HrIntegrationDto> Handle(GetHrIntegrationQuery request, CancellationToken cancellationToken) =>
        await HrLinks.Dto(await links.GetAsync(cancellationToken), journal, outbox)(cancellationToken);
}

internal static class HrLinks
{
    public static Func<CancellationToken, Task<HrIntegrationDto>> Dto(HrLink link, IHrSyncJournal journal, IHrOutboxRepository outbox) =>
        async cancellationToken => new HrIntegrationDto(
            link.Enabled, link.BaseUrl, link.HrKeyProtected is not null, link.HrKeyHint, link.HasKey, link.KeyHint, link.KeyCreatedAtUtc, link.KeyCreatedBy,
            link.EmployeesSyncedAtUtc, link.EmployeesSynced,
            await outbox.CountAsync(HrOutboxStatus.Pending, cancellationToken), await outbox.CountAsync(HrOutboxStatus.Failed, cancellationToken),
            (await journal.RecentAsync(100, cancellationToken)).Select(HrSyncLogDto.From).ToList(),
            (await outbox.GetRecentAsync(50, cancellationToken)).Select(HrOutboxItemDto.From).ToList());

    // HR's address and key, to call it; or why not.
    public static (string Url, string Key) Calling(HrLink link, IHrKeyProtector protector, bool mustBeOn)
    {
        if (mustBeOn && !link.Enabled)
            throw new DomainException("The HR link is switched off. · الربط مع الموارد البشرية متوقف.");
        if (link.BaseUrl is null || link.HrKeyProtected is null)
            throw new DomainException("Give HR's address and HR's key first. · أدخل عنوان الموارد البشرية ومفتاحها.");
        var key = protector.Unprotect(link.HrKeyProtected)
            ?? throw new DomainException("HR's key can no longer be read here (this server's secret changed): paste it again. · أعد إدخال مفتاح الموارد البشرية.");
        return (link.BaseUrl, key);
    }
}

internal sealed class GetHrStatusHandler(IHrLinkStore links) : IRequestHandler<GetHrStatusQuery, HrStatusDto>
{
    public async Task<HrStatusDto> Handle(GetHrStatusQuery request, CancellationToken cancellationToken)
    {
        var link = await links.GetAsync(cancellationToken);
        return new HrStatusDto(link.Enabled, link.EmployeesSyncedAtUtc);
    }
}

internal sealed class SaveHrLinkHandler(IHrLinkStore links, IHrKeyProtector protector, IHrSyncJournal journal, IHrOutboxRepository outbox, IUnitOfWork unitOfWork)
    : IRequestHandler<SaveHrLinkCommand, HrIntegrationDto>
{
    public async Task<HrIntegrationDto> Handle(SaveHrLinkCommand request, CancellationToken cancellationToken)
    {
        var link = await links.GetAsync(cancellationToken);
        var key = string.IsNullOrWhiteSpace(request.HrKey) ? null : request.HrKey.Trim();
        if (key is { Length: < 16 or > 200 })
            throw new DomainException("HR's key is the one HR made for this system: paste it whole. · الصق مفتاح الموارد البشرية كاملاً.");
        link.Configure(request.Enabled, request.BaseUrl, key is null ? null : protector.Protect(key), key is null ? null : HrKeys.Hint(key), request.StaffName);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await HrLinks.Dto(link, journal, outbox)(cancellationToken);
    }
}

internal sealed class GenerateHrKeyHandler(IHrLinkStore links, IUnitOfWork unitOfWork) : IRequestHandler<GenerateHrKeyCommand, HrKeyDto>
{
    public async Task<HrKeyDto> Handle(GenerateHrKeyCommand request, CancellationToken cancellationToken)
    {
        var link = await links.GetAsync(cancellationToken);
        var key = HrKeys.New();
        link.SetKey(HrKeys.Hash(key), HrKeys.Hint(key), request.StaffName);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return new HrKeyDto(key, link.KeyHint!, link.KeyCreatedAtUtc!.Value);
    }
}

internal sealed class VerifyHrKeyHandler(IHrLinkStore links) : IRequestHandler<VerifyHrKeyQuery, bool>
{
    // Only while the link is on: switched off, HR is not heard.
    public async Task<bool> Handle(VerifyHrKeyQuery request, CancellationToken cancellationToken)
    {
        var link = await links.GetAsync(cancellationToken);
        return link.Enabled && HrKeys.Matches(request.Key, link.KeyHash);
    }
}

internal sealed class TestHrLinkHandler(IHrLinkStore links, IHrKeyProtector protector, IHrGateway gateway, IHrSyncJournal journal)
    : IRequestHandler<TestHrLinkCommand, HrTestResultDto>
{
    public async Task<HrTestResultDto> Handle(TestHrLinkCommand request, CancellationToken cancellationToken)
    {
        var (url, key) = HrLinks.Calling(await links.GetAsync(cancellationToken), protector, mustBeOn: false);
        try
        {
            var ping = await gateway.PingAsync(url, key, cancellationToken);
            var message = $"Connected to {ping.System ?? "HR"}{(ping.Company is { } company ? $" · {company}" : "")}.";
            await journal.WriteAsync(new HrSyncLog(HrSyncDirection.Outbound, "ping", HrSyncOutcome.Read, message), cancellationToken);
            return new HrTestResultDto(true, message);
        }
        catch (Exception ex) when (ex is HrRefusedException or HrUnavailableException)
        {
            var outcome = ex is HrRefusedException ? HrSyncOutcome.Refused : HrSyncOutcome.Failed;
            await journal.WriteAsync(new HrSyncLog(HrSyncDirection.Outbound, "ping", outcome, ex.Message), cancellationToken);
            return new HrTestResultDto(false, ex.Message);
        }
    }
}

// HR's employees, kept here: each new one a staff member (one of the same name here linked to them,
// not made again), each one known changed as HR has them, and each no longer on HR's list marked
// as having left. Their advances and salaries keep naming them.
internal sealed class SyncHrEmployeesHandler(
    IHrLinkStore links,
    IHrKeyProtector protector,
    IHrGateway gateway,
    ISyncedEmployeeRepository synced,
    IStaffMemberRepository staff,
    IHrSyncJournal journal,
    IUnitOfWork unitOfWork) : IRequestHandler<SyncHrEmployeesCommand, HrEmployeeSyncDto>
{
    public async Task<HrEmployeeSyncDto> Handle(SyncHrEmployeesCommand request, CancellationToken cancellationToken)
    {
        var link = await links.GetAsync(cancellationToken);
        var (url, key) = HrLinks.Calling(link, protector, mustBeOn: true);
        IReadOnlyList<HrEmployeeRecord> records;
        try
        {
            records = await gateway.EmployeesAsync(url, key, cancellationToken);
        }
        catch (Exception ex) when (ex is HrRefusedException or HrUnavailableException)
        {
            await journal.WriteAsync(new HrSyncLog(HrSyncDirection.Outbound, "employees", HrSyncOutcome.Failed, ex.Message), cancellationToken);
            throw new DomainException($"HR's employees could not be read: {ex.Message} The ones kept here stay as they were.");
        }

        var known = (await synced.GetAllAsync(cancellationToken)).ToDictionary(e => e.HrEmployeeId);
        var members = (await staff.GetAllAsync(cancellationToken)).ToDictionary(m => m.Id);
        var linked = known.Values.Select(e => e.StaffMemberId).ToHashSet();
        var (added, updated, left) = (0, 0, 0);
        foreach (var record in records.Where(r => r.EmployeeId != Guid.Empty).DistinctBy(r => r.EmployeeId))
        {
            if (!known.TryGetValue(record.EmployeeId, out var employee))
            {
                // One of the same name kept here before the link: theirs, not made again.
                var member = members.Values.FirstOrDefault(m => !linked.Contains(m.Id)
                    && string.Equals(m.Name.Trim(), record.FullName.Trim(), StringComparison.OrdinalIgnoreCase));
                if (member is null)
                {
                    member = new StaffMember(Guid.NewGuid(), record.FullName, record.Department);
                    staff.Add(member);
                    members[member.Id] = member;
                }
                linked.Add(member.Id);
                employee = new SyncedEmployee(Guid.NewGuid(), record.EmployeeId, member.Id);
                synced.Add(employee);
                added++;
                employee.Update(record.Code, record.FullName, record.Department, record.Branch, record.IsActive);
            }
            else if (employee.Update(record.Code, record.FullName, record.Department, record.Branch, record.IsActive))
            {
                updated++;
            }

            if (members.GetValueOrDefault(employee.StaffMemberId) is { } kept)
            {
                kept.Change(employee.FullName, employee.Department ?? kept.JobTitle);
                if (record.IsActive)
                    kept.Reactivate();
                else
                    kept.Deactivate();
            }
        }

        var listed = records.Select(r => r.EmployeeId).ToHashSet();
        foreach (var gone in known.Values.Where(e => e.IsActive && !listed.Contains(e.HrEmployeeId)))
        {
            gone.Gone();
            members.GetValueOrDefault(gone.StaffMemberId)?.Deactivate();
            left++;
        }

        link.Synced(records.Count(r => r.IsActive));
        await unitOfWork.SaveChangesAsync(cancellationToken);
        await journal.WriteAsync(new HrSyncLog(HrSyncDirection.Outbound, "employees", HrSyncOutcome.Read,
            $"{records.Count} employees read from HR: {added} new, {updated} changed, {left} left."), cancellationToken);
        return new HrEmployeeSyncDto(records.Count, added, updated, left, link.EmployeesSyncedAtUtc!.Value);
    }
}

internal sealed class RetryHrOutboxHandler(IHrOutboxRepository outbox, IUnitOfWork unitOfWork) : IRequestHandler<RetryHrOutboxCommand, HrOutboxItemDto>
{
    public async Task<HrOutboxItemDto> Handle(RetryHrOutboxCommand request, CancellationToken cancellationToken)
    {
        var item = await outbox.GetByIdAsync(request.ItemId, cancellationToken) ?? throw new NotFoundException("Item to send", request.ItemId);
        item.Retry();
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return HrOutboxItemDto.From(item);
    }
}

// ---- What is sent to HR: the outbox ----

// HR's endpoints for what is sent: /api/integrations/costing/{kind}.
public static class HrCalls
{
    public const string Advance = "employee-advance";
    public const string Deduction = "employee-deduction";
    public const string PayrollSettled = "payroll-settled";
}

// Queued with the record that makes it, in the same unit of work: an advance paid, a deduction, a
// payroll paid; and their voids. Only while the link is on, and only for an employee from HR (one
// kept only here is HR's to know nothing of).
internal sealed class HrOutbox(IHrLinkStore links, ISyncedEmployeeRepository synced, IHrOutboxRepository outbox, IEndOfDayRepository days)
{
    private const string Advance = HrCalls.Advance;
    private const string Deduction = HrCalls.Deduction;
    private const string PayrollSettled = HrCalls.PayrollSettled;

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

    // An advance paid out of the safe, or its void: the end of the day's with its signed receipt.
    public async Task AdvanceAsync(SafeTransaction entry, bool voided, CancellationToken cancellationToken)
    {
        if (entry.EmployeeId is not { } staffId || !await OnAsync(cancellationToken))
            return;
        if (await synced.GetByStaffMemberAsync(staffId, cancellationToken) is not { } employee)
            return;
        // From the end of the day: its own note and signed receipt, the day being said as the source.
        var payout = (await days.GetByPayoutAsync(entry.Id, cancellationToken))?.Payouts.FirstOrDefault(p => p.Id == entry.Id);
        var receipt = voided ? null : payout?.Receipt;
        var payload = new
        {
            idempotencyKey = entry.Id,
            action = voided ? "void" : "create",
            employeeId = employee.HrEmployeeId,
            employeeCode = employee.Code,
            employeeName = employee.FullName,
            date = entry.BusinessDate.ToString("yyyy-MM-dd", Invariant),
            amount = -entry.Amount,
            notes = payout is null ? entry.Notes : payout.Note,
            source = entry.RevenueDate is { } day ? $"End of day {day.ToString("yyyy-MM-dd", Invariant)}" : "Safe",
            receipt = receipt is null ? null : new { photoId = entry.Id, receipt.FileName, receipt.ContentType },
        };
        Queue(Advance, voided, entry.Id, payload,
            $"{(voided ? "Void advance" : "Advance")} · {employee.FullName} · {CompanyMoney.Text(-entry.Amount)} · {entry.BusinessDate.ToString("d MMM", Invariant)}");
    }

    public async Task DeductionAsync(StaffDeduction deduction, bool voided, CancellationToken cancellationToken)
    {
        if (!await OnAsync(cancellationToken) || await synced.GetByStaffMemberAsync(deduction.EmployeeId, cancellationToken) is not { } employee)
            return;
        var payload = new
        {
            idempotencyKey = deduction.Id,
            action = voided ? "void" : "create",
            employeeId = employee.HrEmployeeId,
            employeeCode = employee.Code,
            employeeName = employee.FullName,
            date = deduction.Date.ToString("yyyy-MM-dd", Invariant),
            amount = deduction.Amount,
            kind = deduction.Kind.ToString(),
            reason = deduction.Reason,
        };
        var what = deduction.Kind == StaffDeductionKind.TillShortage ? "Till shortage" : "Staff charge";
        Queue(Deduction, voided, deduction.Id, payload, $"{(voided ? "Void " + what.ToLowerInvariant() : what)} · {employee.FullName} · {CompanyMoney.Text(deduction.Amount)}");
    }

    // A payroll from HR paid out of the safe, or that payment voided.
    public async Task PayrollAsync(PayrollRun run, SafeTransaction entry, bool voided, CancellationToken cancellationToken)
    {
        if (!await OnAsync(cancellationToken))
            return;
        var payload = new
        {
            idempotencyKey = run.Id,
            action = voided ? "void" : "create",
            payrollPeriod = run.Period.ToString("yyyy-MM", Invariant),
            safeVoucherId = entry.Id,
            amount = -entry.Amount,
            disbursedOn = entry.BusinessDate.ToString("yyyy-MM-dd", Invariant),
            disbursedAtUtc = entry.RecordedAtUtc,
            disbursedBy = entry.RecordedBy,
        };
        Queue(PayrollSettled, voided, run.Id, payload, $"{(voided ? "Payroll payment voided" : "Payroll paid")} · {run.PeriodName} · {CompanyMoney.Text(-entry.Amount)}");
    }

    private async Task<bool> OnAsync(CancellationToken cancellationToken) => (await links.GetAsync(cancellationToken)).Enabled;

    private void Queue(string kind, bool voided, Guid key, object payload, string summary) =>
        outbox.Add(new HrOutboxItem(Guid.NewGuid(), kind, voided ? "void" : "create", key, JsonSerializer.Serialize(payload, Json), summary));
}

// ---- From HR: a payroll run approved there ----

public sealed record PayrollRunDepartmentInput(
    string Department, int Employees, decimal GrossWages, decimal Additions, decimal Penalties, decimal AdvancesDeducted, decimal NetCashPayable);

// As HR sends it: PayrollPeriod is the month, yyyy-MM; IdempotencyKey HR's id for the run, the same
// each time it is sent.
public sealed record PayrollRunInput(
    Guid IdempotencyKey,
    string PayrollPeriod,
    int Employees,
    decimal TotalGrossWages,
    decimal TotalAdditions,
    decimal TotalAdvancesDeducted,
    decimal TotalPenalties,
    decimal NetCashPayable,
    IReadOnlyList<PayrollRunDepartmentInput>? Departments,
    decimal TotalBroughtForward = 0);

public sealed record PayrollRunDepartmentDto(
    string Name, int Employees, decimal GrossWages, decimal Additions, decimal Penalties, decimal AdvancesDeducted, decimal NetCashPayable, decimal LaborCost);

public sealed record PayrollRunDto(
    Guid Id,
    DateOnly Period,
    int Employees,
    decimal TotalGrossWages,
    decimal TotalAdditions,
    decimal TotalPenalties,
    decimal TotalAdvancesDeducted,
    decimal TotalBroughtForward,
    decimal NetCashPayable,
    decimal LaborCost,
    PayrollRunStatus Status,
    int Revision,
    DateTime ReceivedAtUtc,
    DateTime UpdatedAtUtc,
    Guid? SafeTransactionId,
    DateTime? DisbursedAtUtc,
    string? DisbursedBy,
    // A payment of it asked of a manager and not decided yet.
    bool PaymentRequested,
    IReadOnlyList<PayrollRunDepartmentDto> Departments)
{
    public static PayrollRunDto From(PayrollRun r, bool requested = false) => new(
        r.Id, r.Period, r.Employees, r.TotalGrossWages, r.TotalAdditions, r.TotalPenalties, r.TotalAdvancesDeducted, r.TotalBroughtForward,
        r.NetCashPayable, r.LaborCost, r.Status, r.Revision, r.ReceivedAtUtc, r.UpdatedAtUtc, r.SafeTransactionId, r.DisbursedAtUtc, r.DisbursedBy,
        requested,
        r.Departments.Select(d => new PayrollRunDepartmentDto(
            d.Name, d.Employees, d.GrossWages, d.Additions, d.Penalties, d.AdvancesDeducted, d.NetCashPayable, d.LaborCost)).ToList());
}

public sealed record PayrollRunResultDto(HrSyncOutcome Outcome, Guid Id, DateOnly Period, decimal NetCashPayable, decimal LaborCost);

public sealed record ReceivePayrollRunCommand(PayrollRunInput Run) : IRequest<PayrollRunResultDto>, IRetryOnConflict;

internal sealed class ReceivePayrollRunHandler(IPayrollRunRepository runs, IHrSyncJournal journal, IUnitOfWork unitOfWork)
    : IRequestHandler<ReceivePayrollRunCommand, PayrollRunResultDto>
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<PayrollRunResultDto> Handle(ReceivePayrollRunCommand request, CancellationToken cancellationToken)
    {
        var input = request.Run;
        try
        {
            var result = await RecordAsync(input, cancellationToken);
            await journal.WriteAsync(new HrSyncLog(HrSyncDirection.Inbound, "payroll-run", result.Outcome,
                $"Payroll of {result.Period.ToString("MMMM yyyy", CultureInfo.InvariantCulture)}: labor cost {CompanyMoney.Text(result.LaborCost)}, " +
                $"net cash payable {CompanyMoney.Text(result.NetCashPayable)}.", result.Id), cancellationToken);
            return result;
        }
        catch (DomainException ex)
        {
            await journal.WriteAsync(new HrSyncLog(HrSyncDirection.Inbound, "payroll-run", HrSyncOutcome.Refused, ex.Message, input.IdempotencyKey), cancellationToken);
            throw;
        }
    }

    private async Task<PayrollRunResultDto> RecordAsync(PayrollRunInput input, CancellationToken cancellationToken)
    {
        if (input.IdempotencyKey == Guid.Empty)
            throw new DomainException("A payroll run needs its idempotency key, HR's id for it.");
        if (!DateOnly.TryParseExact(input.PayrollPeriod + "-01", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var period))
            throw new DomainException("The payroll period is a month, as 2026-10.");
        var departments = (input.Departments ?? [])
            .Select(d => new PayrollRunDepartment(d.Department, d.Employees, d.GrossWages, d.Additions, d.Penalties, d.AdvancesDeducted, d.NetCashPayable))
            .ToList();
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(input with { IdempotencyKey = Guid.Empty }, Json))))
            .ToLowerInvariant();

        var run = await runs.GetByIdAsync(input.IdempotencyKey, cancellationToken);
        if (run is not null && run.PayloadHash == hash)
            return Result(run, HrSyncOutcome.Unchanged);

        // Another run of the same month: replaced while it is still to be paid; once paid, refused.
        if (await runs.GetForPeriodAsync(period, cancellationToken) is { } other && other.Id != input.IdempotencyKey)
        {
            if (other.IsDisbursed)
                throw new DomainException($"The payroll of {other.PeriodName} is paid out of the safe already, as another run: void that payment first.");
            runs.Remove(other);
        }

        var outcome = run is null ? HrSyncOutcome.Recorded : HrSyncOutcome.Updated;
        if (run is null)
        {
            run = new PayrollRun(input.IdempotencyKey, period, hash);
            runs.Add(run);
        }
        else if (run.Period != PayrollRun.Month(period))
        {
            throw new DomainException("A payroll run keeps its month: send the other month as a run of its own.");
        }
        run.Set(input.Employees, input.TotalGrossWages, input.TotalAdditions, input.TotalPenalties, input.TotalAdvancesDeducted, input.TotalBroughtForward,
            input.NetCashPayable, departments, hash);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result(run, outcome);
    }

    private static PayrollRunResultDto Result(PayrollRun run, HrSyncOutcome outcome) => new(outcome, run.Id, run.Period, run.NetCashPayable, run.LaborCost);
}

public sealed record GetPayrollRunsQuery : IRequest<IReadOnlyList<PayrollRunDto>>;

internal sealed class GetPayrollRunsHandler(IPayrollRunRepository runs, IApprovalRequestRepository requests) : IRequestHandler<GetPayrollRunsQuery, IReadOnlyList<PayrollRunDto>>
{
    public async Task<IReadOnlyList<PayrollRunDto>> Handle(GetPayrollRunsQuery request, CancellationToken cancellationToken)
    {
        var list = new List<PayrollRunDto>();
        foreach (var run in await runs.GetRecentAsync(24, cancellationToken))
            list.Add(PayrollRunDto.From(run, !run.IsDisbursed && await requests.GetPendingForAsync(run.Id, cancellationToken) is not null));
        return list;
    }
}

// A payroll from HR paid out of the safe in one entry, its net cash payable: a manager's at once,
// anyone else's asked of a manager. TransactionId (the entry's) and RequestId are made by the app.
public sealed record DisbursePayrollRunCommand(Guid RunId, Guid TransactionId, Guid RequestId, string StaffId, string StaffName, bool CanApprove)
    : IRequest<SafeVoucherResultDto>, IRetryOnConflict;

internal sealed class DisbursePayrollRunHandler(
    IPayrollRunRepository runs, TreasuryWriter treasury, ISafeTransactionRepository safe, IApprovalRequestRepository requests, IUnitOfWork unitOfWork)
    : IRequestHandler<DisbursePayrollRunCommand, SafeVoucherResultDto>
{
    public async Task<SafeVoucherResultDto> Handle(DisbursePayrollRunCommand request, CancellationToken cancellationToken)
    {
        if (await safe.GetByIdAsync(request.TransactionId, cancellationToken) is { } made)
            return new SafeVoucherResultDto(ApprovalOutcome.Applied, SafeTransactionDto.From(made), null);
        if (await requests.GetByIdAsync(request.RequestId, cancellationToken) is { } already)
            return new SafeVoucherResultDto(ApprovalOutcome.Requested, null, ApprovalRequestDto.From(already));
        var run = await runs.GetByIdAsync(request.RunId, cancellationToken) ?? throw new NotFoundException("Payroll run", request.RunId);
        if (run.NetCashPayable <= 0)
            throw new DomainException($"Nothing is left to pay of the payroll of {run.PeriodName}: the advances covered it. · لا يوجد صافي مستحق.");
        if (await requests.GetPendingForAsync(run.Id, cancellationToken) is not null)
            throw new DomainException($"Paying the payroll of {run.PeriodName} is asked of a manager already. · طلب الصرف بانتظار الموافقة.");

        var voucher = new SafeVoucher(
            request.TransactionId, SafeTransactionKind.PayrollPayment, run.NetCashPayable, treasury.Today,
            Notes: $"Payroll of {run.PeriodName} from HR · مسير رواتب", PayrollMonth: run.Period, PayrollRunId: run.Id);
        if (request.CanApprove)
        {
            var entry = await treasury.ApplyAsync(voucher, request.StaffName, null, cancellationToken);
            await unitOfWork.SaveChangesAsync(cancellationToken);
            return new SafeVoucherResultDto(ApprovalOutcome.Applied, SafeTransactionDto.From(entry), null);
        }

        await treasury.CheckAsync(voucher, cancellationToken);
        var (summary, changes) = await treasury.DescribeAsync(voucher, cancellationToken);
        var asked = ApprovalRequest.AskToChange(
            request.RequestId, ApprovalModule.Treasury, ApprovalAction.Create, run.Id, summary, changes, ApprovalPayload.Write(voucher), null,
            request.StaffId, request.StaffName);
        requests.Add(asked);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return new SafeVoucherResultDto(ApprovalOutcome.Requested, null, ApprovalRequestDto.From(asked));
    }
}

// ---- Deductions charged to an employee ----

public sealed record StaffDeductionDto(
    Guid Id, Guid EmployeeId, string Employee, DateOnly Date, StaffDeductionKind Kind, decimal Amount, string? Reason, string RecordedBy,
    DateTime RecordedAtUtc, DateTime? VoidedAtUtc, string? VoidedBy, bool FromHr);

public sealed record GetStaffDeductionsQuery(DateOnly From, DateOnly To) : IRequest<IReadOnlyList<StaffDeductionDto>>;

// Made by the app (Id), so one sent again is recorded once.
public sealed record RecordStaffDeductionCommand(
    Guid Id, Guid EmployeeId, DateOnly Date, StaffDeductionKind Kind, decimal Amount, string? Reason, string StaffName) : IRequest<StaffDeductionDto>;

public sealed record VoidStaffDeductionCommand(Guid Id, string StaffName) : IRequest<StaffDeductionDto>;

internal sealed class StaffDeductionReading(IStaffMemberRepository staff, ISyncedEmployeeRepository synced)
{
    public async Task<IReadOnlyList<StaffDeductionDto>> DtosAsync(IEnumerable<StaffDeduction> list, CancellationToken cancellationToken)
    {
        var names = (await staff.GetAllAsync(cancellationToken)).ToDictionary(m => m.Id, m => m.Name);
        var fromHr = (await synced.GetAllAsync(cancellationToken)).Select(e => e.StaffMemberId).ToHashSet();
        return list.OrderByDescending(d => d.Date).ThenByDescending(d => d.RecordedAtUtc)
            .Select(d => new StaffDeductionDto(
                d.Id, d.EmployeeId, names.GetValueOrDefault(d.EmployeeId, "A removed employee"), d.Date, d.Kind, d.Amount, d.Reason, d.RecordedBy,
                d.RecordedAtUtc, d.VoidedAtUtc, d.VoidedBy, fromHr.Contains(d.EmployeeId)))
            .ToList();
    }
}

internal sealed class GetStaffDeductionsHandler(IStaffDeductionRepository deductions, StaffDeductionReading reading)
    : IRequestHandler<GetStaffDeductionsQuery, IReadOnlyList<StaffDeductionDto>>
{
    public async Task<IReadOnlyList<StaffDeductionDto>> Handle(GetStaffDeductionsQuery request, CancellationToken cancellationToken)
    {
        if (request.To < request.From || request.To.DayNumber - request.From.DayNumber > 370)
            throw new DomainException("Choose a year at most, the first day before the last.");
        return await reading.DtosAsync(await deductions.GetBetweenAsync(request.From, request.To, cancellationToken), cancellationToken);
    }
}

internal sealed class RecordStaffDeductionHandler(
    IStaffDeductionRepository deductions, IStaffMemberRepository staff, HrOutbox hr, StaffDeductionReading reading, IUnitOfWork unitOfWork)
    : IRequestHandler<RecordStaffDeductionCommand, StaffDeductionDto>
{
    public async Task<StaffDeductionDto> Handle(RecordStaffDeductionCommand request, CancellationToken cancellationToken)
    {
        if (await deductions.GetByIdAsync(request.Id, cancellationToken) is { } made)
            return (await reading.DtosAsync([made], cancellationToken))[0];
        var employee = await staff.GetByIdAsync(request.EmployeeId, cancellationToken)
            ?? throw new DomainException("Choose the employee from the list. · اختر الموظف من القائمة.");
        if (!employee.IsActive)
            throw new DomainException($"{employee.Name} has left: a deduction goes on the pay of someone still here.");
        var deduction = new StaffDeduction(request.Id, request.EmployeeId, request.Date, request.Kind, request.Amount, request.Reason, request.StaffName);
        deductions.Add(deduction);
        await hr.DeductionAsync(deduction, voided: false, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return (await reading.DtosAsync([deduction], cancellationToken))[0];
    }
}

internal sealed class VoidStaffDeductionHandler(IStaffDeductionRepository deductions, HrOutbox hr, StaffDeductionReading reading, IUnitOfWork unitOfWork)
    : IRequestHandler<VoidStaffDeductionCommand, StaffDeductionDto>
{
    public async Task<StaffDeductionDto> Handle(VoidStaffDeductionCommand request, CancellationToken cancellationToken)
    {
        var deduction = await deductions.GetByIdAsync(request.Id, cancellationToken) ?? throw new NotFoundException("Deduction", request.Id);
        deduction.Void(request.StaffName);
        await hr.DeductionAsync(deduction, voided: true, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return (await reading.DtosAsync([deduction], cancellationToken))[0];
    }
}
```


### 3.6 البنية التحتية: AES-GCM و HttpClient والعامل الخلفي (سطرًا سطرًا لأهم الأجزاء)

- `HrKeyProtector.Key`: يقرأ `Auth:SigningKey`، يرفض الفارغ، ويشتق 32 بايت بـ `HKDF.DeriveKey(SHA256, …, info)`.
- `Protect`: `RandomNumberGenerator.GetBytes(12)` nonce، `new AesGcm(Key, 16)`، `Encrypt(nonce, plain, cipher, tag)`، ثم `"v1." + Base64([nonce, tag, cipher])`.
- `Unprotect`: يتحقق من البادئة، يقسم البايتات `[..12]`, `[12..28]`, `[28..]`، و `Decrypt` يرمي إن عُبث بها ⇐ يعيد `null` (لا يرمي للأعلى).
- `HrGateway`: `IHttpClientFactory` (مهلة 20 ثانية)، يضيف `X-API-Key` و `Idempotency-Key`، ويصنّف الرد.
- `HrOutboxSender`: كما في المخطط أعلاه، ويضيف `contentBase64` للإيصال من مخزن الصور.
- `HrSyncWorker`: `PeriodicTimer` كل 10 ثوانٍ، Scope جديد لكل دورة، لا يعمل والرابط مغلق، ومزامنة الموظفين كل 6 ساعات مع تأجيل 5 دقائق بعد فشل، ويبتلع الأخطاء بعد تسجيلها (لا يموت العامل الخلفي).

> 📄 **`backend/src/Costing.Infrastructure/Integrations/HrIntegrationServices.cs`** — 269 سطر

```csharp
using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using MediatR;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Costing.Application.Common;
using Costing.Application.Integrations;
using Costing.Domain.Common;
using Costing.Domain.EndOfDay;
using Costing.Domain.Integrations;

namespace Costing.Infrastructure.Integrations;

// HR's key, encrypted at rest with AES-GCM under a key drawn (HKDF) from this server's own signing
// secret (Auth:SigningKey): readable here and nowhere else, and again after a redeploy. Changing
// the secret makes it unreadable, and HR's key is pasted again.
internal sealed class HrKeyProtector(IConfiguration configuration) : IHrKeyProtector
{
    private const string Version = "v1.";

    private byte[] Key
    {
        get
        {
            var secret = configuration["Auth:SigningKey"];
            if (string.IsNullOrEmpty(secret))
                throw new InvalidOperationException("Auth:SigningKey is needed to keep HR's key.");
            return HKDF.DeriveKey(HashAlgorithmName.SHA256, Encoding.UTF8.GetBytes(secret), 32, info: Encoding.UTF8.GetBytes("Costing.HrLink.Key"));
        }
    }

    public string Protect(string key)
    {
        var nonce = RandomNumberGenerator.GetBytes(12);
        var plain = Encoding.UTF8.GetBytes(key);
        var cipher = new byte[plain.Length];
        var tag = new byte[16];
        using var aes = new AesGcm(Key, 16);
        aes.Encrypt(nonce, plain, cipher, tag);
        return Version + Convert.ToBase64String([.. nonce, .. tag, .. cipher]);
    }

    public string? Unprotect(string protectedKey)
    {
        try
        {
            if (!protectedKey.StartsWith(Version, StringComparison.Ordinal))
                return null;
            var all = Convert.FromBase64String(protectedKey[Version.Length..]);
            var (nonce, tag, cipher) = (all[..12], all[12..28], all[28..]);
            var plain = new byte[cipher.Length];
            using var aes = new AesGcm(Key, 16);
            aes.Decrypt(nonce, cipher, tag, plain);
            return Encoding.UTF8.GetString(plain);
        }
        catch (Exception ex) when (ex is CryptographicException or FormatException or ArgumentException)
        {
            return null;
        }
    }
}

// HR over HTTP: its key in X-API-Key, its answers read as HR gives them (camelCase).
internal sealed class HrGateway(IHttpClientFactory http) : IHrGateway
{
    public const string ClientName = "hr";

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<HrPingResult> PingAsync(string baseUrl, string key, CancellationToken cancellationToken = default)
    {
        using var response = await SendAsync(HttpMethod.Get, baseUrl, "api/integrations/costing/ping", key, null, null, cancellationToken);
        await EnsureAsync(response, cancellationToken);
        var body = await response.Content.ReadFromJsonAsync<JsonObject>(Json, cancellationToken);
        return new HrPingResult(body?["system"]?.GetValue<string>(), body?["company"]?.GetValue<string>());
    }

    public async Task<IReadOnlyList<HrEmployeeRecord>> EmployeesAsync(string baseUrl, string key, CancellationToken cancellationToken = default)
    {
        using var response = await SendAsync(HttpMethod.Get, baseUrl, "api/integrations/hr/employees", key, null, null, cancellationToken);
        await EnsureAsync(response, cancellationToken);
        return await response.Content.ReadFromJsonAsync<List<HrEmployeeRecord>>(Json, cancellationToken) ?? [];
    }

    public async Task<HrSendResult> SendAsync(string baseUrl, string key, string kind, string payload, Guid idempotencyKey, CancellationToken cancellationToken = default)
    {
        try
        {
            using var response = await SendAsync(HttpMethod.Post, baseUrl, $"api/integrations/costing/{kind}", key, payload, idempotencyKey, cancellationToken);
            var said = await ErrorsAsync(response, cancellationToken);
            return response.StatusCode switch
            {
                // Taken; or had already (kept once, by its key).
                _ when response.IsSuccessStatusCode => new HrSendResult(HrSendOutcome.Delivered, said ?? $"HR answered {(int)response.StatusCode}."),
                HttpStatusCode.Conflict => new HrSendResult(HrSendOutcome.Delivered, said ?? "HR had it already."),
                HttpStatusCode.BadRequest or HttpStatusCode.UnprocessableEntity or HttpStatusCode.NotFound or HttpStatusCode.Unauthorized
                    or HttpStatusCode.Forbidden => new HrSendResult(HrSendOutcome.Refused, said ?? $"HR refused it ({(int)response.StatusCode})."),
                _ => new HrSendResult(HrSendOutcome.Unavailable, said ?? $"HR answered {(int)response.StatusCode}."),
            };
        }
        catch (HrUnavailableException ex)
        {
            return new HrSendResult(HrSendOutcome.Unavailable, ex.Message);
        }
    }

    private async Task<HttpResponseMessage> SendAsync(
        HttpMethod method, string baseUrl, string path, string key, string? json, Guid? idempotencyKey, CancellationToken cancellationToken)
    {
        var request = new HttpRequestMessage(method, new Uri(new Uri(baseUrl.TrimEnd('/') + "/"), path));
        request.Headers.Add("X-API-Key", key);
        if (idempotencyKey is { } idempotent)
            request.Headers.Add("Idempotency-Key", idempotent.ToString());
        if (json is not null)
            request.Content = new StringContent(json, Encoding.UTF8, "application/json");
        try
        {
            return await http.CreateClient(ClientName).SendAsync(request, cancellationToken);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !cancellationToken.IsCancellationRequested)
        {
            throw new HrUnavailableException($"HR could not be reached at {baseUrl}: {ex.Message}");
        }
    }

    private static async Task EnsureAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        if (response.IsSuccessStatusCode)
            return;
        var said = await ErrorsAsync(response, cancellationToken);
        if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
            throw new HrRefusedException("HR refused the key: make one on HR's Settings → Costing Integration and paste it here. · مفتاح الموارد البشرية غير صحيح.");
        if (response.StatusCode == HttpStatusCode.NotFound)
            throw new HrRefusedException("HR has no Costing link at that address: check it, and that HR is up to date.");
        throw new HrUnavailableException(said ?? $"HR answered {(int)response.StatusCode}.");
    }

    // The errors HR gave, as one line.
    private static async Task<string?> ErrorsAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        if (response.IsSuccessStatusCode)
            return null;
        try
        {
            var body = await response.Content.ReadFromJsonAsync<JsonObject>(Json, cancellationToken);
            if (body?["errors"] is JsonArray errors && errors.Count > 0)
                return string.Join(" ", errors.Select(e => e?.ToString()));
            return body?["detail"]?.GetValue<string>() ?? body?["title"]?.GetValue<string>();
        }
        catch (Exception ex) when (ex is JsonException or NotSupportedException or InvalidOperationException)
        {
            return null;
        }
    }
}

// Sends what waits for HR, oldest first, while the link is on: each by its own endpoint with its
// idempotency key, an advance with its receipt (as base64, read from the end of the day's photos).
// Taken, it is sent; refused, it is kept as failed with HR's reason; out of reach, it is tried
// again later. Each try is logged.
public interface IHrOutboxSender
{
    // How many were sent now.
    Task<int> SendDueAsync(CancellationToken cancellationToken = default);
}

internal sealed class HrOutboxSender(
    IHrLinkStore links,
    IHrKeyProtector protector,
    IHrOutboxRepository outbox,
    IHrGateway gateway,
    IEndOfDayPhotoStore photos,
    IHrSyncJournal journal,
    IUnitOfWork unitOfWork) : IHrOutboxSender
{
    public async Task<int> SendDueAsync(CancellationToken cancellationToken = default)
    {
        var link = await links.GetAsync(cancellationToken);
        if (!link.IsReady || protector.Unprotect(link.HrKeyProtected!) is not { } key)
            return 0;
        var sent = 0;
        foreach (var item in await outbox.GetDueAsync(DateTime.UtcNow, 25, cancellationToken))
        {
            var result = await gateway.SendAsync(link.BaseUrl!, key, item.Kind, await PayloadAsync(item, cancellationToken), item.IdempotencyKey, cancellationToken);
            switch (result.Outcome)
            {
                case HrSendOutcome.Delivered:
                    item.Delivered();
                    sent++;
                    break;
                case HrSendOutcome.Refused:
                    item.Refused(result.Message);
                    break;
                default:
                    item.Postponed(result.Message);
                    break;
            }
            await unitOfWork.SaveChangesAsync(cancellationToken);
            await journal.WriteAsync(new HrSyncLog(
                HrSyncDirection.Outbound, item.Kind,
                result.Outcome switch { HrSendOutcome.Delivered => HrSyncOutcome.Sent, HrSendOutcome.Refused => HrSyncOutcome.Refused, _ => HrSyncOutcome.Failed },
                result.Outcome == HrSendOutcome.Delivered ? item.Summary : $"{item.Summary}: {result.Message}", item.IdempotencyKey), cancellationToken);
            // Out of reach: the rest wait too.
            if (result.Outcome == HrSendOutcome.Unavailable)
                break;
        }
        return sent;
    }

    // An advance's receipt, read now and sent with it as base64.
    private async Task<string> PayloadAsync(HrOutboxItem item, CancellationToken cancellationToken)
    {
        if (item.Kind != HrCalls.Advance || JsonNode.Parse(item.Payload) is not JsonObject payload
            || payload["receipt"] is not JsonObject receipt || receipt["photoId"]?.GetValue<Guid>() is not { } photoId)
            return item.Payload;
        if (await photos.GetAsync(photoId, cancellationToken) is { } content)
            receipt["contentBase64"] = Convert.ToBase64String(content);
        return payload.ToJsonString();
    }
}

// The link's own clock: every 10 seconds, what waits for HR is sent; every 6 hours (and soon after
// the link is switched on), HR's employees are read again. Nothing while it is switched off.
internal sealed class HrSyncWorker(IServiceScopeFactory scopes, ILogger<HrSyncWorker> logger) : BackgroundService
{
    private static readonly TimeSpan Every = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan EmployeesEvery = TimeSpan.FromHours(6);

    // After HR's employees could not be read, not again for a while: the sync log says it once.
    private DateTime _employeesNotBefore = DateTime.MinValue;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(Every);
        do
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                var link = await scope.ServiceProvider.GetRequiredService<IHrLinkStore>().GetAsync(stoppingToken);
                if (!link.IsReady)
                    continue;
                await scope.ServiceProvider.GetRequiredService<IHrOutboxSender>().SendDueAsync(stoppingToken);
                if ((link.EmployeesSyncedAtUtc is not { } synced || DateTime.UtcNow - synced > EmployeesEvery) && DateTime.UtcNow >= _employeesNotBefore)
                {
                    _employeesNotBefore = DateTime.UtcNow.AddMinutes(5);
                    await using var syncing = scopes.CreateAsyncScope();
                    await syncing.ServiceProvider.GetRequiredService<ISender>().Send(new SyncHrEmployeesCommand(), stoppingToken);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                // Logged and tried again on the next tick; the sync log says why to the user.
                logger.LogWarning(ex, "The HR link could not sync now.");
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
```


> 📄 **`backend/src/Costing.Infrastructure/Persistence/HrIntegrationPersistence.cs`** — 221 سطر

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.Extensions.DependencyInjection;
using Costing.Domain.Integrations;
using Costing.Domain.Staff;
using Costing.Infrastructure.Persistence.Configurations;

namespace Costing.Infrastructure.Persistence;

internal sealed class HrLinkConfiguration : IEntityTypeConfiguration<HrLink>
{
    public void Configure(EntityTypeBuilder<HrLink> builder)
    {
        builder.ToTable("HrLinks", CostingDbContext.CostingSchema);
        builder.Property(l => l.BaseUrl).HasMaxLength(HrLink.MaxUrlLength);
        builder.Property(l => l.HrKeyProtected).HasMaxLength(1000);
        builder.Property(l => l.HrKeyHint).HasMaxLength(HrLink.HintLength + 4);
        builder.Property(l => l.KeyHash).HasMaxLength(HrLink.HashLength);
        builder.Property(l => l.KeyHint).HasMaxLength(HrLink.HintLength + 4);
        builder.Property(l => l.KeyCreatedBy).HasMaxLength(200);
        builder.Property(l => l.UpdatedBy).HasMaxLength(200);
        builder.Ignore(l => l.HasKey);
        builder.Ignore(l => l.IsReady);
    }
}

internal sealed class SyncedEmployeeConfiguration : IEntityTypeConfiguration<SyncedEmployee>
{
    public void Configure(EntityTypeBuilder<SyncedEmployee> builder)
    {
        builder.ToTable("SyncedEmployees", CostingDbContext.CostingSchema);
        builder.Property(e => e.Code).HasMaxLength(SyncedEmployee.MaxCodeLength);
        builder.Property(e => e.FullName).HasMaxLength(SyncedEmployee.MaxNameLength);
        builder.Property(e => e.Department).HasMaxLength(100);
        builder.Property(e => e.Branch).HasMaxLength(100);
        builder.HasIndex(e => e.HrEmployeeId).IsUnique();
        builder.HasIndex(e => e.StaffMemberId).IsUnique();
        builder.HasOne<StaffMember>().WithMany().HasForeignKey(e => e.StaffMemberId).OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class HrSyncLogConfiguration : IEntityTypeConfiguration<HrSyncLog>
{
    public void Configure(EntityTypeBuilder<HrSyncLog> builder)
    {
        builder.ToTable("HrSyncLogs", CostingDbContext.CostingSchema);
        builder.HasKey(l => l.Id);
        builder.Property(l => l.Id).ValueGeneratedNever();
        builder.Property(l => l.Direction).IsEnumName();
        builder.Property(l => l.Call).HasMaxLength(60);
        builder.Property(l => l.Outcome).IsEnumName();
        builder.Property(l => l.Message).HasMaxLength(HrSyncLog.MaxMessageLength);
        builder.Property(l => l.Detail).HasMaxLength(2000);
        builder.HasIndex(l => l.AtUtc);
    }
}

internal sealed class HrOutboxItemConfiguration : IEntityTypeConfiguration<HrOutboxItem>
{
    public void Configure(EntityTypeBuilder<HrOutboxItem> builder)
    {
        builder.ToTable("HrOutbox", CostingDbContext.CostingSchema);
        builder.Property(i => i.Kind).HasMaxLength(40);
        builder.Property(i => i.Action).HasMaxLength(10);
        builder.Property(i => i.Payload).HasColumnType("text");
        builder.Property(i => i.Summary).HasMaxLength(HrOutboxItem.MaxSummaryLength);
        builder.Property(i => i.Status).IsEnumName();
        builder.Property(i => i.LastError).HasMaxLength(500);
        builder.HasIndex(i => new { i.Status, i.NextAttemptAtUtc });
        builder.HasIndex(i => i.CreatedAtUtc);
    }
}

internal sealed class PayrollRunConfiguration : IEntityTypeConfiguration<PayrollRun>
{
    public void Configure(EntityTypeBuilder<PayrollRun> builder)
    {
        builder.ToTable("PayrollRuns", CostingDbContext.CostingSchema);
        foreach (var money in new[]
                 {
                     nameof(PayrollRun.TotalGrossWages), nameof(PayrollRun.TotalAdditions), nameof(PayrollRun.TotalPenalties),
                     nameof(PayrollRun.TotalAdvancesDeducted), nameof(PayrollRun.TotalBroughtForward), nameof(PayrollRun.NetCashPayable),
                     nameof(PayrollRun.LaborCost),
                 })
            builder.Property(money).HasPrecision(18, 2);
        builder.Property(r => r.PayloadHash).HasMaxLength(64);
        builder.Property(r => r.Status).IsEnumName();
        builder.Property(r => r.DisbursedBy).HasMaxLength(200);
        builder.Ignore(r => r.IsDisbursed);
        builder.Ignore(r => r.PeriodName);
        // One a month.
        builder.HasIndex(r => r.Period).IsUnique();
        builder.HasMany(r => r.Departments).WithOne().HasForeignKey(d => d.PayrollRunId).OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(r => r.Departments).HasField("_departments").UsePropertyAccessMode(PropertyAccessMode.Field);
    }
}

internal sealed class PayrollRunDepartmentConfiguration : IEntityTypeConfiguration<PayrollRunDepartment>
{
    public void Configure(EntityTypeBuilder<PayrollRunDepartment> builder)
    {
        builder.ToTable("PayrollRunDepartments", CostingDbContext.CostingSchema);
        builder.Property(d => d.Name).HasMaxLength(100);
        foreach (var money in new[]
                 {
                     nameof(PayrollRunDepartment.GrossWages), nameof(PayrollRunDepartment.Additions), nameof(PayrollRunDepartment.Penalties),
                     nameof(PayrollRunDepartment.AdvancesDeducted), nameof(PayrollRunDepartment.NetCashPayable),
                 })
            builder.Property(money).HasPrecision(18, 2);
        builder.Ignore(d => d.LaborCost);
    }
}

internal sealed class StaffDeductionConfiguration : IEntityTypeConfiguration<StaffDeduction>
{
    public void Configure(EntityTypeBuilder<StaffDeduction> builder)
    {
        builder.ToTable("StaffDeductions", CostingDbContext.CostingSchema);
        builder.Property(d => d.Kind).IsEnumName();
        builder.Property(d => d.Amount).HasPrecision(18, 2);
        builder.Property(d => d.Reason).HasMaxLength(StaffDeduction.MaxReasonLength);
        builder.Property(d => d.RecordedBy).HasMaxLength(200);
        builder.Property(d => d.VoidedBy).HasMaxLength(200);
        builder.Ignore(d => d.IsVoided);
        builder.HasIndex(d => d.Date);
        builder.HasOne<StaffMember>().WithMany().HasForeignKey(d => d.EmployeeId).OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class HrLinkStore(CostingDbContext db) : IHrLinkStore
{
    // Made the first time it is asked for, and kept by this unit of work.
    public async Task<HrLink> GetAsync(CancellationToken cancellationToken = default)
    {
        if (db.HrLinks.Local.FirstOrDefault() is { } local)
            return local;
        if (await db.HrLinks.SingleOrDefaultAsync(l => l.Id == HrLink.SingletonId, cancellationToken) is { } kept)
            return kept;
        var made = HrLink.Create();
        db.HrLinks.Add(made);
        return made;
    }
}

internal sealed class SyncedEmployeeRepository(CostingDbContext db) : ISyncedEmployeeRepository
{
    public Task<SyncedEmployee?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        db.SyncedEmployees.SingleOrDefaultAsync(e => e.Id == id, cancellationToken);

    public void Add(SyncedEmployee aggregate) => db.SyncedEmployees.Add(aggregate);

    public async Task<IReadOnlyList<SyncedEmployee>> GetAllAsync(CancellationToken cancellationToken = default) =>
        await db.SyncedEmployees.OrderBy(e => e.FullName).ToListAsync(cancellationToken);

    public async Task<SyncedEmployee?> GetByStaffMemberAsync(Guid staffMemberId, CancellationToken cancellationToken = default) =>
        db.SyncedEmployees.Local.FirstOrDefault(e => e.StaffMemberId == staffMemberId)
        ?? await db.SyncedEmployees.SingleOrDefaultAsync(e => e.StaffMemberId == staffMemberId, cancellationToken);
}

internal sealed class HrOutboxRepository(CostingDbContext db) : IHrOutboxRepository
{
    public Task<HrOutboxItem?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        db.HrOutbox.SingleOrDefaultAsync(i => i.Id == id, cancellationToken);

    public void Add(HrOutboxItem aggregate) => db.HrOutbox.Add(aggregate);

    public async Task<IReadOnlyList<HrOutboxItem>> GetDueAsync(DateTime nowUtc, int take, CancellationToken cancellationToken = default) =>
        await db.HrOutbox.Where(i => i.Status == HrOutboxStatus.Pending && i.NextAttemptAtUtc <= nowUtc)
            .OrderBy(i => i.CreatedAtUtc).Take(take).ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<HrOutboxItem>> GetRecentAsync(int take, CancellationToken cancellationToken = default) =>
        await db.HrOutbox.AsNoTracking().OrderByDescending(i => i.CreatedAtUtc).Take(take).ToListAsync(cancellationToken);

    public Task<int> CountAsync(HrOutboxStatus status, CancellationToken cancellationToken = default) =>
        db.HrOutbox.CountAsync(i => i.Status == status, cancellationToken);
}

// The log, saved in a context of its own: what the call itself did is saved or thrown away with
// the call, and the log of it stays either way.
internal sealed class HrSyncJournal(IServiceScopeFactory scopes, CostingDbContext db) : IHrSyncJournal
{
    public async Task WriteAsync(HrSyncLog entry, CancellationToken cancellationToken = default)
    {
        await using var scope = scopes.CreateAsyncScope();
        var own = scope.ServiceProvider.GetRequiredService<CostingDbContext>();
        own.HrSyncLogs.Add(entry);
        await own.SaveChangesAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<HrSyncLog>> RecentAsync(int count, CancellationToken cancellationToken = default) =>
        await db.HrSyncLogs.AsNoTracking().OrderByDescending(l => l.AtUtc).Take(count).ToListAsync(cancellationToken);
}

internal sealed class PayrollRunRepository(CostingDbContext db) : IPayrollRunRepository
{
    private IQueryable<PayrollRun> WithDepartments => db.PayrollRuns.Include(r => r.Departments);

    public Task<PayrollRun?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        WithDepartments.SingleOrDefaultAsync(r => r.Id == id, cancellationToken);

    public void Add(PayrollRun aggregate) => db.PayrollRuns.Add(aggregate);

    public void Remove(PayrollRun run) => db.PayrollRuns.Remove(run);

    public async Task<IReadOnlyList<PayrollRun>> GetRecentAsync(int take, CancellationToken cancellationToken = default) =>
        await WithDepartments.OrderByDescending(r => r.Period).Take(take).ToListAsync(cancellationToken);

    public Task<PayrollRun?> GetForPeriodAsync(DateOnly period, CancellationToken cancellationToken = default) =>
        WithDepartments.SingleOrDefaultAsync(r => r.Period == period, cancellationToken);
}

internal sealed class StaffDeductionRepository(CostingDbContext db) : IStaffDeductionRepository
{
    public Task<StaffDeduction?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        db.StaffDeductions.SingleOrDefaultAsync(d => d.Id == id, cancellationToken);

    public void Add(StaffDeduction aggregate) => db.StaffDeductions.Add(aggregate);

    public async Task<IReadOnlyList<StaffDeduction>> GetBetweenAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken = default) =>
        await db.StaffDeductions.Where(d => d.Date >= from && d.Date <= to).ToListAsync(cancellationToken);
}
```


`HrIntegrationController.cs`: `HrIntegrationController` (ما يستدعيه HR، بـ `HrKeyFilter`)، `HrIntegrationSettingsController` (صفحة الإعدادات)، `PayrollRunsController` (المسيرات وصرفها)، و `StaffHrController` (حالة الربط، الإضافة المحلية، الخصومات).

> 📄 **`backend/src/Costing.Api/Controllers/HrIntegrationController.cs`** — 171 سطر

```csharp
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Costing.Api.Auth;
using Costing.Application.Approvals;
using Costing.Application.Company;
using Costing.Application.Integrations;
using Costing.Application.Staff;
using Costing.Application.Treasury;
using Costing.Domain.Access;
using Costing.Domain.Integrations;
using Costing.Domain.Staff;
using Costing.Infrastructure.Integrations;

namespace Costing.Api.Controllers;

// What the HR system calls here, with this system's key for it in X-API-Key, only while the link is
// switched on:
//   GET  ping         the link test, from HR's Settings → Costing Integration
//   POST payroll-run  a month's payroll approved on HR: its labor cost and net cash payable
// No user signs in for these. A wrong key, or none, or the link off, is refused and logged.
[ApiController]
[Route("api/integrations/hr")]
[AllowAnonymous]
[TypeFilter(typeof(HrKeyFilter))]
public sealed class HrIntegrationController(ISender sender, IHrSyncJournal journal) : ControllerBase
{
    [HttpGet("ping")]
    public async Task<IActionResult> Ping(CancellationToken cancellationToken)
    {
        var name = (await sender.Send(new GetCompanySettingsQuery(), cancellationToken)).Name;
        await journal.WriteAsync(new HrSyncLog(HrSyncDirection.Inbound, "ping", HrSyncOutcome.Read, "Link tested from HR."), cancellationToken);
        return Ok(new { ok = true, system = "Costing", company = name, atUtc = DateTime.UtcNow });
    }

    // Recorded (200, Recorded or Updated), the same again (200, Unchanged); refused (422) with why.
    [HttpPost("payroll-run")]
    public Task<PayrollRunResultDto> PayrollRun(PayrollRunInput request, CancellationToken cancellationToken) =>
        sender.Send(new ReceivePayrollRunCommand(request), cancellationToken);
}

// This system's key for HR in X-API-Key (or X-Costing-Key), checked against the hash kept; a wrong
// one, or none, or the link switched off, is answered 401 and logged. Never logs the key.
public sealed class HrKeyFilter(ISender sender, IHrSyncJournal journal) : IAsyncActionFilter
{
    public static readonly string[] Headers = ["X-API-Key", "X-Costing-Key"];

    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var request = context.HttpContext.Request;
        var key = Headers.Select(h => request.Headers[h].ToString()).FirstOrDefault(v => !string.IsNullOrWhiteSpace(v));
        if (!await sender.Send(new VerifyHrKeyQuery(key), context.HttpContext.RequestAborted))
        {
            var call = request.Path.Value?.Split('/').LastOrDefault() ?? "hr";
            await journal.WriteAsync(new HrSyncLog(HrSyncDirection.Inbound, call, HrSyncOutcome.Unauthorized,
                key is null ? "Refused: no X-API-Key." : "Refused: the key is not this system's key for HR, or the HR link is switched off.",
                detail: $"From {context.HttpContext.Connection.RemoteIpAddress}"), context.HttpContext.RequestAborted);
            context.Result = new UnauthorizedObjectResult(new { errors = new[] { "Send this system's key for HR in X-API-Key, with the HR link switched on." } });
            return;
        }
        await next();
    }
}

// Settings → HR Integration (ربط الموارد البشرية), a manager's: the link switched on or off, HR's
// address and key, this system's key for HR (shown once), the link tested, HR's employees read, and
// the sync log and what waits to be sent.
[ApiController]
[Route("api/settings/hr-integration")]
[Authorize(Policy = Permissions.SettingsManage)]
public sealed class HrIntegrationSettingsController(ISender sender, IHrOutboxSender outbox) : ControllerBase
{
    [HttpGet]
    public Task<HrIntegrationDto> Get(CancellationToken cancellationToken) => sender.Send(new GetHrIntegrationQuery(), cancellationToken);

    // HrKey: HR's key, when a new one is pasted; left out, the one kept stays.
    [HttpPut]
    public Task<HrIntegrationDto> Save(HrLinkRequest request, CancellationToken cancellationToken) =>
        sender.Send(new SaveHrLinkCommand(request.Enabled, request.BaseUrl, request.HrKey, StaffName), cancellationToken);

    // A new key for HR, in full this once; the one before stops working.
    [HttpPost("key")]
    public Task<HrKeyDto> GenerateKey(CancellationToken cancellationToken) => sender.Send(new GenerateHrKeyCommand(StaffName), cancellationToken);

    [HttpPost("test")]
    public Task<HrTestResultDto> Test(CancellationToken cancellationToken) => sender.Send(new TestHrLinkCommand(), cancellationToken);

    [HttpPost("sync-employees")]
    public Task<HrEmployeeSyncDto> SyncEmployees(CancellationToken cancellationToken) => sender.Send(new SyncHrEmployeesCommand(), cancellationToken);

    // What waits sent now, rather than on the link's next tick.
    [HttpPost("outbox/send")]
    public async Task<object> SendNow(CancellationToken cancellationToken) => new { sent = await outbox.SendDueAsync(cancellationToken) };

    [HttpPost("outbox/{itemId:guid}/retry")]
    public Task<HrOutboxItemDto> Retry(Guid itemId, CancellationToken cancellationToken) => sender.Send(new RetryHrOutboxCommand(itemId), cancellationToken);

    private string StaffName => User.FindFirst(UserClaims.Name)?.Value ?? string.Empty;
}

public sealed record HrLinkRequest(bool Enabled, string? BaseUrl, string? HrKey);

// The payrolls HR approved and sent (Financials → Staff → Payroll from HR), and each paid out of the
// safe: a manager's at once (200, the entry); anyone else's asked of a manager (202, the request).
[ApiController]
[Route("api/financials/payroll-runs")]
[Authorize(Policy = Permissions.InventoryManage)]
public sealed class PayrollRunsController(ISender sender) : ControllerBase
{
    [HttpGet]
    [CostingTab(CostingTabs.Financials)]
    public Task<IReadOnlyList<PayrollRunDto>> Get(CancellationToken cancellationToken) => sender.Send(new GetPayrollRunsQuery(), cancellationToken);

    [HttpPost("{runId:guid}/disburse")]
    [CostingTab(CostingTabs.Financials)]
    public async Task<IActionResult> Disburse(Guid runId, PayrollDisburseRequest request, CancellationToken cancellationToken)
    {
        var result = await sender.Send(new DisbursePayrollRunCommand(
            runId, request.TransactionId, request.RequestId, UserClaims.IdOf(User) ?? string.Empty, User.FindFirst(UserClaims.Name)?.Value ?? string.Empty,
            UserClaims.RoleOf(User) is { } role && RolePermissions.Has(role, Permissions.ApprovalDecide)), cancellationToken);
        return result.Outcome == ApprovalOutcome.Applied ? Ok(result) : Accepted(result);
    }
}

public sealed record PayrollDisburseRequest(Guid TransactionId, Guid RequestId);

// The staff and the HR link as the screens that choose an employee see it, the deductions charged
// to the staff, and a staff member added from the end of the day while HR is not linked.
[ApiController]
[Route("api/staff")]
[Authorize(Policy = Permissions.InventoryView)]
public sealed class StaffHrController(ISender sender) : ControllerBase
{
    private const CostingTabs Choosers = CostingTabs.Financials | CostingTabs.Purchases | CostingTabs.Waste | CostingTabs.EndOfDay;

    // Whether the staff come from HR now.
    [HttpGet("hr-status")]
    [CostingTab(Choosers)]
    public Task<HrStatusDto> HrStatus(CancellationToken cancellationToken) => sender.Send(new GetHrStatusQuery(), cancellationToken);

    [HttpPost("local")]
    [CostingTab(CostingTabs.Financials | CostingTabs.EndOfDay)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<StaffMemberDto> AddLocal(LocalStaffRequest request, CancellationToken cancellationToken) =>
        sender.Send(new AddLocalStaffMemberCommand(request.Id, request.Name, request.JobTitle), cancellationToken);

    [HttpGet("deductions")]
    [CostingTab(CostingTabs.Financials)]
    public Task<IReadOnlyList<StaffDeductionDto>> Deductions([FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken cancellationToken) =>
        sender.Send(new GetStaffDeductionsQuery(from, to), cancellationToken);

    // A till shortage or a staff charge, to come off their pay: sent to HR when it is linked.
    [HttpPost("deductions")]
    [CostingTab(CostingTabs.Financials)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<StaffDeductionDto> RecordDeduction(StaffDeductionRequest request, CancellationToken cancellationToken) =>
        sender.Send(new RecordStaffDeductionCommand(
            request.Id, request.EmployeeId, request.Date, request.Kind, request.Amount, request.Reason, User.FindFirst(UserClaims.Name)?.Value ?? string.Empty),
            cancellationToken);

    [HttpPost("deductions/{deductionId:guid}/void")]
    [CostingTab(CostingTabs.Financials)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<StaffDeductionDto> VoidDeduction(Guid deductionId, CancellationToken cancellationToken) =>
        sender.Send(new VoidStaffDeductionCommand(deductionId, User.FindFirst(UserClaims.Name)?.Value ?? string.Empty), cancellationToken);
}

public sealed record LocalStaffRequest(Guid Id, string Name, string? JobTitle);

public sealed record StaffDeductionRequest(Guid Id, Guid EmployeeId, DateOnly Date, StaffDeductionKind Kind, decimal Amount, string? Reason);
```


[الفصل التالي: نواة الفرونت إند وشاشات التشغيل →](08-frontend-core-and-operations-screens.md)
