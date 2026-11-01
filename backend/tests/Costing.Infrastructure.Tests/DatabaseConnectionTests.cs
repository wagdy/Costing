using Microsoft.Extensions.Configuration;
using Npgsql;
using Costing.Infrastructure.Persistence;

namespace Costing.Infrastructure.Tests;

// No database here: which database the system is pointed at, a hosting platform's DATABASE_URL
// before the configuration's connection string.
public class DatabaseConnectionTests
{
    private static IConfiguration Settings(params (string Key, string Value)[] values) =>
        new ConfigurationBuilder().AddInMemoryCollection(values.ToDictionary(v => v.Key, v => (string?)v.Value)).Build();

    [Fact]
    public void A_platforms_url_is_read_as_npgsql_takes_it()
    {
        var railway = new NpgsqlConnectionStringBuilder(DatabaseConnection.FromUrl("postgresql://postgres:p%40ss%3Aword@postgres.railway.internal:5432/railway"));
        Assert.Equal(("postgres.railway.internal", 5432, "railway", "postgres", "p@ss:word"),
            (railway.Host, railway.Port, railway.Database, railway.Username, railway.Password));

        var secure = new NpgsqlConnectionStringBuilder(DatabaseConnection.FromUrl("postgres://hr:secret@db.example.com/costing?sslmode=require"));
        Assert.Equal((5432, SslMode.Require), (secure.Port, secure.SslMode));

        Assert.Throws<InvalidOperationException>(() => DatabaseConnection.FromUrl("mysql://hr@db/hr"));
    }

    [Fact]
    public void Database_url_comes_before_the_connection_string_and_one_of_them_is_needed()
    {
        const string local = "Host=localhost;Port=5435;Database=costing;Username=hr;Password=hr-dev";
        Assert.Equal(local, DatabaseConnection.Resolve(Settings(("ConnectionStrings:Costing", local))));
        Assert.Equal(local, DatabaseConnection.Resolve(Settings(("ConnectionStrings:Costing", local), ("DATABASE_URL", ""))));

        var cloud = DatabaseConnection.Resolve(Settings(("ConnectionStrings:Costing", local), ("DATABASE_URL", "postgres://u:p@cloud.db:6543/prod")));
        Assert.Equal(("cloud.db", 6543, "prod"), (new NpgsqlConnectionStringBuilder(cloud).Host, new NpgsqlConnectionStringBuilder(cloud).Port, new NpgsqlConnectionStringBuilder(cloud).Database));

        Assert.Contains("DATABASE_URL", Assert.Throws<InvalidOperationException>(() => DatabaseConnection.Resolve(Settings(("ConnectionStrings:Costing", "")))).Message);
    }
}
