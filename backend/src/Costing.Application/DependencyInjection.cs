using Microsoft.Extensions.DependencyInjection;

namespace Costing.Application;

public static class DependencyInjection
{
    // Infrastructure supplies the repositories, the unit of work and the clock.
    public static IServiceCollection AddCostingApplication(this IServiceCollection services)
    {
        services.AddMediatR(config => config.RegisterServicesFromAssembly(typeof(DependencyInjection).Assembly));
        services.AddScoped<Sales.SaleStockPoster>();
        services.AddScoped<Sales.SaleWriter>();
        services.AddScoped<Approvals.DeletionTargets>();
        services.AddScoped<Production.PrepItemWriter>();
        services.AddScoped<Production.ProductionWriter>();
        services.AddScoped<Treasury.TreasuryWriter>();
        services.AddScoped<Purchases.InvoiceRecorder>();
        services.AddScoped<Purchases.InvoicePoster>();
        services.AddScoped<Purchases.InvoiceCorrector>();
        services.AddScoped<RawMaterials.MaterialUnitWriter>();
        services.AddScoped<Categories.CategoryDeleter>();
        return services;
    }
}
