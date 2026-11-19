using Costing.Domain.Common;
using Costing.Domain.Company;
using Costing.Domain.InterBranch;
using Costing.Domain.RawMaterials;
using Costing.Domain.StockMovements;

namespace Costing.Domain.Tests;

// The central kitchen's hub: a restaurant asks its central kitchen for goods; the kitchen sends
// only what its location holds, billed at its average cost or a transfer price; the branch receives
// it at that price, what did not arrive explained and kept as a transit loss; voided, both sides
// go back; and the requisition follows its shipments.
public class InterBranchTests
{
    private static readonly DateOnly Day = new(2026, 11, 18);
    private readonly Branch _kitchen = new(Guid.NewGuid(), "Central Kitchen", "المطبخ المركزي", BranchType.CentralKitchen);
    private readonly Branch _tanta = new(Guid.NewGuid(), "Tanta", "طنطا", BranchType.Restaurant);
    private readonly Branch _sidiGaber = new(Guid.NewGuid(), "Otantik - Sidi Gaber", null, BranchType.Restaurant);
    private readonly InventoryLocation _store;
    private readonly InventoryLocation _tantaStore;

    public InterBranchTests()
    {
        _store = new InventoryLocation(Guid.NewGuid(), _kitchen.Id, "Central Store", null, LocationKind.MainStore);
        _tantaStore = new InventoryLocation(Guid.NewGuid(), _tanta.Id, "Tanta store", null, LocationKind.MainStore);
    }

    // Ten kilos of sauce at L.E 100 a kilo: 0.1 a gram.
    private static RawMaterial Sauce()
    {
        var sauce = new RawMaterial("Tomato sauce", UnitOfMeasure.Gram);
        sauce.ReceivePurchase(10_000, Guid.NewGuid(), 1_000);
        return sauce;
    }

    private InterBranchRequisition Asked(RawMaterial material, decimal grams) =>
        InterBranchRequisition.Submit(Guid.NewGuid(), "REQ-2026-0001", _tanta, _kitchen, Day, Day.AddDays(1), [(material, grams, "For the weekend")],
            " Before noon ", "Mona", "user-2");

    private (InternalSalesInvoice Invoice, IReadOnlyList<StockMovement> Movements) Sent(
        RawMaterial material, decimal grams, InterBranchRequisition? requisition = null, TransferPricing pricing = TransferPricing.WithMarkupOrCustomPrice,
        decimal? markup = 10, decimal? price = null, decimal? held = null) =>
        InternalSalesInvoice.Dispatch(
            Guid.NewGuid(), "ISI-2026-0001", _kitchen, _tanta, requisition, Day, _store, [new(material, grams, price)], pricing, markup,
            new Dictionary<Guid, decimal> { [material.Id] = held ?? 10_000 }, null, "Hany", "user-3");

    [Fact]
    public void A_restaurant_asks_its_central_kitchen_and_only_a_central_kitchen_or_warehouse()
    {
        var sauce = Sauce();
        Assert.Equal("REQ-2026-0007", InterBranchRequisition.NumberFor(2026, 7));
        var asked = Asked(sauce, 4_000);
        Assert.Equal((_tanta.Id, _kitchen.Id, RequisitionStatus.Submitted, "Before noon", 4_000m, "Gram"),
            (asked.RequestingBranchId, asked.SupplyingBranchId, asked.Status, asked.Notes, asked.Lines[0].RequestedQuantity, asked.Lines[0].Unit));

        InterBranchRequisition Ask(Branch from, Branch of, decimal grams = 1, DateOnly? by = null, params RawMaterial[] more) =>
            InterBranchRequisition.Submit(Guid.NewGuid(), "REQ-2026-0002", from, of, Day, by,
                [(sauce, grams, null), .. more.Select(m => (m, 1m, (string?)null))], null, "Mona", null);
        Assert.Contains("is a restaurant", Assert.Throws<DomainException>(() => Ask(_tanta, _sidiGaber)).Message);
        Assert.Contains("cannot ask itself", Assert.Throws<DomainException>(() => Ask(_kitchen, _kitchen)).Message);
        Assert.Contains("more than nothing", Assert.Throws<DomainException>(() => Ask(_tanta, _kitchen, 0)).Message);
        Assert.Contains("before today", Assert.Throws<DomainException>(() => Ask(_tanta, _kitchen, by: Day.AddDays(-1))).Message);
        Assert.Contains("twice", Assert.Throws<DomainException>(() => Ask(_tanta, _kitchen, more: sauce)).Message);
        var warehouse = new Branch(Guid.NewGuid(), "Central Warehouse", null, BranchType.CentralWarehouse);
        Assert.Equal(warehouse.Id, Ask(_tanta, warehouse).SupplyingBranchId);

        // Called off while nothing is sent; once.
        asked.Cancel("Mona");
        Assert.Equal((RequisitionStatus.Cancelled, "Mona"), (asked.Status, asked.CancelledBy));
        Assert.Contains("already been cancelled", Assert.Throws<DomainException>(() => asked.Cancel("Mona")).Message);
    }

    [Fact]
    public void The_kitchen_sends_only_what_its_location_holds_billed_at_a_transfer_price_over_its_cost()
    {
        var sauce = Sauce();
        Assert.Equal("ISI-2026-0003", InternalSalesInvoice.NumberFor(2026, 3));
        Assert.Contains("Central Store has 10000 Gram of Tomato sauce: not enough to send 12000",
            Assert.Throws<DomainException>(() => Sent(sauce, 12_000)).Message);
        Assert.Equal(10_000m, sauce.QuantityOnHand);

        // Four kilos at L.E 100 a kilo, billed at 10% more: L.E 110 a kilo.
        var (invoice, movements) = Sent(sauce, 4_000);
        var line = Assert.Single(invoice.Lines);
        Assert.Equal((4_000m, 0.1m, 0.11m, 440m, 400m), (line.Quantity, line.UnitCost, line.TransferUnitPrice, line.LineRevenue, line.LineCogs));
        Assert.Equal((440m, 400m, 40m, true, ShipmentStatus.InTransit, (decimal?)10m),
            (invoice.TotalTransferRevenue, invoice.TotalInternalCogs, invoice.InternalMargin, invoice.IsInterCompany, invoice.Status, invoice.MarkupPercent));
        var taken = Assert.Single(movements);
        Assert.Equal((-4_000m, StockMovementReason.InterBranchDispatchOut, _store.Id, _kitchen.Id, (decimal?)0.1m),
            (taken.Quantity, taken.Reason, taken.LocationId, taken.BranchId, taken.UnitCost));
        Assert.Equal(6_000m, sauce.QuantityOnHand);

        // A price given for the line; at cost, whatever is given, the cost.
        Assert.Equal(0.12m, Sent(sauce, 1_000, price: 0.12m).Invoice.Lines[0].TransferUnitPrice);
        var atCost = Sent(sauce, 1_000, pricing: TransferPricing.AtCost, price: 0.5m).Invoice;
        Assert.Equal((0.1m, 0m, (decimal?)null), (atCost.Lines[0].TransferUnitPrice, atCost.InternalMargin, atCost.MarkupPercent));
        Assert.Contains("between 0% and 1000%", Assert.Throws<DomainException>(() => Sent(sauce, 1_000, markup: -5)).Message);

        // Only a central kitchen or warehouse sends; never to itself; from its own location.
        Assert.Contains("is a restaurant", Assert.Throws<DomainException>(() => InternalSalesInvoice.Dispatch(
            Guid.NewGuid(), "ISI-2026-0009", _tanta, _sidiGaber, null, Day, _tantaStore, [new(sauce, 1)], TransferPricing.AtCost, null,
            new Dictionary<Guid, decimal> { [sauce.Id] = 10 }, null, "Hany", null)).Message);
        Assert.Contains("another branch's", Assert.Throws<DomainException>(() => InternalSalesInvoice.Dispatch(
            Guid.NewGuid(), "ISI-2026-0009", _kitchen, _tanta, null, Day, _tantaStore, [new(sauce, 1)], TransferPricing.AtCost, null,
            new Dictionary<Guid, decimal> { [sauce.Id] = 10 }, null, "Hany", null)).Message);
        var unpriced = new RawMaterial("Saffron", UnitOfMeasure.Gram);
        Assert.Contains("no cost yet", Assert.Throws<DomainException>(() => Sent(unpriced, 1, held: 5)).Message);
    }

    [Fact]
    public void The_branch_receives_it_at_the_price_billed_and_what_did_not_arrive_is_a_transit_loss_explained()
    {
        var sauce = Sauce();
        var asked = Asked(sauce, 4_000);
        var (shipment, _) = Sent(sauce, 4_000, asked);
        asked.Restate([shipment]);
        Assert.Equal((RequisitionStatus.Dispatched, 4_000m), (asked.Status, asked.Lines[0].DispatchedQuantity));
        Assert.Contains("is not on REQ-2026-0001", Assert.Throws<DomainException>(() => Sent(Sauce(), 1_000, asked)).Message);

        var materials = new Dictionary<Guid, RawMaterial> { [sauce.Id] = sauce };
        InternalPurchaseInvoice Receive(Branch at, InventoryLocation into, decimal? grams, string? notes) =>
            InternalPurchaseInvoice.Receive(Guid.NewGuid(), "IPI-2026-0001", shipment, at, into, materials,
                grams is { } g ? new Dictionary<Guid, decimal> { [sauce.Id] = g } : new Dictionary<Guid, decimal>(), Day, notes, "Mona", "user-2").Invoice;
        Assert.Contains("goes to another branch", Assert.Throws<DomainException>(() => Receive(_sidiGaber, _tantaStore, null, null)).Message);
        Assert.Contains("another branch's", Assert.Throws<DomainException>(() => Receive(_tanta, _store, null, null)).Message);
        Assert.Contains("more than the 4000 sent", Assert.Throws<DomainException>(() => Receive(_tanta, _tantaStore, 4_500, null)).Message);
        Assert.Contains("say what happened", Assert.Throws<DomainException>(() => Receive(_tanta, _tantaStore, 3_500, null)).Message);
        Assert.Equal(ShipmentStatus.InTransit, shipment.Status);

        // 3.5 kg arrived, half a kilo spilled: billed for the four, into stock at L.E 110 a kilo.
        var (receipt, movements) = InternalPurchaseInvoice.Receive(Guid.NewGuid(), "IPI-2026-0001", shipment, _tanta, _tantaStore, materials,
            new Dictionary<Guid, decimal> { [sauce.Id] = 3_500 }, Day, "One tub split in the van", "Mona", "user-2");
        var put = Assert.Single(movements);
        Assert.Equal((3_500m, StockMovementReason.InterBranchReceiptIn, _tantaStore.Id, _tanta.Id, (decimal?)0.11m),
            (put.Quantity, put.Reason, put.LocationId, put.BranchId, put.UnitCost));
        Assert.Equal((440m, 385m, 55m, shipment.Id, asked.Id), (receipt.TotalBilled, receipt.TotalReceivedValue, receipt.TotalTransitLoss,
            receipt.InternalSalesInvoiceId, receipt.RequisitionId));
        Assert.Equal((4_000m, 3_500m, 500m), (receipt.Lines[0].DispatchedQuantity, receipt.Lines[0].ReceivedQuantity, receipt.Lines[0].ShortQuantity));
        Assert.Equal((ShipmentStatus.Received, (decimal?)3_500m, (Guid?)receipt.Id),
            (shipment.Status, shipment.Lines[0].ReceivedQuantity, shipment.InternalPurchaseInvoiceId));
        asked.Restate([shipment]);
        Assert.Equal((RequisitionStatus.Received, 3_500m), (asked.Status, asked.Lines[0].ReceivedQuantity));
        Assert.Contains("already been received", Assert.Throws<DomainException>(() => Receive(_tanta, _tantaStore, null, null)).Message);
        Assert.Contains("has been dispatched already", Assert.Throws<DomainException>(() => asked.Cancel("Mona")).Message);

        // Voided: the kitchen's invoice only with the receipt, by a manager; then both.
        Assert.Contains("voids its receipt", Assert.Throws<DomainException>(() => shipment.Void("Hany")).Message);
        receipt.Void(shipment, "Wagdy");
        Assert.Equal((InternalPurchaseInvoiceStatus.Voided, ShipmentStatus.Voided), (receipt.Status, shipment.Status));
        Assert.Contains("already been voided", Assert.Throws<DomainException>(() => receipt.Void(shipment, "Wagdy")).Message);
        asked.Restate([shipment]);
        Assert.Equal((RequisitionStatus.Submitted, 0m), (asked.Status, asked.Lines[0].DispatchedQuantity));
    }

    [Fact]
    public void A_requisition_partly_sent_stays_open_until_the_rest_follows()
    {
        var sauce = Sauce();
        var asked = Asked(sauce, 6_000);
        var (first, _) = Sent(sauce, 4_000, asked);
        asked.Restate([first]);
        Assert.Equal((RequisitionStatus.PartiallyDispatched, 2_000m), (asked.Status, asked.Outstanding(sauce.Id)));

        // Voided on its way: back to submitted, and voided once.
        first.Void("Hany");
        Assert.Contains("already been voided", Assert.Throws<DomainException>(() => first.Void("Hany")).Message);
        asked.Restate([first]);
        Assert.Equal(RequisitionStatus.Submitted, asked.Status);

        var (all, _) = Sent(sauce, 6_000, asked);
        asked.Restate([first, all]);
        Assert.Equal((RequisitionStatus.Dispatched, 0m), (asked.Status, asked.Outstanding(sauce.Id)));
    }

    [Fact]
    public void A_received_shipment_moves_the_branchs_average_and_its_void_takes_it_back_out()
    {
        // The branch's own stock: five kilos at L.E 90; received: five more at L.E 110.
        var sauce = new RawMaterial("Tomato sauce", UnitOfMeasure.Gram);
        sauce.ReceivePurchase(5_000, Guid.NewGuid(), 450);
        var put = sauce.ReceiveFromBranch(5_000, Guid.NewGuid(), 0.11m, _tantaStore.Id, "Mona");
        Assert.Equal((0.1m, 10_000m), (sauce.AverageCost, sauce.QuantityOnHand));
        sauce.Reverse(put, "Wagdy");
        Assert.Equal((0.09m, 5_000m), (sauce.AverageCost, sauce.QuantityOnHand));
        // A prep item is received too: the kitchen's sauces come in this way.
        var dough = new RawMaterial("Pizza dough", UnitOfMeasure.Gram, kind: MaterialKind.Prep);
        Assert.Equal(StockMovementReason.InterBranchReceiptIn, dough.ReceiveFromBranch(1_000, Guid.NewGuid(), 0.05m, _tantaStore.Id, "Mona").Reason);
    }
}
