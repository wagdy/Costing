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
                first.GetProperty("hasCustomLogo").GetBoolean()));

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

        Assert.Equal(HttpStatusCode.NotFound, (await anyone.GetAsync("/api/company-settings/logo", Cancel)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anyone.PutAsync("/api/company-settings/logo", Upload(png, "image/png", "logo.png"), Cancel)).StatusCode);
        // Not the picture it says it is.
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await manager.PutAsync("/api/company-settings/logo", Upload("GIF89a"u8.ToArray(), "image/png", "logo.png"), Cancel)).StatusCode);

        var saved = await Json(await manager.PutAsync("/api/company-settings/logo", Upload(png, "image/png", "logo.png"), Cancel));
        var version = saved.GetProperty("logoVersion").GetInt64();
        Assert.Equal((true, $"/api/company-settings/logo?v={version}"), (saved.GetProperty("hasCustomLogo").GetBoolean(), saved.GetProperty("logoUrl").GetString()));
        var shown = await anyone.GetAsync(saved.GetProperty("logoUrl").GetString(), Cancel);
        Assert.Equal(("image/png", "nosniff"), (shown.Content.Headers.ContentType!.MediaType, shown.Headers.GetValues("X-Content-Type-Options").Single()));
        Assert.Equal(png, await shown.Content.ReadAsByteArrayAsync(Cancel));
        // By its version, kept a year; and sandboxed, whatever it is.
        Assert.True(shown.Headers.CacheControl!.Public && shown.Headers.CacheControl.MaxAge == TimeSpan.FromDays(365));
        Assert.Contains("sandbox", shown.Headers.GetValues("Content-Security-Policy").Single());
        // Without it, checked by its tag: unchanged, 304. At the old address too.
        var unversioned = await anyone.GetAsync("/api/settings/logo", Cancel);
        Assert.True(unversioned.Headers.CacheControl!.NoCache);
        var check = new HttpRequestMessage(HttpMethod.Get, "/api/company-settings/logo");
        check.Headers.IfNoneMatch.Add(unversioned.Headers.ETag!);
        Assert.Equal(HttpStatusCode.NotModified, (await anyone.SendAsync(check, Cancel)).StatusCode);

        Assert.False((await Json(await manager.DeleteAsync("/api/company-settings/logo", Cancel))).GetProperty("hasCustomLogo").GetBoolean());
        Assert.Equal(HttpStatusCode.NotFound, (await anyone.GetAsync("/api/company-settings/logo", Cancel)).StatusCode);
        Assert.Equal(JsonValueKind.Null, (await Json(await anyone.GetAsync("/api/company-settings", Cancel))).GetProperty("logoUrl").ValueKind);
    }

    // An SVG drawing and an ICO icon are taken for what their bytes are, whatever the browser called
    // them; an SVG with script, an event handler, a link out or a DTD is refused.
    [Fact]
    public async Task A_logo_may_be_a_drawing_or_an_icon_but_never_a_script()
    {
        await using var api = await TestApi.StartAsync();
        var anyone = api.Anonymous();
        var manager = await api.ManagerAsync();
        async Task<HttpResponseMessage> Put(string svg, string name = "logo.svg") =>
            await manager.PutAsync("/api/company-settings/logo", Upload(System.Text.Encoding.UTF8.GetBytes(svg), "image/svg+xml", name), Cancel);

        var drawing = """<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g"><stop offset="0" stop-color="#10b981"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#g)"/><use href="#g"/></svg>""";
        var saved = await Json(await Put(drawing));
        var shown = await anyone.GetAsync(saved.GetProperty("logoUrl").GetString(), Cancel);
        Assert.Equal("image/svg+xml", shown.Content.Headers.ContentType!.MediaType);

        foreach (var unsafeSvg in new[]
                 {
                     """<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>""",
                     """<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect/></svg>""",
                     """<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="https://example.com/x.png"/></svg>""",
                     """<svg xmlns="http://www.w3.org/2000/svg"><a href="java&#x0A;script:alert(1)"><rect/></a></svg>""",
                     """<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">hi</div></foreignObject></svg>""",
                     """<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>""",
                     """<?xml-stylesheet href="https://example.com/a.css"?><svg xmlns="http://www.w3.org/2000/svg"/>""",
                     """<html><svg/></html>""",
                     """<svg""",
                 })
            Assert.Equal(HttpStatusCode.UnprocessableEntity, (await Put(unsafeSvg)).StatusCode);

        // An icon file, sent as anything at all.
        byte[] ico = [0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0, 0, 0, 0, 0, 22, 0, 0, 0];
        var icon = await Json(await manager.PutAsync("/api/company-settings/logo", Upload(ico, "application/octet-stream", "favicon.ico"), Cancel));
        var iconShown = await anyone.GetAsync(icon.GetProperty("logoUrl").GetString(), Cancel);
        Assert.Equal(("image/x-icon", ico.Length), (iconShown.Content.Headers.ContentType!.MediaType, (await iconShown.Content.ReadAsByteArrayAsync(Cancel)).Length));

        // Two megabytes at most.
        var big = new byte[2 * 1024 * 1024 + 1];
        new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }.CopyTo(big, 0);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await manager.PutAsync("/api/company-settings/logo", Upload(big, "image/png", "big.png"), Cancel)).StatusCode);
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
