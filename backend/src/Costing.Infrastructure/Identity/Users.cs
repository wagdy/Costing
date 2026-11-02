using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.Extensions.Logging;
using Costing.Domain.Common;
using Costing.Domain.Access;
using Costing.Infrastructure.Persistence;
using Costing.Infrastructure.Persistence.Configurations;

namespace Costing.Infrastructure.Identity;

// Someone who works in this system: a manager, an accountant, a cost controller or a storekeeper,
// signing in with their email and password.
public sealed class UserAccount
{
    public const int MaxEmailLength = 256;
    public const int MaxNameLength = 200;
    public const int MinPasswordLength = 8;

    public string Id { get; set; } = string.Empty;

    public string Email { get; set; } = string.Empty;

    // Upper case, for finding an email however it is typed.
    public string NormalizedEmail { get; set; } = string.Empty;

    public string FullName { get; set; } = string.Empty;

    public UserRole Role { get; set; }

    public bool IsActive { get; set; } = true;

    public string PasswordHash { get; set; } = string.Empty;

    // When the password was last set: a new one signs them out wherever they are signed in.
    public DateTime PasswordSetAtUtc { get; set; }

    public int FailedSignInAttempts { get; set; }

    public DateTime? LockedUntilUtc { get; set; }

    public DateTime CreatedAtUtc { get; set; }

    public DateTime? LastSignInAtUtc { get; set; }
}

internal sealed class UserAccountConfiguration : IEntityTypeConfiguration<UserAccount>
{
    public void Configure(EntityTypeBuilder<UserAccount> builder)
    {
        builder.ToTable("Users", CostingDbContext.IdentitySchema);
        builder.HasKey(u => u.Id);
        builder.Property(u => u.Id).HasMaxLength(64);
        builder.Property(u => u.Email).HasMaxLength(UserAccount.MaxEmailLength);
        builder.Property(u => u.NormalizedEmail).HasMaxLength(UserAccount.MaxEmailLength);
        builder.HasIndex(u => u.NormalizedEmail).IsUnique();
        builder.Property(u => u.FullName).HasMaxLength(UserAccount.MaxNameLength);
        builder.Property(u => u.Role).IsEnumName();
        builder.Property(u => u.PasswordHash).HasMaxLength(200);
    }
}

public sealed record SignInOutcome(UserAccount? User, DateTime? LockedUntilUtc);

// Who may sign in, and with what: email and password, five misses locking the account for five
// minutes. A manager adds the users, changes their role, deactivates them and resets their
// passwords; there is always at least one active manager.
public sealed class UserDirectory(CostingDbContext db, ILogger<UserDirectory> logger)
{
    private const int MaxFailedAttempts = 5;
    private static readonly TimeSpan LockoutDuration = TimeSpan.FromMinutes(5);
    private static readonly PasswordHasher<UserAccount> Hasher = new();

    // A hash to check a password against when no user has the email, so a wrong email takes as
    // long as a wrong password and does not say which emails are known.
    private static readonly Lazy<string> Nobody = new(() => Hasher.HashPassword(new UserAccount(), Guid.NewGuid().ToString("N")));

    public async Task<IReadOnlyList<UserAccount>> GetAllAsync(CancellationToken cancellationToken) =>
        await db.Users.AsNoTracking().OrderBy(u => u.FullName).ToListAsync(cancellationToken);

    public Task<UserAccount?> GetAsync(string id, CancellationToken cancellationToken) =>
        db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.Id == id, cancellationToken);

    // Null when the user is gone or deactivated. Checked on every request, so a deactivation, a
    // new role or a new password takes effect at once rather than when a token expires.
    public async Task<(UserRole Role, DateTime PasswordSetAtUtc)?> GetActiveAsync(string id, CancellationToken cancellationToken) =>
        await db.Users.AsNoTracking()
            .Where(u => u.Id == id && u.IsActive)
            .Select(u => new { u.Role, u.PasswordSetAtUtc })
            .SingleOrDefaultAsync(cancellationToken) is { } found
            ? (found.Role, found.PasswordSetAtUtc)
            : null;

    public async Task<SignInOutcome> SignInAsync(string? email, string? password, CancellationToken cancellationToken)
    {
        var normalized = Normalize(email);
        var user = normalized.Length == 0 ? null : await db.Users.SingleOrDefaultAsync(u => u.NormalizedEmail == normalized && u.IsActive, cancellationToken);
        if (user is null)
        {
            Hasher.VerifyHashedPassword(new UserAccount(), Nobody.Value, password ?? string.Empty);
            return new SignInOutcome(null, null);
        }
        if (user.LockedUntilUtc > DateTime.UtcNow)
            return new SignInOutcome(null, user.LockedUntilUtc);

        var result = Hasher.VerifyHashedPassword(user, user.PasswordHash, password ?? string.Empty);
        if (result == PasswordVerificationResult.Failed)
        {
            if (++user.FailedSignInAttempts >= MaxFailedAttempts)
            {
                user.FailedSignInAttempts = 0;
                user.LockedUntilUtc = DateTime.UtcNow + LockoutDuration;
                logger.LogWarning("User {UserId} locked after {Attempts} wrong passwords", user.Id, MaxFailedAttempts);
            }
            await db.SaveChangesAsync(cancellationToken);
            return new SignInOutcome(null, user.LockedUntilUtc);
        }

        if (result == PasswordVerificationResult.SuccessRehashNeeded)
            user.PasswordHash = Hasher.HashPassword(user, password!);
        user.FailedSignInAttempts = 0;
        user.LockedUntilUtc = null;
        user.LastSignInAtUtc = DateTime.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        return new SignInOutcome(user, null);
    }

    public async Task<UserAccount> CreateAsync(string email, string fullName, UserRole role, string password, CancellationToken cancellationToken)
    {
        var user = new UserAccount { Id = Guid.NewGuid().ToString("N"), CreatedAtUtc = DateTime.UtcNow, IsActive = true };
        await SetDetailsAsync(user, email, fullName, role, cancellationToken);
        SetPassword(user, password);
        db.Users.Add(user);
        await db.SaveChangesAsync(cancellationToken);
        return user;
    }

    public async Task<UserAccount> UpdateAsync(string id, string email, string fullName, UserRole role, bool isActive, CancellationToken cancellationToken)
    {
        var user = await db.Users.SingleOrDefaultAsync(u => u.Id == id, cancellationToken) ?? throw new NotFoundException("User", id);
        if ((role != UserRole.Manager || !isActive) && user is { Role: UserRole.Manager, IsActive: true }
            && !await db.Users.AnyAsync(u => u.Id != id && u.IsActive && u.Role == UserRole.Manager, cancellationToken))
            throw new DomainException("This is the only active manager: make someone else a manager first.");
        await SetDetailsAsync(user, email, fullName, role, cancellationToken);
        user.IsActive = isActive;
        await db.SaveChangesAsync(cancellationToken);
        return user;
    }

    // A manager's reset, or their own change: either lifts a lockout and signs them out elsewhere.
    public async Task SetPasswordAsync(string id, string password, CancellationToken cancellationToken)
    {
        var user = await db.Users.SingleOrDefaultAsync(u => u.Id == id, cancellationToken) ?? throw new NotFoundException("User", id);
        SetPassword(user, password);
        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task ChangeOwnPasswordAsync(string id, string current, string password, CancellationToken cancellationToken)
    {
        var user = await db.Users.SingleOrDefaultAsync(u => u.Id == id, cancellationToken) ?? throw new NotFoundException("User", id);
        if (Hasher.VerifyHashedPassword(user, user.PasswordHash, current ?? string.Empty) == PasswordVerificationResult.Failed)
            throw new DomainException("Your current password is not right.");
        SetPassword(user, password);
        await db.SaveChangesAsync(cancellationToken);
    }

    // First run: with no user at all, nobody could sign in to add anyone. So the first manager
    // comes from configuration; once there is a user, the configuration is not read again, and
    // the password should be taken out of it.
    public async Task EnsureFirstManagerAsync(string? email, string? name, string? password, CancellationToken cancellationToken)
    {
        if (await db.Users.AnyAsync(cancellationToken))
            return;
        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(password))
        {
            logger.LogWarning("There is no user yet. Set Auth:FirstManager:Email, Name and Password to create the first manager.");
            return;
        }

        await CreateAsync(email, name, UserRole.Manager, password, cancellationToken);
        logger.LogWarning("Created the first manager, {Email}, from Auth:FirstManager. Take the password out of the configuration now.", email.Trim());
    }

    private async Task SetDetailsAsync(UserAccount user, string email, string fullName, UserRole role, CancellationToken cancellationToken)
    {
        var trimmed = email?.Trim() ?? string.Empty;
        if (trimmed.Length is 0 or > UserAccount.MaxEmailLength || !trimmed.Contains('@') || trimmed.StartsWith('@') || trimmed.EndsWith('@'))
            throw new DomainException("Enter their email address: name@company.com.");
        var name = fullName?.Trim() ?? string.Empty;
        if (name.Length is 0 or > UserAccount.MaxNameLength)
            throw new DomainException("Enter their full name.");
        if (!Enum.IsDefined(role))
            throw new DomainException("Choose their role: manager, accountant, cost controller or storekeeper.");
        var normalized = Normalize(trimmed);
        if (await db.Users.AnyAsync(u => u.Id != user.Id && u.NormalizedEmail == normalized, cancellationToken))
            throw new DomainException($"{trimmed} is someone else's already.");
        user.Email = trimmed;
        user.NormalizedEmail = normalized;
        user.FullName = name;
        user.Role = role;
    }

    private static void SetPassword(UserAccount user, string password)
    {
        if ((password ?? string.Empty).Length < UserAccount.MinPasswordLength)
            throw new DomainException($"A password is {UserAccount.MinPasswordLength} characters at least.");
        user.PasswordHash = Hasher.HashPassword(user, password!);
        user.PasswordSetAtUtc = DateTime.UtcNow;
        user.FailedSignInAttempts = 0;
        user.LockedUntilUtc = null;
    }

    private static string Normalize(string? email) => (email ?? string.Empty).Trim().ToUpperInvariant();
}
