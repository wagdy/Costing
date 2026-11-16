using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ClosedXML.Excel;
using Costing.Domain.Access;

namespace Costing.Api.Tests;

// AP aging and a supplier's statement, the vendor prices, staff meals and the inflation simulator,
// through the API: their routes, their JSON and who may call them.
public class ControllershipApiTests
{
    private static CancellationToken Cancel => TestContext.Current.CancellationToken;

    private static async Task<JsonElement> Json(HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, $"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync(Cancel)}");
        return await response.Content.ReadFromJsonAsync<JsonElement>(Cancel);
    }

    [Fact]
    public async Task The_controllership_reports_answer_by_their_routes_for_whoever_works_them()
    {
        await using var api = await TestApi.StartAsync();
        var manager = await api.ManagerAsync();
        var today = DateOnly.Parse((await Json(await manager.GetAsync("/api/financials/today", Cancel))).GetProperty("today").GetString()!, CultureInfo.InvariantCulture);
        var supplier = Guid.NewGuid();
        var saved = await Json(await manager.PutAsJsonAsync($"/api/inventory/suppliers/{supplier}", new { name = "Nile Farms", paymentTermsDays = 15 }, Cancel));
        Assert.Equal(15, saved.GetProperty("paymentTermsDays").GetInt32());
        var beef = (await Json(await manager.PostAsJsonAsync("/api/inventory/raw-materials", new
        {
            name = "Beef", unit = "Gram", purchaseUnit = "kg", purchaseUnitSize = 1000, costPerPurchaseUnit = 400,
        }, Cancel))).GetProperty("id").GetGuid();
        await Json(await manager.PostAsJsonAsync("/api/inventory/purchases", new
        {
            purchaseId = Guid.NewGuid(), lines = new[] { new { rawMaterialId = beef, quantity = 5_000, cost = 2_000 } },
        }, Cancel));

        // AP aging and the statement, with its sheet.
        var aging = await Json(await manager.GetAsync("/api/financials/ap-aging", Cancel));
        Assert.Equal(0m, aging.GetProperty("totalOwed").GetDecimal());
        var statement = await Json(await manager.GetAsync($"/api/suppliers/{supplier}/statement?from={today.AddDays(-30):yyyy-MM-dd}&to={today:yyyy-MM-dd}", Cancel));
        Assert.Equal(("Nile Farms", 15), (statement.GetProperty("supplier").GetString(), statement.GetProperty("paymentTermsDays").GetInt32()));
        var sheet = await manager.GetAsync($"/api/suppliers/{supplier}/statement/sheet", Cancel);
        Assert.Equal(HttpStatusCode.OK, sheet.StatusCode);
        using (var book = new XLWorkbook(await sheet.Content.ReadAsStreamAsync(Cancel)))
            Assert.Equal("Statement", book.Worksheets.Single().Name);
        Assert.Equal(HttpStatusCode.NotFound, (await manager.GetAsync($"/api/suppliers/{Guid.NewGuid()}/statement", Cancel)).StatusCode);

        // A staff meal, by its kind's name, and the day's report.
        var meal = await Json(await manager.PostAsJsonAsync("/api/inventory/staff-meals", new
        {
            entryId = Guid.NewGuid(), kind = "StaffMeal", lines = new[] { new { rawMaterialId = beef, quantity = 250 } }, note = "Lunch",
        }, Cancel));
        Assert.NotEqual(Guid.Empty, meal.GetProperty("entryId").GetGuid());
        var meals = await Json(await manager.GetAsync($"/api/costing/staff-meals?from={today:yyyy-MM-dd}&to={today:yyyy-MM-dd}", Cancel));
        Assert.Equal(100m, meals.GetProperty("staffMeals").GetDecimal());

        // The simulator: a POST, nothing saved.
        var simulation = await Json(await manager.PostAsJsonAsync("/api/costing/intelligence/simulate-inflation", new { globalPercent = 10 }, Cancel));
        Assert.Equal(440m, simulation.GetProperty("materials").EnumerateArray().Single().GetProperty("simulatedPrice").GetDecimal());
        Assert.Equal(HttpStatusCode.OK,
            (await manager.PostAsJsonAsync("/api/costing/intelligence/simulate-inflation/sheet", new { globalPercent = 10 }, Cancel)).StatusCode);

        // Vendor prices on Purchases too; the simulator is the intelligence tab's.
        var storekeeper = await api.UserAsync(manager, "Samir", UserRole.Storekeeper);
        var vendors = $"/api/costing/intelligence/vendor-prices?from={today.AddDays(-30):yyyy-MM-dd}&to={today:yyyy-MM-dd}";
        Assert.Equal(HttpStatusCode.OK, (await storekeeper.GetAsync(vendors, Cancel)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await storekeeper.PostAsJsonAsync("/api/costing/intelligence/simulate-inflation", new { globalPercent = 10 }, Cancel)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await storekeeper.GetAsync($"/api/costing/staff-meals?from={today:yyyy-MM-dd}&to={today:yyyy-MM-dd}", Cancel)).StatusCode);
    }
}
