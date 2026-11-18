using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ClosedXML.Excel;
using Costing.Domain.Access;
using Costing.Domain.Company;

namespace Costing.Api.Tests;

// Internal transfers through the API: refused while the company is one open-space store; with
// sub-stores, made by whoever keeps the stock, its costs only for whoever sees costs; voided;
// listed and sent as a workbook; the locations and what each has.
public class InternalTransfersApiTests
{
    private static CancellationToken Cancel => TestContext.Current.CancellationToken;

    private static async Task<JsonElement> Json(HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, $"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync(Cancel)}");
        return await response.Content.ReadFromJsonAsync<JsonElement>(Cancel);
    }

    [Fact]
    public async Task Stock_is_moved_to_the_kitchen_once_the_company_has_locations_and_each_location_shows_what_it_has()
    {
        await using var api = await TestApi.StartAsync();
        var manager = await api.ManagerAsync();
        var storekeeper = await api.UserAsync(manager, "Samir", UserRole.Storekeeper);
        var accountant = await api.AccountantAsync(manager);
        var today = DateOnly.Parse((await Json(await manager.GetAsync("/api/financials/today", Cancel))).GetProperty("today").GetString()!, CultureInfo.InvariantCulture);
        var iso = today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var nile = Guid.NewGuid();
        await Json(await manager.PutAsJsonAsync($"/api/inventory/suppliers/{nile}", new { name = "Nile Mills" }, Cancel));
        var flour = (await Json(await manager.PostAsJsonAsync("/api/inventory/raw-materials", new
        {
            name = "Flour", unit = "Gram", purchaseUnit = "kg", purchaseUnitSize = 1000,
        }, Cancel))).GetProperty("id").GetGuid();
        var invoice = Guid.NewGuid();
        await Json(await manager.PutAsJsonAsync($"/api/inventory/purchase-invoices/{invoice}", new
        {
            supplierId = nile, invoiceDate = iso, paymentMethod = "Credit",
            lines = new[] { new { rawMaterialId = flour, enteredQuantity = 10, unitLabel = "kg", unitSize = 1000, cost = 300, itemType = "Inventory" } },
        }, Cancel));
        await Json(await manager.PostAsync($"/api/inventory/purchase-invoices/{invoice}/post", null, Cancel));

        // One open-space store: no locations, no transfers.
        Assert.Equal(0, (await Json(await storekeeper.GetAsync("/api/inventory/stock-locations", Cancel))).GetProperty("locations").GetArrayLength());
        var kitchen = Guid.NewGuid();
        var request = new
        {
            id = Guid.NewGuid(), fromLocationId = InventoryLocation.DefaultId, toLocationId = kitchen,
            lines = new[] { new { rawMaterialId = flour, quantity = 4_000 } }, notes = "Evening prep",
        };
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await storekeeper.PostAsJsonAsync("/api/inventory/internal-transfers", request, Cancel)).StatusCode);

        // Sub-stores: the kitchen added; the storekeeper moves four kilos there, without seeing what they cost.
        await Json(await manager.PutAsJsonAsync("/api/settings/company-structure/mode", new { mode = "SingleBranch_WithSubStores" }, Cancel));
        await Json(await manager.PutAsJsonAsync($"/api/settings/locations/{kitchen}", new
        {
            branchId = Branch.DefaultId, name = "Hot Kitchen", nameAr = "المطبخ الساخن", kind = "Kitchen",
        }, Cancel));
        Assert.Equal(["Main Store", "Hot Kitchen"], (await Json(await storekeeper.GetAsync("/api/inventory/stock-locations", Cancel)))
            .GetProperty("locations").EnumerateArray().Select(l => l.GetProperty("name").GetString()));
        // Someone who neither counts nor keeps the raw materials: refused.
        await Json(await manager.PutAsJsonAsync($"/api/access/{api.AccountantId}", new { tabs = new[] { "Purchases" } }, Cancel));
        Assert.Equal(HttpStatusCode.Forbidden, (await accountant.PostAsJsonAsync("/api/inventory/internal-transfers", request, Cancel)).StatusCode);
        var moved = await Json(await storekeeper.PostAsJsonAsync("/api/inventory/internal-transfers", request, Cancel));
        Assert.Equal(($"TR-{today.Year}-0001", "Hot Kitchen", "Posted", JsonValueKind.Null), (moved.GetProperty("number").GetString(),
            moved.GetProperty("toLocation").GetString(), moved.GetProperty("status").GetString(), moved.GetProperty("totalCost").ValueKind));
        // Sent again: the same transfer.
        Assert.Equal(moved.GetProperty("number").GetString(),
            (await Json(await storekeeper.PostAsJsonAsync("/api/inventory/internal-transfers", request, Cancel))).GetProperty("number").GetString());
        // A manager sees its value.
        var seen = await Json(await manager.GetAsync($"/api/inventory/internal-transfers/{request.id}", Cancel));
        Assert.Equal(120m, seen.GetProperty("totalCost").GetDecimal());

        // What each location has.
        var stock = await Json(await manager.GetAsync("/api/inventory/location-stock", Cancel));
        var row = stock.GetProperty("rows").EnumerateArray().Single(r => r.GetProperty("rawMaterialId").GetGuid() == flour);
        Assert.Equal((6_000m, 4_000m), (row.GetProperty("byLocation").GetProperty(InventoryLocation.DefaultId.ToString()).GetDecimal(),
            row.GetProperty("byLocation").GetProperty(kitchen.ToString()).GetDecimal()));

        // Listed, and as a workbook of the transfers and their lines.
        Assert.Single((await Json(await manager.GetAsync("/api/inventory/internal-transfers", Cancel))).EnumerateArray());
        var sheet = await manager.GetAsync("/api/inventory/internal-transfers/sheet", Cancel);
        Assert.Equal(HttpStatusCode.OK, sheet.StatusCode);
        using (var book = new XLWorkbook(await sheet.Content.ReadAsStreamAsync(Cancel)))
        {
            Assert.Equal(["Transfers", "Lines"], book.Worksheets.Select(w => w.Name));
            Assert.Contains(book.Worksheet("Lines").RowsUsed(), r => r.Cell(6).GetString() == "Flour" && r.Cell(7).GetDouble() == 4_000);
        }

        // Voided: the kitchen's four kilos back in the store.
        Assert.Equal("Voided", (await Json(await storekeeper.PostAsync($"/api/inventory/internal-transfers/{request.id}/void", null, Cancel)))
            .GetProperty("status").GetString());
        row = (await Json(await manager.GetAsync("/api/inventory/location-stock", Cancel))).GetProperty("rows").EnumerateArray()
            .Single(r => r.GetProperty("rawMaterialId").GetGuid() == flour);
        Assert.Equal(10_000m, row.GetProperty("byLocation").GetProperty(InventoryLocation.DefaultId.ToString()).GetDecimal());
        Assert.False(row.GetProperty("byLocation").TryGetProperty(kitchen.ToString(), out _));
    }
}
