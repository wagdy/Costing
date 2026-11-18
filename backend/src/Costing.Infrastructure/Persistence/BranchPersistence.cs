using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.Extensions.DependencyInjection;
using Costing.Application.Common;
using Costing.Application.Company;
using Costing.Domain.Common;
using Costing.Domain.Company;
using Costing.Domain.Purchases;
using Costing.Domain.Sales;
using Costing.Domain.StockCounts;
using Costing.Domain.StockMovements;
using Costing.Domain.Treasury;
using Costing.Domain.Waste;
using Costing.Infrastructure.Persistence.Configurations;

namespace Costing.Infrastructure.Persistence;

// The company's branches and the locations they keep stock in, and the branch each record is
// kept by: the first branch's (a default in the column, so every record made before had it) until
// a manager builds the company otherwise.
internal sealed class BranchConfiguration : IEntityTypeConfiguration<Branch>
{
    public void Configure(EntityTypeBuilder<Branch> builder)
    {
        builder.ToTable("Branches", CostingDbContext.CostingSchema);
        builder.Property(b => b.Name).HasMaxLength(Branch.MaxName);
        builder.Property(b => b.NameAr).HasMaxLength(Branch.MaxName);
        builder.Property(b => b.Type).IsEnumName();
        builder.Property(b => b.IsActive).HasDefaultValue(true);
        builder.Ignore(b => b.IsDefault);
    }
}

internal sealed class InventoryLocationConfiguration : IEntityTypeConfiguration<InventoryLocation>
{
    public void Configure(EntityTypeBuilder<InventoryLocation> builder)
    {
        builder.ToTable("InventoryLocations", CostingDbContext.CostingSchema);
        builder.Property(l => l.Name).HasMaxLength(InventoryLocation.MaxName);
        builder.Property(l => l.NameAr).HasMaxLength(InventoryLocation.MaxName);
        builder.Property(l => l.Kind).IsEnumName();
        builder.Property(l => l.IsActive).HasDefaultValue(true);
        builder.Ignore(l => l.IsDefault);
        builder.HasOne<Branch>().WithMany().HasForeignKey(l => l.BranchId).OnDelete(DeleteBehavior.Restrict);
    }
}

// The branch of each record: the first branch's by default (what every record before had), never
// one taken away (a branch is taken out of use, never deleted).
internal sealed class BranchLinksConfiguration :
    IEntityTypeConfiguration<PurchaseInvoice>, IEntityTypeConfiguration<SafeTransaction>, IEntityTypeConfiguration<Domain.Integrations.PosZReport>,
    IEntityTypeConfiguration<SalesReceipt>, IEntityTypeConfiguration<StockMovement>, IEntityTypeConfiguration<BreakageEntry>,
    IEntityTypeConfiguration<StockCount>
{
    public void Configure(EntityTypeBuilder<PurchaseInvoice> builder) => Link(builder);
    public void Configure(EntityTypeBuilder<SafeTransaction> builder) => Link(builder);
    public void Configure(EntityTypeBuilder<Domain.Integrations.PosZReport> builder) => Link(builder);
    public void Configure(EntityTypeBuilder<SalesReceipt> builder) => Link(builder);
    public void Configure(EntityTypeBuilder<StockMovement> builder) => Link(builder);
    public void Configure(EntityTypeBuilder<BreakageEntry> builder) => Link(builder);
    public void Configure(EntityTypeBuilder<StockCount> builder) => Link(builder);

    private static void Link<T>(EntityTypeBuilder<T> builder) where T : class, IBranchOwned
    {
        builder.Property(e => e.BranchId).HasDefaultValue(Branch.DefaultId).HasSentinel(Guid.Empty);
        builder.HasOne<Branch>().WithMany().HasForeignKey(e => e.BranchId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(e => e.BranchId);
    }
}

internal sealed class BranchRepository(CostingDbContext db) : IBranchRepository
{
    public Task<Branch?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        db.Branches.SingleOrDefaultAsync(b => b.Id == id, cancellationToken);

    public void Add(Branch aggregate) => db.Branches.Add(aggregate);

    // The first branch first, then by name.
    public async Task<IReadOnlyList<Branch>> GetAllAsync(CancellationToken cancellationToken = default) =>
        (await db.Branches.ToListAsync(cancellationToken)).OrderByDescending(b => b.IsDefault).ThenBy(b => b.Name, StringComparer.CurrentCultureIgnoreCase).ToList();
}

internal sealed class InventoryLocationRepository(CostingDbContext db) : IInventoryLocationRepository
{
    public Task<InventoryLocation?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        db.InventoryLocations.SingleOrDefaultAsync(l => l.Id == id, cancellationToken);

    public void Add(InventoryLocation aggregate) => db.InventoryLocations.Add(aggregate);

    // Each branch's main store first.
    public async Task<IReadOnlyList<InventoryLocation>> GetAllAsync(CancellationToken cancellationToken = default) =>
        (await db.InventoryLocations.ToListAsync(cancellationToken))
            .OrderBy(l => l.Kind == LocationKind.MainStore ? 0 : 1).ThenBy(l => l.Name, StringComparer.CurrentCultureIgnoreCase).ToList();
}

// No one asking: the app itself, the POS, HR. The first branch in a single-branch company.
internal sealed class NoBranchRequest : IBranchRequest
{
    public Guid? AssignedBranchId => null;

    public Guid? ChosenBranchId => null;
}

// The branch of the request, worked out once: the first branch while the company has one; then
// the user's own (refused if it is out of use), or the one chosen, if it is a branch in use.
internal sealed class CurrentBranch(ICompanyProfile profile, CostingDbContext db, IBranchRequest request) : ICurrentBranch
{
    private Guid? _resolved;

    public async Task<Guid> BranchIdAsync(CancellationToken cancellationToken = default)
    {
        if (!profile.Current.OperatingMode.IsMultiBranch())
            return Branch.DefaultId;
        return _resolved ??= await ResolveAsync(cancellationToken);
    }

    public async Task<Guid?> ScopeAsync(CancellationToken cancellationToken = default) =>
        profile.Current.OperatingMode.IsMultiBranch() ? await BranchIdAsync(cancellationToken) : null;

    private async Task<Guid> ResolveAsync(CancellationToken cancellationToken)
    {
        if (request.AssignedBranchId is { } own)
        {
            var branch = await db.Branches.AsNoTracking().Where(b => b.Id == own).Select(b => new { b.Name, b.IsActive }).SingleOrDefaultAsync(cancellationToken);
            if (branch is not { IsActive: true })
                throw new ForbiddenException(
                    $"Your branch{(branch is null ? string.Empty : ", " + branch.Name + ",")} is not in use: ask a manager to give you another. · فرعك غير مفعّل.");
            return own;
        }
        if (request.ChosenBranchId is { } chosen && await db.Branches.AsNoTracking().AnyAsync(b => b.Id == chosen && b.IsActive, cancellationToken))
            return chosen;
        return Branch.DefaultId;
    }
}

// Each record saved new is given its branch: what it comes from keeps it (a stock entry its
// invoice's, count's or sale's; a payment its invoice's), anything else the branch of the request.
internal sealed class BranchStampInterceptor(IServiceProvider services) : SaveChangesInterceptor
{
    public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
    {
        if (eventData.Context is { } context)
            await StampAsync(context, cancellationToken);
        return result;
    }

    public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
    {
        if (eventData.Context is { } context)
            StampAsync(context, CancellationToken.None).GetAwaiter().GetResult();
        return result;
    }

    private async Task StampAsync(DbContext context, CancellationToken cancellationToken)
    {
        var added = context.ChangeTracker.Entries<IBranchOwned>()
            .Where(e => e.State == EntityState.Added && e.Entity.BranchId == Guid.Empty)
            .Select(e => e.Entity)
            .ToList();
        if (added.Count == 0)
            return;
        var current = await services.GetRequiredService<ICurrentBranch>().BranchIdAsync(cancellationToken);

        static bool Follows(IBranchOwned record) => record is StockMovement or SafeTransaction { PurchaseInvoiceId: not null };
        foreach (var record in added.Where(r => !Follows(r)))
            record.AssignBranch(current);

        var owners = new Dictionary<Guid, Guid>();
        foreach (var owner in context.ChangeTracker.Entries<IBranchOwned>().Select(e => e.Entity).Where(e => e.BranchId != Guid.Empty))
        {
            owners.TryAdd(((Entity)owner).Id, owner.BranchId);
            if (owner is SalesReceipt sale)
                foreach (var line in sale.Lines)
                    owners.TryAdd(line.PublicId, sale.BranchId);
        }
        foreach (var record in added.Where(Follows))
        {
            Guid? source = record switch
            {
                StockMovement m => m.SourceId,
                SafeTransaction t => t.PurchaseInvoiceId,
                _ => null,
            };
            record.AssignBranch(source is { } id && owners.TryGetValue(id, out var branch) ? branch : current);
        }
    }
}
