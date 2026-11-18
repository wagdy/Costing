using Costing.Domain.Common;
using Costing.Domain.Company;
using Costing.Domain.RawMaterials;
using Costing.Domain.Security;
using Costing.Domain.Treasury;

namespace Costing.Domain.Tests;

// How the company is built: an open-space shop until a manager says otherwise; back to one branch
// only once the others are out of use; the first branch and its main store kept as they are; and a
// record undone in the branch it was entered in.
public class CompanyStructureTests
{
    private static CompanySettings Company() => new("Otantik", "L.E", CurrencyPosition.Before, Country.Egypt, "Africa/Cairo", 6);

    private static readonly Branch First = new(Branch.DefaultId, "Otantik", "أوتنتيك", BranchType.Restaurant);

    [Fact]
    public void A_company_is_an_open_space_shop_until_a_manager_builds_it_otherwise()
    {
        var company = Company();
        Assert.Equal(SystemOperatingMode.SingleBranch_OpenSpace, company.OperatingMode);
        Assert.Equal(
            [(false, false), (false, true), (true, true), (true, true)],
            Enum.GetValues<SystemOperatingMode>().Select(m => (m.IsMultiBranch(), m.HasLocations())));
    }

    [Fact]
    public void Back_to_one_branch_only_once_the_others_are_out_of_use()
    {
        var company = Company();
        var tanta = new Branch(Guid.NewGuid(), "Tanta", "طنطا", BranchType.Restaurant);
        Assert.Equal(SystemOperatingMode.SingleBranch_OpenSpace, company.ChangeOperatingMode(SystemOperatingMode.MultiBranch_Independent, [First]));
        Assert.Equal(SystemOperatingMode.MultiBranch_Independent, company.ChangeOperatingMode(SystemOperatingMode.MultiBranch_CentralKitchen, [First, tanta]));

        var refused = Assert.Throws<DomainException>(() => company.ChangeOperatingMode(SystemOperatingMode.SingleBranch_WithSubStores, [First, tanta]));
        Assert.StartsWith("Take Tanta out of use first", refused.Message);
        Assert.Equal(SystemOperatingMode.MultiBranch_CentralKitchen, company.OperatingMode);

        tanta.Change("Tanta", "طنطا", BranchType.Restaurant, isActive: false);
        company.ChangeOperatingMode(SystemOperatingMode.SingleBranch_WithSubStores, [First, tanta]);
        Assert.Equal(SystemOperatingMode.SingleBranch_WithSubStores, company.OperatingMode);
        Assert.Throws<DomainException>(() => company.ChangeOperatingMode((SystemOperatingMode)7, [First]));
    }

    [Fact]
    public void The_first_branch_and_its_main_store_stay_in_use()
    {
        Assert.True(First.IsDefault);
        Assert.Contains("stays in use", Assert.Throws<DomainException>(() => First.Change("Otantik", null, BranchType.Restaurant, false)).Message);
        Assert.Throws<DomainException>(() => new Branch(Guid.NewGuid(), " ", null, BranchType.Restaurant));
        Assert.Throws<DomainException>(() => new Branch(Guid.NewGuid(), "Tanta", new string('ط', Branch.MaxName + 1), BranchType.Restaurant));
        Assert.Throws<DomainException>(() => new Branch(Guid.NewGuid(), "Tanta", null, (BranchType)9));
        var kitchen = new Branch(Guid.NewGuid(), "  Central kitchen ", " ", BranchType.CentralKitchen);
        Assert.Equal(("Central kitchen", (string?)null, false), (kitchen.Name, kitchen.NameAr, kitchen.IsDefault));

        var store = new InventoryLocation(InventoryLocation.DefaultId, Branch.DefaultId, "Main Store", "المخزن الرئيسي", LocationKind.MainStore);
        Assert.Throws<DomainException>(() => store.Change("Main Store", null, LocationKind.Kitchen, true));
        Assert.Throws<DomainException>(() => store.Change("Main Store", null, LocationKind.MainStore, false));
        store.Change("Main warehouse", "المخزن الرئيسي", LocationKind.MainStore, true);
        Assert.Equal("Main warehouse", store.Name);
        var bar = new InventoryLocation(Guid.NewGuid(), Branch.DefaultId, "Bar", "البار", LocationKind.Bar);
        bar.Change("Bar", "البار", LocationKind.Bar, false);
        Assert.False(bar.IsActive);
    }

    [Fact]
    public void A_record_is_undone_in_the_branch_it_was_entered_in()
    {
        var tanta = Guid.NewGuid();
        var flour = new RawMaterial("Flour", UnitOfMeasure.Gram);
        var bought = flour.ReceivePurchase(5_000, Guid.NewGuid(), 150);
        bought.AssignBranch(tanta);
        Assert.Equal(tanta, flour.Reverse(bought, "Omar").BranchId);

        var paid = SafeTransaction.ExpenseVoucher(Guid.NewGuid(), 200, new DateOnly(2026, 11, 2), Guid.NewGuid(), null, "Omar");
        paid.AssignBranch(tanta);
        Assert.Equal(tanta, paid.Void(Guid.NewGuid(), new DateOnly(2026, 11, 18), "Omar").BranchId);
    }

    [Fact]
    public void A_change_of_structure_reads_as_a_line_of_the_audit_log()
    {
        var changed = SecurityAuditLog.OperatingModeChanged("SingleBranch_OpenSpace", "MultiBranch_Independent", "Wagdy", "user-1");
        Assert.Equal((SecurityAuditAction.OperatingModeChanged, "OperatingModeChanged: SingleBranch_OpenSpace → MultiBranch_Independent by Wagdy",
            "SingleBranch_OpenSpace", "MultiBranch_Independent"), (changed.Action, changed.Description, changed.PreviousValue, changed.NewValue));
    }
}
