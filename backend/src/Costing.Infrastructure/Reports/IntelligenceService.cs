using Microsoft.EntityFrameworkCore;
using Costing.Application.Common;
using Costing.Domain.Categories;
using Costing.Domain.Common;
using Costing.Domain.Production;
using Costing.Domain.Purchases;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;
using Costing.Domain.StockMovements;
using Costing.Infrastructure.Persistence;
using static Costing.Infrastructure.Reports.CostingService;

namespace Costing.Infrastructure.Reports;

// Material & demand intelligence (تحليلات الخامات والطلبيات), as a cost accountant reads the stores:
// what the purchase prices did and what that does to the dishes, what to order for the days ahead,
// what was used against what the sales should have taken, and which materials hold the money.
// Every quantity is in the material's purchase unit (kg, L, a carton), every price per it.

public sealed record NamedId(Guid Id, string Name, string? NameAr = null);

// ---- Purchase price variance ----

public enum PriceImpactKind
{
    Dish = 1,
    PrepItem = 2,
}

// What a material's price change does to a dish or a prep item that uses it, its prep items' share
// too: how much of the material goes into a portion of the dish (or a purchase unit of the prep
// item), what that costs more or less now, and against the dish's price, the food cost points; for a
// prep item, its share of what the prep item costs.
public sealed record PriceImpactLine(
    PriceImpactKind Kind, Guid Id, string Name, string? NameAr, string Per, decimal Quantity, decimal CostChange, decimal? Against, decimal? Points);

// One material over the period: the moving average it came in with (Baseline), the latest net price
// paid for it, by how much and what share that moved, what was bought, and the financial impact of
// the change on it: (latest − baseline) × bought. The dishes and prep items it goes into, and who
// sold it last.
public sealed record PriceVarianceRow(
    Guid RawMaterialId,
    string? Code,
    string Material,
    Guid CategoryId,
    string? Category,
    string? CategoryAr,
    string PurchaseUnit,
    decimal? BaselineCost,
    decimal? LatestCost,
    decimal? UnitVariance,
    decimal? ChangePercent,
    decimal QuantityPurchased,
    decimal? Impact,
    int Invoices,
    DateOnly? LatestPurchasedOn,
    Guid? LatestSupplierId,
    string? LatestSupplier,
    IReadOnlyList<Guid> SupplierIds,
    IReadOnlyList<PriceImpactLine> Affected);

public sealed record PriceVarianceReport(
    DateOnly From,
    DateOnly To,
    decimal TotalImpact,
    decimal Increases,
    decimal Decreases,
    int Rising,
    int Falling,
    int AffectedDishes,
    string? LargestRise,
    decimal? LargestRisePercent,
    IReadOnlyList<PriceVarianceRow> Rows,
    IReadOnlyList<NamedId> Categories,
    IReadOnlyList<NamedId> Suppliers);

// ---- The order planner ----

// What the manager expects a dish (a size, when it has sizes) to sell a day.
public sealed record DishExpectation(int MenuItemId, int? VariantId, decimal ExpectedDaily);

// The last LookbackDays' sales a day, for CoverageDays ahead, grown by GrowthPercent (a weekend, a
// holiday); a dish expected otherwise is as Dishes say.
public sealed record OrderPlanRequest(int LookbackDays = 14, int CoverageDays = 7, decimal GrowthPercent = 0, IReadOnlyList<DishExpectation>? Dishes = null);

public sealed record PlannedDish(
    int MenuItemId, int? VariantId, string Code, string Name, string? NameAr, bool HasRecipe, decimal AverageDaily, decimal ExpectedDaily, bool Expected);

// One bought material: what is on the shelf, what the past days used a day, what the days ahead need
// (the prep items on hand netted first), its reorder level, what to order (Recommended, the need
// less the shelf; Suggested, rounded up to whole purchase units), at the latest net price paid, from
// who sold it last.
public sealed record OrderPlanLine(
    Guid RawMaterialId,
    string? Code,
    string Material,
    Guid CategoryId,
    string? Category,
    string? CategoryAr,
    string PurchaseUnit,
    decimal OnHand,
    decimal AverageDailyUsage,
    decimal ExpectedUsage,
    decimal ReorderLevel,
    decimal Recommended,
    decimal Suggested,
    decimal? UnitPrice,
    decimal? EstimatedCost,
    Guid? SupplierId,
    string? Supplier,
    bool BelowReorder);

public sealed record OrderPlan(
    DateOnly LookbackFrom,
    DateOnly LookbackTo,
    int LookbackDays,
    int CoverageDays,
    decimal GrowthPercent,
    IReadOnlyList<PlannedDish> Dishes,
    IReadOnlyList<OrderPlanLine> Lines,
    int ToOrder,
    decimal EstimatedTotal,
    int BelowReorder,
    IReadOnlyList<string> NoPrice);

public enum OrderSheetGrouping
{
    Category = 1,
    Supplier = 2,
}

// The order as approved: each material's quantity in its purchase unit.
public sealed record OrderSheetLine(Guid RawMaterialId, decimal Quantity);

public sealed record OrderSheetRequest(IReadOnlyList<OrderSheetLine> Lines, OrderSheetGrouping GroupBy = OrderSheetGrouping.Category, int? CoverageDays = null);

// The approved order, for the sheet: each line with its unit price and cost, and the group it is under.
public sealed record OrderSheetRow(string Group, string? Code, string Material, string PurchaseUnit, decimal Quantity, decimal? UnitPrice, decimal? Cost, string? Other);

public sealed record OrderSheet(OrderSheetGrouping GroupBy, int? CoverageDays, DateOnly Today, IReadOnlyList<OrderSheetRow> Rows, decimal Total);

// ---- Theoretical against actual consumption ----

// One bought material over the period. Actual usage: opening + purchases − logged waste − closing,
// the book's stock either side. Theoretical: what the sales should have taken by the recipes, down
// through the prep items, and what is held in the prep items' stock made from it (HeldInPrep: made
// and not sold yet, or below zero, sold from what was made before). Unexplained: actual −
// theoretical, valued at the average cost now. A prep item's waste counts as its ingredients'.
public sealed record ConsumptionRow(
    Guid RawMaterialId,
    string? Code,
    string Material,
    Guid CategoryId,
    string? Category,
    string? CategoryAr,
    string PurchaseUnit,
    decimal Opening,
    decimal Purchases,
    decimal Waste,
    decimal Closing,
    decimal ActualUsage,
    decimal TheoreticalUsage,
    decimal HeldInPrep,
    decimal UnexplainedQuantity,
    decimal? UnexplainedPercent,
    decimal? UnitCost,
    decimal? VarianceCost,
    VarianceEvaluation Evaluation);

public sealed record ConsumptionReport(
    DateOnly From,
    DateOnly To,
    decimal TolerancePercent,
    decimal TheoreticalValue,
    decimal ActualValue,
    decimal UnexplainedValue,
    int HighLoss,
    IReadOnlyList<ConsumptionRow> Rows,
    IReadOnlyList<SoldWithoutStock> SoldWithoutRecipe);

// ---- ABC and days on hand ----

public enum AbcClass
{
    A = 1,
    B = 2,
    C = 3,
}

// One bought material: what the period used of it (sold, made into prep items, wasted, short at a
// count) and its worth at the cost then, its share and the running share down the list, its class;
// what is on the shelf and its worth, what it uses a day and so how many days it lasts.
public sealed record AbcRow(
    Guid RawMaterialId,
    string? Code,
    string Material,
    Guid CategoryId,
    string? Category,
    string? CategoryAr,
    string PurchaseUnit,
    decimal Consumption,
    decimal ConsumptionValue,
    decimal SharePercent,
    decimal CumulativePercent,
    AbcClass Class,
    decimal OnHand,
    decimal? StockValue,
    decimal AverageDaily,
    decimal? DaysOnHand,
    bool StockoutRisk,
    bool DeadStock);

public sealed record AbcClassSummary(AbcClass Class, int Materials, decimal Value, decimal SharePercent);

public sealed record AbcReport(
    DateOnly From,
    DateOnly To,
    int Days,
    decimal ConsumptionValue,
    IReadOnlyList<AbcClassSummary> Classes,
    int StockoutRisks,
    int DeadStock,
    decimal DeadStockValue,
    decimal StockValue,
    IReadOnlyList<AbcRow> Rows);

public sealed class IntelligenceService(CostingDbContext db, IBusinessCalendar clock, SalesLedger ledger)
{
    // Class A: what the materials up to three quarters of the value are; B, the next 15%.
    public const decimal ClassALimit = 75;
    public const decimal ClassBLimit = 90;

    // Fewer days on hand than this: it runs out before the next delivery is likely in.
    public const decimal StockoutDays = 2;

    // What took stock out of use: sold, made into prep items, wasted, short at a count.
    private static readonly StockMovementReason[] Uses =
    [
        StockMovementReason.Sale, StockMovementReason.ProductionInput, StockMovementReason.Waste, StockMovementReason.Spoilage,
        StockMovementReason.VoidReturn, StockMovementReason.CountAdjustment,
    ];

    // Waste logged: spoilage, and dishes voided after the kitchen made them, less what refunds put back.
    private static readonly StockMovementReason[] WasteReasons = [StockMovementReason.Waste, StockMovementReason.Spoilage, StockMovementReason.VoidReturn];

    // A movement priced at the average cost when it was made: what the average was then.
    private static readonly StockMovementReason[] AtAverage =
    [
        StockMovementReason.Sale, StockMovementReason.Waste, StockMovementReason.VoidReturn, StockMovementReason.Spoilage,
        StockMovementReason.ProductionInput, StockMovementReason.CountAdjustment, StockMovementReason.OpeningStock,
    ];

    public DateOnly Today => clock.BusinessDateOf(DateTime.UtcNow);

    // ---- Purchase price variance and recipe impact ----

    public async Task<PriceVarianceReport> GetPriceVarianceAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken)
    {
        var (fromUtc, toUtc) = Period(from, to);
        var catalog = await CatalogAsync(cancellationToken);
        var bought = (await PurchasesAsync(cancellationToken))
            .Where(p => p.Date >= from && p.Date <= to)
            .ToLookup(p => p.RawMaterialId);
        var ids = bought.Select(g => g.Key).Where(catalog.Materials.ContainsKey).ToList();

        // The moving average each came in with, from its ledger before the period.
        var history = (await db.StockMovements.AsNoTracking()
                .Where(m => m.OccurredAtUtc < fromUtc && ids.Contains(m.RawMaterialId))
                .OrderBy(m => m.OccurredAtUtc)
                .ToListAsync(cancellationToken))
            .ToLookup(m => m.RawMaterialId);
        var suppliers = await db.Suppliers.AsNoTracking().ToDictionaryAsync(s => s.Id, s => s.Name, cancellationToken);

        var rows = new List<PriceVarianceRow>();
        foreach (var id in ids)
        {
            var material = catalog.Materials[id];
            var lines = bought[id].OrderBy(p => p.Date).ThenBy(p => p.PostedAtUtc).ToList();
            var priced = lines.Where(p => p.UnitCost is not null).ToList();
            var latest = priced.LastOrDefault();
            var baseline = AverageBefore(history[id]) ?? priced.FirstOrDefault()?.UnitCost;
            var change = latest?.UnitCost - baseline;
            var size = material.PurchaseUnitSize;
            var quantity = lines.Sum(p => p.Quantity);
            rows.Add(new PriceVarianceRow(
                id, material.Code, material.Name, material.CategoryId, catalog.CategoryName(material.CategoryId), catalog.CategoryAr(material.CategoryId),
                material.PurchaseUnit, Money(baseline * size), Money(latest?.UnitCost * size), Money(change * size),
                baseline > 0 && change is { } moved ? Percent(moved / baseline.Value) : null,
                Quantity(quantity / size), Money(change * quantity), lines.Select(p => p.InvoiceId).Distinct().Count(),
                latest?.Date, latest?.SupplierId, latest?.SupplierId is { } s ? suppliers.GetValueOrDefault(s) : null,
                lines.Where(p => p.SupplierId is not null).Select(p => p.SupplierId!.Value).Distinct().ToList(),
                change is { } delta && delta != 0 ? Affected(catalog, material, delta) : []));
        }

        rows = rows.OrderByDescending(r => Math.Abs(r.Impact ?? 0)).ThenBy(r => r.Material).ToList();
        var rising = rows.Where(r => r.UnitVariance > 0).ToList();
        var largest = rising.Where(r => r.ChangePercent is not null).MaxBy(r => r.ChangePercent);
        return new PriceVarianceReport(
            from, to, Money(rows.Sum(r => r.Impact ?? 0)), Money(rows.Where(r => r.Impact > 0).Sum(r => r.Impact!.Value)),
            Money(rows.Where(r => r.Impact < 0).Sum(r => r.Impact!.Value)), rising.Count, rows.Count(r => r.UnitVariance < 0),
            rising.SelectMany(r => r.Affected).Where(a => a.Kind == PriceImpactKind.Dish).Select(a => a.Id).Distinct().Count(),
            largest?.Material, largest?.ChangePercent, rows,
            rows.GroupBy(r => r.CategoryId).Select(g => new NamedId(g.Key, g.First().Category ?? "Uncategorized", g.First().CategoryAr))
                .OrderBy(c => c.Name).ToList(),
            rows.SelectMany(r => r.SupplierIds).Distinct().Where(suppliers.ContainsKey).Select(s => new NamedId(s, suppliers[s]))
                .OrderBy(s => s.Name).ToList());
    }

    // The dishes and prep items a material goes into, directly or inside a prep item, and what a
    // change of `change` a unit (a gram, millilitre or piece) does to each, the largest first.
    private static IReadOnlyList<PriceImpactLine> Affected(Catalog catalog, RawMaterial material, decimal change)
    {
        var lines = new List<PriceImpactLine>();
        foreach (var prep in catalog.Materials.Values.Where(m => m.IsPrepItem && !m.IsArchived && catalog.Explosion.IsMade(m.Id)))
        {
            var perUnit = catalog.Explosion.PerUnit(prep.Id).GetValueOrDefault(material.Id);
            if (perUnit == 0)
                continue;
            var perPurchaseUnit = perUnit * prep.PurchaseUnitSize;
            var cost = catalog.Costs.Of(prep.Id).PerUnit * prep.PurchaseUnitSize;
            var moved = perPurchaseUnit * change;
            lines.Add(new PriceImpactLine(
                PriceImpactKind.PrepItem, prep.Id, prep.Name, null, prep.PurchaseUnit, Quantity(perPurchaseUnit / material.PurchaseUnitSize), Money(moved),
                Money(cost), cost > 0 ? Percent(moved / cost.Value) : null));
        }

        foreach (var recipe in catalog.Recipes.Where(r => !r.IsDeleted && r.Ingredients.Count > 0))
        {
            var perPortion = recipe.Ingredients.Sum(i => catalog.Explosion.PerUnit(i.RawMaterialId).GetValueOrDefault(material.Id) * i.AsPurchasedQuantity)
                / recipe.Portions;
            if (perPortion == 0)
                continue;
            var sold = recipe.Target is { } target ? catalog.Targets.GetValueOrDefault(target) : null;
            var price = sold is not null ? sold.Price : recipe.PlannedPrice;
            var moved = perPortion * change;
            lines.Add(new PriceImpactLine(
                PriceImpactKind.Dish, recipe.Id, sold?.Name ?? recipe.Name ?? "A recipe", sold?.NameAr, "portion",
                Quantity(perPortion / material.PurchaseUnitSize), Money(moved), price, price > 0 ? Percent(moved / price.Value) : null));
        }

        return lines.OrderByDescending(l => Math.Abs(l.CostChange)).ThenBy(l => l.Name).ToList();
    }

    // The average cost a material had at the end of these movements, as its ledger tells it: each
    // priced delivery or batch averaged in with what was on the shelf, as the material does it;
    // each movement made at the average then (a sale, a count, waste) saying what it was, which also
    // brings back in step anything the ledger does not show (a price typed in, a void). Null with
    // nothing to go by.
    internal static decimal? AverageBefore(IEnumerable<StockMovement> movements)
    {
        decimal? average = null;
        decimal onHand = 0;
        foreach (var m in movements)
        {
            if (m.ReversalOf is null && m.Quantity > 0 && m.UnitCost is { } cost
                && m.Reason is StockMovementReason.Purchase or StockMovementReason.ProductionOutput)
            {
                var onShelf = Math.Max(onHand, 0);
                average = average is { } before && onShelf > 0 ? (onShelf * before + m.Quantity * cost) / (onShelf + m.Quantity) : cost;
            }
            else if (m.ReversalOf is null && m.UnitCost is { } at && AtAverage.Contains(m.Reason))
                average = at;
            onHand += m.Quantity;
        }

        return average;
    }

    // ---- The order planner ----

    public async Task<OrderPlan> PlanOrderAsync(OrderPlanRequest request, CancellationToken cancellationToken)
    {
        if (request.LookbackDays is < 1 or > 90)
            throw new DomainException("Look back 1 to 90 days. · من 1 إلى 90 يومًا.");
        if (request.CoverageDays is < 1 or > 60)
            throw new DomainException("Order for 1 to 60 days ahead. · من 1 إلى 60 يومًا.");
        if (request.GrowthPercent is < -90 or > 500)
            throw new DomainException("Grow the sales by −90% to +500%. · نسبة النمو من −90% إلى +500%.");
        if (request.Dishes?.Any(d => d.ExpectedDaily < 0) == true)
            throw new DomainException("A dish is expected to sell zero or more a day. · المبيعات المتوقعة صفر أو أكثر.");

        var catalog = await CatalogAsync(cancellationToken);
        var today = Today;
        var (lookFrom, lookTo) = (today.AddDays(-request.LookbackDays), today.AddDays(-1));
        var sold = await SoldAsync(lookFrom, lookTo, cancellationToken);
        decimal days = request.LookbackDays;

        // Each dish the menu sells by a recipe, or sold in the days looked back: what it sold a day,
        // and what it is expected to.
        var expected = (request.Dishes ?? []).GroupBy(d => (d.MenuItemId, d.VariantId)).ToDictionary(g => g.Key, g => g.Last().ExpectedDaily);
        var byDish = sold.GroupBy(s => (s.Key.MenuItemId, s.Key.VariantId)).ToDictionary(g => g.Key, g => g.ToList());
        var dishes = catalog.Targets.Where(t => t.Key.Kind == RecipeTargetKind.MenuItem && t.Value.Sold)
            .Select(t => (MenuItemId: t.Key.CatalogItemId, t.Key.VariantId))
            .Where(key => catalog.RecipeFor(key.MenuItemId, key.VariantId) is not null)
            .Concat(byDish.Keys)
            .Distinct()
            .Select(key =>
            {
                var target = catalog.Targets.GetValueOrDefault(key.VariantId is { } v
                    ? RecipeTarget.ForVariant(key.MenuItemId, v)
                    : RecipeTarget.ForMenuItem(key.MenuItemId));
                var average = byDish.GetValueOrDefault(key)?.Sum(s => s.Quantity) / days ?? 0;
                var overridden = expected.TryGetValue(key, out var set);
                var name = target?.Name ?? byDish.GetValueOrDefault(key)?.First().Name ?? $"Item {key.MenuItemId}";
                return new PlannedDish(
                    key.MenuItemId, key.VariantId, ItemCode(key.MenuItemId, key.VariantId), name, target?.NameAr,
                    catalog.RecipeFor(key.MenuItemId, key.VariantId) is not null, Quantity(average),
                    Quantity(overridden ? set : average * (1 + request.GrowthPercent / 100)), overridden);
            })
            .OrderByDescending(d => d.AverageDaily).ThenBy(d => d.Code)
            .ToList();

        // What a day took in the days looked back, down to bought materials; and what the days
        // ahead need, each sold line's share of its dish's expected sales, prep items still whole.
        var pastDay = new Dictionary<Guid, decimal>();
        var ahead = new Dictionary<Guid, decimal>();
        foreach (var dish in dishes)
        {
            var soldLines = byDish.GetValueOrDefault((dish.MenuItemId, dish.VariantId)) ?? [];
            var total = soldLines.Sum(s => s.Quantity);
            // As expected, not as shown: the shown figure is rounded.
            var daily = expected.TryGetValue((dish.MenuItemId, dish.VariantId), out var set) ? set : total / days * (1 + request.GrowthPercent / 100);
            List<(SaleKey Key, decimal Share, decimal Past)> keys = total > 0
                ? soldLines.Select(s => (s.Key, s.Quantity / total, s.Quantity / days)).ToList()
                : [(new SaleKey(dish.MenuItemId, dish.VariantId, ""), 1m, 0m)];
            foreach (var (key, share, past) in keys)
            {
                var per = catalog.Requirements(key);
                foreach (var (id, quantity) in catalog.Explosion.Explode(per))
                    pastDay[id] = pastDay.GetValueOrDefault(id) + quantity * past;
                foreach (var (id, quantity) in per)
                    ahead[id] = ahead.GetValueOrDefault(id) + quantity * share * daily * request.CoverageDays;
            }
        }

        // The prep items first, each before those it is made with: what is on hand of one is used
        // before it is made again, and only what has to be made is broken into its ingredients.
        foreach (var prepId in catalog.Explosion.TopDown())
        {
            if (catalog.Materials.GetValueOrDefault(prepId) is not { } prep)
                continue;
            var make = ahead.GetValueOrDefault(prepId) + prep.ReorderLevel - Math.Max(prep.QuantityOnHand, 0);
            if (make <= 0)
                continue;
            foreach (var (id, quantity) in catalog.Explosion.Ingredients(prepId, make))
                ahead[id] = ahead.GetValueOrDefault(id) + quantity;
        }

        var prices = await LatestPricesAsync(cancellationToken);
        var suppliers = await db.Suppliers.AsNoTracking().ToDictionaryAsync(s => s.Id, s => s.Name, cancellationToken);
        var lines = new List<OrderPlanLine>();
        foreach (var material in catalog.Materials.Values.Where(m => !m.IsPrepItem && !m.IsArchived))
        {
            var need = ahead.GetValueOrDefault(material.Id);
            var usage = pastDay.GetValueOrDefault(material.Id);
            var recommended = Math.Max(0, need + material.ReorderLevel - material.QuantityOnHand);
            if (need == 0 && usage == 0 && recommended == 0)
                continue;
            var size = material.PurchaseUnitSize;
            var suggested = Math.Ceiling(Math.Round(recommended / size, 6));
            var last = prices.GetValueOrDefault(material.Id);
            var price = last?.UnitCost * size ?? material.CostPerPurchaseUnit;
            lines.Add(new OrderPlanLine(
                material.Id, material.Code, material.Name, material.CategoryId, catalog.CategoryName(material.CategoryId), catalog.CategoryAr(material.CategoryId),
                material.PurchaseUnit, Quantity(material.QuantityOnHand / size), Quantity(usage / size), Quantity(need / size),
                Quantity(material.ReorderLevel / size), Quantity(recommended / size), suggested, Money(price), Money(suggested * price),
                last?.SupplierId, last?.SupplierId is { } s ? suppliers.GetValueOrDefault(s) : null, material.NeedsReorder));
        }

        lines = lines.OrderBy(l => l.Category).ThenBy(l => l.Material).ToList();
        var toOrder = lines.Where(l => l.Suggested > 0).ToList();
        return new OrderPlan(
            lookFrom, lookTo, request.LookbackDays, request.CoverageDays, request.GrowthPercent, dishes, lines, toOrder.Count,
            Money(toOrder.Sum(l => l.EstimatedCost ?? 0)), lines.Count(l => l.BelowReorder),
            toOrder.Where(l => l.UnitPrice is null).Select(l => l.Material).ToList());
    }

    // The order as approved, for its sheet: each material's line at the latest net price, under its
    // category or the supplier who sold it last.
    public async Task<OrderSheet> OrderSheetAsync(OrderSheetRequest request, CancellationToken cancellationToken)
    {
        if (request.Lines.Any(l => l.Quantity < 0))
            throw new DomainException("Order zero or more of each. · الكمية صفر أو أكثر.");
        var ids = request.Lines.Where(l => l.Quantity > 0).Select(l => l.RawMaterialId).Distinct().ToList();
        if (ids.Count == 0)
            throw new DomainException("Approve something to order first. · اعتمد كمية لصنف واحد على الأقل.");
        var materials = await db.RawMaterials.AsNoTracking().Where(m => ids.Contains(m.Id)).ToDictionaryAsync(m => m.Id, cancellationToken);
        var categories = await db.PurchaseCategories.AsNoTracking().ToDictionaryAsync(c => c.Id, c => c.Name, cancellationToken);
        var suppliers = await db.Suppliers.AsNoTracking().ToDictionaryAsync(s => s.Id, s => s.Name, cancellationToken);
        var prices = await LatestPricesAsync(cancellationToken);

        var rows = request.Lines.Where(l => l.Quantity > 0 && materials.ContainsKey(l.RawMaterialId))
            .GroupBy(l => l.RawMaterialId)
            .Select(g =>
            {
                var material = materials[g.Key];
                var last = prices.GetValueOrDefault(material.Id);
                var price = Money(last?.UnitCost * material.PurchaseUnitSize ?? material.CostPerPurchaseUnit);
                var quantity = g.Sum(l => l.Quantity);
                var category = categories.GetValueOrDefault(material.CategoryId) ?? "Uncategorized";
                var supplier = last?.SupplierId is { } s ? suppliers.GetValueOrDefault(s) : null;
                return request.GroupBy == OrderSheetGrouping.Supplier
                    ? new OrderSheetRow(supplier ?? "No supplier yet", material.Code, material.Name, material.PurchaseUnit, quantity, price, Money(quantity * price), category)
                    : new OrderSheetRow(category, material.Code, material.Name, material.PurchaseUnit, quantity, price, Money(quantity * price), supplier);
            })
            .OrderBy(r => r.Group).ThenBy(r => r.Material)
            .ToList();
        return new OrderSheet(request.GroupBy, request.CoverageDays, Today, rows, Money(rows.Sum(r => r.Cost ?? 0)));
    }

    // ---- Theoretical against actual consumption ----

    public async Task<ConsumptionReport> GetConsumptionAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken)
    {
        var (fromUtc, toUtc) = Period(from, to);
        var catalog = await CatalogAsync(cancellationToken);
        var settings = await db.CostingSettings.AsNoTracking().SingleOrDefaultAsync(cancellationToken) ?? new CostingSettings();
        var tolerance = settings.VarianceTolerancePercent;
        var shared = (await db.SharedCosts.AsNoTracking().Where(c => c.RawMaterialId != null).Select(c => c.RawMaterialId!.Value)
            .ToListAsync(cancellationToken)).ToHashSet();

        var stock = await StockAsync(fromUtc, toUtc, cancellationToken);

        // What the sales should have taken, by the recipes as they stand.
        var sold = await SoldAsync(from, to, cancellationToken);
        var theoretical = new Dictionary<Guid, decimal>();
        var withoutRecipe = new List<SoldWithoutStock>();
        foreach (var line in sold)
        {
            var per = catalog.Requirements(line.Key);
            if (per.Count == 0)
            {
                withoutRecipe.Add(new SoldWithoutStock(ItemCode(line.Key.MenuItemId, line.Key.VariantId), line.Name, (int)line.Quantity));
                continue;
            }
            foreach (var (id, quantity) in catalog.Explosion.Explode(per))
                theoretical[id] = theoretical.GetValueOrDefault(id) + quantity * line.Quantity;
        }

        // The prep items' stock change and their waste, in what they are made of.
        var prepItems = catalog.Materials.Values.Where(m => m.IsPrepItem && catalog.Explosion.IsMade(m.Id)).ToList();
        var held = catalog.Explosion.Explode(prepItems.Select(p => KeyValuePair.Create(p.Id, stock.Closing(p.Id) - stock.Opening(p.Id))));
        var prepWaste = catalog.Explosion.Explode(prepItems.Select(p => KeyValuePair.Create(p.Id, stock.Wasted(p.Id))));

        var rows = new List<ConsumptionRow>();
        foreach (var material in catalog.Materials.Values.Where(m => !m.IsPrepItem))
        {
            var id = material.Id;
            var (opening, purchases, closing) = (stock.Opening(id), stock.Moved(id, StockMovementReason.Purchase), stock.Closing(id));
            var waste = stock.Wasted(id) + prepWaste.GetValueOrDefault(id);
            var inPrep = held.GetValueOrDefault(id);
            var expected = theoretical.GetValueOrDefault(id) + inPrep;
            if (opening == 0 && purchases == 0 && waste == 0 && closing == 0 && expected == 0)
                continue;
            var actual = opening + purchases - waste - closing;
            var unexplained = actual - expected;
            decimal? percent = expected > 0 ? Percent(unexplained / expected) : null;
            var evaluation = shared.Contains(id) && expected == 0 ? VarianceEvaluation.SharedCost
                : percent is { } p
                ? p > tolerance ? VarianceEvaluation.Unfavourable : p < -tolerance ? VarianceEvaluation.Favourable : VarianceEvaluation.WithinLimit
                : unexplained > 0 ? VarianceEvaluation.Unfavourable : unexplained < 0 ? VarianceEvaluation.Favourable : VarianceEvaluation.WithinLimit;
            var size = material.PurchaseUnitSize;
            rows.Add(new ConsumptionRow(
                id, material.Code, material.Name, material.CategoryId, catalog.CategoryName(material.CategoryId), catalog.CategoryAr(material.CategoryId),
                material.PurchaseUnit, Quantity(opening / size), Quantity(purchases / size), Quantity(waste / size), Quantity(closing / size),
                Quantity(actual / size), Quantity(expected / size), Quantity(inPrep / size), Quantity(unexplained / size), percent,
                Money(material.CostPerPurchaseUnit), Money(unexplained * material.AverageCost), evaluation));
        }

        rows = rows.OrderBy(r => r.Evaluation == VarianceEvaluation.SharedCost).ThenByDescending(r => r.VarianceCost ?? 0).ThenBy(r => r.Material).ToList();
        var measured = rows.Where(r => r.Evaluation != VarianceEvaluation.SharedCost).ToList();
        decimal Worth(Func<ConsumptionRow, decimal> quantity) => Money(measured.Sum(r => quantity(r) * (r.UnitCost ?? 0)));
        return new ConsumptionReport(
            from, to, tolerance, Worth(r => r.TheoreticalUsage), Worth(r => r.ActualUsage), Money(measured.Sum(r => r.VarianceCost ?? 0)),
            measured.Count(r => r.Evaluation == VarianceEvaluation.Unfavourable), rows,
            withoutRecipe.GroupBy(w => (w.ItemCode, w.MenuItem)).Select(g => new SoldWithoutStock(g.Key.ItemCode, g.Key.MenuItem, g.Sum(w => w.Quantity)))
                .OrderByDescending(w => w.Quantity).ToList());
    }

    // ---- ABC classification and days on hand ----

    public async Task<AbcReport> GetAbcAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken)
    {
        var (fromUtc, toUtc) = Period(from, to);
        var today = Today;
        var days = Math.Max(1, (to < today ? to : today).DayNumber - from.DayNumber + 1);
        var materials = await db.RawMaterials.AsNoTracking().Where(m => m.Kind != MaterialKind.Prep && m.ArchivedAtUtc == null)
            .ToDictionaryAsync(m => m.Id, cancellationToken);
        var categories = await db.PurchaseCategories.AsNoTracking().ToDictionaryAsync(c => c.Id, cancellationToken);
        var used = await db.StockMovements.AsNoTracking()
            .Where(m => m.OccurredAtUtc >= fromUtc && m.OccurredAtUtc < toUtc && Uses.Contains(m.Reason))
            .GroupBy(m => m.RawMaterialId)
            .Select(g => new { RawMaterialId = g.Key, Quantity = -g.Sum(m => m.Quantity), Value = -g.Sum(m => m.Quantity * m.UnitCost), Unpriced = -g.Where(m => m.UnitCost == null).Sum(m => m.Quantity) })
            .ToDictionaryAsync(u => u.RawMaterialId, cancellationToken);

        var measured = materials.Values.Select(m =>
            {
                var use = used.GetValueOrDefault(m.Id);
                var quantity = Math.Max(use?.Quantity ?? 0, 0);
                // At the cost when it was used; what had no price then, at the average now.
                var value = quantity > 0 ? Math.Max((use!.Value ?? 0) + use.Unpriced * (m.AverageCost ?? 0), 0) : 0;
                return (Material: m, Quantity: quantity, Value: value);
            })
            .OrderByDescending(x => x.Value).ThenBy(x => x.Material.Name)
            .ToList();
        var total = measured.Sum(x => x.Value);

        var rows = new List<AbcRow>();
        decimal running = 0;
        foreach (var (material, quantity, value) in measured)
        {
            var before = total > 0 ? running * 100 / total : 100;
            running += value;
            var abc = value <= 0 ? AbcClass.C : before < ClassALimit ? AbcClass.A : before < ClassBLimit ? AbcClass.B : AbcClass.C;
            var size = material.PurchaseUnitSize;
            var daily = quantity / days;
            decimal? onHandDays = daily > 0 ? Math.Round(Math.Max(material.QuantityOnHand, 0) / daily, 1, MidpointRounding.AwayFromZero) : null;
            var category = categories.GetValueOrDefault(material.CategoryId);
            rows.Add(new AbcRow(
                material.Id, material.Code, material.Name, material.CategoryId, category?.Name, category?.NameAr, material.PurchaseUnit,
                Quantity(quantity / size), Money(value), total > 0 ? Percent(value / total) : 0, total > 0 ? Percent(running / total) : 0, abc,
                Quantity(material.QuantityOnHand / size), Money(Math.Max(material.QuantityOnHand, 0) * material.AverageCost),
                Quantity(daily / size), onHandDays, onHandDays < StockoutDays, quantity == 0 && material.QuantityOnHand > 0));
        }

        var dead = rows.Where(r => r.DeadStock).ToList();
        return new AbcReport(
            from, to, days, Money(total),
            Enum.GetValues<AbcClass>().Select(c =>
            {
                var of = rows.Where(r => r.Class == c).ToList();
                var worth = of.Sum(r => r.ConsumptionValue);
                return new AbcClassSummary(c, of.Count, Money(worth), total > 0 ? Percent(worth / total) : 0);
            }).ToList(),
            rows.Count(r => r.StockoutRisk), dead.Count, Money(dead.Sum(r => r.StockValue ?? 0)), Money(rows.Sum(r => r.StockValue ?? 0)), rows);
    }

    // ---- What the reports share ----

    // A sold line as the recipes see it: a dish, its size, its add-ons.
    private sealed record SaleKey(int MenuItemId, int? VariantId, string AddOns)
    {
        public SoldItem Item(int quantity) =>
            new(MenuItemId, VariantId, AddOns.Length == 0 ? [] : AddOns.Split(',').Select(int.Parse).ToList(), quantity);
    }

    private sealed record Sold(SaleKey Key, string Name, decimal Quantity);

    // A dish or add-on the recipes sell by: its name, and its price (none for one priced by its add-ons).
    private sealed record Target(string Name, string? NameAr, decimal? Price, bool Sold);

    // What a report reads the recipes and materials from, loaded once.
    private sealed class Catalog(
        IReadOnlyDictionary<Guid, RawMaterial> materials,
        IReadOnlyDictionary<Guid, PurchaseCategory> categories,
        IReadOnlyList<Recipe> recipes,
        IReadOnlyList<PrepRecipe> prepRecipes,
        IReadOnlyDictionary<RecipeTarget, Target> targets)
    {
        private readonly Dictionary<SaleKey, IReadOnlyDictionary<Guid, decimal>> _requirements = [];
        private readonly IReadOnlyDictionary<RecipeTarget, Recipe> _active =
            recipes.Where(r => !r.IsDeleted && r.Target is not null).ToDictionary(r => r.Target!.Value);

        public IReadOnlyDictionary<Guid, RawMaterial> Materials => materials;
        public IReadOnlyList<Recipe> Recipes => recipes;
        public IReadOnlyDictionary<RecipeTarget, Target> Targets => targets;
        public MaterialExplosion Explosion { get; } = new(prepRecipes);
        public RecipeCosts Costs { get; } = new(materials, prepRecipes);

        public string? CategoryName(Guid id) => categories.GetValueOrDefault(id)?.Name;
        public string? CategoryAr(Guid id) => categories.GetValueOrDefault(id)?.NameAr;

        // The recipe a dish or its size sells by: the size's own, or the dish's.
        public Recipe? RecipeFor(int menuItemId, int? variantId) =>
            (variantId is { } v ? _active.GetValueOrDefault(RecipeTarget.ForVariant(menuItemId, v)) : null)
            ?? _active.GetValueOrDefault(RecipeTarget.ForMenuItem(menuItemId));

        // What one of a sold line takes by the recipes, as stock keeps it: prep items still whole.
        public IReadOnlyDictionary<Guid, decimal> Requirements(SaleKey key)
        {
            if (!_requirements.TryGetValue(key, out var per))
                _requirements[key] = per = StockRequirements.For(key.Item(1), recipes);
            return per;
        }
    }

    private async Task<Catalog> CatalogAsync(CancellationToken cancellationToken)
    {
        var materials = await db.RawMaterials.AsNoTracking().ToDictionaryAsync(m => m.Id, cancellationToken);
        var categories = await db.PurchaseCategories.AsNoTracking().ToDictionaryAsync(c => c.Id, cancellationToken);
        var recipes = await db.Recipes.AsNoTracking().Include(r => r.Ingredients).ToListAsync(cancellationToken);
        var prepRecipes = await db.PrepRecipes.AsNoTracking().Include(r => r.Ingredients).ToListAsync(cancellationToken);

        // The menu as the recipes sell by it: each dish, each of its sizes, each add-on.
        var items = await db.MenuItems.AsNoTracking().Where(m => !m.IsDeleted).ToListAsync(cancellationToken);
        var variants = (await db.MenuItemVariants.AsNoTracking().ToListAsync(cancellationToken)).ToLookup(v => v.MenuItemId);
        var addOns = await db.AddOns.AsNoTracking().ToListAsync(cancellationToken);
        var targets = new Dictionary<RecipeTarget, Target>();
        foreach (var item in items)
        {
            var sizes = variants[item.Id].ToList();
            targets[RecipeTarget.ForMenuItem(item.Id)] = new Target(item.Name, item.NameAr, sizes.Count > 0 || item.IsPriceBasedOnAddons ? null : item.Price, sizes.Count == 0);
            foreach (var size in sizes)
                targets[RecipeTarget.ForVariant(item.Id, size.Id)] = new Target(
                    $"{item.Name} ({size.Name})", item.NameAr is null ? null : $"{item.NameAr} ({size.NameAr ?? size.Name})", size.Price, true);
        }
        foreach (var addOn in addOns)
            targets[RecipeTarget.ForAddOn(addOn.Id)] = new Target(addOn.Name, addOn.NameAr, addOn.Price, false);

        return new Catalog(materials, categories, recipes, prepRecipes, targets);
    }

    // The period's sales, each dish, size and add-ons together: what was sold on the bill.
    private async Task<IReadOnlyList<Sold>> SoldAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken)
    {
        var (fromUtc, _) = clock.Bounds(from);
        var (_, toUtc) = clock.Bounds(to);
        return (await ledger.GetAsync(fromUtc, toUtc, cancellationToken))
            .SelectMany(o => o.Lines)
            .Where(l => l.OnBill && l.Quantity > 0)
            .GroupBy(l => new SaleKey(l.MenuItemId, l.VariantId, string.Join(",", l.AddOnIds.Order())))
            .Select(g => new Sold(g.Key, g.First().VariantName is { } size ? $"{g.First().MenuItemName} ({size})" : g.First().MenuItemName, g.Sum(l => l.Quantity)))
            .ToList();
    }

    // A material's book stock either side of a period and what moved it in between, by why.
    private sealed class Stock(IReadOnlyDictionary<Guid, decimal> before, IReadOnlyDictionary<(Guid, StockMovementReason), decimal> moved)
    {
        public decimal Moved(Guid id, StockMovementReason reason) => moved.GetValueOrDefault((id, reason));

        // An opening count in the period is where its stock began, not something bought.
        public decimal Opening(Guid id) => before.GetValueOrDefault(id) + Moved(id, StockMovementReason.OpeningStock);

        public decimal Closing(Guid id) => before.GetValueOrDefault(id) + moved.Where(m => m.Key.Item1 == id).Sum(m => m.Value);

        public decimal Wasted(Guid id) => -WasteReasons.Sum(r => Moved(id, r));
    }

    private async Task<Stock> StockAsync(DateTime fromUtc, DateTime toUtc, CancellationToken cancellationToken)
    {
        var before = await db.StockMovements.AsNoTracking()
            .Where(m => m.OccurredAtUtc < fromUtc)
            .GroupBy(m => m.RawMaterialId)
            .Select(g => new { g.Key, Quantity = g.Sum(m => m.Quantity) })
            .ToDictionaryAsync(x => x.Key, x => x.Quantity, cancellationToken);
        var moved = await db.StockMovements.AsNoTracking()
            .Where(m => m.OccurredAtUtc >= fromUtc && m.OccurredAtUtc < toUtc)
            .GroupBy(m => new { m.RawMaterialId, m.Reason })
            .Select(g => new { g.Key.RawMaterialId, g.Key.Reason, Quantity = g.Sum(m => m.Quantity) })
            .ToListAsync(cancellationToken);
        return new Stock(before, moved.ToDictionary(m => (m.RawMaterialId, m.Reason), m => m.Quantity));
    }

    // A posted invoice's stock line: when it was bought (the paper's date, or the day it was posted),
    // how much in the material's own unit, the net price a unit, from whom.
    private sealed record Bought(Guid InvoiceId, Guid RawMaterialId, DateOnly Date, DateTime PostedAtUtc, decimal Quantity, decimal? UnitCost, Guid? SupplierId);

    private async Task<IReadOnlyList<Bought>> PurchasesAsync(CancellationToken cancellationToken)
    {
        var lines = await db.PurchaseInvoices.AsNoTracking()
            .Where(i => i.Status == PurchaseInvoiceStatus.Posted)
            .SelectMany(i => i.Lines.Where(l => l.RawMaterialId != null && l.Quantity > 0),
                (i, l) => new { i.Id, l.RawMaterialId, i.InvoiceDate, i.PostedAtUtc, l.Quantity, l.Cost, i.SupplierId })
            .ToListAsync(cancellationToken);
        return lines.Select(l => new Bought(
                l.Id, l.RawMaterialId!.Value, l.InvoiceDate ?? clock.BusinessDateOf(l.PostedAtUtc!.Value), l.PostedAtUtc!.Value, l.Quantity,
                l.Cost is { } cost ? cost / l.Quantity : null, l.SupplierId))
            .ToList();
    }

    // The latest net price paid a unit for each material, and who sold it.
    private async Task<IReadOnlyDictionary<Guid, Bought>> LatestPricesAsync(CancellationToken cancellationToken) =>
        (await PurchasesAsync(cancellationToken))
            .Where(p => p.UnitCost is not null)
            .GroupBy(p => p.RawMaterialId)
            .ToDictionary(g => g.Key, g => g.OrderBy(p => p.Date).ThenBy(p => p.PostedAtUtc).Last());

    private (DateTime FromUtc, DateTime ToUtc) Period(DateOnly from, DateOnly to)
    {
        if (to < from)
            throw new DomainException("The first day must come before the last. · اليوم الأول قبل الأخير.");
        if (to > from.AddYears(2))
            throw new DomainException("Choose two years at most. · سنتان على الأكثر.");
        return (clock.Bounds(from).FromUtc, clock.Bounds(to).ToUtc);
    }

    private static decimal Quantity(decimal value) => Math.Round(value, 3, MidpointRounding.AwayFromZero);
}
