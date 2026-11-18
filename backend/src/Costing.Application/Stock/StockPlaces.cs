using Costing.Application.Common;
using Costing.Application.Company;
using Costing.Domain.Common;
using Costing.Domain.Company;
using Costing.Domain.RawMaterials;

namespace Costing.Application.Stock;

// Stock kept by location (المخزون حسب الموقع): what each location of a branch has, the sum of its
// ledger entries, so it never drifts from them; and each branch's own average cost.
public sealed record LocationStock(Guid RawMaterialId, Guid LocationId, decimal Quantity);

public interface IStockBalances
{
    // Each material's quantity at a location; across the branch's locations with none.
    Task<IReadOnlyDictionary<Guid, decimal>> OnHandAsync(Guid branchId, Guid? locationId, CancellationToken cancellationToken);

    // Every material's quantity at each of the branch's locations (none where it has nothing).
    Task<IReadOnlyList<LocationStock>> ByLocationAsync(Guid branchId, CancellationToken cancellationToken);

    // The branch's own average cost of each material it has one for.
    Task<IReadOnlyDictionary<Guid, decimal?>> BranchCostsAsync(Guid branchId, CancellationToken cancellationToken);
}

// Where a request keeps or takes its stock, checked; and materials seen as they stand there. An
// open-space shop has one place, its Main Store, so nothing here changes anything for it.
public sealed class StockPlaces(ICompanyProfile profile, ICurrentBranch branch, IInventoryLocationRepository locations, IStockBalances balances)
{
    public bool HasLocations => profile.Current.OperatingMode.HasLocations();

    public Task<Guid> BranchIdAsync(CancellationToken cancellationToken) => branch.BranchIdAsync(cancellationToken);

    // A location asked for: none in an open-space shop (its one store); otherwise one in use, of
    // the branch worked in. None asked: none (the branch's main store, or the station's location).
    public async Task<Guid?> CheckAsync(Guid? locationId, CancellationToken cancellationToken)
    {
        if (!HasLocations || locationId is not { } id)
            return null;
        var location = await locations.GetByIdAsync(id, cancellationToken)
            ?? throw new DomainException("That location is no longer there: choose one from the list. · الموقع غير موجود.");
        if (location.BranchId != await branch.BranchIdAsync(cancellationToken))
            throw new DomainException($"{location.Name} is another branch's: choose one of this branch's locations. · الموقع تابع لفرع آخر.");
        if (!location.IsActive)
            throw new DomainException($"{location.Name} is not in use: choose a location in use. · الموقع غير مفعّل.");
        return id;
    }

    // Materials as they stand where the request works: their stock at the location (or across the
    // branch), their cost the branch's own. Nothing in an open-space shop: the company's figures.
    public async Task ViewAsync(IEnumerable<RawMaterial> materials, Guid? locationId, CancellationToken cancellationToken)
    {
        if (!HasLocations)
            return;
        var here = await branch.BranchIdAsync(cancellationToken);
        var onHand = await balances.OnHandAsync(here, locationId, cancellationToken);
        var costs = profile.Current.OperatingMode.IsMultiBranch()
            ? await balances.BranchCostsAsync(here, cancellationToken)
            : new Dictionary<Guid, decimal?>();
        foreach (var material in materials)
            material.View(onHand.GetValueOrDefault(material.Id), costs.TryGetValue(material.Id, out var cost) ? cost : material.CostHere);
    }
}
