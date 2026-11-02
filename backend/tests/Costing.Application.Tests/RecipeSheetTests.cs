using System.Globalization;
using Costing.Domain.Common;
using Costing.Application.Production;
using Costing.Application.RawMaterials;
using Costing.Application.Recipes;
using Costing.Domain.Approvals;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;

namespace Costing.Application.Tests;

// Recipes to and from a spreadsheet: each written out a row per ingredient, the ingredient by a
// label that says its unit; read back grouped by recipe, each one's ingredients replaced whole or
// not at all, and costed from its ingredients' prices.
public class RecipeSheetTests
{
    private readonly TestCosting _pos = new();

    // Flour 30 a kg, mozzarella 300 a kg, eggs 4.25 each, milk 40 a litre; pizza dough made from
    // 600 g of flour a 1 kg batch, never made yet so not priced.
    private static async Task<Dictionary<string, Guid>> SeedAsync(TestCosting pos)
    {
        var ids = new Dictionary<string, Guid>
        {
            ["Flour"] = (await pos.Send(new CreateRawMaterialCommand("Flour", UnitOfMeasure.Gram, CostPerPurchaseUnit: 30))).Id,
            ["Mozzarella"] = (await pos.Send(new CreateRawMaterialCommand("Mozzarella", UnitOfMeasure.Gram, Code: "DAI-1", CostPerPurchaseUnit: 300))).Id,
            ["Eggs"] = (await pos.Send(new CreateRawMaterialCommand("Eggs", UnitOfMeasure.Piece, CostPerPurchaseUnit: 4.25m))).Id,
            ["Milk"] = (await pos.Send(new CreateRawMaterialCommand("Milk", UnitOfMeasure.Millilitre, CostPerPurchaseUnit: 40))).Id,
        };
        ids["Pizza dough"] = (await pos.Send(new SavePrepItemCommand(null, "Pizza dough", UnitOfMeasure.Gram, 1000, [new PrepIngredientEntry(ids["Flour"], 600)]))).Id;
        return ids;
    }

    private Task<RecipeImportResult> Import(params RecipeSheetRow[] rows) => _pos.Send(new ImportRecipesCommand(rows));

    private async Task<Recipe> RecipeOf(RecipeTarget target) => (await _pos.Inventory.Recipes.GetByTargetAsync(target))!;

    private async Task<Recipe> RecipeNamed(string name) => (await _pos.Inventory.Recipes.GetAllAsync()).Single(r => r.Name == name);

    [Fact]
    public async Task Each_recipe_is_written_out_a_row_per_ingredient_named_with_its_unit()
    {
        var ids = await SeedAsync(_pos);
        var meals = Guid.NewGuid();
        await _pos.Send(new SaveRecipeCategoryCommand(meals, "Staff meals"));
        await _pos.Send(new SetRecipeCommand(RecipeTargetKind.MenuItem, TestCosting.Burger, null,
            [new RecipeIngredientDto(ids["Mozzarella"], 150), new RecipeIngredientDto(ids["Pizza dough"], 250)]));
        await _pos.Send(new SaveRecipeCommand(null, "Staff meal", null, null, null, 4, [new RecipeIngredientDto(ids["Eggs"], 2)], meals));

        var sheet = await _pos.Send(new GetRecipeSheetQuery());

        Assert.Equal(
            [
                new RecipeSheetLine("1 · Burger", "Mozzarella (Kg)", 0.15m, 1, null),
                new RecipeSheetLine("1 · Burger", "Pizza dough · مصنّع (Kg)", 0.25m, null, null),
                new RecipeSheetLine("Staff meal", "Eggs (Piece)", 2, 4, "Staff meals"),
            ],
            sheet.Lines);
        // The dropdowns: the menu's items, sizes and add-ons by code, and the recipes off it; every
        // ingredient with its unit, the bought ones first; the kitchen's categories.
        Assert.Equal(["1 · Burger", "10 · Shawarma", "10-101 · Shawarma (Kilo tray)", "10-102 · Shawarma (Half tray)", "A7 · Cheese", "Staff meal"], sheet.Items);
        Assert.Equal(["Eggs (Piece)", "Flour (Kg)", "Milk (Liter)", "Mozzarella (Kg)", "Pizza dough · مصنّع (Kg)"], sheet.Ingredients.Select(i => i.Label));
        Assert.Equal(new SheetIngredient("Mozzarella (Kg)", "Mozzarella", "DAI-1", false, "Kg", "كيلو"), sheet.Ingredients[3]);
        Assert.True(sheet.Ingredients[4].IsPrepItem);
        Assert.Equal(["Staff meals"], sheet.Categories);
    }

    [Fact]
    public async Task Rows_are_grouped_by_recipe_and_each_one_replaced_whole_or_left_as_it_was()
    {
        var ids = await SeedAsync(_pos);
        var meals = Guid.NewGuid();
        await _pos.Send(new SaveRecipeCategoryCommand(meals, "Staff meals"));
        await _pos.Send(new SetRecipeCommand(RecipeTargetKind.MenuItem, TestCosting.Burger, null, [new RecipeIngredientDto(ids["Mozzarella"], 150, 90)]));
        await _pos.Send(new SaveRecipeCommand(null, "Staff meal", null, null, null, 4, [new RecipeIngredientDto(ids["Eggs"], 2)], meals));

        var result = await Import(
            new(2, "1 · Burger", "Mozzarella (Kg)", "0.2", Portions: "1"),
            new(3, null, "Flour (Kg)", "0.1"),
            new(4, "10-101 · Shawarma (Kilo tray)", "Pizza dough · مصنّع (Kg)", "1", Portions: "4"),
            new(5, "Shawarma (Half tray)", "flour", "0.5"),
            new(6, "staff meal", "Eggs (Piece)", "3", Portions: "3", Category: "Staff meals"),
            new(7, "Lunch special", "Milk (Liter)", "0.25", Category: "Specials"),
            new(8, "Bad dish", "Mozzarella (g)", "150"),
            new(9, null, "Saffron", "0.001"),
            new(10, "Bad dish", "Flour (Kg)", "0.2"),
            new(11, "6199 · Ghost", "Flour (Kg)", "1"),
            new(12, "Burger", "Flour (Kg)", "1"),
            new(13, "Soup", "Flour (Kg)", "a pinch"),
            new(14, "A7 · Cheese", "DAI-1", "0.03"),
            new(15, "Lunch special", "Flour (Kg)", "0.05"),
            new(16, "Pasta", "Flour (Kg)", "0"));

        Assert.Equal(
            [(4, "10-101 · Shawarma (Kilo tray)"), (5, "Shawarma (Half tray)"), (7, "Lunch special"), (14, "A7 · Cheese")],
            result.Created.Select(c => (c.Row, c.Name)));
        Assert.Equal([(2, "1 · Burger", "Ingredients"), (6, "staff meal", "Ingredients, Portions")], result.Updated.Select(u => (u.Row, u.Name, string.Join(", ", u.Changes))));
        Assert.Equal(
            [
                (8, "Mozzarella is written in Kg on this sheet, not in g: choose it from the list and write 0.2 for 200 g. The recipe is left as it was."),
                (9, "\"Saffron\" is not a raw material or a prep item: choose it from the list, or add it on Raw materials first. The recipe is left as it was."),
                (11, "6199 is not on the menu: choose the item from the list, or add it on Menu first."),
                (12, "Also on row 2, which is the one imported."),
                (13, "\"a pinch\" is not a quantity: write a number of Kg, such as 0.25. The recipe is left as it was."),
                (16, "The quantity of Flour is more than nothing. The recipe is left as it was."),
            ],
            result.Skipped.Select(s => (s.Row, s.Reason)));
        Assert.All(result.Skipped, s => Assert.False(string.IsNullOrWhiteSpace(s.ReasonAr)));
        Assert.Equal(["Specials"], result.CategoriesAdded);

        // The burger: its whole list replaced, mozzarella keeping its 90% yield; in its own units.
        var burger = await RecipeOf(RecipeTarget.ForMenuItem(TestCosting.Burger));
        Assert.Equal([(ids["Mozzarella"], 200m, 90m), (ids["Flour"], 100m, 100m)], burger.Ingredients.Select(i => (i.RawMaterialId, i.Quantity, i.YieldPercent)));
        // Linked by code, and by the size's name.
        Assert.Equal((4, 1000m), ((await RecipeOf(RecipeTarget.ForVariant(TestCosting.Shawarma, TestCosting.KiloTray))).Portions,
            (await RecipeOf(RecipeTarget.ForVariant(TestCosting.Shawarma, TestCosting.KiloTray))).Ingredients.Single().Quantity));
        Assert.Equal(500m, (await RecipeOf(RecipeTarget.ForVariant(TestCosting.Shawarma, TestCosting.HalfTray))).Ingredients.Single().Quantity);
        Assert.Equal(30m, (await RecipeOf(RecipeTarget.ForAddOn(TestCosting.Cheese))).Ingredients.Single().Quantity);
        var staff = await RecipeNamed("Staff meal");
        Assert.Equal((3, 3m, (Guid?)meals), (staff.Portions, staff.Ingredients.Single().Quantity, staff.RecipeCategoryId));
        var lunch = await RecipeNamed("Lunch special");
        Assert.Equal((false, 2), (lunch.IsLinked, lunch.Ingredients.Count));
        Assert.DoesNotContain(await _pos.Inventory.Recipes.GetAllAsync(), r => r.Name is "Bad dish" or "Soup" or "Pasta");

        // Costed from today's prices: the burger 60 of mozzarella (90% yield: 66.67) and 3 of flour.
        var costs = result.Costed.ToDictionary(c => c.Name);
        Assert.Equal((69.67m, 69.67m, "portion", 2), (costs["1 · Burger"].Cost, costs["1 · Burger"].CostPer, costs["1 · Burger"].Per, costs["1 · Burger"].Ingredients));
        Assert.Equal((12.75m, 4.25m), (costs["staff meal"].Cost, costs["staff meal"].CostPer));
        Assert.Equal((11.5m, 11.5m), (costs["Lunch special"].Cost, costs["Lunch special"].CostPer));
        // Made with pizza dough, which has no price until a batch is made.
        Assert.Equal(["Pizza dough"], costs["10-101 · Shawarma (Kilo tray)"].MissingPrices);
    }

    [Fact]
    public async Task A_quantity_that_reads_as_grams_or_an_ingredient_twice_is_said()
    {
        await SeedAsync(_pos);

        var result = await Import(
            new(2, "Pasta", "Flour (Kg)", "200", Portions: "2"),
            new(3, "Pasta", "Flour (Kg)", "1"),
            new(4, "Omelette", "Eggs (Piece)", "3"));

        var notes = result.Costed.Single(c => c.Name == "Pasta").Notes;
        Assert.Equal(2, notes.Count);
        Assert.StartsWith("Flour is on it twice: the quantities are added together.", notes[0]);
        Assert.StartsWith("Flour: 100.5 Kg a portion. Was it written in grams?", notes[1]);
        Assert.Equal(201_000m, (await RecipeNamed("Pasta")).Ingredients.Single().Quantity);
        Assert.Empty(result.Costed.Single(c => c.Name == "Omelette").Notes);
    }

    [Fact]
    public async Task One_waiting_for_a_manager_or_deleted_is_left_as_it_is()
    {
        var ids = await SeedAsync(_pos);
        var meals = Guid.NewGuid();
        await _pos.Send(new SaveRecipeCategoryCommand(meals, "Staff meals"));
        var staff = await _pos.Send(new SaveRecipeCommand(null, "Staff meal", null, null, null, 1, [new RecipeIngredientDto(ids["Eggs"], 2)], meals));
        _pos.Inventory.ApprovalRequests.Add(ApprovalRequest.Ask(Guid.NewGuid(), ApprovalModule.Recipe, staff.Id, "Staff meal", null, "u1", "Mona"));
        var old = await _pos.Send(new SaveRecipeCommand(null, "Old special", null, null, null, 1, [new RecipeIngredientDto(ids["Eggs"], 1)], meals));
        await _pos.Send(new DeleteRecipeCommand(old.Id, "Omar"));

        var result = await Import(new(2, "Staff meal", "Eggs (Piece)", "5"), new(3, "Old special", "Eggs (Piece)", "2"));

        Assert.Equal(
            [
                (2, "Staff meal waits for a manager's approval: import it again once that is decided."),
                (3, "Old special was deleted: restore it from the deleted recipes, or give the row another name."),
            ],
            result.Skipped.Select(s => (s.Row, s.Reason)));
        Assert.Equal(2m, (await RecipeNamed("Staff meal")).Ingredients.Single().Quantity);
    }

    [Fact]
    public async Task The_recipes_written_out_import_into_another_installation_as_they_are()
    {
        var ids = await SeedAsync(_pos);
        var meals = Guid.NewGuid();
        await _pos.Send(new SaveRecipeCategoryCommand(meals, "Staff meals"));
        await _pos.Send(new SetRecipeCommand(RecipeTargetKind.MenuItem, TestCosting.Shawarma, TestCosting.KiloTray,
            [new RecipeIngredientDto(ids["Flour"], 1250), new RecipeIngredientDto(ids["Milk"], 333.3m)], Portions: 4));
        await _pos.Send(new SetRecipeCommand(RecipeTargetKind.AddOn, TestCosting.Cheese, null, [new RecipeIngredientDto(ids["Mozzarella"], 30)]));
        await _pos.Send(new SaveRecipeCommand(null, "Staff meal", null, null, null, 4, [new RecipeIngredientDto(ids["Eggs"], 2)], meals));

        var written = await _pos.Send(new GetRecipeSheetQuery());
        static string? Cell(decimal? value) => value?.ToString(CultureInfo.InvariantCulture);
        var rows = written.Lines.Select((l, i) => new RecipeSheetRow(i + 2, l.Item, l.Ingredient, Cell(l.Quantity), Cell(l.Portions), l.Category)).ToArray();

        var elsewhere = new TestCosting();
        await SeedAsync(elsewhere);
        var imported = await elsewhere.Send(new ImportRecipesCommand(rows));
        Assert.Equal((3, 0), (imported.Created.Count, imported.Skipped.Count));
        Assert.Equal(["Staff meals"], imported.CategoriesAdded);
        Assert.Equal(written.Lines, (await elsewhere.Send(new GetRecipeSheetQuery())).Lines);

        var again = await Import(rows);
        Assert.Equal((0, 0, 3), (again.Created.Count, again.Updated.Count, again.Unchanged));
    }

    [Fact]
    public async Task An_empty_sheet_or_one_too_long_is_refused()
    {
        Assert.StartsWith("The sheet has no recipes on it", (await Assert.ThrowsAsync<DomainException>(() => Import())).Message);
        var rows = Enumerable.Range(2, 5_001).Select(r => new RecipeSheetRow(r, "Soup", "Flour (Kg)", "1")).ToArray();
        await Assert.ThrowsAsync<DomainException>(() => Import(rows));
    }
}
