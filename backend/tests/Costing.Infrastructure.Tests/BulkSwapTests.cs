using Microsoft.EntityFrameworkCore;
using Costing.Application.Approvals;
using Costing.Application.Production;
using Costing.Application.RawMaterials;
using Costing.Application.Recipes;
using Costing.Domain.Approvals;
using Costing.Domain.Common;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;
using Costing.Infrastructure.Reports;

namespace Costing.Infrastructure.Tests;

// Where an item is used, through the prep items, and the bulk swap: its preview and its doing.
public class BulkSwapTests
{
    // Paprika (200 a kg) in a spice rub made already (500 g a 1 kg batch: 100 a kg), a glaze never
    // made (100 g a kg), and a chicken marinade never made (50 g of rub and 950 g of chicken a kg).
    // The burger (120) has 10 g of rub and 50 g of mozzarella (300 a kg); paprika fries, off the
    // menu at 40, 5 g of paprika and 20 g of glaze; the shawarma tray (400) 200 g of marinade.
    private sealed record Kitchen(
        Guid Paprika, Guid Smoked, Guid Chicken, Guid Rub, Guid Glaze, Guid Marinade, Guid Burger, Guid Fries, Guid Tray);

    private static async Task<Kitchen> SetUpAsync(TestSystem node)
    {
        async Task<Guid> Bought(string name, decimal perKg) =>
            (await node.Send(new CreateRawMaterialCommand(name, UnitOfMeasure.Gram, PurchaseUnit: "kg", PurchaseUnitSize: 1000, CostPerPurchaseUnit: perKg))).Id;
        var paprika = await Bought("Paprika", 200);
        var smoked = await Bought("Smoked paprika", 320);
        var chicken = await Bought("Chicken", 400);
        var mozzarella = await Bought("Mozzarella", 300);
        await node.Send(new ReceivePurchaseCommand(Guid.NewGuid(), [new(paprika, 5_000, 1_000)]));

        async Task<Guid> Prep(string name, IReadOnlyList<PrepIngredientEntry> ingredients) =>
            (await node.Send(new SavePrepItemCommand(null, name, UnitOfMeasure.Gram, 1_000, ingredients, DisplayUnit: "kg", DisplayUnitSize: 1000))).Id;
        var rub = await Prep("Spice rub", [new(paprika, 500)]);
        await node.Send(new MakeProductionOrderCommand(Guid.NewGuid(), rub, 1_000, 1_000, null, "Omar"));
        var glaze = await Prep("Glaze", [new(paprika, 100)]);
        var marinade = await Prep("Chicken marinade", [new(rub, 50), new(chicken, 950)]);

        var kitchen = (await node.Send(new SaveRecipeCategoryCommand(Guid.NewGuid(), "Kitchen"))).Id;
        var burger = await node.Send(new SaveRecipeCommand(null, null, RecipeTargetKind.MenuItem, TestMenu.Burger, null, 1, [new(mozzarella, 50), new(rub, 10)], kitchen));
        var fries = await node.Send(new SaveRecipeCommand(null, "Paprika fries", null, null, null, 1, [new(paprika, 5), new(glaze, 20)], kitchen, PlannedPrice: 40));
        var tray = await node.Send(new SaveRecipeCommand(null, null, RecipeTargetKind.MenuItem, TestMenu.Shawarma, TestMenu.KiloTray, 1, [new(marinade, 200)], kitchen));
        return new Kitchen(paprika, smoked, chicken, rub, glaze, marinade, burger.Id, fries.Id, tray.Id);
    }

    [Fact]
    public async Task Where_an_item_is_used_reaches_through_every_prep_item()
    {
        await using var node = await TestSystem.StartAsync();
        Assert.True(await TestSystem.WaitFor(() => node.Db(db => db.MenuItems.AnyAsync())));
        var ct = TestContext.Current.CancellationToken;
        using var scope = node.Scope();
        var k = await SetUpAsync(node);

        var used = await node.Service<CostingService>(scope).GetWhereUsedAsync(k.Paprika, ct);
        Assert.Equal((3, 3), (used.Dishes, used.PrepItems));
        // Per portion for a dish, per batch for a prep item: on it as written, and inside its prep items as purchased.
        Assert.Equal(
            [
                (WhereUsedKind.Dish, "Burger", (decimal?)null, (decimal?)5m, "Spice rub", (decimal?)1m, (decimal?)120m),
                (WhereUsedKind.OffMenuRecipe, "Paprika fries", 5m, 2m, "Glaze", 1.4m, 40m),
                (WhereUsedKind.Dish, "Shawarma (Kilo tray)", null, 5m, "Chicken marinade", 1m, 400m),
                (WhereUsedKind.PrepItem, "Chicken marinade", null, 25m, "Spice rub", 5m, null),
                (WhereUsedKind.PrepItem, "Glaze", 100m, null, "", 20m, null),
                (WhereUsedKind.PrepItem, "Spice rub", 500m, null, "", 100m, null),
            ],
            used.Rows.Select(r => (r.Kind, r.Name, r.Quantity, r.ThroughPrepItems, string.Join(", ", r.Via), r.ItemCost, r.Price)));
        Assert.Equal((16m, 13.3m), (used.Rows[0].Cost!.Value, used.Rows[0].FoodCostPercent!.Value));
        Assert.Empty((await node.Service<CostingService>(scope).GetWhereUsedAsync(k.Smoked, ct)).Rows);
        await Assert.ThrowsAsync<NotFoundException>(() => node.Service<CostingService>(scope).GetWhereUsedAsync(Guid.NewGuid(), ct));
    }

    [Fact]
    public async Task The_preview_costs_each_recipe_as_the_swap_leaves_it_and_the_dishes_it_reaches_through_prep_items()
    {
        await using var node = await TestSystem.StartAsync();
        Assert.True(await TestSystem.WaitFor(() => node.Db(db => db.MenuItems.AnyAsync())));
        var ct = TestContext.Current.CancellationToken;
        using var scope = node.Scope();
        var k = await SetUpAsync(node);
        var costing = node.Service<CostingService>(scope);

        // Smoked paprika (320 a kg) for paprika, gram for gram.
        var preview = await costing.PreviewSwapAsync(new SwapPreviewRequest(k.Paprika, k.Smoked, 1), canApprove: true, ct);
        Assert.False(preview.UnitsDiffer);
        Assert.Equal(
            [
                (WhereUsedKind.OffMenuRecipe, "Paprika fries", 5m, 5m, (decimal?)1.4m, (decimal?)2.24m, (decimal?)0.84m, true, false),
                (WhereUsedKind.PrepItem, "Glaze", 100m, 100m, 20m, 32m, 12m, true, false),
                // Made already: the rub's next batches carry it.
                (WhereUsedKind.PrepItem, "Spice rub", 500m, 500m, 100m, 160m, 60m, true, true),
            ],
            preview.Rows.Select(r => (r.Kind, r.Name, r.OldQuantity, r.NewQuantity, r.OldCost, r.NewCost, r.CostDelta, r.Selected, r.FromNextBatch)));
        // The burger and the tray have no paprika of their own: they move through the rub (made: 100 → 160 a kg).
        Assert.Equal(
            [
                ("Burger", "Spice rub", (decimal?)16m, (decimal?)16.6m, (decimal?)0.6m, true),
                ("Shawarma (Kilo tray)", "Spice rub", 77m, 77.6m, 0.6m, true),
            ],
            preview.KnockOn.Select(x => (x.Name, string.Join(", ", x.Via), x.OldCost, x.NewCost, x.CostDelta, x.FromNextBatch)));

        // Leaving the rub out: the dishes move only through the glaze. 80 g of smoked for 100 of paprika.
        var some = await costing.PreviewSwapAsync(new SwapPreviewRequest(k.Paprika, k.Smoked, 0.8m, null, [k.Glaze]), canApprove: true, ct);
        Assert.Equal([("Paprika fries", 4m, true), ("Glaze", 80m, true), ("Spice rub", 400m, false)], some.Rows.Select(r => (r.Name, r.NewQuantity, r.Selected)));
        Assert.Equal((decimal?)1.79m, some.Rows[0].NewCost);
        Assert.Empty(some.KnockOn);

        // Someone who may not approve: the prep items shown, left out.
        var staff = await costing.PreviewSwapAsync(new SwapPreviewRequest(k.Paprika, k.Smoked, 1), canApprove: false, ct);
        Assert.Equal([null, BulkSwapRules.PrepItemsManagers, BulkSwapRules.PrepItemsManagers], staff.Rows.Select(r => r.Blocked));
        Assert.Equal([true, false, false], staff.Rows.Select(r => r.Selected));
        Assert.Equal((decimal?)2.0m, staff.Rows[0].NewCost);

        // The marinade for paprika: the rub is inside the marinade, so it would be made from itself.
        var circular = await costing.PreviewSwapAsync(new SwapPreviewRequest(k.Paprika, k.Marinade, 1), canApprove: true, ct);
        Assert.Equal(BulkSwapRules.MadeFromItself("Spice rub", "Chicken marinade"), circular.Rows.Single(r => r.Name == "Spice rub").Blocked);
        Assert.Null(circular.Rows.Single(r => r.Name == "Glaze").Blocked);

        await Assert.ThrowsAsync<DomainException>(() => costing.PreviewSwapAsync(new SwapPreviewRequest(k.Paprika, k.Paprika, 1), true, ct));
        await Assert.ThrowsAsync<DomainException>(() => costing.PreviewSwapAsync(new SwapPreviewRequest(k.Paprika, k.Smoked, 0), true, ct));
        // Nothing was saved.
        Assert.Equal(3, (await costing.GetWhereUsedAsync(k.Paprika, ct)).Dishes);
    }

    [Fact]
    public async Task The_swap_changes_every_recipe_chosen_at_once_or_none()
    {
        await using var node = await TestSystem.StartAsync();
        Assert.True(await TestSystem.WaitFor(() => node.Db(db => db.MenuItems.AnyAsync())));
        var ct = TestContext.Current.CancellationToken;
        using var scope = node.Scope();
        var k = await SetUpAsync(node);
        async Task<IReadOnlyList<(Guid, decimal)>> Lines(Guid recipeId) => await node.Db(db => db.Recipes.Where(r => r.Id == recipeId)
            .SelectMany(r => r.Ingredients).OrderBy(i => i.Quantity).Select(i => new { i.RawMaterialId, i.Quantity }).ToListAsync())
            .ContinueWith(t => (IReadOnlyList<(Guid, decimal)>)t.Result.Select(i => (i.RawMaterialId, i.Quantity)).ToList());
        async Task<IReadOnlyList<(Guid, decimal)>> Batch(Guid prepItemId) => await node.Db(db => db.PrepRecipes.Where(r => r.Id == prepItemId)
            .SelectMany(r => r.Ingredients).OrderBy(i => i.Quantity).Select(i => new { i.RawMaterialId, i.Quantity }).ToListAsync())
            .ContinueWith(t => (IReadOnlyList<(Guid, decimal)>)t.Result.Select(i => (i.RawMaterialId, i.Quantity)).ToList());

        // Refused, nothing changed: prep items by someone who may not approve; the rub into the marinade.
        await Assert.ThrowsAsync<DomainException>(() =>
            node.Send(new BulkSwapMaterialCommand(k.Paprika, k.Smoked, 1, [k.Fries], [k.Rub], CanApprove: false)));
        await Assert.ThrowsAsync<DomainException>(() =>
            node.Send(new BulkSwapMaterialCommand(k.Paprika, k.Marinade, 1, [k.Fries], [k.Glaze, k.Rub])));
        await Assert.ThrowsAsync<DomainException>(() => node.Send(new BulkSwapMaterialCommand(k.Paprika, k.Smoked, 1, [], [])));
        // A recipe without paprika: the preview was old.
        await Assert.ThrowsAsync<DomainException>(() => node.Send(new BulkSwapMaterialCommand(k.Paprika, k.Smoked, 1, [k.Fries, k.Burger], [k.Glaze])));
        Assert.Equal([(k.Paprika, 5m), (k.Glaze, 20m)], await Lines(k.Fries));
        Assert.Equal([(k.Paprika, 100m)], await Batch(k.Glaze));

        // Waiting for a manager to delete it: left as it is, and the swap with it refused.
        await node.Send(new RequestDeletionCommand(Guid.NewGuid(), ApprovalModule.Recipe, k.Fries, "Off the menu soon", "staff-mona", "Mona", CanApprove: false));
        var waiting = await node.Service<CostingService>(scope).PreviewSwapAsync(new SwapPreviewRequest(k.Paprika, k.Smoked, 1), true, ct);
        Assert.Equal((false, true), (waiting.Rows[0].Selected, waiting.Rows[0].Blocked!.StartsWith("Mona")));
        await Assert.ThrowsAsync<DomainException>(() => node.Send(new BulkSwapMaterialCommand(k.Paprika, k.Smoked, 0.8m, [k.Fries], [k.Glaze])));
        Assert.Equal([(k.Paprika, 100m)], await Batch(k.Glaze));
        var request = await node.Db(db => db.ApprovalRequests.Where(r => r.RecordId == k.Fries).Select(r => r.Id).SingleAsync());
        await node.Send(new RejectRequestCommand(request, "Keep it", "Omar"));

        // Done: 4 g and 80 g and 400 g of smoked paprika, at their own yield; paprika used nowhere.
        Assert.Equal(new BulkSwapResult(1, 2), await node.Send(new BulkSwapMaterialCommand(k.Paprika, k.Smoked, 0.8m, [k.Fries], [k.Glaze, k.Rub])));
        Assert.Equal([(k.Smoked, 4m), (k.Glaze, 20m)], await Lines(k.Fries));
        Assert.Equal([(k.Smoked, 80m)], await Batch(k.Glaze));
        Assert.Equal([(k.Smoked, 400m)], await Batch(k.Rub));
        var costing = node.Service<CostingService>(scope);
        Assert.Empty((await costing.GetWhereUsedAsync(k.Paprika, ct)).Rows);
        Assert.Equal((3, 3), ((await costing.GetWhereUsedAsync(k.Smoked, ct)).Dishes, (await costing.GetWhereUsedAsync(k.Smoked, ct)).PrepItems));
        // Costed by it at once: 4 g at 0.32 and 20 g of a glaze never made, now 25.6 a kg.
        Assert.Equal(1.79m, (await costing.GetRecipeCardAsync(k.Fries, ct)).CostPerPortion);
        // The rub was made with paprika: it is costed by its batches until the next.
        Assert.Equal(16m, (await costing.GetRecipeCardAsync(k.Burger, ct)).CostPerPortion);
    }
}
