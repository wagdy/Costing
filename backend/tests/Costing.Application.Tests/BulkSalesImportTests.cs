using Costing.Application.EndOfDay;
using Costing.Application.Recipes;
using Costing.Application.Sales;
using Costing.Domain.Common;
using Costing.Domain.EndOfDay;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;

namespace Costing.Application.Tests;

// Several days' sales in one sheet: read by their Date column, imported oldest day first in the end
// of day's order, every day or none; and a one-day import that will not take a sheet of several.
public class BulkSalesImportTests
{
    private readonly TestCosting _costing = new();
    private readonly DateOnly _today = TestCalendar.Today;

    private static DailySaleRow Sold(int row, DateOnly day, string item, decimal quantity) => new(row, item, quantity, day);

    private static DailySaleRow Discount(int row, DateOnly day, decimal amount, string? reason, int bills) => new(row, null, null, day, amount, reason, bills);

    private static string Day(DateOnly day) => day.ToString("dd/MM/yyyy", System.Globalization.CultureInfo.InvariantCulture);

    private async Task<RawMaterial> BurgersAsync()
    {
        var beef = _costing.Inventory.Stock("Beef", UnitOfMeasure.Gram, 5_000);
        await _costing.Send(new SetRecipeCommand(RecipeTargetKind.MenuItem, TestCosting.Burger, null, [new(beef.Id, 150)]));
        return beef;
    }

    // The day four days ago closed: the next to close is three days ago.
    private async Task CloseAsync(DateOnly day)
    {
        await _costing.Send(new SaveEndOfDaySalesCommand(day, 500, null, null, null, null, "Ali"));
        await _costing.Send(new SubmitEndOfDayCommand(day, "Ali"));
    }

    [Fact]
    public async Task A_sheet_of_several_days_is_previewed_then_imported_oldest_day_first_with_their_discounts_and_drafts()
    {
        var beef = await BurgersAsync();
        var (d4, d3, d2, d1) = (_today.AddDays(-4), _today.AddDays(-3), _today.AddDays(-2), _today.AddDays(-1));
        await CloseAsync(d4);
        // Written in any order: grouped by day, the oldest first.
        DailySaleRow[] sheet =
        [
            Sold(2, d2, "1 · Burger", 3),
            Sold(3, d3, "Burger", 4),
            Discount(4, d3, 50, "Loyalty", 2),
            Discount(5, d3, 10, " loyalty ", 1),
            Sold(6, d1, "1", 2),
            Sold(7, d2, "Pizza", 1),
        ];

        var preview = await _costing.Send(new PreviewBulkSalesImportQuery(sheet));
        Assert.Equal((true, false, d4, (DateOnly?)d3), (preview.Ok, preview.Recorded, preview.LastClosedDate, preview.ExpectedFirstDate));
        Assert.Equal(
            [(d3, 3, 4, 480m, 60m, 0), (d2, 2, 3, 360m, 0m, 1), (d1, 1, 2, 240m, 0m, 0)],
            preview.Days.Select(d => (d.Date, d.Rows, d.Quantity, d.Value, d.Discounts, d.Skipped)));
        Assert.Equal((7, "There is no Pizza on the menu: choose the item from the list, or add it on Menu first."),
            (Assert.Single(preview.Skipped).Row, preview.Skipped[0].Reason));
        // Previewed: nothing recorded.
        Assert.Equal(5_000m, beef.QuantityOnHand);
        Assert.Null(await _costing.Sales.GetDailySummaryAsync(d3));

        var imported = await _costing.Send(new BulkImportSalesCommand(sheet, "Sara"));
        Assert.Equal((true, true, 3), (imported.Ok, imported.Recorded, imported.DraftsCreated));
        Assert.All(imported.Days, d => Assert.NotNull(d.SaleId));
        Assert.Equal(5_000m - 9 * 150, beef.QuantityOnHand);
        var first = (await _costing.Sales.GetDailySummaryAsync(d3))!;
        Assert.Equal((60m, "Loyalty", 60m, 3), (first.DiscountAmount, first.DiscountReasons.Single().Reason, first.DiscountReasons.Single().Amount,
            first.DiscountReasons.Single().Count));
        // Each day's end of day an empty draft, closed in turn: none taken for a draft entered under the wrong date.
        Assert.All([d3, d2, d1], day => Assert.Equal(EndOfDayStatus.Draft, _costing.EndOfDays.All.Single(r => r.Date == day).Status));
        var sequence = await _costing.Send(new GetEndOfDaySequenceQuery());
        Assert.Equal((d3, 0), (sequence.NextExpectedDate, sequence.StrandedDrafts!.Count));

        // The same sheet again: its days are in already; nothing more recorded.
        var again = await Assert.ThrowsAsync<DomainException>(() => _costing.Send(new BulkImportSalesCommand(sheet, "Sara")));
        Assert.Contains($"The sales of {Day(d3)} are entered already", again.Message);
        Assert.Equal(5_000m - 9 * 150, beef.QuantityOnHand);
    }

    [Fact]
    public async Task A_sheet_out_of_the_days_order_is_refused_whole_naming_what_stops_it()
    {
        var beef = await BurgersAsync();
        var (d4, d3, d2, d1) = (_today.AddDays(-4), _today.AddDays(-3), _today.AddDays(-2), _today.AddDays(-1));
        await CloseAsync(d4);
        async Task<IReadOnlyList<string>> Problems(params DailySaleRow[] rows)
        {
            var preview = await _costing.Send(new PreviewBulkSalesImportQuery(rows));
            Assert.False(preview.Ok);
            return preview.Problems;
        }

        // A day skipped between two.
        var gap = await Problems(Sold(2, d3, "Burger", 1), Sold(3, d1, "Burger", 1));
        Assert.Equal(
            $"Missing day {Day(d2)} in the sequence. Please include it in the file or mark it as a Closed Day first. · يوم {Day(d2)} مفقود من التسلسل، يرجى إضافته أو إغلاقه كيوم إجازة أولاً.",
            Assert.Single(gap));
        // Recorded: refused whole, nothing taken, no draft made.
        var refused = await Assert.ThrowsAsync<DomainException>(() =>
            _costing.Send(new BulkImportSalesCommand([Sold(2, d3, "Burger", 1), Sold(3, d1, "Burger", 1)], "Sara")));
        Assert.StartsWith($"Missing day {Day(d2)}", refused.Message);
        Assert.Equal(5_000m, beef.QuantityOnHand);
        Assert.Null(await _costing.Sales.GetDailySummaryAsync(d3));
        Assert.DoesNotContain(_costing.EndOfDays.All, r => r.Date == d3);

        // Not starting on the next day to import.
        Assert.StartsWith($"Missing day {Day(d3)} in the sequence: the file starts on {Day(d2)}.", Assert.Single(await Problems(Sold(2, d2, "Burger", 1))));
        // A day still to come, a day closed already.
        Assert.Contains(await Problems(Sold(2, d3, "Burger", 1), Sold(3, d2, "Burger", 1), Sold(4, d1, "Burger", 1), Sold(5, _today, "Burger", 1),
            Sold(6, _today.AddDays(1), "Burger", 1)), p => p.StartsWith($"{Day(_today.AddDays(1))} has not come yet"));
        Assert.Contains(await Problems(Sold(2, d4, "Burger", 1), Sold(3, d3, "Burger", 1)), p => p.StartsWith($"{Day(d4)} is closed already"));
        // A day with nothing that can be read, and discounts beyond its items.
        Assert.Equal(
            [$"No item could be read for {Day(d3)}: see the rows left out. · لم يُقرأ أي صنف لهذا اليوم.",
             $"The discounts of {Day(d2)} (500.00) are more than its items come to at the menu's prices (120.00): check them. · الخصومات أكبر من قيمة المبيعات بأسعار المنيو."],
            await Problems(Sold(2, d3, "Pizza", 1), Sold(3, d2, "Burger", 1), Discount(4, d2, 500, "Staff", 1)));
        // Every row needs its day.
        Assert.StartsWith("Every row needs its day in the Date column (dd/MM/yyyy): row 3 has none.", (await Assert.ThrowsAsync<DomainException>(() =>
            _costing.Send(new PreviewBulkSalesImportQuery([Sold(2, d3, "Burger", 1), new DailySaleRow(3, "Burger", 1)])))).Message);
    }

    [Fact]
    public async Task A_day_whose_sales_are_in_already_is_neither_the_start_nor_a_gap()
    {
        await BurgersAsync();
        var (d4, d3, d2, d1) = (_today.AddDays(-4), _today.AddDays(-3), _today.AddDays(-2), _today.AddDays(-1));
        await CloseAsync(d4);
        // The next day's sales entered by hand: the file starts after it.
        await _costing.Send(new RecordDailySalesCommand(Guid.NewGuid(), d3, [new(TestCosting.Burger, null, 1)], "Sara"));
        var preview = await _costing.Send(new PreviewBulkSalesImportQuery([Sold(2, d2, "Burger", 1), Sold(3, d1, "Burger", 1)]));
        Assert.Equal((true, (DateOnly?)d2), (preview.Ok, preview.ExpectedFirstDate));
        // Nothing closed yet: any day up to today starts it.
        var fresh = new TestCosting();
        Assert.True((await fresh.Send(new PreviewBulkSalesImportQuery([Sold(2, _today.AddDays(-10), "Burger", 1)]))).Ok);
    }

    [Fact]
    public async Task A_one_day_import_reads_its_discounts_and_will_not_take_a_sheet_of_several_days()
    {
        await BurgersAsync();
        var day = _today.AddDays(-1);
        var several = await Assert.ThrowsAsync<DomainException>(() => _costing.Send(new ImportDailySalesCommand(day,
            [Sold(2, day, "Burger", 2), Sold(3, _today, "Burger", 1)], "Sara")));
        Assert.StartsWith($"The sheet has sales of other days ({Day(_today)}): upload it as a multi-day sheet", several.Message);

        var imported = await _costing.Send(new ImportDailySalesCommand(day,
            [Sold(2, day, "Burger", 2), new DailySaleRow(3, "Burger", 1), Discount(4, day, 30, "Staff", 1)], "Sara"));
        Assert.Equal((3, 360m, 30m), (imported.Quantity, imported.Value, imported.Discounts));
        Assert.Equal("Staff", (await _costing.Sales.GetDailySummaryAsync(day))!.DiscountReasons.Single().Reason);
    }
}
