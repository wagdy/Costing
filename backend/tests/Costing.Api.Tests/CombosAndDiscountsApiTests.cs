using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Costing.Domain.Access;

namespace Costing.Api.Tests;

// Combo offers and a day's discounts through the API: their routes, their JSON and who may call them.
public class CombosAndDiscountsApiTests
{
    private static CancellationToken Cancel => TestContext.Current.CancellationToken;

    private static async Task<JsonElement> Json(HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, $"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync(Cancel)}");
        return await response.Content.ReadFromJsonAsync<JsonElement>(Cancel);
    }

    [Fact]
    public async Task Combos_are_built_by_whoever_writes_recipes_and_the_POS_sells_them_with_its_discounts()
    {
        await using var api = await TestApi.StartAsync();
        var manager = await api.ManagerAsync();
        var today = DateOnly.Parse((await Json(await manager.GetAsync("/api/financials/today", Cancel))).GetProperty("today").GetString()!, CultureInfo.InvariantCulture);

        // A menu item and a recipe for it: a burger at 120 of a 35 patty.
        await Json(await manager.PostAsJsonAsync("/api/menu/categories", new { name = "Mains" }, Cancel));
        await Json(await manager.PostAsJsonAsync("/api/menu/items", new
        {
            number = 1, name = "Burger", category = "Mains", price = 120, isPriceBasedOnAddons = false, sizes = Array.Empty<object>(), addOnIds = Array.Empty<int>(),
        }, Cancel));
        var patty = (await Json(await manager.PostAsJsonAsync("/api/inventory/raw-materials", new
        {
            name = "Patty", unit = "Piece", purchaseUnit = "piece", purchaseUnitSize = 1, costPerPurchaseUnit = 35,
        }, Cancel))).GetProperty("id").GetGuid();
        var kitchen = Guid.NewGuid();
        await Json(await manager.PutAsJsonAsync($"/api/inventory/recipe-categories/{kitchen}", new { name = "Grill" }, Cancel));
        var burger = (await Json(await manager.PostAsJsonAsync("/api/inventory/recipes", new
        {
            targetKind = "MenuItem", catalogItemId = 1, portions = 1, recipeCategoryId = kitchen, ingredients = new[] { new { rawMaterialId = patty, quantity = 1 } },
        }, Cancel))).GetProperty("id").GetGuid();

        // Two burgers at 200: 70 of food, 35%, above the 30% target. A storekeeper (no Recipes tab) may not build one.
        var combo = Guid.NewGuid();
        var body = new { code = 9001, name = "Burger duo", nameAr = "ثنائي", sellingPrice = 200, isActive = true, items = new[] { new { recipeId = burger, quantity = 2 } } };
        var storekeeper = await api.UserAsync(manager, "Samir", UserRole.Storekeeper);
        Assert.Equal(HttpStatusCode.Forbidden, (await storekeeper.PutAsJsonAsync($"/api/inventory/combos/{combo}", body, Cancel)).StatusCode);
        var saved = await Json(await manager.PutAsJsonAsync($"/api/inventory/combos/{combo}", body, Cancel));
        Assert.Equal(9001, saved.GetProperty("code").GetInt32());
        var list = await Json(await manager.GetAsync("/api/costing/combos", Cancel));
        var one = list.GetProperty("combos").EnumerateArray().Single();
        Assert.Equal((70m, 240m, 35m, "AboveTarget"),
            (one.GetProperty("totalCost").GetDecimal(), one.GetProperty("originalPrice").GetDecimal(), one.GetProperty("foodCostPercent").GetDecimal(),
                one.GetProperty("status").GetString()));
        Assert.Equal(9002, list.GetProperty("nextCode").GetInt32());
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await manager.DeleteAsync($"/api/inventory/recipes/{burger}", Cancel)).StatusCode);

        // The POS sells it by its number, with its discounts named or counted.
        var key = (await Json(await manager.PostAsync("/api/settings/pos-integration/key", null, Cancel))).GetProperty("key").GetString()!;
        var pos = api.Anonymous();
        pos.DefaultRequestHeaders.Add("X-Api-Key", key);
        var menu = await Json(await pos.GetAsync("/api/integrations/pos/menu", Cancel));
        Assert.Contains("9001", menu.GetRawText());
        var report = await Json(await pos.PostAsJsonAsync("/api/integrations/pos/z-report", new
        {
            zReportId = Guid.NewGuid(),
            date = today.ToString("yyyy-MM-dd"),
            shiftNumber = 1,
            takings = new
            {
                totalCash = 300m, totalCard = 0m, totalTax = 0m, voidsAmount = 0m, voidReasons = Array.Empty<object>(),
                discountsAmount = 100m, discountReasons = new object[] { "Staff", new { reason = "Loyalty", amount = 60m, count = 2 } },
            },
            soldItems = new[] { new { itemCode = 9001, quantitySold = 2 } },
        }, Cancel));
        Assert.Equal("Recorded", report.GetProperty("outcome").GetString());
        // On the end of day, locked as the POS gave it; confirmed, its takings go into the safe.
        var handedIn = await Json(await manager.PostAsync($"/api/end-of-day/{today:yyyy-MM-dd}/submit", null, Cancel));
        Assert.Equal(300m, handedIn.GetProperty("takingsEntered").GetDecimal());

        // The KPIs: 140 of food on 300 collected, 400 at the menu's prices.
        var kpis = await Json(await manager.GetAsync($"/api/costing/kpis?year={today.Year}&month={today.Month}", Cancel));
        var discounts = kpis.GetProperty("discounts");
        Assert.Equal((100m, 400m, 35m, 46.7m, 11.7m),
            (discounts.GetProperty("discounts").GetDecimal(), discounts.GetProperty("standardGrossRevenue").GetDecimal(),
                discounts.GetProperty("standardFoodCostPercent").GetDecimal(), discounts.GetProperty("actualFoodCostPercent").GetDecimal(),
                discounts.GetProperty("erosionPoints").GetDecimal()));
        Assert.Equal(["Loyalty", "Staff"], discounts.GetProperty("reasons").EnumerateArray().Select(r => r.GetProperty("reason").GetString()));

        // The day's end with its discounts: the cash expected in the till is the same without them.
        var day = await Json(await manager.GetAsync($"/api/end-of-day/{today:yyyy-MM-dd}", Cancel));
        Assert.Equal((100m, 300m), (day.GetProperty("discountsAmount").GetDecimal(), day.GetProperty("netCashInTill").GetDecimal()));

        Assert.Equal(HttpStatusCode.NoContent, (await manager.DeleteAsync($"/api/inventory/combos/{combo}", Cancel)).StatusCode);
        Assert.Empty((await Json(await manager.GetAsync("/api/costing/combos", Cancel))).GetProperty("combos").EnumerateArray());
    }
}
