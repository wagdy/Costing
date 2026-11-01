using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using ClosedXML.Excel;

namespace Costing.Api.Tests;

// Company Settings through the API: read by anyone, changed by a manager; the logo; and what the
// rest of the system takes from them: money in its messages and sheets, the clock, the national
// IDs, and the portal's port reading them.
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
        workdayStartsAtHour = 4, weekends = new[] { "Friday", "Saturday" },
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
        Assert.Equal(["Friday"], first.GetProperty("weekends").EnumerateArray().Select(d => d.GetString()));

        Assert.Equal(HttpStatusCode.Unauthorized, (await anyone.PutAsJsonAsync("/api/settings", Riyadh(), Cancel)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await accountant.PutAsJsonAsync("/api/settings", Riyadh(), Cancel)).StatusCode);
        var refused = await manager.PutAsJsonAsync("/api/settings", new { name = "Acme", currencySymbol = "SAR", currencyPosition = "After", country = "SaudiArabia", timeZoneId = "Mars/Olympus", workdayStartsAtHour = 4, weekends = new[] { "Friday" } }, Cancel);
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
    public async Task The_system_follows_them_money_the_clock_and_national_ids()
    {
        await using var api = await TestApi.StartAsync();
        var manager = await api.ManagerAsync();
        var accountant = await api.AccountantAsync(manager);
        await Json(await manager.PutAsJsonAsync("/api/settings", Riyadh(), Cancel));

        // The workday as Riyadh's clock has it.
        var riyadh = TimeZoneInfo.FindSystemTimeZoneById("Asia/Riyadh");
        var today = DateOnly.Parse((await Json(await manager.GetAsync("/api/hr/today", Cancel))).GetProperty("today").GetString()!, CultureInfo.InvariantCulture);
        Assert.Equal(DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, riyadh).AddHours(-4)), today);

        // A Saudi ID, and money after the amount in what an accountant asks.
        object Employee(string nationalId) => new
        {
            requestId = Guid.NewGuid(), name = "Faisal", jobTitle = "Technician", monthlySalary = 6_000, shiftStartsAt = "09:00:00",
            daysOff = new[] { "Friday", "Saturday" }, hiredOn = "2026-09-01", nationalId,
        };
        var refused = await accountant.PutAsJsonAsync($"/api/hr/employees/{Guid.NewGuid()}", Employee("29001010123456"), Cancel);
        Assert.Contains("10 digits", await refused.Content.ReadAsStringAsync(Cancel));
        var asked = await Json(await accountant.PutAsJsonAsync($"/api/hr/employees/{Guid.NewGuid()}", Employee("1012345678"), Cancel));
        Assert.Equal("New employee · Faisal · Technician · 6,000.00 SAR a month, from 09:00", asked.GetProperty("request").GetProperty("summary").GetString());

        // The payroll sheet's amounts in the company's money, the cells still numbers.
        var faisal = Guid.NewGuid();
        await Json(await manager.PutAsJsonAsync($"/api/hr/employees/{faisal}", Employee("1098765432"), Cancel));
        var sheet = await manager.GetAsync($"/api/hr/payroll/export?month={today.Year:D4}-{today.Month:D2}-01", Cancel);
        using var workbook = new XLWorkbook(new MemoryStream(await sheet.Content.ReadAsByteArrayAsync(Cancel)));
        var baseSalary = workbook.Worksheet("Payroll").Cell(5, 7);
        Assert.Equal((6_000d, "6,000.00 SAR"), (baseSalary.GetDouble(), baseSalary.GetFormattedString()));
    }

    [Fact]
    public async Task The_portals_port_reads_them_and_never_changes_them()
    {
        await using var api = await TestApi.StartAsync(new Dictionary<string, string> { ["Portal:Port"] = "0" });
        var phone = api.Anonymous();

        Assert.Equal("My company", (await Json(await phone.GetAsync("/api/settings", Cancel))).GetProperty("name").GetString());
        Assert.Equal(HttpStatusCode.NotFound, (await phone.PutAsJsonAsync("/api/settings", Riyadh(), Cancel)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await phone.DeleteAsync("/api/settings/logo", Cancel)).StatusCode);
    }
}
