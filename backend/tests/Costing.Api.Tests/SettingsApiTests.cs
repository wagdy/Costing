using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using ClosedXML.Excel;

namespace Costing.Api.Tests;

// Company Settings through the API: read by anyone, changed by a manager; the logo; and the money
// in the system's own messages following them.
public class SettingsApiTests
{
    private static CancellationToken Cancel => TestContext.Current.CancellationToken;

    private static async Task<JsonElement> Json(HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, $"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync(Cancel)}");
        return await response.Content.ReadFromJsonAsync<JsonElement>(Cancel);
    }

    private static object Riyadh(string currency = "SAR", string position = "After") => new
    {
        name = "Acme KSA", currencySymbol = currency, currencyPosition = position, country = "SaudiArabia", timeZoneId = "Asia/Riyadh",
        workdayStartsAtHour = 4,
    };

    private static MultipartFormDataContent Upload(byte[] content, string type, string name)
    {
        var file = new ByteArrayContent(content);
        file.Headers.ContentType = new MediaTypeHeaderValue(type);
        return new MultipartFormDataContent { { file, "file", name } };
    }

    [Fact]
    public async Task Anyone_reads_them_a_manager_alone_changes_them_and_the_first_were_the_configurations()
    {
        await using var api = await TestApi.StartAsync();
        var anyone = api.Anonymous();
        var manager = await api.ManagerAsync();
        var accountant = await api.AccountantAsync(manager);

        var first = await Json(await anyone.GetAsync("/api/settings", Cancel));
        Assert.Equal(("My company", "L.E", "Before", "Egypt", "Africa/Cairo", 4, false),
            (first.GetProperty("name").GetString(), first.GetProperty("currencySymbol").GetString(), first.GetProperty("currencyPosition").GetString(),
                first.GetProperty("country").GetString(), first.GetProperty("timeZoneId").GetString(), first.GetProperty("workdayStartsAtHour").GetInt32(),
                first.GetProperty("hasLogo").GetBoolean()));

        Assert.Equal(HttpStatusCode.Unauthorized, (await anyone.PutAsJsonAsync("/api/settings", Riyadh(), Cancel)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await accountant.PutAsJsonAsync("/api/settings", Riyadh(), Cancel)).StatusCode);
        var refused = await manager.PutAsJsonAsync("/api/settings", new { name = "Acme", currencySymbol = "SAR", currencyPosition = "After", country = "SaudiArabia", timeZoneId = "Mars/Olympus", workdayStartsAtHour = 4 }, Cancel);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, refused.StatusCode);
        Assert.Contains("not a time zone", await refused.Content.ReadAsStringAsync(Cancel));

        var saved = await Json(await manager.PutAsJsonAsync("/api/settings", Riyadh(), Cancel));
        Assert.Equal(("Acme KSA", "SAR", "After", "SaudiArabia", "Asia/Riyadh"),
            (saved.GetProperty("name").GetString(), saved.GetProperty("currencySymbol").GetString(), saved.GetProperty("currencyPosition").GetString(),
                saved.GetProperty("country").GetString(), saved.GetProperty("timeZoneId").GetString()));
        Assert.Equal("Acme KSA", (await Json(await anyone.GetAsync("/api/settings", Cancel))).GetProperty("name").GetString());
        // In the users' permissions: a manager's to change.
        Assert.Contains("settings.manage", (await Json(await manager.GetAsync("/api/auth/me", Cancel))).GetProperty("permissions").EnumerateArray().Select(p => p.GetString()));
    }

    [Fact]
    public async Task The_logo_is_a_managers_picture_shown_to_anyone()
    {
        await using var api = await TestApi.StartAsync();
        var anyone = api.Anonymous();
        var manager = await api.ManagerAsync();
        byte[] png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13];

        Assert.Equal(HttpStatusCode.NotFound, (await anyone.GetAsync("/api/settings/logo", Cancel)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anyone.PutAsync("/api/settings/logo", Upload(png, "image/png", "logo.png"), Cancel)).StatusCode);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await manager.PutAsync("/api/settings/logo", Upload("<svg/>"u8.ToArray(), "image/svg+xml", "logo.svg"), Cancel)).StatusCode);

        var saved = await Json(await manager.PutAsync("/api/settings/logo", Upload(png, "image/png", "logo.png"), Cancel));
        Assert.True(saved.GetProperty("hasLogo").GetBoolean());
        var shown = await anyone.GetAsync($"/api/settings/logo?v={saved.GetProperty("logoVersion").GetInt64()}", Cancel);
        Assert.Equal(("image/png", "nosniff"), (shown.Content.Headers.ContentType!.MediaType, shown.Headers.GetValues("X-Content-Type-Options").Single()));
        Assert.Equal(png, await shown.Content.ReadAsByteArrayAsync(Cancel));

        Assert.False((await Json(await manager.DeleteAsync("/api/settings/logo", Cancel))).GetProperty("hasLogo").GetBoolean());
        Assert.Equal(HttpStatusCode.NotFound, (await anyone.GetAsync("/api/settings/logo", Cancel)).StatusCode);
    }

    [Fact]
    public async Task The_systems_messages_write_amounts_in_the_currency_saved()
    {
        await using var api = await TestApi.StartAsync();
        var manager = await api.ManagerAsync();
        var accountant = await api.AccountantAsync(manager);
        await Json(await manager.PutAsJsonAsync("/api/settings", Riyadh(), Cancel));
        var today = DateOnly.Parse((await Json(await manager.GetAsync("/api/financials/today", Cancel))).GetProperty("today").GetString()!, CultureInfo.InvariantCulture);

        // An accountant's opening balance waits for a manager, its summary in riyals.
        var asked = await Json(await accountant.PostAsJsonAsync("/api/financials/vouchers", new
        {
            requestId = Guid.NewGuid(), transactionId = Guid.NewGuid(), kind = "OpeningBalance", amount = 1_250, date = today.ToString("yyyy-MM-dd"),
            source = "CarriedOver",
        }, Cancel));
        Assert.Equal("Requested", asked.GetProperty("outcome").GetString());
        Assert.Contains("1,250.00 SAR", asked.GetProperty("request").GetProperty("summary").GetString());
    }
}
