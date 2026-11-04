using Costing.Application.EndOfDay;
using Costing.Application.Purchases;
using Costing.Application.RawMaterials;
using Costing.Application.Suppliers;
using Costing.Application.Treasury;
using Costing.Domain.Common;
using Costing.Domain.EndOfDay;
using Costing.Domain.Purchases;
using Costing.Domain.RawMaterials;

namespace Costing.Application.Tests;

// The end of the day handed in, then made into the day's purchase invoices on the daily batch:
// each with the supplier, the way it was paid and the photo it was handed in with.
public class EndOfDayTests
{
    private static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, 0x4A, 0x46, 0x49, 0x46];
    private static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0];

    private readonly TestCosting _pos = new();
    private readonly DateOnly _today = DateOnly.FromDateTime(DateTime.UtcNow);

    private Task<EndOfDayDto> HandIn(Guid id, EndOfDayInvoiceKind kind, Guid supplier, decimal total, byte[] photo, string type = "image/jpeg", DateOnly? on = null) =>
        _pos.Send(new AddEndOfDayInvoiceCommand(on ?? _today, id, kind, supplier, total, null, $"{id:N}.jpg", type, photo, "Ali"));

    private Task<PurchaseBatchResult> Batch(DateOnly date, params BatchInvoice[] invoices) =>
        _pos.Send(new PostPurchaseBatchCommand(date, PurchasePaymentMethod.DayRevenue, date, invoices, "Omar", "staff-omar"));

    private static BatchInvoice Transcribed(Guid handedIn, Guid supplier, Guid flour, decimal kilos, decimal cost, bool onCredit = false) =>
        new(Guid.NewGuid(), supplier, null, [new PurchaseInvoiceLineEntry(flour, kilos, "kg", 1000, cost)], OnCredit: onCredit, EndOfDayInvoiceId: handedIn);

    [Fact]
    public async Task A_day_handed_in_becomes_its_purchase_invoices_with_their_photos_and_ways_of_paying()
    {
        var (nile, delta) = (Guid.NewGuid(), Guid.NewGuid());
        await _pos.Send(new SaveSupplierCommand(nile, "Nile Mills"));
        await _pos.Send(new SaveSupplierCommand(delta, "Delta Dairy"));
        var flour = (await _pos.Send(new CreateRawMaterialCommand("Flour", UnitOfMeasure.Gram, CostPerPurchaseUnit: 30))).Id;

        // A cash invoice and one on credit, each with its photo; a file that is not what it says is refused.
        var (cash, credit) = (Guid.NewGuid(), Guid.NewGuid());
        await HandIn(cash, EndOfDayInvoiceKind.Cash, nile, 150, Jpeg);
        var day = await HandIn(credit, EndOfDayInvoiceKind.Credit, delta, 300, Png, "image/png");
        var fake = await Assert.ThrowsAsync<DomainException>(() => HandIn(Guid.NewGuid(), EndOfDayInvoiceKind.Cash, nile, 10, Png));
        Assert.StartsWith("That file is not the photo or PDF it says it is.", fake.Message);
        Assert.Equal((1, 150m, 1, 300m), (day.CashInvoices, day.CashInvoicesTotal, day.CreditInvoices, day.CreditInvoicesTotal));
        // Sent again after an answer was lost: still one.
        Assert.Equal(2, (await HandIn(cash, EndOfDayInvoiceKind.Cash, nile, 150, Jpeg)).Invoices.Count);

        // Not handed in without its sales; the batch waits for it to be.
        var noSales = await Assert.ThrowsAsync<DomainException>(() => _pos.Send(new SubmitEndOfDayCommand(_today, "Ali")));
        Assert.StartsWith("Enter the day's sales report", noSales.Message);
        var early = await Assert.ThrowsAsync<DomainException>(() => Batch(_today, Transcribed(cash, nile, flour, 5, 150)));
        Assert.Contains("Its end of day is not submitted yet", early.Message);

        await _pos.Send(new SaveEndOfDaySalesCommand(_today, 1_000, 500, 210, 20, "Two voids", "Ali"));
        day = await _pos.Send(new SubmitEndOfDayCommand(_today, "Ali"));
        Assert.Equal((EndOfDayStatus.Submitted, "Ali"), (day.Status, day.SubmittedBy));
        // Net sales 1,500; with the tax 1,710; the cash less the cash invoice; into the safe, all less the cash invoice.
        Assert.Equal((1_500m, 1_710m, 850m, 1_560m), (day.NetSales, day.TotalRevenue, day.CashAfterInvoices, day.ExpectedIntoSafe));
        var locked = await Assert.ThrowsAsync<DomainException>(() => HandIn(Guid.NewGuid(), EndOfDayInvoiceKind.Cash, nile, 10, Jpeg));
        Assert.Contains("is submitted by Ali: a manager reopens it to change it", locked.Message);

        // Posted with another date: refused.
        var otherDay = await Assert.ThrowsAsync<DomainException>(() => Batch(_today.AddDays(-1), Transcribed(cash, nile, flour, 5, 150)));
        Assert.Contains("post it with that date", otherDay.Message);

        // The batch: the cash invoice paid out of the day's takings, the credit one owed to its supplier.
        var posted = await Batch(_today, Transcribed(cash, nile, flour, 5, 150), Transcribed(credit, delta, flour, 10, 300, onCredit: true));
        var (paid, owed) = (posted.Invoices[0], posted.Invoices[1]);
        Assert.Equal((PurchasePaymentMethod.DayRevenue, InvoicePaymentStatus.Paid), (paid.PaymentMethod!.Value, paid.PaymentStatus));
        Assert.Equal((PurchasePaymentMethod.Credit, InvoicePaymentStatus.OnCredit), (owed.PaymentMethod!.Value, owed.PaymentStatus));
        Assert.Equal(300m, await _pos.Inventory.SupplierLedger.BalanceAsync(delta));
        // Each with its photo as its paper.
        Assert.Equal(($"{cash:N}.jpg", "image/png"), (paid.Attachment!.FileName, owed.Attachment!.ContentType));
        Assert.Equal(Jpeg, await _pos.Inventory.Invoices.GetAsync(paid.Id));
        Assert.Equal(Png, await _pos.Inventory.Invoices.GetAsync(owed.Id));

        day = (await _pos.Send(new GetEndOfDayQuery(_today)))!;
        Assert.Equal(2, day.Posted);
        Assert.Equal([paid.Id, owed.Id], day.Invoices.Select(i => i.PurchaseInvoiceId!.Value));

        // Once only.
        var twice = await Assert.ThrowsAsync<DomainException>(() => Batch(_today, Transcribed(cash, nile, flour, 5, 150)));
        Assert.Contains("It is posted already, as another purchase invoice", twice.Message);

        // Reopened by a manager: what is posted stays posted.
        await _pos.Send(new ReopenEndOfDayCommand(_today, "Boss"));
        var removed = await Assert.ThrowsAsync<DomainException>(() => _pos.Send(new RemoveEndOfDayInvoiceCommand(_today, cash, "Ali")));
        Assert.StartsWith("It is posted already as a purchase invoice", removed.Message);
        var added = await HandIn(Guid.NewGuid(), EndOfDayInvoiceKind.Cash, nile, 40, Jpeg);
        Assert.Equal((EndOfDayStatus.Draft, 3, "Boss"), (added.Status, added.Invoices.Count, added.ReopenedBy));
    }

    [Fact]
    public async Task A_day_not_come_yet_is_not_closed_and_its_invoices_need_a_supplier_and_a_total()
    {
        var nile = Guid.NewGuid();
        await _pos.Send(new SaveSupplierCommand(nile, "Nile Mills"));

        var future = await Assert.ThrowsAsync<DomainException>(() => HandIn(Guid.NewGuid(), EndOfDayInvoiceKind.Cash, nile, 10, Jpeg, on: _today.AddDays(2)));
        Assert.StartsWith("That day has not come yet", future.Message);
        var nobody = await Assert.ThrowsAsync<DomainException>(() => HandIn(Guid.NewGuid(), EndOfDayInvoiceKind.Cash, Guid.NewGuid(), 10, Jpeg));
        Assert.StartsWith("Choose the supplier from the list", nobody.Message);
        var nothing = await Assert.ThrowsAsync<DomainException>(() => HandIn(Guid.NewGuid(), EndOfDayInvoiceKind.Cash, nile, 0, Jpeg));
        Assert.StartsWith("Enter the invoice's total", nothing.Message);

        // Changed and taken off while a draft: its photo goes with it.
        var id = Guid.NewGuid();
        await HandIn(id, EndOfDayInvoiceKind.Cash, nile, 10, Jpeg);
        var changed = await _pos.Send(new ChangeEndOfDayInvoiceCommand(_today, id, EndOfDayInvoiceKind.Credit, nile, 12.5m, " Bread ", "Ali"));
        Assert.Equal((EndOfDayInvoiceKind.Credit, 12.5m, "Bread"), (changed.Invoices[0].Kind, changed.Invoices[0].ReportedTotal, changed.Invoices[0].Note));
        Assert.Empty((await _pos.Send(new RemoveEndOfDayInvoiceCommand(_today, id, "Ali"))).Invoices);
        Assert.Null(await _pos.EndOfDays.GetAsync(id));
    }
}
