using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Costing.Api.Auth;
using Costing.Application.Company;
using Costing.Domain.Access;
using Costing.Domain.Company;

namespace Costing.Api.Controllers;

// Company structure (هيكل الشركة), on Settings, a manager's (settings.manage): how the business is
// built, its branches and the locations each keeps stock in. The branches in use, for the branch
// selector, for anyone signed in.
[ApiController]
[Authorize(Policy = Permissions.SettingsManage)]
public sealed class CompanyStructureController(ISender sender) : ControllerBase
{
    [HttpGet("api/settings/company-structure")]
    public Task<CompanyStructureDto> Get(CancellationToken cancellationToken) => sender.Send(new GetCompanyStructureQuery(), cancellationToken);

    [HttpPut("api/settings/company-structure/mode")]
    public Task<CompanyStructureDto> ChangeMode(OperatingModeRequest request, CancellationToken cancellationToken) =>
        sender.Send(new ChangeOperatingModeCommand(request.Mode, UserClaims.IdOf(User) ?? string.Empty, UserClaims.NameOf(User)), cancellationToken);

    // Its id made by the app: added, or changed.
    [HttpPut("api/settings/branches/{id:guid}")]
    public Task<BranchDto> SaveBranch(Guid id, BranchRequest request, CancellationToken cancellationToken) =>
        sender.Send(new SaveBranchCommand(id, request.Name, request.NameAr, request.Type, request.IsActive), cancellationToken);

    [HttpPut("api/settings/locations/{id:guid}")]
    public Task<InventoryLocationDto> SaveLocation(Guid id, LocationRequest request, CancellationToken cancellationToken) =>
        sender.Send(new SaveInventoryLocationCommand(id, request.BranchId, request.Name, request.NameAr, request.Kind, request.IsActive, request.StationIds),
            cancellationToken);
}

// The branches in use and the company's structure, for the branch selector: anyone signed in.
[ApiController]
[Route("api/branches")]
[Authorize]
public sealed class BranchesController(ISender sender) : ControllerBase
{
    [HttpGet]
    public Task<BranchChoicesDto> Get(CancellationToken cancellationToken) => sender.Send(new GetBranchChoicesQuery(), cancellationToken);
}

public sealed record OperatingModeRequest(SystemOperatingMode Mode);

public sealed record BranchRequest(string Name, string? NameAr, BranchType Type = BranchType.Restaurant, bool IsActive = true);

// StationIds: the kitchen stations it serves; none leaves them as they are.
public sealed record LocationRequest(
    Guid BranchId, string Name, string? NameAr, LocationKind Kind = LocationKind.Other, bool IsActive = true, IReadOnlyList<Guid>? StationIds = null);
