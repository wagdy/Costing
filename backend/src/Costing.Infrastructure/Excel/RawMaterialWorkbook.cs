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
