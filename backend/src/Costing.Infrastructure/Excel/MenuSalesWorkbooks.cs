using Costing.Application.Menu;
using Costing.Application.Sales;

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
        new("Voided", "Voided · ملغي", ["voided", "void", "void type", "ملغي", "الإلغاء"],
            "Blank for a line on the bill. Before kitchen (no stock), After kitchen (waste), or After payment (refunded, back to stock)."),
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
        ["R-1001", "2026-10-12", "13:40", "Dine in", "Cash", 6101, "", "", 2, 280, 0, 0, 39.2, 0, 0, ""],
        ["R-1001", "2026-10-12", "13:40", "Dine in", "Cash", 6201, "", "Extra cheese", 1, 110, "", "", "", "", "", ""],
        ["R-1002", "2026-10-12", "14:05", "Delivery", "Visa", 6101, "Large", "", 1, 180, 10, 25, 23.8, 0, 0, ""],
        ["R-1002", "2026-10-12", "14:05", "Delivery", "Visa", 6201, "", "", 1, 95, "", "", "", "", "", "After kitchen"],
    ]);

    public static IReadOnlyList<SaleImportRow> Read(Stream stream)
    {
        var rows = SheetBook.Read(stream, Columns, "Item", "Item");
        return rows.Select(r => new SaleImportRow(
                r.Row, r.Text("Reference"), r.Date("Date"), r.Time("Time"), r.Text("Channel"), r.Text("Payment"), r.Text("Item"), r.Text("Size"),
                r.Text("AddOns"), r.Number("Quantity"), r.Number("LineTotal"), r.Number("Discount"), r.Number("DeliveryFee"), r.Number("Tax"),
                r.Number("Points"), r.Number("Refunded"), r.Text("Voided")))
            .ToList();
    }
}
