using Costing.Domain.Common;

namespace Costing.Domain.StockCounts;

// Returns counts with their Lines loaded.
public interface IStockCountRepository : IRepository<StockCount>
{
    // The count being filled in, if one is: there is at most one, so two managers do not count
    // the same stores twice without knowing.
    Task<StockCount?> GetDraftAsync(CancellationToken cancellationToken = default);

    Task<IReadOnlyList<StockCount>> GetAllAsync(CancellationToken cancellationToken = default);

    // Of these materials, those in a posted count other than this one (not voided), each with when
    // it was first posted: an opening count does not count them again.
    Task<IReadOnlyDictionary<Guid, DateTime>> CountedBeforeAsync(
        IReadOnlyCollection<Guid> rawMaterialIds, Guid exceptStockCountId, CancellationToken cancellationToken = default);

    // Only a draft is ever removed. A posted count is part of the stock's history.
    void Remove(StockCount draft);
}
