using System.Globalization;
using Costing.Domain.Common;
using Costing.Domain.Company;
using Costing.Domain.RawMaterials;
using Costing.Domain.StockMovements;

namespace Costing.Domain.InterBranch;

public enum InternalPurchaseInvoiceStatus
{
    Posted = 1,
    Voided = 2,
}

// A branch's receipt of a shipment and its internal purchase invoice (استلام الفرع وفاتورة مشتريات
// داخلية), IPI-2026-0001: what came in from the central kitchen, into one of its locations at the
// price it was billed, which moves the branch's own average cost, so its recipes and food cost
// carry what it paid the kitchen. It is billed for everything sent, as the kitchen's invoice says,
// so the two invoices match; what did not arrive (short, or damaged on the way) never enters its
// stock and is kept as the receipt's transit loss, with what happened. Voided by a manager, with
// the kitchen's invoice: both sides' stock goes back.
public sealed class InternalPurchaseInvoice : AggregateRoot, IBranchOwned
{
    public const int MaxNotes = 500;

    private readonly List<InternalPurchaseInvoiceLine> _lines = [];

    private InternalPurchaseInvoice() { }

    // The branch that received it and is billed for it.
    public Guid BranchId { get; private set; }

    public void AssignBranch(Guid branchId) => BranchId = branchId;

    public Guid ReceivingBranchId => BranchId;
    public string Number { get; private set; } = string.Empty;
    public Guid InternalSalesInvoiceId { get; private set; }
    public Guid? RequisitionId { get; private set; }
    public Guid SupplyingBranchId { get; private set; }
    public Guid ToLocationId { get; private set; }
    public DateOnly ReceiptDate { get; private set; }
    public InternalPurchaseInvoiceStatus Status { get; private set; } = InternalPurchaseInvoiceStatus.Posted;
    public string? Notes { get; private set; }
    public string CreatedBy { get; private set; } = string.Empty;
    public string? CreatedByUserId { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime? VoidedAtUtc { get; private set; }
    public string? VoidedBy { get; private set; }
    public bool IsInterCompany { get; private set; } = true;

    // Billed (the kitchen's invoice), brought into stock, and lost on the way.
    public decimal TotalBilled { get; private set; }
    public decimal TotalReceivedValue { get; private set; }
    public decimal TotalTransitLoss { get; private set; }
    public IReadOnlyList<InternalPurchaseInvoiceLine> Lines => _lines;

    public static string NumberFor(int year, int sequence) => string.Create(CultureInfo.InvariantCulture, $"IPI-{year}-{sequence:0000}");

    // Received into `to`, one of the receiving branch's own locations: each line as received
    // (none said: all of what was sent), never more than was sent; anything short is explained in
    // the notes. Returns the stock entries to add; the shipment is marked received.
    public static (InternalPurchaseInvoice Invoice, IReadOnlyList<StockMovement> Movements) Receive(
        Guid id, string number, InternalSalesInvoice shipment, Branch receiving, InventoryLocation to, IReadOnlyDictionary<Guid, RawMaterial> materials,
        IReadOnlyDictionary<Guid, decimal> received, DateOnly date, string? notes, string by, string? byUserId)
    {
        if (shipment.Status == ShipmentStatus.Voided)
            throw new DomainException($"{shipment.Number} has been voided: there is nothing to receive. · الشحنة ملغاة.");
        if (shipment.Status == ShipmentStatus.Received)
            throw new DomainException($"{shipment.Number} has already been received. · تم استلام الشحنة بالفعل.");
        if (shipment.ReceivingBranchId != receiving.Id)
            throw new DomainException(
                $"{shipment.Number} goes to another branch: it is received there. Choose that branch at the top of the screen. · الشحنة لفرع آخر.");
        if (to.BranchId != receiving.Id)
            throw new DomainException($"{to.Name} is another branch's: receive it into one of {receiving.Name}'s locations. · الموقع تابع لفرع آخر.");
        if (!to.IsActive)
            throw new DomainException($"{to.Name} is not in use: choose a location in use. · الموقع غير مفعّل.");
        if (received.Keys.Where(k => shipment.Lines.All(l => l.RawMaterialId != k)).Select(k => (Guid?)k).FirstOrDefault() is { } stranger)
            throw new DomainException(
                $"{materials.GetValueOrDefault(stranger)?.Name ?? "That material"} was not sent on {shipment.Number}. · الصنف غير موجود بالشحنة.");

        var counted = shipment.Lines.Select(l =>
        {
            var name = materials.GetValueOrDefault(l.RawMaterialId)?.Name ?? "A material";
            var came = received.TryGetValue(l.RawMaterialId, out var said) ? said : l.Quantity;
            if (came < 0)
                throw new DomainException($"{name}: a quantity received cannot be negative.");
            if (came > l.Quantity)
                throw new DomainException(
                    $"{name}: {came.ToString("0.###", CultureInfo.InvariantCulture)} received is more than the "
                    + $"{l.Quantity.ToString("0.###", CultureInfo.InvariantCulture)} sent. · المستلم أكثر من المرسل.");
            return (Line: l, Received: came);
        }).ToList();
        var said = InterBranchRequisition.Said(notes, MaxNotes, "the notes");
        if (counted.Any(c => c.Received < c.Line.Quantity) && said is null)
            throw new DomainException(
                "Some of it did not arrive: say what happened (short, or damaged on the way) in the notes. · اذكر سبب العجز أو التلف.");

        var invoice = new InternalPurchaseInvoice
        {
            Id = id, Number = number, BranchId = receiving.Id, InternalSalesInvoiceId = shipment.Id, RequisitionId = shipment.RequisitionId,
            SupplyingBranchId = shipment.SupplyingBranchId, ToLocationId = to.Id, ReceiptDate = date, Notes = said, CreatedBy = by, CreatedByUserId = byUserId,
            CreatedAtUtc = DateTime.UtcNow,
        };
        var movements = new List<StockMovement>();
        foreach (var (line, came) in counted)
        {
            if (came > 0)
            {
                var material = materials.GetValueOrDefault(line.RawMaterialId) ?? throw new NotFoundException(nameof(RawMaterial), line.RawMaterialId);
                var put = material.ReceiveFromBranch(came, id, line.TransferUnitPrice, to.Id, by);
                put.AssignBranch(receiving.Id);
                movements.Add(put);
            }
            invoice._lines.Add(new InternalPurchaseInvoiceLine(id, line.RawMaterialId, line.Quantity, came, line.Unit, line.TransferUnitPrice));
        }
        invoice.TotalBilled = shipment.TotalTransferRevenue;
        invoice.TotalReceivedValue = invoice._lines.Sum(l => l.ReceivedValue);
        invoice.TotalTransitLoss = invoice._lines.Sum(l => l.TransitLoss);
        shipment.MarkReceived(id, counted.ToDictionary(c => c.Line.RawMaterialId, c => c.Received));
        return (invoice, movements);
    }

    // Voided by a manager, with the kitchen's invoice: the caller reverses both sides' entries.
    public void Void(InternalSalesInvoice shipment, string by)
    {
        if (Status == InternalPurchaseInvoiceStatus.Voided)
            throw new DomainException($"{Number} has already been voided. · تم إلغاء الاستلام بالفعل.");
        if (shipment.Id != InternalSalesInvoiceId)
            throw new DomainException("That is another shipment's invoice.");
        shipment.VoidWithReceipt(by);
        Status = InternalPurchaseInvoiceStatus.Voided;
        VoidedAtUtc = DateTime.UtcNow;
        VoidedBy = by;
    }
}

// A material received, in its own unit: what was sent and billed, what came in, what was short,
// at the price billed per unit; billed in all, brought into stock, and lost on the way.
public sealed class InternalPurchaseInvoiceLine
{
    private InternalPurchaseInvoiceLine() { }

    internal InternalPurchaseInvoiceLine(Guid invoiceId, Guid rawMaterialId, decimal dispatched, decimal received, string unit, decimal transferUnitPrice)
    {
        Id = Guid.NewGuid();
        InternalPurchaseInvoiceId = invoiceId;
        RawMaterialId = rawMaterialId;
        DispatchedQuantity = dispatched;
        ReceivedQuantity = received;
        ShortQuantity = dispatched - received;
        Unit = unit;
        TransferUnitPrice = transferUnitPrice;
        LineTotal = Math.Round(dispatched * transferUnitPrice, 2, MidpointRounding.AwayFromZero);
        ReceivedValue = Math.Round(received * transferUnitPrice, 2, MidpointRounding.AwayFromZero);
        TransitLoss = LineTotal - ReceivedValue;
    }

    public Guid Id { get; private set; }
    public Guid InternalPurchaseInvoiceId { get; private set; }
    public Guid RawMaterialId { get; private set; }
    public decimal DispatchedQuantity { get; private set; }
    public decimal ReceivedQuantity { get; private set; }
    public decimal ShortQuantity { get; private set; }
    public string Unit { get; private set; } = string.Empty;
    public decimal TransferUnitPrice { get; private set; }
    public decimal LineTotal { get; private set; }
    public decimal ReceivedValue { get; private set; }
    public decimal TransitLoss { get; private set; }
}

public interface IInternalPurchaseInvoiceRepository : IRepository<InternalPurchaseInvoice>
{
    // The branch's, received by it or sent by it: received in the period.
    Task<IReadOnlyList<InternalPurchaseInvoice>> GetForBranchAsync(Guid branchId, DateOnly from, DateOnly to, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<InternalPurchaseInvoice>> GetByIdsAsync(IReadOnlyCollection<Guid> ids, CancellationToken cancellationToken = default);

    Task<int> CountInYearAsync(int year, CancellationToken cancellationToken = default);
}
