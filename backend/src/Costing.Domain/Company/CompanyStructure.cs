using Costing.Domain.Common;

namespace Costing.Domain.Company;

// How the business is built (هيكلة الشركة): what the system shows and keeps apart follows it, from
// one open-space shop to a chain with a central kitchen. Kept on the company's settings.
public enum SystemOperatingMode
{
    // One branch, everything in one place (فرع واحد بمساحة مفتوحة): one stock, no locations, no
    // transfers, no branch selector. The system as it always was.
    SingleBranch_OpenSpace = 1,

    // One branch with a locked main store and the kitchen's operating locations (مخزن ومناطق تشغيل).
    SingleBranch_WithSubStores = 2,

    // Several branches, each buying and costing on its own (فروع مستقلة).
    MultiBranch_Independent = 3,

    // Several branches supplied by a central kitchen or warehouse (مطبخ مركزي).
    MultiBranch_CentralKitchen = 4,
}

public static class OperatingModes
{
    public static bool IsMultiBranch(this SystemOperatingMode mode) =>
        mode is SystemOperatingMode.MultiBranch_Independent or SystemOperatingMode.MultiBranch_CentralKitchen;

    // Inventory locations beyond the one implicit store.
    public static bool HasLocations(this SystemOperatingMode mode) => mode != SystemOperatingMode.SingleBranch_OpenSpace;
}

public enum BranchType
{
    Restaurant = 1,
    CentralKitchen = 2,
    CentralWarehouse = 3,
}

// A branch of the company (فرع): a restaurant, or the central kitchen or warehouse that supplies
// them. The first, made by the migration, is every record's until there are others, and is never
// taken out of use.
public sealed class Branch : AggregateRoot
{
    public const int MaxName = 100;

    public static readonly Guid DefaultId = new("b2a40000-0000-4000-8000-000000000001");

    private Branch() { }

    public Branch(Guid id, string name, string? nameAr, BranchType type, bool isActive = true)
    {
        Id = id;
        Change(name, nameAr, type, isActive);
    }

    public string Name { get; private set; } = string.Empty;
    public string? NameAr { get; private set; }
    public BranchType Type { get; private set; } = BranchType.Restaurant;
    public bool IsActive { get; private set; } = true;

    public bool IsDefault => Id == DefaultId;

    public void Change(string name, string? nameAr, BranchType type, bool isActive)
    {
        var trimmed = name?.Trim() ?? string.Empty;
        if (trimmed.Length is 0 or > MaxName)
            throw new DomainException($"Name the branch: {MaxName} characters at most. · اكتب اسم الفرع.");
        var arabic = string.IsNullOrWhiteSpace(nameAr) ? null : nameAr.Trim();
        if (arabic?.Length > MaxName)
            throw new DomainException($"Keep the Arabic name to {MaxName} characters.");
        if (!Enum.IsDefined(type))
            throw new DomainException("Choose what the branch is: a restaurant, a central kitchen or a central warehouse.");
        if (IsDefault && !isActive)
            throw new DomainException($"{trimmed} is the company's first branch, where every record goes until there are others: it stays in use.");
        Name = trimmed;
        NameAr = arabic;
        Type = type;
        IsActive = isActive;
    }
}

public enum LocationKind
{
    MainStore = 1,
    Kitchen = 2,
    Bar = 3,
    Other = 9,
}

// Where stock is kept inside a branch (موقع المخزون): its main store, the kitchen, the bar. Each
// branch has its main store, made with it; the first branch's is the one implicit store of an
// open-space shop.
public sealed class InventoryLocation : AggregateRoot
{
    public const int MaxName = 100;

    public static readonly Guid DefaultId = new("b2a40000-0000-4000-8000-000000000002");

    private InventoryLocation() { }

    public InventoryLocation(Guid id, Guid branchId, string name, string? nameAr, LocationKind kind, bool isActive = true)
    {
        Id = id;
        BranchId = branchId;
        Change(name, nameAr, kind, isActive);
    }

    public Guid BranchId { get; private set; }
    public string Name { get; private set; } = string.Empty;
    public string? NameAr { get; private set; }
    public LocationKind Kind { get; private set; } = LocationKind.Other;
    public bool IsActive { get; private set; } = true;

    public bool IsDefault => Id == DefaultId;

    // The kitchen stations it serves (الأقسام التي يخدمها): what the kitchen uses of their
    // materials (sales, waste, staff meals) is taken from here. One location a station, in a branch.
    public Guid[] StationIds { get; private set; } = [];

    public void Serve(IEnumerable<Guid> stationIds) => StationIds = stationIds.Distinct().ToArray();

    public void Change(string name, string? nameAr, LocationKind kind, bool isActive)
    {
        var trimmed = name?.Trim() ?? string.Empty;
        if (trimmed.Length is 0 or > MaxName)
            throw new DomainException($"Name the location: {MaxName} characters at most. · اكتب اسم الموقع.");
        var arabic = string.IsNullOrWhiteSpace(nameAr) ? null : nameAr.Trim();
        if (arabic?.Length > MaxName)
            throw new DomainException($"Keep the Arabic name to {MaxName} characters.");
        if (!Enum.IsDefined(kind))
            throw new DomainException("Choose what the location is: the main store, a kitchen, a bar or another.");
        if (IsDefault && (!isActive || kind != LocationKind.MainStore))
            throw new DomainException($"{trimmed} is the first branch's main store: it stays its main store, in use.");
        Name = trimmed;
        NameAr = arabic;
        Kind = kind;
        IsActive = isActive;
    }
}

// A record kept by a branch: its purchases, its safe, its Z reports, its sales, its stock
// movements, waste and counts. Given the branch it is entered in when it is saved, unless it was
// given one (a reversal keeps its original's).
public interface IBranchOwned
{
    Guid BranchId { get; }

    void AssignBranch(Guid branchId);
}

public interface IBranchRepository : IRepository<Branch>
{
    Task<IReadOnlyList<Branch>> GetAllAsync(CancellationToken cancellationToken = default);
}

public interface IInventoryLocationRepository : IRepository<InventoryLocation>
{
    Task<IReadOnlyList<InventoryLocation>> GetAllAsync(CancellationToken cancellationToken = default);
}
