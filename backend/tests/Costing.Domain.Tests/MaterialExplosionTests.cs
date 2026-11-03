using Costing.Domain.Production;
using Costing.Domain.RawMaterials;

namespace Costing.Domain.Tests;

// The bill of materials: a prep item broken into what was bought for it, as purchased, through any
// prep item inside it.
public class MaterialExplosionTests
{
    private static RawMaterial Bought(string name) => new(name, UnitOfMeasure.Gram);
    private static RawMaterial Prep(string name) => new(name, UnitOfMeasure.Gram, kind: MaterialKind.Prep);

    [Fact]
    public void A_prep_item_breaks_into_what_was_bought_its_yields_allowed_for()
    {
        var (tomatoes, garlic, flour) = (Bought("Tomatoes"), Bought("Garlic"), Bought("Flour"));
        // 1 kg of sauce: 900 g of tomatoes used at 90% (1 kg bought) and 50 g of garlic.
        var sauce = Prep("Pizza sauce");
        var sauceRecipe = new PrepRecipe(sauce, 1_000);
        sauceRecipe.Replace([(tomatoes, 900m, 90m), (garlic, 50m, null)]);
        // 2 kg of bases: 1.5 kg of flour and 500 g of the sauce.
        var bases = Prep("Pizza bases");
        var basesRecipe = new PrepRecipe(bases, 2_000);
        basesRecipe.Replace([(flour, 1_500m, null), (sauce, 500m, null)]);
        var explosion = new MaterialExplosion([sauceRecipe, basesRecipe]);

        Assert.Equal(new Dictionary<Guid, decimal> { [tomatoes.Id] = 1m, [garlic.Id] = 0.05m }, explosion.PerUnit(sauce.Id));
        // 100 g of bases: 75 g of flour, and 25 g of sauce, which is 25 g of tomatoes and 1.25 g of garlic.
        var hundred = explosion.Explode([new(bases.Id, 100m), new(flour.Id, 10m)]);
        Assert.Equal((85m, 25m, 1.25m), (hundred[flour.Id], hundred[tomatoes.Id], hundred[garlic.Id]));
        Assert.Equal(new Dictionary<Guid, decimal> { [garlic.Id] = 1m }, explosion.PerUnit(garlic.Id));

        // One level down, for making it; and the bases before the sauce they are made with.
        Assert.Equal([(flour.Id, 75m), (sauce.Id, 25m)], explosion.Ingredients(bases.Id, 100));
        Assert.Equal([bases.Id, sauce.Id], explosion.TopDown());
        Assert.True(explosion.IsMade(sauce.Id));
        Assert.False(explosion.IsMade(flour.Id));
    }

    [Fact]
    public void A_prep_item_with_no_recipe_or_made_with_itself_stays_as_itself()
    {
        var (flour, unwritten) = (Bought("Flour"), Prep("Stock, not written yet"));
        // Never saved so, but guarded against: a dough made with a starter made with the dough.
        var (dough, starter) = (Prep("Mother dough"), Prep("Starter"));
        var doughRecipe = new PrepRecipe(dough, 1_000);
        doughRecipe.Replace([(flour, 500m, null), (starter, 500m, null)]);
        var starterRecipe = new PrepRecipe(starter, 1_000);
        starterRecipe.Replace([(dough, 1_000m, null)]);
        var explosion = new MaterialExplosion([doughRecipe, starterRecipe]);

        Assert.Equal(new Dictionary<Guid, decimal> { [unwritten.Id] = 1m }, explosion.PerUnit(unwritten.Id));
        var perGram = explosion.PerUnit(dough.Id);
        Assert.Equal((0.5m, 0.5m), (perGram[flour.Id], perGram[dough.Id]));
        Assert.Equal(2, explosion.TopDown().Count);
    }
}
