using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Costing.Api.Auth;
using Costing.Application.Stations;
using Costing.Domain.Access;
using Costing.Infrastructure.Excel;
using Costing.Infrastructure.Reports;

namespace Costing.Api.Controllers;

// The kitchen and bar stations (أقسام التشغيل والمطبخ): listed for whoever sorts or counts by them,
// set by a manager on Cost settings; materials, prep items and dishes given one; and the station-level
// variance (انحراف الأقسام) on Material & demand intelligence and Reports.
[ApiController]
[Authorize(Policy = Permissions.InventoryView)]
public sealed class StationsController(ISender sender, IntelligenceService intelligence) : ControllerBase
{
    private const CostingTabs Readers =
        CostingTabs.Materials | CostingTabs.Recipes | CostingTabs.Production | CostingTabs.Waste | CostingTabs.Counts | CostingTabs.Intelligence
        | CostingTabs.Reports | CostingTabs.CostSettings;

    [HttpGet("api/costing/stations")]
    [CostingTab(Readers)]
    public Task<IReadOnlyList<KitchenStationDto>> GetStations(CancellationToken cancellationToken) =>
        sender.Send(new GetKitchenStationsQuery(), cancellationToken);

    // Made on its first save, changed after: a manager's.
    [HttpPut("api/costing/stations/{id:guid}")]
    [CostingTab(CostingTabs.CostSettings)]
    [Authorize(Policy = Permissions.ApprovalDecide)]
    public Task<KitchenStationDto> SaveStation(Guid id, SaveStationRequest request, CancellationToken cancellationToken) =>
        sender.Send(new SaveKitchenStationCommand(
            id, request.Name, request.NameAr, request.Code, request.DisplayOrder, request.TargetVarianceTolerancePercent, request.IsActive), cancellationToken);

    // Taken away: what it kept falls back to the shared station.
    [HttpDelete("api/costing/stations/{id:guid}")]
    [CostingTab(CostingTabs.CostSettings)]
    [Authorize(Policy = Permissions.ApprovalDecide)]
    public async Task<IActionResult> DeleteStation(Guid id, CancellationToken cancellationToken)
    {
        await sender.Send(new DeleteKitchenStationCommand(id), cancellationToken);
        return NoContent();
    }

    // Materials and prep items given a station (or none), one or many.
    [HttpPut("api/inventory/raw-materials/station")]
    [CostingTab(CostingTabs.Materials | CostingTabs.Recipes | CostingTabs.Production)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public async Task<StationAssigned> AssignMaterials(AssignMaterialsStationRequest request, CancellationToken cancellationToken) =>
        new(await sender.Send(new AssignMaterialStationCommand(request.RawMaterialIds ?? [], request.StationId), cancellationToken), request.StationId);

    [HttpPut("api/inventory/recipes/{id:guid}/station")]
    [CostingTab(CostingTabs.Recipes)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public async Task<StationAssigned> AssignRecipe(Guid id, AssignStationRequest request, CancellationToken cancellationToken) =>
        new(1, await sender.Send(new AssignRecipeStationCommand(id, request.StationId), cancellationToken));

    // Station-level variance over a period: each station's theoretical, actual, unexplained and waste.
    [HttpGet("api/costing/intelligence/station-variance")]
    [CostingTab(CostingTabs.Intelligence | CostingTabs.Reports)]
    public Task<StationVarianceReport> GetStationVariance([FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken cancellationToken) =>
        intelligence.GetStationVarianceAsync(from, to, cancellationToken);

    // As a workbook: a station summary sheet, and each station's materials.
    [HttpGet("api/costing/intelligence/station-variance/sheet")]
    [CostingTab(CostingTabs.Intelligence | CostingTabs.Reports)]
    public async Task<IActionResult> GetStationVarianceSheet([FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken cancellationToken) =>
        File(IntelligenceWorkbooks.StationVariance(await intelligence.GetStationVarianceAsync(from, to, cancellationToken)), ReportWorkbook.ContentType,
            $"station-variance-{from:yyyy-MM-dd}-to-{to:yyyy-MM-dd}.xlsx");
}

public sealed record SaveStationRequest(string Name, string? NameAr, string? Code, int DisplayOrder, decimal? TargetVarianceTolerancePercent, bool IsActive = true);

public sealed record AssignMaterialsStationRequest(IReadOnlyList<Guid>? RawMaterialIds, Guid? StationId);

public sealed record AssignStationRequest(Guid? StationId);

public sealed record StationAssigned(int Assigned, Guid? StationId);
