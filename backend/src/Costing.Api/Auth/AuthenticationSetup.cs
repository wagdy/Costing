using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.IdentityModel.Tokens;
using Costing.Domain.Access;
using Costing.Infrastructure.Identity;

namespace Costing.Api.Auth;

internal static class AuthenticationSetup
{
    public static IServiceCollection AddCostingAuthentication(this IServiceCollection services, IConfiguration configuration)
    {
        var section = configuration.GetSection(AuthOptions.Section);
        var options = section.Get<AuthOptions>() ?? new AuthOptions();

        // The usual floor for HS256. Failing at startup means a misconfigured machine never
        // serves at all, rather than serving forgeable tokens.
        if (Encoding.UTF8.GetByteCount(options.SigningKey) < 32)
            throw new InvalidOperationException($"{AuthOptions.Section}:SigningKey must be at least 32 bytes. Generate one with `openssl rand -base64 48`.");

        services.Configure<AuthOptions>(section);
        services.AddSingleton<TokenService>();
        services.AddHttpContextAccessor();
        services.AddScoped<TabCaller>();
        services.AddScoped<IAuthorizationHandler, CostingTabHandler>();
        services.AddSingleton<IAuthorizationPolicyProvider, CostingTabPolicyProvider>();

        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer(jwt =>
            {
                jwt.MapInboundClaims = false;
                jwt.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidIssuer = TokenService.Issuer,
                    ValidAudience = TokenService.Audience,
                    IssuerSigningKey = TokenService.SigningKey(options),
                    NameClaimType = UserClaims.Name,
                    RoleClaimType = UserClaims.Role,
                    ClockSkew = TimeSpan.FromMinutes(1),
                };

                jwt.Events = new JwtBearerEvents
                {
                    // A token alone would keep a deactivated user signed in until it ran out, and
                    // a demoted manager would keep manager rights as long. So every request also
                    // checks that the user is still active, with the role the token claims and
                    // the password it was signed in with.
                    OnTokenValidated = async context =>
                    {
                        var principal = context.Principal!;
                        var userId = UserClaims.IdOf(principal);
                        var active = userId is null
                            ? null
                            : await context.HttpContext.RequestServices.GetRequiredService<UserDirectory>()
                                .GetActiveAsync(userId, context.HttpContext.RequestAborted);

                        if (active is not { } user || user.Role != UserClaims.RoleOf(principal)
                            || user.PasswordSetAtUtc.Ticks / 10 != UserClaims.PasswordSetAtOf(principal) / 10)
                            context.Fail("This account has been deactivated, or its role or password has changed. Sign in again.");
                    },
                };
            });

        // Signed in as a user, for an endpoint that says [Authorize] and for one that forgets to
        // (the fallback), so a new endpoint is closed by default rather than open.
        var staff = new AuthorizationPolicyBuilder()
            .RequireAuthenticatedUser()
            .RequireAssertion(context => UserClaims.RoleOf(context.User) is not null)
            .Build();
        var authorization = services.AddAuthorizationBuilder()
            .SetDefaultPolicy(staff)
            .SetFallbackPolicy(staff);

        // One policy per permission, named by the permission itself:
        //   [Authorize(Policy = Permissions.UsersManage)]
        // Granted by the RolePermissions table, the one the app reads too.
        foreach (var permission in Permissions.All)
        {
            authorization.AddPolicy(permission, policy => policy
                .RequireAuthenticatedUser()
                .RequireAssertion(context => UserClaims.RoleOf(context.User) is { } role && RolePermissions.Has(role, permission)));
        }

        return services;
    }
}
