using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Options;
using Costing.Domain.Access;

namespace Costing.Api.Auth;

// An endpoint's sections (CostingTabs): whoever holds any of them may call it.
//   [CostingTab(CostingTabs.Materials)]                          seen on Materials
//   [CostingTab(CostingTabs.Materials | CostingTabs.Recipes)]   read on either
// A change still needs its permission too (InventoryManage, ApprovalDecide), on the endpoint.
//
// A manager holds every tab. Anyone else holds those a manager ticked for them, their role's
// until then (CostingTabSet.DefaultFor).
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, AllowMultiple = true)]
public sealed class CostingTabAttribute : AuthorizeAttribute
{
    public CostingTabAttribute(CostingTabs tabs)
    {
        Tabs = tabs;
        Policy = CostingTabPolicy.Name(new CostingTabRequirement(tabs));
    }

    public CostingTabs Tabs { get; }
}

public sealed record CostingTabRequirement(CostingTabs Tabs) : IAuthorizationRequirement;

// "costing-tab:8": the tabs as their number.
public static class CostingTabPolicy
{
    private const string Prefix = "costing-tab:";

    public static string Name(CostingTabRequirement r) => Prefix + ((int)r.Tabs).ToString(CultureInfo.InvariantCulture);

    public static CostingTabRequirement? Parse(string name) =>
        name.StartsWith(Prefix, StringComparison.Ordinal)
        && int.TryParse(name[Prefix.Length..], NumberStyles.None, CultureInfo.InvariantCulture, out var tabs) && tabs != 0
            ? new CostingTabRequirement((CostingTabs)tabs & CostingTabs.All)
            : null;
}

// The tab policies made as they are asked for; every other policy as registered.
internal sealed class CostingTabPolicyProvider(IOptions<AuthorizationOptions> options) : DefaultAuthorizationPolicyProvider(options)
{
    public override async Task<AuthorizationPolicy?> GetPolicyAsync(string policyName) =>
        CostingTabPolicy.Parse(policyName) is { } requirement
            ? new AuthorizationPolicyBuilder().RequireAuthenticatedUser().AddRequirements(requirement).Build()
            : await base.GetPolicyAsync(policyName);
}

internal sealed class CostingTabHandler(TabCaller caller) : AuthorizationHandler<CostingTabRequirement>
{
    protected override async Task HandleRequirementAsync(AuthorizationHandlerContext context, CostingTabRequirement requirement)
    {
        if ((await caller.TabsAsync()).HasAny(requirement.Tabs))
            context.Succeed(requirement);
    }
}

// Who is calling, and the tabs they hold: read once a request.
public sealed class TabCaller(IHttpContextAccessor accessor, IUserTabAccessRepository access)
{
    private CostingTabs? tabs;

    private ClaimsPrincipal User => accessor.HttpContext?.User ?? new ClaimsPrincipal();

    public async Task<CostingTabs> TabsAsync(CancellationToken cancellationToken = default) => tabs ??= await ReadAsync(cancellationToken);

    private async Task<CostingTabs> ReadAsync(CancellationToken cancellationToken)
    {
        var user = User;
        if (UserClaims.RoleOf(user) is not { } role)
            return CostingTabs.None;
        if (role == UserRole.Manager)
            return CostingTabs.All;
        return UserClaims.IdOf(user) is { } id && await access.GetByUserAsync(id, cancellationToken) is { } row ? row.Tabs : CostingTabSet.DefaultFor(role);
    }
}
