using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Costing.Domain.Access;

namespace Costing.Api.Tests;

// The daily break-even through the API: today by default, another day when asked, never a day
// not begun; a report, so not a storekeeper's.
public class DailyBreakEvenApiTests
{
    private static CancellationToken Cancel => TestContext.Current.CancellationToken;

    private static async Task<JsonElement> Json(HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, $"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync(Cancel)}");
        return await response.Content.ReadFromJsonAsync<JsonElement>(Cancel);
    }

    [Fact]
    public async Task Today_s_break_even_answers_for_the_reports_and_another_day_when_asked()
    {
        await using var api = await TestApi.StartAsync();
        var manager = await api.ManagerAsync();
        var today = DateOnly.Parse((await Json(await manager.GetAsync("/api/financials/today", Cancel))).GetProperty("today").GetString()!, CultureInfo.InvariantCulture);
        await Json(await manager.PutAsJsonAsync($"/api/costing/expenses/{today.Year}/{today.Month}",
            new { wagesAndBenefits = 31_000, occupationCost = 31_000 }, Cancel));

        var now = await Json(await manager.GetAsync("/api/costing/reports/daily-break-even", Cancel));
        Assert.Equal((today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), true, 62_000m),
            (now.GetProperty("date").GetString(), now.GetProperty("isToday").GetBoolean(), now.GetProperty("monthlyFixedCosts").GetDecimal()));
        // Nothing sold today nor in the week before: no margin to work a target at; the day's fixed costs lost.
        Assert.Equal((JsonValueKind.Null, JsonValueKind.Null), (now.GetProperty("wacmPercent").ValueKind, now.GetProperty("breakEvenSales").ValueKind));
        Assert.Equal(-now.GetProperty("dailyFixedCosts").GetDecimal(), now.GetProperty("operatingResult").GetDecimal());

        var earlier = await Json(await manager.GetAsync($"/api/costing/reports/daily-break-even?date={today.AddDays(-1):yyyy-MM-dd}", Cancel));
        Assert.False(earlier.GetProperty("isToday").GetBoolean());
        // A day not begun is refused, as the app refuses what it cannot do.
        Assert.Equal(HttpStatusCode.UnprocessableEntity,
            (await manager.GetAsync($"/api/costing/reports/daily-break-even?date={today.AddDays(1):yyyy-MM-dd}", Cancel)).StatusCode);

        var storekeeper = await api.UserAsync(manager, "Samir", UserRole.Storekeeper);
        var accountant = await api.UserAsync(manager, "Mona", UserRole.Accountant);
        Assert.Equal(HttpStatusCode.Forbidden, (await storekeeper.GetAsync("/api/costing/reports/daily-break-even", Cancel)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await accountant.GetAsync("/api/costing/reports/daily-break-even", Cancel)).StatusCode);
    }
}
