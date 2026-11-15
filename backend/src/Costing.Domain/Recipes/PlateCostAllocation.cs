namespace Costing.Domain.Recipes;

// How a period's labor and overheads are shared over the plates sold in it, for the fully burdened
// plate cost (التكلفة الكلية للطبق):
//
//   ByQuantitySold        (بالتساوي حسب الكمية المباعة)   every plate carries the same:
//                          labor a plate    = labor pool ÷ plates sold
//                          overhead a plate = overhead pool ÷ plates sold
//   ByRevenueShare        (بنسبة المساهمة في الإيراد)     by what a plate sells for:
//                          a dish's share   = its price × its quantity ÷ the period's sales
//                          labor a plate    = labor pool × its share ÷ its quantity = labor pool × its price ÷ the sales
//                          (the same for the overheads)
//   ActivityBasedPrepTime (حسب وقت التحضير - ABC)         labor by the kitchen's time, the rest by the plate:
//                          labor a plate    = labor pool × its weighted minutes ÷ Σ (quantity × weighted minutes)
//                          overhead a plate = overhead pool ÷ plates sold
//
// Shared over what was sold, the pools are allocated whole: Σ (a plate's share × its quantity) is
// the pool. A dish not sold in the period is given the share a plate of it would have carried, at
// the same rates, so its burdened cost is known before it sells.
public enum OverheadAllocationMethod
{
    ByQuantitySold = 1,
    ByRevenueShare = 2,
    ActivityBasedPrepTime = 3,
}

// A dish as the period sold it: how many plates, what one sells for (null with no price), what the
// plates sold came to (its price × its quantity; its net sales when it has no price), and the
// kitchen's weighted minutes for one plate.
public sealed record PlateDriver(decimal QuantitySold, decimal? Price, decimal Revenue, decimal WeightedMinutes);

// The period's rates, each over what was sold: null when nothing was sold to share over.
public sealed record AllocationRates(
    OverheadAllocationMethod Method,
    decimal LaborPool,
    decimal OverheadPool,
    decimal PlatesSold,
    decimal Revenue,
    decimal WeightedMinutesSold,
    decimal? LaborPerPlate,
    decimal? LaborPerRevenue,
    decimal? LaborPerWeightedMinute,
    decimal? OverheadPerPlate,
    decimal? OverheadPerRevenue)
{
    // One plate's labor and overheads, at its price and its weighted minutes. Null where the
    // method cannot place it: nothing sold in the period, or no price to share revenue by.
    public (decimal? Labor, decimal? Overhead) For(decimal? price, decimal weightedMinutes) => Method switch
    {
        OverheadAllocationMethod.ByQuantitySold => (LaborPerPlate, OverheadPerPlate),
        OverheadAllocationMethod.ByRevenueShare => (price * LaborPerRevenue, price * OverheadPerRevenue),
        _ => (LaborPerWeightedMinute * weightedMinutes, OverheadPerPlate),
    };
}

public static class PlateCostAllocation
{
    public static AllocationRates Rates(
        OverheadAllocationMethod method, decimal laborPool, decimal overheadPool, IEnumerable<PlateDriver> dishes)
    {
        var sold = dishes.Where(d => d.QuantitySold > 0).ToList();
        var plates = sold.Sum(d => d.QuantitySold);
        var revenue = sold.Sum(d => d.Revenue);
        var minutes = sold.Sum(d => d.QuantitySold * d.WeightedMinutes);
        decimal? Over(decimal pool, decimal whole) => whole > 0 ? pool / whole : null;
        return new AllocationRates(
            method, laborPool, overheadPool, plates, revenue, minutes,
            Over(laborPool, plates), Over(laborPool, revenue), Over(laborPool, minutes),
            Over(overheadPool, plates), Over(overheadPool, revenue));
    }

    // The price that leaves the target net margin after the food, the labor and the overheads. By
    // quantity or by time, a plate's labor and overheads do not move with its price:
    //   price = (food + labor + overheads) ÷ (1 − target)
    // By revenue share they do, at (pools ÷ sales) of every pound it sells for:
    //   price = food ÷ (1 − target − (labor pool + overhead pool) ÷ sales)
    // Null when no price reaches it: the pools take as much of each pound as the margin leaves.
    public static decimal? SuggestedPrice(AllocationRates rates, decimal foodCost, decimal weightedMinutes, decimal targetNetMarginPercent)
    {
        var target = targetNetMarginPercent / 100;
        if (target >= 1)
            return null;
        if (rates.Method == OverheadAllocationMethod.ByRevenueShare)
        {
            if (rates.LaborPerRevenue is not { } labor || rates.OverheadPerRevenue is not { } overhead)
                return null;
            var left = 1 - target - labor - overhead;
            return left > 0 ? foodCost / left : null;
        }

        var (perPlateLabor, perPlateOverhead) = rates.For(null, weightedMinutes);
        if (perPlateLabor is not { } l || perPlateOverhead is not { } o)
            return null;
        return (foodCost + l + o) / (1 - target);
    }
}
