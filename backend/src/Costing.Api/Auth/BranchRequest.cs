using Costing.Application.Company;

namespace Costing.Api.Auth;

// Who is asking, as far as branches go: the branch the signed-in user is kept to (their token's),
// or, for one who works every branch, the one chosen at the top of the screen (X-Branch-Id). The
// POS and HR, signed in by key, choose none: the first branch.
public sealed class HttpBranchRequest(IHttpContextAccessor http) : IBranchRequest
{
    public const string Header = "X-Branch-Id";

    public Guid? AssignedBranchId => http.HttpContext?.User is { } user && UserClaims.RoleOf(user) is not null ? UserClaims.BranchOf(user) : null;

    public Guid? ChosenBranchId =>
        http.HttpContext is { } context && UserClaims.RoleOf(context.User) is not null && UserClaims.BranchOf(context.User) is null
        && Guid.TryParse(context.Request.Headers[Header].ToString(), out var chosen)
            ? chosen
            : null;
}
