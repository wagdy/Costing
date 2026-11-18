using Costing.Domain.Access;
using Costing.Domain.Common;
using Costing.Domain.Company;
using Costing.Domain.Security;

namespace Costing.Domain.Tests;

// The books closed until a day: moved forward to a day that is over and closed; rolled back or
// lifted only with why; each change a line of the security audit log as it reads.
public class PeriodLockTests
{
    private static readonly DateOnly Today = new(2026, 11, 18);

    private static CompanySettings Company() => new("Otantik", "L.E", CurrencyPosition.Before, Country.Egypt, "Africa/Cairo", 6);

    [Fact]
    public void A_period_is_closed_forward_only_up_to_the_last_day_closed()
    {
        var company = Company();
        Assert.False(company.IsLocked(new DateOnly(2020, 1, 1)));

        company.LockBooks(new DateOnly(2026, 9, 30), Today, lastClosedDay: new DateOnly(2026, 11, 17));
        Assert.Equal((DateOnly?)new DateOnly(2026, 9, 30), company.BooksLockedUntilDate);
        Assert.True(company.IsLocked(new DateOnly(2026, 9, 30)));
        Assert.False(company.IsLocked(new DateOnly(2026, 10, 1)));

        // Not back, not the same day, not a day to come, not past the last end of day closed.
        Assert.Contains("already", Assert.Throws<DomainException>(() => company.LockBooks(new DateOnly(2026, 9, 30), Today, null)).Message);
        Assert.Contains("already", Assert.Throws<DomainException>(() => company.LockBooks(new DateOnly(2026, 8, 31), Today, null)).Message);
        Assert.Contains("today at the latest", Assert.Throws<DomainException>(() => company.LockBooks(Today.AddDays(1), Today, null)).Message);
        Assert.Contains("The last day closed is 30 Oct 2026",
            Assert.Throws<DomainException>(() => company.LockBooks(new DateOnly(2026, 10, 31), Today, new DateOnly(2026, 10, 30))).Message);
        Assert.Equal((DateOnly?)new DateOnly(2026, 9, 30), company.BooksLockedUntilDate);

        company.LockBooks(new DateOnly(2026, 10, 31), Today, new DateOnly(2026, 10, 31));
        Assert.Equal((DateOnly?)new DateOnly(2026, 10, 31), company.BooksLockedUntilDate);
    }

    [Fact]
    public void A_closed_period_is_opened_again_only_to_an_earlier_day_and_with_why()
    {
        var company = Company();
        Assert.Contains("not locked", Assert.Throws<DomainException>(() => company.UnlockBooks(null, "Auditor adjustment")).Message);
        company.LockBooks(new DateOnly(2026, 10, 31), Today, null);

        Assert.Throws<DomainException>(() => company.UnlockBooks(new DateOnly(2026, 9, 30), null));
        Assert.Throws<DomainException>(() => company.UnlockBooks(new DateOnly(2026, 9, 30), " fix "));
        Assert.Throws<DomainException>(() => company.UnlockBooks(new DateOnly(2026, 9, 30), new string('x', CompanySettings.MaxUnlockReasonLength + 1)));
        Assert.Contains("earlier day", Assert.Throws<DomainException>(() => company.UnlockBooks(new DateOnly(2026, 10, 31), "Auditor adjustment")).Message);
        Assert.Equal((DateOnly?)new DateOnly(2026, 10, 31), company.BooksLockedUntilDate);

        Assert.Equal("Auditor adjustment", company.UnlockBooks(new DateOnly(2026, 9, 30), "  Auditor adjustment  "));
        Assert.Equal((DateOnly?)new DateOnly(2026, 9, 30), company.BooksLockedUntilDate);
        company.UnlockBooks(null, "Opening balances re-entered");
        Assert.Null(company.BooksLockedUntilDate);
    }

    [Fact]
    public void Each_change_of_the_lock_reads_as_a_line_of_the_audit_log()
    {
        var locked = SecurityAuditLog.PeriodLocked(new DateOnly(2026, 9, 30), new DateOnly(2026, 10, 31), "Wagdy", "user-1");
        Assert.Equal((SecurityAuditAction.PeriodLocked, "PeriodLocked: 31-Oct-2026 by Wagdy", "2026-09-30", "2026-10-31", (string?)null, "Wagdy", "user-1"),
            (locked.Action, locked.Description, locked.PreviousValue, locked.NewValue, locked.Reason, locked.By, locked.ByUserId));

        var rolledBack = SecurityAuditLog.PeriodUnlocked(new DateOnly(2026, 10, 31), new DateOnly(2026, 9, 30), "Auditor adjustment", "Wagdy", null);
        Assert.Equal((SecurityAuditAction.PeriodUnlocked, "PeriodUnlocked: rolled back to 30-Sep-2026 by Wagdy. Reason: Auditor adjustment", "Auditor adjustment"),
            (rolledBack.Action, rolledBack.Description, rolledBack.Reason));

        var lifted = SecurityAuditLog.PeriodUnlocked(new DateOnly(2026, 10, 31), null, "Opening balances re-entered", " ", " ");
        Assert.Equal(("PeriodUnlocked: lock lifted (was 31-Oct-2026) by (unknown). Reason: Opening balances re-entered", "(unknown)", (string?)null, (string?)null),
            (lifted.Description, lifted.By, lifted.ByUserId, lifted.NewValue));
    }

    [Fact]
    public void A_record_of_a_closed_day_is_refused_in_both_languages_naming_the_lock_and_the_day()
    {
        var refused = new PeriodLockedException(new DateOnly(2026, 10, 31), new DateOnly(2026, 10, 12));
        Assert.IsAssignableFrom<DomainException>(refused);
        Assert.Equal(
            "Cannot modify records before the locked period (Books closed until 31 Oct 2026): 12 Oct 2026 is in it. " +
            "· لا يمكن تعديل أو إضافة حركات في فترة محاسبية تم إقفالها.",
            refused.Message);
    }

    [Fact]
    public void Opening_a_closed_period_is_the_owners_alone()
    {
        Assert.Contains(Permissions.SettingsUnlockPeriods, Permissions.All);
        Assert.True(RolePermissions.Has(UserRole.Manager, Permissions.SettingsUnlockPeriods));
        Assert.All([UserRole.Accountant, UserRole.CostController, UserRole.Storekeeper],
            role => Assert.False(RolePermissions.Has(role, Permissions.SettingsUnlockPeriods)));
    }
}
