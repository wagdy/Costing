using System.Globalization;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.AspNetCore.RateLimiting;
using Costing.Application;
using Costing.Api.Auth;
using Costing.Api.Controllers;
using Costing.Api.ErrorHandling;
using Costing.Api.Hosting;
using Costing.Infrastructure;
using Costing.Infrastructure.Persistence;

var builder = WebApplication.CreateBuilder(args);
// On a hosting platform, its PORT.
builder.ListenOnPlatformPort();

builder.Services.AddCostingApplication();
builder.Services.AddCostingInfrastructure(builder.Configuration);
builder.Services.AddCostingAuthentication(builder.Configuration);

// Enums travel as names ("Cash", "Pending").
builder.Services.AddControllers()
    .AddJsonOptions(o => o.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.AddOpenApi();

builder.Services.AddProblemDetails(o => o.CustomizeProblemDetails = ApplicationExceptionHandler.Customize);
builder.Services.AddExceptionHandler<ApplicationExceptionHandler>();

// /health says the process is up, /health/ready that it can reach its database too.
builder.Services.AddHealthChecks().AddDbContextCheck<CostingDbContext>(name: "database", tags: ["ready"]);

// Per address, on top of each account's own lockout: one browser cannot cycle through passwords
// across every account.
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.OnRejected = async (context, cancellationToken) =>
    {
        if (context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter))
            context.HttpContext.Response.Headers.RetryAfter = ((int)retryAfter.TotalSeconds).ToString(NumberFormatInfo.InvariantInfo);
        await context.HttpContext.Response.WriteAsJsonAsync(
            new { errors = new[] { "Too many sign-in attempts. Wait a minute and try again." } }, cancellationToken);
    };
    o.AddPolicy(AuthController.SignInRateLimit, context => RateLimitPartition.GetFixedWindowLimiter(
        context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 20, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
});

// Only needed when the Angular app is served from somewhere else, such as `ng serve` during
// development.
builder.Services.AddCors(o => o.AddDefaultPolicy(policy => policy
    .WithOrigins(builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [])
    .AllowAnyHeader()
    .AllowAnyMethod()
    .AllowCredentials()));

var app = builder.Build();

await app.PrepareDatabaseAsync();

app.UseExceptionHandler();
app.UseStatusCodePages();

// Before authentication: the page itself is public, and only the API behind it needs a
// sign-in.
app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions { OnPrepareResponse = SpaHosting.SetCacheHeaders });

app.UseCors();
app.UseAuthentication();
app.UseRateLimiter();
app.UseAuthorization();

if (app.Environment.IsDevelopment())
    app.MapOpenApi().AllowAnonymous();

app.MapControllers();

app.MapHealthChecks("/health", new HealthCheckOptions { Predicate = _ => false }).AllowAnonymous();
app.MapHealthChecks("/health/ready", new HealthCheckOptions { Predicate = check => check.Tags.Contains("ready") }).AllowAnonymous();

app.MapFallback(SpaHosting.ServeIndexAsync).AllowAnonymous();

app.Run();

// For the API tests' WebApplicationFactory.
public partial class Program;
