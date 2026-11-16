using Costing.Domain.Common;
using Costing.Domain.Production;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;

namespace Costing.Domain.Tests;

// Swapping one item for another on a dish's recipe and a prep item's batch, and the costs a swap
// would leave, through the prep items.
public class IngredientSwapTests
{
    private static RawMaterial Bought(string name, decimal? perKg, decimal yield = 100)
    {
        var material = new RawMaterial(name, UnitOfMeasure.Gram);
        if (perKg is { } price)
            material.SetCost(price);
        material.SetDefaultYield(yield);
        return material;
    }

    [Fact]
    public void A_dish_takes_the_new_item_at_the_ratio_and_its_own_yield()
    {
        var brandA = Bought("Mozzarella A", 300, yield: 95);
        var brandB = Bought("Mozzarella B", 260, yield: 90);
        var basil = Bought("Basil", 400);
        var pizza = new Recipe("Margherita", null, 150, null);
        pizza.SetIngredient(brandA, 100);
        pizza.SetIngredient(basil, 5);

        Assert.Equal(80m, pizza.SwapIngredient(brandA, brandB, 0.8m));
        Assert.Equal(
            [(basil.Id, 5m, 100m), (brandB.Id, 80m, 90m)],
            pizza.Ingredients.Select(i => (i.RawMaterialId, i.Quantity, i.YieldPercent)).OrderBy(i => i.Quantity));

        // Not on it: nothing changes.
        Assert.Null(pizza.SwapIngredient(brandA, brandB, 1));
        Assert.Equal(2, pizza.Ingredients.Count);
    }

    [Fact]
    public void A_new_item_already_on_the_recipe_takes_the_quantity_added_to_its_own()
    {
        var brandA = Bought("Mozzarella A", 300);
        var brandB = Bought("Mozzarella B", 260, yield: 90);
        var pizza = new Recipe("Four cheese", null, 200, null);
        pizza.SetIngredient(brandA, 60);
        pizza.SetIngredient(brandB, 40, 95);

        Assert.Equal(60m, pizza.SwapIngredient(brandA, brandB, 1));
        var line = Assert.Single(pizza.Ingredients);
        Assert.Equal((brandB.Id, 100m, 95m), (line.RawMaterialId, line.Quantity, line.YieldPercent));
    }

    [Fact]
    public void A_swap_is_refused_for_the_same_item_a_ratio_out_of_range_or_one_that_rounds_to_nothing()
    {
        var salt = Bought("Salt", 10);
        var seaSalt = Bought("Sea salt", 40);
        var soup = new Recipe("Soup", null, 50, null);
        soup.SetIngredient(salt, 2);

        Assert.Throws<DomainException>(() => soup.SwapIngredient(salt, salt, 1));
        Assert.Throws<DomainException>(() => soup.SwapIngredient(salt, seaSalt, 0));
        Assert.Throws<DomainException>(() => soup.SwapIngredient(salt, seaSalt, 1001));
        Assert.Throws<DomainException>(() => soup.SwapIngredient(salt, seaSalt, 0.0001m));
        Assert.Equal((salt.Id, 2m), (soup.Ingredients.Single().RawMaterialId, soup.Ingredients.Single().Quantity));
    }

    [Fact]
    public void A_prep_item_swaps_the_same_way_and_is_never_made_from_itself()
    {
        var paprika = Bought("Paprika", 200);
        var smoked = Bought("Smoked paprika", 320, yield: 98);
        var rub = new RawMaterial("Spice rub", UnitOfMeasure.Gram, kind: MaterialKind.Prep);
        var batch = new PrepRecipe(rub, 1000);
        batch.Replace([(paprika, 400m, null), (smoked, 100m, 100m)]);

        Assert.Throws<DomainException>(() => batch.SwapIngredient(paprika, rub, 1));
        Assert.Equal(300m, batch.SwapIngredient(paprika, smoked, 0.75m));
        var line = Assert.Single(batch.Ingredients);
        Assert.Equal((smoked.Id, 400m, 100m), (line.RawMaterialId, line.Quantity, line.YieldPercent));
        Assert.Null(batch.SwapIngredient(paprika, smoked, 1));
    }

    [Fact]
    public void The_costs_a_swap_would_leave_carry_through_the_prep_items_made_and_not()
    {
        // A spice rub made at 260 a kg from 500 g of paprika (200 a kg) a kg: its batch is 100.
        // Swapped for smoked paprika (320 a kg), the batch is 160: the rub moves to 260 × 160 ÷ 100.
        var paprika = Bought("Paprika", 200);
        var smoked = Bought("Smoked paprika", 320);
        var rub = new RawMaterial("Spice rub", UnitOfMeasure.Gram, kind: MaterialKind.Prep);
        var rubNow = new PrepRecipe(rub, 1000);
        rubNow.Replace([(paprika, 500m, null)]);
        rub.ReceiveProduction(1000, Guid.NewGuid(), 260);
        // A glaze never made, of 100 g of paprika a kg: costed by its recipe, 20 a kg, then 32.
        var glaze = new RawMaterial("Glaze", UnitOfMeasure.Gram, kind: MaterialKind.Prep);
        var glazeNow = new PrepRecipe(glaze, 1000);
        glazeNow.Replace([(paprika, 100m, null)]);
        var materials = new[] { paprika, smoked, rub, glaze }.ToDictionary(m => m.Id);

        var rubSwapped = new PrepRecipe(rub, 1000);
        rubSwapped.Replace([(paprika, 500m, null)]);
        rubSwapped.SwapIngredient(paprika, smoked, 1);
        var glazeSwapped = new PrepRecipe(glaze, 1000);
        glazeSwapped.Replace([(paprika, 100m, null)]);
        glazeSwapped.SwapIngredient(paprika, smoked, 1);

        var actual = new RecipeCosts(materials, [rubNow, glazeNow]);
        var swapped = new RecipeCosts(materials, [rubSwapped, glazeSwapped], actual);
        Assert.Equal((0.26m, 0.416m), (actual.Of(rub.Id).PerUnit, swapped.Of(rub.Id).PerUnit));
        Assert.Equal((0.02m, 0.032m), (actual.Of(glaze.Id).PerUnit, swapped.Of(glaze.Id).PerUnit));
        Assert.True(swapped.Of(glaze.Id).ByRecipe);
        // Bought items are as they are.
        Assert.Equal(actual.Of(paprika.Id).PerUnit, swapped.Of(paprika.Id).PerUnit);
    }
}
