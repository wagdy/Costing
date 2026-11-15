using Costing.Domain.Common;
using Costing.Domain.Recipes;

namespace Costing.Domain.Tests;

// The fully burdened plate cost's sharing: labor and overheads over the plates sold, by quantity, by
// revenue or by the kitchen's time, and the price that leaves the target net margin.
public class PlateCostTests
{
    // 100 burgers at 120 (10 weighted minutes), 50 steaks at 300 (20), no lemonade yet (30, 2).
    private static readonly PlateDriver Burger = new(100, 120, 12_000, 10);
    private static readonly PlateDriver Steak = new(50, 300, 15_000, 20);
    private static readonly PlateDriver Lemonade = new(0, 30, 0, 2);

    private static AllocationRates Rates(OverheadAllocationMethod method) =>
        PlateCostAllocation.Rates(method, laborPool: 12_000, overheadPool: 6_000, [Burger, Steak, Lemonade]);

    private static decimal Allocated(AllocationRates rates, Func<(decimal? Labor, decimal? Overhead), decimal?> part) =>
        new[] { Burger, Steak }.Sum(d => part(rates.For(d.Price, d.WeightedMinutes))!.Value * d.QuantitySold);

    [Fact]
    public void Equal_per_plate_gives_every_plate_sold_the_same_share()
    {
        var rates = Rates(OverheadAllocationMethod.ByQuantitySold);

        Assert.Equal((150m, 80m, 40m), (rates.PlatesSold, rates.LaborPerPlate!.Value, rates.OverheadPerPlate!.Value));
        Assert.Equal((80m, 40m), Unwrap(rates.For(300, 20)));
        Assert.Equal(12_000m, Allocated(rates, p => p.Labor));
        Assert.Equal(6_000m, Allocated(rates, p => p.Overhead));
    }

    [Fact]
    public void By_revenue_a_plate_carries_its_price_s_share_of_the_sales()
    {
        var rates = Rates(OverheadAllocationMethod.ByRevenueShare);

        // 27,000 of sales: a burger is 120 of them, a steak 300.
        Assert.Equal(27_000m, rates.Revenue);
        var (burgerLabor, burgerOverhead) = Unwrap(rates.For(120, 10));
        var (steakLabor, _) = Unwrap(rates.For(300, 20));
        Assert.Equal((53.33m, 26.67m, 133.33m), (Math.Round(burgerLabor, 2), Math.Round(burgerOverhead, 2), Math.Round(steakLabor, 2)));
        Assert.Equal(12_000m, Math.Round(Allocated(rates, p => p.Labor), 6));
        Assert.Equal(6_000m, Math.Round(Allocated(rates, p => p.Overhead), 6));
        // No price, nothing to share revenue by.
        Assert.Equal((null, null), rates.For(null, 10));
    }

    [Fact]
    public void Activity_based_puts_the_labor_where_the_kitchen_s_minutes_go_and_the_rest_by_the_plate()
    {
        var rates = Rates(OverheadAllocationMethod.ActivityBasedPrepTime);

        // 100 × 10 + 50 × 20 = 2,000 weighted minutes sold: 6 of labor a minute.
        Assert.Equal((2_000m, 6m), (rates.WeightedMinutesSold, rates.LaborPerWeightedMinute!.Value));
        Assert.Equal((60m, 40m), Unwrap(rates.For(120, 10)));
        Assert.Equal((120m, 40m), Unwrap(rates.For(300, 20)));
        Assert.Equal(12_000m, Allocated(rates, p => p.Labor));
        Assert.Equal(6_000m, Allocated(rates, p => p.Overhead));
    }

    [Fact]
    public void A_dish_not_sold_is_given_what_a_plate_of_it_would_carry()
    {
        var rates = Rates(OverheadAllocationMethod.ActivityBasedPrepTime);
        Assert.Equal((12m, 40m), Unwrap(rates.For(Lemonade.Price, Lemonade.WeightedMinutes)));

        // Nothing sold at all: nothing to share over.
        var none = PlateCostAllocation.Rates(OverheadAllocationMethod.ByQuantitySold, 12_000, 6_000, [Lemonade]);
        Assert.Equal((null, null), none.For(30, 2));
    }

    [Fact]
    public void The_suggested_price_leaves_the_target_net_margin_after_everything()
    {
        // By the plate: (40 food + 80 labor + 40 overheads) ÷ (1 − 15%).
        var byPlate = PlateCostAllocation.SuggestedPrice(Rates(OverheadAllocationMethod.ByQuantitySold), 40, 10, 15)!.Value;
        Assert.Equal(188.24m, Math.Round(byPlate, 2));

        // By revenue the shares grow with the price: 40 ÷ (1 − 15% − 18,000 ÷ 27,000).
        var rates = Rates(OverheadAllocationMethod.ByRevenueShare);
        var byRevenue = PlateCostAllocation.SuggestedPrice(rates, 40, 10, 15)!.Value;
        Assert.Equal(218.18m, Math.Round(byRevenue, 2));
        var (labor, overhead) = Unwrap(rates.For(byRevenue, 10));
        Assert.Equal(15m, Math.Round((byRevenue - 40 - labor - overhead) / byRevenue * 100, 6));

        // The pools take two thirds of every pound: no price leaves 40%.
        Assert.Null(PlateCostAllocation.SuggestedPrice(rates, 40, 10, 40));
    }

    [Fact]
    public void A_plate_s_minutes_are_the_ordinary_ten_until_set_and_weighed_by_how_hard_they_are()
    {
        var recipe = new Recipe("Mixed grill", null, 250, null);
        Assert.Equal((10m, 1m, 10m), (recipe.PrepTimeMinutes!.Value, recipe.ComplexityWeight, recipe.Activity.WeightedMinutes));

        recipe.SetActivity(new PlateActivity(18, 1.5m));
        Assert.Equal(27m, recipe.Activity.WeightedMinutes);
        recipe.SetActivity(new PlateActivity(null, 1));
        Assert.Equal((null, 10m), (recipe.PrepTimeMinutes, recipe.Activity.Minutes));

        Assert.Throws<DomainException>(() => recipe.SetActivity(new PlateActivity(-1, 1)));
        Assert.Throws<DomainException>(() => recipe.SetActivity(new PlateActivity(1_441, 1)));
        Assert.Throws<DomainException>(() => recipe.SetActivity(new PlateActivity(10, 0)));
        Assert.Equal(10m, recipe.Activity.WeightedMinutes);
    }

    private static (decimal Labor, decimal Overhead) Unwrap((decimal? Labor, decimal? Overhead) share) => (share.Labor!.Value, share.Overhead!.Value);
}
