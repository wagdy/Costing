using Microsoft.EntityFrameworkCore;
using Costing.Domain.Menu;
using Costing.Domain.Recipes;

namespace Costing.Infrastructure.Reports;

// A dish in a combo, as its recipe costs it today: a portion's cost and its own price (the menu's, or
// a planned price off the menu), and the combo's quantity of each.
public sealed record ComboDishDto(
    Guid RecipeId, string Dish, string? ItemCode, int Quantity, decimal CostPerPortion, decimal LineCost, decimal? Price, decimal? LinePrice,
    bool IsDeleted, IReadOnlyList<string> MissingPrices);

// A combo offer and its roll-up (عرض مجمع):
//
//   Total combo cost        = Σ each dish's cost a portion × its quantity
//   Original separate price = Σ each dish's own price × its quantity (none when a dish has no price)
//   Combo food cost %       = total combo cost ÷ the combo's selling price × 100
//   Savings                 = original separate price − the combo's price
public sealed record ComboOfferDto(
    Guid Id,
    int Code,
    string Name,
    string? NameAr,
    decimal SellingPrice,
    bool IsActive,
    bool IsDeleted,
    IReadOnlyList<ComboDishDto> Items,
    decimal TotalCost,
    decimal? OriginalPrice,
    decimal? Savings,
    decimal? SavingsPercent,
    decimal? FoodCostPercent,
    decimal FoodCostTargetPercent,
    CostStatus Status,
    IReadOnlyList<string> MissingPrices);

// NextCode: the menu number a new combo starts with, after the highest on the menu.
public sealed record ComboOffersReport(int NextCode, decimal FoodCostTargetPercent, IReadOnlyList<ComboOfferDto> Combos);

public sealed partial class CostingService
{
    public const int FirstMenuNumber = 1001;

    // Every combo, by its code; the deleted ones only when asked for.
    public async Task<ComboOffersReport> GetComboOffersAsync(bool includeDeleted, CancellationToken cancellationToken)
    {
        var data = await LoadMenuAsync(cancellationToken);
        var combos = await db.ComboOffers.AsNoTracking()
            .Where(c => includeDeleted || c.DeletedAtUtc == null)
            .OrderBy(c => c.Code)
            .ToListAsync(cancellationToken);
        var highest = await db.MenuItems.AsNoTracking().IgnoreQueryFilters().MaxAsync(m => (int?)m.Id, cancellationToken) ?? 0;
        return new ComboOffersReport(Math.Max(FirstMenuNumber, highest + 1), data.FoodCostTarget, combos.Select(c => Combo(c, data)).ToList());
    }

    private static ComboOfferDto Combo(ComboOffer combo, MenuData data)
    {
        var (dishes, total, original, missing) = RollUp(combo, data);
        var foodCost = combo.SellingPrice > 0 ? Percent(total / combo.SellingPrice) : (decimal?)null;
        decimal? savings = original is { } o ? Money(o - combo.SellingPrice) : null;
        return new ComboOfferDto(
            combo.Id, combo.Code, combo.Name, combo.NameAr, combo.SellingPrice, combo.IsActive, combo.IsDeleted, dishes, total, original, savings,
            original is > 0 ? Percent(savings!.Value / original.Value) : null, foodCost, data.FoodCostTarget,
            missing.Count > 0 ? CostStatus.MissingPrices : foodCost > data.FoodCostTarget ? CostStatus.AboveTarget : CostStatus.WithinTarget,
            missing);
    }

    // Each dish at its recipe's cost today, as its own card costs it (its shared costs a meal too).
    private static (IReadOnlyList<ComboDishDto> Dishes, decimal Total, decimal? Original, IReadOnlyList<string> Missing) RollUp(ComboOffer combo, MenuData data)
    {
        var dishes = new List<ComboDishDto>();
        foreach (var part in combo.Parts)
        {
            if (data.AllRecipes.FirstOrDefault(r => r.Id == part.RecipeId) is not { } recipe)
                continue;
            var card = Card(recipe, data);
            dishes.Add(new ComboDishDto(
                recipe.Id, card.Recipe, card.ItemCode == "" ? null : card.ItemCode, part.Quantity, card.CostPerPortion, Money(card.CostPerPortion * part.Quantity),
                card.MenuPrice, card.MenuPrice is { } price ? Money(price * part.Quantity) : null, recipe.IsDeleted, card.MissingPrices));
        }
        var original = dishes.All(d => d.LinePrice is not null) ? dishes.Sum(d => d.LinePrice!.Value) : (decimal?)null;
        return (dishes, Money(dishes.Sum(d => d.LineCost)), original is { } o ? Money(o) : null,
            dishes.SelectMany(d => d.MissingPrices).Distinct().ToList());
    }

    // The combo sold under a menu row's number, if one is.
    private static ComboOffer? ComboOf(Target target, MenuData data) =>
        target is { Kind: RecipeTargetKind.MenuItem, VariantId: null } && data.Combos.TryGetValue(target.CatalogItemId, out var combo) ? combo : null;

    // A combo's menu row as a costing card: its dishes' costs together, against its price. It has no
    // recipe or lines of its own.
    private static RecipeCostCard ComboCard(Target target, ComboOffer combo, MenuData data)
    {
        var (dishes, total, _, missing) = RollUp(combo, data);
        var shared = Money(dishes.Sum(d => (data.AllRecipes.First(r => r.Id == d.RecipeId) is var r ? Card(r, data).SharedCostPerPortion : 0) * d.Quantity));
        var price = target.Price;
        var foodCost = price > 0 ? Percent(total / price.Value) : (decimal?)null;
        var status = missing.Count > 0 ? CostStatus.MissingPrices
            : foodCost is null ? CostStatus.NoPrice
            : foodCost > data.FoodCostTarget ? CostStatus.AboveTarget : CostStatus.WithinTarget;
        return new RecipeCostCard(
            RecipeTargetKind.MenuItem, target.CatalogItemId, null, ItemCode(target.CatalogItemId, null), target.Name, target.NameAr, target.Category,
            true, 1, price, data.FoodCostTarget, [], total, Money(total - shared), shared, total,
            price is { } p ? Money(p - total) : null, foodCost, Money(total * 100 / data.FoodCostTarget), missing, status,
            LinkedTo: target.Name, ComboOfferId: combo.Id);
    }
}
