using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Costing.Api.Auth;
using Costing.Domain.Access;
using Costing.Infrastructure.Common;
using Costing.Infrastructure.Identity;

namespace Costing.Api.Controllers;

// Signing in: a user with their email and password.
[ApiController]
[Route("api/auth")]
public sealed class AuthController(UserDirectory users, TokenService tokens, BusinessCalendar clock) : ControllerBase
{
    public const string SignInRateLimit = "sign-in";

    // One answer for an email nobody has and a wrong password, so it does not say whose emails
    // are known.
    [AllowAnonymous]
    [EnableRateLimiting(SignInRateLimit)]
    [HttpPost("sign-in")]
    public async Task<ActionResult<SignInResponse>> SignIn(SignInRequest request, CancellationToken cancellationToken)
    {
        var outcome = await users.SignInAsync(request.Email, request.Password, cancellationToken);
        if (outcome.User is not { } user)
        {
            var detail = outcome.LockedUntilUtc is { } lockedUntil
                ? $"Too many wrong passwords. Try again after {clock.ToLocal(lockedUntil):HH:mm}."
                : "Wrong email or password.";
            return Problem(statusCode: StatusCodes.Status401Unauthorized, title: "Sign-in failed.", detail: detail);
        }

        var (token, expiresAtUtc) = tokens.Issue(user);
        return new SignInResponse(token, expiresAtUtc, Me.For(user.Id, user.FullName, user.Email, user.Role));
    }

    // Who is signed in, and what they may do: the permissions come from RolePermissions, so the
    // app shows and hides buttons by the same rules the API enforces. Tabs: the sections they
    // work, every one for a manager, anyone else's as a manager ticked them (their role's until then).
    [HttpGet("me")]
    public async Task<Me> GetMe([FromServices] TabCaller caller, CancellationToken cancellationToken)
    {
        var id = UserClaims.IdOf(User)!;
        var user = await users.GetAsync(id, cancellationToken);
        return Me.For(id, user?.FullName ?? User.FindFirst(UserClaims.Name)?.Value ?? string.Empty, user?.Email ?? string.Empty, UserClaims.RoleOf(User)!.Value) with
        {
            Tabs = CostingTabSet.Split(await caller.TabsAsync(cancellationToken)),
        };
    }

    // Their own password changed, with the one they have now. Signs them out elsewhere; this
    // answer brings them a new token for here.
    [HttpPost("password")]
    public async Task<SignInResponse> ChangePassword(ChangePasswordRequest request, CancellationToken cancellationToken)
    {
        var id = UserClaims.IdOf(User)!;
        await users.ChangeOwnPasswordAsync(id, request.CurrentPassword, request.NewPassword, cancellationToken);
        var user = (await users.GetAsync(id, cancellationToken))!;
        var (token, expiresAtUtc) = tokens.Issue(user);
        return new SignInResponse(token, expiresAtUtc, Me.For(user.Id, user.FullName, user.Email, user.Role));
    }
}

public sealed record SignInRequest(string? Email, string? Password);

public sealed record SignInResponse(string Token, DateTime ExpiresAtUtc, Me User);

public sealed record ChangePasswordRequest(string CurrentPassword, string NewPassword);

public sealed record Me(string Id, string FullName, string Email, UserRole Role, IReadOnlyList<string> Permissions, IReadOnlyList<CostingTabs>? Tabs = null)
{
    public static Me For(string id, string fullName, string email, UserRole role) =>
        new(id, fullName, email, role, RolePermissions.For(role).Order(StringComparer.Ordinal).ToList());
}
