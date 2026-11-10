using System.Text.Json;
using Costing.Application.Approvals;
using Costing.Application.EndOfDay;
using Costing.Application.Integrations;
using Costing.Application.Staff;
using Costing.Application.Suppliers;
using Costing.Application.Treasury;
using Costing.Domain.Approvals;
using Costing.Domain.Common;
using Costing.Domain.EndOfDay;
using Costing.Domain.Integrations;
using Costing.Domain.Staff;
using Costing.Domain.Treasury;

namespace Costing.Application.Tests;

// The HR link, both ways and only while it is on. Off, the staff are kept here and nothing is sent.
// On: HR's employees read and kept here, each a staff member (one of the same name linked, not made
// again); each advance to one of them, the end of the day's with its receipt, and each deduction,
// queued for HR with its own id, and their voids; each payroll run HR sends kept once, replaced
// while still to be paid, paid out of the safe in one entry and HR told so.
public class HrIntegrationTests
{
    private static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, 0x4A, 0x46, 0x49, 0x46];

    private readonly TestCosting _pos = new();
    private readonly DateOnly _today = DateOnly.FromDateTime(DateTime.UtcNow);
    private readonly Guid _hrMona = Guid.NewGuid();
    private readonly Guid _hrAli = Guid.NewGuid();

    private async Task LinkAsync()
    {
        _pos.Hr.Gateway.Employees.Add(new HrEmployeeRecord(_hrMona, "17", "Mona Adel", "Hall", null, true));
        _pos.Hr.Gateway.Employees.Add(new HrEmployeeRecord(_hrAli, "21", "Ali Samir", "Kitchen", null, true));
        await _pos.Send(new SaveHrLinkCommand(true, "https://hr.example.com/", "hrk_0123456789abcdef0123", "Omar"));
        await _pos.Send(new SyncHrEmployeesCommand());
    }

    private Guid StaffOf(Guid hrEmployee) => _pos.Hr.Employees.All.Single(e => e.HrEmployeeId == hrEmployee).StaffMemberId;

    private static JsonElement Payload(HrOutboxItem item) => JsonDocument.Parse(item.Payload).RootElement;

    [Fact]
    public async Task Unlinked_the_staff_are_kept_here_added_from_the_end_of_the_day_and_nothing_is_sent()
    {
        var hana = Guid.NewGuid();
        var added = await _pos.Send(new AddLocalStaffMemberCommand(hana, " Hana ", "Cashier"));
        Assert.Equal(("Hana", "Cashier", true), (added.Name, added.JobTitle, added.IsActive));
        // Added again by the same name: the same one.
        Assert.Equal(hana, (await _pos.Send(new AddLocalStaffMemberCommand(Guid.NewGuid(), "hana", null))).Id);

        // An advance to her out of the safe: recorded here, nothing queued for HR.
        await _pos.Send(new RecordSafeVoucherCommand(Guid.NewGuid(), new SafeVoucher(Guid.NewGuid(), SafeTransactionKind.EmployeeAdvance, 100, _today, EmployeeId: hana),
            null, "staff-omar", "Omar", true));
        await _pos.Send(new RecordStaffDeductionCommand(Guid.NewGuid(), hana, _today, StaffDeductionKind.TillShortage, 40, "Short at close", "Omar"));
        Assert.Empty(_pos.Hr.Outbox.All);
        Assert.False((await _pos.Send(new GetHrStatusQuery())).Linked);
        // HR is not heard either.
        Assert.False(await _pos.Send(new VerifyHrKeyQuery("chr_anything")));
    }

    [Fact]
    public async Task Linked_HRs_employees_are_kept_here_as_staff_and_changed_on_HR()
    {
        // Kept here before the link, by the same name: linked to HR's, not made again.
        var local = Guid.NewGuid();
        await _pos.Send(new SaveStaffMemberCommand(local, "Mona Adel", null, true));
        // Not switched on without HR's address and key.
        var incomplete = await Assert.ThrowsAsync<DomainException>(() => _pos.Send(new SaveHrLinkCommand(true, "https://hr.example.com", null, "Omar")));
        Assert.StartsWith("To switch the link on, give HR's address and HR's key", incomplete.Message);

        await LinkAsync();
        Assert.Equal(local, StaffOf(_hrMona));
        var staff = await _pos.Send(new GetStaffQuery());
        Assert.Equal([("Ali Samir", "Kitchen", "21"), ("Mona Adel", "Hall", "17")],
            staff.OrderBy(s => s.Name).Select(s => (s.Name, s.JobTitle, s.Code)));
        Assert.Equal((true, 2), ((await _pos.Send(new GetHrStatusQuery())).Linked, _pos.Hr.Link.EmployeesSynced));
        // HR's key kept protected, never in plain; shown by its last characters.
        var settings = await _pos.Send(new GetHrIntegrationQuery());
        Assert.Equal((true, "••••0123"), (settings.HasHrKey, settings.HrKeyHint));
        Assert.Equal("plain:hrk_0123456789abcdef0123", _pos.Hr.Link.HrKeyProtected);

        // Changed on HR only; none added here while linked.
        var edited = await Assert.ThrowsAsync<DomainException>(() => _pos.Send(new SaveStaffMemberCommand(local, "Mona A.", null, true)));
        Assert.StartsWith("Mona Adel comes from HR", edited.Message);
        var added = await Assert.ThrowsAsync<DomainException>(() => _pos.Send(new AddLocalStaffMemberCommand(Guid.NewGuid(), "Hana", null)));
        Assert.StartsWith("The staff come from HR while it is linked", added.Message);

        // Read again unchanged: nothing changed. Ali leaves HR's list: left here too.
        var again = await _pos.Send(new SyncHrEmployeesCommand());
        Assert.Equal((2, 0, 0, 0), (again.Received, again.Added, again.Updated, again.Left));
        _pos.Hr.Gateway.Employees.RemoveAll(e => e.EmployeeId == _hrAli);
        var synced = await _pos.Send(new SyncHrEmployeesCommand());
        Assert.Equal((1, 0, 0, 1), (synced.Received, synced.Added, synced.Updated, synced.Left));
        Assert.False((await _pos.Send(new GetStaffQuery())).Single(s => s.Name == "Ali Samir").IsActive);

        // HR out of reach: said, and the employees kept here stay as they were.
        _pos.Hr.Gateway.Down = true;
        var down = await Assert.ThrowsAsync<DomainException>(() => _pos.Send(new SyncHrEmployeesCommand()));
        Assert.StartsWith("HR's employees could not be read", down.Message);
        Assert.False((await _pos.Send(new TestHrLinkCommand())).Ok);
        Assert.Contains(_pos.Hr.Journal.All, l => l.Call == "employees" && l.Outcome == HrSyncOutcome.Failed);
    }

    [Fact]
    public async Task An_advance_from_the_end_of_the_day_goes_to_HR_with_its_receipt_and_its_void_after_it()
    {
        await LinkAsync();
        var mona = StaffOf(_hrMona);
        var payout = Guid.NewGuid();
        await _pos.Send(new AddEndOfDayPayoutCommand(_today, payout, EndOfDayPayoutKind.EmployeeAdvance, mona, 250, "Rent", "signed.jpg", "image/jpeg", Jpeg, "Ali"));
        await _pos.Send(new SaveEndOfDaySalesCommand(_today, 1_000, 0, 140, 0, null, "Ali"));
        await _pos.Send(new SubmitEndOfDayCommand(_today, "Omar", "staff-omar", CanApprove: true));

        var advance = Assert.Single(_pos.Hr.Outbox.All);
        Assert.Equal((HrCalls.Advance, "create", payout, HrOutboxStatus.Pending), (advance.Kind, advance.Action, advance.IdempotencyKey, advance.Status));
        var body = Payload(advance);
        Assert.Equal((_hrMona, "17", 250m, "Rent"), (body.GetProperty("employeeId").GetGuid(), body.GetProperty("employeeCode").GetString(),
            body.GetProperty("amount").GetDecimal(), body.GetProperty("notes").GetString()?.Replace("End of day: ", "")));
        Assert.Equal((payout, "image/jpeg"), (body.GetProperty("receipt").GetProperty("photoId").GetGuid(), body.GetProperty("receipt").GetProperty("contentType").GetString()));
        Assert.Equal(_today.ToString("yyyy-MM-dd"), body.GetProperty("date").GetString());

        // Voided on the safe: HR is told to take it off, by the same key.
        await _pos.Send(new RequestDeletionCommand(Guid.NewGuid(), ApprovalModule.Treasury, payout, "Paid twice", "staff-omar", "Omar", true));
        var voided = _pos.Hr.Outbox.All.Single(i => i.Action == "void");
        Assert.Equal((HrCalls.Advance, payout), (voided.Kind, voided.IdempotencyKey));
        Assert.Equal(JsonValueKind.Null, Payload(voided).GetProperty("receipt").ValueKind);

        // An advance to someone kept only here: HR's to know nothing of.
        var local = Guid.NewGuid();
        await _pos.Send(new SaveHrLinkCommand(false, "https://hr.example.com", null, "Omar"));
        await _pos.Send(new SaveStaffMemberCommand(local, "Hana", null, true));
        await _pos.Send(new SaveHrLinkCommand(true, "https://hr.example.com", null, "Omar"));
        await _pos.Send(new RecordSafeVoucherCommand(Guid.NewGuid(), new SafeVoucher(Guid.NewGuid(), SafeTransactionKind.EmployeeAdvance, 50, _today, EmployeeId: local),
            null, "staff-omar", "Omar", true));
        Assert.Equal(2, _pos.Hr.Outbox.All.Count);
    }

    [Fact]
    public async Task A_deduction_charged_to_an_employee_from_HR_is_sent_and_so_is_its_void()
    {
        await LinkAsync();
        var id = Guid.NewGuid();
        var recorded = await _pos.Send(new RecordStaffDeductionCommand(id, StaffOf(_hrAli), _today, StaffDeductionKind.TillShortage, 75.5m, "Short at close", "Omar"));
        Assert.Equal(("Ali Samir", true), (recorded.Employee, recorded.FromHr));
        var sent = Assert.Single(_pos.Hr.Outbox.All);
        Assert.Equal((HrCalls.Deduction, "create", id), (sent.Kind, sent.Action, sent.IdempotencyKey));
        Assert.Equal(("TillShortage", 75.5m, _hrAli), (Payload(sent).GetProperty("kind").GetString(), Payload(sent).GetProperty("amount").GetDecimal(),
            Payload(sent).GetProperty("employeeId").GetGuid()));

        await _pos.Send(new VoidStaffDeductionCommand(id, "Omar"));
        Assert.Equal(["create", "void"], _pos.Hr.Outbox.All.Select(i => i.Action));
        var list = await _pos.Send(new GetStaffDeductionsQuery(_today.AddDays(-1), _today));
        Assert.NotNull(Assert.Single(list).VoidedAtUtc);
        // Not twice.
        await Assert.ThrowsAsync<DomainException>(() => _pos.Send(new VoidStaffDeductionCommand(id, "Omar")));
    }

    private static PayrollRunInput Run(Guid id, string period, decimal net, decimal advances = 1_500) =>
        new(id, period, 3, 24_000, 1_200, advances, 800, net,
            [new PayrollRunDepartmentInput("Kitchen", 2, 16_000, 800, 500, 1_000, 15_300), new PayrollRunDepartmentInput("Hall", 1, 8_000, 400, 300, 500, 7_600)]);

    [Fact]
    public async Task A_payroll_run_from_HR_is_kept_once_paid_out_of_the_safe_in_one_and_HR_is_told()
    {
        await LinkAsync();
        var lastMonth = _today.AddMonths(-1);
        var period = lastMonth.ToString("yyyy-MM");
        var id = Guid.NewGuid();

        var recorded = await _pos.Send(new ReceivePayrollRunCommand(Run(id, period, 22_900)));
        // Labor cost: the wages and what was added, less the penalties.
        Assert.Equal((HrSyncOutcome.Recorded, 24_400m, 22_900m), (recorded.Outcome, recorded.LaborCost, recorded.NetCashPayable));
        Assert.Equal(HrSyncOutcome.Unchanged, (await _pos.Send(new ReceivePayrollRunCommand(Run(id, period, 22_900)))).Outcome);
        Assert.Equal(HrSyncOutcome.Updated, (await _pos.Send(new ReceivePayrollRunCommand(Run(id, period, 22_400, advances: 2_000)))).Outcome);
        var run = Assert.Single(await _pos.Send(new GetPayrollRunsQuery()));
        Assert.Equal((PayrollRunStatus.Payable, 22_400m, 2_000m, 2, 2), (run.Status, run.NetCashPayable, run.TotalAdvancesDeducted, run.Revision, run.Departments.Count));
        Assert.Equal(16_300m, run.Departments.Single(d => d.Name == "Kitchen").LaborCost);

        // A cashier's payment is asked of a manager; a manager's is the safe's at once, its net cash
        // payable only: the advances were paid during the month.
        var asked = await _pos.Send(new DisbursePayrollRunCommand(id, Guid.NewGuid(), Guid.NewGuid(), "staff-ali", "Ali", false));
        Assert.Equal(ApprovalOutcome.Requested, asked.Outcome);
        Assert.True((await _pos.Send(new GetPayrollRunsQuery())).Single().PaymentRequested);
        await _pos.Send(new RejectRequestCommand(asked.Request!.Id, "Not yet", "Omar"));
        var paid = await _pos.Send(new DisbursePayrollRunCommand(id, Guid.NewGuid(), Guid.NewGuid(), "staff-omar", "Omar", true));
        Assert.Equal((ApprovalOutcome.Applied, SafeTransactionKind.PayrollPayment, -22_400m), (paid.Outcome, paid.Transaction!.Kind, paid.Transaction.Amount));
        run = (await _pos.Send(new GetPayrollRunsQuery())).Single();
        Assert.Equal((PayrollRunStatus.Disbursed, paid.Transaction.Id), (run.Status, run.SafeTransactionId!.Value));
        var settled = _pos.Hr.Outbox.All.Single(i => i.Kind == HrCalls.PayrollSettled);
        Assert.Equal((id, "create", paid.Transaction.Id, 22_400m, period),
            (settled.IdempotencyKey, settled.Action, Payload(settled).GetProperty("safeVoucherId").GetGuid(), Payload(settled).GetProperty("amount").GetDecimal(),
                Payload(settled).GetProperty("payrollPeriod").GetString()));

        // Paid, it is not changed from HR, nor paid twice.
        await Assert.ThrowsAsync<DomainException>(() => _pos.Send(new ReceivePayrollRunCommand(Run(id, period, 20_000))));
        await Assert.ThrowsAsync<DomainException>(() => _pos.Send(new DisbursePayrollRunCommand(id, Guid.NewGuid(), Guid.NewGuid(), "staff-omar", "Omar", true)));
        Assert.Contains(_pos.Hr.Journal.All, l => l.Call == "payroll-run" && l.Outcome == HrSyncOutcome.Refused);

        // Its payment voided: owed again, and HR told.
        await _pos.Send(new RequestDeletionCommand(Guid.NewGuid(), ApprovalModule.Treasury, paid.Transaction.Id, "Wrong day", "staff-omar", "Omar", true));
        Assert.Equal(PayrollRunStatus.Payable, (await _pos.Send(new GetPayrollRunsQuery())).Single().Status);
        Assert.Equal(["create", "void"], _pos.Hr.Outbox.All.Where(i => i.Kind == HrCalls.PayrollSettled).Select(i => i.Action));

        // A payroll is paid from its run, not as a voucher.
        var voucher = await Assert.ThrowsAsync<DomainException>(() => _pos.Send(new RecordSafeVoucherCommand(Guid.NewGuid(),
            new SafeVoucher(Guid.NewGuid(), SafeTransactionKind.PayrollPayment, 22_400, _today, PayrollMonth: run.Period, PayrollRunId: id), null, "staff-omar", "Omar", true)));
        Assert.StartsWith("A payroll from HR is paid from", voucher.Message);
    }

    [Fact]
    public async Task HR_is_heard_only_with_this_systems_key_while_the_link_is_on()
    {
        var key = await _pos.Send(new GenerateHrKeyCommand("Omar"));
        Assert.StartsWith(HrKeys.Prefix, key.Key);
        Assert.NotEqual(key.Key, _pos.Hr.Link.KeyHash);
        // Off: not heard, even with the key.
        Assert.False(await _pos.Send(new VerifyHrKeyQuery(key.Key)));
        await LinkAsync();
        Assert.True(await _pos.Send(new VerifyHrKeyQuery(key.Key)));
        Assert.False(await _pos.Send(new VerifyHrKeyQuery("chr_wrong")));
        Assert.True((await _pos.Send(new TestHrLinkCommand())).Ok);

        // A new key: the old one stops working.
        await _pos.Send(new GenerateHrKeyCommand("Omar"));
        Assert.False(await _pos.Send(new VerifyHrKeyQuery(key.Key)));
    }
}
