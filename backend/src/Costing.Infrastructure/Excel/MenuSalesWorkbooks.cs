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
