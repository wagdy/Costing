using Costing.Domain.Common;

namespace Costing.Domain.Stock;

// A material's cost basis in one branch (المتوسط المرجح للفرع): the moving average of what the
// branch bought and made, so each branch is costed by its own prices. Its stock is the sum of its
// locations' (the ledger's entries, never a figure of its own that could drift). With one branch
// it is the company's average, kept the same; with several, each branch's moves on its own.
public sealed class MaterialBranchStock
{
    private MaterialBranchStock() { }

    public MaterialBranchStock(Guid rawMaterialId, Guid branchId, decimal? averageCost)
    {
        Id = Guid.NewGuid();
        RawMaterialId = rawMaterialId;
        BranchId = branchId;
        AverageCost = averageCost;
    }

    public Guid Id { get; private set; }
    public Guid RawMaterialId { get; private set; }
    public Guid BranchId { get; private set; }
    public decimal? AverageCost { get; private set; }

    public void Mirror(decimal? companyAverage) => AverageCost = companyAverage;

    // A delivery or a batch in: weighted by quantity against what the branch has on its shelves
    // (stock below zero counts as none), as the company's average is.
    public void AverageWith(decimal onHand, decimal quantity, decimal unitCost) =>
        AverageCost = MovingAverage.With(AverageCost, onHand, quantity, unitCost);

    // One taken back out (a voided delivery or batch), as far as the stock left can carry it.
    public void UnaverageWith(decimal onHand, decimal quantity, decimal? unitCost) =>
        AverageCost = MovingAverage.Without(AverageCost, onHand, quantity, unitCost);

    // Its first cost, from an opening count, when it has none.
    public void Open(decimal? unitCost)
    {
        if ((AverageCost ?? 0) == 0 && unitCost is { } cost and >= 0)
            AverageCost = cost;
    }
}

// The moving average's arithmetic: the company's (RawMaterial) and each branch's alike.
public static class MovingAverage
{
    public static decimal With(decimal? average, decimal onHand, decimal quantity, decimal unitCost)
    {
        var onShelf = Math.Max(onHand, 0);
        return average is { } current && onShelf > 0 ? (onShelf * current + quantity * unitCost) / (onShelf + quantity) : unitCost;
    }

    public static decimal? Without(decimal? average, decimal onHand, decimal quantity, decimal? unitCost)
    {
        if (average is not { } current || unitCost is not { } cost)
            return average;
        var left = onHand - quantity;
        if (left <= 0)
            return average;
        var value = Math.Max(onHand, 0) * current - quantity * cost;
        return value >= 0 ? value / left : average;
    }
}

public interface IMaterialBranchStockRepository
{
    Task<MaterialBranchStock?> GetAsync(Guid rawMaterialId, Guid branchId, CancellationToken cancellationToken = default);

    void Add(MaterialBranchStock stock);
}
