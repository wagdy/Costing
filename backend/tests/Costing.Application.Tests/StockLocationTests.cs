using Costing.Application.RawMaterials;
using Costing.Application.Stock;
using Costing.Application.StockCounts;
using Costing.Domain.Common;
using Costing.Domain.Company;
using Costing.Domain.RawMaterials;
using Costing.Domain.Stock;
using Costing.Domain.StockMovements;
using CountLine = Costing.Application.StockCounts.StockCountLine;

namespace Costing.Application.Tests;

// Stock by location through the use cases: an open-space shop has one store, takes no location
// and moves nothing between places; with sub-stores, stock is received, moved, counted and thrown
// away where it is, each transfer numbered by its year and voided whole.
public class StockLocationTests
{
    private readonly TestCosting _costing = new();
    private readonly Guid _kitchen = Guid.NewGuid();

    private RawMaterial Bought(string name, decimal grams, decimal cost)
    {
        var material = new RawMaterial(name, UnitOfMeasure.Gram);
        _costing.Inventory.Add(material);
        _costing.Inventory.Movements.Add(material.ReceivePurchase(grams, Guid.NewGuid(), cost));
        return material;
    }

    private void WithSubStores()
    {
        _costing.Profile.Set(_costing.Profile.Current with { OperatingMode = SystemOperatingMode.SingleBranch_WithSubStores });
        _costing.Locations.All.Add(new InventoryLocation(_kitchen, Branch.DefaultId, "Hot Kitchen", "المطبخ الساخن", LocationKind.Kitchen));
    }

    private Task<InternalTransferDto> Move(Guid from, Guid to, params (RawMaterial Material, decimal Quantity)[] lines) =>
        _costing.Send(new PostInternalTransferCommand(
            Guid.NewGuid(), from, to, lines.Select(l => new TransferLineInput(l.Material.Id, l.Quantity)).ToList(), "For service", "user-1", "Samir"));

    [Fact]
    public async Task An_open_space_shop_keeps_its_one_store_and_moves_nothing_between_places()
    {
        var flour = Bought("Flour", 10_000, 300);
        // A location named is ignored: the one store.
        await _costing.Send(new RecordSpoilageCommand(Guid.NewGuid(), [new SpoilageLine(flour.Id, 500, "Wet")], "Samir", _kitchen));
        Assert.Equal(Guid.Empty, _costing.Inventory.Movements.All.Single(m => m.Reason == StockMovementReason.Spoilage).LocationId);
        Assert.Contains("open-space shop", (await Assert.ThrowsAsync<DomainException>(() =>
            Move(InventoryLocation.DefaultId, _kitchen, (flour, 1_000)))).Message);
        var places = await _costing.Send(new GetStockLocationsQuery());
        Assert.Equal((SystemOperatingMode.SingleBranch_OpenSpace, 0), (places.Mode, places.Locations.Count));
    }

    [Fact]
    public async Task With_sub_stores_stock_is_moved_to_the_kitchen_counted_there_and_moved_back_by_a_void()
    {
        WithSubStores();
        var flour = Bought("Flour", 10_000, 300);
        var places = await _costing.Send(new GetStockLocationsQuery());
        Assert.Equal(["Main Store", "Hot Kitchen"], places.Locations.Select(l => l.Name));

        var first = await Move(InventoryLocation.DefaultId, _kitchen, (flour, 4_000));
        var year = DateOnly.FromDateTime(DateTime.UtcNow).Year;
        Assert.Equal(($"TR-{year}-0001", "Main Store", "Hot Kitchen", InternalTransferStatus.Posted, (decimal?)120m),
            (first.Number, first.FromLocation, first.ToLocation, first.Status, first.TotalCost));
        Assert.Equal($"TR-{year}-0002", (await Move(_kitchen, InventoryLocation.DefaultId, (flour, 1_000))).Number);
        Assert.Equal(10_000m, flour.QuantityOnHand);

        // What each location has now.
        var stock = await _costing.Send(new GetLocationStockQuery());
        var row = stock.Rows.Single(r => r.RawMaterialId == flour.Id);
        Assert.Equal((7_000m, 3_000m, 10_000m, (decimal?)300m), (row.ByLocation[InventoryLocation.DefaultId], row.ByLocation[_kitchen], row.Total, row.Value));
        Assert.Equal(["Main Store", "Hot Kitchen"], stock.Locations.Select(l => l.Name));

        // More than the kitchen has: refused, nothing moved.
        Assert.Contains("Hot Kitchen has 3000 Gram of Flour", (await Assert.ThrowsAsync<DomainException>(() =>
            Move(_kitchen, InventoryLocation.DefaultId, (flour, 3_500)))).Message);

        // Counted in the kitchen: 2.6 kg against its 3 kg.
        var count = Guid.NewGuid();
        var draft = await _costing.Send(new SaveStockCountCommand(count, [new CountLine(flour.Id, 2_600)], "Samir", LocationId: _kitchen));
        Assert.Equal((_kitchen, (decimal?)3_000m), (draft.LocationId, draft.Lines.Single().BookQuantity));
        await _costing.Send(new PostStockCountCommand(count, "Mona"));
        var adjusted = _costing.Inventory.Movements.All.Single(m => m.Reason == StockMovementReason.CountAdjustment);
        Assert.Equal((-400m, _kitchen), (adjusted.Quantity, adjusted.LocationId));

        // The first transfer voided: both sides back where they were.
        var voided = await _costing.Send(new VoidInternalTransferCommand(first.Id, "Omar"));
        Assert.Equal(InternalTransferStatus.Voided, voided.Status);
        var back = _costing.Inventory.Movements.All.Where(m => m.SourceId == first.Id && m.IsReversal).ToList();
        Assert.Equal([(InventoryLocation.DefaultId, 4_000m), (_kitchen, -4_000m)], back.Select(m => (m.LocationId, m.Quantity)).OrderBy(b => b.Item2).Reverse());
        Assert.Contains("already been voided", (await Assert.ThrowsAsync<DomainException>(() =>
            _costing.Send(new VoidInternalTransferCommand(first.Id, "Omar")))).Message);
        Assert.Equal(2, (await _costing.Send(new GetInternalTransfersQuery(DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-1), DateOnly.FromDateTime(DateTime.UtcNow)))).Count);
    }

    [Fact]
    public async Task A_location_is_one_in_use_of_the_branch_and_whoever_does_not_see_costs_sees_none()
    {
        WithSubStores();
        var flour = Bought("Flour", 10_000, 300);
        var tanta = new InventoryLocation(Guid.NewGuid(), Guid.NewGuid(), "Tanta store", null, LocationKind.MainStore);
        _costing.Locations.All.Add(tanta);
        Assert.Contains("another branch's", (await Assert.ThrowsAsync<DomainException>(() =>
            _costing.Send(new RecordSpoilageCommand(Guid.NewGuid(), [new SpoilageLine(flour.Id, 1, "Wet")], "Samir", tanta.Id)))).Message);
        Assert.Contains("no longer there", (await Assert.ThrowsAsync<DomainException>(() =>
            _costing.Send(new RecordSpoilageCommand(Guid.NewGuid(), [new SpoilageLine(flour.Id, 1, "Wet")], "Samir", Guid.NewGuid())))).Message);

        // Thrown away in the kitchen: taken from there.
        await Move(InventoryLocation.DefaultId, _kitchen, (flour, 1_000));
        await _costing.Send(new RecordSpoilageCommand(Guid.NewGuid(), [new SpoilageLine(flour.Id, 200, "Wet")], "Samir", _kitchen));
        Assert.Equal(_kitchen, _costing.Inventory.Movements.All.Single(m => m.Reason == StockMovementReason.Spoilage).LocationId);

        var blind = await _costing.Send(new GetInternalTransfersQuery(DateOnly.FromDateTime(DateTime.UtcNow), DateOnly.FromDateTime(DateTime.UtcNow), SeeCosts: false));
        Assert.Equal(((decimal?)null, (decimal?)null), (blind[0].TotalCost, blind[0].Lines[0].UnitCost));
        Assert.Null((await _costing.Send(new GetLocationStockQuery(SeeCosts: false))).Rows[0].Value);
    }
}
