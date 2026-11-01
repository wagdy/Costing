using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Costing.Api.Auth;
using Costing.Application.Company;
using Costing.Infrastructure.Identity;
using Costing.Infrastructure.Persistence;

namespace Costing.Api.Hosting;

internal static class DatabaseStartup
{
    // Runs before the app listens: the database brought up to date, the company's settings read
    // (made from the configuration's Company section the first time), and the first manager made
    // when there is no user yet. Set Database:MigrateOnStartup to false where something else
    // applies the migrations.
    public static async Task PrepareDatabaseAsync(this WebApplication app)
    {
        await using var scope = app.Services.CreateAsyncScope();

        if (app.Configuration.GetValue("Database:MigrateOnStartup", defaultValue: true))
            await scope.ServiceProvider.GetRequiredService<CostingDbContext>().Database.MigrateAsync();

        await scope.ServiceProvider.GetRequiredService<ISender>().Send(new EnsureCompanySettingsCommand());

        var first = scope.ServiceProvider.GetRequiredService<IOptions<AuthOptions>>().Value.FirstManager;
        await scope.ServiceProvider.GetRequiredService<UserDirectory>()
            .EnsureFirstManagerAsync(first.Email, first.Name, first.Password, CancellationToken.None);
    }
}
