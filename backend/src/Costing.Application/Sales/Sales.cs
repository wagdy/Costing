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

// Sales (المبيعات): what the menu sold, as every cost report reads it. A bill entered as it was
// printed, a day's totals entered as one, or a point of sale's export imported. Each line takes
// its stock when it is recorded, by the recipe it sells by; a sale voided puts that back, exactly
// as it was taken (Deletions, ApprovalModule.Sale), and leaves the reports.

public sealed record SalesLineDto(
    Guid PublicId, int MenuItemId, int? VariantId, string MenuItemName, string? VariantName, int Quantity, decimal LineTotal, IReadOnlyList<int> AddOnIds,
    bool OnBill);

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
        r.Lines.Select(l => new SalesLineDto(l.PublicId, l.MenuItemId, l.VariantId, l.MenuItemName, l.VariantName, l.Quantity, l.LineTotal, l.AddOnIds, l.OnBill))
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
// OnBill false: voided before it was paid; it took no stock.
public sealed record SaleLineInput(int MenuItemId, int? VariantId, int Quantity, decimal? LineTotal = null, IReadOnlyList<int>? AddOnIds = null, bool OnBill = true);

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
// sells by. A line already posted is skipped, so a retried sale posts once. Adds the movements;
// the caller saves.
internal sealed class SaleStockPoster(
    IRecipeRepository recipes,
    IRawMaterialRepository materials,
    IStockMovementRepository movements,
    ILogger<SaleStockPoster> logger)
{
    public async Task PostAsync(IReadOnlyList<(Guid LineId, SoldItem Item)> lines, CancellationToken cancellationToken)
    {
        var pending = new List<(Guid LineId, SoldItem Item)>();
        foreach (var line in lines)
        {
            if (!await movements.ExistsAsync(line.LineId, StockMovementReason.Sale, cancellationToken))
                pending.Add(line);
        }
        if (pending.Count == 0)
            return;

        var relevant = await recipes.GetByTargetsAsync(StockRequirements.TargetsFor(pending.Select(p => p.Item)), cancellationToken);
        var needs = pending.Select(p => (p.LineId, Needs: StockRequirements.For(p.Item, relevant))).ToList();
        var materialsById = (await materials.GetByIdsAsync(needs.SelectMany(n => n.Needs.Keys).Distinct().ToList(), cancellationToken))
            .ToDictionary(m => m.Id);

        foreach (var (lineId, need) in needs)
        {
            foreach (var (rawMaterialId, quantity) in need)
            {
                // Should not happen: raw materials are never deleted.
                if (!materialsById.TryGetValue(rawMaterialId, out var material))
                {
                    logger.LogWarning("Raw material {RawMaterialId} in a recipe does not exist; sale line {LineId} not posted against it", rawMaterialId, lineId);
                    continue;
                }

                movements.Add(material.RecordSale(quantity, lineId));
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
        await poster.PostAsync(
            receipt.Lines.Where(l => l.OnBill).Select(l => (l.PublicId, new SoldItem(l.MenuItemId, l.VariantId, l.AddOnIds, l.Quantity))).ToList(),
            cancellationToken);
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
        return new SalesReceiptLine(item.Id, size?.Id, item.Name, size?.Name, line.Quantity, Money(total), addOnIds, line.OnBill);
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

// ---- Import: a point of sale's export ----

// A row of a sales sheet: one line of a receipt. The receipt's own figures (discount, delivery,
// tax, points, refund) are read from its first row. Rows with no receipt number are a day's
// totals: one receipt for each day, place and way of paying.
public sealed record SaleImportRow(
    int Row,
    string? Reference,
    DateOnly? Date,
    TimeOnly? Time,
    string? Channel,
    string? Payment,
    string? Item,
    string? Size,
    string? AddOns,
    decimal? Quantity,
    decimal? LineTotal,
    decimal? Discount,
    decimal? DeliveryFee,
    decimal? Tax,
    decimal? Points,
    decimal? Refunded);

public sealed record SalesImportResult(int Receipts, int Lines, int AlreadyRecorded, IReadOnlyList<SkippedSheetRow> Skipped);

public sealed record ImportSalesCommand(IReadOnlyList<SaleImportRow> Rows, string StaffName) : IRequest<SalesImportResult>;

internal sealed class ImportSalesHandler(IMenuRepository menu, ISalesReceiptRepository sales, SaleWriter writer, IUnitOfWork unitOfWork)
    : IRequestHandler<ImportSalesCommand, SalesImportResult>
{
    public const int MaxRows = 20_000;

    public async Task<SalesImportResult> Handle(ImportSalesCommand request, CancellationToken cancellationToken)
    {
        if (request.Rows.Count == 0)
            throw new DomainException("The sheet has no sales on it.");
        if (request.Rows.Count > MaxRows)
            throw new DomainException($"Import {MaxRows:N0} rows at most at a time: split the sheet.");

        var known = await SaleWriter.Menu.LoadAsync(menu, cancellationToken);
        var byNumber = known.Items.Values.Where(i => !i.IsDeleted).ToDictionary(i => i.Id);
        var byName = known.Items.Values.Where(i => !i.IsDeleted)
            .SelectMany(i => new[] { i.Name, i.NameAr }.OfType<string>().Select(n => (Name: n, Item: i)))
            .GroupBy(x => x.Name, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First().Item, StringComparer.OrdinalIgnoreCase);
        var addOnsByName = known.AddOns.Values.Where(a => !a.IsDeleted)
            .SelectMany(a => new[] { a.Name, a.NameAr }.OfType<string>().Select(n => (Name: n, AddOn: a)))
            .GroupBy(x => x.Name, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First().AddOn, StringComparer.OrdinalIgnoreCase);

        var skipped = new List<SkippedSheetRow>();
        var parsed = new List<(SaleImportRow Row, SaleLineInput Line, SalesChannel Channel, PaymentMethod Payment)>();
        foreach (var row in request.Rows)
        {
            var problem = Parse(row, byNumber, byName, addOnsByName, out var line, out var channel, out var payment);
            if (problem is not null)
                skipped.Add(new SkippedSheetRow(row.Row, row.Item, problem));
            else
                parsed.Add((row, line!, channel, payment));
        }

        var groups = parsed
            .GroupBy(p => p.Row.Reference is { } reference && !string.IsNullOrWhiteSpace(reference)
                ? $"#{reference.Trim()}"
                : $"{p.Row.Date:yyyy-MM-dd}|{p.Channel}|{p.Payment}", StringComparer.OrdinalIgnoreCase)
            .ToList();
        var references = groups.Select(g => g.First().Row.Reference?.Trim()).OfType<string>().Where(r => r.Length > 0).ToList();
        var recorded = await sales.GetReferencesAsync(references, cancellationToken);

        int receipts = 0, lines = 0, already = 0;
        foreach (var group in groups)
        {
            var first = group.First();
            var reference = first.Row.Reference?.Trim();
            if (reference is { Length: > 0 } && recorded.Contains(reference))
            {
                already++;
                continue;
            }

            var input = new SaleInput(
                Guid.NewGuid(), reference is { Length: > 0 } ? reference : null, first.Row.Date!.Value, first.Row.Time, first.Channel, first.Payment,
                group.Select(p => p.Line).ToList(), first.Row.Discount ?? 0, first.Row.DeliveryFee ?? 0, first.Row.Tax ?? 0, first.Row.Points ?? 0,
                first.Row.Refunded ?? 0, reference is { Length: > 0 } ? null : "A day's totals, imported");
            try
            {
                await writer.RecordAsync(input, SalesSource.Imported, request.StaffName, known, cancellationToken);
                receipts++;
                lines += input.Lines.Count;
            }
            catch (DomainException ex)
            {
                skipped.AddRange(group.Select(p => new SkippedSheetRow(p.Row.Row, p.Row.Item, ex.Message)));
            }
        }

        await unitOfWork.SaveChangesAsync(cancellationToken);
        return new SalesImportResult(receipts, lines, already, skipped.OrderBy(s => s.Row).ToList());
    }

    private static string? Parse(
        SaleImportRow row, IReadOnlyDictionary<int, MenuItem> byNumber, IReadOnlyDictionary<string, MenuItem> byName,
        IReadOnlyDictionary<string, AddOn> addOnsByName, out SaleLineInput? line, out SalesChannel channel, out PaymentMethod payment)
    {
        line = null;
        channel = SalesChannel.DineIn;
        payment = PaymentMethod.Cash;
        if (row.Date is null)
            return "No date.";
        var name = row.Item?.Trim();
        if (string.IsNullOrEmpty(name))
            return "No item.";
        var item = int.TryParse(name, out var number) ? byNumber.GetValueOrDefault(number) : byName.GetValueOrDefault(name);
        if (item is null)
            return $"There is no {name} on the menu: add it on Menu, or check its number.";
        if (row.Quantity is not { } quantity || quantity <= 0 || quantity != decimal.Truncate(quantity))
            return "The quantity is a whole number, 1 or more.";

        int? variantId = null;
        var sizeName = row.Size?.Trim();
        if (!string.IsNullOrEmpty(sizeName))
        {
            var size = item.Variants.SingleOrDefault(v => string.Equals(v.Name, sizeName, StringComparison.OrdinalIgnoreCase)
                || string.Equals(v.NameAr, sizeName, StringComparison.OrdinalIgnoreCase));
            if (size is null)
                return $"{item.Name} has no size {sizeName}.";
            variantId = size.Id;
        }
        else if (item.Variants.Count > 0)
        {
            return $"{item.Name} is sold by size: name its size.";
        }

        var addOnIds = new List<int>();
        foreach (var addOnName in (row.AddOns ?? string.Empty).Split([',', '،', ';'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (!addOnsByName.TryGetValue(addOnName, out var addOn))
                return $"There is no add-on {addOnName} on the menu.";
            addOnIds.Add(addOn.Id);
        }

        if (!TryChannel(row.Channel, out channel))
            return $"\"{row.Channel}\" is not a place of sale: Dine in, Takeaway, Delivery or Online.";
        if (!TryPayment(row.Payment, out payment))
            return $"\"{row.Payment}\" is not a way of paying: Cash, Visa or Instapay.";
        if (row.LineTotal < 0)
            return "A line's total cannot be negative.";

        line = new SaleLineInput(item.Id, variantId, (int)quantity, row.LineTotal, addOnIds);
        return null;
    }

    private static bool TryChannel(string? text, out SalesChannel channel)
    {
        var t = (text ?? string.Empty).Trim().ToLowerInvariant().Replace(" ", "").Replace("-", "");
        channel = t switch
        {
            "" or "dinein" or "صالة" or "داخلي" => SalesChannel.DineIn,
            "takeaway" or "takeout" or "تيكاواي" or "سفري" => SalesChannel.Takeaway,
            "delivery" or "دليفري" or "توصيل" => SalesChannel.Delivery,
            "online" or "اونلاين" or "أونلاين" => SalesChannel.Online,
            _ => 0,
        };
        return channel != 0;
    }

    private static bool TryPayment(string? text, out PaymentMethod payment)
    {
        var t = (text ?? string.Empty).Trim().ToLowerInvariant();
        payment = t switch
        {
            "" or "cash" or "نقدي" or "كاش" => PaymentMethod.Cash,
            "visa" or "card" or "فيزا" or "بطاقة" => PaymentMethod.Visa,
            "instapay" or "انستاباي" or "إنستاباي" => PaymentMethod.Instapay,
            _ => 0,
        };
        return payment != 0;
    }
}
