using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Costing.Api.Auth;
using Costing.Application.InterBranch;
using Costing.Domain.Access;
using Costing.Domain.InterBranch;
using Costing.Infrastructure.Excel;

namespace Costing.Api.Controllers;

// The central kitchen's hub (المطبخ المركزي وتحويلات الفروع), for whoever keeps the stock or buys
// it (Stock counts, Raw materials or Purchases), in the branch chosen: requisitions asked, shipments
// dispatched and billed, receipts. Entered by whoever enters stock; a received shipment voided only
// by a manager. Costs, prices and totals for whoever sees costs.
[ApiController]
[Route("api/inter-branch")]
[CostingTab(CostingTabs.Counts | CostingTabs.Materials | CostingTabs.Purchases)]
public sealed class InterBranchController(ISender sender, Costing.Application.Common.IBusinessCalendar calendar) : ControllerBase
{
    // The hub for the branch: the last 30 days unless a period is asked for, with whatever is open.
    [HttpGet]
    [Authorize(Policy = Permissions.InventoryView)]
    public Task<InterBranchHubDto> Get([FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken cancellationToken)
    {
        var (start, end) = Period(from, to);
        return sender.Send(new GetInterBranchHubQuery(start, end, SeesCosts), cancellationToken);
    }

    [HttpGet("sheet")]
    [Authorize(Policy = Permissions.InventoryView)]
    public async Task<IActionResult> GetSheet([FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken cancellationToken)
    {
        var (start, end) = Period(from, to);
        var hub = await sender.Send(new GetInterBranchHubQuery(start, end, SeesCosts), cancellationToken);
        return File(InterBranchWorkbook.Build(hub, start, end), SheetFiles.ContentType, $"inter-branch-{start:yyyy-MM-dd}-{end:yyyy-MM-dd}.xlsx");
    }

    // Asked of a central kitchen or warehouse by the branch worked in; its id made by the app.
    [HttpPost("requisitions")]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<RequisitionDto> Submit(RequisitionRequest request, CancellationToken cancellationToken) =>
        sender.Send(new SubmitRequisitionCommand(
            request.Id, request.SupplyingBranchId, request.RequestedDeliveryDate, request.Lines ?? [], request.Notes, UserClaims.IdOf(User) ?? string.Empty,
            UserClaims.NameOf(User)), cancellationToken);

    [HttpPost("requisitions/{id:guid}/cancel")]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<RequisitionDto> Cancel(Guid id, CancellationToken cancellationToken) =>
        sender.Send(new CancelRequisitionCommand(id, UserClaims.NameOf(User)), cancellationToken);

    // Dispatched and billed by the central kitchen worked in.
    [HttpPost("shipments")]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<ShipmentDto> Dispatch(DispatchRequest request, CancellationToken cancellationToken) =>
        sender.Send(new DispatchShipmentCommand(
            request.Id, request.RequisitionId, request.ReceivingBranchId, request.FromLocationId, request.Pricing, request.MarkupPercent, request.Lines ?? [],
            request.Notes, UserClaims.IdOf(User) ?? string.Empty, UserClaims.NameOf(User), SeesCosts), cancellationToken);

    // Voided by the kitchen while it is on its way.
    [HttpPost("shipments/{id:guid}/void")]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<ShipmentDto> VoidShipment(Guid id, CancellationToken cancellationToken) =>
        sender.Send(new VoidShipmentCommand(id, UserClaims.NameOf(User), SeesCosts), cancellationToken);

    // Received by the branch worked in.
    [HttpPost("receipts")]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<ReceiptDto> Receive(ReceiveRequest request, CancellationToken cancellationToken) =>
        sender.Send(new ReceiveShipmentCommand(
            request.Id, request.ShipmentId, request.ToLocationId, request.Lines, request.Notes, UserClaims.IdOf(User) ?? string.Empty, UserClaims.NameOf(User),
            SeesCosts), cancellationToken);

    // A received shipment voided, with both its invoices: a manager's.
    [HttpPost("receipts/{id:guid}/void")]
    [Authorize(Policy = Permissions.ApprovalDecide)]
    public Task<ReceiptDto> VoidReceipt(Guid id, CancellationToken cancellationToken) =>
        sender.Send(new VoidReceiptCommand(id, UserClaims.NameOf(User), SeesCosts), cancellationToken);

    private (DateOnly From, DateOnly To) Period(DateOnly? from, DateOnly? to)
    {
        var today = calendar.BusinessDateOf(DateTime.UtcNow);
        return (from ?? today.AddDays(-30), to ?? today);
    }

    private bool SeesCosts => UserClaims.RoleOf(User) is { } role && RolePermissions.Has(role, Permissions.CostingView);
}

public sealed record RequisitionRequest(
    Guid Id, Guid SupplyingBranchId, DateOnly? RequestedDeliveryDate, IReadOnlyList<RequisitionLineInput>? Lines, string? Notes);

public sealed record DispatchRequest(
    Guid Id, Guid? RequisitionId, Guid? ReceivingBranchId, Guid? FromLocationId, TransferPricing Pricing, decimal? MarkupPercent,
    IReadOnlyList<DispatchLineInput>? Lines, string? Notes);

public sealed record ReceiveRequest(Guid Id, Guid ShipmentId, Guid? ToLocationId, IReadOnlyList<ReceiptLineInput>? Lines, string? Notes);
