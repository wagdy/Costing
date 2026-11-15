using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Costing.Domain.Access;

namespace Costing.Api.Tests;

// Blind counts (الجرد الأعمى) and daily spot counts (الجرد اليومي السريع) through the API: what a
// storekeeper is sent, who may post and send lines back, and what a spot count moves.
public class StockCountApiTests
{
    private static CancellationToken Cancel => TestContext.Current.CancellationToken;

    private static async Task<JsonElement> Json(HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, $"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync(Cancel)}");
        return await response.Content.ReadFromJsonAsync<JsonElement>(Cancel);
    }

    // Bought and on the shelf: grams at so much a kilo.
    private static async Task<Guid> StockedAsync(HttpClient manager, string name, decimal grams, decimal costPerKg)
    {
        var id = (await Json(await manager.PostAsJsonAsync("/api/inventory/raw-materials", new
        {
            name, unit = "Gram", purchaseUnit = "kg", purchaseUnitSize = 1000, costPerPurchaseUnit = costPerKg,
        }, Cancel))).GetProperty("id").GetGuid();
        await Json(await manager.PostAsJsonAsync("/api/inventory/purchases", new
        {
            purchaseId = Guid.NewGuid(), lines = new[] { new { rawMaterialId = id, quantity = grams, cost = grams / 1000 * costPerKg } },
        }, Cancel));
        return id;
    }

    private static async Task<Dictionary<Guid, decimal>> OnHandAsync(HttpClient client) =>
        (await Json(await client.GetAsync("/api/inventory/raw-materials", Cancel))).EnumerateArray()
            .ToDictionary(m => m.GetProperty("id").GetGuid(), m => m.GetProperty("quantityOnHand").GetDecimal());

    private static JsonElement LineOf(JsonElement count, Guid material) =>
        count.GetProperty("lines").EnumerateArray().Single(l => l.GetProperty("rawMaterialId").GetGuid() == material);

    private static (decimal? Book, decimal? Cost) Figures(JsonElement line) =>
        (line.GetProperty("bookQuantity").ValueKind == JsonValueKind.Null ? null : line.GetProperty("bookQuantity").GetDecimal(),
         line.GetProperty("unitCost").ValueKind == JsonValueKind.Null ? null : line.GetProperty("unitCost").GetDecimal());

    [Fact]
    public async Task A_storekeeper_counts_blind_and_hands_the_count_in_for_a_reviewer_to_reconcile_send_back_and_post()
    {
        await using var api = await TestApi.StartAsync();
        var manager = await api.ManagerAsync();
        var controller = await api.UserAsync(manager, "Karim", UserRole.CostController);
        var storekeeper = await api.UserAsync(manager, "Samir", UserRole.Storekeeper);
        var beef = await StockedAsync(manager, "Beef", 10_000, 400);
        var cheese = await StockedAsync(manager, "Mozzarella", 5_000, 300);
        var id = Guid.NewGuid();

        // The storekeeper's draft: sent back blind, whatever is asked.
        var saved = await Json(await storekeeper.PutAsJsonAsync($"/api/inventory/stock-counts/{id}?blind=false", new
        {
            lines = new object[] { new { rawMaterialId = beef, countedQuantity = 9_400, note = "one tray in the freezer" }, new { rawMaterialId = cheese, countedQuantity = 5_000 } },
        }, Cancel));
        Assert.True(saved.GetProperty("blind").GetBoolean());
        Assert.All(saved.GetProperty("lines").EnumerateArray(), l => Assert.Equal(((decimal?)null, (decimal?)null), Figures(l)));
        var read = await Json(await storekeeper.GetAsync($"/api/inventory/stock-counts/{id}?blind=false", Cancel));
        Assert.True(read.GetProperty("blind").GetBoolean());
        Assert.All(read.GetProperty("lines").EnumerateArray(), l => Assert.Equal(((decimal?)null, (decimal?)null), Figures(l)));
        Assert.Equal("one tray in the freezer", LineOf(read, beef).GetProperty("note").GetString());
        // Nor anything of the stock on the sheet's list.
        var items = await Json(await storekeeper.GetAsync("/api/inventory/stock-counts/items", Cancel));
        Assert.False(items[0].TryGetProperty("quantityOnHand", out _));

        // A storekeeper hands it in; posting it, or sending lines back, is for who sees the records.
        Assert.Equal(HttpStatusCode.Forbidden, (await storekeeper.PostAsync($"/api/inventory/stock-counts/{id}/post", null, Cancel)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await storekeeper.PostAsJsonAsync($"/api/inventory/stock-counts/{id}/recount", new { rawMaterialIds = new[] { beef } }, Cancel)).StatusCode);
        Assert.Equal("Submitted", (await Json(await storekeeper.PostAsync($"/api/inventory/stock-counts/{id}/submit", null, Cancel))).GetProperty("review").GetString());

        // The cost controller reconciles: the records now, the cost; blind only when asked.
        var reconciled = await Json(await controller.GetAsync($"/api/inventory/stock-counts/{id}", Cancel));
        Assert.False(reconciled.GetProperty("blind").GetBoolean());
        Assert.Equal(((decimal?)10_000m, (decimal?)0.4m), Figures(LineOf(reconciled, beef)));
        Assert.Equal(((decimal?)5_000m, (decimal?)0.3m), Figures(LineOf(reconciled, cheese)));
        Assert.True((await Json(await controller.GetAsync($"/api/inventory/stock-counts/{id}?blind=true", Cancel))).GetProperty("blind").GetBoolean());

        // The beef 600 g short: weighed again. The storekeeper sees which, not the figure.
        var sentBack = await Json(await controller.PostAsJsonAsync($"/api/inventory/stock-counts/{id}/recount",
            new { rawMaterialIds = new[] { beef }, note = "Weigh the beef again" }, Cancel));
        Assert.Equal(("RecountRequested", "Weigh the beef again"), (sentBack.GetProperty("review").GetString(), sentBack.GetProperty("reviewNote").GetString()));
        var asked = await Json(await storekeeper.GetAsync($"/api/inventory/stock-counts/{id}", Cancel));
        Assert.Equal((true, false), (LineOf(asked, beef).GetProperty("recountRequested").GetBoolean(), LineOf(asked, cheese).GetProperty("recountRequested").GetBoolean()));
        Assert.All(asked.GetProperty("lines").EnumerateArray(), l => Assert.Equal(((decimal?)null, (decimal?)null), Figures(l)));

        await Json(await storekeeper.PutAsJsonAsync($"/api/inventory/stock-counts/{id}", new
        {
            lines = new object[] { new { rawMaterialId = beef, countedQuantity = 9_950 }, new { rawMaterialId = cheese, countedQuantity = 5_000 } },
        }, Cancel));
        await Json(await storekeeper.PostAsync($"/api/inventory/stock-counts/{id}/submit", null, Cancel));
        var posted = await Json(await controller.PostAsync($"/api/inventory/stock-counts/{id}/post", null, Cancel));
        Assert.Equal("Posted", posted.GetProperty("status").GetString());
        Assert.Equal((9_950m, 5_000m), (await OnHandAsync(manager)) is var stock ? (stock[beef], stock[cheese]) : default);

        // Posted: still nothing of the records or the costs for the storekeeper.
        Assert.All((await Json(await storekeeper.GetAsync($"/api/inventory/stock-counts/{id}", Cancel))).GetProperty("lines").EnumerateArray(),
            l => Assert.Equal(((decimal?)null, (decimal?)null), Figures(l)));
        // Counted and posted at once: also for who sees the records.
        Assert.Equal(HttpStatusCode.Forbidden, (await storekeeper.PostAsJsonAsync("/api/inventory/stock-counts", new
        {
            stockCountId = Guid.NewGuid(), lines = new[] { new { rawMaterialId = beef, countedQuantity = 1 } },
        }, Cancel)).StatusCode);
    }

    [Fact]
    public async Task A_spot_count_from_a_preset_moves_only_what_it_counted_and_leaves_every_other_material_untouched()
    {
        await using var api = await TestApi.StartAsync();
        var manager = await api.ManagerAsync();
        var storekeeper = await api.UserAsync(manager, "Samir", UserRole.Storekeeper);
        var beef = await StockedAsync(manager, "Beef", 10_000, 400);
        var cheese = await StockedAsync(manager, "Mozzarella", 5_000, 300);
        var flour = await StockedAsync(manager, "Flour", 50_000, 30);
        var oil = await StockedAsync(manager, "Oil", 20_000, 80);

        // Beef and cheese starred as daily critical items, by the storekeeper, from the counts.
        foreach (var item in new[] { beef, cheese })
            Assert.True((await Json(await storekeeper.PutAsJsonAsync($"/api/inventory/raw-materials/{item}/spot-check", new { isSpotCheckItem = true }, Cancel)))
                .GetProperty("isSpotCheckItem").GetBoolean());
        var presets = await Json(await storekeeper.GetAsync("/api/costing/count-presets", Cancel));
        var critical = presets.GetProperty("presets").EnumerateArray().Single(p => p.GetProperty("key").GetString() == "critical");
        var ids = critical.GetProperty("materialIds").EnumerateArray().Select(i => i.GetGuid()).ToList();
        Assert.Equal(new HashSet<Guid> { beef, cheese }, ids.ToHashSet());
        Assert.Equal(["classA", "critical", "highVariance"], presets.GetProperty("presets").EnumerateArray().Select(p => p.GetProperty("key").GetString()).Order());
        Assert.Contains(presets.GetProperty("categories").EnumerateArray(), c => c.GetProperty("materialIds").GetArrayLength() == 4);

        var before = await OnHandAsync(manager);
        var id = Guid.NewGuid();
        var started = await Json(await storekeeper.PutAsJsonAsync($"/api/inventory/stock-counts/{id}", new
        {
            lines = Array.Empty<object>(), kind = "Periodic", scope = "Spot", scopeMaterialIds = ids, scopeLabel = "Daily critical items",
        }, Cancel));
        Assert.Equal(("Spot", "Daily critical items", 2), (started.GetProperty("scope").GetString(), started.GetProperty("scopeLabel").GetString(),
            started.GetProperty("scopeMaterialIds").GetArrayLength()));
        // Flour is not in it.
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await storekeeper.PutAsJsonAsync($"/api/inventory/stock-counts/{id}", new
        {
            lines = new[] { new { rawMaterialId = flour, countedQuantity = 1 } },
        }, Cancel)).StatusCode);

        // Only the beef weighed (9.2 kg); the cheese in it but not counted.
        await Json(await storekeeper.PutAsJsonAsync($"/api/inventory/stock-counts/{id}", new { lines = new[] { new { rawMaterialId = beef, countedQuantity = 9_200 } } }, Cancel));
        await Json(await storekeeper.PostAsync($"/api/inventory/stock-counts/{id}/submit", null, Cancel));
        await Json(await manager.PostAsync($"/api/inventory/stock-counts/{id}/post", null, Cancel));

        var after = await OnHandAsync(manager);
        Assert.Equal(9_200m, after[beef]);
        Assert.Equal((before[cheese], before[flour], before[oil]), (after[cheese], after[flour], after[oil]));
        // One ledger entry, the beef's, on its stock card.
        var card = await Json(await manager.GetAsync($"/api/costing/materials/{beef}/stock-card?type=CountAdjustment", Cancel));
        Assert.Equal(-0.8m, card.GetProperty("lines").EnumerateArray().Single().GetProperty("quantityOut").GetDecimal() * -1);
        foreach (var untouched in new[] { cheese, flour, oil })
            Assert.Empty((await Json(await manager.GetAsync($"/api/costing/materials/{untouched}/stock-card?type=CountAdjustment", Cancel))).GetProperty("lines").EnumerateArray());

        var summary = (await Json(await manager.GetAsync("/api/inventory/stock-counts", Cancel))).EnumerateArray().Single();
        Assert.Equal(("Spot", 2, 1), (summary.GetProperty("scope").GetString(), summary.GetProperty("scopeSize").GetInt32(), summary.GetProperty("materials").GetInt32()));
    }
}
