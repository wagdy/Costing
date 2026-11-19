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
        // One a branch: the first branch's is the one there always was.
        builder.Property(l => l.BranchId).HasDefaultValue(Domain.Company.Branch.DefaultId).HasSentinel(Guid.Empty);
        builder.HasIndex(l => l.BranchId).IsUnique();
        builder.HasOne<Domain.Company.Branch>().WithMany().HasForeignKey(l => l.BranchId).OnDelete(DeleteBehavior.Restrict);
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
        // One a business day in each branch.
        builder.Property(d => d.BranchId).HasDefaultValue(Domain.Company.Branch.DefaultId).HasSentinel(Guid.Empty);
        builder.HasIndex(d => new { d.BranchId, d.Date }).IsUnique();
        builder.HasOne<Domain.Company.Branch>().WithMany().HasForeignKey(d => d.BranchId).OnDelete(DeleteBehavior.Restrict);
        builder.Property(d => d.DiscountsAmount).HasPrecision(18, 2);
        Configurations.PropertyBuilderExtensions.HasDiscountReasons(builder);
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
        builder.HasIndex(l => l.BranchId);
    }
}

internal sealed class PosLinkStore(CostingDbContext db, Costing.Application.Company.ICurrentBranch branch) : IPosLinkStore
{
    // The branch worked in's, made the first time it is asked for, and kept by this unit of work.
    public async Task<PosLink> GetAsync(CancellationToken cancellationToken = default)
    {
        var here = await branch.BranchIdAsync(cancellationToken);
        if (db.PosLinks.Local.FirstOrDefault(l => l.BranchId == here) is { } local)
            return local;
        if (await db.PosLinks.SingleOrDefaultAsync(l => l.BranchId == here, cancellationToken) is { } kept)
            return kept;
        var made = PosLink.Create(here);
        db.PosLinks.Add(made);
        return made;
    }

    public async Task<IReadOnlyList<PosLink>> GetAllAsync(CancellationToken cancellationToken = default) =>
        await db.PosLinks.AsNoTracking().Where(l => l.KeyHash != null).ToListAsync(cancellationToken);
}

internal sealed class PosZReportRepository(CostingDbContext db, Costing.Application.Company.ICurrentBranch branch) : IPosZReportRepository
{
    public Task<PosZReport?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        db.PosZReports.SingleOrDefaultAsync(r => r.Id == id, cancellationToken);

    public void Add(PosZReport aggregate) => db.PosZReports.Add(aggregate);

    // The branch worked in's: its own till's reports of the day.
    public async Task<IReadOnlyList<PosZReport>> GetByDateAsync(DateOnly date, CancellationToken cancellationToken = default)
    {
        var here = await branch.BranchIdAsync(cancellationToken);
        return await db.PosZReports.Where(r => r.BusinessDate == date && r.BranchId == here).OrderBy(r => r.ReceivedAtUtc).ToListAsync(cancellationToken);
    }
}

internal sealed class PosDayRepository(CostingDbContext db, Costing.Application.Company.ICurrentBranch branch) : IPosDayRepository
{
    public Task<PosDay?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        db.PosDays.SingleOrDefaultAsync(d => d.Id == id, cancellationToken);

    public void Add(PosDay aggregate) => db.PosDays.Add(aggregate);

    // The branch worked in's; one made in this unit of work is its branch's once saved.
    public async Task<PosDay?> GetByDateAsync(DateOnly date, CancellationToken cancellationToken = default)
    {
        var here = await branch.BranchIdAsync(cancellationToken);
        return db.PosDays.Local.FirstOrDefault(d => d.Date == date && (d.BranchId == here || d.BranchId == Guid.Empty))
            ?? await db.PosDays.SingleOrDefaultAsync(d => d.Date == date && d.BranchId == here, cancellationToken);
    }
}

// The log, saved in a context of its own: what the call itself did is saved or thrown away with
// the call, and the log of it stays either way.
// Each call kept with the branch whose till made it (none for one refused for its key); the log read
// is the branch worked in's, with the calls refused, whoever made them.
internal sealed class PosSyncJournal(
    IServiceScopeFactory scopes, CostingDbContext db, Costing.Application.Company.IBranchRequest asking, Costing.Application.Company.ICurrentBranch branch)
    : IPosSyncJournal
{
    public async Task WriteAsync(PosSyncLog entry, CancellationToken cancellationToken = default)
    {
        entry.AtBranch(asking.AssignedBranchId ?? (entry.Outcome == PosSyncOutcome.Unauthorized ? null : Domain.Company.Branch.DefaultId));
        await using var scope = scopes.CreateAsyncScope();
        var own = scope.ServiceProvider.GetRequiredService<CostingDbContext>();
        own.PosSyncLogs.Add(entry);
        await own.SaveChangesAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<PosSyncLog>> RecentAsync(int count, CancellationToken cancellationToken = default)
    {
        var scope = await branch.ScopeAsync(cancellationToken);
        return await db.PosSyncLogs.AsNoTracking()
            .Where(l => scope == null || l.BranchId == scope || l.BranchId == null)
            .OrderByDescending(l => l.AtUtc).Take(count).ToListAsync(cancellationToken);
    }
}
