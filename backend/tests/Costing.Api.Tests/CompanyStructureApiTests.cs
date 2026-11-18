using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Costing.Domain.Company;

namespace Costing.Api.Tests;

// The company's structure through the API: a manager's to read and change; the mode on the public
// settings and the branches in use for anyone signed in; a user kept to a branch by their token,
// whatever they ask for; one who works every branch choosing with X-Branch-Id; a change of their
// branch signing them out; and an open-space shop that ignores any branch asked for.
public class CompanyStructureApiTests
{
    private static CancellationToken Cancel => TestContext.Current.CancellationToken;

    private static string Iso(DateOnly day) => day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static async Task<JsonElement> Json(HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, $"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync(Cancel)}");
        return await response.Content.ReadFromJsonAsync<JsonElement>(Cancel);
    }

    private static async Task<Guid> PostedInvoiceAsync(HttpClient client, Guid supplier, Guid flour, DateOnly day)
    {
        var id = Guid.NewGuid();
        await Json(await client.PutAsJsonAsync($"/api/inventory/purchase-invoices/{id}", new
        {
            supplierId = supplier, invoiceDate = Iso(day), paymentMethod = "Credit",
            lines = new[] { new { rawMaterialId = flour, enteredQuantity = 2, unitLabel = "kg", unitSize = 1000, cost = 60, itemType = "Inventory" } },
        }, Cancel));
        await Json(await client.PostAsync($"/api/inventory/purchase-invoices/{id}/post", null, Cancel));
        return id;
    }

    private static async Task<List<Guid>> InvoicesAsync(HttpClient client, Guid? branch = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/inventory/purchase-invoices");
        if (branch is { } chosen)
            request.Headers.Add("X-Branch-Id", chosen.ToString());
        return (await Json(await client.SendAsync(request, Cancel))).EnumerateArray().Select(i => i.GetProperty("id").GetGuid()).ToList();
    }

    [Fact]
    public async Task A_manager_builds_the_company_and_each_user_works_in_their_own_branch_or_the_one_they_choose()
    {
        await using var api = await TestApi.StartAsync();
        var manager = await api.ManagerAsync();
        var accountant = await api.AccountantAsync(manager);
        var today = DateOnly.Parse((await Json(await manager.GetAsync("/api/financials/today", Cancel))).GetProperty("today").GetString()!, CultureInfo.InvariantCulture);
        var nile = Guid.NewGuid();
        await Json(await manager.PutAsJsonAsync($"/api/inventory/suppliers/{nile}", new { name = "Nile Mills" }, Cancel));
        var flour = (await Json(await manager.PostAsJsonAsync("/api/inventory/raw-materials", new
        {
            name = "Flour", unit = "Gram", purchaseUnit = "kg", purchaseUnitSize = 1000,
        }, Cancel))).GetProperty("id").GetGuid();

        // An open-space shop: its one branch and store; the mode on the settings anyone reads.
        Assert.Equal(HttpStatusCode.Unauthorized, (await api.Anonymous().GetAsync("/api/settings/company-structure", Cancel)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await accountant.GetAsync("/api/settings/company-structure", Cancel)).StatusCode);
        var open = await Json(await manager.GetAsync("/api/settings/company-structure", Cancel));
        Assert.Equal(("SingleBranch_OpenSpace", 1, 1), (open.GetProperty("mode").GetString(), open.GetProperty("branches").GetArrayLength(),
            open.GetProperty("locations").GetArrayLength()));
        Assert.Equal("SingleBranch_OpenSpace", (await Json(await api.Anonymous().GetAsync("/api/settings", Cancel))).GetProperty("operatingMode").GetString());
        // Whatever branch is asked for, an open-space shop's records are its one branch's.
        var first = await PostedInvoiceAsync(manager, nile, flour, today);
        Assert.Equal([first], await InvoicesAsync(manager, Guid.NewGuid()));

        // Several branches: a manager's to say; Tanta added with its main store.
        Assert.Equal(HttpStatusCode.Forbidden,
            (await accountant.PutAsJsonAsync("/api/settings/company-structure/mode", new { mode = "MultiBranch_Independent" }, Cancel)).StatusCode);
        await Json(await manager.PutAsJsonAsync("/api/settings/company-structure/mode", new { mode = "MultiBranch_Independent" }, Cancel));
        var tanta = Guid.NewGuid();
        var saved = await Json(await manager.PutAsJsonAsync($"/api/settings/branches/{tanta}", new { name = "Tanta", nameAr = "طنطا", type = "Restaurant" }, Cancel));
        Assert.Equal(1, saved.GetProperty("locations").GetInt32());
        var choices = await Json(await accountant.GetAsync("/api/branches", Cancel));
        Assert.Equal(("MultiBranch_Independent", 2), (choices.GetProperty("mode").GetString(), choices.GetProperty("branches").GetArrayLength()));

        // Samir, kept to Tanta: his token says so; his invoice is Tanta's; asking for another branch changes nothing.
        var samirId = (await Json(await manager.PostAsJsonAsync("/api/users", new
        {
            email = "samir@example.com", fullName = "Samir", role = "Storekeeper", password = "Samir-password", branchId = tanta,
        }, Cancel))).GetProperty("id").GetString()!;
        var samir = await api.SignInAsync("samir@example.com", "Samir-password");
        Assert.Equal(tanta, (await Json(await samir.GetAsync("/api/auth/me", Cancel))).GetProperty("branchId").GetGuid());
        var tantas = await PostedInvoiceAsync(samir, nile, flour, today);
        Assert.Equal([tantas], await InvoicesAsync(samir, Branch.DefaultId));
        Assert.Equal(tanta, await api.Db(db => Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions.SingleAsync(
            db.PurchaseInvoices.Where(i => i.Id == tantas).Select(i => i.BranchId), Cancel)));

        // The manager works every branch: the first by default, Tanta when chosen.
        Assert.Equal([first], await InvoicesAsync(manager));
        Assert.Equal([tantas], await InvoicesAsync(manager, tanta));

        // A branch not in use for a user: refused. Back to one branch: refused while Tanta is in use.
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await manager.PostAsJsonAsync("/api/users", new
        {
            email = "hany@example.com", fullName = "Hany", role = "Storekeeper", password = "Hany-password", branchId = Guid.NewGuid(),
        }, Cancel)).StatusCode);
        var back = await manager.PutAsJsonAsync("/api/settings/company-structure/mode", new { mode = "SingleBranch_OpenSpace" }, Cancel);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, back.StatusCode);
        Assert.Contains("Take Tanta out of use first", await back.Content.ReadAsStringAsync(Cancel));

        // Samir given every branch: his old token signs him out.
        await Json(await manager.PutAsJsonAsync($"/api/users/{samirId}", new
        {
            email = "samir@example.com", fullName = "Samir", role = "Storekeeper", isActive = true, branchId = (Guid?)null,
        }, Cancel));
        Assert.Equal(HttpStatusCode.Unauthorized, (await samir.GetAsync("/api/auth/me", Cancel)).StatusCode);
        var again = await api.SignInAsync("samir@example.com", "Samir-password");
        Assert.Equal(JsonValueKind.Null, (await Json(await again.GetAsync("/api/auth/me", Cancel))).GetProperty("branchId").ValueKind);

        // The structure, with each change of it in the audit log.
        var built = await Json(await manager.GetAsync("/api/settings/company-structure", Cancel));
        Assert.Equal((2, 2), (built.GetProperty("branches").GetArrayLength(), built.GetProperty("locations").GetArrayLength()));
        Assert.Equal(1, await api.Db(db => Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions.CountAsync(
            db.SecurityAuditLogs.Where(l => l.Action == Costing.Domain.Security.SecurityAuditAction.OperatingModeChanged), Cancel)));
    }
}
