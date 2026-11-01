using Microsoft.Extensions.Configuration;
using Npgsql;

namespace Costing.Infrastructure.Persistence;

// The database to use: DATABASE_URL when it is set (postgres://user:password@host:port/database,
// as Railway, Render and Heroku give it), else ConnectionStrings:Costing.
public static class DatabaseConnection
{
    public const string UrlVariable = "DATABASE_URL";

    public static string Resolve(IConfiguration configuration)
    {
        if (configuration[UrlVariable] is { Length: > 0 } url)
            return FromUrl(url);
        return configuration.GetConnectionString(DependencyInjection.ConnectionStringName) is { Length: > 0 } connectionString
            ? connectionString
            : throw new InvalidOperationException(
                $"No database: set {UrlVariable} (postgres://user:password@host:port/database) or ConnectionStrings:{DependencyInjection.ConnectionStringName}.");
    }

    // "postgresql://postgres:secret@postgres.railway.internal:5432/railway?sslmode=require" as
    // Npgsql takes it. The user name and password may be percent-encoded.
    public static string FromUrl(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme is not ("postgres" or "postgresql"))
            throw new InvalidOperationException($"{UrlVariable} is not a postgres:// address.");

        var credentials = uri.UserInfo.Split(':', 2);
        var builder = new NpgsqlConnectionStringBuilder
        {
            Host = uri.Host,
            Port = uri.IsDefaultPort || uri.Port <= 0 ? 5432 : uri.Port,
            Database = Uri.UnescapeDataString(uri.AbsolutePath.TrimStart('/')),
            Username = Uri.UnescapeDataString(credentials[0]),
            Password = credentials.Length > 1 ? Uri.UnescapeDataString(credentials[1]) : null,
        };
        foreach (var pair in uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var (key, value) = pair.Split('=', 2) is [var k, var v] ? (k, Uri.UnescapeDataString(v)) : (pair, string.Empty);
            if (key.Equals("sslmode", StringComparison.OrdinalIgnoreCase) && Enum.TryParse<SslMode>(value.Replace("-", string.Empty), ignoreCase: true, out var mode))
                builder.SslMode = mode;
        }

        return builder.ConnectionString;
    }
}
