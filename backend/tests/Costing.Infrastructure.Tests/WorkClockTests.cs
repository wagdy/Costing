using Microsoft.Extensions.Options;
using Costing.Infrastructure.Common;

namespace Costing.Infrastructure.Tests;

// No database here: the business day is arithmetic on the business's time zone.
public class BusinessCalendarTests
{
    private static readonly BusinessCalendar Cairo = new(Profile("Africa/Cairo", 4));

    private static CompanyProfileStore Profile(string timeZoneId, int workdayStartsAtHour) =>
        new(Options.Create(new CompanyOptions { TimeZoneId = timeZoneId, WorkdayStartsAtHour = workdayStartsAtHour, CurrencySymbol = "L.E" }));

    private static DateTime Utc(int year, int month, int day, int hour, int minute = 0) => new(year, month, day, hour, minute, 0, DateTimeKind.Utc);

    [Fact]
    public void A_moment_after_midnight_belongs_to_the_evening_before_until_the_business_day_starts()
    {
        // 01:30 on the 4th in Cairo (October: UTC+3).
        Assert.Equal((new DateOnly(2026, 10, 3), new DateOnly(2026, 10, 4)), (Cairo.BusinessDateOf(Utc(2026, 10, 3, 22, 30)), Cairo.LocalDateOf(Utc(2026, 10, 3, 22, 30))));
        // 04:30 on the 4th: a new day.
        Assert.Equal(new DateOnly(2026, 10, 4), Cairo.BusinessDateOf(Utc(2026, 10, 4, 1, 30)));
        // The 3rd runs from 04:00 that morning to 04:00 the next, in UTC.
        Assert.Equal((Utc(2026, 10, 3, 1), Utc(2026, 10, 4, 1)), Cairo.Bounds(new DateOnly(2026, 10, 3)));
    }

    // A manager saves another time zone or business day hour: the calendar follows at once.
    [Fact]
    public void It_follows_the_company_settings_as_they_are_saved()
    {
        var company = Profile("Africa/Cairo", 4);
        var calendar = new BusinessCalendar(company);
        Assert.Equal(new DateTime(2026, 1, 15, 10, 0, 0), calendar.ToLocal(Utc(2026, 1, 15, 8)));

        company.Set(company.Current with { TimeZoneId = "Asia/Riyadh", WorkdayStartsAtHour = 0 });
        Assert.Equal(new DateTime(2026, 1, 15, 11, 0, 0), calendar.ToLocal(Utc(2026, 1, 15, 8)));
        // 00:30 in Riyadh: with the day starting at midnight, the new day.
        Assert.Equal(new DateOnly(2026, 1, 16), calendar.BusinessDateOf(Utc(2026, 1, 15, 21, 30)));
        Assert.Equal(Utc(2026, 1, 15, 9), calendar.ToUtc(new DateTime(2026, 1, 15, 12, 0, 0)));
    }
}
