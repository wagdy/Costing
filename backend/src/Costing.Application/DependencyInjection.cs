using Microsoft.Extensions.DependencyInjection;

namespace Costing.Application;

public static class DependencyInjection
{
    // Infrastructure supplies the repositories, the unit of work and the clock.
    public static IServiceCollection AddCostingApplication(this IServiceCollection services)
    {
        services.AddMediatR(config =>
        {
            config.RegisterServicesFromAssembly(typeof(DependencyInjection).Assembly);
            // The books' lock: every request that writes to them, before its handler.
            config.AddOpenBehavior(typeof(Books.BooksLockBehavior<,>));
        });
        services.AddScoped<Books.IBooksLock, Books.CompanyBooksLock>();
        services.AddScoped<Books.BooksGuard>();
        services.AddScoped<Books.PeriodLockReader>();
        services.AddScoped<Company.CompanyStructureReader>();
        services.AddScoped<Stock.StockPlaces>();
        services.AddScoped<Stock.TransferReading>();
        // The days of the records each request names.
        foreach (var lookup in typeof(DependencyInjection).Assembly.GetTypes()
                     .Where(t => t is { IsClass: true, IsAbstract: false } && !t.IsGenericTypeDefinition))
        {
            foreach (var contract in lookup.GetInterfaces().Where(i => i.IsGenericType && i.GetGenericTypeDefinition() == typeof(Books.IBooksDays<>)))
                services.AddScoped(contract, lookup);
        }
        services.AddScoped<Sales.SaleStockPoster>();
        services.AddScoped<Sales.SaleWriter>();
        services.AddScoped<Sales.DailySalesWriter>();
        services.AddScoped<Approvals.DeletionTargets>();
        services.AddScoped<Production.PrepItemWriter>();
        services.AddScoped<Production.ProductionWriter>();
        services.AddScoped<Treasury.TreasuryWriter>();
        services.AddScoped<Purchases.InvoiceRecorder>();
        services.AddScoped<Purchases.InvoicePoster>();
        services.AddScoped<Purchases.PurchaseOrderReceiver>();
        services.AddScoped<Purchases.PurchaseOrderWriter>();
        services.AddScoped<Purchases.PurchaseOrderReading>();
        services.AddScoped<Purchases.InvoiceCorrector>();
        services.AddScoped<RawMaterials.MaterialUnitWriter>();
        services.AddScoped<Categories.CategoryDeleter>();
        services.AddScoped<EndOfDay.EndOfDayDays>();
        services.AddScoped<Sales.BulkSalesPlanner>();
        services.AddScoped<Integrations.HrOutbox>();
        services.AddScoped<Integrations.StaffDeductionReading>();
        return services;
    }
}
