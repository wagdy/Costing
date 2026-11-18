using Costing.Domain.Common;
using Costing.Domain.Production;
using Costing.Domain.RawMaterials;
using Costing.Domain.StockMovements;
using Costing.Domain.Company;

namespace Costing.Domain.StockCounts;

public enum StockCountStatus
{
    // Being filled in: can be saved, finished on another device, or discarded.
    Draft = 1,

    // Stock was set to what was counted. Fixed from then on.
    Posted = 2,

    // Posted, then deleted with a manager's approval: its adjustments reversed, and no longer
    // a point the variance report measures from. Kept, as the record of both.
    Voided = 3,
}

public enum StockCountKind
{
    // The weekly count (جرد دوري): what is found against the records is a shortage or a surplus.
    Periodic = 1,

    // The stock found when costing starts (جرد افتتاحي): where each material's stock begins, valued
    // at its cost, with no shortage or surplus against the records before it. Once per material:
    // one counted already is counted periodically from then on.
    Opening = 2,
}

// How much of the stores a periodic count covers.
public enum StockCountScope
{
    // Every material (جرد شامل): the week's count.
    Full = 1,

    // A chosen few (جرد يومي سريع / جزئي): the daily critical items, the class-A materials, the
    // ones that ran short, a category. Only what is in it is counted, and only what is counted
    // moves; every other material's stock is left exactly as it was.
    Spot = 2,
}

// Where a draft stands between who counts and who reconciles.
public enum StockCountReview
{
    // Being counted.
    Counting = 1,

    // Handed in by a counter who does not see the records (blind): for a manager or a cost
    // controller to reconcile against them and post.
    Submitted = 2,

    // Sent back with lines to weigh again, without saying what the records expect.
    RecountRequested = 3,
}

// A physical count of the stores, material by material. Filled in as a draft, then posted: each
// counted material's stock is set to what was on the shelf (a CountAdjustment in the ledger, or
// for an opening count OpeningStock), and what the ledger said at that moment is kept beside it,
// with the average cost then. Posted counts are the fixed points the variance report measures
// between: an opening count only ever as the first.
//
// A material with no line was not counted, which is not the same as counted at nothing: its
// stock is left alone. A spot count names the materials it covers, and takes no others.
//
// Who counts may count blind (الجرد الأعمى): a storekeeper never sees what the records expect, and
// hands the count in (Submit); a manager or cost controller reconciles it against them and posts
// it, or sends lines back to be weighed again (RequestRecount), still without the figure.
public sealed class StockCount : AggregateRoot, IBranchOwned
{
    // The branch that keeps it (IBranchOwned): given when it is saved, or kept from its original.
    public Guid BranchId { get; private set; }

    public void AssignBranch(Guid branchId) => BranchId = branchId;

    public const int MaxScopeLabelLength = 120;
    public const int MaxNoteLength = 200;
    public const int MaxReviewNoteLength = 300;

    private readonly List<StockCountLine> _lines = [];

    private StockCount() { }

    // The id is made by the till, so a retry after a lost answer reaches the same count.
    public StockCount(
        Guid id, string startedBy, StockCountKind kind = StockCountKind.Periodic, StockCountScope scope = StockCountScope.Full,
        IReadOnlyCollection<Guid>? scopeMaterials = null, string? scopeLabel = null)
    {
        Id = id;
        StartedBy = startedBy;
        StartedAtUtc = DateTime.UtcNow;
        Status = StockCountStatus.Draft;
        SetKind(kind);
        SetScope(scope, scopeMaterials ?? [], scopeLabel);
    }

    public StockCountStatus Status { get; private set; }
    public StockCountKind Kind { get; private set; } = StockCountKind.Periodic;
    public bool IsOpening => Kind == StockCountKind.Opening;
    public DateTime StartedAtUtc { get; private set; }
    public string StartedBy { get; private set; } = string.Empty;
    public DateTime? PostedAtUtc { get; private set; }
    public string? PostedBy { get; private set; }
    public DateTime? VoidedAtUtc { get; private set; }
    public string? VoidedBy { get; private set; }

    public IReadOnlyList<StockCountLine> Lines => _lines.AsReadOnly();

    // Full or spot; for a spot count, the materials it covers and what they were chosen as
    // ("Daily critical items", "Class A", "Dairy").
    public StockCountScope Scope { get; private set; } = StockCountScope.Full;
    public Guid[] ScopeMaterialIds { get; private set; } = [];

    // The location counted (جرد موقع); none: the whole branch, its differences put right in its
    // main store. An open-space shop has one place: none.
    public Guid? LocationId { get; private set; }

    public void CountAt(Guid? locationId)
    {
        if (Status != StockCountStatus.Draft)
            throw new DomainException("A posted count keeps the location it was counted in.");
        LocationId = locationId;
    }
    public string? ScopeLabel { get; private set; }
    public bool IsSpot => Scope == StockCountScope.Spot;

    public StockCountReview Review { get; private set; } = StockCountReview.Counting;
    public string? SubmittedBy { get; private set; }
    public DateTime? SubmittedAtUtc { get; private set; }
    public string? ReviewedBy { get; private set; }
    public DateTime? ReviewedAtUtc { get; private set; }
    // The reviewer's word to the counter with a recount: "Weigh the beef again, the scale was off".
    public string? ReviewNote { get; private set; }

    // Periodic or opening, while it is a draft: started as one, it can be told it is the other.
    public void SetKind(StockCountKind kind)
    {
        if (!Enum.IsDefined(kind))
            throw new DomainException("Choose the kind of count: periodic or opening stock. · اختر نوع الجرد: دوري أو افتتاحي.");
        if (Status != StockCountStatus.Draft && kind != Kind)
            throw new DomainException($"This count has been {Status.ToString().ToLowerInvariant()}: its kind stays.");
        if (kind == StockCountKind.Opening && IsSpot)
            throw new DomainException("The opening stock is where every material's stock begins: start it as a full count. · الجرد الافتتاحي جرد شامل.");
        Kind = kind;
    }

    // Full, or a spot count of these materials, while it is a draft. A spot count is periodic,
    // covers at least one material, and keeps its counted lines within what it covers.
    public void SetScope(StockCountScope scope, IReadOnlyCollection<Guid> materials, string? label)
    {
        if (!Enum.IsDefined(scope))
            throw new DomainException("Choose a full count or a spot count. · اختر جردًا شاملًا أو جردًا سريعًا.");
        if (Status != StockCountStatus.Draft)
            throw new DomainException($"This count has been {Status.ToString().ToLowerInvariant()}: what it covers stays.");
        var name = string.IsNullOrWhiteSpace(label) ? null : label.Trim();
        if (name is { Length: > MaxScopeLabelLength })
            throw new DomainException($"Name what the spot count covers in {MaxScopeLabelLength} characters at most.");
        if (scope == StockCountScope.Full)
        {
            (Scope, ScopeMaterialIds, ScopeLabel) = (scope, [], null);
            return;
        }
        if (Kind == StockCountKind.Opening)
            throw new DomainException("The opening stock is where every material's stock begins: start it as a full count. · الجرد الافتتاحي جرد شامل.");
        var ids = materials.Distinct().ToArray();
        if (ids.Length == 0)
            throw new DomainException("Choose at least one material for the spot count. · اختر خامة واحدة على الأقل للجرد السريع.");
        var outside = _lines.Where(l => !ids.Contains(l.RawMaterialId)).ToList();
        if (outside.Count > 0)
            throw new DomainException($"{outside.Count} counted {(outside.Count == 1 ? "material is" : "materials are")} outside what the spot count would cover: clear {(outside.Count == 1 ? "it" : "them")} first.");
        (Scope, ScopeMaterialIds, ScopeLabel) = (scope, ids, name);
    }

    // Replaces the draft's figures with these, in each material's unit (grams, millilitres, pieces),
    // each with the counter's note if any ("two opened bags"). A recount asked of a line stays asked
    // until the count is handed in again.
    public void Record(IReadOnlyCollection<(Guid RawMaterialId, decimal Counted)> counted) =>
        Record(counted.Select(c => (c.RawMaterialId, c.Counted, (string?)null)).ToList());

    public void Record(IReadOnlyCollection<(Guid RawMaterialId, decimal Counted, string? Note)> counted)
    {
        if (Status != StockCountStatus.Draft)
            throw new DomainException($"This count has been {Status.ToString().ToLowerInvariant()}. Start a new count to count again.");
        if (counted.Any(c => c.Counted < 0))
            throw new DomainException("A counted quantity cannot be negative.");
        if (counted.Select(c => c.RawMaterialId).Distinct().Count() != counted.Count)
            throw new DomainException("Each material is counted once: add its quantities together.");
        if (counted.Any(c => c.Note is { } note && note.Trim().Length > MaxNoteLength))
            throw new DomainException($"Keep a line's note to {MaxNoteLength} characters.");
        if (IsSpot && counted.Count(c => !ScopeMaterialIds.Contains(c.RawMaterialId)) is > 0 and var outside)
            throw new DomainException(
                $"{outside} {(outside == 1 ? "material is" : "materials are")} not in this spot count: it counts only what it covers, and nothing else moves. · " +
                "الجرد السريع يشمل الخامات المختارة فقط.");

        var wanted = counted.ToDictionary(c => c.RawMaterialId);
        _lines.RemoveAll(l => !wanted.ContainsKey(l.RawMaterialId));
        foreach (var (rawMaterialId, quantity, note) in wanted.Values)
        {
            if (_lines.Find(l => l.RawMaterialId == rawMaterialId) is { } line)
                line.Change(quantity, note);
            else
                _lines.Add(new StockCountLine(Id, rawMaterialId, quantity, note));
        }
    }

    // Handed in by its counter for a manager or cost controller to reconcile: any recount asked is
    // done with it.
    public void Submit(string submittedBy)
    {
        if (Status != StockCountStatus.Draft)
            throw new DomainException($"This count has been {Status.ToString().ToLowerInvariant()}.");
        if (_lines.Count == 0)
            throw new DomainException("Count at least one material before handing the count in. · اجرد خامة واحدة على الأقل.");
        foreach (var line in _lines)
            line.Recount(false);
        Review = StockCountReview.Submitted;
        SubmittedBy = submittedBy;
        SubmittedAtUtc = DateTime.UtcNow;
        ReviewNote = null;
    }

    // Sent back to its counter with these lines to weigh again (مطلوب إعادة جرد), and why if said.
    // The counter is told which, never what the records expect.
    public void RequestRecount(IReadOnlyCollection<Guid> materials, string? note, string reviewedBy)
    {
        if (Status != StockCountStatus.Draft)
            throw new DomainException($"This count has been {Status.ToString().ToLowerInvariant()}: nothing to count again.");
        var flagged = _lines.Where(l => materials.Contains(l.RawMaterialId)).ToList();
        if (flagged.Count == 0)
            throw new DomainException("Choose the counted lines to weigh again. · اختر البنود المطلوب إعادة جردها.");
        var said = string.IsNullOrWhiteSpace(note) ? null : note.Trim();
        if (said is { Length: > MaxReviewNoteLength })
            throw new DomainException($"Keep the note to {MaxReviewNoteLength} characters.");
        foreach (var line in _lines)
            line.Recount(flagged.Contains(line));
        Review = StockCountReview.RecountRequested;
        ReviewedBy = reviewedBy;
        ReviewedAtUtc = DateTime.UtcNow;
        ReviewNote = said;
    }

    // Sets each counted material's stock to what was counted, and returns the ledger entries for
    // the differences, for the caller to add in the same unit of work. Counting should happen
    // with the kitchen closed: a sale while the count is open is taken from stock the count
    // then overwrites.
    //
    // An opening count's entries are OpeningStock, not CountAdjustment: where stock begins. A prep
    // item in it never made yet, with no cost of its own, is valued by its recipe today (costs);
    // each line keeps the cost it was valued at.
    public IReadOnlyList<StockMovement> Post(IReadOnlyDictionary<Guid, RawMaterial> materials, string postedBy, RecipeCosts? costs = null)
    {
        if (Status != StockCountStatus.Draft)
            throw new DomainException($"This count has already been {Status.ToString().ToLowerInvariant()}.");
        if (_lines.Count == 0)
            throw new DomainException("Count at least one material before posting.");

        var movements = new List<StockMovement>(_lines.Count);
        foreach (var line in _lines)
        {
            var material = materials.GetValueOrDefault(line.RawMaterialId)
                ?? throw new NotFoundException(nameof(RawMaterial), line.RawMaterialId);
            var book = material.BookQuantity;
            if (IsOpening)
            {
                var byRecipe = costs?.Of(material.Id) is { ByRecipe: true, PerUnit: { } perUnit } ? perUnit : (decimal?)null;
                movements.Add(material.OpenStock(line.CountedQuantity, Id, byRecipe));
                line.Close(book, material.UnitCostHere);
            }
            else
            {
                line.Close(book, material.UnitCostHere);
                movements.Add(material.AdjustToCount(line.CountedQuantity, Id));
            }
        }

        if (LocationId is { } location)
            movements.ForEach(m => m.AssignLocation(location));
        foreach (var line in _lines)
            line.Recount(false);
        Status = StockCountStatus.Posted;
        PostedAtUtc = DateTime.UtcNow;
        PostedBy = postedBy;
        return movements;
    }

    // Marks a posted count void. The caller reverses its adjustments in the same unit of work.
    public void Void(string voidedBy)
    {
        if (Status == StockCountStatus.Voided)
            return;
        if (Status != StockCountStatus.Posted)
            throw new DomainException("Only a posted count is voided; discard a draft instead.");
        Status = StockCountStatus.Voided;
        VoidedAtUtc = DateTime.UtcNow;
        VoidedBy = voidedBy;
    }
}

public sealed class StockCountLine : Entity
{
    private StockCountLine() { }

    internal StockCountLine(Guid stockCountId, Guid rawMaterialId, decimal countedQuantity, string? note = null)
    {
        StockCountId = stockCountId;
        RawMaterialId = rawMaterialId;
        CountedQuantity = countedQuantity;
        Note = Clean(note);
    }

    public Guid StockCountId { get; private set; }
    public Guid RawMaterialId { get; private set; }

    // In the material's unit: grams, millilitres, pieces.
    public decimal CountedQuantity { get; private set; }

    // What the ledger said when the count was posted; null on a draft, which a counter should
    // not see anyway: they count what is on the shelf, not confirm a number.
    public decimal? BookQuantity { get; private set; }

    // The material's average cost per unit when the count was posted: what its variance is valued at.
    public decimal? UnitCost { get; private set; }

    // The counter's word on it: "two bags opened", "found behind the freezer".
    public string? Note { get; private set; }

    // Sent back to be weighed again, until the count is handed in again.
    public bool RecountRequested { get; private set; }

    internal void Change(decimal countedQuantity, string? note = null)
    {
        CountedQuantity = countedQuantity;
        Note = Clean(note);
    }

    internal void Recount(bool requested) => RecountRequested = requested;

    private static string? Clean(string? note) => string.IsNullOrWhiteSpace(note) ? null : note.Trim();

    internal void Close(decimal bookQuantity, decimal? unitCost)
    {
        BookQuantity = bookQuantity;
        UnitCost = unitCost;
    }
}
