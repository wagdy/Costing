using Costing.Domain.Production;
using Costing.Domain.RawMaterials;

namespace Costing.Domain.Tests;

// What a recipe is costed from: each material's average cost, and a prep item never made yet by its
// own batch recipe today, its ingredients priced the same way.
public class RecipeCostsTests
{
    // Bought by the kg, at that price a kg.
    private static RawMaterial Bought(string name, decimal? perKg, UnitOfMeasure unit = UnitOfMeasure.Gram)
    {
        var material = new RawMaterial(name, unit);
        if (perKg is { } price)
            material.SetCost(price);
        return material;
    }

    private static (RawMaterial Item, PrepRecipe Recipe) Prep(string name, decimal batch, params (RawMaterial Material, decimal Quantity, decimal? Yield)[] lines)
    {
        var item = new RawMaterial(name, UnitOfMeasure.Gram, kind: MaterialKind.Prep);
        var recipe = new PrepRecipe(item, batch);
        recipe.Replace(lines);
        return (item, recipe);
    }

    private static RecipeCosts Costs(IEnumerable<RawMaterial> materials, params PrepRecipe[] recipes) =>
        new(materials.ToDictionary(m => m.Id), recipes);

    [Fact]
    public void A_bought_material_and_a_prep_item_made_already_are_at_their_average_cost()
    {
        var flour = Bought("Flour", 30);
        var (dough, recipe) = Prep("Dough", 1000, (flour, 600, null));
        dough.ReceiveProduction(1000, Guid.NewGuid(), 25);

        var costs = Costs([flour, dough], recipe);

        Assert.Equal(((decimal?)0.03m, false), (costs.Of(flour.Id).PerUnit, costs.Of(flour.Id).ByRecipe));
        Assert.Empty(costs.Of(flour.Id).Missing);
        Assert.Equal(((decimal?)0.025m, false), (costs.Of(dough.Id).PerUnit, costs.Of(dough.Id).ByRecipe));
        Assert.Empty(costs.Of(dough.Id).Missing);
    }

    [Fact]
    public void A_prep_item_never_made_or_made_at_nothing_is_costed_by_its_recipe_its_yields_lost()
    {
        var flour = Bought("Flour", 30);
        var butter = Bought("Butter", 200);
        // 2 kg a batch: 200 g of flour, and 200 g of butter at a 80% yield (250 g as bought).
        var (sauce, recipe) = Prep("White sauce", 2000, (flour, 200, null), (butter, 200, 80));

        var cost = Costs([flour, butter, sauce], recipe).Of(sauce.Id);
        Assert.Equal(((decimal?)((6m + 50m) / 2000), true), (cost.PerUnit, cost.ByRecipe));
        Assert.Empty(cost.Missing);

        // A batch costing nothing is no cost to go by either.
        sauce.ReceiveProduction(2000, Guid.NewGuid(), 0);
        Assert.Equal(0m, sauce.AverageCost);
        Assert.True(Costs([flour, butter, sauce], recipe).Of(sauce.Id).ByRecipe);
    }

    [Fact]
    public void One_made_with_another_never_made_is_costed_through_both_and_what_has_no_price_is_named_through_them()
    {
        var flour = Bought("Flour", 30);
        var cream = Bought("Cream", null, UnitOfMeasure.Millilitre);
        var (sauce, sauceRecipe) = Prep("White sauce", 1000, (flour, 500, null));
        var (alfredo, alfredoRecipe) = Prep("Alfredo base", 1100, (sauce, 1000, null), (cream, 100, null));
        var (bake, bakeRecipe) = Prep("Pasta bake", 500, (alfredo, 550, null));

        var costs = Costs([flour, cream, sauce, alfredo, bake], sauceRecipe, alfredoRecipe, bakeRecipe);

        // The sauce 15 a kg; the base 15 for its 1.1 kg, short of the cream; the bake from it.
        Assert.Equal(0.015m, costs.Of(sauce.Id).PerUnit);
        Assert.Equal(((decimal?)(15m / 1100), true), (costs.Of(alfredo.Id).PerUnit, costs.Of(alfredo.Id).ByRecipe));
        Assert.Equal(["Alfredo base: Cream"], costs.Of(alfredo.Id).Missing);
        Assert.Equal(["Pasta bake: Alfredo base: Cream"], costs.Of(bake.Id).Missing);
        Assert.Equal(550 * (15m / 1100) / 500, costs.Of(bake.Id).PerUnit);
        var (batchCost, priced, missing) = costs.Batch(alfredoRecipe);
        Assert.Equal((15m, true), (batchCost, priced));
        Assert.Equal(["Cream"], missing);
    }

    [Fact]
    public void One_with_no_ingredient_priced_or_no_recipe_has_no_price_and_is_named()
    {
        var cream = Bought("Cream", null, UnitOfMeasure.Millilitre);
        var (sauce, recipe) = Prep("Cream sauce", 1000, (cream, 900, null));
        var plain = new RawMaterial("Stock", UnitOfMeasure.Millilitre, kind: MaterialKind.Prep);

        var costs = Costs([cream, sauce, plain], recipe);

        Assert.Equal(((decimal?)null, false), (costs.Of(sauce.Id).PerUnit, costs.Of(sauce.Id).ByRecipe));
        Assert.Equal(["Cream sauce"], costs.Of(sauce.Id).Missing);
        Assert.Equal(((decimal?)null, false), (costs.Of(plain.Id).PerUnit, costs.Of(plain.Id).ByRecipe));
        Assert.Equal(["Stock"], costs.Of(plain.Id).Missing);
        Assert.Equal(RecipeCost.None, costs.Of(Guid.NewGuid()));
    }
}
