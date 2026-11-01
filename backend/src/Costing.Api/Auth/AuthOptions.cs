namespace Costing.Api.Auth;

public sealed class AuthOptions
{
    public const string Section = "Auth";

    // HMAC key for signing tokens; at least 32 bytes. Generate one per installation, for example
    // `openssl rand -base64 48`. Anyone who has it can sign in as anyone.
    public string SigningKey { get; set; } = string.Empty;

    // A working day. A deactivated user, a new role or a new password is refused at once
    // regardless (see AuthenticationSetup), so this is about how often people sign in again.
    public int TokenLifetimeHours { get; set; } = 12;

    public FirstManagerOptions FirstManager { get; set; } = new();
}

// Creates the first manager when there is no user yet; see UserDirectory.EnsureFirstManagerAsync.
// Take the password out of the configuration once it has.
public sealed class FirstManagerOptions
{
    public string? Email { get; set; }

    public string? Name { get; set; }

    public string? Password { get; set; }
}
