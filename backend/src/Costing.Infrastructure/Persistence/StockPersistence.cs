using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.Extensions.DependencyInjection;
using Costing.Application.Common;
using Costing.Application.Stock;
using Costing.Domain.Company;
using Costing.Domain.InterBranch;
using Costing.Domain.Production;
using Costing.Domain.Purchases;
using Costing.Domain.RawMaterials;
using Costing.Domain.Stock;
using Costing.Domain.StockCounts;
using Costing.Domain.StockMovements;
using Costing.Infrastructure.Persistence.Configurations;

namespace Costing.Infrastructure.Persistence;

// Stock by location and cost by branch (عزل المخزون والمتوسط المرجح): each ledger entry's location;
// each branch's average cost; the internal transfers between a branch's locations. A location's
// stock is the sum of its entries, never a figure of its own.
internal sealed class StockLocationsConfiguration :
    IEntityTypeConfiguration<StockMovement>, IEntityTypeConfiguration<PurchaseInvoice>, IEntityTypeConfiguration<StockCount>,
    IEntityTypeConfiguration<ProductionOrder>, IEntityTypeConfiguration<InventoryLocation>, IEntityTypeConfiguration<RawMaterial>
{
    // Every entry before was the one store's: the first branch's Main Store, the column's default.
    public void Configure(EntityTypeBuilder<StockMovement> builder)
    {
        builder.Property(m => m.LocationId).HasDefaultValue(InventoryLocation.DefaultId).HasSentinel(Guid.Empty);
        builder.HasOne<InventoryLocation>().WithMany().HasForeignKey(m => m.LocationId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(m => new { m.RawMaterialId, m.LocationId });
    }

    public void Configure(EntityTypeBuilder<PurchaseInvoice> builder) =>
        builder.HasOne<InventoryLocation>().WithMany().HasForeignKey(i => i.LocationId).OnDelete(DeleteBehavior.Restrict);

    public void Configure(EntityTypeBuilder<StockCount> builder) =>
        builder.HasOne<InventoryLocation>().WithMany().HasForeignKey(c => c.LocationId).OnDelete(DeleteBehavior.Restrict);

    public void Configure(EntityTypeBuilder<ProductionOrder> builder) =>
        builder.HasOne<InventoryLocation>().WithMany().HasForeignKey(o => o.LocationId).OnDelete(DeleteBehavior.Restrict);

    public void Configure(EntityTypeBuilder<InventoryLocation> builder) =>
        builder.Property(l => l.StationIds).HasDefaultValueSql("'{}'::uuid[]");

    // Where a request sees it from: never kept.
    public void Configure(EntityTypeBuilder<RawMaterial> builder)
    {
        builder.Ignore(m => m.StockHere);
        builder.Ignore(m => m.CostHere);
    }
}

internal sealed class MaterialBranchStockConfiguration : IEntityTypeConfiguration<MaterialBranchStock>
{
    public void Configure(EntityTypeBuilder<MaterialBranchStock> builder)
    {
        builder.ToTable("MaterialBranchStocks", CostingDbContext.CostingSchema);
        builder.HasKey(s => s.Id);
        builder.Property(s => s.Id).ValueGeneratedNever();
        builder.Property(s => s.AverageCost).IsUnitCost();
        builder.Property(s => s.CompanyAverageCost).IsUnitCost();
        builder.Ignore(s => s.CostToCompany);
        builder.HasIndex(s => new { s.RawMaterialId, s.BranchId }).IsUnique();
        builder.HasOne<RawMaterial>().WithMany().HasForeignKey(s => s.RawMaterialId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Branch>().WithMany().HasForeignKey(s => s.BranchId).OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class InternalTransferConfiguration : IEntityTypeConfiguration<InternalTransfer>, IEntityTypeConfiguration<InternalTransferLine>
{
    public void Configure(EntityTypeBuilder<InternalTransfer> builder)
    {
        builder.ToTable("InternalTransfers", CostingDbContext.CostingSchema);
        builder.Property(t => t.Number).HasMaxLength(20);
        builder.HasIndex(t => t.Number).IsUnique();
        builder.Property(t => t.Status).IsEnumName();
        builder.Property(t => t.Notes).HasMaxLength(InternalTransfer.MaxNotes);
        builder.Property(t => t.CreatedBy).HasMaxLength(200);
        builder.Property(t => t.CreatedByUserId).HasMaxLength(100);
        builder.Property(t => t.VoidedBy).HasMaxLength(200);
        builder.Ignore(t => t.TotalCost);
        builder.HasIndex(t => new { t.BranchId, t.TransferDate });
        builder.HasOne<Branch>().WithMany().HasForeignKey(t => t.BranchId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<InventoryLocation>().WithMany().HasForeignKey(t => t.FromLocationId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<InventoryLocation>().WithMany().HasForeignKey(t => t.ToLocationId).OnDelete(DeleteBehavior.Restrict);
        builder.HasMany(t => t.Lines).WithOne().HasForeignKey(l => l.InternalTransferId).OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(t => t.Lines).HasField("_lines").UsePropertyAccessMode(PropertyAccessMode.Field);
    }

    public void Configure(EntityTypeBuilder<InternalTransferLine> builder)
    {
        builder.ToTable("InternalTransferLines", CostingDbContext.CostingSchema);
        builder.HasKey(l => l.Id);
        builder.Property(l => l.Id).ValueGeneratedNever();
        builder.Property(l => l.Quantity).IsQuantity();
        builder.Property(l => l.Unit).HasMaxLength(20);
        builder.Property(l => l.UnitCostSnapshot).HasPrecision(18, 6);
        builder.Property(l => l.LineTotalCost).HasPrecision(18, 2);
        builder.HasOne<RawMaterial>().WithMany().HasForeignKey(l => l.RawMaterialId).OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class MaterialBranchStockRepository(CostingDbContext db) : IMaterialBranchStockRepository
{
    public Task<MaterialBranchStock?> GetAsync(Guid rawMaterialId, Guid branchId, CancellationToken cancellationToken = default) =>
        db.MaterialBranchStocks.SingleOrDefaultAsync(s => s.RawMaterialId == rawMaterialId && s.BranchId == branchId, cancellationToken);

    public void Add(MaterialBranchStock stock) => db.MaterialBranchStocks.Add(stock);
}

internal sealed class InternalTransferRepository(CostingDbContext db) : IInternalTransferRepository
{
    public Task<InternalTransfer?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        db.InternalTransfers.Include(t => t.Lines).SingleOrDefaultAsync(t => t.Id == id, cancellationToken);

    public void Add(InternalTransfer aggregate) => db.InternalTransfers.Add(aggregate);

    public async Task<IReadOnlyList<InternalTransfer>> GetBetweenAsync(Guid branchId, DateOnly from, DateOnly to, CancellationToken cancellationToken = default) =>
        await db.InternalTransfers.AsNoTracking().Include(t => t.Lines)
            .Where(t => t.BranchId == branchId && t.TransferDate >= from && t.TransferDate <= to)
            .ToListAsync(cancellationToken);

    public Task<int> CountInYearAsync(int year, CancellationToken cancellationToken = default)
    {
        var prefix = $"TR-{year}-";
        return db.InternalTransfers.CountAsync(t => t.Number.StartsWith(prefix), cancellationToken);
    }
}

internal sealed class StockBalances(CostingDbContext db) : IStockBalances
{
    public async Task<IReadOnlyDictionary<Guid, decimal>> OnHandAsync(Guid branchId, Guid? locationId, CancellationToken cancellationToken) =>
        await db.StockMovements.AsNoTracking()
            .Where(m => m.BranchId == branchId && (locationId == null || m.LocationId == locationId))
            .GroupBy(m => m.RawMaterialId)
            .Select(g => new { g.Key, Quantity = g.Sum(m => m.Quantity) })
            .ToDictionaryAsync(g => g.Key, g => g.Quantity, cancellationToken);

    public async Task<IReadOnlyList<LocationStock>> ByLocationAsync(Guid branchId, CancellationToken cancellationToken) =>
        (await db.StockMovements.AsNoTracking()
            .Where(m => m.BranchId == branchId)
            .GroupBy(m => new { m.RawMaterialId, m.LocationId })
            .Select(g => new { g.Key.RawMaterialId, g.Key.LocationId, Quantity = g.Sum(m => m.Quantity) })
            .ToListAsync(cancellationToken))
            .Where(s => s.Quantity != 0)
            .Select(s => new LocationStock(s.RawMaterialId, s.LocationId, s.Quantity))
            .ToList();

    public async Task<IReadOnlyDictionary<Guid, decimal?>> BranchCostsAsync(Guid branchId, CancellationToken cancellationToken) =>
        await db.MaterialBranchStocks.AsNoTracking().Where(s => s.BranchId == branchId)
            .ToDictionaryAsync(s => s.RawMaterialId, s => s.AverageCost, cancellationToken);
}

// Each new ledger entry kept in its place and each branch's cost kept up, as it is saved (after
// its branch is given). Its location: what moved it said; otherwise, for what the kitchen uses (a
// sale, waste, a staff meal), the location serving the material's station in its branch, and for
// anything else, the branch's main store. An open-space shop: its one Main Store, always.
//
// Each branch's average: with one branch it is the company's, kept the same; with several, a
// delivery or a batch moves its own branch's average (the same arithmetic as the company's, on the
// branch's stock), one taken back out takes its price back out, and the company's becomes its
// branches' stock at their own averages.
internal sealed class StockLedgerInterceptor(IServiceProvider services) : SaveChangesInterceptor
{
    private static readonly StockMovementReason[] UsedByTheKitchen =
    [
        StockMovementReason.Sale, StockMovementReason.Waste, StockMovementReason.VoidReturn, StockMovementReason.Spoilage,
        StockMovementReason.StaffMeal, StockMovementReason.Hospitality, StockMovementReason.RecipeTasting,
    ];

    public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
    {
        if (eventData.Context is CostingDbContext db)
            await KeepAsync(db, cancellationToken);
        return result;
    }

    public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
    {
        if (eventData.Context is CostingDbContext db)
            KeepAsync(db, CancellationToken.None).GetAwaiter().GetResult();
        return result;
    }

    private async Task KeepAsync(CostingDbContext db, CancellationToken cancellationToken)
    {
        var added = db.ChangeTracker.Entries<StockMovement>().Where(e => e.State == EntityState.Added).Select(e => e.Entity).ToList();
        var changed = db.ChangeTracker.Entries<RawMaterial>()
            .Where(e => e.State is EntityState.Added or EntityState.Modified)
            .Select(e => e.Entity)
            .ToDictionary(m => m.Id);
        if (added.Count == 0 && changed.Count == 0)
            return;
        var mode = services.GetRequiredService<ICompanyProfile>().Current.OperatingMode;
        var materials = new Dictionary<Guid, RawMaterial>(changed);
        foreach (var id in added.Select(m => m.RawMaterialId).Distinct().Where(id => !materials.ContainsKey(id)).ToList())
        {
            if (await db.RawMaterials.FindAsync([id], cancellationToken) is { } material)
                materials[id] = material;
        }

        await PlaceAsync(db, added, materials, mode, cancellationToken);
        if (mode.IsMultiBranch())
            await CostByBranchAsync(db, added, materials, cancellationToken);
        else
            await MirrorAsync(db, materials.Values, cancellationToken);
    }

    private static async Task PlaceAsync(
        CostingDbContext db, List<StockMovement> added, Dictionary<Guid, RawMaterial> materials, SystemOperatingMode mode, CancellationToken cancellationToken)
    {
        var unplaced = added.Where(m => m.LocationId == Guid.Empty).ToList();
        if (unplaced.Count == 0)
            return;
        if (!mode.HasLocations())
        {
            unplaced.ForEach(m => m.AssignLocation(InventoryLocation.DefaultId));
            return;
        }
        var locations = await db.InventoryLocations.AsNoTracking().Where(l => l.IsActive).ToListAsync(cancellationToken);
        foreach (var movement in unplaced)
        {
            var branch = movement.BranchId == Guid.Empty ? Branch.DefaultId : movement.BranchId;
            var inBranch = locations.Where(l => l.BranchId == branch).ToList();
            InventoryLocation? serving = null;
            if (UsedByTheKitchen.Contains(movement.Reason)
                && (movement.ResponsibleStationId ?? materials.GetValueOrDefault(movement.RawMaterialId)?.KitchenStationId) is { } station)
                serving = inBranch.FirstOrDefault(l => l.StationIds.Contains(station));
            var main = inBranch.Where(l => l.Kind == LocationKind.MainStore).OrderByDescending(l => l.IsDefault).FirstOrDefault();
            movement.AssignLocation(serving?.Id ?? main?.Id ?? inBranch.FirstOrDefault()?.Id ?? InventoryLocation.DefaultId);
        }
    }

    // One branch: its cost is the company's.
    private static async Task MirrorAsync(CostingDbContext db, IEnumerable<RawMaterial> materials, CancellationToken cancellationToken)
    {
        var touched = materials.ToList();
        if (touched.Count == 0)
            return;
        var ids = touched.Select(m => m.Id).ToList();
        var rows = await db.MaterialBranchStocks.Where(s => s.BranchId == Branch.DefaultId && ids.Contains(s.RawMaterialId))
            .ToDictionaryAsync(s => s.RawMaterialId, cancellationToken);
        foreach (var material in touched)
        {
            if (rows.TryGetValue(material.Id, out var row))
                row.Mirror(material.AverageCost);
            else
                db.MaterialBranchStocks.Add(new MaterialBranchStock(material.Id, Branch.DefaultId, material.AverageCost));
        }
    }

    // Several branches: each branch's own average, from its own stock; the company's from theirs.
    private static async Task CostByBranchAsync(
        CostingDbContext db, List<StockMovement> added, Dictionary<Guid, RawMaterial> materials, CancellationToken cancellationToken)
    {
        if (added.Count == 0)
            return;
        var ids = added.Select(m => m.RawMaterialId).Distinct().ToList();
        var onHand = (await db.StockMovements.AsNoTracking()
                .Where(m => ids.Contains(m.RawMaterialId))
                .GroupBy(m => new { m.RawMaterialId, m.BranchId })
                .Select(g => new { g.Key.RawMaterialId, g.Key.BranchId, Quantity = g.Sum(m => m.Quantity) })
                .ToListAsync(cancellationToken))
            .ToDictionary(s => (s.RawMaterialId, s.BranchId), s => s.Quantity);
        var rows = (await db.MaterialBranchStocks.Where(s => ids.Contains(s.RawMaterialId)).ToListAsync(cancellationToken))
            .ToDictionary(s => (s.RawMaterialId, s.BranchId));

        // A batch's output after the rest, so its inputs' cost to the company is known first.
        var ordered = added.Where(m => m.Reason != StockMovementReason.ProductionOutput)
            .Concat(added.Where(m => m.Reason == StockMovementReason.ProductionOutput))
            .ToList();
        foreach (var movement in ordered)
        {
            var key = (movement.RawMaterialId, movement.BranchId);
            if (!rows.TryGetValue(key, out var row))
            {
                // A branch's first: at the material's cost (the company's) until it buys its own.
                row = new MaterialBranchStock(movement.RawMaterialId, movement.BranchId, materials.GetValueOrDefault(movement.RawMaterialId)?.AverageCost);
                db.MaterialBranchStocks.Add(row);
                rows[key] = row;
            }
            var before = onHand.GetValueOrDefault(key);
            // A delivery, a batch made, or a shipment received from the central kitchen at its price.
            var inbound = movement.Reason is StockMovementReason.Purchase or StockMovementReason.ProductionOutput or StockMovementReason.InterBranchReceiptIn;
            // What it cost the company, where that is not its cost here; a reversal keeps its original's.
            if (!movement.IsReversal)
                movement.CostToCompany(movement.Reason switch
                {
                    StockMovementReason.Purchase or StockMovementReason.OpeningStock => null,
                    StockMovementReason.InterBranchReceiptIn => await SentAtAsync(db, movement, cancellationToken),
                    StockMovementReason.ProductionOutput => MadeAt(movement, added),
                    _ => row.CompanyCostOf(movement.UnitCost),
                });
            if (inbound && !movement.IsReversal && movement.Quantity > 0 && movement.UnitCost is { } cost)
                row.AverageWith(before, movement.Quantity, cost, movement.CompanyUnitCost);
            else if (inbound && movement.IsReversal && movement.Quantity < 0)
                row.UnaverageWith(before, -movement.Quantity, movement.UnitCost, movement.CompanyUnitCost);
            else if (movement.Reason == StockMovementReason.OpeningStock)
                row.Open(movement.UnitCost);
            onHand[key] = before + movement.Quantity;
        }

        // The company's average: its branches' stock, each at what it cost the company (its branch's
        // own average, but for what a branch paid another branch over that branch's cost).
        foreach (var id in ids)
        {
            var held = rows.Where(r => r.Key.RawMaterialId == id && r.Value.CostToCompany is not null)
                .Select(r => (Quantity: Math.Max(onHand.GetValueOrDefault(r.Key), 0), Cost: r.Value.CostToCompany!.Value))
                .Where(h => h.Quantity > 0)
                .ToList();
            var quantity = held.Sum(h => h.Quantity);
            if (quantity > 0 && materials.GetValueOrDefault(id) is { } material)
                material.AdoptAverage(held.Sum(h => h.Quantity * h.Cost) / quantity);
        }
    }

    // A shipment received: at what the goods cost the company as they left the sending branch.
    private static async Task<decimal?> SentAtAsync(CostingDbContext db, StockMovement receipt, CancellationToken cancellationToken)
    {
        var shipment = db.ChangeTracker.Entries<InternalPurchaseInvoice>().Select(e => e.Entity).FirstOrDefault(i => i.Id == receipt.SourceId)
            ?.InternalSalesInvoiceId
            ?? await db.InternalPurchaseInvoices.AsNoTracking().Where(i => i.Id == receipt.SourceId)
                .Select(i => (Guid?)i.InternalSalesInvoiceId).SingleOrDefaultAsync(cancellationToken);
        if (shipment is null)
            return null;
        var sent = await db.StockMovements.AsNoTracking()
            .Where(m => m.SourceId == shipment && m.RawMaterialId == receipt.RawMaterialId && m.Reason == StockMovementReason.InterBranchDispatchOut
                && m.ReversalOf == null)
            .Select(m => new { m.UnitCost, m.CompanyUnitCost })
            .FirstOrDefaultAsync(cancellationToken);
        return sent?.CompanyUnitCost ?? sent?.UnitCost;
    }

    // A batch made: its cost here, in the same share as what went into it cost the company.
    private static decimal? MadeAt(StockMovement output, IEnumerable<StockMovement> added)
    {
        if (output.UnitCost is not { } cost)
            return null;
        var inputs = added.Where(m => m.SourceId == output.SourceId && m.Reason == StockMovementReason.ProductionInput && m.UnitCost is not null).ToList();
        var value = inputs.Sum(m => -m.Quantity * m.UnitCost!.Value);
        var company = inputs.Sum(m => -m.Quantity * (m.CompanyUnitCost ?? m.UnitCost!.Value));
        return value > 0 && company != value ? Math.Round(cost * company / value, 6, MidpointRounding.AwayFromZero) : null;
    }
}
