using Costing.Domain.Common;
using Costing.Domain.Purchases;
using Costing.Domain.RawMaterials;
using Costing.Domain.StockMovements;

namespace Costing.Domain.Tests;

// A supplier's invoice in two steps: entered as written and kept as a draft, which moves nothing;
// then posted, which takes the stock in at the material's own units and moves the average cost.
public class PurchaseInvoiceTests
{
    private static PurchaseInvoiceLineEntry Kg(RawMaterial material, decimal kg, decimal? cost) => new(material.Id, kg, "kg", 1000, cost);

    [Fact]
    public void A_draft_keeps_the_lines_as_written_and_moves_no_stock()
    {
        var tomatoes = new RawMaterial("Tomatoes", UnitOfMeasure.Gram);
        var oil = new RawMaterial("Frying oil", UnitOfMeasure.Millilitre);
        var invoice = new PurchaseInvoice(Guid.NewGuid(), "Omar");
        var nileFarms = Guid.NewGuid();

        invoice.Record(nileFarms, " F-1001 ", new DateOnly(2026, 10, 7),
            [Kg(tomatoes, 5, 100), new PurchaseInvoiceLineEntry(oil.Id, 0.1m, "L", 1000, 9.5m)], PurchasePaymentMethod.Safe);

        Assert.Equal((PurchaseInvoiceStatus.Draft, (Guid?)nileFarms, "F-1001", 109.5m), (invoice.Status, invoice.SupplierId, invoice.SupplierInvoiceNumber, invoice.Total));
        Assert.Equal([(5m, "kg", 5000m), (0.1m, "L", 100m)], invoice.Lines.Select(l => (l.EnteredQuantity, l.UnitLabel, l.Quantity)));
        Assert.Equal((0m, (decimal?)null), (tomatoes.QuantityOnHand, tomatoes.AverageCost));
    }

    [Fact]
    public void Posting_takes_the_stock_in_and_moves_the_average_cost_once()
    {
        var tomatoes = new RawMaterial("Tomatoes", UnitOfMeasure.Gram);
        var invoice = new PurchaseInvoice(Guid.NewGuid(), "Omar");
        invoice.Record(Guid.NewGuid(), null, null, [Kg(tomatoes, 5, 100)], PurchasePaymentMethod.Safe);

        var movements = invoice.Post(new Dictionary<Guid, RawMaterial> { [tomatoes.Id] = tomatoes }, "Omar");

        Assert.Equal((PurchaseInvoiceStatus.Posted, "Omar"), (invoice.Status, invoice.PostedBy));
        Assert.Equal((5000m, 0.02m, 20m), (tomatoes.QuantityOnHand, tomatoes.AverageCost, tomatoes.CostPerPurchaseUnit));
        var movement = Assert.Single(movements);
        Assert.Equal((StockMovementReason.Purchase, invoice.Id, 5000m), (movement.Reason, movement.SourceId, movement.Quantity));

        Assert.Throws<DomainException>(() => invoice.Post(new Dictionary<Guid, RawMaterial> { [tomatoes.Id] = tomatoes }, "Omar"));
        Assert.Throws<DomainException>(() => invoice.Record(Guid.NewGuid(), null, null, [Kg(tomatoes, 1, 10)], PurchasePaymentMethod.Safe));
        Assert.Equal(5000m, tomatoes.QuantityOnHand);
    }

    // An expense line beside the stock: in the invoice's total, split out as expenses, and posting
    // takes only the stock in. An expense is always its amount, in its own units.
    [Fact]
    public void Expense_lines_are_their_cost_and_take_no_stock()
    {
        var tomatoes = new RawMaterial("Tomatoes", UnitOfMeasure.Gram);
        var cleaning = Guid.NewGuid();
        var invoice = new PurchaseInvoice(Guid.NewGuid(), "Omar");

        invoice.Record(null, null, null,
            [Kg(tomatoes, 5, 100), new PurchaseInvoiceLineEntry(null, 4, " bottle ", 250, 80, PurchaseItemType.Expense, cleaning)], PurchasePaymentMethod.Safe);
        var expense = invoice.Lines.Single(l => l.ItemType == PurchaseItemType.Expense);
        Assert.Equal(((Guid?)null, (Guid?)cleaning, 4m, "bottle", 1m, 4m), (expense.RawMaterialId, expense.ExpenseItemId, expense.EnteredQuantity, expense.UnitLabel, expense.UnitSize, expense.Quantity));
        Assert.Equal((100m, 80m, 180m), (invoice.InventoryTotal, invoice.ExpenseTotal, invoice.Total));

        var movement = Assert.Single(invoice.Post(new Dictionary<Guid, RawMaterial> { [tomatoes.Id] = tomatoes }, "Omar"));
        Assert.Equal((tomatoes.Id, 5000m), (movement.RawMaterialId, movement.Quantity));

        var other = new PurchaseInvoice(Guid.NewGuid(), "Omar");
        PurchaseInvoiceLineEntry Expense(Guid? item, decimal? cost, Guid? material = null) => new(material, 1, null, 1, cost, PurchaseItemType.Expense, item);
        Assert.Throws<DomainException>(() => other.Record(null, null, null, [Expense(cleaning, null)]));
        Assert.Throws<DomainException>(() => other.Record(null, null, null, [Expense(null, 10)]));
        Assert.Throws<DomainException>(() => other.Record(null, null, null, [Expense(cleaning, 10, tomatoes.Id)]));
        Assert.Throws<DomainException>(() => other.Record(null, null, null, [Expense(cleaning, 10), Expense(cleaning, 20)]));
        Assert.Throws<DomainException>(() => other.Record(null, null, null, [new(null, 1, "kg", 1000, 10)]));
        // Expenses only: posted, and nothing moves.
        other.Record(null, null, null, [Expense(cleaning, 10)], PurchasePaymentMethod.Safe);
        Assert.Empty(other.Post(new Dictionary<Guid, RawMaterial>(), "Omar"));
    }

    [Fact]
    public void An_invoice_refuses_what_cannot_be_on_it()
    {
        var tomatoes = new RawMaterial("Tomatoes", UnitOfMeasure.Gram);
        var invoice = new PurchaseInvoice(Guid.NewGuid(), "Omar");

        Assert.Throws<DomainException>(() => invoice.Record(null, null, null, [Kg(tomatoes, 1, 10), Kg(tomatoes, 2, 20)], PurchasePaymentMethod.Safe));
        Assert.Throws<DomainException>(() => invoice.Record(null, null, null, [Kg(tomatoes, 0, 10)], PurchasePaymentMethod.Safe));
        Assert.Throws<DomainException>(() => invoice.Record(null, null, null, [Kg(tomatoes, 1, -1)], PurchasePaymentMethod.Safe));
        Assert.Throws<DomainException>(() => invoice.Post(new Dictionary<Guid, RawMaterial>(), "Omar"));
    }

    // A receipt with discounts: a line's own off that line, the invoice's shared among the priced
    // lines by what each comes to after its own. What is paid and what goes into the average cost
    // are the net, never the price before the discount.
    [Fact]
    public void Discounts_come_off_what_is_paid_and_what_the_stock_cost()
    {
        var tomatoes = new RawMaterial("Tomatoes", UnitOfMeasure.Gram);
        var oil = new RawMaterial("Frying oil", UnitOfMeasure.Millilitre);
        var cleaning = Guid.NewGuid();
        var invoice = new PurchaseInvoice(Guid.NewGuid(), "Omar");

        invoice.Record(null, null, null,
        [
            Kg(tomatoes, 5, 100) with { Discount = 10 },
            new PurchaseInvoiceLineEntry(oil.Id, 2, "L", 1000, 50),
            new PurchaseInvoiceLineEntry(null, 1, null, 1, 60, PurchaseItemType.Expense, cleaning),
        ], PurchasePaymentMethod.Safe, discount: 20);

        // 90, 50 and 60 after the line's own: 200, of which 20 off is 9, 5 and 6.
        Assert.Equal(
            [(100m, 10m, 9m, 81m), (50m, 0m, 5m, 45m), (60m, 0m, 6m, 54m)],
            invoice.Lines.Select(l => (l.LineTotal!.Value, l.Discount, l.DiscountShare, l.Cost!.Value)));
        Assert.Equal((210m, 10m, 20m, 180m), (invoice.Subtotal, invoice.LineDiscounts, invoice.Discount, invoice.Total));
        Assert.Equal((126m, 54m), (invoice.InventoryTotal, invoice.ExpenseTotal));

        invoice.Post(new Dictionary<Guid, RawMaterial> { [tomatoes.Id] = tomatoes, [oil.Id] = oil }, "Omar");
        // L.E 81 for 5 kg: 16.20 a kg, not the 20 written on the paper.
        Assert.Equal((0.0162m, 16.2m), (tomatoes.AverageCost, tomatoes.CostPerPurchaseUnit));
        Assert.Equal(0.0225m, oil.AverageCost);
    }

    // Shared to the piastre, the piastre left over to the first line; a line with no price, or none
    // left after its own discount, takes no share.
    [Fact]
    public void The_invoice_discount_is_shared_to_the_piastre()
    {
        RawMaterial Material(string name) => new(name, UnitOfMeasure.Gram);
        var (a, b, c, d) = (Material("A"), Material("B"), Material("C"), Material("D"));
        var invoice = new PurchaseInvoice(Guid.NewGuid(), "Omar");

        invoice.Record(null, null, null,
            [Kg(a, 1, 10), Kg(b, 1, 10), Kg(c, 1, 10), Kg(d, 1, null), Kg(Material("E"), 1, 5) with { Discount = 5 }],
            PurchasePaymentMethod.Safe, discount: 10);

        Assert.Equal([3.34m, 3.33m, 3.33m, 0m, 0m], invoice.Lines.Select(l => l.DiscountShare));
        Assert.Equal([6.66m, 6.67m, 6.67m, null, 0m], invoice.Lines.Select(l => l.Cost));
        Assert.Equal((35m, 20m), (invoice.Subtotal, invoice.Total));

        // Recorded again without one: as written.
        invoice.Record(null, null, null, [Kg(a, 1, 10)], PurchasePaymentMethod.Safe);
        Assert.Equal((0m, 0m, 10m), (invoice.Discount, invoice.Lines.Single().DiscountShare, invoice.Total));
    }

    [Fact]
    public void A_discount_is_never_more_than_what_it_comes_off()
    {
        var tomatoes = new RawMaterial("Tomatoes", UnitOfMeasure.Gram);
        var invoice = new PurchaseInvoice(Guid.NewGuid(), "Omar");
        void Record(PurchaseInvoiceLineEntry line, decimal discount = 0) => invoice.Record(null, null, null, [line], PurchasePaymentMethod.Safe, discount: discount);

        Assert.Throws<DomainException>(() => Record(Kg(tomatoes, 1, 10) with { Discount = -1 }));
        Assert.Throws<DomainException>(() => Record(Kg(tomatoes, 1, 10) with { Discount = 10.01m }));
        Assert.Throws<DomainException>(() => Record(Kg(tomatoes, 1, null) with { Discount = 1 }));
        Assert.Throws<DomainException>(() => Record(Kg(tomatoes, 1, 10), -1));
        Assert.Throws<DomainException>(() => Record(Kg(tomatoes, 1, 10) with { Discount = 4 }, 6.01m));
        Assert.Throws<DomainException>(() => Record(Kg(tomatoes, 1, null), 1));
        Assert.Empty(invoice.Lines);

        // All of it off: a gift, at nothing.
        Record(Kg(tomatoes, 1, 10) with { Discount = 4 }, 6);
        Assert.Equal(0m, invoice.Total);
    }

    // The paper can be replaced while the invoice is a draft. Once posted, a missing one can still
    // be added, but one attached stays as it is.
    [Fact]
    public void The_attached_paper_is_kept_once_the_invoice_is_posted()
    {
        var tomatoes = new RawMaterial("Tomatoes", UnitOfMeasure.Gram);
        var invoice = new PurchaseInvoice(Guid.NewGuid(), "Omar");
        invoice.Record(null, null, null, [Kg(tomatoes, 1, 20)], PurchasePaymentMethod.Safe);

        Assert.Throws<DomainException>(() => invoice.Attach("invoice.svg", "image/svg+xml", 100, "Omar"));
        Assert.Throws<DomainException>(() => invoice.Attach("huge.jpg", "image/jpeg", PurchaseInvoice.MaxAttachmentBytes + 1, "Omar"));
        invoice.Attach("first.jpg", "image/jpeg", 1000, "Omar");
        invoice.Attach("../../second.pdf", "application/pdf", 2000, "Omar");
        Assert.Equal(("second.pdf", "application/pdf", 2000), (invoice.AttachmentFileName, invoice.AttachmentContentType, invoice.AttachmentBytes));

        invoice.Post(new Dictionary<Guid, RawMaterial> { [tomatoes.Id] = tomatoes }, "Omar");
        Assert.Throws<DomainException>(() => invoice.Attach("third.png", "image/png", 3000, "Omar"));

        var forgotten = new PurchaseInvoice(Guid.NewGuid(), "Omar");
        forgotten.Record(null, null, null, [Kg(tomatoes, 1, 20)], PurchasePaymentMethod.Safe);
        forgotten.Post(new Dictionary<Guid, RawMaterial> { [tomatoes.Id] = tomatoes }, "Omar");
        forgotten.Attach("late.jpg", "image/jpeg", 1000, "Sara");
        Assert.True(forgotten.HasAttachment);
    }
}
