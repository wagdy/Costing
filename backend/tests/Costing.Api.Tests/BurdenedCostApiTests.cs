using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ClosedXML.Excel;
using Costing.Domain.Access;

namespace Costing.Api.Tests;

// The fully burdened plate cost through the API: a recipe's prep time saved and read back, the
// intelligence tab's report as a table and a workbook, its card's box, and who may see it.
public class BurdenedCostApiTests
{
    private static CancellationToken Cancel => TestContext.Current.CancellationToken;

    private static async Task<JsonElement> Json(HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, $"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync(Cancel)}");
        return await response.Content.ReadFromJsonAsync<JsonElement>(Cancel);
    }

    [Fact]
    public async Task A_recipe_s_prep_time_is_saved_and_its_burdened_plate_answers_as_a_table_a_box_and_a_workbook()
    {
        await using var api = await TestApi.StartAsync();
        var manager = await api.ManagerAsync();
        var today = DateOnly.Parse((await Json(await manager.GetAsync("/api/financials/today", Cancel))).GetProperty("today").GetString()!, CultureInfo.InvariantCulture);
        var first = new DateOnly(today.Year, today.Month, 1);

        var flour = (await Json(await manager.PostAsJsonAsync("/api/inventory/raw-materials", new
        {
            name = "Flour", unit = "Gram", purchaseUnit = "kg", purchaseUnitSize = 1000, costPerPurchaseUnit = 30,
        }, Cancel))).GetProperty("id").GetGuid();
        var category = Guid.NewGuid();
        await Json(await manager.PutAsJsonAsync($"/api/inventory/recipe-categories/{category}", new { name = "Pasta" }, Cancel));
        var recipe = await Json(await manager.PostAsJsonAsync("/api/inventory/recipes", new
        {
            name = "Alfredo pasta", portions = 1, recipeCategoryId = category, plannedPrice = 165, prepTimeMinutes = 14, complexityWeight = 1.5,
            ingredients = new[] { new { rawMaterialId = flour, quantity = 150 } },
        }, Cancel));
        var id = recipe.GetProperty("id").GetGuid();
        Assert.Equal((14m, 1.5m), (recipe.GetProperty("prepTimeMinutes").GetDecimal(), recipe.GetProperty("complexityWeight").GetDecimal()));
        var card = await Json(await manager.GetAsync($"/api/costing/recipes/{id}", Cancel));
        Assert.Equal((14m, 1.5m), (card.GetProperty("prepTimeMinutes").GetDecimal(), card.GetProperty("complexityWeight").GetDecimal()));

        // The plate-cost settings, with the rest of the cost settings.
        var settings = await Json(await manager.PutAsJsonAsync("/api/costing/settings", new
        {
            foodCostTargetPercent = 30,
            plateCost = new { defaultOverheadAllocationMethod = "ByRevenueShare", targetNetMarginPercent = 18, fallbackMonthlyLaborCost = 90_000, fallbackMonthlyOverheadCost = 75_000 },
        }, Cancel));
        Assert.Equal(("ByRevenueShare", 18m), (settings.GetProperty("plateCost").GetProperty("defaultOverheadAllocationMethod").GetString(),
            settings.GetProperty("plateCost").GetProperty("targetNetMarginPercent").GetDecimal()));

        // Simulated, by the plate: nothing sold, so nothing to share; the off-menu recipe still listed.
        var report = await Json(await manager.GetAsync(
            $"/api/costing/intelligence/burdened-costs?from={first:yyyy-MM-dd}&to={today:yyyy-MM-dd}&method=ByQuantitySold&source=Simulated&monthlyLabor=90000&monthlyOverhead=75000",
            Cancel));
        Assert.Equal(("ByQuantitySold", "Simulated", 18m), (report.GetProperty("method").GetString(), report.GetProperty("source").GetString(),
            report.GetProperty("targetNetMarginPercent").GetDecimal()));
        var alfredo = report.GetProperty("rows").EnumerateArray().Single(r => r.GetProperty("dish").GetString() == "Alfredo pasta");
        Assert.Equal((4.5m, 21m, false, "NotAllocated"), (alfredo.GetProperty("directFoodCost").GetDecimal(), alfredo.GetProperty("weightedMinutes").GetDecimal(),
            alfredo.GetProperty("onMenu").GetBoolean(), alfredo.GetProperty("status").GetString()));

        var box = await Json(await manager.GetAsync($"/api/costing/recipes/{id}/burdened", Cancel));
        Assert.Equal(("ByRevenueShare", "Alfredo pasta"), (box.GetProperty("method").GetString(), box.GetProperty("plate").GetProperty("dish").GetString()));

        var sheet = await manager.GetAsync($"/api/costing/intelligence/burdened-costs/sheet?from={first:yyyy-MM-dd}&to={today:yyyy-MM-dd}", Cancel);
        Assert.Equal(HttpStatusCode.OK, sheet.StatusCode);
        using (var book = new XLWorkbook(await sheet.Content.ReadAsStreamAsync(Cancel)))
            Assert.Equal(["Burdened plate cost", "Cost pools"], book.Worksheets.Select(w => w.Name));

        // Costs, so not a storekeeper's; a cost controller's on the intelligence tab and the card.
        var storekeeper = await api.UserAsync(manager, "Samir", UserRole.Storekeeper);
        var controller = await api.UserAsync(manager, "Karim", UserRole.CostController);
        var path = $"/api/costing/intelligence/burdened-costs?from={first:yyyy-MM-dd}&to={today:yyyy-MM-dd}";
        Assert.Equal(HttpStatusCode.Forbidden, (await storekeeper.GetAsync(path, Cancel)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await storekeeper.GetAsync($"/api/costing/recipes/{id}/burdened", Cancel)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await controller.GetAsync(path, Cancel)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await controller.GetAsync($"/api/costing/recipes/{id}/burdened", Cancel)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await manager.GetAsync($"{path}&method=Nope", Cancel)).StatusCode);
    }
}
