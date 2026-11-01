using Costing.Domain.Common;

namespace Costing.Domain.Staff;

// Someone the safe pays: an advance (سلفة) or a salary (صرف راتب). Only a name and a job here: the
// people themselves, their attendance and their pay, are an HR system's. Kept when they leave, as
// the safe's entries name them.
public sealed class StaffMember : AggregateRoot
{
    public const int MaxNameLength = 200;

    private StaffMember() { }

    public StaffMember(Guid id, string name, string? jobTitle)
    {
        Id = id;
        Change(name, jobTitle);
        CreatedAtUtc = DateTime.UtcNow;
    }

    public string Name { get; private set; } = string.Empty;
    public string? JobTitle { get; private set; }
    public bool IsActive { get; private set; } = true;
    public DateTime CreatedAtUtc { get; private set; }

    public void Change(string name, string? jobTitle)
    {
        var clean = name?.Trim();
        if (string.IsNullOrEmpty(clean))
            throw new DomainException("Name them.");
        if (clean.Length > MaxNameLength)
            throw new DomainException($"Keep the name under {MaxNameLength} characters.");
        var job = string.IsNullOrWhiteSpace(jobTitle) ? null : jobTitle.Trim();
        if (job?.Length > 100)
            throw new DomainException("Keep the job title under 100 characters.");
        Name = clean;
        JobTitle = job;
    }

    // Left: off the lists for new entries, still named on the old ones.
    public void Deactivate() => IsActive = false;

    public void Reactivate() => IsActive = true;
}

public interface IStaffMemberRepository : IRepository<StaffMember>
{
    // Left ones too, by name.
    Task<IReadOnlyList<StaffMember>> GetAllAsync(CancellationToken cancellationToken = default);
}
