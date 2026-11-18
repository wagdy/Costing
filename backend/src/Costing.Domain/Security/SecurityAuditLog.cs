using System.Globalization;

namespace Costing.Domain.Security;

// What is written to the security audit log (سجل التدقيق الأمني).
public enum SecurityAuditAction
{
    // The books closed until a day.
    PeriodLocked = 1,

    // The books' lock rolled back, or lifted, with why.
    PeriodUnlocked = 2,

    // The company's structure changed (its operating mode).
    OperatingModeChanged = 3,
}

// The security audit log: who did what to the system's safeguards, and when; kept, never changed
// or removed. Description is the line as it reads ("PeriodLocked: 31-Oct-2026 by Wagdy"); the
// values before and after, and the reason, kept apart as well, to be listed and searched.
public sealed class SecurityAuditLog
{
    public const int MaxByLength = 200;

    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

    private SecurityAuditLog() { }

    private SecurityAuditLog(SecurityAuditAction action, string description, string? previousValue, string? newValue, string? reason, string by,
        string? byUserId)
    {
        Id = Guid.NewGuid();
        OccurredAtUtc = DateTime.UtcNow;
        Action = action;
        Description = description;
        PreviousValue = previousValue;
        NewValue = newValue;
        Reason = reason;
        By = by;
        ByUserId = string.IsNullOrWhiteSpace(byUserId) ? null : byUserId;
    }

    public Guid Id { get; private set; }
    public DateTime OccurredAtUtc { get; private set; }
    public SecurityAuditAction Action { get; private set; }
    public string Description { get; private set; } = string.Empty;
    public string? PreviousValue { get; private set; }
    public string? NewValue { get; private set; }
    public string? Reason { get; private set; }
    public string By { get; private set; } = string.Empty;
    public string? ByUserId { get; private set; }

    // "PeriodLocked: 31-Oct-2026 by Wagdy".
    public static SecurityAuditLog PeriodLocked(DateOnly? previous, DateOnly until, string by, string? byUserId)
    {
        var who = Who(by);
        return new(SecurityAuditAction.PeriodLocked, $"PeriodLocked: {Day(until)} by {who}", Iso(previous), Iso(until), null, who, byUserId);
    }

    // "PeriodUnlocked: rolled back to 30-Sep-2026 by Wagdy. Reason: Auditor adjustment"; lifted
    // altogether, "PeriodUnlocked: lock lifted (was 31-Oct-2026) by Wagdy. Reason: …".
    public static SecurityAuditLog PeriodUnlocked(DateOnly previous, DateOnly? until, string reason, string by, string? byUserId)
    {
        var who = Who(by);
        return new(SecurityAuditAction.PeriodUnlocked,
            until is { } day
                ? $"PeriodUnlocked: rolled back to {Day(day)} by {who}. Reason: {reason}"
                : $"PeriodUnlocked: lock lifted (was {Day(previous)}) by {who}. Reason: {reason}",
            Iso(previous), Iso(until), reason, who, byUserId);
    }

    // "OperatingModeChanged: SingleBranch_OpenSpace → MultiBranch_Independent by Wagdy".
    public static SecurityAuditLog OperatingModeChanged(string previous, string mode, string by, string? byUserId)
    {
        var who = Who(by);
        return new(SecurityAuditAction.OperatingModeChanged, $"OperatingModeChanged: {previous} → {mode} by {who}", previous, mode, null, who, byUserId);
    }

    private static string Who(string? by) =>
        string.IsNullOrWhiteSpace(by) ? "(unknown)" : by.Trim()[..Math.Min(by.Trim().Length, MaxByLength)];

    private static string Day(DateOnly day) => day.ToString("dd-MMM-yyyy", Invariant);

    private static string? Iso(DateOnly? day) => day?.ToString("yyyy-MM-dd", Invariant);
}

// The log, added to only.
public interface ISecurityAuditLogRepository
{
    void Add(SecurityAuditLog entry);

    // The latest first.
    Task<IReadOnlyList<SecurityAuditLog>> GetLatestAsync(int count, CancellationToken cancellationToken = default);
}
