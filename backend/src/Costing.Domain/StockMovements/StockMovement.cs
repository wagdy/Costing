using Costing.Domain.Common;
using Costing.Domain.Company;

namespace Costing.Domain.StockMovements;

// One entry in the stock ledger. Append-only: a mistake is corrected by a new movement, never
// by editing an old one, so a material's QuantityOnHand always equals the sum of its
// movements and can be rebuilt from them.
public sealed class StockMovement : AggregateRoot, IBranchOwned
{
    // The branch that keeps it (IBranchOwned): given when it is saved, or kept from its original.
    public Guid BranchId { get; private set; }

    public void AssignBranch(Guid branchId) => BranchId = branchId;

    // Where in its branch the stock moved (موقع المخزون): given by what moved it (the receiving
    // location of an invoice, a count's, a transfer's), or, left empty, routed as it is saved (the
    // location serving the material's station for what the kitchen uses, the branch's main store
    // otherwise). An open-space shop's every entry is its one Main Store's.
    public Guid LocationId { get; private set; }

    public void AssignLocation(Guid locationId) => LocationId = locationId;

    private StockMovement() { }

    // Internal: entries are created only by RawMaterial, together with the balance change
    // they explain.
    internal StockMovement(
        Guid rawMaterialId, decimal quantity, StockMovementReason reason, Guid sourceId, decimal? unitCost,
        string? note = null, string? recordedBy = null, Guid? reversalOf = null, Guid? responsibleStationId = null)
    {
        ResponsibleStationId = responsibleStationId;
        RawMaterialId = rawMaterialId;
        Quantity = quantity;
        Reason = reason;
        SourceId = sourceId;
        UnitCost = unitCost;
        Note = note;
        RecordedBy = recordedBy;
        ReversalOf = reversalOf;
        OccurredAtUtc = DateTime.UtcNow;
    }

    public Guid RawMaterialId { get; private set; }

    // Signed: negative for stock out, positive for stock in.
    public decimal Quantity { get; private set; }

    public StockMovementReason Reason { get; private set; }

    // What caused it: the order item for a sale, waste or void return; the purchase or stock
    // count otherwise. (SourceId, RawMaterialId, Reason, ReversalOf) is unique, which is what
    // makes handling the same event twice harmless.
    public Guid SourceId { get; private set; }

    // For an entry that undoes another, its Id: a voided purchase, waste entry or stock count.
    // Same source and reason, the opposite quantity at the same unit cost, so every report that
    // adds a reason up nets the two from the day of the void on. The original stays as it was.
    public Guid? ReversalOf { get; private set; }

    public bool IsReversal => ReversalOf is not null;

    public DateTime OccurredAtUtc { get; private set; }

    // The cost of one unit (gram, millilitre, piece) at that moment: the price paid on a purchase,
    // the average cost otherwise. Null while the material had no price. Quantity × UnitCost is
    // what the movement was worth, so a month's food cost is the sum of its sales' worth.
    public decimal? UnitCost { get; private set; }

    // What one unit cost the company (التكلفة على الشركة), where its branch's cost says otherwise: a
    // branch that bought from the central kitchen at a markup keeps the goods at the price it paid
    // (UnitCost), the company at what the kitchen paid for them. Null: the same as UnitCost, as for
    // every entry of a company with one branch, and most of several. Given as it is saved
    // (StockLedgerInterceptor), the original's on a reversal; the consolidated P&L reads it.
    public decimal? CompanyUnitCost { get; private set; }

    public void CostToCompany(decimal? unitCost) => CompanyUnitCost = unitCost is { } cost && cost != UnitCost ? cost : null;

    // For an entry made by hand (spoilage): why, and who recorded it. Null for the rest, whose
    // SourceId already says.
    public string? Note { get; private set; }
    public string? RecordedBy { get; private set; }

    // For waste (spoilage logged, a dish voided after the kitchen made it): the kitchen or bar
    // station held to account for it, the material's own unless another was named. Null: the
    // material's station, as it is now.
    public Guid? ResponsibleStationId { get; private set; }
}
