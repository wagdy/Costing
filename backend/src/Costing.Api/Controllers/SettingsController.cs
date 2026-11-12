using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Net.Http.Headers;
using Costing.Api.Auth;
using Costing.Application.Company;
using Costing.Domain.Access;
using Costing.Domain.Company;

namespace Costing.Api.Controllers;

// Company Settings (إعدادات الشركة). Read by anyone, signed in or not: the sign-in page shows the
// company's name and logo before anyone signs in, and the browser's tab its icon; nothing here is a
// secret. Changed by a manager (settings.manage). At api/settings and api/company-settings alike.
[ApiController]
[Route("api/settings")]
[Route("api/company-settings")]
public sealed class SettingsController(ISender sender) : ControllerBase
{
    [HttpGet]
    [AllowAnonymous]
    public Task<CompanySettingsDto> Get(CancellationToken cancellationToken) => sender.Send(new GetCompanySettingsQuery(), cancellationToken);

    // The time zone moves which business day new sales, takings and entries fall on from now on;
    // what is recorded already stays on its day.
    [HttpPut]
    [Authorize(Policy = Permissions.SettingsManage)]
    public Task<CompanySettingsDto> Update(CompanySettingsInput request, CancellationToken cancellationToken) =>
        sender.Send(new UpdateCompanySettingsCommand(request, StaffName), cancellationToken);

    // The tab's icon and the top bar's logo, before anyone signs in. Asked for by its version
    // (?v=, as LogoUrl gives it), it is kept a year: a new logo is a new address. Asked for
    // without, it is checked each time by its tag (304 when unchanged).
    [HttpGet("logo")]
    [AllowAnonymous]
    public async Task<IActionResult> GetLogo([FromQuery] long? v, CancellationToken cancellationToken)
    {
        if (await sender.Send(new GetCompanyLogoQuery(), cancellationToken) is not { } logo)
            return NotFound();
        Response.Headers.XContentTypeOptions = "nosniff";
        // An SVG is a document: opened on its own, sandboxed, nothing in it runs or loads.
        Response.Headers.ContentSecurityPolicy = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox";
        Response.Headers.CacheControl = v == logo.Version ? "public, max-age=31536000, immutable" : "no-cache";
        return File(logo.Content, logo.ContentType, lastModified: null, entityTag: new EntityTagHeaderValue($"\"{logo.Version}\""));
    }

    // A PNG, SVG, JPEG, WebP or ICO of up to two megabytes, replacing the one there was.
    [HttpPut("logo")]
    [Authorize(Policy = Permissions.SettingsManage)]
    [RequestSizeLimit(CompanySettings.MaxLogoBytes + 64 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = CompanySettings.MaxLogoBytes + 64 * 1024)]
    public async Task<ActionResult<CompanySettingsDto>> UploadLogo(IFormFile file, CancellationToken cancellationToken)
    {
        if (file.Length > CompanySettings.MaxLogoBytes)
            return UnprocessableEntity(new { errors = new[] { "A logo is two megabytes at most: save a smaller picture." } });
        using var content = new MemoryStream();
        await file.CopyToAsync(content, cancellationToken);
        return await sender.Send(new UploadCompanyLogoCommand(file.FileName, file.ContentType, content.ToArray(), StaffName), cancellationToken);
    }

    [HttpDelete("logo")]
    [Authorize(Policy = Permissions.SettingsManage)]
    public Task<CompanySettingsDto> RemoveLogo(CancellationToken cancellationToken) =>
        sender.Send(new RemoveCompanyLogoCommand(StaffName), cancellationToken);

    private string StaffName => User.FindFirst(UserClaims.Name)?.Value ?? string.Empty;
}
