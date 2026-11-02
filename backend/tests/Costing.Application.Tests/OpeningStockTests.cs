using Costing.Application.Approvals;
using Costing.Application.RawMaterials;
using Costing.Application.StockCounts;
using Costing.Domain.Approvals;
using Costing.Domain.Common;
using Costing.Domain.Production;
using Costing.Domain.RawMaterials;
using Costing.Domain.StockCounts;
using Costing.Domain.StockMovements;
using CountLine = Costing.Application.StockCounts.StockCountLine;

namespace Costing.Application.Tests;

// The opening stock (جرد افتتاحي): where each material's stock begins when costing starts,
// valued at its cost, with no shortage or surplus against the nothing the records had.
public class OpeningStockTests
{
    private readonly TestCosting _pos = new();

    // Priced from the materials sheet, nothing bought yet; and a dough never made.
    private async Task<(RawMaterial Flour, RawMaterial Cheese, RawMaterial Dough)> SeedAsync()
    {
        var flour = (await _pos.Send(new CreateRawMaterialCommand("Flour", UnitOfMeasure.Gram, CostPerPurchaseUnit: 30))).Id;
        var cheese = (await _pos.Send(new CreateRawMaterialCommand("Cheese", UnitOfMeasure.Gram, CostPerPurchaseUnit: 300))).Id;
        var dough = new RawMaterial("Dough", UnitOfMeasure.Gram, kind: MaterialKind.Prep);
        _pos.Inventory.Add(dough);
        var recipe = new PrepRecipe(dough, 1000);
        recipe.Replace([((await Material(flour)), 600m, (decimal?)null)]);
        _pos.Inventory.PrepRecipes.Add(recipe);
        return (await Material(flour), await Material(cheese), dough);
    }

    private async Task<RawMaterial> Material(Guid id) => (await _pos.Inventory.GetByIdAsync(id))!;

    private Task<StockCountDto> Save(Guid id, StockCountKind? kind, params (RawMaterial Material, decimal Quantity)[] lines) =>
        _pos.Send(new SaveStockCountCommand(id, lines.Select(l => new CountLine(l.Material.Id, l.Quantity)).ToList(), "Omar", kind));

    private Task<StockCountDto> Post(Guid id) => _pos.Send(new PostStockCountCommand(id, "Omar"));

    [Fact]
    public async Task It_sets_where_stock_begins_valued_at_each_cost_with_no_difference_recorded()
    {
        var (flour, cheese, dough) = await SeedAsync();
        var id = Guid.NewGuid();

        Assert.Equal(StockCountKind.Opening, (await Save(id, StockCountKind.Opening, (flour, 25_000), (cheese, 4_000), (dough, 3_000))).Kind);
        // Saved again as the counter goes on: still the opening stock.
        await Save(id, null, (flour, 25_000), (cheese, 4_000), (dough, 3_000));
        var posted = await Post(id);

        Assert.Equal((StockCountStatus.Posted, StockCountKind.Opening), (posted.Status, posted.Kind));
        Assert.Equal((25_000m, 4_000m, 3_000m), (flour.QuantityOnHand, cheese.QuantityOnHand, dough.QuantityOnHand));
        var movements = _pos.Inventory.Movements.All;
        Assert.Equal(3, movements.Count);
        Assert.All(movements, m => Assert.Equal((StockMovementReason.OpeningStock, id), (m.Reason, m.SourceId)));
        Assert.DoesNotContain(movements, m => m.Reason == StockMovementReason.CountAdjustment);
        // Its value: each at the cost it has, the dough at its recipe's (600 g of flour a kg: 18 a kg).
        Assert.Equal(0.018m, dough.AverageCost);
        Assert.Equal(750m + 1_200m + 54m, posted.Lines.Sum(l => l.CountedQuantity * l.UnitCost!.Value));
        Assert.Equal(StockCountKind.Opening, Assert.Single(await _pos.Send(new GetStockCountsQuery())).Kind);

        // Counted again a week later: a periodic count, its difference measured from the opening stock.
        var week = Guid.NewGuid();
        await Save(week, StockCountKind.Periodic, (flour, 24_000));
        await Post(week);
        var shortage = Assert.Single(_pos.Inventory.Movements.All, m => m.SourceId == week);
        Assert.Equal((StockMovementReason.CountAdjustment, -1_000m, 0.03m), (shortage.Reason, shortage.Quantity, shortage.UnitCost));
    }

    [Fact]
    public async Task A_material_is_opened_once_and_again_only_once_its_count_is_voided()
    {
        var (flour, cheese, _) = await SeedAsync();
        var opening = Guid.NewGuid();
        await Save(opening, StockCountKind.Opening, (flour, 25_000), (cheese, 4_000));
        await Post(opening);

        // Forgotten the first time: the oil opens on its own.
        var oil = await Material((await _pos.Send(new CreateRawMaterialCommand("Oil", UnitOfMeasure.Millilitre, CostPerPurchaseUnit: 80))).Id);
        var more = Guid.NewGuid();
        await Save(more, StockCountKind.Opening, (oil, 5_000));
        await Post(more);
        Assert.Equal(5_000m, oil.QuantityOnHand);

        // The flour again, as opening stock: refused, and nothing posted.
        var again = Guid.NewGuid();
        await Save(again, StockCountKind.Opening, (flour, 30_000), (oil, 4_000));
        var refused = await Assert.ThrowsAsync<DomainException>(() => Post(again));
        Assert.StartsWith("Flour and Oil were counted already, first on ", refused.Message);
        Assert.Contains("Count them in a periodic count, or leave them out of the opening stock.", refused.Message);
        Assert.Contains("تُجرد جردًا دوريًا", refused.Message);
        Assert.Equal(25_000m, flour.QuantityOnHand);
        await _pos.Send(new DiscardStockCountCommand(again));

        // The opening count voided, its stock taken back out: the cheese can be opened again.
        var voided = await _pos.Send(new RequestDeletionCommand(Guid.NewGuid(), ApprovalModule.StockCount, opening, "Counted the wrong store", "u1", "Omar", CanApprove: true));
        Assert.Equal(ApprovalOutcome.Applied, voided.Outcome);
        Assert.Equal((0m, 0m), (flour.QuantityOnHand, cheese.QuantityOnHand));
        Assert.Equal(2, _pos.Inventory.Movements.All.Count(m => m.SourceId == opening && m.IsReversal && m.Reason == StockMovementReason.OpeningStock));
        Assert.StartsWith("Opening stock count posted ", voided.Request.Summary);

        await _pos.Send(new RecordStockCountCommand(Guid.NewGuid(), [new CountLine(cheese.Id, 3_500)], "Omar", StockCountKind.Opening));
        Assert.Equal(3_500m, cheese.QuantityOnHand);
        Assert.Equal(StockMovementReason.OpeningStock, _pos.Inventory.Movements.All.Last().Reason);
    }
}
