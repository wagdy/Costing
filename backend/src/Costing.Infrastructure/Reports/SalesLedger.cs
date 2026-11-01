using Microsoft.EntityFrameworkCore;
using Costing.Domain.Sales;
using Costing.Infrastructure.Persistence;

namespace Costing.Infrastructure.Reports;

// One sale, wherever it was rung up. DeliveryFee is after any delivery discount; BilledSubtotal
// is what the promo discount was taken from.
public sealed record SaleOrder(bool Online, decimal DiscountAmount, decimal BilledSubtotal, decimal DeliveryFee, IReadOnlyList<SaleLine> Lines)
{
    // For the reconciliation of each day's cash: when it was paid and how, what was charged, and
    // the parts of that which are not the food: tax, the points it was paid with, money handed
    // back. An online sale has no refunds: one refunded before the till saw it paid is no sale.
    public DateTime SoldAtUtc { get; init; }
    public PaymentMethod PaymentMethod { get; init; }
    public decimal Charged { get; init; }
    public decimal Tax { get; init; }
    public decimal Points { get; init; }
    public decimal Refunded { get; init; }
}

// OnBill: still charged. A line refunded after payment was sold, and took its stock; one voided
// before payment never was.
public sealed record SaleLine(
    Guid PublicId, int MenuItemId, int? VariantId, string MenuItemName, string? VariantName, int Quantity, decimal LineTotal,
    IReadOnlyList<int> AddOnIds, bool OnBill);

// Every sale in a period for the cost reports: the receipts entered or imported on the Sales tab,
// by when they were paid, voided ones left out. From inclusive, to exclusive.
public sealed class SalesLedger(CostingDbContext db)
{
    public async Task<IReadOnlyList<SaleOrder>> GetAsync(DateTime fromUtc, DateTime toUtc, CancellationToken cancellationToken)
    {
        var receipts = await db.SalesReceipts.AsNoTracking()
            .Where(r => r.VoidedAtUtc == null && r.SoldAtUtc >= fromUtc && r.SoldAtUtc < toUtc)
            .ToListAsync(cancellationToken);

        return receipts.Select(r => new SaleOrder(
                r.IsOnline, r.DiscountAmount, r.BilledSubtotal, r.DeliveryFee,
                r.Lines.Select(l => new SaleLine(
                    l.PublicId, l.MenuItemId, l.VariantId, l.MenuItemName, l.VariantName, l.Quantity, l.LineTotal, l.AddOnIds, l.OnBill)).ToList())
            {
                SoldAtUtc = r.SoldAtUtc,
                PaymentMethod = r.PaymentMethod,
                Charged = r.TotalAmount,
                Tax = r.TaxAmount,
                Points = r.PointsAmount,
                Refunded = r.RefundedAmount,
            })
            .ToList();
    }
}
