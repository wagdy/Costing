using MediatR;
using Costing.Application.Common;
using Costing.Application.RawMaterials;
using Costing.Domain.Common;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;
using Costing.Domain.Stations;

namespace Costing.Application.Stations;

// The kitchen and bar stations (أقسام التشغيل والمطبخ), a manager's to set on Cost settings: each
// with its own variance tolerance if it has one, and how many materials, prep items and dishes it
// keeps. Each material (a prep item too) and each dish is given one; unassigned, they are the shared
// station's. Seven are there to start with (grill, pizza & bakery, hot kitchen, cold & salads, bar &
// barista, pastry & desserts, shared), each changed or taken away as the kitchen works.

public sealed record KitchenStationDto(
    Guid Id, string Name, string? NameAr, string? Code, int DisplayOrder, decimal? TargetVarianceTolerancePercent, bool IsActive, bool IsShared,
    int Materials, int Recipes)
{
    public static KitchenStationDto From(KitchenStation station, int materials = 0, int recipes = 0) => new(
        station.Id, station.Name, station.NameAr, station.Code, station.DisplayOrder, station.TargetVarianceTolerancePercent, station.IsActive,
        station.IsShared, materials, recipes);
}

public sealed record GetKitchenStationsQuery : IRequest<IReadOnlyList<KitchenStationDto>>;

// Made on its first save (its id made by the page), changed after.
public sealed record SaveKitchenStationCommand(
    Guid Id, string Name, string? NameAr, string? Code, int DisplayOrder, decimal? TargetVarianceTolerancePercent, bool IsActive = true)
    : IRequest<KitchenStationDto>;

// Taken away: what it kept falls back to the shared station.
public sealed record DeleteKitchenStationCommand(Guid Id) : IRequest;

// Materials and prep items given a station (or none: the shared station's), one or many at once.
public sealed record AssignMaterialStationCommand(IReadOnlyList<Guid> RawMaterialIds, Guid? StationId) : IRequest<int>;

// A dish's recipe given the station that makes it (or none).
public sealed record AssignRecipeStationCommand(Guid RecipeId, Guid? StationId) : IRequest<Guid?>;

internal static class StationChecks
{
    // A station to give something to: one there, and in use.
    public static async Task EnsureUsableAsync(this IKitchenStationRepository stations, Guid? stationId, CancellationToken cancellationToken)
    {
        if (stationId is not { } id)
            return;
        var station = await stations.GetByIdAsync(id, cancellationToken)
            ?? throw new DomainException("That station is no longer on the list: choose another. · هذا القسم غير موجود.");
        if (!station.IsActive)
            throw new DomainException($"{station.Name} is not in use: choose another, or put it back in use on Cost settings. · القسم غير مفعل.");
    }
}

internal sealed class GetKitchenStationsHandler(IKitchenStationRepository stations, IRawMaterialRepository materials, IRecipeRepository recipes)
    : IRequestHandler<GetKitchenStationsQuery, IReadOnlyList<KitchenStationDto>>
{
    public async Task<IReadOnlyList<KitchenStationDto>> Handle(GetKitchenStationsQuery request, CancellationToken cancellationToken)
    {
        var kept = (await materials.GetAllAsync(cancellationToken)).Where(m => m.KitchenStationId is not null && !m.IsArchived)
            .GroupBy(m => m.KitchenStationId!.Value).ToDictionary(g => g.Key, g => g.Count());
        var made = (await recipes.GetAllAsync(cancellationToken)).Where(r => r.KitchenStationId is not null && !r.IsDeleted)
            .GroupBy(r => r.KitchenStationId!.Value).ToDictionary(g => g.Key, g => g.Count());
        return (await stations.GetAllAsync(cancellationToken))
            .OrderBy(s => s.DisplayOrder).ThenBy(s => s.Name, StringComparer.CurrentCultureIgnoreCase)
            .Select(s => KitchenStationDto.From(s, kept.GetValueOrDefault(s.Id), made.GetValueOrDefault(s.Id)))
            .ToList();
    }
}

internal sealed class SaveKitchenStationHandler(IKitchenStationRepository stations, IUnitOfWork unitOfWork)
    : IRequestHandler<SaveKitchenStationCommand, KitchenStationDto>
{
    public async Task<KitchenStationDto> Handle(SaveKitchenStationCommand request, CancellationToken cancellationToken)
    {
        if (request.Id == Guid.Empty)
            throw new DomainException("A station needs its id.");
        var all = await stations.GetAllAsync(cancellationToken);
        var code = string.IsNullOrWhiteSpace(request.Code) ? null : request.Code.Trim().ToUpperInvariant();
        if (code is not null && all.Any(s => s.Id != request.Id && s.Code == code))
            throw new DomainException($"Another station has the code {code}: give this one another. · الكود مستخدم لقسم آخر.");
        if (all.FirstOrDefault(s => s.Id != request.Id && string.Equals(s.Name, request.Name?.Trim(), StringComparison.CurrentCultureIgnoreCase)) is { } same)
            throw new DomainException($"There is a station called {same.Name} already. · يوجد قسم بنفس الاسم.");

        var station = await stations.GetByIdAsync(request.Id, cancellationToken);
        if (station is null)
        {
            station = new KitchenStation(
                request.Id, request.Name, request.NameAr, code, request.DisplayOrder, request.TargetVarianceTolerancePercent, request.IsActive);
            stations.Add(station);
        }
        else
        {
            station.Change(request.Name, request.NameAr, code, request.DisplayOrder, request.TargetVarianceTolerancePercent, request.IsActive);
        }
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return KitchenStationDto.From(station);
    }
}

internal sealed class DeleteKitchenStationHandler(IKitchenStationRepository stations, IRawMaterialRepository materials, IRecipeRepository recipes, IUnitOfWork unitOfWork)
    : IRequestHandler<DeleteKitchenStationCommand>
{
    public async Task Handle(DeleteKitchenStationCommand request, CancellationToken cancellationToken)
    {
        var station = await stations.GetByIdAsync(request.Id, cancellationToken) ?? throw new NotFoundException("Station", request.Id);
        // What it kept falls back to the shared station (the database does the waste held against it).
        foreach (var material in (await materials.GetAllAsync(cancellationToken)).Where(m => m.KitchenStationId == station.Id))
            material.AssignStation(null);
        foreach (var recipe in (await recipes.GetAllAsync(cancellationToken)).Where(r => r.KitchenStationId == station.Id))
            recipe.AssignStation(null);
        stations.Remove(station);
        await unitOfWork.SaveChangesAsync(cancellationToken);
    }
}

internal sealed class AssignMaterialStationHandler(IKitchenStationRepository stations, IRawMaterialRepository materials, IUnitOfWork unitOfWork)
    : IRequestHandler<AssignMaterialStationCommand, int>
{
    public const int MaxAtOnce = 2_000;

    public async Task<int> Handle(AssignMaterialStationCommand request, CancellationToken cancellationToken)
    {
        if (request.RawMaterialIds.Count > MaxAtOnce)
            throw new DomainException($"Give at most {MaxAtOnce:N0} materials a station at once.");
        await stations.EnsureUsableAsync(request.StationId, cancellationToken);
        var byId = await materials.GetRequiredByIdsAsync(request.RawMaterialIds.Distinct().ToList(), cancellationToken);
        foreach (var material in byId.Values)
            material.AssignStation(request.StationId);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return byId.Count;
    }
}

internal sealed class AssignRecipeStationHandler(IKitchenStationRepository stations, IRecipeRepository recipes, IUnitOfWork unitOfWork)
    : IRequestHandler<AssignRecipeStationCommand, Guid?>
{
    public async Task<Guid?> Handle(AssignRecipeStationCommand request, CancellationToken cancellationToken)
    {
        await stations.EnsureUsableAsync(request.StationId, cancellationToken);
        var recipe = await recipes.GetByIdAsync(request.RecipeId, cancellationToken) ?? throw new NotFoundException("Recipe", request.RecipeId);
        recipe.AssignStation(request.StationId);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return recipe.KitchenStationId;
    }
}
