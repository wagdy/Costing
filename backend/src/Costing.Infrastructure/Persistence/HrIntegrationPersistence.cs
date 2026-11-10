using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.Extensions.DependencyInjection;
using Costing.Domain.Integrations;
using Costing.Domain.Staff;
using Costing.Infrastructure.Persistence.Configurations;

namespace Costing.Infrastructure.Persistence;

internal sealed class HrLinkConfiguration : IEntityTypeConfiguration<HrLink>
{
    public void Configure(EntityTypeBuilder<HrLink> builder)
    {
        builder.ToTable("HrLinks", CostingDbContext.CostingSchema);
        builder.Property(l => l.BaseUrl).HasMaxLength(HrLink.MaxUrlLength);
        builder.Property(l => l.HrKeyProtected).HasMaxLength(1000);
        builder.Property(l => l.HrKeyHint).HasMaxLength(HrLink.HintLength + 4);
        builder.Property(l => l.KeyHash).HasMaxLength(HrLink.HashLength);
        builder.Property(l => l.KeyHint).HasMaxLength(HrLink.HintLength + 4);
        builder.Property(l => l.KeyCreatedBy).HasMaxLength(200);
        builder.Property(l => l.UpdatedBy).HasMaxLength(200);
        builder.Ignore(l => l.HasKey);
        builder.Ignore(l => l.IsReady);
    }
}

internal sealed class SyncedEmployeeConfiguration : IEntityTypeConfiguration<SyncedEmployee>
{
    public void Configure(EntityTypeBuilder<SyncedEmployee> builder)
    {
        builder.ToTable("SyncedEmployees", CostingDbContext.CostingSchema);
        builder.Property(e => e.Code).HasMaxLength(SyncedEmployee.MaxCodeLength);
        builder.Property(e => e.FullName).HasMaxLength(SyncedEmployee.MaxNameLength);
        builder.Property(e => e.Department).HasMaxLength(100);
        builder.Property(e => e.Branch).HasMaxLength(100);
        builder.HasIndex(e => e.HrEmployeeId).IsUnique();
        builder.HasIndex(e => e.StaffMemberId).IsUnique();
        builder.HasOne<StaffMember>().WithMany().HasForeignKey(e => e.StaffMemberId).OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class HrSyncLogConfiguration : IEntityTypeConfiguration<HrSyncLog>
{
    public void Configure(EntityTypeBuilder<HrSyncLog> builder)
    {
        builder.ToTable("HrSyncLogs", CostingDbContext.CostingSchema);
        builder.HasKey(l => l.Id);
        builder.Property(l => l.Id).ValueGeneratedNever();
        builder.Property(l => l.Direction).IsEnumName();
        builder.Property(l => l.Call).HasMaxLength(60);
        builder.Property(l => l.Outcome).IsEnumName();
        builder.Property(l => l.Message).HasMaxLength(HrSyncLog.MaxMessageLength);
        builder.Property(l => l.Detail).HasMaxLength(2000);
        builder.HasIndex(l => l.AtUtc);
    }
}

internal sealed class HrOutboxItemConfiguration : IEntityTypeConfiguration<HrOutboxItem>
{
    public void Configure(EntityTypeBuilder<HrOutboxItem> builder)
    {
        builder.ToTable("HrOutbox", CostingDbContext.CostingSchema);
        builder.Property(i => i.Kind).HasMaxLength(40);
        builder.Property(i => i.Action).HasMaxLength(10);
        builder.Property(i => i.Payload).HasColumnType("text");
        builder.Property(i => i.Summary).HasMaxLength(HrOutboxItem.MaxSummaryLength);
        builder.Property(i => i.Status).IsEnumName();
        builder.Property(i => i.LastError).HasMaxLength(500);
        builder.HasIndex(i => new { i.Status, i.NextAttemptAtUtc });
        builder.HasIndex(i => i.CreatedAtUtc);
    }
}

internal sealed class PayrollRunConfiguration : IEntityTypeConfiguration<PayrollRun>
{
    public void Configure(EntityTypeBuilder<PayrollRun> builder)
    {
        builder.ToTable("PayrollRuns", CostingDbContext.CostingSchema);
        foreach (var money in new[]
                 {
                     nameof(PayrollRun.TotalGrossWages), nameof(PayrollRun.TotalAdditions), nameof(PayrollRun.TotalPenalties),
                     nameof(PayrollRun.TotalAdvancesDeducted), nameof(PayrollRun.TotalBroughtForward), nameof(PayrollRun.NetCashPayable),
                     nameof(PayrollRun.LaborCost),
                 })
            builder.Property(money).HasPrecision(18, 2);
        builder.Property(r => r.PayloadHash).HasMaxLength(64);
        builder.Property(r => r.Status).IsEnumName();
        builder.Property(r => r.DisbursedBy).HasMaxLength(200);
        builder.Ignore(r => r.IsDisbursed);
        builder.Ignore(r => r.PeriodName);
        // One a month.
        builder.HasIndex(r => r.Period).IsUnique();
        builder.HasMany(r => r.Departments).WithOne().HasForeignKey(d => d.PayrollRunId).OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(r => r.Departments).HasField("_departments").UsePropertyAccessMode(PropertyAccessMode.Field);
    }
}

internal sealed class PayrollRunDepartmentConfiguration : IEntityTypeConfiguration<PayrollRunDepartment>
{
    public void Configure(EntityTypeBuilder<PayrollRunDepartment> builder)
    {
        builder.ToTable("PayrollRunDepartments", CostingDbContext.CostingSchema);
        builder.Property(d => d.Name).HasMaxLength(100);
        foreach (var money in new[]
                 {
                     nameof(PayrollRunDepartment.GrossWages), nameof(PayrollRunDepartment.Additions), nameof(PayrollRunDepartment.Penalties),
                     nameof(PayrollRunDepartment.AdvancesDeducted), nameof(PayrollRunDepartment.NetCashPayable),
                 })
            builder.Property(money).HasPrecision(18, 2);
        builder.Ignore(d => d.LaborCost);
    }
}

internal sealed class StaffDeductionConfiguration : IEntityTypeConfiguration<StaffDeduction>
{
    public void Configure(EntityTypeBuilder<StaffDeduction> builder)
    {
        builder.ToTable("StaffDeductions", CostingDbContext.CostingSchema);
        builder.Property(d => d.Kind).IsEnumName();
        builder.Property(d => d.Amount).HasPrecision(18, 2);
        builder.Property(d => d.Reason).HasMaxLength(StaffDeduction.MaxReasonLength);
        builder.Property(d => d.RecordedBy).HasMaxLength(200);
        builder.Property(d => d.VoidedBy).HasMaxLength(200);
        builder.Ignore(d => d.IsVoided);
        builder.HasIndex(d => d.Date);
        builder.HasOne<StaffMember>().WithMany().HasForeignKey(d => d.EmployeeId).OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class HrLinkStore(CostingDbContext db) : IHrLinkStore
{
    // Made the first time it is asked for, and kept by this unit of work.
    public async Task<HrLink> GetAsync(CancellationToken cancellationToken = default)
    {
        if (db.HrLinks.Local.FirstOrDefault() is { } local)
            return local;
        if (await db.HrLinks.SingleOrDefaultAsync(l => l.Id == HrLink.SingletonId, cancellationToken) is { } kept)
            return kept;
        var made = HrLink.Create();
        db.HrLinks.Add(made);
        return made;
    }
}

internal sealed class SyncedEmployeeRepository(CostingDbContext db) : ISyncedEmployeeRepository
{
    public Task<SyncedEmployee?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        db.SyncedEmployees.SingleOrDefaultAsync(e => e.Id == id, cancellationToken);

    public void Add(SyncedEmployee aggregate) => db.SyncedEmployees.Add(aggregate);

    public async Task<IReadOnlyList<SyncedEmployee>> GetAllAsync(CancellationToken cancellationToken = default) =>
        await db.SyncedEmployees.OrderBy(e => e.FullName).ToListAsync(cancellationToken);

    public async Task<SyncedEmployee?> GetByStaffMemberAsync(Guid staffMemberId, CancellationToken cancellationToken = default) =>
        db.SyncedEmployees.Local.FirstOrDefault(e => e.StaffMemberId == staffMemberId)
        ?? await db.SyncedEmployees.SingleOrDefaultAsync(e => e.StaffMemberId == staffMemberId, cancellationToken);
}

internal sealed class HrOutboxRepository(CostingDbContext db) : IHrOutboxRepository
{
    public Task<HrOutboxItem?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        db.HrOutbox.SingleOrDefaultAsync(i => i.Id == id, cancellationToken);

    public void Add(HrOutboxItem aggregate) => db.HrOutbox.Add(aggregate);

    public async Task<IReadOnlyList<HrOutboxItem>> GetDueAsync(DateTime nowUtc, int take, CancellationToken cancellationToken = default) =>
        await db.HrOutbox.Where(i => i.Status == HrOutboxStatus.Pending && i.NextAttemptAtUtc <= nowUtc)
            .OrderBy(i => i.CreatedAtUtc).Take(take).ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<HrOutboxItem>> GetRecentAsync(int take, CancellationToken cancellationToken = default) =>
        await db.HrOutbox.AsNoTracking().OrderByDescending(i => i.CreatedAtUtc).Take(take).ToListAsync(cancellationToken);

    public Task<int> CountAsync(HrOutboxStatus status, CancellationToken cancellationToken = default) =>
        db.HrOutbox.CountAsync(i => i.Status == status, cancellationToken);
}

// The log, saved in a context of its own: what the call itself did is saved or thrown away with
// the call, and the log of it stays either way.
internal sealed class HrSyncJournal(IServiceScopeFactory scopes, CostingDbContext db) : IHrSyncJournal
{
    public async Task WriteAsync(HrSyncLog entry, CancellationToken cancellationToken = default)
    {
        await using var scope = scopes.CreateAsyncScope();
        var own = scope.ServiceProvider.GetRequiredService<CostingDbContext>();
        own.HrSyncLogs.Add(entry);
        await own.SaveChangesAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<HrSyncLog>> RecentAsync(int count, CancellationToken cancellationToken = default) =>
        await db.HrSyncLogs.AsNoTracking().OrderByDescending(l => l.AtUtc).Take(count).ToListAsync(cancellationToken);
}

internal sealed class PayrollRunRepository(CostingDbContext db) : IPayrollRunRepository
{
    private IQueryable<PayrollRun> WithDepartments => db.PayrollRuns.Include(r => r.Departments);

    public Task<PayrollRun?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        WithDepartments.SingleOrDefaultAsync(r => r.Id == id, cancellationToken);

    public void Add(PayrollRun aggregate) => db.PayrollRuns.Add(aggregate);

    public void Remove(PayrollRun run) => db.PayrollRuns.Remove(run);

    public async Task<IReadOnlyList<PayrollRun>> GetRecentAsync(int take, CancellationToken cancellationToken = default) =>
        await WithDepartments.OrderByDescending(r => r.Period).Take(take).ToListAsync(cancellationToken);

    public Task<PayrollRun?> GetForPeriodAsync(DateOnly period, CancellationToken cancellationToken = default) =>
        WithDepartments.SingleOrDefaultAsync(r => r.Period == period, cancellationToken);
}

internal sealed class StaffDeductionRepository(CostingDbContext db) : IStaffDeductionRepository
{
    public Task<StaffDeduction?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        db.StaffDeductions.SingleOrDefaultAsync(d => d.Id == id, cancellationToken);

    public void Add(StaffDeduction aggregate) => db.StaffDeductions.Add(aggregate);

    public async Task<IReadOnlyList<StaffDeduction>> GetBetweenAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken = default) =>
        await db.StaffDeductions.Where(d => d.Date >= from && d.Date <= to).ToListAsync(cancellationToken);
}
