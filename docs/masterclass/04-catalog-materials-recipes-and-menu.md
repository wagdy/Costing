# الفصل 04: الخامات، الوصفات، المصنعات، والمنيو

[← الفصل السابق](03-auth-permissions-and-approvals.md) · [الفهرس](00-index-and-build-roadmap.md) · [الفصل التالي: المشتريات وتقفيل اليوم والمخزون →](05-purchases-end-of-day-and-inventory.md)

## 1. المحاسبة أولًا: من سعر الشراء إلى تكلفة الطبق

### 1.1 وحدة الشراء ووحدة العدّ

الخامة تُعدّ بوحدة أساسية (جرام/مللي/قطعة) وتُشترى بوحدة شراء:

```text
الدقيق:  Unit = جرام،  PurchaseUnit = "كجم"،  PurchaseUnitSize = 1000
فاتورة: 25 كجم × 18 ج/كجم = 450 ج
⇐ تدخل المخزون 25,000 جم، بتكلفة 450 ÷ 25,000 = 0.018 ج/جم
```

العرض للمستخدم دائمًا **بوحدة الشراء** (18 ج/كجم)، والحساب الداخلي **بالوحدة الأساسية** (0.018 ج/جم). لهذا دقة تكلفة الوحدة `(18,6)`.

### 1.2 المتوسط المرجح المتحرك

```text
المتوسط الجديد = (الرصيد × المتوسط القديم + الكمية المشتراة × سعرها) ÷ (الرصيد + الكمية المشتراة)
```

مثال: في المخزن 10 كجم دقيق بمتوسط 16 ج/كجم، اشترينا 25 كجم بـ 18 ج/كجم:

```text
(10 × 16 + 25 × 18) ÷ 35 = (160 + 450) ÷ 35 = 17.43 ج/كجم
```

كل خروج (بيع، إنتاج، هالك، عجز جرد) يخرج **بالمتوسط وقتها**، ويُسجل في الحركة. حالات خاصة في `RawMaterial` (الفصل 02):

- رصيد سالب ⇐ يُعامل كصفر عند الخلط (لا شيء نخلطه معه): المتوسط = سعر الشراء الجديد.
- إلغاء فاتورة ⇐ `UnaverageWith`: يُخرج سعرها من المتوسط بقدر ما يحتمل المتبقي.

### 1.3 نسبة الصافي (Yield) و AP مقابل EP

```text
EP$/وحدة = AP$/وحدة ÷ Yield%
تكلفة سطر الوصفة = كمية EP × EP$/وحدة
                 = (كمية EP ÷ Yield%) × AP$/وحدة       ← الكمية "كما تُشترى" × المتوسط
```

مثال: الوصفة تطلب 90 جم بصل **منظف**، Yield = 90%، المتوسط 0.02 ج/جم:

```text
كما يُشترى = 90 ÷ 0.9 = 100 جم   ⇐  التكلفة = 100 × 0.02 = 2.00 ج
```

والمخزون يُخصم منه **100 جم** (ما خرج فعلًا من المخزن)، لا 90.

### 1.4 تكلفة الوصفة ونسبة تكلفة الطعام

```text
تكلفة الطبق للحصة   = Σ تكلفة السطور ÷ عدد الحصص (Portions)
نسبة تكلفة الطعام   = تكلفة الحصة ÷ سعر البيع قبل الضريبة × 100
الحالة              = فوق الهدف إن تجاوزت النسبة المستهدفة (CostingSettings، 30% افتراضيًا)
```

### 1.5 المصنّعات: تكلفة بالوصفة قبل أول تشغيلة (`RecipeCosts`)

**المشكلة:** "عجينة البيتزا" مصنّع. قبل أن يُنتج المطبخ أول دفعة، لا متوسط تكلفة لها (`AverageCost` = null). فكيف نعرف تكلفة طبق البيتزا اليوم؟

**الحل:** نحسب تكلفة المصنّع **من وصفة دفعته بأسعار اليوم**، بشكل متداخل:

```text
تكلفة وحدة المصنّع = Σ (كمية المكوّن كما تُشترى × تكلفة وحدة المكوّن) ÷ كمية الدفعة
وتكلفة المكوّن إن كان مصنّعًا آخر بلا متوسط ⇐ من وصفته هو (تداخل)
```

مثال: دفعة 10,000 جم عجين = 6,000 جم دقيق (0.018) + 3,500 مل ماء (0) + 100 جم خميرة (0.12):

```text
(6000 × 0.018 + 0 + 100 × 0.12) ÷ 10000 = (108 + 12) ÷ 10000 = 0.012 ج/جم
```

قواعد `RecipeCosts.Of(materialId)`:

1. خامة مشتراة، أو مصنّع **له متوسط > 0** ⇐ المتوسط (حقيقة الدفعات المنتجة أولى من التقدير).
2. مصنّع بلا متوسط وله وصفة صالحة ⇐ تكلفة الدفعة ÷ كمية الدفعة، و `ByRecipe = true` (تعرض الواجهة "حسب وصفته").
3. **حماية من الدوران:** `_working` تمنع مصنّعًا داخلًا في نفسه من حلقة لا نهائية.
4. **ذاكرة (Memoization):** `_known` تحفظ كل نتيجة مرة واحدة.
5. **الأسعار الناقصة تُسمّى:** `Missing` تقول "صوص ألفريدو: كريمة" (المكوّن الذي بلا سعر داخل أي مصنّع)، فيعرف المستخدم ماذا ينقص.

والمكان الذي يُستخدم فيه: بطاقات الوصفات، قائمة الوصفات، تكلفة المنيو، التكلفة القياسية للمصنّع، تكلفة استيراد الإكسيل، والتقرير النظري. **أما المخزون والإنتاج والفروقات فبالتكلفة الفعلية دائمًا.**

> 📄 **`backend/src/Costing.Domain/Production/RecipeCosts.cs`** — 81 سطر

```csharp
using Costing.Domain.RawMaterials;

namespace Costing.Domain.Production;

// What a gram, millilitre or piece of a material costs when a recipe is costed. PerUnit: none when
// it has no price. ByRecipe: a prep item costed by its own batch recipe, not yet by its batches.
// Missing: what has no price under it, by name ("White sauce: Cream" for one inside a prep item).
public sealed record RecipeCost(decimal? PerUnit, bool ByRecipe, IReadOnlyList<string> Missing)
{
    public static readonly RecipeCost None = new(null, false, []);
}

// The cost a recipe is worked out from, for each material: its average cost, what was paid for it,
// or for a prep item what its batches cost. A prep item never made yet has no average (or one of
// nothing): it is costed by its own batch recipe today instead, each of its ingredients priced the
// same way, so a dish made with it is costed before the kitchen makes the first batch. Once a batch
// is made, what the batches cost takes over.
//
// One of its ingredients with no price leaves its cost short of that one, which is named; with no
// ingredient priced at all, it has no price. A recipe made with itself (never saved; guarded
// against all the same) has none either. Stock itself is never valued this way: what is taken off
// the shelf is at what was paid, and a production order's cost at what went into it.
public sealed class RecipeCosts
{
    private readonly IReadOnlyDictionary<Guid, RawMaterial> _materials;
    private readonly IReadOnlyDictionary<Guid, PrepRecipe> _recipes;
    private readonly Dictionary<Guid, RecipeCost> _known = [];
    private readonly HashSet<Guid> _working = [];

    public RecipeCosts(IReadOnlyDictionary<Guid, RawMaterial> materials, IEnumerable<PrepRecipe> recipes)
    {
        _materials = materials;
        _recipes = recipes.ToDictionary(r => r.PrepItemId);
    }

    public RecipeCost Of(Guid materialId)
    {
        if (_known.TryGetValue(materialId, out var known))
            return known;
        if (!_materials.TryGetValue(materialId, out var material))
            return RecipeCost.None;

        RecipeCost cost;
        if (!material.IsPrepItem || material.AverageCost > 0)
            cost = new RecipeCost(material.AverageCost, false, material.AverageCost is null ? [material.Name] : []);
        else if (_recipes.GetValueOrDefault(material.Id) is not { BatchQuantity: > 0, Ingredients.Count: > 0 } recipe || !_working.Add(material.Id))
            cost = new RecipeCost(material.AverageCost, false, material.AverageCost is null ? [material.Name] : []);
        else
        {
            var (batch, priced, missing) = Batch(recipe);
            _working.Remove(material.Id);
            cost = priced
                ? new RecipeCost(batch / recipe.BatchQuantity, true, missing.Select(name => $"{material.Name}: {name}").ToList())
                : new RecipeCost(null, false, [material.Name]);
        }

        _known[materialId] = cost;
        return cost;
    }

    // One batch of a prep item's recipe at today's costs: what is priced, whether anything is, and
    // what has no price.
    public (decimal Cost, bool Priced, IReadOnlyList<string> Missing) Batch(PrepRecipe recipe)
    {
        var cost = 0m;
        var priced = false;
        var missing = new List<string>();
        foreach (var ingredient in recipe.Ingredients)
        {
            var each = Of(ingredient.RawMaterialId);
            missing.AddRange(each.Missing);
            if (each.PerUnit is { } perUnit)
            {
                cost += ingredient.AsPurchasedQuantity * perUnit;
                priced = true;
            }
        }

        return (cost, priced, missing.Distinct().ToList());
    }
}
```


### 1.6 تفجير الخامات (`MaterialExplosion`: Bill of Materials)

السؤال: "كم دقيقًا **مشترًى** في 1 جم من البيتزا النهائية؟" مطلوب لمخطط الطلبيات والاستهلاك النظري (الفصل 06). `PerUnit(materialId)` تعيد قاموسًا: لكل خامة مشتراة، كم وحدة منها في وحدة واحدة من المادة، نزولًا عبر المصنعات:

```text
لكل مكوّن في وصفة الدفعة:
    لكل (خامة, كمية) في PerUnit(المكوّن):
        المجموع[خامة] += كمية × (كمية المكوّن كما تُشترى) ÷ كمية الدفعة
```

مع نفس الحماية من الدوران والذاكرة. و `TopDown()` ترتيب للمصنعات من الأعلى للأدنى لاستخدامه عند خصم ما في المخزن من مصنعات قبل الطلب (الفصل 06).

> 📄 **`backend/src/Costing.Domain/Production/MaterialExplosion.cs`** — 80 سطر

```csharp
namespace Costing.Domain.Production;

// The bill of materials: what a quantity of any material comes to in the materials that are bought.
// A bought material is itself. A prep item is its batch recipe scaled to the quantity, each
// ingredient as purchased (its yield allowed for), a prep item inside it through its own recipe, and
// so on down. A prep item with no batch recipe, or one made with itself, stays as itself: there is
// nothing to break it into.
public sealed class MaterialExplosion
{
    private readonly IReadOnlyDictionary<Guid, PrepRecipe> _recipes;
    private readonly Dictionary<Guid, IReadOnlyDictionary<Guid, decimal>> _perUnit = [];
    private readonly HashSet<Guid> _working = [];

    public MaterialExplosion(IEnumerable<PrepRecipe> recipes)
    {
        _recipes = recipes.Where(r => r.BatchQuantity > 0 && r.Ingredients.Count > 0).ToDictionary(r => r.PrepItemId);
    }

    // A prep item the kitchen makes by a recipe: one that breaks into what it is made of.
    public bool IsMade(Guid materialId) => _recipes.ContainsKey(materialId);

    // What one unit (a gram, millilitre or piece) of the material takes from bought materials.
    public IReadOnlyDictionary<Guid, decimal> PerUnit(Guid materialId)
    {
        if (_perUnit.TryGetValue(materialId, out var known))
            return known;
        // Made with itself somewhere down: it stays as itself there, and only there.
        if (!_working.Add(materialId))
            return new Dictionary<Guid, decimal> { [materialId] = 1 };
        var totals = new Dictionary<Guid, decimal>();
        if (_recipes.TryGetValue(materialId, out var recipe))
        {
            foreach (var ingredient in recipe.Ingredients)
                foreach (var (id, quantity) in PerUnit(ingredient.RawMaterialId))
                    totals[id] = totals.GetValueOrDefault(id) + quantity * ingredient.AsPurchasedQuantity / recipe.BatchQuantity;
        }
        else
            totals[materialId] = 1;
        _working.Remove(materialId);
        _perUnit[materialId] = totals;
        return totals;
    }

    // Each of the quantities in bought materials, summed.
    public Dictionary<Guid, decimal> Explode(IEnumerable<KeyValuePair<Guid, decimal>> quantities)
    {
        var totals = new Dictionary<Guid, decimal>();
        foreach (var (materialId, quantity) in quantities)
            foreach (var (id, perUnit) in PerUnit(materialId))
                totals[id] = totals.GetValueOrDefault(id) + perUnit * quantity;
        return totals;
    }

    // What making `quantity` of a prep item takes, one level down: its batch's ingredients scaled.
    public IEnumerable<(Guid RawMaterialId, decimal Quantity)> Ingredients(Guid prepItemId, decimal quantity) =>
        _recipes.TryGetValue(prepItemId, out var recipe)
            ? recipe.Ingredients.Select(i => (i.RawMaterialId, i.AsPurchasedQuantity * quantity / recipe.BatchQuantity))
            : [];

    // The prep items made by a recipe, each before any it is made with: the order a requirement
    // passes down through them, so each is netted against its stock before its ingredients are.
    public IReadOnlyList<Guid> TopDown()
    {
        var visited = new HashSet<Guid>();
        var order = new List<Guid>();
        void Visit(Guid id)
        {
            if (!visited.Add(id))
                return;
            foreach (var ingredient in _recipes[id].Ingredients.Where(i => _recipes.ContainsKey(i.RawMaterialId)))
                Visit(ingredient.RawMaterialId);
            order.Add(id);
        }

        foreach (var id in _recipes.Keys)
            Visit(id);
        order.Reverse();
        return order;
    }
}
```


---

## 2. الخامات في طبقة التطبيق

`RawMaterials.cs`: الإنشاء والتعديل والقائمة. `RawMaterialDto` (حسب تعليقه) بلا تكاليف: الكميات للجميع، والتكاليف عبر `api/costing`.

> 📄 **`backend/src/Costing.Application/RawMaterials/RawMaterials.cs`** — 139 سطر

```csharp
using MediatR;
using Costing.Application.Approvals;
using Costing.Application.Categories;
using Costing.Application.Common;
using Costing.Domain.Common;
using Costing.Domain.Approvals;
using Costing.Domain.Categories;
using Costing.Domain.RawMaterials;

namespace Costing.Application.RawMaterials;

// What anyone who may see stock sees, cashiers included. No costs: those are a manager's, through
// the costing screens.
public sealed record RawMaterialDto(
    Guid Id,
    string Name,
    UnitOfMeasure Unit,
    decimal QuantityOnHand,
    decimal ReorderLevel,
    bool NeedsReorder,
    string? Code,
    // Its purchase category's name, and the category.
    string Category,
    string PurchaseUnit,
    decimal PurchaseUnitSize,
    decimal DefaultYieldPercent,
    MaterialKind Kind,
    Guid CategoryId,
    string? CategoryAr)
{
    public static RawMaterialDto From(RawMaterial material, PurchaseCategory? category) => new(
        material.Id,
        material.Name,
        material.Unit,
        material.QuantityOnHand,
        material.ReorderLevel,
        material.NeedsReorder,
        material.Code,
        category?.Name ?? PurchaseCategory.GeneralName,
        material.PurchaseUnit,
        material.PurchaseUnitSize,
        material.DefaultYieldPercent,
        material.Kind,
        material.CategoryId,
        category?.NameAr);
}

// The optional parts describe it for costing. PurchaseUnit and PurchaseUnitSize go together:
// "kg" and 1000 for a material counted in grams. CostPerPurchaseUnit is the price to start from.
// No CategoryId: General.
public sealed record CreateRawMaterialCommand(
    string Name,
    UnitOfMeasure Unit,
    decimal ReorderLevel = 0,
    string? Code = null,
    Guid? CategoryId = null,
    string? PurchaseUnit = null,
    decimal? PurchaseUnitSize = null,
    decimal? DefaultYieldPercent = null,
    decimal? CostPerPurchaseUnit = null) : IRequest<RawMaterialDto>;

internal sealed class CreateRawMaterialCommandHandler(IRawMaterialRepository materials, IPurchaseCategoryRepository categories, IUnitOfWork unitOfWork)
    : IRequestHandler<CreateRawMaterialCommand, RawMaterialDto>
{
    public async Task<RawMaterialDto> Handle(CreateRawMaterialCommand request, CancellationToken cancellationToken)
    {
        var category = await categories.ResolveAsync(request.CategoryId, CategoryKind.RawMaterials, null, cancellationToken);
        var material = new RawMaterial(request.Name, request.Unit, request.ReorderLevel);
        UpdateRawMaterialCommandHandler.Describe(material, request.Code, category.Id, request.PurchaseUnit, request.PurchaseUnitSize, request.DefaultYieldPercent, request.CostPerPurchaseUnit);
        materials.Add(material);

        await unitOfWork.SaveChangesAsync(cancellationToken);
        return RawMaterialDto.From(material, category);
    }
}

// No Unit here on purpose. Every recipe quantity and every ledger entry for a material is in
// its unit, so it is changed by ChangeMaterialUnitCommand, which restates them with it.
// CostPerPurchaseUnit null leaves the average cost as it is; a value replaces it. No CategoryId: General.
public sealed record UpdateRawMaterialCommand(
    Guid RawMaterialId,
    string Name,
    decimal ReorderLevel,
    string? Code = null,
    Guid? CategoryId = null,
    string? PurchaseUnit = null,
    decimal? PurchaseUnitSize = null,
    decimal? DefaultYieldPercent = null,
    decimal? CostPerPurchaseUnit = null) : IRequest<RawMaterialDto>;

internal sealed class UpdateRawMaterialCommandHandler(
    IRawMaterialRepository materials, IPurchaseCategoryRepository categories, IApprovalRequestRepository approvals, IUnitOfWork unitOfWork)
    : IRequestHandler<UpdateRawMaterialCommand, RawMaterialDto>
{
    public async Task<RawMaterialDto> Handle(UpdateRawMaterialCommand request, CancellationToken cancellationToken)
    {
        var material = await materials.GetRequiredAsync(request.RawMaterialId, cancellationToken);
        if (material.IsArchived)
            throw new DomainException($"{material.Name} has been deleted.");
        await approvals.EnsureNotPendingAsync(material.Id, cancellationToken);
        var category = await categories.ResolveAsync(request.CategoryId, CategoryKind.RawMaterials, material.CategoryId, cancellationToken);

        material.Rename(request.Name);
        material.SetReorderLevel(request.ReorderLevel);
        Describe(material, request.Code, category.Id, request.PurchaseUnit, request.PurchaseUnitSize, request.DefaultYieldPercent, request.CostPerPurchaseUnit);

        await unitOfWork.SaveChangesAsync(cancellationToken);
        return RawMaterialDto.From(material, category);
    }

    // Shared with creating one. The purchase unit first: the starting cost is per that unit.
    internal static void Describe(
        RawMaterial material, string? code, Guid categoryId, string? purchaseUnit, decimal? purchaseUnitSize, decimal? defaultYield, decimal? cost)
    {
        material.Describe(code, categoryId);
        if (purchaseUnit is not null || purchaseUnitSize is not null)
            material.SetPurchaseUnit(purchaseUnit ?? material.PurchaseUnit, purchaseUnitSize ?? material.PurchaseUnitSize);
        if (defaultYield is { } yield)
            material.SetDefaultYield(yield);
        if (cost is { } costPerPurchaseUnit)
            material.SetCost(costPerPurchaseUnit);
    }
}

public sealed record GetRawMaterialsQuery(bool NeedsReorderOnly = false) : IRequest<IReadOnlyList<RawMaterialDto>>;

internal sealed class GetRawMaterialsQueryHandler(IRawMaterialRepository materials, IPurchaseCategoryRepository categories)
    : IRequestHandler<GetRawMaterialsQuery, IReadOnlyList<RawMaterialDto>>
{
    public async Task<IReadOnlyList<RawMaterialDto>> Handle(GetRawMaterialsQuery request, CancellationToken cancellationToken)
    {
        var found = request.NeedsReorderOnly
            ? await materials.GetNeedingReorderAsync(cancellationToken)
            : await materials.GetAllAsync(cancellationToken);

        // Deleted ones are kept for the records that name them, off the lists.
        return await categories.DtosAsync(found.Where(m => !m.IsArchived), cancellationToken);
    }
}
```


`RawMaterialRepositoryExtensions`: جلب خامات طلب في رحلة واحدة، و **رفض الخامة المكررة في الطلب** بدل جمعها (في إذن الاستلام، التكرار غالبًا مسح مزدوج لا سطران حقيقيان، والجمع يخفيه).

> 📄 **`backend/src/Costing.Application/RawMaterials/RawMaterialRepositoryExtensions.cs`** — 29 سطر

```csharp
using Costing.Application.Common;
using Costing.Domain.Common;
using Costing.Domain.RawMaterials;

namespace Costing.Application.RawMaterials;

internal static class RawMaterialRepositoryExtensions
{
    // For requests that list materials, such as a delivery or a stock count. A material listed
    // twice is refused rather than summed. On a delivery note that is far more often a
    // double scan than two genuine lines, and summing would hide it.
    public static async Task<IReadOnlyDictionary<Guid, RawMaterial>> GetRequiredByIdsAsync(
        this IRawMaterialRepository materials, IReadOnlyCollection<Guid> ids, CancellationToken cancellationToken)
    {
        if (ids.Count == 0)
            throw new DomainException("List at least one raw material.");
        if (ids.Distinct().Count() != ids.Count)
            throw new DomainException("Each raw material can be listed only once.");

        var found = (await materials.GetByIdsAsync(ids, cancellationToken)).ToDictionary(m => m.Id);
        foreach (var id in ids)
        {
            if (!found.ContainsKey(id))
                throw new NotFoundException(nameof(RawMaterial), id);
        }

        return found;
    }
}
```


### 2.1 تغيير وحدة العدّ (`MaterialUnits`)

خامة أُنشئت بوحدة خاطئة (قطعة بدل جرام): إن لم يسجّلها شيء بعد، تتغير الوحدة ببساطة. وإن سجّلتها فواتير ووصفات وحركات، **تُعاد صياغة كل السجلات** صفًا صفًا في قاعدة البيانات: الكميات تُقسم على النسبة، والتكاليف تُضرب فيها، فتبقى **القيمة** كما هي. تغيير يمس الدفاتر ⇐ للمدير، وغيره يطلب.

> 📄 **`backend/src/Costing.Application/RawMaterials/MaterialUnits.cs`** — 211 سطر

```csharp
using System.Globalization;
using MediatR;
using Costing.Domain.Common;
using Costing.Application.Approvals;
using Costing.Application.Common;
using Costing.Domain.Approvals;
using Costing.Domain.Categories;
using Costing.Domain.RawMaterials;

namespace Costing.Application.RawMaterials;

// A bought material counted in another unit (عدّ بـ), as when it was created with the wrong one.
// While nothing records it, the unit simply changes, for anyone, with the unit it is bought in, its
// price and reorder level as given for the new one. Once something does (the ledger, an invoice, a
// recipe or prep recipe, a count, a batch it went into), OneNewIsOld says how many of the old unit one of the
// new is (60 g a piece; 1 when only the label was wrong), and everything recorded is restated in the
// new unit, quantities divided by it and costs per unit multiplied, so every amount of money is as
// it was. That is a manager's to do, recorded as decided by them, and asked of one by anyone else:
// the material locked until then. Without the conversion it is refused: archive it and create a
// new one instead. A prep item keeps its unit, as it does on its own screen.
public sealed record MaterialUnitChange(
    UnitOfMeasure Unit,
    decimal? OneNewIsOld,
    string PurchaseUnit,
    decimal PurchaseUnitSize,
    decimal? CostPerPurchaseUnit = null,
    decimal? ReorderLevel = null);

// What records a material: a unit change restates them all. PendingRequests: requests waiting for a
// manager that name it, whose quantities would be in the old unit.
public sealed record MaterialUsage(int StockMovements, int InvoiceLines, int Recipes, int PrepRecipes, int Counts, int Batches, int PendingRequests)
{
    public bool InUse => StockMovements + InvoiceLines + Recipes + PrepRecipes + Counts + Batches > 0;
}

// The records naming a material, read and restated where they are kept.
public interface IMaterialUnits
{
    Task<MaterialUsage> UsageAsync(RawMaterial material, Guid? exceptRequestId, CancellationToken cancellationToken);

    // Restates every record naming it in its new unit (oneNewIsOld of the old in one of the new),
    // and saves the unit of work with it, in one transaction.
    Task RestateAndSaveAsync(RawMaterial material, decimal oneNewIsOld, CancellationToken cancellationToken);
}

public sealed record ChangeMaterialUnitCommand(
    Guid RequestId, Guid RawMaterialId, MaterialUnitChange Change, string? Reason, string StaffId, string StaffName, bool CanApprove)
    : IRequest<MaterialUnitChangeResult>, IRetryOnConflict;

// Applied (the material as it is now) or Requested (as it was, until a manager decides).
public sealed record MaterialUnitChangeResult(ApprovalOutcome Outcome, RawMaterialDto Material, ApprovalRequestDto? Request);

public sealed record GetMaterialUsageQuery(Guid RawMaterialId) : IRequest<MaterialUsage>;

internal sealed class GetMaterialUsageHandler(IRawMaterialRepository materials, IMaterialUnits units) : IRequestHandler<GetMaterialUsageQuery, MaterialUsage>
{
    public async Task<MaterialUsage> Handle(GetMaterialUsageQuery request, CancellationToken cancellationToken) =>
        await units.UsageAsync(await materials.GetRequiredAsync(request.RawMaterialId, cancellationToken), null, cancellationToken);
}

internal sealed class ChangeMaterialUnitHandler(
    IRawMaterialRepository materials,
    IPurchaseCategoryRepository categories,
    IApprovalRequestRepository requests,
    MaterialUnitWriter writer,
    IUnitOfWork unitOfWork) : IRequestHandler<ChangeMaterialUnitCommand, MaterialUnitChangeResult>
{
    public async Task<MaterialUnitChangeResult> Handle(ChangeMaterialUnitCommand request, CancellationToken cancellationToken)
    {
        var material = await materials.GetRequiredAsync(request.RawMaterialId, cancellationToken);
        async Task<RawMaterialDto> Dto() => RawMaterialDto.From(material, await categories.GetRequiredAsync(material.CategoryId, cancellationToken));
        if (await requests.GetByIdAsync(request.RequestId, cancellationToken) is { } already)
            return new MaterialUnitChangeResult(ApprovalResultDto.Of(already).Outcome, await Dto(), ApprovalRequestDto.From(already));

        if (material.IsArchived)
            throw new DomainException($"{material.Name} has been deleted.");
        await requests.EnsureNotPendingAsync(material.Id, cancellationToken);
        var usage = await writer.CheckAsync(material, request.Change, null, cancellationToken);

        // Nothing records it yet: changed at once, for anyone.
        if (!usage.InUse)
        {
            await writer.ApplyAsync(material, request.Change, null, cancellationToken);
            await unitOfWork.SaveChangesAsync(cancellationToken);
            return new MaterialUnitChangeResult(ApprovalOutcome.Applied, await Dto(), null);
        }

        var (summary, changes) = writer.Describe(material, request.Change, usage);
        var payload = ApprovalPayload.Write(request.Change);
        if (!request.CanApprove)
        {
            var asked = ApprovalRequest.AskToChange(
                request.RequestId, ApprovalModule.RawMaterial, ApprovalAction.Update, material.Id, summary, changes, payload, request.Reason,
                request.StaffId, request.StaffName);
            requests.Add(asked);
            await unitOfWork.SaveChangesAsync(cancellationToken);
            return new MaterialUnitChangeResult(ApprovalOutcome.Requested, await Dto(), ApprovalRequestDto.From(asked));
        }

        var decided = ApprovalRequest.DecidedChange(
            request.RequestId, ApprovalModule.RawMaterial, ApprovalAction.Update, material.Id, summary, changes, payload, request.Reason,
            request.StaffId, request.StaffName);
        requests.Add(decided);
        await writer.ApplyAsync(material, request.Change, decided.Id, cancellationToken);
        return new MaterialUnitChangeResult(ApprovalOutcome.Applied, await Dto(), ApprovalRequestDto.From(decided));
    }
}

// Checks, describes and applies a unit change: for a manager's own and for an approval alike.
internal sealed class MaterialUnitWriter(IMaterialUnits units)
{
    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

    // What would stop it; checked again on approval, when that request is the one let through.
    public async Task<MaterialUsage> CheckAsync(RawMaterial material, MaterialUnitChange change, Guid? requestId, CancellationToken cancellationToken)
    {
        if (!Enum.IsDefined(change.Unit))
            throw new DomainException("Choose the unit it is counted in.");
        if (material.IsPrepItem)
            throw new DomainException($"{material.Name} is a prep item, kept in its unit: its stock and batches are in it. Add a new prep item for another unit.");
        if (change.Unit == material.Unit)
            throw new DomainException($"{material.Name} is counted in {Name(change.Unit)} already.");
        var usage = await units.UsageAsync(material, requestId, cancellationToken);
        if (usage.PendingRequests > 0)
            throw new DomainException($"A request waiting for a manager names {material.Name}: its unit can be changed once that is decided.");
        if (usage.InUse && change.OneNewIsOld is not > 0)
            throw new DomainException(
                $"{material.Name} is already recorded in {Name(material.Unit)}: say how many {Name(material.Unit)} one {One(change.Unit)} is, " +
                "or, if that cannot be said, archive it and create a new material.");
        return usage;
    }

    // Done: in use, everything restated and saved together; otherwise for the caller to save.
    public async Task ApplyAsync(RawMaterial material, MaterialUnitChange change, Guid? requestId, CancellationToken cancellationToken)
    {
        var usage = await CheckAsync(material, change, requestId, cancellationToken);
        if (!usage.InUse)
        {
            material.ChangeUnit(change.Unit, null);
            material.SetPurchaseUnit(change.PurchaseUnit, change.PurchaseUnitSize);
            if (change.CostPerPurchaseUnit is { } cost)
                material.SetCost(cost);
            if (change.ReorderLevel is { } level)
                material.SetReorderLevel(level);
            return;
        }

        var ratio = change.OneNewIsOld!.Value;
        material.ChangeUnit(change.Unit, ratio);
        material.SetPurchaseUnit(change.PurchaseUnit, change.PurchaseUnitSize);
        await units.RestateAndSaveAsync(material, ratio, cancellationToken);
    }

    // "Tomatoes counted in pieces, not g: 1 piece is 60 g", and what it changes.
    public (string Summary, IReadOnlyList<ApprovalChange> Changes) Describe(RawMaterial material, MaterialUnitChange change, MaterialUsage usage)
    {
        var ratio = change.OneNewIsOld ?? 1;
        var (from, to) = (material.Unit, change.Unit);
        // Said of the larger unit: "1 piece is 60 g" whichever way it goes.
        var conversion = ratio >= 1 ? $"1 {One(to)} is {Amount(ratio, from)}" : $"1 {One(from)} is {Amount(1 / ratio, to)}";
        var changes = new List<ApprovalChange>
        {
            new("Counted in", Name(from), Name(to)),
            new("Conversion", null, conversion),
            new("On hand", Amount(material.QuantityOnHand, from), Amount(material.QuantityOnHand / ratio, to)),
        };
        if (material.AverageCost is { } cost)
            changes.Add(new ApprovalChange("Average cost", $"{Money(cost)} a {One(from)}", $"{Money(cost * ratio)} a {One(to)}"));
        if (material.ReorderLevel != 0)
            changes.Add(new ApprovalChange("Reorder at", Amount(material.ReorderLevel, from), Amount(material.ReorderLevel / ratio, to)));
        changes.Add(new ApprovalChange(
            "Bought by", $"{material.PurchaseUnit} of {Amount(material.PurchaseUnitSize, from)}",
            $"{change.PurchaseUnit} of {Amount(change.PurchaseUnitSize, to)}"));
        var restated = new[]
        {
            Count(usage.StockMovements, "stock movement"), Count(usage.InvoiceLines, "invoice line"), Count(usage.Recipes, "recipe"),
            Count(usage.PrepRecipes, "prep recipe"), Count(usage.Counts, "stock count"), Count(usage.Batches, "batch"),
        }.Where(s => s is not null);
        changes.Add(new ApprovalChange("Restated in the new unit", null, string.Join(", ", restated)));
        return ($"{material.Name} counted in {Name(to)}, not {Name(from)}: {conversion}", changes);
    }

    private static string? Count(int n, string what) => n switch
    {
        0 => null,
        1 => $"1 {what}",
        _ => $"{n} {(what == "batch" ? "batches" : what + "s")}",
    };

    private static string Name(UnitOfMeasure unit) => unit switch
    {
        UnitOfMeasure.Gram => "g",
        UnitOfMeasure.Millilitre => "ml",
        _ => "pieces",
    };

    private static string One(UnitOfMeasure unit) => unit switch
    {
        UnitOfMeasure.Gram => "g",
        UnitOfMeasure.Millilitre => "ml",
        _ => "piece",
    };

    // "12 pieces", "1 piece", "2,400 g".
    private static string Amount(decimal value, UnitOfMeasure unit) => $"{Quantity(value)} {(Quantity(value) == "1" ? One(unit) : Name(unit))}";

    private static string Quantity(decimal value) => Math.Round(value, 3, MidpointRounding.AwayFromZero).ToString("#,0.###", Invariant);

    // Costs per unit are small: to the hundredth of a piastre when they need it.
    private static string Money(decimal value) => CompanyMoney.Text(Math.Round(value, 4, MidpointRounding.AwayFromZero), "#,0.00##");
}
```


> 📄 **`backend/src/Costing.Infrastructure/Persistence/MaterialUnits.cs`** — 64 سطر

```csharp
using Microsoft.EntityFrameworkCore;
using Costing.Application.RawMaterials;
using Costing.Domain.Approvals;
using Costing.Domain.Production;
using Costing.Domain.Purchases;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;
using Costing.Domain.StockCounts;

namespace Costing.Infrastructure.Persistence;

// The records naming a bought material, in the unit it is counted in: read to say what a unit
// change restates, and restated, row by row in the database, when it is made. Quantities are divided by
// how many of the old unit one of the new is, costs per unit multiplied, to the columns' places;
// totals of money are not touched.
internal sealed class MaterialUnits(CostingDbContext db) : IMaterialUnits
{
    public async Task<MaterialUsage> UsageAsync(RawMaterial material, Guid? exceptRequestId, CancellationToken cancellationToken)
    {
        var id = material.Id;
        var text = id.ToString();
        // A request waiting for a manager about it, or holding it in what it would make. They are
        // few, and the payload is JSON: read, and looked through here.
        var pending = await db.ApprovalRequests.AsNoTracking()
            .Where(r => r.Status == ApprovalStatus.Pending && r.Id != exceptRequestId)
            .Select(r => new { r.RecordId, r.Payload })
            .ToListAsync(cancellationToken);
        return new MaterialUsage(
            await db.StockMovements.CountAsync(m => m.RawMaterialId == id, cancellationToken),
            await db.Set<PurchaseInvoiceLine>().CountAsync(l => l.RawMaterialId == id, cancellationToken),
            await db.Set<RecipeIngredient>().Where(i => i.RawMaterialId == id).Select(i => i.RecipeId).Distinct().CountAsync(cancellationToken),
            await db.Set<PrepIngredient>().Where(i => i.RawMaterialId == id).Select(i => i.PrepRecipeId).Distinct().CountAsync(cancellationToken),
            await db.Set<StockCountLine>().Where(l => l.RawMaterialId == id).Select(l => l.StockCountId).Distinct().CountAsync(cancellationToken),
            await db.Set<ProductionOrderLine>().Where(l => l.RawMaterialId == id).Select(l => l.ProductionOrderId).Distinct().CountAsync(cancellationToken),
            pending.Count(r => r.RecordId == id || r.Payload?.Contains(text, StringComparison.OrdinalIgnoreCase) == true));
    }

    public async Task RestateAndSaveAsync(RawMaterial material, decimal oneNewIsOld, CancellationToken cancellationToken)
    {
        var (id, r) = (material.Id, oneNewIsOld);
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        await db.StockMovements.Where(m => m.RawMaterialId == id).ExecuteUpdateAsync(s => s
            .SetProperty(m => m.Quantity, m => Math.Round(m.Quantity / r, 3))
            .SetProperty(m => m.UnitCost, m => m.UnitCost * r), cancellationToken);
        await db.Set<PurchaseInvoiceLine>().Where(l => l.RawMaterialId == id).ExecuteUpdateAsync(s => s
            .SetProperty(l => l.Quantity, l => Math.Round(l.Quantity / r, 3))
            .SetProperty(l => l.UnitSize, l => Math.Round(l.UnitSize / r, 3)), cancellationToken);
        await db.Set<RecipeIngredient>().Where(i => i.RawMaterialId == id).ExecuteUpdateAsync(s => s
            .SetProperty(i => i.Quantity, i => Math.Round(i.Quantity / r, 3)), cancellationToken);
        await db.Set<PrepIngredient>().Where(i => i.RawMaterialId == id).ExecuteUpdateAsync(s => s
            .SetProperty(i => i.Quantity, i => Math.Round(i.Quantity / r, 3)), cancellationToken);
        await db.Set<StockCountLine>().Where(l => l.RawMaterialId == id).ExecuteUpdateAsync(s => s
            .SetProperty(l => l.CountedQuantity, l => Math.Round(l.CountedQuantity / r, 3))
            .SetProperty(l => l.BookQuantity, l => l.BookQuantity == null ? null : Math.Round(l.BookQuantity.Value / r, 3))
            .SetProperty(l => l.UnitCost, l => l.UnitCost * r), cancellationToken);
        await db.Set<ProductionOrderLine>().Where(l => l.RawMaterialId == id).ExecuteUpdateAsync(s => s
            .SetProperty(l => l.Quantity, l => Math.Round(l.Quantity / r, 3))
            .SetProperty(l => l.UnitCost, l => l.UnitCost * r), cancellationToken);

        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }
}
```


### 2.2 الفئات وحذفها وتحويل الأصناف

`PurchaseCategories.cs`: الفئات ونوعها، و "Misplaced": أصناف وُضعت في فئة من غير نوعها قبل فصل الأنواع.

> 📄 **`backend/src/Costing.Application/Categories/PurchaseCategories.cs`** — 117 سطر

```csharp
using MediatR;
using Costing.Domain.Common;
using Costing.Application.Approvals;
using Costing.Application.Common;
using Costing.Application.RawMaterials;
using Costing.Domain.Approvals;
using Costing.Domain.Categories;
using Costing.Domain.Expenses;
using Costing.Domain.RawMaterials;

namespace Costing.Application.Categories;

// The purchase categories raw materials and expense items are filed under. CategoryId is made by
// the till.

// Misplaced: items in use of the kind it is not, filed there before the kinds were kept apart.
public sealed record PurchaseCategoryDto(
    Guid Id, string Name, string? NameAr, ExpenseLine ExpenseLine, bool IsGeneral, int Materials, int ExpenseItems, CategoryKind Kind, int Misplaced)
{
    public static PurchaseCategoryDto From(PurchaseCategory category, PurchaseCategoryUse? use) => new(
        category.Id, category.Name, category.NameAr, category.ExpenseLine, category.IsGeneral, use?.Materials ?? 0, use?.ExpenseItems ?? 0,
        category.Kind, use?.Misplaced(category.Kind) ?? 0);
}

public static class PurchaseCategoryReading
{
    // The category asked for something of that kind, which must exist and be of its kind; none
    // asked for is the General of its kind, made if it is missing. Current: the one it is filed
    // under now, which it may stay in though it is of the other kind (filed before the kinds were
    // kept apart); moved, it goes to one of its own.
    public static async Task<PurchaseCategory> ResolveAsync(
        this IPurchaseCategoryRepository categories, Guid? categoryId, CategoryKind kind, Guid? current, CancellationToken cancellationToken)
    {
        var defaultId = PurchaseCategory.DefaultOf(kind);
        if (categoryId is { } id && id != defaultId)
        {
            var category = await categories.GetByIdAsync(id, cancellationToken)
                ?? throw new DomainException("That category is no longer on the list. Choose it again, or add it.");
            if (category.Kind != kind && id != current)
                throw new DomainException(kind == CategoryKind.RawMaterials
                    ? $"{category.Name} is a general expenses category: choose a raw materials category."
                    : $"{category.Name} is a raw materials category: choose a general expenses category.");
            return category;
        }

        var general = await categories.GetByIdAsync(defaultId, cancellationToken);
        if (general is null)
            categories.Add(general = kind == CategoryKind.Expenses ? PurchaseCategory.GeneralExpenses() : PurchaseCategory.General());
        return general;
    }

    // Materials as the stock screens show them, each with its category's name.
    public static async Task<IReadOnlyList<RawMaterialDto>> DtosAsync(
        this IPurchaseCategoryRepository categories, IEnumerable<RawMaterial> materials, CancellationToken cancellationToken)
    {
        var names = (await categories.GetAllAsync(cancellationToken)).ToDictionary(c => c.Id);
        return materials.Select(m => RawMaterialDto.From(m, names.GetValueOrDefault(m.CategoryId))).ToList();
    }

    public static async Task<RawMaterialDto> DtoAsync(this IPurchaseCategoryRepository categories, RawMaterial material, CancellationToken cancellationToken) =>
        (await categories.DtosAsync([material], cancellationToken))[0];
}

// By name, the Generals first.
public sealed record GetPurchaseCategoriesQuery : IRequest<IReadOnlyList<PurchaseCategoryDto>>;

internal sealed class GetPurchaseCategoriesHandler(IPurchaseCategoryRepository categories)
    : IRequestHandler<GetPurchaseCategoriesQuery, IReadOnlyList<PurchaseCategoryDto>>
{
    public async Task<IReadOnlyList<PurchaseCategoryDto>> Handle(GetPurchaseCategoriesQuery request, CancellationToken cancellationToken)
    {
        var use = await categories.GetUseAsync(cancellationToken);
        return (await categories.GetAllAsync(cancellationToken))
            .OrderByDescending(c => c.IsGeneral)
            .ThenBy(c => c.Name, StringComparer.CurrentCultureIgnoreCase)
            .Select(c => PurchaseCategoryDto.From(c, use.GetValueOrDefault(c.Id)))
            .ToList();
    }
}

// Adds the category, or changes it. Two cannot share a name: the reports could not tell them apart.
// Kind: what it files; a new one is raw materials unless said, and one already there keeps its
// own unless said (and changes it only while it holds nothing of the other kind).
public sealed record SavePurchaseCategoryCommand(
    Guid CategoryId, string Name, string? NameAr = null, ExpenseLine ExpenseLine = ExpenseLine.Controllable, CategoryKind? Kind = null)
    : IRequest<PurchaseCategoryDto>;

internal sealed class SavePurchaseCategoryHandler(IPurchaseCategoryRepository categories, IApprovalRequestRepository requests, IUnitOfWork unitOfWork)
    : IRequestHandler<SavePurchaseCategoryCommand, PurchaseCategoryDto>
{
    public async Task<PurchaseCategoryDto> Handle(SavePurchaseCategoryCommand request, CancellationToken cancellationToken)
    {
        if (!string.IsNullOrWhiteSpace(request.Name)
            && await categories.GetByNormalizedNameAsync(PurchaseCategory.Normalize(request.Name), cancellationToken) is { } namesake
            && namesake.Id != request.CategoryId)
            throw new DomainException($"There is already a category called {namesake.Name}.");

        var category = await categories.GetByIdAsync(request.CategoryId, cancellationToken);
        if (category is null)
            categories.Add(category = new PurchaseCategory(
                request.CategoryId, request.Name, request.NameAr, request.ExpenseLine, request.Kind ?? CategoryKind.RawMaterials));
        else
        {
            // Locked while its deletion waits for a manager.
            await requests.EnsureNotPendingAsync(category.Id, cancellationToken);
            category.Update(request.Name, request.NameAr, request.ExpenseLine);
            if (request.Kind is { } kind && kind != category.Kind)
            {
                var use = (await categories.GetUseAsync(cancellationToken)).GetValueOrDefault(category.Id);
                category.ChangeKind(kind, use?.Misplaced(kind) ?? 0);
            }
        }

        await unitOfWork.SaveChangesAsync(cancellationToken);
        return PurchaseCategoryDto.From(category, (await categories.GetUseAsync(cancellationToken)).GetValueOrDefault(category.Id));
    }
}
```


`CategoryDeletion.cs`: حذف فئة فيها أصناف يتطلب خطة لكل صنف: نقله لفئة أخرى، أو **تحويل مصروف إلى خامة** (بوحدته وكيف يُشترى) أو العكس، مع **إعادة صياغة** ما سُجّل (`ExpenseRestatement`). معاينة أولًا (`PreviewCategoryDeletionQuery`) ثم التنفيذ.

> 📄 **`backend/src/Costing.Application/Categories/CategoryDeletion.cs`** — 401 سطر

```csharp
using System.Globalization;
using MediatR;
using Costing.Domain.Common;
using Costing.Application.Approvals;
using Costing.Application.Common;
using Costing.Domain.Approvals;
using Costing.Domain.Categories;
using Costing.Domain.Expenses;
using Costing.Domain.RawMaterials;

namespace Costing.Application.Categories;

// An expense item made a raw material: what it is counted in, and how it is bought (a bottle of
// 750 ml).
public sealed record StockUnit(Guid ExpenseItemId, UnitOfMeasure Unit, string PurchaseUnit, decimal PurchaseUnitSize);

// A category's deletion as asked: where its raw materials go and where its expense items go, each
// to a category of its own kind or, converted on the way, of the other (Units: what each expense
// item made a raw material is counted in and bought by); and what was in it then, so a manager
// approves what was asked and nothing put in it since.
public sealed record CategoryDeletion(
    Guid MaterialsTo,
    Guid ExpenseItemsTo,
    IReadOnlyList<StockUnit> Units,
    IReadOnlyList<Guid> Materials,
    IReadOnlyList<Guid> ExpenseItems,
    bool MaterialsBecomeExpenses = false);

// What making raw materials expenses restates: their invoice lines and what they cost, their
// ledger entries and their count lines.
public sealed record ExpenseRestatement(int InvoiceLines, decimal InvoiceTotal, int StockMovements, int CountLines);

// The records naming the items, read and restated where they are kept.
public interface IItemConversions
{
    // Why these materials cannot be made expenses, each said by name: in a recipe, a prep recipe
    // or a batch; sold or used through one; received with no invoice; on an invoice with no
    // price; a shared cost; on an invoice beside the expense item it would join (namesakes, by
    // material); or named by a request waiting for a manager.
    Task<IReadOnlyList<string>> ExpenseBlockersAsync(
        IReadOnlyList<RawMaterial> materials, IReadOnlyDictionary<Guid, Guid> namesakes, Guid? exceptRequestId, CancellationToken cancellationToken);

    Task<ExpenseRestatement> RestatementAsync(IReadOnlyList<Guid> materialIds, CancellationToken cancellationToken);

    // Requests waiting for a manager that name any of these records.
    Task<int> PendingNamingAsync(IReadOnlyCollection<Guid> ids, Guid? exceptRequestId, CancellationToken cancellationToken);

    // Saves the unit of work, then moves each material's invoice lines onto its expense item and
    // takes its ledger entries and count lines out: all in one transaction.
    Task RestateAndSaveAsync(IReadOnlyList<(Guid MaterialId, Guid ExpenseItemId)> pairs, CancellationToken cancellationToken);
}

// Deletes the category, its raw materials first moved to MaterialsTo and its expense items to
// ExpenseItemsTo: one holding anything is not deleted without somewhere for it to go, and the
// purchases go with it. Each kind moved to a category of its kind goes as it is, done at once for
// whoever keeps stock; moved to one of the other kind, it is converted on the way, and that is a
// manager's: at once for one, kept with the decisions; asked of one by anyone else, the category
// locked until then. RequestId is made by the till.
public sealed record DeletePurchaseCategoryCommand(
    Guid CategoryId,
    Guid? MaterialsTo = null,
    Guid? ExpenseItemsTo = null,
    IReadOnlyList<StockUnit>? Units = null,
    Guid? RequestId = null,
    string? Reason = null,
    string StaffId = "",
    string StaffName = "",
    bool CanApprove = true,
    // False for a plain move: one that would convert anything is refused.
    bool AllowConversion = true) : IRequest<CategoryDeletionResult>, IRetryOnConflict;

// Applied (Request: the decision kept, when it converted anything) or Requested.
public sealed record CategoryDeletionResult(ApprovalOutcome Outcome, ApprovalRequestDto? Request);

// What a deletion would do, checked as it will be when sent; nothing is saved.
public sealed record PreviewCategoryDeletionQuery(Guid CategoryId, Guid? MaterialsTo, Guid? ExpenseItemsTo, IReadOnlyList<StockUnit>? Units)
    : IRequest<CategoryDeletionPreview>;

// Converts: whether it is a manager's to decide.
public sealed record CategoryDeletionPreview(string Summary, IReadOnlyList<ApprovalChange> Changes, bool Converts);

internal sealed class PreviewCategoryDeletionHandler(IPurchaseCategoryRepository categories, CategoryDeleter deleter)
    : IRequestHandler<PreviewCategoryDeletionQuery, CategoryDeletionPreview>
{
    public async Task<CategoryDeletionPreview> Handle(PreviewCategoryDeletionQuery request, CancellationToken cancellationToken)
    {
        var category = await categories.GetRequiredAsync(request.CategoryId, cancellationToken);
        var plan = await deleter.PlanAsync(category, request.MaterialsTo, request.ExpenseItemsTo, request.Units ?? [], null, cancellationToken);
        return new CategoryDeletionPreview(plan.Summary, plan.Changes, plan.Converts);
    }
}

internal sealed class DeletePurchaseCategoryHandler(
    IPurchaseCategoryRepository categories,
    IApprovalRequestRepository requests,
    CategoryDeleter deleter,
    IUnitOfWork unitOfWork) : IRequestHandler<DeletePurchaseCategoryCommand, CategoryDeletionResult>
{
    public async Task<CategoryDeletionResult> Handle(DeletePurchaseCategoryCommand request, CancellationToken cancellationToken)
    {
        if (request.RequestId is { } sent && await requests.GetByIdAsync(sent, cancellationToken) is { } already)
            return new CategoryDeletionResult(ApprovalResultDto.Of(already).Outcome, ApprovalRequestDto.From(already));
        // Already gone: a retry of a delete that worked.
        if (await categories.GetByIdAsync(request.CategoryId, cancellationToken) is not { } category)
            return new CategoryDeletionResult(ApprovalOutcome.Applied, null);

        await requests.EnsureNotPendingAsync(category.Id, cancellationToken);
        var plan = await deleter.PlanAsync(category, request.MaterialsTo, request.ExpenseItemsTo, request.Units ?? [], null, cancellationToken);
        if (plan.Converts && !request.AllowConversion)
            throw new DomainException(
                $"Moving what is in {category.Name} there would convert it to the other kind. Delete it from the categories screen, which asks where each kind goes.");
        if (!plan.Converts)
        {
            await deleter.ApplyAsync(plan, request.StaffName, cancellationToken);
            return new CategoryDeletionResult(ApprovalOutcome.Applied, null);
        }

        var id = request.RequestId ?? Guid.NewGuid();
        var payload = ApprovalPayload.Write(plan.Deletion);
        if (!request.CanApprove)
        {
            var asked = ApprovalRequest.AskToChange(
                id, ApprovalModule.PurchaseCategory, ApprovalAction.Delete, category.Id, plan.Summary, plan.Changes, payload, request.Reason,
                request.StaffId, request.StaffName);
            requests.Add(asked);
            await unitOfWork.SaveChangesAsync(cancellationToken);
            return new CategoryDeletionResult(ApprovalOutcome.Requested, ApprovalRequestDto.From(asked));
        }

        var decided = ApprovalRequest.DecidedChange(
            id, ApprovalModule.PurchaseCategory, ApprovalAction.Delete, category.Id, plan.Summary, plan.Changes, payload, request.Reason,
            request.StaffId, request.StaffName);
        requests.Add(decided);
        await deleter.ApplyAsync(plan, request.StaffName, cancellationToken);
        return new CategoryDeletionResult(ApprovalOutcome.Applied, ApprovalRequestDto.From(decided));
    }
}

// Plans, describes and carries out a category's deletion: for a manager's own and for an
// approval alike, checked again on approval against what is in the category then.
internal sealed class CategoryDeleter(
    IPurchaseCategoryRepository categories,
    IRawMaterialRepository materials,
    IExpenseItemRepository expenses,
    IItemConversions conversions,
    IUnitOfWork unitOfWork)
{
    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

    internal sealed record Plan(
        PurchaseCategory Category,
        PurchaseCategory? MaterialsTarget,
        PurchaseCategory? ExpensesTarget,
        CategoryDeletion Deletion,
        IReadOnlyList<RawMaterial> Materials,
        IReadOnlyList<ExpenseItem> ExpenseItems,
        IReadOnlyDictionary<Guid, ExpenseItem> Namesakes,
        string Summary,
        IReadOnlyList<ApprovalChange> Changes)
    {
        // Its raw materials going to a general expenses category: made expense items.
        public bool MaterialsBecomeExpenses => Deletion.MaterialsBecomeExpenses;

        // Its expense items in use going to a raw materials category: made raw materials.
        public bool ExpenseItemsBecomeStock => Deletion.Units.Count > 0;

        public bool Converts => MaterialsBecomeExpenses || ExpenseItemsBecomeStock;
    }

    // Everything that would refuse it, refused now.
    public async Task<Plan> PlanAsync(
        PurchaseCategory category, Guid? materialsTo, Guid? expenseItemsTo, IReadOnlyList<StockUnit> units, Guid? exceptRequestId,
        CancellationToken cancellationToken)
    {
        if (category.IsGeneral)
            throw new DomainException($"{category.Name} stays: it is where anything not yet sorted goes. Rename it if you like.");

        var inMaterials = (await materials.GetAllAsync(cancellationToken)).Where(m => m.CategoryId == category.Id).ToList();
        var inExpenses = (await expenses.GetInCategoryAsync(category.Id, cancellationToken))
            .OrderBy(e => e.Name, StringComparer.CurrentCultureIgnoreCase)
            .ToList();
        var materialsTarget = inMaterials.Count > 0 ? await TargetAsync(category, materialsTo, "raw materials", cancellationToken) : null;
        var expensesTarget = inExpenses.Count > 0 ? await TargetAsync(category, expenseItemsTo, "expense items", cancellationToken) : null;

        var namesakes = new Dictionary<Guid, ExpenseItem>();
        if (materialsTarget?.Kind == CategoryKind.Expenses)
            await CheckExpensesAsync(category, inMaterials, namesakes, exceptRequestId, cancellationToken);
        // The ones in use are made raw materials; archived ones move as they are.
        var stockUnits = expensesTarget?.Kind == CategoryKind.RawMaterials
            ? await CheckStockAsync([.. inExpenses.Where(e => !e.IsArchived)], units, exceptRequestId, cancellationToken)
            : [];

        var deletion = new CategoryDeletion(
            materialsTarget?.Id ?? Guid.Empty, expensesTarget?.Id ?? Guid.Empty, stockUnits,
            [.. inMaterials.Select(m => m.Id).Order()], [.. inExpenses.Select(e => e.Id).Order()],
            inMaterials.Count > 0 && materialsTarget?.Kind == CategoryKind.Expenses);
        var plan = new Plan(category, materialsTarget, expensesTarget, deletion, inMaterials, inExpenses, namesakes, "", []);
        var (summary, changes) = await DescribeAsync(plan, cancellationToken);
        return plan with { Summary = summary, Changes = changes };
    }

    // On approval: planned again as it is now, and refused if what is in the category changed.
    public async Task ApplyApprovedAsync(Guid categoryId, CategoryDeletion asked, Guid requestId, string by, CancellationToken cancellationToken)
    {
        var category = await categories.GetByIdAsync(categoryId, cancellationToken)
            ?? throw new DomainException("That category has been deleted already: reject this request.");
        var plan = await PlanAsync(
            category, NoneIfEmpty(asked.MaterialsTo), NoneIfEmpty(asked.ExpenseItemsTo), asked.Units, requestId, cancellationToken);
        if (!plan.Deletion.Materials.SequenceEqual(asked.Materials) || !plan.Deletion.ExpenseItems.SequenceEqual(asked.ExpenseItems)
            || plan.Deletion.Units.Count != asked.Units.Count || plan.MaterialsBecomeExpenses != asked.MaterialsBecomeExpenses)
            throw new DomainException($"What is in {category.Name} has changed since it was asked: reject this request, and ask again.");
        await ApplyAsync(plan, by, cancellationToken);
    }

    private static Guid? NoneIfEmpty(Guid id) => id == Guid.Empty ? null : id;

    // Where something of the category goes: another category, which must be there.
    private async Task<PurchaseCategory> TargetAsync(PurchaseCategory category, Guid? to, string what, CancellationToken cancellationToken)
    {
        if (to is not { } id || id == Guid.Empty)
            throw new DomainException($"{category.Name} holds {what}: choose the category they move to.");
        if (id == category.Id)
            throw new DomainException($"Choose another category for its {what}.");
        return await categories.GetByIdAsync(id, cancellationToken)
            ?? throw new DomainException("That category is no longer on the list. Choose it again, or add it.");
    }

    // Done and saved: everything moved, converted as planned, and the category gone.
    public async Task ApplyAsync(Plan plan, string by, CancellationToken cancellationToken)
    {
        var units = plan.Deletion.Units.ToDictionary(u => u.ExpenseItemId);
        var pairs = new List<(Guid MaterialId, Guid ExpenseItemId)>();
        var target = plan.MaterialsTarget?.Id ?? Guid.Empty;
        foreach (var material in plan.Materials)
        {
            ExpenseItem expense;
            material.MoveTo(target);
            if (!plan.MaterialsBecomeExpenses)
                continue;

            // The expense item of its name, when there is one (read only to find it: loaded to be
            // changed); otherwise a new one, counted as it was bought.
            if (plan.Namesakes.TryGetValue(material.Id, out var namesake))
            {
                expense = await expenses.GetRequiredAsync(namesake.Id, cancellationToken);
                expense.Restore();
                expense.MoveTo(target);
            }
            else
            {
                expenses.Add(expense = new ExpenseItem(Guid.NewGuid(), material.Name, target, null, material.PurchaseUnit));
            }
            material.ConvertToExpense(by);
            pairs.Add((material.Id, expense.Id));
        }

        var expensesTarget = plan.ExpensesTarget?.Id ?? Guid.Empty;
        foreach (var item in plan.ExpenseItems)
        {
            item.MoveTo(expensesTarget);
            if (units.TryGetValue(item.Id, out var unit))
            {
                var material = new RawMaterial(item.Name, unit.Unit);
                material.SetPurchaseUnit(unit.PurchaseUnit, unit.PurchaseUnitSize);
                material.Describe(null, expensesTarget);
                materials.Add(material);
                item.Archive();
            }
        }

        categories.Remove(plan.Category);
        if (pairs.Count > 0)
            await conversions.RestateAndSaveAsync(pairs, cancellationToken);
        else
            await unitOfWork.SaveChangesAsync(cancellationToken);
    }

    private async Task CheckExpensesAsync(
        PurchaseCategory category, IReadOnlyList<RawMaterial> inMaterials, Dictionary<Guid, ExpenseItem> namesakes, Guid? exceptRequestId,
        CancellationToken cancellationToken)
    {
        if (inMaterials.FirstOrDefault(m => m.IsPrepItem) is { } prep)
            throw new DomainException($"{prep.Name} is a prep item, made in the kitchen: move it out of {category.Name} first.");
        if (inMaterials.GroupBy(m => ExpenseItem.Normalize(m.Name)).FirstOrDefault(g => g.Count() > 1) is { } twice)
            throw new DomainException($"Two raw materials in {category.Name} are called {twice.First().Name}: rename one first.");
        foreach (var material in inMaterials)
            if (await expenses.GetByNormalizedNameAsync(ExpenseItem.Normalize(material.Name), cancellationToken) is { } namesake)
                namesakes[material.Id] = namesake;

        var blockers = await conversions.ExpenseBlockersAsync(
            inMaterials, namesakes.ToDictionary(n => n.Key, n => n.Value.Id), exceptRequestId, cancellationToken);
        if (blockers.Count > 0)
            throw new DomainException(
                $"Its raw materials cannot be made expenses: {string.Join(" ", blockers.Take(4))}" +
                (blockers.Count > 4 ? $" And {blockers.Count - 4} more." : "") +
                " Move them as they are instead, or put those right first.");
    }

    private async Task<List<StockUnit>> CheckStockAsync(
        IReadOnlyList<ExpenseItem> toStock, IReadOnlyList<StockUnit> units, Guid? exceptRequestId, CancellationToken cancellationToken)
    {
        var given = units.GroupBy(u => u.ExpenseItemId).ToDictionary(g => g.Key, g => g.First());
        var names = (await materials.GetAllAsync(cancellationToken)).Where(m => !m.IsArchived).Select(m => ExpenseItem.Normalize(m.Name)).ToHashSet();
        var checkedUnits = new List<StockUnit>();
        foreach (var item in toStock)
        {
            if (!given.TryGetValue(item.Id, out var unit) || !Enum.IsDefined(unit.Unit))
                throw new DomainException($"Say what {item.Name} is counted in, and what it is bought by.");
            if (string.IsNullOrWhiteSpace(unit.PurchaseUnit) || unit.PurchaseUnit.Trim().Length > 32)
                throw new DomainException($"Name what {item.Name} is bought by, such as kg or bottle, in under 32 characters.");
            if (unit.PurchaseUnitSize <= 0)
                throw new DomainException($"Say how much one {unit.PurchaseUnit.Trim()} of {item.Name} holds: more than nothing.");
            if (names.Contains(item.NormalizedName))
                throw new DomainException($"There is already a raw material called {item.Name}: rename one first.");
            checkedUnits.Add(unit with { PurchaseUnit = unit.PurchaseUnit.Trim() });
        }
        if (await conversions.PendingNamingAsync([.. toStock.Select(e => e.Id)], exceptRequestId, cancellationToken) > 0)
            throw new DomainException("A request waiting for a manager names one of its expense items: they can be converted once it is decided.");
        return checkedUnits;
    }

    // "Category منظفات deleted: 1 raw material becomes an expense item in صيانه", and line by line
    // what it does.
    private async Task<(string Summary, IReadOnlyList<ApprovalChange> Changes)> DescribeAsync(Plan plan, CancellationToken cancellationToken)
    {
        var changes = new List<ApprovalChange>();
        var converted = new List<string>();
        var (inMaterials, inExpenses) = (plan.Materials, plan.ExpenseItems);
        if (plan.MaterialsBecomeExpenses)
        {
            converted.Add($"{Count(inMaterials.Count, "raw material")} {(inMaterials.Count == 1 ? "becomes an expense item" : "become expense items")} in {plan.MaterialsTarget!.Name}");
            foreach (var m in inMaterials)
                changes.Add(new ApprovalChange(
                    m.Name, $"Raw material, {Amount(m.QuantityOnHand, m.Unit)} on hand",
                    plan.Namesakes.TryGetValue(m.Id, out var joins) ? $"Expense item (joins {joins.Name})" : "Expense item"));
            var restated = await conversions.RestatementAsync([.. inMaterials.Select(m => m.Id)], cancellationToken);
            changes.Add(new ApprovalChange(
                "Invoice lines", null,
                restated.InvoiceLines == 0
                    ? "None: never bought on an invoice"
                    : $"{Count(restated.InvoiceLines, "line")} ({Money(restated.InvoiceTotal)}) restated as expenses, each on its invoice's date"));
            string[] ledger =
            [
                .. restated.StockMovements > 0 ? [Count(restated.StockMovements, "entry", "entries")] : Array.Empty<string>(),
                .. restated.CountLines > 0 ? [Count(restated.CountLines, "count line")] : Array.Empty<string>(),
            ];
            changes.Add(new ApprovalChange("Stock ledger", null, ledger.Length == 0 ? "Nothing in it" : $"{string.Join(" and ", ledger)} taken out"));
            changes.Add(new ApprovalChange("Their expenses count as", null, Line(plan.MaterialsTarget.ExpenseLine)));
        }
        if (plan.ExpenseItemsBecomeStock)
        {
            var made = plan.Deletion.Units.Count;
            converted.Add($"{Count(made, "expense item")} {(made == 1 ? "becomes a raw material" : "become raw materials")} in {plan.ExpensesTarget!.Name}");
            foreach (var unit in plan.Deletion.Units)
                changes.Add(new ApprovalChange(
                    inExpenses.Single(e => e.Id == unit.ExpenseItemId).Name, "Expense item",
                    $"Raw material counted in {Unit(unit.Unit)}, bought by the {unit.PurchaseUnit} of {Amount(unit.PurchaseUnitSize, unit.Unit)}"));
            changes.Add(new ApprovalChange("Past expense lines", null, "Stay expenses; each starts with nothing on hand"));
        }

        // The rest goes as it is.
        var moved = new List<string>();
        if (inMaterials.Count > 0 && !plan.MaterialsBecomeExpenses)
            moved.Add($"{Count(inMaterials.Count, "raw material")} to {plan.MaterialsTarget!.Name}");
        var expensesAsTheyAre = inExpenses.Count - plan.Deletion.Units.Count;
        if (expensesAsTheyAre > 0)
            moved.Add($"{Count(expensesAsTheyAre, "expense item")} to {plan.ExpensesTarget!.Name}");
        if (moved.Count > 0)
            changes.Add(new ApprovalChange("Moved as they are", null, string.Join("; ", moved)));

        var summary = converted.Count > 0
            ? $"Category {plan.Category.Name} deleted: {string.Join("; ", converted)}"
            : moved.Count > 0 ? $"Category {plan.Category.Name} deleted, what is in it moved" : $"Category {plan.Category.Name} deleted";
        return (summary, changes);
    }

    private static string Count(int n, string what, string? plural = null) => n == 1 ? $"1 {what}" : $"{n} {plural ?? what + "s"}";

    private static string Unit(UnitOfMeasure unit) => unit switch
    {
        UnitOfMeasure.Gram => "g",
        UnitOfMeasure.Millilitre => "ml",
        _ => "pieces",
    };

    private static string Line(ExpenseLine line) => line switch
    {
        ExpenseLine.Occupation => "Occupation costs",
        ExpenseLine.OtherFixed => "Other fixed costs",
        ExpenseLine.Wages => "Wages and benefits",
        _ => "Controllable costs",
    };

    // "12 pieces", "1 piece", "2,400 g".
    private static string Amount(decimal value, UnitOfMeasure unit) =>
        $"{Quantity(value)} {(Quantity(value) == "1" && unit == UnitOfMeasure.Piece ? "piece" : Unit(unit))}";

    private static string Quantity(decimal value) => Math.Round(value, 3, MidpointRounding.AwayFromZero).ToString("#,0.###", Invariant);

    private static string Money(decimal value) => CompanyMoney.Text(value, "#,0.00");
}
```


`ItemConversions`: التحويل نفسه في قاعدة البيانات: ما يمنعه (خامة استُخدمت في وصفات أو دفعات أو مبيعات لا تصبح مصروفًا)، وما يعيد صياغته.

> 📄 **`backend/src/Costing.Infrastructure/Persistence/ItemConversions.cs`** — 104 سطر

```csharp
using Microsoft.EntityFrameworkCore;
using Costing.Application.Categories;
using Costing.Domain.Approvals;
using Costing.Domain.Production;
using Costing.Domain.Purchases;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;
using Costing.Domain.StockCounts;
using Costing.Domain.StockMovements;

namespace Costing.Infrastructure.Persistence;

// Raw materials made expense items, in the database: what would stop it, what it restates, and
// the restating itself. A material that was only ever bought, counted or thrown away can be; one
// that recipes, batches or sales have used is stock, and stays so.
internal sealed class ItemConversions(CostingDbContext db) : IItemConversions
{
    // What a material's ledger may hold to be made an expense: its purchases, counts and waste.
    private static readonly StockMovementReason[] Kept =
        [StockMovementReason.Purchase, StockMovementReason.CountAdjustment, StockMovementReason.OpeningStock, StockMovementReason.Spoilage];

    public async Task<IReadOnlyList<string>> ExpenseBlockersAsync(
        IReadOnlyList<RawMaterial> materials, IReadOnlyDictionary<Guid, Guid> namesakes, Guid? exceptRequestId, CancellationToken cancellationToken)
    {
        var ids = materials.Select(m => m.Id).ToList();
        var names = materials.ToDictionary(m => m.Id, m => m.Name);
        var found = new List<(string Name, string Why)>();
        void Add(IEnumerable<Guid> which, string why) => found.AddRange(which.Distinct().Select(id => (names[id], why)));

        Add(await db.Set<RecipeIngredient>().Where(i => ids.Contains(i.RawMaterialId)).Select(i => i.RawMaterialId).ToListAsync(cancellationToken),
            "is in a recipe");
        Add(await db.Set<PrepIngredient>().Where(i => ids.Contains(i.RawMaterialId)).Select(i => i.RawMaterialId).ToListAsync(cancellationToken),
            "is in a prep recipe");
        Add(await db.Set<ProductionOrderLine>().Where(l => ids.Contains(l.RawMaterialId)).Select(l => l.RawMaterialId).ToListAsync(cancellationToken),
            "went into a batch");
        Add(await db.StockMovements.Where(m => ids.Contains(m.RawMaterialId) && !Kept.Contains(m.Reason)).Select(m => m.RawMaterialId).ToListAsync(cancellationToken),
            "has been sold or used through a recipe");
        Add(await db.StockMovements
                .Where(m => ids.Contains(m.RawMaterialId) && m.Reason == StockMovementReason.Purchase && !db.PurchaseInvoices.Any(i => i.Id == m.SourceId))
                .Select(m => m.RawMaterialId).ToListAsync(cancellationToken),
            "was received with no invoice");
        Add(await db.Set<PurchaseInvoiceLine>().Where(l => l.RawMaterialId != null && ids.Contains(l.RawMaterialId.Value) && l.Cost == null)
                .Select(l => l.RawMaterialId!.Value).ToListAsync(cancellationToken),
            "is on an invoice with no price: an expense line has its amount, so price it first");
        Add(await db.SharedCosts.Where(c => c.RawMaterialId != null && ids.Contains(c.RawMaterialId.Value)).Select(c => c.RawMaterialId!.Value)
                .ToListAsync(cancellationToken),
            "is a shared cost");

        // An invoice holding it beside the expense item of its name would hold that item twice.
        foreach (var (material, expense) in namesakes)
            if (await db.Set<PurchaseInvoiceLine>().AnyAsync(
                    l => l.RawMaterialId == material
                        && db.Set<PurchaseInvoiceLine>().Any(other => other.InvoiceId == l.InvoiceId && other.ExpenseItemId == expense),
                    cancellationToken))
                Add([material], "is on an invoice beside the expense item of its name");

        foreach (var id in ids)
            if (await PendingNamingAsync([id], exceptRequestId, cancellationToken) > 0)
                Add([id], "is named by a request waiting for a manager");

        return found.OrderBy(f => f.Name, StringComparer.CurrentCultureIgnoreCase).ThenBy(f => f.Why).Select(f => $"{f.Name} {f.Why}.").ToList();
    }

    public async Task<ExpenseRestatement> RestatementAsync(IReadOnlyList<Guid> materialIds, CancellationToken cancellationToken)
    {
        var lines = db.Set<PurchaseInvoiceLine>().Where(l => l.RawMaterialId != null && materialIds.Contains(l.RawMaterialId.Value));
        return new ExpenseRestatement(
            await lines.CountAsync(cancellationToken),
            await lines.SumAsync(l => l.Cost ?? 0, cancellationToken),
            await db.StockMovements.CountAsync(m => materialIds.Contains(m.RawMaterialId), cancellationToken),
            await db.Set<StockCountLine>().CountAsync(l => materialIds.Contains(l.RawMaterialId), cancellationToken));
    }

    // Read, and looked through here: the payload is JSON, and they are few.
    public async Task<int> PendingNamingAsync(IReadOnlyCollection<Guid> ids, Guid? exceptRequestId, CancellationToken cancellationToken)
    {
        var pending = await db.ApprovalRequests.AsNoTracking()
            .Where(r => r.Status == ApprovalStatus.Pending && r.Id != exceptRequestId)
            .Select(r => new { r.RecordId, r.Payload })
            .ToListAsync(cancellationToken);
        var texts = ids.Select(id => id.ToString()).ToList();
        return pending.Count(r => ids.Contains(r.RecordId) || texts.Any(t => r.Payload?.Contains(t, StringComparison.OrdinalIgnoreCase) == true));
    }

    // As if each had always been its expense item: its invoice lines that item's, each as entered
    // (5 kg, at what it cost), and nothing of it in the stock ledger or on the counts.
    public async Task RestateAndSaveAsync(IReadOnlyList<(Guid MaterialId, Guid ExpenseItemId)> pairs, CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        foreach (var (material, expense) in pairs)
        {
            await db.Set<PurchaseInvoiceLine>().Where(l => l.RawMaterialId == material).ExecuteUpdateAsync(s => s
                .SetProperty(l => l.ItemType, PurchaseItemType.Expense)
                .SetProperty(l => l.ExpenseItemId, (Guid?)expense)
                .SetProperty(l => l.RawMaterialId, (Guid?)null)
                .SetProperty(l => l.UnitSize, 1m)
                .SetProperty(l => l.Quantity, l => l.EnteredQuantity), cancellationToken);
            await db.StockMovements.Where(m => m.RawMaterialId == material).ExecuteDeleteAsync(cancellationToken);
            await db.Set<StockCountLine>().Where(l => l.RawMaterialId == material).ExecuteDeleteAsync(cancellationToken);
        }
        await transaction.CommitAsync(cancellationToken);
    }
}
```


`ExpenseItems.cs`: المصروفات العمومية؛ المصروف المستخدم في فواتير يُؤرشف ولا يُحذف.

> 📄 **`backend/src/Costing.Application/Expenses/ExpenseItems.cs`** — 146 سطر

```csharp
using MediatR;
using Costing.Domain.Common;
using Costing.Application.Categories;
using Costing.Application.Common;
using Costing.Domain.Categories;
using Costing.Domain.Expenses;
using Costing.Domain.Purchases;

namespace Costing.Application.Expenses;

// The expense items purchase invoices can carry beside raw materials: never stock, only a cost
// under a category. ExpenseItemId is made by the till.

public sealed record ExpenseItemDto(
    Guid Id,
    string Name,
    string? NameAr,
    Guid CategoryId,
    string Category,
    string? CategoryAr,
    string? Unit,
    bool IsArchived,
    // Invoices it is on, drafts included: any at all and deleting it archives it instead.
    int Invoices,
    decimal PostedTotal,
    DateTime? LastPostedAtUtc,
    // In a raw materials category: filed there before the kinds were kept apart.
    bool Misplaced = false)
{
    public static ExpenseItemDto From(ExpenseItem item, PurchaseCategory? category, ExpenseItemUse? use) => new(
        item.Id, item.Name, item.NameAr, item.CategoryId, category?.Name ?? PurchaseCategory.GeneralExpensesName, category?.NameAr, item.Unit,
        item.IsArchived, use?.Invoices ?? 0, use?.PostedTotal ?? 0, use?.LastPostedAtUtc, category?.Kind == CategoryKind.RawMaterials);
}

public enum ExpenseItemRemoval
{
    Deleted = 1,

    // It is on invoices: kept for them, off the list for new ones.
    Archived = 2,
}

public sealed record ExpenseItemRemovalDto(ExpenseItemRemoval Outcome);

internal static class ExpenseItemReading
{
    public static async Task<ExpenseItemDto> DtoAsync(
        this IPurchaseCategoryRepository categories, IPurchaseInvoiceRepository invoices, ExpenseItem item, CancellationToken cancellationToken) =>
        ExpenseItemDto.From(
            item, await categories.GetByIdAsync(item.CategoryId, cancellationToken),
            (await invoices.GetExpenseItemUseAsync(cancellationToken)).GetValueOrDefault(item.Id));
}

// By name. The archived ones only when asked for: the Expense items screen shows them to restore.
public sealed record GetExpenseItemsQuery(bool IncludeArchived = false) : IRequest<IReadOnlyList<ExpenseItemDto>>;

internal sealed class GetExpenseItemsHandler(IExpenseItemRepository items, IPurchaseCategoryRepository categories, IPurchaseInvoiceRepository invoices)
    : IRequestHandler<GetExpenseItemsQuery, IReadOnlyList<ExpenseItemDto>>
{
    public async Task<IReadOnlyList<ExpenseItemDto>> Handle(GetExpenseItemsQuery request, CancellationToken cancellationToken)
    {
        var byId = (await categories.GetAllAsync(cancellationToken)).ToDictionary(c => c.Id);
        var use = await invoices.GetExpenseItemUseAsync(cancellationToken);
        return (await items.GetAllAsync(cancellationToken))
            .Where(i => request.IncludeArchived || !i.IsArchived)
            .OrderBy(i => i.Name, StringComparer.CurrentCultureIgnoreCase)
            .Select(i => ExpenseItemDto.From(i, byId.GetValueOrDefault(i.CategoryId), use.GetValueOrDefault(i.Id)))
            .ToList();
    }
}

// Adds the expense item, or changes it. No category: General. Two cannot share a name, archived
// or not: the invoices would not say which was which.
public sealed record SaveExpenseItemCommand(Guid ExpenseItemId, string Name, Guid? CategoryId = null, string? NameAr = null, string? Unit = null)
    : IRequest<ExpenseItemDto>;

internal sealed class SaveExpenseItemHandler(
    IExpenseItemRepository items, IPurchaseCategoryRepository categories, IPurchaseInvoiceRepository invoices, IUnitOfWork unitOfWork)
    : IRequestHandler<SaveExpenseItemCommand, ExpenseItemDto>
{
    public async Task<ExpenseItemDto> Handle(SaveExpenseItemCommand request, CancellationToken cancellationToken)
    {
        if (!string.IsNullOrWhiteSpace(request.Name)
            && await items.GetByNormalizedNameAsync(ExpenseItem.Normalize(request.Name), cancellationToken) is { } namesake
            && namesake.Id != request.ExpenseItemId)
        {
            throw new DomainException(namesake.IsArchived
                ? $"{namesake.Name} is already an expense item, archived. Restore it from the archived ones."
                : $"{namesake.Name} is already an expense item.");
        }

        var item = await items.GetByIdAsync(request.ExpenseItemId, cancellationToken);
        var category = await categories.ResolveAsync(request.CategoryId, CategoryKind.Expenses, item?.CategoryId, cancellationToken);
        if (item is null)
            items.Add(item = new ExpenseItem(request.ExpenseItemId, request.Name ?? string.Empty, category.Id, request.NameAr, request.Unit));
        else
            item.Update(request.Name ?? string.Empty, category.Id, request.NameAr, request.Unit);

        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await categories.DtoAsync(invoices, item, cancellationToken);
    }
}

// Deleted if it is on no invoice; archived if it is, so the invoices keep it.
public sealed record DeleteExpenseItemCommand(Guid ExpenseItemId) : IRequest<ExpenseItemRemovalDto>;

internal sealed class DeleteExpenseItemHandler(IExpenseItemRepository items, IPurchaseInvoiceRepository invoices, IUnitOfWork unitOfWork)
    : IRequestHandler<DeleteExpenseItemCommand, ExpenseItemRemovalDto>
{
    public async Task<ExpenseItemRemovalDto> Handle(DeleteExpenseItemCommand request, CancellationToken cancellationToken)
    {
        // Already gone: a retry of a delete that worked.
        if (await items.GetByIdAsync(request.ExpenseItemId, cancellationToken) is not { } item)
            return new ExpenseItemRemovalDto(ExpenseItemRemoval.Deleted);

        var outcome = ExpenseItemRemoval.Deleted;
        if (await invoices.AnyForExpenseItemAsync(item.Id, cancellationToken))
        {
            item.Archive();
            outcome = ExpenseItemRemoval.Archived;
        }
        else
        {
            items.Remove(item);
        }

        await unitOfWork.SaveChangesAsync(cancellationToken);
        return new ExpenseItemRemovalDto(outcome);
    }
}

// Back on the list new invoices pick from.
public sealed record RestoreExpenseItemCommand(Guid ExpenseItemId) : IRequest<ExpenseItemDto>;

internal sealed class RestoreExpenseItemHandler(
    IExpenseItemRepository items, IPurchaseCategoryRepository categories, IPurchaseInvoiceRepository invoices, IUnitOfWork unitOfWork)
    : IRequestHandler<RestoreExpenseItemCommand, ExpenseItemDto>
{
    public async Task<ExpenseItemDto> Handle(RestoreExpenseItemCommand request, CancellationToken cancellationToken)
    {
        var item = await items.GetRequiredAsync(request.ExpenseItemId, cancellationToken);
        item.Restore();
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await categories.DtoAsync(invoices, item, cancellationToken);
    }
}
```


## 3. الوصفات

`Recipes.cs`: `SetRecipeCommand` (وصفة طبق: المكونات بـ EP والـ Yield، الحصص، الفئة، والهدف في المنيو)، الحذف كعلامة (`DeletedAtUtc`) والاستعادة. وصفة فعّالة واحدة لكل هدف (فهرس فريد، الفصل 02).

> 📄 **`backend/src/Costing.Application/Recipes/Recipes.cs`** — 218 سطر

```csharp
using MediatR;
using Costing.Domain.Common;
using Costing.Application.Approvals;
using Costing.Application.Common;
using Costing.Application.RawMaterials;
using Costing.Domain.Approvals;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;

namespace Costing.Application.Recipes;

// Quantity: the Edible Portion for the whole recipe, in the material's own unit. YieldPercent:
// null takes the material's default.
public sealed record RecipeIngredientDto(Guid RawMaterialId, decimal Quantity, decimal? YieldPercent = null);

public sealed record RecipeDto(
    Guid Id,
    string? Name,
    Guid? RecipeCategoryId,
    decimal? PlannedPrice,
    RecipeTargetKind? TargetKind,
    int? CatalogItemId,
    int? VariantId,
    IReadOnlyList<RecipeIngredientDto> Ingredients,
    int Portions,
    bool IsDeleted)
{
    public static RecipeDto From(Recipe recipe) => new(
        recipe.Id,
        recipe.Name,
        recipe.RecipeCategoryId,
        recipe.PlannedPrice,
        recipe.TargetKind,
        recipe.CatalogItemId,
        recipe.VariantId,
        recipe.Ingredients.Select(i => new RecipeIngredientDto(i.RawMaterialId, i.Quantity, i.YieldPercent)).ToList(),
        recipe.Portions,
        recipe.IsDeleted);
}

internal static class RecipeWriting
{
    // The ingredient list, whole: what is not on it goes.
    public static async Task WriteAsync(
        this Recipe recipe, IRawMaterialRepository materials, IReadOnlyList<RecipeIngredientDto> ingredients, int portions, CancellationToken cancellationToken)
    {
        var byId = await materials.GetRequiredByIdsAsync(ingredients.Select(i => i.RawMaterialId).ToList(), cancellationToken);
        // One deleted since cannot come back in: a recipe that had it may keep it.
        if (byId.Values.FirstOrDefault(m => m.IsArchived && !recipe.Ingredients.Any(i => i.RawMaterialId == m.Id)) is { } archived)
            throw new DomainException($"{archived.Name} has been deleted from the raw materials.");
        foreach (var dropped in recipe.Ingredients.Where(i => !byId.ContainsKey(i.RawMaterialId)).ToList())
            recipe.RemoveIngredient(dropped.RawMaterialId);

        recipe.SetPortions(portions);
        foreach (var ingredient in ingredients)
            recipe.SetIngredient(byId[ingredient.RawMaterialId], ingredient.Quantity, ingredient.YieldPercent);
    }

    // One active recipe per menu item: the one it sells by.
    public static async Task EnsureFreeAsync(this IRecipeRepository recipes, RecipeTarget? target, Guid recipeId, CancellationToken cancellationToken)
    {
        if (target is { } t && await recipes.GetByTargetAsync(t, cancellationToken) is { } other && other.Id != recipeId)
            throw new DomainException(
                $"That menu item already sells by {(other.Name is { } name ? $"the recipe \"{name}\"" : "another recipe")}. Unlink or delete that one first.");
    }
}

// Replaces the whole recipe a menu item, one of its variants, or an add-on sells by, adding it if
// it has none. An empty list deletes it, and that target stops being stock-tracked.
//
// The catalog ids are not checked against the menu: Inventory has no access to it. The screen
// picks them from the menu the till already shows. A wrong id makes a recipe that never
// matches a sale, and does no other harm.
//
// A change applies from the next sale on. A Void After returns the quantities as they are at
// the time of the void, even for a dish sold under the old recipe.
public sealed record SetRecipeCommand(
    RecipeTargetKind TargetKind,
    int CatalogItemId,
    int? VariantId,
    IReadOnlyList<RecipeIngredientDto> Ingredients,
    int Portions = 1,
    string StaffName = "",
    // No ingredients deletes the recipe, so only for someone who may approve deletions; anyone
    // else asks, from the recipes list.
    bool CanDelete = true) : IRequest<RecipeDto?>;

internal sealed class SetRecipeHandler(
    IRecipeRepository recipes, IRawMaterialRepository materials, IApprovalRequestRepository approvals, IUnitOfWork unitOfWork)
    : IRequestHandler<SetRecipeCommand, RecipeDto?>
{
    public async Task<RecipeDto?> Handle(SetRecipeCommand request, CancellationToken cancellationToken)
    {
        var target = new RecipeTarget(request.TargetKind, request.CatalogItemId, request.VariantId);
        var recipe = await recipes.GetByTargetAsync(target, cancellationToken);
        if (recipe is not null)
            await approvals.EnsureNotPendingAsync(recipe.Id, cancellationToken);

        if (request.Ingredients.Count == 0)
        {
            if (recipe is not null)
            {
                if (!request.CanDelete)
                    throw new DomainException("Deleting a recipe goes to a manager: delete it from the recipes list to ask.");
                recipe.Delete(request.StaffName);
                await unitOfWork.SaveChangesAsync(cancellationToken);
            }
            return null;
        }

        if (recipe is null)
            recipes.Add(recipe = new Recipe(target));
        await recipe.WriteAsync(materials, request.Ingredients, request.Portions, cancellationToken);

        await unitOfWork.SaveChangesAsync(cancellationToken);
        return RecipeDto.From(recipe);
    }
}

// Null when the target has no active recipe, which means it is not stock-tracked.
public sealed record GetRecipeQuery(RecipeTargetKind TargetKind, int CatalogItemId, int? VariantId) : IRequest<RecipeDto?>;

internal sealed class GetRecipeHandler(IRecipeRepository recipes) : IRequestHandler<GetRecipeQuery, RecipeDto?>
{
    public async Task<RecipeDto?> Handle(GetRecipeQuery request, CancellationToken cancellationToken)
    {
        var recipe = await recipes.GetByTargetAsync(new RecipeTarget(request.TargetKind, request.CatalogItemId, request.VariantId), cancellationToken);
        return recipe is null ? null : RecipeDto.From(recipe);
    }
}

// Adds a recipe (no id) or changes one: its name, its category, what it is linked to on the menu
// if anything, its portions and the whole ingredient list. Linked, the menu item sells by it from
// the next sale. The category is required here: a recipe written on the recipe screen is sorted.
public sealed record SaveRecipeCommand(
    Guid? RecipeId,
    string? Name,
    RecipeTargetKind? TargetKind,
    int? CatalogItemId,
    int? VariantId,
    int Portions,
    IReadOnlyList<RecipeIngredientDto> Ingredients,
    Guid? RecipeCategoryId = null,
    decimal? PlannedPrice = null) : IRequest<RecipeDto>;

internal sealed class SaveRecipeHandler(
    IRecipeRepository recipes,
    IRecipeCategoryRepository categories,
    IRawMaterialRepository materials,
    IApprovalRequestRepository approvals,
    IUnitOfWork unitOfWork)
    : IRequestHandler<SaveRecipeCommand, RecipeDto>
{
    public async Task<RecipeDto> Handle(SaveRecipeCommand request, CancellationToken cancellationToken)
    {
        if (request.Ingredients.Count == 0)
            throw new DomainException("Add at least one ingredient.");
        if ((request.TargetKind is null) != (request.CatalogItemId is null))
            throw new DomainException("Choose the menu item to link it to, or none.");
        if (request.RecipeCategoryId is not { } categoryId)
            throw new DomainException("Choose the recipe's category.");
        if (await categories.GetByIdAsync(categoryId, cancellationToken) is null)
            throw new DomainException("That category is no longer there. Choose another.");
        RecipeTarget? target = request.TargetKind is { } kind && request.CatalogItemId is { } id ? new RecipeTarget(kind, id, request.VariantId) : null;

        Recipe recipe;
        if (request.RecipeId is { } recipeId)
        {
            recipe = await recipes.GetRequiredAsync(recipeId, cancellationToken);
            if (recipe.IsDeleted)
                throw new DomainException("This recipe is deleted. Restore it to change it.");
            await approvals.EnsureNotPendingAsync(recipe.Id, cancellationToken);
            await recipes.EnsureFreeAsync(target, recipe.Id, cancellationToken);
            recipe.Define(request.Name, categoryId, request.PlannedPrice, target);
        }
        else
        {
            recipe = new Recipe(request.Name, categoryId, request.PlannedPrice, target);
            await recipes.EnsureFreeAsync(target, recipe.Id, cancellationToken);
            recipes.Add(recipe);
        }

        await recipe.WriteAsync(materials, request.Ingredients, request.Portions, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return RecipeDto.From(recipe);
    }
}

// Marks it deleted: off the screens, and a menu item it was linked to stops taking stock by it.
// Deleting it again changes nothing.
public sealed record DeleteRecipeCommand(Guid RecipeId, string StaffName = "") : IRequest;

internal sealed class DeleteRecipeHandler(IRecipeRepository recipes, IUnitOfWork unitOfWork) : IRequestHandler<DeleteRecipeCommand>
{
    public async Task Handle(DeleteRecipeCommand request, CancellationToken cancellationToken)
    {
        var recipe = await recipes.GetRequiredAsync(request.RecipeId, cancellationToken);
        recipe.Delete(request.StaffName);
        await unitOfWork.SaveChangesAsync(cancellationToken);
    }
}

// Back as it was, linked again if its menu item has no other recipe since. If it has, the recipe
// comes back off the menu, under its own name or the one given (the menu item's, from the screen).
public sealed record RestoreRecipeCommand(Guid RecipeId, string? Name = null) : IRequest<RecipeDto>;

internal sealed class RestoreRecipeHandler(IRecipeRepository recipes, IUnitOfWork unitOfWork) : IRequestHandler<RestoreRecipeCommand, RecipeDto>
{
    public async Task<RecipeDto> Handle(RestoreRecipeCommand request, CancellationToken cancellationToken)
    {
        var recipe = await recipes.GetRequiredAsync(request.RecipeId, cancellationToken);
        if (recipe.Target is { } target && await recipes.GetByTargetAsync(target, cancellationToken) is { } other && other.Id != recipe.Id)
            recipe.Unlink(recipe.Name ?? request.Name);
        recipe.Restore();
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return RecipeDto.From(recipe);
    }
}
```


> 📄 **`backend/src/Costing.Application/Recipes/RecipeCategories.cs`** — 120 سطر

```csharp
using MediatR;
using Costing.Domain.Common;
using Costing.Application.Common;
using Costing.Domain.Production;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;

namespace Costing.Application.Recipes;

// The kitchen's recipe categories, its own and not the menu's: the dishes' recipes and the prep
// items' are sorted under them alike. CategoryId is made by the till.

// Recipes: how many active dish recipes are in it; PrepItems, how many prep items still in use.
public sealed record RecipeCategoryDto(Guid Id, string Name, string? NameAr, int Recipes, int PrepItems = 0)
{
    public static RecipeCategoryDto From(RecipeCategory category, int recipes, int prepItems) =>
        new(category.Id, category.Name, category.NameAr, recipes, prepItems);
}

internal static class PrepItemsInCategories
{
    // How many prep items still in use are in each recipe category.
    public static async Task<IReadOnlyDictionary<Guid, int>> CountAsync(
        IPrepRecipeRepository prepRecipes, IRawMaterialRepository materials, CancellationToken cancellationToken)
    {
        var deleted = (await materials.GetAllAsync(cancellationToken)).Where(m => m.IsArchived).Select(m => m.Id).ToHashSet();
        return (await prepRecipes.GetAllAsync(cancellationToken))
            .Where(r => r.RecipeCategoryId is not null && !deleted.Contains(r.PrepItemId))
            .GroupBy(r => r.RecipeCategoryId!.Value)
            .ToDictionary(g => g.Key, g => g.Count());
    }
}

// By name.
public sealed record GetRecipeCategoriesQuery : IRequest<IReadOnlyList<RecipeCategoryDto>>;

internal sealed class GetRecipeCategoriesHandler(
    IRecipeCategoryRepository categories, IRecipeRepository recipes, IPrepRecipeRepository prepRecipes, IRawMaterialRepository materials)
    : IRequestHandler<GetRecipeCategoriesQuery, IReadOnlyList<RecipeCategoryDto>>
{
    public async Task<IReadOnlyList<RecipeCategoryDto>> Handle(GetRecipeCategoriesQuery request, CancellationToken cancellationToken)
    {
        var counts = await recipes.CountByCategoryAsync(cancellationToken);
        var prepCounts = await PrepItemsInCategories.CountAsync(prepRecipes, materials, cancellationToken);
        return (await categories.GetAllAsync(cancellationToken))
            .OrderBy(c => c.Name, StringComparer.CurrentCultureIgnoreCase)
            .Select(c => RecipeCategoryDto.From(c, counts.GetValueOrDefault(c.Id), prepCounts.GetValueOrDefault(c.Id)))
            .ToList();
    }
}

// Adds the category, or renames it. Two cannot share a name: the recipes table could not tell them apart.
public sealed record SaveRecipeCategoryCommand(Guid CategoryId, string Name, string? NameAr = null) : IRequest<RecipeCategoryDto>;

internal sealed class SaveRecipeCategoryHandler(
    IRecipeCategoryRepository categories, IRecipeRepository recipes, IPrepRecipeRepository prepRecipes, IRawMaterialRepository materials,
    IUnitOfWork unitOfWork)
    : IRequestHandler<SaveRecipeCategoryCommand, RecipeCategoryDto>
{
    public async Task<RecipeCategoryDto> Handle(SaveRecipeCategoryCommand request, CancellationToken cancellationToken)
    {
        if (!string.IsNullOrWhiteSpace(request.Name)
            && await categories.GetByNormalizedNameAsync(RecipeCategory.Normalize(request.Name), cancellationToken) is { } namesake
            && namesake.Id != request.CategoryId)
            throw new DomainException($"There is already a category called {namesake.Name}.");

        var category = await categories.GetByIdAsync(request.CategoryId, cancellationToken);
        if (category is null)
            categories.Add(category = new RecipeCategory(request.CategoryId, request.Name, request.NameAr));
        else
            category.Rename(request.Name, request.NameAr);

        await unitOfWork.SaveChangesAsync(cancellationToken);
        return RecipeCategoryDto.From(
            category,
            (await recipes.CountByCategoryAsync(cancellationToken)).GetValueOrDefault(category.Id),
            (await PrepItemsInCategories.CountAsync(prepRecipes, materials, cancellationToken)).GetValueOrDefault(category.Id));
    }
}

// Deletes the category. Its recipes and prep items move first to MoveToId: one with active recipes
// or prep items in use is not deleted without somewhere for them to go. Deleted ones in it move
// with them, or are left uncategorized.
public sealed record DeleteRecipeCategoryCommand(Guid CategoryId, Guid? MoveToId = null) : IRequest;

internal sealed class DeleteRecipeCategoryHandler(
    IRecipeCategoryRepository categories, IRecipeRepository recipes, IPrepRecipeRepository prepRecipes, IRawMaterialRepository materials,
    IUnitOfWork unitOfWork)
    : IRequestHandler<DeleteRecipeCategoryCommand>
{
    public async Task Handle(DeleteRecipeCategoryCommand request, CancellationToken cancellationToken)
    {
        // Already gone: a retry of a delete that worked.
        if (await categories.GetByIdAsync(request.CategoryId, cancellationToken) is not { } category)
            return;

        var inIt = await recipes.GetInCategoryAsync(category.Id, cancellationToken);
        var prepInIt = await prepRecipes.GetInCategoryAsync(category.Id, cancellationToken);
        var deleted = (await materials.GetAllAsync(cancellationToken)).Where(m => m.IsArchived).Select(m => m.Id).ToHashSet();
        var active = inIt.Count(r => !r.IsDeleted) + prepInIt.Count(r => !deleted.Contains(r.PrepItemId));
        if (request.MoveToId is { } moveToId)
        {
            if (moveToId == category.Id)
                throw new DomainException("Choose another category for its recipes.");
            _ = await categories.GetRequiredAsync(moveToId, cancellationToken);
        }
        else if (active > 0)
        {
            throw new DomainException(
                $"{category.Name} has {active} {(active == 1 ? "recipe" : "recipes")}. Choose the category {(active == 1 ? "it moves" : "they move")} to.");
        }

        foreach (var recipe in inIt)
            recipe.MoveTo(request.MoveToId);
        foreach (var prepRecipe in prepInIt)
            prepRecipe.MoveTo(request.MoveToId);
        categories.Remove(category);
        await unitOfWork.SaveChangesAsync(cancellationToken);
    }
}
```


### 3.1 "أضف للمنيو" (`RecipesToMenu`)

وصفات مكتوبة بلا صنف منيو: كل وصفة تصبح صنف منيو جديد باسمها (رقم تالٍ، والفئة تُنشأ إن لم توجد) وتُربط به، فيخصم بيعه مخزونه بالوصفة. وصنف منيو موجود بنفس الاسم بلا وصفة يُربط كما هو. والتخطي بأسباب بالعربية والإنجليزية (محذوفة، مربوطة أصلًا، بانتظار موافقة، الاسم يبيع بوصفة أخرى، بلا فئة أو سعر).

> 📄 **`backend/src/Costing.Application/Recipes/RecipesToMenu.cs`** — 139 سطر

```csharp
using MediatR;
using Costing.Domain.Common;
using Costing.Application.Common;
using Costing.Domain.Approvals;
using Costing.Domain.Menu;
using Costing.Domain.Recipes;

namespace Costing.Application.Recipes;

// Recipes off the menu put on it (إضافة للمنيو): each a menu item of its name, at the price and in
// the menu category given, and the recipe linked to it, so that selling it on Sales, entered or
// imported, takes its stock by the recipe and counts in the reports. The item is numbered as the
// next one, as a new item is; a category not on the menu yet is added.
//
// A menu item of the recipe's name already there (not deleted) with no recipe of its own is the
// one it is linked to, as it is: never a second of that name. One with a recipe already is left
// alone. Each recipe is checked on its own: one that cannot go on is said why, in English and
// Arabic, and the rest go on.

public sealed record RecipeToMenu(Guid RecipeId, string? Category, decimal? Price, string? NameAr = null);

public sealed record AddRecipesToMenuCommand(IReadOnlyList<RecipeToMenu> Recipes) : IRequest<RecipesToMenuResult>, IRetryOnConflict;

// On the menu: the item it sells as (Created: a new one; else one there already), by its code.
public sealed record RecipeOnMenu(Guid RecipeId, string Recipe, int MenuItemId, string Category, decimal Price, bool Created);

public sealed record RecipeNotOnMenu(Guid RecipeId, string? Recipe, string Reason, string ReasonAr);

public sealed record RecipesToMenuResult(IReadOnlyList<RecipeOnMenu> Linked, IReadOnlyList<RecipeNotOnMenu> Skipped, IReadOnlyList<string> CategoriesAdded);

internal sealed class AddRecipesToMenuHandler(IRecipeRepository recipes, IMenuRepository menu, IApprovalRequestRepository approvals, IUnitOfWork unitOfWork)
    : IRequestHandler<AddRecipesToMenuCommand, RecipesToMenuResult>
{
    public const int MaxRecipes = 1000;

    public async Task<RecipesToMenuResult> Handle(AddRecipesToMenuCommand request, CancellationToken cancellationToken)
    {
        if (request.Recipes.Count == 0)
            throw new DomainException("Choose the recipes to put on the menu. · اختر الوصفات لإضافتها للمنيو.");
        if (request.Recipes.Count > MaxRecipes)
            throw new DomainException($"Put at most {MaxRecipes:N0} recipes on the menu at a time. · {MaxRecipes:N0} وصفة على الأكثر في المرة.");

        var all = (await recipes.GetAllAsync(cancellationToken)).ToDictionary(r => r.Id);
        var sold = all.Values.Where(r => !r.IsDeleted && r.Target is not null).Select(r => r.Target!.Value).ToHashSet();
        var pending = (await approvals.GetPendingAsync(cancellationToken)).Select(r => r.RecordId).ToHashSet();
        var categories = (await menu.GetCategoriesAsync(cancellationToken)).ToDictionary(c => MenuKey(c.Name));
        var items = await menu.GetItemsAsync(cancellationToken);
        var byName = items.Where(i => !i.IsDeleted).GroupBy(i => MenuKey(i.Name)).ToDictionary(g => g.Key, g => g.First());
        var next = await menu.NextItemNumberAsync(cancellationToken);
        var nextOrder = categories.Count == 0 ? 1 : categories.Values.Max(c => c.DisplayOrder) + 1;

        var linked = new List<RecipeOnMenu>();
        var skipped = new List<RecipeNotOnMenu>();
        var added = new List<string>();
        foreach (var asked in request.Recipes.DistinctBy(r => r.RecipeId))
        {
            var recipe = all.GetValueOrDefault(asked.RecipeId);
            void Skip(string reason, string reasonAr) => skipped.Add(new RecipeNotOnMenu(asked.RecipeId, recipe?.Name, reason, reasonAr));

            if (recipe is null || recipe.IsDeleted)
            {
                Skip("The recipe is no longer there, or was deleted.", "الوصفة لم تعد موجودة أو محذوفة.");
                continue;
            }
            if (recipe.Target is { } target)
            {
                Skip($"{recipe.Name ?? "It"} is on the menu already, as {Code(target)}.", $"{recipe.Name ?? "الوصفة"} في المنيو بالفعل بكود {Code(target)}.");
                continue;
            }
            if (pending.Contains(recipe.Id))
            {
                Skip($"{recipe.Name} waits for a manager's approval: put it on the menu once that is decided.", $"{recipe.Name} بانتظار موافقة المدير.");
                continue;
            }

            var name = recipe.Name!;
            try
            {
                // A menu item of its name with no recipe: that one, as it is.
                if (byName.GetValueOrDefault(MenuKey(name)) is { } existing)
                {
                    var itsTarget = RecipeTarget.ForMenuItem(existing.Id);
                    if (sold.Contains(itsTarget))
                    {
                        Skip($"{existing.Name} is on the menu already, as {existing.Id}, and sells by another recipe: link one of them from its recipe card.",
                            $"{existing.Name} في المنيو بكود {existing.Id} وله وصفة أخرى: اربط إحداهما من بطاقة الوصفة.");
                        continue;
                    }
                    recipe.Define(recipe.Name, recipe.RecipeCategoryId, recipe.PlannedPrice, itsTarget);
                    sold.Add(itsTarget);
                    linked.Add(new RecipeOnMenu(recipe.Id, name, existing.Id, existing.Category, existing.Price, false));
                    continue;
                }

                var categoryName = SheetText.Clean(asked.Category);
                if (categoryName is null)
                {
                    Skip("Choose its menu category.", "اختر قسمها في المنيو.");
                    continue;
                }
                if (asked.Price is not { } price || price <= 0)
                {
                    Skip("Give it its selling price, more than nothing.", "اكتب سعر البيع، أكبر من صفر.");
                    continue;
                }

                if (!categories.TryGetValue(MenuKey(categoryName), out var category))
                {
                    category = new MenuCategory(categoryName, null, nextOrder++);
                    menu.AddCategory(category);
                    categories[MenuKey(category.Name)] = category;
                    added.Add(category.Name);
                }

                var item = new MenuItem(next, name, SheetText.Clean(asked.NameAr), category.Name, price, false);
                menu.AddItem(item);
                next++;
                byName[MenuKey(item.Name)] = item;
                var newTarget = RecipeTarget.ForMenuItem(item.Id);
                recipe.Define(recipe.Name, recipe.RecipeCategoryId, recipe.PlannedPrice, newTarget);
                sold.Add(newTarget);
                linked.Add(new RecipeOnMenu(recipe.Id, name, item.Id, category.Name, price, true));
            }
            catch (DomainException error)
            {
                Skip(error.Message, "لم تُضف: راجع السبب بالإنجليزية.");
            }
        }

        if (linked.Count > 0)
            await unitOfWork.SaveChangesAsync(cancellationToken);
        return new RecipesToMenuResult(linked, skipped, added);
    }

    private static string MenuKey(string name) => SheetText.Key(name);

    private static string Code(RecipeTarget target) =>
        target.Kind == RecipeTargetKind.AddOn ? $"A{target.CatalogItemId}" : target.VariantId is { } v ? $"{target.CatalogItemId}-{v}" : $"{target.CatalogItemId}";
}
```


## 4. المصنعات وأوامر الإنتاج

### 4.1 `PrepItems.cs`

المصنّع **خامة من نوع `Prep`** لها وصفة دفعة. القائمة تعرض: تكلفته بوصفته بأسعار اليوم (`RecipeCosts`)، وتكلفة الدفعات الموجودة على الرف (المتوسط)، والرصيد. التعديل للمدير، وغيره يطلب (`RequestPrepItemChangeCommand`).

> 📄 **`backend/src/Costing.Application/Production/PrepItems.cs`** — 478 سطر

```csharp
using System.Globalization;
using MediatR;
using Costing.Domain.Common;
using Costing.Application.Approvals;
using Costing.Application.Categories;
using Costing.Application.Common;
using Costing.Domain.Approvals;
using Costing.Domain.Categories;
using Costing.Domain.Production;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;

namespace Costing.Application.Production;

// Prep items: made in the kitchen (dough, house sauces), kept in stock, used by dishes. Each is a
// raw material of the Prep kind, with a recipe for one batch. Quantities are in each material's
// own unit (grams, millilitres, pieces); costs per its display unit (kg, L), as prices are written.
//
// Adding or changing one is a manager's: anyone else's is a request (ApprovalRequests.cs). A new
// one does not exist, for recipes or production, until it is approved; a changed one stays as it
// was until then, and cannot be changed again meanwhile.

// One ingredient of a batch, costed at its average now, or a prep item never made yet by its own
// recipe (CostedByRecipe). BatchCost is what it adds to one batch; Share is that against the batch.
public sealed record PrepIngredientCostDto(
    Guid RawMaterialId,
    string? Code,
    string Name,
    bool IsPrepItem,
    UnitOfMeasure Unit,
    string PurchaseUnit,
    decimal PurchaseUnitSize,
    decimal Quantity,
    decimal YieldPercent,
    decimal AsPurchasedQuantity,
    decimal? CostPerPurchaseUnit,
    decimal? BatchCost,
    decimal? SharePercent,
    bool CostedByRecipe = false);

// A prep item's profile. The standard cost is what a batch costs by its recipe at today's
// averages (a prep item in it never made yet by its own recipe, RecipeCosts); the average cost is
// what the batches on the shelf actually cost, moved by each production order as a delivery moves
// a bought material's. MissingPrices names what has no price under it.
public sealed record PrepItemDto(
    Guid Id,
    string? Code,
    string Name,
    // Its purchase category's name, as a material's: the count sheet groups it there.
    string Category,
    UnitOfMeasure Unit,
    string DisplayUnit,
    decimal DisplayUnitSize,
    decimal ReorderLevel,
    decimal BatchQuantity,
    IReadOnlyList<PrepIngredientCostDto> Ingredients,
    decimal? StandardBatchCost,
    decimal? StandardCostPerDisplayUnit,
    IReadOnlyList<string> MissingPrices,
    decimal QuantityOnHand,
    decimal? AverageCostPerDisplayUnit,
    decimal? StockValue,
    DateTime? LastProducedAtUtc,
    decimal? LastBatchCostPerDisplayUnit,
    IReadOnlyList<ProductionOrderDto> Recent,
    Guid CategoryId,
    // The kitchen's recipe category it is sorted under; none when not given one.
    Guid? RecipeCategoryId = null);

public sealed record PrepIngredientEntry(Guid RawMaterialId, decimal Quantity, decimal? YieldPercent = null);

internal static class PrepItemCosting
{
    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

    public static decimal Money(decimal value) => Math.Round(value, 2, MidpointRounding.AwayFromZero);

    // In its display unit, as the screens write it: 9.6 kg.
    public static string Amount(decimal quantity, RawMaterial item) => Amount(quantity, item.PurchaseUnitSize, item.PurchaseUnit);

    public static string Amount(decimal quantity, decimal size, string unit) => $"{(quantity / size).ToString("0.###", Invariant)} {unit}";

    // In grams or kilos, millilitres or litres, or pieces, whichever reads plainly: 250 g, 6 kg.
    public static string Readable(decimal quantity, UnitOfMeasure unit) => unit switch
    {
        UnitOfMeasure.Gram => quantity >= 1000 ? Amount(quantity, 1000, "kg") : Amount(quantity, 1, "g"),
        UnitOfMeasure.Millilitre => quantity >= 1000 ? Amount(quantity, 1000, "L") : Amount(quantity, 1, "ml"),
        _ => Amount(quantity, 1, "pc"),
    };

    public static PrepItemDto Dto(
        RawMaterial item,
        PrepRecipe? recipe,
        IReadOnlyDictionary<Guid, RawMaterial> materials,
        IReadOnlyList<ProductionOrder> orders,
        IReadOnlyDictionary<Guid, PurchaseCategory> categories,
        RecipeCosts costs)
    {
        var lines = (recipe?.Ingredients ?? [])
            .Select(i => (Ingredient: i, Material: materials.GetValueOrDefault(i.RawMaterialId)))
            .Where(x => x.Material is not null)
            .Select(x => (x.Ingredient, Material: x.Material!, Price: costs.Of(x.Material!.Id)))
            .Select(x => (x.Ingredient, x.Material, x.Price, Cost: x.Ingredient.AsPurchasedQuantity * x.Price.PerUnit))
            .ToList();
        var batchCost = lines.Sum(l => l.Cost ?? 0);
        var missing = lines.SelectMany(l => l.Price.Missing).Distinct().ToList();
        var batch = recipe?.BatchQuantity ?? 0;
        var last = orders.Where(o => o.PrepItemId == item.Id && !o.IsVoided).MaxBy(o => o.ProducedAtUtc);

        return new PrepItemDto(
            item.Id, item.Code, item.Name, categories.GetValueOrDefault(item.CategoryId)?.Name ?? PurchaseCategory.GeneralName, item.Unit, item.PurchaseUnit, item.PurchaseUnitSize, item.ReorderLevel, batch,
            lines
                .Select(l => new PrepIngredientCostDto(
                    l.Material.Id, l.Material.Code, l.Material.Name, l.Material.IsPrepItem, l.Material.Unit, l.Material.PurchaseUnit,
                    l.Material.PurchaseUnitSize, l.Ingredient.Quantity, l.Ingredient.YieldPercent, Math.Round(l.Ingredient.AsPurchasedQuantity, 3),
                    l.Price.PerUnit is { } c ? Money(c * l.Material.PurchaseUnitSize) : null,
                    l.Cost is { } cost ? Money(cost) : null,
                    l.Cost is { } part && batchCost > 0 ? Math.Round(part * 100 / batchCost, 1) : null,
                    l.Price.ByRecipe))
                .OrderByDescending(l => l.BatchCost ?? 0)
                .ThenBy(l => l.Name)
                .ToList(),
            lines.Any(l => l.Cost is not null) ? Money(batchCost) : null,
            lines.Any(l => l.Cost is not null) && batch > 0 ? Money(batchCost / batch * item.PurchaseUnitSize) : null,
            missing,
            item.QuantityOnHand,
            item.CostPerPurchaseUnit is { } average ? Money(average) : null,
            item.AverageCost is { } unit ? Money(unit * Math.Max(item.QuantityOnHand, 0)) : null,
            last?.ProducedAtUtc,
            last is null ? null : Money(last.UnitCost * item.PurchaseUnitSize),
            orders.Where(o => o.PrepItemId == item.Id).Select(o => ProductionOrderDto.From(o, materials)).ToList(),
            item.CategoryId,
            recipe?.RecipeCategoryId);
    }

    // Would `prepItemId` end up made from itself, through the ingredients given and the other
    // prep items' recipes? Dough from a sauce from the dough.
    public static string? Loop(Guid prepItemId, IEnumerable<Guid> ingredientIds, IReadOnlyCollection<PrepRecipe> recipes, IReadOnlyDictionary<Guid, RawMaterial> materials)
    {
        var uses = recipes.ToDictionary(r => r.PrepItemId, r => r.Ingredients.Select(i => i.RawMaterialId).ToList());
        uses[prepItemId] = ingredientIds.ToList();
        foreach (var start in uses[prepItemId])
        {
            var seen = new HashSet<Guid>();
            var stack = new Stack<Guid>([start]);
            while (stack.TryPop(out var id))
            {
                if (id == prepItemId)
                    return materials.GetValueOrDefault(start)?.Name;
                if (seen.Add(id) && uses.TryGetValue(id, out var next))
                    next.ForEach(stack.Push);
            }
        }

        return null;
    }
}

// Every prep item, by name.
public sealed record GetPrepItemsQuery : IRequest<IReadOnlyList<PrepItemDto>>;

internal sealed class GetPrepItemsQueryHandler(
    IRawMaterialRepository materials, IPrepRecipeRepository recipes, IProductionOrderRepository orders, IPurchaseCategoryRepository categories)
    : IRequestHandler<GetPrepItemsQuery, IReadOnlyList<PrepItemDto>>
{
    public async Task<IReadOnlyList<PrepItemDto>> Handle(GetPrepItemsQuery request, CancellationToken cancellationToken)
    {
        var all = (await materials.GetAllAsync(cancellationToken)).ToDictionary(m => m.Id);
        var byCategory = (await categories.GetAllAsync(cancellationToken)).ToDictionary(c => c.Id);
        var byItem = (await recipes.GetAllAsync(cancellationToken)).ToDictionary(r => r.PrepItemId);
        var costs = new RecipeCosts(all, byItem.Values);
        // The last batch of each, for its last cost; the full history is on its own page.
        var lastOrders = (await orders.GetRecentAsync(null, 500, cancellationToken))
            .Where(o => !o.IsVoided)
            .GroupBy(o => o.PrepItemId)
            .Select(g => g.MaxBy(o => o.ProducedAtUtc)!)
            .ToList();
        return all.Values
            .Where(m => m.IsPrepItem && !m.IsArchived)
            .OrderBy(m => m.Name, StringComparer.CurrentCultureIgnoreCase)
            .Select(m => PrepItemCosting.Dto(m, byItem.GetValueOrDefault(m.Id), all, lastOrders, byCategory, costs) with { Recent = [] })
            .ToList();
    }
}

// One prep item's profile, with its last batches.
public sealed record GetPrepItemQuery(Guid PrepItemId) : IRequest<PrepItemDto?>;

internal sealed class GetPrepItemQueryHandler(
    IRawMaterialRepository materials, IPrepRecipeRepository recipes, IProductionOrderRepository orders, IPurchaseCategoryRepository categories)
    : IRequestHandler<GetPrepItemQuery, PrepItemDto?>
{
    public async Task<PrepItemDto?> Handle(GetPrepItemQuery request, CancellationToken cancellationToken)
    {
        var all = (await materials.GetAllAsync(cancellationToken)).ToDictionary(m => m.Id);
        if (all.GetValueOrDefault(request.PrepItemId) is not { IsPrepItem: true } item)
            return null;
        return PrepItemCosting.Dto(
            item,
            await recipes.GetByIdAsync(item.Id, cancellationToken),
            all,
            await orders.GetRecentAsync(item.Id, 20, cancellationToken),
            (await categories.GetAllAsync(cancellationToken)).ToDictionary(c => c.Id),
            new RecipeCosts(all, await recipes.GetAllAsync(cancellationToken)));
    }
}

// A prep item as entered: what it is, how a batch is written, and the whole list of ingredients.
// What a request holds until a manager approves it.
public sealed record PrepItemChange(
    string Name,
    UnitOfMeasure Unit,
    decimal BatchQuantity,
    IReadOnlyList<PrepIngredientEntry> Ingredients,
    string? Code = null,
    Guid? CategoryId = null,
    string? DisplayUnit = null,
    decimal? DisplayUnitSize = null,
    decimal ReorderLevel = 0,
    Guid? RecipeCategoryId = null);

// Saves prep items, for a manager's own save and for an approval alike; checks and describes one
// asked for without changing anything.
internal sealed class PrepItemWriter(
    IRawMaterialRepository materials, IPrepRecipeRepository recipes, IPurchaseCategoryRepository categories, IRecipeCategoryRepository recipeCategories)
{
    // Adds it (under newId when given: a request's record) or changes existingId. Tracked, for
    // the caller to save. Its unit cannot change once it exists: its stock and batches are in it.
    public async Task<(RawMaterial Item, PrepRecipe Recipe, PurchaseCategory Category)> SaveAsync(
        PrepItemChange change, Guid? existingId, Guid? newId, CancellationToken cancellationToken)
    {
        var all = (await materials.GetAllAsync(cancellationToken)).ToDictionary(m => m.Id);
        RawMaterial item;
        PrepRecipe? recipe = null;
        if (existingId is { } id)
        {
            // GetAll reads without tracking: the one to change is loaded to be changed.
            item = await materials.GetRequiredAsync(id, cancellationToken);
            Existing(item, change);
            item.Rename(change.Name);
            recipe = await recipes.GetByIdAsync(item.Id, cancellationToken);
        }
        else
        {
            materials.Add(item = new RawMaterial(change.Name, change.Unit, kind: MaterialKind.Prep, id: newId));
        }

        item.SetReorderLevel(change.ReorderLevel);
        var category = await categories.ResolveAsync(change.CategoryId, CategoryKind.RawMaterials, existingId is null ? null : item.CategoryId, cancellationToken);
        item.Describe(change.Code, category.Id);
        if (change.DisplayUnit is { } unit && change.DisplayUnitSize is { } size)
            item.SetPurchaseUnit(unit, size);

        var ingredients = Ingredients(change, all, recipe);
        if (PrepItemCosting.Loop(item.Id, ingredients.Select(i => i.Material.Id), await recipes.GetAllAsync(cancellationToken), all) is { } through)
            throw new DomainException($"{through} is made with {item.Name}, so {item.Name} cannot be made with {through}.");

        await RecipeCategoryNameAsync(change.RecipeCategoryId, cancellationToken);
        if (recipe is null)
            recipes.Add(recipe = new PrepRecipe(item, change.BatchQuantity));
        else
            recipe.SetBatch(change.BatchQuantity);
        recipe.Replace(ingredients);
        recipe.MoveTo(change.RecipeCategoryId);
        all[item.Id] = item;
        return (item, recipe, category);
    }

    // Everything SaveAsync would refuse, refused now, on copies that are never saved: what a
    // request is checked against before it goes to a manager.
    public async Task CheckAsync(PrepItemChange change, Guid? existingId, CancellationToken cancellationToken)
    {
        var all = (await materials.GetAllAsync(cancellationToken)).ToDictionary(m => m.Id);
        var existing = existingId is { } id ? all.GetValueOrDefault(id) ?? throw new NotFoundException("Prep item", id) : null;
        if (existing is not null)
            Existing(existing, change);
        var copy = new RawMaterial(change.Name, change.Unit, kind: MaterialKind.Prep, id: existing?.Id);
        copy.SetReorderLevel(change.ReorderLevel);
        if (change.DisplayUnit is { } unit && change.DisplayUnitSize is { } size)
            copy.SetPurchaseUnit(unit, size);
        await CheckCategoryAsync(change.CategoryId, existing?.CategoryId, cancellationToken);
        await RecipeCategoryNameAsync(change.RecipeCategoryId, cancellationToken);

        var ingredients = Ingredients(change, all, existing is null ? null : await recipes.GetByIdAsync(existing.Id, cancellationToken));
        if (PrepItemCosting.Loop(copy.Id, ingredients.Select(i => i.Material.Id), await recipes.GetAllAsync(cancellationToken), all) is { } through)
            throw new DomainException($"{through} is made with {copy.Name}, so {copy.Name} cannot be made with {through}.");
        new PrepRecipe(copy, change.BatchQuantity).Replace(ingredients);
    }

    // What a request would add, or change against the prep item as it is, line by line.
    public async Task<(string Summary, IReadOnlyList<ApprovalChange> Changes)> DescribeAsync(
        PrepItemChange change, Guid? existingId, CancellationToken cancellationToken)
    {
        var all = (await materials.GetAllAsync(cancellationToken)).ToDictionary(m => m.Id);
        var existing = existingId is { } id ? all[id] : null;
        var recipe = existing is null ? null : await recipes.GetByIdAsync(existing.Id, cancellationToken);
        var (unit, size) = change.DisplayUnit is { } u && change.DisplayUnitSize is { } s
            ? (u, s)
            : existing is not null ? (existing.PurchaseUnit, existing.PurchaseUnitSize) : DefaultDisplay(change.Unit);
        string Of(Guid ingredient) => all.GetValueOrDefault(ingredient)?.Name ?? "A removed material";
        string Line(Guid ingredient, decimal quantity, decimal? yieldPercent)
        {
            var m = all.GetValueOrDefault(ingredient);
            var amount = m is null ? quantity.ToString("0.###", CultureInfo.InvariantCulture) : PrepItemCosting.Readable(quantity, m.Unit);
            var yields = yieldPercent ?? m?.DefaultYieldPercent ?? 100;
            return yields == 100 ? amount : $"{amount} at {yields.ToString("0.#", CultureInfo.InvariantCulture)}% yield";
        }

        var changes = new List<ApprovalChange>();
        void Add(string label, string? before, string? after)
        {
            if (before != after)
                changes.Add(new ApprovalChange(label, before, after));
        }

        Add("Name", existing?.Name, change.Name.Trim());
        Add("Code", existing?.Code, string.IsNullOrWhiteSpace(change.Code) ? null : change.Code.Trim());
        Add("Category", existing is null ? null : await CategoryNameAsync(existing.CategoryId, cancellationToken),
            await CategoryNameAsync(change.CategoryId, cancellationToken));
        Add("Recipe category", recipe is null ? null : await RecipeCategoryNameAsync(recipe.RecipeCategoryId, cancellationToken),
            await RecipeCategoryNameAsync(change.RecipeCategoryId, cancellationToken));
        Add("Kept in", existing is null ? null : $"{existing.PurchaseUnit} ({existing.PurchaseUnitSize.ToString("0.###", CultureInfo.InvariantCulture)} {Base(existing.Unit)})",
            $"{unit} ({size.ToString("0.###", CultureInfo.InvariantCulture)} {Base(change.Unit)})");
        Add("One batch makes", recipe is null || existing is null ? null : PrepItemCosting.Amount(recipe.BatchQuantity, existing),
            PrepItemCosting.Amount(change.BatchQuantity, size, unit));
        Add("Reorder below", existing is null ? null : PrepItemCosting.Amount(existing.ReorderLevel, existing),
            existing is null && change.ReorderLevel == 0 ? null : PrepItemCosting.Amount(change.ReorderLevel, size, unit));

        var before = recipe?.Ingredients.ToDictionary(i => i.RawMaterialId, i => Line(i.RawMaterialId, i.Quantity, i.YieldPercent)) ?? [];
        var after = change.Ingredients.ToDictionary(i => i.RawMaterialId, i => Line(i.RawMaterialId, i.Quantity, i.YieldPercent));
        foreach (var ingredient in before.Keys.Union(after.Keys).OrderBy(Of))
            Add(Of(ingredient), before.GetValueOrDefault(ingredient), after.GetValueOrDefault(ingredient));

        var count = change.Ingredients.Count;
        var summary = existing is null
            ? $"New prep item {(string.IsNullOrWhiteSpace(change.Code) ? "" : $"{change.Code.Trim()} · ")}{change.Name.Trim()} · " +
              $"{PrepItemCosting.Amount(change.BatchQuantity, size, unit)} batch · {count} {(count == 1 ? "ingredient" : "ingredients")}"
            : $"Prep item {(existing.Code is { } code ? $"{code} · " : "")}{existing.Name}";
        return (summary, changes);
    }

    private static void Existing(RawMaterial item, PrepItemChange change)
    {
        if (!item.IsPrepItem)
            throw new DomainException($"{item.Name} is a bought material, not a prep item.");
        if (item.IsArchived)
            throw new DomainException($"{item.Name} has been deleted.");
        if (item.Unit != change.Unit)
            throw new DomainException($"{item.Name} is kept in {item.Unit.ToString().ToLowerInvariant()}s: its stock and batches are in them. Add a new prep item for another unit.");
    }

    // Each ingredient, known and not deleted: one already on the recipe may stay as it is.
    private static List<(RawMaterial Material, decimal Quantity, decimal? YieldPercent)> Ingredients(
        PrepItemChange change, IReadOnlyDictionary<Guid, RawMaterial> all, PrepRecipe? recipe) =>
        change.Ingredients
            .Select(i =>
            {
                var material = all.GetValueOrDefault(i.RawMaterialId) ?? throw new NotFoundException(nameof(RawMaterial), i.RawMaterialId);
                if (material.IsArchived && recipe?.Ingredients.Any(x => x.RawMaterialId == material.Id) != true)
                    throw new DomainException($"{material.Name} has been deleted: it cannot go on a recipe.");
                return (material, i.Quantity, i.YieldPercent);
            })
            .ToList();

    // A recipe category's name; null for none. One no longer there is refused.
    private async Task<string?> RecipeCategoryNameAsync(Guid? recipeCategoryId, CancellationToken cancellationToken) =>
        recipeCategoryId is { } id
            ? (await recipeCategories.GetByIdAsync(id, cancellationToken))?.Name
              ?? throw new DomainException("That recipe category is no longer on the list. Choose it again, or add it.")
            : null;

    // A raw materials category, as saving it will need: the one it is in now may stay.
    private async Task CheckCategoryAsync(Guid? categoryId, Guid? current, CancellationToken cancellationToken)
    {
        if (categoryId is not { } id || id == PurchaseCategory.GeneralId)
            return;
        var category = await categories.GetByIdAsync(id, cancellationToken)
            ?? throw new DomainException("That category is no longer on the list. Choose it again, or add it.");
        if (category.Kind != CategoryKind.RawMaterials && id != current)
            throw new DomainException($"{category.Name} is a general expenses category: choose a raw materials category.");
    }

    // Its name, without adding General when it is not there yet.
    private async Task<string> CategoryNameAsync(Guid? categoryId, CancellationToken cancellationToken)
    {
        if (categoryId is not { } id || id == PurchaseCategory.GeneralId)
            return PurchaseCategory.GeneralName;
        return (await categories.GetByIdAsync(id, cancellationToken))?.Name
            ?? throw new DomainException("That category is no longer on the list. Choose it again, or add it.");
    }

    // As a new material starts: kg for grams, L for millilitres.
    private static (string Unit, decimal Size) DefaultDisplay(UnitOfMeasure unit) => unit switch
    {
        UnitOfMeasure.Gram => ("kg", 1000m),
        UnitOfMeasure.Millilitre => ("L", 1000m),
        _ => ("piece", 1m),
    };

    private static string Base(UnitOfMeasure unit) => unit switch
    {
        UnitOfMeasure.Gram => "g",
        UnitOfMeasure.Millilitre => "ml",
        _ => "pc",
    };
}

// Adds a prep item (no id) or changes one, for a manager.
public sealed record SavePrepItemCommand(
    Guid? PrepItemId,
    string Name,
    UnitOfMeasure Unit,
    decimal BatchQuantity,
    IReadOnlyList<PrepIngredientEntry> Ingredients,
    string? Code = null,
    Guid? CategoryId = null,
    string? DisplayUnit = null,
    decimal? DisplayUnitSize = null,
    decimal ReorderLevel = 0,
    Guid? RecipeCategoryId = null) : IRequest<PrepItemDto>
{
    public PrepItemChange Change =>
        new(Name, Unit, BatchQuantity, Ingredients, Code, CategoryId, DisplayUnit, DisplayUnitSize, ReorderLevel, RecipeCategoryId);
}

internal sealed class SavePrepItemCommandHandler(
    PrepItemWriter writer,
    IRawMaterialRepository materials,
    IPrepRecipeRepository recipes,
    IProductionOrderRepository orders,
    IApprovalRequestRepository approvals,
    IUnitOfWork unitOfWork) : IRequestHandler<SavePrepItemCommand, PrepItemDto>
{
    public async Task<PrepItemDto> Handle(SavePrepItemCommand request, CancellationToken cancellationToken)
    {
        if (request.PrepItemId is { } id)
            await approvals.EnsureNotPendingAsync(id, cancellationToken);
        var (item, recipe, category) = await writer.SaveAsync(request.Change, request.PrepItemId, null, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);

        var all = (await materials.GetAllAsync(cancellationToken)).ToDictionary(m => m.Id);
        all[item.Id] = item;
        var saved = (await recipes.GetAllAsync(cancellationToken)).Where(r => r.PrepItemId != recipe.PrepItemId).Append(recipe);
        return PrepItemCosting.Dto(
            item, recipe, all, await orders.GetRecentAsync(item.Id, 20, cancellationToken),
            new Dictionary<Guid, PurchaseCategory> { [category.Id] = category }, new RecipeCosts(all, saved));
    }
}

// A new or changed prep item by someone who may not approve: checked now, held as entered, and
// asked of a manager. RequestId is made by the till: a retry finds the request already made.
public sealed record RequestPrepItemChangeCommand(
    Guid RequestId, Guid? PrepItemId, PrepItemChange Change, string? Reason, string StaffId, string StaffName)
    : IRequest<ApprovalResultDto>, IRetryOnConflict;

internal sealed class RequestPrepItemChangeHandler(IApprovalRequestRepository requests, PrepItemWriter writer, IUnitOfWork unitOfWork)
    : IRequestHandler<RequestPrepItemChangeCommand, ApprovalResultDto>
{
    public async Task<ApprovalResultDto> Handle(RequestPrepItemChangeCommand request, CancellationToken cancellationToken)
    {
        if (await requests.GetByIdAsync(request.RequestId, cancellationToken) is { } already)
            return ApprovalResultDto.Of(already);
        if (request.PrepItemId is { } id && await requests.GetPendingForAsync(id, cancellationToken) is { } pending)
            throw new DomainException($"{pending.RequestedBy} has already asked {ApprovalLocks.What(pending)}. A manager will decide.");

        await writer.CheckAsync(request.Change, request.PrepItemId, cancellationToken);
        var (summary, changes) = await writer.DescribeAsync(request.Change, request.PrepItemId, cancellationToken);
        if (request.PrepItemId is not null && changes.Count == 0)
            throw new DomainException("Nothing has changed.");
        var asked = ApprovalRequest.AskToChange(
            request.RequestId, ApprovalModule.PrepItem, request.PrepItemId is null ? ApprovalAction.Create : ApprovalAction.Update,
            request.PrepItemId ?? Guid.NewGuid(), summary, changes, ApprovalPayload.Write(request.Change), request.Reason,
            request.StaffId, request.StaffName);
        requests.Add(asked);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return ApprovalResultDto.Of(asked);
    }
}
```


### 4.2 `ProductionOrders.cs`: المحاسبة سطرًا سطرًا

أمر الإنتاج يحرك **مخزونين**:

```text
1. لكل مكوّن: الكمية = (كمية المكوّن في الوصفة كما تُشترى) × (المخطط ÷ كمية الدفعة)
   حركة ProductionInput  سالبة، بتكلفة المكوّن = متوسطه الآن
2. تكلفة الدفعة = Σ (كمية × متوسط) لكل مكوّن     (كل سطر مقرّب لقرشين)
3. حركة ProductionOutput موجبة للمصنّع بالكمية المنتجة فعلًا،
   تكلفة الوحدة = تكلفة الدفعة ÷ الكمية المنتجة فعلًا
   ⇐ تدخل متوسط المصنّع كأي شراء (AverageWith)
```

**لماذا "المنتج فعلًا" وليس المخطط؟** لأن الدفعة قد تنتج أقل (هدر تشغيل) أو أكثر؛ تحميل تكلفة المكونات على الكمية الفعلية يعطي التكلفة الحقيقية للجرام.

- **المعاينة** (`PreviewProductionQuery`): ما ستأخذه الدفعة مقابل ما في السجلات (`OnHand`, `Short`) وتكلفتها.
- **للمدير فقط:** غيره يطلب، ولا شيء يتحرك حتى الموافقة، وتُنفذ **بمتوسطات لحظة الموافقة**.
- **لا تعديل لدفعة:** التصحيح = عكس حركاتها وإنشاء دفعة جديدة تسمّي ما استبدلته.

> 📄 **`backend/src/Costing.Application/Production/ProductionOrders.cs`** — 433 سطر

```csharp
using System.Globalization;
using MediatR;
using Costing.Domain.Common;
using Costing.Application.Approvals;
using Costing.Application.Common;
using Costing.Application.RawMaterials;
using Costing.Domain.Approvals;
using Costing.Domain.Production;
using Costing.Domain.RawMaterials;
using Costing.Domain.StockMovements;

namespace Costing.Application.Production;

// Production orders: the kitchen's prep work, logged. A prep item, how much was planned (which
// sets the ingredients) and how much came out; posting takes the ingredients off stock at their
// average cost and puts the prep item in at their total over what came out. OrderId is made by
// the till. Quantities are in each material's own unit; costs per its display unit.
//
// A batch moves two stocks, so it is a manager's: anyone else's batch, correction or deletion is
// a request (ApprovalRequests.cs), and nothing moves while it waits. Approved, it is made then,
// at the averages of that moment. A batch is never edited: a correction reverses it (its entries
// undone) and makes it again, as a new batch that names the one it replaced.

// One ingredient of a batch. OnHand and Short only on a preview: what the records show now, and
// how much more the batch takes than that.
public sealed record ProductionLineDto(
    Guid RawMaterialId,
    string? Code,
    string Material,
    bool IsPrepItem,
    UnitOfMeasure Unit,
    string PurchaseUnit,
    decimal PurchaseUnitSize,
    decimal Quantity,
    decimal? OnHand,
    decimal? Short,
    decimal? CostPerPurchaseUnit,
    decimal? Cost);

public sealed record ProductionOrderDto(
    Guid Id,
    Guid PrepItemId,
    string PrepItem,
    UnitOfMeasure Unit,
    string DisplayUnit,
    decimal DisplayUnitSize,
    decimal PlannedQuantity,
    decimal ProducedQuantity,
    // Produced against planned: under 100 is what was lost in the making.
    decimal YieldPercent,
    decimal TotalCost,
    decimal UnitCostPerDisplayUnit,
    DateTime ProducedAtUtc,
    string ProducedBy,
    string? Notes,
    IReadOnlyList<ProductionLineDto> Lines,
    ProductionOrderStatus Status,
    DateTime? VoidedAtUtc,
    string? VoidedBy,
    // A correction: the batch it replaced; and on a replaced one, the batch that corrects it.
    Guid? RevisionOf,
    Guid? ReplacedBy,
    string? ApprovedBy)
{
    public static ProductionOrderDto From(ProductionOrder order, IReadOnlyDictionary<Guid, RawMaterial> materials)
    {
        var item = materials.GetValueOrDefault(order.PrepItemId);
        var size = item?.PurchaseUnitSize ?? 1;
        return new ProductionOrderDto(
            order.Id, order.PrepItemId, item?.Name ?? "A removed prep item", item?.Unit ?? UnitOfMeasure.Gram, item?.PurchaseUnit ?? "unit", size,
            order.PlannedQuantity, order.ProducedQuantity, Math.Round(order.ProducedQuantity * 100 / order.PlannedQuantity, 1),
            order.TotalCost, PrepItemCosting.Money(order.UnitCost * size), order.ProducedAtUtc, order.ProducedBy, order.Notes,
            order.Lines
                .Select(l => materials.GetValueOrDefault(l.RawMaterialId) is { } m
                    ? new ProductionLineDto(m.Id, m.Code, m.Name, m.IsPrepItem, m.Unit, m.PurchaseUnit, m.PurchaseUnitSize, l.Quantity, null, null,
                        PrepItemCosting.Money(l.UnitCost * m.PurchaseUnitSize), l.Cost)
                    : new ProductionLineDto(l.RawMaterialId, null, "A removed material", false, UnitOfMeasure.Piece, "unit", 1, l.Quantity, null, null, null, l.Cost))
                .OrderByDescending(l => l.Cost)
                .ToList(),
            order.Status, order.VoidedAtUtc, order.VoidedBy, order.RevisionOf, order.ReplacedBy, order.ApprovedBy);
    }
}

// What a batch would take and cost if made now: the review before it is posted.
public sealed record ProductionPreviewDto(
    Guid PrepItemId,
    string PrepItem,
    UnitOfMeasure Unit,
    string DisplayUnit,
    decimal DisplayUnitSize,
    decimal PlannedQuantity,
    decimal ProducedQuantity,
    IReadOnlyList<ProductionLineDto> Lines,
    decimal? TotalCost,
    decimal? UnitCostPerDisplayUnit,
    // No cost yet: the batch cannot be posted until they have one.
    IReadOnlyList<string> MissingPrices,
    // Less on record than the batch takes: it can still be posted, and goes below zero.
    IReadOnlyList<string> Shortages);

// A batch as entered, held by a request until a manager approves it: which prep item, how much,
// and the id it is made under (for a correction, the new batch's).
public sealed record ProductionChange(Guid OrderId, Guid PrepItemId, decimal PlannedQuantity, decimal ProducedQuantity, string? Notes);

// Makes, voids and corrects batches, for a manager's own action and for an approval alike. What
// it makes and reverses is added to the orders and the ledger, for the caller to save.
internal sealed class ProductionWriter(
    IProductionOrderRepository orders,
    IPrepRecipeRepository recipes,
    IRawMaterialRepository materials,
    IStockMovementRepository movements,
    IRecordDescriptions descriptions)
{
    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

    public async Task<ProductionOrder> OrderAsync(Guid id, CancellationToken cancellationToken) =>
        await orders.GetByIdAsync(id, cancellationToken) ?? throw new NotFoundException(nameof(ProductionOrder), id);

    public async Task<ProductionPreviewDto> PreviewAsync(Guid prepItemId, decimal planned, decimal? produced, CancellationToken cancellationToken)
    {
        var all = (await materials.GetAllAsync(cancellationToken)).ToDictionary(m => m.Id);
        if (all.GetValueOrDefault(prepItemId) is not { IsPrepItem: true } item)
            throw new NotFoundException("Prep item", prepItemId);
        if (item.IsArchived)
            throw new DomainException($"{item.Name} has been deleted: it is no longer made.");
        var recipe = await recipes.GetByIdAsync(item.Id, cancellationToken);
        if (recipe is null || recipe.Ingredients.Count == 0)
            throw new DomainException($"{item.Name} has no ingredients yet: write its recipe first.");
        var made = produced ?? planned;
        if (made <= 0)
            throw new DomainException("Enter how much was made, more than nothing.");

        var lines = recipe.RequirementsFor(planned)
            .Select(r =>
            {
                var m = all.GetValueOrDefault(r.RawMaterialId) ?? throw new NotFoundException(nameof(RawMaterial), r.RawMaterialId);
                return new ProductionLineDto(
                    m.Id, m.Code, m.Name, m.IsPrepItem, m.Unit, m.PurchaseUnit, m.PurchaseUnitSize, r.Quantity, m.QuantityOnHand,
                    r.Quantity > m.QuantityOnHand ? r.Quantity - Math.Max(m.QuantityOnHand, 0) : null,
                    m.CostPerPurchaseUnit is { } c ? PrepItemCosting.Money(c) : null,
                    m.AverageCost is { } unit ? PrepItemCosting.Money(r.Quantity * unit) : null);
            })
            .OrderByDescending(l => l.Cost ?? 0)
            .ToList();
        var missing = lines.Where(l => l.Cost is null).Select(l => l.Material).ToList();
        decimal? total = missing.Count == 0 ? lines.Sum(l => l.Cost!.Value) : null;

        return new ProductionPreviewDto(
            item.Id, item.Name, item.Unit, item.PurchaseUnit, item.PurchaseUnitSize, planned, made, lines,
            total, total is { } t ? PrepItemCosting.Money(t / made * item.PurchaseUnitSize) : null,
            missing, lines.Where(l => l.Short is not null).Select(l => l.Material).ToList());
    }

    // What would stop it being made now, refused before a request goes to a manager. It is made
    // on approval, at the prices then, and checked again there.
    public async Task CheckAsync(ProductionChange change, CancellationToken cancellationToken)
    {
        if (change.PlannedQuantity <= 0 || change.ProducedQuantity <= 0)
            throw new DomainException("Enter how much was planned and how much was made, both more than nothing.");
        if (change.Notes?.Trim().Length > 200)
            throw new DomainException("Keep the notes under 200 characters.");
        var preview = await PreviewAsync(change.PrepItemId, change.PlannedQuantity, change.ProducedQuantity, cancellationToken);
        if (preview.MissingPrices.Count > 0)
            throw new DomainException(
                $"{string.Join(", ", preview.MissingPrices)} {(preview.MissingPrices.Count == 1 ? "has" : "have")} no cost yet, so the batch's cost cannot be worked out. "
                + "Enter it on Raw materials, or post the invoice it came on.");
    }

    // Makes the batch: the ingredients out at their averages now, the prep item in at their total.
    public async Task<ProductionOrder> MakeAsync(
        ProductionChange change, string producedBy, string? approvedBy, CancellationToken cancellationToken, Guid? revisionOf = null)
    {
        var item = await materials.GetRequiredAsync(change.PrepItemId, cancellationToken);
        if (!item.IsPrepItem)
            throw new DomainException($"{item.Name} is bought, not made: it comes in on a purchase invoice.");
        var recipe = await recipes.GetByIdAsync(item.Id, cancellationToken)
            ?? throw new DomainException($"{item.Name} has no ingredients yet: write its recipe first.");

        // Tracked, as they change: their stock and, for the prep item, its average.
        var ingredients = recipe.Ingredients.Count == 0
            ? new Dictionary<Guid, RawMaterial>()
            : (await materials.GetByIdsAsync(recipe.Ingredients.Select(i => i.RawMaterialId).ToList(), cancellationToken)).ToDictionary(m => m.Id);

        var (order, ledger) = ProductionOrder.Make(
            change.OrderId, item, recipe, ingredients, change.PlannedQuantity, change.ProducedQuantity, producedBy, change.Notes, approvedBy, revisionOf);
        orders.Add(order);
        foreach (var movement in ledger)
            movements.Add(movement);
        return order;
    }

    // Reverses each of its entries, now: the ingredients back at what they were taken at, the
    // prep item out with its cost taken out of the average. Then marks it voided.
    public async Task VoidAsync(ProductionOrder order, string by, Guid? replacedBy, CancellationToken cancellationToken)
    {
        if (order.IsVoided)
            throw new DomainException("This batch has already been voided.");
        var originals = (await movements.GetBySourceAsync(order.Id, StockMovementReason.ProductionInput, cancellationToken))
            .Concat(await movements.GetBySourceAsync(order.Id, StockMovementReason.ProductionOutput, cancellationToken))
            .Where(m => !m.IsReversal)
            .ToList();
        if (originals.Count > 0)
        {
            var byId = await materials.GetRequiredByIdsAsync(originals.Select(m => m.RawMaterialId).Distinct().ToList(), cancellationToken);
            foreach (var original in originals)
                movements.Add(byId[original.RawMaterialId].Reverse(original, by));
        }

        order.Void(by, replacedBy);
    }

    // A correction: the batch reversed, then made again with the quantities given, at the
    // averages now, under the change's id. Kept by whoever made the first.
    public async Task<ProductionOrder> ReviseAsync(
        ProductionOrder original, ProductionChange change, string by, string? approvedBy, CancellationToken cancellationToken)
    {
        if (change.PrepItemId != original.PrepItemId)
            throw new DomainException("A correction makes the same prep item; void the batch and make the other instead.");
        await VoidAsync(original, by, change.OrderId, cancellationToken);
        return await MakeAsync(change, original.ProducedBy, approvedBy, cancellationToken, original.Id);
    }

    // "Batch of Pizza dough made 8 Oct 2026 by Omar · 9.6 kg · L.E 123.40"
    public static string Describe(ProductionOrder order, RawMaterial? item, IRecordDescriptions descriptions) =>
        $"Batch of {item?.Name ?? "a removed prep item"} made {descriptions.BusinessDateOf(order.ProducedAtUtc).ToString("d MMM yyyy", Invariant)}" +
        $"{(order.ProducedBy is { Length: > 0 } by ? $" by {by}" : "")} · " +
        $"{(item is null ? order.ProducedQuantity.ToString("0.###", Invariant) : PrepItemCosting.Amount(order.ProducedQuantity, item))} · " +
        CompanyMoney.Text(order.TotalCost);

    // What a request would make, for the manager: the quantities and what each ingredient gives,
    // as new, or for a correction against the batch as it was made.
    public async Task<(string Summary, IReadOnlyList<ApprovalChange> Changes)> DescribeAsync(
        ProductionChange change, ProductionOrder? original, CancellationToken cancellationToken)
    {
        var all = (await materials.GetAllAsync(cancellationToken)).ToDictionary(m => m.Id);
        var item = all[change.PrepItemId];
        var recipe = await recipes.GetByIdAsync(item.Id, cancellationToken)
            ?? throw new DomainException($"{item.Name} has no ingredients yet: write its recipe first.");
        var takes = recipe.RequirementsFor(change.PlannedQuantity).ToDictionary(r => r.RawMaterialId, r => r.Quantity);
        var took = original?.Lines.ToDictionary(l => l.RawMaterialId, l => l.Quantity) ?? [];
        string Of(Guid id) => all.GetValueOrDefault(id)?.Name ?? "A removed material";
        string? Taken(Dictionary<Guid, decimal> from, Guid id) =>
            from.TryGetValue(id, out var quantity) && all.GetValueOrDefault(id) is { } m ? PrepItemCosting.Readable(quantity, m.Unit) : null;

        var changes = new List<ApprovalChange>();
        void Add(string label, string? before, string? after)
        {
            if (before != after)
                changes.Add(new ApprovalChange(label, before, after));
        }

        if (original is null)
            Add("Prep item", null, item.Name);
        Add("Quantity to produce", original is null ? null : PrepItemCosting.Amount(original.PlannedQuantity, item), PrepItemCosting.Amount(change.PlannedQuantity, item));
        Add("Came out", original is null ? null : PrepItemCosting.Amount(original.ProducedQuantity, item), PrepItemCosting.Amount(change.ProducedQuantity, item));
        Add("Notes", original?.Notes, string.IsNullOrWhiteSpace(change.Notes) ? null : change.Notes.Trim());
        foreach (var id in took.Keys.Union(takes.Keys).OrderBy(Of))
            Add($"{Of(id)} taken", Taken(took, id), Taken(takes, id));

        var summary = original is null
            ? $"New batch of {item.Name} · {PrepItemCosting.Amount(change.PlannedQuantity, item)} planned, " +
              $"{PrepItemCosting.Amount(change.ProducedQuantity, item)} came out"
            : Describe(original, item, descriptions);
        return (summary, changes);
    }
}

public sealed record PreviewProductionQuery(Guid PrepItemId, decimal PlannedQuantity, decimal? ProducedQuantity = null)
    : IRequest<ProductionPreviewDto>;

internal sealed class PreviewProductionQueryHandler(ProductionWriter production)
    : IRequestHandler<PreviewProductionQuery, ProductionPreviewDto>
{
    public Task<ProductionPreviewDto> Handle(PreviewProductionQuery request, CancellationToken cancellationToken) =>
        production.PreviewAsync(request.PrepItemId, request.PlannedQuantity, request.ProducedQuantity, cancellationToken);
}

// Makes the batch, for a manager. Posting again, after an answer was lost, returns the order and
// changes nothing.
public sealed record MakeProductionOrderCommand(
    Guid OrderId, Guid PrepItemId, decimal PlannedQuantity, decimal ProducedQuantity, string? Notes = null, string StaffName = "")
    : IRequest<ProductionOrderDto>, IRetryOnConflict;

internal sealed class MakeProductionOrderCommandHandler(
    IProductionOrderRepository orders,
    IRawMaterialRepository materials,
    ProductionWriter production,
    IUnitOfWork unitOfWork) : IRequestHandler<MakeProductionOrderCommand, ProductionOrderDto>
{
    public async Task<ProductionOrderDto> Handle(MakeProductionOrderCommand request, CancellationToken cancellationToken)
    {
        var order = await orders.GetByIdAsync(request.OrderId, cancellationToken);
        if (order is null)
        {
            order = await production.MakeAsync(
                new ProductionChange(request.OrderId, request.PrepItemId, request.PlannedQuantity, request.ProducedQuantity, request.Notes),
                request.StaffName, null, cancellationToken);
            await unitOfWork.SaveChangesAsync(cancellationToken);
        }

        return ProductionOrderDto.From(order, (await materials.GetAllAsync(cancellationToken)).ToDictionary(m => m.Id));
    }
}

// A batch by someone who may not approve: asked of a manager, nothing moved until it is
// approved. Asking again for the same batch returns the request already made.
public sealed record RequestProductionOrderCommand(
    Guid RequestId,
    Guid OrderId,
    Guid PrepItemId,
    decimal PlannedQuantity,
    decimal ProducedQuantity,
    string? Notes,
    string? Reason,
    string StaffId,
    string StaffName) : IRequest<ApprovalResultDto>, IRetryOnConflict;

internal sealed class RequestProductionOrderHandler(
    IApprovalRequestRepository requests,
    IProductionOrderRepository orders,
    ProductionWriter production,
    IUnitOfWork unitOfWork) : IRequestHandler<RequestProductionOrderCommand, ApprovalResultDto>
{
    public async Task<ApprovalResultDto> Handle(RequestProductionOrderCommand request, CancellationToken cancellationToken)
    {
        if (await requests.GetByIdAsync(request.RequestId, cancellationToken) is { } already)
            return ApprovalResultDto.Of(already);
        if (await requests.GetPendingForAsync(request.OrderId, cancellationToken) is { } waiting)
            return ApprovalResultDto.Of(waiting);
        if (await orders.GetByIdAsync(request.OrderId, cancellationToken) is not null)
            throw new DomainException("This batch has already been made.");

        var change = new ProductionChange(
            request.OrderId, request.PrepItemId, request.PlannedQuantity, request.ProducedQuantity,
            string.IsNullOrWhiteSpace(request.Notes) ? null : request.Notes.Trim());
        await production.CheckAsync(change, cancellationToken);
        var (summary, changes) = await production.DescribeAsync(change, null, cancellationToken);
        var asked = ApprovalRequest.AskToChange(
            request.RequestId, ApprovalModule.ProductionOrder, ApprovalAction.Create, request.OrderId, summary, changes,
            ApprovalPayload.Write(change), request.Reason, request.StaffId, request.StaffName);
        requests.Add(asked);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return ApprovalResultDto.Of(asked);
    }
}

// Corrects a batch made with the wrong quantities: reversed and made again with these, at the
// averages now, as a new batch (NewOrderId, made by the till). Done at once by someone who may
// approve, and recorded as approved by them, since it moves stock back; asked of a manager by
// anyone else.
public sealed record ReviseProductionOrderCommand(
    Guid RequestId,
    Guid OrderId,
    Guid NewOrderId,
    decimal PlannedQuantity,
    decimal ProducedQuantity,
    string? Notes,
    string? Reason,
    string StaffId,
    string StaffName,
    bool CanApprove) : IRequest<ApprovalResultDto>, IRetryOnConflict;

internal sealed class ReviseProductionOrderHandler(
    IApprovalRequestRepository requests,
    ProductionWriter production,
    IUnitOfWork unitOfWork) : IRequestHandler<ReviseProductionOrderCommand, ApprovalResultDto>
{
    public async Task<ApprovalResultDto> Handle(ReviseProductionOrderCommand request, CancellationToken cancellationToken)
    {
        if (await requests.GetByIdAsync(request.RequestId, cancellationToken) is { } already)
            return ApprovalResultDto.Of(already);

        var original = await production.OrderAsync(request.OrderId, cancellationToken);
        if (original.IsVoided)
            throw new DomainException(original.ReplacedBy is null
                ? "This batch has been voided."
                : "This batch has already been corrected: correct the batch that replaced it.");
        if (await requests.GetPendingForAsync(original.Id, cancellationToken) is { } pending)
            throw new DomainException($"{pending.RequestedBy} has already asked {ApprovalLocks.What(pending)}. A manager will decide.");

        var notes = string.IsNullOrWhiteSpace(request.Notes) ? null : request.Notes.Trim();
        if (request.PlannedQuantity == original.PlannedQuantity && request.ProducedQuantity == original.ProducedQuantity && notes == original.Notes)
            throw new DomainException("Nothing has changed: enter the quantities as they should have been.");
        var change = new ProductionChange(request.NewOrderId, original.PrepItemId, request.PlannedQuantity, request.ProducedQuantity, notes);
        await production.CheckAsync(change, cancellationToken);
        var (summary, changes) = await production.DescribeAsync(change, original, cancellationToken);
        var payload = ApprovalPayload.Write(change);

        if (!request.CanApprove)
        {
            var asked = ApprovalRequest.AskToChange(
                request.RequestId, ApprovalModule.ProductionOrder, ApprovalAction.Update, original.Id, summary, changes, payload,
                request.Reason, request.StaffId, request.StaffName);
            requests.Add(asked);
            await unitOfWork.SaveChangesAsync(cancellationToken);
            return ApprovalResultDto.Of(asked);
        }

        var decided = ApprovalRequest.DecidedChange(
            request.RequestId, ApprovalModule.ProductionOrder, ApprovalAction.Update, original.Id, summary, changes, payload,
            request.Reason, request.StaffId, request.StaffName);
        requests.Add(decided);
        await production.ReviseAsync(original, change, request.StaffName, null, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return ApprovalResultDto.Of(decided);
    }
}

// The production ledger, newest first, voided batches too: one prep item's when it is given.
public sealed record GetProductionOrdersQuery(Guid? PrepItemId = null) : IRequest<IReadOnlyList<ProductionOrderDto>>;

internal sealed class GetProductionOrdersQueryHandler(IProductionOrderRepository orders, IRawMaterialRepository materials)
    : IRequestHandler<GetProductionOrdersQuery, IReadOnlyList<ProductionOrderDto>>
{
    public async Task<IReadOnlyList<ProductionOrderDto>> Handle(GetProductionOrdersQuery request, CancellationToken cancellationToken)
    {
        var all = (await materials.GetAllAsync(cancellationToken)).ToDictionary(m => m.Id);
        return (await orders.GetRecentAsync(request.PrepItemId, 200, cancellationToken))
            .Select(o => ProductionOrderDto.From(o, all))
            .ToList();
    }
}

public sealed record GetProductionOrderQuery(Guid OrderId) : IRequest<ProductionOrderDto?>;

internal sealed class GetProductionOrderQueryHandler(IProductionOrderRepository orders, IRawMaterialRepository materials)
    : IRequestHandler<GetProductionOrderQuery, ProductionOrderDto?>
{
    public async Task<ProductionOrderDto?> Handle(GetProductionOrderQuery request, CancellationToken cancellationToken) =>
        await orders.GetByIdAsync(request.OrderId, cancellationToken) is { } order
            ? ProductionOrderDto.From(order, (await materials.GetAllAsync(cancellationToken)).ToDictionary(m => m.Id))
            : null;
}
```


## 5. المنيو

`Menu.cs`: الفئات، الأصناف بأرقامها (الرقم **يُعطى** وهو كود الصنف في التقارير، أو التالي بعد الأعلى من 1001)، الأحجام بأكوادها وأسعارها، والإضافات. والاستيراد من شيت (الفصل 07). `MenuReader` يبني المنيو كاملًا للعرض ولنقطة البيع.

> 📄 **`backend/src/Costing.Application/Menu/Menu.cs`** — 346 سطر

```csharp
using MediatR;
using Costing.Application.Common;
using Costing.Application.RawMaterials;
using Costing.Domain.Common;
using Costing.Domain.Menu;

namespace Costing.Application.Menu;

// The menu (قائمة الطعام): its categories, items and their sizes, and the add-ons, what the
// recipes sell by and the sales name. Kept here, or imported from a sheet, so the costs need no
// point of sale. An item's number is its code on the reports: given, or the next one after the
// highest.

public sealed record MenuCategoryDto(int Id, string Name, string? NameAr, int DisplayOrder, int Items);

public sealed record MenuSizeDto(int Id, string Name, string? NameAr, decimal Price);

public sealed record MenuItemDto(
    int Id, string Name, string? NameAr, string Category, decimal Price, bool IsPriceBasedOnAddons, bool IsAvailable, bool IsDeleted,
    IReadOnlyList<MenuSizeDto> Sizes, IReadOnlyList<int> AddOnIds)
{
    public static MenuItemDto From(MenuItem item) => new(
        item.Id, item.Name, item.NameAr, item.Category, item.Price, item.IsPriceBasedOnAddons, item.IsAvailable, item.IsDeleted,
        item.Variants.OrderBy(v => v.DisplayOrder).ThenBy(v => v.Id).Select(v => new MenuSizeDto(v.Id, v.Name, v.NameAr, v.Price)).ToList(),
        item.AddOnIds);
}

public sealed record AddOnDto(int Id, string Name, string? NameAr, decimal Price, bool IsDeleted);

public sealed record MenuDto(IReadOnlyList<MenuCategoryDto> Categories, IReadOnlyList<MenuItemDto> Items, IReadOnlyList<AddOnDto> AddOns);

// Deleted items and add-ons too, marked: a recipe or a sale may name one.
public sealed record GetMenuQuery : IRequest<MenuDto>;

internal sealed class GetMenuHandler(IMenuRepository menu) : IRequestHandler<GetMenuQuery, MenuDto>
{
    public async Task<MenuDto> Handle(GetMenuQuery request, CancellationToken cancellationToken) => await MenuReader.ReadAsync(menu, cancellationToken);
}

internal static class MenuReader
{
    public static async Task<MenuDto> ReadAsync(IMenuRepository menu, CancellationToken cancellationToken)
    {
        var items = await menu.GetItemsAsync(cancellationToken);
        var counts = items.Where(i => !i.IsDeleted).GroupBy(i => i.Category, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.Count(), StringComparer.OrdinalIgnoreCase);
        var categories = (await menu.GetCategoriesAsync(cancellationToken))
            .Select(c => new MenuCategoryDto(c.Id, c.Name, c.NameAr, c.DisplayOrder, counts.GetValueOrDefault(c.Name)))
            .ToList();
        return new MenuDto(
            categories, items.Select(MenuItemDto.From).ToList(),
            (await menu.GetAddOnsAsync(cancellationToken)).Select(a => new AddOnDto(a.Id, a.Name, a.NameAr, a.Price, a.IsDeleted)).ToList());
    }
}

// ---- Categories ----

// Added (no Id) or renamed; a rename moves its items with it.
public sealed record SaveMenuCategoryCommand(int? Id, string Name, string? NameAr, int? DisplayOrder) : IRequest<MenuDto>, IRetryOnConflict;

internal sealed class SaveMenuCategoryHandler(IMenuRepository menu, IUnitOfWork unitOfWork) : IRequestHandler<SaveMenuCategoryCommand, MenuDto>
{
    public async Task<MenuDto> Handle(SaveMenuCategoryCommand request, CancellationToken cancellationToken)
    {
        var categories = await menu.GetCategoriesAsync(cancellationToken);
        var name = request.Name?.Trim() ?? string.Empty;
        if (categories.Any(c => c.Id != request.Id && string.Equals(c.Name, name, StringComparison.OrdinalIgnoreCase)))
            throw new DomainException($"There is a category called {name} already.");

        if (request.Id is { } id)
        {
            var category = await menu.GetCategoryAsync(id, cancellationToken) ?? throw new NotFoundException("Menu category", id);
            var before = category.Name;
            category.Rename(name, request.NameAr);
            if (request.DisplayOrder is { } order)
                category.MoveTo(order);
            if (!string.Equals(before, category.Name, StringComparison.Ordinal))
            {
                foreach (var item in (await menu.GetItemsAsync(cancellationToken)).Where(i => string.Equals(i.Category, before, StringComparison.OrdinalIgnoreCase)))
                    item.MoveToCategory(category.Name);
            }
        }
        else
        {
            menu.AddCategory(new MenuCategory(name, request.NameAr, request.DisplayOrder ?? (categories.Count == 0 ? 1 : categories.Max(c => c.DisplayOrder) + 1)));
        }

        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await MenuReader.ReadAsync(menu, cancellationToken);
    }
}

// Only an empty one: its items are moved to another first.
public sealed record DeleteMenuCategoryCommand(int Id) : IRequest<MenuDto>;

internal sealed class DeleteMenuCategoryHandler(IMenuRepository menu, IUnitOfWork unitOfWork) : IRequestHandler<DeleteMenuCategoryCommand, MenuDto>
{
    public async Task<MenuDto> Handle(DeleteMenuCategoryCommand request, CancellationToken cancellationToken)
    {
        var category = await menu.GetCategoryAsync(request.Id, cancellationToken) ?? throw new NotFoundException("Menu category", request.Id);
        var inIt = (await menu.GetItemsAsync(cancellationToken)).Count(i => !i.IsDeleted && string.Equals(i.Category, category.Name, StringComparison.OrdinalIgnoreCase));
        if (inIt > 0)
            throw new DomainException($"{category.Name} has {inIt} {(inIt == 1 ? "item" : "items")}: move them to another category first.");
        menu.RemoveCategory(category);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await MenuReader.ReadAsync(menu, cancellationToken);
    }
}

// ---- Items ----

public sealed record MenuSizeInput(string Name, string? NameAr, decimal Price);

// Added (no Id: Number, or the next one) or changed. Its category is one on the menu, by name.
public sealed record SaveMenuItemCommand(
    int? Id, int? Number, string Name, string? NameAr, string Category, decimal Price, bool IsPriceBasedOnAddons, bool IsAvailable,
    IReadOnlyList<MenuSizeInput>? Sizes, IReadOnlyList<int>? AddOnIds) : IRequest<MenuItemDto>, IRetryOnConflict;

internal sealed class SaveMenuItemHandler(IMenuRepository menu, IUnitOfWork unitOfWork) : IRequestHandler<SaveMenuItemCommand, MenuItemDto>
{
    public async Task<MenuItemDto> Handle(SaveMenuItemCommand request, CancellationToken cancellationToken)
    {
        var category = await MenuChecks.CategoryAsync(menu, request.Category, cancellationToken);
        await MenuChecks.AddOnsAsync(menu, request.AddOnIds ?? [], cancellationToken);
        if (request.IsPriceBasedOnAddons && (request.AddOnIds ?? []).Count == 0)
            throw new DomainException("An item priced by its add-ons has at least one add-on.");

        MenuItem item;
        if (request.Id is { } id)
        {
            item = await menu.GetItemAsync(id, cancellationToken) ?? throw new NotFoundException("Menu item", id);
            item.Change(request.Name, request.NameAr, category.Name, request.Price, request.IsPriceBasedOnAddons);
        }
        else
        {
            var number = request.Number ?? await menu.NextItemNumberAsync(cancellationToken);
            if (await menu.GetItemAsync(number, cancellationToken) is { } taken)
                throw new DomainException($"Number {number} is {taken.Name}'s: choose another, or leave it for the next one.");
            item = new MenuItem(number, request.Name, request.NameAr, category.Name, request.Price, request.IsPriceBasedOnAddons);
            menu.AddItem(item);
        }

        item.SetVariants((request.Sizes ?? []).Select(s => (s.Name, s.NameAr, s.Price)).ToList());
        item.SetAddOns(request.AddOnIds ?? []);
        item.SetAvailable(request.IsAvailable);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return MenuItemDto.From(item);
    }
}

// Off the menu, or back on it. Its recipe and its sales stay.
public sealed record SetMenuItemDeletedCommand(int Id, bool Deleted) : IRequest<MenuItemDto>;

internal sealed class SetMenuItemDeletedHandler(IMenuRepository menu, IUnitOfWork unitOfWork) : IRequestHandler<SetMenuItemDeletedCommand, MenuItemDto>
{
    public async Task<MenuItemDto> Handle(SetMenuItemDeletedCommand request, CancellationToken cancellationToken)
    {
        var item = await menu.GetItemAsync(request.Id, cancellationToken) ?? throw new NotFoundException("Menu item", request.Id);
        if (request.Deleted)
            item.Delete();
        else
            item.Restore();
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return MenuItemDto.From(item);
    }
}

// ---- Add-ons ----

public sealed record SaveAddOnCommand(int? Id, string Name, string? NameAr, decimal Price) : IRequest<AddOnDto>, IRetryOnConflict;

internal sealed class SaveAddOnHandler(IMenuRepository menu, IUnitOfWork unitOfWork) : IRequestHandler<SaveAddOnCommand, AddOnDto>
{
    public async Task<AddOnDto> Handle(SaveAddOnCommand request, CancellationToken cancellationToken)
    {
        var name = request.Name?.Trim() ?? string.Empty;
        if ((await menu.GetAddOnsAsync(cancellationToken)).Any(a => a.Id != request.Id && !a.IsDeleted && string.Equals(a.Name, name, StringComparison.OrdinalIgnoreCase)))
            throw new DomainException($"There is an add-on called {name} already.");
        AddOn addOn;
        if (request.Id is { } id)
        {
            addOn = await menu.GetAddOnAsync(id, cancellationToken) ?? throw new NotFoundException("Add-on", id);
            addOn.Change(name, request.NameAr, request.Price);
        }
        else
        {
            addOn = new AddOn(name, request.NameAr, request.Price);
            menu.AddAddOn(addOn);
        }

        await unitOfWork.SaveChangesAsync(cancellationToken);
        return new AddOnDto(addOn.Id, addOn.Name, addOn.NameAr, addOn.Price, addOn.IsDeleted);
    }
}

public sealed record SetAddOnDeletedCommand(int Id, bool Deleted) : IRequest<AddOnDto>;

internal sealed class SetAddOnDeletedHandler(IMenuRepository menu, IUnitOfWork unitOfWork) : IRequestHandler<SetAddOnDeletedCommand, AddOnDto>
{
    public async Task<AddOnDto> Handle(SetAddOnDeletedCommand request, CancellationToken cancellationToken)
    {
        var addOn = await menu.GetAddOnAsync(request.Id, cancellationToken) ?? throw new NotFoundException("Add-on", request.Id);
        if (request.Deleted)
            addOn.Delete();
        else
            addOn.Restore();
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return new AddOnDto(addOn.Id, addOn.Name, addOn.NameAr, addOn.Price, addOn.IsDeleted);
    }
}

internal static class MenuChecks
{
    public static async Task<MenuCategory> CategoryAsync(IMenuRepository menu, string? name, CancellationToken cancellationToken)
    {
        var wanted = name?.Trim();
        if (string.IsNullOrEmpty(wanted))
            throw new DomainException("Choose its category.");
        return (await menu.GetCategoriesAsync(cancellationToken)).SingleOrDefault(c => string.Equals(c.Name, wanted, StringComparison.OrdinalIgnoreCase))
            ?? throw new DomainException($"There is no category {wanted}: add it first.");
    }

    public static async Task AddOnsAsync(IMenuRepository menu, IReadOnlyList<int> ids, CancellationToken cancellationToken)
    {
        if (ids.Count == 0)
            return;
        var known = (await menu.GetAddOnsAsync(cancellationToken)).Where(a => !a.IsDeleted).Select(a => a.Id).ToHashSet();
        if (ids.FirstOrDefault(id => !known.Contains(id)) is var missing and not 0)
            throw new DomainException($"There is no add-on {missing}: choose one on the menu.");
    }
}

// ---- Import ----

// A row of a menu sheet: an item, or one of its sizes on a row of its own under the same number
// or name. A category not on the menu is added; an item already there (by its number, or its
// name) is changed; a size is added to it or changed.
public sealed record MenuImportRow(
    int Row, int? Number, string? Name, string? NameAr, string? Category, string? CategoryAr, decimal? Price, string? Size, string? SizeAr,
    decimal? SizePrice);

public sealed record MenuImportResult(int Added, int Updated, int CategoriesAdded, IReadOnlyList<SkippedSheetRow> Skipped);

public sealed record ImportMenuCommand(IReadOnlyList<MenuImportRow> Rows) : IRequest<MenuImportResult>;

internal sealed class ImportMenuHandler(IMenuRepository menu, IUnitOfWork unitOfWork) : IRequestHandler<ImportMenuCommand, MenuImportResult>
{
    public const int MaxRows = 5_000;

    public async Task<MenuImportResult> Handle(ImportMenuCommand request, CancellationToken cancellationToken)
    {
        if (request.Rows.Count == 0)
            throw new DomainException("The sheet has no items on it.");
        if (request.Rows.Count > MaxRows)
            throw new DomainException($"Import {MaxRows:N0} rows at most at a time: split the sheet.");

        var categories = (await menu.GetCategoriesAsync(cancellationToken)).ToDictionary(c => c.Name, StringComparer.OrdinalIgnoreCase);
        var items = (await menu.GetItemsAsync(cancellationToken)).ToDictionary(i => i.Id);
        var byName = items.Values.GroupBy(i => i.Name, StringComparer.OrdinalIgnoreCase).ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);
        var nextNumber = await menu.NextItemNumberAsync(cancellationToken);
        var nextOrder = categories.Count == 0 ? 1 : categories.Values.Max(c => c.DisplayOrder) + 1;

        var skipped = new List<SkippedSheetRow>();
        var added = new HashSet<int>();
        var updated = new HashSet<int>();
        var categoriesAdded = 0;
        var sizes = new Dictionary<int, List<(string Name, string? NameAr, decimal Price)>>();

        foreach (var row in request.Rows)
        {
            try
            {
                var name = row.Name?.Trim();
                var item = row.Number is { } number ? items.GetValueOrDefault(number) : null;
                item ??= name is { Length: > 0 } ? byName.GetValueOrDefault(name) : null;

                if (item is null)
                {
                    if (string.IsNullOrEmpty(name))
                        throw new DomainException("No item name.");
                    var categoryName = row.Category?.Trim();
                    if (string.IsNullOrEmpty(categoryName))
                        throw new DomainException("No category.");
                    if (!categories.TryGetValue(categoryName, out var category))
                    {
                        category = new MenuCategory(categoryName, row.CategoryAr, nextOrder++);
                        menu.AddCategory(category);
                        categories[category.Name] = category;
                        categoriesAdded++;
                    }

                    var newNumber = row.Number ?? nextNumber;
                    if (row.Number is null)
                        nextNumber++;
                    else if (newNumber >= nextNumber)
                        nextNumber = newNumber + 1;
                    item = new MenuItem(newNumber, name, row.NameAr, category.Name, row.Price ?? 0, false);
                    menu.AddItem(item);
                    items[item.Id] = item;
                    byName[item.Name] = item;
                    added.Add(item.Id);
                }
                else if (!added.Contains(item.Id) && (row.Price is not null || !string.IsNullOrWhiteSpace(row.Category) || !string.IsNullOrWhiteSpace(row.NameAr)))
                {
                    var categoryName = string.IsNullOrWhiteSpace(row.Category) ? item.Category : row.Category.Trim();
                    if (!categories.TryGetValue(categoryName, out var category))
                    {
                        category = new MenuCategory(categoryName, row.CategoryAr, nextOrder++);
                        menu.AddCategory(category);
                        categories[category.Name] = category;
                        categoriesAdded++;
                    }

                    item.Change(name is { Length: > 0 } ? name : item.Name, row.NameAr ?? item.NameAr, category.Name, row.Price ?? item.Price, item.IsPriceBasedOnAddons);
                    updated.Add(item.Id);
                }

                if (!string.IsNullOrWhiteSpace(row.Size))
                {
                    if (!sizes.TryGetValue(item.Id, out var list))
                    {
                        sizes[item.Id] = list = item.Variants.OrderBy(v => v.DisplayOrder).Select(v => (v.Name, v.NameAr, v.Price)).ToList();
                    }
                    var size = (Name: row.Size.Trim(), NameAr: string.IsNullOrWhiteSpace(row.SizeAr) ? null : row.SizeAr.Trim(), Price: row.SizePrice ?? row.Price ?? 0);
                    var at = list.FindIndex(s => string.Equals(s.Name, size.Name, StringComparison.OrdinalIgnoreCase));
                    if (at >= 0)
                        list[at] = size;
                    else
                        list.Add(size);
                    if (!added.Contains(item.Id))
                        updated.Add(item.Id);
                }
            }
            catch (DomainException ex)
            {
                skipped.Add(new SkippedSheetRow(row.Row, row.Name, ex.Message));
            }
        }

        foreach (var (id, list) in sizes)
            items[id].SetVariants(list);

        await unitOfWork.SaveChangesAsync(cancellationToken);
        return new MenuImportResult(added.Count, updated.Count, categoriesAdded, skipped);
    }
}
```


## 6. محرك التكلفة والتقرير النظري: `CostingService`

خدمة قراءة في Infrastructure (استعلامات تجميعية):

- **`MaterialCostDto`:** AP$ لكل وحدة شراء (المتوسط × حجم الوحدة)، Yield الافتراضي، EP$، الرصيد وقيمته، و `recipeCostPerUnit`/`costedByRecipe`/`recipeCostMissing` للمصنعات.
- **بطاقة الوصفة (`RecipeCostCard`):** لكل سطر: EP، Yield، كما يُشترى، EP$، التكلفة؛ ثم تكلفة الحصة، سعر البيع، نسبة التكلفة، والحالة مقابل الهدف (`CostStatus`).
- **التقرير النظري (`TheoreticalCostReport`):** لكل صنف مُباع في الفترة: الكمية × تكلفة وصفته = تكلفة المبيعات النظرية، مقابل إيراده. (يُستخدم في الـ KPIs والفروقات، الفصل 06.)
- **ورقة المبيعات اليدوية** والإعدادات (الهدف، التكاليف المشتركة).

> 📄 **`backend/src/Costing.Infrastructure/Reports/CostingService.cs`** — 762 سطر

```csharp
using Microsoft.EntityFrameworkCore;
using Costing.Application.Common;
using Costing.Domain.Common;
using Costing.Domain.Production;
using Costing.Domain.Sales;
using Costing.Domain.Categories;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;
using Costing.Domain.StockMovements;
using Costing.Infrastructure.Common;
using Costing.Infrastructure.Persistence;

namespace Costing.Infrastructure.Reports;

// Where a dish's cost stands against its price.
public enum CostStatus
{
    // Within the food cost target.
    WithinTarget,
    // Above it: the template's "فوق الهدف".
    AboveTarget,
    // No recipe, so no cost: never shown as a 0% food cost.
    NoRecipe,
    // A recipe with an ingredient that has no price yet: the cost shown is short of the truth.
    MissingPrices,
    // No price to compare with: priced by its add-ons, or free.
    NoPrice,
}

public sealed record MaterialCostDto(
    Guid Id,
    string? Code,
    string Name,
    string? Category,
    UnitOfMeasure Unit,
    string PurchaseUnit,
    decimal PurchaseUnitSize,
    decimal? CostPerPurchaseUnit,
    decimal DefaultYieldPercent,
    decimal QuantityOnHand,
    decimal ReorderLevel,
    decimal? StockValue,
    decimal? LastPurchaseCostPerPurchaseUnit,
    DateTime? LastPurchasedAtUtc,
    // The weighted average per unit (gram, millilitre, piece), unrounded: what a recipe card
    // works from, so the till's live figures match the server's to the cent.
    decimal? CostPerUnit,
    // Bought, or made in the kitchen (a prep item, its cost from its batches).
    MaterialKind Kind,
    // The purchase category Category names.
    Guid CategoryId,
    // In a general expenses category: filed there before the kinds were kept apart.
    bool Misplaced = false,
    // What a recipe is costed from, per unit, unrounded: CostPerUnit, or for a prep item never
    // made yet its cost by its own recipe today (CostedByRecipe). See RecipeCosts.
    decimal? RecipeCostPerUnit = null,
    bool CostedByRecipe = false,
    // Costed by its recipe: what has no price inside it ("Cream", "Alfredo base: Cream").
    IReadOnlyList<string>? RecipeCostMissing = null);

// One line of the Recipe Costing Template. Quantity is the Edible Portion (EP) for the whole
// recipe in the material's Unit; APS/Unit and EPS/Unit are per PurchaseUnit, as prices are written.
public sealed record RecipeCostLine(
    Guid RawMaterialId,
    string? Code,
    string Ingredient,
    decimal Quantity,
    UnitOfMeasure Unit,
    string PurchaseUnit,
    decimal PurchaseUnitSize,
    decimal? ApsPerUnit,
    decimal YieldPercent,
    decimal? EpsPerUnit,
    decimal? RecipeCost,
    // A prep item never made yet, costed by its own recipe today.
    bool CostedByRecipe = false);

// The Recipe Costing Template, for one recipe, or for a menu item, size or add-on by the recipe
// it sells by. Recipe is the name it goes by: its own, or its menu item's. MenuPrice is the price
// it is costed against: the menu's, or an off-menu recipe's planned price.
public sealed record RecipeCostCard(
    RecipeTargetKind? TargetKind,
    int? CatalogItemId,
    int? VariantId,
    string ItemCode,
    string Recipe,
    string? RecipeAr,
    string? Category,
    bool HasRecipe,
    int Portions,
    decimal? MenuPrice,
    decimal FoodCostTargetPercent,
    IReadOnlyList<RecipeCostLine> Lines,
    decimal CostPerRecipe,
    decimal IngredientCostPerPortion,
    decimal SharedCostPerPortion,
    decimal CostPerPortion,
    decimal? MarginPerPortion,
    decimal? FoodCostPercentActual,
    decimal IdealSellingPrice,
    IReadOnlyList<string> MissingPrices,
    CostStatus Status,
    Guid? RecipeId = null,
    // Its own name, if it has one; the menu item's name, when it is linked to one.
    string? RecipeName = null,
    string? LinkedTo = null,
    // Off the menu: an off-menu or R&D recipe, never sold.
    bool IsStandalone = false,
    decimal? PlannedPrice = null,
    // A size with no recipe of its own, costed by the dish's.
    bool UsesBaseRecipe = false,
    bool IsDeleted = false,
    DateTime? DeletedAtUtc = null,
    string? DeletedBy = null,
    // The kitchen's own category for it; null until it is sorted.
    Guid? RecipeCategoryId = null,
    string? RecipeCategory = null,
    string? RecipeCategoryAr = null);

// Where a theoretical cost report's sales come from: the till's closed orders (and the online ones),
// or quantities an accountant typed in.
public enum TheoreticalSource
{
    Pos = 1,
    Manual = 2,
}

// One line of the report. QuantitySold is in portions, or for a prep item entered by hand in its
// Unit (kg, L). Off the menu, MenuItemId is 0 and RecipeId or PrepItemId says what it is.
public sealed record TheoreticalCostRow(
    string ItemCode,
    int MenuItemId,
    int? VariantId,
    string MenuItem,
    string? MenuItemAr,
    string Category,
    decimal QuantitySold,
    decimal NetSales,
    decimal RecipeCostPerUnit,
    decimal TheoreticalCost,
    decimal SharedCost,
    decimal? FoodCostPercent,
    CostStatus Status,
    int QuantityCostedNow,
    string? Unit = null,
    Guid? RecipeId = null,
    Guid? PrepItemId = null);

// The Monthly Theoretical Cost report: what the month's sales should have cost by their recipes,
// with no waste and no mistakes. Source says whose sales: the till's, costed as they were sold, or
// typed in, costed at today's prices; EnteredBy and EnteredAtUtc, for typed ones, by whom and when.
public sealed record TheoreticalCostReport(
    int Year,
    int Month,
    DateOnly From,
    DateOnly To,
    decimal FoodCostTargetPercent,
    IReadOnlyList<TheoreticalCostRow> Rows,
    decimal QuantitySold,
    decimal NetSales,
    decimal TheoreticalCost,
    decimal? FoodCostPercent,
    TheoreticalSource Source = TheoreticalSource.Pos,
    string? EnteredBy = null,
    DateTime? EnteredAtUtc = null);

// One row of the manual sales sheet: a recipe (in portions) or a prep item (in its display unit),
// what one costs now and sells at, and the quantity entered for the month, if any.
public sealed record ManualSalesItemDto(
    ManualSalesItemKind Kind,
    Guid ItemId,
    string? Code,
    string Name,
    string? NameAr,
    string Group,
    string Unit,
    decimal? CostPerUnit,
    decimal? Price,
    decimal? Quantity);

public sealed record ManualSalesSheetDto(int Year, int Month, IReadOnlyList<ManualSalesItemDto> Items, string? EnteredBy, DateTime? EnteredAtUtc);

public sealed record ManualSalesLineDto(ManualSalesItemKind Kind, Guid ItemId, decimal Quantity);

// VarianceTolerancePercent and BeverageCategories: left out of a save, they stay as they are.
public sealed record CostingSettingsDto(
    decimal FoodCostTargetPercent, decimal? VarianceTolerancePercent = null, IReadOnlyList<string>? BeverageCategories = null);

public sealed record SharedCostDto(Guid Id, string Name, Guid? RawMaterialId, string? RawMaterialName, decimal? MonthlyAmount, string? Category);

public sealed record SaveSharedCostRequest(string Name, Guid? RawMaterialId, decimal? MonthlyAmount, string? Category);

// The manager's costing: the Recipe Costing Template (Pillar 1) and the Monthly Theoretical Cost
// report (Pillar 2). Costs come from the stock module: each material's weighted average cost,
// and the cost each sale's stock movements recorded when they happened. Prices are the menu's,
// which are before tax, so net sales need no VAT taken off.
public sealed class CostingService(CostingDbContext db, IBusinessCalendar clock, SalesLedger ledger)
{
    // ---- Materials ----

    public async Task<IReadOnlyList<MaterialCostDto>> GetMaterialsAsync(CancellationToken cancellationToken)
    {
        // Deleted ones are kept for the records that name them, off the list.
        var all = await db.RawMaterials.AsNoTracking().OrderBy(m => m.Name).ToListAsync(cancellationToken);
        var materials = all.Where(m => !m.IsArchived).ToList();
        var costs = new RecipeCosts(all.ToDictionary(m => m.Id), await db.PrepRecipes.AsNoTracking().Include(r => r.Ingredients).ToListAsync(cancellationToken));
        var categories = await db.PurchaseCategories.AsNoTracking().ToDictionaryAsync(c => c.Id, cancellationToken);
        // The last price that stands: a voided delivery or batch, and its reversal, are not one.
        var lastPurchases = await db.StockMovements.AsNoTracking()
            .Where(m => (m.Reason == StockMovementReason.Purchase || m.Reason == StockMovementReason.ProductionOutput) && m.UnitCost != null
                && m.ReversalOf == null && !db.StockMovements.Any(r => r.ReversalOf == m.Id))
            .GroupBy(m => m.RawMaterialId)
            .Select(g => g.OrderByDescending(m => m.OccurredAtUtc).Select(m => new { m.RawMaterialId, m.UnitCost, m.OccurredAtUtc }).First())
            .ToDictionaryAsync(p => p.RawMaterialId, cancellationToken);

        return materials.Select(m =>
        {
            var last = lastPurchases.GetValueOrDefault(m.Id);
            return new MaterialCostDto(
                m.Id, m.Code, m.Name, categories.GetValueOrDefault(m.CategoryId)?.Name, m.Unit, m.PurchaseUnit, m.PurchaseUnitSize,
                Money(m.CostPerPurchaseUnit), m.DefaultYieldPercent, m.QuantityOnHand, m.ReorderLevel,
                Money(m.AverageCost * Math.Max(m.QuantityOnHand, 0)),
                Money(last?.UnitCost * m.PurchaseUnitSize), last?.OccurredAtUtc, m.AverageCost, m.Kind, m.CategoryId,
                categories.GetValueOrDefault(m.CategoryId)?.Kind == CategoryKind.Expenses, costs.Of(m.Id).PerUnit, costs.Of(m.Id).ByRecipe,
                costs.Of(m.Id).ByRecipe ? costs.Of(m.Id).Missing : []);
        }).ToList();
    }

    // ---- Settings and shared costs ----

    public async Task<CostingSettingsDto> GetSettingsAsync(CancellationToken cancellationToken)
    {
        var settings = await SettingsAsync(cancellationToken);
        return new(settings.FoodCostTargetPercent, settings.VarianceTolerancePercent, settings.BeverageCategories);
    }

    public async Task<CostingSettingsDto> SaveSettingsAsync(CostingSettingsDto settings, CancellationToken cancellationToken)
    {
        if (settings.FoodCostTargetPercent is <= 0 or >= 100)
            throw new DomainException("The food cost target is a percentage between 0 and 100.");
        var row = await db.CostingSettings.SingleOrDefaultAsync(cancellationToken);
        if (row is null)
            db.CostingSettings.Add(row = new CostingSettings());
        if (settings.VarianceTolerancePercent is <= 0 or >= 100)
            throw new DomainException("The variance tolerance is a percentage between 0 and 100.");
        row.FoodCostTargetPercent = settings.FoodCostTargetPercent;
        row.VarianceTolerancePercent = settings.VarianceTolerancePercent ?? row.VarianceTolerancePercent;
        if (settings.BeverageCategories is { } beverages)
            row.BeverageCategories = beverages.Where(c => !string.IsNullOrWhiteSpace(c)).Select(c => c.Trim()).Distinct().ToList();
        await db.SaveChangesAsync(cancellationToken);
        return new(row.FoodCostTargetPercent, row.VarianceTolerancePercent, row.BeverageCategories);
    }

    public async Task<IReadOnlyList<SharedCostDto>> GetSharedCostsAsync(CancellationToken cancellationToken)
    {
        var names = await db.RawMaterials.AsNoTracking().ToDictionaryAsync(m => m.Id, m => m.Name, cancellationToken);
        return (await db.SharedCosts.AsNoTracking().OrderBy(c => c.Name).ToListAsync(cancellationToken))
            .Select(c => new SharedCostDto(c.Id, c.Name, c.RawMaterialId, c.RawMaterialId is { } id ? names.GetValueOrDefault(id) : null, c.MonthlyAmount, c.Category))
            .ToList();
    }

    public async Task<SharedCostDto> SaveSharedCostAsync(Guid? id, SaveSharedCostRequest request, CancellationToken cancellationToken)
    {
        var cost = id is { } existing
            ? await db.SharedCosts.SingleOrDefaultAsync(c => c.Id == existing, cancellationToken) ?? throw new NotFoundException("Shared cost", existing)
            : db.SharedCosts.Add(new SharedCost()).Entity;
        cost.Name = request.Name ?? string.Empty;
        cost.RawMaterialId = request.RawMaterialId;
        cost.MonthlyAmount = request.MonthlyAmount;
        cost.Category = request.Category;
        cost.Validate();
        if (cost.RawMaterialId is { } materialId && !await db.RawMaterials.AnyAsync(m => m.Id == materialId, cancellationToken))
            throw new NotFoundException("Raw material", materialId);
        await db.SaveChangesAsync(cancellationToken);
        return (await GetSharedCostsAsync(cancellationToken)).Single(c => c.Id == cost.Id);
    }

    public async Task DeleteSharedCostAsync(Guid id, CancellationToken cancellationToken) =>
        await db.SharedCosts.Where(c => c.Id == id).ExecuteDeleteAsync(cancellationToken);

    // ---- Pillar 1: the recipe costing card ----

    public async Task<RecipeCostCard> GetRecipeCardAsync(RecipeTargetKind kind, int catalogItemId, int? variantId, CancellationToken cancellationToken)
    {
        var data = await LoadMenuAsync(cancellationToken);
        var target = data.Targets.SingleOrDefault(t => t.Kind == kind && t.CatalogItemId == catalogItemId && t.VariantId == variantId)
            ?? throw new NotFoundException("Menu item", variantId is null ? catalogItemId : $"{catalogItemId}/{variantId}");
        return Card(target, data);
    }

    // Every dish, size and add-on with its cost per portion, by the recipe it sells by: what can be
    // linked, and which have no recipe yet.
    public async Task<IReadOnlyList<RecipeCostCard>> GetMenuCostsAsync(CancellationToken cancellationToken)
    {
        var data = await LoadMenuAsync(cancellationToken);
        return data.Targets.Select(t => Card(t, data)).ToList();
    }

    // Every recipe, on the menu or off it, by name: the recipes screen's list. The deleted ones
    // only when asked for.
    public async Task<IReadOnlyList<RecipeCostCard>> GetRecipesAsync(bool includeDeleted, CancellationToken cancellationToken)
    {
        var data = await LoadMenuAsync(cancellationToken);
        return data.AllRecipes
            .Where(r => includeDeleted || !r.IsDeleted)
            .Select(r => Card(r, data))
            .OrderBy(c => c.Recipe, StringComparer.CurrentCultureIgnoreCase)
            .ToList();
    }

    public async Task<RecipeCostCard> GetRecipeCardAsync(Guid recipeId, CancellationToken cancellationToken)
    {
        var data = await LoadMenuAsync(cancellationToken);
        var recipe = data.AllRecipes.SingleOrDefault(r => r.Id == recipeId) ?? throw new NotFoundException(nameof(Recipe), recipeId);
        return Card(recipe, data);
    }

    // ---- Pillar 2: the monthly theoretical cost report ----

    public async Task<TheoreticalCostReport> GetTheoreticalCostAsync(
        int year, int month, CancellationToken cancellationToken, TheoreticalSource source = TheoreticalSource.Pos)
    {
        if (month is < 1 or > 12 || year is < 2000 or > 2100)
            throw new DomainException("Choose a month.");
        if (source == TheoreticalSource.Manual)
            return await ManualTheoreticalCostAsync(year, month, cancellationToken);
        var settings = await SettingsAsync(cancellationToken);
        var first = new DateOnly(year, month, 1);
        var last = first.AddMonths(1).AddDays(-1);
        var sales = await SalesAsync(first, last, cancellationToken);
        var shared = await SharedPerMealAsync(first, last, sales, cancellationToken);
        var target = settings.FoodCostTargetPercent;

        var rows = sales
            .GroupBy(s => (s.MenuItemId, s.VariantId))
            .Select(g =>
            {
                var any = g.First();
                var quantity = g.Sum(s => s.Quantity);
                var netSales = g.Sum(s => s.NetSales);
                var ingredients = g.Sum(s => s.IngredientCost);
                var sharedCost = shared.For(any.Category) * quantity;
                var theoretical = ingredients + sharedCost;
                var foodCost = netSales > 0 ? Percent(theoretical / netSales) : (decimal?)null;
                var status = g.All(s => !s.HasRecipe) ? CostStatus.NoRecipe
                    : g.Any(s => s.MissingPrice) ? CostStatus.MissingPrices
                    : netSales <= 0 ? CostStatus.NoPrice
                    : foodCost > target ? CostStatus.AboveTarget : CostStatus.WithinTarget;
                return new TheoreticalCostRow(
                    ItemCode(any.MenuItemId, any.VariantId), any.MenuItemId, any.VariantId, any.Name, any.NameAr, any.Category,
                    quantity, Money(netSales), Money(theoretical / quantity), Money(theoretical), Money(sharedCost), foodCost, status,
                    g.Where(s => s.CostedNow).Sum(s => s.Quantity));
            })
            .OrderBy(r => r.MenuItemId).ThenBy(r => r.VariantId)
            .ToList();

        var totalSales = rows.Sum(r => r.NetSales);
        var totalCost = rows.Sum(r => r.TheoreticalCost);
        return new TheoreticalCostReport(
            year, month, first, last, target, rows, rows.Sum(r => r.QuantitySold), totalSales, totalCost,
            totalSales > 0 ? Percent(totalCost / totalSales) : null);
    }

    // ---- Pillar 2 by hand: sales typed in instead of the till's ----

    // Every active recipe and prep item, with what it costs and sells at now, and the quantity
    // entered for the month.
    public async Task<ManualSalesSheetDto> GetManualSalesAsync(int year, int month, CancellationToken cancellationToken)
    {
        if (month is < 1 or > 12 || year is < 2000 or > 2100)
            throw new DomainException("Choose a month.");
        var sheet = await ManualSheetAsync(year, month, cancellationToken);
        var entered = sheet?.Lines.ToDictionary(l => (l.Kind, l.ItemId), l => l.Quantity) ?? [];
        var items = await ManualItemsAsync(cancellationToken);
        return new ManualSalesSheetDto(
            year, month,
            items.Values
                .Select(i => i.Dto with { Quantity = entered.TryGetValue((i.Dto.Kind, i.Dto.ItemId), out var q) ? q : null })
                .OrderBy(i => i.Kind)
                .ThenBy(i => i.Group == "Uncategorized")
                .ThenBy(i => i.Group, StringComparer.CurrentCultureIgnoreCase)
                .ThenBy(i => i.Name, StringComparer.CurrentCultureIgnoreCase)
                .ToList(),
            sheet?.UpdatedBy, sheet?.UpdatedAtUtc);
    }

    // The month's quantities, the whole sheet each time: one left out or at 0 was not sold.
    // Portions are whole; a prep item's kg or litres need not be.
    public async Task<TheoreticalCostReport> SaveManualSalesAsync(
        int year, int month, IReadOnlyList<ManualSalesLineDto> lines, string? enteredBy, CancellationToken cancellationToken)
    {
        if (month is < 1 or > 12 || year is < 2000 or > 2100)
            throw new DomainException("Choose a month.");
        if (lines.GroupBy(l => (l.Kind, l.ItemId)).Any(g => g.Count() > 1))
            throw new DomainException("Each item goes on the sheet once.");
        var items = await ManualItemsAsync(cancellationToken);
        foreach (var line in lines)
        {
            if (!items.TryGetValue((line.Kind, line.ItemId), out var item))
                throw new DomainException("An item on the sheet is no longer there. Reload the sheet.");
            if (line.Quantity < 0)
                throw new DomainException($"{item.Dto.Name}: a quantity cannot be negative.");
            if (line.Kind == ManualSalesItemKind.Recipe && line.Quantity != decimal.Truncate(line.Quantity))
                throw new DomainException($"{item.Dto.Name}: portions are whole.");
        }

        var sheet = await db.ManualSalesSheets.Include(s => s.Lines).SingleOrDefaultAsync(s => s.Year == year && s.Month == month, cancellationToken);
        if (sheet is null)
            db.ManualSalesSheets.Add(sheet = new ManualSalesSheet { Year = year, Month = month });
        sheet.Lines.Clear();
        sheet.Lines.AddRange(lines.Where(l => l.Quantity > 0)
            .Select(l => new ManualSalesLine { Year = year, Month = month, Kind = l.Kind, ItemId = l.ItemId, Quantity = Math.Round(l.Quantity, 3) }));
        sheet.UpdatedAtUtc = DateTime.UtcNow;
        sheet.UpdatedBy = enteredBy;
        await db.SaveChangesAsync(cancellationToken);
        return await ManualTheoreticalCostAsync(year, month, cancellationToken);
    }

    // The same report from the typed quantities: each at what it costs by its recipe now, and the
    // month's shared costs spread over the meals typed in, as they are over the meals sold.
    private async Task<TheoreticalCostReport> ManualTheoreticalCostAsync(int year, int month, CancellationToken cancellationToken)
    {
        var settings = await SettingsAsync(cancellationToken);
        var first = new DateOnly(year, month, 1);
        var last = first.AddMonths(1).AddDays(-1);
        var sheet = await ManualSheetAsync(year, month, cancellationToken);
        var items = await ManualItemsAsync(cancellationToken);
        var lines = (sheet?.Lines ?? [])
            .Where(l => l.Quantity > 0 && items.ContainsKey((l.Kind, l.ItemId)))
            .Select(l => (Line: l, Item: items[(l.Kind, l.ItemId)]))
            .ToList();

        var meals = lines
            .Where(x => x.Item.IsMeal)
            .Select(x => new SoldLine(x.Item.MenuItemId, x.Item.VariantId, x.Item.Dto.Name, x.Item.Dto.NameAr, x.Item.SharedCategory ?? string.Empty,
                (int)x.Line.Quantity, (x.Item.Dto.Price ?? 0) * x.Line.Quantity, (x.Item.Dto.CostPerUnit ?? 0) * x.Line.Quantity, true, false, false))
            .ToList();
        var shared = await SharedPerMealAsync(first, last, meals, cancellationToken);
        var target = settings.FoodCostTargetPercent;

        var rows = lines
            .Select(x =>
            {
                var (line, item) = x;
                var quantity = line.Quantity;
                var sharedCost = item.IsMeal ? shared.For(item.SharedCategory) * quantity : 0;
                var theoretical = (item.Dto.CostPerUnit ?? 0) * quantity + sharedCost;
                var netSales = (item.Dto.Price ?? 0) * quantity;
                var foodCost = netSales > 0 ? Percent(theoretical / netSales) : (decimal?)null;
                var status = item.Dto.CostPerUnit is null || item.MissingPrice ? CostStatus.MissingPrices
                    : netSales <= 0 ? CostStatus.NoPrice
                    : foodCost > target ? CostStatus.AboveTarget : CostStatus.WithinTarget;
                return new TheoreticalCostRow(
                    item.Dto.Code ?? string.Empty, item.MenuItemId, item.VariantId, item.Dto.Name, item.Dto.NameAr, item.Dto.Group,
                    quantity, Money(netSales), Money(theoretical / quantity), Money(theoretical), Money(sharedCost), foodCost, status, 0,
                    item.Dto.Kind == ManualSalesItemKind.PrepItem ? item.Dto.Unit : null,
                    item.Dto.Kind == ManualSalesItemKind.Recipe ? item.Dto.ItemId : null,
                    item.Dto.Kind == ManualSalesItemKind.PrepItem ? item.Dto.ItemId : null);
            })
            .OrderBy(r => r.PrepItemId is not null)
            .ThenBy(r => r.Category == "Uncategorized")
            .ThenBy(r => r.Category, StringComparer.CurrentCultureIgnoreCase)
            .ThenBy(r => r.MenuItem, StringComparer.CurrentCultureIgnoreCase)
            .ToList();

        var totalSales = rows.Sum(r => r.NetSales);
        var totalCost = rows.Sum(r => r.TheoreticalCost);
        return new TheoreticalCostReport(
            year, month, first, last, target, rows, rows.Where(r => r.Unit is null).Sum(r => r.QuantitySold), totalSales, totalCost,
            totalSales > 0 ? Percent(totalCost / totalSales) : null,
            TheoreticalSource.Manual, sheet?.UpdatedBy, sheet?.UpdatedAtUtc);
    }

    private Task<ManualSalesSheet?> ManualSheetAsync(int year, int month, CancellationToken cancellationToken) =>
        db.ManualSalesSheets.AsNoTracking().Include(s => s.Lines).SingleOrDefaultAsync(s => s.Year == year && s.Month == month, cancellationToken);

    // A row of the sheet with what the report needs of it besides: whether it is a meal (a dish on
    // the menu or off it, not an add-on or a prep item) and the category its shared costs go by.
    private sealed record ManualItem(ManualSalesItemDto Dto, bool IsMeal, string? SharedCategory, int MenuItemId, int? VariantId, bool MissingPrice);

    private async Task<IReadOnlyDictionary<(ManualSalesItemKind, Guid), ManualItem>> ManualItemsAsync(CancellationToken cancellationToken)
    {
        var data = await LoadMenuAsync(cancellationToken);
        var items = new Dictionary<(ManualSalesItemKind, Guid), ManualItem>();
        foreach (var recipe in data.AllRecipes.Where(r => !r.IsDeleted))
        {
            var card = Card(recipe, data);
            items[(ManualSalesItemKind.Recipe, recipe.Id)] = new ManualItem(
                new ManualSalesItemDto(
                    ManualSalesItemKind.Recipe, recipe.Id, string.IsNullOrEmpty(card.ItemCode) ? null : card.ItemCode, card.Recipe, card.RecipeAr,
                    card.RecipeCategory ?? "Uncategorized", "portion", card.Lines.Count > 0 ? card.IngredientCostPerPortion : null, card.MenuPrice, null),
                card.TargetKind != RecipeTargetKind.AddOn, card.Category, card.CatalogItemId ?? 0, card.VariantId, card.MissingPrices.Count > 0);
        }

        // A prep item at what a batch costs by its recipe now, as a dish is; with no recipe to go
        // by, at what the batches on the shelf cost.
        var prepRecipes = await db.PrepRecipes.AsNoTracking().Include(r => r.Ingredients).ToDictionaryAsync(r => r.Id, cancellationToken);
        foreach (var prep in data.Materials.Values.Where(m => m.IsPrepItem && !m.IsArchived))
        {
            decimal? perUnit = prep.AverageCost * prep.PurchaseUnitSize;
            if (prepRecipes.GetValueOrDefault(prep.Id) is { Ingredients.Count: > 0 } recipe)
            {
                var (batchCost, _, missing) = data.Costs.Batch(recipe);
                if (missing.Count == 0)
                    perUnit = batchCost / recipe.BatchQuantity * prep.PurchaseUnitSize;
            }
            items[(ManualSalesItemKind.PrepItem, prep.Id)] = new ManualItem(
                new ManualSalesItemDto(
                    ManualSalesItemKind.PrepItem, prep.Id, prep.Code, prep.Name, null, "Prep items", prep.PurchaseUnit,
                    perUnit is { } p ? Money(p) : null, null, null),
                false, null, 0, null, false);
        }

        return items;
    }

    // ---- How it is worked out ----

    // A row of the menu that can have a recipe: a dish (or its base recipe), one of its sizes, an add-on.
    private sealed record Target(
        RecipeTargetKind Kind, int CatalogItemId, int? VariantId, string Name, string? NameAr, string? Category, decimal? Price, bool PricedByAddOns);

    private sealed record MenuData(
        IReadOnlyList<Target> Targets,
        // The recipe each target sells by: active and linked.
        IReadOnlyDictionary<RecipeTarget, Recipe> Recipes,
        IReadOnlyList<Recipe> AllRecipes,
        IReadOnlyDictionary<Guid, RecipeCategory> Categories,
        IReadOnlyDictionary<Guid, RawMaterial> Materials,
        decimal FoodCostTarget,
        SharedPerMeal Shared,
        // What each material is costed at in a recipe: a prep item never made, by its own recipe.
        RecipeCosts Costs);

    private async Task<MenuData> LoadMenuAsync(CancellationToken cancellationToken)
    {
        var items = await db.MenuItems.AsNoTracking().Where(m => !m.IsDeleted).OrderBy(m => m.Id).ToListAsync(cancellationToken);
        var variants = (await db.MenuItemVariants.AsNoTracking().OrderBy(v => v.DisplayOrder).ThenBy(v => v.Id).ToListAsync(cancellationToken))
            .ToLookup(v => v.MenuItemId);
        var addOns = await db.AddOns.AsNoTracking().OrderBy(a => a.Id).ToListAsync(cancellationToken);

        var targets = new List<Target>();
        foreach (var item in items)
        {
            // A dish with sizes is sold by size; its base recipe is what a size without its own uses.
            targets.Add(new Target(RecipeTargetKind.MenuItem, item.Id, null, item.Name, item.NameAr, item.Category,
                variants[item.Id].Any() ? null : item.Price, item.IsPriceBasedOnAddons));
            foreach (var variant in variants[item.Id])
                targets.Add(new Target(RecipeTargetKind.MenuItem, item.Id, variant.Id, $"{item.Name} ({variant.Name})",
                    item.NameAr is null ? null : $"{item.NameAr} ({variant.NameAr ?? variant.Name})", item.Category, variant.Price, false));
        }
        targets.AddRange(addOns.Select(a => new Target(RecipeTargetKind.AddOn, a.Id, null, a.Name, a.NameAr, null, a.Price, false)));

        var allRecipes = await db.Recipes.AsNoTracking().Include(r => r.Ingredients).ToListAsync(cancellationToken);
        var recipes = allRecipes.Where(r => !r.IsDeleted && r.Target is not null).ToDictionary(r => r.Target!.Value);
        var materials = await db.RawMaterials.AsNoTracking().ToDictionaryAsync(m => m.Id, cancellationToken);
        var costs = new RecipeCosts(materials, await db.PrepRecipes.AsNoTracking().Include(r => r.Ingredients).ToListAsync(cancellationToken));

        // Shared costs on a recipe card are last month's, the last whole month there is.
        var thisMonth = clock.BusinessDateOf(DateTime.UtcNow);
        var lastFirst = new DateOnly(thisMonth.Year, thisMonth.Month, 1).AddMonths(-1);
        var lastLast = lastFirst.AddMonths(1).AddDays(-1);
        var shared = await SharedPerMealAsync(lastFirst, lastLast, await SalesAsync(lastFirst, lastLast, cancellationToken), cancellationToken);

        var categories = await db.RecipeCategories.AsNoTracking().ToDictionaryAsync(c => c.Id, cancellationToken);

        return new MenuData(targets, recipes, allRecipes, categories, materials, (await SettingsAsync(cancellationToken)).FoodCostTargetPercent, shared, costs);
    }

    // A menu row, by the recipe it sells by: a size with none of its own, by the dish's.
    private static RecipeCostCard Card(Target target, MenuData data)
    {
        var own = data.Recipes.GetValueOrDefault(new RecipeTarget(target.Kind, target.CatalogItemId, target.VariantId));
        var recipe = own ?? (target.VariantId is not null ? data.Recipes.GetValueOrDefault(RecipeTarget.ForMenuItem(target.CatalogItemId)) : null);
        return Card(target, recipe, own is null && recipe is not null, data);
    }

    // A recipe itself: on the menu or off it, deleted or not.
    private static RecipeCostCard Card(Recipe recipe, MenuData data)
    {
        var target = recipe.Target is { } t
            ? data.Targets.SingleOrDefault(x => x.Kind == t.Kind && x.CatalogItemId == t.CatalogItemId && x.VariantId == t.VariantId)
            : null;
        return Card(target, recipe, false, data);
    }

    private static RecipeCostCard Card(Target? target, Recipe? recipe, bool usesBaseRecipe, MenuData data)
    {
        var lines = recipe?.Ingredients
            .Select(i =>
            {
                var m = data.Materials[i.RawMaterialId];
                var price = data.Costs.Of(m.Id);
                var aps = price.PerUnit * m.PurchaseUnitSize;
                var eps = aps * 100 / i.YieldPercent;
                return new RecipeCostLine(m.Id, m.Code, m.Name, i.Quantity, m.Unit, m.PurchaseUnit, m.PurchaseUnitSize,
                    Money(aps), i.YieldPercent, Money(eps), Money(eps * i.Quantity / m.PurchaseUnitSize), price.ByRecipe);
            })
            .OrderBy(l => l.Ingredient)
            .ToList() ?? [];

        var standalone = recipe is { IsLinked: false };
        // The menu's category on the menu (shared costs are set by it); the kitchen's own off it.
        var own = recipe?.RecipeCategoryId is { } categoryId ? data.Categories.GetValueOrDefault(categoryId) : null;
        var category = target?.Category ?? own?.Name;
        var portions = recipe?.Portions ?? 1;
        var perRecipe = lines.Sum(l => l.RecipeCost ?? 0);
        var ingredientsPerPortion = perRecipe / portions;
        // A meal's share of the shared costs: a dish's, or a dish being planned off the menu; not an
        // add-on's. To the cent, as the card shows it: the till's live recalculation starts from it.
        var meal = target is null ? recipe is not null : target.Kind == RecipeTargetKind.MenuItem;
        var sharedPerPortion = meal && recipe is not null ? Money(data.Shared.For(category)) : 0;
        var perPortion = ingredientsPerPortion + sharedPerPortion;
        var price = target is null ? recipe?.PlannedPrice : target.PricedByAddOns ? null : target.Price;
        var foodCost = price > 0 ? Percent(perPortion / price.Value) : (decimal?)null;
        // What has no price under it: an ingredient's own, or one inside a prep item costed by its recipe.
        var missing = (recipe?.Ingredients ?? []).SelectMany(i => data.Costs.Of(i.RawMaterialId).Missing).Distinct().ToList();
        var status = recipe is null ? CostStatus.NoRecipe
            : missing.Count > 0 ? CostStatus.MissingPrices
            : foodCost is null ? CostStatus.NoPrice
            : foodCost > data.FoodCostTarget ? CostStatus.AboveTarget : CostStatus.WithinTarget;
        // Linked to a menu item that has since left the menu: named, but not costed against a price.
        var linkedTo = target?.Name ?? (recipe is { IsLinked: true } ? "A menu item no longer on the menu" : null);

        return new RecipeCostCard(
            target?.Kind ?? recipe?.TargetKind, target?.CatalogItemId ?? recipe?.CatalogItemId, target?.VariantId ?? recipe?.VariantId,
            target is null ? "" : target.Kind == RecipeTargetKind.AddOn ? $"A{target.CatalogItemId}" : ItemCode(target.CatalogItemId, target.VariantId),
            (usesBaseRecipe ? null : recipe?.Name) ?? target?.Name ?? recipe?.Name ?? "A recipe", target?.NameAr, category, recipe is not null, portions, price,
            data.FoodCostTarget, lines,
            Money(perRecipe), Money(ingredientsPerPortion), Money(sharedPerPortion), Money(perPortion),
            price is { } p ? Money(p - perPortion) : null, foodCost,
            Money(perPortion * 100 / data.FoodCostTarget), missing, status,
            recipe?.Id, usesBaseRecipe ? null : recipe?.Name, linkedTo, standalone, recipe?.PlannedPrice, usesBaseRecipe,
            recipe?.IsDeleted ?? false, recipe?.DeletedAtUtc, recipe?.DeletedBy,
            usesBaseRecipe ? null : own?.Id, usesBaseRecipe ? null : own?.Name, usesBaseRecipe ? null : own?.NameAr);
    }

    // One sold line of a settled order in the month, net of refunds, with what its ingredients
    // cost when it was sold: the stock movements its sale posted. CostedNow: sold before its dish
    // had a recipe, so costed by today's recipe at today's prices instead.
    private sealed record SoldLine(
        int MenuItemId, int? VariantId, string Name, string? NameAr, string Category, int Quantity, decimal NetSales,
        decimal IngredientCost, bool HasRecipe, bool MissingPrice, bool CostedNow);

    private async Task<IReadOnlyList<SoldLine>> SalesAsync(DateOnly first, DateOnly last, CancellationToken cancellationToken)
    {
        var (from, _) = clock.Bounds(first);
        var (_, to) = clock.Bounds(last);

        // Paid at the till or online, billed and not refunded: a line voided before payment was
        // never charged, and a refunded one is not a sale. An order's own discount is not shared
        // out across its items.
        var lines = (await ledger.GetAsync(from, to, cancellationToken)).SelectMany(o => o.Lines).Where(l => l.OnBill).ToList();
        if (lines.Count == 0)
            return [];

        // A sale's movements are posted just after the order closes; a day either side catches
        // the ones at the month's edges, and the line's id picks out its own.
        var ids = lines.Select(l => l.PublicId).ToHashSet();
        var movements = (await db.StockMovements.AsNoTracking()
                .Where(m => m.Reason == StockMovementReason.Sale && m.OccurredAtUtc >= from.AddDays(-1) && m.OccurredAtUtc < to.AddDays(1))
                .Select(m => new { m.SourceId, m.RawMaterialId, m.Quantity, m.UnitCost })
                .ToListAsync(cancellationToken))
            .Where(m => ids.Contains(m.SourceId))
            .ToLookup(m => m.SourceId);

        // A line sold before its dish had a recipe posted no movements. Once the dish has one, the
        // line is costed as the same sale would be today: the recipes a sale draws on
        // (StockRequirements), at each material's average cost now, a prep item never made yet by
        // its own recipe (RecipeCosts). So is a prep item taken off the shelf before its first
        // batch, at no cost then: the dish is costed by its recipe now.
        var recipes = await db.Recipes.AsNoTracking().Include(r => r.Ingredients).ToListAsync(cancellationToken);
        var materials = await db.RawMaterials.AsNoTracking().ToDictionaryAsync(m => m.Id, cancellationToken);
        var costs = new RecipeCosts(materials, await db.PrepRecipes.AsNoTracking().Include(r => r.Ingredients).ToListAsync(cancellationToken));
        bool IsPrep(Guid id) => materials.GetValueOrDefault(id)?.IsPrepItem == true;

        var menu = await db.MenuItems.AsNoTracking().IgnoreQueryFilters()
            .Select(m => new { m.Id, m.NameAr, m.Category })
            .ToDictionaryAsync(m => m.Id, cancellationToken);
        var variantNamesAr = await db.MenuItemVariants.AsNoTracking().ToDictionaryAsync(v => v.Id, v => v.NameAr, cancellationToken);

        return lines.Select(l =>
        {
            var posted = movements[l.PublicId].ToList();
            var item = menu.GetValueOrDefault(l.MenuItemId);
            var nameAr = item?.NameAr is null ? null
                : l.VariantId is { } v ? $"{item.NameAr} ({variantNamesAr.GetValueOrDefault(v) ?? l.VariantName})" : item.NameAr;
            var name = l.VariantName is null ? l.MenuItemName : $"{l.MenuItemName} ({l.VariantName})";
            if (posted.Count > 0)
            {
                decimal? UnitCost(Guid material, decimal? atSale) => atSale ?? (IsPrep(material) ? costs.Of(material).PerUnit : null);
                var costedNow = posted.Any(m => m.UnitCost is null && IsPrep(m.RawMaterialId));
                return new SoldLine(l.MenuItemId, l.VariantId, name, nameAr, item?.Category ?? string.Empty, l.Quantity, l.LineTotal,
                    posted.Sum(m => -m.Quantity * (UnitCost(m.RawMaterialId, m.UnitCost) ?? 0)) * l.PostedShare, true,
                    posted.Any(m => UnitCost(m.RawMaterialId, m.UnitCost) is null || (m.UnitCost is null && costs.Of(m.RawMaterialId).Missing.Count > 0)),
                    costedNow);
            }

            var needs = StockRequirements.For(new SoldItem(l.MenuItemId, l.VariantId, l.AddOnIds, l.Quantity), recipes);
            return new SoldLine(l.MenuItemId, l.VariantId, name, nameAr, item?.Category ?? string.Empty, l.Quantity, l.LineTotal,
                needs.Sum(n => n.Value * (costs.Of(n.Key).PerUnit ?? 0)), needs.Count > 0,
                needs.Keys.Any(id => costs.Of(id).Missing.Count > 0), needs.Count > 0);
        }).ToList();
    }

    // Each shared cost's month, per meal sold that shares it. A meal is food: a shared cost for
    // every meal (frying oil, gas, takeaway boxes) is not charged to a drink. One named for a
    // drinks category is, to that category.
    private sealed class SharedPerMeal(decimal everyMeal, IReadOnlyDictionary<string, decimal> byCategory, IReadOnlySet<string> drinks)
    {
        public static readonly SharedPerMeal None = new(0, new Dictionary<string, decimal>(), new HashSet<string>());

        public decimal For(string? category) =>
            (category is not null && drinks.Contains(category) ? 0 : everyMeal)
            + (category is not null ? byCategory.GetValueOrDefault(category) : 0);
    }

    private async Task<SharedPerMeal> SharedPerMealAsync(DateOnly first, DateOnly last, IReadOnlyList<SoldLine> sales, CancellationToken cancellationToken)
    {
        var costs = await db.SharedCosts.AsNoTracking().ToListAsync(cancellationToken);
        if (costs.Count == 0 || sales.Count == 0)
            return SharedPerMeal.None;

        var (from, _) = clock.Bounds(first);
        var (_, to) = clock.Bounds(last);
        var materialIds = costs.Where(c => c.RawMaterialId is not null).Select(c => c.RawMaterialId!.Value).ToList();
        var purchased = await db.StockMovements.AsNoTracking()
            .Where(m => m.Reason == StockMovementReason.Purchase && materialIds.Contains(m.RawMaterialId)
                && m.OccurredAtUtc >= from && m.OccurredAtUtc < to)
            .GroupBy(m => m.RawMaterialId)
            .Select(g => new { RawMaterialId = g.Key, Cost = g.Sum(m => m.Quantity * (m.UnitCost ?? 0)) })
            .ToDictionaryAsync(p => p.RawMaterialId, p => p.Cost, cancellationToken);

        var drinks = (await SettingsAsync(cancellationToken)).BeverageCategories.ToHashSet(StringComparer.OrdinalIgnoreCase);
        var meals = sales.Where(s => !drinks.Contains(s.Category)).Sum(s => s.Quantity);
        var mealsIn = sales.GroupBy(s => s.Category).ToDictionary(g => g.Key, g => g.Sum(s => s.Quantity));
        decimal everyMeal = 0;
        var byCategory = new Dictionary<string, decimal>();
        foreach (var cost in costs)
        {
            var month = cost.MonthlyAmount ?? purchased.GetValueOrDefault(cost.RawMaterialId!.Value);
            if (cost.Category is null)
                everyMeal += meals > 0 ? month / meals : 0;
            else if (mealsIn.GetValueOrDefault(cost.Category) is > 0 and var inCategory)
                byCategory[cost.Category] = byCategory.GetValueOrDefault(cost.Category) + month / inCategory;
        }
        return new SharedPerMeal(everyMeal, byCategory, drinks);
    }

    private async Task<CostingSettings> SettingsAsync(CancellationToken cancellationToken) =>
        await db.CostingSettings.AsNoTracking().SingleOrDefaultAsync(cancellationToken) ?? new CostingSettings();

    // The menu's own numbers: the dish's, and the size's after it.
    internal static string ItemCode(int menuItemId, int? variantId) =>
        variantId is { } v ? $"{menuItemId}-{v}" : menuItemId.ToString(System.Globalization.CultureInfo.InvariantCulture);

    internal static decimal Money(decimal value) => Math.Round(value, 2, MidpointRounding.AwayFromZero);

    internal static decimal? Money(decimal? value) => value is { } v ? Money(v) : null;

    internal static decimal Percent(decimal share) => Math.Round(share * 100, 1, MidpointRounding.AwayFromZero);
}
```


## 7. نقاط النهاية

`CostingController` (`api/costing`): التكاليف والتقارير الغذائية (المواد، البطاقات، النظري، الإعدادات، التكاليف المشتركة).

> 📄 **`backend/src/Costing.Api/Controllers/CostingController.cs`** — 186 سطر

```csharp
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Costing.Domain.Access;
using Costing.Domain.Recipes;
using Costing.Api.Auth;
using Costing.Infrastructure.Reports;

namespace Costing.Api.Controllers;

// The manager's costing: what dishes and ingredients cost, and the food cost reports. Costs are
// a manager's, not a cashier's, so all of it is CostingView. Materials, purchases and recipes are
// changed through api/inventory, as before.
[ApiController]
[Route("api/costing")]
[Authorize(Policy = Permissions.InventoryView)]
public sealed class CostingController(
    CostingService costing, VarianceService variance, KpiService kpis, BreakEvenService breakEven, PurchaseSpendingService spending,
    TreasuryService treasury, MediatR.ISender sender, Costing.Application.Common.IBusinessCalendar calendar) : ControllerBase
{
    // Raw materials with their costs: what each costs per purchase unit, the last price paid, and
    // the stock's value.
    [HttpGet("materials")]
    [CostingTab(CostingTabs.Materials | CostingTabs.Recipes | CostingTabs.Purchases | CostingTabs.Counts | CostingTabs.Waste | CostingTabs.Production | CostingTabs.Reports)]
    public Task<IReadOnlyList<MaterialCostDto>> GetMaterials(CancellationToken cancellationToken) =>
        costing.GetMaterialsAsync(cancellationToken);

    // A material's purchase history card (كارت الصنف): each invoice line that bought it, to check
    // against the paper invoices.
    [HttpGet("materials/{materialId:guid}/purchases")]
    [CostingTab(CostingTabs.Materials | CostingTabs.Recipes | CostingTabs.Purchases | CostingTabs.Counts | CostingTabs.Waste | CostingTabs.Production | CostingTabs.Reports)]
    public Task<MaterialPurchaseHistory> GetMaterialPurchases(Guid materialId, CancellationToken cancellationToken) =>
        spending.MaterialHistoryAsync(materialId, cancellationToken);

    // Every dish, size and add-on with its cost per portion and food cost %.
    [HttpGet("menu")]
    [CostingTab(CostingTabs.Recipes | CostingTabs.Menu | CostingTabs.Reports)]
    public Task<IReadOnlyList<RecipeCostCard>> GetMenuCosts(CancellationToken cancellationToken) =>
        costing.GetMenuCostsAsync(cancellationToken);

    // The Recipe Costing Template for one dish, size or add-on.
    [HttpGet("recipe-card")]
    [CostingTab(CostingTabs.Recipes | CostingTabs.Menu | CostingTabs.Reports)]
    public Task<RecipeCostCard> GetRecipeCard(
        [FromQuery] RecipeTargetKind targetKind, [FromQuery] int catalogItemId, [FromQuery] int? variantId, CancellationToken cancellationToken) =>
        costing.GetRecipeCardAsync(targetKind, catalogItemId, variantId, cancellationToken);

    // Every recipe, on the menu or off it; the deleted ones too when asked for.
    [HttpGet("recipes")]
    [CostingTab(CostingTabs.Recipes | CostingTabs.Menu | CostingTabs.Reports)]
    public Task<IReadOnlyList<RecipeCostCard>> GetRecipes([FromQuery] bool includeDeleted, CancellationToken cancellationToken) =>
        costing.GetRecipesAsync(includeDeleted, cancellationToken);

    // One recipe's costing card, deleted or not.
    [HttpGet("recipes/{recipeId:guid}")]
    [CostingTab(CostingTabs.Recipes | CostingTabs.Menu | CostingTabs.Reports)]
    public Task<RecipeCostCard> GetRecipeCardById(Guid recipeId, CancellationToken cancellationToken) =>
        costing.GetRecipeCardAsync(recipeId, cancellationToken);

    // The Monthly Theoretical Cost report for a business month: from the till's sales (Pos, the
    // default), or from the quantities typed in for it (Manual).
    [HttpGet("theoretical")]
    [CostingTab(CostingTabs.Reports | CostingTabs.Sales)]
    public Task<TheoreticalCostReport> GetTheoreticalCost(
        [FromQuery] int year, [FromQuery] int month, CancellationToken cancellationToken, [FromQuery] TheoreticalSource source = TheoreticalSource.Pos) =>
        costing.GetTheoreticalCostAsync(year, month, cancellationToken, source);

    // The month's sales sheet for typing quantities in: every active recipe and prep item.
    [HttpGet("manual-sales/{year:int}/{month:int}")]
    [CostingTab(CostingTabs.Reports | CostingTabs.Sales)]
    public Task<ManualSalesSheetDto> GetManualSales(int year, int month, CancellationToken cancellationToken) =>
        costing.GetManualSalesAsync(year, month, cancellationToken);

    // Saves the month's typed quantities, the whole sheet, and answers with the report from them.
    [HttpPut("manual-sales/{year:int}/{month:int}")]
    [CostingTab(CostingTabs.Reports | CostingTabs.Sales)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<TheoreticalCostReport> SaveManualSales(int year, int month, SaveManualSalesRequest request, CancellationToken cancellationToken) =>
        costing.SaveManualSalesAsync(year, month, request.Lines ?? [], User.FindFirst(UserClaims.Name)?.Value, cancellationToken);

    // Actual usage against standard between two posted stock counts; the last two by default.
    [HttpGet("variance")]
    [CostingTab(CostingTabs.Reports | CostingTabs.Counts)]
    public Task<VarianceReport> GetVariance([FromQuery] Guid? fromCountId, [FromQuery] Guid? toCountId, CancellationToken cancellationToken) =>
        variance.GetVarianceAsync(fromCountId, toCountId, cancellationToken);

    // Spoilage recorded in the last so many days, with what it cost.
    [HttpGet("spoilage")]
    [CostingTab(CostingTabs.Waste | CostingTabs.Reports)]
    public Task<IReadOnlyList<SpoilageEntry>> GetSpoilage([FromQuery] int days = 30, CancellationToken cancellationToken = default)
    {
        var to = DateTime.UtcNow;
        return variance.GetSpoilageAsync(to.AddDays(-Math.Clamp(days, 1, 366)), to.AddMinutes(1), cancellationToken);
    }

    // Breakage (كسر) in the last so many business days: what was broken, at its cost, beside the
    // spoilage. Voided ones too, marked.
    [HttpGet("breakage")]
    [CostingTab(CostingTabs.Waste | CostingTabs.Reports)]
    public Task<IReadOnlyList<Costing.Application.Waste.BreakageEntryDto>> GetBreakage(
        [FromQuery] int days = 30, CancellationToken cancellationToken = default)
    {
        var today = calendar.BusinessDateOf(DateTime.UtcNow);
        return sender.Send(new Costing.Application.Waste.GetBreakageQuery(today.AddDays(-Math.Clamp(days, 1, 366) + 1), today), cancellationToken);
    }

    // The template's financial KPIs for a business month, with the month as an income statement
    // and what each dish earned.
    [HttpGet("kpis")]
    [CostingTab(CostingTabs.Reports | CostingTabs.CostSettings)]
    public Task<KpiReport> GetKpis([FromQuery] int year, [FromQuery] int month, CancellationToken cancellationToken) =>
        kpis.GetAsync(year, month, cancellationToken);

    // A month's wages, labour hours and overheads, as the manager enters them. The whole month
    // each time: a figure left out is not known yet.
    [HttpPut("expenses/{year:int}/{month:int}")]
    [CostingTab(CostingTabs.Reports | CostingTabs.CostSettings)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<MonthlyExpensesDto> SaveExpenses(int year, int month, MonthlyExpensesDto expenses, CancellationToken cancellationToken) =>
        kpis.SaveExpensesAsync(year, month, expenses, User.FindFirst(UserClaims.Name)?.Value, cancellationToken);

    // Purchases by category between two days, both included: stock and expenses, from the posted invoices.
    [HttpGet("purchases/spending")]
    [CostingTab(CostingTabs.Reports | CostingTabs.CostSettings)]
    public Task<SpendingReport> GetSpending([FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken cancellationToken) =>
        spending.GetAsync(from, to, cancellationToken);

    // The safe between two days, both included: where its money came from and went, the tax held
    // for the tax authority, and day by day.
    [HttpGet("treasury")]
    [CostingTab(CostingTabs.Reports | CostingTabs.Financials)]
    public Task<TreasuryAnalytics> GetTreasury([FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken cancellationToken) =>
        treasury.GetAnalyticsAsync(from, to, cancellationToken);

    // The break-even worksheet over a run of months (one month: from = to), at a year's pace.
    [HttpGet("break-even")]
    [CostingTab(CostingTabs.Reports | CostingTabs.CostSettings)]
    public Task<BreakEvenWorksheet> GetBreakEven(
        [FromQuery] int fromYear, [FromQuery] int fromMonth, [FromQuery] int toYear, [FromQuery] int toMonth, CancellationToken cancellationToken) =>
        breakEven.GetAsync(fromYear, fromMonth, toYear, toMonth, cancellationToken);

    // The worksheet's four options, weekly sales to try, kept for next time.
    [HttpPut("break-even/scenarios")]
    [CostingTab(CostingTabs.Reports | CostingTabs.CostSettings)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<IReadOnlyList<decimal>> SaveBreakEvenScenarios(IReadOnlyList<decimal> scenarios, CancellationToken cancellationToken) =>
        breakEven.SaveScenariosAsync(scenarios, cancellationToken);

    [HttpGet("settings")]
    [CostingTab(CostingTabs.All)]
    public Task<CostingSettingsDto> GetSettings(CancellationToken cancellationToken) =>
        costing.GetSettingsAsync(cancellationToken);

    [HttpPut("settings")]
    [CostingTab(CostingTabs.CostSettings)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<CostingSettingsDto> SaveSettings(CostingSettingsDto settings, CancellationToken cancellationToken) =>
        costing.SaveSettingsAsync(settings, cancellationToken);

    [HttpGet("shared-costs")]
    [CostingTab(CostingTabs.CostSettings | CostingTabs.Reports)]
    public Task<IReadOnlyList<SharedCostDto>> GetSharedCosts(CancellationToken cancellationToken) =>
        costing.GetSharedCostsAsync(cancellationToken);

    [HttpPost("shared-costs")]
    [CostingTab(CostingTabs.CostSettings)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<SharedCostDto> AddSharedCost(SaveSharedCostRequest request, CancellationToken cancellationToken) =>
        costing.SaveSharedCostAsync(null, request, cancellationToken);

    [HttpPut("shared-costs/{id:guid}")]
    [CostingTab(CostingTabs.CostSettings)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<SharedCostDto> SaveSharedCost(Guid id, SaveSharedCostRequest request, CancellationToken cancellationToken) =>
        costing.SaveSharedCostAsync(id, request, cancellationToken);

    [HttpDelete("shared-costs/{id:guid}")]
    [CostingTab(CostingTabs.CostSettings)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public async Task<IActionResult> DeleteSharedCost(Guid id, CancellationToken cancellationToken)
    {
        await costing.DeleteSharedCostAsync(id, cancellationToken);
        return NoContent();
    }
}

public sealed record SaveManualSalesRequest(IReadOnlyList<ManualSalesLineDto> Lines);
```


`MenuSalesController.cs` يحمل خمسة Controllers صغيرة: `MenuController` (`api/menu`)، `SalesController` (`api/sales`)، `StaffController` (`api/staff`)، `AccessController` (`api/access`: توزيع الأقسام، الفصل 03)، و `BreakageController` (`api/costing/breakage`).

> 📄 **`backend/src/Costing.Api/Controllers/MenuSalesController.cs`** — 260 سطر

```csharp
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Costing.Api.Auth;
using Costing.Application.Access;
using Costing.Application.Common;
using Costing.Application.Menu;
using Costing.Application.Recipes;
using Costing.Application.Sales;
using Costing.Application.Staff;
using Costing.Application.Waste;
using Costing.Domain.Access;
using Costing.Domain.Common;
using Costing.Infrastructure.Excel;
using Costing.Infrastructure.Identity;

namespace Costing.Api.Controllers;

// The menu (قائمة الطعام): categories, items and sizes, add-ons. Read wherever recipes and sales
// are worked; changed on Menu.
[ApiController]
[Route("api/menu")]
[Authorize(Policy = Permissions.InventoryView)]
public sealed class MenuController(ISender sender) : ControllerBase
{
    private const int MaxImportBytes = 5 * 1024 * 1024;

    [HttpGet]
    [CostingTab(CostingTabs.Menu | CostingTabs.Recipes | CostingTabs.Sales | CostingTabs.Reports | CostingTabs.CostSettings)]
    public Task<MenuDto> GetMenu(CancellationToken cancellationToken) => sender.Send(new GetMenuQuery(), cancellationToken);

    [HttpPost("categories")]
    [CostingTab(CostingTabs.Menu)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<MenuDto> AddCategory(MenuCategoryRequest request, CancellationToken cancellationToken) =>
        sender.Send(new SaveMenuCategoryCommand(null, request.Name, request.NameAr, request.DisplayOrder), cancellationToken);

    [HttpPut("categories/{categoryId:int}")]
    [CostingTab(CostingTabs.Menu)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<MenuDto> UpdateCategory(int categoryId, MenuCategoryRequest request, CancellationToken cancellationToken) =>
        sender.Send(new SaveMenuCategoryCommand(categoryId, request.Name, request.NameAr, request.DisplayOrder), cancellationToken);

    [HttpDelete("categories/{categoryId:int}")]
    [CostingTab(CostingTabs.Menu)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<MenuDto> DeleteCategory(int categoryId, CancellationToken cancellationToken) =>
        sender.Send(new DeleteMenuCategoryCommand(categoryId), cancellationToken);

    // A new item: Number, or the next one after the highest.
    [HttpPost("items")]
    [CostingTab(CostingTabs.Menu)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<MenuItemDto> AddItem(MenuItemRequest request, CancellationToken cancellationToken) =>
        sender.Send(request.Command(null), cancellationToken);

    // Recipes off the menu put on it, each a menu item of its name linked to it: sold on Sales from
    // then on, taking its stock by the recipe. The Menu tab's, as it adds items.
    [HttpPost("from-recipes")]
    [CostingTab(CostingTabs.Menu)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<RecipesToMenuResult> AddRecipesToMenu(AddRecipesToMenuRequest request, CancellationToken cancellationToken) =>
        sender.Send(new AddRecipesToMenuCommand(request.Recipes ?? []), cancellationToken);

    [HttpPut("items/{itemId:int}")]
    [CostingTab(CostingTabs.Menu)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<MenuItemDto> UpdateItem(int itemId, MenuItemRequest request, CancellationToken cancellationToken) =>
        sender.Send(request.Command(itemId), cancellationToken);

    [HttpDelete("items/{itemId:int}")]
    [CostingTab(CostingTabs.Menu)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<MenuItemDto> DeleteItem(int itemId, CancellationToken cancellationToken) =>
        sender.Send(new SetMenuItemDeletedCommand(itemId, true), cancellationToken);

    [HttpPost("items/{itemId:int}/restore")]
    [CostingTab(CostingTabs.Menu)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<MenuItemDto> RestoreItem(int itemId, CancellationToken cancellationToken) =>
        sender.Send(new SetMenuItemDeletedCommand(itemId, false), cancellationToken);

    [HttpPost("add-ons")]
    [CostingTab(CostingTabs.Menu)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<AddOnDto> AddAddOn(AddOnRequest request, CancellationToken cancellationToken) =>
        sender.Send(new SaveAddOnCommand(null, request.Name, request.NameAr, request.Price), cancellationToken);

    [HttpPut("add-ons/{addOnId:int}")]
    [CostingTab(CostingTabs.Menu)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<AddOnDto> UpdateAddOn(int addOnId, AddOnRequest request, CancellationToken cancellationToken) =>
        sender.Send(new SaveAddOnCommand(addOnId, request.Name, request.NameAr, request.Price), cancellationToken);

    [HttpDelete("add-ons/{addOnId:int}")]
    [CostingTab(CostingTabs.Menu)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<AddOnDto> DeleteAddOn(int addOnId, CancellationToken cancellationToken) =>
        sender.Send(new SetAddOnDeletedCommand(addOnId, true), cancellationToken);

    [HttpPost("add-ons/{addOnId:int}/restore")]
    [CostingTab(CostingTabs.Menu)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<AddOnDto> RestoreAddOn(int addOnId, CancellationToken cancellationToken) =>
        sender.Send(new SetAddOnDeletedCommand(addOnId, false), cancellationToken);

    [HttpGet("template")]
    [CostingTab(CostingTabs.Menu)]
    public IActionResult Template() => File(MenuWorkbook.Build(), SheetFiles.ContentType, MenuWorkbook.FileName);

    [HttpPost("import")]
    [CostingTab(CostingTabs.Menu)]
    [Authorize(Policy = Permissions.InventoryManage)]
    [RequestSizeLimit(MaxImportBytes + 64 * 1024)]
    public async Task<MenuImportResult> Import(IFormFile file, CancellationToken cancellationToken)
    {
        if (file.Length > MaxImportBytes)
            throw new DomainException("The file is larger than 5 MB: a menu's sheet is far smaller. Is it the right file?");
        await using var stream = file.OpenReadStream();
        return await sender.Send(new ImportMenuCommand(MenuWorkbook.Read(stream)), cancellationToken);
    }
}

public sealed record MenuCategoryRequest(string Name, string? NameAr, int? DisplayOrder);

public sealed record MenuItemRequest(
    int? Number, string Name, string? NameAr, string Category, decimal Price, bool IsPriceBasedOnAddons, bool IsAvailable = true,
    IReadOnlyList<MenuSizeInput>? Sizes = null, IReadOnlyList<int>? AddOnIds = null)
{
    public SaveMenuItemCommand Command(int? id) =>
        new(id, Number, Name, NameAr, Category, Price, IsPriceBasedOnAddons, IsAvailable, Sizes, AddOnIds);
}

public sealed record AddOnRequest(string Name, string? NameAr, decimal Price);

public sealed record AddRecipesToMenuRequest(IReadOnlyList<RecipeToMenu>? Recipes);

// Sales (المبيعات): what the menu sold, entered or imported. A void is asked through the
// approvals (deletion-requests, module Sale), as the other voids are.
[ApiController]
[Route("api/sales")]
[Authorize(Policy = Permissions.InventoryView)]
[CostingTab(CostingTabs.Sales)]
public sealed class SalesController(ISender sender, IBusinessCalendar calendar) : ControllerBase
{
    private const int MaxImportBytes = 10 * 1024 * 1024;

    // A period's sales, a week to today unless asked.
    [HttpGet]
    public Task<SalesReport> GetSales([FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken cancellationToken)
    {
        var today = calendar.BusinessDateOf(DateTime.UtcNow);
        return sender.Send(new GetSalesQuery(from ?? today.AddDays(-6), to ?? today), cancellationToken);
    }

    // Its id is made by the app: a retry after a lost answer records it once.
    [HttpPost]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<SalesReceiptDto> Record(SaleInput sale, CancellationToken cancellationToken) =>
        sender.Send(new RecordSaleCommand(sale, UserClaims.NameOf(User)), cancellationToken);

    // Handed back after it was paid: a line's quantity, or the whole sale with no line named.
    [HttpPost("{saleId:guid}/refund")]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<SalesReceiptDto> Refund(Guid saleId, RefundRequest request, CancellationToken cancellationToken) =>
        sender.Send(new RefundSaleCommand(saleId, request.LinePublicId, request.Quantity, UserClaims.NameOf(User)), cancellationToken);

    // The day's sales summary: each item sold and how many, for its stock. One a day.
    [HttpPost("daily")]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<SalesReceiptDto> RecordDaily(DailySalesRequest request, CancellationToken cancellationToken) =>
        sender.Send(new RecordDailySalesCommand(request.Id, request.Date, request.Lines ?? [], UserClaims.NameOf(User)), cancellationToken);

    // Two columns, the item (from the menu's list) and how many sold, for the day chosen on import.
    [HttpGet("daily/template")]
    public async Task<IActionResult> DailyTemplate(CancellationToken cancellationToken) =>
        File(DailySalesWorkbook.Build(await sender.Send(new GetDailySalesSheetQuery(), cancellationToken)), SheetFiles.ContentType,
            DailySalesWorkbook.FileName);

    [HttpPost("daily/import")]
    [Authorize(Policy = Permissions.InventoryManage)]
    [RequestSizeLimit(MaxImportBytes + 64 * 1024)]
    public async Task<DailySalesImportResult> ImportDaily([FromQuery] DateOnly date, IFormFile file, CancellationToken cancellationToken)
    {
        if (file.Length > MaxImportBytes)
            throw new DomainException("The file is larger than 10 MB. · الملف أكبر من 10 ميجابايت.");
        await using var stream = file.OpenReadStream();
        return await sender.Send(new ImportDailySalesCommand(date, DailySalesWorkbook.Read(stream), UserClaims.NameOf(User)), cancellationToken);
    }
}

public sealed record DailySalesRequest(Guid Id, DateOnly Date, IReadOnlyList<DailySaleLine>? Lines);

public sealed record RefundRequest(Guid? LinePublicId, int? Quantity);

// Staff (الموظفين): who the safe pays advances and salaries to.
[ApiController]
[Route("api/staff")]
[Authorize(Policy = Permissions.InventoryView)]
public sealed class StaffController(ISender sender) : ControllerBase
{
    // Read where an advance is given: the safe, the daily batch, waste, and the end of the day.
    [HttpGet]
    [CostingTab(CostingTabs.Financials | CostingTabs.Purchases | CostingTabs.Waste | CostingTabs.EndOfDay)]
    public Task<IReadOnlyList<StaffMemberDto>> GetStaff(CancellationToken cancellationToken) => sender.Send(new GetStaffQuery(), cancellationToken);

    [HttpPut("{staffId:guid}")]
    [CostingTab(CostingTabs.Financials)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<StaffMemberDto> Save(Guid staffId, StaffMemberRequest request, CancellationToken cancellationToken) =>
        sender.Send(new SaveStaffMemberCommand(staffId, request.Name, request.JobTitle, request.IsActive), cancellationToken);
}

public sealed record StaffMemberRequest(string Name, string? JobTitle, bool IsActive = true);

// Permissions (الصلاحيات): the sections each user works, a manager's to give.
[ApiController]
[Route("api/access")]
[Authorize(Policy = Permissions.UsersManage)]
public sealed class AccessController(ISender sender, UserDirectory users) : ControllerBase
{
    [HttpGet]
    public async Task<IReadOnlyList<UserTabsDto>> GetAll(CancellationToken cancellationToken) =>
        await sender.Send(new GetUserTabsQuery(await AccountsAsync(cancellationToken)), cancellationToken);

    // Tabs: the sections, by name; none sent (null), back to the role's own.
    [HttpPut("{userId}")]
    public async Task<UserTabsDto> Set(string userId, SetTabsRequest request, CancellationToken cancellationToken)
    {
        var user = (await AccountsAsync(cancellationToken)).SingleOrDefault(u => u.Id == userId) ?? throw new NotFoundException("User", userId);
        return await sender.Send(new SetUserTabsCommand(user, request.Tabs is null ? null : CostingTabSet.Join(request.Tabs), UserClaims.NameOf(User)),
            cancellationToken);
    }

    private async Task<IReadOnlyList<UserAccountRef>> AccountsAsync(CancellationToken cancellationToken) =>
        (await users.GetAllAsync(cancellationToken)).Where(u => u.IsActive).Select(u => new UserAccountRef(u.Id, u.FullName, u.Role)).ToList();
}

public sealed record SetTabsRequest(IReadOnlyList<CostingTabs>? Tabs);

// Breakage (كسر) entered on Waste. Its void is asked through the approvals (module Breakage).
[ApiController]
[Route("api/costing/breakage")]
[Authorize(Policy = Permissions.InventoryManage)]
[CostingTab(CostingTabs.Waste)]
public sealed class BreakageController(ISender sender) : ControllerBase
{
    [HttpPost]
    public Task<BreakageEntryDto> Record(BreakageRequest request, CancellationToken cancellationToken) =>
        sender.Send(new RecordBreakageCommand(
            request.Id, request.Date, request.Description, request.Quantity, request.UnitCost, request.EmployeeId, request.Notes, UserClaims.NameOf(User)),
            cancellationToken);
}

public sealed record BreakageRequest(Guid Id, DateOnly Date, string Description, int Quantity, decimal? UnitCost, Guid? EmployeeId, string? Notes);

internal static class SheetFiles
{
    public const string ContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}
```


[الفصل التالي: المشتريات وتقفيل اليوم والمخزون →](05-purchases-end-of-day-and-inventory.md)
