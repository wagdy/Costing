using MediatR;
using Costing.Domain.Common;
using Costing.Application.Approvals;
using Costing.Application.Categories;
using Costing.Application.Common;
using Costing.Application.RawMaterials;
using Costing.Application.Recipes;
using Costing.Domain.Approvals;
using Costing.Domain.Categories;
using Costing.Domain.Production;
using Costing.Domain.RawMaterials;

namespace Costing.Application.Production;

// Prep items' batch recipes to and from a spreadsheet, as the dishes' are (RecipeSheet): every
// prep item written out a row per ingredient, and a sheet read back in. A prep item is named on
// each of its rows (a blank name is the row above's): one already kept is changed, a new name
// adds one. Each ingredient is chosen from the materials and prep items, its quantity for one
// batch in its own unit as its label says: 0.2 for 200 g. What one batch makes, and the unit a new
// prep item is kept in (Kg unless said), go on any of its rows.
//
// A prep item's rows replace its whole recipe, each ingredient keeping its yield; a blank batch
// leaves it as it was, and a new one's is the weight of its ingredients. One with a row that
// cannot be read is left as it was, whole. A prep item made with another new one on the sheet is
// made after it. A manager's import saves at once; anyone else's asks a manager for each, as
// changing one by hand does. Nothing on the sheet is a cost: what a batch costs is worked out.

public sealed record PrepRecipeSheetRow(int Row, string? Item, string? Ingredient, string? Quantity, string? Makes = null, string? Unit = null);

// One row written out: the prep item, an ingredient by its label and its quantity for one batch;
// what a batch makes and the unit it is kept in on its first row. A prep item with no recipe yet
// is a row of its own, with no ingredient.
public sealed record PrepRecipeSheetLine(string Item, string? Ingredient, decimal? Quantity, decimal? Makes, string? Unit);

public sealed record PrepRecipeSheet(IReadOnlyList<PrepRecipeSheetLine> Lines, IReadOnlyList<string> Items, IReadOnlyList<SheetIngredient> Ingredients);

public sealed record GetPrepRecipeSheetQuery : IRequest<PrepRecipeSheet>;

public sealed record ImportPrepRecipesCommand(IReadOnlyList<PrepRecipeSheetRow> Rows, string StaffId, string StaffName, bool CanApprove)
    : IRequest<RecipeImportResult>;

internal sealed class GetPrepRecipeSheetHandler(IRawMaterialRepository materials, IPrepRecipeRepository recipes)
    : IRequestHandler<GetPrepRecipeSheetQuery, PrepRecipeSheet>
{
    public async Task<PrepRecipeSheet> Handle(GetPrepRecipeSheetQuery request, CancellationToken cancellationToken)
    {
        var all = await materials.GetAllAsync(cancellationToken);
        var byId = all.ToDictionary(m => m.Id);
        var lookup = new IngredientLookup(all);
        var byItem = (await recipes.GetAllAsync(cancellationToken)).ToDictionary(r => r.PrepItemId);
        var items = all.Where(m => m.IsPrepItem && !m.IsArchived).OrderBy(m => m.Name, StringComparer.CurrentCultureIgnoreCase).ToList();

        var lines = new List<PrepRecipeSheetLine>();
        foreach (var item in items)
        {
            var recipe = byItem.GetValueOrDefault(item.Id);
            var unit = SheetUnits.Name(item.Unit);
            var makes = recipe is null ? (decimal?)null : SheetNumbers.InSheetUnit(recipe.BatchQuantity, item.Unit);
            var ingredients = (recipe?.Ingredients ?? [])
                .Where(i => byId.ContainsKey(i.RawMaterialId))
                .OrderBy(i => byId[i.RawMaterialId].Name, StringComparer.CurrentCultureIgnoreCase)
                .ToList();
            if (ingredients.Count == 0)
            {
                lines.Add(new PrepRecipeSheetLine(item.Name, null, null, makes, unit));
                continue;
            }
            var first = true;
            foreach (var ingredient in ingredients)
            {
                var material = byId[ingredient.RawMaterialId];
                lines.Add(new PrepRecipeSheetLine(
                    item.Name, lookup.LabelOf(material), SheetNumbers.InSheetUnit(ingredient.Quantity, material.Unit), first ? makes : null, first ? unit : null));
                first = false;
            }
        }

        return new PrepRecipeSheet(lines, items.Select(i => i.Name).ToList(), lookup.Offered);
    }
}

internal sealed class ImportPrepRecipesHandler(
    IRawMaterialRepository materials,
    IPrepRecipeRepository recipes,
    IPurchaseCategoryRepository categories,
    IApprovalRequestRepository requests,
    PrepItemWriter writer,
    IUnitOfWork unitOfWork) : IRequestHandler<ImportPrepRecipesCommand, RecipeImportResult>
{
    public const int MaxRows = 5000;
    private const int MaxNameLength = 200;

    private sealed class Plan(int row, string name, RawMaterial? existing, UnitOfMeasure unit, decimal? makes, List<PrepRecipeSheetRow> rows)
    {
        public int Row { get; } = row;
        public string Name { get; } = name;
        public RawMaterial? Existing { get; } = existing;
        public UnitOfMeasure Unit { get; } = unit;
        public decimal? Makes { get; } = makes;
        public List<PrepRecipeSheetRow> Rows { get; } = rows;
        // Its id: the one kept, or the new one's, given now so that others on the sheet can name it.
        public Guid Id { get; } = existing?.Id ?? Guid.NewGuid();
        public List<SheetLine> Lines { get; set; } = [];
        public List<string> Notes { get; } = [];
    }

    public async Task<RecipeImportResult> Handle(ImportPrepRecipesCommand request, CancellationToken cancellationToken)
    {
        if (request.Rows.Count == 0)
            throw new DomainException("The sheet has no prep items on it: a prep item's name, an ingredient and its quantity on each row. · لا توجد أصناف مُصنَّعة في الملف.");
        if (request.Rows.Count > MaxRows)
            throw new DomainException($"Import at most {MaxRows:N0} rows at a time: split the sheet. · استورد {MaxRows:N0} صف على الأكثر في المرة.");

        var all = await materials.GetAllAsync(cancellationToken);
        var byName = new Dictionary<string, RawMaterial>();
        foreach (var material in all.OrderBy(m => m.IsArchived))
            byName.TryAdd(SheetText.Key(material.Name), material);
        var recipesById = (await recipes.GetAllAsync(cancellationToken)).ToDictionary(r => r.PrepItemId);
        var pendingRecords = new HashSet<Guid>();
        var pendingNames = new HashSet<string>();
        foreach (var pending in await requests.GetPendingAsync(cancellationToken))
        {
            pendingRecords.Add(pending.RecordId);
            if (pending is { Module: ApprovalModule.PrepItem, Action: ApprovalAction.Create })
                pendingNames.Add(SheetText.Key(ApprovalPayload.Read<PrepItemChange>(pending).Name));
        }

        var skipped = new List<SkippedSheetRow>();
        var plans = Plans(request.Rows, byName, pendingRecords, pendingNames, skipped);

        // Each new prep item named before its rows are read: another on the sheet may be made with it.
        var placeholders = plans.Where(p => p.Existing is null).Select(p => new RawMaterial(p.Name, p.Unit, kind: MaterialKind.Prep, id: p.Id)).ToList();
        var lookup = new IngredientLookup(all.Concat(placeholders));
        var newIds = placeholders.Select(p => p.Id).ToHashSet();
        foreach (var plan in plans.ToList())
        {
            plan.Lines = plan.Rows.Where(r => SheetText.Clean(r.Ingredient) is not null || SheetText.Clean(r.Quantity) is not null)
                .Select(r => lookup.Read(r.Row, r.Ingredient, r.Quantity))
                .Select(l => l.Material?.Id == plan.Id ? l with { Reason = "A prep item is not made from itself.", ReasonAr = "لا يُصنع الصنف من نفسه." } : l)
                .ToList();
            if (plan.Lines.Any(l => l.Reason is not null))
            {
                foreach (var bad in plan.Lines.Where(l => l.Reason is not null))
                    skipped.Add(new SkippedSheetRow(bad.Row, plan.Name, $"{bad.Reason} The prep item is left as it was.", $"{bad.ReasonAr} لم يُغيَّر الصنف."));
                plans.Remove(plan);
            }
            else if (plan.Lines.Count == 0 && plan.Existing is null)
            {
                skipped.Add(new SkippedSheetRow(plan.Row, plan.Name, "No ingredients under it: choose at least one, with its quantity for one batch.",
                    "لا توجد مكونات: اختر مكوّنًا واحدًا على الأقل بكميته في التشغيلة."));
                plans.Remove(plan);
            }
        }

        // The category new prep items are kept under, as the batch recipes sheet files them.
        PurchaseCategory? category = null;
        var added = new List<string>();
        if (plans.Any(p => p.Existing is null))
            category = await CategoryAsync(added, cancellationToken);

        var created = new List<ImportedSheetItem>();
        var updated = new List<UpdatedSheetItem>();
        var toCost = new List<(Plan Plan, decimal Batch, Dictionary<Guid, RawMaterial> Used, List<PrepIngredientEntry> Entries, bool Requested)>();
        var unchanged = 0;
        var requested = 0;
        var made = new HashSet<Guid>();
        var asked = new HashSet<Guid>();
        foreach (var plan in Ordered(plans, newIds, skipped))
        {
            void Skip(string reason, string reasonAr) => skipped.Add(new SkippedSheetRow(plan.Row, plan.Name, reason, reasonAr));

            // Made with a new one on the sheet: only once that one is made.
            var waitingOn = plan.Lines.Select(l => l.Material!).FirstOrDefault(m => newIds.Contains(m.Id) && !made.Contains(m.Id));
            if (waitingOn is not null)
            {
                if (asked.Contains(waitingOn.Id))
                    Skip($"Made with {waitingOn.Name}, which waits for a manager's approval: import the sheet again once it is approved.",
                        $"يُصنع من {waitingOn.Name} الذي ينتظر موافقة المدير: استورد الملف مرة أخرى بعد الموافقة.");
                else
                    Skip($"Made with {waitingOn.Name}, which was not imported.", $"يُصنع من {waitingOn.Name} الذي لم يُستورد.");
                continue;
            }

            var recipe = plan.Existing is null ? null : recipesById.GetValueOrDefault(plan.Existing.Id);
            if (plan.Lines.Count == 0)
            {
                unchanged++;
                continue;
            }

            // The same ingredient twice: added together, and said.
            var quantities = new Dictionary<Guid, decimal>();
            foreach (var line in plan.Lines)
            {
                if (quantities.ContainsKey(line.Material!.Id))
                    plan.Notes.Add($"{line.Material.Name} is on it twice: the quantities are added together. · المكوّن مكرر: جُمعت الكميات.");
                quantities[line.Material.Id] = quantities.GetValueOrDefault(line.Material.Id) + line.Quantity;
            }
            var used = plan.Lines.Select(l => l.Material!).DistinctBy(m => m.Id).ToDictionary(m => m.Id);

            // One batch: as written; as kept; or a new one's, the weight of its ingredients.
            decimal batch;
            if (plan.Makes is { } makes)
                batch = makes;
            else if (recipe is not null)
                batch = recipe.BatchQuantity;
            else if (plan.Unit == UnitOfMeasure.Piece)
            {
                Skip("Say how many pieces one batch makes, under Batch Makes.", "اكتب عدد القطع التي تنتجها التشغيلة في عمود كمية التشغيلة.");
                continue;
            }
            else
            {
                var weight = quantities.Where(q => used[q.Key].Unit != UnitOfMeasure.Piece).Sum(q => q.Value);
                if (weight <= 0)
                {
                    Skip("Say how much one batch makes, under Batch Makes.", "اكتب كمية التشغيلة في عمود كمية التشغيلة.");
                    continue;
                }
                batch = Math.Round(weight, 3);
                plan.Notes.Add($"Makes {SheetNumbers.Plain(batch / SheetUnits.Factor(plan.Unit))} {SheetUnits.Name(plan.Unit)} a batch: the weight of its ingredients. " +
                               "Correct it where cooking changes the weight. · كمية التشغيلة هي وزن مكوناتها: صحّحها إن تغيّر الوزن بالطهي.");
            }
            foreach (var (id, quantity) in quantities.Where(q => used[q.Key].Unit != UnitOfMeasure.Piece && q.Value / SheetUnits.Factor(used[q.Key].Unit) > 200))
                plan.Notes.Add($"{used[id].Name}: {SheetNumbers.Plain(quantity / SheetUnits.Factor(used[id].Unit))} {SheetUnits.Name(used[id].Unit)} in one batch. " +
                               "Was it written in grams? On this sheet 0.2 is 200 g. · تأكد أن الكمية ليست بالجرام.");

            // As kept: each ingredient keeping its yield on the recipe.
            var yields = recipe?.Ingredients.ToDictionary(i => i.RawMaterialId, i => i.YieldPercent) ?? [];
            var entries = quantities.Select(q => new PrepIngredientEntry(q.Key, q.Value, yields.TryGetValue(q.Key, out var y) ? y : null)).ToList();
            var item = plan.Existing;
            var change = item is null
                ? new PrepItemChange(plan.Name, plan.Unit, batch, entries, CategoryId: category!.Id)
                : new PrepItemChange(item.Name, item.Unit, batch, entries, item.Code, item.CategoryId, item.PurchaseUnit, item.PurchaseUnitSize, item.ReorderLevel,
                    recipe?.RecipeCategoryId);

            var changes = new List<string>();
            if (recipe is not null)
            {
                var before = recipe.Ingredients.ToDictionary(i => i.RawMaterialId, i => i.Quantity);
                if (before.Count != quantities.Count || quantities.Any(q => !before.TryGetValue(q.Key, out var was) || Math.Round(was, 4) != Math.Round(q.Value, 4)))
                    changes.Add("Ingredients");
                if (Math.Round(recipe.BatchQuantity, 4) != Math.Round(batch, 4))
                    changes.Add("Batch");
                if (changes.Count == 0)
                {
                    unchanged++;
                    continue;
                }
            }
            else if (item is not null)
            {
                changes.Add("Ingredients");
                changes.Add("Batch");
            }

            try
            {
                if (request.CanApprove)
                {
                    await writer.SaveAsync(change, item?.Id, item is null ? plan.Id : null, cancellationToken);
                    await unitOfWork.SaveChangesAsync(cancellationToken);
                    if (item is null)
                    {
                        made.Add(plan.Id);
                        created.Add(new ImportedSheetItem(plan.Row, plan.Id, plan.Name));
                    }
                    else
                    {
                        updated.Add(new UpdatedSheetItem(plan.Row, item.Id, item.Name, changes));
                    }
                }
                else
                {
                    await writer.CheckAsync(change, item?.Id, cancellationToken);
                    var (summary, described) = await writer.DescribeAsync(change, item?.Id, cancellationToken);
                    requests.Add(ApprovalRequest.AskToChange(
                        Guid.NewGuid(), ApprovalModule.PrepItem, item is null ? ApprovalAction.Create : ApprovalAction.Update, plan.Id, summary, described,
                        ApprovalPayload.Write(change), "Imported from Excel", request.StaffId, request.StaffName));
                    await unitOfWork.SaveChangesAsync(cancellationToken);
                    asked.Add(plan.Id);
                    requested++;
                }
            }
            catch (DomainException error)
            {
                Skip(error.Message, "لم يُستورد: راجع السبب بالإنجليزية.");
                continue;
            }

            toCost.Add((plan, batch, used, entries, !request.CanApprove));
        }

        // Costed once all are saved: one made with another new one on the sheet, by that one's recipe.
        var costs = new RecipeCosts((await materials.GetAllAsync(cancellationToken)).ToDictionary(m => m.Id), await recipes.GetAllAsync(cancellationToken));
        var costed = toCost.Select(c => Cost(c.Plan, c.Batch, c.Used, c.Entries, c.Requested, costs)).ToList();
        return new RecipeImportResult(created, updated, unchanged, skipped.OrderBy(s => s.Row).ToList(), added, costed, requested);
    }

    // The prep items to import, by their names: a row with no name is the one above's. A name
    // that is a bought material's, a deleted one's, one waiting for approval, or on the sheet
    // already is skipped and said why; so is a unit or a batch that cannot be read.
    private static List<Plan> Plans(
        IReadOnlyList<PrepRecipeSheetRow> rows, Dictionary<string, RawMaterial> byName, HashSet<Guid> pendingRecords, HashSet<string> pendingNames,
        List<SkippedSheetRow> skipped)
    {
        var groups = new List<(int Row, string Name, List<PrepRecipeSheetRow> Rows)>();
        var byKey = new Dictionary<string, int>();
        (int Row, string Name, List<PrepRecipeSheetRow> Rows)? current = null;
        foreach (var row in rows.OrderBy(r => r.Row))
        {
            if (SheetText.Clean(row.Item) is { } name)
            {
                if (byKey.TryGetValue(SheetText.Key(name), out var at))
                    current = groups[at];
                else
                {
                    byKey[SheetText.Key(name)] = groups.Count;
                    groups.Add((row.Row, name, []));
                    current = groups[^1];
                }
            }
            else if (current is null)
            {
                skipped.Add(new SkippedSheetRow(row.Row, null, "No prep item named on this row or above it.", "لا يوجد صنف مُصنَّع مسمى في هذا الصف أو فوقه."));
                continue;
            }
            current.Value.Rows.Add(row);
        }

        var plans = new List<Plan>();
        foreach (var (row, name, groupRows) in groups)
        {
            void Skip(string reason, string reasonAr) => skipped.Add(new SkippedSheetRow(row, name, reason, reasonAr));
            if (name.Length > MaxNameLength)
            {
                Skip($"The name is longer than {MaxNameLength} characters.", $"الاسم أطول من {MaxNameLength} حرف.");
                continue;
            }

            var existing = byName.GetValueOrDefault(SheetText.Key(name));
            if (existing is { IsPrepItem: false })
            {
                Skip($"{existing.Name} is a bought raw material: a prep item takes another name.", $"{existing.Name} خامة مشتراة: اختر للصنف المُصنَّع اسمًا آخر.");
                continue;
            }
            if (existing is { IsArchived: true })
            {
                Skip($"{existing.Name} was deleted: restore it rather than import it again.", $"{existing.Name} محذوف: استرجعه بدلًا من استيراده.");
                continue;
            }
            if (existing is not null ? pendingRecords.Contains(existing.Id) : pendingNames.Contains(SheetText.Key(name)))
            {
                Skip($"{name} waits for a manager's approval: import it again once that is decided.", $"{name} بانتظار موافقة المدير: استورده بعد البت فيه.");
                continue;
            }

            var unitText = groupRows.Select(r => SheetText.Clean(r.Unit)).FirstOrDefault(u => u is not null);
            var unit = SheetUnits.Parse(unitText);
            if (unitText is not null && unit is null)
            {
                Skip($"\"{unitText}\" is not a unit the system knows: Kg, Liter or Piece.", $"\"{unitText}\" ليست وحدة معروفة: كيلو أو لتر أو قطعة.");
                continue;
            }
            if (existing is not null && unit is { } other && other != existing.Unit)
            {
                Skip($"{existing.Name} is kept by the {SheetUnits.Name(existing.Unit)}, not the {SheetUnits.Name(other)}: its stock and batches are in it. Add a new prep item for another unit.",
                    $"{existing.Name} يُحفظ بالـ{SheetUnits.NameAr(existing.Unit)} وليس بالـ{SheetUnits.NameAr(other)}: أضف صنفًا جديدًا لوحدة أخرى.");
                continue;
            }
            var kept = existing?.Unit ?? unit ?? UnitOfMeasure.Gram;

            var makesText = groupRows.Select(r => SheetText.Clean(r.Makes)).FirstOrDefault(m => m is not null);
            decimal? makes = null;
            if (makesText is not null)
            {
                if (SheetText.Amount(makesText) is not { } amount || amount <= 0)
                {
                    Skip($"\"{makesText}\" is not what a batch makes: write a number of {SheetUnits.Name(kept)}, more than nothing.",
                        $"\"{makesText}\" ليست كمية تشغيلة: اكتب رقمًا بالـ{SheetUnits.NameAr(kept)} أكبر من صفر.");
                    continue;
                }
                makes = amount * SheetUnits.Factor(kept);
            }

            plans.Add(new Plan(row, name, existing, kept, makes, groupRows));
        }

        return plans;
    }

    // Each after the new ones on the sheet it is made with; ones made with each other skipped.
    private static List<Plan> Ordered(List<Plan> plans, HashSet<Guid> newIds, List<SkippedSheetRow> skipped)
    {
        var byId = plans.ToDictionary(p => p.Id);
        var ordered = new List<Plan>();
        var done = new Dictionary<Guid, bool>();
        bool Visit(Plan plan, HashSet<Guid> path)
        {
            if (done.TryGetValue(plan.Id, out var ok))
                return ok;
            if (!path.Add(plan.Id))
                return false;
            ok = true;
            foreach (var line in plan.Lines.Where(l => newIds.Contains(l.Material!.Id) && byId.ContainsKey(l.Material.Id)))
                ok &= Visit(byId[line.Material!.Id], path);
            path.Remove(plan.Id);
            done[plan.Id] = ok;
            if (ok)
                ordered.Add(plan);
            else
                skipped.Add(new SkippedSheetRow(plan.Row, plan.Name, "Made with a prep item that is itself made with it: put one of them right.",
                    "يُصنع من صنف يُصنع منه: صحّح أحدهما."));
            return ok;
        }

        foreach (var plan in plans)
            Visit(plan, []);
        return ordered;
    }

    // The batch recipes' category, المصنعات, added when not there.
    private async Task<PurchaseCategory> CategoryAsync(List<string> added, CancellationToken cancellationToken)
    {
        var key = PurchaseCategory.Normalize(ImportPrepItemsHandler.CategoryName);
        var category = (await categories.GetAllAsync(cancellationToken))
            .FirstOrDefault(c => PurchaseCategory.Normalize(c.Name) == key || (c.NameAr is { } ar && PurchaseCategory.Normalize(ar) == key));
        if (category is null)
        {
            categories.Add(category = new PurchaseCategory(Guid.NewGuid(), ImportPrepItemsHandler.CategoryName));
            added.Add(category.Name);
            await unitOfWork.SaveChangesAsync(cancellationToken);
        }
        else if (category.Kind != CategoryKind.RawMaterials)
        {
            throw new DomainException($"{category.Name} is a general expenses category: make it a raw materials category for the prep items first.");
        }

        return category;
    }

    // What one batch costs now, and one kg, litre or piece of it: each ingredient as purchased at
    // its average cost, a prep item never made yet by its own recipe.
    private static CostedSheetItem Cost(
        Plan plan, decimal batch, Dictionary<Guid, RawMaterial> used, List<PrepIngredientEntry> entries, bool requested, RecipeCosts costs)
    {
        // One not saved (a new prep item asked of a manager) has no price yet, by its name.
        var missing = entries
            .SelectMany(e => costs.Of(e.RawMaterialId) is { PerUnit: null, Missing.Count: 0 } ? [used[e.RawMaterialId].Name] : costs.Of(e.RawMaterialId).Missing)
            .Distinct()
            .ToList();
        var cost = entries.Sum(e => e.Quantity * 100 / (e.YieldPercent ?? used[e.RawMaterialId].DefaultYieldPercent) * (costs.Of(e.RawMaterialId).PerUnit ?? 0));
        return new CostedSheetItem(
            plan.Row, plan.Name, entries.Count, SheetNumbers.Money(cost), SheetNumbers.Money(cost / batch * SheetUnits.Factor(plan.Unit)),
            SheetUnits.Name(plan.Unit), missing, plan.Notes, requested);
    }
}
