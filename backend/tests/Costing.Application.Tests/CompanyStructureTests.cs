using Costing.Application.Company;
using Costing.Application.StockCounts;
using Costing.Domain.Common;
using Costing.Domain.Company;
using Costing.Domain.RawMaterials;
using Costing.Domain.Security;
using CountLine = Costing.Application.StockCounts.StockCountLine;

namespace Costing.Application.Tests;

// The company's structure through its use cases: an open-space shop with its one branch and store;
// locations once the structure has them, branches once it has several (each with its main store);
// back to one branch only once the others are out of use; each change of structure in the audit
// log; and the lists narrowed to the branch being worked in only when there are several.
public class CompanyStructureTests
{
    private readonly TestCosting _costing = new();

    [Fact]
    public async Task An_open_space_shop_has_one_branch_and_one_store_and_adds_neither()
    {
        _costing.Company();
        var open = await _costing.Send(new GetCompanyStructureQuery());
        Assert.Equal(SystemOperatingMode.SingleBranch_OpenSpace, open.Mode);
        var branch = Assert.Single(open.Branches);
        Assert.Equal(("Test Bistro", true, 1), (branch.Name, branch.IsDefault, branch.Locations));
        Assert.Equal(("Main Store", LocationKind.MainStore, true), (Assert.Single(open.Locations).Name, open.Locations[0].Kind, open.Locations[0].IsDefault));
        Assert.Equal(SystemOperatingMode.SingleBranch_OpenSpace, (await _costing.Send(new GetCompanySettingsQuery())).OperatingMode);

        Assert.Contains("several branches", (await Assert.ThrowsAsync<DomainException>(() =>
            _costing.Send(new SaveBranchCommand(Guid.NewGuid(), "Tanta", "طنطا", BranchType.Restaurant)))).Message);
        Assert.Contains("open-space shop", (await Assert.ThrowsAsync<DomainException>(() =>
            _costing.Send(new SaveInventoryLocationCommand(Guid.NewGuid(), Branch.DefaultId, "Kitchen", "المطبخ", LocationKind.Kitchen)))).Message);
        // Its own branch renamed in any structure.
        Assert.Equal("Otantik", (await _costing.Send(new SaveBranchCommand(Branch.DefaultId, "Otantik", "أوتنتيك", BranchType.Restaurant))).Name);
        Assert.Empty(_costing.Audit.All);
    }

    [Fact]
    public async Task Locations_then_branches_follow_the_structure_and_each_change_of_it_is_audited()
    {
        _costing.Company();
        var stores = await _costing.Send(new ChangeOperatingModeCommand(SystemOperatingMode.SingleBranch_WithSubStores, "user-1", "Wagdy"));
        Assert.Equal(SystemOperatingMode.SingleBranch_WithSubStores, stores.Mode);
        Assert.Equal(SystemOperatingMode.SingleBranch_WithSubStores, _costing.Profile.Current.OperatingMode);
        var kitchen = await _costing.Send(new SaveInventoryLocationCommand(Guid.NewGuid(), Branch.DefaultId, "Kitchen", "المطبخ", LocationKind.Kitchen));
        Assert.Equal((Branch.DefaultId, LocationKind.Kitchen, false), (kitchen.BranchId, kitchen.Kind, kitchen.IsDefault));
        Assert.Contains("location called Kitchen already", (await Assert.ThrowsAsync<DomainException>(() =>
            _costing.Send(new SaveInventoryLocationCommand(Guid.NewGuid(), Branch.DefaultId, " kitchen ", null, LocationKind.Kitchen)))).Message);
        Assert.Contains("several branches", (await Assert.ThrowsAsync<DomainException>(() =>
            _costing.Send(new SaveBranchCommand(Guid.NewGuid(), "Tanta", null, BranchType.Restaurant)))).Message);

        await _costing.Send(new ChangeOperatingModeCommand(SystemOperatingMode.MultiBranch_CentralKitchen, "user-1", "Wagdy"));
        var tanta = Guid.NewGuid();
        var saved = await _costing.Send(new SaveBranchCommand(tanta, "Tanta", "طنطا", BranchType.Restaurant));
        Assert.Equal(("Tanta", 1), (saved.Name, saved.Locations));
        Assert.Equal(("Main Store", LocationKind.MainStore), (_costing.Locations.All.Single(l => l.BranchId == tanta).Name, _costing.Locations.All.Single(l => l.BranchId == tanta).Kind));
        await _costing.Send(new SaveBranchCommand(Guid.NewGuid(), "Central kitchen", "المطبخ المركزي", BranchType.CentralKitchen));
        Assert.Contains("branch called Tanta already", (await Assert.ThrowsAsync<DomainException>(() =>
            _costing.Send(new SaveBranchCommand(Guid.NewGuid(), "TANTA", null, BranchType.Restaurant)))).Message);
        var choices = await _costing.Send(new GetBranchChoicesQuery());
        Assert.Equal(SystemOperatingMode.MultiBranch_CentralKitchen, choices.Mode);
        Assert.Equal(["Test Bistro", "Tanta", "Central kitchen"], choices.Branches.Select(b => b.Name));

        // Back to one branch: refused while the others are in use; then, with them out of use, the
        // choices are the first branch alone.
        Assert.StartsWith("Take Tanta, Central kitchen out of use first", (await Assert.ThrowsAsync<DomainException>(() =>
            _costing.Send(new ChangeOperatingModeCommand(SystemOperatingMode.SingleBranch_OpenSpace, "user-1", "Wagdy")))).Message);
        foreach (var other in _costing.Branches.All.Where(b => !b.IsDefault).ToList())
            await _costing.Send(new SaveBranchCommand(other.Id, other.Name, other.NameAr, other.Type, IsActive: false));
        await _costing.Send(new ChangeOperatingModeCommand(SystemOperatingMode.SingleBranch_OpenSpace, "user-1", "Wagdy"));
        Assert.Equal(["Test Bistro"], (await _costing.Send(new GetBranchChoicesQuery())).Branches.Select(b => b.Name));

        // The same mode again writes nothing.
        await _costing.Send(new ChangeOperatingModeCommand(SystemOperatingMode.SingleBranch_OpenSpace, "user-1", "Wagdy"));
        Assert.Equal(
            ["OperatingModeChanged: SingleBranch_OpenSpace → SingleBranch_WithSubStores by Wagdy",
             "OperatingModeChanged: SingleBranch_WithSubStores → MultiBranch_CentralKitchen by Wagdy",
             "OperatingModeChanged: MultiBranch_CentralKitchen → SingleBranch_OpenSpace by Wagdy"],
            _costing.Audit.All.Select(a => a.Description));
        Assert.All(_costing.Audit.All, a => Assert.Equal((SecurityAuditAction.OperatingModeChanged, "user-1"), (a.Action, a.ByUserId)));
    }

    [Fact]
    public async Task A_list_is_narrowed_to_the_branch_worked_in_only_when_the_company_has_several()
    {
        var flour = _costing.Inventory.Stock("Flour", UnitOfMeasure.Gram, 10_000);
        var first = Guid.NewGuid();
        var tantas = Guid.NewGuid();
        await _costing.Send(new RecordStockCountCommand(first, [new CountLine(flour.Id, 9_000)], "Samir"));
        await _costing.Send(new RecordStockCountCommand(tantas, [new CountLine(flour.Id, 8_000)], "Samir"));
        var tanta = Guid.NewGuid();
        (await _costing.Inventory.Counts.GetByIdAsync(first, TestContext.Current.CancellationToken))!.AssignBranch(Branch.DefaultId);
        (await _costing.Inventory.Counts.GetByIdAsync(tantas, TestContext.Current.CancellationToken))!.AssignBranch(tanta);

        // One branch: every count.
        Assert.Equal(2, (await _costing.Send(new GetStockCountsQuery())).Count);
        // Several, working in Tanta: Tanta's alone.
        _costing.CurrentBranch.Scope = tanta;
        Assert.Equal([tantas], (await _costing.Send(new GetStockCountsQuery())).Select(c => c.Id));
        _costing.CurrentBranch.Scope = Branch.DefaultId;
        Assert.Equal([first], (await _costing.Send(new GetStockCountsQuery())).Select(c => c.Id));
    }
}
