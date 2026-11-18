using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Costing.Application.Approvals;
using Costing.Application.Books;
using Costing.Application.Purchases;
using Costing.Application.RawMaterials;
using Costing.Application.StockCounts;
using Costing.Application.Suppliers;
using Costing.Domain.Approvals;
using Costing.Domain.Common;
using Costing.Domain.Purchases;
using Costing.Domain.RawMaterials;
using Costing.Domain.Security;
using Costing.Infrastructure.Reports;

namespace Costing.Infrastructure.Tests;

// The books' lock on a real database: the lock set before (on Financials) carried over by the
// migration with where its history starts, and back again on the way down; a lock and an unlock
// kept with their lines in the security audit log; and the firewall's look-ups through the real
// repositories: a draft posted on a closed day, a closed day's count voided, refused.
public class PeriodLockTests
{
    private const string BeforeThePeriodLock = "20261118092632_AddKitchenStations";

    [Fact]
    public async Task The_lock_set_on_Financials_is_carried_over_to_the_company_with_where_its_history_starts()
    {
        await using var node = await TestSystem.StartAsync();
        var ct = TestContext.Current.CancellationToken;
        await node.Db(async db =>
        {
            var migrator = db.GetService<IMigrator>();
            await migrator.MigrateAsync(BeforeThePeriodLock, ct);
            await db.Database.ExecuteSqlRawAsync("""
                INSERT INTO costing."FinancialSettings" ("Id", "ServicePercent", "BooksLockedUntil") VALUES (1, 0, DATE '2026-09-30')
                ON CONFLICT ("Id") DO UPDATE SET "BooksLockedUntil" = EXCLUDED."BooksLockedUntil";
                """, ct);
            await migrator.MigrateAsync(cancellationToken: ct);
            return 0;
        });

        Assert.Equal((DateOnly?)new DateOnly(2026, 9, 30), await node.Db(db => db.CompanySettings.Select(c => c.BooksLockedUntilDate).SingleAsync(ct)));
        var carried = Assert.Single(await node.Db(db => db.SecurityAuditLogs.ToListAsync(ct)));
        Assert.Equal((SecurityAuditAction.PeriodLocked, "PeriodLocked: 30-Sep-2026 by System (carried over from the earlier books lock)", "2026-09-30", "System"),
            (carried.Action, carried.Description, carried.NewValue, carried.By));
        Assert.Equal((DateOnly?)new DateOnly(2026, 9, 30), (await node.Service<TreasuryService>(node.Scope()).GetSettingsAsync(ct)).BooksLockedUntil);

        // Down again: the lock back where it was.
        var back = await node.Db(async db =>
        {
            await db.GetService<IMigrator>().MigrateAsync(BeforeThePeriodLock, ct);
            var day = await db.Database.SqlQueryRaw<DateOnly?>("""SELECT "BooksLockedUntil" AS "Value" FROM costing."FinancialSettings" """).SingleAsync(ct);
            await db.GetService<IMigrator>().MigrateAsync(cancellationToken: ct);
            return day;
        });
        Assert.Equal((DateOnly?)new DateOnly(2026, 9, 30), back);
    }

    [Fact]
    public async Task A_closed_days_draft_and_count_are_refused_through_the_real_records_and_the_lock_kept_in_the_audit_log()
    {
        await using var node = await TestSystem.StartAsync();
        var ct = TestContext.Current.CancellationToken;
        using var scope = node.Scope();
        var today = node.Service<BooksGuard>(scope).Today;

        var flour = (await node.Send(new CreateRawMaterialCommand("Flour", UnitOfMeasure.Gram, PurchaseUnit: "kg", PurchaseUnitSize: 1000))).Id;
        var nile = (await node.Send(new SaveSupplierCommand(Guid.NewGuid(), "Nile Mills"))).Id;
        var draft = Guid.NewGuid();
        await node.Send(new SavePurchaseInvoiceCommand(draft, nile, "D-1", today.AddDays(-1), [new(flour, 5, "kg", 1000, 150)], "Omar", PurchasePaymentMethod.Credit));
        var count = Guid.NewGuid();
        await node.Send(new RecordStockCountCommand(count, [new(flour, 0)], "Samir"));

        var locked = await node.Send(new LockBooksCommand(today, "LOCK", "user-1", "Wagdy"));
        Assert.Equal((DateOnly?)today, locked.LockedUntil);
        Assert.Equal((DateOnly?)today, await node.Db(db => db.CompanySettings.Select(c => c.BooksLockedUntilDate).SingleAsync(ct)));

        Assert.Equal(today.AddDays(-1), (await Assert.ThrowsAsync<PeriodLockedException>(() => node.Send(new PostPurchaseInvoiceCommand(draft, "Omar", "staff-omar")))).Day);
        Assert.Equal(today, (await Assert.ThrowsAsync<PeriodLockedException>(() =>
            node.Send(new RequestDeletionCommand(Guid.NewGuid(), ApprovalModule.StockCount, count, "Miscounted", "staff-omar", "Omar", true)))).Day);
        Assert.Equal(PurchaseInvoiceStatus.Draft, await node.Db(db => db.PurchaseInvoices.Where(i => i.Id == draft).Select(i => i.Status).SingleAsync(ct)));

        var opened = await node.Send(new UnlockBooksCommand(null, "Count redone with the auditor", "user-1", "Wagdy"));
        Assert.Null(opened.LockedUntil);
        var lines = await node.Db(db => db.SecurityAuditLogs.OrderBy(e => e.OccurredAtUtc).ToListAsync(ct));
        Assert.Equal([SecurityAuditAction.PeriodLocked, SecurityAuditAction.PeriodUnlocked], lines.Select(l => l.Action));
        Assert.Equal(("Count redone with the auditor", "user-1", (string?)null), (lines[1].Reason, lines[1].ByUserId, lines[1].NewValue));
        // Open again: the count voided.
        await node.Send(new RequestDeletionCommand(Guid.NewGuid(), ApprovalModule.StockCount, count, "Miscounted", "staff-omar", "Omar", true));
    }
}
