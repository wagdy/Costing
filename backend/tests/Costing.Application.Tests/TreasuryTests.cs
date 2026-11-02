using Costing.Domain.Common;
using Costing.Application.Approvals;
using Costing.Application.Treasury;
using Costing.Domain.Treasury;

namespace Costing.Application.Tests;

// The treasury's dates. After midnight, before the business day starts, the restaurant's calendar
// is a day ahead of the business day: an entry dated that calendar day is taken, never a day later.
public class TreasuryTests
{
    private readonly TestCosting _pos = new();

    private Task<SafeVoucherResultDto> Enter(SafeTransactionKind kind, decimal amount, DateOnly date, DateOnly? takings = null, FundingSource? source = null) =>
        _pos.Send(new RecordSafeVoucherCommand(
            Guid.NewGuid(), new SafeVoucher(Guid.NewGuid(), kind, amount, date, source, takings), null, "staff-omar", "Omar", CanApprove: true));

    [Fact]
    public async Task After_midnight_the_calendar_day_is_taken_as_well_as_the_business_day()
    {
        _pos.Dates.BusinessDayBehind = 1;
        var calendar = DateOnly.FromDateTime(DateTime.UtcNow);
        var business = calendar.AddDays(-1);

        // The screens send the business day; the calendar day is taken too.
        var opening = await Enter(SafeTransactionKind.OpeningBalance, 1_000, business, source: FundingSource.CarriedOver);
        var transfer = await Enter(SafeTransactionKind.RevenueTransfer, 300, calendar, takings: calendar);
        Assert.Equal((business, calendar, calendar), (opening.Transaction!.BusinessDate, transfer.Transaction!.BusinessDate, transfer.Transaction.RevenueDate!.Value));

        // A day after the calendar is the future either way.
        var future = await Assert.ThrowsAsync<DomainException>(() =>
            Enter(SafeTransactionKind.Funding, 10, calendar.AddDays(1), source: FundingSource.Other));
        Assert.Equal("A safe entry is dated today or before: cash cannot move in the future.", future.Message);
        await Assert.ThrowsAsync<DomainException>(() =>
            Enter(SafeTransactionKind.RevenueTransfer, 10, calendar, takings: calendar.AddDays(1)));
    }

    private Task<SafeVoucherResultDto> Takings(decimal amount, bool canApprove, decimal? screenRate = null, SafeTransactionKind kind = SafeTransactionKind.RevenueTransfer)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        return _pos.Send(new RecordSafeVoucherCommand(
            Guid.NewGuid(),
            new SafeVoucher(
                Guid.NewGuid(), kind, amount, today, RevenueDate: kind == SafeTransactionKind.RevenueTransfer ? today : null,
                ExpenseItemId: kind == SafeTransactionKind.ExpenseVoucher ? Guid.NewGuid() : null, IncludesTax: true, TaxPercent: screenRate),
            null, canApprove ? "staff-omar" : "staff-mona", canApprove ? "Omar" : "Mona", canApprove));
    }

    [Fact]
    public async Task Takings_with_the_tax_in_them_are_taken_off_at_the_tills_rate_never_the_screens()
    {
        var entered = await Takings(1_140, canApprove: true, screenRate: 1);

        var t = entered.Transaction!;
        Assert.Equal((1_140m, true, (decimal?)14m, 140m), (t.Amount, t.IncludesTax, t.TaxPercent, t.TaxAmount));
        // The whole sum counted is in the safe.
        Assert.Equal(1_140m, await _pos.Inventory.Safe.SafeBalanceAsync());

        // Only a day's takings have tax taken off.
        var expense = await Assert.ThrowsAsync<DomainException>(() => Takings(100, canApprove: true, kind: SafeTransactionKind.ExpenseVoucher));
        Assert.Equal("Only a day's takings are entered with the tax in them.", expense.Message);
    }

    [Fact]
    public async Task An_accountants_takings_show_the_tax_and_are_approved_at_the_rate_asked()
    {
        var asked = await Takings(570, canApprove: false);

        var request = asked.Request!;
        Assert.Contains(request.Changes, c => c.Label == "Tax collected · الضريبة المحصلة" && c.After == "L.E 70.00");
        Assert.Contains(request.Changes, c => c.Label == "Net sales · صافي المبيعات" && c.After == "L.E 500.00");

        // The till's rate changing in between does not change what was asked.
        _pos.TaxRate.Percent = 10;
        await _pos.Send(new ApproveRequestCommand(request.Id, "Omar"));

        var approved = await _pos.Inventory.Safe.GetByIdAsync(request.RecordId);
        Assert.Equal((570m, (decimal?)14m, 70m, "Mona", "Omar"), (approved!.Amount, approved.TaxPercent, approved.TaxAmount, approved.RecordedBy, approved.ApprovedBy));
    }

    // A day's Z report: its cash into the safe less what the drawer paid, its card to the bank, the
    // tax collected kept apart from the net sales, and its voids said, with why.
    private Task<SafeVoucherResultDto> ZReport(
        DateOnly day, decimal cash, decimal card, decimal tax, decimal voids = 0, string? notes = null, bool canApprove = true) =>
        _pos.Send(new RecordSafeVoucherCommand(
            Guid.NewGuid(),
            new SafeVoucher(Guid.NewGuid(), SafeTransactionKind.RevenueTransfer, cash, day, RevenueDate: day, Notes: notes,
                CardAmount: card, TaxAmount: tax, VoidsAmount: voids),
            null, canApprove ? "staff-omar" : "staff-mona", canApprove ? "Omar" : "Mona", canApprove));

    [Fact]
    public async Task A_days_z_report_puts_only_its_cash_in_the_safe_and_keeps_the_tax_apart_from_the_net_sales()
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var entered = (await ZReport(today, cash: 4_000, card: 2_840, tax: 840, voids: 150, notes: "Two pizzas sent back, one wrong order")).Transaction!;

        Assert.Equal((4_000m, (decimal?)4_000m, 2_840m, 840m, 150m, 6_000m), (entered.Amount, entered.GrossAmount, entered.CardAmount, entered.TaxAmount,
            entered.VoidsAmount, entered.NetAmount));
        Assert.Equal(("Two pizzas sent back, one wrong order", true, (decimal?)null), (entered.Notes, entered.IncludesTax, entered.TaxPercent));
        // The safe holds the cash, never the card nor more for the tax.
        Assert.Equal(4_000m, await _pos.Inventory.Safe.SafeBalanceAsync());

        // A day all by card: nothing into the safe, the takings entered all the same.
        var yesterday = today.AddDays(-1);
        var card = (await ZReport(yesterday, cash: 0, card: 1_140, tax: 140)).Transaction!;
        Assert.Equal((0m, 1_140m, 1_000m), (card.Amount, card.CardAmount, card.NetAmount));
        Assert.Equal(4_000m, await _pos.Inventory.Safe.SafeBalanceAsync());

        // An accountant's: the request says the breakdown, and nothing moves until approved.
        var asked = (await ZReport(today.AddDays(-2), cash: 500, card: 70, tax: 70, canApprove: false)).Request!;
        Assert.StartsWith("Takings of ", asked.Summary);
        Assert.EndsWith("· L.E 500.00 cash, L.E 70.00 card · net sales L.E 500.00, L.E 500.00 into the safe", asked.Summary);
        Assert.Contains(asked.Changes, c => c.Label == "Tax collected · الضريبة المحصلة" && c.After == "L.E 70.00");
        Assert.Equal(4_000m, await _pos.Inventory.Safe.SafeBalanceAsync());
    }

    [Fact]
    public async Task A_z_report_is_refused_with_no_takings_tax_above_them_or_twice_for_a_day()
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);

        Assert.StartsWith("Enter the day's cash or card takings.",
            (await Assert.ThrowsAsync<DomainException>(() => ZReport(today, cash: 0, card: 0, tax: 0))).Message);
        Assert.StartsWith("The tax collected cannot be more than the day's takings.",
            (await Assert.ThrowsAsync<DomainException>(() => ZReport(today, cash: 100, card: 50, tax: 200))).Message);
        Assert.StartsWith("The cash, card, tax and voids are zero or more.",
            (await Assert.ThrowsAsync<DomainException>(() => ZReport(today, cash: 100, card: -5, tax: 0))).Message);

        await ZReport(today, cash: 300, card: 200, tax: 50);
        var twice = await Assert.ThrowsAsync<DomainException>(() => ZReport(today, cash: 10, card: 0, tax: 0));
        Assert.Contains("are entered already: L.E 500.00", twice.Message);
        Assert.Contains("إيراد هذا اليوم مسجل بالفعل", twice.Message);
    }
}
