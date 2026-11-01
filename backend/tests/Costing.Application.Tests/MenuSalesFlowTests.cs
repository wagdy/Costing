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
    public async Task A_sales_sheet_is_a_receipt_for_each_number_a_days_totals_for_the_rest_and_never_imported_twice()
    {
        var chicken = _costing.Inventory.Stock("Chicken", UnitOfMeasure.Gram, 5_000);
        await _costing.Send(new SetRecipeCommand(RecipeTargetKind.MenuItem, TestCosting.Shawarma, TestCosting.KiloTray, [new(chicken.Id, 1000)]));
        var day = TestCalendar.Today;
        SaleImportRow Row(int row, string? reference, string item, string? size, decimal quantity, string? payment = null, decimal? total = null,
            decimal? tax = null) =>
            new(row, reference, day, new TimeOnly(13, 0), null, payment, item, size, null, quantity, total, null, null, tax, null, null);

        IReadOnlyList<SaleImportRow> sheet =
        [
            Row(2, "R-1", "Shawarma", "Kilo tray", 1, tax: 56),
            Row(3, "R-1", "1", null, 2),
            Row(4, null, "Burger", null, 5, "Visa", 600),
            Row(5, null, "Burger", null, 1, "Visa", 120),
            Row(6, "R-2", "Pizza", null, 1),
            Row(7, "R-3", "Shawarma", null, 1),
        ];
        var result = await _costing.Send(new ImportSalesCommand(sheet, "Sara"));

        Assert.Equal((2, 4, 0), (result.Receipts, result.Lines, result.AlreadyRecorded));
        Assert.Equal(
            [(6, "There is no Pizza on the menu: add it on Menu, or check its number."), (7, "Shawarma is sold by size: name its size.")],
            result.Skipped.Select(s => (s.Row, s.Reason)));
        var r1 = _costing.Sales.All.Single(r => r.Reference == "R-1");
        Assert.Equal((640m, 56m, 696m, SalesSource.Imported), (r1.BilledSubtotal, r1.TaxAmount, r1.TotalAmount, r1.Source));
        var totals = _costing.Sales.All.Single(r => r.Reference is null);
        Assert.Equal((PaymentMethod.Visa, 720m, 6), (totals.PaymentMethod, totals.TotalAmount, totals.Lines.Sum(l => l.Quantity)));
        Assert.Equal(4_000m, chicken.QuantityOnHand);

        // The same sheet again: the numbered receipt is recorded already.
        var again = await _costing.Send(new ImportSalesCommand(sheet.Take(2).ToList(), "Sara"));
        Assert.Equal((0, 1), (again.Receipts, again.AlreadyRecorded));
        Assert.Equal(4_000m, chicken.QuantityOnHand);

        var report = await _costing.Send(new GetSalesQuery(day, day));
        Assert.Equal((2, 9, 1_416m), (report.Totals.Receipts, report.Totals.Items, report.Totals.Total));
        Assert.Equal((696m, 720m), (report.Totals.ByPayment[PaymentMethod.Cash], report.Totals.ByPayment[PaymentMethod.Visa]));
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
