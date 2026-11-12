using Costing.Domain.Common;

namespace Costing.Infrastructure.Reports;

// Menu engineering (هندسة المنيو والربحية), as Kasavana and Smith set it out: each dish the period
// sold placed by how popular it was and how much it left after its food cost.
//
//   menu mix %            = its quantity sold ÷ every analysed dish's
//   popular               = menu mix % ≥ 70% × (100% ÷ the number of dishes analysed)
//   contribution margin   = its average net selling price − its food cost a portion
//   profitable            = its margin ≥ the average margin, weighted by quantity sold
//
//   Star (النجوم): popular and profitable. Plowhorse (خيول العمل): popular, below the average margin.
//   Puzzle (الألغاز): profitable, not popular. Dog (الأصناف الضعيفة): neither.
//
// Food cost a portion is what its ingredients cost when it was sold, as the theoretical report
// takes it (the stock movements the sale posted); shared costs are monthly and left out here, so a
// week compares with a month. A dish with no recipe or no price cannot be placed, and is listed
// apart. The suggested price is the one that brings it to the food cost target.

public enum MenuClass
{
    Star = 1,
    Plowhorse = 2,
    Puzzle = 3,
    Dog = 4,
}

public sealed record MenuEngineeringRow(
    string ItemCode,
    int MenuItemId,
    int? VariantId,
    string MenuItem,
    string? MenuItemAr,
    string Category,
    decimal QuantitySold,
    decimal? MenuMixPercent,
    decimal NetSales,
    decimal? AveragePrice,
    decimal? FoodCostPerPortion,
    decimal? FoodCostPercent,
    decimal? ContributionMargin,
    decimal? TotalContribution,
    bool Popular,
    bool Profitable,
    MenuClass? Class,
    decimal? SuggestedPrice,
    CostStatus Status);

public sealed record MenuClassSummary(MenuClass Class, int Items, decimal QuantitySold, decimal Contribution, decimal? ContributionSharePercent);

public sealed record MenuEngineeringReport(
    DateOnly From,
    DateOnly To,
    string? Category,
    decimal FoodCostTargetPercent,
    int Items,
    decimal QuantitySold,
    decimal NetSales,
    decimal TotalContribution,
    decimal? AverageContribution,
    decimal? PopularityThresholdPercent,
    decimal? FoodCostPercent,
    IReadOnlyList<MenuClassSummary> Classes,
    IReadOnlyList<MenuEngineeringRow> Rows,
    int Unclassified,
    IReadOnlyList<string> Categories);

public sealed partial class CostingService
{
    // A dish below this share of an even menu mix is not popular: 70%, as Kasavana and Smith set it.
    public const decimal PopularityFactor = 0.7m;

    public async Task<MenuEngineeringReport> GetMenuEngineeringAsync(DateOnly from, DateOnly to, string? category, CancellationToken cancellationToken)
    {
        if (to < from)
            throw new DomainException("The first day must come before the last. · اليوم الأول قبل الأخير.");
        if (to > from.AddYears(2))
            throw new DomainException("Choose two years at most. · سنتان على الأكثر.");

        var settings = await SettingsAsync(cancellationToken);
        var target = settings.FoodCostTargetPercent;
        var sold = await SalesAsync(from, to, cancellationToken);
        var categories = sold.Select(s => s.Category).Where(c => c.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase)
            .Order(StringComparer.CurrentCultureIgnoreCase).ToList();
        var chosen = string.IsNullOrWhiteSpace(category) ? null : category.Trim();
        var dishes = sold
            .Where(s => chosen is null || string.Equals(s.Category, chosen, StringComparison.OrdinalIgnoreCase))
            .GroupBy(s => (s.MenuItemId, s.VariantId))
            .Select(g => new
            {
                Any = g.First(),
                Quantity = (decimal)g.Sum(s => s.Quantity),
                NetSales = g.Sum(s => s.NetSales),
                Ingredients = g.Sum(s => s.IngredientCost),
                HasRecipe = g.Any(s => s.HasRecipe),
                MissingPrice = g.Any(s => s.MissingPrice),
            })
            .Where(d => d.Quantity > 0)
            .ToList();

        // Placed: sold with a recipe and a price.
        var placed = dishes.Where(d => d.HasRecipe && d.NetSales > 0).ToList();
        var totalQuantity = placed.Sum(d => d.Quantity);
        var totalContribution = placed.Sum(d => d.NetSales - d.Ingredients);
        decimal? averageMargin = totalQuantity > 0 ? totalContribution / totalQuantity : null;
        decimal? threshold = placed.Count > 0 ? PopularityFactor / placed.Count : null;

        var rows = dishes.Select(d =>
            {
                var any = d.Any;
                var code = ItemCode(any.MenuItemId, any.VariantId);
                if (!d.HasRecipe || d.NetSales <= 0)
                    return new MenuEngineeringRow(
                        code, any.MenuItemId, any.VariantId, any.Name, any.NameAr, any.Category, d.Quantity, null, Money(d.NetSales),
                        d.NetSales > 0 ? Money(d.NetSales / d.Quantity) : null, null, null, null, null, false, false, null, null,
                        d.HasRecipe ? CostStatus.NoPrice : CostStatus.NoRecipe);

                var price = d.NetSales / d.Quantity;
                var cost = d.Ingredients / d.Quantity;
                var margin = price - cost;
                var mix = d.Quantity / totalQuantity;
                var popular = mix >= threshold;
                var profitable = margin >= averageMargin;
                var foodCost = Percent(cost / price);
                var status = d.MissingPrice ? CostStatus.MissingPrices : foodCost > target ? CostStatus.AboveTarget : CostStatus.WithinTarget;
                return new MenuEngineeringRow(
                    code, any.MenuItemId, any.VariantId, any.Name, any.NameAr, any.Category, d.Quantity, Math.Round(mix * 100, 2, MidpointRounding.AwayFromZero),
                    Money(d.NetSales), Money(price), Money(cost), foodCost, Money(margin), Money(d.NetSales - d.Ingredients), popular, profitable,
                    (popular, profitable) switch
                    {
                        (true, true) => MenuClass.Star,
                        (true, false) => MenuClass.Plowhorse,
                        (false, true) => MenuClass.Puzzle,
                        _ => MenuClass.Dog,
                    },
                    target > 0 ? Money(cost * 100 / target) : null, status);
            })
            .OrderBy(r => r.Class ?? (MenuClass)99).ThenByDescending(r => r.TotalContribution ?? decimal.MinValue).ThenBy(r => r.ItemCode)
            .ToList();

        var classified = rows.Where(r => r.Class is not null).ToList();
        var placedSales = placed.Sum(d => d.NetSales);
        var placedCost = placed.Sum(d => d.Ingredients);
        return new MenuEngineeringReport(
            from, to, chosen, target, classified.Count, totalQuantity, Money(placedSales), Money(totalContribution), Money(averageMargin),
            threshold is { } t ? Math.Round(t * 100, 2, MidpointRounding.AwayFromZero) : null,
            placedSales > 0 ? Percent(placedCost / placedSales) : null,
            Enum.GetValues<MenuClass>().Select(c =>
                {
                    var of = classified.Where(r => r.Class == c).ToList();
                    var contribution = of.Sum(r => r.TotalContribution ?? 0);
                    return new MenuClassSummary(c, of.Count, of.Sum(r => r.QuantitySold), Money(contribution),
                        totalContribution != 0 ? Percent(contribution / totalContribution) : null);
                })
                .ToList(),
            rows, rows.Count - classified.Count, categories);
    }
}
