using Costing.Domain.Common;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;
using Costing.Domain.Stations;

namespace Costing.Domain.Tests;

// The kitchen and bar stations: named, a code in capitals, their own tolerance or the settings'; a
// material's waste held against its station unless another is named, a dish voided after the
// kitchen against the station that makes it, and a void of either kept where it was.
public class KitchenStationTests
{
    [Fact]
    public void A_station_is_named_coded_and_judged_by_its_own_tolerance_or_the_settings()
    {
        Assert.StartsWith("Name the station", Assert.Throws<DomainException>(() => new KitchenStation(Guid.NewGuid(), " ", null, null, 1, null)).Message);
        Assert.StartsWith("A station's tolerance is a percentage above 0",
            Assert.Throws<DomainException>(() => new KitchenStation(Guid.NewGuid(), "Bar", null, null, 1, 0)).Message);
        Assert.Throws<DomainException>(() => new KitchenStation(Guid.NewGuid(), "Bar", null, new string('B', 21), 1, null));

        var bar = new KitchenStation(Guid.NewGuid(), " Bar & Barista ", " البار ", " bar ", 5, 2.555m);
        Assert.Equal(("Bar & Barista", "البار", "BAR", 2.56m, true, false), (bar.Name, bar.NameAr, bar.Code, bar.TargetVarianceTolerancePercent, bar.IsActive, bar.IsShared));
        Assert.Equal(2.56m, bar.ToleranceOr(5));
        bar.Change("Bar", null, "shared", 5, null, false);
        Assert.Equal((5m, true, false), (bar.ToleranceOr(5), bar.IsShared, bar.IsActive));
    }

    [Fact]
    public void Waste_is_held_against_the_materials_station_unless_another_is_named_and_a_void_keeps_it()
    {
        var (cold, hot) = (Guid.NewGuid(), Guid.NewGuid());
        var lettuce = new RawMaterial("Lettuce", UnitOfMeasure.Gram);
        lettuce.ReceivePurchase(1_000, Guid.NewGuid(), 30);
        lettuce.AssignStation(cold);

        Assert.Equal(cold, lettuce.RecordSpoilage(100, Guid.NewGuid(), "Wilted", "Omar").ResponsibleStationId);
        var spoiled = lettuce.RecordSpoilage(100, Guid.NewGuid(), "Left out", "Omar", hot);
        Assert.Equal(hot, spoiled.ResponsibleStationId);
        Assert.Equal(hot, lettuce.Reverse(spoiled, "Boss").ResponsibleStationId);
        // A dish voided after the kitchen: its station's, else the material's.
        Assert.Equal(hot, lettuce.RecordWaste(50, Guid.NewGuid(), hot).ResponsibleStationId);
        Assert.Equal(cold, lettuce.RecordWaste(50, Guid.NewGuid()).ResponsibleStationId);
        // A sale is no one's waste.
        Assert.Null(lettuce.RecordSale(50, Guid.NewGuid()).ResponsibleStationId);
    }

    [Fact]
    public void A_sold_items_station_is_its_sizes_recipes_else_its_items()
    {
        var (grill, pizza) = (Guid.NewGuid(), Guid.NewGuid());
        var item = new Recipe(RecipeTarget.ForMenuItem(1));
        item.AssignStation(grill);
        var large = new Recipe(RecipeTarget.ForVariant(1, 2));
        large.AssignStation(pizza);
        Recipe[] recipes = [item, large];

        Assert.Equal(pizza, StockRequirements.StationOf(new SoldItem(1, 2, [], 1), recipes));
        Assert.Equal(grill, StockRequirements.StationOf(new SoldItem(1, 3, [], 1), recipes));
        Assert.Equal(grill, StockRequirements.StationOf(new SoldItem(1, null, [], 1), recipes));
        Assert.Null(StockRequirements.StationOf(new SoldItem(9, null, [], 1), recipes));
    }
}
