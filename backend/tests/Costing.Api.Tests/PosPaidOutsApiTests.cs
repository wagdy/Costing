using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace Costing.Api.Tests;

// The POS's shift close in Costing: its paid-outs (an advance to an employee, an expense with its
// supplier and receipt, an expense with neither) into the end of day of the business day, each once;
// and its day.closed with the items sold on each channel as one line and the discounts with why.
public sealed class PosPaidOutsApiTests
{
    private static CancellationToken Cancel => TestContext.Current.CancellationToken;

    private static async Task<JsonElement> Json(HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, $"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync(Cancel)}");
        return await response.Content.ReadFromJsonAsync<JsonElement>(Cancel);
    }

    private static object PaidOut(Guid id, string date, string kind, decimal amount, string note, object? extra = null) => new
    {
        id = Guid.NewGuid(),
        kind = "paid-out",
        branchCode = "BR-01",
        occurredAtUtc = DateTime.UtcNow,
        data = Merge(new Dictionary<string, object?>
        {
            ["paidOutId"] = id, ["shiftId"] = Guid.NewGuid(), ["shiftNumber"] = 4, ["businessDate"] = date, ["kind"] = kind, ["amount"] = amount,
            ["note"] = note, ["givenBy"] = "Mona",
        }, extra),
    };

    private static Dictionary<string, object?> Merge(Dictionary<string, object?> data, object? extra)
    {
        if (extra is not null)
            foreach (var p in extra.GetType().GetProperties())
                data[p.Name] = p.GetValue(extra);
        return data;
    }

    [Fact]
    public async Task A_shifts_paid_outs_reach_the_end_of_day_once_and_its_day_keeps_its_discounts()
    {
        await using var api = await TestApi.StartAsync();
        var manager = await api.ManagerAsync();
        var today = (await Json(await manager.GetAsync("/api/financials/today", Cancel))).GetProperty("today").GetString()!;
        var key = (await Json(await manager.PostAsync("/api/settings/pos-integration/key", null, Cancel))).GetProperty("key").GetString()!;
        var pos = api.Anonymous();
        pos.DefaultRequestHeaders.Add("X-Api-Key", key);

        // Costing's suppliers, for the POS's form; an employee on its staff.
        var nile = Guid.NewGuid();
        await Json(await manager.PutAsJsonAsync($"/api/inventory/suppliers/{nile}", new { name = "Nile Farms" }, Cancel));
        var suppliers = await Json(await pos.GetAsync("/api/integrations/pos/suppliers", Cancel));
        Assert.Contains(suppliers.EnumerateArray(), s => s.GetProperty("id").GetGuid() == nile && s.GetProperty("name").GetString() == "Nile Farms");
        var hassan = Guid.NewGuid();
        await Json(await manager.PutAsJsonAsync($"/api/staff/{hassan}", new { name = "Hassan", jobTitle = "Chef" }, Cancel));

        var (advance, ice, gas) = (Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());
        var sent = await Json(await pos.PostAsJsonAsync("/api/integrations/pos/events",
            PaidOut(advance, today, "StaffAdvance", 150, "Advance", new { employeeId = Guid.NewGuid(), employeeName = "Hassan" }), Cancel));
        Assert.Equal(("Recorded", "advance"), (sent.GetProperty("outcome").GetString(), sent.GetProperty("entry").GetString()));
        await Json(await pos.PostAsJsonAsync("/api/integrations/pos/events",
            PaidOut(ice, today, "Expense", 80, "Ice", new
            {
                supplierId = nile, supplierName = "Nile Farms",
                receipt = new { contentType = "image/png", fileName = "r.png", base64 = Convert.ToBase64String([137, 80, 78, 71]) },
            }), Cancel));
        await Json(await pos.PostAsJsonAsync("/api/integrations/pos/events", PaidOut(gas, today, "Expense", 40, "Gas cylinder"), Cancel));

        // Sent again: what it was.
        var again = await Json(await pos.PostAsJsonAsync("/api/integrations/pos/events",
            PaidOut(advance, today, "StaffAdvance", 150, "Advance", new { employeeName = "Hassan" }), Cancel));
        Assert.Equal("Unchanged", again.GetProperty("outcome").GetString());
        // An advance to someone Costing does not have: refused, and the POS keeps it as failed.
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await pos.PostAsJsonAsync("/api/integrations/pos/events",
            PaidOut(Guid.NewGuid(), today, "StaffAdvance", 10, "Advance", new { employeeName = "Nobody" }), Cancel)).StatusCode);

        var day = await Json(await manager.GetAsync($"/api/end-of-day/{today}", Cancel));
        var payout = day.GetProperty("payouts").EnumerateArray().Single();
        Assert.Equal((advance, hassan, 150m), (payout.GetProperty("id").GetGuid(), payout.GetProperty("employeeId").GetGuid(), payout.GetProperty("amount").GetDecimal()));
        var invoices = day.GetProperty("invoices").EnumerateArray().ToDictionary(i => i.GetProperty("id").GetGuid());
        Assert.Equal((nile, 80m, "Cash"), (invoices[ice].GetProperty("supplierId").GetGuid(), invoices[ice].GetProperty("reportedTotal").GetDecimal(),
            invoices[ice].GetProperty("kind").GetString()));
        Assert.Contains("POS shift 4", invoices[gas].GetProperty("note").GetString());
        // No supplier named: the POS's petty cash; no photo taken: a slip of what the POS recorded.
        var petty = await api.Db(db => db.Suppliers.SingleAsync(s => s.Name.StartsWith("POS petty cash"), Cancel));
        Assert.Equal(petty.Id, invoices[gas].GetProperty("supplierId").GetGuid());
        Assert.Equal("application/pdf", invoices[gas].GetProperty("photo").GetProperty("contentType").GetString());
        var slip = await manager.GetAsync($"/api/end-of-day/{today}/photos/{gas}", Cancel);
        Assert.StartsWith("%PDF-1.4", await slip.Content.ReadAsStringAsync(Cancel));

        // The day: a burger sold in the hall and two taken away, one line of three; the discount kept with why.
        await Json(await manager.PostAsJsonAsync("/api/menu/categories", new { name = "Mains" }, Cancel));
        await Json(await manager.PostAsJsonAsync("/api/menu/items", new
        {
            number = 7001, name = "Burger", category = "Mains", price = 100, isPriceBasedOnAddons = false, sizes = Array.Empty<object>(), addOnIds = Array.Empty<int>(),
        }, Cancel));
        var closed = await Json(await pos.PostAsJsonAsync("/api/integrations/pos/events", new
        {
            id = Guid.NewGuid(),
            kind = "day.closed",
            data = new
            {
                shiftId = Guid.NewGuid(), shiftNumber = 4, businessDate = today,
                soldItems = new[]
                {
                    new { code = 7001, itemCode = "7001", name = "Burger", quantity = 1, netAmount = 100m, channel = "DineIn" },
                    new { code = 7001, itemCode = "7001", name = "Burger", quantity = 2, netAmount = 200m, channel = "Takeaway" },
                },
                waste = Array.Empty<object>(),
                takings = new
                {
                    cash = 250m, card = 40m, tax = 42m, discountsAmount = 10m,
                    discountReasons = new[] { new { reason = "Loyal guest", count = 1, amount = 10m } },
                    voidsBefore = new { count = 0, amount = 0m }, voidsAfter = new { count = 0, amount = 0m },
                },
            },
        }, Cancel));
        Assert.Equal("Recorded", closed.GetProperty("outcome").GetString());
        var sale = await api.Db(db => db.SalesReceipts.Include(r => r.Lines).SingleAsync(r => r.BusinessDate == DateOnly.Parse(today, CultureInfo.InvariantCulture), Cancel));
        Assert.Equal((7001, 3), (sale.Lines.Single().MenuItemId, sale.Lines.Single().Quantity));
        var takings = await api.Db(db => db.SafeTransactions.SingleAsync(t => t.RevenueDate == DateOnly.Parse(today, CultureInfo.InvariantCulture)
            && t.ReversalOf == null, Cancel));
        Assert.Equal((10m, "Loyal guest"), (takings.DiscountsAmount, takings.DiscountReasons.Single().Reason));
    }
}
