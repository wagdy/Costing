using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Costing.Api.Auth;
using Costing.Application.Stock;
using Costing.Domain.Access;
using Costing.Infrastructure.Excel;

namespace Costing.Api.Controllers;

// Internal transfers (التحويلات الداخلية) between the locations of the branch worked in, for
// whoever keeps the stock (Stock counts or Raw materials); their costs for whoever sees costs.
// And the locations and what each has, for the screens that take or put stock somewhere.
[ApiController]
[Route("api/inventory")]
[CostingTab(CostingTabs.Counts | CostingTabs.Materials)]
public sealed class InternalTransfersController(ISender sender, Costing.Application.Common.IBusinessCalendar calendar) : ControllerBase
{
    [HttpGet("internal-transfers")]
    [Authorize(Policy = Permissions.InventoryView)]
    public Task<IReadOnlyList<InternalTransferDto>> GetAll([FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken cancellationToken)
    {
        var today = calendar.BusinessDateOf(DateTime.UtcNow);
        return sender.Send(new GetInternalTransfersQuery(from ?? today.AddDays(-30), to ?? today, SeesCosts), cancellationToken);
    }

    [HttpGet("internal-transfers/sheet")]
    [Authorize(Policy = Permissions.InventoryView)]
    public async Task<IActionResult> GetSheet([FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken cancellationToken)
    {
        var today = calendar.BusinessDateOf(DateTime.UtcNow);
        var (start, end) = (from ?? today.AddDays(-30), to ?? today);
        var transfers = await sender.Send(new GetInternalTransfersQuery(start, end, SeesCosts), cancellationToken);
        return File(InternalTransferWorkbook.Build(transfers, start, end), SheetFiles.ContentType, $"internal-transfers-{start:yyyy-MM-dd}-{end:yyyy-MM-dd}.xlsx");
    }

    [HttpGet("internal-transfers/{id:guid}")]
    [Authorize(Policy = Permissions.InventoryView)]
    public Task<InternalTransferDto> Get(Guid id, CancellationToken cancellationToken) =>
        sender.Send(new GetInternalTransferQuery(id, SeesCosts), cancellationToken);

    // Posted as it is made; its id made by the app, so sent again it comes back as it is.
    [HttpPost("internal-transfers")]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<InternalTransferDto> Post(PostTransferRequest request, CancellationToken cancellationToken) =>
        sender.Send(new PostInternalTransferCommand(
            request.Id, request.FromLocationId, request.ToLocationId, request.Lines ?? [], request.Notes, UserClaims.IdOf(User) ?? string.Empty,
            UserClaims.NameOf(User), SeesCosts), cancellationToken);

    [HttpPost("internal-transfers/{id:guid}/void")]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<InternalTransferDto> Void(Guid id, CancellationToken cancellationToken) =>
        sender.Send(new VoidInternalTransferCommand(id, UserClaims.NameOf(User), SeesCosts), cancellationToken);

    // The branch's locations in use, and the structure: the screens' location lists.
    [HttpGet("stock-locations")]
    [CostingTab(CostingTabs.All)]
    [Authorize(Policy = Permissions.InventoryView)]
    public Task<StockLocationsDto> GetLocations(CancellationToken cancellationToken) => sender.Send(new GetStockLocationsQuery(), cancellationToken);

    // What each location of the branch has.
    [HttpGet("location-stock")]
    [Authorize(Policy = Permissions.InventoryView)]
    public Task<LocationStockDto> GetLocationStock(CancellationToken cancellationToken) =>
        sender.Send(new GetLocationStockQuery(SeesCosts), cancellationToken);

    private bool SeesCosts => UserClaims.RoleOf(User) is { } role && RolePermissions.Has(role, Permissions.CostingView);
}

public sealed record PostTransferRequest(Guid Id, Guid FromLocationId, Guid ToLocationId, IReadOnlyList<TransferLineInput>? Lines, string? Notes);
