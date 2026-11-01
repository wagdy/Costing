using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Infrastructure;
using Npgsql;
using Costing.Domain.Common;
using Costing.Domain.Access;
using Costing.Domain.Approvals;
using Costing.Domain.Categories;
using Costing.Domain.Expenses;
using Costing.Domain.Menu;
using Costing.Domain.Production;
using Costing.Domain.Purchases;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;
using Costing.Domain.Sales;
using Costing.Domain.Staff;
using Costing.Domain.StockCounts;
using Costing.Domain.StockMovements;
using Costing.Domain.Suppliers;
using Costing.Domain.Treasury;
using Costing.Domain.Waste;
using Costing.Infrastructure.Identity;
using Costing.Infrastructure.Reports;

namespace Costing.Infrastructure.Persistence;

// The Costing & Financials database: the raw materials and their stock, recipes and prep items,
// the menu and its sales, purchases and suppliers, counts and waste, the safe, the approvals a
// manager gives, and the system's users.
public sealed class CostingDbContext(DbContextOptions<CostingDbContext> options) : DbContext(options), IUnitOfWork
{
    // Everything in one schema; the system's users apart.
    public const string CostingSchema = "costing";
    public const string IdentitySchema = "identity";

    // The app's and the design-time tools' own setup. The history of migrations is kept in the
    // costing schema by name: left to the search path, a database user named costing (whose
    // "$user" schema is costing once the first migration makes it) would look there, find none,
    // and apply them again.
    public static void ConfigureNpgsql(NpgsqlDbContextOptionsBuilder npgsql) => npgsql
        .UseQuerySplittingBehavior(QuerySplittingBehavior.SingleQuery)
        .MigrationsHistoryTable(HistoryRepository.DefaultTableName, CostingSchema);

    public DbSet<MenuCategory> MenuCategories => Set<MenuCategory>();
    public DbSet<MenuItem> MenuItems => Set<MenuItem>();
    public DbSet<MenuItemVariant> MenuItemVariants => Set<MenuItemVariant>();
    public DbSet<AddOn> AddOns => Set<AddOn>();
    public DbSet<SalesReceipt> SalesReceipts => Set<SalesReceipt>();
    public DbSet<StaffMember> Staff => Set<StaffMember>();

    public DbSet<RawMaterial> RawMaterials => Set<RawMaterial>();
    public DbSet<Recipe> Recipes => Set<Recipe>();
    public DbSet<RecipeCategory> RecipeCategories => Set<RecipeCategory>();
    public DbSet<StockMovement> StockMovements => Set<StockMovement>();
    public DbSet<StockCount> StockCounts => Set<StockCount>();
    public DbSet<PurchaseInvoice> PurchaseInvoices => Set<PurchaseInvoice>();
    public DbSet<PurchaseInvoiceAttachment> PurchaseInvoiceAttachments => Set<PurchaseInvoiceAttachment>();
    public DbSet<Supplier> Suppliers => Set<Supplier>();
    public DbSet<PurchaseCategory> PurchaseCategories => Set<PurchaseCategory>();
    public DbSet<ExpenseItem> ExpenseItems => Set<ExpenseItem>();
    public DbSet<ApprovalRequest> ApprovalRequests => Set<ApprovalRequest>();
    public DbSet<SafeTransaction> SafeTransactions => Set<SafeTransaction>();
    public DbSet<SupplierLedgerEntry> SupplierLedgerEntries => Set<SupplierLedgerEntry>();
    public DbSet<PrepRecipe> PrepRecipes => Set<PrepRecipe>();
    public DbSet<ProductionOrder> ProductionOrders => Set<ProductionOrder>();
    public DbSet<BreakageEntry> BreakageEntries => Set<BreakageEntry>();
    public DbSet<CostingSettings> CostingSettings => Set<CostingSettings>();
    public DbSet<FinancialSettings> FinancialSettings => Set<FinancialSettings>();
    public DbSet<SharedCost> SharedCosts => Set<SharedCost>();
    public DbSet<MonthlyExpenses> MonthlyExpenses => Set<MonthlyExpenses>();
    public DbSet<ManualSalesSheet> ManualSalesSheets => Set<ManualSalesSheet>();

    public DbSet<UserTabAccess> UserTabAccess => Set<UserTabAccess>();
    public DbSet<Domain.Company.CompanySettings> CompanySettings => Set<Domain.Company.CompanySettings>();
    public DbSet<Company.CompanyLogo> CompanyLogos => Set<Company.CompanyLogo>();

    public DbSet<UserAccount> Users => Set<UserAccount>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(CostingDbContext).Assembly);

        // The domain's aggregates: ids generated in the domain, domain events never stored, and
        // optimistic concurrency on PostgreSQL's xmin.
        foreach (var entityType in modelBuilder.Model.GetEntityTypes().Where(t => typeof(Entity).IsAssignableFrom(t.ClrType)))
        {
            var entity = modelBuilder.Entity(entityType.ClrType);
            entity.Property(nameof(Entity.Id)).ValueGeneratedNever();

            if (typeof(AggregateRoot).IsAssignableFrom(entityType.ClrType))
            {
                entity.Ignore(nameof(AggregateRoot.DomainEvents));
                entity.Property<uint>("Version").IsRowVersion();
            }
        }
    }

    // Money, to two decimal places.
    protected override void ConfigureConventions(ModelConfigurationBuilder configurationBuilder) =>
        configurationBuilder.Properties<decimal>().HavePrecision(10, 2);

    public override async Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        ChangeTracker.DetectChanges();
        TouchRootsOfChangedChildren();
        try
        {
            return await base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
        }
        catch (Exception ex) when (ToConflict(ex) is { } conflict)
        {
            throw conflict;
        }
    }

    // The xmin check guards a row, but an aggregate can span several: an invoice's lines are rows
    // of their own. Marking the aggregate modified whenever one of its children changes puts
    // its row, and its check, into every save that touches it. Only the owning aggregate,
    // recognised by its collection navigation.
    private void TouchRootsOfChangedChildren()
    {
        var changedChildren = ChangeTracker.Entries()
            .Where(e => e.Entity is Entity and not AggregateRoot
                && e.State is EntityState.Added or EntityState.Modified or EntityState.Deleted)
            .ToList();

        foreach (var child in changedChildren)
        {
            foreach (var foreignKey in child.Metadata.GetForeignKeys()
                         .Where(fk => fk.PrincipalToDependent is not null
                             && typeof(AggregateRoot).IsAssignableFrom(fk.PrincipalEntityType.ClrType)))
            {
                var property = child.Property(foreignKey.Properties[0].Name);
                var rootId = (Guid?)(child.State == EntityState.Deleted ? property.OriginalValue : property.CurrentValue);
                var root = ChangeTracker.Entries<AggregateRoot>().FirstOrDefault(r => r.Entity.Id == rootId);
                if (root is { State: EntityState.Unchanged })
                    root.State = EntityState.Modified;
            }
        }
    }

    // The save failures a caller can act on, translated so no layer above this one ever handles
    // an EF Core or Npgsql type.
    private static ConflictException? ToConflict(Exception ex) => ex switch
    {
        DbUpdateConcurrencyException =>
            new ConflictException("Someone else changed this at the same time. Reload it and try again.", ex),
        DbUpdateException { InnerException: PostgresException { SqlState: PostgresErrorCodes.UniqueViolation } } =>
            new ConflictException("This conflicts with a record that already exists.", ex),
        // Removed while someone else put it to use: a category deleted as a material joined it.
        DbUpdateException { InnerException: PostgresException { SqlState: PostgresErrorCodes.ForeignKeyViolation } } =>
            new ConflictException("It was put to use at the same time. Reload and try again.", ex),
        _ => null,
    };
}
