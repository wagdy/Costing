using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace Costing.Api.Tests;

// The POS link over HTTP: a manager makes the key (shown once, kept as its hash); the POS calls with
// it in X-API-Key, a wrong one or none refused and logged; the menu read; a Z report sent here and
// as the POS's own day.closed event, the second the same report sent again.
public sealed class PosIntegrationApiTests
{
    private static CancellationToken Cancel => TestContext.Current.CancellationToken;

    private static async Task<JsonElement> Json(HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, $"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync(Cancel)}");
        return await response.Content.ReadFromJsonAsync<JsonElement>(Cancel);
    }

    [Fact]
    public async Task A_manager_makes_the_key_the_POS_calls_with_it_and_every_call_is_logged()
    {
        await using var api = await TestApi.StartAsync();
        var manager = await api.ManagerAsync();
        var accountant = await api.AccountantAsync(manager);
        var pos = api.Anonymous();

        Assert.Equal(HttpStatusCode.Forbidden, (await accountant.PostAsync("/api/settings/pos-integration/key", null, Cancel)).StatusCode);
        var none = await Json(await manager.GetAsync("/api/settings/pos-integration", Cancel));
        Assert.False(none.GetProperty("hasKey").GetBoolean());

        var made = await Json(await manager.PostAsync("/api/settings/pos-integration/key", null, Cancel));
        var key = made.GetProperty("key").GetString()!;
        Assert.StartsWith("cpk_", key);
        // Only the hash is kept.
        Assert.False(await api.Db(db => db.PosLinks.AnyAsync(l => l.KeyHash == key, Cancel)));

        // No key, a wrong key: refused.
        Assert.Equal(HttpStatusCode.Unauthorized, (await pos.GetAsync("/api/integrations/pos/ping", Cancel)).StatusCode);
        pos.DefaultRequestHeaders.Add("X-Api-Key", "cpk_not-it");
        Assert.Equal(HttpStatusCode.Unauthorized, (await pos.GetAsync("/api/integrations/pos/menu", Cancel)).StatusCode);
        pos.DefaultRequestHeaders.Remove("X-Api-Key");
        pos.DefaultRequestHeaders.Add("X-Api-Key", key);

        var ping = await Json(await pos.GetAsync("/api/integrations/pos/ping", Cancel));
        Assert.True(ping.GetProperty("ok").GetBoolean());
        var menu = await Json(await pos.GetAsync("/api/integrations/pos/menu", Cancel));
        Assert.Equal(JsonValueKind.Array, menu.GetProperty("items").ValueKind);

        // A Z report of a day with nothing sold but takings: recorded; then the POS's own envelope
        // for the same shift, read the same: nothing changes.
        var shift = Guid.NewGuid();
        var date = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-2)).ToString("yyyy-MM-dd");
        var report = new
        {
            zReportId = shift,
            date,
            shiftNumber = 1,
            takings = new { totalCash = 400m, totalCard = 100m, totalTax = 70m, voidsAmount = 0m, voidReasons = Array.Empty<object>() },
            soldItems = Array.Empty<object>(),
        };
        var recorded = await Json(await pos.PostAsJsonAsync("/api/integrations/pos/z-report", report, Cancel));
        Assert.Equal("Recorded", recorded.GetProperty("outcome").GetString());

        var envelope = new
        {
            id = Guid.NewGuid(),
            kind = "day.closed",
            branchCode = "BR-01",
            occurredAtUtc = DateTime.UtcNow,
            data = new
            {
                shiftId = shift,
                shiftNumber = 1,
                businessDate = date,
                soldItems = Array.Empty<object>(),
                waste = Array.Empty<object>(),
                takings = new { cash = 400m, card = 100m, tax = 70m, voidsBefore = new { count = 0, amount = 0m }, voidsAfter = new { count = 0, amount = 0m, reasons = Array.Empty<object>() } },
            },
        };
        var resent = await pos.PostAsJsonAsync("/api/integrations/pos/events", envelope, Cancel);
        // Read as the same report, the envelope's own fields aside: nothing changes.
        var resentBody = await Json(resent);
        Assert.Equal("Unchanged", resentBody.GetProperty("outcome").GetString());
        Assert.Equal(1, await api.Db(db => db.SafeTransactions.CountAsync(t => t.ReversalOf == null && t.VoidedAtUtc == null && t.RevenueDate != null, Cancel)));

        // An event Costing does not use: answered, left.
        Assert.Equal(HttpStatusCode.Accepted,
            (await pos.PostAsJsonAsync("/api/integrations/pos/events", new { id = Guid.NewGuid(), kind = "staff.meal", data = new { } }, Cancel)).StatusCode);

        // A report it cannot place: 422, nothing recorded.
        var refused = await pos.PostAsJsonAsync("/api/integrations/pos/z-report",
            new { zReportId = Guid.NewGuid(), date, takings = report.takings, soldItems = new[] { new { itemCode = 9999, quantitySold = 1 } } }, Cancel);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, refused.StatusCode);

        var logs = await Json(await manager.GetAsync("/api/settings/pos-integration", Cancel));
        Assert.True(logs.GetProperty("hasKey").GetBoolean());
        Assert.Equal(made.GetProperty("keyHint").GetString(), logs.GetProperty("keyHint").GetString());
        var outcomes = logs.GetProperty("logs").EnumerateArray().Select(l => l.GetProperty("outcome").GetString()).Reverse().ToList();
        Assert.Equal(["Unauthorized", "Unauthorized", "Served", "Served", "Recorded", "Unchanged", "Served", "Refused"], outcomes);
        Assert.DoesNotContain(logs.GetProperty("logs").EnumerateArray(), l => l.GetRawText().Contains(key));

        // A new key: the old one stops working.
        await Json(await manager.PostAsync("/api/settings/pos-integration/key", null, Cancel));
        Assert.Equal(HttpStatusCode.Unauthorized, (await pos.GetAsync("/api/integrations/pos/ping", Cancel)).StatusCode);
    }
}
