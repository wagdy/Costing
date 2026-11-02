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
