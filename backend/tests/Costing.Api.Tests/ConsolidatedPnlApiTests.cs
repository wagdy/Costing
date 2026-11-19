using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Costing.Domain.Company;

namespace Costing.Api.Tests;

// The P&L by branch and for the company as a whole, through the API: a manager reads the company's,
// consolidated, with its table by branch, or any branch's, and enters a branch's costs on its own;
// a cost controller kept to Tanta reads and enters Tanta's alone.
public class ConsolidatedPnlApiTests
{
    private static CancellationToken Cancel => TestContext.Current.CancellationToken;

    private static async Task<JsonElement> Json(HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, $"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync(Cancel)}");
        return await response.Content.ReadFromJsonAsync<JsonElement>(Cancel);
    }

    private static object Wages(decimal wages) => new { wagesAndBenefits = wages };

    [Fact]
    public async Task A_manager_reads_the_company_or_any_branch_and_a_branchs_user_reads_their_own()
    {
        await using var api = await TestApi.StartAsync();
        var manager = await api.ManagerAsync();
        var today = DateOnly.Parse((await Json(await manager.GetAsync("/api/financials/today", Cancel))).GetProperty("today").GetString()!,
            System.Globalization.CultureInfo.InvariantCulture);
        var (year, month) = (today.Year, today.Month);
        string Kpis(Guid? branch = null) => $"/api/costing/kpis?year={year}&month={month}" + (branch is { } b ? $"&branchId={b}" : string.Empty);
        string Expenses(Guid? branch = null) => $"/api/costing/expenses/{year}/{month}" + (branch is { } b ? $"?branchId={b}" : string.Empty);

        // One branch: the company's, with nothing to choose.
        var single = await Json(await manager.GetAsync(Kpis(), Cancel));
        Assert.Equal(("Company", false), (single.GetProperty("scope").GetProperty("view").GetString(),
            single.GetProperty("scope").GetProperty("canChoose").GetBoolean()));
        Assert.Equal(JsonValueKind.Null, single.GetProperty("columns").ValueKind);

        await Json(await manager.PutAsJsonAsync("/api/settings/company-structure/mode", new { mode = "MultiBranch_Independent" }, Cancel));
        var tanta = Guid.NewGuid();
        await Json(await manager.PutAsJsonAsync($"/api/settings/branches/{tanta}", new { name = "Tanta", type = "Restaurant" }, Cancel));

        // The company's as a whole: its branches, its own costs, the eliminations and the whole.
        var whole = await Json(await manager.GetAsync(Kpis(), Cancel));
        Assert.Equal(("Consolidated", true, 2), (whole.GetProperty("scope").GetProperty("view").GetString(),
            whole.GetProperty("scope").GetProperty("canChoose").GetBoolean(), whole.GetProperty("scope").GetProperty("branches").GetArrayLength()));
        Assert.Equal(["Branch", "Branch", "CompanyCosts", "Eliminations", "Consolidated"],
            whole.GetProperty("columns").EnumerateArray().Select(c => c.GetProperty("kind").GetString()));

        // A branch's costs are entered on its own P&L, never the company's; the company's adds them up.
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await manager.PutAsJsonAsync(Expenses(), Wages(100), Cancel)).StatusCode);
        await Json(await manager.PutAsJsonAsync(Expenses(tanta), Wages(250), Cancel));
        await Json(await manager.PutAsJsonAsync(Expenses(Branch.DefaultId), Wages(100), Cancel));
        var tantas = await Json(await manager.GetAsync(Kpis(tanta), Cancel));
        Assert.Equal(("Branch", "Tanta", 250m), (tantas.GetProperty("scope").GetProperty("view").GetString(),
            tantas.GetProperty("scope").GetProperty("branch").GetString(), tantas.GetProperty("expenses").GetProperty("wagesAndBenefits").GetDecimal()));
        Assert.Equal(350m, (await Json(await manager.GetAsync(Kpis(), Cancel))).GetProperty("expenses").GetProperty("wagesAndBenefits").GetDecimal());
        Assert.Equal("Branch", (await Json(await manager.GetAsync($"/api/costing/reports/pnl?year={year}&month={month}&branchId={tanta}", Cancel)))
            .GetProperty("scope").GetProperty("view").GetString());
        Assert.Equal(HttpStatusCode.NotFound, (await manager.GetAsync(Kpis(Guid.NewGuid()), Cancel)).StatusCode);

        // Rania, kept to Tanta: Tanta's P&L whatever she asks for but another branch's, which is refused.
        await Json(await manager.PostAsJsonAsync("/api/users", new
        {
            email = "rania@example.com", fullName = "Rania", role = "CostController", password = "Rania-password", branchId = tanta,
        }, Cancel));
        var rania = await api.SignInAsync("rania@example.com", "Rania-password");
        var hers = await Json(await rania.GetAsync(Kpis(), Cancel));
        Assert.Equal(("Branch", "Tanta", false), (hers.GetProperty("scope").GetProperty("view").GetString(),
            hers.GetProperty("scope").GetProperty("branch").GetString(), hers.GetProperty("scope").GetProperty("canChoose").GetBoolean()));
        Assert.Equal(HttpStatusCode.Forbidden, (await rania.GetAsync(Kpis(Branch.DefaultId), Cancel)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await rania.PutAsJsonAsync(Expenses(Branch.DefaultId), Wages(1), Cancel)).StatusCode);
        await Json(await rania.PutAsJsonAsync(Expenses(), Wages(300), Cancel));
        Assert.Equal(300m, (await Json(await manager.GetAsync(Kpis(tanta), Cancel))).GetProperty("expenses").GetProperty("wagesAndBenefits").GetDecimal());
        Assert.Equal(100m, (await Json(await manager.GetAsync(Kpis(Branch.DefaultId), Cancel))).GetProperty("expenses").GetProperty("wagesAndBenefits").GetDecimal());
    }
}
