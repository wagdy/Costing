using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Costing.Application;
using Costing.Application.Hr;
using Costing.Infrastructure.Persistence;

namespace Costing.Infrastructure.Tests;

// The system wired exactly as the API wires it, against a real PostgreSQL. Each test gets its own
// database, created and dropped around it.
public sealed class TestSystem : IAsyncDisposable
{
    private IHost _host = null!;
    private string _connectionString = null!;

    public static string? DatabaseServer => Environment.GetEnvironmentVariable("HRPAYROLL_TEST_DB");

    public static async Task<TestSystem> StartAsync()
    {
        if (DatabaseServer is null)
            Assert.Skip("Set HRPAYROLL_TEST_DB to a PostgreSQL 15+ connection string (without Database=) to run the integration tests.");

        var system = new TestSystem { _connectionString = $"{DatabaseServer};Database=hr_test_{Guid.NewGuid():N}" };
        var builder = Host.CreateApplicationBuilder();
        builder.Logging.ClearProviders();
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            [$"ConnectionStrings:{DependencyInjection.ConnectionStringName}"] = system._connectionString,
            // Never a hosting platform's database, whatever this machine's environment says.
            [DatabaseConnection.UrlVariable] = string.Empty,
        });
        builder.Services.AddHrApplication();
        builder.Services.AddHrInfrastructure(builder.Configuration);
        builder.Services.AddSingleton<IAttendanceNotifier, NoScreens>();
        system._host = builder.Build();

        await using (var scope = system._host.Services.CreateAsyncScope())
            await scope.ServiceProvider.GetRequiredService<HrDbContext>().Database.MigrateAsync();

        await system._host.StartAsync();
        return system;
    }

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

    public async Task<T> Db<T>(Func<HrDbContext, Task<T>> query)
    {
        await using var scope = _host.Services.CreateAsyncScope();
        return await query(scope.ServiceProvider.GetRequiredService<HrDbContext>());
    }

    public T Service<T>(IServiceScope scope) where T : notnull => scope.ServiceProvider.GetRequiredService<T>();

    public IServiceScope Scope() => _host.Services.CreateScope();

    public async ValueTask DisposeAsync()
    {
        await _host.StopAsync();
        _host.Dispose();

        var options = new DbContextOptionsBuilder<HrDbContext>().UseNpgsql(_connectionString).Options;
        await using var db = new HrDbContext(options);
        await db.Database.EnsureDeletedAsync();
    }

    private sealed class NoScreens : IAttendanceNotifier
    {
        public Task StatusChangedAsync(IReadOnlyList<EmployeeStatusDto> statuses, CancellationToken cancellationToken) => Task.CompletedTask;
    }
}
