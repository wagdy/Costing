using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Costing.Infrastructure.Persistence;

// Used only by `dotnet ef`, so migrations can be added before the API exists:
//   dotnet ef migrations add <Name> --project backend/src/Costing.Infrastructure --startup-project backend/src/Costing.Infrastructure --output-dir Persistence/Migrations
// Adding a migration never connects to the database. Applying one reads the connection string
// from COSTING_CONNECTION.
internal sealed class CostingDbContextFactory : IDesignTimeDbContextFactory<CostingDbContext>
{
    public CostingDbContext CreateDbContext(string[] args)
    {
        var connectionString = Environment.GetEnvironmentVariable("COSTING_CONNECTION")
            ?? "Host=localhost;Port=5436;Database=costing;Username=costing;Password=costing-dev";

        return new CostingDbContext(new DbContextOptionsBuilder<CostingDbContext>().UseNpgsql(connectionString, CostingDbContext.ConfigureNpgsql).Options);
    }
}
