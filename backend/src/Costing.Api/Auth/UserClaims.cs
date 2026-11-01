using System.Globalization;
using System.Security.Claims;
using Costing.Domain.Access;

namespace Costing.Api.Auth;

// What a user's token says about who holds it: their user id, name and role, and when their
// password was set, so a new one signs them out at once.
//
// Short claim names, read back as they are: AuthenticationSetup turns off the inbound mapping
// that would otherwise rename them to long XML-namespace claim types.
public static class UserClaims
{
    public const string Id = "sub";
    public const string Name = "name";
    public const string Role = "role";
    public const string PasswordSetAt = "pwd_set";

    public static string? IdOf(ClaimsPrincipal user) => user.FindFirstValue(Id);

    public static string NameOf(ClaimsPrincipal user) => user.FindFirstValue(Name) ?? string.Empty;

    // Null for anything but a role name this build knows. A number is refused too, though
    // Enum.TryParse would take it.
    public static UserRole? RoleOf(ClaimsPrincipal user) =>
        user.FindFirstValue(Role) is { } value && Enum.GetNames<UserRole>().Contains(value) ? Enum.Parse<UserRole>(value) : null;

    public static long? PasswordSetAtOf(ClaimsPrincipal user) =>
        long.TryParse(user.FindFirstValue(PasswordSetAt), NumberStyles.None, CultureInfo.InvariantCulture, out var ticks) ? ticks : null;
}
