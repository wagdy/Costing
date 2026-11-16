using Costing.Domain.Common;
using Costing.Domain.EndOfDay;
using Costing.Domain.Menu;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;
using Costing.Domain.Sales;
using Costing.Domain.Treasury;

namespace Costing.Domain.Tests;

// Combo offers made of existing recipes, their stock through those recipes, and a day's discounts.
public class CombosAndDiscountsTests
{
    private static RawMaterial Bought(string name, decimal perKg)
    {
        var material = new RawMaterial(name, UnitOfMeasure.Gram);
        material.SetCost(perKg);
        return material;
    }

    [Fact]
    public void A_combo_is_two_dishes_at_least_each_once_at_a_price_of_its_own()
    {
        var (pizza, cola) = (Guid.NewGuid(), Guid.NewGuid());
        Assert.Throws<DomainException>(() => new ComboOffer(Guid.NewGuid(), 0, "Duo", null, 100, true, [new(pizza, 2)]));
        Assert.Throws<DomainException>(() => new ComboOffer(Guid.NewGuid(), 9001, "Duo", null, 0, true, [new(pizza, 2)]));
        Assert.Throws<DomainException>(() => new ComboOffer(Guid.NewGuid(), 9001, "Duo", null, 100, true, [new(pizza, 1)]));
        Assert.Throws<DomainException>(() => new ComboOffer(Guid.NewGuid(), 9001, "Duo", null, 100, true, [new(pizza, 1), new(pizza, 1)]));
        Assert.Throws<DomainException>(() => new ComboOffer(Guid.NewGuid(), 9001, "Duo", null, 100, true, [new(pizza, 100)]));
        Assert.Throws<DomainException>(() => new ComboOffer(Guid.NewGuid(), 9001, " ", null, 100, true, [new(pizza, 2)]));

        var duo = new ComboOffer(Guid.NewGuid(), 9001, " Pizza duo ", "ثنائي البيتزا", 199.999m, true, [new(pizza, 2), new(cola, 2)]);
        Assert.Equal(("Pizza duo", 200m, 2), (duo.Name, duo.SellingPrice, duo.Items.Count));
        var kept = duo.Items.Single(i => i.RecipeId == pizza).Id;

        // Changed: the pizza line kept, one cola now.
        duo.Change("Pizza duo", null, 180, false, [new(pizza, 2), new(cola, 1)]);
        Assert.Equal((kept, 1, false), (duo.Items.Single(i => i.RecipeId == pizza).Id, duo.Items.Single(i => i.RecipeId == cola).Quantity, duo.IsActive));
        duo.Delete("Omar");
        Assert.Throws<DomainException>(() => duo.Change("Pizza duo", null, 180, true, [new(pizza, 2)]));
    }

    [Fact]
    public void A_combo_on_the_menu_is_its_name_price_and_availability_with_no_sizes_or_add_ons()
    {
        var combo = new ComboOffer(Guid.NewGuid(), 9001, "Pizza duo", "ثنائي", 200, false, [new(Guid.NewGuid(), 2)]);
        var item = new MenuItem(9001, "Old name", null, "Mains", 50, false);
        item.SetVariants([("Large", null, 60)]);
        item.SetAddOns([3]);

        item.SellAs(combo);
        Assert.Equal(("Pizza duo", "ثنائي", ComboOffer.MenuCategory, 200m, false, 0, 0, true, combo.Id),
            (item.Name, item.NameAr, item.Category, item.Price, item.IsAvailable, item.Variants.Count, item.AddOnIds.Length, item.IsCombo, item.ComboOfferId!.Value));
        Assert.Throws<DomainException>(() => new MenuItem(9002, "Other", null, "Mains", 10, false).SellAs(combo));

        combo.Delete("Omar");
        item.SellAs(combo);
        Assert.True(item.IsDeleted);
    }

    [Fact]
    public void A_combo_sold_takes_each_dish_by_its_recipe_as_many_times_as_it_holds()
    {
        var dough = Bought("Dough", 20);
        var cheese = Bought("Cheese", 300);
        var syrup = Bought("Cola syrup", 50);
        var pizza = new Recipe(RecipeTarget.ForMenuItem(4));
        pizza.SetIngredient(dough, 250);
        pizza.SetIngredient(cheese, 100);
        var cola = new Recipe("Cola", null, 25, null);
        cola.SetIngredient(syrup, 40);
        var gone = new Recipe("Old side", null, 10, null);
        gone.SetIngredient(cheese, 999);
        gone.Delete("Omar");
        var extraCheese = new Recipe(RecipeTarget.ForAddOn(7));
        extraCheese.SetIngredient(cheese, 30);
        var combos = new Dictionary<int, IReadOnlyList<ComboPart>> { [9001] = [new(pizza.Id, 2), new(cola.Id, 1), new(gone.Id, 1)] };

        // Three combos with extra cheese: six pizzas, three colas, the extra cheese three times; the deleted side nothing.
        var needs = StockRequirements.For(new SoldItem(9001, null, [7], 3), [pizza, cola, gone, extraCheese], combos);
        Assert.Equal((1_500m, 690m, 120m), (needs[dough.Id], needs[cheese.Id], needs[syrup.Id]));
        Assert.Equal([pizza.Id, cola.Id, gone.Id], StockRequirements.RecipeIdsFor([new SoldItem(9001, null, [], 1), new SoldItem(4, null, [], 1)], combos).ToList());

        // The pizza sold by itself is as before.
        Assert.Equal(250m, StockRequirements.For(new SoldItem(4, null, [], 1), [pizza], combos)[dough.Id]);
    }

    [Fact]
    public void Discount_reasons_are_each_once_never_more_than_the_discounts_and_none_without_them()
    {
        var cleaned = Discounts.Clean(100, [new(" Loyalty ", 30, 2), new("loyalty", 20, 1), new("Staff", 25)]);
        Assert.Equal([new DiscountReason("Loyalty", 50, 3), new DiscountReason("Staff", 25)], cleaned);
        Assert.Throws<DomainException>(() => Discounts.Clean(40, [new("Loyalty", 30), new("Staff", 20)]));
        Assert.Throws<DomainException>(() => Discounts.Clean(0, [new("Loyalty")]));
        Assert.Throws<DomainException>(() => Discounts.Clean(10, [new(" ")]));
        Assert.Throws<DomainException>(() => Discounts.Clean(10, [new("Loyalty", -1)]));
        Assert.Throws<DomainException>(() => Discounts.Clean(-1, []));
        Assert.Throws<DomainException>(() => Discounts.Clean(10, Enumerable.Range(1, 21).Select(i => new DiscountReason($"Reason {i}"))));
        // Named only, with no amounts: kept as reasons.
        Assert.Equal(["Loyalty", "Staff"], Discounts.Clean(10, [new("Loyalty"), new("Staff")]).Select(r => r.Reason));
    }

    [Fact]
    public void A_days_discounts_are_said_on_its_takings_and_never_in_the_safe_and_a_void_takes_them_back()
    {
        var takings = SafeTransaction.RevenueTransfer(Guid.NewGuid(), 800, new DateOnly(2026, 11, 15), new DateOnly(2026, 11, 15), null, "Omar",
            card: 200, tax: 140, discounts: 150, discountReasons: [new("Loyalty", 100, 4), new("Staff", 50, 2)]);
        Assert.Equal((1_140m, 1_000m, 150m), (takings.Amount, takings.NetAmount, takings.DiscountsAmount));
        Assert.Equal(2, takings.DiscountReasons.Count);
        Assert.Throws<DomainException>(() => SafeTransaction.RevenueTransfer(Guid.NewGuid(), 800, new DateOnly(2026, 11, 15), new DateOnly(2026, 11, 15),
            null, "Omar", discounts: 10, discountReasons: [new("Loyalty", 20)]));

        var reversal = takings.Void(Guid.NewGuid(), new DateOnly(2026, 11, 16), "Omar");
        Assert.Equal(-150m, reversal.DiscountsAmount);
        Assert.Equal([new DiscountReason("Loyalty", -100, -4), new DiscountReason("Staff", -50, -2)], reversal.DiscountReasons);
    }

    [Fact]
    public void The_end_of_day_keeps_its_discounts_and_the_cash_expected_in_the_till_never_counts_them()
    {
        var day = new EndOfDayReport(Guid.NewGuid(), new DateOnly(2026, 11, 15), "Omar");
        day.RecordSales(1_000, 500, 210, 0, null, "Omar", openingFloat: 300);
        var withoutDiscounts = day.NetCashInTill;

        day.RecordSales(1_000, 500, 210, 0, null, "Omar", openingFloat: 300, discounts: 240, discountReasons: [new("Happy hour", 200), new("Staff", 40)]);
        Assert.Equal((withoutDiscounts, 240m, 2), (day.NetCashInTill, day.DiscountsAmount!.Value, day.DiscountReasons.Count));
        Assert.Equal(1_440m, day.NetCashInTill);
        Assert.Throws<DomainException>(() => day.RecordSales(1_000, 500, 210, 0, null, "Omar", discounts: -1));
    }
}
