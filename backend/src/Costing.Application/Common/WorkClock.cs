namespace Costing.Application.Common;

// The business's clock, in its own time zone: the business day a moment belongs to (a night past
// midnight still the evening's day until the day starts), and its calendar date on the wall.
public interface IBusinessCalendar
{
    DateOnly BusinessDateOf(DateTime utc);

    // The calendar date on the wall: after midnight, a day ahead of the business day until it starts.
    DateOnly LocalDateOf(DateTime utc);

    DateTime ToLocal(DateTime utc);

    // A wall-clock time as UTC; one skipped by a daylight-saving change, the hour after it.
    DateTime ToUtc(DateTime local);

    // The day's span in UTC: [FromUtc, ToUtc).
    (DateTime FromUtc, DateTime ToUtc) Bounds(DateOnly businessDate);
}
