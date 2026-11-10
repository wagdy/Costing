using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using MediatR;
using Costing.Application.Approvals;
using Costing.Application.Common;
using Costing.Application.Treasury;
using Costing.Domain.Approvals;
using Costing.Domain.Common;
using Costing.Domain.EndOfDay;
using Costing.Domain.Integrations;
using Costing.Domain.Staff;
using Costing.Domain.Treasury;

namespace Costing.Application.Integrations;

// The HR & payroll link (Settings → HR Integration), both ways, only while it is switched on:
//
// From HR: its employees (read from HR, kept here as SyncedEmployees, each a staff member here so
// the safe's advances and salaries name them), and each payroll run HR approves (sent here): its
// labor cost for the month's profit and loss, and its net cash payable, to be paid out of the safe.
//
// To HR, through an outbox tried again until HR takes it: each advance paid out of the safe to an
// employee from HR (the end of the day's, with its signed receipt), and its void; each deduction
// charged to one (a till shortage, a staff charge), and its void; and each payroll paid out of the
// safe, and its void. Each is sent by its own id here, so HR keeps it once.
//
// Switched off, nothing is read or sent and every screen works on the staff kept here.

public static class HrKeys
{
    public const string Prefix = "chr_";

    // 32 random bytes, URL-safe: shown once, kept only as its hash.
    public static string New() => Prefix + Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public static string Hash(string key) => PosKeys.Hash(key);

    public static string Hint(string key) => "••••" + key.Trim()[^4..];

    public static bool Matches(string? key, string? hash) => PosKeys.Matches(key, hash);
}

// HR's key, kept encrypted here and read back only to call HR.
public interface IHrKeyProtector
{
    string Protect(string key);

    // Null when it cannot be read back (this server's secret changed): HR's key is pasted again.
    string? Unprotect(string protectedKey);
}

// An employee as HR lists them.
public sealed record HrEmployeeRecord(Guid EmployeeId, string? Code, string FullName, string? Department, string? Branch, bool IsActive);

public sealed record HrPingResult(string? System, string? Company);

public enum HrSendOutcome
{
    Delivered = 1,
    // HR answered no, saying why: tried again only once put right.
    Refused = 2,
    // HR out of reach, or answered with an error of its own: tried again later.
    Unavailable = 3,
}

public sealed record HrSendResult(HrSendOutcome Outcome, string Message);

// HR answered, and said no (a wrong key, a refusal).
public sealed class HrRefusedException(string message) : Exception(message);

// HR could not be reached, or failed.
public sealed class HrUnavailableException(string message) : Exception(message);

// The calls this system makes to HR, each with HR's key in X-API-Key.
public interface IHrGateway
{
    Task<HrPingResult> PingAsync(string baseUrl, string key, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<HrEmployeeRecord>> EmployeesAsync(string baseUrl, string key, CancellationToken cancellationToken = default);

    // One outbox item to HR's endpoint for its kind, with its idempotency key.
    Task<HrSendResult> SendAsync(string baseUrl, string key, string kind, string payload, Guid idempotencyKey, CancellationToken cancellationToken = default);
}

public sealed record HrSyncLogDto(
    Guid Id, DateTime AtUtc, HrSyncDirection Direction, string Call, HrSyncOutcome Outcome, string Message, Guid? Reference, string? Detail)
{
    public static HrSyncLogDto From(HrSyncLog l) => new(l.Id, l.AtUtc, l.Direction, l.Call, l.Outcome, l.Message, l.Reference, l.Detail);
}

public sealed record HrOutboxItemDto(
    Guid Id, string Kind, string Action, Guid IdempotencyKey, string Summary, HrOutboxStatus Status, int Attempts, DateTime NextAttemptAtUtc,
    string? LastError, DateTime CreatedAtUtc, DateTime? SentAtUtc)
{
    public static HrOutboxItemDto From(HrOutboxItem i) => new(
        i.Id, i.Kind, i.Action, i.IdempotencyKey, i.Summary, i.Status, i.Attempts, i.NextAttemptAtUtc, i.LastError, i.CreatedAtUtc, i.SentAtUtc);
}

public sealed record HrIntegrationDto(
    bool Enabled,
    string? BaseUrl,
    bool HasHrKey,
    string? HrKeyHint,
    bool HasKey,
    string? KeyHint,
    DateTime? KeyCreatedAtUtc,
    string? KeyCreatedBy,
    DateTime? EmployeesSyncedAtUtc,
    int EmployeesSynced,
    int Pending,
    int Failed,
    IReadOnlyList<HrSyncLogDto> Logs,
    IReadOnlyList<HrOutboxItemDto> Outbox);

public sealed record HrKeyDto(string Key, string KeyHint, DateTime CreatedAtUtc);

public sealed record HrTestResultDto(bool Ok, string Message);

public sealed record HrEmployeeSyncDto(int Received, int Added, int Updated, int Left, DateTime AtUtc);

// Whether the staff come from HR now, for the screens that choose one.
public sealed record HrStatusDto(bool Linked, DateTime? EmployeesSyncedAtUtc);

public sealed record GetHrIntegrationQuery : IRequest<HrIntegrationDto>;

public sealed record GetHrStatusQuery : IRequest<HrStatusDto>;

// Switched on or off, HR's address, and HR's key when a new one is pasted (null keeps it).
public sealed record SaveHrLinkCommand(bool Enabled, string? BaseUrl, string? HrKey, string StaffName) : IRequest<HrIntegrationDto>;

public sealed record GenerateHrKeyCommand(string StaffName) : IRequest<HrKeyDto>;

// HR's ping, with its address and key as saved (switched on or not).
public sealed record TestHrLinkCommand : IRequest<HrTestResultDto>;

public sealed record SyncHrEmployeesCommand : IRequest<HrEmployeeSyncDto>;

public sealed record RetryHrOutboxCommand(Guid ItemId) : IRequest<HrOutboxItemDto>;

public sealed record VerifyHrKeyQuery(string? Key) : IRequest<bool>;

internal sealed class GetHrIntegrationHandler(IHrLinkStore links, IHrSyncJournal journal, IHrOutboxRepository outbox)
    : IRequestHandler<GetHrIntegrationQuery, HrIntegrationDto>
{
    public async Task<HrIntegrationDto> Handle(GetHrIntegrationQuery request, CancellationToken cancellationToken) =>
        await HrLinks.Dto(await links.GetAsync(cancellationToken), journal, outbox)(cancellationToken);
}

internal static class HrLinks
{
    public static Func<CancellationToken, Task<HrIntegrationDto>> Dto(HrLink link, IHrSyncJournal journal, IHrOutboxRepository outbox) =>
        async cancellationToken => new HrIntegrationDto(
            link.Enabled, link.BaseUrl, link.HrKeyProtected is not null, link.HrKeyHint, link.HasKey, link.KeyHint, link.KeyCreatedAtUtc, link.KeyCreatedBy,
            link.EmployeesSyncedAtUtc, link.EmployeesSynced,
            await outbox.CountAsync(HrOutboxStatus.Pending, cancellationToken), await outbox.CountAsync(HrOutboxStatus.Failed, cancellationToken),
            (await journal.RecentAsync(100, cancellationToken)).Select(HrSyncLogDto.From).ToList(),
            (await outbox.GetRecentAsync(50, cancellationToken)).Select(HrOutboxItemDto.From).ToList());

    // HR's address and key, to call it; or why not.
    public static (string Url, string Key) Calling(HrLink link, IHrKeyProtector protector, bool mustBeOn)
    {
        if (mustBeOn && !link.Enabled)
            throw new DomainException("The HR link is switched off. · الربط مع الموارد البشرية متوقف.");
        if (link.BaseUrl is null || link.HrKeyProtected is null)
            throw new DomainException("Give HR's address and HR's key first. · أدخل عنوان الموارد البشرية ومفتاحها.");
        var key = protector.Unprotect(link.HrKeyProtected)
            ?? throw new DomainException("HR's key can no longer be read here (this server's secret changed): paste it again. · أعد إدخال مفتاح الموارد البشرية.");
        return (link.BaseUrl, key);
    }
}

internal sealed class GetHrStatusHandler(IHrLinkStore links) : IRequestHandler<GetHrStatusQuery, HrStatusDto>
{
    public async Task<HrStatusDto> Handle(GetHrStatusQuery request, CancellationToken cancellationToken)
    {
        var link = await links.GetAsync(cancellationToken);
        return new HrStatusDto(link.Enabled, link.EmployeesSyncedAtUtc);
    }
}

internal sealed class SaveHrLinkHandler(IHrLinkStore links, IHrKeyProtector protector, IHrSyncJournal journal, IHrOutboxRepository outbox, IUnitOfWork unitOfWork)
    : IRequestHandler<SaveHrLinkCommand, HrIntegrationDto>
{
    public async Task<HrIntegrationDto> Handle(SaveHrLinkCommand request, CancellationToken cancellationToken)
    {
        var link = await links.GetAsync(cancellationToken);
        var key = string.IsNullOrWhiteSpace(request.HrKey) ? null : request.HrKey.Trim();
        if (key is { Length: < 16 or > 200 })
            throw new DomainException("HR's key is the one HR made for this system: paste it whole. · الصق مفتاح الموارد البشرية كاملاً.");
        link.Configure(request.Enabled, request.BaseUrl, key is null ? null : protector.Protect(key), key is null ? null : HrKeys.Hint(key), request.StaffName);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await HrLinks.Dto(link, journal, outbox)(cancellationToken);
    }
}

internal sealed class GenerateHrKeyHandler(IHrLinkStore links, IUnitOfWork unitOfWork) : IRequestHandler<GenerateHrKeyCommand, HrKeyDto>
{
    public async Task<HrKeyDto> Handle(GenerateHrKeyCommand request, CancellationToken cancellationToken)
    {
        var link = await links.GetAsync(cancellationToken);
        var key = HrKeys.New();
        link.SetKey(HrKeys.Hash(key), HrKeys.Hint(key), request.StaffName);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return new HrKeyDto(key, link.KeyHint!, link.KeyCreatedAtUtc!.Value);
    }
}

internal sealed class VerifyHrKeyHandler(IHrLinkStore links) : IRequestHandler<VerifyHrKeyQuery, bool>
{
    // Only while the link is on: switched off, HR is not heard.
    public async Task<bool> Handle(VerifyHrKeyQuery request, CancellationToken cancellationToken)
    {
        var link = await links.GetAsync(cancellationToken);
        return link.Enabled && HrKeys.Matches(request.Key, link.KeyHash);
    }
}

internal sealed class TestHrLinkHandler(IHrLinkStore links, IHrKeyProtector protector, IHrGateway gateway, IHrSyncJournal journal)
    : IRequestHandler<TestHrLinkCommand, HrTestResultDto>
{
    public async Task<HrTestResultDto> Handle(TestHrLinkCommand request, CancellationToken cancellationToken)
    {
        var (url, key) = HrLinks.Calling(await links.GetAsync(cancellationToken), protector, mustBeOn: false);
        try
        {
            var ping = await gateway.PingAsync(url, key, cancellationToken);
            var message = $"Connected to {ping.System ?? "HR"}{(ping.Company is { } company ? $" · {company}" : "")}.";
            await journal.WriteAsync(new HrSyncLog(HrSyncDirection.Outbound, "ping", HrSyncOutcome.Read, message), cancellationToken);
            return new HrTestResultDto(true, message);
        }
        catch (Exception ex) when (ex is HrRefusedException or HrUnavailableException)
        {
            var outcome = ex is HrRefusedException ? HrSyncOutcome.Refused : HrSyncOutcome.Failed;
            await journal.WriteAsync(new HrSyncLog(HrSyncDirection.Outbound, "ping", outcome, ex.Message), cancellationToken);
            return new HrTestResultDto(false, ex.Message);
        }
    }
}

// HR's employees, kept here: each new one a staff member (one of the same name here linked to them,
// not made again), each one known changed as HR has them, and each no longer on HR's list marked
// as having left. Their advances and salaries keep naming them.
internal sealed class SyncHrEmployeesHandler(
    IHrLinkStore links,
    IHrKeyProtector protector,
    IHrGateway gateway,
    ISyncedEmployeeRepository synced,
    IStaffMemberRepository staff,
    IHrSyncJournal journal,
    IUnitOfWork unitOfWork) : IRequestHandler<SyncHrEmployeesCommand, HrEmployeeSyncDto>
{
    public async Task<HrEmployeeSyncDto> Handle(SyncHrEmployeesCommand request, CancellationToken cancellationToken)
    {
        var link = await links.GetAsync(cancellationToken);
        var (url, key) = HrLinks.Calling(link, protector, mustBeOn: true);
        IReadOnlyList<HrEmployeeRecord> records;
        try
        {
            records = await gateway.EmployeesAsync(url, key, cancellationToken);
        }
        catch (Exception ex) when (ex is HrRefusedException or HrUnavailableException)
        {
            await journal.WriteAsync(new HrSyncLog(HrSyncDirection.Outbound, "employees", HrSyncOutcome.Failed, ex.Message), cancellationToken);
            throw new DomainException($"HR's employees could not be read: {ex.Message} The ones kept here stay as they were.");
        }

        var known = (await synced.GetAllAsync(cancellationToken)).ToDictionary(e => e.HrEmployeeId);
        var members = (await staff.GetAllAsync(cancellationToken)).ToDictionary(m => m.Id);
        var linked = known.Values.Select(e => e.StaffMemberId).ToHashSet();
        var (added, updated, left) = (0, 0, 0);
        foreach (var record in records.Where(r => r.EmployeeId != Guid.Empty).DistinctBy(r => r.EmployeeId))
        {
            if (!known.TryGetValue(record.EmployeeId, out var employee))
            {
                // One of the same name kept here before the link: theirs, not made again.
                var member = members.Values.FirstOrDefault(m => !linked.Contains(m.Id)
                    && string.Equals(m.Name.Trim(), record.FullName.Trim(), StringComparison.OrdinalIgnoreCase));
                if (member is null)
                {
                    member = new StaffMember(Guid.NewGuid(), record.FullName, record.Department);
                    staff.Add(member);
                    members[member.Id] = member;
                }
                linked.Add(member.Id);
                employee = new SyncedEmployee(Guid.NewGuid(), record.EmployeeId, member.Id);
                synced.Add(employee);
                added++;
                employee.Update(record.Code, record.FullName, record.Department, record.Branch, record.IsActive);
            }
            else if (employee.Update(record.Code, record.FullName, record.Department, record.Branch, record.IsActive))
            {
                updated++;
            }

            if (members.GetValueOrDefault(employee.StaffMemberId) is { } kept)
            {
                kept.Change(employee.FullName, employee.Department ?? kept.JobTitle);
                if (record.IsActive)
                    kept.Reactivate();
                else
                    kept.Deactivate();
            }
        }

        var listed = records.Select(r => r.EmployeeId).ToHashSet();
        foreach (var gone in known.Values.Where(e => e.IsActive && !listed.Contains(e.HrEmployeeId)))
        {
            gone.Gone();
            members.GetValueOrDefault(gone.StaffMemberId)?.Deactivate();
            left++;
        }

        link.Synced(records.Count(r => r.IsActive));
        await unitOfWork.SaveChangesAsync(cancellationToken);
        await journal.WriteAsync(new HrSyncLog(HrSyncDirection.Outbound, "employees", HrSyncOutcome.Read,
            $"{records.Count} employees read from HR: {added} new, {updated} changed, {left} left."), cancellationToken);
        return new HrEmployeeSyncDto(records.Count, added, updated, left, link.EmployeesSyncedAtUtc!.Value);
    }
}

internal sealed class RetryHrOutboxHandler(IHrOutboxRepository outbox, IUnitOfWork unitOfWork) : IRequestHandler<RetryHrOutboxCommand, HrOutboxItemDto>
{
    public async Task<HrOutboxItemDto> Handle(RetryHrOutboxCommand request, CancellationToken cancellationToken)
    {
        var item = await outbox.GetByIdAsync(request.ItemId, cancellationToken) ?? throw new NotFoundException("Item to send", request.ItemId);
        item.Retry();
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return HrOutboxItemDto.From(item);
    }
}

// ---- What is sent to HR: the outbox ----

// HR's endpoints for what is sent: /api/integrations/costing/{kind}.
public static class HrCalls
{
    public const string Advance = "employee-advance";
    public const string Deduction = "employee-deduction";
    public const string PayrollSettled = "payroll-settled";
}

// Queued with the record that makes it, in the same unit of work: an advance paid, a deduction, a
// payroll paid; and their voids. Only while the link is on, and only for an employee from HR (one
// kept only here is HR's to know nothing of).
internal sealed class HrOutbox(IHrLinkStore links, ISyncedEmployeeRepository synced, IHrOutboxRepository outbox, IEndOfDayRepository days)
{
    private const string Advance = HrCalls.Advance;
    private const string Deduction = HrCalls.Deduction;
    private const string PayrollSettled = HrCalls.PayrollSettled;

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

    // An advance paid out of the safe, or its void: the end of the day's with its signed receipt.
    public async Task AdvanceAsync(SafeTransaction entry, bool voided, CancellationToken cancellationToken)
    {
        if (entry.EmployeeId is not { } staffId || !await OnAsync(cancellationToken))
            return;
        if (await synced.GetByStaffMemberAsync(staffId, cancellationToken) is not { } employee)
            return;
        // From the end of the day: its own note and signed receipt, the day being said as the source.
        var payout = (await days.GetByPayoutAsync(entry.Id, cancellationToken))?.Payouts.FirstOrDefault(p => p.Id == entry.Id);
        var receipt = voided ? null : payout?.Receipt;
        var payload = new
        {
            idempotencyKey = entry.Id,
            action = voided ? "void" : "create",
            employeeId = employee.HrEmployeeId,
            employeeCode = employee.Code,
            employeeName = employee.FullName,
            date = entry.BusinessDate.ToString("yyyy-MM-dd", Invariant),
            amount = -entry.Amount,
            notes = payout is null ? entry.Notes : payout.Note,
            source = entry.RevenueDate is { } day ? $"End of day {day.ToString("yyyy-MM-dd", Invariant)}" : "Safe",
            receipt = receipt is null ? null : new { photoId = entry.Id, receipt.FileName, receipt.ContentType },
        };
        Queue(Advance, voided, entry.Id, payload,
            $"{(voided ? "Void advance" : "Advance")} · {employee.FullName} · {CompanyMoney.Text(-entry.Amount)} · {entry.BusinessDate.ToString("d MMM", Invariant)}");
    }

    public async Task DeductionAsync(StaffDeduction deduction, bool voided, CancellationToken cancellationToken)
    {
        if (!await OnAsync(cancellationToken) || await synced.GetByStaffMemberAsync(deduction.EmployeeId, cancellationToken) is not { } employee)
            return;
        var payload = new
        {
            idempotencyKey = deduction.Id,
            action = voided ? "void" : "create",
            employeeId = employee.HrEmployeeId,
            employeeCode = employee.Code,
            employeeName = employee.FullName,
            date = deduction.Date.ToString("yyyy-MM-dd", Invariant),
            amount = deduction.Amount,
            kind = deduction.Kind.ToString(),
            reason = deduction.Reason,
        };
        var what = deduction.Kind == StaffDeductionKind.TillShortage ? "Till shortage" : "Staff charge";
        Queue(Deduction, voided, deduction.Id, payload, $"{(voided ? "Void " + what.ToLowerInvariant() : what)} · {employee.FullName} · {CompanyMoney.Text(deduction.Amount)}");
    }

    // A payroll from HR paid out of the safe, or that payment voided.
    public async Task PayrollAsync(PayrollRun run, SafeTransaction entry, bool voided, CancellationToken cancellationToken)
    {
        if (!await OnAsync(cancellationToken))
            return;
        var payload = new
        {
            idempotencyKey = run.Id,
            action = voided ? "void" : "create",
            payrollPeriod = run.Period.ToString("yyyy-MM", Invariant),
            safeVoucherId = entry.Id,
            amount = -entry.Amount,
            disbursedOn = entry.BusinessDate.ToString("yyyy-MM-dd", Invariant),
            disbursedAtUtc = entry.RecordedAtUtc,
            disbursedBy = entry.RecordedBy,
        };
        Queue(PayrollSettled, voided, run.Id, payload, $"{(voided ? "Payroll payment voided" : "Payroll paid")} · {run.PeriodName} · {CompanyMoney.Text(-entry.Amount)}");
    }

    private async Task<bool> OnAsync(CancellationToken cancellationToken) => (await links.GetAsync(cancellationToken)).Enabled;

    private void Queue(string kind, bool voided, Guid key, object payload, string summary) =>
        outbox.Add(new HrOutboxItem(Guid.NewGuid(), kind, voided ? "void" : "create", key, JsonSerializer.Serialize(payload, Json), summary));
}

// ---- From HR: a payroll run approved there ----

public sealed record PayrollRunDepartmentInput(
    string Department, int Employees, decimal GrossWages, decimal Additions, decimal Penalties, decimal AdvancesDeducted, decimal NetCashPayable);

// As HR sends it: PayrollPeriod is the month, yyyy-MM; IdempotencyKey HR's id for the run, the same
// each time it is sent.
public sealed record PayrollRunInput(
    Guid IdempotencyKey,
    string PayrollPeriod,
    int Employees,
    decimal TotalGrossWages,
    decimal TotalAdditions,
    decimal TotalAdvancesDeducted,
    decimal TotalPenalties,
    decimal NetCashPayable,
    IReadOnlyList<PayrollRunDepartmentInput>? Departments,
    decimal TotalBroughtForward = 0);

public sealed record PayrollRunDepartmentDto(
    string Name, int Employees, decimal GrossWages, decimal Additions, decimal Penalties, decimal AdvancesDeducted, decimal NetCashPayable, decimal LaborCost);

public sealed record PayrollRunDto(
    Guid Id,
    DateOnly Period,
    int Employees,
    decimal TotalGrossWages,
    decimal TotalAdditions,
    decimal TotalPenalties,
    decimal TotalAdvancesDeducted,
    decimal TotalBroughtForward,
    decimal NetCashPayable,
    decimal LaborCost,
    PayrollRunStatus Status,
    int Revision,
    DateTime ReceivedAtUtc,
    DateTime UpdatedAtUtc,
    Guid? SafeTransactionId,
    DateTime? DisbursedAtUtc,
    string? DisbursedBy,
    // A payment of it asked of a manager and not decided yet.
    bool PaymentRequested,
    IReadOnlyList<PayrollRunDepartmentDto> Departments)
{
    public static PayrollRunDto From(PayrollRun r, bool requested = false) => new(
        r.Id, r.Period, r.Employees, r.TotalGrossWages, r.TotalAdditions, r.TotalPenalties, r.TotalAdvancesDeducted, r.TotalBroughtForward,
        r.NetCashPayable, r.LaborCost, r.Status, r.Revision, r.ReceivedAtUtc, r.UpdatedAtUtc, r.SafeTransactionId, r.DisbursedAtUtc, r.DisbursedBy,
        requested,
        r.Departments.Select(d => new PayrollRunDepartmentDto(
            d.Name, d.Employees, d.GrossWages, d.Additions, d.Penalties, d.AdvancesDeducted, d.NetCashPayable, d.LaborCost)).ToList());
}

public sealed record PayrollRunResultDto(HrSyncOutcome Outcome, Guid Id, DateOnly Period, decimal NetCashPayable, decimal LaborCost);

public sealed record ReceivePayrollRunCommand(PayrollRunInput Run) : IRequest<PayrollRunResultDto>, IRetryOnConflict;

internal sealed class ReceivePayrollRunHandler(IPayrollRunRepository runs, IHrSyncJournal journal, IUnitOfWork unitOfWork)
    : IRequestHandler<ReceivePayrollRunCommand, PayrollRunResultDto>
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<PayrollRunResultDto> Handle(ReceivePayrollRunCommand request, CancellationToken cancellationToken)
    {
        var input = request.Run;
        try
        {
            var result = await RecordAsync(input, cancellationToken);
            await journal.WriteAsync(new HrSyncLog(HrSyncDirection.Inbound, "payroll-run", result.Outcome,
                $"Payroll of {result.Period.ToString("MMMM yyyy", CultureInfo.InvariantCulture)}: labor cost {CompanyMoney.Text(result.LaborCost)}, " +
                $"net cash payable {CompanyMoney.Text(result.NetCashPayable)}.", result.Id), cancellationToken);
            return result;
        }
        catch (DomainException ex)
        {
            await journal.WriteAsync(new HrSyncLog(HrSyncDirection.Inbound, "payroll-run", HrSyncOutcome.Refused, ex.Message, input.IdempotencyKey), cancellationToken);
            throw;
        }
    }

    private async Task<PayrollRunResultDto> RecordAsync(PayrollRunInput input, CancellationToken cancellationToken)
    {
        if (input.IdempotencyKey == Guid.Empty)
            throw new DomainException("A payroll run needs its idempotency key, HR's id for it.");
        if (!DateOnly.TryParseExact(input.PayrollPeriod + "-01", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var period))
            throw new DomainException("The payroll period is a month, as 2026-10.");
        var departments = (input.Departments ?? [])
            .Select(d => new PayrollRunDepartment(d.Department, d.Employees, d.GrossWages, d.Additions, d.Penalties, d.AdvancesDeducted, d.NetCashPayable))
            .ToList();
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(input with { IdempotencyKey = Guid.Empty }, Json))))
            .ToLowerInvariant();

        var run = await runs.GetByIdAsync(input.IdempotencyKey, cancellationToken);
        if (run is not null && run.PayloadHash == hash)
            return Result(run, HrSyncOutcome.Unchanged);

        // Another run of the same month: replaced while it is still to be paid; once paid, refused.
        if (await runs.GetForPeriodAsync(period, cancellationToken) is { } other && other.Id != input.IdempotencyKey)
        {
            if (other.IsDisbursed)
                throw new DomainException($"The payroll of {other.PeriodName} is paid out of the safe already, as another run: void that payment first.");
            runs.Remove(other);
        }

        var outcome = run is null ? HrSyncOutcome.Recorded : HrSyncOutcome.Updated;
        if (run is null)
        {
            run = new PayrollRun(input.IdempotencyKey, period, hash);
            runs.Add(run);
        }
        else if (run.Period != PayrollRun.Month(period))
        {
            throw new DomainException("A payroll run keeps its month: send the other month as a run of its own.");
        }
        run.Set(input.Employees, input.TotalGrossWages, input.TotalAdditions, input.TotalPenalties, input.TotalAdvancesDeducted, input.TotalBroughtForward,
            input.NetCashPayable, departments, hash);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result(run, outcome);
    }

    private static PayrollRunResultDto Result(PayrollRun run, HrSyncOutcome outcome) => new(outcome, run.Id, run.Period, run.NetCashPayable, run.LaborCost);
}

public sealed record GetPayrollRunsQuery : IRequest<IReadOnlyList<PayrollRunDto>>;

internal sealed class GetPayrollRunsHandler(IPayrollRunRepository runs, IApprovalRequestRepository requests) : IRequestHandler<GetPayrollRunsQuery, IReadOnlyList<PayrollRunDto>>
{
    public async Task<IReadOnlyList<PayrollRunDto>> Handle(GetPayrollRunsQuery request, CancellationToken cancellationToken)
    {
        var list = new List<PayrollRunDto>();
        foreach (var run in await runs.GetRecentAsync(24, cancellationToken))
            list.Add(PayrollRunDto.From(run, !run.IsDisbursed && await requests.GetPendingForAsync(run.Id, cancellationToken) is not null));
        return list;
    }
}

// A payroll from HR paid out of the safe in one entry, its net cash payable: a manager's at once,
// anyone else's asked of a manager. TransactionId (the entry's) and RequestId are made by the app.
public sealed record DisbursePayrollRunCommand(Guid RunId, Guid TransactionId, Guid RequestId, string StaffId, string StaffName, bool CanApprove)
    : IRequest<SafeVoucherResultDto>, IRetryOnConflict;

internal sealed class DisbursePayrollRunHandler(
    IPayrollRunRepository runs, TreasuryWriter treasury, ISafeTransactionRepository safe, IApprovalRequestRepository requests, IUnitOfWork unitOfWork)
    : IRequestHandler<DisbursePayrollRunCommand, SafeVoucherResultDto>
{
    public async Task<SafeVoucherResultDto> Handle(DisbursePayrollRunCommand request, CancellationToken cancellationToken)
    {
        if (await safe.GetByIdAsync(request.TransactionId, cancellationToken) is { } made)
            return new SafeVoucherResultDto(ApprovalOutcome.Applied, SafeTransactionDto.From(made), null);
        if (await requests.GetByIdAsync(request.RequestId, cancellationToken) is { } already)
            return new SafeVoucherResultDto(ApprovalOutcome.Requested, null, ApprovalRequestDto.From(already));
        var run = await runs.GetByIdAsync(request.RunId, cancellationToken) ?? throw new NotFoundException("Payroll run", request.RunId);
        if (run.NetCashPayable <= 0)
            throw new DomainException($"Nothing is left to pay of the payroll of {run.PeriodName}: the advances covered it. · لا يوجد صافي مستحق.");
        if (await requests.GetPendingForAsync(run.Id, cancellationToken) is not null)
            throw new DomainException($"Paying the payroll of {run.PeriodName} is asked of a manager already. · طلب الصرف بانتظار الموافقة.");

        var voucher = new SafeVoucher(
            request.TransactionId, SafeTransactionKind.PayrollPayment, run.NetCashPayable, treasury.Today,
            Notes: $"Payroll of {run.PeriodName} from HR · مسير رواتب", PayrollMonth: run.Period, PayrollRunId: run.Id);
        if (request.CanApprove)
        {
            var entry = await treasury.ApplyAsync(voucher, request.StaffName, null, cancellationToken);
            await unitOfWork.SaveChangesAsync(cancellationToken);
            return new SafeVoucherResultDto(ApprovalOutcome.Applied, SafeTransactionDto.From(entry), null);
        }

        await treasury.CheckAsync(voucher, cancellationToken);
        var (summary, changes) = await treasury.DescribeAsync(voucher, cancellationToken);
        var asked = ApprovalRequest.AskToChange(
            request.RequestId, ApprovalModule.Treasury, ApprovalAction.Create, run.Id, summary, changes, ApprovalPayload.Write(voucher), null,
            request.StaffId, request.StaffName);
        requests.Add(asked);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return new SafeVoucherResultDto(ApprovalOutcome.Requested, null, ApprovalRequestDto.From(asked));
    }
}

// ---- Deductions charged to an employee ----

public sealed record StaffDeductionDto(
    Guid Id, Guid EmployeeId, string Employee, DateOnly Date, StaffDeductionKind Kind, decimal Amount, string? Reason, string RecordedBy,
    DateTime RecordedAtUtc, DateTime? VoidedAtUtc, string? VoidedBy, bool FromHr);

public sealed record GetStaffDeductionsQuery(DateOnly From, DateOnly To) : IRequest<IReadOnlyList<StaffDeductionDto>>;

// Made by the app (Id), so one sent again is recorded once.
public sealed record RecordStaffDeductionCommand(
    Guid Id, Guid EmployeeId, DateOnly Date, StaffDeductionKind Kind, decimal Amount, string? Reason, string StaffName) : IRequest<StaffDeductionDto>;

public sealed record VoidStaffDeductionCommand(Guid Id, string StaffName) : IRequest<StaffDeductionDto>;

internal sealed class StaffDeductionReading(IStaffMemberRepository staff, ISyncedEmployeeRepository synced)
{
    public async Task<IReadOnlyList<StaffDeductionDto>> DtosAsync(IEnumerable<StaffDeduction> list, CancellationToken cancellationToken)
    {
        var names = (await staff.GetAllAsync(cancellationToken)).ToDictionary(m => m.Id, m => m.Name);
        var fromHr = (await synced.GetAllAsync(cancellationToken)).Select(e => e.StaffMemberId).ToHashSet();
        return list.OrderByDescending(d => d.Date).ThenByDescending(d => d.RecordedAtUtc)
            .Select(d => new StaffDeductionDto(
                d.Id, d.EmployeeId, names.GetValueOrDefault(d.EmployeeId, "A removed employee"), d.Date, d.Kind, d.Amount, d.Reason, d.RecordedBy,
                d.RecordedAtUtc, d.VoidedAtUtc, d.VoidedBy, fromHr.Contains(d.EmployeeId)))
            .ToList();
    }
}

internal sealed class GetStaffDeductionsHandler(IStaffDeductionRepository deductions, StaffDeductionReading reading)
    : IRequestHandler<GetStaffDeductionsQuery, IReadOnlyList<StaffDeductionDto>>
{
    public async Task<IReadOnlyList<StaffDeductionDto>> Handle(GetStaffDeductionsQuery request, CancellationToken cancellationToken)
    {
        if (request.To < request.From || request.To.DayNumber - request.From.DayNumber > 370)
            throw new DomainException("Choose a year at most, the first day before the last.");
        return await reading.DtosAsync(await deductions.GetBetweenAsync(request.From, request.To, cancellationToken), cancellationToken);
    }
}

internal sealed class RecordStaffDeductionHandler(
    IStaffDeductionRepository deductions, IStaffMemberRepository staff, HrOutbox hr, StaffDeductionReading reading, IUnitOfWork unitOfWork)
    : IRequestHandler<RecordStaffDeductionCommand, StaffDeductionDto>
{
    public async Task<StaffDeductionDto> Handle(RecordStaffDeductionCommand request, CancellationToken cancellationToken)
    {
        if (await deductions.GetByIdAsync(request.Id, cancellationToken) is { } made)
            return (await reading.DtosAsync([made], cancellationToken))[0];
        var employee = await staff.GetByIdAsync(request.EmployeeId, cancellationToken)
            ?? throw new DomainException("Choose the employee from the list. · اختر الموظف من القائمة.");
        if (!employee.IsActive)
            throw new DomainException($"{employee.Name} has left: a deduction goes on the pay of someone still here.");
        var deduction = new StaffDeduction(request.Id, request.EmployeeId, request.Date, request.Kind, request.Amount, request.Reason, request.StaffName);
        deductions.Add(deduction);
        await hr.DeductionAsync(deduction, voided: false, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return (await reading.DtosAsync([deduction], cancellationToken))[0];
    }
}

internal sealed class VoidStaffDeductionHandler(IStaffDeductionRepository deductions, HrOutbox hr, StaffDeductionReading reading, IUnitOfWork unitOfWork)
    : IRequestHandler<VoidStaffDeductionCommand, StaffDeductionDto>
{
    public async Task<StaffDeductionDto> Handle(VoidStaffDeductionCommand request, CancellationToken cancellationToken)
    {
        var deduction = await deductions.GetByIdAsync(request.Id, cancellationToken) ?? throw new NotFoundException("Deduction", request.Id);
        deduction.Void(request.StaffName);
        await hr.DeductionAsync(deduction, voided: true, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return (await reading.DtosAsync([deduction], cancellationToken))[0];
    }
}
