using Costing.Application.RawMaterials;
using Costing.Application.StockCounts;
using Costing.Domain.Common;
using Costing.Domain.RawMaterials;
using Costing.Domain.StockCounts;
using Costing.Domain.StockMovements;
using CountLine = Costing.Application.StockCounts.StockCountLine;

namespace Costing.Application.Tests;

// Blind counts (الجرد الأعمى) and daily spot counts (الجرد اليومي السريع): what a counter is sent,
// what a reviewer sees, and what posting a spot count moves, and leaves alone.
public class BlindAndSpotCountTests
{
    private readonly TestCosting _pos = new();

    // Beef at 400 a kilo, 10 kg; mozzarella at 300, 5 kg; flour at 30, 50 kg.
    private async Task<(RawMaterial Beef, RawMaterial Cheese, RawMaterial Flour)> SeedAsync()
    {
        async Task<RawMaterial> Priced(string name, decimal costPerKg, decimal grams)
        {
            var id = (await _pos.Send(new CreateRawMaterialCommand(name, UnitOfMeasure.Gram, CostPerPurchaseUnit: costPerKg))).Id;
            var material = (await _pos.Inventory.GetByIdAsync(id))!;
            material.ReceivePurchase(grams, Guid.NewGuid(), lineCost: grams / 1000 * costPerKg);
            return material;
        }
        return (await Priced("Beef", 400, 10_000), await Priced("Mozzarella", 300, 5_000), await Priced("Flour", 30, 50_000));
    }

    [Fact]
    public async Task Posting_a_spot_count_moves_only_the_materials_counted_in_it_and_leaves_every_other_alone()
    {
        var (beef, cheese, flour) = await SeedAsync();
        var before = _pos.Inventory.Movements.All.Count;
        var id = Guid.NewGuid();

        // The daily critical items: beef and cheese. The beef weighed, the cheese not yet.
        var draft = await _pos.Send(new SaveStockCountCommand(
            id, [new CountLine(beef.Id, 9_400)], "Samir", StockCountKind.Periodic, StockCountScope.Spot, [beef.Id, cheese.Id], "Daily critical items"));
        Assert.Equal((StockCountScope.Spot, "Daily critical items"), (draft.Scope, draft.ScopeLabel));
        Assert.Equal([beef.Id, cheese.Id], draft.ScopeMaterialIds);
        // Flour is not in it: refused, and the draft as it was.
        await Assert.ThrowsAsync<DomainException>(() => _pos.Send(new SaveStockCountCommand(id, [new CountLine(beef.Id, 9_400), new CountLine(flour.Id, 1)], "Samir")));

        var posted = await _pos.Send(new PostStockCountCommand(id, "Mona"));

        Assert.Equal(StockCountStatus.Posted, posted.Status);
        var moved = Assert.Single(_pos.Inventory.Movements.All.Skip(before));
        Assert.Equal((beef.Id, -600m, StockMovementReason.CountAdjustment, id), (moved.RawMaterialId, moved.Quantity, moved.Reason, moved.SourceId));
        // Cheese in the spot count but not counted, and flour outside it: exactly as they were.
        Assert.Equal((9_400m, 5_000m, 50_000m), (beef.QuantityOnHand, cheese.QuantityOnHand, flour.QuantityOnHand));
        Assert.Equal((0.4m, 10_000m), (posted.Lines.Single().UnitCost, posted.Lines.Single().BookQuantity));
    }

    [Fact]
    public async Task A_blind_counter_is_sent_no_figure_of_the_records_or_cost_and_a_reviewer_sees_them_as_they_stand()
    {
        var (beef, _, _) = await SeedAsync();
        var id = Guid.NewGuid();

        var blind = await _pos.Send(new SaveStockCountCommand(id, [new CountLine(beef.Id, 9_400, "one tray in the freezer")], "Samir", Blind: true));
        Assert.True(blind.Blind);
        var line = Assert.Single(blind.Lines);
        Assert.Equal((9_400m, (decimal?)null, (decimal?)null, "one tray in the freezer"), (line.CountedQuantity, line.BookQuantity, line.UnitCost, line.Note));
        Assert.All((await _pos.Send(new GetStockCountQuery(id, Blind: true)))!.Lines, l => Assert.Equal((null, null), (l.BookQuantity, l.UnitCost)));

        // The reviewer: the records as they stand now, beside what was counted.
        var reviewed = (await _pos.Send(new GetStockCountQuery(id)))!;
        Assert.False(reviewed.Blind);
        Assert.Equal((10_000m, 0.4m), (reviewed.Lines.Single().BookQuantity, reviewed.Lines.Single().UnitCost));

        // Posted, still nothing for the blind; the figures as they were at posting for the rest.
        await _pos.Send(new PostStockCountCommand(id, "Mona"));
        beef.ReceivePurchase(1_000, Guid.NewGuid(), lineCost: 400);
        var postedBlind = (await _pos.Send(new GetStockCountQuery(id, Blind: true)))!.Lines.Single();
        var posted = (await _pos.Send(new GetStockCountQuery(id)))!.Lines.Single();
        Assert.Equal(((decimal?)null, (decimal?)null), (postedBlind.BookQuantity, postedBlind.UnitCost));
        Assert.Equal((10_000m, 0.4m), (posted.BookQuantity, posted.UnitCost));
    }

    [Fact]
    public async Task A_count_handed_in_is_sent_back_for_lines_to_weigh_again_and_handed_in_again()
    {
        var (beef, cheese, _) = await SeedAsync();
        var id = Guid.NewGuid();
        await _pos.Send(new SaveStockCountCommand(id, [new CountLine(beef.Id, 7_000), new CountLine(cheese.Id, 5_000)], "Samir", Blind: true));

        var handedIn = await _pos.Send(new SubmitStockCountCommand(id, "Samir", Blind: true));
        Assert.Equal((StockCountReview.Submitted, "Samir"), (handedIn.Review, handedIn.SubmittedBy));
        Assert.Equal(StockCountReview.Submitted, (await _pos.Send(new GetStockCountsQuery())).Single().Review);

        var sentBack = await _pos.Send(new RequestStockCountRecountCommand(id, [beef.Id], "Weigh the beef again", "Karim"));
        Assert.Equal((StockCountReview.RecountRequested, "Weigh the beef again"), (sentBack.Review, sentBack.ReviewNote));
        // The counter is told which lines, never what the records expect.
        var asCounter = (await _pos.Send(new GetStockCountQuery(id, Blind: true)))!;
        Assert.Equal([(beef.Id, true, (decimal?)null), (cheese.Id, false, null)], asCounter.Lines.Select(l => (l.RawMaterialId, l.RecountRequested, l.BookQuantity)));

        await _pos.Send(new SaveStockCountCommand(id, [new CountLine(beef.Id, 9_900), new CountLine(cheese.Id, 5_000)], "Samir", Blind: true));
        var again = await _pos.Send(new SubmitStockCountCommand(id, "Samir", Blind: true));
        Assert.Equal(StockCountReview.Submitted, again.Review);
        Assert.All(again.Lines, l => Assert.False(l.RecountRequested));
    }

    [Fact]
    public async Task A_count_sheet_lists_each_material_with_its_star_and_nothing_of_its_stock()
    {
        var (beef, _, _) = await SeedAsync();
        Assert.True(await _pos.Send(new SetSpotCheckItemCommand(beef.Id, true)));
        Assert.True(beef.IsSpotCheckItem);

        var items = await _pos.Send(new GetCountItemsQuery());
        Assert.Equal(["Beef", "Flour", "Mozzarella"], items.Select(i => i.Name));
        Assert.Equal([true, false, false], items.Select(i => i.IsSpotCheckItem));
        // What a count sheet is sent has no stock or cost to it at all.
        Assert.DoesNotContain(typeof(CountItemDto).GetProperties(), p => p.Name.Contains("Quantity") || p.Name.Contains("Cost") || p.Name.Contains("Value"));
    }
}
