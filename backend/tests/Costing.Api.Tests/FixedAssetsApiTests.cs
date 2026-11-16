using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Costing.Domain.Access;

namespace Costing.Api.Tests;

// The fixed assets register through the API: an accountant's purchase waits for a manager, a
// manager's is made at once; the P&L's EBITDA and net profit; the register in Excel; who may do what.
public class FixedAssetsApiTests
{
    private static CancellationToken Cancel => TestContext.Current.CancellationToken;

    private static async Task<JsonElement> Json(HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, $"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync(Cancel)}");
        return await response.Content.ReadFromJsonAsync<JsonElement>(Cancel);
    }

    private static object Asset(Guid id, string name, decimal cost, int life, string paidFrom, DateOnly date, decimal salvage = 0) => new
    {
        requestId = Guid.NewGuid(), assetId = id, transactionId = Guid.NewGuid(), name, category = "KitchenEquipment", purchaseDate = date.ToString("yyyy-MM-dd"),
        purchaseCost = cost, usefulLifeMonths = life, salvageValue = salvage, location = "Kitchen", paidFrom,
    };

    [Fact]
    public async Task Assets_are_bought_by_the_books_the_manager_approves_and_the_pnl_takes_their_depreciation()
    {
        await using var api = await TestApi.StartAsync();
        var manager = await api.ManagerAsync();
        var accountant = await api.AccountantAsync(manager);
        var today = DateOnly.Parse((await Json(await manager.GetAsync("/api/financials/today", Cancel))).GetProperty("today").GetString()!, CultureInfo.InvariantCulture);

        await Json(await manager.PostAsJsonAsync("/api/financials/vouchers", new
        {
            requestId = Guid.NewGuid(), transactionId = Guid.NewGuid(), kind = "OpeningBalance", amount = 50_000, source = "CarriedOver",
        }, Cancel));

        // The accountant buys a fryer out of the safe: a request; approved, it is on the register.
        var fryer = Guid.NewGuid();
        var asked = await accountant.PostAsJsonAsync("/api/financials/fixed-assets", Asset(fryer, "Fryer", 24_000, 48, "Safe", today), Cancel);
        Assert.Equal(HttpStatusCode.Accepted, asked.StatusCode);
        var request = (await Json(asked)).GetProperty("request");
        Assert.Contains("Fixed asset bought (CAPEX) · Fryer", request.GetProperty("summary").GetString());
        await Json(await manager.PostAsync($"/api/inventory/approval-requests/{request.GetProperty("id").GetGuid()}/approve", null, Cancel));

        // The manager's by the bank, at once. An asset owned already, and a write-off, are a manager's alone.
        var made = await Json(await manager.PostAsJsonAsync("/api/financials/fixed-assets", Asset(Guid.NewGuid(), "Walk-in chiller", 60_000, 60, "Bank", today, 6_000), Cancel));
        Assert.Equal(("Applied", "FA-0002", "Bank"),
            (made.GetProperty("outcome").GetString(), made.GetProperty("assetCode").GetString(), made.GetProperty("transaction").GetProperty("fund").GetString()));
        Assert.Equal(HttpStatusCode.Forbidden,
            (await accountant.PostAsJsonAsync("/api/financials/fixed-assets", Asset(Guid.NewGuid(), "Mixer", 3_000, 36, "OwnedAlready", today), Cancel)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await accountant.PostAsJsonAsync($"/api/financials/fixed-assets/{fryer}/dispose", new
        {
            requestId = Guid.NewGuid(), transactionId = Guid.NewGuid(), date = today.ToString("yyyy-MM-dd"),
        }, Cancel)).StatusCode);
        var storekeeper = await api.UserAsync(manager, "Samir", UserRole.Storekeeper);
        Assert.Equal(HttpStatusCode.Forbidden, (await storekeeper.GetAsync("/api/financials/fixed-assets", Cancel)).StatusCode);

        // The register: 84,000 of cost, 500 + 900 of depreciation this month.
        var register = await Json(await accountant.GetAsync("/api/financials/fixed-assets", Cancel));
        Assert.Equal((84_000m, 1_400m, 82_600m, 2),
            (register.GetProperty("totalCost").GetDecimal(), register.GetProperty("depreciationThisMonth").GetDecimal(),
                register.GetProperty("netBookValue").GetDecimal(), register.GetProperty("activeCount").GetInt32()));
        Assert.Equal(("FA-0001", "Safe", "Active"),
            (register.GetProperty("assets")[0].GetProperty("assetCode").GetString(), register.GetProperty("assets")[0].GetProperty("paidFrom").GetString(),
                register.GetProperty("assets")[0].GetProperty("status").GetString()));
        var sheet = await accountant.GetAsync("/api/financials/fixed-assets/export", Cancel);
        Assert.Equal(HttpStatusCode.OK, sheet.StatusCode);
        Assert.Equal("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sheet.Content.Headers.ContentType!.MediaType);

        // The P&L: no revenue or wages yet, so EBITDA and the net profit wait for the wages; the depreciation is there.
        var pnl = await Json(await manager.GetAsync($"/api/costing/reports/pnl?year={today.Year}&month={today.Month}", Cancel));
        Assert.Equal((1_400m, JsonValueKind.Null), (pnl.GetProperty("depreciation").GetDecimal(), pnl.GetProperty("ebitda").ValueKind));
        await Json(await manager.PutAsJsonAsync($"/api/costing/expenses/{today.Year}/{today.Month}", new
        {
            wagesAndBenefits = 1_000, occupationCost = 500,
        }, Cancel));
        pnl = await Json(await manager.GetAsync($"/api/costing/reports/pnl?year={today.Year}&month={today.Month}", Cancel));
        Assert.Equal((-1_500m, -2_900m), (pnl.GetProperty("ebitda").GetDecimal(), pnl.GetProperty("netProfit").GetDecimal()));

        // The fryer sold today for 25,000 into the safe: a gain of 1,000, the safe 1,000 up on where it started.
        var soldFor = await Json(await manager.PostAsJsonAsync($"/api/financials/fixed-assets/{fryer}/dispose", new
        {
            requestId = Guid.NewGuid(), transactionId = Guid.NewGuid(), date = today.ToString("yyyy-MM-dd"), saleProceeds = 25_000, fund = "Safe",
        }, Cancel));
        Assert.Equal("Applied", soldFor.GetProperty("outcome").GetString());
        pnl = await Json(await manager.GetAsync($"/api/costing/reports/pnl?year={today.Year}&month={today.Month}", Cancel));
        Assert.Equal((900m, 1_000m, -1_400m),
            (pnl.GetProperty("depreciation").GetDecimal(), pnl.GetProperty("disposalGainOrLoss").GetDecimal(), pnl.GetProperty("netProfit").GetDecimal()));
        var safe = await Json(await manager.GetAsync($"/api/financials/safe?year={today.Year}&month={today.Month}", Cancel));
        Assert.Equal(51_000m, safe.GetProperty("balanceNow").GetDecimal());
    }
}
