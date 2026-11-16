using Microsoft.EntityFrameworkCore;
using Costing.Application.Recipes;
using Costing.Domain.Approvals;
using Costing.Domain.Common;
using Costing.Domain.Production;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;

namespace Costing.Infrastructure.Reports;

public enum WhereUsedKind
{
    Dish = 1,
    OffMenuRecipe = 2,
    PrepItem = 3,
}

// One recipe or prep item that uses the item (أين تُستخدم الخامة). For a dish, per portion; for a
// prep item, per batch (BatchQuantity of its Unit). Quantity: as the recipe writes it (edible
// portion), when the item is on it; ThroughPrepItems: what its prep items take of it, as
// purchased, Via naming them. ItemCost: what the item costs in it, at today's costs. Cost: the
// portion's cost (a prep item's: the batch's); Price: the menu's (a planned price off the menu).
public sealed record WhereUsedRow(
    WhereUsedKind Kind,
    Guid Id,
    string Name,
    string? ItemCode,
    string? Category,
    int? Portions,
    decimal? BatchQuantity,
    UnitOfMeasure? BatchUnit,
    decimal? Price,
    decimal? Cost,
    decimal? FoodCostPercent,
    decimal? Quantity,
    decimal? ThroughPrepItems,
    IReadOnlyList<string> Via,
    decimal? ItemCost);

public sealed record WhereUsedReport(
    Guid MaterialId,
    string Material,
    string? Code,
    bool IsPrepItem,
    UnitOfMeasure Unit,
    string PurchaseUnit,
    decimal PurchaseUnitSize,
    int Dishes,
    int PrepItems,
    IReadOnlyList<WhereUsedRow> Rows);

public sealed record SwapPreviewRequest(Guid FromMaterialId, Guid ToMaterialId, decimal Ratio, IReadOnlyList<Guid>? RecipeIds = null, IReadOnlyList<Guid>? PrepItemIds = null);

public sealed record SwapItem(Guid Id, string Name, string? Code, bool IsPrepItem, UnitOfMeasure Unit, string PurchaseUnit, decimal PurchaseUnitSize, decimal? CostPerUnit);

// A recipe or prep item with the old item on it, as the swap would leave it. Quantities in each
// item's own unit, as the recipe writes them (a dish's for all its portions, a prep item's for a
// batch); Merged: the new item was on it already, and takes the quantity added to its own. Cost:
// a dish's a portion, a prep item's a batch. Blocked: why it cannot be swapped now (a request
// waiting for a manager, a prep item that would be made from itself, or one for a manager).
public sealed record SwapPreviewRow(
    WhereUsedKind Kind,
    Guid Id,
    string Name,
    string? ItemCode,
    string? Category,
    int? Portions,
    decimal? BatchQuantity,
    decimal OldQuantity,
    decimal NewQuantity,
    bool Merged,
    decimal? OldCost,
    decimal? NewCost,
    decimal? CostDelta,
    decimal? Price,
    decimal? OldFoodCostPercent,
    decimal? NewFoodCostPercent,
    bool Selected,
    string? Blocked,
    // A prep item made already: what is on the shelf was made with the old item.
    bool FromNextBatch);

// A dish without the old item on it, whose cost moves through a prep item chosen (Via).
public sealed record SwapKnockOn(
    WhereUsedKind Kind, Guid Id, string Name, string? ItemCode, IReadOnlyList<string> Via, decimal? OldCost, decimal? NewCost, decimal? CostDelta,
    decimal? Price, decimal? OldFoodCostPercent, decimal? NewFoodCostPercent, bool FromNextBatch);

public sealed record SwapPreview(
    SwapItem From,
    SwapItem To,
    decimal Ratio,
    bool UnitsDiffer,
    IReadOnlyList<SwapPreviewRow> Rows,
    IReadOnlyList<SwapKnockOn> KnockOn);

public sealed partial class CostingService
{
    // Every recipe and prep item not deleted that uses the material or prep item, on it or inside
    // its prep items, at any depth: dishes first, then prep items, each by name.
    public async Task<WhereUsedReport> GetWhereUsedAsync(Guid materialId, CancellationToken cancellationToken)
    {
        var data = await LoadMenuAsync(cancellationToken);
        var item = data.Materials.GetValueOrDefault(materialId) ?? throw new NotFoundException(nameof(RawMaterial), materialId);
        var batches = (await db.PrepRecipes.AsNoTracking().Include(r => r.Ingredients).ToListAsync(cancellationToken)).ToDictionary(r => r.PrepItemId);
        var inside = new PrepContents(batches, materialId);
        var perUnit = data.Costs.Of(materialId).PerUnit;

        var rows = new List<WhereUsedRow>();
        foreach (var recipe in data.AllRecipes.Where(r => !r.IsDeleted))
        {
            var (direct, through, via) = Uses(recipe.Ingredients.Select(i => (i.RawMaterialId, i.Quantity, i.AsPurchasedQuantity)), materialId, inside, data.Materials);
            if (direct is null && through is null)
                continue;
            var card = Card(recipe, data);
            var portions = recipe.Portions;
            var directAp = recipe.Ingredients.Where(i => i.RawMaterialId == materialId).Sum(i => i.AsPurchasedQuantity);
            rows.Add(new WhereUsedRow(
                recipe.IsLinked ? WhereUsedKind.Dish : WhereUsedKind.OffMenuRecipe, recipe.Id, card.Recipe, card.ItemCode == "" ? null : card.ItemCode,
                card.Category, portions, null, null, card.MenuPrice, card.CostPerPortion, card.FoodCostPercentActual,
                direct / portions, through / portions, via, ItemCost((directAp + (through ?? 0)) / portions, perUnit)));
        }

        foreach (var (id, batch) in batches)
        {
            if (data.Materials.GetValueOrDefault(id) is not { IsArchived: false } prep || id == materialId)
                continue;
            var (direct, through, via) = Uses(batch.Ingredients.Select(i => (i.RawMaterialId, i.Quantity, i.AsPurchasedQuantity)), materialId, inside, data.Materials);
            if (direct is null && through is null)
                continue;
            var directAp = batch.Ingredients.Where(i => i.RawMaterialId == materialId).Sum(i => i.AsPurchasedQuantity);
            var category = batch.RecipeCategoryId is { } c ? data.Categories.GetValueOrDefault(c)?.Name : null;
            rows.Add(new WhereUsedRow(
                WhereUsedKind.PrepItem, id, prep.Name, prep.Code, category, null, batch.BatchQuantity, prep.Unit, null,
                Money(data.Costs.Batch(batch).Cost), null, direct, through, via, ItemCost(directAp + (through ?? 0), perUnit)));
        }

        var ordered = rows.OrderBy(r => r.Kind == WhereUsedKind.PrepItem).ThenBy(r => r.Name, StringComparer.CurrentCultureIgnoreCase).ToList();
        return new WhereUsedReport(item.Id, item.Name, item.Code, item.IsPrepItem, item.Unit, item.PurchaseUnit, item.PurchaseUnitSize,
            ordered.Count(r => r.Kind != WhereUsedKind.PrepItem), ordered.Count(r => r.Kind == WhereUsedKind.PrepItem), ordered);
    }

    // The bulk swap's preview: every recipe and prep item with the old item on it, as the swap
    // would leave it (each one's own change, with the prep items chosen swapped too), and the dishes
    // whose cost moves only through those prep items. In memory: nothing is saved.
    public async Task<SwapPreview> PreviewSwapAsync(SwapPreviewRequest request, bool canApprove, CancellationToken cancellationToken)
    {
        IngredientSwap.CheckRatio(request.Ratio);
        if (request.FromMaterialId == request.ToMaterialId)
            throw new DomainException("Choose another item to swap in. · اختر خامة مختلفة.");
        var data = await LoadMenuAsync(cancellationToken);
        var from = data.Materials.GetValueOrDefault(request.FromMaterialId) ?? throw new NotFoundException(nameof(RawMaterial), request.FromMaterialId);
        var to = data.Materials.GetValueOrDefault(request.ToMaterialId) ?? throw new NotFoundException(nameof(RawMaterial), request.ToMaterialId);
        if (to.IsArchived)
            throw new DomainException($"{to.Name} has been deleted from the raw materials: it cannot go on a recipe.");

        // The prep recipes twice over: as they are, and as the swap leaves them.
        async Task<Dictionary<Guid, PrepRecipe>> Batches() =>
            (await db.PrepRecipes.AsNoTracking().Include(r => r.Ingredients).ToListAsync(cancellationToken)).ToDictionary(r => r.PrepItemId);
        var actualBatches = await Batches();
        var swappedBatches = await Batches();
        var pending = (await db.ApprovalRequests.AsNoTracking().Where(r => r.Status == ApprovalStatus.Pending).Select(r => new { r.RecordId, r.RequestedBy })
                .ToListAsync(cancellationToken))
            .GroupBy(r => r.RecordId).ToDictionary(g => g.Key, g => g.First().RequestedBy);
        var inside = to.IsPrepItem ? BulkSwapRules.MadeFrom(to.Id, actualBatches) : new HashSet<Guid>();

        var prepRows = actualBatches.Values
            .Where(b => b.Ingredients.Any(i => i.RawMaterialId == from.Id) && data.Materials.GetValueOrDefault(b.PrepItemId) is { IsArchived: false })
            .Select(b =>
            {
                var item = data.Materials[b.PrepItemId];
                var blocked = pending.TryGetValue(b.PrepItemId, out var by) ? $"{by} has asked a manager about it · بانتظار موافقة"
                    : inside.Contains(b.PrepItemId) ? BulkSwapRules.MadeFromItself(item.Name, to.Name)
                    : !canApprove ? BulkSwapRules.PrepItemsManagers
                    : null;
                return (Batch: b, Item: item, Blocked: blocked);
            })
            .ToList();
        var chosenPrep = prepRows.Where(r => r.Blocked is null && (request.PrepItemIds is null || request.PrepItemIds.Contains(r.Batch.PrepItemId)))
            .Select(r => r.Batch.PrepItemId).ToHashSet();
        foreach (var id in chosenPrep)
            swappedBatches[id].SwapIngredient(from, to, request.Ratio);

        var actualCosts = new RecipeCosts(data.Materials, actualBatches.Values);
        var swappedCosts = new RecipeCosts(data.Materials, swappedBatches.Values, actualCosts);
        var swappedData = data with { Costs = swappedCosts };
        // Made already: its cost moves with its next batches.
        bool Made(Guid prepItemId) => data.Materials.GetValueOrDefault(prepItemId)?.AverageCost > 0;
        var changedPrep = chosenPrep.ToHashSet();

        var rows = new List<SwapPreviewRow>();
        var direct = data.AllRecipes.Where(r => !r.IsDeleted && r.Ingredients.Any(i => i.RawMaterialId == from.Id)).ToList();
        var directIds = direct.Select(r => r.Id).ToList();
        var copies = (await db.Recipes.AsNoTracking().Include(r => r.Ingredients).Where(r => directIds.Contains(r.Id)).ToListAsync(cancellationToken))
            .ToDictionary(r => r.Id);
        foreach (var recipe in direct)
        {
            var line = recipe.Ingredients.Single(i => i.RawMaterialId == from.Id);
            var copy = copies[recipe.Id];
            var merged = copy.Ingredients.Any(i => i.RawMaterialId == to.Id);
            var newQuantity = copy.SwapIngredient(from, to, request.Ratio)!.Value;

            var (before, after) = (Card(recipe, data), Card(copy, swappedData));
            var blocked = pending.TryGetValue(recipe.Id, out var by) ? $"{by} has asked a manager about it · بانتظار موافقة" : null;
            var selected = blocked is null && (request.RecipeIds is null || request.RecipeIds.Contains(recipe.Id));
            rows.Add(new SwapPreviewRow(
                recipe.IsLinked ? WhereUsedKind.Dish : WhereUsedKind.OffMenuRecipe, recipe.Id, before.Recipe, before.ItemCode == "" ? null : before.ItemCode,
                before.Category, recipe.Portions, null, line.Quantity, newQuantity, merged, before.CostPerPortion, after.CostPerPortion,
                Money(after.CostPerPortion - before.CostPerPortion), before.MenuPrice, before.FoodCostPercentActual, after.FoodCostPercentActual,
                selected, blocked, Through(recipe.Ingredients.Select(i => i.RawMaterialId), changedPrep, actualBatches).Any(Made)));
        }

        foreach (var (batch, item, blocked) in prepRows)
        {
            var line = batch.Ingredients.Single(i => i.RawMaterialId == from.Id);
            var merged = batch.Ingredients.Any(i => i.RawMaterialId == to.Id);
            var swapped = chosenPrep.Contains(batch.PrepItemId) ? swappedBatches[batch.PrepItemId] : Swapped(batch.PrepItemId);
            var newQuantity = IngredientSwap.Quantity(line.Quantity, request.Ratio);
            var (before, after) = (Money(actualCosts.Batch(batch).Cost), Money(swappedCosts.Batch(swapped).Cost));
            var category = batch.RecipeCategoryId is { } c ? data.Categories.GetValueOrDefault(c)?.Name : null;
            rows.Add(new SwapPreviewRow(
                WhereUsedKind.PrepItem, batch.PrepItemId, item.Name, item.Code, category, null, batch.BatchQuantity, line.Quantity, newQuantity, merged,
                before, after, Money(after - before), null, null, null, chosenPrep.Contains(batch.PrepItemId), blocked, Made(batch.PrepItemId)));
        }

        // The dishes not swapped themselves whose cost moves through a prep item chosen.
        var swappedDishes = rows.Where(r => r.Kind != WhereUsedKind.PrepItem && r.Selected).Select(r => r.Id).ToHashSet();
        var knockOn = new List<SwapKnockOn>();
        if (changedPrep.Count > 0)
        {
            foreach (var recipe in data.AllRecipes.Where(r => !r.IsDeleted && !swappedDishes.Contains(r.Id)))
            {
                var via = Through(recipe.Ingredients.Select(i => i.RawMaterialId), changedPrep, actualBatches).ToList();
                if (via.Count == 0)
                    continue;
                var (before, after) = (Card(recipe, data), Card(recipe, swappedData));
                knockOn.Add(new SwapKnockOn(
                    recipe.IsLinked ? WhereUsedKind.Dish : WhereUsedKind.OffMenuRecipe, recipe.Id, before.Recipe, before.ItemCode == "" ? null : before.ItemCode,
                    via.Select(id => data.Materials[id].Name).OrderBy(n => n).ToList(), before.CostPerPortion, after.CostPerPortion,
                    Money(after.CostPerPortion - before.CostPerPortion), before.MenuPrice, before.FoodCostPercentActual, after.FoodCostPercentActual,
                    via.Any(Made)));
            }
        }

        return new SwapPreview(
            Item(from, actualCosts), Item(to, actualCosts), request.Ratio, from.Unit != to.Unit,
            rows.OrderBy(r => r.Kind == WhereUsedKind.PrepItem).ThenBy(r => r.Name, StringComparer.CurrentCultureIgnoreCase).ToList(),
            knockOn.OrderBy(k => k.Name, StringComparer.CurrentCultureIgnoreCase).ToList());

        // A prep item not chosen, as it would be swapped on its own: for its row.
        PrepRecipe Swapped(Guid prepItemId)
        {
            var copy = new PrepRecipe(data.Materials[prepItemId], actualBatches[prepItemId].BatchQuantity);
            copy.Replace(actualBatches[prepItemId].Ingredients.Select(i => (data.Materials[i.RawMaterialId], i.Quantity, (decimal?)i.YieldPercent)).ToList());
            copy.SwapIngredient(from, to, request.Ratio);
            return copy;
        }
    }

    private static SwapItem Item(RawMaterial m, RecipeCosts costs) =>
        new(m.Id, m.Name, m.Code, m.IsPrepItem, m.Unit, m.PurchaseUnit, m.PurchaseUnitSize, costs.Of(m.Id).PerUnit);

    private static decimal? ItemCost(decimal quantity, decimal? perUnit) => perUnit is { } p ? Money(quantity * p) : null;

    // The prep items among `ingredients`, at any depth, that are in `changed`.
    private static IEnumerable<Guid> Through(IEnumerable<Guid> ingredients, IReadOnlySet<Guid> changed, IReadOnlyDictionary<Guid, PrepRecipe> batches)
    {
        var found = new HashSet<Guid>();
        foreach (var ingredient in ingredients)
            foreach (var id in BulkSwapRules.MadeFrom(ingredient, batches))
                if (changed.Contains(id))
                    found.Add(id);
        return found;
    }

    // A recipe's or batch's use of the item: on it (as written), inside its prep items (as
    // purchased), and the prep items it is inside.
    private static (decimal? Direct, decimal? Through, IReadOnlyList<string> Via) Uses(
        IEnumerable<(Guid Material, decimal Quantity, decimal AsPurchased)> lines, Guid itemId, PrepContents inside, IReadOnlyDictionary<Guid, RawMaterial> materials)
    {
        decimal? direct = null, through = null;
        var via = new List<string>();
        foreach (var (material, quantity, asPurchased) in lines)
        {
            if (material == itemId)
            {
                direct = (direct ?? 0) + quantity;
                continue;
            }
            var perUnit = inside.PerUnit(material);
            if (perUnit is not > 0)
                continue;
            through = (through ?? 0) + asPurchased * perUnit.Value;
            via.Add(materials.GetValueOrDefault(material)?.Name ?? "A prep item");
        }
        return (direct, through is { } t ? Math.Round(t, 3) : null, via.Distinct().OrderBy(n => n).ToList());
    }

    // How much of one item a unit of each prep item takes, as purchased, through its batch and the
    // prep items inside it.
    private sealed class PrepContents(IReadOnlyDictionary<Guid, PrepRecipe> batches, Guid itemId)
    {
        private readonly Dictionary<Guid, decimal?> _known = [];
        private readonly HashSet<Guid> _working = [];

        public decimal? PerUnit(Guid prepItemId)
        {
            if (_known.TryGetValue(prepItemId, out var known))
                return known;
            if (batches.GetValueOrDefault(prepItemId) is not { BatchQuantity: > 0 } batch || !_working.Add(prepItemId))
                return null;
            decimal? total = null;
            foreach (var ingredient in batch.Ingredients)
            {
                var each = ingredient.RawMaterialId == itemId ? 1 : PerUnit(ingredient.RawMaterialId);
                if (each is > 0)
                    total = (total ?? 0) + ingredient.AsPurchasedQuantity * each.Value / batch.BatchQuantity;
            }
            _working.Remove(prepItemId);
            return _known[prepItemId] = total;
        }
    }
}
