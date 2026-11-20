using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace Costing.Api.Tests;

// The POS's shift close in Costing: its floor documents (an advance to an employee, an expense with
// its supplier and receipt, an expense with neither, a driver's payout, a credit invoice, a payment
// to a supplier) into the end of day of the business day, each once; its day.closed with the items
// sold on each channel as one line, the discounts with why, and the till, into the sales report; and
// the day confirmed, its takings into the safe once.
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
        var withSales = await Json(await manager.GetAsync($"/api/end-of-day/{today}", Cancel));
        Assert.Equal((10m, "Loyal guest"), (withSales.GetProperty("discountsAmount").GetDecimal(),
            withSales.GetProperty("discountReasons").EnumerateArray().Single().GetProperty("reason").GetString()));
    }

    private static object Event(string kind, object data) => new { id = Guid.NewGuid(), kind, branchCode = "BR-01", occurredAtUtc = DateTime.UtcNow, data };

    private static object Document(Guid id, Guid shift, int number, string date, string kind, decimal amount, string note, object? extra = null) =>
        Merge(new Dictionary<string, object?>
        {
            ["paidOutId"] = id, ["shiftId"] = shift, ["shiftNumber"] = number, ["businessDate"] = date, ["kind"] = kind, ["amount"] = amount,
            ["note"] = note, ["givenBy"] = "Mona",
        }, extra);

    private static object DayClosed(Guid shift, int number, string date, int burgers, decimal cash, decimal card, decimal discounts, decimal openingFloat,
        decimal expected, decimal counted, decimal creditInvoices) => new
    {
        shiftId = shift, shiftNumber = number, businessDate = date, closedAtUtc = DateTime.UtcNow,
        soldItems = new[] { new { code = 7001, itemCode = "7001", name = "Burger", quantity = burgers, netAmount = burgers * 100m, channel = "DineIn" } },
        waste = Array.Empty<object>(),
        takings = new
        {
            cash, card, tax = 0m, cashTotal = cash, cardTotal = card, discountsAmount = discounts,
            discountReasons = discounts > 0 ? new[] { new { reason = "Loyal guest", count = 1, amount = discounts } } : [],
            voidsBefore = new { count = 0, amount = 0m }, voidsAfter = new { count = 0, amount = 0m },
        },
        till = new
        {
            openingFloat, cashSales = cash, cardSales = card, cashCollected = cash, cardCollected = card, taxCollected = 0m, voidsAndRefunds = 0m,
            discountsAndPromos = discounts, expectedCash = expected, actualCountedCash = counted, cashOverShort = counted - expected, creditInvoices,
            closedBy = "Mona",
        },
    };

    // The floor's five documents and the shift's till, recorded once at the POS, fill every section
    // of the end of day; the cash expected in the till is the drawer's; a second shift adds to it and
    // a resend changes nothing; confirmed, the takings go into the safe once, the payments out of them.
    [Fact]
    public async Task A_shift_closed_at_the_till_fills_every_section_of_the_end_of_day_and_confirming_counts_each_once()
    {
        await using var api = await TestApi.StartAsync();
        var manager = await api.ManagerAsync();
        var today = (await Json(await manager.GetAsync("/api/financials/today", Cancel))).GetProperty("today").GetString()!;
        var date = DateOnly.Parse(today, CultureInfo.InvariantCulture);
        var key = (await Json(await manager.PostAsync("/api/settings/pos-integration/key", null, Cancel))).GetProperty("key").GetString()!;
        var pos = api.Anonymous();
        pos.DefaultRequestHeaders.Add("X-Api-Key", key);
        var (nile, meats, hassan) = (Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());
        await Json(await manager.PutAsJsonAsync($"/api/inventory/suppliers/{nile}", new { name = "Nile Farms" }, Cancel));
        await Json(await manager.PutAsJsonAsync($"/api/inventory/suppliers/{meats}", new { name = "Cairo Meats" }, Cancel));
        // Owed 1,000 from before: paid 200 on account at the till.
        Assert.Equal(HttpStatusCode.NoContent, (await manager.PostAsJsonAsync($"/api/financials/suppliers/{meats}/opening-balance",
            new { entryId = Guid.NewGuid(), owed = 1000m }, Cancel)).StatusCode);
        await Json(await manager.PutAsJsonAsync($"/api/staff/{hassan}", new { name = "Hassan", jobTitle = "Chef" }, Cancel));
        await Json(await manager.PostAsJsonAsync("/api/menu/categories", new { name = "Mains" }, Cancel));
        await Json(await manager.PostAsJsonAsync("/api/menu/items", new
        {
            number = 7001, name = "Burger", category = "Mains", price = 100, isPriceBasedOnAddons = false, sizes = Array.Empty<object>(), addOnIds = Array.Empty<int>(),
        }, Cancel));

        // Shift 1: float 500; 2,100 of burgers, 100 off, 1,200 cash and 800 card; a cash expense of
        // 300, a credit invoice of 1,500 from Nile Farms (never out of the drawer), 200 paid to
        // Cairo Meats, an advance of 100 to Hassan: 1,100 left in the drawer, counted.
        var (s1, expense, credit, payment, advance) = (Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());
        var png = new { contentType = "image/png", fileName = "r.png", base64 = Convert.ToBase64String([137, 80, 78, 71]) };
        var documents = new[]
        {
            Event("paid-out", Document(expense, s1, 1, today, "Expense", 300, "Gas cylinder", new { receipt = png })),
            Event("credit-invoice", Document(credit, s1, 1, today, "CreditInvoice", 1500, "Vegetables", new { supplierId = nile, supplierName = "Nile Farms", receipt = png })),
            Event("paid-out", Document(payment, s1, 1, today, "SupplierPayment", 200, "On account", new { supplierId = meats, supplierName = "Cairo Meats" })),
            Event("paid-out", Document(advance, s1, 1, today, "StaffAdvance", 100, "Advance", new { employeeName = "Hassan" })),
        };
        foreach (var document in documents)
            Assert.Equal("Recorded", (await Json(await pos.PostAsJsonAsync("/api/integrations/pos/events", document, Cancel))).GetProperty("outcome").GetString());
        var closing = Event("day.closed", DayClosed(s1, 1, today, 21, 1200, 800, 100, 500, 1100, 1100, 1500));
        Assert.Equal("Recorded", (await Json(await pos.PostAsJsonAsync("/api/integrations/pos/events", closing, Cancel))).GetProperty("outcome").GetString());

        var day = await Json(await manager.GetAsync($"/api/end-of-day/{today}", Cancel));
        var invoices = day.GetProperty("invoices").EnumerateArray().ToDictionary(i => i.GetProperty("id").GetGuid());
        var payouts = day.GetProperty("payouts").EnumerateArray().ToDictionary(p => p.GetProperty("id").GetGuid());
        Assert.Equal(("Cash", 300m, true, 1), (invoices[expense].GetProperty("kind").GetString(), invoices[expense].GetProperty("reportedTotal").GetDecimal(),
            invoices[expense].GetProperty("fromPos").GetBoolean(), invoices[expense].GetProperty("posShiftNumber").GetInt32()));
        Assert.Equal(("Credit", 1500m, nile), (invoices[credit].GetProperty("kind").GetString(), invoices[credit].GetProperty("reportedTotal").GetDecimal(),
            invoices[credit].GetProperty("supplierId").GetGuid()));
        Assert.Equal(("SupplierPayment", 200m, meats), (payouts[payment].GetProperty("kind").GetString(), payouts[payment].GetProperty("amount").GetDecimal(),
            payouts[payment].GetProperty("supplierId").GetGuid()));
        Assert.Equal(("EmployeeAdvance", 100m, hassan), (payouts[advance].GetProperty("kind").GetString(), payouts[advance].GetProperty("amount").GetDecimal(),
            payouts[advance].GetProperty("employeeId").GetGuid()));
        Assert.Equal((500m, 1200m, 800m, 100m), (day.GetProperty("openingFloat").GetDecimal(), day.GetProperty("cashAmount").GetDecimal(),
            day.GetProperty("cardAmount").GetDecimal(), day.GetProperty("discountsAmount").GetDecimal()));
        // 500 + 1,200 − 300 − 200 − 100: the credit invoice is not in it.
        Assert.Equal(1100m, day.GetProperty("netCashInTill").GetDecimal());
        var synced = day.GetProperty("pos");
        Assert.Equal((true, "1", 1100m, 0m, 2, 2), (synced.GetProperty("salesLocked").GetBoolean(), synced.GetProperty("shifts").GetString(),
            synced.GetProperty("countedCash").GetDecimal(), synced.GetProperty("overShort").GetDecimal(), synced.GetProperty("invoices").GetInt32(),
            synced.GetProperty("payouts").GetInt32()));

        // Locked: a figure typed over the POS's is refused.
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await manager.PutAsJsonAsync($"/api/end-of-day/{today}/sales",
            new { cashAmount = 1300m, cardAmount = 800m, openingFloat = 500m, discountsAmount = 100m }, Cancel)).StatusCode);

        // Shift 2 the same day: float 300, 400 cash, a 50 expense; then the whole of shift 1 again
        // (Retry): nothing changes.
        var (s2, ice) = (Guid.NewGuid(), Guid.NewGuid());
        await Json(await pos.PostAsJsonAsync("/api/integrations/pos/events", Event("paid-out", Document(ice, s2, 2, today, "Expense", 50, "Ice")), Cancel));
        await Json(await pos.PostAsJsonAsync("/api/integrations/pos/events", Event("day.closed", DayClosed(s2, 2, today, 4, 400, 0, 0, 300, 650, 650, 0)), Cancel));
        foreach (var document in documents.Append(closing))
            Assert.Equal("Unchanged", (await Json(await pos.PostAsJsonAsync("/api/integrations/pos/events", document, Cancel))).GetProperty("outcome").GetString());
        day = await Json(await manager.GetAsync($"/api/end-of-day/{today}", Cancel));
        Assert.Equal((800m, 1600m, 800m, 100m, "1, 2"), (day.GetProperty("openingFloat").GetDecimal(), day.GetProperty("cashAmount").GetDecimal(),
            day.GetProperty("cardAmount").GetDecimal(), day.GetProperty("discountsAmount").GetDecimal(), day.GetProperty("pos").GetProperty("shifts").GetString()));
        // Both drawers' floats and cash, less what left them: what both shifts handed over.
        Assert.Equal((1750m, 1750m), (day.GetProperty("netCashInTill").GetDecimal(), day.GetProperty("pos").GetProperty("countedCash").GetDecimal()));
        Assert.Equal(3, day.GetProperty("invoices").GetArrayLength());

        // Review & confirm: the takings into the safe once, from the sales report; the payment and the
        // advance out of them; the invoices waiting on the daily batch; the sales summary still one.
        var confirmed = await Json(await manager.PostAsync($"/api/end-of-day/{today}/submit", null, Cancel));
        Assert.Equal(("Submitted", 2400m, 0), (confirmed.GetProperty("status").GetString(), confirmed.GetProperty("takingsEntered").GetDecimal(),
            confirmed.GetProperty("posted").GetInt32()));
        Assert.All(confirmed.GetProperty("payouts").EnumerateArray(), p => Assert.Equal("InSafe", p.GetProperty("voucher").GetString()));
        var entries = await api.Db(db => db.Set<Costing.Domain.Treasury.SafeTransaction>().Where(t => t.RevenueDate == date && t.ReversalOf == null && t.VoidedAtUtc == null)
            .Select(t => new { t.Kind, t.Amount, t.Fund }).ToListAsync(Cancel));
        Assert.Equal(2400m, Assert.Single(entries, e => e.Kind == Costing.Domain.Treasury.SafeTransactionKind.RevenueTransfer).Amount);
        Assert.Equal(2400m - 200m - 100m, entries.Where(e => e.Fund == Costing.Domain.Treasury.CashFund.Safe).Sum(e => e.Amount));
        Assert.Equal(1, await api.Db(db => db.SalesReceipts.CountAsync(r => r.BusinessDate == date && r.VoidedAtUtc == null, Cancel)));

        // Sent again once confirmed: as it was; a new one for the day is refused: it is handed in.
        Assert.Equal("Unchanged", (await Json(await pos.PostAsJsonAsync("/api/integrations/pos/events", closing, Cancel))).GetProperty("outcome").GetString());
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await pos.PostAsJsonAsync("/api/integrations/pos/events",
            Event("paid-out", Document(Guid.NewGuid(), s2, 2, today, "Expense", 10, "Late")), Cancel)).StatusCode);
        Assert.Single(await api.Db(db => db.Set<Costing.Domain.Treasury.SafeTransaction>()
            .Where(t => t.RevenueDate == date && t.Kind == Costing.Domain.Treasury.SafeTransactionKind.RevenueTransfer && t.ReversalOf == null && t.VoidedAtUtc == null)
            .ToListAsync(Cancel)));
    }

    // Taken off in Costing (a cashier's duplicate): the POS sending it again does not put it back.
    [Fact]
    public async Task A_POS_document_taken_off_in_Costing_stays_off_and_a_credit_invoice_needs_a_supplier()
    {
        await using var api = await TestApi.StartAsync();
        var manager = await api.ManagerAsync();
        var today = (await Json(await manager.GetAsync("/api/financials/today", Cancel))).GetProperty("today").GetString()!;
        var key = (await Json(await manager.PostAsync("/api/settings/pos-integration/key", null, Cancel))).GetProperty("key").GetString()!;
        var pos = api.Anonymous();
        pos.DefaultRequestHeaders.Add("X-Api-Key", key);
        var (shift, twice) = (Guid.NewGuid(), Guid.NewGuid());
        var duplicate = Event("paid-out", Document(twice, shift, 1, today, "Driver", 40, "Fuel", new { driverName = "Samir" }));
        await Json(await pos.PostAsJsonAsync("/api/integrations/pos/events", duplicate, Cancel));
        var day = await Json(await manager.GetAsync($"/api/end-of-day/{today}", Cancel));
        var driver = day.GetProperty("invoices").EnumerateArray().Single();
        Assert.Contains("Driver: Samir", driver.GetProperty("note").GetString());
        Assert.Equal("Delivery drivers · سائقو التوصيل", driver.GetProperty("supplier").GetString());

        await Json(await manager.DeleteAsync($"/api/end-of-day/{today}/invoices/{twice}", Cancel));
        var again = await Json(await pos.PostAsJsonAsync("/api/integrations/pos/events", duplicate, Cancel));
        Assert.Equal("Unchanged", again.GetProperty("outcome").GetString());
        day = await Json(await manager.GetAsync($"/api/end-of-day/{today}", Cancel));
        Assert.Equal(0, day.GetProperty("invoices").GetArrayLength());
        Assert.Contains("taken off by", day.GetProperty("auditTrail").GetString());

        // A credit invoice with no supplier Costing has: refused, the POS keeps it as failed.
        var refused = await pos.PostAsJsonAsync("/api/integrations/pos/events",
            Event("credit-invoice", Document(Guid.NewGuid(), shift, 1, today, "CreditInvoice", 900, "Meat", new { supplierName = "Nobody Ltd" })), Cancel);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, refused.StatusCode);
        Assert.Contains("not one of Costing's suppliers", await refused.Content.ReadAsStringAsync(Cancel));
    }
}
