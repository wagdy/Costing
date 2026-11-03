using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Costing.Application.Common;
using Costing.Domain.Access;
using Costing.Domain.Approvals;
using Costing.Domain.Categories;
using Costing.Domain.Common;
using Costing.Domain.Company;
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
using Costing.Infrastructure.Common;
using Costing.Infrastructure.Reports;
using Costing.Infrastructure.Identity;
using Costing.Infrastructure.Persistence;

namespace Costing.Infrastructure;

public static class DependencyInjection
{
    public const string ConnectionStringName = "Costing";

    // Every port of the application, except the live notifications, which come from the API's hub.
    public static IServiceCollection AddCostingInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        // DATABASE_URL first (a hosting platform's), else ConnectionStrings:Costing.
        var connectionString = DatabaseConnection.Resolve(configuration);

        services.Configure<CompanyOptions>(configuration.GetSection(CompanyOptions.Section));
        services.AddSingleton<ICompanyProfile, CompanyProfileStore>();
        services.AddSingleton<BusinessCalendar>();
        services.AddSingleton<IBusinessCalendar>(sp => sp.GetRequiredService<BusinessCalendar>());
        services.TryAddSingleton(TimeProvider.System);

        services.AddDbContext<CostingDbContext>(o => o.UseNpgsql(connectionString, CostingDbContext.ConfigureNpgsql));
        services.AddScoped<IUnitOfWork>(sp => sp.GetRequiredService<CostingDbContext>());
        services.AddTransient(typeof(IPipelineBehavior<,>), typeof(RetryOnConflictBehavior<,>));

        // Company Settings.
        services.AddScoped<ICompanySettingsStore, Company.CompanySettingsStore>();

        // Approvals.
        services.AddScoped<IApprovalRequestRepository, ApprovalRequestRepository>();

        // The menu, its sales, and the staff the safe pays.
        services.AddScoped<IMenuRepository, MenuRepository>();
        services.AddScoped<ISalesReceiptRepository, SalesReceiptRepository>();
        services.AddScoped<IStaffMemberRepository, StaffMemberRepository>();
        services.AddScoped<IUserTabAccessRepository, UserTabAccessRepository>();

        // Stock, recipes, purchases and the safe.
        services.AddScoped<IRawMaterialRepository, RawMaterialRepository>();
        services.AddScoped<Costing.Application.RawMaterials.IMaterialUnits, MaterialUnits>();
        services.AddScoped<Costing.Application.Categories.IItemConversions, ItemConversions>();
        services.AddScoped<IRecipeRepository, RecipeRepository>();
        services.AddScoped<IRecipeCategoryRepository, RecipeCategoryRepository>();
        services.AddScoped<IStockMovementRepository, StockMovementRepository>();
        services.AddScoped<IStockCountRepository, StockCountRepository>();
        services.AddScoped<IPurchaseInvoiceRepository, PurchaseInvoiceRepository>();
        services.AddScoped<IPurchaseAttachmentStore, PurchaseAttachmentStore>();
        services.AddScoped<ISupplierRepository, SupplierRepository>();
        services.AddScoped<IPurchaseCategoryRepository, PurchaseCategoryRepository>();
        services.AddScoped<ISafeTransactionRepository, SafeTransactionRepository>();
        services.AddScoped<ISupplierLedgerRepository, SupplierLedgerRepository>();
        services.AddScoped<Costing.Application.Approvals.IRecordDescriptions, RecordDescriptions>();
        services.AddScoped<Costing.Application.Treasury.ITaxRate, FinancialTaxRate>();
        services.AddScoped<IExpenseItemRepository, ExpenseItemRepository>();
        services.AddScoped<IPrepRecipeRepository, PrepRecipeRepository>();
        services.AddScoped<IProductionOrderRepository, ProductionOrderRepository>();
        services.AddScoped<IBreakageEntryRepository, BreakageEntryRepository>();

        // The cost reports and the treasury.
        services.AddScoped<SalesLedger>();
        services.AddScoped<CostingService>();
        services.AddScoped<VarianceService>();
        services.AddScoped<KpiService>();
        services.AddScoped<BreakEvenService>();
        services.AddScoped<PurchaseSpendingService>();
        services.AddScoped<TreasuryService>();
        services.AddScoped<IntelligenceService>();

        // The system's users.
        services.AddScoped<UserDirectory>();

        return services;
    }
}
