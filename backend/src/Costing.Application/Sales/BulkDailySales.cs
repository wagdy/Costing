using MediatR;
using Costing.Application.Common;
using Costing.Application.RawMaterials;
using Costing.Domain.Common;
using Costing.Domain.EndOfDay;
using Costing.Domain.Menu;
using Costing.Domain.Sales;

namespace Costing.Application.Sales;

// Several days' sales in one sheet (استيراد مبيعات متعدد الأيام): each row with its day in the Date
// column, the days imported oldest first and in the order the end of day keeps (EndOfDaySequence).
// The file starts on the first day after the last closed one whose sales are not in yet, its days
// follow one another (a day between them only when its sales are in already), and none is still to
// come. Previewed first, then recorded all together or not at all: each day's sales summary (its
// stock taken by its recipes and combos, its discounts and why) and, for each day not started yet,
// its end of day as an empty draft, to be closed in turn.

// One day of the sheet: its rows, the items and how many sold, at the menu's prices, its discounts,
// the rows left out, and once recorded its sales summary.
public sealed record BulkSalesDay(DateOnly Date, int Rows, int Items, int Quantity, decimal Value, decimal Discounts, int Skipped, Guid? SaleId = null);

// The sheet read and checked against the days' order: its days oldest first, every row left out and
// why, what stops it (Problems, each in English and Arabic), the last closed day and the day the
// file should start on; recorded, how many end-of-day drafts were made.
public sealed record BulkSalesImport(
    IReadOnlyList<BulkSalesDay> Days,
    IReadOnlyList<SkippedSheetRow> Skipped,
    IReadOnlyList<string> Problems,
    DateOnly? LastClosedDate,
    DateOnly? ExpectedFirstDate,
    bool Ok,
    bool Recorded = false,
    int DraftsCreated = 0);

public sealed record PreviewBulkSalesImportQuery(IReadOnlyList<DailySaleRow> Rows) : IRequest<BulkSalesImport>;

public sealed record BulkImportSalesCommand(IReadOnlyList<DailySaleRow> Rows, string StaffName) : IRequest<BulkSalesImport>, IRetryOnConflict;

internal sealed class BulkSalesPlanner(IMenuRepository menu, ISalesReceiptRepository sales, IEndOfDayRepository days, IBusinessCalendar calendar)
{
    public const int MaxRows = 20_000;
    public const int MaxDays = 31;

    public sealed record Day(DateOnly Date, int Rows, DailySheet Sheet);

    public sealed record Plan(
        IReadOnlyList<Day> Days, IReadOnlyList<SkippedSheetRow> Skipped, IReadOnlyList<string> Problems, DateOnly? LastClosed, DateOnly? ExpectedFirst,
        SaleWriter.Menu Known)
    {
        public BulkSalesImport Result(IReadOnlyDictionary<DateOnly, Guid>? recorded = null, int drafts = 0) => new(
            Days.Select(d => new BulkSalesDay(
                    d.Date, d.Rows, d.Sheet.Items, d.Sheet.Quantity, d.Sheet.Value, d.Sheet.Discounts, d.Sheet.Skipped.Count,
                    recorded?.GetValueOrDefault(d.Date)))
                .ToList(),
            Skipped, Problems, LastClosed, ExpectedFirst, Problems.Count == 0, recorded is not null, drafts);
    }

    public async Task<Plan> PlanAsync(IReadOnlyList<DailySaleRow> rows, CancellationToken cancellationToken)
    {
        if (rows.Count == 0)
            throw new DomainException("The sheet has no rows on it. · الملف لا يحتوي على صفوف.");
        if (rows.Count > MaxRows)
            throw new DomainException($"Import {MaxRows:N0} rows at most at a time. · {MaxRows:N0} صف على الأكثر.");
        var undated = rows.Where(r => r.Date is null).Select(r => r.Row).ToList();
        if (undated.Count > 0)
            throw new DomainException(
                $"Every row needs its day in the Date column (dd/MM/yyyy): {(undated.Count == 1 ? "row" : "rows")} " +
                $"{string.Join(", ", undated.Take(10))}{(undated.Count > 10 ? ", …" : "")} {(undated.Count == 1 ? "has" : "have")} none. " +
                "· كل صف يحتاج تاريخ المبيعات في عمود التاريخ.");
        var groups = rows.GroupBy(r => r.Date!.Value).OrderBy(g => g.Key).ToList();
        if (groups.Count > MaxDays)
            throw new DomainException($"Import {MaxDays} days at most at a time: the sheet has {groups.Count}. · {MaxDays} يومًا على الأكثر في الملف.");

        var known = await SaleWriter.Menu.LoadAsync(menu, cancellationToken);
        var targets = DailySalesItems.Of(known.Items.Values.ToList());
        var problems = new List<string>();
        var planned = new List<Day>();
        foreach (var group in groups)
        {
            var sheet = DailySheet.Read(group, targets, known);
            planned.Add(new Day(group.Key, group.Count(), sheet));
            if (sheet.Lines.Count == 0)
                problems.Add($"No item could be read for {DailySheet.Day(group.Key)}: see the rows left out. · لم يُقرأ أي صنف لهذا اليوم.");
            else if (sheet.Problem(group.Key) is { } problem)
                problems.Add(problem);
        }

        // The days' order (EndOfDaySequence): after the last closed day, never ahead of today.
        var now = DateTime.UtcNow;
        var today = new[] { calendar.BusinessDateOf(now), calendar.LocalDateOf(now) }.Max();
        var lastClosed = await days.LastSubmittedDateAsync(cancellationToken);
        var dates = planned.Select(d => d.Date).ToList();
        foreach (var date in dates)
        {
            if (date > today)
                problems.Add($"{DailySheet.Day(date)} has not come yet: import a day once it is over. · هذا اليوم لم يأتِ بعد.");
            else if (lastClosed is { } last && date <= last)
                problems.Add(
                    $"{DailySheet.Day(date)} is closed already (the last closed day is {DailySheet.Day(last)}): leave it out of the file. " +
                    "· هذا اليوم مُقفل بالفعل.");
            else if (await sales.GetDailySummaryAsync(date, cancellationToken) is not null)
                problems.Add(
                    $"The sales of {DailySheet.Day(date)} are entered already: leave the day out of the file, or void them on Sales first. " +
                    "· مبيعات هذا اليوم مسجلة بالفعل.");
        }

        // The day the file starts on: the first after the last closed day whose sales are not in yet.
        DateOnly? expected = null;
        if (lastClosed is { } closed)
        {
            var day = closed.AddDays(1);
            while (day < today && await sales.GetDailySummaryAsync(day, cancellationToken) is not null)
                day = day.AddDays(1);
            expected = day;
            if (dates[0] > day)
                problems.Add(
                    $"Missing day {DailySheet.Day(day)} in the sequence: the file starts on {DailySheet.Day(dates[0])}. " +
                    "Please include it in the file or mark it as a Closed Day first. " +
                    $"· يوم {DailySheet.Day(day)} مفقود من التسلسل، يرجى إضافته أو إغلاقه كيوم إجازة أولاً.");
        }

        // No day missing between them, unless its sales are in already.
        for (var i = 1; i < dates.Count; i++)
            for (var missing = dates[i - 1].AddDays(1); missing < dates[i]; missing = missing.AddDays(1))
                if (await sales.GetDailySummaryAsync(missing, cancellationToken) is null)
                    problems.Add(
                        $"Missing day {DailySheet.Day(missing)} in the sequence. Please include it in the file or mark it as a Closed Day first. " +
                        $"· يوم {DailySheet.Day(missing)} مفقود من التسلسل، يرجى إضافته أو إغلاقه كيوم إجازة أولاً.");

        return new Plan(planned, planned.SelectMany(d => d.Sheet.Skipped).ToList(), problems, lastClosed, expected, known);
    }
}

internal sealed class PreviewBulkSalesImportHandler(BulkSalesPlanner planner) : IRequestHandler<PreviewBulkSalesImportQuery, BulkSalesImport>
{
    public async Task<BulkSalesImport> Handle(PreviewBulkSalesImportQuery request, CancellationToken cancellationToken) =>
        (await planner.PlanAsync(request.Rows, cancellationToken)).Result();
}

// Recorded all together or not at all, oldest day first: refused whole, naming what stops it, when
// any day is out of order or cannot be read.
internal sealed class BulkImportSalesHandler(BulkSalesPlanner planner, DailySalesWriter writer, IEndOfDayRepository days, IUnitOfWork unitOfWork)
    : IRequestHandler<BulkImportSalesCommand, BulkSalesImport>
{
    public async Task<BulkSalesImport> Handle(BulkImportSalesCommand request, CancellationToken cancellationToken)
    {
        var plan = await planner.PlanAsync(request.Rows, cancellationToken);
        if (plan.Problems.Count > 0)
            throw new DomainException(
                string.Join(" ", plan.Problems.Take(3)) + (plan.Problems.Count > 3 ? $" (and {plan.Problems.Count - 3} more)" : ""));

        var recorded = new Dictionary<DateOnly, Guid>();
        var drafts = 0;
        foreach (var day in plan.Days)
        {
            var receipt = await writer.RecordAsync(
                Guid.NewGuid(), day.Date, day.Sheet.Lines, request.StaffName, plan.Known, cancellationToken, day.Sheet.Discounts, day.Sheet.Reasons);
            recorded[day.Date] = receipt.Id;
            // Its end of day, to be closed in turn: an empty draft, unless one is started already.
            if (await days.GetByDateAsync(day.Date, cancellationToken) is null)
            {
                days.Add(new EndOfDayReport(Guid.NewGuid(), day.Date, request.StaffName));
                drafts++;
            }
        }
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return plan.Result(recorded, drafts);
    }
}
