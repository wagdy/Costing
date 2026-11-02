using Costing.Domain.Common;
using Costing.Application.Menu;
using Costing.Application.RawMaterials;
using Costing.Application.Recipes;
using Costing.Application.Sales;
using Costing.Domain.Approvals;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;
using Costing.Domain.Sales;

namespace Costing.Application.Tests;

// Recipes off the menu put on it: each a menu item of its name, linked to it, so that selling it
// takes its stock by the recipe; one of a name on the menu already linked to that item instead.
public class RecipesToMenuTests
{
    private readonly TestCosting _pos = new();

    private async Task<(Guid Flour, Guid Alfredo, Guid Toast, Guid Burger)> SeedAsync()
    {
        var flour = (await _pos.Send(new CreateRawMaterialCommand("Flour", UnitOfMeasure.Gram, CostPerPurchaseUnit: 30))).Id;
        var cheese = (await _pos.Send(new CreateRawMaterialCommand("Cheese", UnitOfMeasure.Gram, CostPerPurchaseUnit: 300))).Id;
        var pasta = Guid.NewGuid();
        await _pos.Send(new SaveRecipeCategoryCommand(pasta, "Pasta"));
        var alfredo = await _pos.Send(new SaveRecipeCommand(null, "Alfredo pasta", null, null, null, 1, [new RecipeIngredientDto(flour, 150)], pasta, 165));
        var toast = await _pos.Send(new SaveRecipeCommand(null, "Cheese toast", null, null, null, 1, [new RecipeIngredientDto(cheese, 50)], pasta));
        // Named as the burger on the menu, which has no recipe yet.
        var burger = await _pos.Send(new SaveRecipeCommand(null, "burger", null, null, null, 1, [new RecipeIngredientDto(cheese, 30)], pasta));
        return (flour, alfredo.Id, toast.Id, burger.Id);
    }

    private Task<RecipesToMenuResult> Add(params RecipeToMenu[] recipes) => _pos.Send(new AddRecipesToMenuCommand(recipes));

    private async Task<Recipe> RecipeOf(Guid id) => (await _pos.Inventory.Recipes.GetByIdAsync(id))!;

    [Fact]
    public async Task Each_goes_on_the_menu_as_an_item_of_its_name_linked_to_it_and_sold_takes_its_stock()
    {
        var (flour, alfredo, toast, burger) = await SeedAsync();

        var result = await Add(new(alfredo, " Pasta ", 165, "باستا ألفريدو"), new(toast, "Mains", null), new(burger, null, null));

        // A new item, the next number, in a category added for it; the burger the one on the menu.
        Assert.Equal(
            [("Alfredo pasta", 1001, "Pasta", 165m, true), ("burger", TestCosting.Burger, "Mains", 120m, false)],
            result.Linked.Select(l => (l.Recipe, l.MenuItemId, l.Category, l.Price, l.Created)));
        Assert.Equal(["Pasta"], result.CategoriesAdded);
        Assert.Equal([("Cheese toast", "Give it its selling price, more than nothing.")], result.Skipped.Select(s => (s.Recipe, s.Reason)));
        Assert.Equal("اكتب سعر البيع، أكبر من صفر.", result.Skipped.Single().ReasonAr);

        var menu = await _pos.Send(new GetMenuQuery());
        var item = menu.Items.Single(i => i.Id == 1001);
        Assert.Equal(("Alfredo pasta", "باستا ألفريدو", "Pasta", 165m), (item.Name, item.NameAr, item.Category, item.Price));
        Assert.Single(menu.Items, i => i.Name.Equals("Burger", StringComparison.OrdinalIgnoreCase));
        // Linked, keeping its own name, its kitchen category and its planned price.
        var linked = await RecipeOf(alfredo);
        Assert.Equal((RecipeTarget.ForMenuItem(1001), "Alfredo pasta", (decimal?)165m), (linked.Target, linked.Name, linked.PlannedPrice));
        Assert.Equal(RecipeTarget.ForMenuItem(TestCosting.Burger), (await RecipeOf(burger)).Target);
        Assert.False((await RecipeOf(toast)).IsLinked);

        // Sold on Sales: entered, and imported by its name; each takes 150 g of flour.
        await _pos.Send(new RecordSaleCommand(new SaleInput(Guid.NewGuid(), "R-1", TestCalendar.Today, new TimeOnly(13, 0), SalesChannel.DineIn,
            PaymentMethod.Cash, [new SaleLineInput(1001, null, 2)]), "Sara"));
        await _pos.Send(new ImportSalesCommand(
            [new SaleImportRow(2, "R-2", TestCalendar.Today, new TimeOnly(14, 0), null, null, "Alfredo pasta", null, null, 1, null, null, null, null, null, null)], "Sara"));
        Assert.Equal(-450m, (await _pos.Inventory.GetByIdAsync(flour))!.QuantityOnHand);
        Assert.Equal(495m, (await _pos.Send(new GetSalesQuery(TestCalendar.Today, TestCalendar.Today))).Totals.Total);
    }

    [Fact]
    public async Task One_on_the_menu_already_deleted_or_waiting_for_a_manager_is_left_as_it_is()
    {
        var (_, alfredo, toast, burger) = await SeedAsync();
        await Add(new RecipeToMenu(alfredo, "Pasta", 165));
        await _pos.Send(new DeleteRecipeCommand(toast, "Omar"));
        _pos.Inventory.ApprovalRequests.Add(ApprovalRequest.Ask(Guid.NewGuid(), ApprovalModule.Recipe, burger, "burger", null, "u1", "Mona"));
        // The shawarma's kilo tray sells by a recipe already: a recipe of its name is not linked to it.
        var cheese = (await _pos.Inventory.GetAllAsync()).Single(m => m.Name == "Cheese").Id;
        await _pos.Send(new SetRecipeCommand(RecipeTargetKind.MenuItem, TestCosting.Shawarma, null, [new RecipeIngredientDto(cheese, 10)]));
        var pasta = (await _pos.Inventory.RecipeCategories.GetAllAsync()).Single().Id;
        var shawarma = await _pos.Send(new SaveRecipeCommand(null, "Shawarma", null, null, null, 1, [new RecipeIngredientDto(cheese, 20)], pasta));

        var result = await Add(new(alfredo, "Pasta", 170), new(toast, "Pasta", 40), new(burger, "Mains", 120), new(shawarma.Id, "Mains", 90), new(Guid.NewGuid(), "Pasta", 10));

        Assert.Empty(result.Linked);
        Assert.Equal(
            [
                "Alfredo pasta is on the menu already, as 1001.",
                "The recipe is no longer there, or was deleted.",
                "burger waits for a manager's approval: put it on the menu once that is decided.",
                $"Shawarma is on the menu already, as {TestCosting.Shawarma}, and sells by another recipe: link one of them from its recipe card.",
                "The recipe is no longer there, or was deleted.",
            ],
            result.Skipped.Select(s => s.Reason));
        Assert.All(result.Skipped, s => Assert.False(string.IsNullOrWhiteSpace(s.ReasonAr)));
        Assert.Equal(165m, (await _pos.Send(new GetMenuQuery())).Items.Single(i => i.Id == 1001).Price);
    }

    [Fact]
    public async Task Several_are_numbered_one_after_another_and_none_is_refused()
    {
        var (_, alfredo, toast, _) = await SeedAsync();

        var result = await Add(new(alfredo, "Pasta", 165), new(toast, "Snacks", 45));

        Assert.Equal([1001, 1002], result.Linked.Select(l => l.MenuItemId));
        Assert.Equal(["Pasta", "Snacks"], result.CategoriesAdded);
        Assert.StartsWith("Choose the recipes to put on the menu.", (await Assert.ThrowsAsync<DomainException>(() => Add())).Message);
    }
}
