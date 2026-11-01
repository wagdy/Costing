using Microsoft.EntityFrameworkCore;
using Costing.Infrastructure.Persistence;

namespace Costing.Infrastructure.Tests;

// The database as the API starts on it: migrated once, and found migrated every start after.
public class DatabaseTests
{
    private static CancellationToken Cancel => TestContext.Current.CancellationToken;

    // The test server's user is hr, as the dev database's is: its "$user" schema is hr once the
    // first migration made it, so a history of migrations left to the search path would be looked
    // for there, not found, and every migration applied again.
    [Fact]
    public async Task Started_again_it_finds_its_migrations_applied_and_applies_none_twice()
    {
        await using var app = await TestSystem.StartAsync();

        Assert.Empty(await app.Db(db => db.Database.GetPendingMigrationsAsync(Cancel)));
        Assert.Equal(await app.Db(db => Task.FromResult(db.Database.GetMigrations())), await app.Db(db => db.Database.GetAppliedMigrationsAsync(Cancel)));
        await app.Db(async db =>
        {
            await db.Database.MigrateAsync(Cancel);
            return true;
        });
        var history = await app.Db(db => db.Database.SqlQueryRaw<string>(
            "SELECT table_schema AS \"Value\" FROM information_schema.tables WHERE table_name = '__EFMigrationsHistory'").ToListAsync(Cancel));
        Assert.Equal([HrDbContext.HrSchema], history);
    }
}
