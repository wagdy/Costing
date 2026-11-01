using Microsoft.Extensions.Options;
using Costing.Infrastructure.Common;

namespace Costing.Infrastructure.Tests;

// No database here: the workday is arithmetic on the business's time zone.
public class WorkClockTests
{
    private static readonly WorkClock Cairo = new(Profile("Africa/Cairo", 4));

    private static CompanyProfileStore Profile(string timeZoneId, int workdayStartsAtHour) =>
        new(Options.Create(new CompanyOptions { TimeZoneId = timeZoneId, WorkdayStartsAtHour = workdayStartsAtHour }));

    private static DateTime Utc(int year, int month, int day, int hour, int minute = 0) => new(year, month, day, hour, minute, 0, DateTimeKind.Utc);

    [Fact]
    public void A_moment_after_midnight_belongs_to_the_evening_before_until_the_workday_starts()
    {
        // 01:30 on the 4th in Cairo (October: UTC+3).
        Assert.Equal((new DateOnly(2026, 10, 3), new DateOnly(2026, 10, 4)), (Cairo.WorkdayOf(Utc(2026, 10, 3, 22, 30)), Cairo.LocalDateOf(Utc(2026, 10, 3, 22, 30))));
        // 04:30 on the 4th: a new day.
        Assert.Equal(new DateOnly(2026, 10, 4), Cairo.WorkdayOf(Utc(2026, 10, 4, 1, 30)));
    }

    [Fact]
    public void The_wall_clock_is_the_business_time_zones_with_no_zone_attached()
    {
        // January: UTC+2.
        var local = Cairo.LocalTimeOf(Utc(2026, 1, 15, 8));
        Assert.Equal((new DateTime(2026, 1, 15, 10, 0, 0), DateTimeKind.Unspecified), (local, local.Kind));
    }

    // A manager saves another time zone or workday hour: the clock follows at once.
    [Fact]
    public void It_follows_the_company_settings_as_they_are_saved()
    {
        var company = Profile("Africa/Cairo", 4);
        var clock = new WorkClock(company);
        Assert.Equal(new DateTime(2026, 1, 15, 10, 0, 0), clock.LocalTimeOf(Utc(2026, 1, 15, 8)));

        company.Set(company.Current with { TimeZoneId = "Asia/Riyadh", WorkdayStartsAtHour = 0 });
        Assert.Equal(new DateTime(2026, 1, 15, 11, 0, 0), clock.LocalTimeOf(Utc(2026, 1, 15, 8)));
        // 00:30 in Riyadh: with the workday starting at midnight, the new day.
        Assert.Equal(new DateOnly(2026, 1, 16), clock.WorkdayOf(Utc(2026, 1, 15, 21, 30)));
    }
}
