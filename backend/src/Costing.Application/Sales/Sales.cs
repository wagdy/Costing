using MediatR;
using Microsoft.Extensions.Logging;
using Costing.Application.Common;
using Costing.Application.RawMaterials;
using Costing.Domain.Common;
using Costing.Domain.Menu;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;
using Costing.Domain.Sales;
using Costing.Domain.StockMovements;

namespace Costing.Application.Sales;

// Sales (المبيعات): what the menu sold, as every cost report reads it. Entered as a day's sales
// summary, item by item, or imported from the day's sheet (DailySales.cs); a bill as it was
// printed is still taken, for scripts. Each line takes its stock when it is recorded, by the
// recipe it sells by; a sale voided puts that back, exactly as it was taken (Deletions,
// ApprovalModule.Sale), and leaves the reports.

public sealed record SalesLineDto(
    Guid PublicId, int MenuItemId, int? VariantId, string MenuItemName, string? VariantName, int Quantity, decimal LineTotal, IReadOnlyList<int> AddOnIds,
    bool OnBill, LineVoid Voided);

public sealed record SalesReceiptDto(
    Guid Id,
    string? Reference,
    DateTime SoldAtUtc,
    DateOnly BusinessDate,
    SalesChannel Channel,
    PaymentMethod PaymentMethod,
    IReadOnlyList<SalesLineDto> Lines,
    decimal Subtotal,
    decimal DiscountAmount,
    decimal DeliveryFee,
    decimal TaxAmount,
    decimal PointsAmount,
    decimal TotalAmount,
    decimal RefundedAmount,
    string? Notes,
    SalesSource Source,
    string EnteredBy,
    DateTime EnteredAtUtc,
    DateTime? VoidedAtUtc,
    string? VoidedBy)
{
    public static SalesReceiptDto From(SalesReceipt r) => new(
        r.Id, r.Reference, r.SoldAtUtc, r.BusinessDate, r.Channel, r.PaymentMethod,
        r.Lines.Select(l => new SalesLineDto(
                l.PublicId, l.MenuItemId, l.VariantId, l.MenuItemName, l.VariantName, l.Quantity, l.LineTotal, l.AddOnIds, l.OnBill, l.Voided))
            .ToList(),
        r.BilledSubtotal, r.DiscountAmount, r.DeliveryFee, r.TaxAmount, r.PointsAmount, r.TotalAmount, r.RefundedAmount, r.Notes, r.Source, r.EnteredBy,
        r.EnteredAtUtc, r.VoidedAtUtc, r.VoidedBy);
}

// A period's sales, voided ones listed but not counted. ByPayment: what was charged, less what was
// handed back, by how it was paid.
public sealed record SalesTotals(
    int Receipts, int Items, decimal Subtotal, decimal Discounts, decimal DeliveryFees, decimal Tax, decimal Points, decimal Total, decimal Refunded,
    IReadOnlyDictionary<PaymentMethod, decimal> ByPayment);

public sealed record SalesReport(DateOnly From, DateOnly To, IReadOnlyList<SalesReceiptDto> Receipts, SalesTotals Totals);

// One line as entered: an item (a size of it), how many, with which add-ons. LineTotal, what it
// came to: left out, the menu's price (the size's, or the item's) and its add-ons', times how many.
// Voided: taken off the bill, and when (LineVoid).
public sealed record SaleLineInput(
    int MenuItemId, int? VariantId, int Quantity, decimal? LineTotal = null, IReadOnlyList<int>? AddOnIds = null, LineVoid Voided = LineVoid.None);

// A sale as entered. Date is its business day; Time, when it was paid (a time before the business
// day starts is that night's, past midnight); none, the day's middle. Its id is made by the app.
public sealed record SaleInput(
    Guid Id,
    string? Reference,
    DateOnly Date,
    TimeOnly? Time,
    SalesChannel Channel,
    PaymentMethod PaymentMethod,
    IReadOnlyList<SaleLineInput> Lines,
    decimal DiscountAmount = 0,
    decimal DeliveryFee = 0,
    decimal TaxAmount = 0,
    decimal PointsAmount = 0,
    decimal RefundedAmount = 0,
    string? Notes = null);

// Turns sold lines into stock movements, each material's share as purchased, by the recipe each
// sells by: Sale for a line charged, then VoidReturn for one refunded after payment, and Waste for
// one voided after the kitchen made it. A line already posted for a reason is skipped, so a
// retried sale posts once. Adds the movements; the caller saves.
internal sealed class SaleStockPoster(
    IRecipeRepository recipes,
    IRawMaterialRepository materials,
    IStockMovementRepository movements,
    ILogger<SaleStockPoster> logger)
{
    public Task PostAsync(IReadOnlyCollection<SalesReceiptLine> lines, CancellationToken cancellationToken) =>
        PostAsync(lines
            .SelectMany(l => l.Voided switch
            {
                LineVoid.None => [(l, StockMovementReason.Sale)],
                LineVoid.AfterKitchen => [(l, StockMovementReason.Waste)],
                LineVoid.AfterPayment => new[] { (l, StockMovementReason.Sale), (l, StockMovementReason.VoidReturn) },
                _ => [],
            })
            .ToList(), cancellationToken);

    // Lines refunded on a sale already recorded: only their stock put back. What they sold was
    // taken when the sale was, under the line a refund split them from.
    public Task PostReturnsAsync(IReadOnlyCollection<SalesReceiptLine> lines, CancellationToken cancellationToken) =>
        PostAsync(lines.Select(l => (l, StockMovementReason.VoidReturn)).ToList(), cancellationToken);

    private async Task PostAsync(IReadOnlyList<(SalesReceiptLine Line, StockMovementReason Reason)> posts, CancellationToken cancellationToken)
    {
        var pending = new List<(Guid LineId, SoldItem Item, StockMovementReason Reason)>();
        foreach (var (line, reason) in posts)
        {
            if (!await movements.ExistsAsync(line.PublicId, reason, cancellationToken))
                pending.Add((line.PublicId, new SoldItem(line.MenuItemId, line.VariantId, line.AddOnIds, line.Quantity), reason));
        }
        if (pending.Count == 0)
            return;

        var relevant = await recipes.GetByTargetsAsync(StockRequirements.TargetsFor(pending.Select(p => p.Item)), cancellationToken);
        var needs = pending.Select(p => (p.LineId, p.Reason, Needs: StockRequirements.For(p.Item, relevant))).ToList();
        var materialsById = (await materials.GetByIdsAsync(needs.SelectMany(n => n.Needs.Keys).Distinct().ToList(), cancellationToken))
            .ToDictionary(m => m.Id);

        foreach (var (lineId, reason, need) in needs)
        {
            foreach (var (rawMaterialId, quantity) in need)
            {
                // Should not happen: raw materials are never deleted.
                if (!materialsById.TryGetValue(rawMaterialId, out var material))
                {
                    logger.LogWarning("Raw material {RawMaterialId} in a recipe does not exist; sale line {LineId} not posted against it", rawMaterialId, lineId);
                    continue;
                }

                movements.Add(reason switch
                {
                    StockMovementReason.Sale => material.RecordSale(quantity, lineId),
                    StockMovementReason.Waste => material.RecordWaste(quantity, lineId),
                    _ => material.RecordVoidReturn(quantity, lineId),
                });
            }
        }
    }
}

// A sale built from what was entered: each line checked against the menu, its names kept as they
// are today, and its total the menu's when none is given.
internal sealed class SaleWriter(IMenuRepository menu, ISalesReceiptRepository sales, IBusinessCalendar calendar, SaleStockPoster poster)
{
    public async Task<SalesReceipt> RecordAsync(SaleInput input, SalesSource source, string by, Menu? loaded, CancellationToken cancellationToken)
    {
        var known = loaded ?? await Menu.LoadAsync(menu, cancellationToken);
        if (input.Lines is not { Count: > 0 })
            throw new DomainException("Add at least one item.");
        var lines = input.Lines.Select(line => Line(line, known)).ToList();

        var local = input.Date.ToDateTime(input.Time ?? new TimeOnly(12, 0));
        var startsAt = calendar.Bounds(input.Date).FromUtc;
        var soldAt = calendar.ToUtc(local);
        // A time before the business day starts is that night's, past midnight.
        if (soldAt < startsAt)
            soldAt = calendar.ToUtc(local.AddDays(1));

        var receipt = new SalesReceipt(
            input.Id, input.Reference, soldAt, input.Date, input.Channel, input.PaymentMethod, lines, Money(input.DiscountAmount), Money(input.DeliveryFee),
            Money(input.TaxAmount), Money(input.PointsAmount), Money(input.RefundedAmount), input.Notes, source, by);
        sales.Add(receipt);
        await poster.PostAsync(receipt.Lines, cancellationToken);
        return receipt;
    }

    private static SalesReceiptLine Line(SaleLineInput line, Menu known)
    {
        var item = known.Items.GetValueOrDefault(line.MenuItemId) ?? throw new DomainException($"There is no item {line.MenuItemId} on the menu.");
        MenuItemVariant? size = null;
        if (line.VariantId is { } variantId)
        {
            size = item.Variants.SingleOrDefault(v => v.Id == variantId)
                ?? throw new DomainException($"{item.Name} has no such size: choose one of its sizes.");
        }
        else if (item.Variants.Count > 0)
        {
            throw new DomainException($"{item.Name} is sold by size: choose its size.");
        }

        var addOnIds = (line.AddOnIds ?? []).Distinct().ToList();
        var addOns = addOnIds.Select(id => known.AddOns.GetValueOrDefault(id) ?? throw new DomainException($"There is no add-on {id} on the menu.")).ToList();
        if (line.Quantity <= 0)
            throw new DomainException($"Sell at least one {item.Name}.");
        var total = line.LineTotal ?? ((size?.Price ?? item.Price) + addOns.Sum(a => a.Price)) * line.Quantity;
        return new SalesReceiptLine(item.Id, size?.Id, item.Name, size?.Name, line.Quantity, Money(total), addOnIds, line.Voided);
    }

    internal static decimal Money(decimal value) => Math.Round(value, 2, MidpointRounding.AwayFromZero);

    // The menu as a sale checks it: every item and add-on, deleted ones too (an old sale may name one).
    internal sealed record Menu(IReadOnlyDictionary<int, MenuItem> Items, IReadOnlyDictionary<int, AddOn> AddOns)
    {
        public static async Task<Menu> LoadAsync(IMenuRepository menu, CancellationToken cancellationToken) => new(
            (await menu.GetItemsAsync(cancellationToken)).ToDictionary(i => i.Id),
            (await menu.GetAddOnsAsync(cancellationToken)).ToDictionary(a => a.Id));
    }
}

public sealed record RecordSaleCommand(SaleInput Sale, string StaffName) : IRequest<SalesReceiptDto>, IRetryOnConflict;

internal sealed class RecordSaleHandler(ISalesReceiptRepository sales, SaleWriter writer, IUnitOfWork unitOfWork)
    : IRequestHandler<RecordSaleCommand, SalesReceiptDto>
{
    public async Task<SalesReceiptDto> Handle(RecordSaleCommand request, CancellationToken cancellationToken)
    {
        // Sent again after a lost answer: already recorded.
        if (await sales.GetByIdAsync(request.Sale.Id, cancellationToken) is { } already)
            return SalesReceiptDto.From(already);
        if (request.Sale.Reference is { } reference && !string.IsNullOrWhiteSpace(reference)
            && (await sales.GetReferencesAsync([reference.Trim()], cancellationToken)).Count > 0)
            throw new DomainException($"Receipt {reference.Trim()} is recorded already.");

        var receipt = await writer.RecordAsync(request.Sale, SalesSource.Entered, request.StaffName, null, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return SalesReceiptDto.From(receipt);
    }
}

// Handed back after it was paid: Quantity of a line, or the whole sale (no line). Its money is
// added to the refund, its ingredients put back into stock. Entered as it happened, as a sale is.
public sealed record RefundSaleCommand(Guid SaleId, Guid? LinePublicId, int? Quantity, string StaffName) : IRequest<SalesReceiptDto>, IRetryOnConflict;

internal sealed class RefundSaleHandler(ISalesReceiptRepository sales, SaleStockPoster poster, IUnitOfWork unitOfWork)
    : IRequestHandler<RefundSaleCommand, SalesReceiptDto>
{
    public async Task<SalesReceiptDto> Handle(RefundSaleCommand request, CancellationToken cancellationToken)
    {
        var sale = await sales.GetByIdAsync(request.SaleId, cancellationToken) ?? throw new NotFoundException("Sale", request.SaleId);
        var refunded = new List<SalesReceiptLine>();
        if (request.LinePublicId is { } lineId)
        {
            var line = sale.Lines.SingleOrDefault(l => l.PublicId == lineId) ?? throw new DomainException("That line is not on this sale.");
            refunded.Add(sale.Refund(lineId, request.Quantity ?? line.Quantity));
        }
        else
        {
            var onBill = sale.Lines.Where(l => l.OnBill).ToList();
            if (onBill.Count == 0)
                throw new DomainException("Everything on this sale is refunded or voided already.");
            foreach (var line in onBill)
                refunded.Add(sale.Refund(line.PublicId, line.Quantity));
        }

        await poster.PostReturnsAsync(refunded, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return SalesReceiptDto.From(sale);
    }
}

// The sales of From to To (business days), newest first.
public sealed record GetSalesQuery(DateOnly From, DateOnly To) : IRequest<SalesReport>;

internal sealed class GetSalesHandler(ISalesReceiptRepository sales) : IRequestHandler<GetSalesQuery, SalesReport>
{
    public async Task<SalesReport> Handle(GetSalesQuery request, CancellationToken cancellationToken)
    {
        if (request.To < request.From)
            throw new DomainException("The period ends before it starts.");
        if (request.To.DayNumber - request.From.DayNumber > 92)
            throw new DomainException("Show three months of sales at most.");
        var receipts = await sales.GetForDaysAsync(request.From, request.To, cancellationToken);
        var counted = receipts.Where(r => !r.IsVoided).ToList();
        var totals = new SalesTotals(
            counted.Count, counted.Sum(r => r.Lines.Where(l => l.OnBill).Sum(l => l.Quantity)), counted.Sum(r => r.BilledSubtotal),
            counted.Sum(r => r.DiscountAmount), counted.Sum(r => r.DeliveryFee), counted.Sum(r => r.TaxAmount), counted.Sum(r => r.PointsAmount),
            counted.Sum(r => r.TotalAmount), counted.Sum(r => r.RefundedAmount),
            Enum.GetValues<PaymentMethod>().ToDictionary(m => m, m => counted.Where(r => r.PaymentMethod == m).Sum(r => r.TotalAmount - r.RefundedAmount)));
        return new SalesReport(request.From, request.To, receipts.Select(SalesReceiptDto.From).ToList(), totals);
    }
}
