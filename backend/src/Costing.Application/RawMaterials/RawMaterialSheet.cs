using MediatR;
using Costing.Domain.Common;
using Costing.Application.Categories;
using Costing.Application.Common;
using Costing.Domain.Approvals;
using Costing.Domain.Categories;
using Costing.Domain.RawMaterials;

namespace Costing.Application.RawMaterials;

// Raw materials to and from a spreadsheet: the list written out (GetRawMaterialSheetQuery, the
// export), and a sheet read back in (ImportRawMaterialsCommand), the template's or an export
// edited, or one exported from another installation. Every one is a purchased stock item, for
// recipes, purchases and stock counts; never an expense item, which is a thing of its own, nor a
// prep item, which is made in the kitchen.
//
// A row is the material its code names, else the one its name does (capitals and spacing aside):
// that one is changed as the row says, and a row naming none is a new material. A blank cell
// leaves that detail as it is. Each row is checked on its own: a good one applied, a bad one
// skipped and said why, by its row number on the sheet, in English and Arabic. Never twice for
// one material: a second row for it, by its name or its code, is skipped. A category not on the
// list yet is added, once.
//
// The unit it is counted in is not changed here: that restates its stock, recipes and records, on
// Raw materials. The cost replaces the average only when it differs from the one written out, so
// an export imported back as it is leaves each average as it was, not rounded.

// One row as read from the sheet: its number there, and its cells as they were written.
// PurchaseUnitHolds is in the Unit's kg, litres or pieces; ReorderLevel in purchase units, as the
// material's own screen writes it.
public sealed record RawMaterialSheetRow(
    int Row,
    string? Name,
    string? Category,
    string? Unit,
    string? Cost,
    string? Code = null,
    string? PurchaseUnit = null,
    string? PurchaseUnitHolds = null,
    string? ReorderLevel = null,
    string? YieldPercent = null);

// A material as the sheet writes it, in the sheet's units.
public sealed record RawMaterialSheetLine(
    string? Code,
    string Name,
    string Category,
    string Unit,
    string PurchaseUnit,
    decimal PurchaseUnitHolds,
    decimal? Cost,
    decimal ReorderLevel,
    decimal YieldPercent);

// What the sheet is written from: the materials, and the raw materials categories for its dropdown.
public sealed record RawMaterialSheet(IReadOnlyList<RawMaterialSheetLine> Lines, IReadOnlyList<string> Categories);

public sealed record ImportedRawMaterial(
    int Row, Guid Id, string Name, string Category, UnitOfMeasure Unit, string PurchaseUnit, decimal? CostPerPurchaseUnit);

// One already there, changed by its row: what changed, by the sheet's column (Name, Code,
// Category, PurchaseUnit, Cost, ReorderLevel, Yield; NameAr and Unit for an expense item).
public sealed record UpdatedSheetItem(int Row, Guid Id, string Name, IReadOnlyList<string> Changes);

public sealed record SkippedSheetRow(int Row, string? Name, string Reason, string? ReasonAr = null);

public sealed record RawMaterialImportResult(
    IReadOnlyList<ImportedRawMaterial> Created,
    IReadOnlyList<UpdatedSheetItem> Updated,
    int Unchanged,
    IReadOnlyList<SkippedSheetRow> Skipped,
    IReadOnlyList<string> CategoriesAdded);

public sealed record ImportRawMaterialsCommand(IReadOnlyList<RawMaterialSheetRow> Rows) : IRequest<RawMaterialImportResult>;

public sealed record GetRawMaterialSheetQuery : IRequest<RawMaterialSheet>;

// The units the sheet takes, in English or Arabic: what a material is bought and priced in. A
// material bought by the kg is counted in grams, by the litre in millilitres, by the piece in
// pieces; its cost is per kg, litre or piece unless its purchase unit says otherwise.
public static class SheetUnits
{
    public static readonly IReadOnlyList<string> Names = ["Kg", "Liter", "Piece"];

    private static readonly Dictionary<string, UnitOfMeasure> ByName = new(StringComparer.OrdinalIgnoreCase)
    {
        ["kg"] = UnitOfMeasure.Gram,
        ["kgs"] = UnitOfMeasure.Gram,
        ["kilo"] = UnitOfMeasure.Gram,
        ["kilos"] = UnitOfMeasure.Gram,
        ["kilogram"] = UnitOfMeasure.Gram,
        ["kilograms"] = UnitOfMeasure.Gram,
        ["كيلو"] = UnitOfMeasure.Gram,
        ["كجم"] = UnitOfMeasure.Gram,
        ["كغ"] = UnitOfMeasure.Gram,
        ["كيلوجرام"] = UnitOfMeasure.Gram,
        ["كيلوغرام"] = UnitOfMeasure.Gram,
        ["liter"] = UnitOfMeasure.Millilitre,
        ["liters"] = UnitOfMeasure.Millilitre,
        ["litre"] = UnitOfMeasure.Millilitre,
        ["litres"] = UnitOfMeasure.Millilitre,
        ["l"] = UnitOfMeasure.Millilitre,
        ["lt"] = UnitOfMeasure.Millilitre,
        ["ltr"] = UnitOfMeasure.Millilitre,
        ["لتر"] = UnitOfMeasure.Millilitre,
        ["piece"] = UnitOfMeasure.Piece,
        ["pieces"] = UnitOfMeasure.Piece,
        ["pc"] = UnitOfMeasure.Piece,
        ["pcs"] = UnitOfMeasure.Piece,
        ["unit"] = UnitOfMeasure.Piece,
        ["units"] = UnitOfMeasure.Piece,
        ["قطعة"] = UnitOfMeasure.Piece,
        ["حبة"] = UnitOfMeasure.Piece,
        ["عدد"] = UnitOfMeasure.Piece,
    };

    public static UnitOfMeasure? Parse(string? text) =>
        text is null ? null : ByName.TryGetValue(text.Trim().TrimEnd('.'), out var unit) ? unit : null;

    // As the sheet writes it.
    public static string Name(UnitOfMeasure unit) => unit switch
    {
        UnitOfMeasure.Gram => "Kg",
        UnitOfMeasure.Millilitre => "Liter",
        _ => "Piece",
    };

    public static string NameAr(UnitOfMeasure unit) => unit switch
    {
        UnitOfMeasure.Gram => "كيلو",
        UnitOfMeasure.Millilitre => "لتر",
        _ => "قطعة",
    };

    // How many of the material's own unit one of the sheet's is: a kg is 1000 g.
    public static decimal Factor(UnitOfMeasure unit) => unit == UnitOfMeasure.Piece ? 1m : 1000m;
}

internal sealed class GetRawMaterialSheetHandler(IRawMaterialRepository materials, IPurchaseCategoryRepository categories)
    : IRequestHandler<GetRawMaterialSheetQuery, RawMaterialSheet>
{
    public async Task<RawMaterialSheet> Handle(GetRawMaterialSheetQuery request, CancellationToken cancellationToken)
    {
        var all = await categories.GetAllAsync(cancellationToken);
        var byId = all.ToDictionary(c => c.Id);
        var lines = (await materials.GetAllAsync(cancellationToken))
            .Where(m => !m.IsArchived && !m.IsPrepItem)
            .Select(m =>
            {
                var factor = SheetUnits.Factor(m.Unit);
                return new RawMaterialSheetLine(
                    m.Code,
                    m.Name,
                    byId.GetValueOrDefault(m.CategoryId)?.Name ?? PurchaseCategory.GeneralName,
                    SheetUnits.Name(m.Unit),
                    m.PurchaseUnit,
                    Math.Round(m.PurchaseUnitSize / factor, 3),
                    m.CostPerPurchaseUnit is { } cost ? Math.Round(cost, 4) : null,
                    Math.Round(m.ReorderLevel / m.PurchaseUnitSize, 3),
                    m.DefaultYieldPercent);
            })
            .OrderBy(l => l.Category, StringComparer.CurrentCultureIgnoreCase)
            .ThenBy(l => l.Name, StringComparer.CurrentCultureIgnoreCase)
            .ToList();
        var names = all.Where(c => c.Kind == CategoryKind.RawMaterials).Select(c => c.Name).OrderBy(n => n, StringComparer.CurrentCultureIgnoreCase).ToList();
        return new RawMaterialSheet(lines, names);
    }
}

internal sealed class ImportRawMaterialsHandler(
    IRawMaterialRepository materials, IPurchaseCategoryRepository categories, IApprovalRequestRepository approvals, IUnitOfWork unitOfWork)
    : IRequestHandler<ImportRawMaterialsCommand, RawMaterialImportResult>
{
    public const int MaxRows = 2000;
    private const int MaxNameLength = 200;
    private const int MaxCodeLength = 32;
    private const int MaxPurchaseUnitLength = 32;
    private const int MaxCategoryLength = 100;

    // A row checked: the material it is (none: a new one) and its cells read.
    private sealed record Plan(
        RawMaterial? Existing, string Name, string? Code, UnitOfMeasure Unit, string? Category, string? PurchaseUnit, decimal? Holds,
        decimal? Cost, decimal? ReorderLevel, decimal? Yield);

    private sealed record Problem(string Reason, string ReasonAr);

    public async Task<RawMaterialImportResult> Handle(ImportRawMaterialsCommand request, CancellationToken cancellationToken)
    {
        if (request.Rows.Count == 0)
            throw new DomainException("The sheet has no materials on it: fill in a row under the headings. · لا توجد خامات في الملف: املأ صفًا تحت العناوين.");
        if (request.Rows.Count > MaxRows)
            throw new DomainException($"Import at most {MaxRows:N0} materials at a time: split the sheet. · استورد {MaxRows:N0} خامة على الأكثر في المرة: قسّم الملف.");

        // Every material by its name and its code: deleted ones and prep items too, which a row
        // may name but not change.
        var all = await materials.GetAllAsync(cancellationToken);
        var byName = new Dictionary<string, RawMaterial>();
        foreach (var material in all)
            byName.TryAdd(PurchaseCategory.Normalize(material.Name), material);
        var byCode = all.Where(m => m.Code is not null).GroupBy(m => CodeKey(m.Code!)).ToDictionary(g => g.Key, g => g.ToList());
        var pending = (await approvals.GetPendingAsync(cancellationToken)).Select(r => r.RecordId).ToHashSet();
        // Categories by their name, English or Arabic.
        var known = new Dictionary<string, PurchaseCategory>();
        foreach (var category in await categories.GetAllAsync(cancellationToken))
        {
            known.TryAdd(PurchaseCategory.Normalize(category.Name), category);
            if (category.NameAr is { } ar)
                known.TryAdd(PurchaseCategory.Normalize(ar), category);
        }

        var created = new List<ImportedRawMaterial>();
        var updated = new List<UpdatedSheetItem>();
        var unchanged = 0;
        var skipped = new List<SkippedSheetRow>();
        var added = new List<string>();
        // Where each name, code and material was first on the sheet.
        var namesOnSheet = new Dictionary<string, int>();
        var codesOnSheet = new Dictionary<string, int>();
        var materialsOnSheet = new Dictionary<Guid, int>();
        foreach (var row in request.Rows.OrderBy(r => r.Row))
        {
            var name = SheetText.Clean(row.Name);
            var checkedRow = Check(row, name, byName, byCode, pending, known, namesOnSheet, codesOnSheet, materialsOnSheet);
            if (checkedRow.Problem is { } problem)
            {
                skipped.Add(new SkippedSheetRow(row.Row, name, problem.Reason, problem.ReasonAr));
                continue;
            }

            var plan = checkedRow.Plan!;
            var category = plan.Category is null ? null : await CategoryAsync(plan.Category, known, added, cancellationToken);
            RawMaterial material;
            if (plan.Existing is null)
            {
                material = new RawMaterial(plan.Name, plan.Unit);
                material.Describe(plan.Code, (category ?? await categories.ResolveAsync(null, CategoryKind.RawMaterials, null, cancellationToken)).Id);
                var factor = SheetUnits.Factor(plan.Unit);
                if (plan.PurchaseUnit is not null || plan.Holds is not null)
                    material.SetPurchaseUnit(plan.PurchaseUnit ?? material.PurchaseUnit, plan.Holds is { } holds ? holds * factor : material.PurchaseUnitSize);
                if (plan.Yield is { } yield)
                    material.SetDefaultYield(yield);
                if (plan.ReorderLevel is { } reorder)
                    material.SetReorderLevel(reorder * material.PurchaseUnitSize);
                if (plan.Cost is { } cost)
                    material.SetCost(cost);
                materials.Add(material);
                created.Add(new ImportedRawMaterial(
                    row.Row, material.Id, material.Name, category?.Name ?? PurchaseCategory.GeneralName, material.Unit, material.PurchaseUnit, plan.Cost));
            }
            else
            {
                material = plan.Existing;
                var changes = Apply(material, plan, category);
                if (changes.Count == 0)
                    unchanged++;
                else
                    updated.Add(new UpdatedSheetItem(row.Row, material.Id, material.Name, changes));
            }

            byName[PurchaseCategory.Normalize(material.Name)] = material;
            if (material.Code is { } code)
                byCode[CodeKey(code)] = [material];
            namesOnSheet[PurchaseCategory.Normalize(material.Name)] = row.Row;
            if (plan.Code is { } written)
                codesOnSheet[CodeKey(written)] = row.Row;
            materialsOnSheet[material.Id] = row.Row;
        }

        if (created.Count > 0 || updated.Count > 0)
            await unitOfWork.SaveChangesAsync(cancellationToken);
        return new RawMaterialImportResult(created, updated, unchanged, skipped, added);
    }

    // A row's cells read and checked against the materials and the rows above it.
    private static (Plan? Plan, Problem? Problem) Check(
        RawMaterialSheetRow row, string? name, Dictionary<string, RawMaterial> byName, Dictionary<string, List<RawMaterial>> byCode, HashSet<Guid> pending,
        Dictionary<string, PurchaseCategory> known, Dictionary<string, int> namesOnSheet, Dictionary<string, int> codesOnSheet,
        Dictionary<Guid, int> materialsOnSheet)
    {
        static (Plan?, Problem?) Skip(string reason, string reasonAr) => (null, new Problem(reason, reasonAr));

        if (name is null)
            return Skip("No material name.", "لا يوجد اسم للخامة.");
        if (name.Length > MaxNameLength)
            return Skip($"The name is longer than {MaxNameLength} characters.", $"الاسم أطول من {MaxNameLength} حرف.");
        var code = SheetText.Clean(row.Code);
        if (code?.Length > MaxCodeLength)
            return Skip($"The code is longer than {MaxCodeLength} characters.", $"الكود أطول من {MaxCodeLength} حرفًا.");
        if (code is not null && codesOnSheet.TryGetValue(CodeKey(code), out var codeRow))
            return Skip($"The code {code} is also on row {codeRow}, which is the one imported.", $"الكود {code} موجود أيضًا في الصف {codeRow}، وهو الذي استُورد.");
        if (namesOnSheet.TryGetValue(PurchaseCategory.Normalize(name), out var nameRow))
            return Skip($"Also on row {nameRow}, which is the one imported.", $"مكرر في الصف {nameRow}، وهو الذي استُورد.");

        // The material it is: its code's, else its name's; the two must be one.
        RawMaterial? byItsCode = null;
        if (code is not null && byCode.TryGetValue(CodeKey(code), out var coded))
        {
            if (coded.Count > 1)
                return Skip(
                    $"The code {code} is on more than one material ({string.Join(", ", coded.Select(m => m.Name))}): give each its own code on Raw materials first.",
                    $"الكود {code} مستخدم لأكثر من خامة: اجعل لكل خامة كودًا خاصًا بها أولًا.");
            byItsCode = coded[0];
        }
        var byItsName = byName.GetValueOrDefault(PurchaseCategory.Normalize(name));
        if (byItsCode is not null && byItsName is not null && byItsCode != byItsName)
            return Skip(
                $"The code {code} is {byItsCode.Name}'s, and {byItsName.Name} is another material: give the row one material's code and name.",
                $"الكود {code} خاص بـ {byItsCode.Name}، والاسم {byItsName.Name} لخامة أخرى: اجعل الكود والاسم لخامة واحدة.");
        var existing = byItsCode ?? byItsName;
        if (existing is not null)
        {
            if (existing.IsArchived)
                return Skip(
                    $"{existing.Name} was deleted: restore it from the deleted materials rather than import it again.",
                    $"{existing.Name} محذوفة: استرجعها من الخامات المحذوفة بدلًا من استيرادها.");
            if (existing.IsPrepItem)
                return Skip($"{existing.Name} is a prep item: change it under Recipes → Prep items.", $"{existing.Name} صنف مُصنَّع: عدّله من الوصفات ← المصنعات.");
            if (materialsOnSheet.TryGetValue(existing.Id, out var materialRow))
                return Skip($"{existing.Name} is also on row {materialRow}, which is the one imported.", $"{existing.Name} موجودة أيضًا في الصف {materialRow}، وهو الذي استُورد.");
            if (pending.Contains(existing.Id))
                return Skip(
                    $"{existing.Name} waits for a manager's approval: import it again once that is decided.",
                    $"{existing.Name} بانتظار موافقة المدير: استوردها مرة أخرى بعد البت فيها.");
        }

        // The unit: required for a new one; never another for one there already.
        var unitText = SheetText.Clean(row.Unit);
        var unit = SheetUnits.Parse(unitText);
        if (unitText is not null && unit is null)
            return Skip($"\"{unitText}\" is not a unit the system knows: Kg, Liter or Piece.", $"\"{unitText}\" ليست وحدة معروفة: كيلو أو لتر أو قطعة.");
        if (existing is null && unit is null)
            return Skip("No unit of measure: Kg, Liter or Piece.", "لا توجد وحدة قياس: كيلو أو لتر أو قطعة.");
        if (existing is not null && unit is { } other && other != existing.Unit)
            return Skip(
                $"{existing.Name} is counted by the {SheetUnits.Name(existing.Unit)}, not the {SheetUnits.Name(other)}: change its unit on Raw materials, which restates its stock and recipes.",
                $"{existing.Name} تُحسب بالـ{SheetUnits.NameAr(existing.Unit)} وليس بالـ{SheetUnits.NameAr(other)}: غيّر وحدتها من صفحة الخامات، فيُعاد حساب مخزونها ووصفاتها.");
        var counted = unit ?? existing!.Unit;

        if (Amount(row.Cost, "a cost", "تكلفة", out var cost) is { } costProblem)
            return (null, costProblem);
        if (cost < 0)
            return Skip("A cost cannot be negative.", "لا يمكن أن تكون التكلفة سالبة.");
        if (Amount(row.PurchaseUnitHolds, "how much the purchase unit holds", "سعة وحدة الشراء", out var holds) is { } holdsProblem)
            return (null, holdsProblem);
        if (holds <= 0)
            return Skip("A purchase unit holds more than nothing.", "يجب أن تكون سعة وحدة الشراء أكبر من صفر.");
        if (Amount(row.ReorderLevel, "a reorder level", "حد طلب", out var reorder) is { } reorderProblem)
            return (null, reorderProblem);
        if (reorder < 0)
            return Skip("A reorder level cannot be negative.", "لا يمكن أن يكون حد الطلب سالبًا.");
        if (Amount(row.YieldPercent?.TrimEnd('%', '٪', ' '), "a yield", "نسبة صافي", out var yield) is { } yieldProblem)
            return (null, yieldProblem);
        if (yield is not (null or (> 0m and <= 100m)))
            return Skip("The yield is more than 0% and at most 100%.", "نسبة الصافي أكبر من 0% وحتى 100%.");

        // The purchase unit: its name and what it holds go together for a new one, unless it is
        // the unit itself (a kg holds 1 kg).
        var purchaseUnit = SheetText.Clean(row.PurchaseUnit);
        if (purchaseUnit?.Length > MaxPurchaseUnitLength)
            return Skip($"The purchase unit's name is longer than {MaxPurchaseUnitLength} characters.", $"اسم وحدة الشراء أطول من {MaxPurchaseUnitLength} حرفًا.");
        if (existing is null && purchaseUnit is null && holds is not null)
            return Skip($"Name the purchase unit that holds {holds}.", $"اكتب اسم وحدة الشراء التي تحتوي {holds}.");
        if (existing is null && purchaseUnit is not null && holds is null)
        {
            if (!IsTheUnitItself(purchaseUnit, counted))
                return Skip(
                    $"Say how much a {purchaseUnit} holds, in {SheetUnits.Name(counted)}.",
                    $"اكتب كم تحتوي وحدة الشراء ({purchaseUnit}) بالـ{SheetUnits.NameAr(counted)}.");
            holds = 1;
        }

        // The category: a raw materials one, or a new name, which is added.
        var category = SheetText.Clean(row.Category);
        if (category?.Length > MaxCategoryLength)
            return Skip($"The category's name is longer than {MaxCategoryLength} characters.", $"اسم القسم أطول من {MaxCategoryLength} حرف.");
        if (category is not null && known.TryGetValue(PurchaseCategory.Normalize(category), out var filedUnder) && filedUnder.Kind != CategoryKind.RawMaterials)
            return Skip(
                $"{filedUnder.Name} is a general expenses category: give it a raw materials category.",
                $"{filedUnder.Name} قسم مصروفات عمومية: اختر قسمًا من أقسام الخامات.");

        return (new Plan(existing, name, code, counted, category, purchaseUnit, holds, cost, reorder, yield), null);
    }

    // A material there already, as its row says; what changed, by column. Its name and code as
    // they are written where only capitals or spacing differ: renamed only when found by its code
    // under another name.
    private static List<string> Apply(RawMaterial material, Plan plan, PurchaseCategory? category)
    {
        var changes = new List<string>();
        if (PurchaseCategory.Normalize(plan.Name) != PurchaseCategory.Normalize(material.Name))
        {
            material.Rename(plan.Name);
            changes.Add("Name");
        }
        if (plan.Code is not null && (material.Code is null || CodeKey(plan.Code) != CodeKey(material.Code)))
        {
            material.Describe(plan.Code, material.CategoryId);
            changes.Add("Code");
        }
        if (category is not null && category.Id != material.CategoryId)
        {
            material.MoveTo(category.Id);
            changes.Add("Category");
        }

        var factor = SheetUnits.Factor(material.Unit);
        var purchaseUnit = plan.PurchaseUnit ?? material.PurchaseUnit;
        var holds = plan.Holds ?? Math.Round(material.PurchaseUnitSize / factor, 3);
        if (purchaseUnit != material.PurchaseUnit || Math.Round(holds, 3) != Math.Round(material.PurchaseUnitSize / factor, 3))
        {
            material.SetPurchaseUnit(purchaseUnit, holds * factor);
            changes.Add("PurchaseUnit");
        }
        if (plan.Yield is { } yield && yield != material.DefaultYieldPercent)
        {
            material.SetDefaultYield(yield);
            changes.Add("Yield");
        }
        if (plan.ReorderLevel is { } reorder && Math.Round(reorder, 3) != Math.Round(material.ReorderLevel / material.PurchaseUnitSize, 3))
        {
            material.SetReorderLevel(reorder * material.PurchaseUnitSize);
            changes.Add("ReorderLevel");
        }
        // As the material's own screen does: an unchanged cost is left alone, so the average is
        // not reset to the rounded figure written out.
        if (plan.Cost is { } cost && (material.CostPerPurchaseUnit is not { } current || Math.Round(current, 4) != Math.Round(cost, 4)))
        {
            material.SetCost(cost);
            changes.Add("Cost");
        }

        return changes;
    }

    // A number cell: none when blank, a problem when it is not a number.
    private static Problem? Amount(string? text, string what, string whatAr, out decimal? amount)
    {
        amount = null;
        if (SheetText.Clean(text) is not { } written)
            return null;
        amount = SheetText.Amount(written);
        return amount is null
            ? new Problem($"\"{written}\" is not {what}: write a number, such as 85.50.", $"\"{written}\" ليست {whatAr}: اكتب رقمًا، مثل 85.50.")
            : null;
    }

    // A kg bought by the kg: the purchase unit is the unit itself, holding one.
    private static bool IsTheUnitItself(string purchaseUnit, UnitOfMeasure unit) =>
        SheetUnits.Parse(purchaseUnit) == unit
        || string.Equals(purchaseUnit, RawMaterial.DefaultPurchaseUnit(unit).Name, StringComparison.OrdinalIgnoreCase);

    private static string CodeKey(string code) => SheetText.Key(code);

    // The category of that name, English or Arabic; one added when there is none. General is the
    // default one, whatever it is called here, never a second of that name.
    private async Task<PurchaseCategory> CategoryAsync(
        string name, Dictionary<string, PurchaseCategory> known, List<string> added, CancellationToken cancellationToken)
    {
        if (known.TryGetValue(PurchaseCategory.Normalize(name), out var found))
            return found;
        if (PurchaseCategory.Normalize(name) == PurchaseCategory.Normalize(PurchaseCategory.GeneralName) || name == PurchaseCategory.GeneralNameAr)
            return known[PurchaseCategory.Normalize(name)] = await categories.ResolveAsync(null, CategoryKind.RawMaterials, null, cancellationToken);
        var category = new PurchaseCategory(Guid.NewGuid(), name);
        categories.Add(category);
        known[PurchaseCategory.Normalize(name)] = category;
        added.Add(category.Name);
        return category;
    }
}
