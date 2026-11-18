using ClosedXML.Excel;
using Microsoft.EntityFrameworkCore;
using Costing.Application.Purchases;
using Costing.Application.RawMaterials;
using Costing.Application.Recipes;
using Costing.Application.Sales;
using Costing.Application.StockCounts;
using Costing.Application.Stations;
using Costing.Application.Suppliers;
using Costing.Domain.Purchases;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;
using Costing.Domain.Sales;
using Costing.Domain.Stations;
using Costing.Domain.StockMovements;
using Costing.Infrastructure.Excel;
using Costing.Infrastructure.Reports;

namespace Costing.Infrastructure.Tests;

// Station-level variance on a real database: the seven stations the migration starts with; the grill
// keeps the patties, cold & salads the lettuce, the oil no station (the shared one's). Ten burgers
// sold, a patty and 50 g of lettuce each; the grill finds two patties short at the count; a kilo of
// lettuce thrown away by the hot kitchen; a litre of oil used that no sale accounts for.
public class StationVarianceTests
{
    private static readonly Guid Grill = new("5a1f0000-0000-4000-8000-000000000001");
    private static readonly Guid HotKitchen = new("5a1f0000-0000-4000-8000-000000000003");
    private static readonly Guid ColdSalads = new("5a1f0000-0000-4000-8000-000000000004");
    private static readonly Guid Shared = new("5a1f0000-0000-4000-8000-000000000007");

    [Fact]
    public async Task Each_station_is_held_to_its_materials_use_and_the_waste_it_is_responsible_for()
    {
        await using var node = await TestSystem.StartAsync();
        Assert.True(await TestSystem.WaitFor(() => node.Db(db => db.MenuItems.AnyAsync())));
        var ct = TestContext.Current.CancellationToken;
        using var scope = node.Scope();
        var intelligence = node.Service<IntelligenceService>(scope);
        var today = intelligence.Today;

        // The seven stations, in the kitchen's order.
        var stations = await node.Send(new GetKitchenStationsQuery());
        Assert.Equal(["GRILL", "PIZZA", "HOT", "COLD", "BAR", "PASTRY", "SHARED"], stations.Select(s => s.Code));
        Assert.True(stations.Single(s => s.Code == "SHARED").IsShared);
        // The grill judged by its own tolerance, 25%; the rest by the settings' 5%.
        await node.Send(new SaveKitchenStationCommand(Grill, "Grill", "المشويات", "grill", 1, 25));

        var patty = (await node.Send(new CreateRawMaterialCommand("Beef patty", UnitOfMeasure.Piece, PurchaseUnit: "piece", PurchaseUnitSize: 1))).Id;
        var lettuce = (await node.Send(new CreateRawMaterialCommand("Lettuce", UnitOfMeasure.Gram, PurchaseUnit: "kg", PurchaseUnitSize: 1000))).Id;
        var oil = (await node.Send(new CreateRawMaterialCommand("Frying oil", UnitOfMeasure.Millilitre, PurchaseUnit: "L", PurchaseUnitSize: 1000))).Id;
        Assert.Equal(1, await node.Send(new AssignMaterialStationCommand([patty], Grill)));
        await node.Send(new AssignMaterialStationCommand([lettuce], ColdSalads));
        var nile = (await node.Send(new SaveSupplierCommand(Guid.NewGuid(), "Nile Farms"))).Id;
        var bought = Guid.NewGuid();
        await node.Send(new SavePurchaseInvoiceCommand(bought, nile, null, today,
            [new(patty, 20, "piece", 1, 400), new(lettuce, 10, "kg", 1000, 300), new(oil, 5, "L", 1000, 250)], "Omar", PurchasePaymentMethod.Credit));
        await node.Send(new PostPurchaseInvoiceCommand(bought, "Omar"));

        await node.Send(new SetRecipeCommand(RecipeTargetKind.MenuItem, TestMenu.Burger, null, [new(patty, 1), new(lettuce, 50)]));
        await node.Send(new RecordDailySalesCommand(Guid.NewGuid(), today, [new(TestMenu.Burger, null, 10)], "Omar"));
        Assert.True(await TestSystem.WaitFor(async () => await node.Db(db => db.StockMovements.CountAsync(m => m.Reason == StockMovementReason.Sale)) == 2));
        // A kilo of the cold station's lettuce thrown away by the hot kitchen.
        await node.Send(new RecordSpoilageCommand(Guid.NewGuid(), [new(lettuce, 1_000, "Left out of the fridge", HotKitchen)], "Omar"));
        // The count: eight patties (two short), 8.5 kg of lettuce, 4 L of oil.
        await node.Send(new RecordStockCountCommand(Guid.NewGuid(), [new(patty, 8), new(lettuce, 8_500), new(oil, 4_000)], "Omar"));

        var report = await intelligence.GetStationVarianceAsync(today.AddDays(-1), today, ct);
        Assert.Equal(["Grill", "Pizza & Bakery", "Hot Kitchen", "Cold & Salads", "Bar & Barista", "Pastry & Desserts", "Shared / General"],
            report.Stations.Select(s => s.Station));
        var grill = report.Stations[0];
        // 12 patties used against 10 sold: 2 at 20 unexplained, 20% of the 200 the sales should have taken: past three quarters of 25%.
        Assert.Equal((200m, 240m, 40m, (decimal?)20m, 25m, StationStatus.Watch, 1),
            (grill.TheoreticalConsumptionCost, grill.ActualConsumptionCost, grill.UnexplainedVarianceCost, grill.UnexplainedVariancePercent,
                grill.TolerancePercent, grill.Status, grill.OverTolerance));
        Assert.Equal([("Beef patty", 40m)], grill.TopLossMaterials.Select(m => (m.Material, m.VarianceCost)));
        // The lettuce used as sold (0.5 kg); the kilo spoiled is the hot kitchen's waste, not the cold station's.
        var cold = report.Stations.Single(s => s.StationId == ColdSalads);
        Assert.Equal((15m, 15m, 0m, 0m, StationStatus.WithinTarget), (cold.TheoreticalConsumptionCost, cold.ActualConsumptionCost,
            cold.UnexplainedVarianceCost, cold.LoggedSpoilageWasteCost, cold.Status));
        var hot = report.Stations.Single(s => s.StationId == HotKitchen);
        Assert.Equal((0, 30m, StationStatus.WithinTarget), (hot.Materials, hot.LoggedSpoilageWasteCost, hot.Status));
        // The oil, no station's: the shared station's, a litre at 50 used that no sale accounts for.
        var shared = report.Stations.Single(s => s.StationId == Shared);
        Assert.Equal((1, 0m, 50m, (decimal?)null, StationStatus.HighLoss), (shared.Materials, shared.TheoreticalConsumptionCost,
            shared.UnexplainedVarianceCost, shared.UnexplainedVariancePercent, shared.Status));
        Assert.Equal(Shared, report.Rows.Single(r => r.Material == "Frying oil").KitchenStationId);
        Assert.Equal((90m, 30m), (report.UnexplainedValue, report.WasteValue));

        // The workbook: a summary a station, then each station's materials.
        using (var book = new XLWorkbook(IntelligenceWorkbooks.StationVariance(report)))
        {
            Assert.Equal(["Station Summary", "By Station"], book.Worksheets.Select(w => w.Name));
            var summary = book.Worksheet("Station Summary");
            Assert.Equal("Station-level variance · انحراف الأقسام", summary.Cell(1, 1).GetString());
            Assert.Contains(summary.RowsUsed(), r => r.Cell(1).GetString() == "Grill · المشويات" && r.Cell(2).GetString() == "Watch · تحت المراقبة");
            Assert.Contains(book.Worksheet("By Station").RowsUsed(), r => r.Cell(3).GetString() == "Beef patty" && r.Cell(12).GetDouble() == 40);
        }

        // A spot count of one station.
        var presets = await intelligence.GetCountPresetsAsync(ct);
        Assert.Equal([("GRILL", [patty]), ("COLD", [lettuce])], presets.Stations!.Where(s => s.Code != "SHARED").Select(s => (s.Code, s.MaterialIds.ToList())));
        Assert.Contains(oil, presets.Stations!.Single(s => s.Code == "SHARED").MaterialIds);

        // A dish voided after the kitchen made it: the waste of the station that makes the dish.
        var recipe = (await node.Db(db => db.Recipes.SingleAsync(r => r.CatalogItemId == TestMenu.Burger))).Id;
        await node.Send(new AssignRecipeStationCommand(recipe, HotKitchen));
        var sale = Guid.NewGuid();
        await node.Send(new RecordSaleCommand(new SaleInput(sale, null, today, null, SalesChannel.DineIn, PaymentMethod.Cash,
            [new SaleLineInput(TestMenu.Burger, null, 1, Voided: LineVoid.AfterKitchen)]), "Omar"));
        Assert.True(await TestSystem.WaitFor(async () => await node.Db(db => db.StockMovements.CountAsync(m => m.Reason == StockMovementReason.Waste)) == 2));
        Assert.All(await node.Db(db => db.StockMovements.Where(m => m.Reason == StockMovementReason.Waste).ToListAsync()),
            m => Assert.Equal(HotKitchen, m.ResponsibleStationId));

        // The grill taken away: its patties fall to the shared station.
        await node.Send(new DeleteKitchenStationCommand(Grill));
        Assert.Null(await node.Db(db => db.RawMaterials.Where(m => m.Id == patty).Select(m => m.KitchenStationId).SingleAsync()));
        var after = await intelligence.GetStationVarianceAsync(today.AddDays(-1), today, ct);
        Assert.DoesNotContain(after.Stations, s => s.Station == "Grill");
        Assert.Contains("Beef patty", after.Stations.Single(s => s.StationId == Shared).TopLossMaterials.Select(m => m.Material));
    }
}
