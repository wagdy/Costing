using ClosedXML.Excel;
using Microsoft.EntityFrameworkCore;
using Costing.Application.Production;
using Costing.Application.Purchases;
using Costing.Application.RawMaterials;
using Costing.Application.Recipes;
using Costing.Application.Sales;
using Costing.Application.StockCounts;
using Costing.Application.Suppliers;
using Costing.Domain.Purchases;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;
using Costing.Domain.StockMovements;
using Costing.Infrastructure.Excel;
using Costing.Infrastructure.Reports;

namespace Costing.Infrastructure.Tests;

// Material & demand intelligence over one kitchen's few days: tomatoes bought at 20 a kilo ten days
// ago and at 25 today, made into pizza sauce, the sauce and a patty in the burger; fifteen burgers
// sold yesterday, tomatoes spoiled and found short at a count, saffron bought and never used.
public class IntelligenceTests
{
    [Fact]
    public async Task The_stores_are_read_for_prices_orders_consumption_and_value()
    {
        await using var node = await TestSystem.StartAsync();
        Assert.True(await TestSystem.WaitFor(() => node.Db(db => db.MenuItems.AnyAsync())));
        var ct = TestContext.Current.CancellationToken;
        using var scope = node.Scope();
        var intelligence = node.Service<IntelligenceService>(scope);
        var today = intelligence.Today;
        var yesterday = today.AddDays(-1);

        var tomatoes = (await node.Send(new CreateRawMaterialCommand("Tomatoes", UnitOfMeasure.Gram, ReorderLevel: 12_500, PurchaseUnit: "kg", PurchaseUnitSize: 1000))).Id;
        var patty = (await node.Send(new CreateRawMaterialCommand("Beef patty", UnitOfMeasure.Piece, PurchaseUnit: "piece", PurchaseUnitSize: 1))).Id;
        var saffron = (await node.Send(new CreateRawMaterialCommand("Saffron", UnitOfMeasure.Gram, PurchaseUnit: "kg", PurchaseUnitSize: 1000))).Id;
        var nile = (await node.Send(new SaveSupplierCommand(Guid.NewGuid(), "Nile Farms"))).Id;
        async Task Invoice(Guid id, DateOnly date, IReadOnlyList<PurchaseInvoiceLineEntry> lines)
        {
            await node.Send(new SavePurchaseInvoiceCommand(id, nile, null, date, lines, "Omar", PurchasePaymentMethod.Credit));
            await node.Send(new PostPurchaseInvoiceCommand(id, "Omar"));
        }

        // Ten days ago: 10 kg of tomatoes at 20 a kilo, and 50 g of saffron; its stock came in then.
        var first = Guid.NewGuid();
        await Invoice(first, today.AddDays(-10), [new(tomatoes, 10, "kg", 1000, 200), new(saffron, 50, "g", 1, 100)]);
        await node.Db(db => db.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE costing.\"StockMovements\" SET \"OccurredAtUtc\" = {DateTime.UtcNow.AddDays(-10)} WHERE \"SourceId\" = {first}", ct));

        // The sauce is tomatoes, a kilo for a kilo; the burger a patty and 100 g of sauce.
        var sauce = (await node.Send(new SavePrepItemCommand(null, "Pizza sauce", UnitOfMeasure.Gram, 1_000, [new(tomatoes, 1_000)], DisplayUnit: "kg", DisplayUnitSize: 1000))).Id;
        await node.Send(new SetRecipeCommand(RecipeTargetKind.MenuItem, TestMenu.Burger, null, [new(patty, 1), new(sauce, 100)]));

        // Today: 5 kg of tomatoes at 25 a kilo and twenty patties at 20; two kilos of sauce made.
        await Invoice(Guid.NewGuid(), today, [new(tomatoes, 5, "kg", 1000, 125), new(patty, 20, "piece", 1, 400)]);
        await node.Send(new MakeProductionOrderCommand(Guid.NewGuid(), sauce, 2_000, 2_000, null, "Omar"));
        // Fifteen burgers sold yesterday; 500 g of tomatoes spoiled, and the count finds 500 g short.
        await node.Send(new RecordDailySalesCommand(Guid.NewGuid(), yesterday, [new(TestMenu.Burger, null, 15)], "Omar"));
        Assert.True(await TestSystem.WaitFor(async () => await node.Db(db => db.StockMovements.CountAsync(m => m.Reason == StockMovementReason.Sale)) == 2));
        await node.Send(new RecordSpoilageCommand(Guid.NewGuid(), [new(tomatoes, 500, "Rotten")], "Omar"));
        await node.Send(new RecordStockCountCommand(Guid.NewGuid(), [new(tomatoes, 12_000)], "Omar"));

        // ---- Prices: tomatoes came in at an average of 20 a kilo and were last bought at 25.
        var prices = await intelligence.GetPriceVarianceAsync(yesterday, today, ct);
        Assert.Equal(["Tomatoes", "Beef patty"], prices.Rows.Select(r => r.Material));
        var tomato = prices.Rows[0];
        Assert.Equal((20m, 25m, 5m, 25m, 5m, 25m, "Nile Farms", "kg"),
            (tomato.BaselineCost, tomato.LatestCost, tomato.UnitVariance, tomato.ChangePercent, tomato.QuantityPurchased, tomato.Impact, tomato.LatestSupplier, tomato.PurchaseUnit));
        // A kilo of sauce is a kilo of tomatoes: 5 more a kilo, of its 21.67. A burger has 100 g: 0.50 more, 0.4 points of its 120.
        Assert.Equal(
            [(PriceImpactKind.PrepItem, "Pizza sauce", "kg", 1m, 5m, (decimal?)21.67m, (decimal?)23.1m), (PriceImpactKind.Dish, "Burger", "portion", 0.1m, 0.5m, 120m, 0.4m)],
            tomato.Affected.Select(a => (a.Kind, a.Name, a.Per, a.Quantity, a.CostChange, a.Against, a.Points)));
        // The patty has no price before today: its first is its baseline, so no change.
        Assert.Equal((20m, 20m, 0m, 0m), (prices.Rows[1].BaselineCost, prices.Rows[1].LatestCost, prices.Rows[1].Impact, prices.Rows[1].ChangePercent));
        Assert.Empty(prices.Rows[1].Affected);
        Assert.Equal((25m, 25m, 0m, 1, 0, 1, "Tomatoes", 25m),
            (prices.TotalImpact, prices.Increases, prices.Decreases, prices.Rising, prices.Falling, prices.AffectedDishes, prices.LargestRise, prices.LargestRisePercent));
        Assert.Equal([new NamedId(nile, "Nile Farms")], prices.Suppliers);

        // ---- The order: a week like the last, 15 burgers. Patties: 15 less the 5 left; sauce: 1.5 kg
        // less the 0.5 kg made, so 1 kg of tomatoes, with the 12.5 kg reorder level against 12 kg left.
        var plan = await intelligence.PlanOrderAsync(new OrderPlanRequest(7, 7), ct);
        Assert.Equal((today.AddDays(-7), yesterday), (plan.LookbackFrom, plan.LookbackTo));
        var burger = Assert.Single(plan.Dishes);
        Assert.Equal(("1", true, 2.143m, 2.143m, false), (burger.Code, burger.HasRecipe, burger.AverageDaily, burger.ExpectedDaily, burger.Expected));
        Assert.Equal(
            [("Beef patty", 5m, 2.143m, 15m, 0m, 10m, 10m, (decimal?)20m, (decimal?)200m, false), ("Tomatoes", 12m, 0.214m, 1m, 12.5m, 1.5m, 2m, 25m, 50m, true)],
            plan.Lines.Select(l => (l.Material, l.OnHand, l.AverageDailyUsage, l.ExpectedUsage, l.ReorderLevel, l.Recommended, l.Suggested, l.UnitPrice, l.EstimatedCost, l.BelowReorder)));
        Assert.Equal((2, 250m, 1), (plan.ToOrder, plan.EstimatedTotal, plan.BelowReorder));

        // Three burgers a day expected: 21; or the week's sales doubled: 30.
        var expected = await intelligence.PlanOrderAsync(new OrderPlanRequest(7, 7, 0, [new(TestMenu.Burger, null, 3)]), ct);
        Assert.Equal([16m, 3m], expected.Lines.Select(l => l.Suggested));
        Assert.True(expected.Dishes.Single().Expected);
        var doubled = await intelligence.PlanOrderAsync(new OrderPlanRequest(7, 7, 100), ct);
        Assert.Equal(25m, doubled.Lines.Single(l => l.Material == "Beef patty").Suggested);
        await Assert.ThrowsAsync<Costing.Domain.Common.DomainException>(() => intelligence.PlanOrderAsync(new OrderPlanRequest(0, 7), ct));

        // The approved order as a sheet, by category and by supplier.
        var order = await intelligence.OrderSheetAsync(new OrderSheetRequest([new(patty, 10), new(tomatoes, 2)], CoverageDays: 7), ct);
        Assert.Equal((250m, 2), (order.Total, order.Rows.Count));
        Assert.All(order.Rows, r => Assert.Equal("General", r.Group));
        var bySupplier = await intelligence.OrderSheetAsync(new OrderSheetRequest([new(patty, 10)], OrderSheetGrouping.Supplier), ct);
        Assert.Equal(("Nile Farms", "General"), (bySupplier.Rows.Single().Group, bySupplier.Rows.Single().Other));
        using (var book = new XLWorkbook(IntelligenceWorkbooks.OrderSheet(order)))
        {
            var sheet = book.Worksheet("Order");
            Assert.Equal("Purchase order sheet · طلبية الشراء", sheet.Cell(1, 1).GetString());
            Assert.Equal(("General", "Beef patty", 250d), (sheet.Cell(5, 1).GetString(), sheet.Cell(6, 2).GetString(), sheet.Cell(9, 6).GetDouble()));
        }

        // ---- Consumption: 10 kg + 5 kg − 0.5 kg spoiled − 12 kg left = 2.5 kg used; the sales took
        // 1.5 kg through the sauce, and 0.5 kg is in the sauce still on the shelf: 0.5 kg unexplained.
        var consumption = await intelligence.GetConsumptionAsync(yesterday, today, ct);
        Assert.Equal(["Tomatoes", "Beef patty", "Saffron"], consumption.Rows.Select(r => r.Material));
        var used = consumption.Rows[0];
        Assert.Equal((10m, 5m, 0.5m, 12m, 2.5m, 2m, 0.5m, 0.5m, 25m, 10.83m, VarianceEvaluation.Unfavourable),
            (used.Opening, used.Purchases, used.Waste, used.Closing, used.ActualUsage, used.TheoreticalUsage, used.HeldInPrep, used.UnexplainedQuantity,
                used.UnexplainedPercent, used.VarianceCost, used.Evaluation));
        Assert.Equal((15m, 15m, 0m, VarianceEvaluation.WithinLimit),
            (consumption.Rows[1].ActualUsage, consumption.Rows[1].TheoreticalUsage, consumption.Rows[1].UnexplainedQuantity, consumption.Rows[1].Evaluation));
        Assert.Equal((10.83m, 1), (consumption.UnexplainedValue, consumption.HighLoss));
        Assert.Empty(consumption.SoldWithoutRecipe);

        // ---- ABC over the two days: the patties, 300, are A; the tomatoes, 65, B; the saffron, never
        // used, is dead stock worth 100. Five patties left at 7.5 a day: less than a day.
        var abc = await intelligence.GetAbcAsync(yesterday, today, ct);
        Assert.Equal(2, abc.Days);
        Assert.Equal(
            [("Beef patty", AbcClass.A, 300m, 82.2m, (decimal?)0.7m, true, false), ("Tomatoes", AbcClass.B, 65m, 17.8m, 8m, false, false),
             ("Saffron", AbcClass.C, 0m, 0m, null, false, true)],
            abc.Rows.Select(r => (r.Material, r.Class, r.ConsumptionValue, r.SharePercent, r.DaysOnHand, r.StockoutRisk, r.DeadStock)));
        Assert.Equal((365m, 1, 1, 100m), (abc.ConsumptionValue, abc.StockoutRisks, abc.DeadStock, abc.DeadStockValue));
        Assert.Equal([(AbcClass.A, 1), (AbcClass.B, 1), (AbcClass.C, 1)], abc.Classes.Select(c => (c.Class, c.Materials)));

        // Each report as a workbook.
        foreach (var stream in new[]
                 {
                     IntelligenceWorkbooks.PriceVariance(prices, prices.Rows), IntelligenceWorkbooks.Consumption(consumption), IntelligenceWorkbooks.Abc(abc),
                 })
        {
            using var book = new XLWorkbook(stream);
            // Its first row of figures, under the header.
            Assert.NotEmpty(book.Worksheet(1).Row(5).CellsUsed());
        }

        // ---- The tomatoes' stock card over the ten days: 10 kg in at 20, 5 kg at 25 (the average
        // 21.67), 2 kg into the sauce, 0.5 kg spoiled, 0.5 kg short at the count: 12 kg left, 260 worth.
        // The average after the second delivery is the card's own; the ones after, as the ledger kept
        // them, to six places a gram.
        var cards = node.Service<StockCardService>(scope);
        var card = await cards.GetAsync(tomatoes, today.AddDays(-10), today, null, ct);
        Assert.Equal((0m, (decimal?)null, 15m, 3m, 12m, (decimal?)21.667m, (decimal?)260m, 12m, "kg"),
            (card.OpeningBalance, card.OpeningAverageCost, card.TotalIn, card.TotalOut, card.ClosingBalance, card.ClosingAverageCost, card.ClosingValue,
                card.OnHand, card.PurchaseUnit));
        Assert.Equal(
            [
                (StockCardMovementType.Purchases, StockCardSourceKind.PurchaseInvoice, 10m, 0m, 10m, (decimal?)20m, (decimal?)20m),
                (StockCardMovementType.Purchases, StockCardSourceKind.PurchaseInvoice, 5m, 0m, 15m, 25m, 21.6667m),
                (StockCardMovementType.Production, StockCardSourceKind.ProductionOrder, 0m, 2m, 13m, 21.667m, 21.667m),
                (StockCardMovementType.Waste, StockCardSourceKind.Spoilage, 0m, 0.5m, 12.5m, 21.667m, 21.667m),
                (StockCardMovementType.CountAdjustment, StockCardSourceKind.StockCount, 0m, 0.5m, 12m, 21.667m, 21.667m),
            ],
            card.Lines.Select(l => (l.Type, l.SourceKind, l.QuantityIn, l.QuantityOut, l.Balance, l.UnitCost, l.AverageCostAfter)));
        // Each line names its record and opens it: the invoice of its paper date, from its supplier;
        // the batch of sauce; why the tomatoes were thrown away.
        Assert.Equal((first, (DateOnly?)today.AddDays(-10), "Invoice, no number · فاتورة بدون رقم", "Nile Farms", 200m),
            (card.Lines[0].SourceId, card.Lines[0].SourceDate, card.Lines[0].Reference, card.Lines[0].Details, card.Lines[0].Value));
        Assert.Equal(("Production batch · تشغيلة إنتاج", "Batch: 2 kg of Pizza sauce", -43.33m), (card.Lines[2].Reference, card.Lines[2].Details, card.Lines[2].Value));
        Assert.Equal(("Spoilage · تالف", "Rotten", "Omar"), (card.Lines[3].Reference, card.Lines[3].Details, card.Lines[3].RecordedBy));
        Assert.Equal("Stock count · جرد", card.Lines[4].Reference);

        // From yesterday: it opens with the first delivery's 10 kg at 20. Purchases only: two lines,
        // the balance still the ledger's.
        var since = await cards.GetAsync(tomatoes, yesterday, today, StockCardMovementType.Purchases, ct);
        Assert.Equal((10m, (decimal?)20m, 5m, 3m, 12m), (since.OpeningBalance, since.OpeningAverageCost, since.TotalIn, since.TotalOut, since.ClosingBalance));
        Assert.Equal([(5m, 15m)], since.Lines.Select(l => (l.QuantityIn, l.Balance)));
        // The sauce's card: made, then sold through the burgers, the day's sales summary its record.
        var sauceCard = await cards.GetAsync(sauce, yesterday, today, null, ct);
        Assert.Equal(
            [(StockCardMovementType.Production, 2m, 0m, 2m), (StockCardMovementType.Sales, 0m, 1.5m, 0.5m)],
            sauceCard.Lines.Select(l => (l.Type, l.QuantityIn, l.QuantityOut, l.Balance)));
        var sold = sauceCard.Lines[1];
        Assert.Equal((StockCardSourceKind.SalesReceipt, (DateOnly?)yesterday, "Daily sales summary · ملخص المبيعات اليومية", "15 × Burger"),
            (sold.SourceKind, sold.SourceDate, sold.Reference, sold.Details));
        Assert.True(await node.Db(db => db.SalesReceipts.AnyAsync(r => r.Id == sold.SourceId, ct)));
        await Assert.ThrowsAsync<Costing.Domain.Common.DomainException>(() => cards.GetAsync(tomatoes, today, yesterday, null, ct));
        using (var book = new XLWorkbook(StockCardWorkbook.Build(card)))
        {
            var sheet = book.Worksheet("Stock card");
            Assert.Equal(("Opening balance · رصيد أول المدة", "Closing balance · رصيد آخر المدة", 12d),
                (sheet.Cell(5, 2).GetString(), sheet.Cell(11, 2).GetString(), sheet.Cell(11, 7).GetDouble()));
        }

        // The latest price's invoice, to open from the price variance.
        Assert.NotNull(tomato.LatestInvoiceId);
        Assert.NotEqual(first, tomato.LatestInvoiceId);
    }

    // Four dishes sold, a hundred in all: two popular (above 70% of an even 25% mix, 17.5%), two
    // not; the average margin, weighted by what sold, 63.50. Lemonade has no recipe, so no place.
    [Fact]
    public async Task Menu_engineering_places_each_dish_by_its_popularity_and_margin()
    {
        await using var node = await TestSystem.StartAsync();
        Assert.True(await TestSystem.WaitFor(() => node.Db(db => db.MenuItems.AnyAsync())));
        var ct = TestContext.Current.CancellationToken;
        using var scope = node.Scope();
        var costing = node.Service<CostingService>(scope);
        var today = node.Service<IntelligenceService>(scope).Today;
        await node.Db(db => db.Database.ExecuteSqlRawAsync("""
            INSERT INTO costing."MenuItems" ("Id", "Name", "Category", "Price", "IsAvailable", "IsPriceBasedOnAddons", "IsDeleted", "AddOnIds") VALUES
                (30, 'Steak', 'Mains', 300, true, false, false, ARRAY[]::integer[]),
                (31, 'Fries', 'Mains', 40, true, false, false, ARRAY[]::integer[]),
                (32, 'Soup', 'Mains', 50, true, false, false, ARRAY[]::integer[]);
            """, ct));

        async Task<Guid> Piece(string name, decimal cost) =>
            (await node.Send(new CreateRawMaterialCommand(name, UnitOfMeasure.Piece, PurchaseUnit: "piece", PurchaseUnitSize: 1, CostPerPurchaseUnit: cost))).Id;
        await node.Send(new SetRecipeCommand(RecipeTargetKind.MenuItem, TestMenu.Burger, null, [new(await Piece("Patty", 20), 1)]));
        await node.Send(new SetRecipeCommand(RecipeTargetKind.MenuItem, 30, null, [new(await Piece("Steak cut", 150), 1)]));
        await node.Send(new SetRecipeCommand(RecipeTargetKind.MenuItem, 31, null, [new(await Piece("Potato portion", 10), 1)]));
        await node.Send(new SetRecipeCommand(RecipeTargetKind.MenuItem, 32, null, [new(await Piece("Soup base", 30), 1)]));
        await node.Send(new RecordDailySalesCommand(Guid.NewGuid(), today,
            [new(TestMenu.Burger, null, 40), new(30, null, 5), new(31, null, 50), new(32, null, 5), new(TestMenu.Lemonade, null, 10)], "Omar"));
        Assert.True(await TestSystem.WaitFor(async () => await node.Db(db => db.StockMovements.CountAsync(m => m.Reason == StockMovementReason.Sale)) == 4));

        var report = await costing.GetMenuEngineeringAsync(today, today, null, ct);
        Assert.Equal((4, 100m, 8_550m, 6_350m, (decimal?)63.5m, (decimal?)17.5m, 30m, 1),
            (report.Items, report.QuantitySold, report.NetSales, report.TotalContribution, report.AverageContribution, report.PopularityThresholdPercent,
                report.FoodCostTargetPercent, report.Unclassified));
        Assert.Equal(
            [
                ("Burger", (MenuClass?)MenuClass.Star, (decimal?)40m, (decimal?)100m, (decimal?)16.7m, (decimal?)66.67m),
                ("Fries", MenuClass.Plowhorse, 50m, 30m, 25m, 33.33m),
                ("Steak", MenuClass.Puzzle, 5m, 150m, 50m, 500m),
                ("Soup", MenuClass.Dog, 5m, 20m, 60m, 100m),
                ("Lemonade", null, null, null, null, null),
            ],
            report.Rows.Select(r => (r.MenuItem, r.Class, r.MenuMixPercent, r.ContributionMargin, r.FoodCostPercent, r.SuggestedPrice)));
        Assert.Equal((CostStatus.AboveTarget, CostStatus.NoRecipe), (report.Rows[3].Status, report.Rows[4].Status));
        Assert.Equal(
            [(MenuClass.Star, 1, 4_000m), (MenuClass.Plowhorse, 1, 1_500m), (MenuClass.Puzzle, 1, 750m), (MenuClass.Dog, 1, 100m)],
            report.Classes.Select(c => (c.Class, c.Items, c.Contribution)));
        Assert.Equal(["Drinks", "Mains"], report.Categories);

        // The drinks alone: nothing with a recipe to place.
        var drinks = await costing.GetMenuEngineeringAsync(today, today, "drinks", ct);
        Assert.Equal((0, (decimal?)null, 1), (drinks.Items, drinks.PopularityThresholdPercent, drinks.Unclassified));
        await Assert.ThrowsAsync<Costing.Domain.Common.DomainException>(() => costing.GetMenuEngineeringAsync(today, today.AddDays(-1), null, ct));
        using var book = new XLWorkbook(IntelligenceWorkbooks.MenuEngineering(report));
        Assert.Equal("Star · نجم", book.Worksheet("Menu engineering").Cell(5, 1).GetString());
    }
}
