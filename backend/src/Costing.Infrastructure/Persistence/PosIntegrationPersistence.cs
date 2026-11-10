using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.Extensions.DependencyInjection;
using Costing.Domain.Integrations;
using Costing.Infrastructure.Persistence.Configurations;

namespace Costing.Infrastructure.Persistence;

internal sealed class PosLinkConfiguration : IEntityTypeConfiguration<PosLink>
{
    public void Configure(EntityTypeBuilder<PosLink> builder)
    {
        builder.ToTable("PosLinks", CostingDbContext.CostingSchema);
        builder.Property(l => l.KeyHash).HasMaxLength(PosLink.HashLength);
        builder.Property(l => l.KeyHint).HasMaxLength(PosLink.HintLength + 4);
        builder.Property(l => l.KeyCreatedBy).HasMaxLength(200);
        builder.Ignore(l => l.HasKey);
    }
}

internal sealed class PosZReportConfiguration : IEntityTypeConfiguration<PosZReport>
{
    public void Configure(EntityTypeBuilder<PosZReport> builder)
    {
        builder.ToTable("PosZReports", CostingDbContext.CostingSchema);
        builder.Property(r => r.Source).HasMaxLength(40);
        builder.Property(r => r.PayloadHash).HasMaxLength(64);
        builder.Property(r => r.Payload).HasColumnType("text");
        builder.HasIndex(r => r.BusinessDate);
    }
}

internal sealed class PosDayConfiguration : IEntityTypeConfiguration<PosDay>
{
    public void Configure(EntityTypeBuilder<PosDay> builder)
    {
        builder.ToTable("PosDays", CostingDbContext.CostingSchema);
        // One a business day.
        builder.HasIndex(d => d.Date).IsUnique();
    }
}

internal sealed class PosSyncLogConfiguration : IEntityTypeConfiguration<PosSyncLog>
{
    public void Configure(EntityTypeBuilder<PosSyncLog> builder)
    {
        builder.ToTable("PosSyncLogs", CostingDbContext.CostingSchema);
        builder.HasKey(l => l.Id);
        builder.Property(l => l.Id).ValueGeneratedNever();
        builder.Property(l => l.Endpoint).HasMaxLength(60);
        builder.Property(l => l.Outcome).IsEnumName();
        builder.Property(l => l.Message).HasMaxLength(PosSyncLog.MaxMessage);
        builder.Property(l => l.Detail).HasMaxLength(PosSyncLog.MaxDetail);
        builder.HasIndex(l => l.AtUtc);
    }
}

internal sealed class PosLinkStore(CostingDbContext db) : IPosLinkStore
{
    // Made the first time it is asked for, and kept by this unit of work.
    public async Task<PosLink> GetAsync(CancellationToken cancellationToken = default)
    {
        if (db.PosLinks.Local.FirstOrDefault() is { } local)
            return local;
        if (await db.PosLinks.SingleOrDefaultAsync(l => l.Id == PosLink.SingletonId, cancellationToken) is { } kept)
            return kept;
        var made = PosLink.Create();
        db.PosLinks.Add(made);
        return made;
    }
}

internal sealed class PosZReportRepository(CostingDbContext db) : IPosZReportRepository
{
    public Task<PosZReport?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        db.PosZReports.SingleOrDefaultAsync(r => r.Id == id, cancellationToken);

    public void Add(PosZReport aggregate) => db.PosZReports.Add(aggregate);

    public async Task<IReadOnlyList<PosZReport>> GetByDateAsync(DateOnly date, CancellationToken cancellationToken = default) =>
        await db.PosZReports.Where(r => r.BusinessDate == date).OrderBy(r => r.ReceivedAtUtc).ToListAsync(cancellationToken);
}

internal sealed class PosDayRepository(CostingDbContext db) : IPosDayRepository
{
    public Task<PosDay?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        db.PosDays.SingleOrDefaultAsync(d => d.Id == id, cancellationToken);

    public void Add(PosDay aggregate) => db.PosDays.Add(aggregate);

    public async Task<PosDay?> GetByDateAsync(DateOnly date, CancellationToken cancellationToken = default) =>
        db.PosDays.Local.FirstOrDefault(d => d.Date == date) ?? await db.PosDays.SingleOrDefaultAsync(d => d.Date == date, cancellationToken);
}

// The log, saved in a context of its own: what the call itself did is saved or thrown away with
// the call, and the log of it stays either way.
internal sealed class PosSyncJournal(IServiceScopeFactory scopes, CostingDbContext db) : IPosSyncJournal
{
    public async Task WriteAsync(PosSyncLog entry, CancellationToken cancellationToken = default)
    {
        await using var scope = scopes.CreateAsyncScope();
        var own = scope.ServiceProvider.GetRequiredService<CostingDbContext>();
        own.PosSyncLogs.Add(entry);
        await own.SaveChangesAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<PosSyncLog>> RecentAsync(int count, CancellationToken cancellationToken = default) =>
        await db.PosSyncLogs.AsNoTracking().OrderByDescending(l => l.AtUtc).Take(count).ToListAsync(cancellationToken);
}
