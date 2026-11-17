using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Costing.Domain.Purchases;
using Costing.Domain.RawMaterials;
using Costing.Domain.Suppliers;
using Costing.Infrastructure.Persistence.Configurations;

namespace Costing.Infrastructure.Persistence;

// Purchase orders and their lines: PO-year-sequence unique, a line per material.
internal sealed class PurchaseOrderConfiguration : IEntityTypeConfiguration<PurchaseOrder>
{
    public void Configure(EntityTypeBuilder<PurchaseOrder> builder)
    {
        builder.ToTable("PurchaseOrders", CostingDbContext.CostingSchema);
        builder.Property(o => o.PoNumber).HasMaxLength(16);
        builder.Property(o => o.PaymentTerms).IsEnumName();
        builder.Property(o => o.Status).IsEnumName();
        builder.Property(o => o.Notes).HasMaxLength(PurchaseOrder.MaxNotesLength);
        builder.Property(o => o.CreatedByUserId).HasMaxLength(450);
        builder.Property(o => o.CreatedBy).HasMaxLength(200);
        builder.Property(o => o.ApprovedByUserId).HasMaxLength(450);
        builder.Property(o => o.ApprovedBy).HasMaxLength(200);
        builder.Property(o => o.CancelledBy).HasMaxLength(200);
        builder.Property(o => o.ClosedBy).HasMaxLength(200);
        builder.Ignore(o => o.IsOpen);
        builder.Ignore(o => o.ExpectedTotal);
        builder.Ignore(o => o.RemainingValue);
        builder.HasIndex(o => o.PoNumber).IsUnique();
        builder.HasIndex(o => new { o.Year, o.Sequence }).IsUnique();
        builder.HasIndex(o => new { o.Status, o.SupplierId });
        builder.HasOne<Supplier>().WithMany().HasForeignKey(o => o.SupplierId).OnDelete(DeleteBehavior.Restrict);
        builder.HasMany(o => o.Lines).WithOne().HasForeignKey(l => l.PurchaseOrderId).OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(o => o.Lines).HasField("_lines").UsePropertyAccessMode(PropertyAccessMode.Field).AutoInclude();
    }
}

internal sealed class PurchaseOrderLineConfiguration : IEntityTypeConfiguration<PurchaseOrderLine>
{
    public void Configure(EntityTypeBuilder<PurchaseOrderLine> builder)
    {
        builder.ToTable("PurchaseOrderLines", CostingDbContext.CostingSchema);
        builder.Property(l => l.OrderedPurchaseQty).HasPrecision(18, 3);
        builder.Property(l => l.ReceivedPurchaseQty).HasPrecision(18, 3);
        builder.Property(l => l.ExpectedUnitCost).HasPrecision(18, 4);
        builder.Property(l => l.LineNotes).HasMaxLength(PurchaseOrder.MaxLineNotesLength);
        builder.Ignore(l => l.RemainingQty);
        builder.Ignore(l => l.LineTotal);
        builder.Property(l => l.RawMaterialId).HasColumnName("MaterialId");
        builder.HasOne<RawMaterial>().WithMany().HasForeignKey(l => l.RawMaterialId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(l => new { l.PurchaseOrderId, l.RawMaterialId }).IsUnique();
    }
}

internal sealed class PurchaseOrderRepository(CostingDbContext db) : IPurchaseOrderRepository
{
    public Task<PurchaseOrder?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        db.PurchaseOrders.SingleOrDefaultAsync(o => o.Id == id, cancellationToken);

    public void Add(PurchaseOrder aggregate) => db.PurchaseOrders.Add(aggregate);

    public async Task<IReadOnlyList<PurchaseOrder>> GetAllAsync(CancellationToken cancellationToken = default) =>
        await db.PurchaseOrders.OrderByDescending(o => o.Year).ThenByDescending(o => o.Sequence).ToListAsync(cancellationToken);

    public async Task<int> NextSequenceAsync(int year, CancellationToken cancellationToken = default)
    {
        var saved = await db.PurchaseOrders.Where(o => o.Year == year).MaxAsync(o => (int?)o.Sequence, cancellationToken) ?? 0;
        var pending = db.ChangeTracker.Entries<PurchaseOrder>()
            .Where(e => e.State == EntityState.Added && e.Entity.Year == year).Select(e => e.Entity.Sequence).DefaultIfEmpty(0).Max();
        return Math.Max(saved, pending) + 1;
    }
}
