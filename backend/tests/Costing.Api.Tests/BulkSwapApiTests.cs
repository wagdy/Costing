using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Costing.Domain.Access;

namespace Costing.Api.Tests;

// Where an item is used and the bulk material swap through the API: their routes, their JSON and
// who may call them.
public class BulkSwapApiTests
{
    private static CancellationToken Cancel => TestContext.Current.CancellationToken;

    private static async Task<JsonElement> Json(HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, $"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync(Cancel)}");
        return await response.Content.ReadFromJsonAsync<JsonElement>(Cancel);
    }

    [Fact]
    public async Task Where_used_is_for_every_stock_card_and_the_swap_for_whoever_writes_recipes()
    {
        await using var api = await TestApi.StartAsync();
        var manager = await api.ManagerAsync();
        async Task<Guid> Bought(string name, decimal perKg) => (await Json(await manager.PostAsJsonAsync("/api/inventory/raw-materials", new
        {
            name, unit = "Gram", purchaseUnit = "kg", purchaseUnitSize = 1000, costPerPurchaseUnit = perKg,
        }, Cancel))).GetProperty("id").GetGuid();
        var paprika = await Bought("Paprika", 200);
        var smoked = await Bought("Smoked paprika", 320);
        var category = Guid.NewGuid();
        await Json(await manager.PutAsJsonAsync($"/api/inventory/recipe-categories/{category}", new { name = "Sides" }, Cancel));
        var fries = (await Json(await manager.PostAsJsonAsync("/api/inventory/recipes", new
        {
            name = "Paprika fries", portions = 1, recipeCategoryId = category, plannedPrice = 40,
            ingredients = new[] { new { rawMaterialId = paprika, quantity = 5 } },
        }, Cancel))).GetProperty("id").GetGuid();
        var rub = (await Json(await manager.PostAsJsonAsync("/api/inventory/prep-items", new
        {
            name = "Spice rub", unit = "Gram", batchQuantity = 1000, displayUnit = "kg", displayUnitSize = 1000,
            ingredients = new[] { new { rawMaterialId = paprika, quantity = 500 } },
        }, Cancel))).GetProperty("id").GetGuid();

        // Where it is used: for a stock card, the storekeeper's too.
        var used = await Json(await manager.GetAsync($"/api/costing/intelligence/where-used/{paprika}", Cancel));
        Assert.Equal(["OffMenuRecipe:Paprika fries", "PrepItem:Spice rub"],
            used.GetProperty("rows").EnumerateArray().Select(r => $"{r.GetProperty("kind").GetString()}:{r.GetProperty("name").GetString()}"));
        var storekeeper = await api.UserAsync(manager, "Samir", UserRole.Storekeeper);
        Assert.Equal(HttpStatusCode.OK, (await storekeeper.GetAsync($"/api/costing/intelligence/where-used/{paprika}", Cancel)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await manager.GetAsync($"/api/costing/intelligence/where-used/{Guid.NewGuid()}", Cancel)).StatusCode);
        var swap = new { fromMaterialId = paprika, toMaterialId = smoked, ratio = 1 };
        Assert.Equal(HttpStatusCode.Forbidden, (await storekeeper.PostAsJsonAsync("/api/costing/recipes/bulk-swap/preview", swap, Cancel)).StatusCode);

        // A cost controller writes recipes, not prep items: those are shown, and left out.
        var controller = await api.UserAsync(manager, "Hana", UserRole.CostController);
        var preview = await Json(await controller.PostAsJsonAsync("/api/costing/recipes/bulk-swap/preview", swap, Cancel));
        Assert.Equal([("Paprika fries", true, false), ("Spice rub", false, true)],
            preview.GetProperty("rows").EnumerateArray().Select(r =>
                (r.GetProperty("name").GetString(), r.GetProperty("selected").GetBoolean(), r.GetProperty("blocked").ValueKind == JsonValueKind.String)));
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await controller.PostAsJsonAsync("/api/costing/recipes/bulk-swap", new
        {
            fromMaterialId = paprika, toMaterialId = smoked, ratio = 1, recipeIds = new[] { fries }, prepItemIds = new[] { rub }, canApprove = true,
        }, Cancel)).StatusCode);
        var done = await Json(await controller.PostAsJsonAsync("/api/costing/recipes/bulk-swap", new
        {
            fromMaterialId = paprika, toMaterialId = smoked, ratio = 0.8, recipeIds = new[] { fries },
        }, Cancel));
        Assert.Equal((1, 0), (done.GetProperty("recipes").GetInt32(), done.GetProperty("prepItems").GetInt32()));

        // The manager swaps the prep item; the fries are costed by the new item at once.
        await Json(await manager.PostAsJsonAsync("/api/costing/recipes/bulk-swap", new
        {
            fromMaterialId = paprika, toMaterialId = smoked, ratio = 1, prepItemIds = new[] { rub },
        }, Cancel));
        Assert.Empty((await Json(await manager.GetAsync($"/api/costing/intelligence/where-used/{paprika}", Cancel))).GetProperty("rows").EnumerateArray());
        Assert.Equal(1.28m, (await Json(await manager.GetAsync($"/api/costing/recipes/{fries}", Cancel))).GetProperty("costPerPortion").GetDecimal());
    }
}
