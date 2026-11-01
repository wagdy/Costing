using Costing.Application.Approvals;
using Costing.Application.Recipes;
using Costing.Application.Sales;
using Costing.Domain.Approvals;
using Costing.Domain.Common;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;
using Costing.Domain.Sales;
using Costing.Domain.StockMovements;

namespace Costing.Application.Tests;

// A sale takes stock through the recipes it sells by, once, and a void puts back exactly what it
// took. The sales and the stock share nothing but the menu's numbers.
public class InventoryTests
{
    private readonly TestCosting _pos = new();
    private readonly RawMaterial _beef;
    private readonly RawMaterial _bun;
    private readonly RawMaterial _cheese;
    private readonly RawMaterial _chicken;

    public InventoryTests()
    {
        _beef = _pos.Inventory.Stock("Beef patty", UnitOfMeasure.Piece, 50);
        _bun = _pos.Inventory.Stock("Bun", UnitOfMeasure.Piece, 50);
        _cheese = _pos.Inventory.Stock("Cheese slice", UnitOfMeasure.Piece, 50);
        _chicken = _pos.Inventory.Stock("Chicken", UnitOfMeasure.Gram, 5000);
    }

    private async Task Recipes()
    {
        await _pos.Send(new SetRecipeCommand(RecipeTargetKind.MenuItem, TestCosting.Burger, null, [new(_beef.Id, 1), new(_bun.Id, 1)]));
        await _pos.Send(new SetRecipeCommand(RecipeTargetKind.AddOn, TestCosting.Cheese, null, [new(_cheese.Id, 1)]));
        await _pos.Send(new SetRecipeCommand(RecipeTargetKind.MenuItem, TestCosting.Shawarma, TestCosting.KiloTray, [new(_chicken.Id, 1000)]));
    }

    private static SaleInput Sale(Guid id, params SaleLineInput[] lines) =>
        new(id, null, TestCalendar.Today, new TimeOnly(13, 0), SalesChannel.DineIn, PaymentMethod.Cash, lines);

    private Task<SalesReceiptDto> PaidSale(Guid? id = null) => _pos.Send(new RecordSaleCommand(
        Sale(id ?? Guid.NewGuid(), new SaleLineInput(TestCosting.Burger, null, 2, AddOnIds: [TestCosting.Cheese]),
            new SaleLineInput(TestCosting.Shawarma, TestCosting.KiloTray, 1)),
        "Sara"));

    [Fact]
    public async Task A_sale_deducts_stock_through_recipes_exactly_once_and_adds_up_at_the_menus_prices()
    {
        await Recipes();
        var id = Guid.NewGuid();
        var sale = await PaidSale(id);

        Assert.Equal((48m, 48m, 48m, 4000m), (_beef.QuantityOnHand, _bun.QuantityOnHand, _cheese.QuantityOnHand, _chicken.QuantityOnHand));
        // Burger 120 and cheese 15, twice; a kilo tray, 400.
        Assert.Equal([270m, 400m], sale.Lines.Select(l => l.LineTotal));
        Assert.Equal(670m, sale.TotalAmount);

        // Sent again after a lost answer: recorded once, stock taken once.
        await PaidSale(id);
        Assert.Single(_pos.Sales.All);
        Assert.Equal((48m, 4000m), (_beef.QuantityOnHand, _chicken.QuantityOnHand));
    }

    [Fact]
    public async Task A_line_voided_before_payment_takes_nothing_and_a_voided_sale_puts_back_what_it_took()
    {
        await Recipes();
        var sale = await _pos.Send(new RecordSaleCommand(
            Sale(Guid.NewGuid(), new SaleLineInput(TestCosting.Burger, null, 2), new SaleLineInput(TestCosting.Burger, null, 1, Voided: LineVoid.BeforeKitchen)), "Sara"));
        Assert.Equal((48m, 240m), (_beef.QuantityOnHand, sale.Subtotal));

        // An accountant asks; nothing moves until a manager approves.
        var asked = await _pos.Send(new RequestDeletionCommand(Guid.NewGuid(), ApprovalModule.Sale, sale.Id, "Entered twice", "staff-mona", "Mona", CanApprove: false));
        Assert.Equal(ApprovalOutcome.Requested, asked.Outcome);
        Assert.Equal(48m, _beef.QuantityOnHand);

        await _pos.Send(new ApproveRequestCommand(asked.Request.Id, "Omar"));
        Assert.Equal((50m, 50m), (_beef.QuantityOnHand, _bun.QuantityOnHand));
        Assert.True(_pos.Sales.All.Single().IsVoided);
        Assert.Equal(
            [StockMovementReason.Sale, StockMovementReason.Sale],
            _pos.Inventory.Movements.All.Where(m => m.RawMaterialId == _beef.Id).Select(m => m.Reason).ToList());
        Assert.Equal(1, _pos.Inventory.Movements.All.Count(m => m.RawMaterialId == _beef.Id && m.IsReversal));
    }

    [Fact]
    public async Task A_menu_item_with_no_recipe_is_sold_without_touching_stock()
    {
        await PaidSale();

        Assert.Empty(_pos.Inventory.Movements.All);
    }

    [Fact]
    public async Task A_sale_names_only_what_is_on_the_menu_and_a_receipt_number_once()
    {
        async Task<string> Refused(params SaleLineInput[] lines) =>
            (await Assert.ThrowsAsync<DomainException>(() => _pos.Send(new RecordSaleCommand(Sale(Guid.NewGuid(), lines), "Sara")))).Message;

        Assert.Equal("There is no item 99 on the menu.", await Refused(new SaleLineInput(99, null, 1)));
        Assert.Equal("Shawarma is sold by size: choose its size.", await Refused(new SaleLineInput(TestCosting.Shawarma, null, 1)));
        Assert.Equal("Burger has no such size: choose one of its sizes.", await Refused(new SaleLineInput(TestCosting.Burger, TestCosting.KiloTray, 1)));
        Assert.Equal("There is no add-on 3 on the menu.", await Refused(new SaleLineInput(TestCosting.Burger, null, 1, AddOnIds: [3])));
        Assert.Equal("Add at least one item.", await Refused());

        await _pos.Send(new RecordSaleCommand(Sale(Guid.NewGuid(), new SaleLineInput(TestCosting.Burger, null, 1)) with { Reference = "R-1" }, "Sara"));
        var again = await Assert.ThrowsAsync<DomainException>(() =>
            _pos.Send(new RecordSaleCommand(Sale(Guid.NewGuid(), new SaleLineInput(TestCosting.Burger, null, 1)) with { Reference = " r-1 " }, "Sara")));
        Assert.Equal("Receipt r-1 is recorded already.", again.Message);
    }

    [Fact]
    public async Task A_line_voided_after_the_kitchen_is_waste_one_refunded_after_payment_goes_back_and_a_voided_sale_undoes_both()
    {
        await Recipes();
        var sale = await _pos.Send(new RecordSaleCommand(
            Sale(Guid.NewGuid(), new SaleLineInput(TestCosting.Burger, null, 2), new SaleLineInput(TestCosting.Burger, null, 1, Voided: LineVoid.AfterKitchen),
                new SaleLineInput(TestCosting.Burger, null, 1, Voided: LineVoid.AfterPayment)) with { RefundedAmount = 120 },
            "Sara"));

        // Two sold and one wasted: three patties out; the refunded one sold and back.
        Assert.Equal(47m, _beef.QuantityOnHand);
        Assert.Equal(
            [StockMovementReason.Sale, StockMovementReason.Waste, StockMovementReason.Sale, StockMovementReason.VoidReturn],
            _pos.Inventory.Movements.All.Where(m => m.RawMaterialId == _beef.Id).Select(m => m.Reason));
        // The refunded line was charged: in the subtotal, its money in the refund.
        Assert.Equal((360m, 360m, 120m), (sale.Subtotal, sale.TotalAmount, sale.RefundedAmount));

        var voided = await _pos.Send(new RequestDeletionCommand(Guid.NewGuid(), ApprovalModule.Sale, sale.Id, null, "staff-omar", "Omar", CanApprove: true));
        Assert.Equal(ApprovalOutcome.Applied, voided.Outcome);
        Assert.Equal(50m, _beef.QuantityOnHand);
    }
}
