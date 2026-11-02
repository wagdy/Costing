using System.Globalization;
using Costing.Domain.Common;
using Costing.Application.Categories;
using Costing.Application.RawMaterials;
using Costing.Domain.Approvals;
using Costing.Domain.Categories;
using Costing.Domain.RawMaterials;

namespace Costing.Application.Tests;

// Raw materials to and from a spreadsheet: each good row a purchased stock item added, or the one
// of its code or name changed as the row says; a bad row said why, in English and Arabic; the
// list written out imports back as it is, here or into another installation.
public class RawMaterialImportTests
{
    private readonly TestCosting _pos = new();

    private Task<RawMaterialImportResult> Import(params RawMaterialSheetRow[] rows) => ImportInto(_pos, rows);

    private static Task<RawMaterialImportResult> ImportInto(TestCosting into, params RawMaterialSheetRow[] rows) => into.Send(new ImportRawMaterialsCommand(rows));

    private async Task<RawMaterial> Material(string name) => (await _pos.Inventory.GetAllAsync()).Single(m => m.Name == name);

    [Fact]
    public async Task Each_good_row_is_a_purchased_stock_item_in_its_unit_category_and_price()
    {
        await _pos.Send(new SavePurchaseCategoryCommand(Guid.NewGuid(), "Vegetables", "خضروات"));

        var result = await Import(
            new(2, "Chicken breast", "Poultry", "Kg", "185"),
            new(3, " Full-cream   milk ", "Dairy", "لتر", "42.5"),
            new(4, "Eggs", " dairy ", "pcs", "٤٫٢٥"),
            new(5, "Parsley", "خضروات", "كيلو", null),
            new(6, "Paper cups", null, "Piece", "1,250"));

        Assert.Empty(result.Skipped);
        Assert.Equal(["Chicken breast", "Full-cream milk", "Eggs", "Parsley", "Paper cups"], result.Created.Select(m => m.Name));
        // New categories added once each; one already there, named in Arabic, found.
        Assert.Equal(["Poultry", "Dairy"], result.CategoriesAdded);
        Assert.Equal(["Poultry", "Dairy", "Dairy", "Vegetables", PurchaseCategory.GeneralName], result.Created.Select(m => m.Category));

        // Stock items, counted in grams, millilitres or pieces and priced per kg, litre or piece.
        var chicken = await Material("Chicken breast");
        Assert.Equal((MaterialKind.Purchased, UnitOfMeasure.Gram, "kg", 1000m, (decimal?)185m),
            (chicken.Kind, chicken.Unit, chicken.PurchaseUnit, chicken.PurchaseUnitSize, chicken.CostPerPurchaseUnit));
        var milk = await Material("Full-cream milk");
        Assert.Equal((UnitOfMeasure.Millilitre, "L", (decimal?)42.5m), (milk.Unit, milk.PurchaseUnit, milk.CostPerPurchaseUnit));
        var eggs = await Material("Eggs");
        Assert.Equal((UnitOfMeasure.Piece, "piece", (decimal?)4.25m), (eggs.Unit, eggs.PurchaseUnit, eggs.CostPerPurchaseUnit));
        Assert.Equal((decimal?)1_250m, (await Material("Paper cups")).CostPerPurchaseUnit);
        // No cost: no price until a purchase brings one. No stock either way.
        var parsley = await Material("Parsley");
        Assert.Equal(((decimal?)null, 0m), (parsley.AverageCost, parsley.QuantityOnHand));
        Assert.All(await _pos.Inventory.GetAllAsync(), m => Assert.Equal(0m, m.QuantityOnHand));
    }

    [Fact]
    public async Task A_material_on_the_list_is_changed_by_its_row_and_a_bad_row_says_why()
    {
        await _pos.Send(new CreateRawMaterialCommand("Tomatoes", UnitOfMeasure.Gram, CostPerPurchaseUnit: 15));
        await _pos.Send(new CreateRawMaterialCommand("Milk", UnitOfMeasure.Millilitre));
        var salt = await _pos.Send(new CreateRawMaterialCommand("Salt", UnitOfMeasure.Gram));
        (await _pos.Inventory.GetByIdAsync(salt.Id))!.Archive("Omar");
        _pos.Inventory.Add(new RawMaterial("Pizza dough", UnitOfMeasure.Gram, kind: MaterialKind.Prep));
        var flourId = (await _pos.Send(new CreateRawMaterialCommand("Flour", UnitOfMeasure.Gram))).Id;
        _pos.Inventory.ApprovalRequests.Add(ApprovalRequest.Ask(Guid.NewGuid(), ApprovalModule.RawMaterial, flourId, "Flour", null, "u1", "Mona"));
        await _pos.Send(new SavePurchaseCategoryCommand(Guid.NewGuid(), "Utilities", null, ExpenseLine.Controllable, CategoryKind.Expenses));

        var result = await Import(
            new(2, "tomatoes ", "Vegetables", "Kg", "20"),
            new(3, "SALT", null, "Kg", null),
            new(4, "Rice", "Dry goods", "Kg", "30"),
            new(5, " rice", "Dry goods", "Kg", "31"),
            new(6, null, "Dry goods", "Kg", "5"),
            new(7, "Semolina", "Dry goods", "Sack", "500"),
            new(8, "Sugar", "Dry goods", null, null),
            new(9, "Oil", "Dry goods", "Liter", "abc"),
            new(10, "Vinegar", "Dry goods", "Liter", "-5"),
            new(11, new string('x', 201), null, "Kg", null),
            new(12, "Charcoal", "utilities", "Kg", null),
            new(13, "Pizza dough", null, "Kg", null),
            new(14, "Milk", null, "Kg", null),
            new(15, "Flour", null, "Kg", "40"));

        Assert.Equal([(4, "Rice")], result.Created.Select(m => (m.Row, m.Name)));
        // Found by its name, whatever its capitals: kept as it is written, its category and price as the row says.
        var tomatoes = Assert.Single(result.Updated);
        Assert.Equal((2, "Tomatoes", "Category, Cost"), (tomatoes.Row, tomatoes.Name, string.Join(", ", tomatoes.Changes)));
        Assert.Equal((decimal?)20m, (await Material("Tomatoes")).CostPerPurchaseUnit);
        Assert.Equal(
            [
                (3, "Salt was deleted: restore it from the deleted materials rather than import it again."),
                (5, "Also on row 4, which is the one imported."),
                (6, "No material name."),
                (7, "\"Sack\" is not a unit the system knows: Kg, Liter or Piece."),
                (8, "No unit of measure: Kg, Liter or Piece."),
                (9, "\"abc\" is not a cost: write a number, such as 85.50."),
                (10, "A cost cannot be negative."),
                (11, "The name is longer than 200 characters."),
                (12, "Utilities is a general expenses category: give it a raw materials category."),
                (13, "Pizza dough is a prep item: change it under Recipes → Prep items."),
                (14, "Milk is counted by the Liter, not the Kg: change its unit on Raw materials, which restates its stock and recipes."),
                (15, "Flour waits for a manager's approval: import it again once that is decided."),
            ],
            result.Skipped.Select(s => (s.Row, s.Reason)));
        // Each in Arabic too.
        Assert.All(result.Skipped, s => Assert.False(string.IsNullOrWhiteSpace(s.ReasonAr)));
        Assert.Equal("لا يوجد اسم للخامة.", result.Skipped.Single(s => s.Row == 6).ReasonAr);
        // A skipped row adds no category, and changes nothing.
        Assert.Equal(["Vegetables", "Dry goods"], result.CategoriesAdded);
        Assert.Null((await Material("Flour")).AverageCost);
        Assert.Single(await _pos.Inventory.GetAllAsync(), m => m.Name == "Tomatoes");

        // The same rows again: nothing left to change.
        var again = await Import(new RawMaterialSheetRow(2, "Tomatoes", "Vegetables", "Kg", "20"), new RawMaterialSheetRow(4, "Rice", "Dry goods", "Kg", "30"));
        Assert.Equal((0, 0, 2), (again.Created.Count, again.Updated.Count, again.Unchanged));
    }

    [Fact]
    public async Task A_code_names_its_material_once_and_never_two()
    {
        var butter = await _pos.Send(new CreateRawMaterialCommand("Butter", UnitOfMeasure.Gram, Code: "DAI-1"));
        await _pos.Send(new CreateRawMaterialCommand("Cream", UnitOfMeasure.Millilitre, Code: "DAI-2"));
        await _pos.Send(new CreateRawMaterialCommand("Cheese", UnitOfMeasure.Gram, Code: "DAI-3"));
        await _pos.Send(new CreateRawMaterialCommand("Oregano", UnitOfMeasure.Gram, Code: "HRB-1"));
        await _pos.Send(new CreateRawMaterialCommand("Basil", UnitOfMeasure.Gram, Code: "hrb-1"));

        var result = await Import(
            new(2, "Unsalted butter", null, null, null, Code: "dai-1"),
            new(3, "Ghee", null, "Kg", null, Code: "DAI-1"),
            new(4, "Cream", null, null, null, Code: "DAI-9"),
            new(5, "Cheese", null, null, null, Code: "DAI-2"),
            new(6, "Thyme", null, "Kg", null, Code: "HRB-1"),
            new(7, "Mozzarella", "Dairy", "Kg", "290", Code: " DAI-4 "));

        // By its code, under another name: renamed, its code kept as it is written.
        Assert.Equal([(2, "Unsalted butter", "Name"), (4, "Cream", "Code")], result.Updated.Select(u => (u.Row, u.Name, string.Join(", ", u.Changes))));
        var renamed = (await _pos.Inventory.GetByIdAsync(butter.Id))!;
        Assert.Equal(("Unsalted butter", "DAI-1"), (renamed.Name, renamed.Code));
        Assert.Equal("DAI-9", (await Material("Cream")).Code);
        Assert.Equal(("Mozzarella", "DAI-4"), (result.Created.Single().Name, (await Material("Mozzarella")).Code));
        Assert.Equal(
            [
                (3, "The code DAI-1 is also on row 2, which is the one imported."),
                (5, "The code DAI-2 is Cream's, and Cheese is another material: give the row one material's code and name."),
                (6, "The code HRB-1 is on more than one material (Oregano, Basil): give each its own code on Raw materials first."),
            ],
            result.Skipped.Select(s => (s.Row, s.Reason)));
    }

    [Fact]
    public async Task What_it_is_bought_in_its_reorder_level_and_yield_are_written_as_on_its_own_screen()
    {
        var result = await Import(
            new(2, "Eggs", "Dairy", "Piece", "127.5", PurchaseUnit: "tray", PurchaseUnitHolds: "30", ReorderLevel: "4", YieldPercent: "98%"),
            new(3, "Flour", null, "Kg", "500", PurchaseUnit: "sack", PurchaseUnitHolds: "25"),
            new(4, "Salt", null, "Kg", "12", PurchaseUnit: "Kg"),
            new(5, "Sugar", null, "Kg", null, PurchaseUnit: "sack"),
            new(6, "Pepper", null, "Kg", null, PurchaseUnitHolds: "2"),
            new(7, "Rice", null, "Kg", null, PurchaseUnit: "bag", PurchaseUnitHolds: "0"),
            new(8, "Peppers", null, "Kg", null, YieldPercent: "120"),
            new(9, "Onions", null, "Kg", null, ReorderLevel: "-1"),
            new(10, "Garlic", null, "Kg", null, PurchaseUnitHolds: "a lot"));

        var eggs = await Material("Eggs");
        Assert.Equal(("tray", 30m, (decimal?)127.5m, 120m, 98m), (eggs.PurchaseUnit, eggs.PurchaseUnitSize, eggs.CostPerPurchaseUnit, eggs.ReorderLevel, eggs.DefaultYieldPercent));
        var flour = await Material("Flour");
        Assert.Equal(("sack", 25_000m, (decimal?)500m, 0.02m), (flour.PurchaseUnit, flour.PurchaseUnitSize, flour.CostPerPurchaseUnit, flour.AverageCost));
        Assert.Equal(1000m, (await Material("Salt")).PurchaseUnitSize);
        Assert.Equal(
            [
                (5, "Say how much a sack holds, in Kg."),
                (6, "Name the purchase unit that holds 2."),
                (7, "A purchase unit holds more than nothing."),
                (8, "The yield is more than 0% and at most 100%."),
                (9, "A reorder level cannot be negative."),
                (10, "\"a lot\" is not how much the purchase unit holds: write a number, such as 85.50."),
            ],
            result.Skipped.Select(s => (s.Row, s.Reason)));

        // A material there already: blank cells leave it as it is; what it is bought in, changed.
        var changed = await Import(new RawMaterialSheetRow(2, "Eggs", null, null, null, PurchaseUnit: "carton", PurchaseUnitHolds: "360"));
        Assert.Equal((IReadOnlyList<string>)["PurchaseUnit"], changed.Updated.Single().Changes);
        eggs = await Material("Eggs");
        // The price per egg is as it was; the reorder level and the yield too.
        Assert.Equal(("carton", 360m, (decimal?)1_530m, 120m, 98m), (eggs.PurchaseUnit, eggs.PurchaseUnitSize, eggs.CostPerPurchaseUnit, eggs.ReorderLevel, eggs.DefaultYieldPercent));
    }

    [Fact]
    public async Task An_average_cost_is_not_reset_to_the_rounded_figure_written_out()
    {
        var cheese = await _pos.Send(new CreateRawMaterialCommand("Cheese", UnitOfMeasure.Gram, CostPerPurchaseUnit: 361.751234m));
        var line = (await _pos.Send(new GetRawMaterialSheetQuery())).Lines.Single();
        Assert.Equal((decimal?)361.7512m, line.Cost);

        var result = await Import(new RawMaterialSheetRow(2, "Cheese", null, null, "361.7512"));
        Assert.Equal((0, 1), (result.Updated.Count, result.Unchanged));
        Assert.Equal(0.361751234m, (await _pos.Inventory.GetByIdAsync(cheese.Id))!.AverageCost);

        // A price that differs replaces it.
        await Import(new RawMaterialSheetRow(2, "Cheese", null, null, "380"));
        Assert.Equal((decimal?)380m, (await _pos.Inventory.GetByIdAsync(cheese.Id))!.CostPerPurchaseUnit);
    }

    [Fact]
    public async Task The_list_written_out_imports_into_another_installation_as_it_is()
    {
        await _pos.Send(new CreateRawMaterialCommand("Chicken breast", UnitOfMeasure.Gram, ReorderLevel: 5000, Code: "POU-1", PurchaseUnit: "kg",
            PurchaseUnitSize: 1000, DefaultYieldPercent: 85, CostPerPurchaseUnit: 185));
        await _pos.Send(new CreateRawMaterialCommand("Eggs", UnitOfMeasure.Piece, ReorderLevel: 60, PurchaseUnit: "tray", PurchaseUnitSize: 30, CostPerPurchaseUnit: 127.5m));
        await _pos.Send(new CreateRawMaterialCommand("Milk", UnitOfMeasure.Millilitre, PurchaseUnit: "carton", PurchaseUnitSize: 12_000));
        var archived = await _pos.Send(new CreateRawMaterialCommand("Old stock", UnitOfMeasure.Gram));
        (await _pos.Inventory.GetByIdAsync(archived.Id))!.Archive("Omar");
        _pos.Inventory.Add(new RawMaterial("Pizza dough", UnitOfMeasure.Gram, kind: MaterialKind.Prep));

        var written = await _pos.Send(new GetRawMaterialSheetQuery());
        // Neither the deleted material nor the prep item; each in the sheet's units.
        Assert.Equal(["Chicken breast", "Eggs", "Milk"], written.Lines.Select(l => l.Name));
        Assert.Equal(new RawMaterialSheetLine("POU-1", "Chicken breast", PurchaseCategory.GeneralName, "Kg", "kg", 1, 185, 5, 85), written.Lines[0]);
        Assert.Equal(("carton", 12m, (decimal?)null, "Liter"), (written.Lines[2].PurchaseUnit, written.Lines[2].PurchaseUnitHolds, written.Lines[2].Cost, written.Lines[2].Unit));

        // Read back as a sheet's cells, into an installation with none.
        static string? Cell(decimal? value) => value?.ToString(CultureInfo.InvariantCulture);
        var rows = written.Lines.Select((l, i) => new RawMaterialSheetRow(
            i + 2, l.Name, l.Category, l.Unit, Cell(l.Cost), l.Code, l.PurchaseUnit, Cell(l.PurchaseUnitHolds), Cell(l.ReorderLevel), Cell(l.YieldPercent))).ToArray();
        var elsewhere = new TestCosting();
        var imported = await ImportInto(elsewhere, rows);
        Assert.Equal((3, 0), (imported.Created.Count, imported.Skipped.Count));
        Assert.Equal(written.Lines, (await elsewhere.Send(new GetRawMaterialSheetQuery())).Lines);

        // And back into this one: nothing to change.
        var again = await Import(rows);
        Assert.Equal((0, 0, 3), (again.Created.Count, again.Updated.Count, again.Unchanged));
    }

    [Fact]
    public async Task An_empty_or_huge_sheet_is_refused()
    {
        var empty = await Assert.ThrowsAsync<DomainException>(() => Import());
        Assert.StartsWith("The sheet has no materials on it: fill in a row under the headings.", empty.Message);
        var rows = Enumerable.Range(2, 2_001).Select(r => new RawMaterialSheetRow(r, $"Material {r}", null, "Kg", null)).ToArray();
        await Assert.ThrowsAsync<DomainException>(() => Import(rows));
        Assert.Empty(await _pos.Inventory.GetAllAsync());
    }
}
