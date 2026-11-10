using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using MediatR;
using Costing.Application.Approvals;
using Costing.Application.Common;
using Costing.Application.Recipes;
using Costing.Application.Sales;
using Costing.Application.Treasury;
using Costing.Domain.Approvals;
using Costing.Domain.Common;
using Costing.Domain.Integrations;
using Costing.Domain.Menu;
using Costing.Domain.Recipes;
using Costing.Domain.Sales;
using Costing.Domain.StockMovements;
using Costing.Domain.Treasury;

namespace Costing.Application.Integrations;

// The POS link (Settings → POS Integration): the key the POS proves itself by, the menu it reads
// from here, and each shift's Z report it sends, made into the day's sales summary (its stock
// taken by the recipes, what was voided after the kitchen taken as waste) and the day's takings in
// the safe; all of a report or none of it. A report sent again changes nothing; sent changed, it
// replaces what it made. A day whose sales or takings were entered by hand is left as it is: the
// report is refused, naming it.

// ---- The key ----

public static class PosKeys
{
    public const string Prefix = "cpk_";

    // 32 random bytes, URL-safe: shown once, kept only as its hash.
    public static string New() => Prefix + Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public static string Hash(string key) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(key.Trim()))).ToLowerInvariant();

    public static string Hint(string key) => "••••" + key[^4..];

    // In constant time, so the time taken says nothing of how close a wrong key came.
    public static bool Matches(string? key, string? hash)
    {
        if (string.IsNullOrWhiteSpace(key) || hash is null)
            return false;
        var given = Encoding.ASCII.GetBytes(Hash(key));
        var kept = Encoding.ASCII.GetBytes(hash);
        return CryptographicOperations.FixedTimeEquals(given, kept);
    }
}

public sealed record PosSyncLogDto(
    Guid Id, DateTime AtUtc, string Endpoint, PosSyncOutcome Outcome, string Message, Guid? ZReportId, DateOnly? BusinessDate, string? Detail)
{
    public static PosSyncLogDto From(PosSyncLog l) => new(l.Id, l.AtUtc, l.Endpoint, l.Outcome, l.Message, l.ZReportId, l.BusinessDate, l.Detail);
}

public sealed record PosIntegrationDto(bool HasKey, string? KeyHint, DateTime? KeyCreatedAtUtc, string? KeyCreatedBy, IReadOnlyList<PosSyncLogDto> Logs);

// The key in full, this once: the page shows it to be copied into the POS.
public sealed record PosKeyDto(string Key, string KeyHint, DateTime CreatedAtUtc, string CreatedBy);

public sealed record GetPosIntegrationQuery(int Logs = 200) : IRequest<PosIntegrationDto>;

public sealed record GeneratePosKeyCommand(string StaffName) : IRequest<PosKeyDto>, IRetryOnConflict;

public sealed record VerifyPosKeyQuery(string? Key) : IRequest<bool>;

internal sealed class GetPosIntegrationHandler(IPosLinkStore links, IPosSyncJournal journal) : IRequestHandler<GetPosIntegrationQuery, PosIntegrationDto>
{
    public async Task<PosIntegrationDto> Handle(GetPosIntegrationQuery request, CancellationToken cancellationToken)
    {
        var link = await links.GetAsync(cancellationToken);
        var logs = await journal.RecentAsync(Math.Clamp(request.Logs, 1, 1000), cancellationToken);
        return new PosIntegrationDto(link.HasKey, link.KeyHint, link.KeyCreatedAtUtc, link.KeyCreatedBy, logs.Select(PosSyncLogDto.From).ToList());
    }
}

internal sealed class GeneratePosKeyHandler(IPosLinkStore links, IUnitOfWork unitOfWork) : IRequestHandler<GeneratePosKeyCommand, PosKeyDto>
{
    public async Task<PosKeyDto> Handle(GeneratePosKeyCommand request, CancellationToken cancellationToken)
    {
        var link = await links.GetAsync(cancellationToken);
        var key = PosKeys.New();
        link.SetKey(PosKeys.Hash(key), PosKeys.Hint(key), request.StaffName);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return new PosKeyDto(key, link.KeyHint!, link.KeyCreatedAtUtc!.Value, request.StaffName);
    }
}

internal sealed class VerifyPosKeyHandler(IPosLinkStore links) : IRequestHandler<VerifyPosKeyQuery, bool>
{
    public async Task<bool> Handle(VerifyPosKeyQuery request, CancellationToken cancellationToken) =>
        PosKeys.Matches(request.Key, (await links.GetAsync(cancellationToken)).KeyHash);
}

// ---- The menu, as the POS reads it ----

// Codes as Costing's reports write them: an item by its number (6101), a size as the item's number
// and the size's (6101-17), an add-on as A and its number (A3).
public sealed record PosMenuSizeDto(string Code, int VariantId, string Name, string? NameAr, decimal Price);

public sealed record PosMenuItemDto(
    int Code, string Name, string? NameAr, string Category, decimal Price, bool IsAvailable, bool PricedByAddOns, bool HasRecipe,
    IReadOnlyList<PosMenuSizeDto> Sizes, IReadOnlyList<string> AddOnCodes);

public sealed record PosMenuCategoryDto(string Name, string? NameAr, int DisplayOrder);

public sealed record PosMenuAddOnDto(string Code, string Name, string? NameAr, decimal Price);

public sealed record PosMenuDto(DateTime AtUtc, IReadOnlyList<PosMenuCategoryDto> Categories, IReadOnlyList<PosMenuItemDto> Items, IReadOnlyList<PosMenuAddOnDto> AddOns);

public sealed record GetPosMenuQuery : IRequest<PosMenuDto>;

internal sealed class GetPosMenuHandler(IMenuRepository menu, IRecipeRepository recipes) : IRequestHandler<GetPosMenuQuery, PosMenuDto>
{
    public async Task<PosMenuDto> Handle(GetPosMenuQuery request, CancellationToken cancellationToken)
    {
        var categories = await menu.GetCategoriesAsync(cancellationToken);
        var items = (await menu.GetItemsAsync(cancellationToken)).Where(i => !i.IsDeleted).OrderBy(i => i.Id).ToList();
        var addOns = (await menu.GetAddOnsAsync(cancellationToken)).Where(a => !a.IsDeleted).OrderBy(a => a.Id).ToList();
        var targets = items.SelectMany(i => i.Variants.Select(v => RecipeTarget.ForVariant(i.Id, v.Id)).Prepend(RecipeTarget.ForMenuItem(i.Id))).ToList();
        var withRecipe = (await recipes.GetByTargetsAsync(targets, cancellationToken))
            .Where(r => !r.IsDeleted && r.Target is { Kind: RecipeTargetKind.MenuItem })
            .Select(r => r.Target!.Value.CatalogItemId).ToHashSet();
        var live = addOns.Select(a => a.Id).ToHashSet();

        return new PosMenuDto(
            DateTime.UtcNow,
            categories.OrderBy(c => c.DisplayOrder).ThenBy(c => c.Name).Select(c => new PosMenuCategoryDto(c.Name, c.NameAr, c.DisplayOrder)).ToList(),
            items.Select(i => new PosMenuItemDto(
                i.Id, i.Name, i.NameAr, i.Category, i.Price, i.IsAvailable, i.IsPriceBasedOnAddons, withRecipe.Contains(i.Id),
                i.Variants.OrderBy(v => v.DisplayOrder).Select(v => new PosMenuSizeDto($"{i.Id}-{v.Id}", v.Id, v.Name, v.NameAr, v.Price)).ToList(),
                i.AddOnIds.Where(live.Contains).Select(id => $"A{id}").ToList())).ToList(),
            addOns.Select(a => new PosMenuAddOnDto($"A{a.Id}", a.Name, a.NameAr, a.Price)).ToList());
    }
}

// ---- The Z report ----

// A line of it: the item by its code (6101, a size 6101-17) or name, and for an item sold by size
// without a size code, its size by name. Reason: why it was voided, for waste.
public sealed record ZReportItem(string ItemCode, int Quantity, string? Size = null, string? Name = null, string? Reason = null);

public sealed record ZReportVoidReason(string Reason, int Count, decimal Amount);

// The day's takings as the Z report gives them, as the safe keeps them: the cash and the card
// (Visa, wallets) before tax, the tax collected on them, and the voids and why.
public sealed record ZReportTakings(decimal Cash, decimal Card, decimal Tax, decimal VoidsAmount, IReadOnlyList<ZReportVoidReason>? VoidReasons = null);

// A shift's Z report: ZReportId is the POS's id for the shift, the same each time it is sent.
// WastedItems: voided after the kitchen had made them (waste): their stock taken as waste.
public sealed record ZReportInput(
    Guid ZReportId, DateOnly Date, int? ShiftNumber, ZReportTakings Takings, IReadOnlyList<ZReportItem> SoldItems,
    IReadOnlyList<ZReportItem>? WastedItems = null);

public sealed record ZReportResultDto(
    Guid ZReportId, DateOnly Date, PosSyncOutcome Outcome, Guid? SaleId, Guid? TakingsId, int Items, int Quantity, int Wasted,
    decimal SalesValue, decimal Cash, decimal Card, decimal Tax, IReadOnlyList<string> Warnings);

public sealed record ReceiveZReportCommand(ZReportInput Report, string Source) : IRequest<ZReportResultDto>, IRetryOnConflict;

internal sealed class ReceiveZReportHandler(
    IPosZReportRepository reports,
    IPosDayRepository days,
    IMenuRepository menu,
    IRecipeRepository recipes,
    ISalesReceiptRepository sales,
    ISafeTransactionRepository safe,
    IStockMovementRepository movements,
    SaleWriter saleWriter,
    TreasuryWriter treasury,
    DeletionTargets deletions,
    IBusinessCalendar calendar,
    IPosSyncJournal journal,
    IUnitOfWork unitOfWork) : IRequestHandler<ReceiveZReportCommand, ZReportResultDto>
{
    public const string By = "POS";
    public const int MaxLines = 2_000;

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter() } };
    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

    public async Task<ZReportResultDto> Handle(ReceiveZReportCommand request, CancellationToken cancellationToken)
    {
        var report = request.Report;
        var endpoint = request.Source;
        try
        {
            var result = await RecordAsync(report, request.Source, cancellationToken);
            await journal.WriteAsync(new PosSyncLog(endpoint, result.Outcome, Describe(result), report.ZReportId, report.Date,
                JsonSerializer.Serialize(result, Json)), cancellationToken);
            return result;
        }
        catch (DomainException ex)
        {
            await journal.WriteAsync(new PosSyncLog(endpoint, PosSyncOutcome.Refused, ex.Message, report.ZReportId, report.Date), cancellationToken);
            throw;
        }
        catch (NotFoundException ex)
        {
            await journal.WriteAsync(new PosSyncLog(endpoint, PosSyncOutcome.Refused, ex.Message, report.ZReportId, report.Date), cancellationToken);
            throw;
        }
        catch (ConflictException)
        {
            // Run again by the pipeline; logged if it fails for good.
            throw;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            await journal.WriteAsync(new PosSyncLog(endpoint, PosSyncOutcome.Failed, "It could not be recorded: " + ex.GetType().Name, report.ZReportId, report.Date),
                CancellationToken.None);
            throw;
        }
    }

    private async Task<ZReportResultDto> RecordAsync(ZReportInput report, string source, CancellationToken cancellationToken)
    {
        Check(report);
        CheckDate(report.Date);
        var payload = JsonSerializer.Serialize(report, Json);
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(payload))).ToLowerInvariant();

        var existing = await reports.GetByIdAsync(report.ZReportId, cancellationToken);
        if (existing is not null && existing.PayloadHash == hash)
        {
            // Sent again: what it made stands.
            var day = await days.GetByDateAsync(existing.BusinessDate, cancellationToken);
            return Result(report, PosSyncOutcome.Unchanged, day?.SaleId, day?.TakingsId, await SaleAsync(day?.SaleId, cancellationToken), []);
        }

        var known = await SaleWriter.Menu.LoadAsync(menu, cancellationToken);
        var targets = new MenuTargets(known.Items.Values.ToList(), known.AddOns.Values.ToList());

        // Every line placed on the menu first: a report with a line that cannot be is refused whole.
        Place(report, targets, known);

        var moved = existing is not null && existing.BusinessDate != report.Date ? existing.BusinessDate : (DateOnly?)null;
        if (existing is null)
        {
            existing = new PosZReport(report.ZReportId, report.Date, report.ShiftNumber, source, hash, payload);
            reports.Add(existing);
        }
        else
        {
            existing.Replace(report.Date, report.ShiftNumber, source, hash, payload);
        }

        // The day's records from every one of its shifts' reports; a report moved to another day
        // takes its lines off the day it was on.
        if (moved is { } before)
            await RebuildDayAsync(before, existing, targets, known, cancellationToken);
        var (saleId, takingsId, warnings) = await RebuildDayAsync(report.Date, existing, targets, known, cancellationToken);

        await unitOfWork.SaveChangesAsync(cancellationToken);
        var outcome = existing.Revision == 1 ? PosSyncOutcome.Recorded : PosSyncOutcome.Updated;
        return Result(report, outcome, saleId, takingsId, await SaleAsync(saleId, cancellationToken), warnings);
    }

    // The day's sales summary and takings, made again from the reports of that day: what the POS
    // made of it before voided (its stock put back, its takings reversed), the new ones recorded.
    private async Task<(Guid? SaleId, Guid? TakingsId, IReadOnlyList<string> Warnings)> RebuildDayAsync(
        DateOnly date, PosZReport current, MenuTargets targets, SaleWriter.Menu known, CancellationToken cancellationToken)
    {
        var day = await days.GetByDateAsync(date, cancellationToken);
        if (day is null)
        {
            day = new PosDay(Guid.NewGuid(), date);
            days.Add(day);
        }

        // Entered by hand: not the POS's to replace.
        if (await sales.GetDailySummaryAsync(date, cancellationToken) is { } summary && summary.Id != day.SaleId)
            throw new DomainException(
                $"The sales of {Day(date)} were entered by hand ({summary.Lines.Count} items): void them on Sales, then send the Z report again. · " +
                "مبيعات هذا اليوم مُدخلة يدويًا: ألغها من المبيعات ثم أعد إرسال تقرير Z.");
        if (await safe.GetTakingsAsync(date, cancellationToken) is { } takings && takings.Id != day.TakingsId)
            throw new DomainException(
                $"The takings of {Day(date)} were entered by hand ({SaleWriter.Money(takings.TakingsTotal):N2}): void them in the safe, then send the Z report again. · " +
                "إيراد هذا اليوم مُدخل يدويًا: ألغه من الخزنة ثم أعد إرسال تقرير Z.");

        // What the POS made of the day before: voided, unless someone voided it already.
        if (day.SaleId is { } oldSale && await sales.GetByIdAsync(oldSale, cancellationToken) is { IsVoided: false })
            foreach (var reversal in await deletions.DeleteAsync(ApprovalModule.Sale, oldSale, By, cancellationToken))
                movements.Add(reversal);
        if (day.TakingsId is { } oldTakings && await safe.GetByIdAsync(oldTakings, cancellationToken) is { } previous
            && previous.VoidedAtUtc is null && previous.ReversalOf is null)
            await treasury.VoidAsync(previous, By, cancellationToken);

        // Every report of the day: the one in hand as it is now, the rest as kept.
        var dayReports = (await reports.GetByDateAsync(date, cancellationToken))
            .Where(r => r.Id != current.Id)
            .Select(r => JsonSerializer.Deserialize<ZReportInput>(r.Payload, Json)!)
            .ToList();
        if (current.BusinessDate == date)
            dayReports.Add(JsonSerializer.Deserialize<ZReportInput>(current.Payload, Json)!);
        if (dayReports.Count == 0)
        {
            day.Recorded(null, null);
            return (null, null, []);
        }

        // The sales summary: each item sold, and each made and voided after the kitchen, as waste.
        var sold = new Dictionary<(int Item, int? Variant), int>();
        var wasted = new Dictionary<(int Item, int? Variant), int>();
        foreach (var each in dayReports)
        {
            foreach (var item in each.SoldItems)
                Add(sold, Place(item, targets, known), item.Quantity);
            foreach (var item in each.WastedItems ?? [])
                Add(wasted, Place(item, targets, known), item.Quantity);
        }
        var lines = sold.Select(s => new SaleLineInput(s.Key.Item, s.Key.Variant, s.Value))
            .Concat(wasted.Select(w => new SaleLineInput(w.Key.Item, w.Key.Variant, w.Value, Voided: LineVoid.AfterKitchen)))
            .ToList();

        var warnings = new List<string>();
        Guid? saleId = null;
        if (lines.Count > 0)
        {
            var shifts = string.Join(", ", dayReports.Select(r => r.ShiftNumber).OfType<int>().Order());
            var receipt = await saleWriter.RecordAsync(
                new SaleInput(Guid.NewGuid(), null, date, null, SalesChannel.DineIn, PaymentMethod.Cash, lines,
                    Notes: shifts.Length > 0 ? $"POS Z reports, shifts {shifts}" : "POS Z report"),
                SalesSource.DailySummary, By, known, cancellationToken);
            saleId = receipt.Id;
            warnings.AddRange(await WithoutRecipesAsync(lines, known, cancellationToken));
        }

        // The takings: the day's cash, card, tax and voids, every shift's together.
        var cash = dayReports.Sum(r => r.Takings.Cash);
        var card = dayReports.Sum(r => r.Takings.Card);
        var tax = dayReports.Sum(r => r.Takings.Tax);
        var voids = dayReports.Sum(r => r.Takings.VoidsAmount);
        Guid? takingsId = null;
        if (cash + card > 0)
        {
            var reasons = dayReports.SelectMany(r => r.Takings.VoidReasons ?? [])
                .GroupBy(r => r.Reason.Trim(), StringComparer.OrdinalIgnoreCase)
                .Select(g => $"{g.Key} ×{g.Sum(r => r.Count)} {g.Sum(r => r.Amount).ToString("N2", Invariant)}")
                .ToList();
            var notes = "From the POS" + (reasons.Count > 0 ? $" · voids: {string.Join("; ", reasons)}" : "");
            if (notes.Length > SafeTransaction.MaxNotesLength)
                notes = notes[..SafeTransaction.MaxNotesLength];
            var entry = SafeTransaction.RevenueTransfer(
                Guid.NewGuid(), cash, date, date, notes, By, null, null, await safe.PaidOutOfTakingsAsync(date, cancellationToken), card, tax, voids);
            safe.Add(entry);
            takingsId = entry.Id;
        }
        else if (tax > 0)
        {
            throw new DomainException("Tax was collected on a day with no cash or card takings: check the Z report. · ضريبة بدون إيراد.");
        }

        day.Recorded(saleId, takingsId);
        return (saleId, takingsId, warnings);
    }

    // Each line on the menu, or the report refused naming every line that is not.
    private static void Place(ZReportInput report, MenuTargets targets, SaleWriter.Menu known)
    {
        var problems = new List<string>();
        foreach (var item in report.SoldItems.Concat(report.WastedItems ?? []))
        {
            try
            {
                Place(item, targets, known);
            }
            catch (DomainException ex)
            {
                problems.Add(ex.Message);
            }
        }
        if (problems.Count > 0)
            throw new DomainException(
                $"{problems.Count} {(problems.Count == 1 ? "line" : "lines")} of the Z report could not be placed on the menu, so nothing was recorded: " +
                string.Join(" ", problems.Distinct().Take(20)) + " · لم يُسجل شيء: بعض الأصناف غير موجودة في المنيو.");
    }

    private static (int Item, int? Variant) Place(ZReportItem item, MenuTargets targets, SaleWriter.Menu known)
    {
        var code = item.ItemCode?.Trim();
        var label = string.IsNullOrEmpty(code) ? item.Name ?? "(no code)" : code;
        var (target, reason, _) = targets.Find(string.IsNullOrEmpty(code) ? item.Name ?? string.Empty : code);
        if (target is not { } found)
            throw new DomainException(reason ?? $"{label}{(item.Name is { } n && n != label ? $" ({n})" : "")} is not on the menu.");
        if (found.Kind != RecipeTargetKind.MenuItem)
            throw new DomainException($"{label} is an add-on: it is sold on an item, not by itself.");
        var menuItem = known.Items[found.CatalogItemId];
        if (found.VariantId is { } variant)
            return (menuItem.Id, variant);
        if (menuItem.Variants.Count == 0)
            return (menuItem.Id, null);
        // Sold by size, the size by its name.
        var size = item.Size?.Trim();
        var match = size is null ? null : menuItem.Variants.SingleOrDefault(v =>
            string.Equals(v.Name, size, StringComparison.OrdinalIgnoreCase) || string.Equals(v.NameAr, size, StringComparison.OrdinalIgnoreCase));
        return match is not null
            ? (menuItem.Id, match.Id)
            : throw new DomainException(size is null
                ? $"{label} ({menuItem.Name}) is sold by size: send its size code ({string.Join(", ", menuItem.Variants.Select(v => $"{menuItem.Id}-{v.Id} {v.Name}"))})."
                : $"{menuItem.Name} has no size {size}: its sizes are {string.Join(", ", menuItem.Variants.Select(v => v.Name))}.");
    }

    private static void Check(ZReportInput report)
    {
        if (report.ZReportId == Guid.Empty)
            throw new DomainException("A Z report needs its id (the POS shift's), so a resend is known for one.");
        if (report.Takings is null)
            throw new DomainException("A Z report needs its takings.");
        var t = report.Takings;
        if (t.Cash < 0 || t.Card < 0 || t.Tax < 0 || t.VoidsAmount < 0)
            throw new DomainException("The cash, card, tax and voids are zero or more. · المبالغ صفر أو أكثر.");
        if (t.Tax > t.Cash + t.Card)
            throw new DomainException("The tax collected cannot be more than the day's sales. · الضريبة لا تزيد عن إجمالي المبيعات.");
        var lines = report.SoldItems ?? throw new DomainException("A Z report lists its sold items (none: an empty list).");
        if (lines.Count + (report.WastedItems?.Count ?? 0) > MaxLines)
            throw new DomainException($"A Z report has {MaxLines:N0} lines at most.");
        if (lines.Concat(report.WastedItems ?? []).Any(l => l.Quantity < 1))
            throw new DomainException("Each item's quantity is 1 or more.");
    }

    private void CheckDate(DateOnly date)
    {
        var now = DateTime.UtcNow;
        var latest = new[] { calendar.BusinessDateOf(now), calendar.LocalDateOf(now) }.Max();
        if (date > latest)
            throw new DomainException($"{Day(date)} has not come yet here: check the POS's date and time zone.");
    }

    private async Task<IReadOnlyList<string>> WithoutRecipesAsync(IReadOnlyList<SaleLineInput> lines, SaleWriter.Menu known, CancellationToken cancellationToken)
    {
        var items = lines.Select(l => new SoldItem(l.MenuItemId, l.VariantId, [], l.Quantity)).ToList();
        var relevant = await recipes.GetByTargetsAsync(StockRequirements.TargetsFor(items), cancellationToken);
        return items.Where(i => StockRequirements.For(i, relevant).Count == 0)
            .Select(i => known.Items[i.MenuItemId] is var item && i.VariantId is { } v
                ? $"{item.Name} ({item.Variants.Single(x => x.Id == v).Name})"
                : known.Items[i.MenuItemId].Name)
            .Distinct()
            .Select(name => $"{name} has no recipe: no stock was taken for it.")
            .ToList();
    }

    private async Task<SalesReceipt?> SaleAsync(Guid? id, CancellationToken cancellationToken) =>
        id is { } saleId ? await sales.GetByIdAsync(saleId, cancellationToken) : null;

    private static ZReportResultDto Result(ZReportInput report, PosSyncOutcome outcome, Guid? saleId, Guid? takingsId, SalesReceipt? sale, IReadOnlyList<string> warnings) =>
        new(report.ZReportId, report.Date, outcome, saleId, takingsId,
            sale?.Lines.Count(l => l.OnBill) ?? 0, sale?.Lines.Where(l => l.OnBill).Sum(l => l.Quantity) ?? 0,
            sale?.Lines.Where(l => !l.OnBill).Sum(l => l.Quantity) ?? 0, sale?.BilledSubtotal ?? 0,
            report.Takings.Cash, report.Takings.Card, report.Takings.Tax, warnings);

    private static string Describe(ZReportResultDto r) => r.Outcome switch
    {
        PosSyncOutcome.Unchanged => $"Z report of {Day(r.Date)} sent again: nothing changed.",
        _ => $"Z report of {Day(r.Date)} {(r.Outcome == PosSyncOutcome.Updated ? "updated" : "recorded")}: {r.Quantity} sold of {r.Items} items" +
             (r.Wasted > 0 ? $", {r.Wasted} wasted" : "") +
             $"; takings {r.Cash.ToString("N2", Invariant)} cash, {r.Card.ToString("N2", Invariant)} card, {r.Tax.ToString("N2", Invariant)} tax" +
             (r.Warnings.Count > 0 ? $". {r.Warnings.Count} without a recipe." : "."),
    };

    private static void Add(Dictionary<(int, int?), int> into, (int, int?) key, int quantity) =>
        into[key] = into.GetValueOrDefault(key) + quantity;

    private static string Day(DateOnly date) => date.ToString("d MMM yyyy", Invariant);
}

// ---- The POS's own event envelope (POST …/events) ----

// What the POS sends every linked system: {id, kind, branchCode, occurredAtUtc, data}. Costing uses
// day.closed (a shift's Z report); any other kind is answered and left.
public static class PosEvents
{
    public const string DayClosed = "day.closed";

    public static ZReportInput DayClosedReport(JsonElement data)
    {
        var shiftId = Guid(data, "shiftId");
        var date = DateOnly.Parse(Text(data, "businessDate") ?? throw new DomainException("day.closed has no businessDate."), CultureInfo.InvariantCulture);
        var takings = data.TryGetProperty("takings", out var t) ? t : throw new DomainException("day.closed has no takings.");
        var before = Number(Child(takings, "voidsBefore"), "amount");
        var after = Child(takings, "voidsAfter");
        var reasons = new List<ZReportVoidReason>();
        if (after is { } a && a.TryGetProperty("reasons", out var listed) && listed.ValueKind == JsonValueKind.Array)
            reasons.AddRange(listed.EnumerateArray().Select(r =>
                new ZReportVoidReason(Text(r, "reason") ?? "No reason", (int)Number(r, "count"), Number(r, "amount"))));
        if (Number(Child(takings, "voidsBefore"), "count") is var count and > 0)
            reasons.Add(new ZReportVoidReason("Before kitchen", (int)count, before));

        return new ZReportInput(
            shiftId, date, data.TryGetProperty("shiftNumber", out var n) && n.ValueKind == JsonValueKind.Number ? n.GetInt32() : null,
            new ZReportTakings(Number(takings, "cash"), Number(takings, "card"), Number(takings, "tax"), before + Number(after, "amount"), reasons),
            Items(data, "soldItems"), Items(data, "waste"));
    }

    private static IReadOnlyList<ZReportItem> Items(JsonElement data, string name) =>
        data.TryGetProperty(name, out var list) && list.ValueKind == JsonValueKind.Array
            ? list.EnumerateArray().Select(i => new ZReportItem(
                Text(i, "itemCode") ?? (i.TryGetProperty("code", out var c) ? c.ToString() : string.Empty),
                (int)Number(i, "quantity"), Text(i, "size"), Text(i, "name"), Text(i, "reason"))).ToList()
            : [];

    private static JsonElement? Child(JsonElement element, string name) =>
        element.TryGetProperty(name, out var child) && child.ValueKind == JsonValueKind.Object ? child : null;

    private static string? Text(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static decimal Number(JsonElement? element, string name) =>
        element is { } e && e.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number ? value.GetDecimal() : 0;

    private static System.Guid Guid(JsonElement element, string name) =>
        Text(element, name) is { } text && System.Guid.TryParse(text, out var id) ? id : throw new DomainException($"day.closed has no {name}.");
}
