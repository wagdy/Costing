namespace Costing.Domain.Common;

public interface IUnitOfWork
{
    // Saves every change made in the current use case in one transaction: an approval and what
    // it applies, an advance and its shares, are saved together or not at all.
    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);
}
