using Costing.Domain.RawMaterials;

namespace Costing.Domain.Production;

// What a gram, millilitre or piece of a material costs when a recipe is costed. PerUnit: none when
// it has no price. ByRecipe: a prep item costed by its own batch recipe, not yet by its batches.
// Missing: what has no price under it, by name ("White sauce: Cream" for one inside a prep item).
public sealed record RecipeCost(decimal? PerUnit, bool ByRecipe, IReadOnlyList<string> Missing)
{
    public static readonly RecipeCost None = new(null, false, []);
}

// The cost a recipe is worked out from, for each material: its average cost, what was paid for it,
// or for a prep item what its batches cost. A prep item never made yet has no average (or one of
// nothing): it is costed by its own batch recipe today instead, each of its ingredients priced the
// same way, so a dish made with it is costed before the kitchen makes the first batch. Once a batch
// is made, what the batches cost takes over.
//
// One of its ingredients with no price leaves its cost short of that one, which is named; with no
// ingredient priced at all, it has no price. A recipe made with itself (never saved; guarded
// against all the same) has none either. Stock itself is never valued this way: what is taken off
// the shelf is at what was paid, and a production order's cost at what went into it.
public sealed class RecipeCosts
{
    private readonly IReadOnlyDictionary<Guid, RawMaterial> _materials;
    private readonly IReadOnlyDictionary<Guid, PrepRecipe> _recipes;
    private readonly Dictionary<Guid, RecipeCost> _known = [];
    private readonly HashSet<Guid> _working = [];

    public RecipeCosts(IReadOnlyDictionary<Guid, RawMaterial> materials, IEnumerable<PrepRecipe> recipes)
    {
        _materials = materials;
        _recipes = recipes.ToDictionary(r => r.PrepItemId);
    }

    public RecipeCost Of(Guid materialId)
    {
        if (_known.TryGetValue(materialId, out var known))
            return known;
        if (!_materials.TryGetValue(materialId, out var material))
            return RecipeCost.None;

        RecipeCost cost;
        if (!material.IsPrepItem || material.AverageCost > 0)
            cost = new RecipeCost(material.AverageCost, false, material.AverageCost is null ? [material.Name] : []);
        else if (_recipes.GetValueOrDefault(material.Id) is not { BatchQuantity: > 0, Ingredients.Count: > 0 } recipe || !_working.Add(material.Id))
            cost = new RecipeCost(material.AverageCost, false, material.AverageCost is null ? [material.Name] : []);
        else
        {
            var (batch, priced, missing) = Batch(recipe);
            _working.Remove(material.Id);
            cost = priced
                ? new RecipeCost(batch / recipe.BatchQuantity, true, missing.Select(name => $"{material.Name}: {name}").ToList())
                : new RecipeCost(null, false, [material.Name]);
        }

        _known[materialId] = cost;
        return cost;
    }

    // One batch of a prep item's recipe at today's costs: what is priced, whether anything is, and
    // what has no price.
    public (decimal Cost, bool Priced, IReadOnlyList<string> Missing) Batch(PrepRecipe recipe)
    {
        var cost = 0m;
        var priced = false;
        var missing = new List<string>();
        foreach (var ingredient in recipe.Ingredients)
        {
            var each = Of(ingredient.RawMaterialId);
            missing.AddRange(each.Missing);
            if (each.PerUnit is { } perUnit)
            {
                cost += ingredient.AsPurchasedQuantity * perUnit;
                priced = true;
            }
        }

        return (cost, priced, missing.Distinct().ToList());
    }
}
