using System.Globalization;
using Costing.Domain.Common;

namespace Costing.Domain.Company;

// Where the company is.
public enum Country
{
    Egypt = 1,
    SaudiArabia = 2,
}

// Which side of an amount the currency is written on: "L.E 1,400.00" or "1,400.00 SAR".
public enum CurrencyPosition
{
    Before = 1,
    After = 2,
}

// An amount as the company writes it, wherever one is shown: the screens, the Excel sheets and
// the API's own messages alike. With no symbol, the number alone.
public sealed record MoneyFormat(string Symbol, CurrencyPosition Position)
{
    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

    public static MoneyFormat Plain { get; } = new(string.Empty, CurrencyPosition.Before);

    // "L.E 1,400.00"; whole amounts too: "L.E 100,000" with "N0".
    public string Format(decimal amount, string numberFormat = "N2")
    {
        var number = amount.ToString(numberFormat, Invariant);
        if (Symbol.Length == 0)
            return number;
        return Position == CurrencyPosition.Before ? $"{Symbol} {number}" : $"{number} {Symbol}";
    }
}

// The company this system runs for (إعدادات الشركة): one row, kept by a manager. Its name and logo,
// how money is written, the country, the time zone and the hour its business day starts (a night
// past midnight belongs to the evening's day: its sales, its takings, its waste). The time zone
// moves which day new sales and entries fall on from the moment it is saved.
public sealed class CompanySettings
{
    public const int SingletonId = 1;
    public const int MaxNameLength = 200;
    public const int MaxCurrencySymbolLength = 8;
    public const int MaxLogoFileNameLength = 200;
    public const int MaxLogoBytes = 2 * 1024 * 1024;

    // A logo is the browser tab's icon and the top bar's emblem: a picture (PNG, JPEG, WebP), an icon
    // (ICO) or a drawing (SVG). An SVG is taken only with nothing in it that runs or reaches out
    // (checked as it is uploaded), and is served sandboxed besides.
    public static readonly IReadOnlySet<string> LogoTypes = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "image/png", "image/jpeg", "image/webp", "image/svg+xml", "image/x-icon",
    };

    private CompanySettings() { }

    public CompanySettings(
        string name, string currencySymbol, CurrencyPosition currencyPosition, Country country, string timeZoneId, int workdayStartsAtHour)
    {
        Update(name, currencySymbol, currencyPosition, country, timeZoneId, workdayStartsAtHour, updatedBy: null);
    }

    public int Id { get; private init; } = SingletonId;
    public string Name { get; private set; } = string.Empty;
    public string CurrencySymbol { get; private set; } = string.Empty;
    public CurrencyPosition CurrencyPosition { get; private set; } = CurrencyPosition.Before;
    public Country Country { get; private set; } = Country.Egypt;
    // IANA id, as the server's own clock knows it: "Africa/Cairo", "Asia/Riyadh".
    public string TimeZoneId { get; private set; } = string.Empty;
    public int WorkdayStartsAtHour { get; private set; }
    public string? LogoFileName { get; private set; }
    public string? LogoContentType { get; private set; }
    public int? LogoBytes { get; private set; }
    public DateTime? LogoUpdatedAtUtc { get; private set; }
    public string? UpdatedBy { get; private set; }
    public DateTime? UpdatedAtUtc { get; private set; }

    public bool HasLogo => LogoFileName is not null;

    public MoneyFormat Money => new(CurrencySymbol, CurrencyPosition);

    public void Update(
        string name, string currencySymbol, CurrencyPosition currencyPosition, Country country, string timeZoneId, int workdayStartsAtHour,
        string? updatedBy)
    {
        var trimmedName = name?.Trim() ?? string.Empty;
        if (trimmedName.Length is 0 or > MaxNameLength)
            throw new DomainException($"Enter the company's name: {MaxNameLength} characters at most.");
        var symbol = currencySymbol?.Trim() ?? string.Empty;
        if (symbol.Length > MaxCurrencySymbolLength)
            throw new DomainException($"Keep the currency symbol to {MaxCurrencySymbolLength} characters: L.E, $, SAR.");
        if (!Enum.IsDefined(currencyPosition))
            throw new DomainException("Choose whether the currency goes before the amount or after it.");
        if (!Enum.IsDefined(country))
            throw new DomainException("Choose the country: Egypt or Saudi Arabia.");
        var zone = timeZoneId?.Trim() ?? string.Empty;
        if (!IsTimeZone(zone))
            throw new DomainException($"\"{zone}\" is not a time zone this server knows: choose one from the list.");
        if (workdayStartsAtHour is < 0 or > 12)
            throw new DomainException("The business day starts between midnight (0) and noon (12).");

        Name = trimmedName;
        CurrencySymbol = symbol;
        CurrencyPosition = currencyPosition;
        Country = country;
        TimeZoneId = zone;
        WorkdayStartsAtHour = workdayStartsAtHour;
        if (updatedBy is not null)
        {
            UpdatedBy = updatedBy;
            UpdatedAtUtc = DateTime.UtcNow;
        }
    }

    // A PNG, SVG, JPEG, WebP or ICO of up to two megabytes, replacing the one there was.
    public void AttachLogo(string fileName, string contentType, int bytes, string updatedBy)
    {
        if (!LogoTypes.Contains(contentType))
            throw new DomainException("A logo is a PNG, SVG, JPEG, WebP or ICO picture.");
        if (bytes is <= 0 or > MaxLogoBytes)
            throw new DomainException("A logo is two megabytes at most: save a smaller picture.");
        var name = Path.GetFileName(fileName?.Trim() ?? string.Empty);
        LogoFileName = name.Length is > 0 and <= MaxLogoFileNameLength ? name : "logo";
        LogoContentType = contentType.ToLowerInvariant();
        LogoBytes = bytes;
        LogoUpdatedAtUtc = DateTime.UtcNow;
        UpdatedBy = updatedBy;
        UpdatedAtUtc = LogoUpdatedAtUtc;
    }

    public void RemoveLogo(string updatedBy)
    {
        LogoFileName = null;
        LogoContentType = null;
        LogoBytes = null;
        LogoUpdatedAtUtc = DateTime.UtcNow;
        UpdatedBy = updatedBy;
        UpdatedAtUtc = LogoUpdatedAtUtc;
    }

    public static bool IsTimeZone(string timeZoneId)
    {
        if (timeZoneId.Length == 0)
            return false;
        try
        {
            TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);
            return true;
        }
        catch (TimeZoneNotFoundException)
        {
            return false;
        }
        catch (InvalidTimeZoneException)
        {
            return false;
        }
    }
}

// The company's settings, one row, and its logo's bytes apart from it (so reading the settings
// never loads the picture). Tracked: changed and saved in the same unit of work.
public interface ICompanySettingsStore
{
    // None until the first start has made it.
    Task<CompanySettings?> GetAsync(CancellationToken cancellationToken = default);

    void Add(CompanySettings settings);

    // Replaces the logo there was; null takes it off.
    Task PutLogoAsync(byte[]? content, CancellationToken cancellationToken = default);

    Task<byte[]?> GetLogoAsync(CancellationToken cancellationToken = default);
}
