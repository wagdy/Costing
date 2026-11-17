using System.Globalization;
using MediatR;
using Costing.Application.Approvals;
using Costing.Application.Common;
using Costing.Domain.Approvals;
using Costing.Domain.Common;
using Costing.Domain.Purchases;
using Costing.Domain.RawMaterials;
using Costing.Domain.Suppliers;

namespace Costing.Application.Purchases;

// Purchase orders (أوامر الشراء): written as drafts (by hand, or from the order planner a supplier
// each), approved by a manager (anyone else's asked of one), sent to the supplier, then received
// against the supplier's invoices with the 3-way match (ThreeWayMatch). What each line has received
// is counted from the posted invoices that name the order (PurchaseOrderReceiver), so a voided or
// corrected invoice puts it right by itself. Ids are made by the till.

public sealed record PurchaseOrderLineDto(
    Guid Id,
    Guid RawMaterialId,
    string? Code,
    string Material,
    string PurchaseUnit,
    decimal PurchaseUnitSize,
    UnitOfMeasure Unit,
    decimal OrderedPurchaseQty,
    decimal ReceivedPurchaseQty,
    decimal RemainingQty,
    decimal ExpectedUnitCost,
    decimal LineTotal,
    string? LineNotes);

// An invoice received against the order: posted (or voided since), or waiting for a manager to
// sign its differences off; with its paper, when it has one.
public sealed record PurchaseOrderDelivery(
    Guid InvoiceId,
    string? SupplierInvoiceNumber,
    DateOnly? InvoiceDate,
    PurchaseInvoiceStatus Status,
    decimal Total,
    DateTime? PostedAtUtc,
    string? PostedBy,
    string? AttachmentFileName,
    bool ClosedTheOrder,
    bool AwaitingApproval);

public sealed record PurchaseOrderDto(
    Guid Id,
    string PoNumber,
    Guid SupplierId,
    string Supplier,
    string? SupplierPhone,
    DateOnly OrderDate,
    DateOnly? ExpectedDeliveryDate,
    PurchaseOrderTerms PaymentTerms,
    string? Notes,
    PurchaseOrderStatus Status,
    string CreatedBy,
    DateTime CreatedAtUtc,
    string? ApprovedBy,
    DateTime? ApprovedAtUtc,
    string? CancelledBy,
    DateTime? CancelledAtUtc,
    string? ClosedBy,
    DateTime? ClosedAtUtc,
    decimal ExpectedTotal,
    decimal RemainingValue,
    // How much of what was ordered has come, by expected value.
    decimal ReceivedPercent,
    IReadOnlyList<PurchaseOrderLineDto> Lines,
    IReadOnlyList<PurchaseOrderDelivery> Deliveries);

public sealed record PurchaseOrderSummaryDto(
    Guid Id,
    string PoNumber,
    Guid SupplierId,
    string Supplier,
    DateOnly OrderDate,
    DateOnly? ExpectedDeliveryDate,
    PurchaseOrderTerms PaymentTerms,
    PurchaseOrderStatus Status,
    int Lines,
    decimal ExpectedTotal,
    decimal RemainingValue,
    decimal ReceivedPercent,
    int Deliveries,
    string CreatedBy,
    string? ApprovedBy,
    // Late: open, and its expected day gone.
    bool Overdue);

// One item of a delivery against its order, named, for the screens and the manager.
public sealed record MatchLineDto(
    Guid RawMaterialId,
    string Material,
    string PurchaseUnit,
    decimal Ordered,
    decimal Remaining,
    decimal Received,
    decimal ExpectedUnitCost,
    decimal? NetUnitPrice,
    decimal? UnitOvercharge,
    decimal Overcharge,
    decimal QtyOver,
    decimal ShortBy,
    bool PriceOver,
    MatchStatus Status);

// An invoice against the order it delivers: how each item stands (a draft's, before it is posted),
// what was overbilled, whether a manager signs it off, and whether it closes the order.
public sealed record PurchaseOrderMatchDto(
    Guid PurchaseOrderId,
    string PoNumber,
    PurchaseOrderStatus Status,
    bool Closes,
    IReadOnlyList<MatchLineDto>? Lines,
    decimal Overcharge,
    bool HasShort,
    bool NeedsApproval);

public sealed record PurchaseOrderSaved(Guid Id, string PoNumber, PurchaseOrderStatus Status, ApprovalOutcome Outcome, ApprovalRequestDto? Request = null);

// Reads purchase orders for the screens: names, units and deliveries.
internal sealed class PurchaseOrderReading(
    IRawMaterialRepository materials, ISupplierRepository suppliers, IPurchaseInvoiceRepository invoices, IApprovalRequestRepository requests)
{
    public async Task<PurchaseOrderDto> DtoAsync(PurchaseOrder order, CancellationToken cancellationToken)
    {
        var byId = (await materials.GetByIdsAsync(order.Lines.Select(l => l.RawMaterialId), cancellationToken)).ToDictionary(m => m.Id);
        var supplier = await suppliers.GetByIdAsync(order.SupplierId, cancellationToken);
        var pending = (await requests.GetPendingAsync(cancellationToken))
            .Where(r => r.Module == ApprovalModule.PurchaseInvoice && r.Action == ApprovalAction.Create).Select(r => r.RecordId).ToHashSet();
        var deliveries = (await invoices.GetForOrderAsync(order.Id, cancellationToken))
            .Where(i => i.Status != PurchaseInvoiceStatus.Draft || pending.Contains(i.Id))
            .OrderBy(i => i.PostedAtUtc ?? i.CreatedAtUtc)
            .Select(i => new PurchaseOrderDelivery(
                i.Id, i.SupplierInvoiceNumber, i.InvoiceDate, i.Status, i.Total, i.PostedAtUtc, i.PostedBy, i.AttachmentFileName,
                order.ClosedByInvoiceId == i.Id, pending.Contains(i.Id)))
            .ToList();
        return new PurchaseOrderDto(
            order.Id, order.PoNumber, order.SupplierId, supplier?.Name ?? "A removed supplier", supplier?.Phone, order.OrderDate, order.ExpectedDeliveryDate,
            order.PaymentTerms, order.Notes, order.Status, order.CreatedBy, order.CreatedAtUtc, order.ApprovedBy, order.ApprovedAtUtc, order.CancelledBy,
            order.CancelledAtUtc, order.ClosedBy, order.ClosedAtUtc, order.ExpectedTotal, order.RemainingValue, ReceivedPercent(order),
            order.Lines.Select(l =>
            {
                var material = byId.GetValueOrDefault(l.RawMaterialId);
                return new PurchaseOrderLineDto(
                    l.Id, l.RawMaterialId, material?.Code, material?.Name ?? "A removed material", material?.PurchaseUnit ?? "unit",
                    material?.PurchaseUnitSize ?? 1, material?.Unit ?? UnitOfMeasure.Piece, l.OrderedPurchaseQty, l.ReceivedPurchaseQty, l.RemainingQty,
                    l.ExpectedUnitCost, l.LineTotal, l.LineNotes);
            }).ToList(),
            deliveries);
    }

    public static decimal ReceivedPercent(PurchaseOrder order) =>
        order.ExpectedTotal > 0
            ? Math.Round((order.ExpectedTotal - order.RemainingValue) * 100 / order.ExpectedTotal, 1, MidpointRounding.AwayFromZero)
            : order.Lines.All(l => l.RemainingQty == 0) ? 100 : 0;
}

// What a purchase order has received, counted from the posted invoices that name it; and an
// invoice set against its order (ThreeWayMatch), as it is posted and for a manager to sign off.
internal sealed class PurchaseOrderReceiver(
    IPurchaseOrderRepository orders,
    IPurchaseInvoiceRepository invoices,
    IRawMaterialRepository materials,
    ISupplierRepository suppliers)
{
    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

    // The order an invoice delivers, if it names one: from the same supplier.
    public async Task<PurchaseOrder?> OrderOfAsync(PurchaseInvoice invoice, CancellationToken cancellationToken)
    {
        if (invoice.PurchaseOrderId is not { } id)
            return null;
        var order = await orders.GetByIdAsync(id, cancellationToken) ?? throw new NotFoundException("Purchase order", id);
        if (order.SupplierId != invoice.SupplierId)
            throw new DomainException($"{order.PoNumber} is ordered from another supplier: choose its supplier, or another order. · أمر الشراء لمورد آخر.");
        return order;
    }

    // Open for a delivery: approved, and not complete or cancelled. A correction of an invoice
    // already against it is received whatever it stands at.
    public static void EnsureReceivable(PurchaseOrder order, PurchaseInvoice invoice)
    {
        if (invoice.RevisionOf is null && !order.IsOpen)
            throw new DomainException(order.Status == PurchaseOrderStatus.Draft
                ? $"{order.PoNumber} is not approved yet: a manager approves it before it is received. · أمر الشراء غير معتمد."
                : $"{order.PoNumber} is {PurchaseOrder.StatusName(order.Status)}: nothing more is received against it. · أمر الشراء مغلق.");
    }

    // What the invoice brings of each material, in purchase units, at what it cost net.
    public async Task<IReadOnlyList<DeliveredItem>> DeliveredAsync(PurchaseInvoice invoice, CancellationToken cancellationToken)
    {
        var stock = invoice.Lines.Where(l => l.ItemType == PurchaseItemType.Inventory && l.RawMaterialId is not null).ToList();
        var sizes = await SizesAsync(stock.Select(l => l.RawMaterialId!.Value), cancellationToken);
        return stock.Select(l => new DeliveredItem(l.RawMaterialId!.Value, l.Quantity / sizes.GetValueOrDefault(l.RawMaterialId!.Value, 1), l.Cost)).ToList();
    }

    public async Task<MatchResult> MatchAsync(PurchaseOrder order, PurchaseInvoice invoice, CancellationToken cancellationToken) =>
        ThreeWayMatch.Compare(order, await DeliveredAsync(invoice, cancellationToken));

    public async Task<PurchaseOrderMatchDto> MatchDtoAsync(PurchaseOrder order, PurchaseInvoice invoice, MatchResult? match, CancellationToken cancellationToken)
    {
        if (match is null)
            return new PurchaseOrderMatchDto(order.Id, order.PoNumber, order.Status, invoice.ClosesPurchaseOrder, null, 0, false, false);
        var named = (await materials.GetByIdsAsync(match.Lines.Select(l => l.RawMaterialId), cancellationToken)).ToDictionary(m => m.Id);
        return new PurchaseOrderMatchDto(
            order.Id, order.PoNumber, order.Status, invoice.ClosesPurchaseOrder,
            match.Lines.Select(l => new MatchLineDto(
                l.RawMaterialId, named.GetValueOrDefault(l.RawMaterialId)?.Name ?? "A removed material", named.GetValueOrDefault(l.RawMaterialId)?.PurchaseUnit ?? "unit",
                l.Ordered, l.Remaining, l.Received, l.ExpectedUnitCost, l.NetUnitPrice, l.UnitOvercharge, l.Overcharge, l.QtyOver, l.ShortBy, l.PriceOver,
                l.Status)).ToList(),
            match.Overcharge, match.HasShort, match.NeedsApproval);
    }

    // Posted against its order: counted in, and the order closed with what came when it says so.
    public async Task PostedAsync(PurchaseInvoice invoice, PurchaseOrder order, string by, CancellationToken cancellationToken)
    {
        await RecountAsync(order, invoice, cancellationToken);
        if (invoice.ClosesPurchaseOrder && order.IsOpen)
            order.Close(by, invoice.Id);
    }

    // Voided: what it brought comes off its order again, which may open again.
    public async Task VoidedAsync(PurchaseInvoice invoice, CancellationToken cancellationToken)
    {
        if (invoice.PurchaseOrderId is { } id && await orders.GetByIdAsync(id, cancellationToken) is { } order)
            await RecountAsync(order, invoice, cancellationToken);
    }

    private async Task RecountAsync(PurchaseOrder order, PurchaseInvoice changed, CancellationToken cancellationToken)
    {
        // The one in hand as it is now, posted or voided in this unit of work and not saved yet.
        var posted = (await invoices.GetForOrderAsync(order.Id, cancellationToken)).Where(i => i.Id != changed.Id).Append(changed)
            .Where(i => i.Status == PurchaseInvoiceStatus.Posted)
            .ToList();
        var lines = posted.SelectMany(i => i.Lines).Where(l => l.ItemType == PurchaseItemType.Inventory && l.RawMaterialId is not null).ToList();
        var sizes = await SizesAsync(lines.Select(l => l.RawMaterialId!.Value), cancellationToken);
        var received = lines.GroupBy(l => l.RawMaterialId!.Value)
            .ToDictionary(g => g.Key, g => g.Sum(l => l.Quantity / sizes.GetValueOrDefault(g.Key, 1)));
        order.Recount(received, order.ClosedByInvoiceId is not { } closer || posted.Any(i => i.Id == closer));
    }

    // "Invoice F-1 · Nile Farms against PO-2026-0001: L.E 40.00 overcharged, 1 item over", and each
    // difference, the order against the invoice.
    public async Task<(string Summary, IReadOnlyList<ApprovalChange> Changes)> DescribeAsync(
        PurchaseOrder order, PurchaseInvoice invoice, MatchResult match, CancellationToken cancellationToken)
    {
        var supplier = (await suppliers.GetByIdAsync(order.SupplierId, cancellationToken))?.Name ?? "a supplier";
        var named = (await materials.GetByIdsAsync(match.Lines.Select(l => l.RawMaterialId), cancellationToken)).ToDictionary(m => m.Id);
        var over = match.Lines.Count(l => l.QtyOver > 0);
        var parts = new List<string>();
        if (match.Overcharge > 0)
            parts.Add($"{Money(match.Overcharge)} overcharged");
        if (over > 0)
            parts.Add($"{over} {(over == 1 ? "item" : "items")} over the order");
        var summary = $"{(invoice.SupplierInvoiceNumber is { } number ? $"Invoice {number}" : "An invoice")} · {supplier} against {order.PoNumber}: " +
                      $"{string.Join(", ", parts)} · {Money(invoice.Total)}";
        var changes = new List<ApprovalChange> { new("Purchase order · أمر الشراء", null, $"{order.PoNumber} · {supplier}") };
        foreach (var line in match.Lines.Where(l => l.PriceOver || l.QtyOver > 0))
        {
            var material = named.GetValueOrDefault(line.RawMaterialId);
            var (name, unit) = (material?.Name ?? "A removed material", material?.PurchaseUnit ?? "unit");
            if (line.Status == MatchStatus.NotOrdered)
            {
                changes.Add(new ApprovalChange($"{name} · not ordered · غير مطلوب", "Not on the order", $"{Quantity(line.Received)} {unit} came"));
                continue;
            }
            if (line.PriceOver)
                changes.Add(new ApprovalChange(
                    $"{name} · price per {unit} · زيادة سعر", $"{Money(line.ExpectedUnitCost)} on the order",
                    $"{Money(line.NetUnitPrice ?? 0)} billed · +{Money(line.UnitOvercharge ?? 0)} each, {Money(line.Overcharge)} in all"));
            if (line.QtyOver > 0)
                changes.Add(new ApprovalChange(
                    $"{name} · quantity · كمية زائدة", $"{Quantity(line.Remaining)} {unit} left to come",
                    $"{Quantity(line.Received)} {unit} came · {Quantity(line.QtyOver)} over"));
        }
        changes.Add(new ApprovalChange("Invoice total · إجمالي الفاتورة", Money(order.RemainingValue) + " left on the order", Money(invoice.Total)));
        return (summary, changes);
    }

    private async Task<IReadOnlyDictionary<Guid, decimal>> SizesAsync(IEnumerable<Guid> ids, CancellationToken cancellationToken)
    {
        var distinct = ids.Distinct().ToList();
        return distinct.Count == 0
            ? new Dictionary<Guid, decimal>()
            : (await materials.GetByIdsAsync(distinct, cancellationToken)).ToDictionary(m => m.Id, m => m.PurchaseUnitSize > 0 ? m.PurchaseUnitSize : 1);
    }

    private static string Money(decimal value) => CompanyMoney.Text(value);

    private static string Quantity(decimal value) => value.ToString("#,##0.###", Invariant);
}

// What a posting request waiting for a manager holds: the invoice, and the order it is against.
public sealed record PostAgainstOrder(Guid InvoiceId, Guid PurchaseOrderId);

// ---- Writing them ----

public sealed record PurchaseOrderInput(
    Guid SupplierId,
    DateOnly OrderDate,
    DateOnly? ExpectedDeliveryDate,
    PurchaseOrderTerms PaymentTerms,
    string? Notes,
    IReadOnlyList<PurchaseOrderLineEntry> Lines);

// A draft written or rewritten. Id made by the till.
public sealed record SavePurchaseOrderCommand(Guid Id, PurchaseOrderInput Order, string StaffId, string StaffName)
    : IRequest<PurchaseOrderDto>, IRetryOnConflict;

// Approved: at once for a manager; asked of one for anyone else, the draft locked until then.
public sealed record ApprovePurchaseOrderCommand(Guid RequestId, Guid Id, string? Reason, string StaffId, string StaffName, bool CanApprove)
    : IRequest<PurchaseOrderSaved>, IRetryOnConflict;

// Called off before anything came: a draft by whoever wrote orders, an approved one by a manager.
public sealed record CancelPurchaseOrderCommand(Guid Id, string StaffName, bool CanApprove) : IRequest<PurchaseOrderDto>, IRetryOnConflict;

// What has not come is not expected any more: closed with what was received. A manager's.
public sealed record ClosePurchaseOrderCommand(Guid Id, string StaffName) : IRequest<PurchaseOrderDto>, IRetryOnConflict;

// Several written at once, a supplier each (from the order planner): all or none. A manager's are
// approved at once; anyone else's are drafts asked of a manager, each its own request.
public sealed record NewPurchaseOrder(Guid Id, PurchaseOrderInput Order);

public sealed record CreatePurchaseOrdersCommand(IReadOnlyList<NewPurchaseOrder> Orders, string StaffId, string StaffName, bool CanApprove)
    : IRequest<IReadOnlyList<PurchaseOrderSaved>>, IRetryOnConflict;

internal sealed class PurchaseOrderWriter(IPurchaseOrderRepository orders, ISupplierRepository suppliers, IRawMaterialRepository materials)
{
    public const int MaxAtOnce = 30;

    public async Task<PurchaseOrder> CreateAsync(Guid id, PurchaseOrderInput input, string staffId, string staffName, CancellationToken cancellationToken)
    {
        await CheckAsync(input, null, cancellationToken);
        var order = new PurchaseOrder(
            id, await orders.NextSequenceAsync(input.OrderDate.Year, cancellationToken), input.SupplierId, input.OrderDate, input.ExpectedDeliveryDate,
            input.PaymentTerms, input.Notes, input.Lines ?? [], staffId, staffName);
        orders.Add(order);
        return order;
    }

    public async Task ChangeAsync(PurchaseOrder order, PurchaseOrderInput input, CancellationToken cancellationToken)
    {
        await CheckAsync(input, order, cancellationToken);
        order.Change(input.SupplierId, input.OrderDate, input.ExpectedDeliveryDate, input.PaymentTerms, input.Notes, input.Lines ?? []);
    }

    // A supplier on the list, materials bought (not made) and not deleted: a draft keeps what it had.
    private async Task CheckAsync(PurchaseOrderInput input, PurchaseOrder? kept, CancellationToken cancellationToken)
    {
        var supplier = await suppliers.GetByIdAsync(input.SupplierId, cancellationToken)
            ?? throw new DomainException("That supplier is no longer on the list. Choose it again, or add it.");
        if (supplier.IsArchived && kept?.SupplierId != supplier.Id)
            throw new DomainException($"{supplier.Name} is archived. Restore it on the Suppliers tab to order from it again.");
        var ids = (input.Lines ?? []).Select(l => l.RawMaterialId).Distinct().ToList();
        var found = (await materials.GetByIdsAsync(ids, cancellationToken)).ToDictionary(m => m.Id);
        var had = kept?.Lines.Select(l => l.RawMaterialId).ToHashSet() ?? [];
        foreach (var id in ids)
        {
            if (found.GetValueOrDefault(id) is not { } material)
                throw new DomainException("An item on the order is no longer on the list. Choose it again.");
            if (material.IsPrepItem)
                throw new DomainException($"{material.Name} is made in the kitchen, not bought: make it with a production order.");
            if (material.IsArchived && !had.Contains(id))
                throw new DomainException($"{material.Name} has been deleted from the raw materials.");
        }
    }

    // "PO-2026-0001 · Nile Farms · 3 items · L.E 1,200.00, expected 18 Nov", and what it orders.
    public async Task<(string Summary, IReadOnlyList<ApprovalChange> Changes)> DescribeAsync(PurchaseOrder order, CancellationToken cancellationToken)
    {
        var supplier = (await suppliers.GetByIdAsync(order.SupplierId, cancellationToken))?.Name ?? "a supplier";
        var named = (await materials.GetByIdsAsync(order.Lines.Select(l => l.RawMaterialId), cancellationToken)).ToDictionary(m => m.Id);
        var summary = $"{order.PoNumber} · {supplier} · {order.Lines.Count} {(order.Lines.Count == 1 ? "item" : "items")} · {CompanyMoney.Text(order.ExpectedTotal)}" +
                      (order.ExpectedDeliveryDate is { } due ? $", expected {due.ToString("d MMM", CultureInfo.InvariantCulture)}" : "");
        var changes = new List<ApprovalChange>
        {
            new("Supplier · المورد", null, supplier),
            new("Paid · الدفع", null, order.PaymentTerms == PurchaseOrderTerms.Credit ? "On credit · آجل" : "Cash · نقدي"),
        };
        changes.AddRange(order.Lines.Select(l =>
        {
            var material = named.GetValueOrDefault(l.RawMaterialId);
            return new ApprovalChange(
                material?.Name ?? "A removed material", null,
                $"{l.OrderedPurchaseQty.ToString("#,##0.###", CultureInfo.InvariantCulture)} {material?.PurchaseUnit ?? "unit"} × {CompanyMoney.Text(l.ExpectedUnitCost)} = {CompanyMoney.Text(l.LineTotal)}");
        }));
        return (summary, changes);
    }
}

internal sealed class SavePurchaseOrderHandler(
    IPurchaseOrderRepository orders, PurchaseOrderWriter writer, PurchaseOrderReading reading, IApprovalRequestRepository requests, IUnitOfWork unitOfWork)
    : IRequestHandler<SavePurchaseOrderCommand, PurchaseOrderDto>
{
    public async Task<PurchaseOrderDto> Handle(SavePurchaseOrderCommand request, CancellationToken cancellationToken)
    {
        var order = await orders.GetByIdAsync(request.Id, cancellationToken);
        if (order is null)
            order = await writer.CreateAsync(request.Id, request.Order, request.StaffId, request.StaffName, cancellationToken);
        else
        {
            await requests.EnsureNotPendingAsync(order.Id, cancellationToken);
            await writer.ChangeAsync(order, request.Order, cancellationToken);
        }
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await reading.DtoAsync(order, cancellationToken);
    }
}

internal sealed class ApprovePurchaseOrderHandler(
    IPurchaseOrderRepository orders, PurchaseOrderWriter writer, IApprovalRequestRepository requests, IUnitOfWork unitOfWork)
    : IRequestHandler<ApprovePurchaseOrderCommand, PurchaseOrderSaved>
{
    public async Task<PurchaseOrderSaved> Handle(ApprovePurchaseOrderCommand request, CancellationToken cancellationToken)
    {
        var order = await orders.GetRequiredAsync(request.Id, cancellationToken);
        if (await requests.GetByIdAsync(request.RequestId, cancellationToken) is { } asked)
            return new PurchaseOrderSaved(order.Id, order.PoNumber, order.Status, asked.IsPending ? ApprovalOutcome.Requested : ApprovalOutcome.Applied,
                ApprovalRequestDto.From(asked));
        if (order.Status != PurchaseOrderStatus.Draft)
            return order.Status == PurchaseOrderStatus.Cancelled
                ? throw new DomainException($"{order.PoNumber} is cancelled.")
                : new PurchaseOrderSaved(order.Id, order.PoNumber, order.Status, ApprovalOutcome.Applied);
        await requests.EnsureNotPendingAsync(order.Id, cancellationToken);
        var saved = await PurchaseOrderApproval.ApproveOrAskAsync(order, request.RequestId, request.Reason, request.StaffId, request.StaffName, request.CanApprove,
            writer, requests, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return saved;
    }
}

internal static class PurchaseOrderApproval
{
    public static async Task<PurchaseOrderSaved> ApproveOrAskAsync(
        PurchaseOrder order, Guid requestId, string? reason, string staffId, string staffName, bool canApprove, PurchaseOrderWriter writer,
        IApprovalRequestRepository requests, CancellationToken cancellationToken)
    {
        if (canApprove)
        {
            order.Approve(staffId, staffName);
            return new PurchaseOrderSaved(order.Id, order.PoNumber, order.Status, ApprovalOutcome.Applied);
        }
        var (summary, changes) = await writer.DescribeAsync(order, cancellationToken);
        var asked = ApprovalRequest.AskToChange(
            requestId, ApprovalModule.PurchaseOrder, ApprovalAction.Create, order.Id, summary, changes, ApprovalPayload.Write(new { order.Id, order.PoNumber }),
            reason, staffId, staffName);
        requests.Add(asked);
        return new PurchaseOrderSaved(order.Id, order.PoNumber, order.Status, ApprovalOutcome.Requested, ApprovalRequestDto.From(asked));
    }
}

internal sealed class CancelPurchaseOrderHandler(
    IPurchaseOrderRepository orders, PurchaseOrderReading reading, IApprovalRequestRepository requests, IUnitOfWork unitOfWork)
    : IRequestHandler<CancelPurchaseOrderCommand, PurchaseOrderDto>
{
    public async Task<PurchaseOrderDto> Handle(CancelPurchaseOrderCommand request, CancellationToken cancellationToken)
    {
        var order = await orders.GetRequiredAsync(request.Id, cancellationToken);
        if (order.Status != PurchaseOrderStatus.Cancelled)
        {
            if (order.Status != PurchaseOrderStatus.Draft && !request.CanApprove)
                throw new DomainException($"{order.PoNumber} is approved: a manager calls it off. · إلغاء أمر شراء معتمد للمدير.");
            // A request waiting to approve it is turned down with it.
            if (await requests.GetPendingForAsync(order.Id, cancellationToken) is { } pending)
                pending.Reject(request.StaffName, "Cancelled · ألغي أمر الشراء");
            order.Cancel(request.StaffName);
            await unitOfWork.SaveChangesAsync(cancellationToken);
        }
        return await reading.DtoAsync(order, cancellationToken);
    }
}

internal sealed class ClosePurchaseOrderHandler(IPurchaseOrderRepository orders, PurchaseOrderReading reading, IUnitOfWork unitOfWork)
    : IRequestHandler<ClosePurchaseOrderCommand, PurchaseOrderDto>
{
    public async Task<PurchaseOrderDto> Handle(ClosePurchaseOrderCommand request, CancellationToken cancellationToken)
    {
        var order = await orders.GetRequiredAsync(request.Id, cancellationToken);
        if (order.Status != PurchaseOrderStatus.Completed)
        {
            order.Close(request.StaffName);
            await unitOfWork.SaveChangesAsync(cancellationToken);
        }
        return await reading.DtoAsync(order, cancellationToken);
    }
}

internal sealed class CreatePurchaseOrdersHandler(
    IPurchaseOrderRepository orders, PurchaseOrderWriter writer, ISupplierRepository suppliers, IApprovalRequestRepository requests, IUnitOfWork unitOfWork)
    : IRequestHandler<CreatePurchaseOrdersCommand, IReadOnlyList<PurchaseOrderSaved>>
{
    public async Task<IReadOnlyList<PurchaseOrderSaved>> Handle(CreatePurchaseOrdersCommand request, CancellationToken cancellationToken)
    {
        if (request.Orders.Count == 0)
            throw new DomainException("Nothing to order: approve a quantity first. · لا توجد كميات معتمدة.");
        if (request.Orders.Count > PurchaseOrderWriter.MaxAtOnce)
            throw new DomainException($"Write {PurchaseOrderWriter.MaxAtOnce} purchase orders at most at once.");
        if (request.Orders.Select(o => o.Id).Distinct().Count() != request.Orders.Count)
            throw new DomainException("The same purchase order is there twice.");

        var saved = new List<PurchaseOrderSaved>();
        var problems = new List<string>();
        foreach (var entry in request.Orders)
        {
            try
            {
                // Sent again after an answer was lost: written already.
                if (await orders.GetByIdAsync(entry.Id, cancellationToken) is { } made)
                {
                    var waiting = await requests.GetPendingForAsync(made.Id, cancellationToken);
                    saved.Add(new PurchaseOrderSaved(made.Id, made.PoNumber, made.Status, waiting is null ? ApprovalOutcome.Applied : ApprovalOutcome.Requested,
                        waiting is null ? null : ApprovalRequestDto.From(waiting)));
                    continue;
                }
                var order = await writer.CreateAsync(entry.Id, entry.Order, request.StaffId, request.StaffName, cancellationToken);
                saved.Add(await PurchaseOrderApproval.ApproveOrAskAsync(
                    order, entry.Id, null, request.StaffId, request.StaffName, request.CanApprove, writer, requests, cancellationToken));
            }
            catch (Exception error) when (error is DomainException or NotFoundException)
            {
                var supplier = (await suppliers.GetByIdAsync(entry.Order.SupplierId, cancellationToken))?.Name;
                problems.Add($"{supplier ?? "A supplier"}: {error.Message}");
            }
        }
        if (problems.Count > 0)
            throw new DomainException(string.Join("\n", problems));
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return saved;
    }
}

// ---- Reading them ----

// Newest first; Open: approved or partly received, for a delivery to be received against.
public sealed record GetPurchaseOrdersQuery(PurchaseOrderStatus? Status = null, bool OpenOnly = false, Guid? SupplierId = null, DateOnly? Today = null)
    : IRequest<IReadOnlyList<PurchaseOrderSummaryDto>>;

internal sealed class GetPurchaseOrdersHandler(IPurchaseOrderRepository orders, ISupplierRepository suppliers, IPurchaseInvoiceRepository invoices)
    : IRequestHandler<GetPurchaseOrdersQuery, IReadOnlyList<PurchaseOrderSummaryDto>>
{
    public async Task<IReadOnlyList<PurchaseOrderSummaryDto>> Handle(GetPurchaseOrdersQuery request, CancellationToken cancellationToken)
    {
        var names = (await suppliers.GetAllAsync(cancellationToken)).ToDictionary(s => s.Id, s => s.Name);
        var delivered = await invoices.GetDeliveriesByOrderAsync(cancellationToken);
        return (await orders.GetAllAsync(cancellationToken))
            .Where(o => (request.Status is null || o.Status == request.Status) && (!request.OpenOnly || o.IsOpen)
                && (request.SupplierId is null || o.SupplierId == request.SupplierId))
            .Select(o => new PurchaseOrderSummaryDto(
                o.Id, o.PoNumber, o.SupplierId, names.GetValueOrDefault(o.SupplierId) ?? "A removed supplier", o.OrderDate, o.ExpectedDeliveryDate,
                o.PaymentTerms, o.Status, o.Lines.Count, o.ExpectedTotal, o.RemainingValue, PurchaseOrderReading.ReceivedPercent(o),
                delivered.GetValueOrDefault(o.Id), o.CreatedBy, o.ApprovedBy,
                o.IsOpen && request.Today is { } today && o.ExpectedDeliveryDate < today))
            .ToList();
    }
}

public sealed record GetPurchaseOrderQuery(Guid Id) : IRequest<PurchaseOrderDto?>;

internal sealed class GetPurchaseOrderHandler(IPurchaseOrderRepository orders, PurchaseOrderReading reading)
    : IRequestHandler<GetPurchaseOrderQuery, PurchaseOrderDto?>
{
    public async Task<PurchaseOrderDto?> Handle(GetPurchaseOrderQuery request, CancellationToken cancellationToken) =>
        await orders.GetByIdAsync(request.Id, cancellationToken) is { } order ? await reading.DtoAsync(order, cancellationToken) : null;
}

// The open orders, in full, for a delivery to be received against: a supplier's, or everyone's.
public sealed record GetOpenPurchaseOrdersQuery(Guid? SupplierId = null) : IRequest<IReadOnlyList<PurchaseOrderDto>>;

internal sealed class GetOpenPurchaseOrdersHandler(IPurchaseOrderRepository orders, PurchaseOrderReading reading)
    : IRequestHandler<GetOpenPurchaseOrdersQuery, IReadOnlyList<PurchaseOrderDto>>
{
    public async Task<IReadOnlyList<PurchaseOrderDto>> Handle(GetOpenPurchaseOrdersQuery request, CancellationToken cancellationToken)
    {
        var open = (await orders.GetAllAsync(cancellationToken)).Where(o => o.IsOpen && (request.SupplierId is null || o.SupplierId == request.SupplierId)).ToList();
        var dtos = new List<PurchaseOrderDto>();
        foreach (var order in open)
            dtos.Add(await reading.DtoAsync(order, cancellationToken));
        return dtos;
    }
}
