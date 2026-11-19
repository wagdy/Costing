using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ClosedXML.Excel;

namespace Costing.Api.Tests;

// The central kitchen's hub through the API, each request in the branch chosen (X-Branch-Id): empty
// and refused outside a central kitchen's company; a storekeeper asks for Tanta, sends from the
// kitchen and receives in Tanta without seeing a price (the transfer price set by the markup, not
// by them); a manager sees the billing and alone voids a received shipment; the hub as a workbook;
// none of it for whoever neither keeps the stock nor buys it.
public class InterBranchApiTests
{
    private static CancellationToken Cancel => TestContext.Current.CancellationToken;

    private static async Task<JsonElement> Json(HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, $"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync(Cancel)}");
        return await response.Content.ReadFromJsonAsync<JsonElement>(Cancel);
    }

    private static async Task<HttpResponseMessage> In(HttpClient client, Guid branch, HttpMethod method, string url, object? body = null)
    {
        using var request = new HttpRequestMessage(method, url);
        request.Headers.Add("X-Branch-Id", branch.ToString());
        if (body is not null)
            request.Content = JsonContent.Create(body);
        return await client.SendAsync(request, Cancel);
    }

    [Fact]
    public async Task A_storekeeper_asks_sends_and_receives_without_a_price_and_a_manager_voids_a_received_shipment()
    {
        await using var api = await TestApi.StartAsync();
        var manager = await api.ManagerAsync();
        var samir = await api.UserAsync(manager, "Samir", Costing.Domain.Access.UserRole.Storekeeper);
        var accountant = await api.AccountantAsync(manager);
        var today = DateOnly.Parse((await Json(await manager.GetAsync("/api/financials/today", Cancel))).GetProperty("today").GetString()!, CultureInfo.InvariantCulture);
        var nile = Guid.NewGuid();
        await Json(await manager.PutAsJsonAsync($"/api/inventory/suppliers/{nile}", new { name = "Nile Farms" }, Cancel));
        var sauce = (await Json(await manager.PostAsJsonAsync("/api/inventory/raw-materials", new
        {
            name = "Tomato sauce", unit = "Gram", purchaseUnit = "kg", purchaseUnitSize = 1000,
        }, Cancel))).GetProperty("id").GetGuid();

        // An open-space shop: the hub says so and holds nothing; nothing is asked.
        var open = await Json(await samir.GetAsync("/api/inter-branch", Cancel));
        Assert.Equal(("SingleBranch_OpenSpace", 0), (open.GetProperty("mode").GetString(), open.GetProperty("requisitions").GetArrayLength()));
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await samir.PostAsJsonAsync("/api/inter-branch/requisitions", new
        {
            id = Guid.NewGuid(), supplyingBranchId = Guid.NewGuid(), lines = new[] { new { rawMaterialId = sauce, quantity = 1 } },
        }, Cancel)).StatusCode);

        // A central kitchen and Tanta; the kitchen buys ten kilos at L.E 100.
        await Json(await manager.PutAsJsonAsync("/api/settings/company-structure/mode", new { mode = "MultiBranch_CentralKitchen" }, Cancel));
        var (kitchen, tanta) = (Guid.NewGuid(), Guid.NewGuid());
        await Json(await manager.PutAsJsonAsync($"/api/settings/branches/{kitchen}", new { name = "Central Kitchen", type = "CentralKitchen" }, Cancel));
        await Json(await manager.PutAsJsonAsync($"/api/settings/branches/{tanta}", new { name = "Tanta", type = "Restaurant" }, Cancel));
        var invoice = Guid.NewGuid();
        await Json(await In(manager, kitchen, HttpMethod.Put, $"/api/inventory/purchase-invoices/{invoice}", new
        {
            supplierId = nile, invoiceDate = today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), paymentMethod = "Credit",
            lines = new[] { new { rawMaterialId = sauce, enteredQuantity = 10, unitLabel = "kg", unitSize = 1000, cost = 1000, itemType = "Inventory" } },
        }));
        await Json(await In(manager, kitchen, HttpMethod.Post, $"/api/inventory/purchase-invoices/{invoice}/post"));

        // Samir asks for Tanta, sends from the kitchen at 10% over cost (his own price ignored), receives in Tanta.
        var asked = await Json(await In(samir, tanta, HttpMethod.Post, "/api/inter-branch/requisitions", new
        {
            id = Guid.NewGuid(), supplyingBranchId = kitchen, lines = new[] { new { rawMaterialId = sauce, quantity = 4_000, notes = "Weekend" } },
        }));
        Assert.Equal($"REQ-{today.Year}-0001", asked.GetProperty("number").GetString());
        var shipment = new
        {
            id = Guid.NewGuid(), requisitionId = asked.GetProperty("id").GetGuid(), pricing = "WithMarkupOrCustomPrice", markupPercent = 10,
            lines = new[] { new { rawMaterialId = sauce, quantity = 4_000, transferUnitPrice = 0.5 } },
        };
        var sent = await Json(await In(samir, kitchen, HttpMethod.Post, "/api/inter-branch/shipments", shipment));
        Assert.Equal(($"ISI-{today.Year}-0001", "InTransit", JsonValueKind.Null), (sent.GetProperty("number").GetString(), sent.GetProperty("status").GetString(),
            sent.GetProperty("totalTransferRevenue").ValueKind));
        var seen = await Json(await In(manager, kitchen, HttpMethod.Get, "/api/inter-branch"));
        Assert.Equal((440m, 440m), (seen.GetProperty("shipments")[0].GetProperty("totalTransferRevenue").GetDecimal(),
            seen.GetProperty("summary").GetProperty("billingThisMonth").GetDecimal()));
        var received = await Json(await In(samir, tanta, HttpMethod.Post, "/api/inter-branch/receipts", new { id = Guid.NewGuid(), shipmentId = sent.GetProperty("id").GetGuid() }));
        Assert.Equal(($"IPI-{today.Year}-0001", JsonValueKind.Null), (received.GetProperty("number").GetString(), received.GetProperty("totalBilled").ValueKind));

        // The hub as a workbook.
        var sheet = await In(manager, tanta, HttpMethod.Get, "/api/inter-branch/sheet");
        Assert.Equal(HttpStatusCode.OK, sheet.StatusCode);
        using (var book = new XLWorkbook(await sheet.Content.ReadAsStreamAsync(Cancel)))
            Assert.Equal(["Requisitions", "Requisition lines", "Dispatches", "Dispatch lines", "Receipts", "Receipt lines"], book.Worksheets.Select(w => w.Name));

        // A received shipment: not Samir's to void; a manager's.
        var receiptId = received.GetProperty("id").GetGuid();
        Assert.Equal(HttpStatusCode.Forbidden, (await In(samir, tanta, HttpMethod.Post, $"/api/inter-branch/receipts/{receiptId}/void")).StatusCode);
        Assert.Equal("Voided", (await Json(await In(manager, tanta, HttpMethod.Post, $"/api/inter-branch/receipts/{receiptId}/void"))).GetProperty("status").GetString());

        // Neither keeping the stock nor buying it: no hub.
        await Json(await manager.PutAsJsonAsync($"/api/access/{api.AccountantId}", new { tabs = new[] { "Financials" } }, Cancel));
        Assert.Equal(HttpStatusCode.Forbidden, (await accountant.GetAsync("/api/inter-branch", Cancel)).StatusCode);
    }
}
