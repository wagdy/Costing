using Costing.Domain.Common;

namespace Costing.Domain.Waste;

// Breakage (كسر) in Costing → Waste: plates, glasses and other consumables broken on a business
// day, at their cost, the second kind of waste beside spoiled stock. Not stock: nothing comes off
// the shelves; the cost is the day's. Entered on Waste. AssetItemId and AssetTransactionId name an
// asset system's own record of it, when one sends it; none for one entered here. What broke is
// said by its name as it was, and who broke it.
public sealed class BreakageEntry : AggregateRoot
{
    public const int MaxDescriptionLength = 150;
    public const int MaxNotesLength = 300;

    private BreakageEntry() { }

    public BreakageEntry(
        Guid id,
        DateOnly businessDate,
        Guid? assetItemId,
        Guid? assetTransactionId,
        string description,
        int quantity,
        decimal? unitCost,
        Guid? employeeId,
        string? notes,
        string recordedBy)
    {
        var name = description?.Trim() ?? string.Empty;
        if (name.Length == 0)
            throw new DomainException("Say what broke.");
        if (quantity < 1)
            throw new DomainException("Say how many broke.");
        if (unitCost < 0)
            throw new DomainException("A piece's cost is zero or more.");
        var trimmed = string.IsNullOrWhiteSpace(notes) ? null : notes.Trim();
        Id = id;
        BusinessDate = businessDate;
        AssetItemId = assetItemId;
        AssetTransactionId = assetTransactionId;
        Description = name[..Math.Min(name.Length, MaxDescriptionLength)];
        Quantity = quantity;
        UnitCost = unitCost;
        Cost = Math.Round((unitCost ?? 0) * quantity, 2, MidpointRounding.AwayFromZero);
        EmployeeId = employeeId;
        Notes = trimmed?[..Math.Min(trimmed.Length, MaxNotesLength)];
        RecordedBy = recordedBy;
        RecordedAtUtc = DateTime.UtcNow;
    }

    public DateOnly BusinessDate { get; private set; }
    public Guid? AssetItemId { get; private set; }
    public Guid? AssetTransactionId { get; private set; }
    public string Description { get; private set; } = string.Empty;
    public int Quantity { get; private set; }

    // None when the asset's cost was not known: the entry costs nothing, and says so.
    public decimal? UnitCost { get; private set; }
    public decimal Cost { get; private set; }

    // Who held it, when someone did.
    public Guid? EmployeeId { get; private set; }

    public string? Notes { get; private set; }
    public string RecordedBy { get; private set; } = string.Empty;
    public DateTime RecordedAtUtc { get; private set; }

    public DateTime? VoidedAtUtc { get; private set; }
    public string? VoidedBy { get; private set; }
    public bool IsVoided => VoidedAtUtc is not null;

    public void Void(string voidedBy)
    {
        if (IsVoided)
            throw new DomainException("This breakage has already been voided.");
        VoidedAtUtc = DateTime.UtcNow;
        VoidedBy = voidedBy;
    }
}
