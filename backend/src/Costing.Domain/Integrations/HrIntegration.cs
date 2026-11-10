using Costing.Domain.Common;

namespace Costing.Domain.Integrations;

// The HR & payroll system, linked (ربط الموارد البشرية), both ways and only when it is switched on:
// this system reads HR's employees and is sent each payroll run HR approves; HR is sent each
// advance paid out of the safe here, each deduction charged to an employee, and each payroll paid
// out of the safe. Unlinked, or switched off, nothing is sent or read, and every screen works on
// the staff kept here.
//
// Two keys, one each way: HR's (HrKey), made on HR and pasted here, which this system calls HR
// with, kept encrypted (HrKeyProtected, by the data protection keys of this server, never in
// plain); and this system's (KeyHash), made here and pasted into HR, which HR calls this system
// with, kept only as its hash.
public sealed class HrLink : AggregateRoot
{
    public static readonly Guid SingletonId = new("3b8a5f20-9c41-4e6d-8a77-2f10c4d9e6b1");
    public const int HashLength = 64;
    public const int HintLength = 12;
    public const int MaxUrlLength = 300;

    private HrLink() { }

    public static HrLink Create() => new() { Id = SingletonId };

    public bool Enabled { get; private set; }
    public string? BaseUrl { get; private set; }

    // HR's key, encrypted; and its last characters, to tell which one it is.
    public string? HrKeyProtected { get; private set; }
    public string? HrKeyHint { get; private set; }

    // This system's key for HR: its hash and its last characters.
    public string? KeyHash { get; private set; }
    public string? KeyHint { get; private set; }
    public DateTime? KeyCreatedAtUtc { get; private set; }
    public string? KeyCreatedBy { get; private set; }

    public DateTime? EmployeesSyncedAtUtc { get; private set; }
    public int EmployeesSynced { get; private set; }

    public DateTime? UpdatedAtUtc { get; private set; }
    public string? UpdatedBy { get; private set; }

    public bool HasKey => KeyHash is not null;

    // Ready to call HR: switched on, its address and its key given.
    public bool IsReady => Enabled && BaseUrl is not null && HrKeyProtected is not null;

    // Switched on or off, HR's address, and HR's key when a new one is given (kept as it was when
    // none is). Switched on, it needs both.
    public void Configure(bool enabled, string? baseUrl, string? hrKeyProtected, string? hrKeyHint, string by)
    {
        var url = string.IsNullOrWhiteSpace(baseUrl) ? null : baseUrl.Trim().TrimEnd('/');
        if (url is not null)
        {
            if (url.Length > MaxUrlLength)
                throw new DomainException("Keep HR's address under 300 characters.");
            if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
                throw new DomainException("HR's address starts with http:// or https://, as https://hr.example.com. · عنوان الموارد البشرية يبدأ بـ https://");
        }
        if (hrKeyProtected is not null)
            (HrKeyProtected, HrKeyHint) = (hrKeyProtected, hrKeyHint?.Length > HintLength ? hrKeyHint[^HintLength..] : hrKeyHint);
        if (enabled && (url is null || HrKeyProtected is null))
            throw new DomainException("To switch the link on, give HR's address and HR's key. · أدخل عنوان الموارد البشرية ومفتاحها أولاً.");
        Enabled = enabled;
        BaseUrl = url;
        UpdatedAtUtc = DateTime.UtcNow;
        UpdatedBy = by;
    }

    // A new key for HR: the one before stops working at once.
    public void SetKey(string hash, string hint, string by)
    {
        if (hash.Length != HashLength)
            throw new DomainException("A key's hash is 64 hex characters.");
        KeyHash = hash;
        KeyHint = hint.Length > HintLength ? hint[^HintLength..] : hint;
        KeyCreatedAtUtc = DateTime.UtcNow;
        KeyCreatedBy = by;
    }

    public void Synced(int employees)
    {
        EmployeesSynced = employees;
        EmployeesSyncedAtUtc = DateTime.UtcNow;
    }
}

// An employee as HR has them, kept here so the lists that choose one work at once, even with HR
// out of reach: their HR id and code, name, department, branch and whether they still work. Each
// is a staff member here too (StaffMemberId), as the safe's advances and salaries name staff.
public sealed class SyncedEmployee : AggregateRoot
{
    public const int MaxNameLength = 200;
    public const int MaxCodeLength = 50;

    private SyncedEmployee() { }

    public SyncedEmployee(Guid id, Guid hrEmployeeId, Guid staffMemberId)
    {
        if (hrEmployeeId == Guid.Empty)
            throw new DomainException("An employee from HR needs HR's id for them.");
        Id = id;
        HrEmployeeId = hrEmployeeId;
        StaffMemberId = staffMemberId;
    }

    public Guid HrEmployeeId { get; private set; }
    public Guid StaffMemberId { get; private set; }
    public string? Code { get; private set; }
    public string FullName { get; private set; } = string.Empty;
    public string? Department { get; private set; }
    public string? Branch { get; private set; }
    public bool IsActive { get; private set; }
    public DateTime SyncedAtUtc { get; private set; }

    // As HR has them now; whether anything changed.
    public bool Update(string? code, string fullName, string? department, string? branch, bool isActive)
    {
        var name = fullName?.Trim();
        if (string.IsNullOrEmpty(name))
            throw new DomainException("An employee from HR needs a name.");
        name = name.Length > MaxNameLength ? name[..MaxNameLength] : name;
        var (newCode, newDepartment, newBranch) = (Short(code, MaxCodeLength), Short(department, 100), Short(branch, 100));
        var changed = name != FullName || newCode != Code || newDepartment != Department || newBranch != Branch || isActive != IsActive;
        (FullName, Code, Department, Branch, IsActive) = (name, newCode, newDepartment, newBranch, isActive);
        SyncedAtUtc = DateTime.UtcNow;
        return changed;
    }

    // No longer on HR's list: left.
    public void Gone()
    {
        IsActive = false;
        SyncedAtUtc = DateTime.UtcNow;
    }

    private static string? Short(string? value, int max) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim() is { } v && v.Length > max ? v[..max] : value.Trim();
}

public enum HrSyncDirection
{
    // HR called this system.
    Inbound = 1,

    // This system called HR.
    Outbound = 2,
}

public enum HrSyncOutcome
{
    // Read: the link tested, the employees listed.
    Read = 1,

    // Taken in: a payroll run recorded, or the same one again (Unchanged), or changed (Updated).
    Recorded = 2,
    Unchanged = 3,
    Updated = 4,

    // Sent to HR, and HR took it.
    Sent = 5,

    // Not taken, and nothing recorded: why is in the message.
    Refused = 6,

    // Could not be done now: HR out of reach, or an error; tried again.
    Failed = 7,

    // A call without this system's key, or with a wrong one.
    Unauthorized = 8,
}

// Each call between the two systems, either way, refused ones too: what, when, how it went.
public sealed class HrSyncLog
{
    public const int MaxMessageLength = 500;

    private HrSyncLog() { }

    public HrSyncLog(HrSyncDirection direction, string call, HrSyncOutcome outcome, string message, Guid? reference = null, string? detail = null)
    {
        Id = Guid.NewGuid();
        AtUtc = DateTime.UtcNow;
        Direction = direction;
        Call = call.Length > 60 ? call[..60] : call;
        Outcome = outcome;
        Message = message.Length > MaxMessageLength ? message[..MaxMessageLength] : message;
        Reference = reference;
        Detail = detail is { Length: > 2000 } ? detail[..2000] : detail;
    }

    public Guid Id { get; private set; }
    public DateTime AtUtc { get; private set; }
    public HrSyncDirection Direction { get; private set; }
    public string Call { get; private set; } = string.Empty;
    public HrSyncOutcome Outcome { get; private set; }
    public string Message { get; private set; } = string.Empty;
    public Guid? Reference { get; private set; }
    public string? Detail { get; private set; }
}

public enum HrOutboxStatus
{
    // Waiting to be sent, or to be tried again (NextAttemptAtUtc).
    Pending = 1,

    // HR took it.
    Sent = 2,

    // HR refused it, saying why: kept, to be sent again by hand once put right.
    Failed = 3,
}

// What waits to be sent to HR, oldest first, each once: an advance, its void, a deduction, a
// payroll paid. IdempotencyKey is the record's own id here (the advance's safe entry, the
// deduction, the payroll run), the same each time it is sent, so HR keeps it once; Action says
// whether it is made or voided. Out of reach, it is tried again from 15 seconds, doubling, up to
// 10 minutes apart.
public sealed class HrOutboxItem : AggregateRoot
{
    public const int MaxSummaryLength = 200;

    private HrOutboxItem() { }

    public HrOutboxItem(Guid id, string kind, string action, Guid idempotencyKey, string payload, string summary)
    {
        Id = id;
        Kind = kind;
        Action = action;
        IdempotencyKey = idempotencyKey;
        Payload = payload;
        Summary = summary.Length > MaxSummaryLength ? summary[..MaxSummaryLength] : summary;
        Status = HrOutboxStatus.Pending;
        CreatedAtUtc = NextAttemptAtUtc = DateTime.UtcNow;
    }

    // employee-advance, employee-deduction or payroll-settled: the HR endpoint it goes to.
    public string Kind { get; private set; } = string.Empty;

    // create or void.
    public string Action { get; private set; } = string.Empty;
    public Guid IdempotencyKey { get; private set; }
    public string Payload { get; private set; } = string.Empty;
    public string Summary { get; private set; } = string.Empty;
    public HrOutboxStatus Status { get; private set; }
    public int Attempts { get; private set; }
    public DateTime NextAttemptAtUtc { get; private set; }
    public string? LastError { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime? SentAtUtc { get; private set; }

    public void Delivered()
    {
        Attempts++;
        Status = HrOutboxStatus.Sent;
        SentAtUtc = DateTime.UtcNow;
        LastError = null;
    }

    // Out of reach: again later, from 15 seconds, doubling, up to 10 minutes apart.
    public void Postponed(string error)
    {
        Attempts++;
        LastError = Trim(error);
        var wait = TimeSpan.FromSeconds(Math.Min(600, 15 * Math.Pow(2, Math.Min(Attempts - 1, 10))));
        NextAttemptAtUtc = DateTime.UtcNow + wait;
    }

    // Refused by HR: kept, to be sent again once put right.
    public void Refused(string error)
    {
        Attempts++;
        Status = HrOutboxStatus.Failed;
        LastError = Trim(error);
    }

    public void Retry()
    {
        if (Status == HrOutboxStatus.Sent)
            throw new DomainException("It was sent already.");
        Status = HrOutboxStatus.Pending;
        NextAttemptAtUtc = DateTime.UtcNow;
    }

    private static string Trim(string error) => error.Length > 500 ? error[..500] : error;
}

public interface IHrLinkStore
{
    // The link, made the first time it is asked for.
    Task<HrLink> GetAsync(CancellationToken cancellationToken = default);
}

public interface ISyncedEmployeeRepository : IRepository<SyncedEmployee>
{
    Task<IReadOnlyList<SyncedEmployee>> GetAllAsync(CancellationToken cancellationToken = default);

    Task<SyncedEmployee?> GetByStaffMemberAsync(Guid staffMemberId, CancellationToken cancellationToken = default);
}

public interface IHrOutboxRepository : IRepository<HrOutboxItem>
{
    // Due now, oldest first.
    Task<IReadOnlyList<HrOutboxItem>> GetDueAsync(DateTime nowUtc, int take, CancellationToken cancellationToken = default);

    // The latest, of every status, newest first.
    Task<IReadOnlyList<HrOutboxItem>> GetRecentAsync(int take, CancellationToken cancellationToken = default);

    Task<int> CountAsync(HrOutboxStatus status, CancellationToken cancellationToken = default);
}

// Written apart from the call's own work: a refused or failed call is logged all the same.
public interface IHrSyncJournal
{
    Task WriteAsync(HrSyncLog entry, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<HrSyncLog>> RecentAsync(int count, CancellationToken cancellationToken = default);
}
