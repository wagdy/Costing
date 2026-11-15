using Microsoft.EntityFrameworkCore;
using Costing.Domain.Production;
using Costing.Domain.Recipes;

namespace Costing.Infrastructure.Reports;

// A dish as the fully burdened plate cost starts from: what one plate's ingredients cost now (its
// recipe card's cost per portion, prep items by RecipeCosts, shared costs included), what it sells
// for before VAT, how many plates the period sold, and the kitchen's weighted minutes for a plate.
//
// Weighted minutes: the dish's own prep time × its complexity, and its share of each prep item it
// is made with: a batch's prep time × its complexity, over what the batch makes, for what one plate
// takes of it, as purchased. A pizza with 250 g of a 10 kg dough batch that takes 60 minutes
// carries 1.5 of them.
internal sealed record PlateBase(
    string ItemCode,
    int? MenuItemId,
    int? VariantId,
    Guid? RecipeId,
    string Dish,
    string? DishAr,
    string? Category,
    // On the menu now; off it: an off-menu (R&D) recipe at its planned price, or a dish sold in the
    // period that has left the menu since.
    bool OnMenu,
    decimal QuantitySold,
    decimal NetSales,
    // The menu's price, or the planned price off it; sold without a price, its average net price.
    decimal? Price,
    decimal? FoodCost,
    bool HasRecipe,
    bool MissingPrices,
    decimal? PrepTimeMinutes,
    decimal ComplexityWeight,
    decimal WeightedMinutes,
    bool PrepTimeAssumed);

public sealed partial class CostingService
{
    internal async Task<IReadOnlyList<PlateBase>> PlateBasesAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken)
    {
        var data = await LoadMenuAsync(cancellationToken);
        var prepRecipes = await db.PrepRecipes.AsNoTracking().Include(r => r.Ingredients).ToDictionaryAsync(r => r.PrepItemId, cancellationToken);
        var minutesPerUnit = new PrepMinutes(prepRecipes);

        var sold = (await SalesAsync(from, to, cancellationToken))
            .GroupBy(s => (s.MenuItemId, s.VariantId))
            .ToDictionary(g => g.Key, g => (
                Any: g.First(), Quantity: (decimal)g.Sum(s => s.Quantity), NetSales: g.Sum(s => s.NetSales),
                Ingredients: g.Sum(s => s.IngredientCost), HasRecipe: g.Any(s => s.HasRecipe), Missing: g.Any(s => s.MissingPrice)));

        decimal Weighted(Recipe? recipe) =>
            recipe is null
                ? PlateActivity.Default.WeightedMinutes
                : recipe.Activity.WeightedMinutes + recipe.Ingredients.Sum(i => i.AsPurchasedQuantity / recipe.Portions * minutesPerUnit.Of(i.RawMaterialId));

        var rows = new List<PlateBase>();
        var seen = new HashSet<(int, int?)>();
        foreach (var target in data.Targets.Where(t => t.Kind == RecipeTargetKind.MenuItem))
        {
            var key = (target.CatalogItemId, target.VariantId);
            var hasSizes = target.VariantId is null && data.Targets.Any(t => t.Kind == RecipeTargetKind.MenuItem && t.CatalogItemId == target.CatalogItemId && t.VariantId is not null);
            var sale = sold.GetValueOrDefault(key);
            // A dish sold by its sizes: each size is a plate, the dish itself never is.
            if (hasSizes && sale.Quantity == 0)
                continue;
            seen.Add(key);

            var own = data.Recipes.GetValueOrDefault(new RecipeTarget(target.Kind, target.CatalogItemId, target.VariantId));
            var recipe = own ?? (target.VariantId is not null ? data.Recipes.GetValueOrDefault(RecipeTarget.ForMenuItem(target.CatalogItemId)) : null);
            var card = CardOf(target);
            var price = target.PricedByAddOns ? null : target.Price;
            if (price is null && sale.Quantity > 0 && sale.NetSales > 0)
                price = sale.NetSales / sale.Quantity;
            rows.Add(new PlateBase(
                card.ItemCode, target.CatalogItemId, target.VariantId, recipe?.Id, target.Name, target.NameAr, target.Category, true,
                sale.Quantity, sale.NetSales, price, card.HasRecipe ? card.CostPerPortion : null, card.HasRecipe, card.MissingPrices.Count > 0,
                recipe?.PrepTimeMinutes, recipe?.ComplexityWeight ?? PlateActivity.DefaultComplexityWeight, Weighted(recipe),
                recipe is null || recipe.PrepTimeMinutes is null));
        }

        // Sold in the period and gone from the menu since: its plates were made and served all the
        // same, at what their ingredients cost when sold.
        foreach (var ((menuItemId, variantId), sale) in sold.Where(s => !seen.Contains(s.Key)))
        {
            var any = sale.Any;
            rows.Add(new PlateBase(
                ItemCode(menuItemId, variantId), menuItemId, variantId, null, any.Name, any.NameAr, any.Category.Length > 0 ? any.Category : null, false,
                sale.Quantity, sale.NetSales, sale.NetSales > 0 ? sale.NetSales / sale.Quantity : null,
                sale.HasRecipe ? sale.Ingredients / sale.Quantity : null, sale.HasRecipe, sale.Missing,
                null, PlateActivity.DefaultComplexityWeight, PlateActivity.Default.WeightedMinutes, true));
        }

        // Off the menu: a dish being planned, at its planned price, so its burdened cost is known
        // before it goes on the menu.
        foreach (var recipe in data.AllRecipes.Where(r => !r.IsDeleted && !r.IsLinked))
        {
            var card = Card(recipe, data);
            rows.Add(new PlateBase(
                "", null, null, recipe.Id, card.Recipe, null, card.Category, false, 0, 0, recipe.PlannedPrice, card.CostPerPortion, true,
                card.MissingPrices.Count > 0, recipe.PrepTimeMinutes, recipe.ComplexityWeight, Weighted(recipe), recipe.PrepTimeMinutes is null));
        }
        return rows;

        RecipeCostCard CardOf(Target target)
        {
            var own = data.Recipes.GetValueOrDefault(new RecipeTarget(target.Kind, target.CatalogItemId, target.VariantId));
            var recipe = own ?? (target.VariantId is not null ? data.Recipes.GetValueOrDefault(RecipeTarget.ForMenuItem(target.CatalogItemId)) : null);
            return CostingService.Card(target, recipe, own is null && recipe is not null, data);
        }
    }

    // The kitchen's weighted minutes in one gram, millilitre or piece of a prep item: its batch's
    // minutes, and those of the prep items it is made with, over what the batch makes. A bought
    // material takes none; a prep item made with itself (never saved) stops there.
    private sealed class PrepMinutes(IReadOnlyDictionary<Guid, PrepRecipe> recipes)
    {
        private readonly Dictionary<Guid, decimal> _known = [];
        private readonly HashSet<Guid> _working = [];

        public decimal Of(Guid materialId)
        {
            if (_known.TryGetValue(materialId, out var known))
                return known;
            if (!recipes.TryGetValue(materialId, out var recipe) || recipe.BatchQuantity <= 0 || !_working.Add(materialId))
                return 0;
            var minutes = (recipe.Activity.WeightedMinutes + recipe.Ingredients.Sum(i => i.AsPurchasedQuantity * Of(i.RawMaterialId))) / recipe.BatchQuantity;
            _working.Remove(materialId);
            return _known[materialId] = minutes;
        }
    }
}
