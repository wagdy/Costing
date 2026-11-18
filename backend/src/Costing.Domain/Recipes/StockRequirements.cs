namespace Costing.Domain.Recipes;

// One sold order line, as inventory sees it: catalog ids and a quantity. Nothing about the
// order, its price or its customer. The POS turns its shared OrderItem into this before
// handing it over, which is the whole interface between the two modules.
public sealed record SoldItem(int MenuItemId, int? VariantId, IReadOnlyList<int> AddOnIds, int Quantity);

// A dish in a combo sold under a menu number (ComboOffer): its recipe, by id, and how many of it one
// combo takes.
public sealed record ComboPart(Guid RecipeId, int Quantity);

public static class StockRequirements
{
    // What `item` draws from stock, summed per raw material:
    //   the variant's own recipe if it has one, otherwise the menu item's base recipe;
    //   plus each add-on's recipe, per unit, the same way the add-on is priced per unit;
    //   all multiplied by the quantity.
    // The variant recipe replaces the base rather than adding to it: a 1 kg tray is not a
    // base portion plus a tray.
    //
    // A combo (combos, by the number it is sold under) has no recipe of its own: each dish in it
    // takes its recipe's stock for the quantity sold × how many of it one combo takes, and through
    // its prep items the stock they were made from, as a sale of that dish would. `recipes` holds
    // the combos' recipes too, by id (RecipeIdsFor). A deleted recipe takes nothing.
    // The station that made a sold item: its size's recipe's, or the item's (none for a combo, whose
    // dishes are made at their own stations).
    public static Guid? StationOf(SoldItem item, IReadOnlyCollection<Recipe> recipes)
    {
        var live = recipes.Where(r => !r.IsDeleted && r.Target is not null).ToList();
        var main = (item.VariantId is { } variantId ? live.FirstOrDefault(r => r.Target == RecipeTarget.ForVariant(item.MenuItemId, variantId)) : null)
            ?? live.FirstOrDefault(r => r.Target == RecipeTarget.ForMenuItem(item.MenuItemId));
        return main?.KitchenStationId;
    }

    public static IReadOnlyDictionary<Guid, decimal> For(
        SoldItem item, IReadOnlyCollection<Recipe> recipes, IReadOnlyDictionary<int, IReadOnlyList<ComboPart>>? combos = null)
    {
        // Only the active recipes on the menu take stock: one per target.
        var byTarget = recipes.Where(r => !r.IsDeleted && r.Target is not null)
            .GroupBy(r => r.Target!.Value).ToDictionary(g => g.Key, g => g.First());
        var totals = new Dictionary<Guid, decimal>();

        if (combos?.GetValueOrDefault(item.MenuItemId) is { } parts)
        {
            var byId = recipes.GroupBy(r => r.Id).ToDictionary(g => g.Key, g => g.First());
            foreach (var part in parts)
                Add(byId.GetValueOrDefault(part.RecipeId) is { IsDeleted: false } dish ? dish : null, item.Quantity * part.Quantity);
        }
        else
        {
            var main = item.VariantId is { } variantId && byTarget.TryGetValue(RecipeTarget.ForVariant(item.MenuItemId, variantId), out var forVariant)
                ? forVariant
                : byTarget.GetValueOrDefault(RecipeTarget.ForMenuItem(item.MenuItemId));
            Add(main, item.Quantity);
        }
        foreach (var addOnId in item.AddOnIds)
            Add(byTarget.GetValueOrDefault(RecipeTarget.ForAddOn(addOnId)), item.Quantity);

        return totals;

        void Add(Recipe? recipe, int units)
        {
            if (recipe is null)
                return;

            foreach (var (rawMaterialId, quantity) in recipe.RequirementsFor(units))
                totals[rawMaterialId] = totals.GetValueOrDefault(rawMaterialId) + quantity;
        }
    }

    // The recipes the combos among the items are made of, by id, to load with the rest.
    public static IReadOnlyCollection<Guid> RecipeIdsFor(IEnumerable<SoldItem> items, IReadOnlyDictionary<int, IReadOnlyList<ComboPart>> combos) =>
        items.SelectMany(i => combos.GetValueOrDefault(i.MenuItemId) ?? []).Select(p => p.RecipeId).ToHashSet();

    // Every recipe the given items could need, so they can be loaded in one query.
    public static IReadOnlyCollection<RecipeTarget> TargetsFor(IEnumerable<SoldItem> items) =>
        items
            .SelectMany(i => new[] { RecipeTarget.ForMenuItem(i.MenuItemId) }
                .Concat(i.VariantId is { } v ? [RecipeTarget.ForVariant(i.MenuItemId, v)] : [])
                .Concat(i.AddOnIds.Select(RecipeTarget.ForAddOn)))
            .ToHashSet();
}
