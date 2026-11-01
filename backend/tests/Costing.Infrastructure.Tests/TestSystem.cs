using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Costing.Application;
using Costing.Infrastructure.Persistence;
using Costing.Infrastructure.Reports;

namespace Costing.Infrastructure.Tests;

// The system wired exactly as the API wires it, against a real PostgreSQL, with the test menu on
// it and a stand-in till (Till.cs) to sell from. Each test gets its own database, created and
// dropped around it.
public sealed class TestSystem : IAsyncDisposable
{
    private IHost _host = null!;
    private string _connectionString = null!;

    public static string? DatabaseServer => Environment.GetEnvironmentVariable("COSTING_TEST_DB");

    public static async Task<TestSystem> StartAsync()
    {
        if (DatabaseServer is null)
            Assert.Skip("Set COSTING_TEST_DB to a PostgreSQL 15+ connection string (without Database=) to run the integration tests.");

        var system = new TestSystem { _connectionString = $"{DatabaseServer};Database=costing_test_{Guid.NewGuid():N}" };
        var builder = Host.CreateApplicationBuilder();
        builder.Logging.ClearProviders();
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            [$"ConnectionStrings:{DependencyInjection.ConnectionStringName}"] = system._connectionString,
            // Never a hosting platform's database, whatever this machine's environment says.
            [DatabaseConnection.UrlVariable] = string.Empty,
            // The till's: Cairo, the day from 04:00, amounts in L.E.
            ["Company:CurrencySymbol"] = "L.E",
        });
        builder.Services.AddCostingApplication();
        builder.Services.AddCostingInfrastructure(builder.Configuration);
        builder.Services.AddMediatR(config => config.RegisterServicesFromAssembly(typeof(TestSystem).Assembly));
        builder.Services.AddSingleton<Till>();
        system._host = builder.Build();

        await using (var scope = system._host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CostingDbContext>();
            await db.Database.MigrateAsync();
            await TestMenu.SeedAsync(db);
            await scope.ServiceProvider.GetRequiredService<ISender>().Send(new Costing.Application.Company.EnsureCompanySettingsCommand());
        }

        await system._host.StartAsync();
        return system;
    }

    // Who is at the till: the stand-in keeps no users, so this is only for the reading.
    public TestSystem As(string userId, object role) => this;

    public async Task<T> Send<T>(IRequest<T> request)
    {
        await using var scope = _host.Services.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<ISender>().Send(request);
    }

    public async Task Send(IRequest request)
    {
        await using var scope = _host.Services.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<ISender>().Send(request);
    }

    public async Task<T> Db<T>(Func<CostingDbContext, Task<T>> query)
    {
        await using var scope = _host.Services.CreateAsyncScope();
        return await query(scope.ServiceProvider.GetRequiredService<CostingDbContext>());
    }

    public T Service<T>(IServiceScope scope) where T : notnull => scope.ServiceProvider.GetRequiredService<T>();

    public IServiceScope Scope() => _host.Services.CreateScope();

    public static async Task<bool> WaitFor(Func<Task<bool>> condition, int seconds = 15)
    {
        var waited = System.Diagnostics.Stopwatch.StartNew();
        while (waited.Elapsed < TimeSpan.FromSeconds(seconds))
        {
            if (await condition())
                return true;
            await Task.Delay(100);
        }
        return false;
    }

    public async ValueTask DisposeAsync()
    {
        await _host.StopAsync();
        _host.Dispose();

        var options = new DbContextOptionsBuilder<CostingDbContext>().UseNpgsql(_connectionString).Options;
        await using var db = new CostingDbContext(options);
        await db.Database.EnsureDeletedAsync();
    }
}

// The menu the tests sell from, numbered as a point of sale's would be: a burger at 120 with
// cheese at 15 on it, shawarma by the kilo tray at 400, and lemonade at 30 in Drinks. The bills'
// tax, 14%.
public static class TestMenu
{
    public const int Burger = 1, Shawarma = 10, KiloTray = 101, Cheese = 7, Lemonade = 20;
    public const decimal TaxPercent = 14m;

    public static async Task SeedAsync(CostingDbContext db)
    {
        await db.Database.ExecuteSqlRawAsync("""
            INSERT INTO costing."MenuCategories" ("Id", "Name", "DisplayOrder") VALUES (1, 'Mains', 1), (2, 'Drinks', 2);
            INSERT INTO costing."AddOns" ("Id", "Name", "Price", "IsDeleted") VALUES (7, 'Cheese', 15, false);
            INSERT INTO costing."MenuItems" ("Id", "Name", "Category", "Price", "IsAvailable", "IsPriceBasedOnAddons", "IsDeleted", "AddOnIds") VALUES
                (1, 'Burger', 'Mains', 120, true, false, false, ARRAY[7]),
                (10, 'Shawarma', 'Mains', 0, true, false, false, ARRAY[]::integer[]),
                (20, 'Lemonade', 'Drinks', 30, true, false, false, ARRAY[]::integer[]);
            INSERT INTO costing."MenuItemVariants" ("Id", "MenuItemId", "Name", "Price", "DisplayOrder") VALUES (101, 10, 'Kilo tray', 400, 0);
            INSERT INTO costing."FinancialSettings" ("Id", "ServicePercent", "TaxPercent") VALUES (1, 0, 14);
            SELECT setval(pg_get_serial_sequence('costing."MenuCategories"', 'Id'), 100);
            SELECT setval(pg_get_serial_sequence('costing."AddOns"', 'Id'), 100);
            SELECT setval(pg_get_serial_sequence('costing."MenuItemVariants"', 'Id'), 1000);
            """);
    }
}
