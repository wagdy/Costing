using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Costing.Api.Auth;
using Costing.Domain.Access;
using Costing.Infrastructure.Identity;

namespace Costing.Api.Controllers;

// The system's users, a manager's: added with a first password, changed (name, email, role,
// active), and their password reset. There is always an active manager.
[ApiController]
[Route("api/users")]
[Authorize(Policy = Permissions.UsersManage)]
public sealed class UsersController(UserDirectory users) : ControllerBase
{
    [HttpGet]
    public async Task<IReadOnlyList<UserDto>> GetAll(CancellationToken cancellationToken) =>
        (await users.GetAllAsync(cancellationToken)).Select(UserDto.From).ToList();

    [HttpPost]
    public async Task<UserDto> Create(CreateUserRequest request, CancellationToken cancellationToken) =>
        UserDto.From(await users.CreateAsync(request.Email, request.FullName, request.Role, request.Password, cancellationToken));

    [HttpPut("{userId}")]
    public async Task<UserDto> Update(string userId, UpdateUserRequest request, CancellationToken cancellationToken)
    {
        if (userId == UserClaims.IdOf(User) && (!request.IsActive || request.Role != UserRole.Manager))
            throw new Costing.Domain.Common.DomainException("You cannot take your own manager's rights away: another manager does that.");
        return UserDto.From(await users.UpdateAsync(userId, request.Email, request.FullName, request.Role, request.IsActive, cancellationToken));
    }

    // Also lifts a lockout, and signs them out wherever they are signed in.
    [HttpPut("{userId}/password")]
    public async Task<IActionResult> ResetPassword(string userId, ResetPasswordRequest request, CancellationToken cancellationToken)
    {
        await users.SetPasswordAsync(userId, request.Password, cancellationToken);
        return NoContent();
    }
}

public sealed record UserDto(string Id, string Email, string FullName, UserRole Role, bool IsActive, DateTime CreatedAtUtc, DateTime? LastSignInAtUtc, bool IsLocked)
{
    public static UserDto From(UserAccount u) =>
        new(u.Id, u.Email, u.FullName, u.Role, u.IsActive, u.CreatedAtUtc, u.LastSignInAtUtc, u.LockedUntilUtc > DateTime.UtcNow);
}

public sealed record CreateUserRequest(string Email, string FullName, UserRole Role, string Password);

public sealed record UpdateUserRequest(string Email, string FullName, UserRole Role, bool IsActive);

public sealed record ResetPasswordRequest(string Password);
