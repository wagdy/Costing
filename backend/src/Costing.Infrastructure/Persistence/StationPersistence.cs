using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;
using Costing.Domain.Stations;
using Costing.Domain.StockMovements;

namespace Costing.Infrastructure.Persistence;

// The kitchen and bar stations, and what points at them: a material's (a prep item's) station, a
// dish's, and the station held to account for a waste entry. Taken away, each falls back to the
// shared station (null).
internal sealed class KitchenStationConfiguration : IEntityTypeConfiguration<KitchenStation>
{
    public void Configure(EntityTypeBuilder<KitchenStation> builder)
    {
        builder.ToTable("KitchenStations", CostingDbContext.CostingSchema);
        builder.Property(s => s.Name).HasMaxLength(KitchenStation.MaxName);
        builder.Property(s => s.NameAr).HasMaxLength(KitchenStation.MaxName);
        builder.Property(s => s.Code).HasMaxLength(KitchenStation.MaxCode);
        builder.Property(s => s.TargetVarianceTolerancePercent).HasPrecision(5, 2);
        builder.Property(s => s.IsActive).HasDefaultValue(true);
        builder.Ignore(s => s.IsShared);
        builder.HasIndex(s => s.Code).IsUnique().HasFilter("\"Code\" IS NOT NULL");
    }
}

internal sealed class StationLinksConfiguration :
    IEntityTypeConfiguration<RawMaterial>, IEntityTypeConfiguration<Recipe>, IEntityTypeConfiguration<StockMovement>
{
    public void Configure(EntityTypeBuilder<RawMaterial> builder) =>
        builder.HasOne<KitchenStation>().WithMany().HasForeignKey(m => m.KitchenStationId).OnDelete(DeleteBehavior.SetNull);

    public void Configure(EntityTypeBuilder<Recipe> builder) =>
        builder.HasOne<KitchenStation>().WithMany().HasForeignKey(r => r.KitchenStationId).OnDelete(DeleteBehavior.SetNull);

    public void Configure(EntityTypeBuilder<StockMovement> builder) =>
        builder.HasOne<KitchenStation>().WithMany().HasForeignKey(m => m.ResponsibleStationId).OnDelete(DeleteBehavior.SetNull);
}

internal sealed class KitchenStationRepository(CostingDbContext db) : IKitchenStationRepository
{
    public Task<KitchenStation?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        db.KitchenStations.SingleOrDefaultAsync(s => s.Id == id, cancellationToken);

    public void Add(KitchenStation aggregate) => db.KitchenStations.Add(aggregate);

    public async Task<IReadOnlyList<KitchenStation>> GetAllAsync(CancellationToken cancellationToken = default) =>
        await db.KitchenStations.OrderBy(s => s.DisplayOrder).ThenBy(s => s.Name).ToListAsync(cancellationToken);

    public void Remove(KitchenStation station) => db.KitchenStations.Remove(station);
}
