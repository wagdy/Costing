using System.Globalization;
using Costing.Domain.Common;
using Costing.Domain.Company;
using Costing.Domain.RawMaterials;
using Costing.Domain.StockMovements;

namespace Costing.Domain.Stock;

public enum InternalTransferStatus
{
    Posted = 1,
    Voided = 2,
}

// An internal transfer (تحويل داخلي): stock moved from one location of a branch to another (the
// main store to the kitchen, the kitchen to the bar), posted as it is made. Each line at the
// branch's average cost then: nothing bought, sold or spent, so no cost of the period, only where
// the stock is. Numbered TR-2026-0001 by the year it is made in. Voided, both sides go back.
public sealed class InternalTransfer : AggregateRoot, IBranchOwned
{
    public const int MaxNotes = 500;
    public const int MaxLines = 200;

    private readonly List<InternalTransferLine> _lines = [];

    private InternalTransfer() { }

    public Guid BranchId { get; private set; }

    public void AssignBranch(Guid branchId) => BranchId = branchId;

    public string Number { get; private set; } = string.Empty;
    public DateOnly TransferDate { get; private set; }
    public Guid FromLocationId { get; private set; }
    public Guid ToLocationId { get; private set; }
    public InternalTransferStatus Status { get; private set; } = InternalTransferStatus.Posted;
    public string? Notes { get; private set; }
    public string CreatedBy { get; private set; } = string.Empty;
    public string? CreatedByUserId { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime? VoidedAtUtc { get; private set; }
    public string? VoidedBy { get; private set; }
    public IReadOnlyList<InternalTransferLine> Lines => _lines;
    public decimal TotalCost => _lines.Sum(l => l.LineTotalCost);

    public static string NumberFor(int year, int sequence) => string.Create(CultureInfo.InvariantCulture, $"TR-{year}-{sequence:0000}");

    // Posted as it is made: each line moved out of `from` and into `to`, both in the branch; what
    // `from` has on its shelves (onHand) is enough for every line. Returns the entries to add.
    public static (InternalTransfer Transfer, IReadOnlyList<StockMovement> Movements) Post(
        Guid id, string number, Guid branchId, DateOnly date, InventoryLocation from, InventoryLocation to,
        IReadOnlyList<(RawMaterial Material, decimal Quantity)> lines, IReadOnlyDictionary<Guid, decimal> onHand, string? notes, string by, string? byUserId)
    {
        if (from.Id == to.Id)
            throw new DomainException("Move it from one location to another: the two are the same. · اختر موقعين مختلفين.");
        if (from.BranchId != branchId || to.BranchId != branchId)
            throw new DomainException("Both locations are the branch's own: a transfer moves stock inside one branch. · التحويل داخل الفرع نفسه.");
        if (!from.IsActive || !to.IsActive)
            throw new DomainException($"{(!from.IsActive ? from.Name : to.Name)} is not in use: choose a location in use.");
        if (lines.Count == 0)
            throw new DomainException("Add at least one material to move. · أضف خامة واحدة على الأقل.");
        if (lines.Count > MaxLines)
            throw new DomainException($"A transfer moves {MaxLines} materials at most.");
        if (lines.GroupBy(l => l.Material.Id).FirstOrDefault(g => g.Count() > 1) is { } twice)
            throw new DomainException($"{twice.First().Material.Name} is on the transfer twice: put it on one line.");
        var said = string.IsNullOrWhiteSpace(notes) ? null : notes.Trim();
        if (said?.Length > MaxNotes)
            throw new DomainException($"Keep the notes to {MaxNotes} characters.");
        foreach (var (material, quantity) in lines)
        {
            if (quantity <= 0)
                throw new DomainException($"{material.Name}: move more than nothing.");
            var there = onHand.GetValueOrDefault(material.Id);
            if (quantity > there)
                throw new DomainException(
                    $"{from.Name} has {there.ToString("0.###", CultureInfo.InvariantCulture)} {material.Unit} of {material.Name}: not enough to move "
                    + $"{quantity.ToString("0.###", CultureInfo.InvariantCulture)}. · الرصيد في الموقع لا يكفي.");
        }

        var transfer = new InternalTransfer
        {
            Id = id, Number = number, BranchId = branchId, TransferDate = date, FromLocationId = from.Id, ToLocationId = to.Id, Notes = said,
            CreatedBy = by, CreatedByUserId = byUserId, CreatedAtUtc = DateTime.UtcNow,
        };
        var movements = new List<StockMovement>();
        foreach (var (material, quantity) in lines)
        {
            var (taken, put) = material.Transfer(quantity, id, from.Id, to.Id, by);
            taken.AssignBranch(branchId);
            put.AssignBranch(branchId);
            movements.Add(taken);
            movements.Add(put);
            transfer._lines.Add(new InternalTransferLine(id, material.Id, quantity, material.Unit.ToString(), taken.UnitCost ?? 0));
        }
        return (transfer, movements);
    }

    // Voided: both sides of each line go back (the caller reverses its entries). Again: nothing.
    public void Void(string by)
    {
        if (Status == InternalTransferStatus.Voided)
            throw new DomainException("This transfer has already been voided. · تم إلغاء هذا التحويل بالفعل.");
        Status = InternalTransferStatus.Voided;
        VoidedAtUtc = DateTime.UtcNow;
        VoidedBy = by;
    }
}

// A material moved, in its own unit, at the branch's average cost then.
public sealed class InternalTransferLine
{
    private InternalTransferLine() { }

    internal InternalTransferLine(Guid transferId, Guid rawMaterialId, decimal quantity, string unit, decimal unitCostSnapshot)
    {
        Id = Guid.NewGuid();
        InternalTransferId = transferId;
        RawMaterialId = rawMaterialId;
        Quantity = quantity;
        Unit = unit;
        UnitCostSnapshot = unitCostSnapshot;
        LineTotalCost = Math.Round(quantity * unitCostSnapshot, 2, MidpointRounding.AwayFromZero);
    }

    public Guid Id { get; private set; }
    public Guid InternalTransferId { get; private set; }
    public Guid RawMaterialId { get; private set; }
    public decimal Quantity { get; private set; }
    public string Unit { get; private set; } = string.Empty;
    public decimal UnitCostSnapshot { get; private set; }
    public decimal LineTotalCost { get; private set; }
}

public interface IInternalTransferRepository : IRepository<InternalTransfer>
{
    Task<IReadOnlyList<InternalTransfer>> GetBetweenAsync(Guid branchId, DateOnly from, DateOnly to, CancellationToken cancellationToken = default);

    // How many the year has had: the next is one more.
    Task<int> CountInYearAsync(int year, CancellationToken cancellationToken = default);
}
