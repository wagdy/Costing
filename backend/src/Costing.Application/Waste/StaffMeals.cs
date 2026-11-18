using MediatR;
using Costing.Application.Common;
using Costing.Application.RawMaterials;
using Costing.Domain.Common;
using Costing.Domain.Menu;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;
using Costing.Domain.StockMovements;
using Costing.Application.Books;

namespace Costing.Application.Waste;

// What was taken from stock on purpose (وجبات العاملين والضيافة): a staff meal, hospitality to a
// guest, or a recipe tried. Logged apart from spoilage, so the kitchen is never charged with them
// as unexplained loss, and the P&L carries them where they belong: staff meals in the labor cost,
// hospitality and tastings as costs of their own.
public enum StaffConsumptionKind
{
    StaffMeal = 1,
    Hospitality = 2,
    RecipeTasting = 3,
}

// A line: a material or prep item (Quantity in its own unit: grams, millilitres, pieces), or a
// recipe (Quantity in plates, whole): its ingredients taken as a sale takes them, prep items from
// their own stock, at the average cost now.
public sealed record StaffConsumptionLine(Guid? RawMaterialId, Guid? RecipeId, decimal Quantity);

// EntryId works as a spoilage's: made by the screen, so a retry records it once. RecordedBy is
// set by the API from who is signed in.
public sealed record RecordStaffConsumptionCommand(
    Guid EntryId, StaffConsumptionKind Kind, IReadOnlyList<StaffConsumptionLine> Lines, string? Note = null, string RecordedBy = "", Guid? LocationId = null)
    : IRequest<Guid>, IRetryOnConflict, IBooksEntry
{
    bool IBooksEntry.WritesToday => true;
}

public static class StaffConsumptionKinds
{
    public static StockMovementReason ReasonOf(StaffConsumptionKind kind) => kind switch
    {
        StaffConsumptionKind.StaffMeal => StockMovementReason.StaffMeal,
        StaffConsumptionKind.Hospitality => StockMovementReason.Hospitality,
        StaffConsumptionKind.RecipeTasting => StockMovementReason.RecipeTasting,
        _ => throw new DomainException("A staff meal, hospitality or a recipe tasting. · وجبة عاملين أو ضيافة أو تجربة وصفة."),
    };
}

internal sealed class RecordStaffConsumptionHandler(
    IRawMaterialRepository materials, IRecipeRepository recipes, IMenuRepository menu, IStockMovementRepository movements, IUnitOfWork unitOfWork,
    Stock.StockPlaces places)
    : IRequestHandler<RecordStaffConsumptionCommand, Guid>
{
    public async Task<Guid> Handle(RecordStaffConsumptionCommand request, CancellationToken cancellationToken)
    {
        var reason = StaffConsumptionKinds.ReasonOf(request.Kind);
        if (await movements.ExistsAsync(request.EntryId, reason, cancellationToken))
            return request.EntryId;
        if (request.Lines.Count == 0)
            throw new DomainException("Add at least one item. · أضف صنفًا واحدًا على الأقل.");
        var note = string.IsNullOrWhiteSpace(request.Note) ? null : request.Note.Trim();
        if (note?.Length > 120)
            throw new DomainException("Keep the note under 120 characters.");

        // Each line, as what it takes from stock: (material, quantity, what to call it).
        var taken = new List<(Guid Material, decimal Quantity, string? Note)>();
        IReadOnlyList<MenuItem>? items = null;
        foreach (var line in request.Lines)
        {
            if ((line.RawMaterialId is null) == (line.RecipeId is null))
                throw new DomainException("Each line is a material or a recipe. · كل سطر خامة أو وصفة.");
            if (line.Quantity <= 0)
                throw new DomainException("Each line needs a quantity greater than zero. · الكمية أكبر من صفر.");
            if (line.RawMaterialId is { } materialId)
            {
                taken.Add((materialId, line.Quantity, note));
                continue;
            }

            var recipe = await recipes.GetRequiredAsync(line.RecipeId!.Value, cancellationToken);
            if (recipe.IsDeleted)
                throw new DomainException("That recipe is deleted. · الوصفة محذوفة.");
            if (line.Quantity != decimal.Truncate(line.Quantity))
                throw new DomainException("A recipe is taken in whole plates. · الوصفة بالطبق الكامل.");
            items ??= await menu.GetItemsAsync(cancellationToken);
            var name = recipe.Name
                ?? (recipe.CatalogItemId is { } id ? items.FirstOrDefault(i => i.Id == id)?.Name : null)
                ?? "A recipe";
            var plates = (int)line.Quantity;
            var said = $"{plates} × {name}{(note is null ? "" : $" · {note}")}";
            taken.AddRange(recipe.RequirementsFor(plates).Select(r => (r.RawMaterialId, r.Quantity, (string?)(said.Length > 200 ? said[..200] : said))));
        }

        var byId = await materials.GetRequiredByIdsAsync(taken.Select(t => t.Material).Distinct().ToList(), cancellationToken);
        if (byId.Values.FirstOrDefault(m => m.IsArchived) is { } archived)
            throw new DomainException($"{archived.Name} has been deleted from the raw materials.");
        var location = await places.CheckAsync(request.LocationId, cancellationToken);
        foreach (var (material, quantity, said) in taken)
        {
            var entry = byId[material].RecordConsumption(quantity, request.EntryId, reason, said, request.RecordedBy);
            if (location is { } at)
                entry.AssignLocation(at);
            movements.Add(entry);
        }
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return request.EntryId;
    }
}
