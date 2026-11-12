using System.Xml;
using MediatR;
using Costing.Application.Common;
using Costing.Domain.Common;
using Costing.Domain.Company;

namespace Costing.Application.Company;

// Company Settings (إعدادات الشركة): the company's name and logo, how money is written, the
// country, the time zone and the hour its business day starts. Read by everyone (the sign-in page
// shows the name and logo before anyone signs in); changed by a manager. A save is at once in the
// app's profile (ICompanyProfile), so the clock and the messages follow it without a restart.

public sealed record CompanySettingsDto(
    string Name,
    string CurrencySymbol,
    CurrencyPosition CurrencyPosition,
    Country Country,
    string TimeZoneId,
    int WorkdayStartsAtHour,
    // A logo uploaded in place of the system's own icon.
    bool HasCustomLogo,
    // Changes whenever the logo does, for the app to ask for the new one.
    long LogoVersion,
    // Where it is, its version in the address (null with none): the tab's icon and the top bar's.
    string? LogoUrl)
{
    public const string LogoPath = "/api/company-settings/logo";

    public static CompanySettingsDto From(CompanyProfile p)
    {
        var version = p.LogoUpdatedAtUtc?.Ticks ?? 0;
        return new(
            p.Name, p.Money.Symbol, p.Money.Position, p.Country, p.TimeZoneId, p.WorkdayStartsAtHour, p.HasLogo, version,
            p.HasLogo ? $"{LogoPath}?v={version}" : null);
    }
}

public sealed record GetCompanySettingsQuery : IRequest<CompanySettingsDto>;

internal sealed class GetCompanySettingsHandler(ICompanyProfile profile) : IRequestHandler<GetCompanySettingsQuery, CompanySettingsDto>
{
    public Task<CompanySettingsDto> Handle(GetCompanySettingsQuery request, CancellationToken cancellationToken) =>
        Task.FromResult(CompanySettingsDto.From(profile.Current));
}

public sealed record CompanySettingsInput(
    string Name,
    string? CurrencySymbol,
    CurrencyPosition CurrencyPosition,
    Country Country,
    string TimeZoneId,
    int WorkdayStartsAtHour);

// A manager's.
public sealed record UpdateCompanySettingsCommand(CompanySettingsInput Settings, string StaffName) : IRequest<CompanySettingsDto>;

internal sealed class UpdateCompanySettingsHandler(ICompanySettingsStore store, ICompanyProfile profile, IUnitOfWork unitOfWork)
    : IRequestHandler<UpdateCompanySettingsCommand, CompanySettingsDto>
{
    public async Task<CompanySettingsDto> Handle(UpdateCompanySettingsCommand request, CancellationToken cancellationToken)
    {
        var s = request.Settings;
        var settings = await CompanySettingsRow.GetOrMakeAsync(store, profile, cancellationToken);
        settings.Update(s.Name, s.CurrencySymbol ?? string.Empty, s.CurrencyPosition, s.Country, s.TimeZoneId, s.WorkdayStartsAtHour, request.StaffName);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        profile.Set(CompanyProfile.From(settings));
        return CompanySettingsDto.From(profile.Current);
    }
}

// The logo (شعار الشركة وأيقونة المتصفح): a PNG, SVG, JPEG, WebP or ICO of up to two megabytes,
// replacing the one there was; what it is is read from its bytes, whatever the browser called it.
// A manager's.
public sealed record UploadCompanyLogoCommand(string FileName, string ContentType, byte[] Content, string StaffName) : IRequest<CompanySettingsDto>;

internal sealed class UploadCompanyLogoHandler(ICompanySettingsStore store, ICompanyProfile profile, IUnitOfWork unitOfWork)
    : IRequestHandler<UploadCompanyLogoCommand, CompanySettingsDto>
{
    public async Task<CompanySettingsDto> Handle(UploadCompanyLogoCommand request, CancellationToken cancellationToken)
    {
        var settings = await CompanySettingsRow.GetOrMakeAsync(store, profile, cancellationToken);
        var type = LogoImage.TypeOf(request.Content)
            ?? throw new DomainException(
                "A logo is a PNG, SVG, JPEG, WebP or ICO picture: that file is none of them, or an SVG with script or links in it. "
                + "· الشعار صورة PNG أو SVG أو JPEG أو WebP أو ICO.");
        settings.AttachLogo(request.FileName, type, request.Content.Length, request.StaffName);
        await store.PutLogoAsync(request.Content, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        profile.Set(CompanyProfile.From(settings));
        return CompanySettingsDto.From(profile.Current);
    }
}

public sealed record RemoveCompanyLogoCommand(string StaffName) : IRequest<CompanySettingsDto>;

internal sealed class RemoveCompanyLogoHandler(ICompanySettingsStore store, ICompanyProfile profile, IUnitOfWork unitOfWork)
    : IRequestHandler<RemoveCompanyLogoCommand, CompanySettingsDto>
{
    public async Task<CompanySettingsDto> Handle(RemoveCompanyLogoCommand request, CancellationToken cancellationToken)
    {
        var settings = await CompanySettingsRow.GetOrMakeAsync(store, profile, cancellationToken);
        settings.RemoveLogo(request.StaffName);
        await store.PutLogoAsync(null, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        profile.Set(CompanyProfile.From(settings));
        return CompanySettingsDto.From(profile.Current);
    }
}

// Version: its LogoVersion, the address's ?v= and the tag a browser checks it by.
public sealed record CompanyLogoFile(string FileName, string ContentType, byte[] Content, long Version);

public sealed record GetCompanyLogoQuery : IRequest<CompanyLogoFile?>;

internal sealed class GetCompanyLogoHandler(ICompanySettingsStore store) : IRequestHandler<GetCompanyLogoQuery, CompanyLogoFile?>
{
    public async Task<CompanyLogoFile?> Handle(GetCompanyLogoQuery request, CancellationToken cancellationToken)
    {
        if (await store.GetAsync(cancellationToken) is not { HasLogo: true } settings)
            return null;
        return await store.GetLogoAsync(cancellationToken) is { } content
            ? new CompanyLogoFile(settings.LogoFileName!, settings.LogoContentType!, content, settings.LogoUpdatedAtUtc?.Ticks ?? 0)
            : null;
    }
}

// Made at start-up from the configuration's Company section (CompanyProfile's first values); the
// database's once it is there.
public sealed record EnsureCompanySettingsCommand : IRequest<CompanyProfile>;

internal sealed class EnsureCompanySettingsHandler(ICompanySettingsStore store, ICompanyProfile profile, IUnitOfWork unitOfWork)
    : IRequestHandler<EnsureCompanySettingsCommand, CompanyProfile>
{
    public async Task<CompanyProfile> Handle(EnsureCompanySettingsCommand request, CancellationToken cancellationToken)
    {
        var settings = await CompanySettingsRow.GetOrMakeAsync(store, profile, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        profile.Set(CompanyProfile.From(settings));
        return profile.Current;
    }
}

internal static class CompanySettingsRow
{
    // The row, or one made from the profile as it stands (the configuration's values).
    public static async Task<CompanySettings> GetOrMakeAsync(ICompanySettingsStore store, ICompanyProfile profile, CancellationToken cancellationToken)
    {
        if (await store.GetAsync(cancellationToken) is { } settings)
            return settings;
        var p = profile.Current;
        settings = new CompanySettings(p.Name, p.Money.Symbol, p.Money.Position, p.Country, p.TimeZoneId, p.WorkdayStartsAtHour);
        store.Add(settings);
        return settings;
    }
}

// What an uploaded logo is, read from its bytes: a PNG, JPEG, WebP or ICO by its first bytes; an
// SVG when it reads as one and has nothing in it that could run or reach out of it.
internal static class LogoImage
{
    // Taken as a drawing's links: within itself (#id), or a picture inside it.
    private static readonly string[] SafeLinks = ["#", "data:image/png", "data:image/jpeg", "data:image/webp", "data:image/gif"];

    // Not in a logo: script, a page inside it, or anything that loads another.
    private static readonly HashSet<string> UnsafeElements = new(StringComparer.OrdinalIgnoreCase)
    {
        "script", "foreignObject", "iframe", "embed", "object", "handler", "listener",
    };

    public static string? TypeOf(byte[] content)
    {
        bool StartsWith(params byte[] prefix) => content.Length >= prefix.Length && content.AsSpan(0, prefix.Length).SequenceEqual(prefix);
        if (UploadedFile.LooksLike("image/png", content))
            return "image/png";
        if (UploadedFile.LooksLike("image/jpeg", content))
            return "image/jpeg";
        if (UploadedFile.LooksLike("image/webp", content))
            return "image/webp";
        // An icon file: reserved 0, type 1, and at least one picture in it.
        if (content.Length >= 6 && StartsWith(0, 0, 1, 0) && (content[4] | content[5] << 8) > 0)
            return "image/x-icon";
        return IsSafeSvg(content) ? "image/svg+xml" : null;
    }

    // XML whose root is <svg>, with no DTD (so nothing is fetched or expanded), no processing
    // instruction (a stylesheet), no script or embedded page, no event handler, and no link but to
    // itself or a picture inside it. Served sandboxed too, so what is missed here still never runs.
    internal static bool IsSafeSvg(byte[] content)
    {
        var settings = new XmlReaderSettings
        {
            DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, IgnoreComments = true, IgnoreWhitespace = true, MaxCharactersInDocument = 4_000_000,
        };
        try
        {
            using var reader = XmlReader.Create(new MemoryStream(content), settings);
            var root = true;
            while (reader.Read())
            {
                if (reader.NodeType == XmlNodeType.ProcessingInstruction)
                    return false;
                if (reader.NodeType is XmlNodeType.Text or XmlNodeType.CDATA && Forbidden(reader.Value))
                    return false;
                if (reader.NodeType != XmlNodeType.Element)
                    continue;
                if (root && reader.LocalName != "svg")
                    return false;
                root = false;
                if (UnsafeElements.Contains(reader.LocalName))
                    return false;
                for (var more = reader.MoveToFirstAttribute(); more; more = reader.MoveToNextAttribute())
                {
                    var name = reader.LocalName;
                    if (name.StartsWith("on", StringComparison.OrdinalIgnoreCase) || Forbidden(reader.Value))
                        return false;
                    if (name is "href" or "src" && !SafeLinks.Any(l => reader.Value.TrimStart().StartsWith(l, StringComparison.OrdinalIgnoreCase)))
                        return false;
                }
                reader.MoveToElement();
            }
            return !root;
        }
        catch (XmlException)
        {
            return false;
        }
    }

    // A script's address, or a stylesheet's import, anywhere: "java\nscript:" too.
    private static bool Forbidden(string value)
    {
        var squeezed = new string(value.Where(c => !char.IsWhiteSpace(c) && c != '\0').ToArray());
        return squeezed.Contains("javascript:", StringComparison.OrdinalIgnoreCase) || squeezed.Contains("@import", StringComparison.OrdinalIgnoreCase);
    }
}

