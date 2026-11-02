using Costing.Application.Access;
using Costing.Application.Menu;
using Costing.Application.Recipes;
using Costing.Application.Sales;
using Costing.Domain.Access;
using Costing.Domain.Common;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;
using Costing.Domain.Sales;

namespace Costing.Application.Tests;

// The menu and its sales without a point of sale: kept here or imported from a sheet, and who
// works which section.
public class MenuSalesFlowTests
{
    private readonly TestCosting _costing = new();

    [Fact]
    public async Task A_menu_sheet_adds_items_with_their_sizes_and_categories_and_changes_those_already_there()
    {
        var result = await _costing.Send(new ImportMenuCommand(
        [
            new MenuImportRow(2, 6101, "Margherita", "مارجريتا", "Pizza", "بيتزا", 140, null, null, null),
            new MenuImportRow(3, 6101, "Margherita", null, null, null, null, "Large", "كبير", 180),
            new MenuImportRow(4, null, "Burger", null, null, null, 125, null, null, null),
            new MenuImportRow(5, null, "Crepe", null, "Crepes", null, 95, null, null, null),
            new MenuImportRow(6, null, null, null, "Crepes", null, 95, null, null, null),
        ]));

        Assert.Equal((2, 1, 2), (result.Added, result.Updated, result.CategoriesAdded));
        var skipped = Assert.Single(result.Skipped);
        Assert.Equal((6, "No item name."), (skipped.Row, skipped.Reason));

        var menu = await _costing.Send(new GetMenuQuery());
        var pizza = menu.Items.Single(i => i.Id == 6101);
        Assert.Equal(("Pizza", 140m, "Large", 180m), (pizza.Category, pizza.Price, pizza.Sizes.Single().Name, pizza.Sizes.Single().Price));
        // The next number after the highest.
        Assert.Equal(6102, menu.Items.Single(i => i.Name == "Crepe").Id);
        Assert.Equal(125m, menu.Items.Single(i => i.Name == "Burger").Price);
        Assert.Equal(["Mains", "Pizza", "Crepes"], menu.Categories.Select(c => c.Name));

        // A category with items in it stays; renamed, its items go with it.
        var pizzaCategory = menu.Categories.Single(c => c.Name == "Pizza");
        Assert.Contains("move them to another category first", (await Assert.ThrowsAsync<DomainException>(() =>
            _costing.Send(new DeleteMenuCategoryCommand(pizzaCategory.Id)))).Message);
        menu = await _costing.Send(new SaveMenuCategoryCommand(pizzaCategory.Id, "Pizzas", null, null));
        Assert.Equal("Pizzas", menu.Items.Single(i => i.Id == 6101).Category);
    }

    [Fact]
    public async Task A_days_sales_summary_takes_each_items_stock_by_its_recipe_once_a_day_entered_or_imported()
    {
        var chicken = _costing.Inventory.Stock("Chicken", UnitOfMeasure.Gram, 5_000);
        var beef = _costing.Inventory.Stock("Beef", UnitOfMeasure.Gram, 5_000);
        await _costing.Send(new SetRecipeCommand(RecipeTargetKind.MenuItem, TestCosting.Shawarma, TestCosting.KiloTray, [new(chicken.Id, 1000)]));
        await _costing.Send(new SetRecipeCommand(RecipeTargetKind.MenuItem, TestCosting.Burger, null, [new(beef.Id, 150)]));
        var (yesterday, today) = (TestCalendar.Today.AddDays(-1), TestCalendar.Today);

        // Entered by hand: an item twice is one line; no bills, no money taken, priced at the menu's prices.
        var entered = await _costing.Send(new RecordDailySalesCommand(Guid.NewGuid(), yesterday,
            [new(TestCosting.Burger, null, 3), new(TestCosting.Shawarma, TestCosting.KiloTray, 1), new(TestCosting.Burger, null, 2)], "Sara"));
        Assert.Equal((SalesSource.DailySummary, yesterday, (string?)null), (entered.Source, entered.BusinessDate, entered.Reference));
        Assert.Equal([("Burger", (string?)null, 5, 600m), ("Shawarma", "Kilo tray", 1, 400m)],
            entered.Lines.Select(l => (l.MenuItemName, l.VariantName, l.Quantity, l.LineTotal)));
        Assert.Equal((4_000m, 4_250m), (chicken.QuantityOnHand, beef.QuantityOnHand));

        // That day again: refused, naming it; nothing taken.
        var twice = await Assert.ThrowsAsync<DomainException>(() =>
            _costing.Send(new RecordDailySalesCommand(Guid.NewGuid(), yesterday, [new(TestCosting.Burger, null, 1)], "Sara")));
        Assert.StartsWith($"The sales of {yesterday.ToString("d MMM yyyy", System.Globalization.CultureInfo.InvariantCulture)} are entered already (2 items, 6 sold)",
            twice.Message);
        Assert.Contains("مبيعات هذا اليوم مسجلة بالفعل", twice.Message);
        Assert.Equal(4_250m, beef.QuantityOnHand);
        Assert.StartsWith("That day has not come yet",
            (await Assert.ThrowsAsync<DomainException>(() => _costing.Send(new RecordDailySalesCommand(
                Guid.NewGuid(), today.AddDays(2), [new(TestCosting.Burger, null, 1)], "Sara")))).Message);

        // Imported: an item by the list's label, its code or its name; what cannot be read said why.
        var imported = await _costing.Send(new ImportDailySalesCommand(today,
        [
            new(2, "1 · Burger", 4),
            new(3, "10-101 · Shawarma (Kilo tray)", 1),
            new(4, "burger", 1),
            new(5, "Shawarma", 2),
            new(6, "Pizza", 3),
            new(7, "10-102", 1.5m),
            new(8, null, 2),
        ], "Sara"));
        Assert.Equal((2, 6, 1_000m), (imported.Items, imported.Quantity, imported.Value));
        Assert.Equal(
            [
                (5, "Shawarma is sold by size: choose its size from the list."),
                (6, "There is no Pizza on the menu: choose the item from the list, or add it on Menu first."),
                (7, "The quantity sold is a whole number, 1 or more."),
                (8, "No item: choose it from the list."),
            ],
            imported.Skipped.Select(s => (s.Row, s.Reason)));
        Assert.All(imported.Skipped, s => Assert.False(string.IsNullOrWhiteSpace(s.ReasonAr)));
        Assert.Equal((3_000m, 3_500m), (chicken.QuantityOnHand, beef.QuantityOnHand));

        // A sheet with nothing that can be read records nothing.
        var nothing = await _costing.Send(new ImportDailySalesCommand(today.AddDays(-2), [new(2, "Pizza", 1)], "Sara"));
        Assert.Null(nothing.SaleId);
        Assert.Single(nothing.Skipped);

        var report = await _costing.Send(new GetSalesQuery(yesterday, today));
        Assert.Equal((2, 12), (report.Totals.Receipts, report.Totals.Items));
    }

    [Fact]
    public async Task A_users_tabs_are_their_roles_until_a_manager_ticks_theirs_and_a_managers_are_every_one()
    {
        UserAccountRef mona = new("u-mona", "Mona", UserRole.Storekeeper), omar = new("u-omar", "Omar", UserRole.Manager);

        var listed = Assert.Single(await _costing.Send(new GetUserTabsQuery([mona, omar])));
        Assert.False(listed.Restricted);
        Assert.Equal(CostingTabSet.Split(CostingTabSet.DefaultFor(UserRole.Storekeeper)), listed.Tabs);

        var ticked = await _costing.Send(new SetUserTabsCommand(mona, CostingTabs.Counts | CostingTabs.Waste, "Omar"));
        Assert.Equal((true, "Omar"), (ticked.Restricted, ticked.SetBy));
        Assert.Equal([CostingTabs.Counts, CostingTabs.Waste], ticked.Tabs);
        Assert.Equal(CostingTabs.Counts | CostingTabs.Waste, _costing.Tabs.All.Single().Tabs);

        var back = await _costing.Send(new SetUserTabsCommand(mona, null, "Omar"));
        Assert.False(back.Restricted);
        Assert.Empty(_costing.Tabs.All);

        await Assert.ThrowsAsync<DomainException>(() => _costing.Send(new SetUserTabsCommand(omar, CostingTabs.Sales, "Omar")));
    }
}
