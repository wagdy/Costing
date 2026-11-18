using MediatR;
using Costing.Application.Books;
using Costing.Application.Common;
using Costing.Application.Company;
using Costing.Domain.Common;
using Costing.Domain.Company;
using Costing.Domain.RawMaterials;
using Costing.Domain.Stock;
using Costing.Domain.StockMovements;

namespace Costing.Application.Stock;

// Internal transfers (التحويلات الداخلية بين المخزن والأقسام): stock moved between the locations of
// a branch, the main store to the kitchen or the bar, at the branch's average cost, posted as it
// is made and voided whole. Only once the company keeps stock in more than one place; and what
// each location has, for whoever moves or counts it.

public sealed record InternalTransferLineDto(Guid RawMaterialId, string Material, string? Code, decimal Quantity, string Unit, decimal? UnitCost, decimal? LineTotal);

public sealed record InternalTransferDto(
    Guid Id,
    string Number,
    DateOnly TransferDate,
    Guid FromLocationId,
    string FromLocation,
    string? FromLocationAr,
    Guid ToLocationId,
    string ToLocation,
    string? ToLocationAr,
    InternalTransferStatus Status,
    string? Notes,
    string CreatedBy,
    DateTime CreatedAtUtc,
    DateTime? VoidedAtUtc,
    string? VoidedBy,
    // Null for whoever does not see the costs.
    decimal? TotalCost,
    IReadOnlyList<InternalTransferLineDto> Lines);

public sealed record TransferLineInput(Guid RawMaterialId, decimal Quantity);

// Posted as it is made, today, in the branch worked in. Its id is made by the app: sent again, the
// one there is comes back.
public sealed record PostInternalTransferCommand(
    Guid Id, Guid FromLocationId, Guid ToLocationId, IReadOnlyList<TransferLineInput> Lines, string? Notes, string StaffId, string StaffName,
    bool SeeCosts = true) : IRequest<InternalTransferDto>, IRetryOnConflict, IBooksEntry
{
    bool IBooksEntry.WritesToday => true;
}

// Voided: both sides of each line go back, now; on the books of the day it was made.
public sealed record VoidInternalTransferCommand(Guid Id, string StaffName, bool SeeCosts = true) : IRequest<InternalTransferDto>, IBooksEntry;

public sealed record GetInternalTransfersQuery(DateOnly From, DateOnly To, bool SeeCosts = true) : IRequest<IReadOnlyList<InternalTransferDto>>;

public sealed record GetInternalTransferQuery(Guid Id, bool SeeCosts = true) : IRequest<InternalTransferDto>;

// The locations of the branch worked in, for the screens that take or put stock somewhere.
public sealed record StockLocationsDto(SystemOperatingMode Mode, Guid BranchId, IReadOnlyList<InventoryLocationDto> Locations);

public sealed record GetStockLocationsQuery : IRequest<StockLocationsDto>;

// What each location of the branch has (الرصيد حسب الموقع): a row a material, a column a location.
public sealed record LocationColumnDto(Guid Id, string Name, string? NameAr, LocationKind Kind, bool IsActive);

public sealed record LocationStockRowDto(
    Guid RawMaterialId, string Material, string? Code, UnitOfMeasure Unit, bool IsPrepItem, IReadOnlyDictionary<Guid, decimal> ByLocation, decimal Total,
    decimal? AverageCost, decimal? Value);

public sealed record LocationStockDto(Guid BranchId, IReadOnlyList<LocationColumnDto> Locations, IReadOnlyList<LocationStockRowDto> Rows);

public sealed record GetLocationStockQuery(bool SeeCosts = true) : IRequest<LocationStockDto>;

internal sealed class TransferReading(IInventoryLocationRepository locations, IRawMaterialRepository materials)
{
    public async Task<IReadOnlyList<InternalTransferDto>> DtosAsync(IReadOnlyList<InternalTransfer> transfers, bool seeCosts, CancellationToken cancellationToken)
    {
        var places = (await locations.GetAllAsync(cancellationToken)).ToDictionary(l => l.Id);
        var ids = transfers.SelectMany(t => t.Lines.Select(l => l.RawMaterialId)).Distinct().ToList();
        var names = ids.Count == 0 ? new Dictionary<Guid, RawMaterial>() : (await materials.GetByIdsAsync(ids, cancellationToken)).ToDictionary(m => m.Id);
        return transfers.Select(t =>
        {
            var from = places.GetValueOrDefault(t.FromLocationId);
            var to = places.GetValueOrDefault(t.ToLocationId);
            return new InternalTransferDto(
                t.Id, t.Number, t.TransferDate, t.FromLocationId, from?.Name ?? "—", from?.NameAr, t.ToLocationId, to?.Name ?? "—", to?.NameAr, t.Status, t.Notes,
                t.CreatedBy, t.CreatedAtUtc, t.VoidedAtUtc, t.VoidedBy, seeCosts ? t.TotalCost : null,
                t.Lines.Select(l => new InternalTransferLineDto(
                    l.RawMaterialId, names.GetValueOrDefault(l.RawMaterialId)?.Name ?? "—", names.GetValueOrDefault(l.RawMaterialId)?.Code, l.Quantity, l.Unit,
                    seeCosts ? l.UnitCostSnapshot : null, seeCosts ? l.LineTotalCost : null)).ToList());
        }).ToList();
    }

    public async Task<InternalTransferDto> DtoAsync(InternalTransfer transfer, bool seeCosts, CancellationToken cancellationToken) =>
        (await DtosAsync([transfer], seeCosts, cancellationToken))[0];
}

internal sealed class PostInternalTransferHandler(
    IInternalTransferRepository transfers,
    IInventoryLocationRepository locations,
    IRawMaterialRepository materials,
    IStockMovementRepository movements,
    IStockBalances balances,
    StockPlaces places,
    BooksGuard books,
    TransferReading reading,
    IUnitOfWork unitOfWork) : IRequestHandler<PostInternalTransferCommand, InternalTransferDto>
{
    public async Task<InternalTransferDto> Handle(PostInternalTransferCommand request, CancellationToken cancellationToken)
    {
        if (await transfers.GetByIdAsync(request.Id, cancellationToken) is { } already)
            return await reading.DtoAsync(already, request.SeeCosts, cancellationToken);
        if (!places.HasLocations)
            throw new DomainException(
                "An open-space shop keeps its stock in one place: choose a structure with locations on Company structure first. · لا توجد مواقع للتحويل بينها.");

        var branch = await places.BranchIdAsync(cancellationToken);
        var from = await locations.GetByIdAsync(request.FromLocationId, cancellationToken)
            ?? throw new DomainException("Choose where the stock is moved from. · اختر موقع الصرف.");
        var to = await locations.GetByIdAsync(request.ToLocationId, cancellationToken)
            ?? throw new DomainException("Choose where the stock is moved to. · اختر موقع الاستلام.");
        var lines = request.Lines ?? [];
        var byId = lines.Count == 0
            ? new Dictionary<Guid, RawMaterial>()
            : (await materials.GetByIdsAsync(lines.Select(l => l.RawMaterialId).Distinct().ToList(), cancellationToken)).ToDictionary(m => m.Id);
        var chosen = lines.Select(l =>
        {
            var material = byId.GetValueOrDefault(l.RawMaterialId) ?? throw new NotFoundException(nameof(RawMaterial), l.RawMaterialId);
            if (material.IsArchived)
                throw new DomainException($"{material.Name} has been archived: it is not moved any more.");
            return (material, l.Quantity);
        }).ToList();

        // At the branch's average cost; checked against what the location it leaves has.
        await places.ViewAsync(byId.Values, from.Id, cancellationToken);
        var onHand = await balances.OnHandAsync(branch, from.Id, cancellationToken);
        var today = books.Today;
        var number = InternalTransfer.NumberFor(today.Year, await transfers.CountInYearAsync(today.Year, cancellationToken) + 1);
        var (transfer, ledger) = InternalTransfer.Post(
            request.Id, number, branch, today, from, to, chosen, onHand, request.Notes, request.StaffName, request.StaffId);
        transfers.Add(transfer);
        foreach (var movement in ledger)
            movements.Add(movement);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await reading.DtoAsync(transfer, request.SeeCosts, cancellationToken);
    }
}

internal sealed class VoidInternalTransferHandler(
    IInternalTransferRepository transfers,
    IRawMaterialRepository materials,
    IStockMovementRepository movements,
    TransferReading reading,
    IUnitOfWork unitOfWork) : IRequestHandler<VoidInternalTransferCommand, InternalTransferDto>
{
    public async Task<InternalTransferDto> Handle(VoidInternalTransferCommand request, CancellationToken cancellationToken)
    {
        var transfer = await transfers.GetByIdAsync(request.Id, cancellationToken) ?? throw new NotFoundException(nameof(InternalTransfer), request.Id);
        transfer.Void(request.StaffName);
        var originals = (await movements.GetBySourceAsync(transfer.Id, StockMovementReason.TransferOut, cancellationToken))
            .Concat(await movements.GetBySourceAsync(transfer.Id, StockMovementReason.TransferIn, cancellationToken))
            .Where(m => !m.IsReversal)
            .ToList();
        var byId = (await materials.GetByIdsAsync(originals.Select(m => m.RawMaterialId).Distinct().ToList(), cancellationToken)).ToDictionary(m => m.Id);
        // Each side back where it was: the reversal keeps its original's branch and location.
        foreach (var original in originals)
            movements.Add(byId[original.RawMaterialId].Reverse(original, request.StaffName));
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await reading.DtoAsync(transfer, request.SeeCosts, cancellationToken);
    }
}

internal sealed class GetInternalTransfersHandler(IInternalTransferRepository transfers, ICurrentBranch branch, TransferReading reading)
    : IRequestHandler<GetInternalTransfersQuery, IReadOnlyList<InternalTransferDto>>
{
    public async Task<IReadOnlyList<InternalTransferDto>> Handle(GetInternalTransfersQuery request, CancellationToken cancellationToken)
    {
        if (request.To < request.From)
            throw new DomainException("The period ends before it starts.");
        if (request.To.DayNumber - request.From.DayNumber > 366)
            throw new DomainException("Show a year of transfers at most.");
        var listed = await transfers.GetBetweenAsync(await branch.BranchIdAsync(cancellationToken), request.From, request.To, cancellationToken);
        return await reading.DtosAsync(listed.OrderByDescending(t => t.TransferDate).ThenByDescending(t => t.Number, StringComparer.Ordinal).ToList(),
            request.SeeCosts, cancellationToken);
    }
}

internal sealed class GetInternalTransferHandler(IInternalTransferRepository transfers, TransferReading reading)
    : IRequestHandler<GetInternalTransferQuery, InternalTransferDto>
{
    public async Task<InternalTransferDto> Handle(GetInternalTransferQuery request, CancellationToken cancellationToken) =>
        await reading.DtoAsync(
            await transfers.GetByIdAsync(request.Id, cancellationToken) ?? throw new NotFoundException(nameof(InternalTransfer), request.Id),
            request.SeeCosts, cancellationToken);
}

internal sealed class GetStockLocationsHandler(ICompanyProfile profile, ICurrentBranch branch, IInventoryLocationRepository locations)
    : IRequestHandler<GetStockLocationsQuery, StockLocationsDto>
{
    public async Task<StockLocationsDto> Handle(GetStockLocationsQuery request, CancellationToken cancellationToken)
    {
        var here = await branch.BranchIdAsync(cancellationToken);
        var mode = profile.Current.OperatingMode;
        var listed = mode.HasLocations()
            ? (await locations.GetAllAsync(cancellationToken)).Where(l => l.BranchId == here && l.IsActive).Select(InventoryLocationDto.From).ToList()
            : [];
        return new StockLocationsDto(mode, here, listed);
    }
}

internal sealed class GetLocationStockHandler(
    ICompanyProfile profile, ICurrentBranch branch, IInventoryLocationRepository locations, IRawMaterialRepository materials, IStockBalances balances)
    : IRequestHandler<GetLocationStockQuery, LocationStockDto>
{
    public async Task<LocationStockDto> Handle(GetLocationStockQuery request, CancellationToken cancellationToken)
    {
        var here = await branch.BranchIdAsync(cancellationToken);
        var columns = (await locations.GetAllAsync(cancellationToken)).Where(l => l.BranchId == here).ToList();
        var stock = await balances.ByLocationAsync(here, cancellationToken);
        var costs = profile.Current.OperatingMode.IsMultiBranch() ? await balances.BranchCostsAsync(here, cancellationToken) : null;
        var held = stock.GroupBy(s => s.RawMaterialId).ToDictionary(g => g.Key, g => g.ToDictionary(s => s.LocationId, s => s.Quantity));
        var rows = (await materials.GetAllAsync(cancellationToken))
            .Where(m => !m.IsArchived || held.ContainsKey(m.Id))
            .Select(m =>
            {
                var at = held.GetValueOrDefault(m.Id) ?? new Dictionary<Guid, decimal>();
                var total = at.Values.Sum();
                var cost = costs is null ? m.AverageCost : costs.GetValueOrDefault(m.Id) ?? m.AverageCost;
                return new LocationStockRowDto(m.Id, m.Name, m.Code, m.Unit, m.IsPrepItem, at, total,
                    request.SeeCosts ? cost : null, request.SeeCosts && cost is { } c ? Math.Round(total * c, 2, MidpointRounding.AwayFromZero) : null);
            })
            .ToList();
        return new LocationStockDto(
            here, columns.Select(l => new LocationColumnDto(l.Id, l.Name, l.NameAr, l.Kind, l.IsActive)).ToList(), rows);
    }
}
