using Costing.Domain.Common;
using Costing.Domain.Purchases;

namespace Costing.Domain.Tests;

// Purchase orders: drafted, approved, received against invoices (counted from them), closed or
// cancelled; and the 3-way match of a delivery against its order.
public class PurchaseOrderTests
{
    private static readonly Guid Tomatoes = Guid.NewGuid(), Onions = Guid.NewGuid(), Garlic = Guid.NewGuid();
    private static readonly DateOnly Today = new(2026, 11, 17);

    // 10 kg of tomatoes at 20 and 5 kg of onions at 12 from one supplier: 260.
    private static PurchaseOrder Order(int sequence = 1) => new(
        Guid.NewGuid(), sequence, Guid.NewGuid(), Today, Today.AddDays(1), PurchaseOrderTerms.Credit, "Morning delivery",
        [new(Tomatoes, 10, 20), new(Onions, 5, 12)], "user-omar", "Omar");

    [Fact]
    public void A_draft_is_numbered_by_its_year_written_freely_then_approved()
    {
        var order = Order(7);
        Assert.Equal(("PO-2026-0007", PurchaseOrderStatus.Draft, 260m, false), (order.PoNumber, order.Status, order.ExpectedTotal, order.IsOpen));

        // Rewritten while a draft: a line kept, one taken off, one added.
        order.Change(order.SupplierId, Today, null, PurchaseOrderTerms.Cash, null, [new(Tomatoes, 12, 19.5m), new(Garlic, 1, 80)]);
        Assert.Equal([(Tomatoes, 12m, 19.5m), (Garlic, 1m, 80m)], order.Lines.Select(l => (l.RawMaterialId, l.OrderedPurchaseQty, l.ExpectedUnitCost)));
        Assert.Throws<DomainException>(() => order.Change(order.SupplierId, Today, Today.AddDays(-1), PurchaseOrderTerms.Cash, null, [new(Tomatoes, 1, 1)]));
        Assert.Throws<DomainException>(() => order.Change(order.SupplierId, Today, null, PurchaseOrderTerms.Cash, null, [new(Tomatoes, 1, 1), new(Tomatoes, 2, 1)]));
        Assert.Throws<DomainException>(() => order.Change(order.SupplierId, Today, null, PurchaseOrderTerms.Cash, null, [new(Tomatoes, 0, 1)]));
        Assert.Throws<DomainException>(() => order.Change(order.SupplierId, Today, null, PurchaseOrderTerms.Cash, null, []));

        order.Approve("user-boss", "Boss");
        Assert.Equal((PurchaseOrderStatus.Approved, "Boss", true), (order.Status, order.ApprovedBy, order.IsOpen));
        Assert.Throws<DomainException>(() => order.Change(order.SupplierId, Today, null, PurchaseOrderTerms.Cash, null, [new(Tomatoes, 1, 1)]));
        Assert.Throws<DomainException>(() => order.Approve("user-boss", "Boss"));
    }

    [Fact]
    public void What_has_come_is_counted_from_its_invoices_and_it_is_complete_once_all_has_or_it_is_closed()
    {
        var order = Order();
        order.Approve("user-boss", "Boss");

        // 6 of the 10 kg of tomatoes: partly received, 4 kg and the onions still to come.
        order.Recount(new Dictionary<Guid, decimal> { [Tomatoes] = 6 });
        Assert.Equal((PurchaseOrderStatus.PartiallyReceived, 4m, 5m, 140m),
            (order.Status, order.LineFor(Tomatoes)!.RemainingQty, order.LineFor(Onions)!.RemainingQty, order.RemainingValue));
        Assert.Throws<DomainException>(() => order.Cancel("Omar"));

        // Everything: complete. The invoice voided, counted again: partly received once more.
        order.Recount(new Dictionary<Guid, decimal> { [Tomatoes] = 10, [Onions] = 5 });
        Assert.Equal(PurchaseOrderStatus.Completed, order.Status);
        order.Recount(new Dictionary<Guid, decimal> { [Tomatoes] = 6 });
        Assert.Equal(PurchaseOrderStatus.PartiallyReceived, order.Status);

        // Closed with what came, by an invoice: complete; that invoice voided, open again.
        var closer = Guid.NewGuid();
        order.Close("Mona", closer);
        Assert.Equal((PurchaseOrderStatus.Completed, closer), (order.Status, order.ClosedByInvoiceId));
        order.Recount(new Dictionary<Guid, decimal>(), closingInvoiceStands: false);
        Assert.Equal((PurchaseOrderStatus.Approved, (DateTime?)null), (order.Status, order.ClosedAtUtc));

        // Nothing has come: it can be called off.
        order.Cancel("Boss");
        Assert.Equal(PurchaseOrderStatus.Cancelled, order.Status);
        Assert.Throws<DomainException>(() => order.Close("Boss"));
    }

    [Fact]
    public void A_delivery_is_matched_against_what_was_left_to_come_at_the_price_ordered()
    {
        var order = Order();
        order.Approve("user-boss", "Boss");

        // As ordered: matched. A price within half a percent is still matched (20.09 against 20).
        var exact = ThreeWayMatch.Compare(order, [new(Tomatoes, 10, 200.9m), new(Onions, 5, 60)]);
        Assert.Equal([MatchStatus.Matched, MatchStatus.Matched], exact.Lines.Select(l => l.Status));
        Assert.Equal((0m, false, false), (exact.Overcharge, exact.NeedsApproval, exact.HasShort));

        // 6 kg of tomatoes at 22 (a 2.00 jump, 12.00 in all), 7 kg of onions (2 over), and garlic never ordered.
        var off = ThreeWayMatch.Compare(order, [new(Tomatoes, 6, 132), new(Onions, 7, 84), new(Garlic, 1, 80)]);
        var tomatoes = off.Lines.Single(l => l.RawMaterialId == Tomatoes);
        Assert.Equal((MatchStatus.PriceOvercharge, (decimal?)22m, (decimal?)2m, 12m, 4m, true),
            (tomatoes.Status, tomatoes.NetUnitPrice, tomatoes.UnitOvercharge, tomatoes.Overcharge, tomatoes.ShortBy, tomatoes.PriceOver));
        var onions = off.Lines.Single(l => l.RawMaterialId == Onions);
        Assert.Equal((MatchStatus.QtyOver, 2m, false), (onions.Status, onions.QtyOver, onions.PriceOver));
        Assert.Equal(MatchStatus.NotOrdered, off.Lines.Single(l => l.RawMaterialId == Garlic).Status);
        Assert.Equal((12m, 2m, true, true), (off.Overcharge, off.QtyOverLines, off.NeedsApproval, off.HasShort));

        // Short only (no onions at all): no manager needed, a backorder or a close.
        var short_ = ThreeWayMatch.Compare(order, [new(Tomatoes, 4, 80)]);
        Assert.Equal([MatchStatus.Short, MatchStatus.Short], short_.Lines.Select(l => l.Status));
        Assert.Equal((false, true), (short_.NeedsApproval, short_.HasShort));

        // What was left: after 6 kg came, 4 kg of tomatoes is all; 5 kg now is 1 over.
        order.Recount(new Dictionary<Guid, decimal> { [Tomatoes] = 6 });
        var rest = ThreeWayMatch.Compare(order, [new(Tomatoes, 5, 100), new(Onions, 5, 60)]);
        Assert.Equal((4m, 1m, MatchStatus.QtyOver), (rest.Lines[0].Remaining, rest.Lines[0].QtyOver, rest.Lines[0].Status));
    }
}
