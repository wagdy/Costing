using Costing.Domain.Common;
using Costing.Domain.Company;

namespace Costing.Domain.Tests;

// The company's settings: how money is written, and what a manager may set.
public class CompanySettingsTests
{
    private static CompanySettings Egypt() =>
        new("Acme", "L.E", CurrencyPosition.Before, Country.Egypt, "Africa/Cairo", 4);

    [Fact]
    public void Money_is_written_with_the_currency_before_or_after_or_alone()
    {
        Assert.Equal("L.E 1,400.00", new MoneyFormat("L.E", CurrencyPosition.Before).Format(1_400m));
        Assert.Equal("1,400.50 SAR", new MoneyFormat("SAR", CurrencyPosition.After).Format(1_400.5m));
        Assert.Equal("$ 100,000", new MoneyFormat("$", CurrencyPosition.Before).Format(100_000m, "N0"));
        Assert.Equal("1,400.00", MoneyFormat.Plain.Format(1_400m));
        Assert.Equal("L.E 1,400.00", Egypt().Money.Format(1_400m));
    }

    [Fact]
    public void A_manager_sets_the_name_currency_country_time_zone_and_business_day()
    {
        var settings = Egypt();
        settings.Update(" Acme KSA ", " SAR ", CurrencyPosition.After, Country.SaudiArabia, "Asia/Riyadh", 5, "Omar");

        Assert.Equal(("Acme KSA", "SAR", CurrencyPosition.After, Country.SaudiArabia, "Asia/Riyadh", 5, "Omar"),
            (settings.Name, settings.CurrencySymbol, settings.CurrencyPosition, settings.Country, settings.TimeZoneId, settings.WorkdayStartsAtHour,
                settings.UpdatedBy));

        void Refused(string why, Action update) => Assert.Contains(why, Assert.Throws<DomainException>(update).Message);
        Refused("company's name", () => settings.Update(" ", "SAR", CurrencyPosition.After, Country.SaudiArabia, "Asia/Riyadh", 4, "Omar"));
        Refused("8 characters", () => settings.Update("Acme", "RIYALS-SA", CurrencyPosition.After, Country.SaudiArabia, "Asia/Riyadh", 4, "Omar"));
        Refused("not a time zone", () => settings.Update("Acme", "SAR", CurrencyPosition.After, Country.SaudiArabia, "Mars/Olympus", 4, "Omar"));
        Refused("between midnight", () => settings.Update("Acme", "SAR", CurrencyPosition.After, Country.SaudiArabia, "Asia/Riyadh", 13, "Omar"));
        Refused("the country", () => settings.Update("Acme", "SAR", CurrencyPosition.After, (Country)9, "Asia/Riyadh", 4, "Omar"));
        // Refused, nothing changed.
        Assert.Equal("Acme KSA", settings.Name);
    }

    [Fact]
    public void A_logo_is_a_picture_drawing_or_icon_of_two_megabytes_at_most()
    {
        var settings = Egypt();
        settings.AttachLogo("../acme.png", "image/png", 2_048, "Omar");
        Assert.Equal((true, "acme.png", "image/png", 2_048), (settings.HasLogo, settings.LogoFileName, settings.LogoContentType, settings.LogoBytes));
        settings.AttachLogo("acme.svg", "image/svg+xml", 2_048, "Omar");
        settings.AttachLogo("acme.ico", "image/x-icon", CompanySettings.MaxLogoBytes, "Omar");
        Assert.Equal((2 * 1024 * 1024, "image/x-icon"), (CompanySettings.MaxLogoBytes, settings.LogoContentType));

        Assert.Throws<DomainException>(() => settings.AttachLogo("acme.gif", "image/gif", 2_048, "Omar"));
        Assert.Throws<DomainException>(() => settings.AttachLogo("big.png", "image/png", CompanySettings.MaxLogoBytes + 1, "Omar"));

        settings.RemoveLogo("Omar");
        Assert.False(settings.HasLogo);
    }
}
