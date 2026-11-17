using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Costing.Api.Auth;
using Costing.Application.Approvals;
using Costing.Application.Common;
using Costing.Application.Purchases;
using Costing.Domain.Access;
using Costing.Domain.Purchases;

namespace Costing.Api.Controllers;

// Purchase orders (أوامر الشراء) on Purchases: written as drafts, by hand or from the order planner a
// supplier each (batch), approved by a manager (anyone else's asked of one: 202), printed or copied
// for the supplier, and received against the supplier's invoices (an invoice names the order it
// delivers: PUT api/inventory/purchase-invoices/{id} with purchaseOrderId). Ids are made by the till.
[ApiController]
[Route("api/inventory/purchase-orders")]
[Authorize(Policy = Permissions.InventoryManage)]
public sealed class PurchaseOrdersController(ISender sender, IBusinessCalendar calendar) : ControllerBase
{
    // Newest first: by status, the open ones only, or a supplier's.
    [HttpGet]
    [CostingTab(CostingTabs.Purchases | CostingTabs.Intelligence | CostingTabs.EndOfDay)]
    public Task<IReadOnlyList<PurchaseOrderSummaryDto>> GetOrders(
        [FromQuery] PurchaseOrderStatus? status, [FromQuery] bool open, [FromQuery] Guid? supplierId, CancellationToken cancellationToken) =>
        sender.Send(new GetPurchaseOrdersQuery(status, open, supplierId, calendar.BusinessDateOf(DateTime.UtcNow)), cancellationToken);

    // The open ones in full, what is left to come of each line, for a delivery to be received against.
    [HttpGet("open")]
    [CostingTab(CostingTabs.Purchases | CostingTabs.EndOfDay)]
    public Task<IReadOnlyList<PurchaseOrderDto>> GetOpenOrders([FromQuery] Guid? supplierId, CancellationToken cancellationToken) =>
        sender.Send(new GetOpenPurchaseOrdersQuery(supplierId), cancellationToken);

    [HttpGet("{id:guid}")]
    [CostingTab(CostingTabs.Purchases)]
    public async Task<ActionResult<PurchaseOrderDto>> GetOrder(Guid id, CancellationToken cancellationToken) =>
        await sender.Send(new GetPurchaseOrderQuery(id), cancellationToken) is { } order ? order : NotFound();

    // A draft, written or rewritten.
    [HttpPut("{id:guid}")]
    [CostingTab(CostingTabs.Purchases)]
    public Task<PurchaseOrderDto> SaveOrder(Guid id, PurchaseOrderInput request, CancellationToken cancellationToken) =>
        sender.Send(new SavePurchaseOrderCommand(id, request, StaffId, StaffName), cancellationToken);

    // Approved at once for a manager (200); asked of one for anyone else (202).
    [HttpPost("{id:guid}/approve")]
    [CostingTab(CostingTabs.Purchases)]
    public async Task<IActionResult> ApproveOrder(Guid id, ApprovePurchaseOrderRequest request, CancellationToken cancellationToken)
    {
        var saved = await sender.Send(new ApprovePurchaseOrderCommand(request.RequestId, id, request.Reason, StaffId, StaffName, CanApprove), cancellationToken);
        return saved.Outcome == ApprovalOutcome.Requested ? Accepted(saved) : Ok(saved);
    }

    // Called off before anything came: a draft by whoever writes orders, an approved one by a manager.
    [HttpPost("{id:guid}/cancel")]
    [CostingTab(CostingTabs.Purchases)]
    public Task<PurchaseOrderDto> CancelOrder(Guid id, CancellationToken cancellationToken) =>
        sender.Send(new CancelPurchaseOrderCommand(id, StaffName, CanApprove), cancellationToken);

    // What has not come is not expected any more. A manager's.
    [HttpPost("{id:guid}/close")]
    [CostingTab(CostingTabs.Purchases)]
    [Authorize(Policy = Permissions.ApprovalDecide)]
    public Task<PurchaseOrderDto> CloseOrder(Guid id, CancellationToken cancellationToken) =>
        sender.Send(new ClosePurchaseOrderCommand(id, StaffName), cancellationToken);

    // Several at once, a supplier each, from the order planner: all or none (422, each by its supplier).
    [HttpPost("batch")]
    [CostingTab(CostingTabs.Purchases | CostingTabs.Intelligence)]
    public Task<IReadOnlyList<PurchaseOrderSaved>> CreateOrders(CreatePurchaseOrdersRequest request, CancellationToken cancellationToken) =>
        sender.Send(new CreatePurchaseOrdersCommand(request.Orders ?? [], StaffId, StaffName, CanApprove), cancellationToken);

    private string StaffName => User.FindFirst(UserClaims.Name)?.Value ?? string.Empty;

    private string StaffId => UserClaims.IdOf(User) ?? string.Empty;

    private bool CanApprove => UserClaims.RoleOf(User) is { } role && RolePermissions.Has(role, Permissions.ApprovalDecide);
}

public sealed record ApprovePurchaseOrderRequest(Guid RequestId, string? Reason = null);

public sealed record CreatePurchaseOrdersRequest(IReadOnlyList<NewPurchaseOrder>? Orders);
