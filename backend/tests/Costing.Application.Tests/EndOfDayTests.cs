using Costing.Application.EndOfDay;
using Costing.Application.Purchases;
using Costing.Application.RawMaterials;
using Costing.Application.Suppliers;
using Costing.Application.Treasury;
using Costing.Domain.Common;
using Costing.Domain.EndOfDay;
using Costing.Domain.Purchases;
using Costing.Domain.RawMaterials;
using Costing.Domain.Treasury;

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

    // A day the restaurant did not trade, closed with why so the days go on; only the next day, never
    // one with entries on it or one that sold.
    [Fact]
    public async Task A_closed_day_keeps_the_days_in_order_with_why_never_one_that_traded()
    {
        var start = _today.AddDays(-3);
        await _pos.Send(new SaveEndOfDaySalesCommand(start, 500, null, null, null, null, "Ali"));
        await _pos.Send(new SubmitEndOfDayCommand(start, "Ali"));

        Assert.StartsWith("Close ", (await Assert.ThrowsAsync<DomainException>(() =>
            _pos.Send(new MarkClosedDayCommand(_today.AddDays(-1), "Plumbing", "Ali")))).Message);
        await Assert.ThrowsAsync<DomainException>(() => _pos.Send(new MarkClosedDayCommand(start.AddDays(1), " ", "Ali")));
        var closed = await _pos.Send(new MarkClosedDayCommand(start.AddDays(1), "Restaurant closed for plumbing maintenance", "Ali"));
        Assert.Equal((EndOfDayStatus.Submitted, true, "Restaurant closed for plumbing maintenance", 0m),
            (closed.Status, closed.IsClosedDay, closed.ClosedDayReason, closed.NetSales));
        Assert.Contains("Marked as a closed day by Ali: Restaurant closed for plumbing maintenance", closed.AuditTrail);
        var sequence = await _pos.Send(new GetEndOfDaySequenceQuery());
        Assert.Equal((start.AddDays(1), start.AddDays(2)), (sequence.LastClosedDate, sequence.NextExpectedDate));
        // Sent again after an answer was lost: as it is.
        Assert.True((await _pos.Send(new MarkClosedDayCommand(start.AddDays(1), "Restaurant closed for plumbing maintenance", "Ali"))).IsClosedDay);

        // With an invoice handed in: handed in with it instead.
        var invoice = Guid.NewGuid();
        var nile = Guid.NewGuid();
        await _pos.Send(new SaveSupplierCommand(nile, "Nile Mills"));
        await HandIn(invoice, EndOfDayInvoiceKind.Cash, nile, 40, Jpeg, on: start.AddDays(2));
        Assert.Contains("has entries handed in", (await Assert.ThrowsAsync<DomainException>(() =>
            _pos.Send(new MarkClosedDayCommand(start.AddDays(2), "Closed", "Ali")))).Message);
        await _pos.Send(new RemoveEndOfDayInvoiceCommand(start.AddDays(2), invoice, "Ali"));

        // Its takings in the safe: it traded.
        await _pos.Send(new RecordSafeVoucherCommand(
            Guid.NewGuid(), new SafeVoucher(Guid.NewGuid(), SafeTransactionKind.RevenueTransfer, 300, start.AddDays(2), RevenueDate: start.AddDays(2)),
            null, "staff-omar", "Omar", true));
        Assert.StartsWith("The day's takings are in the safe: hand the day in with its sales", (await Assert.ThrowsAsync<DomainException>(() =>
            _pos.Send(new MarkClosedDayCommand(start.AddDays(2), "Closed", "Ali")))).Message);
    }

    // A draft entered under the wrong date (after the day to close next) moved there by a manager with
    // the reason written into it; the draft invoices paid out of its drawer move with it; never onto a
    // day with entries of its own.
    [Fact]
    public async Task A_stranded_draft_moves_to_the_day_to_close_next_with_its_reason_written_in()
    {
        var (start, next, stranded) = (_today.AddDays(-3), _today.AddDays(-2), _today.AddDays(-1));
        var nile = Guid.NewGuid();
        await _pos.Send(new SaveSupplierCommand(nile, "Nile Mills"));
        var flour = (await _pos.Send(new CreateRawMaterialCommand("Flour", UnitOfMeasure.Gram, CostPerPurchaseUnit: 30))).Id;
        // Entered under the wrong day before any day was closed; then the day before it closed.
        var gas = Guid.NewGuid();
        await HandIn(gas, EndOfDayInvoiceKind.Cash, nile, 60, Jpeg, on: stranded);
        var draft = await _pos.Send(new SaveEndOfDaySalesCommand(stranded, 800, 200, 140, null, "Busy lunch", "Ali"));
        var drawer = Guid.NewGuid();
        var onCredit = Guid.NewGuid();
        PurchaseInvoiceLineEntry[] kilo = [new(flour, 1, "kg", 1000, 30)];
        await _pos.Send(new SavePurchaseInvoiceCommand(drawer, nile, "F-1", stranded, kilo, "Omar", PurchasePaymentMethod.DayRevenue, stranded));
        await _pos.Send(new SavePurchaseInvoiceCommand(onCredit, nile, "F-2", stranded, kilo, "Omar", PurchasePaymentMethod.Credit));
        await _pos.Send(new SaveEndOfDaySalesCommand(start, 500, null, null, null, null, "Ali"));
        await _pos.Send(new SubmitEndOfDayCommand(start, "Ali"));

        var sequence = await _pos.Send(new GetEndOfDaySequenceQuery());
        Assert.Equal(new EndOfDayStranded(draft.Id, stranded, 1, 0, true), Assert.Single(sequence.StrandedDrafts!));

        Assert.StartsWith("Give the reason", (await Assert.ThrowsAsync<DomainException>(() =>
            _pos.Send(new ReassignEndOfDayDateCommand(draft.Id, next, "  ", "Boss")))).Message);
        Assert.StartsWith("Close ", (await Assert.ThrowsAsync<DomainException>(() =>
            _pos.Send(new ReassignEndOfDayDateCommand(draft.Id, _today, "Typo", "Boss")))).Message);
        // The day to close next with entries of its own: days are not merged.
        var other = Guid.NewGuid();
        await HandIn(other, EndOfDayInvoiceKind.Credit, nile, 25, Jpeg, on: next);
        Assert.Contains("has entries of its own", (await Assert.ThrowsAsync<DomainException>(() =>
            _pos.Send(new ReassignEndOfDayDateCommand(draft.Id, next, "Typo", "Boss")))).Message);
        // Taken off, the empty draft left there makes room.
        await _pos.Send(new RemoveEndOfDayInvoiceCommand(next, other, "Ali"));

        // Nothing moved by the refusals.
        Assert.Equal((stranded, (DateOnly?)stranded), (_pos.EndOfDays.All.Single(d => d.Id == draft.Id).Date, (await _pos.Inventory.Invoices.GetByIdAsync(drawer))!.RevenueDate));
        var moved = await _pos.Send(new ReassignEndOfDayDateCommand(draft.Id, next, "wrong initial entry", "Boss"));
        var line = $"System Audit: Migrated from {stranded:dd/MM/yyyy} to {next:dd/MM/yyyy} by Boss due to: wrong initial entry";
        Assert.Equal((stranded, 1, next, draft.Id), (moved.From, moved.PurchaseInvoicesMoved, moved.Day.Date, moved.Day.Id));
        Assert.Equal(($"Busy lunch\n{line}", line), (moved.Day.Notes, moved.Day.Invoices.Single().Note));
        Assert.Contains(line, moved.Day.AuditTrail);
        Assert.Equal((1_000m, 60m), (moved.Day.NetSales, moved.Day.CashInvoicesTotal));
        Assert.Single(_pos.EndOfDays.All, d => d.Date == next);
        var paid = (await _pos.Inventory.Invoices.GetByIdAsync(drawer))!;
        Assert.Equal((next, next), (paid.InvoiceDate, paid.RevenueDate));
        Assert.Equal(stranded, (await _pos.Inventory.Invoices.GetByIdAsync(onCredit))!.InvoiceDate);
        Assert.Empty((await _pos.Send(new GetEndOfDaySequenceQuery())).StrandedDrafts!);

        // Sent again after an answer was lost: as it is.
        Assert.Equal((next, 0), ((await _pos.Send(new ReassignEndOfDayDateCommand(draft.Id, next, "wrong initial entry", "Boss"))).Day.Date, 0));
        // Handed in on its own day now.
        Assert.Equal(EndOfDayStatus.Submitted, (await _pos.Send(new SubmitEndOfDayCommand(next, "Ali"))).Status);
    }

    // Before a day is closed: purchase invoices left as drafts dated on or before it, and cash handed
    // out with no one named more than 48 hours ago, said; neither stops it.
    [Fact]
    public async Task Draft_invoices_and_old_custodies_are_said_before_the_day_is_closed_never_stopping_it()
    {
        var nile = Guid.NewGuid();
        await _pos.Send(new SaveSupplierCommand(nile, "Nile Mills"));
        var flour = (await _pos.Send(new CreateRawMaterialCommand("Flour", UnitOfMeasure.Gram, CostPerPurchaseUnit: 30))).Id;
        Assert.Empty((await _pos.Send(new GetEndOfDaySequenceQuery())).Warnings);

        await _pos.Send(new SavePurchaseInvoiceCommand(Guid.NewGuid(), nile, "F-1", _today, [new PurchaseInvoiceLineEntry(flour, 1, "kg", 1000, 30)], "Omar"));
        // Dated after the day: not said yet.
        await _pos.Send(new SavePurchaseInvoiceCommand(Guid.NewGuid(), nile, "F-2", _today.AddDays(1), [new PurchaseInvoiceLineEntry(flour, 1, "kg", 1000, 30)], "Omar"));
        var custody = SafeTransaction.PendingAdvance(Guid.NewGuid(), 300, _today.AddDays(-3), "For the market run", "Omar");
        typeof(SafeTransaction).GetProperty(nameof(SafeTransaction.RecordedAtUtc))!.SetValue(custody, DateTime.UtcNow.AddHours(-50));
        _pos.Inventory.Safe.Add(custody);
        _pos.Inventory.Safe.Add(SafeTransaction.PendingAdvance(Guid.NewGuid(), 100, _today, "Just now", "Omar"));

        var warnings = (await _pos.Send(new GetEndOfDaySequenceQuery())).Warnings;
        Assert.Equal(2, warnings.Count);
        Assert.StartsWith("There are draft invoices: 1 draft purchase invoice is dated on or before", warnings[0]);
        Assert.Contains("(Nile Mills). Consider posting them before closing the day.", warnings[0]);
        Assert.StartsWith("1 cash custody handed out with no one named more than 48 hours ago", warnings[1]);

        // Closed all the same, as a day that sold nothing; the answer says them too.
        var closed = await _pos.Send(new SubmitEndOfDayCommand(_today, "Ali", ZeroSales: true));
        Assert.Equal((EndOfDayStatus.Submitted, 2), (closed.Status, closed.Warnings!.Count));
        Assert.True((await _pos.Send(new GetEndOfDaySequenceQuery())).AllClosed);
    }

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
        Assert.Contains("is submitted by Ali: to change it, a manager undoes it", locked.Message);

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

        // Undone by a manager, the last closed day: the purchase invoices posted from it voided (their
        // stock and what is owed undone) and unlinked, to be posted again; a draft, to be handed in again.
        var undone = await _pos.Send(new UndoLastEndOfDayCommand(_today, "Closed on the wrong day", "Boss"));
        Assert.Equal((2, EndOfDayStatus.Draft, "Boss", "Closed on the wrong day"), (undone.InvoicesVoided, undone.Day.Status, undone.Day.ReopenedBy, undone.Day.ReopenReason));
        Assert.All(undone.Day.Invoices, i => Assert.Null(i.PurchaseInvoiceId));
        Assert.Equal(0m, await _pos.Inventory.SupplierLedger.BalanceAsync(delta));
        Assert.Equal(PurchaseInvoiceStatus.Voided, (await _pos.Inventory.Invoices.GetByIdAsync(paid.Id))!.Status);
        await _pos.Send(new RemoveEndOfDayInvoiceCommand(_today, cash, "Ali"));
        var added = await HandIn(Guid.NewGuid(), EndOfDayInvoiceKind.Cash, nile, 40, Jpeg);
        Assert.Equal((EndOfDayStatus.Draft, 2, "Boss"), (added.Status, added.Invoices.Count, added.ReopenedBy));
        // Only the last closed day, and only by naming the one meant.
        await Assert.ThrowsAsync<DomainException>(() => _pos.Send(new UndoLastEndOfDayCommand(_today, null, "Boss")));
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
