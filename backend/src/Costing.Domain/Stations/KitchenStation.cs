using Costing.Domain.Common;

namespace Costing.Domain.Stations;

// A kitchen or bar station (قسم التشغيل): the grill, the pizza oven, the bar. Each material and prep
// item is kept by one, and its use is held against it; each dish is made at one. Its variance is
// judged by its own tolerance when it has one (a bar's is tighter than a bakery's), the costing
// settings' otherwise. Unassigned materials fall to the shared station (SharedCode), or to a shared
// group of their own when there is none.
public sealed class KitchenStation : AggregateRoot
{
    public const int MaxName = 100;
    public const int MaxCode = 20;
    public const string SharedCode = "SHARED";
    public const string SharedName = "Shared / General";
    public const string SharedNameAr = "خامات مشتركة";

    private KitchenStation() { }

    public KitchenStation(Guid id, string name, string? nameAr, string? code, int displayOrder, decimal? tolerancePercent, bool isActive = true)
    {
        Id = id;
        Change(name, nameAr, code, displayOrder, tolerancePercent, isActive);
    }

    public string Name { get; private set; } = string.Empty;
    public string? NameAr { get; private set; }

    // A short code for sheets and labels (GRILL, BAR); unique when given.
    public string? Code { get; private set; }

    public int DisplayOrder { get; private set; }

    // Its own variance tolerance, % of theoretical (null: the costing settings').
    public decimal? TargetVarianceTolerancePercent { get; private set; }

    // Kept off the pickers when not in use; its history stays.
    public bool IsActive { get; private set; } = true;

    public bool IsShared => Code == SharedCode;

    public decimal ToleranceOr(decimal fallback) => TargetVarianceTolerancePercent ?? fallback;

    public void Change(string name, string? nameAr, string? code, int displayOrder, decimal? tolerancePercent, bool isActive)
    {
        var cleaned = Clean(name) ?? throw new DomainException("Name the station. · اكتب اسم القسم.");
        if (cleaned.Length > MaxName || Clean(nameAr)?.Length > MaxName)
            throw new DomainException($"Keep the station's name under {MaxName} characters.");
        var shortCode = Clean(code)?.ToUpperInvariant();
        if (shortCode?.Length > MaxCode)
            throw new DomainException($"Keep the station's code under {MaxCode} characters.");
        if (tolerancePercent is { } t && (t <= 0 || t > 100))
            throw new DomainException("A station's tolerance is a percentage above 0, up to 100. · نسبة السماح أكبر من صفر حتى 100.");
        if (displayOrder < 0)
            throw new DomainException("The display order is 0 or more.");
        Name = cleaned;
        NameAr = Clean(nameAr);
        Code = shortCode;
        DisplayOrder = displayOrder;
        TargetVarianceTolerancePercent = tolerancePercent is { } p ? Math.Round(p, 2, MidpointRounding.AwayFromZero) : null;
        IsActive = isActive;
    }

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}

public interface IKitchenStationRepository : IRepository<KitchenStation>
{
    Task<IReadOnlyList<KitchenStation>> GetAllAsync(CancellationToken cancellationToken = default);

    // Taken away: the materials, prep items and dishes kept by it, and the waste held against it, fall
    // back to the shared station.
    void Remove(KitchenStation station);
}
