using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Costing.Domain.Company;
using Costing.Domain.Treasury;

namespace Costing.Api.Tests;

// Each branch closes its own day (تقفيل اليوم لكل فرع): the first branch and Tanta hand in the same
// days, each with its own takings and its own order; Tanta's undo is Tanta's alone; the books lock
// no later than the day both have closed up to; and each branch's till, with its own key, sends
// Z reports that become that branch's day.
public class BranchEndOfDayApiTests
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

    private static string Iso(DateOnly day) => day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    [Fact]
    public async Task Each_branch_closes_its_own_days_with_its_own_takings_and_its_own_till()
    {
        await using var api = await TestApi.StartAsync();
        var manager = await api.ManagerAsync();
        var today = DateOnly.Parse((await Json(await manager.GetAsync("/api/financials/today", Cancel))).GetProperty("today").GetString()!,
            CultureInfo.InvariantCulture);
        var (d2, d1) = (today.AddDays(-2), today.AddDays(-1));
        await Json(await manager.PutAsJsonAsync("/api/settings/company-structure/mode", new { mode = "MultiBranch_Independent" }, Cancel));
        var (first, tanta) = (Branch.DefaultId, Guid.NewGuid());
        await Json(await manager.PutAsJsonAsync($"/api/settings/branches/{tanta}", new { name = "Tanta", nameAr = "طنطا", type = "Restaurant" }, Cancel));

        async Task CloseAsync(Guid branch, DateOnly day, decimal cash)
        {
            await Json(await In(manager, branch, HttpMethod.Put, $"/api/end-of-day/{Iso(day)}/sales", new { cashAmount = cash }));
            await Json(await In(manager, branch, HttpMethod.Post, $"/api/end-of-day/{Iso(day)}/submit"));
            // Its takings into the safe, from Financials: the branch's day's.
            await Json(await In(manager, branch, HttpMethod.Post, "/api/financials/vouchers", new
            {
                requestId = Guid.NewGuid(), transactionId = Guid.NewGuid(), kind = "RevenueTransfer", amount = cash, revenueDate = Iso(day),
            }));
        }

        // The same two days in the first branch; the first of them in Tanta, as its own.
        await CloseAsync(first, d2, 400);
        await CloseAsync(first, d1, 450);
        await CloseAsync(tanta, d2, 700);
        var tantas = await Json(await In(manager, tanta, HttpMethod.Get, "/api/end-of-day/sequence"));
        Assert.Equal((Iso(d2), Iso(d1), "Tanta"), (tantas.GetProperty("lastClosedDate").GetString(), tantas.GetProperty("nextExpectedDate").GetString(),
            tantas.GetProperty("branch").GetString()));
        Assert.Equal(Iso(d1), (await Json(await In(manager, first, HttpMethod.Get, "/api/end-of-day/sequence"))).GetProperty("lastClosedDate").GetString());
        // Each branch in its own order: Tanta's next is d1, not today.
        Assert.Equal(HttpStatusCode.UnprocessableEntity,
            (await In(manager, tanta, HttpMethod.Put, $"/api/end-of-day/{Iso(today)}/sales", new { cashAmount = 1 })).StatusCode);
        async Task<List<(Guid Branch, DateOnly? Day, decimal Amount)>> TakingsAsync() =>
            (await api.Db(db => db.SafeTransactions
                .Where(t => t.Kind == SafeTransactionKind.RevenueTransfer && t.ReversalOf == null && t.VoidedAtUtc == null)
                .Select(t => new { t.BranchId, t.RevenueDate, t.Amount }).ToListAsync(Cancel)))
            .Select(t => (t.BranchId, t.RevenueDate, t.Amount)).OrderBy(t => t.RevenueDate).ThenBy(t => t.Amount).ToList();
        Assert.Equal([(first, d2, 400m), (tanta, d2, 700m), (first, d1, 450m)], await TakingsAsync());

        // A second takings of d2 in Tanta is refused: one a day in each branch.
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await In(manager, tanta, HttpMethod.Post, "/api/financials/vouchers", new
        {
            requestId = Guid.NewGuid(), transactionId = Guid.NewGuid(), kind = "RevenueTransfer", amount = 5, revenueDate = Iso(d2),
        })).StatusCode);

        // The books lock no later than the day both have closed up to.
        var lockState = await Json(await manager.GetAsync("/api/settings/period-lock", Cancel));
        Assert.Equal(Iso(d2), lockState.GetProperty("lastClosedDay").GetString());
        Assert.Equal(HttpStatusCode.UnprocessableEntity,
            (await manager.PostAsJsonAsync("/api/settings/period-lock/lock", new { until = Iso(d1), confirmation = "LOCK" }, Cancel)).StatusCode);

        // Tanta's undo takes Tanta's day back alone.
        await Json(await In(manager, tanta, HttpMethod.Post, "/api/end-of-day/void-last", new { reason = "Wrong cash count" }));
        Assert.Equal([(first, d2, 400m), (first, d1, 450m)], await TakingsAsync());
        Assert.Equal(Iso(d1), (await Json(await In(manager, first, HttpMethod.Get, "/api/end-of-day/sequence"))).GetProperty("lastClosedDate").GetString());

        // Each branch's till its own key; what it sends is its branch's day.
        var tantaKey = (await Json(await In(manager, tanta, HttpMethod.Post, "/api/settings/pos-integration/key"))).GetProperty("key").GetString()!;
        var firstKey = (await Json(await In(manager, first, HttpMethod.Post, "/api/settings/pos-integration/key"))).GetProperty("key").GetString()!;
        Assert.NotEqual(tantaKey, firstKey);
        Task<HttpResponseMessage> SendAsync(string key, Guid shift, decimal cash)
        {
            var till = api.Anonymous();
            till.DefaultRequestHeaders.Add("X-Api-Key", key);
            return till.PostAsJsonAsync("/api/integrations/pos/z-report", new
            {
                zReportId = shift, date = Iso(today), shiftNumber = 1,
                takings = new { totalCash = cash, totalCard = 0m, totalTax = 0m, voidsAmount = 0m, voidReasons = Array.Empty<object>() },
                soldItems = Array.Empty<object>(),
            }, Cancel);
        }
        var tantaShift = Guid.NewGuid();
        Assert.Equal("Recorded", (await Json(await SendAsync(tantaKey, tantaShift, 900))).GetProperty("outcome").GetString());
        Assert.Equal("Recorded", (await Json(await SendAsync(firstKey, Guid.NewGuid(), 300))).GetProperty("outcome").GetString());
        Assert.Equal([(first, (DateOnly?)today, 300m), (tanta, (DateOnly?)today, 900m)], (await TakingsAsync()).Where(t => t.Day == today).ToList());
        Assert.Equal([first, tanta],
            await api.Db(db => db.PosDays.Where(d => d.Date == today).OrderBy(d => d.BranchId == tanta).Select(d => d.BranchId).ToListAsync(Cancel)));
        // Tanta's report is not the first branch's till's to change.
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await SendAsync(firstKey, tantaShift, 1)).StatusCode);

        // Each branch's page names whose till the key is, and shows its own till's calls.
        var tantaPage = await Json(await In(manager, tanta, HttpMethod.Get, "/api/settings/pos-integration"));
        Assert.Equal(("Tanta", 1), (tantaPage.GetProperty("branch").GetString(), tantaPage.GetProperty("logs").GetArrayLength()));
        Assert.Equal(2, (await Json(await In(manager, first, HttpMethod.Get, "/api/settings/pos-integration"))).GetProperty("logs").GetArrayLength());
    }
}
