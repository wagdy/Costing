using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Costing.Application.Integrations;
using Costing.Application.RawMaterials;
using Costing.Application.Recipes;
using Costing.Application.Sales;
using Costing.Domain.Common;
using Costing.Domain.Integrations;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;
using Costing.Domain.Sales;
using Costing.Domain.StockMovements;
using Costing.Domain.Treasury;

namespace Costing.Infrastructure.Tests;

// The POS's Z reports, on a real database: each made into the day's sales summary (its stock taken
// by the recipes, what was made and voided taken as waste) and the day's takings; sent again,
// nothing changes; sent changed, exactly what it made is replaced; all of a report or none of it;
// a day entered by hand left alone. Every call logged, refused ones too.
public sealed class PosIntegrationTests
{
    private static readonly DateOnly Yesterday = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-2));

    private static async Task<(TestSystem Node, Guid Patty, Guid Meat)> StartAsync()
    {
        var node = await TestSystem.StartAsync();
        Assert.True(await TestSystem.WaitFor(() => node.Db(db => db.MenuItems.AnyAsync())));
        async Task<Guid> Piece(string name, decimal cost) =>
            (await node.Send(new CreateRawMaterialCommand(name, UnitOfMeasure.Piece, PurchaseUnit: "piece", PurchaseUnitSize: 1, CostPerPurchaseUnit: cost))).Id;
        var patty = await Piece("Beef patty", 20);
        var meat = await Piece("Shawarma portion", 50);
        await node.Send(new SetRecipeCommand(RecipeTargetKind.MenuItem, TestMenu.Burger, null, [new(patty, 1)]));
        // The kilo tray: eight portions.
        await node.Send(new SetRecipeCommand(RecipeTargetKind.MenuItem, TestMenu.Shawarma, TestMenu.KiloTray, [new(meat, 8)]));
        return (node, patty, meat);
    }

    private static ZReportInput Report(Guid id, decimal cash, IReadOnlyList<ZReportItem> sold, IReadOnlyList<ZReportItem>? wasted = null, int shift = 1) =>
        new(id, Yesterday, shift, new ZReportTakings(cash, 100, 14m * (cash + 100) / 100m, 30, [new ZReportVoidReason("Captain error", 1, 30)]), sold, wasted);

    private static Task<decimal> OnHand(TestSystem node, Guid material) =>
        node.Db(db => db.RawMaterials.Where(m => m.Id == material).Select(m => m.QuantityOnHand).SingleAsync());

    private static Task<List<SafeTransaction>> Takings(TestSystem node) =>
        node.Db(db => db.SafeTransactions.Where(t => t.Kind == SafeTransactionKind.RevenueTransfer && t.RevenueDate == Yesterday).ToListAsync());

    [Fact]
    public async Task A_z_report_makes_the_days_sales_and_takings_once_and_a_changed_one_replaces_exactly_them()
    {
        var (node, patty, meat) = await StartAsync();
        await using var _ = node;
        var id = Guid.NewGuid();
        // A burger by its code, the kilo tray by its size code, and a lemonade (no recipe) by name;
        // a burger made and voided after the kitchen.
        var first = Report(id, 500, [new("1", 3), new($"{TestMenu.Shawarma}-{TestMenu.KiloTray}", 2), new("", 4, Name: "Lemonade")],
            [new("1", 1, Reason: "Captain error")]);

        var recorded = await node.Send(new ReceiveZReportCommand(first, "z-report"));

        Assert.Equal((PosSyncOutcome.Recorded, 3, 9, 1), (recorded.Outcome, recorded.Items, recorded.Quantity, recorded.Wasted));
        Assert.Equal(["Lemonade has no recipe: no stock was taken for it."], recorded.Warnings);
        // Three sold and one wasted burger, two trays of eight portions.
        Assert.Equal((-4m, -16m), (await OnHand(node, patty), await OnHand(node, meat)));
        var wasted = await node.Db(db => db.StockMovements.CountAsync(m => m.RawMaterialId == patty && m.Reason == StockMovementReason.Waste));
        Assert.Equal(1, wasted);
        var sale = await node.Db(db => db.SalesReceipts.Include(r => r.Lines).SingleAsync(r => r.Id == recorded.SaleId));
        Assert.Equal((SalesSource.DailySummary, Yesterday, 3 * 120m + 2 * 400m + 4 * 30m), (sale.Source, sale.BusinessDate, sale.BilledSubtotal));
        var takings = Assert.Single(await Takings(node));
        Assert.Equal((500m, 100m, 84m, 30m, 684m), (takings.GrossAmount!.Value, takings.CardAmount, takings.TaxAmount, takings.VoidsAmount, takings.Amount));
        Assert.Contains("Captain error ×1", takings.Notes);

        // Sent again, as it was: nothing changes.
        var again = await node.Send(new ReceiveZReportCommand(first, "events"));
        Assert.Equal((PosSyncOutcome.Unchanged, recorded.SaleId, recorded.TakingsId), (again.Outcome, again.SaleId, again.TakingsId));
        Assert.Equal(-4m, await OnHand(node, patty));
        Assert.Single(await Takings(node));

        // Corrected on the POS: the day's records replaced, the stock as the new report says.
        var corrected = first with { Takings = first.Takings with { Cash = 600, Tax = 98 }, SoldItems = [new("1", 5)], WastedItems = [] };
        var updated = await node.Send(new ReceiveZReportCommand(corrected, "z-report"));
        Assert.Equal(PosSyncOutcome.Updated, updated.Outcome);
        Assert.NotEqual(recorded.SaleId, updated.SaleId);
        Assert.Equal((-5m, 0m), (await OnHand(node, patty), await OnHand(node, meat)));
        Assert.True(await node.Db(db => db.SalesReceipts.Where(r => r.Id == recorded.SaleId).Select(r => r.VoidedAtUtc != null).SingleAsync()));
        var live = (await Takings(node)).Where(t => t.ReversalOf == null && t.VoidedAtUtc == null).ToList();
        Assert.Equal(700m + 98m, Assert.Single(live).Amount);

        // The day's second shift: one summary and one takings for the day, both shifts in them.
        var second = Report(Guid.NewGuid(), 200, [new("1", 2)], shift: 2);
        var merged = await node.Send(new ReceiveZReportCommand(second, "z-report"));
        Assert.Equal((PosSyncOutcome.Recorded, 7), (merged.Outcome, merged.Quantity));
        Assert.Equal(-7m, await OnHand(node, patty));
        var both = (await Takings(node)).Single(t => t.ReversalOf == null && t.VoidedAtUtc == null);
        Assert.Equal((800m, 200m), (both.GrossAmount!.Value, both.CardAmount));
        Assert.Equal(1, await node.Db(db => db.SalesReceipts.CountAsync(r => r.Source == SalesSource.DailySummary && r.VoidedAtUtc == null)));

        var logs = await node.Db(db => db.PosSyncLogs.OrderBy(l => l.AtUtc).Select(l => l.Outcome).ToListAsync());
        Assert.Equal([PosSyncOutcome.Recorded, PosSyncOutcome.Unchanged, PosSyncOutcome.Updated, PosSyncOutcome.Recorded], logs);
    }

    [Fact]
    public async Task A_report_with_a_line_off_the_menu_or_a_day_entered_by_hand_is_refused_whole_and_logged()
    {
        var (node, patty, _) = await StartAsync();
        await using var _ = node;

        // An unknown code, and the tray without its size: nothing recorded.
        var off = Report(Guid.NewGuid(), 500, [new("1", 2), new("9999", 1), new($"{TestMenu.Shawarma}", 1)]);
        var refused = await Assert.ThrowsAsync<DomainException>(() => node.Send(new ReceiveZReportCommand(off, "z-report")));
        Assert.Contains("2 lines of the Z report could not be placed", refused.Message);
        Assert.Contains("9999 is not on the menu", refused.Message);
        Assert.Contains("is sold by size", refused.Message);
        Assert.Equal(0m, await OnHand(node, patty));
        Assert.Empty(await Takings(node));
        Assert.False(await node.Db(db => db.PosZReports.AnyAsync()));

        // The size by its name, as the POS names it, is enough.
        var sized = Report(Guid.NewGuid(), 500, [new("10", 1, Size: "kilo tray")]);
        Assert.Equal(PosSyncOutcome.Recorded, (await node.Send(new ReceiveZReportCommand(sized, "z-report"))).Outcome);

        // The day after, its sales typed in by hand: the POS's report is refused.
        var today = Yesterday.AddDays(1);
        await node.Send(new RecordDailySalesCommand(Guid.NewGuid(), today, [new DailySaleLine(TestMenu.Burger, null, 1)], "Mona"));
        var byHand = await Assert.ThrowsAsync<DomainException>(() =>
            node.Send(new ReceiveZReportCommand(Report(Guid.NewGuid(), 100, [new("1", 1)]) with { Date = today }, "z-report")));
        Assert.Contains("were entered by hand", byHand.Message);

        var logs = await node.Db(db => db.PosSyncLogs.OrderBy(l => l.AtUtc).Select(l => new { l.Outcome, l.Message }).ToListAsync());
        Assert.Equal([PosSyncOutcome.Refused, PosSyncOutcome.Recorded, PosSyncOutcome.Refused], logs.Select(l => l.Outcome));
        Assert.Contains("9999", logs[0].Message);
    }

    [Fact]
    public void The_POS_day_closed_event_reads_as_a_z_report()
    {
        var shift = Guid.NewGuid();
        var data = JsonDocument.Parse($$"""
            {
              "shiftId": "{{shift}}", "shiftNumber": 3, "businessDate": "2026-11-09",
              "soldItems": [ { "code": 6101, "name": "Margherita", "size": "Large", "itemCode": "6101-17", "quantity": 2, "netAmount": 380 },
                             { "code": 9003, "name": "Soft drink", "quantity": 1, "netAmount": 30 } ],
              "waste": [ { "code": 9003, "name": "Soft drink", "quantity": 1, "amount": 30, "reason": "Captain error" } ],
              "takings": { "cash": 627.2, "card": 0, "tax": 87.81, "netSales": 627.2,
                           "voidsBefore": { "count": 2, "amount": 35 },
                           "voidsAfter": { "count": 1, "amount": 30, "reasons": [ { "reason": "Captain error", "count": 1, "amount": 30 } ] } }
            }
            """).RootElement;

        var report = PosEvents.DayClosedReport(data);

        Assert.Equal((shift, new DateOnly(2026, 11, 9), (int?)3), (report.ZReportId, report.Date, report.ShiftNumber));
        Assert.Equal((627.2m, 0m, 87.81m, 65m), (report.Takings.Cash, report.Takings.Card, report.Takings.Tax, report.Takings.VoidsAmount));
        Assert.Equal(["Captain error", "Before kitchen"], report.Takings.VoidReasons!.Select(r => r.Reason));
        Assert.Equal([("6101-17", 2, "Large"), ("9003", 1, (string?)null)], report.SoldItems.Select(i => (i.ItemCode, i.Quantity, i.Size)));
        Assert.Equal(("9003", "Captain error"), (report.WastedItems!.Single().ItemCode, report.WastedItems!.Single().Reason));
    }

    [Fact]
    public void A_key_is_kept_as_its_hash_and_checked_in_constant_time()
    {
        var key = PosKeys.New();
        Assert.StartsWith(PosKeys.Prefix, key);
        var hash = PosKeys.Hash(key);
        Assert.Equal(64, hash.Length);
        Assert.True(PosKeys.Matches(key, hash));
        Assert.True(PosKeys.Matches($"  {key} ", hash));
        Assert.False(PosKeys.Matches(PosKeys.New(), hash));
        Assert.False(PosKeys.Matches(null, hash));
        Assert.False(PosKeys.Matches(key, null));
        Assert.Equal("••••" + key[^4..], PosKeys.Hint(key));
    }
}
