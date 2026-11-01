using System.Globalization;
using System.Security.Claims;
using System.Text;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Costing.Domain.Access;
using Costing.Infrastructure.Identity;

namespace Costing.Api.Auth;

public sealed class TokenService(IOptions<AuthOptions> options, TimeProvider time)
{
    public const string Issuer = "hr-payroll";
    public const string Audience = "hr-payroll";

    private static readonly JsonWebTokenHandler Handler = new();

    // A user's: their id, name and role, and when their password was set.
    public (string Token, DateTime ExpiresAtUtc) Issue(UserAccount user) => Create(
    [
        new Claim(UserClaims.Id, user.Id),
        new Claim(UserClaims.Name, user.FullName),
        new Claim(UserClaims.Role, user.Role.ToString()),
        new Claim(UserClaims.PasswordSetAt, user.PasswordSetAtUtc.Ticks.ToString(CultureInfo.InvariantCulture)),
    ]);

    // An employee's, for the self-service portal: their id, the role Employee, and when their PIN
    // was set. Their HR & Payroll tabs too, a claim each ("hr_tabs": ["Now", "Attendance"]), for
    // the portal to show; every request checks them against the ones they have now
    // (AuthenticationSetup).
    private (string Token, DateTime ExpiresAtUtc) Create(IReadOnlyList<Claim> claims)
    {
        var expiresAtUtc = time.GetUtcNow().UtcDateTime.AddHours(options.Value.TokenLifetimeHours);
        var token = Handler.CreateToken(new SecurityTokenDescriptor
        {
            Issuer = Issuer,
            Audience = Audience,
            Expires = expiresAtUtc,
            Subject = new ClaimsIdentity(claims),
            SigningCredentials = new SigningCredentials(SigningKey(options.Value), SecurityAlgorithms.HmacSha256),
        });
        return (token, expiresAtUtc);
    }

    public static SymmetricSecurityKey SigningKey(AuthOptions options) => new(Encoding.UTF8.GetBytes(options.SigningKey));
}
