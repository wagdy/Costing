using Costing.Domain.Common;
using Costing.Domain.Company;
using Costing.Domain.RawMaterials;
using Costing.Domain.Stock;
using Costing.Domain.StockMovements;

namespace Costing.Domain.Tests;

// Stock by location and cost by branch: a transfer moves stock between two locations of a branch
// at its average cost, nothing gained or lost; a count set against what is on the shelf where it
// was counted; each branch's average moved by its own deliveries; and what a transfer refuses.
public class StockLocationTests
{
    private static readonly Guid Kitchen = Guid.NewGuid();

    private static RawMaterial Flour(decimal kilos = 10, decimal pricePerKilo = 30)
    {
        var flour = new RawMaterial("Flour", UnitOfMeasure.Gram);
        flour.ReceivePurchase(kilos * 1000, Guid.NewGuid(), kilos * pricePerKilo);
        return flour;
    }

    [Fact]
    public void A_transfer_moves_stock_between_two_locations_at_its_average_cost_and_changes_nothing_else()
    {
        var flour = Flour();
        var (taken, put) = flour.Transfer(2_000, Guid.NewGuid(), InventoryLocation.DefaultId, Kitchen, "Samir");
        Assert.Equal((-2_000m, StockMovementReason.TransferOut, InventoryLocation.DefaultId, (decimal?)0.03m), (taken.Quantity, taken.Reason, taken.LocationId, taken.UnitCost));
        Assert.Equal((2_000m, StockMovementReason.TransferIn, Kitchen, (decimal?)0.03m), (put.Quantity, put.Reason, put.LocationId, put.UnitCost));
        // The company's stock and cost as they were.
        Assert.Equal((10_000m, (decimal?)0.03m), (flour.QuantityOnHand, flour.AverageCost));
        Assert.Throws<DomainException>(() => flour.Transfer(1, Guid.NewGuid(), Kitchen, Kitchen, "Samir"));
        Assert.Throws<DomainException>(() => flour.Transfer(0, Guid.NewGuid(), InventoryLocation.DefaultId, Kitchen, "Samir"));

        // Undone where it was: each side back in its own location.
        Assert.Equal((2_000m, InventoryLocation.DefaultId), (flour.Reverse(taken, "Omar").Quantity, flour.Reverse(taken, "Omar").LocationId));
    }

    [Fact]
    public void A_count_is_set_against_the_shelf_it_was_counted_on_and_valued_at_the_cost_there()
    {
        var flour = Flour();
        // Unviewed: the company's figures, as always.
        Assert.Equal(-1_000m, flour.AdjustToCount(9_000, Guid.NewGuid()).Quantity);

        // The kitchen holds 2 kg of it, at the branch's 0.05 a gram.
        flour.View(2_000, 0.05m);
        Assert.Equal((2_000m, (decimal?)0.05m), (flour.BookQuantity, flour.UnitCostHere));
        var counted = flour.AdjustToCount(1_500, Guid.NewGuid());
        Assert.Equal((-500m, (decimal?)0.05m), (counted.Quantity, counted.UnitCost));
        Assert.Equal((decimal?)0.05m, flour.RecordSale(100, Guid.NewGuid()).UnitCost);
        // The company's average kept as it is.
        Assert.Equal((decimal?)0.03m, flour.AverageCost);
        flour.AdoptAverage(0.04m);
        Assert.Equal((decimal?)0.04m, flour.AverageCost);
    }

    [Fact]
    public void Each_branch_averages_its_own_deliveries_and_takes_a_voided_one_back_out()
    {
        var tanta = new MaterialBranchStock(Guid.NewGuid(), Guid.NewGuid(), null);
        tanta.AverageWith(0, 5_000, 0.05m);
        Assert.Equal((decimal?)0.05m, tanta.AverageCost);
        tanta.AverageWith(5_000, 5_000, 0.03m);
        Assert.Equal((decimal?)0.04m, tanta.AverageCost);
        tanta.UnaverageWith(10_000, 5_000, 0.03m);
        Assert.Equal((decimal?)0.05m, tanta.AverageCost);
        // Stock below zero counts as none.
        Assert.Equal(0.06m, MovingAverage.With(0.05m, -200, 1_000, 0.06m));
        tanta.Open(0.07m);
        Assert.Equal((decimal?)0.05m, tanta.AverageCost);
        var fresh = new MaterialBranchStock(Guid.NewGuid(), Guid.NewGuid(), null);
        fresh.Open(0.07m);
        Assert.Equal((decimal?)0.07m, fresh.AverageCost);
    }

    [Fact]
    public void A_transfer_moves_only_what_the_location_has_inside_one_branch_numbered_by_its_year()
    {
        var branch = Guid.NewGuid();
        var store = new InventoryLocation(Guid.NewGuid(), branch, "Main Store", null, LocationKind.MainStore);
        var kitchen = new InventoryLocation(Guid.NewGuid(), branch, "Hot Kitchen", "المطبخ الساخن", LocationKind.Kitchen);
        var elsewhere = new InventoryLocation(Guid.NewGuid(), Guid.NewGuid(), "Tanta store", null, LocationKind.MainStore);
        var flour = Flour();
        var oil = new RawMaterial("Oil", UnitOfMeasure.Millilitre);
        var onHand = new Dictionary<Guid, decimal> { [flour.Id] = 10_000 };
        var day = new DateOnly(2026, 11, 18);
        Assert.Equal("TR-2026-0007", InternalTransfer.NumberFor(2026, 7));

        InternalTransfer Post(InventoryLocation from, InventoryLocation to, params (RawMaterial, decimal)[] lines) =>
            InternalTransfer.Post(Guid.NewGuid(), "TR-2026-0001", branch, day, from, to, lines, onHand, " For the evening ", "Samir", "user-1").Transfer;

        Assert.Contains("the two are the same", Assert.Throws<DomainException>(() => Post(store, store, (flour, 1))).Message);
        Assert.Contains("inside one branch", Assert.Throws<DomainException>(() => Post(store, elsewhere, (flour, 1))).Message);
        Assert.Contains("at least one", Assert.Throws<DomainException>(() => Post(store, kitchen)).Message);
        Assert.Contains("twice", Assert.Throws<DomainException>(() => Post(store, kitchen, (flour, 1), (flour, 2))).Message);
        Assert.Contains("Main Store has 0 Millilitre of Oil", Assert.Throws<DomainException>(() => Post(store, kitchen, (oil, 1))).Message);
        Assert.Contains("not enough to move 12000", Assert.Throws<DomainException>(() => Post(store, kitchen, (flour, 12_000))).Message);
        kitchen.Change("Hot Kitchen", null, LocationKind.Kitchen, isActive: false);
        Assert.Contains("not in use", Assert.Throws<DomainException>(() => Post(store, kitchen, (flour, 1))).Message);
        kitchen.Change("Hot Kitchen", null, LocationKind.Kitchen, isActive: true);

        var (transfer, movements) = InternalTransfer.Post(
            Guid.NewGuid(), "TR-2026-0001", branch, day, store, kitchen, [(flour, 4_000)], onHand, " For the evening ", "Samir", "user-1");
        Assert.Equal(("TR-2026-0001", branch, InternalTransferStatus.Posted, "For the evening", 120m), (transfer.Number, transfer.BranchId, transfer.Status, transfer.Notes,
            transfer.TotalCost));
        var line = Assert.Single(transfer.Lines);
        Assert.Equal((4_000m, "Gram", 0.03m, 120m), (line.Quantity, line.Unit, line.UnitCostSnapshot, line.LineTotalCost));
        Assert.Equal([(store.Id, -4_000m, branch), (kitchen.Id, 4_000m, branch)], movements.Select(m => (m.LocationId, m.Quantity, m.BranchId)));
        transfer.Void("Omar");
        Assert.Equal((InternalTransferStatus.Voided, "Omar"), (transfer.Status, transfer.VoidedBy));
        Assert.Throws<DomainException>(() => transfer.Void("Omar"));
    }

    [Fact]
    public void A_location_serves_its_stations_once_each()
    {
        var kitchen = new InventoryLocation(Guid.NewGuid(), Branch.DefaultId, "Hot Kitchen", null, LocationKind.Kitchen);
        var grill = Guid.NewGuid();
        kitchen.Serve([grill, grill]);
        Assert.Equal([grill], kitchen.StationIds);
        kitchen.Serve([]);
        Assert.Empty(kitchen.StationIds);
    }
}
