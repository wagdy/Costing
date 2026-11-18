using MediatR;
using Costing.Application.Common;
using Costing.Domain.Common;
using Costing.Domain.Company;
using Costing.Domain.Security;

namespace Costing.Application.Company;

// Company structure (هيكل الشركة): how the business is built, its branches, and where each keeps
// its stock. A manager's (Settings → Company structure). An open-space shop has one branch and one
// implicit store, made by the migration; a manager adds locations once the structure has them, and
// branches once it has several. Each change of structure in the security audit log.

// Where what is entered now is written, and what the lists are narrowed to: the company's one
// branch while it has one (no list narrowed); otherwise the user's own branch, or, for one who
// works every branch, the branch they chose at the top of the screen.
public interface ICurrentBranch
{
    Task<Guid> BranchIdAsync(CancellationToken cancellationToken = default);

    // Null while the company works in one branch: nothing to narrow.
    Task<Guid?> ScopeAsync(CancellationToken cancellationToken = default);
}

// Who is asking, as far as branches go: the branch the user is kept to (their token's), or the one a
// user of every branch chose at the top of the screen. Neither for the POS, HR or the app itself.
public interface IBranchRequest
{
    Guid? AssignedBranchId { get; }

    Guid? ChosenBranchId { get; }
}

public static class BranchScope
{
    // A list narrowed to the branch being worked in, when there is one to narrow to.
    public static async Task<IReadOnlyList<T>> NarrowAsync<T>(this ICurrentBranch branch, IEnumerable<T> records, CancellationToken cancellationToken)
        where T : IBranchOwned =>
        await branch.ScopeAsync(cancellationToken) is { } scope ? records.Where(r => r.BranchId == scope).ToList() : records.ToList();
}

public sealed record BranchDto(Guid Id, string Name, string? NameAr, BranchType Type, bool IsActive, bool IsDefault, int Locations)
{
    public static BranchDto From(Branch b, int locations) => new(b.Id, b.Name, b.NameAr, b.Type, b.IsActive, b.IsDefault, locations);
}

// StationIds: the kitchen stations it serves, whose materials the kitchen takes from here.
public sealed record InventoryLocationDto(
    Guid Id, Guid BranchId, string Name, string? NameAr, LocationKind Kind, bool IsActive, bool IsDefault, IReadOnlyList<Guid>? StationIds = null)
{
    public static InventoryLocationDto From(InventoryLocation l) => new(l.Id, l.BranchId, l.Name, l.NameAr, l.Kind, l.IsActive, l.IsDefault, l.StationIds);
}

public sealed record CompanyStructureDto(SystemOperatingMode Mode, IReadOnlyList<BranchDto> Branches, IReadOnlyList<InventoryLocationDto> Locations);

public sealed record GetCompanyStructureQuery : IRequest<CompanyStructureDto>;

// The company's structure changed.
public sealed record ChangeOperatingModeCommand(SystemOperatingMode Mode, string StaffId, string StaffName) : IRequest<CompanyStructureDto>;

// A branch added or changed: added only once the structure has several; a new one gets its main store.
public sealed record SaveBranchCommand(Guid Id, string Name, string? NameAr, BranchType Type, bool IsActive = true) : IRequest<BranchDto>;

// A location added or changed: added only once the structure has locations.
// StationIds: the stations it serves (none changes nothing; empty: none).
public sealed record SaveInventoryLocationCommand(
    Guid Id, Guid BranchId, string Name, string? NameAr, LocationKind Kind, bool IsActive = true, IReadOnlyList<Guid>? StationIds = null)
    : IRequest<InventoryLocationDto>;

// The branches in use, for the branch selector; the structure with them.
public sealed record BranchChoicesDto(SystemOperatingMode Mode, IReadOnlyList<BranchDto> Branches);

public sealed record GetBranchChoicesQuery : IRequest<BranchChoicesDto>;

internal sealed class CompanyStructureReader(IBranchRepository branches, IInventoryLocationRepository locations, ICompanyProfile profile)
{
    public async Task<CompanyStructureDto> ReadAsync(CancellationToken cancellationToken)
    {
        var all = await locations.GetAllAsync(cancellationToken);
        return new CompanyStructureDto(profile.Current.OperatingMode,
            (await branches.GetAllAsync(cancellationToken)).Select(b => BranchDto.From(b, all.Count(l => l.BranchId == b.Id))).ToList(),
            all.Select(InventoryLocationDto.From).ToList());
    }
}

internal sealed class GetCompanyStructureHandler(CompanyStructureReader reader) : IRequestHandler<GetCompanyStructureQuery, CompanyStructureDto>
{
    public Task<CompanyStructureDto> Handle(GetCompanyStructureQuery request, CancellationToken cancellationToken) => reader.ReadAsync(cancellationToken);
}

internal sealed class GetBranchChoicesHandler(IBranchRepository branches, ICompanyProfile profile) : IRequestHandler<GetBranchChoicesQuery, BranchChoicesDto>
{
    public async Task<BranchChoicesDto> Handle(GetBranchChoicesQuery request, CancellationToken cancellationToken) =>
        new(profile.Current.OperatingMode, (await branches.GetAllAsync(cancellationToken)).Where(b => b.IsActive).Select(b => BranchDto.From(b, 0)).ToList());
}

internal sealed class ChangeOperatingModeHandler(
    ICompanySettingsStore settings,
    IBranchRepository branches,
    ISecurityAuditLogRepository audit,
    ICompanyProfile profile,
    CompanyStructureReader reader,
    IUnitOfWork unitOfWork) : IRequestHandler<ChangeOperatingModeCommand, CompanyStructureDto>
{
    public async Task<CompanyStructureDto> Handle(ChangeOperatingModeCommand request, CancellationToken cancellationToken)
    {
        var company = await settings.GetAsync(cancellationToken) ?? throw new DomainException("Save the company's settings first.");
        var previous = company.ChangeOperatingMode(request.Mode, await branches.GetAllAsync(cancellationToken));
        if (previous != request.Mode)
            audit.Add(SecurityAuditLog.OperatingModeChanged(previous.ToString(), request.Mode.ToString(), request.StaffName, request.StaffId));
        await unitOfWork.SaveChangesAsync(cancellationToken);
        profile.Set(CompanyProfile.From(company));
        return await reader.ReadAsync(cancellationToken);
    }
}

internal sealed class SaveBranchHandler(IBranchRepository branches, IInventoryLocationRepository locations, ICompanyProfile profile, IUnitOfWork unitOfWork)
    : IRequestHandler<SaveBranchCommand, BranchDto>
{
    public async Task<BranchDto> Handle(SaveBranchCommand request, CancellationToken cancellationToken)
    {
        var all = await branches.GetAllAsync(cancellationToken);
        var name = request.Name?.Trim() ?? string.Empty;
        if (all.FirstOrDefault(b => b.Id != request.Id && string.Equals(b.Name, name, StringComparison.CurrentCultureIgnoreCase)) is { } same)
            throw new DomainException($"There is a branch called {same.Name} already. · يوجد فرع بهذا الاسم.");
        var branch = all.FirstOrDefault(b => b.Id == request.Id);
        if (branch is null)
        {
            if (!profile.Current.OperatingMode.IsMultiBranch())
                throw new DomainException("Choose a structure with several branches first, on Company structure. · اختر هيكلاً متعدد الفروع أولاً.");
            branch = new Branch(request.Id, request.Name!, request.NameAr, request.Type, request.IsActive);
            branches.Add(branch);
            // Its main store, made with it: where its stock is kept until it has more.
            locations.Add(new InventoryLocation(Guid.NewGuid(), branch.Id, "Main Store", "المخزن الرئيسي", LocationKind.MainStore));
        }
        else
        {
            branch.Change(request.Name!, request.NameAr, request.Type, request.IsActive);
        }
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return BranchDto.From(branch, (await locations.GetAllAsync(cancellationToken)).Count(l => l.BranchId == branch.Id));
    }
}

internal sealed class SaveInventoryLocationHandler(
    IBranchRepository branches, IInventoryLocationRepository locations, ICompanyProfile profile, IUnitOfWork unitOfWork)
    : IRequestHandler<SaveInventoryLocationCommand, InventoryLocationDto>
{
    public async Task<InventoryLocationDto> Handle(SaveInventoryLocationCommand request, CancellationToken cancellationToken)
    {
        var all = await locations.GetAllAsync(cancellationToken);
        var location = all.FirstOrDefault(l => l.Id == request.Id);
        var branchId = location?.BranchId ?? request.BranchId;
        if (await branches.GetByIdAsync(branchId, cancellationToken) is not { } branch)
            throw new DomainException("That branch is no longer there: choose one from the list.");
        var name = request.Name?.Trim() ?? string.Empty;
        if (all.FirstOrDefault(l => l.Id != request.Id && l.BranchId == branchId && string.Equals(l.Name, name, StringComparison.CurrentCultureIgnoreCase)) is { } same)
            throw new DomainException($"{branch.Name} has a location called {same.Name} already. · يوجد موقع بهذا الاسم.");
        if (location is null)
        {
            if (!profile.Current.OperatingMode.HasLocations())
                throw new DomainException("An open-space shop keeps its stock in one place: choose a structure with locations first. · اختر هيكلاً به مواقع أولاً.");
            location = new InventoryLocation(request.Id, branchId, request.Name!, request.NameAr, request.Kind, request.IsActive);
            locations.Add(location);
        }
        else
        {
            location.Change(request.Name!, request.NameAr, request.Kind, request.IsActive);
        }
        if (request.StationIds is { } stations)
        {
            // A station is served from one location of a branch.
            if (all.FirstOrDefault(l => l.Id != location.Id && l.BranchId == branchId && l.StationIds.Intersect(stations).Any()) is { } other)
                throw new DomainException(
                    $"{other.Name} serves one of those stations already: a station takes its stock from one location. · القسم مرتبط بموقع آخر.");
            location.Serve(stations);
        }
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return InventoryLocationDto.From(location);
    }
}
