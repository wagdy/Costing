using System.Globalization;
using Costing.Domain.Common;
using Costing.Domain.Company;
using Costing.Domain.RawMaterials;
using Costing.Domain.StockMovements;

namespace Costing.Domain.InterBranch;

// How a central kitchen prices what it sends (سياسة تسعير التحويل الداخلي).
public enum TransferPricing
{
    // At its own weighted average cost (بتكلفة المتوسط المرجح للمركزي): no margin.
    AtCost = 1,

    // At a transfer price (بسعر تحويل داخلي / هامش تشغيلي): its cost plus a markup, or a price per line.
    WithMarkupOrCustomPrice = 2,
}

public enum ShipmentStatus
{
    // Dispatched and on its way (في الطريق): out of the kitchen, not yet in the branch.
    InTransit = 1,

    // Received by the branch, on its internal purchase invoice.
    Received = 2,

    // Voided: its stock back in the kitchen.
    Voided = 3,
}

// A central kitchen's dispatch and its internal sales invoice (إذن صرف وفاتورة بيع داخلية),
// ISI-2026-0001: what it sent a branch, out of one of its locations at its own average cost, and
// what it billed for it at the transfer price. Revenue and cost of goods are inter-company: the
// company's P&L takes them out again. On its way until the branch receives it; voided while on its
// way, its stock goes back. A received one is voided only with its receipt.
public sealed class InternalSalesInvoice : AggregateRoot, IBranchOwned
{
    public const int MaxNotes = 500;
    public const int MaxLines = 200;
    public const decimal MaxMarkupPercent = 1000;

    private readonly List<InternalSalesInvoiceLine> _lines = [];

    private InternalSalesInvoice() { }

    // The branch that sent it and billed it.
    public Guid BranchId { get; private set; }

    public void AssignBranch(Guid branchId) => BranchId = branchId;

    public Guid SupplyingBranchId => BranchId;
    public string Number { get; private set; } = string.Empty;
    public Guid? RequisitionId { get; private set; }
    public Guid ReceivingBranchId { get; private set; }
    public Guid FromLocationId { get; private set; }
    public DateOnly DispatchDate { get; private set; }
    public TransferPricing Pricing { get; private set; } = TransferPricing.AtCost;
    public decimal? MarkupPercent { get; private set; }
    public ShipmentStatus Status { get; private set; } = ShipmentStatus.InTransit;
    public string? Notes { get; private set; }
    public string CreatedBy { get; private set; } = string.Empty;
    public string? CreatedByUserId { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime? ReceivedAtUtc { get; private set; }
    public Guid? InternalPurchaseInvoiceId { get; private set; }
    public DateTime? VoidedAtUtc { get; private set; }
    public string? VoidedBy { get; private set; }

    // Between two of the company's branches: taken out of the company's P&L as a whole.
    public bool IsInterCompany { get; private set; } = true;

    // What it billed (inter-company revenue), what the goods cost the kitchen (inter-company cost of
    // goods) and the difference, its margin.
    public decimal TotalTransferRevenue { get; private set; }
    public decimal TotalInternalCogs { get; private set; }
    public decimal InternalMargin { get; private set; }
    public IReadOnlyList<InternalSalesInvoiceLine> Lines => _lines;

    public static string NumberFor(int year, int sequence) => string.Create(CultureInfo.InvariantCulture, $"ISI-{year}-{sequence:0000}");

    public sealed record DispatchLine(RawMaterial Material, decimal Quantity, decimal? TransferUnitPrice = null);

    // Dispatched and billed at once: each line out of `from` (one of the kitchen's own locations,
    // holding enough of it: onHand), at the kitchen's average cost, billed at that (at cost) or at
    // the cost plus the markup, or the price given for the line. For a requisition, only what it
    // asked for, to the branch that asked. Returns the stock entries to add.
    public static (InternalSalesInvoice Invoice, IReadOnlyList<StockMovement> Movements) Dispatch(
        Guid id, string number, Branch supplying, Branch receiving, InterBranchRequisition? requisition, DateOnly date, InventoryLocation from,
        IReadOnlyList<DispatchLine> lines, TransferPricing pricing, decimal? markupPercent, IReadOnlyDictionary<Guid, decimal> onHand,
        string? notes, string by, string? byUserId)
    {
        if (!supplying.Supplies())
            throw new DomainException(
                $"{supplying.Name} is a restaurant: shipments go out from a central kitchen or warehouse. Choose it at the top of the screen. · الصرف من المطبخ المركزي.");
        if (receiving.Id == supplying.Id)
            throw new DomainException("Send it to another branch: the kitchen cannot bill itself. · اختر فرعاً آخر.");
        if (!supplying.IsActive || !receiving.IsActive)
            throw new DomainException($"{(!supplying.IsActive ? supplying.Name : receiving.Name)} is not in use. · الفرع غير مفعّل.");
        if (from.BranchId != supplying.Id)
            throw new DomainException($"{from.Name} is another branch's: send it from one of {supplying.Name}'s locations. · الموقع تابع لفرع آخر.");
        if (!from.IsActive)
            throw new DomainException($"{from.Name} is not in use: choose a location in use. · الموقع غير مفعّل.");
        if (requisition is not null)
        {
            if (requisition.SupplyingBranchId != supplying.Id)
                throw new DomainException($"{requisition.Number} is asked of another branch: dispatch it from there. · الطلب موجه لفرع آخر.");
            if (requisition.RequestingBranchId != receiving.Id)
                throw new DomainException($"{requisition.Number} goes to the branch that asked for it.");
            if (requisition.Status is RequisitionStatus.Cancelled)
                throw new DomainException($"{requisition.Number} has been cancelled: nothing more is sent for it. · الطلب ملغي.");
            if (lines.FirstOrDefault(l => requisition.Lines.All(r => r.RawMaterialId != l.Material.Id)) is { } extra)
                throw new DomainException($"{extra.Material.Name} is not on {requisition.Number}: send it as a direct dispatch. · الصنف غير مطلوب.");
        }
        if (lines.Count == 0)
            throw new DomainException("Send at least one material. · أضف خامة واحدة على الأقل.");
        if (lines.Count > MaxLines)
            throw new DomainException($"A dispatch sends {MaxLines} materials at most.");
        if (lines.GroupBy(l => l.Material.Id).FirstOrDefault(g => g.Count() > 1) is { } twice)
            throw new DomainException($"{twice.First().Material.Name} is on the dispatch twice: put it on one line.");
        if (!Enum.IsDefined(pricing))
            throw new DomainException("Choose how it is priced: at cost, or at a transfer price. · اختر سياسة التسعير.");
        var markup = pricing == TransferPricing.WithMarkupOrCustomPrice ? markupPercent ?? 0 : (decimal?)null;
        if (markup is < 0 or > MaxMarkupPercent)
            throw new DomainException($"A markup is between 0% and {MaxMarkupPercent:0}%. · الهامش بين ٠ و ١٠٠٠٪.");
        var said = InterBranchRequisition.Said(notes, MaxNotes, "the notes");

        var invoice = new InternalSalesInvoice
        {
            Id = id, Number = number, BranchId = supplying.Id, RequisitionId = requisition?.Id, ReceivingBranchId = receiving.Id, FromLocationId = from.Id,
            DispatchDate = date, Pricing = pricing, MarkupPercent = markup, Notes = said, CreatedBy = by, CreatedByUserId = byUserId,
            CreatedAtUtc = DateTime.UtcNow,
        };
        var priced = new List<(RawMaterial Material, decimal Quantity, decimal Cost, decimal Price)>();
        foreach (var line in lines)
        {
            var material = line.Material;
            if (line.Quantity <= 0)
                throw new DomainException($"{material.Name}: send more than nothing. · الكمية أكبر من صفر.");
            var there = onHand.GetValueOrDefault(material.Id);
            if (line.Quantity > there)
                throw new DomainException(
                    $"{from.Name} has {there.ToString("0.###", CultureInfo.InvariantCulture)} {material.Unit} of {material.Name}: not enough to send "
                    + $"{line.Quantity.ToString("0.###", CultureInfo.InvariantCulture)}. · الرصيد في الموقع لا يكفي.");
            var cost = material.UnitCostHere
                ?? throw new DomainException($"{material.Name} has no cost yet at {supplying.Name}: buy or make it first, so it can be billed. · لا توجد تكلفة للصنف.");
            if (line.TransferUnitPrice is < 0)
                throw new DomainException($"{material.Name}: a transfer price cannot be less than nothing.");
            var price = pricing == TransferPricing.AtCost
                ? cost
                : line.TransferUnitPrice ?? Math.Round(cost * (1 + markup!.Value / 100m), 6, MidpointRounding.AwayFromZero);
            priced.Add((material, line.Quantity, cost, price));
        }

        // Every line checked: now each goes out.
        var movements = new List<StockMovement>();
        foreach (var (material, quantity, cost, price) in priced)
        {
            var taken = material.DispatchToBranch(quantity, id, from.Id, by);
            taken.AssignBranch(supplying.Id);
            movements.Add(taken);
            invoice._lines.Add(new InternalSalesInvoiceLine(id, material.Id, quantity, material.Unit.ToString(), cost, price));
        }
        invoice.TotalTransferRevenue = invoice._lines.Sum(l => l.LineRevenue);
        invoice.TotalInternalCogs = invoice._lines.Sum(l => l.LineCogs);
        invoice.InternalMargin = invoice.TotalTransferRevenue - invoice.TotalInternalCogs;
        return (invoice, movements);
    }

    // Received by the branch: what of each line came in, on its internal purchase invoice.
    internal void MarkReceived(Guid purchaseInvoiceId, IReadOnlyDictionary<Guid, decimal> received)
    {
        EnsureInTransit();
        foreach (var line in _lines)
            line.Receive(received.GetValueOrDefault(line.RawMaterialId));
        Status = ShipmentStatus.Received;
        ReceivedAtUtc = DateTime.UtcNow;
        InternalPurchaseInvoiceId = purchaseInvoiceId;
    }

    // Voided while on its way: its stock goes back to the kitchen (the caller reverses its entries).
    public void Void(string by)
    {
        if (Status == ShipmentStatus.Received)
            throw new DomainException(
                $"{Number} has been received: a manager voids its receipt, which voids both invoices. · تم الاستلام؛ يُلغى من الاستلام.");
        EnsureInTransit();
        Voided(by);
    }

    // Voided with its receipt, by a manager: both invoices, and both sides' stock.
    internal void VoidWithReceipt(string by)
    {
        if (Status != ShipmentStatus.Received)
            throw new DomainException($"{Number} has not been received.");
        Voided(by);
    }

    private void Voided(string by)
    {
        Status = ShipmentStatus.Voided;
        VoidedAtUtc = DateTime.UtcNow;
        VoidedBy = by;
    }

    private void EnsureInTransit()
    {
        if (Status == ShipmentStatus.Voided)
            throw new DomainException($"{Number} has already been voided. · تم إلغاء الشحنة بالفعل.");
        if (Status == ShipmentStatus.Received)
            throw new DomainException($"{Number} has already been received. · تم استلام الشحنة بالفعل.");
    }
}

// A material sent, in its own unit: its cost to the kitchen then (its branch's average) and the
// price billed for it, each per unit; the line's revenue and cost of goods; and what of it the
// branch received, once it has.
public sealed class InternalSalesInvoiceLine
{
    private InternalSalesInvoiceLine() { }

    internal InternalSalesInvoiceLine(Guid invoiceId, Guid rawMaterialId, decimal quantity, string unit, decimal unitCost, decimal transferUnitPrice)
    {
        Id = Guid.NewGuid();
        InternalSalesInvoiceId = invoiceId;
        RawMaterialId = rawMaterialId;
        Quantity = quantity;
        Unit = unit;
        UnitCost = unitCost;
        TransferUnitPrice = transferUnitPrice;
        LineRevenue = Math.Round(quantity * transferUnitPrice, 2, MidpointRounding.AwayFromZero);
        LineCogs = Math.Round(quantity * unitCost, 2, MidpointRounding.AwayFromZero);
    }

    public Guid Id { get; private set; }
    public Guid InternalSalesInvoiceId { get; private set; }
    public Guid RawMaterialId { get; private set; }
    public decimal Quantity { get; private set; }
    public string Unit { get; private set; } = string.Empty;
    public decimal UnitCost { get; private set; }
    public decimal TransferUnitPrice { get; private set; }
    public decimal LineRevenue { get; private set; }
    public decimal LineCogs { get; private set; }
    public decimal? ReceivedQuantity { get; private set; }

    internal void Receive(decimal quantity) => ReceivedQuantity = quantity;
}

public interface IInternalSalesInvoiceRepository : IRepository<InternalSalesInvoice>
{
    // The branch's, sent by it or to it: dispatched in the period, or still on the way whenever sent.
    Task<IReadOnlyList<InternalSalesInvoice>> GetForBranchAsync(Guid branchId, DateOnly from, DateOnly to, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<InternalSalesInvoice>> GetByRequisitionAsync(Guid requisitionId, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<InternalSalesInvoice>> GetByIdsAsync(IReadOnlyCollection<Guid> ids, CancellationToken cancellationToken = default);

    Task<int> CountInYearAsync(int year, CancellationToken cancellationToken = default);
}
