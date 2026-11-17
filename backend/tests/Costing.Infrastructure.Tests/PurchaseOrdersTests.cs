using Microsoft.EntityFrameworkCore;
using Costing.Application.Approvals;
using Costing.Application.Purchases;
using Costing.Application.RawMaterials;
using Costing.Application.Suppliers;
using Costing.Domain.Approvals;
using Costing.Domain.Common;
using Costing.Domain.Purchases;
using Costing.Domain.RawMaterials;
using Costing.Infrastructure.Reports;

namespace Costing.Infrastructure.Tests;

// The order planner's quantities as a purchase order per supplier, approved by a manager, then
// received against the supplier's invoices with the 3-way match: a short delivery billed above the
// order's price waits for a manager before its stock goes in, the rest stays open as a backorder,
// the next delivery closes the order, and voiding it opens the order again.
public class PurchaseOrdersTests
{
    [Fact]
    public async Task From_the_planner_to_a_partial_overcharged_delivery_signed_off_then_closed()
    {
        await using var node = await TestSystem.StartAsync();
        var ct = TestContext.Current.CancellationToken;
        using var scope = node.Scope();
        var today = node.Service<IntelligenceService>(scope).Today;
        var tomatoes = (await node.Send(new CreateRawMaterialCommand("Tomatoes", UnitOfMeasure.Gram, PurchaseUnit: "kg", PurchaseUnitSize: 1000))).Id;
        var onions = (await node.Send(new CreateRawMaterialCommand("Onions", UnitOfMeasure.Gram, PurchaseUnit: "kg", PurchaseUnitSize: 1000,
            CostPerPurchaseUnit: 12))).Id;
        var nile = (await node.Send(new SaveSupplierCommand(Guid.NewGuid(), "Nile Farms", PaymentTermsDays: 30))).Id;
        var delta = (await node.Send(new SaveSupplierCommand(Guid.NewGuid(), "Delta Farms"))).Id;
        Task<decimal> OnHand(Guid id) => node.Db(db => db.RawMaterials.Where(m => m.Id == id).Select(m => m.QuantityOnHand).SingleAsync());

        // Nile Farms sold the tomatoes last, at 20 a kg; no one has sold onions yet.
        var earlier = Guid.NewGuid();
        await node.Send(new SavePurchaseInvoiceCommand(earlier, nile, "N-0", today, [new PurchaseInvoiceLineEntry(tomatoes, 1, "kg", 1000, 20)], "Boss",
            PurchasePaymentMethod.Credit));
        await node.Send(new PostPurchaseInvoiceCommand(earlier, "Boss"));

        // The planner's approved quantities: a purchase order for Nile Farms, the onions under no one.
        var plan = await node.Service<IntelligenceService>(scope).PurchaseOrderPlanAsync(
            new OrderSheetRequest([new(tomatoes, 10), new(onions, 5)], OrderSheetGrouping.Supplier), ct);
        Assert.Equal([("Nile Farms", 200m), (null, 60m)], plan.Orders.Select(o => (o.Supplier, o.Total)));
        Assert.Equal((30, 20m, true), (plan.Orders[0].PaymentTermsDays, plan.Orders[0].Lines[0].UnitPrice, plan.Orders[0].Lines[0].PriceKnown));

        // A cost controller writes them, the onions given to Nile Farms: a draft asked of a manager.
        var po = Guid.NewGuid();
        var input = new PurchaseOrderInput(nile, today, today.AddDays(1), PurchaseOrderTerms.Credit, null, [new(tomatoes, 10, 20), new(onions, 5, 12)]);
        var written = Assert.Single(await node.Send(new CreatePurchaseOrdersCommand([new NewPurchaseOrder(po, input)], "user-mona", "Mona", CanApprove: false)));
        Assert.Equal(($"PO-{today.Year}-0001", PurchaseOrderStatus.Draft, ApprovalOutcome.Requested), (written.PoNumber, written.Status, written.Outcome));
        // Locked meanwhile, and not received against until approved.
        await Assert.ThrowsAsync<DomainException>(() => node.Send(new SavePurchaseOrderCommand(po, input, "user-mona", "Mona")));
        var early = Guid.NewGuid();
        await Assert.ThrowsAsync<DomainException>(() => node.Send(new SavePurchaseInvoiceCommand(early, nile, "N-1", today,
            [new PurchaseInvoiceLineEntry(tomatoes, 6, "kg", 1000, 132)], "Mona", PurchasePaymentMethod.Credit, PurchaseOrderId: po)));
        await node.Send(new ApproveRequestCommand(written.Request!.Id, "Boss", "user-boss"));
        var order = (await node.Send(new GetPurchaseOrderQuery(po)))!;
        Assert.Equal((PurchaseOrderStatus.Approved, "Boss", 260m), (order.Status, order.ApprovedBy, order.ExpectedTotal));

        // 6 of the 10 kg come at 22 a kg (2.00 over, 12.00 in all) and the 5 kg of onions as ordered;
        // the rest of the tomatoes stays open. Over the order's price: it waits for a manager.
        var first = Guid.NewGuid();
        var draft = await node.Send(new SavePurchaseInvoiceCommand(first, nile, "N-1", today,
            [new PurchaseInvoiceLineEntry(tomatoes, 6, "kg", 1000, 132), new PurchaseInvoiceLineEntry(onions, 5, "kg", 1000, 60)], "Mona",
            PurchasePaymentMethod.Credit, PurchaseOrderId: po));
        var match = draft.PurchaseOrder!;
        Assert.Equal((12m, true, true), (match.Overcharge, match.HasShort, match.NeedsApproval));
        Assert.Equal([(MatchStatus.PriceOvercharge, 4m), (MatchStatus.Matched, 0m)], match.Lines!.Select(l => (l.Status, l.ShortBy)));
        var held = await node.Send(new PostPurchaseInvoiceCommand(first, "Mona", "user-mona", CanApprove: false));
        Assert.Equal((PurchaseInvoiceStatus.Draft, true), (held.Status, held.AwaitingApproval));
        Assert.Equal(1_000m, await OnHand(tomatoes));
        var asked = await node.Db(db => db.ApprovalRequests.SingleAsync(r => r.RecordId == first && r.Status == ApprovalStatus.Pending));
        Assert.Contains("overcharged", asked.Summary);
        Assert.Contains(asked.Changes, c => c.Label.StartsWith("Tomatoes · price per kg") && c.After!.Contains("12.00 in all"));
        await Assert.ThrowsAsync<DomainException>(() => node.Send(new SavePurchaseInvoiceCommand(first, nile, "N-1", today,
            [new PurchaseInvoiceLineEntry(tomatoes, 6, "kg", 1000, 120)], "Mona", PurchasePaymentMethod.Credit, PurchaseOrderId: po)));

        // Signed off: posted, its stock in, the order partly received.
        await node.Send(new ApproveRequestCommand(asked.Id, "Boss", "user-boss"));
        Assert.Equal((7_000m, 5_000m), (await OnHand(tomatoes), await OnHand(onions)));
        order = (await node.Send(new GetPurchaseOrderQuery(po)))!;
        Assert.Equal((PurchaseOrderStatus.PartiallyReceived, 6m, 4m, 5m, 0m),
            (order.Status, order.Lines[0].ReceivedPurchaseQty, order.Lines[0].RemainingQty, order.Lines[1].ReceivedPurchaseQty, order.Lines[1].RemainingQty));
        Assert.Equal((first, PurchaseInvoiceStatus.Posted), (order.Deliveries.Single().InvoiceId, order.Deliveries.Single().Status));

        // 3 of the 4 kg left, as ordered, closing the order: no manager needed, complete.
        var second = Guid.NewGuid();
        await node.Send(new SavePurchaseInvoiceCommand(second, nile, "N-2", today, [new PurchaseInvoiceLineEntry(tomatoes, 3, "kg", 1000, 60)], "Mona",
            PurchasePaymentMethod.Credit, PurchaseOrderId: po, ClosesPurchaseOrder: true));
        var posted = await node.Send(new PostPurchaseInvoiceCommand(second, "Mona", "user-mona", CanApprove: false));
        Assert.Equal(PurchaseInvoiceStatus.Posted, posted.Status);
        order = (await node.Send(new GetPurchaseOrderQuery(po)))!;
        Assert.Equal((PurchaseOrderStatus.Completed, 9m, 2), (order.Status, order.Lines[0].ReceivedPurchaseQty, order.Deliveries.Count));
        Assert.True(order.Deliveries.Single(d => d.InvoiceId == second).ClosedTheOrder);
        // Nothing more against it, and never from another supplier.
        var third = Guid.NewGuid();
        await Assert.ThrowsAsync<DomainException>(() => node.Send(new SavePurchaseInvoiceCommand(third, nile, "N-3", today,
            [new PurchaseInvoiceLineEntry(tomatoes, 1, "kg", 1000, 20)], "Mona", PurchasePaymentMethod.Credit, PurchaseOrderId: po)));
        await Assert.ThrowsAsync<DomainException>(() => node.Send(new SavePurchaseInvoiceCommand(third, delta, "D-1", today,
            [new PurchaseInvoiceLineEntry(tomatoes, 1, "kg", 1000, 20)], "Mona", PurchasePaymentMethod.Credit, PurchaseOrderId: po)));

        // The closing invoice voided: what it brought comes off, and the order is open again.
        await node.Send(new RequestDeletionCommand(Guid.NewGuid(), ApprovalModule.PurchaseInvoice, second, "Typed twice", "user-boss", "Boss", CanApprove: true));
        order = (await node.Send(new GetPurchaseOrderQuery(po)))!;
        Assert.Equal((PurchaseOrderStatus.PartiallyReceived, 6m, (DateTime?)null), (order.Status, order.Lines[0].ReceivedPurchaseQty, order.ClosedAtUtc));

        // A manager's order is approved at once; the daily batch receives it, the manager not asked.
        var po2 = Guid.NewGuid();
        var direct = Assert.Single(await node.Send(new CreatePurchaseOrdersCommand(
            [new NewPurchaseOrder(po2, input with { SupplierId = delta, Lines = [new(onions, 2, 12)] })], "user-boss", "Boss", CanApprove: true)));
        Assert.Equal(($"PO-{today.Year}-0002", PurchaseOrderStatus.Approved), (direct.PoNumber, direct.Status));
        await node.Send(new PostPurchaseBatchCommand(today, PurchasePaymentMethod.Credit, null,
            [new BatchInvoice(Guid.NewGuid(), delta, "D-1", [new PurchaseInvoiceLineEntry(onions, 3, "kg", 1000, 39)], PurchaseOrderId: po2)], "Boss", "user-boss"));
        var batched = (await node.Send(new GetPurchaseOrderQuery(po2)))!;
        Assert.Equal((PurchaseOrderStatus.Completed, 3m), (batched.Status, batched.Lines[0].ReceivedPurchaseQty));

        // The list: open, partly received, and the supplier's.
        var open = await node.Send(new GetPurchaseOrdersQuery(OpenOnly: true));
        Assert.Equal([po], open.Select(o => o.Id));
        Assert.Equal(69.2m, open[0].ReceivedPercent);

        // A draft called off.
        var po3 = Guid.NewGuid();
        await node.Send(new SavePurchaseOrderCommand(po3, input, "user-mona", "Mona"));
        Assert.Equal(PurchaseOrderStatus.Cancelled, (await node.Send(new CancelPurchaseOrderCommand(po3, "Mona", CanApprove: false))).Status);
    }
}
