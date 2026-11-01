using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Costing.Api.Auth;
using Costing.Application.Company;
using Costing.Domain.Access;
using Costing.Domain.Company;

namespace Costing.Api.Controllers;

// Company Settings (إعدادات الشركة). Read by anyone, signed in or not: the sign-in page and the
// portal show the company's name and logo before anyone signs in, and nothing here is a secret.
// Changed by a manager (settings.manage).
[ApiController]
[Route("api/settings")]
public sealed class SettingsController(ISender sender) : ControllerBase
{
    [HttpGet]
    [AllowAnonymous]
    public Task<CompanySettingsDto> Get(CancellationToken cancellationToken) => sender.Send(new GetCompanySettingsQuery(), cancellationToken);

    // The time zone moves how new punches fall into workdays from now on; the weekends are only
    // what a new employee starts with.
    [HttpPut]
    [Authorize(Policy = Permissions.SettingsManage)]
    public Task<CompanySettingsDto> Update(CompanySettingsInput request, CancellationToken cancellationToken) =>
        sender.Send(new UpdateCompanySettingsCommand(request, StaffName), cancellationToken);

    [HttpGet("logo")]
    [AllowAnonymous]
    public async Task<IActionResult> GetLogo(CancellationToken cancellationToken)
    {
        if (await sender.Send(new GetCompanyLogoQuery(), cancellationToken) is not { } logo)
            return NotFound();
        Response.Headers.XContentTypeOptions = "nosniff";
        // Asked for by its version (?v=), so a new logo is a new address.
        Response.Headers.CacheControl = "public, max-age=86400";
        return File(logo.Content, logo.ContentType);
    }

    // A PNG, JPEG or WebP of up to a megabyte, replacing the one there was.
    [HttpPut("logo")]
    [Authorize(Policy = Permissions.SettingsManage)]
    [RequestSizeLimit(CompanySettings.MaxLogoBytes + 64 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = CompanySettings.MaxLogoBytes + 64 * 1024)]
    public async Task<ActionResult<CompanySettingsDto>> UploadLogo(IFormFile file, CancellationToken cancellationToken)
    {
        if (file.Length > CompanySettings.MaxLogoBytes)
            return UnprocessableEntity(new { errors = new[] { "A logo is a megabyte at most: save a smaller picture." } });
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
