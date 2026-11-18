using System.Globalization;
using MediatR;
using Costing.Domain.Common;
using Costing.Application.Categories;
using Costing.Application.Common;
using Costing.Application.RawMaterials;
using Costing.Domain.Categories;
using Costing.Domain.Production;
using Costing.Domain.RawMaterials;
using Costing.Domain.StockCounts;
using Costing.Domain.StockMovements;

namespace Costing.Application.StockCounts;

// Physical counts of the stores. A count is filled in as a draft, saved as it goes (a count can
// take an hour, and a tablet can sleep), then posted, which sets stock to what was counted.
// StockCountId is made by the till, as PurchaseId is. The names of who started and posted it
// are set by the API from who is signed in.
//
// A count is periodic (جرد دوري), what is found against the records a shortage or a surplus, or
// the opening stock (جرد افتتاحي): where each material's stock begins when costing starts,
// valued at its cost, with no shortage or surplus against the zero before it, so neither the
// KPIs nor the profit see it. A material is opened once: one in a posted count already is
// counted periodically from then on.
//
// A periodic count is full (جرد شامل) or a spot count (جرد يومي سريع) of a chosen few; posting
// either moves only the materials counted in it. Who counts may count blind (الجرد الأعمى): the
// API leaves the records' figures and the costs out of what such a counter is sent, and a counter
// who counts blind hands the count in for a manager or a cost controller to reconcile and post.

// What a count sheet shows of each line. BookQuantity and UnitCost are what the records say: on a
// posted count, as they were at posting; on a draft, as they are now, for whoever reconciles it.
// Left out (null) for whoever counts blind: a storekeeper, or anyone counting with blind mode on.
public sealed record StockCountLineDto(
    Guid RawMaterialId, decimal CountedQuantity, decimal? BookQuantity, decimal? UnitCost, string? Note = null, bool RecountRequested = false);

public sealed record StockCountDto(
    Guid Id,
    StockCountStatus Status,
    DateTime StartedAtUtc,
    string StartedBy,
    DateTime? PostedAtUtc,
    string? PostedBy,
    IReadOnlyList<StockCountLineDto> Lines,
    DateTime? VoidedAtUtc = null,
    string? VoidedBy = null,
    StockCountKind Kind = StockCountKind.Periodic,
    StockCountScope Scope = StockCountScope.Full,
    IReadOnlyList<Guid>? ScopeMaterialIds = null,
    string? ScopeLabel = null,
    StockCountReview Review = StockCountReview.Counting,
    string? SubmittedBy = null,
    DateTime? SubmittedAtUtc = null,
    string? ReviewedBy = null,
    DateTime? ReviewedAtUtc = null,
    string? ReviewNote = null,
    // Shown blind: the records' figures and the costs left out.
    bool Blind = false)
{
    // live: the draft's materials as they stand, for the records' figures now. Blind, none at all.
    public static StockCountDto From(StockCount count, bool blind = false, IReadOnlyDictionary<Guid, RawMaterial>? live = null) => new(
        count.Id, count.Status, count.StartedAtUtc, count.StartedBy, count.PostedAtUtc, count.PostedBy,
        count.Lines.Select(l =>
        {
            var (book, cost) = blind ? (null, null)
                : count.Status == StockCountStatus.Draft
                    ? (live?.GetValueOrDefault(l.RawMaterialId)?.QuantityOnHand, live?.GetValueOrDefault(l.RawMaterialId)?.AverageCost)
                    : (l.BookQuantity, l.UnitCost);
            return new StockCountLineDto(l.RawMaterialId, l.CountedQuantity, book, cost, l.Note, l.RecountRequested);
        }).ToList(),
        count.VoidedAtUtc, count.VoidedBy, count.Kind, count.Scope, count.ScopeMaterialIds, count.ScopeLabel, count.Review, count.SubmittedBy,
        count.SubmittedAtUtc, count.ReviewedBy, count.ReviewedAtUtc, count.ReviewNote, blind);

    // As the caller may see it: a draft not blind with the records' figures now.
    public static async Task<StockCountDto> ShowAsync(StockCount count, bool blind, IRawMaterialRepository materials, CancellationToken cancellationToken)
    {
        if (blind || count.Status != StockCountStatus.Draft || count.Lines.Count == 0)
            return From(count, blind);
        var live = (await materials.GetByIdsAsync(count.Lines.Select(l => l.RawMaterialId).ToList(), cancellationToken)).ToDictionary(m => m.Id);
        return From(count, blind, live);
    }
}

// In the material's unit: grams, millilitres, pieces; with the counter's note, if any.
public sealed record StockCountLine(Guid RawMaterialId, decimal CountedQuantity, string? Note = null);

public sealed record StockCountSummaryDto(
    Guid Id, StockCountStatus Status, DateTime StartedAtUtc, string StartedBy, DateTime? PostedAtUtc, string? PostedBy, int Materials,
    DateTime? VoidedAtUtc = null, string? VoidedBy = null, StockCountKind Kind = StockCountKind.Periodic,
    StockCountScope Scope = StockCountScope.Full, string? ScopeLabel = null, int ScopeSize = 0,
    StockCountReview Review = StockCountReview.Counting, string? SubmittedBy = null, DateTime? SubmittedAtUtc = null);

// The draft first, if there is one, then the posted counts, newest first.
public sealed record GetStockCountsQuery : IRequest<IReadOnlyList<StockCountSummaryDto>>;

internal sealed class GetStockCountsQueryHandler(IStockCountRepository counts)
    : IRequestHandler<GetStockCountsQuery, IReadOnlyList<StockCountSummaryDto>>
{
    public async Task<IReadOnlyList<StockCountSummaryDto>> Handle(GetStockCountsQuery request, CancellationToken cancellationToken) =>
        (await counts.GetAllAsync(cancellationToken))
            .OrderBy(c => c.Status)
            .ThenByDescending(c => c.PostedAtUtc ?? c.StartedAtUtc)
            .Select(c => new StockCountSummaryDto(
                c.Id, c.Status, c.StartedAtUtc, c.StartedBy, c.PostedAtUtc, c.PostedBy, c.Lines.Count, c.VoidedAtUtc, c.VoidedBy, c.Kind,
                c.Scope, c.ScopeLabel, c.ScopeMaterialIds.Length, c.Review, c.SubmittedBy, c.SubmittedAtUtc))
            .ToList();
}

// Blind: as its counter sees it, without the records' figures or the costs.
public sealed record GetStockCountQuery(Guid StockCountId, bool Blind = false) : IRequest<StockCountDto?>;

internal sealed class GetStockCountQueryHandler(IStockCountRepository counts, IRawMaterialRepository materials) : IRequestHandler<GetStockCountQuery, StockCountDto?>
{
    public async Task<StockCountDto?> Handle(GetStockCountQuery request, CancellationToken cancellationToken) =>
        await counts.GetByIdAsync(request.StockCountId, cancellationToken) is { } count
            ? await StockCountDto.ShowAsync(count, request.Blind, materials, cancellationToken)
            : null;
}

// Creates the draft on its first save. Only one draft at a time: a second is refused, naming the
// one still open. Kind: periodic or opening, as it starts or changed while a draft; none keeps it.
// Scope: full, or a spot count of ScopeMaterialIds (named ScopeLabel); none keeps it.
public sealed record SaveStockCountCommand(
    Guid StockCountId,
    IReadOnlyList<StockCountLine> Lines,
    string StaffName = "",
    StockCountKind? Kind = null,
    StockCountScope? Scope = null,
    IReadOnlyList<Guid>? ScopeMaterialIds = null,
    string? ScopeLabel = null,
    bool Blind = false)
    : IRequest<StockCountDto>;

internal sealed class SaveStockCountCommandHandler(
    IStockCountRepository counts,
    IRawMaterialRepository materials,
    IUnitOfWork unitOfWork) : IRequestHandler<SaveStockCountCommand, StockCountDto>
{
    public async Task<StockCountDto> Handle(SaveStockCountCommand request, CancellationToken cancellationToken)
    {
        // Every listed material must exist; an empty draft is allowed while it is being started.
        var named = request.Lines.Select(l => l.RawMaterialId).Concat(request.ScopeMaterialIds ?? []).Distinct().ToList();
        if (named.Count > 0)
            await materials.GetRequiredByIdsAsync(named, cancellationToken);

        var count = await counts.GetByIdAsync(request.StockCountId, cancellationToken);
        if (count is null)
        {
            if (await counts.GetDraftAsync(cancellationToken) is { } open)
                throw new DomainException(
                    $"{open.StartedBy} started a count at {open.StartedAtUtc:HH:mm} UTC that is still open: finish or discard it first.");
            count = new StockCount(
                request.StockCountId, request.StaffName, request.Kind ?? StockCountKind.Periodic, request.Scope ?? StockCountScope.Full,
                request.ScopeMaterialIds, request.ScopeLabel);
            counts.Add(count);
        }
        else
        {
            if (request.Kind is { } kind)
                count.SetKind(kind);
            if (request.Scope is { } scope)
                count.SetScope(scope, request.ScopeMaterialIds ?? [], request.ScopeLabel);
        }

        count.Record(request.Lines.Select(l => (l.RawMaterialId, l.CountedQuantity, l.Note)).ToList());
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await StockCountDto.ShowAsync(count, request.Blind, materials, cancellationToken);
    }
}

// Handed in by its counter (تسليم الجرد للمراجعة), for a manager or cost controller to reconcile
// against the records and post: a counter who counts blind never posts.
public sealed record SubmitStockCountCommand(Guid StockCountId, string StaffName = "", bool Blind = false) : IRequest<StockCountDto>;

internal sealed class SubmitStockCountCommandHandler(IStockCountRepository counts, IRawMaterialRepository materials, IUnitOfWork unitOfWork)
    : IRequestHandler<SubmitStockCountCommand, StockCountDto>
{
    public async Task<StockCountDto> Handle(SubmitStockCountCommand request, CancellationToken cancellationToken)
    {
        var count = await counts.GetRequiredAsync(request.StockCountId, cancellationToken);
        count.Submit(request.StaffName);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await StockCountDto.ShowAsync(count, request.Blind, materials, cancellationToken);
    }
}

// Lines sent back to be weighed again (مطلوب إعادة جرد), by who reconciles the count; the counter
// sees which and the note, never what the records expect.
public sealed record RequestStockCountRecountCommand(Guid StockCountId, IReadOnlyList<Guid> RawMaterialIds, string? Note, string StaffName = "")
    : IRequest<StockCountDto>;

internal sealed class RequestStockCountRecountCommandHandler(IStockCountRepository counts, IRawMaterialRepository materials, IUnitOfWork unitOfWork)
    : IRequestHandler<RequestStockCountRecountCommand, StockCountDto>
{
    public async Task<StockCountDto> Handle(RequestStockCountRecountCommand request, CancellationToken cancellationToken)
    {
        var count = await counts.GetRequiredAsync(request.StockCountId, cancellationToken);
        count.RequestRecount(request.RawMaterialIds ?? [], request.Note, request.StaffName);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await StockCountDto.ShowAsync(count, blind: false, materials, cancellationToken);
    }
}

// What a count sheet lists: each material and prep item by its code, name, category and the unit
// it is counted in, whether it is a daily critical item, and nothing of its stock or its cost, so
// a sheet counted blind carries neither.
public sealed record CountItemDto(
    Guid Id,
    string? Code,
    string Name,
    Guid CategoryId,
    string Category,
    string? CategoryAr,
    UnitOfMeasure Unit,
    string PurchaseUnit,
    decimal PurchaseUnitSize,
    bool IsPrepItem,
    bool IsSpotCheckItem,
    bool IsArchived,
    // The kitchen or bar station that keeps it, for a count of one station.
    Guid? KitchenStationId = null);

public sealed record GetCountItemsQuery : IRequest<IReadOnlyList<CountItemDto>>;

internal sealed class GetCountItemsQueryHandler(IRawMaterialRepository materials, IPurchaseCategoryRepository categories)
    : IRequestHandler<GetCountItemsQuery, IReadOnlyList<CountItemDto>>
{
    public async Task<IReadOnlyList<CountItemDto>> Handle(GetCountItemsQuery request, CancellationToken cancellationToken)
    {
        var byId = (await categories.GetAllAsync(cancellationToken)).ToDictionary(c => c.Id);
        return (await materials.GetAllAsync(cancellationToken))
            .Select(m =>
            {
                var category = byId.GetValueOrDefault(m.CategoryId);
                return new CountItemDto(
                    m.Id, m.Code, m.Name, m.CategoryId, category?.Name ?? PurchaseCategory.GeneralName, category?.NameAr, m.Unit, m.PurchaseUnit,
                    m.PurchaseUnitSize, m.IsPrepItem, m.IsSpotCheckItem, m.IsArchived, m.KitchenStationId);
            })
            .OrderBy(i => i.Category, StringComparer.CurrentCultureIgnoreCase)
            .ThenBy(i => i.Name, StringComparer.CurrentCultureIgnoreCase)
            .ToList();
    }
}

// Starred, or not, as a daily critical item (جرد يومي سريع): a flag, no stock moves.
public sealed record SetSpotCheckItemCommand(Guid RawMaterialId, bool IsSpotCheckItem) : IRequest<bool>;

internal sealed class SetSpotCheckItemCommandHandler(IRawMaterialRepository materials, IUnitOfWork unitOfWork)
    : IRequestHandler<SetSpotCheckItemCommand, bool>
{
    public async Task<bool> Handle(SetSpotCheckItemCommand request, CancellationToken cancellationToken)
    {
        var material = await materials.GetRequiredAsync(request.RawMaterialId, cancellationToken);
        material.MarkSpotCheck(request.IsSpotCheckItem);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return material.IsSpotCheckItem;
    }
}

// Posting again, after an answer was lost, returns the posted count and changes nothing.
public sealed record PostStockCountCommand(Guid StockCountId, string StaffName = "") : IRequest<StockCountDto>, IRetryOnConflict;

internal sealed class PostStockCountCommandHandler(
    IStockCountRepository counts,
    IRawMaterialRepository materials,
    IPrepRecipeRepository prepRecipes,
    IStockMovementRepository movements,
    IBusinessCalendar clock,
    IUnitOfWork unitOfWork) : IRequestHandler<PostStockCountCommand, StockCountDto>
{
    public async Task<StockCountDto> Handle(PostStockCountCommand request, CancellationToken cancellationToken)
    {
        var count = await counts.GetRequiredAsync(request.StockCountId, cancellationToken);
        if (count.Status == StockCountStatus.Posted)
            return StockCountDto.From(count);

        IReadOnlyDictionary<Guid, RawMaterial> byId = count.Lines.Count == 0
            ? new Dictionary<Guid, RawMaterial>()
            : await materials.GetRequiredByIdsAsync(count.Lines.Select(l => l.RawMaterialId).ToList(), cancellationToken);
        var costs = await CountPosting.CheckAsync(count, byId, counts, materials, prepRecipes, clock, cancellationToken);
        foreach (var movement in count.Post(byId, request.StaffName, costs))
            movements.Add(movement);

        await unitOfWork.SaveChangesAsync(cancellationToken);
        return StockCountDto.From(count);
    }
}

internal static class CountPosting
{
    // An opening count: none of its materials counted before, and what a prep item never made is
    // valued at by its recipe. Null for a periodic count, which needs neither.
    public static async Task<RecipeCosts?> CheckAsync(
        StockCount count, IReadOnlyDictionary<Guid, RawMaterial> byId, IStockCountRepository counts, IRawMaterialRepository materials,
        IPrepRecipeRepository prepRecipes, IBusinessCalendar clock, CancellationToken cancellationToken)
    {
        if (!count.IsOpening || count.Lines.Count == 0)
            return null;

        var before = await counts.CountedBeforeAsync(byId.Keys.ToList(), count.Id, cancellationToken);
        if (before.Count > 0)
        {
            var names = before.Keys.Select(id => byId[id].Name).Order(StringComparer.CurrentCultureIgnoreCase).ToList();
            var named = names.Count <= 5 ? Join(names) : $"{string.Join(", ", names.Take(5))} and {names.Count - 5} more";
            var first = clock.BusinessDateOf(before.Values.Min());
            throw new DomainException(
                $"{named} {(names.Count == 1 ? "was" : "were")} counted already, first on {first.ToString("d MMM yyyy", CultureInfo.InvariantCulture)}: what is found now is a shortage or a surplus. " +
                "Count them in a periodic count, or leave them out of the opening stock. · " +
                "خامات جُردت من قبل: تُجرد جردًا دوريًا أو تُترك خارج الجرد الافتتاحي.");
        }

        if (!byId.Values.Any(m => m.IsPrepItem))
            return null;
        return new RecipeCosts(
            (await materials.GetAllAsync(cancellationToken)).ToDictionary(m => m.Id), await prepRecipes.GetAllAsync(cancellationToken));
    }

    private static string Join(IReadOnlyList<string> names) =>
        names.Count == 1 ? names[0] : $"{string.Join(", ", names.Take(names.Count - 1))} and {names[^1]}";
}

public sealed record DiscardStockCountCommand(Guid StockCountId) : IRequest;

internal sealed class DiscardStockCountCommandHandler(IStockCountRepository counts, IUnitOfWork unitOfWork)
    : IRequestHandler<DiscardStockCountCommand>
{
    public async Task Handle(DiscardStockCountCommand request, CancellationToken cancellationToken)
    {
        // Already gone: a retry of a discard that worked.
        if (await counts.GetByIdAsync(request.StockCountId, cancellationToken) is not { } count)
            return;
        if (count.Status == StockCountStatus.Posted)
            throw new DomainException("A posted count stays: it is part of the stock's history.");

        counts.Remove(count);
        await unitOfWork.SaveChangesAsync(cancellationToken);
    }
}

// A whole count in one request: recorded and posted at once. For a quick count of a few
// materials, and for scripts; the screens use a draft.
public sealed record RecordStockCountCommand(
    Guid StockCountId, IReadOnlyList<StockCountLine> Lines, string StaffName = "", StockCountKind Kind = StockCountKind.Periodic)
    : IRequest<IReadOnlyList<RawMaterialDto>>, IRetryOnConflict;

internal sealed class RecordStockCountCommandHandler(
    IStockCountRepository counts,
    IRawMaterialRepository materials,
    IPrepRecipeRepository prepRecipes,
    IStockMovementRepository movements,
    IPurchaseCategoryRepository categories,
    IBusinessCalendar clock,
    IUnitOfWork unitOfWork) : IRequestHandler<RecordStockCountCommand, IReadOnlyList<RawMaterialDto>>
{
    public async Task<IReadOnlyList<RawMaterialDto>> Handle(RecordStockCountCommand request, CancellationToken cancellationToken)
    {
        var byId = await materials.GetRequiredByIdsAsync(
            request.Lines.Select(l => l.RawMaterialId).ToList(), cancellationToken);

        if (await counts.GetByIdAsync(request.StockCountId, cancellationToken) is null)
        {
            var count = new StockCount(request.StockCountId, request.StaffName, request.Kind);
            count.Record(request.Lines.Select(l => (l.RawMaterialId, l.CountedQuantity)).ToList());
            var costs = await CountPosting.CheckAsync(count, byId, counts, materials, prepRecipes, clock, cancellationToken);
            counts.Add(count);
            foreach (var movement in count.Post(byId, request.StaffName, costs))
                movements.Add(movement);

            await unitOfWork.SaveChangesAsync(cancellationToken);
        }

        return await categories.DtosAsync(byId.Values, cancellationToken);
    }
}
