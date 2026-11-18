using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ClosedXML.Excel;
using Costing.Domain.Access;

namespace Costing.Api.Tests;

// The kitchen and bar stations through the API: listed for whoever sorts or counts by them, set by a
// manager alone; materials given one in bulk; the station-level variance and its workbook for whoever
// reads Intelligence or Reports; a station's spot count.
public class StationsApiTests
{
    private static CancellationToken Cancel => TestContext.Current.CancellationToken;

    private static async Task<JsonElement> Json(HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, $"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync(Cancel)}");
        return await response.Content.ReadFromJsonAsync<JsonElement>(Cancel);
    }

    [Fact]
    public async Task Stations_are_a_managers_to_set_and_each_materials_use_is_reported_under_its_own()
    {
        await using var api = await TestApi.StartAsync();
        var manager = await api.ManagerAsync();
        var today = DateOnly.Parse((await Json(await manager.GetAsync("/api/financials/today", Cancel))).GetProperty("today").GetString()!, CultureInfo.InvariantCulture);
        var storekeeper = await api.UserAsync(manager, "Samir", UserRole.Storekeeper);
        var controller = await api.UserAsync(manager, "Karim", UserRole.CostController);

        // The seven to start with, listed for a storekeeper too (they count and log waste by them).
        var stations = (await Json(await storekeeper.GetAsync("/api/costing/stations", Cancel))).EnumerateArray().ToList();
        Assert.Equal(["Grill", "Pizza & Bakery", "Hot Kitchen", "Cold & Salads", "Bar & Barista", "Pastry & Desserts", "Shared / General"],
            stations.Select(s => s.GetProperty("name").GetString()));
        var bar = stations[4].GetProperty("id").GetGuid();

        // A manager's to set: the bar's tolerance tightened; a storekeeper or cost controller refused.
        var request = new { name = "Bar & Barista", nameAr = "البار والباريستا", code = "BAR", displayOrder = 5, targetVarianceTolerancePercent = 2, isActive = true };
        Assert.Equal(HttpStatusCode.Forbidden, (await controller.PutAsJsonAsync($"/api/costing/stations/{bar}", request, Cancel)).StatusCode);
        Assert.Equal(2m, (await Json(await manager.PutAsJsonAsync($"/api/costing/stations/{bar}", request, Cancel)))
            .GetProperty("targetVarianceTolerancePercent").GetDecimal());
        var pastry = Guid.NewGuid();
        await Json(await manager.PutAsJsonAsync($"/api/costing/stations/{pastry}", new { name = "Bakery oven", code = "OVEN", displayOrder = 8 }, Cancel));
        Assert.Equal(HttpStatusCode.NoContent, (await manager.DeleteAsync($"/api/costing/stations/{pastry}", Cancel)).StatusCode);

        // Coffee given to the bar in bulk with milk, by whoever works Raw materials.
        var coffee = (await Json(await manager.PostAsJsonAsync("/api/inventory/raw-materials", new
        {
            name = "Coffee beans", unit = "Gram", purchaseUnit = "kg", purchaseUnitSize = 1000, costPerPurchaseUnit = 900,
        }, Cancel))).GetProperty("id").GetGuid();
        var milk = (await Json(await manager.PostAsJsonAsync("/api/inventory/raw-materials", new
        {
            name = "Milk", unit = "Millilitre", purchaseUnit = "L", purchaseUnitSize = 1000, costPerPurchaseUnit = 40,
        }, Cancel))).GetProperty("id").GetGuid();
        var assigned = await Json(await storekeeper.PutAsJsonAsync("/api/inventory/raw-materials/station", new { rawMaterialIds = new[] { coffee, milk }, stationId = bar }, Cancel));
        Assert.Equal(2, assigned.GetProperty("assigned").GetInt32());
        var costed = (await Json(await manager.GetAsync("/api/costing/materials", Cancel))).EnumerateArray().Single(m => m.GetProperty("id").GetGuid() == coffee);
        Assert.Equal(bar, costed.GetProperty("kitchenStationId").GetGuid());

        // Spoiled by the bar: held against it.
        await Json(await manager.PostAsJsonAsync("/api/inventory/spoilage", new
        {
            spoilageId = Guid.NewGuid(), lines = new[] { new { rawMaterialId = milk, quantity = 500, reason = "Sour", responsibleStationId = bar } },
        }, Cancel));
        var spoiled = (await Json(await manager.GetAsync("/api/costing/spoilage?days=1", Cancel))).EnumerateArray().Single();
        Assert.Equal(bar, spoiled.GetProperty("lines")[0].GetProperty("responsibleStationId").GetGuid());

        // The station-level variance: for Intelligence or Reports, not a storekeeper.
        var span = $"from={today.AddDays(-6):yyyy-MM-dd}&to={today:yyyy-MM-dd}";
        Assert.Equal(HttpStatusCode.Forbidden, (await storekeeper.GetAsync($"/api/costing/intelligence/station-variance?{span}", Cancel)).StatusCode);
        var report = await Json(await controller.GetAsync($"/api/costing/intelligence/station-variance?{span}", Cancel));
        var barRow = report.GetProperty("stations").EnumerateArray().Single(s => s.GetProperty("code").GetString() == "BAR");
        Assert.Equal((2m, 20m, "WithinTarget"), (barRow.GetProperty("tolerancePercent").GetDecimal(), barRow.GetProperty("loggedSpoilageWasteCost").GetDecimal(),
            barRow.GetProperty("status").GetString()));
        var sheet = await controller.GetAsync($"/api/costing/intelligence/station-variance/sheet?{span}", Cancel);
        Assert.Equal(HttpStatusCode.OK, sheet.StatusCode);
        using (var book = new XLWorkbook(await sheet.Content.ReadAsStreamAsync(Cancel)))
            Assert.Equal(["Station Summary", "By Station"], book.Worksheets.Select(w => w.Name));

        // A station's spot count, for a storekeeper at the shift's close.
        var presets = await Json(await storekeeper.GetAsync("/api/costing/count-presets", Cancel));
        var barPreset = presets.GetProperty("stations").EnumerateArray().Single(s => s.GetProperty("code").GetString() == "BAR");
        Assert.Equal(new[] { coffee, milk }.Order(), barPreset.GetProperty("materialIds").EnumerateArray().Select(i => i.GetGuid()).Order());
    }
}
