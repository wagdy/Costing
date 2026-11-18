using MediatR;
using Costing.Domain.Common;
using Costing.Domain.Company;
using Costing.Domain.EndOfDay;
using Costing.Domain.Security;

namespace Costing.Application.Books;

// Month-end close (إقفال الفترة المحاسبية): the books closed until a day, by a manager who types
// LOCK to confirm; rolled back, or lifted, by the owner alone (SettingsUnlockPeriods), with why.
// Each, and only each that is done, written to the security audit log.

public sealed record SecurityAuditEntryDto(
    Guid Id, DateTime OccurredAtUtc, SecurityAuditAction Action, string Description, string? PreviousValue, string? NewValue, string? Reason, string By)
{
    public static SecurityAuditEntryDto From(SecurityAuditLog entry) =>
        new(entry.Id, entry.OccurredAtUtc, entry.Action, entry.Description, entry.PreviousValue, entry.NewValue, entry.Reason, entry.By);
}

// LockedUntil: the books closed until; LastClosedDay: the last end of day closed, the latest a lock
// may go (none closed: today); SuggestedUntil: the latest month's end that can be closed now,
// past the lock; History: the lock's changes, the latest first.
public sealed record PeriodLockDto(
    DateOnly? LockedUntil,
    DateOnly Today,
    DateOnly? LastClosedDay,
    DateOnly? SuggestedUntil,
    IReadOnlyList<SecurityAuditEntryDto> History);

public sealed record GetPeriodLockQuery(int History = 20) : IRequest<PeriodLockDto>;

// A period closed. Confirmation: the word LOCK, typed.
public sealed record LockBooksCommand(DateOnly Until, string? Confirmation, string StaffId, string StaffName) : IRequest<PeriodLockDto>;

// An exceptional unlock: back to Until, or lifted (null); Reason, why.
public sealed record UnlockBooksCommand(DateOnly? Until, string? Reason, string StaffId, string StaffName) : IRequest<PeriodLockDto>;

internal sealed class PeriodLockReader(ICompanySettingsStore settings, IEndOfDayRepository days, ISecurityAuditLogRepository audit, BooksGuard guard)
{
    public async Task<PeriodLockDto> ReadAsync(int history, CancellationToken cancellationToken)
    {
        var locked = (await settings.GetAsync(cancellationToken))?.BooksLockedUntilDate;
        var today = guard.Today;
        var lastClosed = await days.LastSubmittedDateAsync(cancellationToken);
        return new PeriodLockDto(locked, today, lastClosed, BooksGuard.SuggestedClose(locked, today, lastClosed),
            (await audit.GetLatestAsync(Math.Clamp(history, 1, 200), cancellationToken)).Select(SecurityAuditEntryDto.From).ToList());
    }
}

internal sealed class GetPeriodLockHandler(PeriodLockReader reader) : IRequestHandler<GetPeriodLockQuery, PeriodLockDto>
{
    public Task<PeriodLockDto> Handle(GetPeriodLockQuery request, CancellationToken cancellationToken) =>
        reader.ReadAsync(request.History, cancellationToken);
}

internal sealed class LockBooksHandler(
    ICompanySettingsStore settings,
    IEndOfDayRepository days,
    ISecurityAuditLogRepository audit,
    BooksGuard guard,
    PeriodLockReader reader,
    IUnitOfWork unitOfWork) : IRequestHandler<LockBooksCommand, PeriodLockDto>
{
    public const string ConfirmationWord = "LOCK";

    public async Task<PeriodLockDto> Handle(LockBooksCommand request, CancellationToken cancellationToken)
    {
        if (!string.Equals(request.Confirmation?.Trim(), ConfirmationWord, StringComparison.Ordinal))
            throw new DomainException($"Type {ConfirmationWord} to confirm closing the books. · اكتب {ConfirmationWord} لتأكيد الإقفال.");
        var company = await settings.GetAsync(cancellationToken)
            ?? throw new DomainException("Save the company's settings first.");
        var previous = company.BooksLockedUntilDate;
        company.LockBooks(request.Until, guard.Today, await days.LastSubmittedDateAsync(cancellationToken));
        audit.Add(SecurityAuditLog.PeriodLocked(previous, request.Until, request.StaffName, request.StaffId));
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await reader.ReadAsync(20, cancellationToken);
    }
}

internal sealed class UnlockBooksHandler(
    ICompanySettingsStore settings,
    ISecurityAuditLogRepository audit,
    PeriodLockReader reader,
    IUnitOfWork unitOfWork) : IRequestHandler<UnlockBooksCommand, PeriodLockDto>
{
    public async Task<PeriodLockDto> Handle(UnlockBooksCommand request, CancellationToken cancellationToken)
    {
        var company = await settings.GetAsync(cancellationToken)
            ?? throw new DomainException("The books are not locked: there is nothing to unlock. · الدفاتر غير مقفلة.");
        var previous = company.BooksLockedUntilDate;
        var reason = company.UnlockBooks(request.Until, request.Reason);
        audit.Add(SecurityAuditLog.PeriodUnlocked(previous!.Value, request.Until, reason, request.StaffName, request.StaffId));
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await reader.ReadAsync(20, cancellationToken);
    }
}

// The lock as the company's settings keep it.
internal sealed class CompanyBooksLock(ICompanySettingsStore settings) : IBooksLock
{
    public async Task<DateOnly?> LockedUntilAsync(CancellationToken cancellationToken) =>
        (await settings.GetAsync(cancellationToken))?.BooksLockedUntilDate;
}
