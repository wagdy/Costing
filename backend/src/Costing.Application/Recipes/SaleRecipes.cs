using Costing.Domain.Menu;
using Costing.Domain.Recipes;

namespace Costing.Application.Recipes;

internal static class SaleRecipes
{
    // The recipes sold items could need, in one go: those their menu numbers sell by, the dishes of
    // the combos among them, and what each combo is made of (StockRequirements.For).
    public static async Task<(IReadOnlyList<Recipe> Recipes, IReadOnlyDictionary<int, IReadOnlyList<ComboPart>> Combos)> ForSaleAsync(
        this IRecipeRepository recipes, IComboOfferRepository combos, IReadOnlyCollection<SoldItem> items, CancellationToken cancellationToken)
    {
        var parts = await combos.GetPartsAsync(items.Select(i => i.MenuItemId).Distinct().ToList(), cancellationToken);
        var byTarget = await recipes.GetByTargetsAsync(StockRequirements.TargetsFor(items), cancellationToken);
        var ids = StockRequirements.RecipeIdsFor(items, parts);
        var byId = ids.Count == 0 ? [] : await recipes.GetByIdsAsync(ids, cancellationToken);
        return (byTarget.Concat(byId).ToList(), parts);
    }
}
