using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Costing.Domain.FixedAssets;
using Costing.Domain.Treasury;
using Costing.Infrastructure.Persistence.Configurations;

namespace Costing.Infrastructure.Persistence;

// The fixed assets register: one row per asset, the safe entries that bought and sold it beside it.
internal sealed class FixedAssetConfiguration : IEntityTypeConfiguration<FixedAsset>
{
    public void Configure(EntityTypeBuilder<FixedAsset> builder)
    {
        builder.ToTable("FixedAssets", CostingDbContext.CostingSchema);
        builder.Property(a => a.AssetCode).HasMaxLength(16);
        builder.Property(a => a.Name).HasMaxLength(FixedAsset.MaxNameLength);
        builder.Property(a => a.Category).IsEnumName();
        builder.Property(a => a.Status).IsEnumName();
        builder.Property(a => a.PaidFrom).IsEnumName();
        builder.Property(a => a.SaleFund).IsEnumName();
        builder.Property(a => a.Location).HasMaxLength(FixedAsset.MaxLocationLength);
        builder.Property(a => a.Notes).HasMaxLength(FixedAsset.MaxNotesLength);
        builder.Property(a => a.DisposalNotes).HasMaxLength(FixedAsset.MaxNotesLength);
        builder.Property(a => a.PurchaseCost).HasPrecision(18, 2);
        builder.Property(a => a.SalvageValue).HasPrecision(18, 2);
        builder.Property(a => a.SaleProceeds).HasPrecision(18, 2);
        builder.Property(a => a.CreatedBy).HasMaxLength(200);
        builder.Property(a => a.UpdatedBy).HasMaxLength(200);
        builder.Property(a => a.DisposedBy).HasMaxLength(200);
        builder.Property(a => a.VoidedBy).HasMaxLength(200);
        builder.Ignore(a => a.IsVoided);
        builder.Ignore(a => a.IsOwnedAlready);
        builder.Ignore(a => a.IsGone);
        builder.Ignore(a => a.DepreciableAmount);
        builder.Ignore(a => a.MonthlyDepreciation);
        builder.Ignore(a => a.FirstMonth);
        builder.Ignore(a => a.NetBookValueAtDisposal);
        builder.Ignore(a => a.GainOrLoss);
        builder.HasIndex(a => a.Number).IsUnique();
        builder.HasIndex(a => a.AssetCode).IsUnique();
        builder.HasOne<SafeTransaction>().WithMany().HasForeignKey(a => a.PurchaseTransactionId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<SafeTransaction>().WithMany().HasForeignKey(a => a.SaleTransactionId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(a => a.PurchaseTransactionId);
        builder.HasIndex(a => a.SaleTransactionId);
    }
}

internal sealed class FixedAssetRepository(CostingDbContext db) : IFixedAssetRepository
{
    public Task<FixedAsset?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        db.FixedAssets.SingleOrDefaultAsync(a => a.Id == id, cancellationToken);

    public void Add(FixedAsset aggregate) => db.FixedAssets.Add(aggregate);

    public async Task<IReadOnlyList<FixedAsset>> GetAllAsync(CancellationToken cancellationToken = default) =>
        await db.FixedAssets.Where(a => a.VoidedAtUtc == null).OrderBy(a => a.Number).ToListAsync(cancellationToken);

    public Task<FixedAsset?> GetByTransactionAsync(Guid transactionId, CancellationToken cancellationToken = default) =>
        db.FixedAssets.SingleOrDefaultAsync(a => a.PurchaseTransactionId == transactionId || a.SaleTransactionId == transactionId, cancellationToken);

    // Added in this unit of work and not saved yet counted too.
    public async Task<int> NextNumberAsync(CancellationToken cancellationToken = default)
    {
        var saved = await db.FixedAssets.MaxAsync(a => (int?)a.Number, cancellationToken) ?? 0;
        var pending = db.ChangeTracker.Entries<FixedAsset>().Where(e => e.State == EntityState.Added).Select(e => e.Entity.Number).DefaultIfEmpty(0).Max();
        return Math.Max(saved, pending) + 1;
    }
}
