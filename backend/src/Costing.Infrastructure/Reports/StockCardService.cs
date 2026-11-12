using Microsoft.EntityFrameworkCore;
using Costing.Application.Common;
using Costing.Domain.Common;
using Costing.Domain.Purchases;
using Costing.Domain.RawMaterials;
using Costing.Domain.Sales;
using Costing.Domain.StockCounts;
using Costing.Domain.StockMovements;
using Costing.Infrastructure.Persistence;

namespace Costing.Infrastructure.Reports;

// The item's stock card (كارتة الصنف / حركة الصنف): every movement of one material or prep item over
// a period, oldest first, as a store ledger is kept: what came in, what went out, the balance after
// each, the price it moved at, and the moving average it left. Each line names what made it (an
// invoice, a batch, a count, a day's sales, spoilage) so it opens from here.
// Quantities are in the material's purchase unit, prices per it, as the screens show them.

// The kinds of movement the card is filtered by.
public enum StockCardMovementType
{
    Opening = 1,
    Purchases = 2,
    Production = 3,
    Sales = 4,
    Waste = 5,
    CountAdjustment = 6,
}

// What a line opens: the record that made the movement.
public enum StockCardSourceKind
{
    PurchaseInvoice = 1,
    ProductionOrder = 2,
    StockCount = 3,
    SalesReceipt = 4,
    Spoilage = 5,
}

// One movement. SourceId opens it: the invoice, the production order, the count, the sales receipt
// (not the line, which is what the ledger keeps); for spoilage, the entry's own id. SourceDate is the
// day that record is under (an invoice's paper date, a sale's business day), for opening it there.
// HasSource: that record was found; stock received without an invoice has none to open.
public sealed record StockCardLine(
    Guid MovementId,
    DateOnly Date,
    DateTime OccurredAtUtc,
    StockMovementReason Reason,
    StockCardMovementType Type,
    bool IsReversal,
    StockCardSourceKind SourceKind,
    Guid SourceId,
    bool HasSource,
    DateOnly? SourceDate,
    string Reference,
    string? Details,
    decimal QuantityIn,
    decimal QuantityOut,
    decimal Balance,
    decimal? UnitCost,
    decimal? Value,
    decimal? AverageCostAfter,
    string? RecordedBy);

// The card: the balance it opened the period with and at what average, what came in and went out in
// it (every movement, whatever the filter), what it closed with and its worth at the average then;
// and the material as it stands now. Lines: the period's movements, of Type only when it is given.
public sealed record StockCard(
    Guid RawMaterialId,
    string? Code,
    string Material,
    bool IsPrepItem,
    UnitOfMeasure Unit,
    string PurchaseUnit,
    decimal PurchaseUnitSize,
    DateOnly From,
    DateOnly To,
    StockCardMovementType? Type,
    decimal OpeningBalance,
    decimal? OpeningAverageCost,
    decimal TotalIn,
    decimal TotalOut,
    decimal ClosingBalance,
    decimal? ClosingAverageCost,
    decimal? ClosingValue,
    decimal OnHand,
    decimal? AverageCost,
    IReadOnlyList<StockCardLine> Lines);

public sealed class StockCardService(CostingDbContext db, IBusinessCalendar clock)
{
    public static StockCardMovementType TypeOf(StockMovementReason reason) => reason switch
    {
        StockMovementReason.OpeningStock => StockCardMovementType.Opening,
        StockMovementReason.Purchase => StockCardMovementType.Purchases,
        StockMovementReason.ProductionInput or StockMovementReason.ProductionOutput => StockCardMovementType.Production,
        StockMovementReason.Sale or StockMovementReason.VoidReturn => StockCardMovementType.Sales,
        StockMovementReason.Waste or StockMovementReason.Spoilage => StockCardMovementType.Waste,
        _ => StockCardMovementType.CountAdjustment,
    };

    private static StockCardSourceKind SourceOf(StockMovementReason reason) => reason switch
    {
        StockMovementReason.Purchase => StockCardSourceKind.PurchaseInvoice,
        StockMovementReason.ProductionInput or StockMovementReason.ProductionOutput => StockCardSourceKind.ProductionOrder,
        StockMovementReason.OpeningStock or StockMovementReason.CountAdjustment => StockCardSourceKind.StockCount,
        StockMovementReason.Spoilage => StockCardSourceKind.Spoilage,
        _ => StockCardSourceKind.SalesReceipt,
    };

    public async Task<StockCard> GetAsync(Guid materialId, DateOnly? from, DateOnly? to, StockCardMovementType? type, CancellationToken cancellationToken)
    {
        if (type is { } t && !Enum.IsDefined(t))
            throw new DomainException("Choose a kind of movement. · اختر نوع الحركة.");
        var last = to ?? clock.BusinessDateOf(DateTime.UtcNow);
        var first = from ?? new DateOnly(last.Year, last.Month, 1);
        if (last < first)
            throw new DomainException("The first day must come before the last. · اليوم الأول قبل الأخير.");
        if (last > first.AddYears(5))
            throw new DomainException("Choose five years at most. · خمس سنوات على الأكثر.");
        var fromUtc = clock.Bounds(first).FromUtc;
        var toUtc = clock.Bounds(last).ToUtc;

        var material = await db.RawMaterials.AsNoTracking().SingleOrDefaultAsync(m => m.Id == materialId, cancellationToken)
            ?? throw new NotFoundException("Raw material", materialId);
        // The whole ledger, to know the balance and the average at each step; only the period is shown.
        var movements = await db.StockMovements.AsNoTracking()
            .Where(m => m.RawMaterialId == materialId && m.OccurredAtUtc < toUtc)
            .OrderBy(m => m.OccurredAtUtc).ThenBy(m => m.Id)
            .ToListAsync(cancellationToken);

        var byId = movements.ToDictionary(m => m.Id);
        var size = material.PurchaseUnitSize;
        decimal? average = null;
        decimal onHand = 0;
        decimal? openingAverage = null;
        decimal opening = 0;
        var openingTaken = false;
        var shown = new List<(StockMovement Movement, decimal Balance, decimal? Average)>();
        foreach (var m in movements)
        {
            if (!openingTaken && m.OccurredAtUtc >= fromUtc)
            {
                (opening, openingAverage, openingTaken) = (onHand, average, true);
            }
            average = AverageAfter(average, onHand, m, m.ReversalOf is { } of ? byId.GetValueOrDefault(of) : null);
            onHand += m.Quantity;
            if (m.OccurredAtUtc >= fromUtc)
                shown.Add((m, onHand, average));
        }
        if (!openingTaken)
            (opening, openingAverage) = (onHand, average);

        var sources = await SourcesAsync(shown.Select(s => s.Movement).ToList(), cancellationToken);
        var lines = shown
            .Where(s => type is null || TypeOf(s.Movement.Reason) == type)
            .Select(s =>
            {
                var m = s.Movement;
                var found = sources.GetValueOrDefault((m.SourceId, SourceOf(m.Reason)));
                var source = found ?? new Source(m.SourceId, null, Fallback(m.Reason), null);
                var details = m.Reason == StockMovementReason.Spoilage && !m.IsReversal ? m.Note : source.Details;
                if (m.IsReversal)
                    details = details is null ? "Voided · ملغاة" : $"Voided · ملغاة — {details}";
                return new StockCardLine(
                    m.Id, clock.BusinessDateOf(m.OccurredAtUtc), m.OccurredAtUtc, m.Reason, TypeOf(m.Reason), m.IsReversal,
                    SourceOf(m.Reason), source.Id, found is not null, source.Date, source.Reference, details,
                    Quantity(Math.Max(m.Quantity, 0) / size), Quantity(Math.Max(-m.Quantity, 0) / size), Quantity(s.Balance / size),
                    Cost(m.UnitCost * size), m.UnitCost is { } cost ? CostingService.Money(m.Quantity * cost) : null, Cost(s.Average * size),
                    m.RecordedBy ?? source.By);
            })
            .ToList();

        var inPeriod = shown.Select(s => s.Movement).ToList();
        var totalIn = inPeriod.Where(m => m.Quantity > 0).Sum(m => m.Quantity);
        var totalOut = -inPeriod.Where(m => m.Quantity < 0).Sum(m => m.Quantity);
        var closing = opening + totalIn - totalOut;
        return new StockCard(
            material.Id, material.Code, material.Name, material.IsPrepItem, material.Unit, material.PurchaseUnit, size, first, last, type,
            Quantity(opening / size), Cost(openingAverage * size), Quantity(totalIn / size), Quantity(totalOut / size), Quantity(closing / size),
            Cost(average * size), average is { } a ? CostingService.Money(Math.Max(closing, 0) * a) : null,
            Quantity(material.QuantityOnHand / size), Cost(material.AverageCost * size), lines);
    }

    // The average a movement leaves, as the material moves it: a priced delivery or batch averaged in
    // with the stock on the shelf (none below zero); one voided taken back out of it as far as the
    // stock left carries it; any other movement priced at the average then says what that was, which
    // also brings in a price typed in by hand. A reversal of anything else leaves it where it was.
    internal static decimal? AverageAfter(decimal? average, decimal onHand, StockMovement m, StockMovement? original)
    {
        var averaging = m.Reason is StockMovementReason.Purchase or StockMovementReason.ProductionOutput;
        if (m.ReversalOf is null)
        {
            if (m.UnitCost is not { } cost)
                return average;
            if (averaging && m.Quantity > 0)
            {
                var onShelf = Math.Max(onHand, 0);
                return average is { } before && onShelf > 0 ? (onShelf * before + m.Quantity * cost) / (onShelf + m.Quantity) : cost;
            }
            return cost;
        }

        var undone = original?.Quantity ?? -m.Quantity;
        if (!averaging || undone <= 0 || average is not { } now || (original?.UnitCost ?? m.UnitCost) is not { } paid)
            return average;
        var left = onHand - undone;
        if (left <= 0)
            return average;
        var value = Math.Max(onHand, 0) * now - undone * paid;
        return value >= 0 ? value / left : average;
    }

    // What each movement's record says of itself: its number, who or what it was, and its day.
    private sealed record Source(Guid Id, DateOnly? Date, string Reference, string? Details, string? By = null);

    private async Task<Dictionary<(Guid, StockCardSourceKind), Source>> SourcesAsync(IReadOnlyList<StockMovement> movements, CancellationToken cancellationToken)
    {
        var result = new Dictionary<(Guid, StockCardSourceKind), Source>();
        List<Guid> Ids(StockCardSourceKind kind) => movements.Where(m => SourceOf(m.Reason) == kind).Select(m => m.SourceId).Distinct().ToList();

        var invoiceIds = Ids(StockCardSourceKind.PurchaseInvoice);
        if (invoiceIds.Count > 0)
        {
            var invoices = await db.PurchaseInvoices.AsNoTracking()
                .Where(i => invoiceIds.Contains(i.Id))
                .Select(i => new { i.Id, i.SupplierInvoiceNumber, i.SupplierId, i.InvoiceDate, i.PostedAtUtc, i.CreatedAtUtc, i.Status, i.PostedBy })
                .ToListAsync(cancellationToken);
            var supplierIds = invoices.Where(i => i.SupplierId != null).Select(i => i.SupplierId!.Value).Distinct().ToList();
            var suppliers = await db.Suppliers.AsNoTracking().Where(s => supplierIds.Contains(s.Id)).ToDictionaryAsync(s => s.Id, s => s.Name, cancellationToken);
            foreach (var i in invoices)
                result[(i.Id, StockCardSourceKind.PurchaseInvoice)] = new Source(
                    i.Id, i.InvoiceDate ?? clock.BusinessDateOf(i.PostedAtUtc ?? i.CreatedAtUtc),
                    i.SupplierInvoiceNumber is { Length: > 0 } number ? $"Invoice {number} · فاتورة {number}" : "Invoice, no number · فاتورة بدون رقم",
                    (i.SupplierId is { } s ? suppliers.GetValueOrDefault(s) : null) ?? "No supplier · بدون مورد", i.PostedBy);
        }

        var orderIds = Ids(StockCardSourceKind.ProductionOrder);
        if (orderIds.Count > 0)
        {
            var orders = await db.ProductionOrders.AsNoTracking()
                .Where(o => orderIds.Contains(o.Id))
                .Select(o => new { o.Id, o.PrepItemId, o.ProducedQuantity, o.ProducedAtUtc, o.ProducedBy })
                .ToListAsync(cancellationToken);
            var prepIds = orders.Select(o => o.PrepItemId).Distinct().ToList();
            var preps = await db.RawMaterials.AsNoTracking().Where(m => prepIds.Contains(m.Id))
                .ToDictionaryAsync(m => m.Id, m => new { m.Name, m.PurchaseUnit, m.PurchaseUnitSize }, cancellationToken);
            foreach (var o in orders)
            {
                var prep = preps.GetValueOrDefault(o.PrepItemId);
                var made = prep is null ? null : $"{Quantity(o.ProducedQuantity / prep.PurchaseUnitSize):0.###} {prep.PurchaseUnit} of {prep.Name}";
                result[(o.Id, StockCardSourceKind.ProductionOrder)] = new Source(
                    o.Id, clock.BusinessDateOf(o.ProducedAtUtc), "Production batch · تشغيلة إنتاج", made is null ? null : $"Batch: {made}", o.ProducedBy);
            }
        }

        var countIds = Ids(StockCardSourceKind.StockCount);
        if (countIds.Count > 0)
        {
            var counts = await db.StockCounts.AsNoTracking()
                .Where(c => countIds.Contains(c.Id))
                .Select(c => new { c.Id, c.Kind, c.StartedAtUtc, c.PostedAtUtc, c.PostedBy })
                .ToListAsync(cancellationToken);
            foreach (var c in counts)
                result[(c.Id, StockCardSourceKind.StockCount)] = new Source(
                    c.Id, clock.BusinessDateOf(c.PostedAtUtc ?? c.StartedAtUtc),
                    c.Kind == StockCountKind.Opening ? "Opening count · جرد افتتاحي" : "Stock count · جرد", null, c.PostedBy);
        }

        // A sale's movement keeps its receipt line's id; the receipt is what opens.
        var lineIds = Ids(StockCardSourceKind.SalesReceipt);
        if (lineIds.Count > 0)
        {
            var lines = await db.SalesReceipts.AsNoTracking()
                .SelectMany(r => r.Lines.Where(l => lineIds.Contains(l.PublicId)),
                    (r, l) => new { r.Id, r.BusinessDate, r.Source, r.Reference, r.EnteredBy, l.PublicId, l.MenuItemName, l.VariantName, l.Quantity })
                .ToListAsync(cancellationToken);
            foreach (var l in lines)
            {
                var reference = l.Source == SalesSource.DailySummary ? "Daily sales summary · ملخص المبيعات اليومية"
                    : l.Reference is { Length: > 0 } number ? $"Sale {number} · فاتورة بيع {number}" : "Sale · فاتورة بيع";
                var item = l.VariantName is null ? l.MenuItemName : $"{l.MenuItemName} ({l.VariantName})";
                result[(l.PublicId, StockCardSourceKind.SalesReceipt)] = new Source(l.Id, l.BusinessDate, reference, $"{l.Quantity} × {item}", l.EnteredBy);
            }
        }

        foreach (var id in Ids(StockCardSourceKind.Spoilage))
        {
            var first = movements.First(m => m.SourceId == id && m.Reason == StockMovementReason.Spoilage);
            result[(id, StockCardSourceKind.Spoilage)] = new Source(id, clock.BusinessDateOf(first.OccurredAtUtc), "Spoilage · تالف", first.Note);
        }

        return result;
    }

    // A movement whose record is gone (it should not be): named by why it moved.
    private static string Fallback(StockMovementReason reason) => reason switch
    {
        StockMovementReason.Purchase => "Purchase · مشتريات",
        StockMovementReason.ProductionInput or StockMovementReason.ProductionOutput => "Production batch · تشغيلة إنتاج",
        StockMovementReason.OpeningStock => "Opening count · جرد افتتاحي",
        StockMovementReason.CountAdjustment => "Stock count · جرد",
        StockMovementReason.Spoilage => "Spoilage · تالف",
        _ => "Sale · فاتورة بيع",
    };

    private static decimal Quantity(decimal value) => Math.Round(value, 3, MidpointRounding.AwayFromZero);

    private static decimal? Cost(decimal? value) => value is { } v ? Math.Round(v, 4, MidpointRounding.AwayFromZero) : null;
}
