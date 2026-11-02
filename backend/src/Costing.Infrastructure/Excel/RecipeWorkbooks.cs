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
