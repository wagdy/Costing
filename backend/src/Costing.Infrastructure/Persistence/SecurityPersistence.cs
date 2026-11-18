using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Costing.Domain.Security;
using Costing.Infrastructure.Persistence.Configurations;

namespace Costing.Infrastructure.Persistence;

// The security audit log: added to, read the latest first; never changed or removed here.
internal sealed class SecurityAuditLogConfiguration : IEntityTypeConfiguration<SecurityAuditLog>
{
    public void Configure(EntityTypeBuilder<SecurityAuditLog> builder)
    {
        builder.ToTable("SecurityAuditLogs", CostingDbContext.CostingSchema);
        builder.HasKey(e => e.Id);
        builder.Property(e => e.Id).ValueGeneratedNever();
        builder.Property(e => e.Action).IsEnumName();
        builder.Property(e => e.Description).HasMaxLength(1000);
        builder.Property(e => e.PreviousValue).HasMaxLength(100);
        builder.Property(e => e.NewValue).HasMaxLength(100);
        builder.Property(e => e.Reason).HasMaxLength(Domain.Company.CompanySettings.MaxUnlockReasonLength);
        builder.Property(e => e.By).HasMaxLength(SecurityAuditLog.MaxByLength);
        builder.Property(e => e.ByUserId).HasMaxLength(100);
        builder.HasIndex(e => e.OccurredAtUtc);
    }
}

internal sealed class SecurityAuditLogRepository(CostingDbContext db) : ISecurityAuditLogRepository
{
    public void Add(SecurityAuditLog entry) => db.SecurityAuditLogs.Add(entry);

    public async Task<IReadOnlyList<SecurityAuditLog>> GetLatestAsync(int count, CancellationToken cancellationToken = default) =>
        await db.SecurityAuditLogs.AsNoTracking().OrderByDescending(e => e.OccurredAtUtc).ThenByDescending(e => e.Id).Take(count).ToListAsync(cancellationToken);
}
