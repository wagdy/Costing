using MediatR;
using Costing.Application.Books;
using Costing.Application.Common;
using Costing.Application.Company;
using Costing.Application.Stock;
using Costing.Domain.Common;
using Costing.Domain.Company;
using Costing.Domain.InterBranch;
using Costing.Domain.RawMaterials;
using Costing.Domain.StockMovements;

namespace Costing.Application.InterBranch;

// The central kitchen's hub (مركز عمليات المطبخ المركزي وتحويلات الفروع), once the company runs
// several branches with a central kitchen: a branch asks for goods (a requisition), the kitchen
// sends and bills them (a dispatch and its internal sales invoice), and the branch receives them
// (its receipt and internal purchase invoice), its average cost moved by the price it paid. Each
// request works in the branch chosen: the kitchen dispatches, the branch asks and receives. Costs,
// prices and totals only for whoever sees costs.

public sealed record InterBranchBranchDto(Guid Id, string Name, string? NameAr, BranchType Type, bool IsActive);

public sealed record RequisitionLineDto(
    Guid RawMaterialId, string Material, string? Code, string Unit, decimal PurchaseUnitSize, decimal RequestedQuantity, decimal DispatchedQuantity,
    decimal ReceivedQuantity, string? Notes);

public sealed record RequisitionDto(
    Guid Id, string Number, Guid RequestingBranchId, string RequestingBranch, Guid SupplyingBranchId, string SupplyingBranch, DateOnly RequestDate,
    DateOnly? RequestedDeliveryDate, RequisitionStatus Status, string? Notes, string CreatedBy, DateTime CreatedAtUtc, DateTime? CancelledAtUtc,
    string? CancelledBy, IReadOnlyList<RequisitionLineDto> Lines);

public sealed record ShipmentLineDto(
    Guid RawMaterialId, string Material, string? Code, string Unit, decimal PurchaseUnitSize, decimal Quantity, decimal? ReceivedQuantity,
    decimal? UnitCost, decimal? TransferUnitPrice, decimal? LineRevenue, decimal? LineCogs);

public sealed record ShipmentDto(
    Guid Id, string Number, Guid? RequisitionId, string? RequisitionNumber, Guid SupplyingBranchId, string SupplyingBranch, Guid ReceivingBranchId,
    string ReceivingBranch, Guid FromLocationId, string FromLocation, DateOnly DispatchDate, TransferPricing Pricing, decimal? MarkupPercent,
    ShipmentStatus Status, string? Notes, string CreatedBy, DateTime CreatedAtUtc, DateTime? ReceivedAtUtc, Guid? ReceiptId, string? ReceiptNumber,
    DateTime? VoidedAtUtc, string? VoidedBy, bool IsInterCompany, decimal? TotalTransferRevenue, decimal? TotalInternalCogs, decimal? InternalMargin,
    IReadOnlyList<ShipmentLineDto> Lines);

public sealed record ReceiptLineDto(
    Guid RawMaterialId, string Material, string? Code, string Unit, decimal PurchaseUnitSize, decimal DispatchedQuantity, decimal ReceivedQuantity,
    decimal ShortQuantity, decimal? TransferUnitPrice, decimal? LineTotal, decimal? TransitLoss);

public sealed record ReceiptDto(
    Guid Id, string Number, Guid ShipmentId, string ShipmentNumber, Guid? RequisitionId, string? RequisitionNumber, Guid SupplyingBranchId,
    string SupplyingBranch, Guid ReceivingBranchId, string ReceivingBranch, Guid ToLocationId, string ToLocation, DateOnly ReceiptDate,
    InternalPurchaseInvoiceStatus Status, string? Notes, string CreatedBy, DateTime CreatedAtUtc, DateTime? VoidedAtUtc, string? VoidedBy,
    bool IsInterCompany, decimal? TotalBilled, decimal? TotalReceivedValue, decimal? TotalTransitLoss, IReadOnlyList<ReceiptLineDto> Lines);

// The hub's cards, for the branch worked in: requisitions still open (asked by it or of it),
// shipments on their way (sent by it or to it), receipts this month, and what was billed this month
// between it and the others (whoever sees costs).
public sealed record InterBranchSummaryDto(int OpenRequisitions, int ShipmentsInTransit, int ReceiptsThisMonth, decimal? BillingThisMonth);

public sealed record InterBranchHubDto(
    SystemOperatingMode Mode, Guid BranchId, string Branch, BranchType BranchType, IReadOnlyList<InterBranchBranchDto> Branches,
    InterBranchSummaryDto Summary, IReadOnlyList<RequisitionDto> Requisitions, IReadOnlyList<ShipmentDto> Shipments, IReadOnlyList<ReceiptDto> Receipts);

// The hub for the branch worked in: its requisitions, shipments and receipts of the period, with
// whatever is still open or on its way whenever it was made. Outside a central kitchen's company:
// the mode, and nothing else.
public sealed record GetInterBranchHubQuery(DateOnly From, DateOnly To, bool SeeCosts = true) : IRequest<InterBranchHubDto>;

public sealed record RequisitionLineInput(Guid RawMaterialId, decimal Quantity, string? Notes = null);

// Asked by the branch worked in of a central kitchen or warehouse. Nothing moves: no books.
public sealed record SubmitRequisitionCommand(
    Guid Id, Guid SupplyingBranchId, DateOnly? RequestedDeliveryDate, IReadOnlyList<RequisitionLineInput> Lines, string? Notes, string StaffId,
    string StaffName) : IRequest<RequisitionDto>, IRetryOnConflict;

// Called off, by either branch, before anything of it is dispatched.
public sealed record CancelRequisitionCommand(Guid Id, string StaffName) : IRequest<RequisitionDto>;

public sealed record DispatchLineInput(Guid RawMaterialId, decimal Quantity, decimal? TransferUnitPrice = null);

// Sent and billed by the central kitchen worked in, today: for a requisition, or straight to a
// branch (ReceivingBranchId). From one of its locations (its main store unless another is chosen).
// Prices per line only from whoever sees costs.
public sealed record DispatchShipmentCommand(
    Guid Id, Guid? RequisitionId, Guid? ReceivingBranchId, Guid? FromLocationId, TransferPricing Pricing, decimal? MarkupPercent,
    IReadOnlyList<DispatchLineInput> Lines, string? Notes, string StaffId, string StaffName, bool SeeCosts = true)
    : IRequest<ShipmentDto>, IRetryOnConflict, IBooksEntry
{
    bool IBooksEntry.WritesToday => true;
}

// Voided by the kitchen while it is on its way: its stock back where it left, on its own day's books.
public sealed record VoidShipmentCommand(Guid Id, string StaffName, bool SeeCosts = true) : IRequest<ShipmentDto>, IBooksEntry;

public sealed record ReceiptLineInput(Guid RawMaterialId, decimal ReceivedQuantity);

// Received by the branch worked in, today, into one of its locations (its main store unless
// another is chosen): each line as said, or all of it.
public sealed record ReceiveShipmentCommand(
    Guid Id, Guid ShipmentId, Guid? ToLocationId, IReadOnlyList<ReceiptLineInput>? Lines, string? Notes, string StaffId, string StaffName,
    bool SeeCosts = true) : IRequest<ReceiptDto>, IRetryOnConflict, IBooksEntry
{
    bool IBooksEntry.WritesToday => true;
}

// Voided by a manager: the receipt and the kitchen's invoice, both sides' stock, on both days' books.
public sealed record VoidReceiptCommand(Guid Id, string StaffName, bool SeeCosts = true) : IRequest<ReceiptDto>, IBooksEntry;

// What the hub's names and numbers come from, read once for a set of records.
internal sealed class InterBranchReading(
    IBranchRepository branches,
    IInventoryLocationRepository locations,
    IRawMaterialRepository materials,
    IInterBranchRequisitionRepository requisitions,
    IInternalSalesInvoiceRepository shipments,
    IInternalPurchaseInvoiceRepository receipts)
{
    public async Task<(IReadOnlyList<RequisitionDto>, IReadOnlyList<ShipmentDto>, IReadOnlyList<ReceiptDto>)> DtosAsync(
        IReadOnlyList<InterBranchRequisition> asked, IReadOnlyList<InternalSalesInvoice> sent, IReadOnlyList<InternalPurchaseInvoice> received, bool seeCosts,
        CancellationToken cancellationToken)
    {
        var branchNames = (await branches.GetAllAsync(cancellationToken)).ToDictionary(b => b.Id, b => b.Name);
        var places = (await locations.GetAllAsync(cancellationToken)).ToDictionary(l => l.Id, l => l.Name);
        var ids = asked.SelectMany(r => r.Lines.Select(l => l.RawMaterialId))
            .Concat(sent.SelectMany(s => s.Lines.Select(l => l.RawMaterialId)))
            .Concat(received.SelectMany(r => r.Lines.Select(l => l.RawMaterialId)))
            .Distinct().ToList();
        var named = ids.Count == 0 ? new Dictionary<Guid, RawMaterial>() : (await materials.GetByIdsAsync(ids, cancellationToken)).ToDictionary(m => m.Id);

        // The numbers each names: its requisition, its receipt, its shipment.
        var requisitionIds = sent.Select(s => s.RequisitionId).Concat(received.Select(r => r.RequisitionId)).OfType<Guid>()
            .Where(id => asked.All(r => r.Id != id)).Distinct().ToList();
        var requisitionNumbers = asked.ToDictionary(r => r.Id, r => r.Number);
        foreach (var r in requisitionIds.Count == 0 ? [] : await requisitions.GetByIdsAsync(requisitionIds, cancellationToken))
            requisitionNumbers[r.Id] = r.Number;
        var receiptIds = sent.Select(s => s.InternalPurchaseInvoiceId).OfType<Guid>().Where(id => received.All(r => r.Id != id)).Distinct().ToList();
        var receiptNumbers = received.ToDictionary(r => r.Id, r => r.Number);
        foreach (var r in receiptIds.Count == 0 ? [] : await receipts.GetByIdsAsync(receiptIds, cancellationToken))
            receiptNumbers[r.Id] = r.Number;
        var shipmentIds = received.Select(r => r.InternalSalesInvoiceId).Where(id => sent.All(s => s.Id != id)).Distinct().ToList();
        var shipmentNumbers = sent.ToDictionary(s => s.Id, s => s.Number);
        foreach (var s in shipmentIds.Count == 0 ? [] : await shipments.GetByIdsAsync(shipmentIds, cancellationToken))
            shipmentNumbers[s.Id] = s.Number;

        string Branch(Guid id) => branchNames.GetValueOrDefault(id) ?? "—";
        string Place(Guid id) => places.GetValueOrDefault(id) ?? "—";
        (string Name, string? Code, decimal Size) Material(Guid id) =>
            named.GetValueOrDefault(id) is { } m ? (m.Name, m.Code, m.PurchaseUnitSize) : ("—", null, 1);
        decimal? Seen(decimal value) => seeCosts ? value : null;

        var requisitionDtos = asked.Select(r => new RequisitionDto(
            r.Id, r.Number, r.RequestingBranchId, Branch(r.RequestingBranchId), r.SupplyingBranchId, Branch(r.SupplyingBranchId), r.RequestDate,
            r.RequestedDeliveryDate, r.Status, r.Notes, r.CreatedBy, r.CreatedAtUtc, r.CancelledAtUtc, r.CancelledBy,
            r.Lines.Select(l =>
            {
                var m = Material(l.RawMaterialId);
                return new RequisitionLineDto(l.RawMaterialId, m.Name, m.Code, l.Unit, m.Size, l.RequestedQuantity, l.DispatchedQuantity, l.ReceivedQuantity, l.Notes);
            }).ToList())).ToList();
        var shipmentDtos = sent.Select(s => new ShipmentDto(
            s.Id, s.Number, s.RequisitionId, s.RequisitionId is { } rq ? requisitionNumbers.GetValueOrDefault(rq) : null, s.SupplyingBranchId,
            Branch(s.SupplyingBranchId), s.ReceivingBranchId, Branch(s.ReceivingBranchId), s.FromLocationId, Place(s.FromLocationId), s.DispatchDate,
            s.Pricing, seeCosts ? s.MarkupPercent : null, s.Status, s.Notes, s.CreatedBy, s.CreatedAtUtc, s.ReceivedAtUtc, s.InternalPurchaseInvoiceId,
            s.InternalPurchaseInvoiceId is { } rc ? receiptNumbers.GetValueOrDefault(rc) : null, s.VoidedAtUtc, s.VoidedBy, s.IsInterCompany,
            Seen(s.TotalTransferRevenue), Seen(s.TotalInternalCogs), Seen(s.InternalMargin),
            s.Lines.Select(l =>
            {
                var m = Material(l.RawMaterialId);
                return new ShipmentLineDto(l.RawMaterialId, m.Name, m.Code, l.Unit, m.Size, l.Quantity, l.ReceivedQuantity, Seen(l.UnitCost),
                    Seen(l.TransferUnitPrice), Seen(l.LineRevenue), Seen(l.LineCogs));
            }).ToList())).ToList();
        var receiptDtos = received.Select(r => new ReceiptDto(
            r.Id, r.Number, r.InternalSalesInvoiceId, shipmentNumbers.GetValueOrDefault(r.InternalSalesInvoiceId) ?? "—", r.RequisitionId,
            r.RequisitionId is { } rq ? requisitionNumbers.GetValueOrDefault(rq) : null, r.SupplyingBranchId, Branch(r.SupplyingBranchId),
            r.ReceivingBranchId, Branch(r.ReceivingBranchId), r.ToLocationId, Place(r.ToLocationId), r.ReceiptDate, r.Status, r.Notes, r.CreatedBy,
            r.CreatedAtUtc, r.VoidedAtUtc, r.VoidedBy, r.IsInterCompany, Seen(r.TotalBilled), Seen(r.TotalReceivedValue), Seen(r.TotalTransitLoss),
            r.Lines.Select(l =>
            {
                var m = Material(l.RawMaterialId);
                return new ReceiptLineDto(l.RawMaterialId, m.Name, m.Code, l.Unit, m.Size, l.DispatchedQuantity, l.ReceivedQuantity, l.ShortQuantity,
                    Seen(l.TransferUnitPrice), Seen(l.LineTotal), Seen(l.TransitLoss));
            }).ToList())).ToList();
        return (requisitionDtos, shipmentDtos, receiptDtos);
    }

    public async Task<RequisitionDto> DtoAsync(InterBranchRequisition requisition, CancellationToken cancellationToken) =>
        (await DtosAsync([requisition], [], [], false, cancellationToken)).Item1[0];

    public async Task<ShipmentDto> DtoAsync(InternalSalesInvoice shipment, bool seeCosts, CancellationToken cancellationToken) =>
        (await DtosAsync([], [shipment], [], seeCosts, cancellationToken)).Item2[0];

    public async Task<ReceiptDto> DtoAsync(InternalPurchaseInvoice receipt, bool seeCosts, CancellationToken cancellationToken) =>
        (await DtosAsync([], [], [receipt], seeCosts, cancellationToken)).Item3[0];
}

// The rules every request of the hub shares: the company runs a central kitchen; the branch worked in.
internal sealed class InterBranchDesk(ICompanyProfile profile, ICurrentBranch current, IBranchRepository branches, IInventoryLocationRepository locations)
{
    public void EnsureCentralKitchen()
    {
        if (profile.Current.OperatingMode != SystemOperatingMode.MultiBranch_CentralKitchen)
            throw new DomainException(
                "The company is not run with a central kitchen: choose Branches with a central kitchen on Company structure first. · الشركة ليست بنظام المطبخ المركزي.");
    }

    public async Task<Branch> HereAsync(CancellationToken cancellationToken) =>
        await BranchAsync(await current.BranchIdAsync(cancellationToken), cancellationToken);

    public async Task<Branch> BranchAsync(Guid id, CancellationToken cancellationToken) =>
        await branches.GetByIdAsync(id, cancellationToken) ?? throw new DomainException("That branch is no longer there: choose one from the list. · الفرع غير موجود.");

    // A location of the branch: the one chosen, or its main store.
    public async Task<InventoryLocation> PlaceAsync(Branch branch, Guid? chosen, CancellationToken cancellationToken)
    {
        var all = (await locations.GetAllAsync(cancellationToken)).Where(l => l.BranchId == branch.Id).ToList();
        if (chosen is { } id)
            return all.FirstOrDefault(l => l.Id == id)
                ?? throw new DomainException("That location is not one of this branch's: choose one from the list. · الموقع تابع لفرع آخر.");
        return all.Where(l => l.IsActive).OrderBy(l => l.Kind == LocationKind.MainStore ? 0 : 1).ThenByDescending(l => l.IsDefault).FirstOrDefault()
            ?? throw new DomainException($"{branch.Name} has no location in use: add one on Company structure. · لا يوجد موقع للفرع.");
    }
}

internal sealed class GetInterBranchHubHandler(
    ICompanyProfile profile,
    IBranchRepository branches,
    InterBranchDesk desk,
    IInterBranchRequisitionRepository requisitions,
    IInternalSalesInvoiceRepository shipments,
    IInternalPurchaseInvoiceRepository receipts,
    IBusinessCalendar calendar,
    InterBranchReading reading) : IRequestHandler<GetInterBranchHubQuery, InterBranchHubDto>
{
    public async Task<InterBranchHubDto> Handle(GetInterBranchHubQuery request, CancellationToken cancellationToken)
    {
        if (request.To < request.From)
            throw new DomainException("The period ends before it starts.");
        if (request.To.DayNumber - request.From.DayNumber > 366)
            throw new DomainException("Show a year at most.");
        var mode = profile.Current.OperatingMode;
        var here = await desk.HereAsync(cancellationToken);
        var all = (await branches.GetAllAsync(cancellationToken))
            .Select(b => new InterBranchBranchDto(b.Id, b.Name, b.NameAr, b.Type, b.IsActive)).ToList();
        if (mode != SystemOperatingMode.MultiBranch_CentralKitchen)
            return new InterBranchHubDto(mode, here.Id, here.Name, here.Type, all, new InterBranchSummaryDto(0, 0, 0, request.SeeCosts ? 0 : null), [], [], []);

        var asked = (await requisitions.GetForBranchAsync(here.Id, request.From, request.To, cancellationToken))
            .OrderByDescending(r => r.RequestDate).ThenByDescending(r => r.Number, StringComparer.Ordinal).ToList();
        var sent = (await shipments.GetForBranchAsync(here.Id, request.From, request.To, cancellationToken))
            .OrderByDescending(s => s.DispatchDate).ThenByDescending(s => s.Number, StringComparer.Ordinal).ToList();
        var received = (await receipts.GetForBranchAsync(here.Id, request.From, request.To, cancellationToken))
            .OrderByDescending(r => r.ReceiptDate).ThenByDescending(r => r.Number, StringComparer.Ordinal).ToList();

        var today = calendar.BusinessDateOf(DateTime.UtcNow);
        var monthStart = new DateOnly(today.Year, today.Month, 1);
        var receivedThisMonth = (await receipts.GetForBranchAsync(here.Id, monthStart, today, cancellationToken))
            .Count(r => r.Status == InternalPurchaseInvoiceStatus.Posted);
        decimal? billed = request.SeeCosts
            ? (await shipments.GetForBranchAsync(here.Id, monthStart, today, cancellationToken))
                .Where(s => s.Status != ShipmentStatus.Voided && s.DispatchDate >= monthStart).Sum(s => s.TotalTransferRevenue)
            : null;
        var summary = new InterBranchSummaryDto(
            asked.Count(r => r.Status is RequisitionStatus.Submitted or RequisitionStatus.PartiallyDispatched),
            sent.Count(s => s.Status == ShipmentStatus.InTransit), receivedThisMonth, billed);
        var (r1, s1, p1) = await reading.DtosAsync(asked, sent, received, request.SeeCosts, cancellationToken);
        return new InterBranchHubDto(mode, here.Id, here.Name, here.Type, all, summary, r1, s1, p1);
    }
}

internal sealed class SubmitRequisitionHandler(
    InterBranchDesk desk,
    IInterBranchRequisitionRepository requisitions,
    IRawMaterialRepository materials,
    IBusinessCalendar calendar,
    InterBranchReading reading,
    IUnitOfWork unitOfWork) : IRequestHandler<SubmitRequisitionCommand, RequisitionDto>
{
    public async Task<RequisitionDto> Handle(SubmitRequisitionCommand request, CancellationToken cancellationToken)
    {
        if (await requisitions.GetByIdAsync(request.Id, cancellationToken) is { } already)
            return await reading.DtoAsync(already, cancellationToken);
        desk.EnsureCentralKitchen();
        var requesting = await desk.HereAsync(cancellationToken);
        var supplying = await desk.BranchAsync(request.SupplyingBranchId, cancellationToken);
        var lines = request.Lines ?? [];
        var byId = lines.Count == 0
            ? new Dictionary<Guid, RawMaterial>()
            : (await materials.GetByIdsAsync(lines.Select(l => l.RawMaterialId).Distinct().ToList(), cancellationToken)).ToDictionary(m => m.Id);
        var asked = lines.Select(l =>
        {
            var material = byId.GetValueOrDefault(l.RawMaterialId) ?? throw new NotFoundException(nameof(RawMaterial), l.RawMaterialId);
            if (material.IsArchived)
                throw new DomainException($"{material.Name} has been archived: it is not asked for any more.");
            return (material, l.Quantity, l.Notes);
        }).ToList();
        var today = calendar.BusinessDateOf(DateTime.UtcNow);
        var number = InterBranchRequisition.NumberFor(today.Year, await requisitions.CountInYearAsync(today.Year, cancellationToken) + 1);
        var requisition = InterBranchRequisition.Submit(
            request.Id, number, requesting, supplying, today, request.RequestedDeliveryDate, asked, request.Notes, request.StaffName, request.StaffId);
        requisitions.Add(requisition);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await reading.DtoAsync(requisition, cancellationToken);
    }
}

internal sealed class CancelRequisitionHandler(
    ICurrentBranch current, IInterBranchRequisitionRepository requisitions, InterBranchReading reading, IUnitOfWork unitOfWork)
    : IRequestHandler<CancelRequisitionCommand, RequisitionDto>
{
    public async Task<RequisitionDto> Handle(CancelRequisitionCommand request, CancellationToken cancellationToken)
    {
        var requisition = await requisitions.GetByIdAsync(request.Id, cancellationToken)
            ?? throw new NotFoundException(nameof(InterBranchRequisition), request.Id);
        var here = await current.BranchIdAsync(cancellationToken);
        if (here != requisition.RequestingBranchId && here != requisition.SupplyingBranchId)
            throw new DomainException($"{requisition.Number} is between two other branches: cancel it from one of them. · الطلب بين فرعين آخرين.");
        requisition.Cancel(request.StaffName);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await reading.DtoAsync(requisition, cancellationToken);
    }
}

internal sealed class DispatchShipmentHandler(
    InterBranchDesk desk,
    IInterBranchRequisitionRepository requisitions,
    IInternalSalesInvoiceRepository shipments,
    IRawMaterialRepository materials,
    IStockMovementRepository movements,
    IStockBalances balances,
    StockPlaces places,
    BooksGuard books,
    InterBranchReading reading,
    IUnitOfWork unitOfWork) : IRequestHandler<DispatchShipmentCommand, ShipmentDto>
{
    public async Task<ShipmentDto> Handle(DispatchShipmentCommand request, CancellationToken cancellationToken)
    {
        if (await shipments.GetByIdAsync(request.Id, cancellationToken) is { } already)
            return await reading.DtoAsync(already, request.SeeCosts, cancellationToken);
        desk.EnsureCentralKitchen();
        var supplying = await desk.HereAsync(cancellationToken);
        var requisition = request.RequisitionId is { } asked
            ? await requisitions.GetByIdAsync(asked, cancellationToken) ?? throw new NotFoundException(nameof(InterBranchRequisition), asked)
            : null;
        var receivingId = requisition?.RequestingBranchId ?? request.ReceivingBranchId
            ?? throw new DomainException("Choose the branch it goes to. · اختر الفرع المستلم.");
        var receiving = await desk.BranchAsync(receivingId, cancellationToken);
        var from = await desk.PlaceAsync(supplying, request.FromLocationId, cancellationToken);

        // Lines with nothing to send are left off: a requisition's lines the kitchen has none of today.
        var lines = (request.Lines ?? []).Where(l => l.Quantity != 0).ToList();
        var byId = lines.Count == 0
            ? new Dictionary<Guid, RawMaterial>()
            : (await materials.GetByIdsAsync(lines.Select(l => l.RawMaterialId).Distinct().ToList(), cancellationToken)).ToDictionary(m => m.Id);
        var chosen = lines.Select(l =>
        {
            var material = byId.GetValueOrDefault(l.RawMaterialId) ?? throw new NotFoundException(nameof(RawMaterial), l.RawMaterialId);
            if (material.IsArchived)
                throw new DomainException($"{material.Name} has been archived: it is not sent any more.");
            // Prices are set by whoever sees what the goods cost.
            return new InternalSalesInvoice.DispatchLine(material, l.Quantity, request.SeeCosts ? l.TransferUnitPrice : null);
        }).ToList();

        // At the kitchen's average cost; checked against what the location it leaves has.
        await places.ViewAsync(byId.Values, from.Id, cancellationToken);
        var onHand = await balances.OnHandAsync(supplying.Id, from.Id, cancellationToken);
        var today = books.Today;
        var number = InternalSalesInvoice.NumberFor(today.Year, await shipments.CountInYearAsync(today.Year, cancellationToken) + 1);
        var (shipment, ledger) = InternalSalesInvoice.Dispatch(
            request.Id, number, supplying, receiving, requisition, today, from, chosen, request.Pricing, request.MarkupPercent, onHand, request.Notes,
            request.StaffName, request.StaffId);
        shipments.Add(shipment);
        foreach (var movement in ledger)
            movements.Add(movement);
        await InterBranchLedger.RestateAsync(requisitions, shipments, shipment, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await reading.DtoAsync(shipment, request.SeeCosts, cancellationToken);
    }
}

internal sealed class VoidShipmentHandler(
    ICurrentBranch current,
    IInterBranchRequisitionRepository requisitions,
    IInternalSalesInvoiceRepository shipments,
    IRawMaterialRepository materials,
    IStockMovementRepository movements,
    InterBranchReading reading,
    IUnitOfWork unitOfWork) : IRequestHandler<VoidShipmentCommand, ShipmentDto>
{
    public async Task<ShipmentDto> Handle(VoidShipmentCommand request, CancellationToken cancellationToken)
    {
        var shipment = await shipments.GetByIdAsync(request.Id, cancellationToken) ?? throw new NotFoundException(nameof(InternalSalesInvoice), request.Id);
        if (await current.BranchIdAsync(cancellationToken) != shipment.SupplyingBranchId)
            throw new DomainException($"{shipment.Number} was sent by another branch: it is voided there. · يُلغى من المطبخ المرسل.");
        shipment.Void(request.StaffName);
        await InterBranchLedger.ReverseAsync(materials, movements, shipment.Id, StockMovementReason.InterBranchDispatchOut, request.StaffName, cancellationToken);
        await InterBranchLedger.RestateAsync(requisitions, shipments, shipment, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await reading.DtoAsync(shipment, request.SeeCosts, cancellationToken);
    }
}

internal sealed class ReceiveShipmentHandler(
    InterBranchDesk desk,
    IInterBranchRequisitionRepository requisitions,
    IInternalSalesInvoiceRepository shipments,
    IInternalPurchaseInvoiceRepository receipts,
    IRawMaterialRepository materials,
    IStockMovementRepository movements,
    BooksGuard books,
    InterBranchReading reading,
    IUnitOfWork unitOfWork) : IRequestHandler<ReceiveShipmentCommand, ReceiptDto>
{
    public async Task<ReceiptDto> Handle(ReceiveShipmentCommand request, CancellationToken cancellationToken)
    {
        if (await receipts.GetByIdAsync(request.Id, cancellationToken) is { } already)
            return await reading.DtoAsync(already, request.SeeCosts, cancellationToken);
        desk.EnsureCentralKitchen();
        var shipment = await shipments.GetByIdAsync(request.ShipmentId, cancellationToken)
            ?? throw new NotFoundException(nameof(InternalSalesInvoice), request.ShipmentId);
        var receiving = await desk.HereAsync(cancellationToken);
        var to = await desk.PlaceAsync(receiving, request.ToLocationId, cancellationToken);
        var byId = (await materials.GetByIdsAsync(shipment.Lines.Select(l => l.RawMaterialId).Distinct().ToList(), cancellationToken)).ToDictionary(m => m.Id);
        var said = (request.Lines ?? []).GroupBy(l => l.RawMaterialId).ToDictionary(g => g.Key, g => g.Sum(l => l.ReceivedQuantity));
        var today = books.Today;
        var number = InternalPurchaseInvoice.NumberFor(today.Year, await receipts.CountInYearAsync(today.Year, cancellationToken) + 1);
        var (receipt, ledger) = InternalPurchaseInvoice.Receive(
            request.Id, number, shipment, receiving, to, byId, said, today, request.Notes, request.StaffName, request.StaffId);
        receipts.Add(receipt);
        foreach (var movement in ledger)
            movements.Add(movement);
        await InterBranchLedger.RestateAsync(requisitions, shipments, shipment, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await reading.DtoAsync(receipt, request.SeeCosts, cancellationToken);
    }
}

internal sealed class VoidReceiptHandler(
    IInterBranchRequisitionRepository requisitions,
    IInternalSalesInvoiceRepository shipments,
    IInternalPurchaseInvoiceRepository receipts,
    IRawMaterialRepository materials,
    IStockMovementRepository movements,
    InterBranchReading reading,
    IUnitOfWork unitOfWork) : IRequestHandler<VoidReceiptCommand, ReceiptDto>
{
    public async Task<ReceiptDto> Handle(VoidReceiptCommand request, CancellationToken cancellationToken)
    {
        var receipt = await receipts.GetByIdAsync(request.Id, cancellationToken) ?? throw new NotFoundException(nameof(InternalPurchaseInvoice), request.Id);
        var shipment = await shipments.GetByIdAsync(receipt.InternalSalesInvoiceId, cancellationToken)
            ?? throw new NotFoundException(nameof(InternalSalesInvoice), receipt.InternalSalesInvoiceId);
        receipt.Void(shipment, request.StaffName);
        // The branch's side out (its price taken back out of its average), then the kitchen's back in.
        await InterBranchLedger.ReverseAsync(materials, movements, receipt.Id, StockMovementReason.InterBranchReceiptIn, request.StaffName, cancellationToken);
        await InterBranchLedger.ReverseAsync(materials, movements, shipment.Id, StockMovementReason.InterBranchDispatchOut, request.StaffName, cancellationToken);
        await InterBranchLedger.RestateAsync(requisitions, shipments, shipment, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await reading.DtoAsync(receipt, request.SeeCosts, cancellationToken);
    }
}

internal static class InterBranchLedger
{
    // Each of a record's entries undone where it was made: its branch and its location.
    public static async Task ReverseAsync(
        IRawMaterialRepository materials, IStockMovementRepository movements, Guid sourceId, StockMovementReason reason, string by,
        CancellationToken cancellationToken)
    {
        var originals = (await movements.GetBySourceAsync(sourceId, reason, cancellationToken)).Where(m => !m.IsReversal).ToList();
        if (originals.Count == 0)
            return;
        var byId = (await materials.GetByIdsAsync(originals.Select(m => m.RawMaterialId).Distinct().ToList(), cancellationToken)).ToDictionary(m => m.Id);
        foreach (var original in originals)
            movements.Add(byId[original.RawMaterialId].Reverse(original, by));
    }

    // The shipment's requisition, as its shipments now stand.
    public static async Task RestateAsync(
        IInterBranchRequisitionRepository requisitions, IInternalSalesInvoiceRepository shipments, InternalSalesInvoice shipment,
        CancellationToken cancellationToken)
    {
        if (shipment.RequisitionId is not { } id || await requisitions.GetByIdAsync(id, cancellationToken) is not { } requisition)
            return;
        var all = (await shipments.GetByRequisitionAsync(id, cancellationToken)).Where(s => s.Id != shipment.Id).Append(shipment);
        requisition.Restate(all);
    }
}
