using Costing.Application.Approvals;
using Costing.Application.EndOfDay;
using Costing.Application.Staff;
using Costing.Application.Suppliers;
using Costing.Application.Treasury;
using Costing.Domain.Approvals;
using Costing.Domain.Common;
using Costing.Domain.EndOfDay;
using Costing.Domain.Treasury;

namespace Costing.Application.Tests;

// The cash paid out of the till at the end of the day, each with its receipt: to suppliers, against
// what they are owed, and as advances to employees. Handed in, each becomes the safe's entry out of
// the day's takings: a manager's at once, a cashier's asked of a manager. The takings, once entered,
// reach the safe less what was paid out of them; an advance is deducted in its month's payroll.
public class EndOfDayPayoutTests
{
    private static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, 0x4A, 0x46, 0x49, 0x46];
    private static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0];

    private readonly TestCosting _pos = new();
    private readonly DateOnly _today = DateOnly.FromDateTime(DateTime.UtcNow);
    private readonly Guid _nile = Guid.NewGuid();
    private readonly Guid _mona = Guid.NewGuid();

    private async Task SetUpAsync()
    {
        await _pos.Send(new SaveSupplierCommand(_nile, "Nile Mills"));
        // Owed 1,000 from before.
        await _pos.Send(new SetSupplierOpeningBalanceCommand(Guid.NewGuid(), _nile, 1_000, _today.AddDays(-10), "Omar"));
        await _pos.Send(new SaveStaffMemberCommand(_mona, "Mona", "Cashier", true));
    }

    private Task<EndOfDayDto> Pay(Guid id, Guid supplier, decimal amount, byte[]? receipt = null) =>
        _pos.Send(new AddEndOfDayPayoutCommand(
            _today, id, EndOfDayPayoutKind.SupplierPayment, supplier, amount, null, "receipt.jpg", "image/jpeg", receipt ?? Jpeg, "Ali"));

    private Task<EndOfDayDto> Advance(Guid id, Guid employee, decimal amount, byte[]? receipt = null) =>
        _pos.Send(new AddEndOfDayPayoutCommand(
            _today, id, EndOfDayPayoutKind.EmployeeAdvance, employee, amount, "Rent", "signed.jpg", "image/jpeg", receipt ?? Jpeg, "Ali"));

    private Task<EndOfDayDto> Sales() => _pos.Send(new SaveEndOfDaySalesCommand(_today, 1_000, 500, 210, 0, null, "Ali", OpeningFloat: 500));

    private async Task<EndOfDayVoucherState> StateOf(Guid payout) =>
        (await _pos.Send(new GetEndOfDayQuery(_today)))!.Payouts.Single(p => p.Id == payout).Voucher;

    [Fact]
    public async Task A_cashiers_payments_are_asked_of_a_manager_and_once_approved_come_out_of_the_days_takings()
    {
        await SetUpAsync();

        // More than the supplier is owed, alone or with the day's other payments to them: refused.
        var tooMuch = await Assert.ThrowsAsync<DomainException>(() => Pay(Guid.NewGuid(), _nile, 1_200));
        Assert.StartsWith("Nile Mills is owed L.E 1,000.00: pay that much or less.", tooMuch.Message);
        var paid = Guid.NewGuid();
        await Pay(paid, _nile, 600);
        var together = await Assert.ThrowsAsync<DomainException>(() => Pay(Guid.NewGuid(), _nile, 500));
        Assert.Contains("is owed L.E 400.00 after the day's other payments to them", together.Message);
        // A receipt that is not what it says: refused.
        var fake = await Assert.ThrowsAsync<DomainException>(() => Advance(Guid.NewGuid(), _mona, 10, Png));
        Assert.StartsWith("That file is not the photo or PDF it says it is.", fake.Message);

        var advanced = Guid.NewGuid();
        var day = await Advance(advanced, _mona, 250);
        Assert.Equal((1, 600m, 1, 250m), (day.SupplierPayments, day.SupplierPaymentsTotal, day.Advances, day.AdvancesTotal));
        Assert.Equal(["Nile Mills", "Mona"], day.Payouts.Select(p => p.Payee));
        Assert.Equal(Jpeg, await _pos.EndOfDays.GetAsync(advanced));
        // Sent again after an answer was lost: still two.
        Assert.Equal(2, (await Advance(advanced, _mona, 250)).Payouts.Count);

        // The float 500 and the cash 1,000 with its share of the tax, 140; less 600 and 250.
        day = await Sales();
        Assert.Equal((500m, 140m, 1_140m, 850m, 790m), (day.OpeningFloat!.Value, day.CashTax, day.CashSalesCollected, day.CashPaidOut, day.NetCashInTill));
        Assert.Equal(1_710m - 850m, day.ExpectedIntoSafe);

        // Handed in by a cashier: each asked of a manager, nothing in the safe yet.
        day = await _pos.Send(new SubmitEndOfDayCommand(_today, "Ali", "staff-ali", CanApprove: false));
        Assert.All(day.Payouts, p => Assert.Equal(EndOfDayVoucherState.Requested, p.Voucher));
        Assert.Null(await _pos.Inventory.Safe.GetByIdAsync(paid));
        Assert.Equal(ApprovalStatus.Pending, (await _pos.Inventory.ApprovalRequests.GetByIdAsync(paid))!.Status);

        // Approved: the payment out of the day's takings and off the supplier's account; the advance
        // Mona's, deducted in this month's payroll.
        await _pos.Send(new ApproveRequestCommand(paid, "Omar"));
        await _pos.Send(new ApproveRequestCommand(advanced, "Omar"));
        var payment = (await _pos.Inventory.Safe.GetByIdAsync(paid))!;
        Assert.Equal((SafeTransactionKind.SupplierPayment, CashFund.DayRevenue, -600m, (DateOnly?)_today), (payment.Kind, payment.Fund, payment.Amount, payment.RevenueDate));
        Assert.Equal(400m, await _pos.Inventory.SupplierLedger.BalanceAsync(_nile));
        var advance = (await _pos.Inventory.Safe.GetByIdAsync(advanced))!;
        Assert.Equal((SafeTransactionKind.EmployeeAdvance, (Guid?)_mona, (DateOnly?)new DateOnly(_today.Year, _today.Month, 1)),
            (advance.Kind, advance.EmployeeId, advance.PayrollMonth));
        Assert.Equal(EndOfDayVoucherState.InSafe, await StateOf(paid));

        // The day's takings entered: what was paid out of them taken off what reaches the safe.
        await _pos.Send(new RecordSafeVoucherCommand(
            Guid.NewGuid(), new SafeVoucher(Guid.NewGuid(), SafeTransactionKind.RevenueTransfer, 1_000, _today, RevenueDate: _today, CardAmount: 500, TaxAmount: 210),
            null, "staff-omar", "Omar", true));
        var takings = (await _pos.Inventory.Safe.GetTakingsAsync(_today))!;
        Assert.Equal((1_710m, 850m, day.ExpectedIntoSafe), (takings.TakingsTotal, takings.PaidOut, takings.Amount));
    }

    [Fact]
    public async Task A_managers_go_to_the_safe_at_once_and_one_a_manager_refused_can_be_taken_off()
    {
        await SetUpAsync();
        var paid = Guid.NewGuid();
        await Pay(paid, _nile, 100);
        await Sales();

        // Handed in by a manager: in the safe at once.
        var day = await _pos.Send(new SubmitEndOfDayCommand(_today, "Omar", "staff-omar", CanApprove: true));
        Assert.Equal(EndOfDayVoucherState.InSafe, day.Payouts.Single().Voucher);
        Assert.Equal(900m, await _pos.Inventory.SupplierLedger.BalanceAsync(_nile));

        // Reopened: what went to the safe is corrected there; a new advance is asked of a manager
        // when the day is handed in again.
        await _pos.Send(new ReopenEndOfDayCommand(_today, "Omar"));
        var locked = await Assert.ThrowsAsync<DomainException>(() => _pos.Send(new ChangeEndOfDayPayoutCommand(_today, paid, _nile, 50, null, "Ali")));
        Assert.StartsWith("It went to the safe when the day was handed in", locked.Message);
        var advanced = Guid.NewGuid();
        await Advance(advanced, _mona, 75);
        await _pos.Send(new SubmitEndOfDayCommand(_today, "Ali", "staff-ali", CanApprove: false));
        Assert.Equal(EndOfDayVoucherState.Requested, await StateOf(advanced));

        // Refused: nothing entered, so it can be taken off (once the day is reopened).
        await _pos.Send(new RejectRequestCommand(advanced, "No signature on the receipt", "Omar"));
        Assert.Equal(EndOfDayVoucherState.Refused, await StateOf(advanced));
        await _pos.Send(new ReopenEndOfDayCommand(_today, "Omar"));
        day = await _pos.Send(new RemoveEndOfDayPayoutCommand(_today, advanced, "Ali"));
        Assert.Equal([paid], day.Payouts.Select(p => p.Id));
        Assert.Null(await _pos.EndOfDays.GetAsync(advanced));
    }

    [Fact]
    public async Task An_advance_goes_to_someone_on_the_staff_and_a_payment_to_a_supplier_on_the_list()
    {
        await SetUpAsync();
        var karim = Guid.NewGuid();
        await _pos.Send(new SaveStaffMemberCommand(karim, "Karim", null, false));

        var left = await Assert.ThrowsAsync<DomainException>(() => Advance(Guid.NewGuid(), karim, 50));
        Assert.StartsWith("Karim has left", left.Message);
        var nobody = await Assert.ThrowsAsync<DomainException>(() => Advance(Guid.NewGuid(), Guid.NewGuid(), 50));
        Assert.StartsWith("Choose the employee from the list", nobody.Message);
        var noSupplier = await Assert.ThrowsAsync<DomainException>(() => Pay(Guid.NewGuid(), Guid.NewGuid(), 50));
        Assert.StartsWith("Choose the supplier from the list", noSupplier.Message);
        // Nothing owed to a new supplier: nothing to pay.
        var delta = Guid.NewGuid();
        await _pos.Send(new SaveSupplierCommand(delta, "Delta Dairy"));
        var owesNothing = await Assert.ThrowsAsync<DomainException>(() => Pay(Guid.NewGuid(), delta, 50));
        Assert.StartsWith("Nothing is owed to Delta Dairy", owesNothing.Message);
        Assert.Null(await _pos.Send(new GetEndOfDayQuery(_today)) is { } made ? made.Payouts.FirstOrDefault() : null);
    }
}
