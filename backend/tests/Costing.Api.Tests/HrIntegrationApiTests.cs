using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Costing.Api.Tests;

// The HR link over HTTP, both ways, against a stand-in for HR on a port of its own: linked from
// Settings, tested, HR's employees read; an advance from the end of the day sent to HR with its
// receipt; a payroll run HR sends taken with this system's key, paid out of the safe, and HR told.
public sealed class HrIntegrationApiTests
{
    private const string HrKey = "hrk_test-key-0123456789abcdef";

    private static CancellationToken Cancel => TestContext.Current.CancellationToken;

    private static async Task<JsonElement> Json(HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, $"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync(Cancel)}");
        return await response.Content.ReadFromJsonAsync<JsonElement>(Cancel);
    }

    // HR, as far as this system calls it: its key checked, two employees, and what is sent kept.
    private sealed class FakeHr : IAsyncDisposable
    {
        public readonly ConcurrentQueue<(string Kind, JsonElement Body, string? Idempotency)> Received = new();
        public readonly Guid Mona = Guid.NewGuid();
        private WebApplication _app = null!;

        public string Url { get; private set; } = string.Empty;

        public static async Task<FakeHr> StartAsync()
        {
            var hr = new FakeHr();
            var builder = WebApplication.CreateSlimBuilder();
            builder.WebHost.UseUrls("http://127.0.0.1:0");
            builder.Logging.ClearProviders();
            var app = builder.Build();
            bool Keyed(HttpContext http) => http.Request.Headers["X-API-Key"] == HrKey;
            app.MapGet("/api/integrations/costing/ping", (HttpContext http) =>
                Keyed(http) ? Results.Ok(new { ok = true, system = "HR & Payroll", company = "Otantik" }) : Results.Unauthorized());
            app.MapGet("/api/integrations/hr/employees", (HttpContext http) => Keyed(http)
                ? Results.Ok(new[]
                {
                    new { employeeId = hr.Mona, code = "17", fullName = "Mona Adel", department = "Hall", branch = (string?)null, isActive = true },
                    new { employeeId = Guid.NewGuid(), code = "21", fullName = "Ali Samir", department = "Kitchen", branch = (string?)null, isActive = true },
                })
                : Results.Unauthorized());
            app.MapPost("/api/integrations/costing/{kind}", async (string kind, HttpContext http) =>
            {
                if (!Keyed(http))
                    return Results.Unauthorized();
                var body = await JsonSerializer.DeserializeAsync<JsonElement>(http.Request.Body);
                hr.Received.Enqueue((kind, body, http.Request.Headers["Idempotency-Key"].ToString()));
                return Results.Ok(new { ok = true });
            });
            await app.StartAsync();
            hr._app = app;
            hr.Url = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.First();
            return hr;
        }

        public async ValueTask DisposeAsync() => await _app.DisposeAsync();
    }

    // What was sent to HR of a kind, once the link has sent it (now, or on its own clock).
    private static async Task<(string Kind, JsonElement Body, string? Idempotency)> SentAsync(FakeHr hr, HttpClient manager, string kind)
    {
        for (var i = 0; i < 40; i++)
        {
            if (hr.Received.FirstOrDefault(r => r.Kind == kind) is { Kind: not null } found)
                return found;
            await manager.PostAsync("/api/settings/hr-integration/outbox/send", null, Cancel);
            await Task.Delay(250, Cancel);
        }
        throw new Xunit.Sdk.XunitException($"Nothing of {kind} reached HR.");
    }

    [Fact]
    public async Task Linked_HRs_staff_are_read_an_advance_goes_to_HR_with_its_receipt_and_HRs_payroll_is_paid_and_HR_told()
    {
        await using var hr = await FakeHr.StartAsync();
        await using var api = await TestApi.StartAsync();
        var manager = await api.ManagerAsync();

        // Off: the staff are kept here, and HR is not heard.
        Assert.False((await Json(await manager.GetAsync("/api/staff/hr-status", Cancel))).GetProperty("linked").GetBoolean());
        var key = (await Json(await manager.PostAsync("/api/settings/hr-integration/key", null, Cancel))).GetProperty("key").GetString()!;
        var fromHr = api.Anonymous();
        fromHr.DefaultRequestHeaders.Add("X-API-Key", key);
        Assert.Equal(HttpStatusCode.Unauthorized, (await fromHr.GetAsync("/api/integrations/hr/ping", Cancel)).StatusCode);

        // Linked: tested, and HR's employees read and kept here.
        var saved = await Json(await manager.PutAsJsonAsync("/api/settings/hr-integration", new { enabled = true, baseUrl = hr.Url, hrKey = HrKey }, Cancel));
        Assert.Equal((true, "••••cdef"), (saved.GetProperty("enabled").GetBoolean(), saved.GetProperty("hrKeyHint").GetString()));
        Assert.DoesNotContain(HrKey, saved.GetRawText());
        Assert.True((await Json(await manager.PostAsync("/api/settings/hr-integration/test", null, Cancel))).GetProperty("ok").GetBoolean());
        Assert.Equal(2, (await Json(await manager.PostAsync("/api/settings/hr-integration/sync-employees", null, Cancel))).GetProperty("added").GetInt32());
        var staff = (await Json(await manager.GetAsync("/api/staff", Cancel))).EnumerateArray().ToList();
        var mona = staff.Single(s => s.GetProperty("name").GetString() == "Mona Adel");
        Assert.Equal(("17", "Hall"), (mona.GetProperty("code").GetString(), mona.GetProperty("department").GetString()));
        Assert.True((await Json(await fromHr.GetAsync("/api/integrations/hr/ping", Cancel))).GetProperty("ok").GetBoolean());

        // An advance from the end of the day, with its signed receipt: sent to HR, receipt and all.
        var today = (await Json(await manager.GetAsync("/api/financials/today", Cancel))).GetProperty("today").GetString()!;
        byte[] jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, 0x4A, 0x46, 0x49, 0x46];
        var receipt = new ByteArrayContent(jpeg);
        receipt.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg");
        var advance = Guid.NewGuid();
        await Json(await manager.PostAsync($"/api/end-of-day/{today}/advances", new MultipartFormDataContent
        {
            { new StringContent(advance.ToString()), "id" }, { new StringContent(mona.GetProperty("id").GetString()!), "employeeId" },
            { new StringContent("250"), "amount" }, { receipt, "file", "signed.jpg" },
        }, Cancel));
        await Json(await manager.PutAsJsonAsync($"/api/end-of-day/{today}/sales", new { cashAmount = 1_000, cardAmount = 0, taxAmount = 140, voidsAmount = 0 }, Cancel));
        await Json(await manager.PostAsync($"/api/end-of-day/{today}/submit", null, Cancel));
        var sent = await SentAsync(hr, manager, "employee-advance");
        Assert.Equal(advance.ToString(), sent.Idempotency);
        Assert.Equal((hr.Mona, 250m, "create"), (sent.Body.GetProperty("employeeId").GetGuid(), sent.Body.GetProperty("amount").GetDecimal(),
            sent.Body.GetProperty("action").GetString()));
        Assert.Equal(Convert.ToBase64String(jpeg), sent.Body.GetProperty("receipt").GetProperty("contentBase64").GetString());

        // HR's payroll for last month, sent with this system's key: kept once, paid out of the safe.
        var run = Guid.NewGuid();
        var period = DateOnly.Parse(today).AddMonths(-1).ToString("yyyy-MM");
        var payroll = new
        {
            idempotencyKey = run, payrollPeriod = period, employees = 2, totalGrossWages = 16_000, totalAdditions = 600, totalAdvancesDeducted = 1_000,
            totalPenalties = 400, netCashPayable = 15_200,
            departments = new[] { new { department = "Hall", employees = 1, grossWages = 8_000, additions = 300, penalties = 200, advancesDeducted = 500, netCashPayable = 7_600 } },
        };
        Assert.Equal("Recorded", (await Json(await fromHr.PostAsJsonAsync("/api/integrations/hr/payroll-run", payroll, Cancel))).GetProperty("outcome").GetString());
        Assert.Equal("Unchanged", (await Json(await fromHr.PostAsJsonAsync("/api/integrations/hr/payroll-run", payroll, Cancel))).GetProperty("outcome").GetString());
        var runs = (await Json(await manager.GetAsync("/api/financials/payroll-runs", Cancel))).EnumerateArray().ToList();
        Assert.Equal((16_200m, 15_200m, "Payable"), (runs.Single().GetProperty("laborCost").GetDecimal(), runs.Single().GetProperty("netCashPayable").GetDecimal(),
            runs.Single().GetProperty("status").GetString()));

        var paid = await Json(await manager.PostAsJsonAsync($"/api/financials/payroll-runs/{run}/disburse", new { transactionId = Guid.NewGuid(), requestId = Guid.NewGuid() }, Cancel));
        Assert.Equal(-15_200m, paid.GetProperty("transaction").GetProperty("amount").GetDecimal());
        var settled = await SentAsync(hr, manager, "payroll-settled");
        Assert.Equal((run.ToString(), period), (settled.Idempotency, settled.Body.GetProperty("payrollPeriod").GetString()));

        // The sync log says each call, either way.
        var settings = await Json(await manager.GetAsync("/api/settings/hr-integration", Cancel));
        var calls = settings.GetProperty("logs").EnumerateArray().Select(l => (l.GetProperty("call").GetString(), l.GetProperty("outcome").GetString())).ToList();
        Assert.Contains(("payroll-run", "Recorded"), calls);
        Assert.Contains(("employee-advance", "Sent"), calls);
        Assert.Contains(("ping", "Unauthorized"), calls);
        Assert.Equal(0, settings.GetProperty("pending").GetInt32());
    }
}
