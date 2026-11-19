using Costing.Application.InterBranch;
using Costing.Domain.Common;
using Costing.Domain.Company;
using Costing.Domain.InterBranch;
using Costing.Domain.RawMaterials;
using Costing.Domain.StockMovements;

namespace Costing.Application.Tests;

// The central kitchen's hub through its use cases, each in the branch chosen: Tanta asks the central
// kitchen; the kitchen sends it, never more than its store holds, at its cost plus a markup; Tanta
// receives it; the hub counts what is open, on its way and received, its billing only for whoever
// sees costs; the kitchen voids what is still on its way, a manager a received shipment. Outside a
// central kitchen's company, none of it.
public class InterBranchTests
{
    private readonly TestCosting _costing = new();
    private readonly Branch _kitchen = new(Guid.NewGuid(), "Central Kitchen", "المطبخ المركزي", BranchType.CentralKitchen);
    private readonly Branch _tanta = new(Guid.NewGuid(), "Tanta", "طنطا", BranchType.Restaurant);
    private readonly InventoryLocation _kitchenStore;
    private readonly InventoryLocation _tantaStore;
    private static DateOnly Today => DateOnly.FromDateTime(DateTime.UtcNow);

    public InterBranchTests()
    {
        _kitchenStore = new InventoryLocation(Guid.NewGuid(), _kitchen.Id, "Central Store", null, LocationKind.MainStore);
        _tantaStore = new InventoryLocation(Guid.NewGuid(), _tanta.Id, "Tanta store", null, LocationKind.MainStore);
    }

    private void CentralKitchen()
    {
        _costing.Profile.Set(_costing.Profile.Current with { OperatingMode = SystemOperatingMode.MultiBranch_CentralKitchen });
        _costing.Branches.All.AddRange([_kitchen, _tanta]);
        _costing.Locations.All.AddRange([_kitchenStore, _tantaStore]);
    }

    // Ten kilos of sauce in the kitchen's store, at L.E 100 a kilo there.
    private RawMaterial Sauce()
    {
        var sauce = new RawMaterial("Tomato sauce", UnitOfMeasure.Gram);
        _costing.Inventory.Add(sauce);
        var bought = sauce.ReceivePurchase(10_000, Guid.NewGuid(), 1_000);
        bought.AssignBranch(_kitchen.Id);
        bought.AssignLocation(_kitchenStore.Id);
        _costing.Inventory.Movements.Add(bought);
        _costing.Balances.Costs[(sauce.Id, _kitchen.Id)] = 0.1m;
        return sauce;
    }

    private Task<T> In<T>(Branch branch, Func<Task<T>> act)
    {
        _costing.CurrentBranch.Branch = branch.Id;
        return act();
    }

    private decimal Held(Branch branch, RawMaterial material) =>
        _costing.Inventory.Movements.All.Where(m => m.BranchId == branch.Id && m.RawMaterialId == material.Id).Sum(m => m.Quantity);

    private Task<RequisitionDto> Ask(RawMaterial material, decimal grams) =>
        In(_tanta, () => _costing.Send(new SubmitRequisitionCommand(
            Guid.NewGuid(), _kitchen.Id, Today.AddDays(1), [new RequisitionLineInput(material.Id, grams, "For the weekend")], "Before noon", "user-2", "Mona")));

    private Task<ShipmentDto> Send(RawMaterial material, decimal grams, Guid? requisition, bool seeCosts = true) =>
        In(_kitchen, () => _costing.Send(new DispatchShipmentCommand(
            Guid.NewGuid(), requisition, requisition is null ? _tanta.Id : null, null, TransferPricing.WithMarkupOrCustomPrice, 10,
            [new DispatchLineInput(material.Id, grams)], null, "user-3", "Hany", seeCosts)));

    private Task<ReceiptDto> Receive(Guid shipment, decimal? grams = null, string? notes = null, Guid? material = null) =>
        In(_tanta, () => _costing.Send(new ReceiveShipmentCommand(
            Guid.NewGuid(), shipment, null, grams is { } g ? [new ReceiptLineInput(material!.Value, g)] : null, notes, "user-2", "Mona")));

    [Fact]
    public async Task Outside_a_central_kitchens_company_nothing_is_asked_and_the_hub_is_empty()
    {
        var sauce = new RawMaterial("Tomato sauce", UnitOfMeasure.Gram);
        _costing.Inventory.Add(sauce);
        _costing.Branches.All.Add(_kitchen);
        Assert.Contains("not run with a central kitchen", (await Assert.ThrowsAsync<DomainException>(() => _costing.Send(new SubmitRequisitionCommand(
            Guid.NewGuid(), _kitchen.Id, null, [new RequisitionLineInput(sauce.Id, 1)], null, "user-2", "Mona")))).Message);
        var hub = await _costing.Send(new GetInterBranchHubQuery(Today.AddDays(-30), Today));
        Assert.Equal((SystemOperatingMode.SingleBranch_OpenSpace, 0, 0, 0), (hub.Mode, hub.Requisitions.Count, hub.Shipments.Count, hub.Receipts.Count));
    }

    [Fact]
    public async Task Tanta_asks_the_kitchen_sends_it_at_a_transfer_price_and_Tanta_receives_it()
    {
        CentralKitchen();
        var sauce = Sauce();
        var asked = await Ask(sauce, 4_000);
        Assert.Equal(($"REQ-{Today.Year}-0001", "Tanta", "Central Kitchen", RequisitionStatus.Submitted),
            (asked.Number, asked.RequestingBranch, asked.SupplyingBranch, asked.Status));

        // The kitchen sees it waiting; Tanta, a restaurant, sends nothing; nor the kitchen more than it has.
        var waiting = await In(_kitchen, () => _costing.Send(new GetInterBranchHubQuery(Today.AddDays(-30), Today)));
        Assert.Equal((BranchType.CentralKitchen, 1, asked.Number), (waiting.BranchType, waiting.Summary.OpenRequisitions, waiting.Requisitions.Single().Number));
        Assert.Contains("is a restaurant", (await Assert.ThrowsAsync<DomainException>(() => In(_tanta, () => _costing.Send(new DispatchShipmentCommand(
            Guid.NewGuid(), asked.Id, null, null, TransferPricing.AtCost, null, [new DispatchLineInput(sauce.Id, 1)], null, "user-2", "Mona"))))).Message);
        Assert.Contains("not enough to send 12000", (await Assert.ThrowsAsync<DomainException>(() => Send(sauce, 12_000, asked.Id))).Message);

        // Four kilos at L.E 100, billed at 10% more.
        var sent = await Send(sauce, 4_000, asked.Id);
        Assert.Equal(($"ISI-{Today.Year}-0001", asked.Number, ShipmentStatus.InTransit, (decimal?)440m, (decimal?)400m, (decimal?)40m, "Central Store"),
            (sent.Number, sent.RequisitionNumber, sent.Status, sent.TotalTransferRevenue, sent.TotalInternalCogs, sent.InternalMargin, sent.FromLocation));
        Assert.Equal((6_000m, RequisitionStatus.Dispatched), (Held(_kitchen, sauce), _costing.Requisitions.All.Single().Status));

        // On its way to Tanta; received there, all of it, into its own store.
        var incoming = await In(_tanta, () => _costing.Send(new GetInterBranchHubQuery(Today.AddDays(-30), Today)));
        Assert.Equal((1, 0), (incoming.Summary.ShipmentsInTransit, incoming.Summary.OpenRequisitions));
        Assert.Contains("goes to another branch", (await Assert.ThrowsAsync<DomainException>(() => In(_kitchen, () => _costing.Send(
            new ReceiveShipmentCommand(Guid.NewGuid(), sent.Id, null, null, null, "user-3", "Hany"))))).Message);
        var received = await Receive(sent.Id);
        Assert.Equal(($"IPI-{Today.Year}-0001", sent.Number, asked.Number, "Tanta store", (decimal?)440m, (decimal?)0m),
            (received.Number, received.ShipmentNumber, received.RequisitionNumber, received.ToLocation, received.TotalBilled, received.TotalTransitLoss));
        var put = _costing.Inventory.Movements.All.Single(m => m.Reason == StockMovementReason.InterBranchReceiptIn);
        Assert.Equal((4_000m, _tanta.Id, _tantaStore.Id, (decimal?)0.11m), (put.Quantity, put.BranchId, put.LocationId, put.UnitCost));
        Assert.Equal(RequisitionStatus.Received, _costing.Requisitions.All.Single().Status);

        // The hub after: one received this month, its billing for whoever sees costs only.
        var after = await In(_tanta, () => _costing.Send(new GetInterBranchHubQuery(Today.AddDays(-30), Today)));
        Assert.Equal((0, 1, (decimal?)440m), (after.Summary.ShipmentsInTransit, after.Summary.ReceiptsThisMonth, after.Summary.BillingThisMonth));
        var blind = await In(_tanta, () => _costing.Send(new GetInterBranchHubQuery(Today.AddDays(-30), Today, SeeCosts: false)));
        Assert.Equal(((decimal?)null, (decimal?)null, (decimal?)null, 4_000m), (blind.Summary.BillingThisMonth, blind.Shipments[0].Lines[0].TransferUnitPrice,
            blind.Receipts[0].TotalBilled, blind.Receipts[0].Lines[0].ReceivedQuantity));
    }

    [Fact]
    public async Task What_did_not_arrive_is_explained_and_the_kitchen_alone_voids_what_is_on_its_way()
    {
        CentralKitchen();
        var sauce = Sauce();
        var direct = await Send(sauce, 2_000, null);
        Assert.Equal(("Tanta", (string?)null), (direct.ReceivingBranch, direct.RequisitionNumber));
        Assert.Contains("say what happened", (await Assert.ThrowsAsync<DomainException>(() => Receive(direct.Id, 1_500, material: sauce.Id))).Message);
        var short_ = await Receive(direct.Id, 1_500, "A tub split in the van", sauce.Id);
        Assert.Equal(((decimal?)220m, (decimal?)165m, (decimal?)55m, 500m),
            (short_.TotalBilled, short_.TotalReceivedValue, short_.TotalTransitLoss, short_.Lines[0].ShortQuantity));
        Assert.Equal((8_000m, 1_500m), (Held(_kitchen, sauce), Held(_tanta, sauce)));

        // On its way: voided by the kitchen, not by Tanta; its requisition asked again.
        var asked = await Ask(sauce, 3_000);
        var sent = await Send(sauce, 3_000, asked.Id);
        Assert.Contains("voided there", (await Assert.ThrowsAsync<DomainException>(() => In(_tanta, () =>
            _costing.Send(new VoidShipmentCommand(sent.Id, "Mona"))))).Message);
        Assert.Equal(ShipmentStatus.Voided, (await In(_kitchen, () => _costing.Send(new VoidShipmentCommand(sent.Id, "Hany")))).Status);
        Assert.Equal((8_000m, RequisitionStatus.Submitted), (Held(_kitchen, sauce), _costing.Requisitions.All.Single(r => r.Id == asked.Id).Status));

        // Cancelled while nothing is on its way; not once something is.
        var cancelled = await In(_tanta, () => _costing.Send(new CancelRequisitionCommand(asked.Id, "Mona")));
        Assert.Equal(RequisitionStatus.Cancelled, cancelled.Status);
        Assert.Contains("has been cancelled", (await Assert.ThrowsAsync<DomainException>(() => Send(sauce, 1_000, asked.Id))).Message);

        // A received shipment voided by a manager: both invoices, both sides' stock.
        var again = await Send(sauce, 1_000, null);
        var receipt = await Receive(again.Id);
        Assert.Contains("voids its receipt", (await Assert.ThrowsAsync<DomainException>(() => In(_kitchen, () =>
            _costing.Send(new VoidShipmentCommand(again.Id, "Hany"))))).Message);
        var voided = await _costing.Send(new VoidReceiptCommand(receipt.Id, "Wagdy"));
        Assert.Equal(InternalPurchaseInvoiceStatus.Voided, voided.Status);
        Assert.Equal(ShipmentStatus.Voided, _costing.Shipments.All.Single(s => s.Id == again.Id).Status);
        Assert.Equal((8_000m, 1_500m), (Held(_kitchen, sauce), Held(_tanta, sauce)));
        Assert.All(_costing.Inventory.Movements.All.Where(m => m.IsReversal && m.Reason == StockMovementReason.InterBranchReceiptIn),
            m => Assert.Equal((_tanta.Id, _tantaStore.Id), (m.BranchId, m.LocationId)));
    }
}
