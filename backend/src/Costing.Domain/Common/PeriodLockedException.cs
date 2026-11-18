using System.Globalization;

namespace Costing.Domain.Common;

// Refused: the request writes on, changes or voids a day in the books locked (إقفال الفترة
// المحاسبية). The API answers it 423 Locked; a refusal like any other to whatever catches one.
public sealed class PeriodLockedException(DateOnly lockedUntil, DateOnly day) : DomainException(Describe(lockedUntil, day))
{
    public DateOnly LockedUntil { get; } = lockedUntil;

    // The day in the books locked the request would have written on (the earliest, of several).
    public DateOnly Day { get; } = day;

    public static string Describe(DateOnly lockedUntil, DateOnly day) =>
        $"Cannot modify records before the locked period (Books closed until {Format(lockedUntil)}): {Format(day)} is in it. " +
        "· لا يمكن تعديل أو إضافة حركات في فترة محاسبية تم إقفالها.";

    public static string Format(DateOnly day) => day.ToString("d MMM yyyy", CultureInfo.InvariantCulture);
}
