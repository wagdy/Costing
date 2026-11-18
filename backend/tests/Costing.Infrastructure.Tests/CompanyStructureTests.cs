using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Costing.Application.Approvals;
using Costing.Application.Company;
using Costing.Application.Purchases;
using Costing.Application.RawMaterials;
using Costing.Application.Suppliers;
using Costing.Application.Waste;
using Costing.Domain.Approvals;
using Costing.Domain.Common;
using Costing.Domain.Company;
using Costing.Domain.Purchases;
using Costing.Domain.RawMaterials;
using Costing.Domain.StockMovements;

namespace Costing.Infrastructure.Tests;

// The company's structure on a real database: the migration's first branch (named after the
// company) and its store, every record made before given to it; an open-space shop working exactly
// as before; with several branches, each record kept by the branch it is entered in, a stock entry
// by the invoice it comes from, a void in the branch it undoes; the lists narrowed to the branch;
// and a user kept to a branch out of use refused.
public class CompanyStructureTests
{
    private const string BeforeTheStructure = "20261118122831_AddPeriodLockAndSecurityAudit";

    private static async Task<(Guid Flour, Guid Nile)> FlourAndNileAsync(TestSystem node)
    {
        var flour = (await node.Send(new CreateRawMaterialCommand("Flour", UnitOfMeasure.Gram, PurchaseUnit: "kg", PurchaseUnitSize: 1000))).Id;
        var nile = (await node.Send(new SaveSupplierCommand(Guid.NewGuid(), "Nile Mills"))).Id;
        return (flour, nile);
    }

    private static async Task<Guid> PostedAsync(TestSystem node, Guid nile, Guid flour, DateOnly day)
    {
        var id = Guid.NewGuid();
        await node.Send(new SavePurchaseInvoiceCommand(id, nile, $"F-{id:N}"[..8], day, [new(flour, 5, "kg", 1000, 150)], "Omar", PurchasePaymentMethod.Credit));
        await node.Send(new PostPurchaseInvoiceCommand(id, "Omar", "staff-omar"));
        return id;
    }

    [Fact]
    public async Task The_first_branch_is_named_after_the_company_and_keeps_every_record_made_before()
    {
        await using var node = await TestSystem.StartAsync();
        var ct = TestContext.Current.CancellationToken;
        var (flour, nile) = await FlourAndNileAsync(node);
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var invoice = await PostedAsync(node, nile, flour, today);

        // As a database from before the structure, with its records: then brought up to date.
        var company = await node.Db(async db =>
        {
            var migrator = db.GetService<IMigrator>();
            await migrator.MigrateAsync(BeforeTheStructure, ct);
            await migrator.MigrateAsync(cancellationToken: ct);
            return await db.CompanySettings.Select(c => c.Name).SingleAsync(ct);
        });

        var branch = Assert.Single(await node.Db(db => db.Branches.ToListAsync(ct)));
        Assert.Equal((Branch.DefaultId, company, BranchType.Restaurant, true), (branch.Id, branch.Name, branch.Type, branch.IsActive));
        var store = Assert.Single(await node.Db(db => db.InventoryLocations.ToListAsync(ct)));
        Assert.Equal((InventoryLocation.DefaultId, Branch.DefaultId, "Main Store", LocationKind.MainStore), (store.Id, store.BranchId, store.Name, store.Kind));
        Assert.Equal(SystemOperatingMode.SingleBranch_OpenSpace, await node.Db(db => db.CompanySettings.Select(c => c.OperatingMode).SingleAsync(ct)));
        Assert.Equal(Branch.DefaultId, await node.Db(db => db.PurchaseInvoices.Where(i => i.Id == invoice).Select(i => i.BranchId).SingleAsync(ct)));
        Assert.All(await node.Db(db => db.StockMovements.Select(m => m.BranchId).ToListAsync(ct)), b => Assert.Equal(Branch.DefaultId, b));

        // And what is entered now, in an open-space shop, is the first branch's, whatever is chosen.
        node.Branch.ChosenBranchId = Guid.NewGuid();
        var later = await PostedAsync(node, nile, flour, today);
        Assert.Equal(Branch.DefaultId, await node.Db(db => db.PurchaseInvoices.Where(i => i.Id == later).Select(i => i.BranchId).SingleAsync(ct)));
    }

    [Fact]
    public async Task With_several_branches_each_record_is_kept_by_its_branch_and_a_void_by_the_branch_it_undoes()
    {
        await using var node = await TestSystem.StartAsync();
        var ct = TestContext.Current.CancellationToken;
        var (flour, nile) = await FlourAndNileAsync(node);
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var before = await PostedAsync(node, nile, flour, today);

        await node.Send(new ChangeOperatingModeCommand(SystemOperatingMode.MultiBranch_Independent, "user-1", "Wagdy"));
        var tanta = Guid.NewGuid();
        await node.Send(new SaveBranchCommand(tanta, "Tanta", "طنطا", BranchType.Restaurant));
        Assert.Equal(2, await node.Db(db => db.InventoryLocations.CountAsync(ct)));

        // Working in Tanta: its invoice, the stock it brought in, its breakage, all Tanta's.
        node.Branch.ChosenBranchId = tanta;
        var tantas = await PostedAsync(node, nile, flour, today);
        await node.Send(new RecordBreakageCommand(Guid.NewGuid(), today, "Glass", 2, 15, null, null, "Omar"));
        Assert.Equal(tanta, await node.Db(db => db.PurchaseInvoices.Where(i => i.Id == tantas).Select(i => i.BranchId).SingleAsync(ct)));
        Assert.Equal(tanta, await node.Db(db => db.StockMovements.Where(m => m.SourceId == tantas).Select(m => m.BranchId).SingleAsync(ct)));
        Assert.Equal(tanta, await node.Db(db => db.BreakageEntries.Select(b => b.BranchId).SingleAsync(ct)));

        // The list: the branch's own.
        Assert.Equal([tantas], (await node.Send(new GetPurchaseInvoicesQuery(PurchaseInvoiceStatus.Posted))).Select(i => i.Id));
        node.Branch.ChosenBranchId = null;
        Assert.Equal([before], (await node.Send(new GetPurchaseInvoicesQuery(PurchaseInvoiceStatus.Posted))).Select(i => i.Id));

        // Voided from the first branch: undone in Tanta, where it was entered.
        await node.Send(new RequestDeletionCommand(Guid.NewGuid(), ApprovalModule.PurchaseInvoice, tantas, "Entered twice", "staff-omar", "Omar", true));
        var reversal = await node.Db(db => db.StockMovements.SingleAsync(m => m.SourceId == tantas && m.ReversalOf != null, ct));
        Assert.Equal((tanta, StockMovementReason.Purchase), (reversal.BranchId, reversal.Reason));

        // A branch chosen that is not in use: the first branch.
        await node.Send(new SaveBranchCommand(tanta, "Tanta", "طنطا", BranchType.Restaurant, IsActive: false));
        node.Branch.ChosenBranchId = tanta;
        Assert.Equal([before], (await node.Send(new GetPurchaseInvoicesQuery(PurchaseInvoiceStatus.Posted))).Select(i => i.Id));

        // A user kept to it: refused, not moved to another branch.
        node.Branch.AssignedBranchId = tanta;
        Assert.Contains("Tanta", (await Assert.ThrowsAsync<ForbiddenException>(() => node.Send(new GetPurchaseInvoicesQuery(PurchaseInvoiceStatus.Posted)))).Message);
    }
}
