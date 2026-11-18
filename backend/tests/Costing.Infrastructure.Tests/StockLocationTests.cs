using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Costing.Application.Company;
using Costing.Application.Purchases;
using Costing.Application.RawMaterials;
using Costing.Application.Recipes;
using Costing.Application.Sales;
using Costing.Application.Stations;
using Costing.Application.Stock;
using Costing.Application.StockCounts;
using Costing.Application.Suppliers;
using Costing.Domain.Company;
using Costing.Domain.Purchases;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;
using Costing.Domain.Sales;
using Costing.Domain.StockMovements;

namespace Costing.Infrastructure.Tests;

// Stock by location and cost by branch on a real database: the upgrade keeps every material's cost
// as the first branch's; an open-space shop's every entry its one Main Store's and its cost the
// company's; with sub-stores, a delivery received in the main store, moved to the kitchen, sold
// from the kitchen serving the dish's station and counted there; with several branches, each
// branch costed by its own deliveries and the company by both.
public class StockLocationTests
{
    private const string BeforeLocations = "20261118131754_AddCompanyStructure";
    private static readonly Guid Grill = new("5a1f0000-0000-4000-8000-000000000001");

    private static async Task<(Guid Patty, Guid Lettuce, Guid Nile)> StockAsync(TestSystem node)
    {
        var patty = (await node.Send(new CreateRawMaterialCommand("Beef patty", UnitOfMeasure.Piece, PurchaseUnit: "piece", PurchaseUnitSize: 1))).Id;
        var lettuce = (await node.Send(new CreateRawMaterialCommand("Lettuce", UnitOfMeasure.Gram, PurchaseUnit: "kg", PurchaseUnitSize: 1000))).Id;
        var nile = (await node.Send(new SaveSupplierCommand(Guid.NewGuid(), "Nile Farms"))).Id;
        return (patty, lettuce, nile);
    }

    private static async Task<Guid> BoughtAsync(TestSystem node, Guid nile, DateOnly day, Guid? location, params PurchaseInvoiceLineEntry[] lines)
    {
        var id = Guid.NewGuid();
        await node.Send(new SavePurchaseInvoiceCommand(id, nile, $"F-{id:N}"[..8], day, lines, "Omar", PurchasePaymentMethod.Credit, LocationId: location));
        await node.Send(new PostPurchaseInvoiceCommand(id, "Omar", "staff-omar"));
        return id;
    }

    [Fact]
    public async Task The_upgrade_keeps_each_materials_cost_as_the_first_branchs_and_an_open_space_shop_works_in_its_one_store()
    {
        await using var node = await TestSystem.StartAsync();
        var ct = TestContext.Current.CancellationToken;
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var (patty, _, nile) = await StockAsync(node);
        await BoughtAsync(node, nile, today, null, new PurchaseInvoiceLineEntry(patty, 10, "piece", 1, 200));

        await node.Db(async db =>
        {
            var migrator = db.GetService<IMigrator>();
            await migrator.MigrateAsync(BeforeLocations, ct);
            await migrator.MigrateAsync(cancellationToken: ct);
            return 0;
        });
        var seeded = await node.Db(db => db.MaterialBranchStocks.SingleAsync(s => s.RawMaterialId == patty, ct));
        Assert.Equal((Branch.DefaultId, (decimal?)20m), (seeded.BranchId, seeded.AverageCost));
        Assert.All(await node.Db(db => db.StockMovements.Select(m => m.LocationId).ToListAsync(ct)), l => Assert.Equal(InventoryLocation.DefaultId, l));

        // An open-space shop: a delivery said to go elsewhere goes to its one store; its cost the company's.
        await BoughtAsync(node, nile, today, Guid.NewGuid(), new PurchaseInvoiceLineEntry(patty, 10, "piece", 1, 300));
        Assert.All(await node.Db(db => db.StockMovements.Select(m => m.LocationId).ToListAsync(ct)), l => Assert.Equal(InventoryLocation.DefaultId, l));
        var material = await node.Db(db => db.RawMaterials.SingleAsync(m => m.Id == patty, ct));
        Assert.Equal((20m, (decimal?)25m), (material.QuantityOnHand, material.AverageCost));
        Assert.Equal((decimal?)25m, await node.Db(db => db.MaterialBranchStocks.Where(s => s.RawMaterialId == patty).Select(s => s.AverageCost).SingleAsync(ct)));
    }

    [Fact]
    public async Task With_sub_stores_stock_is_received_moved_to_the_kitchen_sold_from_it_and_counted_there()
    {
        await using var node = await TestSystem.StartAsync();
        Assert.True(await TestSystem.WaitFor(() => node.Db(db => db.MenuItems.AnyAsync())));
        var ct = TestContext.Current.CancellationToken;
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var (patty, lettuce, nile) = await StockAsync(node);
        await node.Send(new AssignMaterialStationCommand([patty], Grill));

        await node.Send(new ChangeOperatingModeCommand(SystemOperatingMode.SingleBranch_WithSubStores, "user-1", "Wagdy"));
        var kitchen = Guid.NewGuid();
        await node.Send(new SaveInventoryLocationCommand(kitchen, Branch.DefaultId, "Hot Kitchen", "المطبخ الساخن", LocationKind.Kitchen, StationIds: [Grill]));

        // Received in the main store.
        await BoughtAsync(node, nile, today, InventoryLocation.DefaultId,
            new PurchaseInvoiceLineEntry(patty, 20, "piece", 1, 400), new PurchaseInvoiceLineEntry(lettuce, 5, "kg", 1000, 150));
        // Twelve patties moved to the kitchen.
        var moved = await node.Send(new PostInternalTransferCommand(
            Guid.NewGuid(), InventoryLocation.DefaultId, kitchen, [new TransferLineInput(patty, 12)], null, "user-1", "Samir"));
        Assert.Equal((240m, 20m), (moved.TotalCost!.Value, moved.Lines.Single().UnitCost!.Value));

        // Two burgers sold: each patty from the kitchen serving the grill, the lettuce from the main store.
        await node.Send(new SetRecipeCommand(RecipeTargetKind.MenuItem, TestMenu.Burger, null, [new(patty, 1), new(lettuce, 50)]));
        await node.Send(new RecordSaleCommand(new SaleInput(Guid.NewGuid(), null, today, null, SalesChannel.DineIn, PaymentMethod.Cash,
            [new SaleLineInput(TestMenu.Burger, null, 2)]), "Omar"));
        Assert.True(await TestSystem.WaitFor(async () => await node.Db(db => db.StockMovements.CountAsync(m => m.Reason == StockMovementReason.Sale)) == 2));
        var sold = await node.Db(db => db.StockMovements.Where(m => m.Reason == StockMovementReason.Sale).ToListAsync(ct));
        Assert.Equal(kitchen, sold.Single(m => m.RawMaterialId == patty).LocationId);
        Assert.Equal(InventoryLocation.DefaultId, sold.Single(m => m.RawMaterialId == lettuce).LocationId);

        // What each location has.
        var stock = await node.Send(new GetLocationStockQuery());
        var row = stock.Rows.Single(r => r.RawMaterialId == patty);
        Assert.Equal((8m, 10m, 18m), (row.ByLocation[InventoryLocation.DefaultId], row.ByLocation[kitchen], row.Total));

        // Counted in the kitchen: nine against its ten, the difference taken there.
        var count = Guid.NewGuid();
        await node.Send(new RecordStockCountCommand(count, [new(patty, 9)], "Samir", LocationId: kitchen));
        var adjusted = await node.Db(db => db.StockMovements.SingleAsync(m => m.SourceId == count, ct));
        Assert.Equal((-1m, kitchen), (adjusted.Quantity, adjusted.LocationId));
        Assert.Equal(17m, await node.Db(db => db.RawMaterials.Where(m => m.Id == patty).Select(m => m.QuantityOnHand).SingleAsync(ct)));
    }

    [Fact]
    public async Task With_several_branches_each_is_costed_by_its_own_deliveries_and_the_company_by_both()
    {
        await using var node = await TestSystem.StartAsync();
        var ct = TestContext.Current.CancellationToken;
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var (_, lettuce, nile) = await StockAsync(node);
        await node.Send(new ChangeOperatingModeCommand(SystemOperatingMode.MultiBranch_Independent, "user-1", "Wagdy"));
        var tanta = Guid.NewGuid();
        await node.Send(new SaveBranchCommand(tanta, "Tanta", "طنطا", BranchType.Restaurant));
        var tantaStore = await node.Db(db => db.InventoryLocations.Where(l => l.BranchId == tanta).Select(l => l.Id).SingleAsync(ct));

        // Five kilos at 30 a kilo in the first branch, five at 50 in Tanta.
        await BoughtAsync(node, nile, today, null, new PurchaseInvoiceLineEntry(lettuce, 5, "kg", 1000, 150));
        node.Branch.ChosenBranchId = tanta;
        await BoughtAsync(node, nile, today, null, new PurchaseInvoiceLineEntry(lettuce, 5, "kg", 1000, 250));

        var costs = await node.Db(db => db.MaterialBranchStocks.Where(s => s.RawMaterialId == lettuce).ToDictionaryAsync(s => s.BranchId, s => s.AverageCost, ct));
        Assert.Equal(((decimal?)0.03m, (decimal?)0.05m), (costs[Branch.DefaultId], costs[tanta]));
        Assert.Equal((decimal?)0.04m, await node.Db(db => db.RawMaterials.Where(m => m.Id == lettuce).Select(m => m.AverageCost).SingleAsync(ct)));

        // Thrown away in Tanta: from its own store, at its own cost.
        await node.Send(new RecordSpoilageCommand(Guid.NewGuid(), [new SpoilageLine(lettuce, 1_000, "Wilted")], "Samir"));
        var spoiled = await node.Db(db => db.StockMovements.SingleAsync(m => m.Reason == StockMovementReason.Spoilage, ct));
        Assert.Equal((tanta, tantaStore, (decimal?)0.05m), (spoiled.BranchId, spoiled.LocationId, spoiled.UnitCost));
        Assert.Equal(4_000m, (await node.Send(new GetLocationStockQuery())).Rows.Single(r => r.RawMaterialId == lettuce).Total);
    }
}
