using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Costing.Domain.Access;

namespace Costing.Api.Tests;

// Month-end close through the API: the status, the history and the lock a manager's, typed LOCK;
// the unlock the owner's, with why; and every write of a closed day answered 423 Locked with the
// lock's day and the day refused: an invoice voided or entered, the day's sales, a month's
// expenses and sales sheet, the POS's Z report (logged as refused), a count posted.
public class PeriodLockApiTests
{
    private static CancellationToken Cancel => TestContext.Current.CancellationToken;

    private static string Iso(DateOnly day) => day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static async Task<JsonElement> Json(HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, $"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync(Cancel)}");
        return await response.Content.ReadFromJsonAsync<JsonElement>(Cancel);
    }

    private static async Task<JsonElement> Locked(HttpResponseMessage response)
    {
        Assert.True(response.StatusCode == HttpStatusCode.Locked, $"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync(Cancel)}");
        return await response.Content.ReadFromJsonAsync<JsonElement>(Cancel);
    }

    private static async Task<DateOnly> TodayAsync(HttpClient client) =>
        DateOnly.Parse((await Json(await client.GetAsync("/api/financials/today", Cancel))).GetProperty("today").GetString()!, CultureInfo.InvariantCulture);

    private static async Task<Guid> PostedInvoiceAsync(HttpClient manager, Guid supplier, Guid material, DateOnly day)
    {
        var id = Guid.NewGuid();
        await Json(await manager.PutAsJsonAsync($"/api/inventory/purchase-invoices/{id}", new
        {
            supplierId = supplier, invoiceDate = Iso(day), paymentMethod = "Credit",
            lines = new[] { new { rawMaterialId = material, enteredQuantity = 2, unitLabel = "kg", unitSize = 1000, cost = 60, itemType = "Inventory" } },
        }, Cancel));
        await Json(await manager.PostAsync($"/api/inventory/purchase-invoices/{id}/post", null, Cancel));
        return id;
    }

    [Fact]
    public async Task A_manager_closes_the_month_the_owner_opens_it_with_why_and_a_closed_months_records_are_answered_423_Locked()
    {
        await using var api = await TestApi.StartAsync();
        var manager = await api.ManagerAsync();
        var accountant = await api.AccountantAsync(manager);
        var today = await TodayAsync(manager);
        var monthEnd = new DateOnly(today.Year, today.Month, 1).AddDays(-1);
        var inIt = monthEnd.AddDays(-2);

        var nile = Guid.NewGuid();
        await Json(await manager.PutAsJsonAsync($"/api/inventory/suppliers/{nile}", new { name = "Nile Mills" }, Cancel));
        var flour = (await Json(await manager.PostAsJsonAsync("/api/inventory/raw-materials", new
        {
            name = "Flour", unit = "Gram", purchaseUnit = "kg", purchaseUnitSize = 1000,
        }, Cancel))).GetProperty("id").GetGuid();
        var invoice = await PostedInvoiceAsync(manager, nile, flour, inIt);

        // The status: a manager's; the month to close suggested.
        Assert.Equal(HttpStatusCode.Unauthorized, (await api.Anonymous().GetAsync("/api/settings/period-lock", Cancel)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await accountant.GetAsync("/api/settings/period-lock", Cancel)).StatusCode);
        var open = await Json(await manager.GetAsync("/api/settings/period-lock", Cancel));
        Assert.Equal((JsonValueKind.Null, Iso(monthEnd), 0), (open.GetProperty("lockedUntil").ValueKind, open.GetProperty("suggestedUntil").GetString(),
            open.GetProperty("history").GetArrayLength()));

        // Closed by a manager who types LOCK; not by an accountant.
        Assert.Equal(HttpStatusCode.Forbidden,
            (await accountant.PostAsJsonAsync("/api/settings/period-lock/lock", new { until = Iso(monthEnd), confirmation = "LOCK" }, Cancel)).StatusCode);
        var unconfirmed = await manager.PostAsJsonAsync("/api/settings/period-lock/lock", new { until = Iso(monthEnd), confirmation = "yes" }, Cancel);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, unconfirmed.StatusCode);
        var locked = await Json(await manager.PostAsJsonAsync("/api/settings/period-lock/lock", new { until = Iso(monthEnd), confirmation = "LOCK" }, Cancel));
        Assert.Equal(Iso(monthEnd), locked.GetProperty("lockedUntil").GetString());
        var entry = locked.GetProperty("history")[0];
        Assert.Equal("PeriodLocked", entry.GetProperty("action").GetString());
        Assert.StartsWith($"PeriodLocked: {monthEnd.ToString("dd-MMM-yyyy", CultureInfo.InvariantCulture)} by ", entry.GetProperty("description").GetString());
        Assert.Equal(1, await api.Db(db => db.SecurityAuditLogs.CountAsync(Cancel)));
        // Shown on Financials as well.
        Assert.Equal(Iso(monthEnd), (await Json(await manager.GetAsync("/api/financials/settings", Cancel))).GetProperty("booksLockedUntil").GetString());

        // Its invoice not voided, by a manager or asked by an accountant: 423, the lock's day and the day refused.
        var voided = await Locked(await manager.PostAsJsonAsync("/api/inventory/deletion-requests",
            new { requestId = Guid.NewGuid(), module = "PurchaseInvoice", recordId = invoice, reason = "Wrong supplier" }, Cancel));
        Assert.Equal((Iso(monthEnd), Iso(inIt)), (voided.GetProperty("lockedUntil").GetString(), voided.GetProperty("day").GetString()));
        var detail = voided.GetProperty("detail").GetString()!;
        Assert.StartsWith($"Cannot modify records before the locked period (Books closed until {monthEnd.ToString("d MMM yyyy", CultureInfo.InvariantCulture)})", detail);
        Assert.Contains("لا يمكن تعديل أو إضافة حركات في فترة محاسبية تم إقفالها", detail);
        Assert.Equal(detail, voided.GetProperty("errors")[0].GetString());
        await Locked(await accountant.PostAsJsonAsync("/api/inventory/deletion-requests",
            new { requestId = Guid.NewGuid(), module = "PurchaseInvoice", recordId = invoice, reason = "Wrong supplier" }, Cancel));
        Assert.Equal("Posted", (await Json(await manager.GetAsync($"/api/inventory/purchase-invoices/{invoice}", Cancel))).GetProperty("status").GetString());

        // A new invoice dated in it, its daily sales, its month's expenses and sales sheet: 423. This month's: kept.
        await Locked(await manager.PutAsJsonAsync($"/api/inventory/purchase-invoices/{Guid.NewGuid()}", new
        {
            supplierId = nile, invoiceDate = Iso(inIt), paymentMethod = "Credit",
            lines = new[] { new { rawMaterialId = flour, enteredQuantity = 1, unitLabel = "kg", unitSize = 1000, cost = 30, itemType = "Inventory" } },
        }, Cancel));
        await Locked(await manager.PostAsJsonAsync("/api/sales/daily", new { id = Guid.NewGuid(), date = Iso(inIt), lines = Array.Empty<object>() }, Cancel));
        await Locked(await manager.PutAsJsonAsync($"/api/costing/expenses/{monthEnd.Year}/{monthEnd.Month}", new { wagesAndBenefits = 1_000 }, Cancel));
        await Locked(await manager.PutAsJsonAsync($"/api/costing/manual-sales/{monthEnd.Year}/{monthEnd.Month}", new { lines = Array.Empty<object>() }, Cancel));
        await Json(await manager.PutAsJsonAsync($"/api/costing/expenses/{today.Year}/{today.Month}", new { wagesAndBenefits = 1_000 }, Cancel));

        // The POS's Z report of a day in it: 423 to the POS, logged as refused; nothing recorded.
        var key = (await Json(await manager.PostAsync("/api/settings/pos-integration/key", null, Cancel))).GetProperty("key").GetString()!;
        var pos = api.Anonymous();
        pos.DefaultRequestHeaders.Add("X-Api-Key", key);
        var takings = new { totalCash = 400m, totalCard = 100m, totalTax = 70m, voidsAmount = 0m, voidReasons = Array.Empty<object>() };
        var refused = await Locked(await pos.PostAsJsonAsync("/api/integrations/pos/z-report",
            new { zReportId = Guid.NewGuid(), date = Iso(inIt), shiftNumber = 1, takings, soldItems = Array.Empty<object>() }, Cancel));
        Assert.Equal(Iso(inIt), refused.GetProperty("day").GetString());
        var log = (await Json(await manager.GetAsync("/api/settings/pos-integration", Cancel))).GetProperty("logs")[0];
        Assert.Equal("Refused", log.GetProperty("outcome").GetString());
        Assert.Contains("Books closed until", log.GetProperty("message").GetString());
        Assert.False(await api.Db(db => db.PosZReports.AnyAsync(Cancel)));
        Assert.Equal("Recorded", (await Json(await pos.PostAsJsonAsync("/api/integrations/pos/z-report",
            new { zReportId = Guid.NewGuid(), date = Iso(today), shiftNumber = 1, takings, soldItems = Array.Empty<object>() }, Cancel))).GetProperty("outcome").GetString());

        // Opened again by the owner alone, and only with why; then the void goes through.
        var notTheOwner = await api.UserAsync(manager, "Karim", UserRole.Accountant);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await notTheOwner.PostAsJsonAsync("/api/settings/period-lock/unlock", new { until = Iso(inIt.AddDays(-1)), reason = "Auditor adjustment" }, Cancel)).StatusCode);
        Assert.Equal(HttpStatusCode.UnprocessableEntity,
            (await manager.PostAsJsonAsync("/api/settings/period-lock/unlock", new { until = Iso(inIt.AddDays(-1)), reason = " " }, Cancel)).StatusCode);
        var opened = await Json(await manager.PostAsJsonAsync("/api/settings/period-lock/unlock",
            new { until = Iso(inIt.AddDays(-1)), reason = "Auditor adjustment" }, Cancel));
        Assert.Equal(Iso(inIt.AddDays(-1)), opened.GetProperty("lockedUntil").GetString());
        var unlock = opened.GetProperty("history")[0];
        Assert.Equal(("PeriodUnlocked", "Auditor adjustment"), (unlock.GetProperty("action").GetString(), unlock.GetProperty("reason").GetString()));
        Assert.EndsWith(". Reason: Auditor adjustment", unlock.GetProperty("description").GetString());
        await Json(await manager.PostAsJsonAsync("/api/inventory/deletion-requests",
            new { requestId = Guid.NewGuid(), module = "PurchaseInvoice", recordId = invoice, reason = "Wrong supplier" }, Cancel));
        Assert.Equal("Voided", (await Json(await manager.GetAsync($"/api/inventory/purchase-invoices/{invoice}", Cancel))).GetProperty("status").GetString());
        Assert.Equal(2, (await Json(await manager.GetAsync("/api/settings/period-lock", Cancel))).GetProperty("history").GetArrayLength());
    }

    [Fact]
    public async Task With_the_books_closed_through_today_a_count_is_kept_as_a_draft_but_not_posted_nor_waste_logged()
    {
        await using var api = await TestApi.StartAsync();
        var manager = await api.ManagerAsync();
        var today = await TodayAsync(manager);
        var flour = (await Json(await manager.PostAsJsonAsync("/api/inventory/raw-materials", new
        {
            name = "Flour", unit = "Gram", purchaseUnit = "kg", purchaseUnitSize = 1000,
        }, Cancel))).GetProperty("id").GetGuid();
        var count = Guid.NewGuid();
        await Json(await manager.PutAsJsonAsync($"/api/inventory/stock-counts/{count}", new { lines = new[] { new { rawMaterialId = flour, countedQuantity = 500 } } }, Cancel));

        await Json(await manager.PostAsJsonAsync("/api/settings/period-lock/lock", new { until = Iso(today), confirmation = "LOCK" }, Cancel));

        await Json(await manager.PutAsJsonAsync($"/api/inventory/stock-counts/{count}", new { lines = new[] { new { rawMaterialId = flour, countedQuantity = 600 } } }, Cancel));
        var posted = await Locked(await manager.PostAsync($"/api/inventory/stock-counts/{count}/post", null, Cancel));
        Assert.Equal(Iso(today), posted.GetProperty("day").GetString());
        Assert.Equal("Draft", (await Json(await manager.GetAsync($"/api/inventory/stock-counts/{count}", Cancel))).GetProperty("status").GetString());
        await Locked(await manager.PostAsJsonAsync("/api/inventory/spoilage", new
        {
            spoilageId = Guid.NewGuid(), lines = new[] { new { rawMaterialId = flour, quantity = 100, reason = "Wet" } },
        }, Cancel));
        Assert.False(await api.Db(db => db.StockMovements.AnyAsync(Cancel)));
    }
}
