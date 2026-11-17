using System.Globalization;
using MediatR;
using Costing.Application.Common;
using Costing.Application.RawMaterials;
using Costing.Application.Recipes;
using Costing.Domain.Common;
using Costing.Domain.Menu;
using Costing.Domain.Recipes;
using Costing.Domain.Sales;

namespace Costing.Application.Sales;

// The day's sales summary (ملخص المبيعات اليومية), as a Z report gives it: each item sold that day
// and how many, no bills and no money. Recorded, each takes its stock by its recipe, and the day
// counts in the theoretical cost and the variance, its items valued at the menu's prices. The
// day's money is its takings, entered on Financials.
//
// One summary a day: entered by hand, item by item, or imported from the day's sheet (an item and
// a quantity a row). A second for a day already entered is refused, naming it: void it on Sales,
// which puts its stock back, and enter the day again.

public sealed record DailySaleLine(int MenuItemId, int? VariantId, int Quantity);

public sealed record RecordDailySalesCommand(Guid Id, DateOnly Date, IReadOnlyList<DailySaleLine> Lines, string StaffName)
    : IRequest<SalesReceiptDto>, IRetryOnConflict;

// A row of the sales sheet: its day (the Date column; the day chosen on a one-day import), the item,
// by its code or name (or chosen from the list), and how many sold; or a discount given that day
// (الخصومات): how much, why, and on how many bills. A row may carry both.
public sealed record DailySaleRow(
    int Row, string? Item, decimal? Quantity, DateOnly? Date = null, decimal? DiscountAmount = null, string? DiscountReason = null,
    decimal? DiscountCount = null)
{
    public bool HasItem => !string.IsNullOrWhiteSpace(Item) || Quantity is not null;
    public bool HasDiscount => DiscountAmount is not null || !string.IsNullOrWhiteSpace(DiscountReason);
}

// SaleId: the day's summary recorded, or none when no row could be read.
public sealed record DailySalesImportResult(
    DateOnly Date, Guid? SaleId, int Items, int Quantity, decimal Value, IReadOnlyList<SkippedSheetRow> Skipped, decimal Discounts = 0);

public sealed record ImportDailySalesCommand(DateOnly Date, IReadOnlyList<DailySaleRow> Rows, string StaffName)
    : IRequest<DailySalesImportResult>, IRetryOnConflict;

// The menu as the day's sheet lists it: every item, each size of one sold by size, by its code.
public sealed record DailySalesSheet(IReadOnlyList<string> Items);

public sealed record GetDailySalesSheetQuery : IRequest<DailySalesSheet>;

internal sealed class DailySalesWriter(ISalesReceiptRepository sales, SaleWriter writer, IBusinessCalendar calendar)
{
    public async Task<SalesReceipt> RecordAsync(
        Guid id, DateOnly date, IReadOnlyList<DailySaleLine> lines, string by, SaleWriter.Menu? menu, CancellationToken cancellationToken,
        decimal discounts = 0, IReadOnlyList<DiscountReason>? discountReasons = null)
    {
        var now = DateTime.UtcNow;
        var latest = new[] { calendar.BusinessDateOf(now), calendar.LocalDateOf(now) }.Max();
        if (date > latest)
            throw new DomainException("That day has not come yet: enter a day's sales once it is over. · هذا اليوم لم يأتِ بعد.");
        if (lines.Count == 0)
            throw new DomainException("Add at least one item sold. · أضف صنفًا مباعًا واحدًا على الأقل.");
        if (lines.Any(l => l.Quantity <= 0))
            throw new DomainException("Each item sold is 1 or more. · الكمية المباعة 1 أو أكثر.");
        if (await sales.GetDailySummaryAsync(date, cancellationToken) is { } entered)
            throw new DomainException(
                $"The sales of {date.ToString("d MMM yyyy", CultureInfo.InvariantCulture)} are entered already " +
                $"({entered.Lines.Count} {(entered.Lines.Count == 1 ? "item" : "items")}, {entered.Lines.Sum(l => l.Quantity)} sold): " +
                "void them on Sales and enter the day again. · مبيعات هذا اليوم مسجلة بالفعل: ألغها من المبيعات ثم أدخل اليوم من جديد.");

        // An item twice is one line of both.
        var merged = lines
            .GroupBy(l => (l.MenuItemId, l.VariantId))
            .Select(g => new SaleLineInput(g.Key.MenuItemId, g.Key.VariantId, g.Sum(l => l.Quantity)))
            .ToList();
        return await writer.RecordAsync(
            new SaleInput(id, null, date, null, SalesChannel.DineIn, PaymentMethod.Cash, merged, DiscountAmount: discounts,
                Notes: "Daily sales summary", DiscountReasons: discountReasons),
            SalesSource.DailySummary, by, menu, cancellationToken);
    }
}

internal sealed class RecordDailySalesHandler(ISalesReceiptRepository sales, DailySalesWriter writer, IUnitOfWork unitOfWork)
    : IRequestHandler<RecordDailySalesCommand, SalesReceiptDto>
{
    public async Task<SalesReceiptDto> Handle(RecordDailySalesCommand request, CancellationToken cancellationToken)
    {
        // Sent again after a lost answer: recorded already.
        if (await sales.GetByIdAsync(request.Id, cancellationToken) is { } already)
            return SalesReceiptDto.From(already);
        var receipt = await writer.RecordAsync(request.Id, request.Date, request.Lines ?? [], request.StaffName, null, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return SalesReceiptDto.From(receipt);
    }
}

internal sealed class GetDailySalesSheetHandler(IMenuRepository menu) : IRequestHandler<GetDailySalesSheetQuery, DailySalesSheet>
{
    public async Task<DailySalesSheet> Handle(GetDailySalesSheetQuery request, CancellationToken cancellationToken) =>
        new(DailySalesItems.Of(await menu.GetItemsAsync(cancellationToken)).Labels.ToList());
}

internal static class DailySalesItems
{
    // Items and their sizes, no add-ons: an add-on is sold on an item, not by itself.
    public static MenuTargets Of(IReadOnlyList<MenuItem> items) => new(items, []);
}

internal sealed class ImportDailySalesHandler(IMenuRepository menu, DailySalesWriter writer, IUnitOfWork unitOfWork)
    : IRequestHandler<ImportDailySalesCommand, DailySalesImportResult>
{
    public const int MaxRows = 5_000;

    public async Task<DailySalesImportResult> Handle(ImportDailySalesCommand request, CancellationToken cancellationToken)
    {
        if (request.Rows.Count == 0)
            throw new DomainException("The sheet has no items on it. · الملف لا يحتوي على أصناف.");
        if (request.Rows.Count > MaxRows)
            throw new DomainException($"Import {MaxRows:N0} rows at most at a time. · {MaxRows:N0} صف على الأكثر.");

        // A sheet of several days is a multi-day upload, kept in their order: never one day of all of them.
        var others = request.Rows.Select(r => r.Date).OfType<DateOnly>().Where(d => d != request.Date).Distinct().Order().ToList();
        if (others.Count > 0)
            throw new DomainException(
                $"The sheet has sales of other days ({string.Join(", ", others.Take(5).Select(DailySheet.Day))}{(others.Count > 5 ? ", …" : "")}): " +
                "upload it as a multi-day sheet, or keep only this day's rows. · الملف يحتوي على أيام أخرى: ارفعه كملف متعدد الأيام.");

        var known = await SaleWriter.Menu.LoadAsync(menu, cancellationToken);
        var sheet = DailySheet.Read(request.Rows, DailySalesItems.Of(known.Items.Values.ToList()), known);
        if (sheet.Lines.Count == 0)
            return new DailySalesImportResult(request.Date, null, 0, 0, 0, sheet.Skipped);
        if (sheet.Problem(request.Date) is { } problem)
            throw new DomainException(problem);

        var receipt = await writer.RecordAsync(
            Guid.NewGuid(), request.Date, sheet.Lines, request.StaffName, known, cancellationToken, sheet.Discounts, sheet.Reasons);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return new DailySalesImportResult(
            request.Date, receipt.Id, receipt.Lines.Count, receipt.Lines.Sum(l => l.Quantity), receipt.BilledSubtotal, sheet.Skipped, receipt.DiscountAmount);
    }
}

// A day's rows of the sales sheet read: its items sold (each row an item and how many), what was left
// out and why, and its discounts (each reason's amount and bills, added up), valued at the menu's prices.
internal sealed record DailySheet(
    IReadOnlyList<DailySaleLine> Lines, IReadOnlyList<SkippedSheetRow> Skipped, decimal Discounts, IReadOnlyList<DiscountReason> Reasons, decimal Value)
{
    public int Quantity => Lines.Sum(l => l.Quantity);

    public int Items => Lines.Select(l => (l.MenuItemId, l.VariantId)).Distinct().Count();

    public static string Day(DateOnly day) => day.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture);

    // What stops the day being recorded: discounts more than its items come to at the menu's prices.
    public string? Problem(DateOnly date) =>
        Discounts > Value
            ? $"The discounts of {Day(date)} ({Discounts.ToString("N2", CultureInfo.InvariantCulture)}) are more than its items come to at the menu's prices " +
              $"({Value.ToString("N2", CultureInfo.InvariantCulture)}): check them. · الخصومات أكبر من قيمة المبيعات بأسعار المنيو."
            : null;

    public static DailySheet Read(IEnumerable<DailySaleRow> rows, MenuTargets targets, SaleWriter.Menu known)
    {
        var skipped = new List<SkippedSheetRow>();
        var lines = new List<DailySaleLine>();
        var given = new List<DiscountReason>();
        foreach (var row in rows)
        {
            if (row.HasItem || !row.HasDiscount)
            {
                var (line, reason, reasonAr) = Parse(row, targets, known);
                if (line is not null)
                    lines.Add(line);
                else
                    skipped.Add(new SkippedSheetRow(row.Row, row.Item, reason!, reasonAr));
            }
            if (!row.HasDiscount)
                continue;
            if (row.DiscountAmount is not { } amount || amount < 0)
                skipped.Add(new SkippedSheetRow(row.Row, row.DiscountReason, "A discount is an amount, 0 or more.", "الخصم مبلغ صفر أو أكثر."));
            else if (row.DiscountCount is { } count && (count < 0 || count != decimal.Truncate(count)))
                skipped.Add(new SkippedSheetRow(row.Row, row.DiscountReason, "The bills discounted are a whole number.", "عدد الفواتير رقم صحيح."));
            else
                given.Add(new DiscountReason(SheetText.Clean(row.DiscountReason) ?? "Not given", amount, (int)(row.DiscountCount ?? 0)));
        }
        var discounts = Math.Round(given.Sum(r => r.Amount), 2, MidpointRounding.AwayFromZero);
        var reasons = given
            .GroupBy(r => r.Reason, StringComparer.OrdinalIgnoreCase)
            .Select(g => new DiscountReason(g.First().Reason, g.Sum(r => r.Amount), g.Sum(r => r.Count)))
            .Where(r => r.Amount > 0)
            .ToList();
        var value = lines.Count == 0
            ? 0
            : SaleWriter.ValueOf(lines.Select(l => new SaleLineInput(l.MenuItemId, l.VariantId, l.Quantity)), known);
        return new DailySheet(lines, skipped, discounts, reasons, value);
    }

    // A row's item and how many sold: the item on the menu (a size of one sold by size), a whole number.
    private static (DailySaleLine? Line, string? Reason, string? ReasonAr) Parse(DailySaleRow row, MenuTargets targets, SaleWriter.Menu known)
    {
        var text = SheetText.Clean(row.Item);
        if (text is null)
            return (null, "No item: choose it from the list.", "لا يوجد صنف: اختره من القائمة.");
        if (row.Quantity is not { } quantity || quantity < 1 || quantity != decimal.Truncate(quantity) || quantity > int.MaxValue)
            return (null, "The quantity sold is a whole number, 1 or more.", "الكمية المباعة رقم صحيح 1 أو أكثر.");

        var (target, reason, reasonAr) = targets.Find(text);
        if (target is not { } found)
            return (null, reason ?? $"There is no {text} on the menu: choose the item from the list, or add it on Menu first.",
                reasonAr ?? $"لا يوجد {text} في المنيو: اختر الصنف من القائمة أو أضفه في المنيو أولًا.");
        if (found.Kind != RecipeTargetKind.MenuItem)
            return (null, "An add-on is sold on an item, not by itself: leave it out.", "الإضافة تُباع مع صنف وليست وحدها.");
        var item = known.Items[found.CatalogItemId];
        if (found.VariantId is null && item.Variants.Count > 0)
            return (null, $"{item.Name} is sold by size: choose its size from the list.", $"{item.Name} يُباع بالحجم: اختر الحجم من القائمة.");
        return (new DailySaleLine(found.CatalogItemId, found.VariantId, (int)quantity), null, null);
    }
}
