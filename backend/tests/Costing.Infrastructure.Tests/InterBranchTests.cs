using Microsoft.EntityFrameworkCore;
using Costing.Application.Company;
using Costing.Application.InterBranch;
using Costing.Application.Purchases;
using Costing.Application.RawMaterials;
using Costing.Application.Suppliers;
using Costing.Domain.Common;
using Costing.Domain.Company;
using Costing.Domain.InterBranch;
using Costing.Domain.Purchases;
using Costing.Domain.RawMaterials;
using Costing.Domain.StockMovements;
using Costing.Infrastructure.Reports;

namespace Costing.Infrastructure.Tests;

// The central kitchen's hub on a real database: Tanta asks the central kitchen for tomato sauce;
// the kitchen sends five kilos from its store, which holds ten bought at L.E 100, billed at L.E 110;
// Tanta receives them into its own store, its average moved from its own L.E 80 by the L.E 110 it
// paid; the stock card names both invoices; and a manager's void takes all of it back.
public class InterBranchTests
{
    private static async Task BoughtAsync(TestSystem node, Guid branch, Guid supplier, Guid material, decimal kilos, decimal cost)
    {
        node.Branch.ChosenBranchId = branch;
        var id = Guid.NewGuid();
        await node.Send(new SavePurchaseInvoiceCommand(id, supplier, $"F-{id:N}"[..8], DateOnly.FromDateTime(DateTime.UtcNow),
            [new PurchaseInvoiceLineEntry(material, kilos, "kg", 1000, cost)], "Omar", PurchasePaymentMethod.Credit));
        await node.Send(new PostPurchaseInvoiceCommand(id, "Omar", "staff-omar"));
    }

    [Fact]
    public async Task Tanta_is_sent_sauce_by_the_central_kitchen_at_a_transfer_price_its_average_moves_and_a_void_takes_it_all_back()
    {
        await using var node = await TestSystem.StartAsync();
        var ct = TestContext.Current.CancellationToken;
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var sauce = (await node.Send(new CreateRawMaterialCommand("Tomato sauce", UnitOfMeasure.Gram, PurchaseUnit: "kg", PurchaseUnitSize: 1000))).Id;
        var supplier = (await node.Send(new SaveSupplierCommand(Guid.NewGuid(), "Nile Farms"))).Id;

        // Outside a central kitchen's company: nothing is asked.
        Assert.Contains("not run with a central kitchen", (await Assert.ThrowsAsync<DomainException>(() => node.Send(new SubmitRequisitionCommand(
            Guid.NewGuid(), Branch.DefaultId, null, [new RequisitionLineInput(sauce, 1)], null, "user-2", "Mona")))).Message);

        await node.Send(new ChangeOperatingModeCommand(SystemOperatingMode.MultiBranch_CentralKitchen, "user-1", "Wagdy"));
        var (kitchen, tanta) = (Guid.NewGuid(), Guid.NewGuid());
        await node.Send(new SaveBranchCommand(kitchen, "Central Kitchen", "المطبخ المركزي", BranchType.CentralKitchen));
        await node.Send(new SaveBranchCommand(tanta, "Tanta", "طنطا", BranchType.Restaurant));
        var stores = await node.Db(db => db.InventoryLocations.Where(l => l.BranchId == kitchen || l.BranchId == tanta)
            .ToDictionaryAsync(l => l.BranchId, l => l.Id, ct));

        // Tanta's own five kilos at L.E 80; the kitchen's ten at L.E 100.
        await BoughtAsync(node, tanta, supplier, sauce, 5, 400);
        await BoughtAsync(node, kitchen, supplier, sauce, 10, 1_000);
        async Task<decimal?> Mac(Guid branch) =>
            await node.Db(db => db.MaterialBranchStocks.Where(s => s.RawMaterialId == sauce && s.BranchId == branch).Select(s => s.AverageCost).SingleAsync(ct));
        async Task<decimal> Held(Guid branch, Guid location) =>
            await node.Db(db => db.StockMovements.Where(m => m.RawMaterialId == sauce && m.BranchId == branch && m.LocationId == location).SumAsync(m => m.Quantity, ct));
        Assert.Equal(((decimal?)0.08m, (decimal?)0.1m), (await Mac(tanta), await Mac(kitchen)));

        // Tanta asks for five kilos.
        node.Branch.ChosenBranchId = tanta;
        var asked = await node.Send(new SubmitRequisitionCommand(
            Guid.NewGuid(), kitchen, today.AddDays(1), [new RequisitionLineInput(sauce, 5_000)], "For the weekend", "user-2", "Mona"));
        Assert.Equal($"REQ-{today.Year}-0001", asked.Number);

        // The kitchen: twelve kilos refused; five sent at L.E 110 a kilo.
        node.Branch.ChosenBranchId = kitchen;
        DispatchShipmentCommand Dispatch(decimal grams) => new(
            Guid.NewGuid(), asked.Id, null, null, TransferPricing.WithMarkupOrCustomPrice, null, [new DispatchLineInput(sauce, grams, 0.11m)], null, "user-3", "Hany");
        Assert.Contains("not enough to send 12000", (await Assert.ThrowsAsync<DomainException>(() => node.Send(Dispatch(12_000)))).Message);
        var sent = await node.Send(Dispatch(5_000));
        Assert.Equal(($"ISI-{today.Year}-0001", (decimal?)550m, (decimal?)500m, (decimal?)50m),
            (sent.Number, sent.TotalTransferRevenue, sent.TotalInternalCogs, sent.InternalMargin));
        Assert.Equal((5_000m, (decimal?)0.1m), (await Held(kitchen, stores[kitchen]), await Mac(kitchen)));

        // Tanta receives it into its store: ten kilos, at (400 + 550) / 10 kg = L.E 95 a kilo.
        node.Branch.ChosenBranchId = tanta;
        var received = await node.Send(new ReceiveShipmentCommand(Guid.NewGuid(), sent.Id, null, null, null, "user-2", "Mona"));
        Assert.Equal(($"IPI-{today.Year}-0001", (decimal?)550m), (received.Number, received.TotalBilled));
        Assert.Equal((10_000m, (decimal?)0.095m), (await Held(tanta, stores[tanta]), await Mac(tanta)));
        var hub = await node.Send(new GetInterBranchHubQuery(today.AddDays(-30), today));
        Assert.Equal((RequisitionStatus.Received, 1, 0), (hub.Requisitions.Single().Status, hub.Summary.ReceiptsThisMonth, hub.Summary.ShipmentsInTransit));

        // The stock card: out on the kitchen's invoice, in on Tanta's.
        using (var scope = node.Scope())
        {
            var card = await node.Service<StockCardService>(scope).GetAsync(sauce, today, today, StockCardMovementType.InterBranch, ct);
            Assert.Equal([$"Dispatch {sent.Number} · صرف لفرع", $"Receipt {received.Number} · استلام من المركزي"], card.Lines.Select(l => l.Reference));
            Assert.Equal(["To Tanta", "From Central Kitchen"], card.Lines.Select(l => l.Details));
        }

        // A manager voids the receipt: both invoices; Tanta back to its five kilos at L.E 80, the kitchen to its ten.
        await node.Send(new VoidReceiptCommand(received.Id, "Wagdy"));
        Assert.Equal((5_000m, (decimal?)0.08m), (await Held(tanta, stores[tanta]), await Mac(tanta)));
        Assert.Equal(10_000m, await Held(kitchen, stores[kitchen]));
        var statuses = await node.Db(async db => (
            (await db.InternalSalesInvoices.SingleAsync(ct)).Status, (await db.InternalPurchaseInvoices.SingleAsync(ct)).Status,
            (await db.InterBranchRequisitions.SingleAsync(ct)).Status));
        Assert.Equal((ShipmentStatus.Voided, InternalPurchaseInvoiceStatus.Voided, RequisitionStatus.Submitted), statuses);
        Assert.Equal(15_000m, await node.Db(db => db.RawMaterials.Where(m => m.Id == sauce).Select(m => m.QuantityOnHand).SingleAsync(ct)));
    }
}
