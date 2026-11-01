using Microsoft.Extensions.Options;
using Costing.Application.Common;
using Costing.Domain.Company;

namespace Costing.Infrastructure.Common;

// The company's settings as the configuration first gives them (the Company section): only until
// the first start has made the settings row, which a manager changes on Company Settings after.
public sealed class CompanyOptions
{
    public const string Section = "Company";

    public string Name { get; set; } = "My company";

    // IANA id. Works on Linux, macOS and Windows alike.
    public string TimeZoneId { get; set; } = "Africa/Cairo";

    // The hour the business day rolls over, in local time. With 4, a sale at 01:30 belongs to the
    // evening before: a night past midnight is one day.
    public int WorkdayStartsAtHour { get; set; } = 4;

    public Country Country { get; set; } = Country.Egypt;

    // Empty: amounts are written as numbers alone.
    public string CurrencySymbol { get; set; } = string.Empty;

    public CurrencyPosition CurrencyPosition { get; set; } = CurrencyPosition.Before;
}

// The company's settings held for the whole app (ICompanyProfile): the configuration's until the
// database's are read at start-up, then each save's.
public sealed class CompanyProfileStore(IOptions<CompanyOptions> options) : ICompanyProfile
{
    private volatile CompanyProfile _current = new(
        options.Value.Name, new MoneyFormat(options.Value.CurrencySymbol, options.Value.CurrencyPosition), options.Value.Country,
        options.Value.TimeZoneId, options.Value.WorkdayStartsAtHour, HasLogo: false, LogoUpdatedAtUtc: null);

    public CompanyProfile Current => _current;

    public void Set(CompanyProfile profile) => _current = profile;
}

// Everything is stored in UTC. This is the one place that knows the company's local time: which
// business day a moment belongs to, and the day's span. It follows the time zone and the hour the
// business day starts of Company Settings as they are saved.
public sealed class BusinessCalendar(ICompanyProfile company) : IBusinessCalendar
{
    private volatile Zone _zone = new(string.Empty, TimeZoneInfo.Utc);

    public DateTime ToLocal(DateTime utc) => TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), ZoneNow());

    public DateOnly BusinessDateOf(DateTime utc) => DateOnly.FromDateTime(ToLocal(utc).AddHours(-company.Current.WorkdayStartsAtHour));

    public DateOnly LocalDateOf(DateTime utc) => DateOnly.FromDateTime(ToLocal(utc));

    public (DateTime FromUtc, DateTime ToUtc) Bounds(DateOnly businessDate)
    {
        var start = businessDate.ToDateTime(new TimeOnly(company.Current.WorkdayStartsAtHour, 0));
        return (ToUtc(start), ToUtc(start.AddDays(1)));
    }

    // A local time skipped by a daylight-saving change does not exist; the hour after it does.
    public DateTime ToUtc(DateTime local)
    {
        var zone = ZoneNow();
        local = DateTime.SpecifyKind(local, DateTimeKind.Unspecified);
        return TimeZoneInfo.ConvertTimeToUtc(zone.IsInvalidTime(local) ? local.AddHours(1) : local, zone);
    }

    // Looked up once a zone, not each time.
    private TimeZoneInfo ZoneNow()
    {
        var id = company.Current.TimeZoneId;
        var zone = _zone;
        if (zone.Id != id)
            _zone = zone = new Zone(id, TimeZoneInfo.FindSystemTimeZoneById(id));
        return zone.Info;
    }

    private sealed record Zone(string Id, TimeZoneInfo Info);
}
