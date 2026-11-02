using System.Globalization;
using Costing.Application.Production;
using Costing.Application.RawMaterials;
using Costing.Application.Recipes;
using Costing.Domain.Approvals;
using Costing.Domain.RawMaterials;

namespace Costing.Application.Tests;

// Prep items' batch recipes to and from a spreadsheet: written out a row per ingredient; read back
// grouped by prep item, each one's recipe replaced whole or not at all, a new one made after any
// new one it is made with; a manager's saved, anyone else's asked of a manager.
public class PrepRecipeSheetTests
{
    private readonly TestCosting _pos = new();

    // Flour 30 a kg, oil 80 a litre, garlic 60 a kg, eggs 4.25 each; pizza dough, 600 g of flour and
    // 50 ml of oil at a 90% yield for a 1 kg batch.
    private static async Task<Dictionary<string, Guid>> SeedAsync(TestCosting pos)
    {
        var ids = new Dictionary<string, Guid>
        {
            ["Flour"] = (await pos.Send(new CreateRawMaterialCommand("Flour", UnitOfMeasure.Gram, CostPerPurchaseUnit: 30))).Id,
            ["Oil"] = (await pos.Send(new CreateRawMaterialCommand("Oil", UnitOfMeasure.Millilitre, CostPerPurchaseUnit: 80))).Id,
            ["Garlic"] = (await pos.Send(new CreateRawMaterialCommand("Garlic", UnitOfMeasure.Gram, CostPerPurchaseUnit: 60))).Id,
            ["Eggs"] = (await pos.Send(new CreateRawMaterialCommand("Eggs", UnitOfMeasure.Piece, CostPerPurchaseUnit: 4.25m))).Id,
        };
        ids["Pizza dough"] = (await pos.Send(new SavePrepItemCommand(null, "Pizza dough", UnitOfMeasure.Gram, 1000,
            [new PrepIngredientEntry(ids["Flour"], 600), new PrepIngredientEntry(ids["Oil"], 50, 90)]))).Id;
        return ids;
    }

    private Task<RecipeImportResult> Import(bool manager, params PrepRecipeSheetRow[] rows) =>
        _pos.Send(new ImportPrepRecipesCommand(rows, "u1", manager ? "Omar" : "Mona", manager));

    private async Task<RawMaterial> Item(string name) => (await _pos.Inventory.GetAllAsync()).Single(m => m.Name == name);

    [Fact]
    public async Task Each_prep_item_is_written_out_a_row_per_ingredient_its_batch_on_its_first()
    {
        await SeedAsync(_pos);
        await _pos.Send(new SavePrepItemCommand(null, "Croutons", UnitOfMeasure.Piece, 50, []));

        var sheet = await _pos.Send(new GetPrepRecipeSheetQuery());

        Assert.Equal(
            [
                // One with no recipe yet: a row of its own.
                new PrepRecipeSheetLine("Croutons", null, null, 50, "Piece"),
                new PrepRecipeSheetLine("Pizza dough", "Flour (Kg)", 0.6m, 1, "Kg"),
                new PrepRecipeSheetLine("Pizza dough", "Oil (Liter)", 0.05m, null, null),
            ],
            sheet.Lines);
        Assert.Equal(["Croutons", "Pizza dough"], sheet.Items);
        Assert.Equal(["Eggs (Piece)", "Flour (Kg)", "Garlic (Kg)", "Oil (Liter)", "Croutons · مصنّع (Piece)", "Pizza dough · مصنّع (Kg)"],
            sheet.Ingredients.Select(i => i.Label));
    }

    [Fact]
    public async Task A_managers_rows_replace_each_recipe_whole_and_make_new_ones_after_those_they_are_made_with()
    {
        var ids = await SeedAsync(_pos);

        var result = await Import(true,
            new(2, "Pizza dough", "Flour (Kg)", "0.7", Makes: "1.2"),
            new(3, null, "Oil (Liter)", "0.05"),
            // Made with garlic oil, which is new on the sheet, below it.
            new(4, "Garlic bread base", "Pizza dough · مصنّع (Kg)", "1"),
            new(5, null, "Garlic oil", "0.1"),
            new(6, "Garlic oil", "Oil (Liter)", "0.9", Makes: "1", Unit: "Liter"),
            new(7, null, "Garlic (Kg)", "0.2"),
            new(8, "Egg wash", "Eggs (Piece)", "6", Unit: "Piece"),
            new(9, "Flour", "Eggs (Piece)", "1"),
            new(11, "Loop", "Loop", "1"),
            new(12, "Dough twice", "Flour (Kg)", "0.5", Unit: "Liter"),
            new(13, "Dough twice", "Flour (g)", "500"));

        Assert.Equal(
            [(6, "Garlic oil"), (4, "Garlic bread base")],
            result.Created.Select(c => (c.Row, c.Name)));
        Assert.Equal([(2, "Pizza dough", "Ingredients, Batch")], result.Updated.Select(u => (u.Row, u.Name, string.Join(", ", u.Changes))));
        Assert.Equal(
            [
                (8, "Say how many pieces one batch makes, under Batch Makes."),
                (9, "Flour is a bought raw material: a prep item takes another name."),
                (11, "A prep item is not made from itself. The prep item is left as it was."),
                (13, "Flour is written in Kg on this sheet, not in g: choose it from the list and write 0.2 for 200 g. The prep item is left as it was."),
            ],
            result.Skipped.Select(s => (s.Row, s.Reason)));
        // Kept under المصنعات, added for them.
        Assert.Equal(["مصنعات"], result.CategoriesAdded);

        // The dough's recipe replaced, the oil keeping its 90% yield; its batch now 1.2 kg.
        var dough = (await _pos.Inventory.PrepRecipes.GetByIdAsync(ids["Pizza dough"]))!;
        Assert.Equal(1200m, dough.BatchQuantity);
        Assert.Equal([(ids["Flour"], 700m, 100m), (ids["Oil"], 50m, 90m)], dough.Ingredients.Select(i => (i.RawMaterialId, i.Quantity, i.YieldPercent)));
        // Garlic oil in litres, its batch as written; the bread base made with it, its batch the
        // weight of its ingredients (a litre as a kilo), and said so.
        var garlicOil = await Item("Garlic oil");
        Assert.Equal((MaterialKind.Prep, UnitOfMeasure.Millilitre, 1000m), (garlicOil.Kind, garlicOil.Unit, (await _pos.Inventory.PrepRecipes.GetByIdAsync(garlicOil.Id))!.BatchQuantity));
        var baseRecipe = (await _pos.Inventory.PrepRecipes.GetByIdAsync((await Item("Garlic bread base")).Id))!;
        Assert.Equal((1100m, 2), (baseRecipe.BatchQuantity, baseRecipe.Ingredients.Count));
        var costs = result.Costed.ToDictionary(c => c.Name);
        Assert.StartsWith("Makes 1.1 Kg a batch: the weight of its ingredients.", costs["Garlic bread base"].Notes.Single());

        // Costed per batch and per kg or litre: the dough 21 of flour and 4.44 of oil, for 1.2 kg.
        Assert.Equal((25.44m, 21.2m, "Kg"), (costs["Pizza dough"].Cost, costs["Pizza dough"].CostPer, costs["Pizza dough"].Per));
        Assert.Equal((84m, 84m, "Liter"), (costs["Garlic oil"].Cost, costs["Garlic oil"].CostPer, costs["Garlic oil"].Per));
        // Prep items have no price until a batch is made.
        Assert.Equal(["Pizza dough", "Garlic oil"], costs["Garlic bread base"].MissingPrices);
    }

    [Fact]
    public async Task Anyone_but_a_manager_asks_for_each_and_nothing_changes_until_it_is_approved()
    {
        var ids = await SeedAsync(_pos);

        var result = await Import(false,
            new(2, "Pizza dough", "Flour (Kg)", "0.8"),
            new(3, "Garlic oil", "Oil (Liter)", "0.9", Unit: "Liter"),
            new(4, "Garlic bread base", "Garlic oil", "0.1"));

        Assert.Equal((0, 0, 2), (result.Created.Count, result.Updated.Count, result.Requested));
        Assert.Equal([(4, "Made with Garlic oil, which waits for a manager's approval: import the sheet again once it is approved.")],
            result.Skipped.Select(s => (s.Row, s.Reason)));
        Assert.All(result.Costed, c => Assert.True(c.Requested));
        var asked = await _pos.Inventory.ApprovalRequests.GetPendingAsync();
        Assert.Equal([(ApprovalModule.PrepItem, ApprovalAction.Update), (ApprovalModule.PrepItem, ApprovalAction.Create)], asked.Select(a => (a.Module, a.Action)));
        Assert.Equal(600m, (await _pos.Inventory.PrepRecipes.GetByIdAsync(ids["Pizza dough"]))!.Ingredients.Single(i => i.RawMaterialId == ids["Flour"]).Quantity);
        Assert.DoesNotContain(await _pos.Inventory.GetAllAsync(), m => m.Name == "Garlic oil");

        // Asked already: not asked twice.
        var again = await Import(false, new(2, "Pizza dough", "Flour (Kg)", "0.8"), new(3, "Garlic oil", "Oil (Liter)", "0.9"));
        Assert.Equal(["Pizza dough waits for a manager's approval: import it again once that is decided.", "Garlic oil waits for a manager's approval: import it again once that is decided."],
            again.Skipped.Select(s => s.Reason));
    }

    [Fact]
    public async Task One_kept_in_another_unit_is_not_changed()
    {
        await SeedAsync(_pos);

        var result = await Import(true, new(2, "Pizza dough", "Flour (Kg)", "0.6", Unit: "Piece"), new(3, "Sauce", "Oil (Liter)", "1", Unit: "Bucket"));

        Assert.Equal(
            [
                (2, "Pizza dough is kept by the Kg, not the Piece: its stock and batches are in it. Add a new prep item for another unit."),
                (3, "\"Bucket\" is not a unit the system knows: Kg, Liter or Piece."),
            ],
            result.Skipped.Select(s => (s.Row, s.Reason)));
    }

    [Fact]
    public async Task The_prep_items_written_out_import_into_another_installation_as_they_are()
    {
        var ids = await SeedAsync(_pos);
        await _pos.Send(new SavePrepItemCommand(null, "Garlic oil", UnitOfMeasure.Millilitre, 1000,
            [new PrepIngredientEntry(ids["Oil"], 900), new PrepIngredientEntry(ids["Garlic"], 200)]));
        await _pos.Send(new SavePrepItemCommand(null, "Garlic bread base", UnitOfMeasure.Gram, 1100,
            [new PrepIngredientEntry(ids["Pizza dough"], 1000), new PrepIngredientEntry((await Item("Garlic oil")).Id, 100)]));

        var written = await _pos.Send(new GetPrepRecipeSheetQuery());
        static string? Cell(decimal? value) => value?.ToString(CultureInfo.InvariantCulture);
        var rows = written.Lines.Select((l, i) => new PrepRecipeSheetRow(i + 2, l.Item, l.Ingredient, Cell(l.Quantity), Cell(l.Makes), l.Unit)).ToArray();

        // Into an installation with the bought materials only: each prep item made after those it is made with.
        var elsewhere = new TestCosting();
        foreach (var (name, unit, cost) in new[] { ("Flour", UnitOfMeasure.Gram, 30m), ("Oil", UnitOfMeasure.Millilitre, 80m), ("Garlic", UnitOfMeasure.Gram, 60m), ("Eggs", UnitOfMeasure.Piece, 4.25m) })
            await elsewhere.Send(new CreateRawMaterialCommand(name, unit, CostPerPurchaseUnit: cost));
        var imported = await elsewhere.Send(new ImportPrepRecipesCommand(rows, "u1", "Omar", true));
        Assert.Equal((3, 0), (imported.Created.Count, imported.Skipped.Count));
        var there = (await elsewhere.Send(new GetPrepRecipeSheetQuery())).Lines;
        // A yield is not on the sheet: the oil on the dough there takes its own default.
        Assert.Equal(written.Lines, there);

        var again = await Import(true, rows);
        Assert.Equal((0, 0, 3), (again.Created.Count, again.Updated.Count, again.Unchanged));
    }
}
