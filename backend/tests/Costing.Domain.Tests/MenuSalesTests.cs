using Costing.Domain.Access;
using Costing.Domain.Common;
using Costing.Domain.Menu;
using Costing.Domain.Sales;
using Costing.Domain.Staff;

namespace Costing.Domain.Tests;

// What the costs stand on without a point of sale: the menu, its sales, the staff the safe pays,
// and who works which section.
public class MenuSalesTests
{
    private static SalesReceiptLine Line(int quantity, decimal total, LineVoid voided = LineVoid.None) =>
        new(6101, null, "Margherita", null, quantity, total, [], voided);

    private static SalesReceipt Sale(IReadOnlyList<SalesReceiptLine> lines, decimal discount = 0, decimal delivery = 0, decimal tax = 0, decimal points = 0,
        decimal refunded = 0) =>
        new(Guid.NewGuid(), " R-1 ", new DateTime(2026, 10, 12, 11, 0, 0), new DateOnly(2026, 10, 12), SalesChannel.DineIn, PaymentMethod.Cash, lines,
            discount, delivery, tax, points, refunded, null, SalesSource.Entered, "Sara");

    [Fact]
    public void A_sale_adds_up_as_a_bill_does_the_lines_on_it_less_the_discount_with_tax_and_delivery_less_points()
    {
        var sale = Sale([Line(2, 280), Line(1, 140, LineVoid.BeforeKitchen)], discount: 20, delivery: 25, tax: 36.4m, points: 10, refunded: 50);

        Assert.Equal(("R-1", 280m, 311.4m, 50m), (sale.Reference, sale.BilledSubtotal, sale.TotalAmount, sale.RefundedAmount));
        Assert.Equal(DateTimeKind.Utc, sale.SoldAtUtc.Kind);

        void Refused(string why, Func<SalesReceipt> make) => Assert.Contains(why, Assert.Throws<DomainException>(() => make()).Message);
        Refused("at least one line", () => Sale([]));
        Refused("more than the items", () => Sale([Line(1, 100)], discount: 150));
        Refused("more than the bill", () => Sale([Line(1, 100)], points: 200));
        Refused("more than what was paid", () => Sale([Line(1, 100)], refunded: 150));
        Refused("cannot be negative", () => Sale([Line(1, 100)], tax: -1));
        Assert.Contains("at least one", Assert.Throws<DomainException>(() => Line(0, 100)).Message);

        sale.Void("Omar");
        Assert.Equal((true, "Omar"), (sale.IsVoided, sale.VoidedBy));
        Assert.Throws<DomainException>(() => sale.Void("Omar"));
    }

    [Fact]
    public void An_item_keeps_its_number_and_each_size_by_name_and_is_priced_by_its_add_ons_or_its_own()
    {
        var item = new MenuItem(6101, " Margherita ", "مارجريتا", "Pizza", 140, isPriceBasedOnAddons: false);
        item.SetVariants([("Medium", null, 160), ("Large", "كبير", 180)]);
        Assert.Equal((6101, "Margherita", 2), (item.Id, item.Name, item.Variants.Count));

        // A size renamed is a new one; one listed again keeps its place and price as given.
        item.SetVariants([("large", null, 190)]);
        var large = Assert.Single(item.Variants);
        Assert.Equal(("large", 190m, 0), (large.Name, large.Price, large.DisplayOrder));

        // Priced by its add-ons: no price of its own.
        item.Change("Mixed grill", null, "Grill", 300, isPriceBasedOnAddons: true);
        Assert.Equal(0, item.Price);
        item.SetAddOns([3, 1, 3]);
        Assert.Equal([1, 3], item.AddOnIds);

        Assert.Throws<DomainException>(() => new MenuItem(0, "Nothing", null, "Pizza", 10, false));
        Assert.Contains("two sizes", Assert.Throws<DomainException>(() => item.SetVariants([("Big", null, 1), ("big", null, 2)])).Message);
        Assert.Contains("negative", Assert.Throws<DomainException>(() => new AddOn("Cheese", null, -1)).Message);
        Assert.Contains("Name the item", Assert.Throws<DomainException>(() => item.Change(" ", null, "Grill", 1, false)).Message);
    }

    [Fact]
    public void Each_role_works_its_own_sections_until_a_manager_ticks_theirs()
    {
        Assert.Equal(CostingTabs.All, CostingTabSet.DefaultFor(UserRole.Manager));
        Assert.True(CostingTabSet.DefaultFor(UserRole.Storekeeper).HasFlag(CostingTabs.Counts));
        Assert.False(CostingTabSet.DefaultFor(UserRole.Storekeeper).HasAny(CostingTabs.Financials | CostingTabs.Reports));
        Assert.True(CostingTabSet.DefaultFor(UserRole.Accountant).HasFlag(CostingTabs.Financials));
        Assert.True(CostingTabSet.DefaultFor(UserRole.CostController).HasFlag(CostingTabs.Recipes));
        Assert.Equal(14, CostingTabSet.Each.Count);
        // The intelligence reports: the cost controller's and the accountant's, never the storekeeper's.
        Assert.True(CostingTabSet.DefaultFor(UserRole.CostController).HasFlag(CostingTabs.Intelligence));
        Assert.True(CostingTabSet.DefaultFor(UserRole.Accountant).HasFlag(CostingTabs.Intelligence));
        Assert.False(CostingTabSet.DefaultFor(UserRole.Storekeeper).HasFlag(CostingTabs.Intelligence));
        // The end of the day: handed in by the storekeeper or the accountant, not the cost controller.
        Assert.True(CostingTabSet.DefaultFor(UserRole.Storekeeper).HasFlag(CostingTabs.EndOfDay));
        Assert.True(CostingTabSet.DefaultFor(UserRole.Accountant).HasFlag(CostingTabs.EndOfDay));
        Assert.False(CostingTabSet.DefaultFor(UserRole.CostController).HasFlag(CostingTabs.EndOfDay));
        Assert.Equal(CostingTabs.All, CostingTabSet.Join(CostingTabSet.Each));
        Assert.Equal([CostingTabs.Materials, CostingTabs.Sales], CostingTabSet.Split(CostingTabs.Sales | CostingTabs.Materials));

        var mona = new UserTabAccess(" user-1 ", CostingTabs.Sales | (CostingTabs)(1 << 20), "Omar");
        Assert.Equal(("user-1", CostingTabs.Sales), (mona.UserId, mona.Tabs));
        Assert.Throws<DomainException>(() => new UserTabAccess(" ", CostingTabs.Sales, "Omar"));

        // A storekeeper sees no costs, nor decides; an accountant and a cost controller see them.
        Assert.False(RolePermissions.Has(UserRole.Storekeeper, Permissions.CostingView));
        Assert.True(RolePermissions.Has(UserRole.CostController, Permissions.CostingView));
        Assert.False(RolePermissions.Has(UserRole.Accountant, Permissions.ApprovalDecide));
    }

    [Fact]
    public void Someone_the_safe_pays_is_kept_when_they_leave()
    {
        var hassan = new StaffMember(Guid.NewGuid(), " Hassan ", " Chef ");
        Assert.Equal(("Hassan", "Chef", true), (hassan.Name, hassan.JobTitle, hassan.IsActive));
        hassan.Deactivate();
        Assert.False(hassan.IsActive);
        Assert.Throws<DomainException>(() => hassan.Change(" ", null));
    }

    [Fact]
    public void A_refund_after_payment_splits_off_what_is_handed_back_at_its_share_of_what_was_charged()
    {
        // Two at 100 and one at 50, 14% tax, 20 of it paid with points: 255 charged.
        var two = Line(2, 200);
        var sale = Sale([two, Line(1, 50)], tax: 35, points: 30);
        Assert.Equal(255m, sale.TotalAmount);

        // One of the two: its share, 100 of 250's 255.
        var refunded = sale.Refund(two.PublicId, 1);
        Assert.Equal((1, 100m, LineVoid.AfterPayment, 102m), (refunded.Quantity, refunded.LineTotal, refunded.Voided, sale.RefundedAmount));
        Assert.Equal((1, 100m, 2), (two.Quantity, two.LineTotal, two.PostedQuantity));
        // Still charged: the subtotal and the total stand.
        Assert.Equal((250m, 255m), (sale.BilledSubtotal, sale.TotalAmount));

        // The rest, the last on the bill: whatever is left of what was charged.
        sale.Refund(two.PublicId, 1);
        sale.Refund(sale.Lines.Single(l => l.OnBill).PublicId, 1);
        Assert.Equal(255m, sale.RefundedAmount);
        Assert.Contains("off the bill already", Assert.Throws<DomainException>(() => sale.Refund(two.PublicId, 1)).Message);
    }
}
