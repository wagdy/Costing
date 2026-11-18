using MediatR;
using Costing.Application.Common;
using Costing.Domain.Common;

namespace Costing.Application.Books;

// The firewall of the books closed (إقفال الفترة المحاسبية وتجميد الدفاتر): whatever writes to the
// ledgers of money and stock (invoices, sales, the end of day, the safe, waste, counts, production,
// fixed assets, payroll) says the business days it writes on, or whose records it changes or
// voids; on or before the day the books are closed until, it is refused whole, before anything is
// done, as PeriodLockedException (423 Locked).
//
// A request says its days in up to three ways, together: the days it carries (BooksDays), the
// business day now (WritesToday: what is posted as it happens: waste, a count, a batch), and the
// days of the records it names, looked up by an IBooksDays<T> of its own. A request that writes
// nothing to the books (the menu, recipes, materials, users) is not an IBooksEntry; the
// classification test holds every command to one or the other.
public interface IBooksEntry
{
    IEnumerable<DateOnly?> BooksDays => [];

    bool WritesToday => false;
}

// A request that writes to the books but checks the lock in its own handler, where its refusal is
// logged for whoever sent it: the POS's Z report, HR's payroll run, the undo of the last day closed.
public interface IChecksBooksItself;

// The days of the records a request names, looked up: the invoice it posts or voids, the sale it
// refunds, the request it approves.
public interface IBooksDays<in TRequest>
{
    Task<IEnumerable<DateOnly?>> DaysAsync(TRequest request, CancellationToken cancellationToken);
}

// The day the books are closed until; null when none are.
public interface IBooksLock
{
    Task<DateOnly?> LockedUntilAsync(CancellationToken cancellationToken);
}

// The check itself, for the pipeline and for what checks for itself: a webhook that logs its
// refusals, a monthly figure saved outside the pipeline.
public sealed class BooksGuard(IBooksLock books, IBusinessCalendar calendar)
{
    public DateOnly Today => calendar.BusinessDateOf(DateTime.UtcNow);

    public Task<DateOnly?> LockedUntilAsync(CancellationToken cancellationToken) => books.LockedUntilAsync(cancellationToken);

    public async Task EnsureOpenAsync(IEnumerable<DateOnly?> days, CancellationToken cancellationToken)
    {
        if (await books.LockedUntilAsync(cancellationToken) is { } locked)
            EnsureOpen(locked, days);
    }

    // A month's figure (its expenses, its payroll, its sales sheet) is the month's last day: the
    // month closed once the books are closed through its end.
    public Task EnsureMonthOpenAsync(int year, int month, CancellationToken cancellationToken) =>
        EnsureOpenAsync([MonthEnd(year, month)], cancellationToken);

    public static DateOnly MonthEnd(int year, int month) => new DateOnly(year, month, 1).AddMonths(1).AddDays(-1);

    // The month to close next: the latest month's end on or before what may be locked (today, and
    // the last end of day closed), past the lock; none while the next month's end is still to come.
    public static DateOnly? SuggestedClose(DateOnly? locked, DateOnly today, DateOnly? lastClosed)
    {
        var cap = lastClosed is { } last && last < today ? last : today;
        var monthEnd = MonthEnd(cap.Year, cap.Month);
        if (monthEnd > cap)
            monthEnd = new DateOnly(cap.Year, cap.Month, 1).AddDays(-1);
        return locked is { } l && monthEnd <= l ? null : monthEnd;
    }

    public static void EnsureOpen(DateOnly locked, IEnumerable<DateOnly?> days)
    {
        DateOnly? closed = null;
        foreach (var day in days)
        {
            if (day is { } d && d <= locked && (closed is null || d < closed))
                closed = d;
        }
        if (closed is { } first)
            throw new PeriodLockedException(locked, first);
    }
}

// The firewall in the pipeline: before the handler, so nothing is touched when it refuses. With the
// books open, no record is looked up.
internal sealed class BooksLockBehavior<TRequest, TResponse>(BooksGuard guard, IEnumerable<IBooksDays<TRequest>> lookups)
    : IPipelineBehavior<TRequest, TResponse>
    where TRequest : notnull
{
    public async Task<TResponse> Handle(TRequest request, RequestHandlerDelegate<TResponse> next, CancellationToken cancellationToken)
    {
        if (request is IBooksEntry entry && await guard.LockedUntilAsync(cancellationToken) is { } locked)
        {
            var days = new List<DateOnly?>(entry.BooksDays);
            if (entry.WritesToday)
                days.Add(guard.Today);
            foreach (var lookup in lookups)
                days.AddRange(await lookup.DaysAsync(request, cancellationToken));
            BooksGuard.EnsureOpen(locked, days);
        }
        return await next(cancellationToken);
    }
}
