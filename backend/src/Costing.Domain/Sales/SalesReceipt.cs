using Costing.Domain.Common;

namespace Costing.Domain.Sales;

// Where a sale was made: in the restaurant, taken away or delivered by it, or online (a delivery
// app or the website), whose orders pay their own delivery.
public enum SalesChannel
{
    DineIn = 1,
    Takeaway = 2,
    Delivery = 3,
    Online = 4,
}

// How a sale was paid. Only cash reaches the safe; the rest is reconciled apart.
public enum PaymentMethod
{
    Cash = 1,
    Visa = 2,
    Instapay = 3,
}

// How a receipt reached the system.
public enum SalesSource
{
    // Entered on the Sales tab, a bill or a day's totals.
    Entered = 1,

    // Imported from a sheet: a point of sale's export.
    Imported = 2,
}

// One sale (فاتورة بيع): a bill paid, what was on it and how it added up, as a point of sale
// would print it. What every cost report reads as sales (the theoretical cost, the variance, the
// KPIs, the reconciliation of the safe), so the costs need no point of sale: receipts are
// entered here, a bill at a time or a day's totals as one, or imported from a sheet.
//
// Its lines take stock when it is recorded, each by the recipe its item sells by (a size's, or the
// dish's; and each add-on's), a portion's share of each ingredient as purchased. Voided, its
// stock is put back, and it leaves the reports; it is kept, for the record.
//
//   subtotal = the lines still on the bill
//   total    = subtotal - discount + tax + delivery fee - points
//
// Its id is made by the app, so a retried entry is recorded once; an imported one also keeps the
// point of sale's own number (Reference), so a sheet imported twice is recorded once.
public sealed class SalesReceipt : AggregateRoot
{
    public const int MaxReferenceLength = 64;

    private readonly List<SalesReceiptLine> _lines = [];

    private SalesReceipt() { }

    public SalesReceipt(
        Guid id,
        string? reference,
        DateTime soldAtUtc,
        DateOnly businessDate,
        SalesChannel channel,
        PaymentMethod paymentMethod,
        IReadOnlyList<SalesReceiptLine> lines,
        decimal discountAmount,
        decimal deliveryFee,
        decimal taxAmount,
        decimal pointsAmount,
        decimal refundedAmount,
        string? notes,
        SalesSource source,
        string enteredBy)
    {
        if (!Enum.IsDefined(channel) || !Enum.IsDefined(paymentMethod))
            throw new DomainException("Say where the sale was made and how it was paid.");
        if (lines.Count == 0)
            throw new DomainException("A sale has at least one line.");
        if (discountAmount < 0 || deliveryFee < 0 || taxAmount < 0 || pointsAmount < 0 || refundedAmount < 0)
            throw new DomainException("The discount, delivery fee, tax, points and refunds cannot be negative.");
        var cleanReference = string.IsNullOrWhiteSpace(reference) ? null : reference.Trim();
        if (cleanReference?.Length > MaxReferenceLength)
            throw new DomainException($"Keep the receipt number under {MaxReferenceLength} characters.");
        if (notes?.Trim().Length > 300)
            throw new DomainException("Keep the notes under 300 characters.");

        Id = id;
        Reference = cleanReference;
        SoldAtUtc = DateTime.SpecifyKind(soldAtUtc, DateTimeKind.Utc);
        BusinessDate = businessDate;
        Channel = channel;
        PaymentMethod = paymentMethod;
        _lines.AddRange(lines);
        DiscountAmount = discountAmount;
        DeliveryFee = deliveryFee;
        TaxAmount = taxAmount;
        PointsAmount = pointsAmount;
        Notes = string.IsNullOrWhiteSpace(notes) ? null : notes.Trim();
        Source = source;
        EnteredBy = enteredBy;
        EnteredAtUtc = DateTime.UtcNow;

        if (DiscountAmount > BilledSubtotal)
            throw new DomainException("The discount cannot be more than the items.");
        TotalAmount = BilledSubtotal - DiscountAmount + TaxAmount + DeliveryFee - PointsAmount;
        if (TotalAmount < 0)
            throw new DomainException("The points cannot be more than the bill.");
        if (refundedAmount > TotalAmount)
            throw new DomainException("What was handed back cannot be more than what was paid.");
        RefundedAmount = refundedAmount;
    }

    // The point of sale's own number for it, if it came from one.
    public string? Reference { get; private set; }

    // When it was paid, and the business day that makes it (a night past midnight belongs to the
    // evening's).
    public DateTime SoldAtUtc { get; private set; }
    public DateOnly BusinessDate { get; private set; }

    public SalesChannel Channel { get; private set; }
    public bool IsOnline => Channel == SalesChannel.Online;
    public PaymentMethod PaymentMethod { get; private set; }

    public IReadOnlyCollection<SalesReceiptLine> Lines => _lines.AsReadOnly();

    // The lines still on the bill.
    public decimal BilledSubtotal => _lines.Where(l => l.OnBill).Sum(l => l.LineTotal);

    // Off the items, before tax (a promotion).
    public decimal DiscountAmount { get; private set; }

    // Charged for delivery, after any delivery discount.
    public decimal DeliveryFee { get; private set; }

    public decimal TaxAmount { get; private set; }

    // Paid with loyalty points: a payment against the bill, after tax.
    public decimal PointsAmount { get; private set; }

    // What was charged.
    public decimal TotalAmount { get; private set; }

    // Handed back after it was paid. The lines it was for stay sold: they took their stock.
    public decimal RefundedAmount { get; private set; }

    public string? Notes { get; private set; }
    public SalesSource Source { get; private set; }
    public string EnteredBy { get; private set; } = string.Empty;
    public DateTime EnteredAtUtc { get; private set; }

    public DateTime? VoidedAtUtc { get; private set; }
    public string? VoidedBy { get; private set; }
    public bool IsVoided => VoidedAtUtc is not null;

    // Taken back: it leaves the reports, and its stock is put back (the caller posts that).
    public void Void(string voidedBy)
    {
        if (IsVoided)
            throw new DomainException("This sale is voided already.");
        VoidedAtUtc = DateTime.UtcNow;
        VoidedBy = voidedBy;
    }
}

// One line of a sale: an item (a size of it), how many, with which add-ons, and what the line
// came to. PublicId names it to the stock it took. OnBill: still charged; a line voided before
// it was paid never was, and took no stock.
public sealed class SalesReceiptLine
{
    private SalesReceiptLine() { }

    public SalesReceiptLine(
        int menuItemId, int? variantId, string menuItemName, string? variantName, int quantity, decimal lineTotal, IReadOnlyList<int> addOnIds,
        bool onBill = true)
    {
        if (quantity <= 0)
            throw new DomainException("A line sells at least one.");
        if (lineTotal < 0)
            throw new DomainException("A line's total cannot be negative.");
        PublicId = Guid.NewGuid();
        MenuItemId = menuItemId;
        VariantId = variantId;
        MenuItemName = menuItemName;
        VariantName = variantName;
        Quantity = quantity;
        LineTotal = lineTotal;
        AddOnIds = addOnIds.ToArray();
        OnBill = onBill;
    }

    public Guid PublicId { get; private set; }
    public int MenuItemId { get; private set; }
    public int? VariantId { get; private set; }

    // As it was sold: the menu may be renamed since.
    public string MenuItemName { get; private set; } = string.Empty;
    public string? VariantName { get; private set; }

    public int Quantity { get; private set; }
    public decimal LineTotal { get; private set; }
    public int[] AddOnIds { get; private set; } = [];
    public bool OnBill { get; private set; } = true;
}

public interface ISalesReceiptRepository : IRepository<SalesReceipt>
{
    // Those paid from (inclusive) to (exclusive), voided ones left out, with their lines.
    Task<IReadOnlyList<SalesReceipt>> GetPaidAsync(DateTime fromUtc, DateTime toUtc, CancellationToken cancellationToken = default);

    // A business day's or a range's, voided ones too, newest first.
    Task<IReadOnlyList<SalesReceipt>> GetForDaysAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken = default);

    // The point of sale's numbers already recorded, of those asked.
    Task<IReadOnlySet<string>> GetReferencesAsync(IReadOnlyCollection<string> references, CancellationToken cancellationToken = default);
}
