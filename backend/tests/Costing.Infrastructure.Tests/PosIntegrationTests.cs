using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Costing.Application.EndOfDay;
using Costing.Application.Integrations;
using Costing.Application.RawMaterials;
using Costing.Application.Recipes;
using Costing.Application.Sales;
using Costing.Domain.Common;
using Costing.Domain.EndOfDay;
using Costing.Domain.Integrations;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;
using Costing.Domain.Sales;
using Costing.Domain.StockMovements;
using Costing.Domain.Treasury;

namespace Costing.Infrastructure.Tests;

// The POS's Z reports, on a real database: each made into the day's sales summary (its stock taken
// by the recipes, what was made and voided taken as waste) and its end of day's sales report, every
// shift's together and locked; the takings into the safe from it once the end of day is confirmed;
// sent again, nothing changes; sent changed, exactly what it made is replaced; all of a report or
// none of it; a day entered by hand left alone. Every call logged, refused ones too.
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

    private static Task<EndOfDayDto?> EndOfDay(TestSystem node) => node.Send(new GetEndOfDayQuery(Yesterday));

    private static Task<List<SafeTransaction>> LiveTakings(TestSystem node) =>
        node.Db(db => db.SafeTransactions.Where(t => t.Kind == SafeTransactionKind.RevenueTransfer && t.RevenueDate == Yesterday
            && t.ReversalOf == null && t.VoidedAtUtc == null).ToListAsync());

    [Fact]
    public async Task A_z_report_makes_the_days_sales_and_its_end_of_days_sales_report_and_the_takings_go_in_once_confirmed()
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
        // The end of day's sales report is the POS's, locked; nothing in the safe until it is confirmed.
        Assert.Null(recorded.TakingsId);
        var day = (await EndOfDay(node))!;
        Assert.Equal(recorded.EndOfDayId, day.Id);
        Assert.Equal((500m, 100m, 84m, 30m, EndOfDayStatus.Draft), (day.CashAmount!.Value, day.CardAmount!.Value, day.TaxAmount!.Value, day.VoidsAmount!.Value, day.Status));
        Assert.Equal((true, true, "1"), (day.Pos!.SalesFromPos, day.Pos.SalesLocked, day.Pos.Shifts));
        Assert.Empty(await Takings(node));

        // Sent again, as it was: nothing changes.
        var again = await node.Send(new ReceiveZReportCommand(first, "events"));
        Assert.Equal((PosSyncOutcome.Unchanged, recorded.SaleId), (again.Outcome, again.SaleId));
        Assert.Equal(-4m, await OnHand(node, patty));

        // Corrected on the POS: the day's records replaced, the stock as the new report says.
        var corrected = first with { Takings = first.Takings with { Cash = 600, Tax = 98 }, SoldItems = [new("1", 5)], WastedItems = [] };
        var updated = await node.Send(new ReceiveZReportCommand(corrected, "z-report"));
        Assert.Equal(PosSyncOutcome.Updated, updated.Outcome);
        Assert.NotEqual(recorded.SaleId, updated.SaleId);
        Assert.Equal((-5m, 0m), (await OnHand(node, patty), await OnHand(node, meat)));
        Assert.True(await node.Db(db => db.SalesReceipts.Where(r => r.Id == recorded.SaleId).Select(r => r.VoidedAtUtc != null).SingleAsync()));
        Assert.Equal((600m, 98m), ((await EndOfDay(node))!.CashAmount!.Value, (await EndOfDay(node))!.TaxAmount!.Value));

        // The day's second shift: one summary for the day and one sales report, both shifts in them.
        var second = Report(Guid.NewGuid(), 200, [new("1", 2)], shift: 2);
        var merged = await node.Send(new ReceiveZReportCommand(second, "z-report"));
        Assert.Equal((PosSyncOutcome.Recorded, 7), (merged.Outcome, merged.Quantity));
        Assert.Equal(-7m, await OnHand(node, patty));
        Assert.Equal(1, await node.Db(db => db.SalesReceipts.CountAsync(r => r.Source == SalesSource.DailySummary && r.VoidedAtUtc == null)));
        day = (await EndOfDay(node))!;
        Assert.Equal((800m, 200m, 140m, 60m, "1, 2"), (day.CashAmount!.Value, day.CardAmount!.Value, day.TaxAmount!.Value, day.VoidsAmount!.Value, day.Pos!.Shifts));
        Assert.Equal([1, 2], day.Pos.ShiftList.Select(x => x.Number ?? 0));

        // Locked: a figure typed over the POS's is refused; the notes are the day's own.
        var typed = await Assert.ThrowsAsync<DomainException>(() => node.Send(new SaveEndOfDaySalesCommand(Yesterday, 900, 200, 140, 60, null, "Ali")));
        Assert.Contains("synced from the POS", typed.Message);
        await node.Send(new SaveEndOfDaySalesCommand(Yesterday, 800, 200, 140, 60, "Busy night", "Ali"));
        Assert.Equal("Busy night", (await EndOfDay(node))!.Notes);

        // Confirmed: the takings into the safe from it, once, both shifts in them.
        await node.Send(new SubmitEndOfDayCommand(Yesterday, "Ali", "staff-ali", CanApprove: true));
        var takings = Assert.Single(await LiveTakings(node));
        Assert.Equal((800m, 200m, 140m, 60m, 1140m), (takings.GrossAmount!.Value, takings.CardAmount, takings.TaxAmount, takings.VoidsAmount, takings.Amount));
        Assert.Contains("Captain error ×2", takings.Notes);
        Assert.Contains("shift 1, 2", takings.Notes);
        Assert.Equal(takings.Id, await node.Db(db => db.PosDays.Where(d => d.Date == Yesterday).Select(d => d.TakingsId).SingleAsync()));

        // Sent again once confirmed: as it was; changed, refused: the day is handed in.
        Assert.Equal(PosSyncOutcome.Unchanged, (await node.Send(new ReceiveZReportCommand(second, "events"))).Outcome);
        var late = await Assert.ThrowsAsync<DomainException>(() => node.Send(new ReceiveZReportCommand(second with { SoldItems = [new("1", 3)] }, "events")));
        Assert.Contains("handed in already", late.Message);
        Assert.Single(await LiveTakings(node));

        var logs = await node.Db(db => db.PosSyncLogs.OrderBy(l => l.AtUtc).Select(l => l.Outcome).ToListAsync());
        Assert.Equal([PosSyncOutcome.Recorded, PosSyncOutcome.Unchanged, PosSyncOutcome.Updated, PosSyncOutcome.Recorded, PosSyncOutcome.Unchanged, PosSyncOutcome.Refused], logs);
    }

    // The till as each shift closed it: the floats and the cash each drawer took with its tax, every
    // shift's together, so the cash expected in the till is the drawers' to the piastre. A manager
    // unlocks the POS's figures with why, corrects them, and the takings go in as corrected.
    [Fact]
    public async Task Each_shifts_till_adds_up_on_the_end_of_day_and_a_manager_overrides_it_with_why()
    {
        var (node, _, _) = await StartAsync();
        await using var _ = node;
        // 1,000.00 cash with 14% tax in it (877.19 before), and 228 card (200 before), two drawers.
        var one = new ZReportInput(Guid.NewGuid(), Yesterday, 1, new ZReportTakings(877.19m, 200, 150.81m, 0), [new("1", 1)],
            Till: new ZReportTill(500, 1000, 228, ExpectedCash: 1500, CountedCash: 1495, OverShort: -5, ClosedBy: "Mona"));
        var two = new ZReportInput(Guid.NewGuid(), Yesterday, 2, new ZReportTakings(87.72m, 0, 12.28m, 0), [new("1", 1)],
            Till: new ZReportTill(300, 100, 0, ExpectedCash: 400, CountedCash: 400, OverShort: 0, ClosedBy: "Samir"));
        await node.Send(new ReceiveZReportCommand(one, "events"));
        await node.Send(new ReceiveZReportCommand(two, "events"));

        var day = (await EndOfDay(node))!;
        // Floats 800; the cash the drawers took, 1,100.00, exactly: not the proportional share.
        Assert.Equal((800m, 1100m, 1900m), (day.OpeningFloat!.Value, day.CashSalesCollected, day.NetCashInTill));
        Assert.Equal(((decimal?)1895m, (decimal?)-5m), (day.Pos!.CountedCash, day.Pos.OverShort));
        Assert.Equal(["Mona", "Samir"], day.Pos.ShiftList.Select(x => x.ClosedBy!));

        // A manager unlocks it, with why: the figures are theirs, then locked to the POS again.
        var noWhy = await Assert.ThrowsAsync<DomainException>(() => node.Send(new OverrideEndOfDaySalesCommand(Yesterday, " ", "Boss")));
        Assert.Contains("why", noWhy.Message);
        await node.Send(new OverrideEndOfDaySalesCommand(Yesterday, "Card machine double-charged a guest", "Boss"));
        day = await node.Send(new SaveEndOfDaySalesCommand(Yesterday, 964.91m, 150, 163.09m, 0, null, "Boss", 800));
        Assert.Equal((false, 150m, "Boss"), (day.Pos!.SalesLocked, day.CardAmount!.Value, day.Pos.OverriddenBy));
        Assert.Equal(200m, day.Pos.Figures!.Card);
        Assert.Contains(day.AuditTrail!.Split('\n'), l => l.Contains("unlocked from the POS by Boss: Card machine double-charged a guest"));
        day = await node.Send(new RelockEndOfDaySalesCommand(Yesterday, "Boss"));
        Assert.Equal((true, 200m, 1100m), (day.Pos!.SalesLocked, day.CardAmount!.Value, day.CashSalesCollected));

        // Unlocked again and corrected: confirmed, the takings are the corrected figures.
        await node.Send(new OverrideEndOfDaySalesCommand(Yesterday, "Card machine double-charged a guest", "Boss"));
        await node.Send(new SaveEndOfDaySalesCommand(Yesterday, 964.91m, 150, 163.09m, 0, null, "Boss", 800));
        await node.Send(new SubmitEndOfDayCommand(Yesterday, "Boss", "staff-boss", CanApprove: true));
        var takings = Assert.Single(await LiveTakings(node));
        Assert.Equal((964.91m, 150m), (takings.GrossAmount!.Value, takings.CardAmount));
        Assert.Contains("overridden by Boss", takings.Notes);
    }

    // Its end of day closed and then undone by a manager: what the POS made of the day voided (its
    // stock put back, its takings reversed); confirmed again only once the POS has sent the shift
    // again, which records the day again.
    [Fact]
    public async Task A_day_undone_takes_the_same_z_report_again_when_the_pos_resends_it()
    {
        var (node, patty, _) = await StartAsync();
        await using var _ = node;
        var report = Report(Guid.NewGuid(), 500, [new("1", 3)]);
        var recorded = await node.Send(new ReceiveZReportCommand(report, "z-report"));
        Assert.Equal(-3m, await OnHand(node, patty));
        await node.Send(new SubmitEndOfDayCommand(Yesterday, "Ali", "staff-ali", CanApprove: true));
        Assert.Equal(684m, Assert.Single(await LiveTakings(node)).Amount);
        Assert.Equal(1, (await node.Send(new GetEndOfDaySequenceQuery())).LastClosed!.ZReports);

        var undone = await node.Send(new UndoLastEndOfDayCommand(Yesterday, "Z report on the wrong day", "Boss"));
        Assert.Equal((true, true, 1, EndOfDayStatus.Draft), (undone.TakingsVoided, undone.SalesVoided, undone.ZReports, undone.Day.Status));
        Assert.Equal(0m, await OnHand(node, patty));
        Assert.Empty(await LiveTakings(node));
        Assert.True(undone.Day.Pos!.Resend);

        // Not confirmed again before the POS sends the shift again: its sales are not in.
        var early = await Assert.ThrowsAsync<DomainException>(() => node.Send(new SubmitEndOfDayCommand(Yesterday, "Ali", "staff-ali", CanApprove: true)));
        Assert.Contains("send it again from the POS", early.Message);

        // Sent again as it was: recorded again, not taken for a resend.
        var again = await node.Send(new ReceiveZReportCommand(report, "z-report"));
        Assert.NotEqual(PosSyncOutcome.Unchanged, again.Outcome);
        Assert.NotEqual(recorded.SaleId, again.SaleId);
        Assert.Equal(-3m, await OnHand(node, patty));
        await node.Send(new SubmitEndOfDayCommand(Yesterday, "Ali", "staff-ali", CanApprove: true));
        Assert.Equal(684m, Assert.Single(await LiveTakings(node)).Amount);
        Assert.Equal(PosSyncOutcome.Unchanged, (await node.Send(new ReceiveZReportCommand(report, "events"))).Outcome);
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
              "takings": { "cash": 627.2, "card": 0, "tax": 87.81, "netSales": 627.2, "cashTotal": 715.01,
                           "voidsBefore": { "count": 2, "amount": 35 },
                           "voidsAfter": { "count": 1, "amount": 30, "reasons": [ { "reason": "Captain error", "count": 1, "amount": 30 } ] } },
              "closedAtUtc": "2026-11-09T23:10:00Z",
              "till": { "openingFloat": 500, "expectedCash": 1215.01, "actualCountedCash": 1210, "cashOverShort": -5.01, "closedBy": "Mona", "creditInvoices": 1500 }
            }
            """).RootElement;

        var report = PosEvents.DayClosedReport(data);

        Assert.Equal((shift, new DateOnly(2026, 11, 9), (int?)3), (report.ZReportId, report.Date, report.ShiftNumber));
        Assert.Equal((627.2m, 0m, 87.81m, 65m), (report.Takings.Cash, report.Takings.Card, report.Takings.Tax, report.Takings.VoidsAmount));
        Assert.Equal(["Captain error", "Before kitchen"], report.Takings.VoidReasons!.Select(r => r.Reason));
        Assert.Equal([("6101-17", 2, "Large"), ("9003", 1, (string?)null)], report.SoldItems.Select(i => (i.ItemCode, i.Quantity, i.Size)));
        Assert.Equal(("9003", "Captain error"), (report.WastedItems!.Single().ItemCode, report.WastedItems!.Single().Reason));
        // The till: its float, the cash it took (the takings' total when the till does not say), counted, short.
        var till = report.Till!;
        Assert.Equal((500m, 715.01m, (decimal?)1210m, (decimal?)-5.01m, "Mona", 1500m), (till.OpeningFloat, till.CashCollected, till.CountedCash, till.OverShort, till.ClosedBy, till.CreditInvoices));
        Assert.Equal(new DateTime(2026, 11, 9, 23, 10, 0, DateTimeKind.Utc), till.ClosedAtUtc);
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
