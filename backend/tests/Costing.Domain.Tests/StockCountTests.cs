using Costing.Domain.Common;
using Costing.Domain.Production;
using Costing.Domain.RawMaterials;
using Costing.Domain.StockCounts;
using Costing.Domain.StockMovements;

namespace Costing.Domain.Tests;

// Physical counts and spoilage: the fixed points and the recorded losses the variance report
// measures from.
public class StockCountTests
{
    private static RawMaterial Priced(string name, decimal onHand, decimal costPerKg)
    {
        var material = new RawMaterial(name, UnitOfMeasure.Gram);
        material.ReceivePurchase(onHand, Guid.NewGuid(), lineCost: onHand / 1000 * costPerKg);
        return material;
    }

    [Fact]
    public void Posting_sets_stock_to_what_was_counted_and_keeps_what_the_records_said()
    {
        var fries = Priced("Farm frites", 20_000, 60);
        var cheese = Priced("Mozzarella", 5_000, 300);
        var count = new StockCount(Guid.NewGuid(), "Omar");

        count.Record([(fries.Id, 17_500), (cheese.Id, 5_200)]);
        Assert.All(count.Lines, l => Assert.Null(l.BookQuantity));

        var movements = count.Post(new Dictionary<Guid, RawMaterial> { [fries.Id] = fries, [cheese.Id] = cheese }, "Omar");

        Assert.Equal(StockCountStatus.Posted, count.Status);
        Assert.Equal((17_500m, 5_200m), (fries.QuantityOnHand, cheese.QuantityOnHand));
        var friesLine = Assert.Single(count.Lines, l => l.RawMaterialId == fries.Id);
        Assert.Equal((20_000m, 0.06m), (friesLine.BookQuantity, friesLine.UnitCost));
        Assert.Equal([-2_500m, 200m], movements.OrderBy(m => m.Quantity).Select(m => m.Quantity));
        Assert.All(movements, m => Assert.Equal((StockMovementReason.CountAdjustment, count.Id), (m.Reason, m.SourceId)));
    }

    // Left out is not counted, not counted at nothing: its stock stays.
    [Fact]
    public void A_material_left_out_of_the_count_keeps_its_stock()
    {
        var fries = Priced("Farm frites", 20_000, 60);
        var cheese = Priced("Mozzarella", 5_000, 300);
        var count = new StockCount(Guid.NewGuid(), "Omar");
        count.Record([(fries.Id, 1_000), (cheese.Id, 0)]);

        // The draft is saved again with the cheese taken off.
        count.Record([(fries.Id, 18_000)]);
        count.Post(new Dictionary<Guid, RawMaterial> { [fries.Id] = fries, [cheese.Id] = cheese }, "Omar");

        Assert.Equal((18_000m, 5_000m), (fries.QuantityOnHand, cheese.QuantityOnHand));
        Assert.Equal(18_000m, Assert.Single(count.Lines).CountedQuantity);
    }

    [Fact]
    public void A_count_refuses_what_cannot_be_counted_and_cannot_change_once_posted()
    {
        var fries = Priced("Farm frites", 1_000, 60);
        var count = new StockCount(Guid.NewGuid(), "Omar");

        Assert.Throws<DomainException>(() => count.Record([(fries.Id, -1)]));
        Assert.Throws<DomainException>(() => count.Record([(fries.Id, 1), (fries.Id, 2)]));
        Assert.Throws<DomainException>(() => count.Post(new Dictionary<Guid, RawMaterial>(), "Omar"));

        count.Record([(fries.Id, 900)]);
        count.Post(new Dictionary<Guid, RawMaterial> { [fries.Id] = fries }, "Omar");

        Assert.Throws<DomainException>(() => count.Record([(fries.Id, 800)]));
        Assert.Throws<DomainException>(() => count.Post(new Dictionary<Guid, RawMaterial> { [fries.Id] = fries }, "Omar"));
        Assert.Equal(900m, fries.QuantityOnHand);
    }

    // The opening stock: where stock begins, at the cost each has, not a shortage or a surplus.
    [Fact]
    public void An_opening_count_sets_where_stock_begins_at_the_cost_each_has_and_records_no_difference()
    {
        // Priced from the materials sheet, never bought: nothing on hand.
        var flour = new RawMaterial("Flour", UnitOfMeasure.Gram);
        flour.SetCost(30);
        var cheese = Priced("Mozzarella", 1_000, 300);
        var count = new StockCount(Guid.NewGuid(), "Omar", StockCountKind.Opening);
        count.Record([(flour.Id, 25_000), (cheese.Id, 4_000)]);

        var movements = count.Post(new Dictionary<Guid, RawMaterial> { [flour.Id] = flour, [cheese.Id] = cheese }, "Omar");

        Assert.True(count.IsOpening);
        Assert.Equal((25_000m, 4_000m), (flour.QuantityOnHand, cheese.QuantityOnHand));
        Assert.All(movements, m => Assert.Equal((StockMovementReason.OpeningStock, count.Id), (m.Reason, m.SourceId)));
        Assert.Equal([3_000m, 25_000m], movements.OrderBy(m => m.Quantity).Select(m => m.Quantity));
        // Valued at the cost each has; what the records said before kept for the record.
        Assert.Equal((0m, 0.03m), (count.Lines.Single(l => l.RawMaterialId == flour.Id).BookQuantity, count.Lines.Single(l => l.RawMaterialId == flour.Id).UnitCost));
        Assert.Equal(25_000 * 0.03m + 4_000 * 0.3m, count.Lines.Sum(l => l.CountedQuantity * l.UnitCost!.Value));
        Assert.Equal((0.03m, 0.3m), (flour.AverageCost, cheese.AverageCost));
    }

    [Fact]
    public void A_prep_item_never_made_opens_at_its_recipe_cost_and_one_with_no_price_at_none()
    {
        var flour = new RawMaterial("Flour", UnitOfMeasure.Gram);
        flour.SetCost(30);
        var oil = new RawMaterial("Oil", UnitOfMeasure.Millilitre);
        var dough = new RawMaterial("Dough", UnitOfMeasure.Gram, kind: MaterialKind.Prep);
        var recipe = new PrepRecipe(dough, 1000);
        recipe.Replace([(flour, 600m, (decimal?)null)]);
        var all = new Dictionary<Guid, RawMaterial> { [flour.Id] = flour, [oil.Id] = oil, [dough.Id] = dough };
        var count = new StockCount(Guid.NewGuid(), "Omar", StockCountKind.Opening);
        count.Record([(dough.Id, 3_000), (oil.Id, 2_000), (flour.Id, 1_000)]);

        var movements = count.Post(all, "Omar", new RecipeCosts(all, [recipe]));

        // 600 g of flour at 30 a kg for each kg of dough: 18 a kg from now on, as its first batch would be.
        Assert.Equal(0.018m, dough.AverageCost);
        Assert.Equal(0.018m, movements.Single(m => m.RawMaterialId == dough.Id).UnitCost);
        Assert.Equal(0.018m, count.Lines.Single(l => l.RawMaterialId == dough.Id).UnitCost);
        // No price to value the oil at: its stock is set all the same.
        Assert.Equal((2_000m, (decimal?)null), (oil.QuantityOnHand, count.Lines.Single(l => l.RawMaterialId == oil.Id).UnitCost));
        // One with its own cost keeps it.
        Assert.Equal(0.03m, flour.AverageCost);
    }

    [Fact]
    public void A_draft_can_be_told_it_is_the_other_kind_and_a_posted_one_cannot()
    {
        var fries = Priced("Farm frites", 1_000, 60);
        var count = new StockCount(Guid.NewGuid(), "Omar");
        Assert.Equal(StockCountKind.Periodic, count.Kind);

        count.SetKind(StockCountKind.Opening);
        count.SetKind(StockCountKind.Opening);
        Assert.True(count.IsOpening);
        Assert.Throws<DomainException>(() => count.SetKind((StockCountKind)7));

        count.SetKind(StockCountKind.Periodic);
        count.Record([(fries.Id, 900)]);
        var movement = Assert.Single(count.Post(new Dictionary<Guid, RawMaterial> { [fries.Id] = fries }, "Omar"));
        Assert.Equal((StockMovementReason.CountAdjustment, -100m), (movement.Reason, movement.Quantity));
        Assert.Contains("its kind stays", Assert.Throws<DomainException>(() => count.SetKind(StockCountKind.Opening)).Message);
    }

    [Fact]
    public void Spoilage_takes_stock_at_the_average_cost_and_says_why_and_who()
    {
        var cheese = Priced("Mozzarella", 5_000, 300);

        var spoiled = cheese.RecordSpoilage(250, Guid.NewGuid(), " Expired ", "Omar");

        Assert.Equal(4_750m, cheese.QuantityOnHand);
        Assert.Equal((StockMovementReason.Spoilage, -250m, 0.3m, "Expired", "Omar"),
            (spoiled.Reason, spoiled.Quantity, spoiled.UnitCost, spoiled.Note, spoiled.RecordedBy));
        Assert.Throws<DomainException>(() => cheese.RecordSpoilage(10, Guid.NewGuid(), " ", "Omar"));
        Assert.Throws<DomainException>(() => cheese.RecordSpoilage(0, Guid.NewGuid(), "Dropped", "Omar"));
    }
}
