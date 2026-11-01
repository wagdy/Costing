using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Costing.Api.Controllers;
using Costing.Application.Hr;
using Costing.Domain.Access;
using Costing.Infrastructure.Persistence;

namespace Costing.Api.Tests;

// The API exactly as Program.cs builds it, in process, on its own database. On start it has
// migrated and created the first manager, "Boss".
public sealed class TestApi : IAsyncDisposable
{
    public const string BossEmail = "boss@example.com", BossPassword = "boss-password";
    public const string AccountantEmail = "mona@example.com", AccountantPassword = "mona-password";

    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter() } };

    private WebApplicationFactory<Program> _factory = null!;
    private string _connectionString = null!;

    public static string? DatabaseServer => Environment.GetEnvironmentVariable("HRPAYROLL_TEST_DB");

    public IServiceProvider Services => _factory.Services;

    // The accountant's user id, once AccountantAsync has made them.
    public string? AccountantId { get; private set; }

    // `settings`: more of the API's settings, for a test that needs one.
    public static Task<TestApi> StartAsync(IReadOnlyDictionary<string, string>? settings = null)
    {
        if (DatabaseServer is null)
            Assert.Skip("Set HRPAYROLL_TEST_DB to a PostgreSQL 15+ connection string (without Database=) to run the API tests.");

        var api = new TestApi { _connectionString = $"{DatabaseServer};Database=hr_api_test_{Guid.NewGuid():N}" };

        // UseSetting, not ConfigureAppConfiguration: Program reads the connection string and the
        // signing key while building, before anything added later would be seen. "Testing", so
        // appsettings.Development.json and its database stay out of it.
        api._factory = new WebApplicationFactory<Program>().WithWebHostBuilder(web =>
        {
            web.UseEnvironment("Testing");
            web.UseSetting($"ConnectionStrings:{Costing.Infrastructure.DependencyInjection.ConnectionStringName}", api._connectionString);
            // Never a hosting platform's database, whatever this machine's environment says.
            web.UseSetting(Costing.Infrastructure.Persistence.DatabaseConnection.UrlVariable, string.Empty);
            web.UseSetting("Auth:SigningKey", "test-only-signing-key-0123456789-0123456789");
            web.UseSetting("Auth:FirstManager:Email", BossEmail);
            web.UseSetting("Auth:FirstManager:Name", "Boss");
            web.UseSetting("Auth:FirstManager:Password", BossPassword);
            foreach (var (key, value) in settings ?? new Dictionary<string, string>())
                web.UseSetting(key, value);
            web.ConfigureLogging(logging => logging.ClearProviders());
        });

        // Starts the host: migration, then the first manager.
        _ = api._factory.Server;
        return Task.FromResult(api);
    }

    public HttpClient Anonymous() => _factory.CreateClient();

    public HttpClient Anonymous(WebApplicationFactoryClientOptions options) => _factory.CreateClient(options);

    public async Task<HttpClient> SignInAsync(string email, string password)
    {
        var client = _factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/auth/sign-in", new SignInRequest(email, password));
        Assert.True(response.IsSuccessStatusCode, $"Sign-in as {email} failed: {(int)response.StatusCode} {await response.Content.ReadAsStringAsync()}");
        var signedIn = (await response.Content.ReadFromJsonAsync<SignInResponse>(Json))!;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", signedIn.Token);
        return client;
    }

    public Task<HttpClient> ManagerAsync() => SignInAsync(BossEmail, BossPassword);

    // Mona, the accountant, added by the manager as a user.
    public async Task<HttpClient> AccountantAsync(HttpClient manager)
    {
        if (AccountantId is null)
        {
            var response = await manager.PostAsJsonAsync("/api/users", new CreateUserRequest(AccountantEmail, "Mona", UserRole.Accountant, AccountantPassword), Json);
            Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
            AccountantId = (await response.Content.ReadFromJsonAsync<UserDto>(Json))!.Id;
        }

        return await SignInAsync(AccountantEmail, AccountantPassword);
    }

    // The outsider's name, as the employee lists show them.
    public const string OutsiderName = "Outsider";

    // Someone signed in who holds no HR tab: an employee in the portal, given none. Their token is
    // good, and refused (403) everywhere but their own portal.
    public async Task<HttpClient> OutsiderAsync()
    {
        var mobile = "0109" + Random.Shared.Next(1_000_000, 9_999_999).ToString(System.Globalization.CultureInfo.InvariantCulture);
        await using (var scope = Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<HrDbContext>();
            var outsider = new Costing.Domain.Employees.Employee(
                Guid.NewGuid(), OutsiderName, "Clerk", 3_000, new TimeOnly(9, 0), Costing.Domain.Employees.WeekDays.Friday, new DateOnly(2026, 1, 1));
            outsider.SetMobileNumber(mobile);
            outsider.SetPinHash(scope.ServiceProvider.GetRequiredService<IPinHasher>().Hash("1357"));
            db.Employees.Add(outsider);
            await db.SaveChangesAsync();
        }

        var client = _factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/auth/employee-login", new EmployeeLoginRequest(mobile, "1357"));
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        var signedIn = (await response.Content.ReadFromJsonAsync<EmployeeSignInResponse>(Json))!;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", signedIn.Token);
        return client;
    }

    // The HR screens' live connection, as the Angular app opens it: a WebSocket with the token in
    // the query string, since a browser cannot put it in a header there.
    public async Task<HubConnection> ConnectHubAsync(HttpClient signedIn, ConcurrentQueue<IReadOnlyList<EmployeeStatusDto>> received)
    {
        var token = signedIn.DefaultRequestHeaders.Authorization!.Parameter;
        var server = _factory.Server;
        var connection = new HubConnectionBuilder()
            .WithUrl(new Uri(server.BaseAddress, $"/hubs/hr?access_token={token}"), o =>
            {
                o.Transports = HttpTransportType.WebSockets;
                o.HttpMessageHandlerFactory = _ => server.CreateHandler();
                o.WebSocketFactory = async (context, cancellationToken) => await server.CreateWebSocketClient().ConnectAsync(context.Uri, cancellationToken);
            })
            .AddJsonProtocol(o => o.PayloadSerializerOptions.Converters.Add(new JsonStringEnumConverter()))
            .Build();
        connection.On<IReadOnlyList<EmployeeStatusDto>>("EmployeeStatusChanged", received.Enqueue);
        await connection.StartAsync();
        return connection;
    }

    public async Task<T> Db<T>(Func<HrDbContext, Task<T>> query)
    {
        await using var scope = Services.CreateAsyncScope();
        return await query(scope.ServiceProvider.GetRequiredService<HrDbContext>());
    }

    // On the Stopwatch, which a laptop's sleep does not move.
    public static async Task<bool> WaitFor(Func<Task<bool>> condition, int seconds = 15)
    {
        var waited = Stopwatch.StartNew();
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
        await _factory.DisposeAsync();

        var options = new DbContextOptionsBuilder<HrDbContext>().UseNpgsql(_connectionString).Options;
        await using var db = new HrDbContext(options);
        await db.Database.EnsureDeletedAsync();
    }
}

public static class HttpAssertions
{
    // What the app would show: errors[0] of the ProblemDetails.
    public static async Task<string?> ErrorOf(HttpResponseMessage response)
    {
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return body.TryGetProperty("errors", out var errors) && errors.ValueKind == JsonValueKind.Array
            ? errors[0].GetString()
            : null;
    }
}
