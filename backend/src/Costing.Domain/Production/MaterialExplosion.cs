namespace Costing.Domain.Production;

// The bill of materials: what a quantity of any material comes to in the materials that are bought.
// A bought material is itself. A prep item is its batch recipe scaled to the quantity, each
// ingredient as purchased (its yield allowed for), a prep item inside it through its own recipe, and
// so on down. A prep item with no batch recipe, or one made with itself, stays as itself: there is
// nothing to break it into.
public sealed class MaterialExplosion
{
    private readonly IReadOnlyDictionary<Guid, PrepRecipe> _recipes;
    private readonly Dictionary<Guid, IReadOnlyDictionary<Guid, decimal>> _perUnit = [];
    private readonly HashSet<Guid> _working = [];

    public MaterialExplosion(IEnumerable<PrepRecipe> recipes)
    {
        _recipes = recipes.Where(r => r.BatchQuantity > 0 && r.Ingredients.Count > 0).ToDictionary(r => r.PrepItemId);
    }

    // A prep item the kitchen makes by a recipe: one that breaks into what it is made of.
    public bool IsMade(Guid materialId) => _recipes.ContainsKey(materialId);

    // What one unit (a gram, millilitre or piece) of the material takes from bought materials.
    public IReadOnlyDictionary<Guid, decimal> PerUnit(Guid materialId)
    {
        if (_perUnit.TryGetValue(materialId, out var known))
            return known;
        // Made with itself somewhere down: it stays as itself there, and only there.
        if (!_working.Add(materialId))
            return new Dictionary<Guid, decimal> { [materialId] = 1 };
        var totals = new Dictionary<Guid, decimal>();
        if (_recipes.TryGetValue(materialId, out var recipe))
        {
            foreach (var ingredient in recipe.Ingredients)
                foreach (var (id, quantity) in PerUnit(ingredient.RawMaterialId))
                    totals[id] = totals.GetValueOrDefault(id) + quantity * ingredient.AsPurchasedQuantity / recipe.BatchQuantity;
        }
        else
            totals[materialId] = 1;
        _working.Remove(materialId);
        _perUnit[materialId] = totals;
        return totals;
    }

    // Each of the quantities in bought materials, summed.
    public Dictionary<Guid, decimal> Explode(IEnumerable<KeyValuePair<Guid, decimal>> quantities)
    {
        var totals = new Dictionary<Guid, decimal>();
        foreach (var (materialId, quantity) in quantities)
            foreach (var (id, perUnit) in PerUnit(materialId))
                totals[id] = totals.GetValueOrDefault(id) + perUnit * quantity;
        return totals;
    }

    // What making `quantity` of a prep item takes, one level down: its batch's ingredients scaled.
    public IEnumerable<(Guid RawMaterialId, decimal Quantity)> Ingredients(Guid prepItemId, decimal quantity) =>
        _recipes.TryGetValue(prepItemId, out var recipe)
            ? recipe.Ingredients.Select(i => (i.RawMaterialId, i.AsPurchasedQuantity * quantity / recipe.BatchQuantity))
            : [];

    // The prep items made by a recipe, each before any it is made with: the order a requirement
    // passes down through them, so each is netted against its stock before its ingredients are.
    public IReadOnlyList<Guid> TopDown()
    {
        var visited = new HashSet<Guid>();
        var order = new List<Guid>();
        void Visit(Guid id)
        {
            if (!visited.Add(id))
                return;
            foreach (var ingredient in _recipes[id].Ingredients.Where(i => _recipes.ContainsKey(i.RawMaterialId)))
                Visit(ingredient.RawMaterialId);
            order.Add(id);
        }

        foreach (var id in _recipes.Keys)
            Visit(id);
        order.Reverse();
        return order;
    }
}
