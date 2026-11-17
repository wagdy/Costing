using Costing.Domain.Common;

namespace Costing.Domain.Purchases;

// Where a purchase order stands.
public enum PurchaseOrderStatus
{
    // Being written: changed freely, nothing ordered yet.
    Draft = 1,

    // Approved by a manager (أمر شراء معتمد): sent to the supplier, open for deliveries.
    Approved = 2,

    // Part of it delivered (استلام جزئي): the rest still open, a backorder.
    PartiallyReceived = 3,

    // All of it delivered, or closed with what came (مكتمل).
    Completed = 4,

    // Called off before anything came (ملغى).
    Cancelled = 5,
}

// How the supplier is to be paid for it: a delivery's invoice is paid so unless it says otherwise.
public enum PurchaseOrderTerms
{
    Cash = 1,
    Credit = 2,
}

// One line as it is ordered: how many of the material's purchase unit, at what price each.
public sealed record PurchaseOrderLineEntry(Guid RawMaterialId, decimal OrderedPurchaseQty, decimal ExpectedUnitCost, string? LineNotes = null);

// A purchase order (أمر شراء): what is ordered from one supplier, at what price, and by when. Written
// as a draft, approved by a manager, then received against the supplier's invoices (ThreeWayMatch):
// each posted invoice that names it (PurchaseInvoice.PurchaseOrderId) adds what it brought to each
// line's received quantity, and a voided one takes it back (Recount). Fully received, it is complete;
// received in part, the rest stays open as a backorder, or is closed with what came (Close).
//
// Its number is PO-year-sequence, the year it is ordered in: PO-2026-0001.
public sealed class PurchaseOrder : AggregateRoot
{
    public const int MaxLines = 100;
    public const int MaxNotesLength = 500;
    public const int MaxLineNotesLength = 200;

    // Quantities are kept to the thousandth of a purchase unit, as stock is.
    private const decimal Unit = 0.0005m;

    private readonly List<PurchaseOrderLine> _lines = [];

    private PurchaseOrder() { }

    public PurchaseOrder(
        Guid id, int sequence, Guid supplierId, DateOnly orderDate, DateOnly? expectedDeliveryDate, PurchaseOrderTerms paymentTerms, string? notes,
        IReadOnlyList<PurchaseOrderLineEntry> lines, string createdByUserId, string createdBy)
    {
        if (sequence <= 0)
            throw new DomainException("A purchase order's number is 1 or more.");
        Id = id;
        Year = orderDate.Year;
        Sequence = sequence;
        PoNumber = NumberOf(Year, sequence);
        Status = PurchaseOrderStatus.Draft;
        CreatedByUserId = createdByUserId;
        CreatedBy = createdBy;
        CreatedAtUtc = DateTime.UtcNow;
        Write(supplierId, orderDate, expectedDeliveryDate, paymentTerms, notes, lines);
    }

    public int Year { get; private set; }
    public int Sequence { get; private set; }
    public string PoNumber { get; private set; } = string.Empty;

    public Guid SupplierId { get; private set; }
    public DateOnly OrderDate { get; private set; }
    public DateOnly? ExpectedDeliveryDate { get; private set; }
    public PurchaseOrderTerms PaymentTerms { get; private set; }
    public string? Notes { get; private set; }
    public PurchaseOrderStatus Status { get; private set; }

    public string CreatedByUserId { get; private set; } = string.Empty;
    public string CreatedBy { get; private set; } = string.Empty;
    public DateTime CreatedAtUtc { get; private set; }
    public string? ApprovedByUserId { get; private set; }
    public string? ApprovedBy { get; private set; }
    public DateTime? ApprovedAtUtc { get; private set; }
    public DateTime? CancelledAtUtc { get; private set; }
    public string? CancelledBy { get; private set; }

    // Closed with what was received (إغلاق بالكمية المستلمة): by the invoice that closed it, or by hand.
    public DateTime? ClosedAtUtc { get; private set; }
    public string? ClosedBy { get; private set; }
    public Guid? ClosedByInvoiceId { get; private set; }

    public IReadOnlyList<PurchaseOrderLine> Lines => _lines.OrderBy(l => l.Position).ToList();

    // Open for deliveries: approved, and not complete or cancelled.
    public bool IsOpen => Status is PurchaseOrderStatus.Approved or PurchaseOrderStatus.PartiallyReceived;

    public decimal ExpectedTotal => Round(_lines.Sum(l => l.LineTotal));
    public decimal RemainingValue => Round(_lines.Sum(l => l.RemainingQty * l.ExpectedUnitCost));

    public static string NumberOf(int year, int sequence) => $"PO-{year:0000}-{sequence:0000}";

    public PurchaseOrderLine? LineFor(Guid rawMaterialId) => _lines.SingleOrDefault(l => l.RawMaterialId == rawMaterialId);

    // A draft rewritten: its supplier, dates, terms, notes and lines.
    public void Change(
        Guid supplierId, DateOnly orderDate, DateOnly? expectedDeliveryDate, PurchaseOrderTerms paymentTerms, string? notes,
        IReadOnlyList<PurchaseOrderLineEntry> lines)
    {
        if (Status != PurchaseOrderStatus.Draft)
            throw new DomainException($"{PoNumber} is {StatusName(Status)}: only a draft is changed. · لا يُعدل إلا أمر الشراء المسودة.");
        if (orderDate.Year != Year)
            throw new DomainException($"{PoNumber} is numbered in {Year}: keep its order date in that year, or write a new one.");
        Write(supplierId, orderDate, expectedDeliveryDate, paymentTerms, notes, lines);
    }

    public void Approve(string userId, string by)
    {
        if (Status != PurchaseOrderStatus.Draft)
            throw new DomainException($"{PoNumber} is {StatusName(Status)} already. · أمر الشراء معتمد بالفعل.");
        Status = PurchaseOrderStatus.Approved;
        ApprovedByUserId = userId;
        ApprovedBy = by;
        ApprovedAtUtc = DateTime.UtcNow;
    }

    // Called off before anything came; once something has, the rest is closed instead.
    public void Cancel(string by)
    {
        if (Status is not (PurchaseOrderStatus.Draft or PurchaseOrderStatus.Approved))
            throw new DomainException(Status == PurchaseOrderStatus.PartiallyReceived
                ? $"Part of {PoNumber} has come: close it with what was received instead. · أغلق أمر الشراء بالكمية المستلمة."
                : $"{PoNumber} is {StatusName(Status)}: it cannot be cancelled.");
        if (_lines.Any(l => l.ReceivedPurchaseQty > 0))
            throw new DomainException($"Part of {PoNumber} has come: close it with what was received instead.");
        Status = PurchaseOrderStatus.Cancelled;
        CancelledAtUtc = DateTime.UtcNow;
        CancelledBy = by;
    }

    // Closed with what came: the rest is not expected any more. invoiceId: the invoice that closed it
    // as it was received; none, by hand.
    public void Close(string by, Guid? invoiceId = null)
    {
        if (!IsOpen)
            throw new DomainException($"{PoNumber} is {StatusName(Status)}: only an open purchase order is closed.");
        ClosedAtUtc = DateTime.UtcNow;
        ClosedBy = by;
        ClosedByInvoiceId = invoiceId;
        Status = PurchaseOrderStatus.Completed;
    }

    // What its posted invoices brought, by material in purchase units, counted again after one is
    // posted or voided. closingInvoiceStands: whether the invoice that closed it is still posted;
    // voided, the order is open again. Complete once every line has come in full, or closed.
    public void Recount(IReadOnlyDictionary<Guid, decimal> received, bool closingInvoiceStands = true)
    {
        foreach (var line in _lines)
            line.Received(received.GetValueOrDefault(line.RawMaterialId));
        if (Status is PurchaseOrderStatus.Draft or PurchaseOrderStatus.Cancelled)
            return;
        if (ClosedByInvoiceId is not null && !closingInvoiceStands)
        {
            ClosedAtUtc = null;
            ClosedBy = null;
            ClosedByInvoiceId = null;
        }
        Status = ClosedAtUtc is not null || _lines.All(l => l.RemainingQty <= Unit)
            ? PurchaseOrderStatus.Completed
            : _lines.Any(l => l.ReceivedPurchaseQty > 0) ? PurchaseOrderStatus.PartiallyReceived : PurchaseOrderStatus.Approved;
    }

    private void Write(
        Guid supplierId, DateOnly orderDate, DateOnly? expectedDeliveryDate, PurchaseOrderTerms paymentTerms, string? notes,
        IReadOnlyList<PurchaseOrderLineEntry> lines)
    {
        if (supplierId == Guid.Empty)
            throw new DomainException("Choose the supplier it is ordered from. · اختر المورد.");
        if (expectedDeliveryDate < orderDate)
            throw new DomainException("It is expected on the day it is ordered or after. · تاريخ التوريد بعد تاريخ الطلب.");
        if (!Enum.IsDefined(paymentTerms))
            throw new DomainException("Say how it is paid: cash or credit. · نقدي أو آجل.");
        if (notes?.Trim().Length > MaxNotesLength)
            throw new DomainException($"Keep the notes under {MaxNotesLength} characters.");
        if (lines.Count == 0)
            throw new DomainException("Order at least one item. · أضف صنفًا واحدًا على الأقل.");
        if (lines.Count > MaxLines)
            throw new DomainException($"A purchase order holds {MaxLines} lines at most.");
        if (lines.Select(l => l.RawMaterialId).Distinct().Count() != lines.Count)
            throw new DomainException("Each item goes on the order once: add its quantities together. · كل صنف مرة واحدة.");

        // A line kept keeps what has come of it (nothing, on a draft) and its id.
        var kept = _lines.ToDictionary(l => l.RawMaterialId);
        var written = lines.Select((entry, i) =>
        {
            var line = kept.GetValueOrDefault(entry.RawMaterialId) ?? new PurchaseOrderLine(Id, entry.RawMaterialId);
            line.Set(entry, i);
            return line;
        }).ToList();

        SupplierId = supplierId;
        OrderDate = orderDate;
        ExpectedDeliveryDate = expectedDeliveryDate;
        PaymentTerms = paymentTerms;
        Notes = string.IsNullOrWhiteSpace(notes) ? null : notes.Trim();
        _lines.Clear();
        _lines.AddRange(written);
    }

    public static string StatusName(PurchaseOrderStatus status) => status switch
    {
        PurchaseOrderStatus.Draft => "a draft",
        PurchaseOrderStatus.Approved => "approved",
        PurchaseOrderStatus.PartiallyReceived => "partly received",
        PurchaseOrderStatus.Completed => "complete",
        _ => "cancelled",
    };

    private static decimal Round(decimal amount) => Math.Round(amount, 2, MidpointRounding.AwayFromZero);
}

public sealed class PurchaseOrderLine : Entity
{
    private PurchaseOrderLine() { }

    internal PurchaseOrderLine(Guid purchaseOrderId, Guid rawMaterialId)
    {
        PurchaseOrderId = purchaseOrderId;
        RawMaterialId = rawMaterialId;
    }

    public Guid PurchaseOrderId { get; private set; }
    public Guid RawMaterialId { get; private set; }
    public int Position { get; private set; }

    // In the material's purchase unit (kg, a carton): ordered, and come so far on posted invoices.
    public decimal OrderedPurchaseQty { get; private set; }
    public decimal ReceivedPurchaseQty { get; private set; }

    // What one purchase unit is expected to cost, net (the latest price paid, or the vendor matrix's).
    public decimal ExpectedUnitCost { get; private set; }
    public string? LineNotes { get; private set; }

    public decimal RemainingQty => Math.Max(OrderedPurchaseQty - ReceivedPurchaseQty, 0);
    public decimal LineTotal => Math.Round(OrderedPurchaseQty * ExpectedUnitCost, 2, MidpointRounding.AwayFromZero);

    internal void Set(PurchaseOrderLineEntry entry, int position)
    {
        if (entry.RawMaterialId == Guid.Empty)
            throw new DomainException("Choose the item for each line. · اختر الصنف.");
        if (entry.OrderedPurchaseQty <= 0 || entry.OrderedPurchaseQty > 1_000_000)
            throw new DomainException("Order more than nothing of each item. · الكمية أكبر من صفر.");
        if (entry.ExpectedUnitCost < 0)
            throw new DomainException("An expected price is zero or more. · السعر صفر أو أكثر.");
        if (entry.LineNotes?.Trim().Length > PurchaseOrder.MaxLineNotesLength)
            throw new DomainException($"Keep each line's notes under {PurchaseOrder.MaxLineNotesLength} characters.");
        Position = position;
        OrderedPurchaseQty = Math.Round(entry.OrderedPurchaseQty, 3, MidpointRounding.AwayFromZero);
        ExpectedUnitCost = Math.Round(entry.ExpectedUnitCost, 4, MidpointRounding.AwayFromZero);
        LineNotes = string.IsNullOrWhiteSpace(entry.LineNotes) ? null : entry.LineNotes.Trim();
    }

    internal void Received(decimal quantity) => ReceivedPurchaseQty = Math.Round(Math.Max(quantity, 0), 3, MidpointRounding.AwayFromZero);
}

// How one item of a delivery stands against its purchase order.
public enum MatchStatus
{
    // As ordered, at the price ordered (مطابق).
    Matched = 1,

    // Billed above the price ordered, beyond the tolerance (زيادة سعر).
    PriceOvercharge = 2,

    // More came than was left to come (كمية زائدة).
    QtyOver = 3,

    // Less came than was left to come (استلام جزئي): the rest a backorder, or closed.
    Short = 4,

    // On the invoice, not on the order at all (غير مطلوب).
    NotOrdered = 5,
}

// One item of a delivery against its order: what was ordered and was left to come, what came, the
// price ordered against the net price billed, and how it stands. A line can be over on both price
// and quantity: Status is the first of QtyOver or NotOrdered, PriceOvercharge, Short, Matched.
public sealed record MatchLine(
    Guid RawMaterialId,
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

// A delivery against its order: each item, what was billed above the prices ordered, and whether a
// manager must sign it off (an overcharge or more than was ordered) before its stock goes in.
public sealed record MatchResult(IReadOnlyList<MatchLine> Lines, decimal Overcharge, decimal QtyOverLines, bool HasShort, bool NeedsApproval);

// What came in on a delivery of a material: in its purchase units, at what it cost net of every discount.
public sealed record DeliveredItem(Guid RawMaterialId, decimal PurchaseQty, decimal? NetCost);

// The 3-way match (المطابقة الثلاثية): the purchase order (what was ordered, at what price), the goods
// received (the quantity on the invoice, as counted at the door) and the supplier's invoice (what each
// line is billed, net of its discounts):
//
//   Net unit price = line cost after every discount ÷ quantity received in purchase units
//   Overcharge     = net unit price > expected unit cost × (1 + 0.5%), and at least a piastre more
//   Over-delivery  = quantity received > what was left to come
//   Short          = quantity received < what was left to come
//
// An item not on the order is an over-delivery of all of it. What was left to come is ordered less
// what earlier posted invoices brought.
public static class ThreeWayMatch
{
    public const decimal PriceTolerancePercent = 0.5m;
    private const decimal Unit = 0.0005m;

    public static MatchResult Compare(PurchaseOrder order, IReadOnlyList<DeliveredItem> delivered)
    {
        var byMaterial = delivered.GroupBy(d => d.RawMaterialId)
            .ToDictionary(g => g.Key, g => (Qty: g.Sum(d => d.PurchaseQty), Cost: g.Any(d => d.NetCost is not null) ? g.Sum(d => d.NetCost ?? 0) : (decimal?)null));
        var lines = new List<MatchLine>();
        foreach (var line in order.Lines)
        {
            var (qty, cost) = byMaterial.GetValueOrDefault(line.RawMaterialId);
            lines.Add(Line(line.RawMaterialId, line.OrderedPurchaseQty, line.RemainingQty, qty, line.ExpectedUnitCost, cost));
        }
        foreach (var (material, (qty, cost)) in byMaterial.Where(d => order.LineFor(d.Key) is null))
            lines.Add(Line(material, 0, 0, qty, 0, cost, notOrdered: true));

        return new MatchResult(
            lines, Math.Round(lines.Sum(l => l.Overcharge), 2, MidpointRounding.AwayFromZero), lines.Count(l => l.QtyOver > 0),
            lines.Any(l => l.ShortBy > 0), lines.Any(l => l.PriceOver || l.QtyOver > 0));
    }

    private static MatchLine Line(Guid material, decimal ordered, decimal remaining, decimal received, decimal expected, decimal? cost, bool notOrdered = false)
    {
        decimal? net = received > 0 && cost is { } c ? Math.Round(c / received, 4, MidpointRounding.AwayFromZero) : null;
        var priceOver = !notOrdered && expected > 0 && net is { } price
            && price > expected * (1 + PriceTolerancePercent / 100) && Math.Round(price - expected, 2, MidpointRounding.AwayFromZero) >= 0.01m;
        decimal? unitOver = priceOver ? net - expected : null;
        var over = Math.Max(received - remaining, 0);
        var shortBy = notOrdered ? 0 : Math.Max(remaining - received, 0);
        var status = notOrdered ? MatchStatus.NotOrdered
            : over > Unit ? MatchStatus.QtyOver
            : priceOver ? MatchStatus.PriceOvercharge
            : shortBy > Unit ? MatchStatus.Short
            : MatchStatus.Matched;
        return new MatchLine(
            material, ordered, remaining, Math.Round(received, 3), expected, net, unitOver,
            priceOver ? Math.Round(unitOver!.Value * received, 2, MidpointRounding.AwayFromZero) : 0,
            over > Unit ? Math.Round(over, 3) : 0, shortBy > Unit ? Math.Round(shortBy, 3) : 0, priceOver, status);
    }
}

public interface IPurchaseOrderRepository : IRepository<PurchaseOrder>
{
    // Every purchase order, newest first, with its lines.
    Task<IReadOnlyList<PurchaseOrder>> GetAllAsync(CancellationToken cancellationToken = default);

    // The next number in the year, purchase orders added in this unit of work counted.
    Task<int> NextSequenceAsync(int year, CancellationToken cancellationToken = default);
}
