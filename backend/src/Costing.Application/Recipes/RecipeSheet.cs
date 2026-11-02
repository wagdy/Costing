using System.Text.RegularExpressions;
using MediatR;
using Costing.Domain.Common;
using Costing.Application.Common;
using Costing.Application.RawMaterials;
using Costing.Domain.Approvals;
using Costing.Domain.Menu;
using Costing.Domain.Production;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;

namespace Costing.Application.Recipes;

// Recipes to and from a spreadsheet: every recipe written out a row per ingredient (the export,
// GetRecipeSheetQuery), and a sheet read back in (ImportRecipesCommand), the template's, an export
// edited, or one from another installation.
//
// A recipe is named on each of its rows (a blank name is the row above's): a menu item, a size of
// it or an add-on by its code as the dropdown writes it ("6101 · Margherita", "6101-2 · Margherita
// (Large)", "A3 · Extra cheese"), or by its name; else a recipe off the menu by its name, a new one
// for a name not used yet. Each ingredient is chosen from the materials and prep items, its
// quantity written in its own unit as its label says (Kg, Liter, Piece): 0.2 for 200 g.
//
// A recipe's rows replace its whole ingredient list; its portions and category, written on any of
// its rows, change only when given. A recipe with a row that cannot be read is left as it was,
// whole, and each such row said why in English and Arabic: never half its ingredients. Nothing on
// the sheet is a cost: what each recipe costs is worked out from its ingredients' prices now.

public sealed record RecipeSheetRow(int Row, string? Item, string? Ingredient, string? Quantity, string? Portions = null, string? Category = null);

// One row written out: the recipe as the sheet names it, an ingredient by its label, the quantity
// in that ingredient's unit; the portions and category on a recipe's first row.
public sealed record RecipeSheetLine(string Item, string Ingredient, decimal Quantity, int? Portions, string? Category);

// What the sheet is written from: its rows, and its dropdowns' lists (the recipes and menu items,
// the ingredients with their units, the kitchen's recipe categories).
public sealed record RecipeSheet(
    IReadOnlyList<RecipeSheetLine> Lines, IReadOnlyList<string> Items, IReadOnlyList<SheetIngredient> Ingredients, IReadOnlyList<string> Categories);

public sealed record ImportedSheetItem(int Row, Guid Id, string Name);

public sealed record RecipeImportResult(
    IReadOnlyList<ImportedSheetItem> Created,
    IReadOnlyList<UpdatedSheetItem> Updated,
    int Unchanged,
    IReadOnlyList<SkippedSheetRow> Skipped,
    IReadOnlyList<string> CategoriesAdded,
    IReadOnlyList<CostedSheetItem> Costed,
    int Requested = 0);

public sealed record GetRecipeSheetQuery : IRequest<RecipeSheet>;

public sealed record ImportRecipesCommand(IReadOnlyList<RecipeSheetRow> Rows) : IRequest<RecipeImportResult>;

// The menu's items, sizes and add-ons as a recipes sheet names them: by code and name, "6101 ·
// Margherita", or by name alone, in English or Arabic.
internal sealed partial class MenuTargets
{
    private readonly Dictionary<RecipeTarget, string> _labels = [];
    private readonly Dictionary<string, List<RecipeTarget>> _byName = [];
    private readonly HashSet<RecipeTarget> _live = [];

    public MenuTargets(IReadOnlyList<MenuItem> items, IReadOnlyList<AddOn> addOns)
    {
        foreach (var item in items.Where(i => !i.IsDeleted).OrderBy(i => i.Id))
        {
            Add(RecipeTarget.ForMenuItem(item.Id), $"{item.Id} · {item.Name}", item.Name, item.NameAr);
            foreach (var variant in item.Variants.OrderBy(v => v.DisplayOrder))
                Add(RecipeTarget.ForVariant(item.Id, variant.Id), $"{item.Id}-{variant.Id} · {item.Name} ({variant.Name})", $"{item.Name} ({variant.Name})",
                    item.NameAr is null ? null : $"{item.NameAr} ({variant.NameAr ?? variant.Name})");
        }
        foreach (var addOn in addOns.Where(a => !a.IsDeleted).OrderBy(a => a.Id))
            Add(RecipeTarget.ForAddOn(addOn.Id), $"A{addOn.Id} · {addOn.Name}", addOn.Name, addOn.NameAr);
    }

    public IReadOnlyCollection<string> Labels => _labels.Values;

    public string? LabelOf(RecipeTarget target) => _labels.GetValueOrDefault(target);

    // A menu target by its code, written as the dropdown does or alone; by its name else. Found:
    // the target; a code not on the menu or a name two share: why not; neither: no target.
    public (RecipeTarget? Target, string? Reason, string? ReasonAr) Find(string text)
    {
        if (Code().Match(text) is { Success: true } coded)
        {
            var code = coded.Groups["code"].Value;
            var target = code.StartsWith('A') || code.StartsWith('a')
                ? RecipeTarget.ForAddOn(int.Parse(code[1..]))
                : coded.Groups["variant"].Success
                    ? RecipeTarget.ForVariant(int.Parse(coded.Groups["item"].Value), int.Parse(coded.Groups["variant"].Value))
                    : RecipeTarget.ForMenuItem(int.Parse(coded.Groups["item"].Value));
            return _live.Contains(target)
                ? (target, null, null)
                : (null, $"{code.ToUpperInvariant()} is not on the menu: choose the item from the list, or add it on Menu first.",
                    $"{code.ToUpperInvariant()} ليس في المنيو: اختر الصنف من القائمة، أو أضفه في المنيو أولًا.");
        }

        if (_byName.TryGetValue(SheetText.Key(text), out var named))
            return named.Count == 1
                ? (named[0], null, null)
                : (null, $"More than one menu item is called {text}: choose the one you mean from the list, by its code.",
                    $"يوجد أكثر من صنف باسم {text}: اختر المقصود من القائمة بكوده.");
        return (null, null, null);
    }

    private void Add(RecipeTarget target, string label, string name, string? nameAr)
    {
        _labels[target] = label;
        _live.Add(target);
        foreach (var each in new[] { name, nameAr }.OfType<string>().Select(SheetText.Key).Distinct())
        {
            if (!_byName.TryGetValue(each, out var list))
                _byName[each] = list = [];
            list.Add(target);
        }
    }

    // 6101, 6101-2, A3, alone or before " · " and a name.
    [GeneratedRegex(@"^(?<code>(?<item>\d+)(-(?<variant>\d+))?|[Aa]\d+)(\s*·.*)?$")]
    private static partial Regex Code();
}

internal sealed class GetRecipeSheetHandler(
    IRecipeRepository recipes, IRecipeCategoryRepository categories, IRawMaterialRepository materials, IMenuRepository menu)
    : IRequestHandler<GetRecipeSheetQuery, RecipeSheet>
{
    public async Task<RecipeSheet> Handle(GetRecipeSheetQuery request, CancellationToken cancellationToken)
    {
        var all = await materials.GetAllAsync(cancellationToken);
        var byId = all.ToDictionary(m => m.Id);
        var lookup = new IngredientLookup(all);
        var targets = new MenuTargets(await menu.GetItemsAsync(cancellationToken), await menu.GetAddOnsAsync(cancellationToken));
        var kitchen = (await categories.GetAllAsync(cancellationToken)).OrderBy(c => c.Name, StringComparer.CurrentCultureIgnoreCase).ToList();
        var categoryNames = kitchen.ToDictionary(c => c.Id, c => c.Name);
        var active = (await recipes.GetAllAsync(cancellationToken)).Where(r => !r.IsDeleted).ToList();

        var lines = new List<RecipeSheetLine>();
        foreach (var (recipe, name) in active.Select(r => (r, Name: NameOf(r, targets))).OrderBy(x => x.Name, StringComparer.CurrentCultureIgnoreCase))
        {
            var first = true;
            foreach (var ingredient in recipe.Ingredients
                         .Where(i => byId.ContainsKey(i.RawMaterialId))
                         .OrderBy(i => byId[i.RawMaterialId].Name, StringComparer.CurrentCultureIgnoreCase))
            {
                var material = byId[ingredient.RawMaterialId];
                lines.Add(new RecipeSheetLine(
                    name, lookup.LabelOf(material), SheetNumbers.InSheetUnit(ingredient.Quantity, material.Unit),
                    first ? recipe.Portions : null,
                    first && recipe.RecipeCategoryId is { } category ? categoryNames.GetValueOrDefault(category) : null));
                first = false;
            }
        }

        var items = targets.Labels
            .Concat(active.Where(r => !r.IsLinked).Select(r => r.Name!))
            .Distinct()
            .OrderBy(n => n, StringComparer.CurrentCultureIgnoreCase)
            .ToList();
        return new RecipeSheet(lines, items, lookup.Offered, kitchen.Select(c => c.Name).ToList());
    }

    // As the sheet names it: its menu target's code and name, its own name off the menu. One
    // linked to an item no longer on the menu keeps its code, to be told so on import.
    internal static string NameOf(Recipe recipe, MenuTargets targets) =>
        recipe.Target is { } target
            ? targets.LabelOf(target) ?? $"{(target.Kind == RecipeTargetKind.AddOn ? $"A{target.CatalogItemId}" : target.VariantId is { } v ? $"{target.CatalogItemId}-{v}" : $"{target.CatalogItemId}")} · {recipe.Name ?? "not on the menu"}"
            : recipe.Name!;
}

internal sealed class ImportRecipesHandler(
    IRecipeRepository recipes,
    IRecipeCategoryRepository categories,
    IRawMaterialRepository materials,
    IPrepRecipeRepository prepRecipes,
    IMenuRepository menu,
    IApprovalRequestRepository approvals,
    IUnitOfWork unitOfWork)
    : IRequestHandler<ImportRecipesCommand, RecipeImportResult>
{
    public const int MaxRows = 5000;
    private const int MaxNameLength = 200;

    // A recipe's rows, by the name on its first.
    private sealed record Group(int Row, string Name, List<RecipeSheetRow> Rows);

    public async Task<RecipeImportResult> Handle(ImportRecipesCommand request, CancellationToken cancellationToken)
    {
        if (request.Rows.Count == 0)
            throw new DomainException("The sheet has no recipes on it: a recipe's name, an ingredient and its quantity on each row. · لا توجد وصفات في الملف.");
        if (request.Rows.Count > MaxRows)
            throw new DomainException($"Import at most {MaxRows:N0} rows at a time: split the sheet. · استورد {MaxRows:N0} صف على الأكثر في المرة.");

        var all = await materials.GetAllAsync(cancellationToken);
        var lookup = new IngredientLookup(all);
        var targets = new MenuTargets(await menu.GetItemsAsync(cancellationToken), await menu.GetAddOnsAsync(cancellationToken));
        var every = await recipes.GetAllAsync(cancellationToken);
        var byTarget = every.Where(r => !r.IsDeleted && r.Target is not null).ToDictionary(r => r.Target!.Value);
        var offMenu = every.Where(r => !r.IsLinked && r.Name is not null).GroupBy(r => SheetText.Key(r.Name!))
            .ToDictionary(g => g.Key, g => g.OrderBy(r => r.IsDeleted).First());
        var pending = (await approvals.GetPendingAsync(cancellationToken)).Select(r => r.RecordId).ToHashSet();
        var kitchen = new Dictionary<string, RecipeCategory>();
        foreach (var category in await categories.GetAllAsync(cancellationToken))
        {
            kitchen.TryAdd(RecipeCategory.Normalize(category.Name), category);
            if (category.NameAr is { } ar)
                kitchen.TryAdd(RecipeCategory.Normalize(ar), category);
        }

        var created = new List<ImportedSheetItem>();
        var updated = new List<UpdatedSheetItem>();
        var toCost = new List<(int Row, string Name, Recipe Recipe, List<string> Notes)>();
        var skipped = new List<SkippedSheetRow>();
        var added = new List<string>();
        var unchanged = 0;
        // Each recipe once: by what it is, the first group naming it.
        var seen = new Dictionary<string, int>();

        foreach (var group in Groups(request.Rows, skipped))
        {
            void Skip(string reason, string reasonAr) => skipped.Add(new SkippedSheetRow(group.Row, group.Name, reason, reasonAr));

            if (group.Name.Length > MaxNameLength)
            {
                Skip($"The name is longer than {MaxNameLength} characters.", $"الاسم أطول من {MaxNameLength} حرف.");
                continue;
            }

            // What it is: a menu target, a recipe off the menu, or a new one.
            var (target, targetReason, targetReasonAr) = targets.Find(group.Name);
            if (targetReason is not null)
            {
                Skip(targetReason, targetReasonAr!);
                continue;
            }

            Recipe? recipe;
            string identity;
            if (target is { } t)
            {
                recipe = byTarget.GetValueOrDefault(t);
                identity = $"T{t}";
            }
            else if (offMenu.TryGetValue(SheetText.Key(group.Name), out var own))
            {
                if (own.IsDeleted)
                {
                    Skip($"{own.Name} was deleted: restore it from the deleted recipes, or give the row another name.",
                        $"{own.Name} محذوفة: استرجعها من الوصفات المحذوفة، أو اكتب اسمًا آخر.");
                    continue;
                }
                recipe = own;
                identity = $"R{own.Id}";
            }
            else
            {
                recipe = null;
                identity = $"N{SheetText.Key(group.Name)}";
            }

            if (seen.TryGetValue(identity, out var firstRow))
            {
                Skip($"Also on row {firstRow}, which is the one imported.", $"مكرر في الصف {firstRow}، وهو الذي استُورد.");
                continue;
            }
            seen[identity] = group.Row;
            if (recipe is not null && pending.Contains(recipe.Id))
            {
                Skip($"{group.Name} waits for a manager's approval: import it again once that is decided.",
                    $"{group.Name} بانتظار موافقة المدير: استوردها مرة أخرى بعد البت فيها.");
                continue;
            }

            // Its portions and category, from any of its rows.
            var portionsText = group.Rows.Select(r => SheetText.Clean(r.Portions)).FirstOrDefault(p => p is not null);
            int? portions = null;
            if (portionsText is not null)
            {
                if (SheetText.Amount(portionsText) is not { } p || p < 1 || p != decimal.Truncate(p) || p > 10_000)
                {
                    Skip($"\"{portionsText}\" is not a number of portions: a whole number, 1 or more.", $"\"{portionsText}\" ليس عدد حصص: رقم صحيح 1 أو أكثر.");
                    continue;
                }
                portions = (int)p;
            }
            var categoryName = group.Rows.Select(r => SheetText.Clean(r.Category)).FirstOrDefault(c => c is not null);
            if (categoryName?.Length > 100)
            {
                Skip("The category's name is longer than 100 characters.", "اسم القسم أطول من 100 حرف.");
                continue;
            }

            // Its ingredients: every row read, or none of them taken.
            var lines = group.Rows.Where(r => SheetText.Clean(r.Ingredient) is not null || SheetText.Clean(r.Quantity) is not null)
                .Select(r => lookup.Read(r.Row, r.Ingredient, r.Quantity))
                .ToList();
            if (lines.Count == 0)
            {
                if (recipe is not null)
                    unchanged++;
                else
                    Skip("No ingredients under it: choose at least one, with its quantity.", "لا توجد مكونات: اختر مكوّنًا واحدًا على الأقل بكميته.");
                continue;
            }
            if (lines.Any(l => l.Reason is not null))
            {
                foreach (var bad in lines.Where(l => l.Reason is not null))
                    skipped.Add(new SkippedSheetRow(bad.Row, group.Name, $"{bad.Reason} The recipe is left as it was.", $"{bad.ReasonAr} لم تُغيَّر الوصفة."));
                continue;
            }

            // The same ingredient twice: its quantities added together, and said.
            var notes = new List<string>();
            var quantities = new Dictionary<Guid, decimal>();
            foreach (var line in lines)
            {
                if (quantities.ContainsKey(line.Material!.Id))
                    notes.Add($"{line.Material.Name} is on it twice: the quantities are added together. · المكوّن مكرر: جُمعت الكميات.");
                quantities[line.Material.Id] = quantities.GetValueOrDefault(line.Material.Id) + line.Quantity;
            }
            var byMaterial = lines.Select(l => l.Material!).DistinctBy(m => m.Id).ToDictionary(m => m.Id);
            var portionsNow = portions ?? recipe?.Portions ?? 1;
            foreach (var (id, quantity) in quantities)
            {
                var material = byMaterial[id];
                if (material.Unit != UnitOfMeasure.Piece && quantity / SheetUnits.Factor(material.Unit) / portionsNow > 5)
                    notes.Add($"{material.Name}: {SheetNumbers.Plain(quantity / SheetUnits.Factor(material.Unit) / portionsNow)} {SheetUnits.Name(material.Unit)} a portion. " +
                              $"Was it written in grams? On this sheet 0.2 is 200 g. · تأكد أن الكمية ليست بالجرام.");
            }

            // Its category: one of the kitchen's, or a new one, added.
            RecipeCategory? category = null;
            if (categoryName is not null && !kitchen.TryGetValue(RecipeCategory.Normalize(categoryName), out category))
            {
                category = new RecipeCategory(Guid.NewGuid(), categoryName);
                categories.Add(category);
                kitchen[RecipeCategory.Normalize(categoryName)] = category;
                added.Add(category.Name);
            }

            var ingredients = quantities.Select(q => new RecipeIngredientDto(q.Key, q.Value)).ToList();
            if (recipe is null)
            {
                recipe = target is { } linked ? new Recipe(null, category?.Id, null, linked) : new Recipe(group.Name, category?.Id, null, null);
                recipes.Add(recipe);
                if (recipe.Target is { } newTarget)
                    byTarget[newTarget] = recipe;
                else
                    offMenu[SheetText.Key(group.Name)] = recipe;
                await recipe.WriteAsync(materials, ingredients, portionsNow, cancellationToken);
                created.Add(new ImportedSheetItem(group.Row, recipe.Id, group.Name));
            }
            else
            {
                var changes = new List<string>();
                var before = recipe.Ingredients.ToDictionary(i => i.RawMaterialId, i => i.Quantity);
                if (before.Count != quantities.Count || quantities.Any(q => !before.TryGetValue(q.Key, out var was) || Math.Round(was, 4) != Math.Round(q.Value, 4)))
                    changes.Add("Ingredients");
                if (portionsNow != recipe.Portions)
                    changes.Add("Portions");
                if (category is not null && category.Id != recipe.RecipeCategoryId)
                {
                    recipe.MoveTo(category.Id);
                    changes.Add("Category");
                }
                if (changes.Count == 0)
                {
                    unchanged++;
                    continue;
                }
                await recipe.WriteAsync(materials, ingredients, portionsNow, cancellationToken);
                updated.Add(new UpdatedSheetItem(group.Row, recipe.Id, group.Name, changes));
            }

            toCost.Add((group.Row, group.Name, recipe, notes));
        }

        if (created.Count > 0 || updated.Count > 0)
            await unitOfWork.SaveChangesAsync(cancellationToken);
        var costs = new RecipeCosts(all.ToDictionary(m => m.Id), await prepRecipes.GetAllAsync(cancellationToken));
        var costed = toCost.Select(c => Cost(c.Row, c.Name, c.Recipe, costs, c.Notes)).ToList();
        return new RecipeImportResult(created, updated, unchanged, skipped.OrderBy(s => s.Row).ToList(), added, costed);
    }

    // The rows by recipe, in the order their names first come: a row with no name is the one
    // above's; ingredients above any name are said so.
    private static List<Group> Groups(IReadOnlyList<RecipeSheetRow> rows, List<SkippedSheetRow> skipped)
    {
        var groups = new Dictionary<string, Group>();
        Group? current = null;
        foreach (var row in rows.OrderBy(r => r.Row))
        {
            if (SheetText.Clean(row.Item) is { } name)
            {
                if (!groups.TryGetValue(SheetText.Key(name), out current))
                    groups[SheetText.Key(name)] = current = new Group(row.Row, name, []);
            }
            else if (current is null)
            {
                skipped.Add(new SkippedSheetRow(row.Row, null, "No recipe named on this row or above it.", "لا توجد وصفة مسماة في هذا الصف أو فوقه."));
                continue;
            }
            current.Rows.Add(row);
        }

        return groups.Values.ToList();
    }

    // What it costs now: each ingredient as purchased (its yield lost) at its average cost, a prep
    // item never made yet by its own recipe.
    private static CostedSheetItem Cost(int row, string name, Recipe recipe, RecipeCosts costs, List<string> notes)
    {
        var missing = recipe.Ingredients.SelectMany(i => costs.Of(i.RawMaterialId).Missing).Distinct().ToList();
        var cost = recipe.Ingredients.Sum(i => i.AsPurchasedQuantity * (costs.Of(i.RawMaterialId).PerUnit ?? 0));
        return new CostedSheetItem(row, name, recipe.Ingredients.Count, SheetNumbers.Money(cost), SheetNumbers.Money(cost / recipe.Portions), "portion", missing, notes);
    }
}
