using Microsoft.EntityFrameworkCore;
using Costing.Domain.Common;
using Costing.Domain.Production;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;

namespace Costing.Infrastructure.Reports;

// The inflation & pricing simulator (محاكي التضخم والتسعير): every dish, off-menu recipe and prep
// item costed again at hypothetical prices, in memory, nothing saved. The price of a bought material
// changes by the most specific rule given:
//
//   its own new price (per purchase unit)  >  its category's %  >  the global %  >  as it is
//
// A prep item never made is costed by its recipe at the new prices; one made, at its average ×
// (its batch at the new prices ÷ its batch now), so nested prep items carry the change through.
//
//   Suggested price (keep food cost %) = price × simulated cost ÷ current cost
//   Suggested price (keep cash margin) = price + (simulated cost − current cost)
//   Monthly profit impact              = (current cost − simulated cost) × plates sold in the last 30 days
public sealed record CategoryInflation(Guid CategoryId, decimal Percent);

public sealed record MaterialPriceOverride(Guid RawMaterialId, decimal CostPerPurchaseUnit);

public sealed record InflationScenario(decimal? GlobalPercent, IReadOnlyList<CategoryInflation>? Categories, IReadOnlyList<MaterialPriceOverride>? Materials);

public enum SimulatedItemKind
{
    Dish = 1,
    OffMenuRecipe = 2,
    PrepItem = 3,
}

// A material whose price the scenario changes, per purchase unit.
public sealed record SimulatedMaterial(Guid RawMaterialId, string Material, string PurchaseUnit, decimal? CurrentPrice, decimal SimulatedPrice, decimal? ChangePercent);

public sealed record SimulatedItem(
    SimulatedItemKind Kind,
    string ItemCode,
    Guid? RecipeId,
    Guid? PrepItemId,
    string Name,
    string? Category,
    // What the cost is for: a portion, or a prep item's display unit (kg, L).
    string Unit,
    decimal? SellingPrice,
    decimal CurrentCost,
    decimal SimulatedCost,
    decimal Change,
    decimal? ChangePercent,
    decimal? CurrentFoodCostPercent,
    decimal? SimulatedFoodCostPercent,
    bool AboveTarget,
    // Within the target now, above it at the new prices.
    bool NewlyAboveTarget,
    decimal? SuggestedPriceKeepFoodCost,
    decimal? SuggestedPriceKeepMargin,
    decimal QuantityLast30Days,
    decimal? MonthlyProfitImpact);

public sealed record InflationReport(
    DateOnly SalesFrom,
    DateOnly SalesTo,
    decimal FoodCostTargetPercent,
    int MaterialsChanged,
    int Dishes,
    int NewlyAboveTarget,
    decimal MonthlyProfitImpact,
    IReadOnlyList<SimulatedMaterial> Materials,
    IReadOnlyList<SimulatedItem> Items);

public sealed partial class CostingService
{
    public const int InflationSalesDays = 30;

    public async Task<InflationReport> SimulateInflationAsync(InflationScenario scenario, CancellationToken cancellationToken)
    {
        static void CheckPercent(decimal percent)
        {
            if (percent is < -90 or > 1000)
                throw new DomainException("A change is a percentage from −90% to +1,000%. · نسبة التغير من −90% إلى +1000%.");
        }
        if (scenario.GlobalPercent is { } global)
            CheckPercent(global);
        foreach (var category in scenario.Categories ?? [])
            CheckPercent(category.Percent);
        if ((scenario.Materials ?? []).Any(m => m.CostPerPurchaseUnit < 0))
            throw new DomainException("A new price cannot be negative. · السعر الجديد لا يكون سالبًا.");

        var data = await LoadMenuAsync(cancellationToken);
        var byCategory = (scenario.Categories ?? []).GroupBy(c => c.CategoryId).ToDictionary(g => g.Key, g => g.Last().Percent);
        var byMaterial = (scenario.Materials ?? []).GroupBy(m => m.RawMaterialId).ToDictionary(g => g.Key, g => g.Last().CostPerPurchaseUnit);

        // A bought material's simulated cost a unit, by the most specific rule; null: as it is.
        decimal? Simulated(RawMaterial m)
        {
            if (byMaterial.TryGetValue(m.Id, out var price))
                return m.PurchaseUnitSize > 0 ? price / m.PurchaseUnitSize : null;
            var percent = byCategory.TryGetValue(m.CategoryId, out var p) ? p : scenario.GlobalPercent;
            return percent is { } change && m.AverageCost is { } average ? average * (1 + change / 100) : null;
        }

        var prepRecipes = await db.PrepRecipes.AsNoTracking().Include(r => r.Ingredients).ToListAsync(cancellationToken);
        var simulatedCosts = new RecipeCosts(data.Materials, prepRecipes, Simulated);
        var simulated = data with { Costs = simulatedCosts };

        var today = clock.BusinessDateOf(DateTime.UtcNow);
        var salesFrom = today.AddDays(-(InflationSalesDays - 1));
        var sold = (await SalesAsync(salesFrom, today, cancellationToken))
            .GroupBy(s => (s.MenuItemId, s.VariantId))
            .ToDictionary(g => g.Key, g => (decimal)g.Sum(s => s.Quantity));
        var target = data.FoodCostTarget;

        SimulatedItem Item(SimulatedItemKind kind, RecipeCostCard now, RecipeCostCard then, decimal quantity)
        {
            var (current, next) = (now.CostPerPortion, then.CostPerPortion);
            var price = kind == SimulatedItemKind.Dish ? now.MenuPrice : now.PlannedPrice;
            decimal? Fc(decimal cost) => price > 0 ? Percent(cost / price.Value) : null;
            var (fcNow, fcThen) = (Fc(current), Fc(next));
            return new SimulatedItem(
                kind, now.ItemCode, now.RecipeId, null, now.Recipe, now.Category, "portion", price, current, next, Money(next - current),
                current > 0 ? Percent(next / current - 1) : null, fcNow, fcThen, fcThen > target, fcThen > target && !(fcNow > target),
                price > 0 && current > 0 ? Money(price.Value * next / current) : null, price is { } p ? Money(p + next - current) : null,
                quantity, kind == SimulatedItemKind.Dish ? Money((current - next) * quantity) : null);
        }

        var items = new List<SimulatedItem>();
        foreach (var menuTarget in data.Targets.Where(t => t.Kind == RecipeTargetKind.MenuItem))
        {
            var own = data.Recipes.GetValueOrDefault(new RecipeTarget(menuTarget.Kind, menuTarget.CatalogItemId, menuTarget.VariantId));
            var recipe = own ?? (menuTarget.VariantId is not null ? data.Recipes.GetValueOrDefault(RecipeTarget.ForMenuItem(menuTarget.CatalogItemId)) : null);
            if (recipe is null)
                continue;
            var baseUsed = own is null;
            items.Add(Item(SimulatedItemKind.Dish, Card(menuTarget, recipe, baseUsed, data), Card(menuTarget, recipe, baseUsed, simulated),
                sold.GetValueOrDefault((menuTarget.CatalogItemId, menuTarget.VariantId))));
        }
        foreach (var recipe in data.AllRecipes.Where(r => !r.IsDeleted && !r.IsLinked))
            items.Add(Item(SimulatedItemKind.OffMenuRecipe, Card(recipe, data), Card(recipe, simulated), 0));
        foreach (var prep in prepRecipes)
        {
            if (data.Materials.GetValueOrDefault(prep.PrepItemId) is not { IsArchived: false } material)
                continue;
            var size = material.PurchaseUnitSize;
            var (now, then) = (data.Costs.Of(material.Id).PerUnit, simulatedCosts.Of(material.Id).PerUnit);
            if (now is not { } current || then is not { } next)
                continue;
            items.Add(new SimulatedItem(
                SimulatedItemKind.PrepItem, material.Code ?? "", null, material.Id, material.Name, "Prep item · مصنّع", material.PurchaseUnit, null,
                Money(current * size), Money(next * size), Money((next - current) * size), current > 0 ? Percent(next / current - 1) : null,
                null, null, false, false, null, null, 0, null));
        }

        var changed = data.Materials.Values
            .Where(m => !m.IsPrepItem && !m.IsArchived && Simulated(m) is { } next && next != m.AverageCost)
            .Select(m => new SimulatedMaterial(
                m.Id, m.Name, m.PurchaseUnit, Money(m.AverageCost * m.PurchaseUnitSize), Money(Simulated(m)!.Value * m.PurchaseUnitSize),
                m.AverageCost > 0 ? Percent(Simulated(m)!.Value / m.AverageCost.Value - 1) : null))
            .OrderByDescending(m => Math.Abs(m.ChangePercent ?? 0))
            .ThenBy(m => m.Material, StringComparer.CurrentCultureIgnoreCase)
            .ToList();

        items = items
            .OrderBy(i => i.Kind)
            .ThenByDescending(i => i.NewlyAboveTarget)
            .ThenBy(i => i.MonthlyProfitImpact ?? 0)
            .ThenByDescending(i => i.Change)
            .ThenBy(i => i.Name, StringComparer.CurrentCultureIgnoreCase)
            .ToList();
        var dishes = items.Where(i => i.Kind == SimulatedItemKind.Dish).ToList();
        return new InflationReport(
            salesFrom, today, target, changed.Count, dishes.Count, items.Count(i => i.NewlyAboveTarget),
            Money(dishes.Sum(i => i.MonthlyProfitImpact ?? 0)), changed, items);
    }
}
