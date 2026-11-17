using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Costing.Domain.Access;

namespace Costing.Api.Tests;

// Purchase orders through the API: the planner's preview, an accountant's orders asked of a manager,
// a delivery received against one over its price and held for a manager, and who may close one.
public class PurchaseOrdersApiTests
{
    private static CancellationToken Cancel => TestContext.Current.CancellationToken;

    private static async Task<JsonElement> Json(HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, $"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync(Cancel)}");
        return await response.Content.ReadFromJsonAsync<JsonElement>(Cancel);
    }

    [Fact]
    public async Task The_planner_writes_the_orders_a_manager_approves_them_and_an_overcharged_delivery_waits_for_one()
    {
        await using var api = await TestApi.StartAsync();
        var manager = await api.ManagerAsync();
        var accountant = await api.AccountantAsync(manager);
        var today = DateOnly.Parse((await Json(await manager.GetAsync("/api/financials/today", Cancel))).GetProperty("today").GetString()!, CultureInfo.InvariantCulture);
        var day = today.ToString("yyyy-MM-dd");

        var flour = (await Json(await manager.PostAsJsonAsync("/api/inventory/raw-materials", new
        {
            name = "Flour", unit = "Gram", purchaseUnit = "kg", purchaseUnitSize = 1000, costPerPurchaseUnit = 30,
        }, Cancel))).GetProperty("id").GetGuid();
        var mill = Guid.NewGuid();
        await Json(await manager.PutAsJsonAsync($"/api/inventory/suppliers/{mill}", new { name = "Nile Mills" }, Cancel));
        var bought = Guid.NewGuid();
        await Json(await manager.PutAsJsonAsync($"/api/inventory/purchase-invoices/{bought}", new
        {
            supplierId = mill, invoiceDate = day, paymentMethod = "Credit",
            lines = new[] { new { rawMaterialId = flour, enteredQuantity = 1, unitLabel = "kg", unitSize = 1000, cost = 30, itemType = "Inventory" } },
        }, Cancel));
        await Json(await manager.PostAsync($"/api/inventory/purchase-invoices/{bought}/post", null, Cancel));

        // The planner: 20 kg of flour from who sold it last, at 30.
        var plan = await Json(await accountant.PostAsJsonAsync("/api/costing/intelligence/orders/purchase-orders", new
        {
            lines = new[] { new { rawMaterialId = flour, quantity = 20 } }, groupBy = "Supplier",
        }, Cancel));
        var planned = plan.GetProperty("orders").EnumerateArray().Single();
        Assert.Equal(("Nile Mills", 600m), (planned.GetProperty("supplier").GetString(), planned.GetProperty("total").GetDecimal()));

        // Written by the accountant: a draft asked of a manager.
        var po = Guid.NewGuid();
        var written = await Json(await accountant.PostAsJsonAsync("/api/inventory/purchase-orders/batch", new
        {
            orders = new[]
            {
                new
                {
                    id = po,
                    order = new
                    {
                        supplierId = mill, orderDate = day, expectedDeliveryDate = day, paymentTerms = "Cash", notes = (string?)null,
                        lines = new[] { new { rawMaterialId = flour, orderedPurchaseQty = 20, expectedUnitCost = 30 } },
                    },
                },
            },
        }, Cancel));
        var saved = written.EnumerateArray().Single();
        Assert.Equal(("Requested", "Draft"), (saved.GetProperty("outcome").GetString(), saved.GetProperty("status").GetString()));
        await Json(await manager.PostAsync($"/api/inventory/approval-requests/{saved.GetProperty("request").GetProperty("id").GetGuid()}/approve", null, Cancel));
        var open = await Json(await accountant.GetAsync($"/api/inventory/purchase-orders/open?supplierId={mill}", Cancel));
        Assert.Equal((20m, "Approved"), (open[0].GetProperty("lines")[0].GetProperty("remainingQty").GetDecimal(), open[0].GetProperty("status").GetString()));

        // 15 kg billed at 33 a kg: over the order's price, held for a manager.
        var invoice = Guid.NewGuid();
        var draft = await Json(await accountant.PutAsJsonAsync($"/api/inventory/purchase-invoices/{invoice}", new
        {
            supplierId = mill, supplierInvoiceNumber = "M-7", invoiceDate = day, paymentMethod = "Credit", purchaseOrderId = po,
            lines = new[] { new { rawMaterialId = flour, enteredQuantity = 15, unitLabel = "kg", unitSize = 1000, cost = 495, itemType = "Inventory" } },
        }, Cancel));
        var line = draft.GetProperty("purchaseOrder").GetProperty("lines")[0];
        Assert.Equal(("PriceOvercharge", 33m, 45m), (line.GetProperty("status").GetString(), line.GetProperty("netUnitPrice").GetDecimal(),
            line.GetProperty("overcharge").GetDecimal()));
        var held = await Json(await accountant.PostAsync($"/api/inventory/purchase-invoices/{invoice}/post", null, Cancel));
        Assert.Equal(("Draft", true), (held.GetProperty("status").GetString(), held.GetProperty("awaitingApproval").GetBoolean()));
        var request = (await Json(await manager.GetAsync("/api/inventory/approval-requests", Cancel))).GetProperty("pending").EnumerateArray()
            .Single(r => r.GetProperty("recordId").GetGuid() == invoice);
        Assert.Equal("PurchaseInvoice", request.GetProperty("module").GetString());
        await Json(await manager.PostAsync($"/api/inventory/approval-requests/{request.GetProperty("id").GetGuid()}/approve", null, Cancel));

        var order = await Json(await accountant.GetAsync($"/api/inventory/purchase-orders/{po}", Cancel));
        Assert.Equal(("PartiallyReceived", 15m, 1), (order.GetProperty("status").GetString(), order.GetProperty("lines")[0].GetProperty("receivedPurchaseQty").GetDecimal(),
            order.GetProperty("deliveries").GetArrayLength()));
        var listed = await Json(await accountant.GetAsync("/api/inventory/purchase-orders?status=PartiallyReceived", Cancel));
        Assert.Equal(1, listed.GetArrayLength());

        // Closing what is left is a manager's; a storekeeper may not see the planner's preview.
        Assert.Equal(HttpStatusCode.Forbidden, (await accountant.PostAsync($"/api/inventory/purchase-orders/{po}/close", null, Cancel)).StatusCode);
        Assert.Equal("Completed", (await Json(await manager.PostAsync($"/api/inventory/purchase-orders/{po}/close", null, Cancel))).GetProperty("status").GetString());
        var storekeeper = await api.UserAsync(manager, "Samir", UserRole.Storekeeper);
        Assert.Equal(HttpStatusCode.Forbidden, (await storekeeper.PostAsJsonAsync("/api/costing/intelligence/orders/purchase-orders", new
        {
            lines = new[] { new { rawMaterialId = flour, quantity = 1 } },
        }, Cancel)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await storekeeper.GetAsync("/api/inventory/purchase-orders", Cancel)).StatusCode);
    }
}
