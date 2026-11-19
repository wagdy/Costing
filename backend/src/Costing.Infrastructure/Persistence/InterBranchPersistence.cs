using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Costing.Domain.Company;
using Costing.Domain.InterBranch;
using Costing.Domain.RawMaterials;
using Costing.Infrastructure.Persistence.Configurations;

namespace Costing.Infrastructure.Persistence;

// The central kitchen's hub (مركز عمليات المطبخ المركزي): the branches' requisitions, the kitchen's
// dispatches and their internal sales invoices, the branches' receipts and their internal purchase
// invoices. Each is its branch's record, kept under the branch's own name: the requisition the
// asking branch's, the sales invoice the kitchen's, the purchase invoice the receiving branch's.
internal sealed class InterBranchConfiguration :
    IEntityTypeConfiguration<InterBranchRequisition>, IEntityTypeConfiguration<InterBranchRequisitionLine>,
    IEntityTypeConfiguration<InternalSalesInvoice>, IEntityTypeConfiguration<InternalSalesInvoiceLine>,
    IEntityTypeConfiguration<InternalPurchaseInvoice>, IEntityTypeConfiguration<InternalPurchaseInvoiceLine>
{
    public void Configure(EntityTypeBuilder<InterBranchRequisition> builder)
    {
        builder.ToTable("InterBranchRequisitions", CostingDbContext.CostingSchema);
        builder.Property(r => r.BranchId).HasColumnName("RequestingBranchId");
        builder.Ignore(r => r.RequestingBranchId);
        builder.Ignore(r => r.IsOpen);
        builder.Property(r => r.Number).HasMaxLength(20);
        builder.HasIndex(r => r.Number).IsUnique();
        builder.Property(r => r.Status).IsEnumName();
        builder.Property(r => r.Notes).HasMaxLength(InterBranchRequisition.MaxNotes);
        Who(builder);
        builder.Property(r => r.CancelledBy).HasMaxLength(200);
        builder.HasIndex(r => new { r.BranchId, r.RequestDate });
        builder.HasIndex(r => new { r.SupplyingBranchId, r.RequestDate });
        builder.HasOne<Branch>().WithMany().HasForeignKey(r => r.BranchId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Branch>().WithMany().HasForeignKey(r => r.SupplyingBranchId).OnDelete(DeleteBehavior.Restrict);
        builder.HasMany(r => r.Lines).WithOne().HasForeignKey(l => l.InterBranchRequisitionId).OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(r => r.Lines).HasField("_lines").UsePropertyAccessMode(PropertyAccessMode.Field);
    }

    public void Configure(EntityTypeBuilder<InterBranchRequisitionLine> builder)
    {
        builder.ToTable("InterBranchRequisitionLines", CostingDbContext.CostingSchema);
        builder.HasKey(l => l.Id);
        builder.Property(l => l.Id).ValueGeneratedNever();
        builder.Property(l => l.RequestedQuantity).IsQuantity();
        builder.Property(l => l.DispatchedQuantity).IsQuantity();
        builder.Property(l => l.ReceivedQuantity).IsQuantity();
        builder.Property(l => l.Unit).HasMaxLength(20);
        builder.Property(l => l.Notes).HasMaxLength(InterBranchRequisition.MaxLineNotes);
        builder.HasOne<RawMaterial>().WithMany().HasForeignKey(l => l.RawMaterialId).OnDelete(DeleteBehavior.Restrict);
    }

    public void Configure(EntityTypeBuilder<InternalSalesInvoice> builder)
    {
        builder.ToTable("InternalSalesInvoices", CostingDbContext.CostingSchema);
        builder.Property(s => s.BranchId).HasColumnName("SupplyingBranchId");
        builder.Ignore(s => s.SupplyingBranchId);
        builder.Property(s => s.Number).HasMaxLength(20);
        builder.HasIndex(s => s.Number).IsUnique();
        builder.Property(s => s.Pricing).IsEnumName();
        builder.Property(s => s.Status).IsEnumName();
        builder.Property(s => s.MarkupPercent).HasPrecision(9, 4);
        builder.Property(s => s.Notes).HasMaxLength(InternalSalesInvoice.MaxNotes);
        Who(builder);
        builder.Property(s => s.VoidedBy).HasMaxLength(200);
        builder.Property(s => s.TotalTransferRevenue).HasPrecision(18, 2);
        builder.Property(s => s.TotalInternalCogs).HasPrecision(18, 2);
        builder.Property(s => s.InternalMargin).HasPrecision(18, 2);
        builder.HasIndex(s => new { s.BranchId, s.DispatchDate });
        builder.HasIndex(s => new { s.ReceivingBranchId, s.DispatchDate });
        builder.HasIndex(s => s.RequisitionId);
        builder.HasOne<Branch>().WithMany().HasForeignKey(s => s.BranchId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Branch>().WithMany().HasForeignKey(s => s.ReceivingBranchId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<InventoryLocation>().WithMany().HasForeignKey(s => s.FromLocationId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<InterBranchRequisition>().WithMany().HasForeignKey(s => s.RequisitionId).OnDelete(DeleteBehavior.Restrict);
        builder.HasMany(s => s.Lines).WithOne().HasForeignKey(l => l.InternalSalesInvoiceId).OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(s => s.Lines).HasField("_lines").UsePropertyAccessMode(PropertyAccessMode.Field);
    }

    public void Configure(EntityTypeBuilder<InternalSalesInvoiceLine> builder)
    {
        builder.ToTable("InternalSalesInvoiceLines", CostingDbContext.CostingSchema);
        builder.HasKey(l => l.Id);
        builder.Property(l => l.Id).ValueGeneratedNever();
        builder.Property(l => l.Quantity).IsQuantity();
        builder.Property(l => l.ReceivedQuantity).IsQuantity();
        builder.Property(l => l.Unit).HasMaxLength(20);
        builder.Property(l => l.UnitCost).HasPrecision(18, 6);
        builder.Property(l => l.TransferUnitPrice).HasPrecision(18, 6);
        builder.Property(l => l.LineRevenue).HasPrecision(18, 2);
        builder.Property(l => l.LineCogs).HasPrecision(18, 2);
        builder.HasOne<RawMaterial>().WithMany().HasForeignKey(l => l.RawMaterialId).OnDelete(DeleteBehavior.Restrict);
    }

    public void Configure(EntityTypeBuilder<InternalPurchaseInvoice> builder)
    {
        builder.ToTable("InternalPurchaseInvoices", CostingDbContext.CostingSchema);
        builder.Property(p => p.BranchId).HasColumnName("ReceivingBranchId");
        builder.Ignore(p => p.ReceivingBranchId);
        builder.Property(p => p.Number).HasMaxLength(20);
        builder.HasIndex(p => p.Number).IsUnique();
        builder.Property(p => p.Status).IsEnumName();
        builder.Property(p => p.Notes).HasMaxLength(InternalPurchaseInvoice.MaxNotes);
        Who(builder);
        builder.Property(p => p.VoidedBy).HasMaxLength(200);
        builder.Property(p => p.TotalBilled).HasPrecision(18, 2);
        builder.Property(p => p.TotalReceivedValue).HasPrecision(18, 2);
        builder.Property(p => p.TotalTransitLoss).HasPrecision(18, 2);
        builder.HasIndex(p => new { p.BranchId, p.ReceiptDate });
        builder.HasIndex(p => new { p.SupplyingBranchId, p.ReceiptDate });
        // One receipt a shipment.
        builder.HasIndex(p => p.InternalSalesInvoiceId).IsUnique();
        builder.HasOne<Branch>().WithMany().HasForeignKey(p => p.BranchId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Branch>().WithMany().HasForeignKey(p => p.SupplyingBranchId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<InventoryLocation>().WithMany().HasForeignKey(p => p.ToLocationId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<InternalSalesInvoice>().WithMany().HasForeignKey(p => p.InternalSalesInvoiceId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<InterBranchRequisition>().WithMany().HasForeignKey(p => p.RequisitionId).OnDelete(DeleteBehavior.Restrict);
        builder.HasMany(p => p.Lines).WithOne().HasForeignKey(l => l.InternalPurchaseInvoiceId).OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(p => p.Lines).HasField("_lines").UsePropertyAccessMode(PropertyAccessMode.Field);
    }

    public void Configure(EntityTypeBuilder<InternalPurchaseInvoiceLine> builder)
    {
        builder.ToTable("InternalPurchaseInvoiceLines", CostingDbContext.CostingSchema);
        builder.HasKey(l => l.Id);
        builder.Property(l => l.Id).ValueGeneratedNever();
        builder.Property(l => l.DispatchedQuantity).IsQuantity();
        builder.Property(l => l.ReceivedQuantity).IsQuantity();
        builder.Property(l => l.ShortQuantity).IsQuantity();
        builder.Property(l => l.Unit).HasMaxLength(20);
        builder.Property(l => l.TransferUnitPrice).HasPrecision(18, 6);
        builder.Property(l => l.LineTotal).HasPrecision(18, 2);
        builder.Property(l => l.ReceivedValue).HasPrecision(18, 2);
        builder.Property(l => l.TransitLoss).HasPrecision(18, 2);
        builder.HasOne<RawMaterial>().WithMany().HasForeignKey(l => l.RawMaterialId).OnDelete(DeleteBehavior.Restrict);
    }

    private static void Who<T>(EntityTypeBuilder<T> builder) where T : class
    {
        builder.Property<string>("CreatedBy").HasMaxLength(200);
        builder.Property<string?>("CreatedByUserId").HasMaxLength(100);
    }
}

internal sealed class InterBranchRequisitionRepository(CostingDbContext db) : IInterBranchRequisitionRepository
{
    public Task<InterBranchRequisition?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        db.InterBranchRequisitions.Include(r => r.Lines).SingleOrDefaultAsync(r => r.Id == id, cancellationToken);

    public void Add(InterBranchRequisition aggregate) => db.InterBranchRequisitions.Add(aggregate);

    public async Task<IReadOnlyList<InterBranchRequisition>> GetForBranchAsync(Guid branchId, DateOnly from, DateOnly to, CancellationToken cancellationToken = default) =>
        await db.InterBranchRequisitions.AsNoTracking().Include(r => r.Lines)
            .Where(r => r.BranchId == branchId || r.SupplyingBranchId == branchId)
            .Where(r => (r.RequestDate >= from && r.RequestDate <= to)
                || r.Status == RequisitionStatus.Submitted || r.Status == RequisitionStatus.PartiallyDispatched || r.Status == RequisitionStatus.Dispatched)
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<InterBranchRequisition>> GetByIdsAsync(IReadOnlyCollection<Guid> ids, CancellationToken cancellationToken = default) =>
        await db.InterBranchRequisitions.AsNoTracking().Where(r => ids.Contains(r.Id)).ToListAsync(cancellationToken);

    public Task<int> CountInYearAsync(int year, CancellationToken cancellationToken = default)
    {
        var prefix = $"REQ-{year}-";
        return db.InterBranchRequisitions.CountAsync(r => r.Number.StartsWith(prefix), cancellationToken);
    }
}

internal sealed class InternalSalesInvoiceRepository(CostingDbContext db) : IInternalSalesInvoiceRepository
{
    public Task<InternalSalesInvoice?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        db.InternalSalesInvoices.Include(s => s.Lines).SingleOrDefaultAsync(s => s.Id == id, cancellationToken);

    public void Add(InternalSalesInvoice aggregate) => db.InternalSalesInvoices.Add(aggregate);

    public async Task<IReadOnlyList<InternalSalesInvoice>> GetForBranchAsync(Guid branchId, DateOnly from, DateOnly to, CancellationToken cancellationToken = default) =>
        await db.InternalSalesInvoices.AsNoTracking().Include(s => s.Lines)
            .Where(s => s.BranchId == branchId || s.ReceivingBranchId == branchId)
            .Where(s => (s.DispatchDate >= from && s.DispatchDate <= to) || s.Status == ShipmentStatus.InTransit)
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<InternalSalesInvoice>> GetByRequisitionAsync(Guid requisitionId, CancellationToken cancellationToken = default) =>
        await db.InternalSalesInvoices.Include(s => s.Lines).Where(s => s.RequisitionId == requisitionId).ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<InternalSalesInvoice>> GetByIdsAsync(IReadOnlyCollection<Guid> ids, CancellationToken cancellationToken = default) =>
        await db.InternalSalesInvoices.AsNoTracking().Where(s => ids.Contains(s.Id)).ToListAsync(cancellationToken);

    public Task<int> CountInYearAsync(int year, CancellationToken cancellationToken = default)
    {
        var prefix = $"ISI-{year}-";
        return db.InternalSalesInvoices.CountAsync(s => s.Number.StartsWith(prefix), cancellationToken);
    }
}

internal sealed class InternalPurchaseInvoiceRepository(CostingDbContext db) : IInternalPurchaseInvoiceRepository
{
    public Task<InternalPurchaseInvoice?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        db.InternalPurchaseInvoices.Include(p => p.Lines).SingleOrDefaultAsync(p => p.Id == id, cancellationToken);

    public void Add(InternalPurchaseInvoice aggregate) => db.InternalPurchaseInvoices.Add(aggregate);

    public async Task<IReadOnlyList<InternalPurchaseInvoice>> GetForBranchAsync(Guid branchId, DateOnly from, DateOnly to, CancellationToken cancellationToken = default) =>
        await db.InternalPurchaseInvoices.AsNoTracking().Include(p => p.Lines)
            .Where(p => p.BranchId == branchId || p.SupplyingBranchId == branchId)
            .Where(p => p.ReceiptDate >= from && p.ReceiptDate <= to)
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<InternalPurchaseInvoice>> GetByIdsAsync(IReadOnlyCollection<Guid> ids, CancellationToken cancellationToken = default) =>
        await db.InternalPurchaseInvoices.AsNoTracking().Where(p => ids.Contains(p.Id)).ToListAsync(cancellationToken);

    public Task<int> CountInYearAsync(int year, CancellationToken cancellationToken = default)
    {
        var prefix = $"IPI-{year}-";
        return db.InternalPurchaseInvoices.CountAsync(p => p.Number.StartsWith(prefix), cancellationToken);
    }
}
