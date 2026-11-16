using Costing.Domain.Common;
using Costing.Domain.Production;
using Costing.Domain.RawMaterials;
using Costing.Domain.StockMovements;
using Costing.Domain.Suppliers;

namespace Costing.Domain.Tests;

// The inflation simulator's prices, staff meals taken from stock, and a supplier's payment terms.
public class WhatIfAndConsumptionTests
{
    private static RawMaterial Bought(string name, decimal? perKg)
    {
        var material = new RawMaterial(name, UnitOfMeasure.Gram);
        if (perKg is { } price)
            material.SetCost(price);
        return material;
    }

    [Fact]
    public void A_simulation_prices_what_is_bought_anew_and_carries_it_through_the_prep_items()
    {
        // Flour at 30 a kg; a dough made at 25 a kg from 600 g of it a kg; a sauce never made, of 500 g of tomatoes at 10 a kg.
        var flour = Bought("Flour", 30);
        var tomatoes = Bought("Tomatoes", 10);
        var saffron = Bought("Saffron", null);
        var dough = new RawMaterial("Dough", UnitOfMeasure.Gram, kind: MaterialKind.Prep);
        var doughRecipe = new PrepRecipe(dough, 1000);
        doughRecipe.Replace([(flour, 600m, null)]);
        dough.ReceiveProduction(1000, Guid.NewGuid(), 25);
        var sauce = new RawMaterial("Sauce", UnitOfMeasure.Gram, kind: MaterialKind.Prep);
        var sauceRecipe = new PrepRecipe(sauce, 1000);
        sauceRecipe.Replace([(tomatoes, 500m, null)]);
        var materials = new[] { flour, tomatoes, saffron, dough, sauce }.ToDictionary(m => m.Id);

        // Flour +20%, tomatoes +50%, saffron (no price yet) at 2 a gram.
        var simulated = new RecipeCosts(materials, [doughRecipe, sauceRecipe], m =>
            m.Id == flour.Id ? m.AverageCost * 1.2m : m.Id == tomatoes.Id ? m.AverageCost * 1.5m : m.Id == saffron.Id ? 2m : null);
        var actual = new RecipeCosts(materials, [doughRecipe, sauceRecipe]);

        Assert.Equal((0.036m, 0.015m, 2m), (simulated.Of(flour.Id).PerUnit!.Value, simulated.Of(tomatoes.Id).PerUnit!.Value, simulated.Of(saffron.Id).PerUnit!.Value));
        // The dough's batches cost 25 a kg; its recipe moves from 18 to 21.6: 25 × 1.2.
        Assert.Equal((0.025m, 0.03m), (actual.Of(dough.Id).PerUnit!.Value, Math.Round(simulated.Of(dough.Id).PerUnit!.Value, 6)));
        // The sauce, never made, by its recipe at the new price: 500 g × 0.015 a kg.
        Assert.Equal((0.005m, 0.0075m, true), (actual.Of(sauce.Id).PerUnit!.Value, simulated.Of(sauce.Id).PerUnit!.Value, simulated.Of(sauce.Id).ByRecipe));
        // Nothing saved: the materials are as they were.
        Assert.Equal(0.03m, flour.AverageCost);
    }

    [Fact]
    public void A_staff_meal_takes_stock_at_the_average_and_is_never_spoilage()
    {
        var beef = Bought("Beef", 400);
        beef.ReceivePurchase(5_000, Guid.NewGuid(), lineCost: 2_000);
        var entry = Guid.NewGuid();

        var meal = beef.RecordConsumption(250, entry, StockMovementReason.StaffMeal, "2 × Burger", "Omar");
        Assert.Equal((-250m, (decimal?)0.4m, "2 × Burger", StockMovementReason.StaffMeal, 4_750m),
            (meal.Quantity, meal.UnitCost, meal.Note, meal.Reason, beef.QuantityOnHand));
        Assert.True(StaffConsumption.Is(StockMovementReason.Hospitality));
        Assert.False(StaffConsumption.Is(StockMovementReason.Spoilage));
        Assert.Throws<DomainException>(() => beef.RecordConsumption(10, entry, StockMovementReason.Spoilage, null, "Omar"));
        Assert.Throws<DomainException>(() => beef.RecordConsumption(0, entry, StockMovementReason.Hospitality, null, "Omar"));
    }

    [Fact]
    public void A_supplier_gives_days_to_pay_kept_unless_changed()
    {
        var supplier = new Supplier(Guid.NewGuid(), new SupplierDetails("Nile Farms", PaymentTermsDays: 30));
        Assert.Equal(30, supplier.PaymentTermsDays);
        supplier.Update(new SupplierDetails("Nile Farms", Phone: "0100"));
        Assert.Equal(30, supplier.PaymentTermsDays);
        Assert.Throws<DomainException>(() => supplier.Update(new SupplierDetails("Nile Farms", PaymentTermsDays: 400)));
        Assert.Equal(0, new Supplier(Guid.NewGuid(), new SupplierDetails("Delta Dairy")).PaymentTermsDays);
    }
}
