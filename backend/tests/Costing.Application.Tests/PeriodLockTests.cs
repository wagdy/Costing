using MediatR;
using Costing.Application.Approvals;
using Costing.Application.Books;
using Costing.Application.Integrations;
using Costing.Application.Purchases;
using Costing.Application.RawMaterials;
using Costing.Application.Sales;
using Costing.Application.StockCounts;
using Costing.Application.Suppliers;
using Costing.Application.Treasury;
using Costing.Domain.Approvals;
using Costing.Domain.Common;
using Costing.Domain.Integrations;
using Costing.Domain.Purchases;
using Costing.Domain.RawMaterials;
using Costing.Domain.Sales;
using Costing.Domain.Security;
using Costing.Domain.StockCounts;
using Costing.Domain.Treasury;
using CountLine = Costing.Application.StockCounts.StockCountLine;

namespace Costing.Application.Tests;

// Month-end close: the books closed until a day by a manager who types LOCK, opened again by the
// owner with why, each in the security audit log; and the firewall that keeps every record of a
// closed day as it is: not entered, changed, posted or voided, refused whole before anything moves.
public class PeriodLockTests
{
    private readonly TestCosting _costing = new();
    private readonly DateOnly _today = TestCalendar.Today;

    private DateOnly LastMonthEnd => new DateOnly(_today.Year, _today.Month, 1).AddDays(-1);

    // Every command either writes to the books, and says on which days, or is listed here as one
    // that does not, with why: a new command fails this until it is one or the other.
    private static readonly Dictionary<string, string> NotTheBooks = new()
    {
        // The menu, recipes, materials, prep items and their categories: what things are, not what happened.
        ["SaveAddOnCommand"] = "menu", ["SetAddOnDeletedCommand"] = "menu",
        ["SaveMenuCategoryCommand"] = "menu", ["DeleteMenuCategoryCommand"] = "menu", ["SaveMenuItemCommand"] = "menu",
        ["SetMenuItemDeletedCommand"] = "menu", ["ImportMenuCommand"] = "menu", ["AddRecipesToMenuCommand"] = "menu",
        ["SaveComboOfferCommand"] = "menu", ["DeleteComboOfferCommand"] = "menu",
        ["SaveRecipeCommand"] = "recipes", ["SetRecipeCommand"] = "recipes", ["DeleteRecipeCommand"] = "recipes",
        ["RestoreRecipeCommand"] = "recipes", ["ImportRecipesCommand"] = "recipes", ["SaveRecipeCategoryCommand"] = "recipes",
        ["DeleteRecipeCategoryCommand"] = "recipes", ["BulkSwapMaterialCommand"] = "recipes", ["AssignRecipeStationCommand"] = "recipes",
        ["CreateRawMaterialCommand"] = "materials", ["UpdateRawMaterialCommand"] = "materials", ["ImportRawMaterialsCommand"] = "materials",
        ["SetSpotCheckItemCommand"] = "materials", ["AssignMaterialStationCommand"] = "materials",
        // A unit restated: quantities said in another unit, their worth as it was.
        ["ChangeMaterialUnitCommand"] = "materials",
        ["SavePrepItemCommand"] = "prep items", ["RequestPrepItemChangeCommand"] = "prep items", ["ImportPrepItemsCommand"] = "prep items",
        ["ImportPrepRecipesCommand"] = "prep items",
        ["SavePurchaseCategoryCommand"] = "categories", ["DeletePurchaseCategoryCommand"] = "categories",
        ["SaveExpenseItemCommand"] = "expense items", ["DeleteExpenseItemCommand"] = "expense items",
        ["RestoreExpenseItemCommand"] = "expense items", ["ImportExpenseItemsCommand"] = "expense items",
        ["SaveSupplierCommand"] = "suppliers", ["DeleteSupplierCommand"] = "suppliers", ["RestoreSupplierCommand"] = "suppliers",
        ["SaveKitchenStationCommand"] = "stations", ["DeleteKitchenStationCommand"] = "stations",
        ["AddLocalStaffMemberCommand"] = "staff", ["SaveStaffMemberCommand"] = "staff",
        // Purchase orders: what is ordered, not what came; an invoice against one is held to its own day.
        ["SavePurchaseOrderCommand"] = "orders", ["CreatePurchaseOrdersCommand"] = "orders", ["ApprovePurchaseOrderCommand"] = "orders",
        ["CancelPurchaseOrderCommand"] = "orders", ["ClosePurchaseOrderCommand"] = "orders",
        // Drafts and what is asked: nothing in the books until posted or approved, held to the lock then.
        ["DiscardPurchaseInvoiceCommand"] = "a draft", ["SaveStockCountCommand"] = "a draft", ["SubmitStockCountCommand"] = "a draft",
        ["RequestStockCountRecountCommand"] = "a draft", ["DiscardStockCountCommand"] = "a draft",
        ["RequestProductionOrderCommand"] = "asked: held to the lock when approved",
        ["RejectRequestCommand"] = "nothing done",
        // A document kept with an invoice: no figure changes.
        ["AttachPurchaseInvoiceFileCommand"] = "a document",
        // The system itself: settings, users, the lock, the links.
        ["UpdateCompanySettingsCommand"] = "settings", ["UploadCompanyLogoCommand"] = "settings", ["RemoveCompanyLogoCommand"] = "settings",
        ["LockBooksCommand"] = "the lock", ["UnlockBooksCommand"] = "the lock", ["SetUserTabsCommand"] = "users",
        ["GeneratePosKeyCommand"] = "the POS link", ["GenerateHrKeyCommand"] = "the HR link", ["SaveHrLinkCommand"] = "the HR link",
        ["RetryHrOutboxCommand"] = "the HR link", ["TestHrLinkCommand"] = "the HR link", ["SyncHrEmployeesCommand"] = "staff",
        ["EnsureCompanySettingsCommand"] = "settings",
        // The company's structure: its mode, branches and locations.
        ["ChangeOperatingModeCommand"] = "structure", ["SaveBranchCommand"] = "structure", ["SaveInventoryLocationCommand"] = "structure",
    };

    [Fact]
    public void Every_command_is_held_to_the_books_lock_or_said_not_to_write_to_the_books()
    {
        var assembly = typeof(IBooksEntry).Assembly;
        var commands = assembly.GetTypes()
            .Where(t => t is { IsClass: true, IsAbstract: false } && typeof(IBaseRequest).IsAssignableFrom(t) && !t.Name.EndsWith("Query", StringComparison.Ordinal))
            .ToList();
        Assert.NotEmpty(commands);
        var lookups = assembly.GetTypes()
            .SelectMany(t => t.GetInterfaces())
            .Where(i => i.IsGenericType && i.GetGenericTypeDefinition() == typeof(IBooksDays<>))
            .Select(i => i.GetGenericArguments()[0])
            .ToHashSet();

        var unclassified = new List<string>();
        var silent = new List<string>();
        foreach (var command in commands)
        {
            var guarded = typeof(IBooksEntry).IsAssignableFrom(command);
            var self = typeof(IChecksBooksItself).IsAssignableFrom(command);
            if (!guarded && !self && !NotTheBooks.ContainsKey(command.Name))
                unclassified.Add(command.Name);
            if (guarded && NotTheBooks.ContainsKey(command.Name))
                unclassified.Add(command.Name + " (both)");
            // A guarded command says its days somehow: on itself, as today's, or by a lookup.
            if (guarded)
            {
                var map = command.GetInterfaceMap(typeof(IBooksEntry));
                if (!map.TargetMethods.Any(m => m.DeclaringType == command) && !lookups.Contains(command))
                    silent.Add(command.Name);
            }
        }
        Assert.True(unclassified.Count == 0, "Not classified: " + string.Join(", ", unclassified));
        Assert.True(silent.Count == 0, "Guarded without days: " + string.Join(", ", silent));
        // And the list names only commands there are.
        Assert.Empty(NotTheBooks.Keys.Where(name => !commands.Any(c => c.Name == name)));
    }

    [Fact]
    public async Task A_manager_closes_a_month_by_typing_LOCK_and_the_owner_opens_it_again_only_with_why_each_in_the_audit_log()
    {
        _costing.Company();
        var october = LastMonthEnd.AddMonths(-1);
        october = new DateOnly(october.Year, october.Month, 1).AddMonths(1).AddDays(-1);

        var open = await _costing.Send(new GetPeriodLockQuery());
        Assert.Equal(((DateOnly?)null, (DateOnly?)LastMonthEnd), (open.LockedUntil, open.SuggestedUntil));

        // LOCK typed, exactly.
        Assert.Contains("Type LOCK", (await Assert.ThrowsAsync<DomainException>(() => _costing.Send(new LockBooksCommand(october, "lock", "u-1", "Wagdy")))).Message);
        Assert.Null(_costing.Settings.Row!.BooksLockedUntilDate);
        var locked = await _costing.Send(new LockBooksCommand(october, " LOCK ", "u-1", "Wagdy"));
        Assert.Equal(((DateOnly?)october, (DateOnly?)LastMonthEnd), (locked.LockedUntil, locked.SuggestedUntil));
        var entry = Assert.Single(locked.History);
        Assert.Equal((SecurityAuditAction.PeriodLocked, $"PeriodLocked: {october:dd-MMM-yyyy} by Wagdy", (string?)null, october.ToString("yyyy-MM-dd"), "Wagdy"),
            (entry.Action, entry.Description, entry.PreviousValue, entry.NewValue, entry.By));
        Assert.Equal("u-1", _costing.Audit.All.Single().ByUserId);

        // Forward only; never a day to come.
        Assert.Contains("closed until", (await Assert.ThrowsAsync<DomainException>(() =>
            _costing.Send(new LockBooksCommand(october.AddDays(-5), "LOCK", "u-1", "Wagdy")))).Message);
        Assert.Contains("up to today at the latest", (await Assert.ThrowsAsync<DomainException>(() =>
            _costing.Send(new LockBooksCommand(_today.AddDays(1), "LOCK", "u-1", "Wagdy")))).Message);
        var november = await _costing.Send(new LockBooksCommand(LastMonthEnd, "LOCK", "u-1", "Wagdy"));
        Assert.Equal(october.ToString("yyyy-MM-dd"), november.History[0].PreviousValue);

        // Opened again: back to an earlier day, with why; refused without.
        Assert.Contains("why", (await Assert.ThrowsAsync<DomainException>(() =>
            _costing.Send(new UnlockBooksCommand(october, "  ok ", "u-1", "Wagdy")))).Message);
        Assert.Contains("earlier day", (await Assert.ThrowsAsync<DomainException>(() =>
            _costing.Send(new UnlockBooksCommand(LastMonthEnd, "Auditor adjustment", "u-1", "Wagdy")))).Message);
        var rolledBack = await _costing.Send(new UnlockBooksCommand(october, "  Auditor adjustment ", "u-1", "Wagdy"));
        Assert.Equal((DateOnly?)october, rolledBack.LockedUntil);
        Assert.Equal((SecurityAuditAction.PeriodUnlocked, $"PeriodUnlocked: rolled back to {october:dd-MMM-yyyy} by Wagdy. Reason: Auditor adjustment",
            "Auditor adjustment", LastMonthEnd.ToString("yyyy-MM-dd")), (rolledBack.History[0].Action, rolledBack.History[0].Description,
            rolledBack.History[0].Reason, rolledBack.History[0].PreviousValue));

        // Lifted altogether, then nothing left to unlock.
        var lifted = await _costing.Send(new UnlockBooksCommand(null, "Opening balances re-entered", "u-1", "Wagdy"));
        Assert.Null(lifted.LockedUntil);
        Assert.Equal($"PeriodUnlocked: lock lifted (was {october:dd-MMM-yyyy}) by Wagdy. Reason: Opening balances re-entered", lifted.History[0].Description);
        Assert.Equal(4, lifted.History.Count);
        await Assert.ThrowsAsync<DomainException>(() => _costing.Send(new UnlockBooksCommand(null, "Again, to be sure", "u-1", "Wagdy")));
        Assert.Equal(4, _costing.Audit.All.Count);
    }

    [Fact]
    public void The_suggested_close_is_the_latest_month_end_that_can_be_closed()
    {
        var today = new DateOnly(2026, 11, 18);
        Assert.Equal(new DateOnly(2026, 10, 31), BooksGuard.SuggestedClose(null, today, null));
        Assert.Equal(new DateOnly(2026, 10, 31), BooksGuard.SuggestedClose(new DateOnly(2026, 9, 30), today, new DateOnly(2026, 11, 17)));
        // The last day closed before the month's end: the month before.
        Assert.Equal(new DateOnly(2026, 9, 30), BooksGuard.SuggestedClose(null, today, new DateOnly(2026, 10, 29)));
        // Closed through it already: nothing to suggest.
        Assert.Null(BooksGuard.SuggestedClose(new DateOnly(2026, 10, 31), today, null));
        // The month's last day itself, once it is over.
        Assert.Equal(new DateOnly(2026, 11, 30), BooksGuard.SuggestedClose(null, new DateOnly(2026, 11, 30), new DateOnly(2026, 11, 30)));
    }

    private async Task<(Guid Supplier, RawMaterial Flour)> SupplierAndFlourAsync()
    {
        var nile = Guid.NewGuid();
        await _costing.Send(new SaveSupplierCommand(nile, "Nile Mills"));
        return (nile, _costing.Inventory.Stock("Flour", UnitOfMeasure.Gram, 1_000));
    }

    private async Task<Guid> PostedInvoiceAsync(Guid supplier, RawMaterial flour, DateOnly day)
    {
        var id = Guid.NewGuid();
        await _costing.Send(new SavePurchaseInvoiceCommand(id, supplier, $"F-{id:N}"[..8], day, [new PurchaseInvoiceLineEntry(flour.Id, 2, "kg", 1000, 60)],
            "Omar", PurchasePaymentMethod.Credit));
        await _costing.Send(new PostPurchaseInvoiceCommand(id, "Omar", "staff-omar"));
        return id;
    }

    [Fact]
    public async Task An_invoice_of_a_closed_month_is_not_entered_posted_or_voided_and_is_again_once_the_month_is_opened()
    {
        var (nile, flour) = await SupplierAndFlourAsync();
        var inOctober = LastMonthEnd.AddDays(-3);
        var invoice = await PostedInvoiceAsync(nile, flour, inOctober);
        var asked = await PostedInvoiceAsync(nile, flour, inOctober);
        var draft = Guid.NewGuid();
        await _costing.Send(new SavePurchaseInvoiceCommand(draft, nile, "D-1", inOctober, [new PurchaseInvoiceLineEntry(flour.Id, 1, "kg", 1000, 30)], "Omar",
            PurchasePaymentMethod.Credit));
        // A void asked before the close, waiting for a manager.
        var request = await _costing.Send(new RequestDeletionCommand(Guid.NewGuid(), ApprovalModule.PurchaseInvoice, asked, "Entered twice", "staff-mona", "Mona", false));
        Assert.Equal(5_000m, flour.QuantityOnHand);

        _costing.CloseBooksUntil(LastMonthEnd);

        // Voided by a manager, or asked by anyone: refused, the invoice as it was.
        var voided = await Assert.ThrowsAsync<PeriodLockedException>(() =>
            _costing.Send(new RequestDeletionCommand(Guid.NewGuid(), ApprovalModule.PurchaseInvoice, invoice, "Wrong supplier", "staff-omar", "Omar", true)));
        Assert.Equal((LastMonthEnd, inOctober), (voided.LockedUntil, voided.Day));
        Assert.Equal(PeriodLockedException.Describe(LastMonthEnd, inOctober), voided.Message);
        Assert.Contains("لا يمكن تعديل أو إضافة حركات في فترة محاسبية تم إقفالها", voided.Message);
        await Assert.ThrowsAsync<PeriodLockedException>(() =>
            _costing.Send(new RequestDeletionCommand(Guid.NewGuid(), ApprovalModule.PurchaseInvoice, invoice, "Wrong supplier", "staff-mona", "Mona", false)));
        // The void asked before: not approved now.
        await Assert.ThrowsAsync<PeriodLockedException>(() => _costing.Send(new ApproveRequestCommand(request.Request!.Id, "Omar")));
        Assert.Equal(ApprovalStatus.Pending, (await _costing.Inventory.ApprovalRequests.GetByIdAsync(request.Request!.Id, TestContext.Current.CancellationToken))!.Status);
        // Corrected (which voids it), or paid on credit from its day: refused.
        await Assert.ThrowsAsync<PeriodLockedException>(() => _costing.Send(new CorrectPurchaseInvoiceCommand(Guid.NewGuid(), invoice,
            new InvoiceCorrection(Guid.NewGuid(), nile, "F-9", _today, [new PurchaseInvoiceLineEntry(flour.Id, 1, "kg", 1000, 30)], PurchasePaymentMethod.Credit, null),
            "Price", "staff-omar", "Omar", true)));
        // A new invoice dated in it, or the draft posted on its day: refused; the draft dated today instead: posted.
        await Assert.ThrowsAsync<PeriodLockedException>(() => _costing.Send(new SavePurchaseInvoiceCommand(Guid.NewGuid(), nile, "F-2", inOctober,
            [new PurchaseInvoiceLineEntry(flour.Id, 1, "kg", 1000, 30)], "Omar", PurchasePaymentMethod.Credit)));
        await Assert.ThrowsAsync<PeriodLockedException>(() => _costing.Send(new PostPurchaseInvoiceCommand(draft, "Omar", "staff-omar")));
        foreach (var id in new[] { invoice, asked })
            Assert.Equal(PurchaseInvoiceStatus.Posted, (await _costing.Inventory.Invoices.GetByIdAsync(id, TestContext.Current.CancellationToken))!.Status);
        Assert.Equal(5_000m, flour.QuantityOnHand);
        await _costing.Send(new SavePurchaseInvoiceCommand(draft, nile, "D-1", _today, [new PurchaseInvoiceLineEntry(flour.Id, 1, "kg", 1000, 30)], "Omar",
            PurchasePaymentMethod.Credit));
        await _costing.Send(new PostPurchaseInvoiceCommand(draft, "Omar", "staff-omar"));
        Assert.Equal(6_000m, flour.QuantityOnHand);

        // The month opened again by the owner: the void goes through.
        _costing.Settings.Row!.UnlockBooks(inOctober.AddDays(-1), "Auditor adjustment");
        await _costing.Send(new ApproveRequestCommand(request.Request!.Id, "Omar"));
        Assert.Equal(PurchaseInvoiceStatus.Voided, (await _costing.Inventory.Invoices.GetByIdAsync(asked, TestContext.Current.CancellationToken))!.Status);
        Assert.Equal(4_000m, flour.QuantityOnHand);
    }

    [Fact]
    public async Task With_the_books_closed_through_today_nothing_is_counted_wasted_sold_or_paid_today_and_a_closed_days_count_stays()
    {
        var flour = _costing.Inventory.Stock("Flour", UnitOfMeasure.Gram, 10_000);
        // Counted and posted today, then the books closed through today.
        var counted = Guid.NewGuid();
        await _costing.Send(new RecordStockCountCommand(counted, [new CountLine(flour.Id, 9_500)], "Samir"));
        var draft = Guid.NewGuid();
        await _costing.Send(new SaveStockCountCommand(draft, [new CountLine(flour.Id, 9_000)], "Samir"));
        var movements = _costing.Inventory.Movements.All.Count;
        _costing.CloseBooksUntil(_today);

        // The draft is kept (a draft is not the books), but not posted.
        await _costing.Send(new SaveStockCountCommand(draft, [new CountLine(flour.Id, 9_100)], "Samir"));
        Assert.Equal(_today, (await Assert.ThrowsAsync<PeriodLockedException>(() => _costing.Send(new PostStockCountCommand(draft, "Mona")))).Day);
        Assert.Equal(StockCountStatus.Draft, (await _costing.Inventory.Counts.GetByIdAsync(draft, TestContext.Current.CancellationToken))!.Status);
        await Assert.ThrowsAsync<PeriodLockedException>(() => _costing.Send(new RecordStockCountCommand(Guid.NewGuid(), [new CountLine(flour.Id, 1)], "Samir")));
        // The count posted on the closed day: not voided.
        await Assert.ThrowsAsync<PeriodLockedException>(() =>
            _costing.Send(new RequestDeletionCommand(Guid.NewGuid(), ApprovalModule.StockCount, counted, "Miscounted", "staff-omar", "Omar", true)));
        // Waste, a sale, the day's sales, a safe voucher: refused.
        await Assert.ThrowsAsync<PeriodLockedException>(() => _costing.Send(new RecordSpoilageCommand(Guid.NewGuid(), [new SpoilageLine(flour.Id, 100, "Wet")], "Samir")));
        await Assert.ThrowsAsync<PeriodLockedException>(() => _costing.Send(new RecordSaleCommand(
            new SaleInput(Guid.NewGuid(), null, _today, null, SalesChannel.DineIn, PaymentMethod.Cash, [new SaleLineInput(TestCosting.Burger, null, 1)]), "Sara")));
        await Assert.ThrowsAsync<PeriodLockedException>(() => _costing.Send(new RecordDailySalesCommand(Guid.NewGuid(), _today, [new DailySaleLine(TestCosting.Burger, null, 3)], "Sara")));
        await Assert.ThrowsAsync<PeriodLockedException>(() => _costing.Send(new RecordSafeVoucherCommand(Guid.NewGuid(),
            new SafeVoucher(Guid.NewGuid(), SafeTransactionKind.RevenueTransfer, 500, _today, RevenueDate: _today), null, "staff-omar", "Omar", true)));
        Assert.Equal(movements, _costing.Inventory.Movements.All.Count);
        Assert.Equal(9_500m, flour.QuantityOnHand);
        Assert.Empty(_costing.Sales.All);
    }

    [Fact]
    public async Task HRs_payroll_for_a_closed_month_is_refused_and_logged()
    {
        _costing.CloseBooksUntil(LastMonthEnd);
        var lastMonth = LastMonthEnd.ToString("yyyy-MM");
        var refused = await Assert.ThrowsAsync<PeriodLockedException>(() => _costing.Send(new ReceivePayrollRunCommand(new PayrollRunInput(
            Guid.NewGuid(), lastMonth, 2, 16_000, 0, 0, 0, 16_000, []))));
        Assert.Equal(LastMonthEnd, refused.Day);
        var logged = Assert.Single(_costing.Hr.Journal.All);
        Assert.Equal(("payroll-run", HrSyncOutcome.Refused), (logged.Call, logged.Outcome));
        Assert.StartsWith("Cannot modify records before the locked period", logged.Message);
        Assert.Empty(_costing.Hr.Runs.All);
        // This month's: kept.
        Assert.Equal(HrSyncOutcome.Recorded, (await _costing.Send(new ReceivePayrollRunCommand(new PayrollRunInput(
            Guid.NewGuid(), _today.ToString("yyyy-MM"), 2, 16_000, 0, 0, 0, 16_000, [])))).Outcome);
    }

    [Fact]
    public void The_month_of_a_figure_is_closed_once_its_last_day_is()
    {
        Assert.Equal(new DateOnly(2026, 2, 28), BooksGuard.MonthEnd(2026, 2));
        BooksGuard.EnsureOpen(new DateOnly(2026, 10, 30), [BooksGuard.MonthEnd(2026, 10)]);
        Assert.Throws<PeriodLockedException>(() => BooksGuard.EnsureOpen(new DateOnly(2026, 10, 31), [BooksGuard.MonthEnd(2026, 10)]));
        // Of several days, the earliest named; none at all, nothing refused.
        Assert.Equal(new DateOnly(2026, 10, 2), Assert.Throws<PeriodLockedException>(() =>
            BooksGuard.EnsureOpen(new DateOnly(2026, 10, 31), [null, new DateOnly(2026, 11, 2), new DateOnly(2026, 10, 9), new DateOnly(2026, 10, 2)])).Day);
        BooksGuard.EnsureOpen(new DateOnly(2026, 10, 31), [null]);
    }
}
