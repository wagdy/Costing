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
    bool HasLogo,
    // Changes whenever the logo does, for the app to ask for the new one.
    long LogoVersion)
{
    public static CompanySettingsDto From(CompanyProfile p) => new(
        p.Name, p.Money.Symbol, p.Money.Position, p.Country, p.TimeZoneId, p.WorkdayStartsAtHour, p.HasLogo,
        p.LogoUpdatedAtUtc?.Ticks ?? 0);
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

// The logo (شعار الشركة): a PNG, JPEG or WebP of up to a megabyte, checked by its first bytes,
// replacing the one there was. A manager's.
public sealed record UploadCompanyLogoCommand(string FileName, string ContentType, byte[] Content, string StaffName) : IRequest<CompanySettingsDto>;

internal sealed class UploadCompanyLogoHandler(ICompanySettingsStore store, ICompanyProfile profile, IUnitOfWork unitOfWork)
    : IRequestHandler<UploadCompanyLogoCommand, CompanySettingsDto>
{
    public async Task<CompanySettingsDto> Handle(UploadCompanyLogoCommand request, CancellationToken cancellationToken)
    {
        var settings = await CompanySettingsRow.GetOrMakeAsync(store, profile, cancellationToken);
        if (CompanySettings.LogoTypes.Contains(request.ContentType) && !UploadedFile.LooksLike(request.ContentType, request.Content))
            throw new DomainException("That file is not the picture it says it is.");
        settings.AttachLogo(request.FileName, request.ContentType, request.Content.Length, request.StaffName);
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

public sealed record CompanyLogoFile(string FileName, string ContentType, byte[] Content);

public sealed record GetCompanyLogoQuery : IRequest<CompanyLogoFile?>;

internal sealed class GetCompanyLogoHandler(ICompanySettingsStore store) : IRequestHandler<GetCompanyLogoQuery, CompanyLogoFile?>
{
    public async Task<CompanyLogoFile?> Handle(GetCompanyLogoQuery request, CancellationToken cancellationToken)
    {
        if (await store.GetAsync(cancellationToken) is not { HasLogo: true } settings)
            return null;
        return await store.GetLogoAsync(cancellationToken) is { } content
            ? new CompanyLogoFile(settings.LogoFileName!, settings.LogoContentType!, content)
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
