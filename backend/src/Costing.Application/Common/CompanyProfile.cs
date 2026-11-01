using Costing.Domain.Company;

namespace Costing.Application.Common;

// The company's settings as they stand (CompanySettings), at hand on every request without the
// database: how money is written in messages, the country, and the clock's time zone and
// business day.
public sealed record CompanyProfile(
    string Name,
    MoneyFormat Money,
    Country Country,
    string TimeZoneId,
    int WorkdayStartsAtHour,
    bool HasLogo,
    DateTime? LogoUpdatedAtUtc)
{
    public static CompanyProfile From(CompanySettings settings) => new(
        settings.Name, settings.Money, settings.Country, settings.TimeZoneId, settings.WorkdayStartsAtHour, settings.HasLogo,
        settings.LogoUpdatedAtUtc);
}

// Kept in memory for the whole app, read at start-up from the database and replaced as a manager
// saves the settings. One API process holds it: a second one would not see the other's saves
// until it starts again.
public interface ICompanyProfile
{
    CompanyProfile Current { get; }

    void Set(CompanyProfile profile);
}

// How amounts are written in the system's own messages ("Takings of 12 Oct · L.E 1,140.00"): the
// company's currency, as Company Settings has it. Set with the profile (ICompanyProfile.Set), so
// the messages follow a save at once; L.E until the settings are read.
public static class CompanyMoney
{
    private static volatile MoneyFormat _format = new("L.E", CurrencyPosition.Before);

    public static MoneyFormat Format
    {
        get => _format;
        set => _format = value;
    }

    // "L.E 1,140.00"; another number format: "#,0.00##" for a unit cost.
    public static string Text(decimal amount, string numberFormat = "N2") => _format.Format(amount, numberFormat);
}
