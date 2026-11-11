# الفصل 02: تصميم قاعدة البيانات والكيانات

[← الفصل السابق](01-mindset-architecture-and-setup.md) · [الفهرس](00-index-and-build-roadmap.md) · [الفصل التالي: الهوية والصلاحيات والموافقات →](03-auth-permissions-and-approvals.md)

## 1. التفكير قبل الجداول

### 1.1 الـ Schemas

- **`costing`**: كل جداول العمل (الخامات، الوصفات، المخزون، المشتريات، الخزنة، تقفيل اليوم، الربط…).
- **`identity`**: المستخدمون فقط (`identity.Users`).

الفصل يسهّل الصلاحيات على مستوى قاعدة البيانات ويمنع تصادم الأسماء لو شارك نظام آخر نفس الخادم. وجدول تاريخ الـ migrations نفسه داخل `costing` (السبب في شرح الـ `DbContext`).

### 1.2 القواعد التي ستراها في كل جدول

| القاعدة | التطبيق | لماذا |
| --- | --- | --- |
| المفتاح `Guid` يصنعه الكود | `Entity.Id = Guid.NewGuid()` و `ValueGeneratedNever()` | Idempotency: "الـ till" (المتصفح) يصنع المعرّف، فإعادة الطلب لا تكرر |
| لا navigation بين الـ Aggregates | `HasOne<Supplier>().WithMany().HasForeignKey(...)` | حدود واضحة، لا تحميل بالخطأ |
| `Restrict` على المفاتيح الأجنبية | لا حذف متسلسل | دفاتر مالية: لا يُحذف مورد له فواتير |
| `Cascade` للأبناء فقط | بنود الفاتورة، بنود الجرد، مكونات الوصفة | الابن لا معنى له بدون أبيه |
| المال `(10,2)` افتراضيًا، والمبالغ الكبيرة `(18,2)` | `ConfigureConventions` | دقة عشرية حتمية |
| **الكميات `(18,3)`** و **تكلفة الوحدة `(18,6)`** | `IsQuantity()` و `IsUnitCost()` | الوصفة قد تطلب 2.5 جم، وتكلفة الجرام قد تكون 0.020833؛ تقريب المال لقرشين يمحوها |
| الـ enums بالاسم | `IsEnumName()` | قراءة بشرية، وثبات المعنى |
| التزامن على `xmin` | `IsRowVersion()` | تعديلان متزامنان ⇒ 409 لا ضياع صامت |
| لا حذف للسجل المالي | `Void`/`Archive` بدل `DELETE` | الأثر المحاسبي يبقى قابلًا للتدقيق |

### 1.3 دفتر المخزون (Stock Ledger): أهم جدول في النظام

`StockMovements`: كل سطر = حركة واحدة لخامة واحدة: الكمية (موجبة دخول، سالبة خروج)، تكلفة الوحدة **وقتها**، السبب (`Purchase`, `Sale`, `ProductionInput`, `ProductionOutput`, `Spoilage`, `CountAdjustment`, `OpeningStock`, …)، ومصدرها (`SourceId`: الفاتورة، البيع، أمر الإنتاج…).

- **لا يُعدَّل ولا يُحذف أبدًا.** الإلغاء = حركة عكسية (`ReversalOf`).
- **فهرس فريد `(SourceId, Reason, RawMaterialId, ReversalOf)` مع `NULLS NOT DISTINCT`** يمنع ترحيل نفس المصدر مرتين لنفس الخامة لنفس السبب، ويمنع عكس الحركة نفسها مرتين (Idempotency على مستوى قاعدة البيانات). `NULLS NOT DISTINCT` (PostgreSQL 15+) ضروري: بدونه تُعتبر كل قيمة `NULL` في `ReversalOf` مختلفة عن غيرها فيمر التكرار.
- **`QuantityOnHand` في الخامة = مجموع حركاتها** دائمًا، ويمكن إعادة بنائه منها.

### 1.4 خريطة الجداول

| السياق | الجداول (schema `costing`) |
| --- | --- |
| الشركة والإعدادات | `CompanySettings`, `CompanyLogos`, `CostingSettings`, `FinancialSettings`, `MonthlyExpenses`, `SharedCosts` |
| الكتالوج | `RawMaterials`, `PurchaseCategories`, `ExpenseItems`, `Suppliers` |
| الوصفات والإنتاج | `Recipes`, `RecipeIngredients`, `RecipeCategories`, `PrepRecipes`, `PrepRecipeIngredients`, `ProductionOrders`, `ProductionOrderLines` |
| المنيو والمبيعات | `MenuCategories`, `MenuItems`, `MenuItemVariants`, `AddOns`, `SalesReceipts`, `SalesReceiptLines`, `ManualSalesSheets`, `ManualSalesLines` |
| المخزون | `StockMovements`, `StockCounts`, `StockCountLines`, `BreakageEntries` |
| المشتريات | `PurchaseInvoices`, `PurchaseInvoiceLines`, `PurchaseInvoiceAttachments` |
| الخزنة | `SafeTransactions`, `SupplierLedgerEntries` |
| تقفيل اليوم | `EndOfDayReports`, `EndOfDayInvoices`, `EndOfDayPayouts`, `EndOfDayPhotos` |
| الموظفون | `Staff`, `PayrollRuns`, `PayrollRunDepartments`, `StaffDeductions`, `SyncedEmployees` |
| الصلاحيات والموافقات | `UserTabAccess`, `ApprovalRequests`, `identity.Users` |
| الربط | `PosLinks`, `PosZReports`, `PosDays`, `PosSyncLogs`, `HrLinks`, `HrOutbox`, `HrSyncLogs` |

> كيانات **الصلاحيات والموافقات** مشروحة في الفصل 03، و **الربط** (POS و HR) في الفصل 07، و **محركات التكلفة** (`RecipeCosts`, `MaterialExplosion`) في الفصل 04. هنا كل الكيانات الأخرى.

---

## 2. أساسيات الدومين

`Entity`: المعرّف يُصنع في الكود (السبب مكتوب في التعليق: حدث الدومين يحتاج المعرّف قبل الحفظ، والعقدة تعمل offline وقد تُدمج بياناتها لاحقًا). `AggregateRoot`: الوحدة التي تُحمَّل وتُحفظ ككل، ولها وحدها مستودع.

> 📄 **`backend/src/Costing.Domain/Common/Entity.cs`** — 10 سطر

```csharp
namespace Costing.Domain.Common;

public abstract class Entity
{
    // Generated here, not by a database identity column, for two reasons. A domain event
    // raised before SaveChanges has to name the rows it is about, and an identity column has
    // no value yet at that point. And this node runs offline: whatever it creates may later
    // be merged with the cloud or another branch, where an int sequence would collide.
    public Guid Id { get; protected init; } = Guid.NewGuid();
}
```


> 📄 **`backend/src/Costing.Domain/Common/AggregateRoot.cs`** — 14 سطر

```csharp
namespace Costing.Domain.Common;

// The unit that is loaded, changed and saved as a whole. Only aggregate roots get a
// repository, and only they raise domain events.
public abstract class AggregateRoot : Entity
{
    private readonly List<DomainEvent> _domainEvents = [];

    public IReadOnlyCollection<DomainEvent> DomainEvents => _domainEvents.AsReadOnly();

    public void ClearDomainEvents() => _domainEvents.Clear();

    protected void Raise(DomainEvent domainEvent) => _domainEvents.Add(domainEvent);
}
```


> 📄 **`backend/src/Costing.Domain/Common/DomainEvent.cs`** — 14 سطر

```csharp
namespace Costing.Domain.Common;

// Deliberately not MediatR's INotification. Infrastructure wraps each event when it
// publishes, so the dispatcher can be swapped without touching an entity.
//
// The setters are init rather than get-only so that an event read back from the outbox keeps
// the EventId it was written with. A get-only property would be regenerated on
// deserialisation, and handlers could no longer tell a redelivery from a new event.
public abstract record DomainEvent
{
    public Guid EventId { get; init; } = Guid.NewGuid();

    public DateTime OccurredAtUtc { get; init; } = DateTime.UtcNow;
}
```


الاستثناءات: `DomainException` (قاعدة عمل رفضت، رسالتها للمستخدم ⇐ 422)، و `NotFound`/`Forbidden`/`Conflict`، و `IRetryOnConflict` (أمر آمن لإعادة التنفيذ).

> 📄 **`backend/src/Costing.Domain/Common/DomainException.cs`** — 5 سطر

```csharp
namespace Costing.Domain.Common;

// A business rule refused the call. Messages are written to be shown to the user as they
// are; the API maps this type to a 4xx, never a 500.
public sealed class DomainException(string message) : Exception(message);
```


> 📄 **`backend/src/Costing.Domain/Common/ApplicationExceptions.cs`** — 23 سطر

```csharp
namespace Costing.Domain.Common;

// The exceptions use cases throw on purpose, one per status code the API answers with. Kept
// apart from DomainException (a business rule refused the change), so the API can tell "no
// such order" (404) from "not allowed" (403) from "someone got there first" (409).

public sealed class NotFoundException(string entityName, object id)
    : Exception($"{entityName} {id} was not found.");

// Allowed to call the endpoint, but not to do this to this record now. The message is shown to
// the user as it is.
public sealed class ForbiddenException(string message) : Exception(message);

// The save collided with another: someone changed the same record meanwhile, or a unique
// value already exists. Infrastructure translates the database's own exceptions into this.
public sealed class ConflictException(string message, Exception? innerException = null)
    : Exception(message, innerException);

// A request that may be run again from the start when its save collides with another: it is
// idempotent by an id of its own, and it reads everything it needs afresh. Stock entered by
// hand (a delivery, spoilage, a count posted) is: it can collide with the outbox taking a sale's
// stock from the same material, which the person entering it neither did nor can fix.
public interface IRetryOnConflict;
```


`IRepository<T>` مقيد بالجذور ولا `Remove` فيه افتراضيًا؛ و `IUnitOfWork`: كل تغييرات حالة الاستخدام في معاملة واحدة.

> 📄 **`backend/src/Costing.Domain/Common/IRepository.cs`** — 14 سطر

```csharp
namespace Costing.Domain.Common;

// Constrained to aggregate roots on purpose. There is no OrderItem repository: an item is
// loaded, changed and saved through its Order, which is what keeps the order's totals and
// status consistent with its items.
//
// No Remove here either. Orders, customers and stock movements are never deleted; the
// repositories that do allow it declare it themselves.
public interface IRepository<TAggregate> where TAggregate : AggregateRoot
{
    Task<TAggregate?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);

    void Add(TAggregate aggregate);
}
```


> 📄 **`backend/src/Costing.Domain/Common/IUnitOfWork.cs`** — 8 سطر

```csharp
namespace Costing.Domain.Common;

public interface IUnitOfWork
{
    // Saves every change made in the current use case in one transaction: an approval and what
    // it applies, an advance and its shares, are saved together or not at all.
    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);
}
```


## 3. الشركة

`CompanySettings`: صف واحد: الاسم، العملة وموضعها (`L.E 1,400.00` أو `1,400.00 SAR`)، الدولة، المنطقة الزمنية، **ساعة بداية اليوم التجاري** (مطعم يغلق 2 فجرًا: مبيعات 1:30 فجرًا تتبع "أمس"). و `MoneyFormat.Format` يكتب المال بنفس الطريقة في كل مكان.

> 📄 **`backend/src/Costing.Domain/Company/CompanySettings.cs`** — 172 سطر

```csharp
using System.Globalization;
using Costing.Domain.Common;

namespace Costing.Domain.Company;

// Where the company is.
public enum Country
{
    Egypt = 1,
    SaudiArabia = 2,
}

// Which side of an amount the currency is written on: "L.E 1,400.00" or "1,400.00 SAR".
public enum CurrencyPosition
{
    Before = 1,
    After = 2,
}

// An amount as the company writes it, wherever one is shown: the screens, the Excel sheets and
// the API's own messages alike. With no symbol, the number alone.
public sealed record MoneyFormat(string Symbol, CurrencyPosition Position)
{
    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

    public static MoneyFormat Plain { get; } = new(string.Empty, CurrencyPosition.Before);

    // "L.E 1,400.00"; whole amounts too: "L.E 100,000" with "N0".
    public string Format(decimal amount, string numberFormat = "N2")
    {
        var number = amount.ToString(numberFormat, Invariant);
        if (Symbol.Length == 0)
            return number;
        return Position == CurrencyPosition.Before ? $"{Symbol} {number}" : $"{number} {Symbol}";
    }
}

// The company this system runs for (إعدادات الشركة): one row, kept by a manager. Its name and logo,
// how money is written, the country, the time zone and the hour its business day starts (a night
// past midnight belongs to the evening's day: its sales, its takings, its waste). The time zone
// moves which day new sales and entries fall on from the moment it is saved.
public sealed class CompanySettings
{
    public const int SingletonId = 1;
    public const int MaxNameLength = 200;
    public const int MaxCurrencySymbolLength = 8;
    public const int MaxLogoFileNameLength = 200;
    public const int MaxLogoBytes = 1024 * 1024;

    // A logo is shown in the page: a picture, never an SVG, which could carry script.
    public static readonly IReadOnlySet<string> LogoTypes = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "image/png", "image/jpeg", "image/webp" };

    private CompanySettings() { }

    public CompanySettings(
        string name, string currencySymbol, CurrencyPosition currencyPosition, Country country, string timeZoneId, int workdayStartsAtHour)
    {
        Update(name, currencySymbol, currencyPosition, country, timeZoneId, workdayStartsAtHour, updatedBy: null);
    }

    public int Id { get; private init; } = SingletonId;
    public string Name { get; private set; } = string.Empty;
    public string CurrencySymbol { get; private set; } = string.Empty;
    public CurrencyPosition CurrencyPosition { get; private set; } = CurrencyPosition.Before;
    public Country Country { get; private set; } = Country.Egypt;
    // IANA id, as the server's own clock knows it: "Africa/Cairo", "Asia/Riyadh".
    public string TimeZoneId { get; private set; } = string.Empty;
    public int WorkdayStartsAtHour { get; private set; }
    public string? LogoFileName { get; private set; }
    public string? LogoContentType { get; private set; }
    public int? LogoBytes { get; private set; }
    public DateTime? LogoUpdatedAtUtc { get; private set; }
    public string? UpdatedBy { get; private set; }
    public DateTime? UpdatedAtUtc { get; private set; }

    public bool HasLogo => LogoFileName is not null;

    public MoneyFormat Money => new(CurrencySymbol, CurrencyPosition);

    public void Update(
        string name, string currencySymbol, CurrencyPosition currencyPosition, Country country, string timeZoneId, int workdayStartsAtHour,
        string? updatedBy)
    {
        var trimmedName = name?.Trim() ?? string.Empty;
        if (trimmedName.Length is 0 or > MaxNameLength)
            throw new DomainException($"Enter the company's name: {MaxNameLength} characters at most.");
        var symbol = currencySymbol?.Trim() ?? string.Empty;
        if (symbol.Length > MaxCurrencySymbolLength)
            throw new DomainException($"Keep the currency symbol to {MaxCurrencySymbolLength} characters: L.E, $, SAR.");
        if (!Enum.IsDefined(currencyPosition))
            throw new DomainException("Choose whether the currency goes before the amount or after it.");
        if (!Enum.IsDefined(country))
            throw new DomainException("Choose the country: Egypt or Saudi Arabia.");
        var zone = timeZoneId?.Trim() ?? string.Empty;
        if (!IsTimeZone(zone))
            throw new DomainException($"\"{zone}\" is not a time zone this server knows: choose one from the list.");
        if (workdayStartsAtHour is < 0 or > 12)
            throw new DomainException("The business day starts between midnight (0) and noon (12).");

        Name = trimmedName;
        CurrencySymbol = symbol;
        CurrencyPosition = currencyPosition;
        Country = country;
        TimeZoneId = zone;
        WorkdayStartsAtHour = workdayStartsAtHour;
        if (updatedBy is not null)
        {
            UpdatedBy = updatedBy;
            UpdatedAtUtc = DateTime.UtcNow;
        }
    }

    // A PNG, JPEG or WebP of up to a megabyte, replacing the one there was.
    public void AttachLogo(string fileName, string contentType, int bytes, string updatedBy)
    {
        if (!LogoTypes.Contains(contentType))
            throw new DomainException("A logo is a PNG, JPEG or WebP picture.");
        if (bytes is <= 0 or > MaxLogoBytes)
            throw new DomainException("A logo is a megabyte at most: save a smaller picture.");
        var name = Path.GetFileName(fileName?.Trim() ?? string.Empty);
        LogoFileName = name.Length is > 0 and <= MaxLogoFileNameLength ? name : "logo";
        LogoContentType = contentType.ToLowerInvariant();
        LogoBytes = bytes;
        LogoUpdatedAtUtc = DateTime.UtcNow;
        UpdatedBy = updatedBy;
        UpdatedAtUtc = LogoUpdatedAtUtc;
    }

    public void RemoveLogo(string updatedBy)
    {
        LogoFileName = null;
        LogoContentType = null;
        LogoBytes = null;
        LogoUpdatedAtUtc = DateTime.UtcNow;
        UpdatedBy = updatedBy;
        UpdatedAtUtc = LogoUpdatedAtUtc;
    }

    public static bool IsTimeZone(string timeZoneId)
    {
        if (timeZoneId.Length == 0)
            return false;
        try
        {
            TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);
            return true;
        }
        catch (TimeZoneNotFoundException)
        {
            return false;
        }
        catch (InvalidTimeZoneException)
        {
            return false;
        }
    }
}

// The company's settings, one row, and its logo's bytes apart from it (so reading the settings
// never loads the picture). Tracked: changed and saved in the same unit of work.
public interface ICompanySettingsStore
{
    // None until the first start has made it.
    Task<CompanySettings?> GetAsync(CancellationToken cancellationToken = default);

    void Add(CompanySettings settings);

    // Replaces the logo there was; null takes it off.
    Task PutLogoAsync(byte[]? content, CancellationToken cancellationToken = default);

    Task<byte[]?> GetLogoAsync(CancellationToken cancellationToken = default);
}
```


## 4. الكتالوج

### 4.1 الوحدات: `UnitOfMeasure`

**وحدات أساسية فقط**: جرام، مللي، قطعة. شحنة 5 كجم تُسجل 5000 جم. لماذا؟ حتى لا تختلف الوصفة والفاتورة والجرد أبدًا على معنى "1".

> 📄 **`backend/src/Costing.Domain/RawMaterials/UnitOfMeasure.cs`** — 10 سطر

```csharp
namespace Costing.Domain.RawMaterials;

// Base units only. A 5 kg delivery is booked as 5000 g, so a recipe, a delivery and a stock
// count can never disagree about what "1" means.
public enum UnitOfMeasure
{
    Gram = 1,
    Millilitre = 2,
    Piece = 3,
}
```


### 4.2 الخامة: `RawMaterial` (قلب المحاسبة)

اقرأ هذا الكيان ببطء؛ فيه أهم معادلات النظام (وشرحها التفصيلي في الفصل 04):

- **`Kind`**: خامة مشتراة (`Purchased`) أو مصنّع (`Prep`).
- **`Unit`** (الوحدة الأساسية) و **`PurchaseUnit` + `PurchaseUnitSize`**: "تُشترى بالكيلو = 1000 جم"، "كرتونة = 24 قطعة".
- **`AverageCost`**: متوسط تكلفة **الوحدة الأساسية** (الجرام)؛ يُخزَّن بدقة عالية، `null` = لا سعر بعد.
- **`DefaultYieldPercent`**: نسبة الصافي الافتراضية (0 < Yield ≤ 100).
- **`QuantityOnHand`**: الرصيد = مجموع الحركات.
- **`ReorderLevel`**: حد إعادة الطلب.
- **`AverageWith(quantity, unitCost)`**: المتوسط المرجح المتحرك:
  ```text
  المتوسط الجديد = (max(الرصيد,0) × المتوسط + الكمية × السعر) ÷ (max(الرصيد,0) + الكمية)
  ```
  والرصيد السالب يُعامل كصفر ("لا يوجد ما نخلطه").
- **`UnaverageWith`**: عند إلغاء فاتورة، يُخرج سعرها من المتوسط "بقدر ما يحتمل المتبقي".
- **`OpenStock`**: الجرد الافتتاحي: يضبط الرصيد **كبداية** لا كفرق، ويعطي المصنّع الذي لم يُنتج قط تكلفة وصفته.
- **`Count`**: الجرد الدوري: الفرق يصبح حركة `CountAdjustment`.
- **المخزون يُسمح أن يصبح سالبًا**: البيع حدث فعلًا؛ رفض الخصم لن "يلغي البيع" بل سيضيّع السجل. الرصيد السالب **إشارة**: فاتورة لم تُسجل أو وصفة خاطئة، والجرد يصححه.
- **`Archive`**: لا حذف؛ أرشفة فقط ورصيده صفر، حتى لا تختفي قيمته من الدفاتر.

> 📄 **`backend/src/Costing.Domain/RawMaterials/RawMaterial.cs`** — 329 سطر

```csharp
using Costing.Domain.Common;
using Costing.Domain.StockMovements;

namespace Costing.Domain.RawMaterials;

public enum MaterialKind
{
    // Bought from a supplier, on purchase invoices.
    Purchased = 1,

    // Made in the kitchen from other materials, by a production order: dough, a house sauce. Kept
    // in stock, costed and counted like the rest; dishes use it as an ingredient.
    Prep = 2,
}

public sealed class RawMaterial : AggregateRoot
{
    private RawMaterial() { }

    // id: one given beforehand, as a prep item asked for and approved later takes its request's.
    public RawMaterial(string name, UnitOfMeasure unit, decimal reorderLevel = 0, MaterialKind kind = MaterialKind.Purchased, Guid? id = null)
    {
        if (id is { } given)
            Id = given;
        Rename(name);
        Unit = unit;
        Kind = kind;
        SetReorderLevel(reorderLevel);
        (PurchaseUnit, PurchaseUnitSize) = DefaultPurchaseUnit(unit);
    }

    // How a unit is bought to begin with: grams by the kg, millilitres by the litre, pieces one by one.
    public static (string Name, decimal Size) DefaultPurchaseUnit(UnitOfMeasure unit) => unit switch
    {
        UnitOfMeasure.Gram => ("kg", 1000m),
        UnitOfMeasure.Millilitre => ("L", 1000m),
        _ => ("piece", 1m),
    };

    public string Name { get; private set; } = string.Empty;
    public UnitOfMeasure Unit { get; private set; }
    public MaterialKind Kind { get; private set; } = MaterialKind.Purchased;
    public bool IsPrepItem => Kind == MaterialKind.Prep;

    // Can go negative; see Move.
    public decimal QuantityOnHand { get; private set; }

    public decimal ReorderLevel { get; private set; }
    public bool NeedsReorder => QuantityOnHand <= ReorderLevel;

    // How the reports name it: ING-001. Optional.
    public string? Code { get; private set; }

    // The purchase category it is filed under (Dairy, Meat): the count sheet and the reports
    // group by it, and purchases are added up by it. Every material has one; General until sorted.
    public Guid CategoryId { get; private set; }

    // How it is bought, and so how its price is written: per kg (1000 g), per carton of 30 eggs
    // (30 pieces). Stock, recipes and the ledger stay in Unit; this is only for prices.
    public string PurchaseUnit { get; private set; } = string.Empty;
    public decimal PurchaseUnitSize { get; private set; } = 1;

    // The As Purchased (AP) cost of one Unit (a gram, a millilitre, a piece), averaged over what
    // was bought, weighted by quantity. Null until it has a price. Each stock movement records the
    // cost at its moment, so a month's costs do not change when later prices do.
    public decimal? AverageCost { get; private set; }

    // The share left after trimming, for a recipe line that does not say: 85 for peppers,
    // 98 for eggs. Each recipe line keeps its own.
    public decimal DefaultYieldPercent { get; private set; } = 100;

    // AverageCost per purchase unit, as prices are written: 360 a kg rather than 0.36 a gram.
    public decimal? CostPerPurchaseUnit => AverageCost * PurchaseUnitSize;

    public void Rename(string name)
    {
        if (string.IsNullOrWhiteSpace(name))
            throw new DomainException("Raw material name is required.");
        Name = name.Trim();
    }

    public void SetReorderLevel(decimal reorderLevel)
    {
        if (reorderLevel < 0)
            throw new DomainException("Reorder level cannot be negative.");
        ReorderLevel = reorderLevel;
    }

    public void Describe(string? code, Guid categoryId)
    {
        Code = string.IsNullOrWhiteSpace(code) ? null : code.Trim();
        MoveTo(categoryId);
    }

    public void MoveTo(Guid categoryId)
    {
        if (categoryId == Guid.Empty)
            throw new DomainException("Choose the material's category.");
        CategoryId = categoryId;
    }

    public void SetPurchaseUnit(string name, decimal size)
    {
        if (string.IsNullOrWhiteSpace(name))
            throw new DomainException("Name the unit it is bought in, such as kg or carton.");
        if (size <= 0)
            throw new DomainException("The unit it is bought in must hold more than zero.");
        PurchaseUnit = name.Trim();
        PurchaseUnitSize = size;
    }

    public void SetDefaultYield(decimal percent) => DefaultYieldPercent = ValidYield(percent);

    // Counted in another unit (عدّ بـ). While nothing records it, simply: it starts again in the new
    // unit, bought as that unit is, its price and reorder level to be given again. Once something
    // does, oneNewIsOld says how many of the old unit one of the new is (60 g a piece), and what it
    // holds is restated in the new: on hand, the reorder level and the unit it is bought in divided
    // by it, the average cost multiplied, so its value is as it was. Every record naming it (the
    // ledger, invoices, recipes, counts, batches) is restated by the caller, in the same transaction.
    public void ChangeUnit(UnitOfMeasure unit, decimal? oneNewIsOld)
    {
        if (!Enum.IsDefined(unit))
            throw new DomainException("Choose the unit it is counted in.");
        if (IsPrepItem)
            throw new DomainException($"{Name} is a prep item, kept in its unit: add a new prep item for another unit.");
        if (unit == Unit)
            throw new DomainException($"{Name} is counted in that unit already.");
        if (oneNewIsOld is { } ratio)
        {
            if (ratio <= 0)
                throw new DomainException("Say how many of the old unit one of the new is: more than nothing.");
            QuantityOnHand = Math.Round(QuantityOnHand / ratio, 3, MidpointRounding.AwayFromZero);
            ReorderLevel = Math.Round(ReorderLevel / ratio, 3, MidpointRounding.AwayFromZero);
            PurchaseUnitSize = Math.Round(PurchaseUnitSize / ratio, 3, MidpointRounding.AwayFromZero);
            AverageCost = AverageCost is { } cost ? Math.Round(cost * ratio, 6, MidpointRounding.AwayFromZero) : null;
        }
        else
        {
            if (QuantityOnHand != 0)
                throw new DomainException($"{Name} has stock: say how many of the old unit one of the new is.");
            (PurchaseUnit, PurchaseUnitSize) = DefaultPurchaseUnit(unit);
            AverageCost = null;
            ReorderLevel = 0;
        }

        Unit = unit;
    }

    // The price to start from, per purchase unit: for stock already on the shelf when costing
    // starts, or a price agreed before any delivery. Purchases with prices move it from there.
    public void SetCost(decimal costPerPurchaseUnit)
    {
        if (costPerPurchaseUnit < 0)
            throw new DomainException("A cost cannot be negative.");
        AverageCost = costPerPurchaseUnit / PurchaseUnitSize;
    }

    public static decimal ValidYield(decimal percent) =>
        percent is > 0 and <= 100 ? percent : throw new DomainException("Yield is more than 0% and at most 100%.");

    // Each method below changes QuantityOnHand and returns the ledger entry that explains the
    // change. The caller adds it to IStockMovementRepository in the same unit of work.
    // StockMovement has no public constructor, so every entry in the ledger was produced here.

    public StockMovement RecordSale(decimal quantity, Guid orderItemId) =>
        Move(-Positive(quantity), StockMovementReason.Sale, orderItemId, AverageCost);

    public StockMovement RecordWaste(decimal quantity, Guid orderItemId) =>
        Move(-Positive(quantity), StockMovementReason.Waste, orderItemId, AverageCost);

    public StockMovement RecordVoidReturn(decimal quantity, Guid orderItemId) =>
        Move(Positive(quantity), StockMovementReason.VoidReturn, orderItemId, AverageCost);

    // lineCost: what this line of the delivery cost in all, when the invoice is entered. It moves
    // the average cost, weighted by quantity against what is on the shelf; stock below zero
    // counts as none, since nothing is left to average with.
    public StockMovement ReceivePurchase(decimal quantity, Guid purchaseId, decimal? lineCost = null)
    {
        if (IsPrepItem)
            throw new DomainException($"{Name} is made in the kitchen, not bought: make it with a production order.");
        Positive(quantity);
        if (lineCost is not { } cost)
            return Move(quantity, StockMovementReason.Purchase, purchaseId, AverageCost);
        if (cost < 0)
            throw new DomainException("A purchase cannot cost less than nothing.");

        var unitCost = cost / quantity;
        AverageWith(quantity, unitCost);
        return Move(quantity, StockMovementReason.Purchase, purchaseId, unitCost);
    }

    // Taken to make a prep item, at the average cost now: what it adds to the batch's cost.
    public StockMovement UseInProduction(decimal quantity, Guid productionOrderId) =>
        Move(-Positive(quantity), StockMovementReason.ProductionInput, productionOrderId, AverageCost);

    // A batch of this prep item made. batchCost is what its ingredients cost; it moves the
    // average exactly as a delivery's price moves a bought material's.
    public StockMovement ReceiveProduction(decimal quantity, Guid productionOrderId, decimal batchCost)
    {
        if (!IsPrepItem)
            throw new DomainException($"{Name} is bought, not made: it comes in on a purchase invoice.");
        Positive(quantity);
        if (batchCost < 0)
            throw new DomainException("A batch cannot cost less than nothing.");

        var unitCost = batchCost / quantity;
        AverageWith(quantity, unitCost);
        return Move(quantity, StockMovementReason.ProductionOutput, productionOrderId, unitCost);
    }

    // Stock thrown away before it reached a dish. Why is required: the variance report sets it
    // against the shortfall, and "expired" and "dropped" call for different fixes.
    public StockMovement RecordSpoilage(decimal quantity, Guid spoilageId, string reason, string recordedBy)
    {
        if (string.IsNullOrWhiteSpace(reason))
            throw new DomainException("Say why it was thrown away.");
        if (reason.Trim().Length > 200)
            throw new DomainException("Keep the reason under 200 characters.");
        return Move(-Positive(quantity), StockMovementReason.Spoilage, spoilageId, AverageCost, reason.Trim(), recordedBy);
    }

    public StockMovement AdjustToCount(decimal countedQuantity, Guid stockCountId)
    {
        if (countedQuantity < 0)
            throw new DomainException("A counted quantity cannot be negative.");
        return Move(countedQuantity - QuantityOnHand, StockMovementReason.CountAdjustment, stockCountId, AverageCost);
    }

    // Its stock as found when costing starts (جرد افتتاحي): set to what was counted, at the cost it
    // has, as where its stock begins rather than a difference. One with no cost of its own yet (a
    // prep item never made) is valued at unitCost, its recipe's today, from then on.
    public StockMovement OpenStock(decimal countedQuantity, Guid stockCountId, decimal? unitCost = null)
    {
        if (countedQuantity < 0)
            throw new DomainException("A counted quantity cannot be negative.");
        if (unitCost is { } cost && (AverageCost ?? 0) == 0)
        {
            if (cost < 0)
                throw new DomainException("A cost cannot be negative.");
            AverageCost = cost;
        }
        return Move(countedQuantity - QuantityOnHand, StockMovementReason.OpeningStock, stockCountId, AverageCost);
    }

    // Weighted by quantity against what is on the shelf; stock below zero counts as none, since
    // nothing is left to average with.
    private void AverageWith(decimal quantity, decimal unitCost)
    {
        var onShelf = Math.Max(QuantityOnHand, 0);
        AverageCost = AverageCost is { } average && onShelf > 0
            ? (onShelf * average + quantity * unitCost) / (onShelf + quantity)
            : unitCost;
    }

    // Stock is allowed to go negative. Deduction runs after the sale has already happened, so
    // refusing it would not un-sell the dish; it would only lose the record. A negative
    // balance is the signal that a delivery was never booked in or a recipe quantity is wrong,
    // and a stock count puts it right.
    // Undoes one of this material's ledger entries, for a voided purchase, waste entry, stock
    // count or production order: the opposite quantity at the unit cost it had, entered now. A
    // purchase or a batch taken back out also takes its price out of the average, as far as the
    // stock left can carry it.
    public StockMovement Reverse(StockMovement original, string reversedBy)
    {
        if (original.RawMaterialId != Id)
            throw new DomainException("That entry belongs to another material.");
        if (original.IsReversal)
            throw new DomainException("A reversal is not reversed again.");

        if (original.Reason is StockMovementReason.Purchase or StockMovementReason.ProductionOutput && original.Quantity > 0)
            UnaverageWith(original.Quantity, original.UnitCost);
        return Move(-original.Quantity, original.Reason, original.SourceId, original.UnitCost, "Voided", reversedBy, original.Id);
    }

    // The average as if `quantity` bought at `unitCost` had never come in: the value of the
    // stock on the shelf less theirs, over what is left. With nothing left, or the delivery
    // already used up past knowing what it cost, the average stays where it is.
    private void UnaverageWith(decimal quantity, decimal? unitCost)
    {
        if (AverageCost is not { } average || unitCost is not { } cost)
            return;
        var left = QuantityOnHand - quantity;
        if (left <= 0)
            return;
        var value = Math.Max(QuantityOnHand, 0) * average - quantity * cost;
        if (value >= 0)
            AverageCost = value / left;
    }

    // Taken off the lists: no new purchases, recipes or counts name it. Kept, with its ledger,
    // for the invoices, counts and reports that already do. Only with no stock on hand, so its
    // value never goes off the books unseen.
    public bool IsArchived => ArchivedAtUtc is not null;
    public DateTime? ArchivedAtUtc { get; private set; }
    public string? ArchivedBy { get; private set; }

    public void Archive(string archivedBy)
    {
        if (IsArchived)
            return;
        if (QuantityOnHand != 0)
            throw new DomainException(
                $"{Name} still has stock on hand. Count it to zero or record its waste first, so its value is not lost from the books.");
        ArchivedAtUtc = DateTime.UtcNow;
        ArchivedBy = archivedBy;
    }

    // Never stock after all: bought as an expense, and filed as a raw material by mistake. Its
    // purchases are restated as expense lines and its ledger taken out by the caller, so nothing
    // is on hand; archived, it stays only for what names it.
    public void ConvertToExpense(string convertedBy)
    {
        if (IsPrepItem)
            throw new DomainException($"{Name} is a prep item, made in the kitchen: it cannot be an expense.");
        QuantityOnHand = 0;
        Archive(convertedBy);
    }

    private StockMovement Move(
        decimal delta, StockMovementReason reason, Guid sourceId, decimal? unitCost, string? note = null, string? recordedBy = null,
        Guid? reversalOf = null)
    {
        QuantityOnHand += delta;
        return new StockMovement(Id, delta, reason, sourceId, unitCost, note, recordedBy, reversalOf);
    }

    private static decimal Positive(decimal quantity) =>
        quantity > 0 ? quantity : throw new DomainException("Quantity must be greater than zero.");
}
```


> 📄 **`backend/src/Costing.Domain/RawMaterials/IRawMaterialRepository.cs`** — 13 سطر

```csharp
using Costing.Domain.Common;

namespace Costing.Domain.RawMaterials;

public interface IRawMaterialRepository : IRepository<RawMaterial>
{
    Task<IReadOnlyList<RawMaterial>> GetAllAsync(CancellationToken cancellationToken = default);

    // One round trip for every material an order touches, rather than one per ingredient.
    Task<IReadOnlyList<RawMaterial>> GetByIdsAsync(IEnumerable<Guid> ids, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<RawMaterial>> GetNeedingReorderAsync(CancellationToken cancellationToken = default);
}
```


### 4.3 الفئات والمصروفات والموردون

`PurchaseCategory`: فئة الشراء ونوعها (خامات أو مصروفات)، و **`ExpenseLine`**: أين تُحسب مصروفاتها في قائمة الدخل (أجور، مصروفات قابلة للتحكم، إشغال، …). المخزون المشترى لا يُحسب مصروفًا هنا: يصبح تكلفة مبيعات حين تستهلكه الوصفات.

> 📄 **`backend/src/Costing.Domain/Categories/PurchaseCategory.cs`** — 139 سطر

```csharp
using Costing.Domain.Common;

namespace Costing.Domain.Categories;

// Where an expense filed under the category counts in the profit and loss. Stock bought under it
// counts nowhere here: it is cost of sales once the recipes use it.
public enum ExpenseLine
{
    // Utilities, cleaning, maintenance, marketing: costs the manager can bring down.
    Controllable = 1,

    // Rent and what comes with the premises.
    Occupation = 2,

    // Other costs that do not move with sales: insurance, licences, loan repayments.
    OtherFixed = 3,

    // Salaries and what comes with them, paid as expenses (a voucher from the safe): added to the
    // month's wages and benefits.
    Wages = 4,
}

// What a category files: raw materials (stock: bought, counted, used in recipes) or general
// expenses (bought, never stock). A raw material goes in one of the first, an expense item in one
// of the second.
public enum CategoryKind
{
    RawMaterials = 1,
    Expenses = 2,
}

// What the restaurant buys, grouped (Meat, Dairy, Packaging for raw materials; Cleaning,
// Utilities, Rent for expenses): every raw material is in one of its kind, and so is every
// expense item, so purchases can be added up by category. Its id is made by the till, so a
// retried save adds it once. Each kind has its General, for anything not yet sorted: always
// there, never deleted, and never the other kind.
public sealed class PurchaseCategory : AggregateRoot
{
    public static readonly Guid GeneralId = new("3f3f4d50-4158-44c8-bb35-e3dd347717ea");
    public const string GeneralName = "General";
    public const string GeneralNameAr = "عام";

    public static readonly Guid GeneralExpensesId = new("8c2d3b6e-1f4a-4c55-9e1d-6a7b0f2e9c41");
    public const string GeneralExpensesName = "General expenses";
    public const string GeneralExpensesNameAr = "مصروفات عامة";

    private PurchaseCategory() { }

    public PurchaseCategory(
        Guid id, string name, string? nameAr = null, ExpenseLine expenseLine = ExpenseLine.Controllable, CategoryKind kind = CategoryKind.RawMaterials)
    {
        if (!Enum.IsDefined(kind))
            throw new DomainException("Say whether the category is for raw materials or general expenses.");
        Id = id;
        Kind = kind;
        CreatedAtUtc = DateTime.UtcNow;
        Update(name, nameAr, expenseLine);
    }

    public static PurchaseCategory General() => new(GeneralId, GeneralName, GeneralNameAr);

    public static PurchaseCategory GeneralExpenses() => new(GeneralExpensesId, GeneralExpensesName, GeneralExpensesNameAr, kind: CategoryKind.Expenses);

    // Where something of that kind goes when no category is chosen.
    public static Guid DefaultOf(CategoryKind kind) => kind == CategoryKind.Expenses ? GeneralExpensesId : GeneralId;

    public string Name { get; private set; } = string.Empty;

    // The name as compared: capitals and extra spaces ignored, so "dry  goods" is Dry goods.
    public string NormalizedName { get; private set; } = string.Empty;

    public string? NameAr { get; private set; }
    public ExpenseLine ExpenseLine { get; private set; } = ExpenseLine.Controllable;
    public CategoryKind Kind { get; private set; } = CategoryKind.RawMaterials;
    public DateTime CreatedAtUtc { get; private set; }

    // The General of its kind.
    public bool IsGeneral => Id == GeneralId || Id == GeneralExpensesId;

    public void Update(string name, string? nameAr, ExpenseLine expenseLine)
    {
        var clean = Collapse(name ?? string.Empty);
        if (clean.Length == 0)
            throw new DomainException("Give the category a name.");
        var cleanAr = string.IsNullOrWhiteSpace(nameAr) ? null : Collapse(nameAr);
        if (clean.Length > 100 || cleanAr?.Length > 100)
            throw new DomainException("Keep the category's name under 100 characters.");
        if (!Enum.IsDefined(expenseLine))
            throw new DomainException("Choose where its expenses count.");

        Name = clean;
        NormalizedName = Normalize(clean);
        NameAr = cleanAr;
        ExpenseLine = expenseLine;
    }

    // For the other kind: only while nothing of the other kind is filed under it (holdingOther: its
    // raw materials or expense items in use), so nothing is left in a category not its own. A
    // General stays the kind it is.
    public void ChangeKind(CategoryKind kind, int holdingOther)
    {
        if (!Enum.IsDefined(kind))
            throw new DomainException("Say whether the category is for raw materials or general expenses.");
        if (kind == Kind)
            return;
        if (IsGeneral)
            throw new DomainException($"{Name} is where anything not yet sorted goes: it stays {(Kind == CategoryKind.Expenses ? "general expenses" : "raw materials")}.");
        if (holdingOther > 0)
            throw new DomainException(
                Kind == CategoryKind.RawMaterials
                    ? $"{Name} holds {holdingOther} raw {(holdingOther == 1 ? "material" : "materials")}: move them to a raw materials category, or delete {Name} and convert them, first."
                    : $"{Name} holds {holdingOther} expense {(holdingOther == 1 ? "item" : "items")}: move them to a general expenses category, or delete {Name} and convert them, first.");
        Kind = kind;
    }

    public static string Normalize(string name) => Collapse(name).ToUpperInvariant();

    private static string Collapse(string name) => string.Join(' ', name.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
}

// How many raw materials and expense items are filed under a category, archived ones too; and of
// them, the ones in use.
public sealed record PurchaseCategoryUse(int Materials, int ExpenseItems, int ActiveMaterials = 0, int ActiveExpenseItems = 0)
{
    // In use, and of the kind the category is not: filed there before the kinds were kept apart.
    public int Misplaced(CategoryKind kind) => kind == CategoryKind.RawMaterials ? ActiveExpenseItems : ActiveMaterials;
}

public interface IPurchaseCategoryRepository : IRepository<PurchaseCategory>
{
    Task<IReadOnlyList<PurchaseCategory>> GetAllAsync(CancellationToken cancellationToken = default);

    Task<PurchaseCategory?> GetByNormalizedNameAsync(string normalizedName, CancellationToken cancellationToken = default);

    Task<IReadOnlyDictionary<Guid, PurchaseCategoryUse>> GetUseAsync(CancellationToken cancellationToken = default);

    // Only once nothing is filed under it, and never a General.
    void Remove(PurchaseCategory category);
}
```


`ExpenseItem`: ما يُشترى ولا يُخزَّن (منظفات، صيانة، كهرباء): يظهر في الفاتورة بجانب الخامات، لكنه لا يدخل المخزون ولا الوصفات أبدًا؛ تكلفته مصروف تحت فئته.

> 📄 **`backend/src/Costing.Domain/Expenses/ExpenseItem.cs`** — 95 سطر

```csharp
using Costing.Domain.Common;

namespace Costing.Domain.Expenses;

// Something bought that is not stock: cleaning supplies, a repair, the electricity bill. It goes
// on purchase invoices beside the raw materials, but is never counted, never in a recipe and
// never in the stock ledger: posting an invoice only records what it cost, under its category,
// for the profit and loss. Kept apart from the raw materials so it cannot reach those screens.
//
// One on an invoice is never removed, only archived, as a supplier is. Its id is made by the app.
// Not stock.
public sealed class ExpenseItem : AggregateRoot
{
    private ExpenseItem() { }

    public ExpenseItem(Guid id, string name, Guid categoryId, string? nameAr = null, string? unit = null)
    {
        Id = id;
        CreatedAtUtc = DateTime.UtcNow;
        Update(name, categoryId, nameAr, unit);
    }

    public string Name { get; private set; } = string.Empty;

    // The name as compared: capitals and extra spaces ignored.
    public string NormalizedName { get; private set; } = string.Empty;

    public string? NameAr { get; private set; }
    public Guid CategoryId { get; private set; }

    // What a line of it is usually counted in (bottle, visit, month), for the invoice to start
    // from. None: a line is just its amount.
    public string? Unit { get; private set; }

    public bool IsArchived { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime? ArchivedAtUtc { get; private set; }

    public void Update(string name, Guid categoryId, string? nameAr, string? unit)
    {
        var clean = Collapse(name ?? string.Empty);
        if (clean.Length == 0)
            throw new DomainException("Give the expense a name.");
        if (clean.Length > 200 || (nameAr is not null && Collapse(nameAr).Length > 200))
            throw new DomainException("Keep the expense's name under 200 characters.");
        if (unit?.Trim().Length > 32)
            throw new DomainException("Keep the unit under 32 characters.");

        Name = clean;
        NormalizedName = Normalize(clean);
        NameAr = string.IsNullOrWhiteSpace(nameAr) ? null : Collapse(nameAr);
        Unit = string.IsNullOrWhiteSpace(unit) ? null : unit.Trim();
        MoveTo(categoryId);
    }

    public void MoveTo(Guid categoryId)
    {
        if (categoryId == Guid.Empty)
            throw new DomainException("Choose the expense's category.");
        CategoryId = categoryId;
    }

    // Off the list new invoices pick from; on the invoices it is already on.
    public void Archive()
    {
        if (IsArchived)
            return;
        IsArchived = true;
        ArchivedAtUtc = DateTime.UtcNow;
    }

    public void Restore()
    {
        IsArchived = false;
        ArchivedAtUtc = null;
    }

    public static string Normalize(string name) => Collapse(name).ToUpperInvariant();

    private static string Collapse(string name) => string.Join(' ', name.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
}

public interface IExpenseItemRepository : IRepository<ExpenseItem>
{
    Task<IReadOnlyList<ExpenseItem>> GetAllAsync(CancellationToken cancellationToken = default);

    Task<IReadOnlyList<ExpenseItem>> GetByIdsAsync(IReadOnlyCollection<Guid> ids, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<ExpenseItem>> GetInCategoryAsync(Guid categoryId, CancellationToken cancellationToken = default);

    Task<ExpenseItem?> GetByNormalizedNameAsync(string normalizedName, CancellationToken cancellationToken = default);

    // Only one that is on no invoice.
    void Remove(ExpenseItem item);
}
```


`Supplier`: مورد عليه فواتير لا يُحذف بل يُؤرشف.

> 📄 **`backend/src/Costing.Domain/Suppliers/Supplier.cs`** — 89 سطر

```csharp
using Costing.Domain.Common;

namespace Costing.Domain.Suppliers;

// Who the restaurant buys from: the name the invoices are filed under, and how to reach them.
// A supplier on an invoice is never removed, only archived: it leaves the list new invoices pick
// from, and the invoices it is on keep showing it. One never invoiced can go entirely.
//
// Its id is made by the till, so a retried save adds the supplier once.
public sealed class Supplier : AggregateRoot
{
    private Supplier() { }

    public Supplier(Guid id, SupplierDetails details)
    {
        Id = id;
        CreatedAtUtc = DateTime.UtcNow;
        Update(details);
    }

    public string Name { get; private set; } = string.Empty;

    // The name as compared: capitals and extra spaces ignored, so "Nile  farms" is Nile Farms.
    public string NormalizedName { get; private set; } = string.Empty;

    public string? ContactPerson { get; private set; }
    public string? Phone { get; private set; }
    public string? Email { get; private set; }
    public string? Notes { get; private set; }

    public bool IsArchived { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime? ArchivedAtUtc { get; private set; }

    public void Update(SupplierDetails details)
    {
        var name = Clean(details.Name) ?? throw new DomainException("Give the supplier a name.");
        if (name.Length > 200)
            throw new DomainException("Keep the supplier's name under 200 characters.");
        if (Clean(details.ContactPerson)?.Length > 200 || Clean(details.Email)?.Length > 200)
            throw new DomainException("Keep the contact's name and email under 200 characters.");
        if (Clean(details.Phone)?.Length > 32)
            throw new DomainException("Keep the phone number under 32 characters.");
        if (Clean(details.Notes)?.Length > 500)
            throw new DomainException("Keep the notes under 500 characters.");
        if (Clean(details.Email) is { } email && !email.Contains('@'))
            throw new DomainException("That email address is missing its @.");

        Name = Collapse(name);
        NormalizedName = Normalize(name);
        ContactPerson = Clean(details.ContactPerson);
        Phone = Clean(details.Phone);
        Email = Clean(details.Email);
        Notes = Clean(details.Notes);
    }

    // Off the list new invoices pick from; on the invoices it is already on.
    public void Archive()
    {
        if (IsArchived)
            return;
        IsArchived = true;
        ArchivedAtUtc = DateTime.UtcNow;
    }

    public void Restore()
    {
        IsArchived = false;
        ArchivedAtUtc = null;
    }

    public static string Normalize(string name) => Collapse(name).ToUpperInvariant();

    private static string Collapse(string name) => string.Join(' ', name.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}

public sealed record SupplierDetails(string Name, string? ContactPerson = null, string? Phone = null, string? Email = null, string? Notes = null);

public interface ISupplierRepository : IRepository<Supplier>
{
    Task<IReadOnlyList<Supplier>> GetAllAsync(CancellationToken cancellationToken = default);

    Task<Supplier?> GetByNormalizedNameAsync(string normalizedName, CancellationToken cancellationToken = default);

    // Only one that is on no invoice.
    void Remove(Supplier supplier);
}
```


## 5. دفتر المخزون

> 📄 **`backend/src/Costing.Domain/StockMovements/StockMovementReason.cs`** — 31 سطر

```csharp
namespace Costing.Domain.StockMovements;

public enum StockMovementReason
{
    // An order was paid.
    Sale = 1,

    // An item was voided after it reached the kitchen but before payment.
    Waste = 2,

    // An item was voided after payment, and its ingredients go back on the shelf.
    VoidReturn = 3,

    Purchase = 4,

    CountAdjustment = 5,

    // Raw stock thrown away, recorded by hand: expired, spoiled, dropped, damaged packaging.
    Spoilage = 6,

    // Taken from stock to make a prep item: the flour that went into the dough. A transfer
    // between stock items, not a cost of sales.
    ProductionInput = 7,

    // A prep item made: the dough, into stock at what its ingredients cost.
    ProductionOutput = 8,

    // Stock as found when costing starts (جرد افتتاحي): where it begins, not a shortage or a
    // surplus, so no report counts it as a loss or a gain.
    OpeningStock = 9,
}
```


> 📄 **`backend/src/Costing.Domain/StockMovements/StockMovement.cs`** — 59 سطر

```csharp
using Costing.Domain.Common;

namespace Costing.Domain.StockMovements;

// One entry in the stock ledger. Append-only: a mistake is corrected by a new movement, never
// by editing an old one, so a material's QuantityOnHand always equals the sum of its
// movements and can be rebuilt from them.
public sealed class StockMovement : AggregateRoot
{
    private StockMovement() { }

    // Internal: entries are created only by RawMaterial, together with the balance change
    // they explain.
    internal StockMovement(
        Guid rawMaterialId, decimal quantity, StockMovementReason reason, Guid sourceId, decimal? unitCost,
        string? note = null, string? recordedBy = null, Guid? reversalOf = null)
    {
        RawMaterialId = rawMaterialId;
        Quantity = quantity;
        Reason = reason;
        SourceId = sourceId;
        UnitCost = unitCost;
        Note = note;
        RecordedBy = recordedBy;
        ReversalOf = reversalOf;
        OccurredAtUtc = DateTime.UtcNow;
    }

    public Guid RawMaterialId { get; private set; }

    // Signed: negative for stock out, positive for stock in.
    public decimal Quantity { get; private set; }

    public StockMovementReason Reason { get; private set; }

    // What caused it: the order item for a sale, waste or void return; the purchase or stock
    // count otherwise. (SourceId, RawMaterialId, Reason, ReversalOf) is unique, which is what
    // makes handling the same event twice harmless.
    public Guid SourceId { get; private set; }

    // For an entry that undoes another, its Id: a voided purchase, waste entry or stock count.
    // Same source and reason, the opposite quantity at the same unit cost, so every report that
    // adds a reason up nets the two from the day of the void on. The original stays as it was.
    public Guid? ReversalOf { get; private set; }

    public bool IsReversal => ReversalOf is not null;

    public DateTime OccurredAtUtc { get; private set; }

    // The cost of one unit (gram, millilitre, piece) at that moment: the price paid on a purchase,
    // the average cost otherwise. Null while the material had no price. Quantity × UnitCost is
    // what the movement was worth, so a month's food cost is the sum of its sales' worth.
    public decimal? UnitCost { get; private set; }

    // For an entry made by hand (spoilage): why, and who recorded it. Null for the rest, whose
    // SourceId already says.
    public string? Note { get; private set; }
    public string? RecordedBy { get; private set; }
}
```


> 📄 **`backend/src/Costing.Domain/StockMovements/IStockMovementRepository.cs`** — 14 سطر

```csharp
using Costing.Domain.Common;

namespace Costing.Domain.StockMovements;

public interface IStockMovementRepository : IRepository<StockMovement>
{
    // The outbox delivers at least once, so a handler can see the same event twice. Checking
    // this first lets it skip the repeat; the unique index on (SourceId, RawMaterialId, Reason)
    // catches two deliveries racing each other.
    Task<bool> ExistsAsync(Guid sourceId, StockMovementReason reason, CancellationToken cancellationToken = default);

    // Every entry a purchase, waste entry or stock count made, and any reversing them.
    Task<IReadOnlyList<StockMovement>> GetBySourceAsync(Guid sourceId, StockMovementReason reason, CancellationToken cancellationToken = default);
}
```


## 6. الوصفات والإنتاج

- `Recipe`: وصفة طبق: لكل خامة **EP للوصفة كاملة** و Yield، وعدد الحصص (`Portions`). مرتبطة بهدف في الكتالوج (`RecipeTarget`: صنف منيو، أو حجم منه، أو إضافة): بيع وحدة من الهدف يخصم (EP ÷ Yield ÷ الحصص) من كل خامة.
- `RecipeIngredient`: الخامة، الكمية EP، و Yield (افتراضي الخامة إن لم يُحدد).
- `RecipeTarget`: معرّفات `int` للكتالوج فقط، فلا يعتمد المخزون على الكتالوج.
- `StockRequirements`: يحوّل سطر مبيعات إلى "كم تخصم من كل خامة".
- `PrepRecipe`: وصفة **دفعة** المصنّع ("10 كجم عجين = 6 كجم دقيق + 3.5 لتر ماء + 100 جم خميرة")؛ مكوناتها خامات أو مصنعات أخرى (تداخل)، و `AsPurchasedQuantity = Quantity × 100 ÷ Yield`.
- `ProductionOrder`: أمر إنتاج: المخطط والمنتج فعليًا، يُخرج المكونات بمتوسطها ويُدخل المصنّع بتكلفتها.

> 📄 **`backend/src/Costing.Domain/Recipes/RecipeTarget.cs`** — 22 سطر

```csharp
namespace Costing.Domain.Recipes;

public enum RecipeTargetKind
{
    MenuItem,
    AddOn,
}

// What a recipe is for, named by the shared catalog's ids: the delivery system's MenuItem, one
// of its MenuItemVariants, or an AddOn. Plain ints. Inventory never loads the catalog, so it
// cannot come to depend on it.
public readonly record struct RecipeTarget(RecipeTargetKind Kind, int CatalogItemId, int? VariantId)
{
    // The base recipe, used for every variant that does not have its own.
    public static RecipeTarget ForMenuItem(int menuItemId) => new(RecipeTargetKind.MenuItem, menuItemId, null);

    // For a variant that uses different quantities, such as a 1 kg tray against a half.
    public static RecipeTarget ForVariant(int menuItemId, int variantId) => new(RecipeTargetKind.MenuItem, menuItemId, variantId);

    // Per unit of the item it is added to, the way its price is.
    public static RecipeTarget ForAddOn(int addOnId) => new(RecipeTargetKind.AddOn, addOnId, null);
}
```


> 📄 **`backend/src/Costing.Domain/Recipes/RecipeIngredient.cs`** — 38 سطر

```csharp
using Costing.Domain.Common;
using Costing.Domain.RawMaterials;

namespace Costing.Domain.Recipes;

public sealed class RecipeIngredient : Entity
{
    private RecipeIngredient() { }

    internal RecipeIngredient(Guid recipeId, Guid rawMaterialId, decimal quantity, decimal yieldPercent)
    {
        RecipeId = recipeId;
        RawMaterialId = rawMaterialId;
        Change(quantity, yieldPercent);
    }

    public Guid RecipeId { get; private set; }
    public Guid RawMaterialId { get; private set; }

    // The Edible Portion (EP) the recipe calls for, as written for all its portions, in the raw
    // material's own unit: grams, millilitres or pieces.
    public decimal Quantity { get; private set; }

    // The share of the material left after trimming. What stock gives up for Quantity is
    // Quantity ÷ Yield: 85 g of peppers to use at 85% takes 100 g off the shelf.
    public decimal YieldPercent { get; private set; } = 100;

    // As Purchased (AP): what comes off stock for the whole recipe.
    public decimal AsPurchasedQuantity => Quantity * 100 / YieldPercent;

    internal void Change(decimal quantity, decimal yieldPercent)
    {
        if (quantity <= 0)
            throw new DomainException("Ingredient quantity must be greater than zero.");
        Quantity = quantity;
        YieldPercent = RawMaterial.ValidYield(yieldPercent);
    }
}
```


> 📄 **`backend/src/Costing.Domain/Recipes/Recipe.cs`** — 134 سطر

```csharp
using Costing.Domain.Common;
using Costing.Domain.RawMaterials;

namespace Costing.Domain.Recipes;

// A dish as the kitchen writes it: each raw material's Edible Portion for the whole recipe and
// its yield, and how many portions that makes. Linked to a catalog item (a menu item, one of its
// sizes, or an add-on), one sold unit takes one portion's share off stock, as purchased. Not
// linked, it is an off-menu or R&D recipe: costed, never sold. A catalog item with no linked
// recipe is simply not stock-tracked.
//
// Deleted, it is only marked so: it leaves the screens and the sales, and stays for the record of
// what the kitchen worked to. Each sale's stock movements already keep what it took, and at what
// cost, so past reports never depend on it.
public sealed class Recipe : AggregateRoot
{
    private readonly List<RecipeIngredient> _ingredients = [];

    private Recipe() { }

    // The recipe a catalog item sells by, under its name.
    public Recipe(RecipeTarget target)
        : this(null, null, null, target)
    {
    }

    public Recipe(string? name, Guid? categoryId, decimal? plannedPrice, RecipeTarget? target)
    {
        CreatedAtUtc = DateTime.UtcNow;
        Define(name, categoryId, plannedPrice, target);
    }

    // Its own name: required off the menu; on it, optional, the catalog item's name standing in.
    public string? Name { get; private set; }

    // The kitchen's own grouping (sauces, staff meals, catering), apart from the menu's categories.
    // Null for one not sorted yet: written before categories, or by its dish alone.
    public Guid? RecipeCategoryId { get; private set; }

    // What an off-menu recipe is meant to sell at, for its food cost before it is on the menu. A
    // linked recipe is costed against the menu's price.
    public decimal? PlannedPrice { get; private set; }

    // RecipeTarget's parts, as separate columns; all null for an off-menu recipe. One active
    // recipe per target.
    public RecipeTargetKind? TargetKind { get; private set; }
    public int? CatalogItemId { get; private set; }
    public int? VariantId { get; private set; }

    public RecipeTarget? Target => TargetKind is { } kind && CatalogItemId is { } id ? new RecipeTarget(kind, id, VariantId) : null;
    public bool IsLinked => CatalogItemId is not null;

    public DateTime CreatedAtUtc { get; private set; }
    public DateTime? DeletedAtUtc { get; private set; }
    public string? DeletedBy { get; private set; }
    public bool IsDeleted => DeletedAtUtc is not null;

    // What it is called and what it is for, set together so the whole is checked: off the menu, it
    // needs a name of its own.
    public void Define(string? name, Guid? categoryId, decimal? plannedPrice, RecipeTarget? target)
    {
        var cleanName = Clean(name);
        if (cleanName?.Length > 200)
            throw new DomainException("Keep the recipe's name under 200 characters.");
        if (plannedPrice < 0)
            throw new DomainException("A planned price cannot be negative.");
        if (target is { Kind: RecipeTargetKind.AddOn, VariantId: not null })
            throw new DomainException("An add-on has no variants.");
        if (target is null && cleanName is null)
            throw new DomainException("Name the recipe: off the menu, it has no menu item's name to go by.");

        Name = cleanName;
        RecipeCategoryId = categoryId;
        PlannedPrice = plannedPrice;
        TargetKind = target?.Kind;
        CatalogItemId = target?.CatalogItemId;
        VariantId = target?.VariantId;
    }

    // Off the menu: kept, with its name, for the record. A sale no longer takes stock by it.
    public void Unlink(string? name = null) => Define(name ?? Name, RecipeCategoryId, PlannedPrice, null);

    // Into another category: its own being deleted.
    public void MoveTo(Guid? categoryId) => RecipeCategoryId = categoryId;

    public void Delete(string deletedBy)
    {
        if (IsDeleted)
            return;
        DeletedAtUtc = DateTime.UtcNow;
        DeletedBy = deletedBy;
    }

    public void Restore()
    {
        DeletedAtUtc = null;
        DeletedBy = null;
    }

    // How many portions the quantities below make, as a recipe is written: 15 for a tray of
    // strata. A sold item uses one portion's share.
    public int Portions { get; private set; } = 1;

    public IReadOnlyCollection<RecipeIngredient> Ingredients => _ingredients.AsReadOnly();

    public void SetPortions(int portions) =>
        Portions = portions >= 1 ? portions : throw new DomainException("A recipe makes at least one portion.");

    // Adds the ingredient, or changes it if it is already there. Takes the material itself rather
    // than an id so that a recipe can never name one that does not exist. Without a yield, the
    // material's default is used.
    public void SetIngredient(RawMaterial material, decimal quantity, decimal? yieldPercent = null)
    {
        var existing = _ingredients.SingleOrDefault(i => i.RawMaterialId == material.Id);
        var yield = yieldPercent ?? existing?.YieldPercent ?? material.DefaultYieldPercent;
        if (existing is null)
            _ingredients.Add(new RecipeIngredient(Id, material.Id, quantity, yield));
        else
            existing.Change(quantity, yield);
    }

    public void RemoveIngredient(Guid rawMaterialId) =>
        _ingredients.RemoveAll(i => i.RawMaterialId == rawMaterialId);

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    public IReadOnlyList<(Guid RawMaterialId, decimal Quantity)> RequirementsFor(int units)
    {
        if (units <= 0)
            throw new DomainException("Units must be at least 1.");

        return _ingredients.Select(i => (i.RawMaterialId, Quantity: i.AsPurchasedQuantity * units / Portions)).ToList();
    }
}
```


> 📄 **`backend/src/Costing.Domain/Recipes/RecipeCategory.cs`** — 54 سطر

```csharp
using Costing.Domain.Common;

namespace Costing.Domain.Recipes;

// The kitchen's own grouping of its recipes (Sauces, Staff meals, Catering orders), apart from
// the menu's categories, which belong to the delivery system. Every recipe written on the recipe
// screen is in one. Its id is made by the till, so a retried save adds it once.
public sealed class RecipeCategory : AggregateRoot
{
    private RecipeCategory() { }

    public RecipeCategory(Guid id, string name, string? nameAr = null)
    {
        Id = id;
        CreatedAtUtc = DateTime.UtcNow;
        Rename(name, nameAr);
    }

    public string Name { get; private set; } = string.Empty;

    // The name as compared: capitals and extra spaces ignored, so "staff  meals" is Staff meals.
    public string NormalizedName { get; private set; } = string.Empty;

    public string? NameAr { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }

    public void Rename(string name, string? nameAr = null)
    {
        var clean = Collapse(name ?? string.Empty);
        if (clean.Length == 0)
            throw new DomainException("Give the category a name.");
        var cleanAr = string.IsNullOrWhiteSpace(nameAr) ? null : Collapse(nameAr);
        if (clean.Length > 100 || cleanAr?.Length > 100)
            throw new DomainException("Keep the category's name under 100 characters.");

        Name = clean;
        NormalizedName = Normalize(clean);
        NameAr = cleanAr;
    }

    public static string Normalize(string name) => Collapse(name).ToUpperInvariant();

    private static string Collapse(string name) => string.Join(' ', name.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
}

public interface IRecipeCategoryRepository : IRepository<RecipeCategory>
{
    Task<IReadOnlyList<RecipeCategory>> GetAllAsync(CancellationToken cancellationToken = default);

    Task<RecipeCategory?> GetByNormalizedNameAsync(string normalizedName, CancellationToken cancellationToken = default);

    // Only once no active recipe is in it.
    void Remove(RecipeCategory category);
}
```


> 📄 **`backend/src/Costing.Domain/Recipes/IRecipeRepository.cs`** — 27 سطر

```csharp
using Costing.Domain.Common;

namespace Costing.Domain.Recipes;

// Returns recipes with their Ingredients loaded. Nothing removes one: a deleted recipe is marked so.
public interface IRecipeRepository : IRepository<Recipe>
{
    // Every recipe, on the menu or off it, the deleted ones too: a recipes sheet is written from
    // them and read back against them.
    Task<IReadOnlyList<Recipe>> GetAllAsync(CancellationToken cancellationToken = default);

    // The active recipe linked to the target, if any.
    Task<Recipe?> GetByTargetAsync(RecipeTarget target, CancellationToken cancellationToken = default);

    // Every active recipe a set of sold items could need, in one round trip (see
    // StockRequirements.TargetsFor). Targets with no recipe are simply absent.
    Task<IReadOnlyList<Recipe>> GetByTargetsAsync(IReadOnlyCollection<RecipeTarget> targets, CancellationToken cancellationToken = default);

    // Every recipe in the category, the deleted ones too: what moves with it when it goes.
    Task<IReadOnlyList<Recipe>> GetInCategoryAsync(Guid categoryId, CancellationToken cancellationToken = default);

    // How many active recipes each category holds.
    Task<IReadOnlyDictionary<Guid, int>> CountByCategoryAsync(CancellationToken cancellationToken = default);

    // How many recipes not deleted, on the menu or off it, have the material as an ingredient.
    Task<int> CountUsingAsync(Guid rawMaterialId, CancellationToken cancellationToken = default);
}
```


> 📄 **`backend/src/Costing.Domain/Recipes/StockRequirements.cs`** — 49 سطر

```csharp
namespace Costing.Domain.Recipes;

// One sold order line, as inventory sees it: catalog ids and a quantity. Nothing about the
// order, its price or its customer. The POS turns its shared OrderItem into this before
// handing it over, which is the whole interface between the two modules.
public sealed record SoldItem(int MenuItemId, int? VariantId, IReadOnlyList<int> AddOnIds, int Quantity);

public static class StockRequirements
{
    // What `item` draws from stock, summed per raw material:
    //   the variant's own recipe if it has one, otherwise the menu item's base recipe;
    //   plus each add-on's recipe, per unit, the same way the add-on is priced per unit;
    //   all multiplied by the quantity.
    // The variant recipe replaces the base rather than adding to it: a 1 kg tray is not a
    // base portion plus a tray.
    public static IReadOnlyDictionary<Guid, decimal> For(SoldItem item, IReadOnlyCollection<Recipe> recipes)
    {
        // Only the active recipes on the menu take stock: one per target.
        var byTarget = recipes.Where(r => !r.IsDeleted && r.Target is not null).ToDictionary(r => r.Target!.Value);
        var totals = new Dictionary<Guid, decimal>();

        var main = item.VariantId is { } variantId && byTarget.TryGetValue(RecipeTarget.ForVariant(item.MenuItemId, variantId), out var forVariant)
            ? forVariant
            : byTarget.GetValueOrDefault(RecipeTarget.ForMenuItem(item.MenuItemId));

        Add(main);
        foreach (var addOnId in item.AddOnIds)
            Add(byTarget.GetValueOrDefault(RecipeTarget.ForAddOn(addOnId)));

        return totals;

        void Add(Recipe? recipe)
        {
            if (recipe is null)
                return;

            foreach (var (rawMaterialId, quantity) in recipe.RequirementsFor(item.Quantity))
                totals[rawMaterialId] = totals.GetValueOrDefault(rawMaterialId) + quantity;
        }
    }

    // Every recipe the given items could need, so they can be loaded in one query.
    public static IReadOnlyCollection<RecipeTarget> TargetsFor(IEnumerable<SoldItem> items) =>
        items
            .SelectMany(i => new[] { RecipeTarget.ForMenuItem(i.MenuItemId) }
                .Concat(i.VariantId is { } v ? [RecipeTarget.ForVariant(i.MenuItemId, v)] : [])
                .Concat(i.AddOnIds.Select(RecipeTarget.ForAddOn)))
            .ToHashSet();
}
```


> 📄 **`backend/src/Costing.Domain/Production/PrepRecipe.cs`** — 99 سطر

```csharp
using Costing.Domain.Common;
using Costing.Domain.RawMaterials;

namespace Costing.Domain.Production;

// A prep item's bill of materials, for one batch as the kitchen makes it: "10 kg of pizza dough
// takes 6 kg of flour, 3.5 L of water, 100 g of yeast". Its ingredients can be bought materials
// or other prep items. Its id is the prep item's, so each prep item has one.
public sealed class PrepRecipe : AggregateRoot
{
    private readonly List<PrepIngredient> _ingredients = [];

    private PrepRecipe() { }

    public PrepRecipe(RawMaterial prepItem, decimal batchQuantity)
    {
        if (!prepItem.IsPrepItem)
            throw new DomainException($"{prepItem.Name} is bought, not made: it has no recipe to make it from.");
        Id = prepItem.Id;
        SetBatch(batchQuantity);
    }

    public Guid PrepItemId => Id;

    // What one batch makes, in the prep item's own unit: 10,000 g.
    public decimal BatchQuantity { get; private set; }

    // The kitchen's own recipe category (أقسام الوصفات) it is sorted under, with the dishes': sauces,
    // doughs. None until it is given one. Its stock category, for the count sheet, is the prep item's.
    public Guid? RecipeCategoryId { get; private set; }

    public void MoveTo(Guid? categoryId) => RecipeCategoryId = categoryId;

    public IReadOnlyCollection<PrepIngredient> Ingredients => _ingredients.AsReadOnly();

    public void SetBatch(decimal batchQuantity) =>
        BatchQuantity = batchQuantity > 0 ? batchQuantity : throw new DomainException("A batch makes more than nothing.");

    // The whole list, replacing what was there. Each quantity is the Edible Portion for one batch,
    // in the ingredient's own unit, as a dish's recipe is written.
    public void Replace(IReadOnlyCollection<(RawMaterial Material, decimal Quantity, decimal? YieldPercent)> ingredients)
    {
        if (ingredients.Any(i => i.Material.Id == Id))
            throw new DomainException("A prep item cannot be made from itself.");
        if (ingredients.Select(i => i.Material.Id).Distinct().Count() != ingredients.Count)
            throw new DomainException("Each ingredient goes on the recipe once: add its quantities together.");

        var lines = ingredients
            .Select(i => new PrepIngredient(Id, i.Material.Id, i.Quantity, i.YieldPercent ?? i.Material.DefaultYieldPercent))
            .ToList();
        _ingredients.Clear();
        _ingredients.AddRange(lines);
    }

    // What `quantity` of the prep item takes from stock, as purchased, to the gram: the batch's
    // ingredients scaled to it.
    public IReadOnlyList<(Guid RawMaterialId, decimal Quantity)> RequirementsFor(decimal quantity)
    {
        if (quantity <= 0)
            throw new DomainException("Make more than nothing.");
        return _ingredients
            .Select(i => (i.RawMaterialId, Math.Round(i.AsPurchasedQuantity * quantity / BatchQuantity, 3, MidpointRounding.AwayFromZero)))
            .ToList();
    }
}

public sealed class PrepIngredient : Entity
{
    private PrepIngredient() { }

    internal PrepIngredient(Guid prepRecipeId, Guid rawMaterialId, decimal quantity, decimal yieldPercent)
    {
        if (quantity <= 0)
            throw new DomainException("Each ingredient needs a quantity greater than zero.");
        PrepRecipeId = prepRecipeId;
        RawMaterialId = rawMaterialId;
        Quantity = quantity;
        YieldPercent = RawMaterial.ValidYield(yieldPercent);
    }

    public Guid PrepRecipeId { get; private set; }
    public Guid RawMaterialId { get; private set; }

    // The Edible Portion for one batch, in the ingredient's own unit.
    public decimal Quantity { get; private set; }

    public decimal YieldPercent { get; private set; } = 100;

    // What comes off stock for one batch: 85 g of peeled onion at 85% takes 100 g.
    public decimal AsPurchasedQuantity => Quantity * 100 / YieldPercent;
}

public interface IPrepRecipeRepository : IRepository<PrepRecipe>
{
    Task<IReadOnlyList<PrepRecipe>> GetAllAsync(CancellationToken cancellationToken = default);

    // Those in a recipe category, deleted prep items' too: to be moved with it.
    Task<IReadOnlyList<PrepRecipe>> GetInCategoryAsync(Guid recipeCategoryId, CancellationToken cancellationToken = default);
}
```


> 📄 **`backend/src/Costing.Domain/Production/ProductionOrder.cs`** — 168 سطر

```csharp
using Costing.Domain.Common;
using Costing.Domain.RawMaterials;
using Costing.Domain.StockMovements;

namespace Costing.Domain.Production;

public enum ProductionOrderStatus
{
    // Its ingredients out and the prep item in.
    Made = 1,

    // Reversed, each of its entries undone: deleted, or corrected by a batch made again.
    Voided = 2,
}

// A batch of a prep item made in the kitchen: its ingredients taken from stock by the recipe,
// scaled to what was planned, and what came out put into stock at what they cost. Recorded
// once it is made, and fixed from then on: the ledger of what the kitchen produced. A wrong one
// is voided (its entries reversed) and, when corrected, made again as a new batch that names it.
//
// Its id is made by the till and is the stock movements' SourceId, so a retry after a lost
// answer makes the batch once.
public sealed class ProductionOrder : AggregateRoot
{
    private readonly List<ProductionOrderLine> _lines = [];

    private ProductionOrder() { }

    private ProductionOrder(
        Guid id, Guid prepItemId, decimal planned, decimal produced, string producedBy, string? notes, string? approvedBy, Guid? revisionOf)
    {
        Id = id;
        PrepItemId = prepItemId;
        PlannedQuantity = planned;
        ProducedQuantity = produced;
        ProducedBy = producedBy;
        Notes = notes;
        ApprovedBy = approvedBy;
        RevisionOf = revisionOf;
        ProducedAtUtc = DateTime.UtcNow;
        Status = ProductionOrderStatus.Made;
    }

    public Guid PrepItemId { get; private set; }

    // In the prep item's unit. Planned sets the ingredients; produced is what came out, and what
    // the batch's cost is shared over: 9.6 kg from a 10 kg batch carries the lost 0.4 kg's cost.
    public decimal PlannedQuantity { get; private set; }
    public decimal ProducedQuantity { get; private set; }

    // What the ingredients cost at their averages when it was made, and that per unit produced.
    public decimal TotalCost { get; private set; }
    public decimal UnitCost { get; private set; }

    public DateTime ProducedAtUtc { get; private set; }
    public string ProducedBy { get; private set; } = string.Empty;
    public string? Notes { get; private set; }

    // The manager who approved it, when it was asked of one: made then, at the averages then.
    public string? ApprovedBy { get; private set; }

    public ProductionOrderStatus Status { get; private set; } = ProductionOrderStatus.Made;
    public DateTime? VoidedAtUtc { get; private set; }
    public string? VoidedBy { get; private set; }
    public bool IsVoided => Status == ProductionOrderStatus.Voided;

    // A correction: this batch is the one it replaced, made again with other quantities. The
    // replaced one names it back.
    public Guid? RevisionOf { get; private set; }
    public Guid? ReplacedBy { get; private set; }

    public IReadOnlyList<ProductionOrderLine> Lines => _lines.AsReadOnly();

    // Makes the batch: takes each ingredient off stock at its average cost now, and puts the
    // produced quantity of the prep item into stock at their total over what came out. Returns
    // the ledger entries for the caller to add in the same unit of work. The records may show
    // too little of an ingredient (a delivery not entered yet): it goes below zero, as a sale
    // takes it, and a count puts it right. One with no cost at all stops it, as the batch's cost
    // could not be known.
    public static (ProductionOrder Order, IReadOnlyList<StockMovement> Movements) Make(
        Guid id,
        RawMaterial prepItem,
        PrepRecipe recipe,
        IReadOnlyDictionary<Guid, RawMaterial> materials,
        decimal planned,
        decimal produced,
        string producedBy,
        string? notes = null,
        string? approvedBy = null,
        Guid? revisionOf = null)
    {
        if (recipe.PrepItemId != prepItem.Id)
            throw new DomainException("That recipe is for another prep item.");
        if (prepItem.IsArchived)
            throw new DomainException($"{prepItem.Name} has been deleted: it is no longer made.");
        if (recipe.Ingredients.Count == 0)
            throw new DomainException($"{prepItem.Name} has no ingredients yet: write its recipe first.");
        if (planned <= 0 || produced <= 0)
            throw new DomainException("Enter how much was planned and how much was made, both more than nothing.");
        if (notes?.Trim().Length > 200)
            throw new DomainException("Keep the notes under 200 characters.");

        var requirements = recipe.RequirementsFor(planned)
            .Select(r => (Material: materials.GetValueOrDefault(r.RawMaterialId) ?? throw new NotFoundException(nameof(RawMaterial), r.RawMaterialId), r.Quantity))
            .ToList();
        var unpriced = requirements.Where(r => r.Material.AverageCost is null).Select(r => r.Material.Name).ToList();
        if (unpriced.Count > 0)
            throw new DomainException($"{string.Join(", ", unpriced)} {(unpriced.Count == 1 ? "has" : "have")} no cost yet, so the batch's cost cannot be worked out. "
                + "Enter it on Raw materials, or post the invoice it came on.");

        var order = new ProductionOrder(
            id, prepItem.Id, planned, produced, producedBy, string.IsNullOrWhiteSpace(notes) ? null : notes.Trim(), approvedBy, revisionOf);
        var movements = new List<StockMovement>();
        foreach (var (material, quantity) in requirements.Where(r => r.Quantity > 0))
        {
            var unitCost = material.AverageCost!.Value;
            order._lines.Add(new ProductionOrderLine(id, material.Id, quantity, unitCost));
            movements.Add(material.UseInProduction(quantity, id));
        }

        order.TotalCost = order._lines.Sum(l => l.Cost);
        order.UnitCost = order.TotalCost / produced;
        movements.Add(prepItem.ReceiveProduction(produced, id, order.TotalCost));
        return (order, movements);
    }

    // Marks it voided once its entries are reversed (the caller reverses them): deleted, or
    // replacedBy the batch that corrects it. Voiding again changes nothing.
    public void Void(string voidedBy, Guid? replacedBy = null)
    {
        if (IsVoided)
            return;
        Status = ProductionOrderStatus.Voided;
        VoidedAtUtc = DateTime.UtcNow;
        VoidedBy = voidedBy;
        ReplacedBy = replacedBy;
    }
}

public sealed class ProductionOrderLine : Entity
{
    private ProductionOrderLine() { }

    internal ProductionOrderLine(Guid productionOrderId, Guid rawMaterialId, decimal quantity, decimal unitCost)
    {
        ProductionOrderId = productionOrderId;
        RawMaterialId = rawMaterialId;
        Quantity = quantity;
        UnitCost = unitCost;
        Cost = Math.Round(quantity * unitCost, 2, MidpointRounding.AwayFromZero);
    }

    public Guid ProductionOrderId { get; private set; }
    public Guid RawMaterialId { get; private set; }

    // As taken off stock, in the ingredient's own unit.
    public decimal Quantity { get; private set; }

    // Its average cost per unit at that moment, and what this line came to.
    public decimal UnitCost { get; private set; }
    public decimal Cost { get; private set; }
}

public interface IProductionOrderRepository : IRepository<ProductionOrder>
{
    // Newest first; one prep item's when it is given.
    Task<IReadOnlyList<ProductionOrder>> GetRecentAsync(Guid? prepItemId, int take, CancellationToken cancellationToken = default);
}
```


## 7. المنيو والمبيعات

`MenuItem` برقمه (كوده في كل التقارير، مثل `6101`)، وأحجامه (`6101-17`)، والإضافات (`A3`)، والفئات. `SalesReceipt`: إيصال مبيعات أو **ملخص يومي** (`SalesSource.DailySummary`، واحد لكل يوم)، بسطوره، والقناة وطريقة الدفع والإلغاءات.

> 📄 **`backend/src/Costing.Domain/Menu/MenuItem.cs`** — 224 سطر

```csharp
using Costing.Domain.Common;

namespace Costing.Domain.Menu;

// The menu (قائمة الطعام) the recipes sell by: its items, their sizes, the add-ons, and the
// categories they are grouped in. Kept here, so the costs need no point of sale: entered on the
// Menu tab, or imported from a sheet.
//
// Numbered, not given a Guid: an item's number is its code on every report (6101, a size of it
// 6101-2, an add-on A3), as the menu numbers them. A recipe names what it sells by by these
// numbers (RecipeTarget).
public sealed class MenuCategory
{
    public const int MaxNameLength = 100;

    private MenuCategory() { }

    public MenuCategory(string name, string? nameAr, int displayOrder)
    {
        Rename(name, nameAr);
        DisplayOrder = displayOrder;
    }

    public int Id { get; private set; }
    public string Name { get; private set; } = string.Empty;
    public string? NameAr { get; private set; }
    public int DisplayOrder { get; private set; }

    public void Rename(string name, string? nameAr)
    {
        Name = MenuText.Name(name, "the category");
        NameAr = MenuText.Optional(nameAr, MaxNameLength);
    }

    public void MoveTo(int displayOrder) => DisplayOrder = displayOrder;
}

// A dish or a drink. Category is its category's name, as the reports group and match it (the
// beverage categories are names). Price is what it sells at; with sizes, each size's price is,
// and Price is not charged. Priced by its add-ons (a kilo of mixed grill), it has no price of
// its own. Deleted, it is only marked so: past sales and recipes still name it.
public sealed class MenuItem
{
    public const int MaxNameLength = 200;

    private readonly List<MenuItemVariant> _variants = [];

    private MenuItem() { }

    public MenuItem(int id, string name, string? nameAr, string category, decimal price, bool isPriceBasedOnAddons)
    {
        if (id <= 0)
            throw new DomainException("An item's number is 1 or more.");
        Id = id;
        Change(name, nameAr, category, price, isPriceBasedOnAddons);
    }

    public int Id { get; private set; }
    public string Name { get; private set; } = string.Empty;
    public string? NameAr { get; private set; }
    public string Category { get; private set; } = string.Empty;
    public decimal Price { get; private set; }
    public bool IsAvailable { get; private set; } = true;
    public bool IsPriceBasedOnAddons { get; private set; }
    public bool IsDeleted { get; private set; }

    // The add-ons it can be sold with, by their numbers.
    public int[] AddOnIds { get; private set; } = [];

    public IReadOnlyCollection<MenuItemVariant> Variants => _variants.AsReadOnly();

    public void Change(string name, string? nameAr, string category, decimal price, bool isPriceBasedOnAddons)
    {
        if (price < 0)
            throw new DomainException("A price cannot be negative.");
        Name = MenuText.Name(name, "the item");
        NameAr = MenuText.Optional(nameAr, MaxNameLength);
        Category = MenuText.Name(category, "its category");
        IsPriceBasedOnAddons = isPriceBasedOnAddons;
        Price = isPriceBasedOnAddons ? 0 : price;
    }

    public void SetAvailable(bool available) => IsAvailable = available;

    public void SetAddOns(IEnumerable<int> addOnIds) => AddOnIds = addOnIds.Distinct().Order().ToArray();

    // Its category renamed: the items keep the name the category goes by.
    public void MoveToCategory(string category) => Category = MenuText.Name(category, "its category");

    // Sets its sizes as listed: one named as one already there keeps its number (so its recipe and
    // its sales stay with it), a new name is a new size, and one not listed is taken off.
    public void SetVariants(IReadOnlyList<(string Name, string? NameAr, decimal Price)> sizes)
    {
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var size in sizes)
        {
            if (!names.Add(MenuText.Name(size.Name, "each size")))
                throw new DomainException($"There are two sizes called {size.Name.Trim()}.");
            if (size.Price < 0)
                throw new DomainException("A price cannot be negative.");
        }

        _variants.RemoveAll(v => !names.Contains(v.Name));
        for (var i = 0; i < sizes.Count; i++)
        {
            var (name, nameAr, price) = sizes[i];
            var existing = _variants.SingleOrDefault(v => string.Equals(v.Name, name.Trim(), StringComparison.OrdinalIgnoreCase));
            if (existing is null)
                _variants.Add(new MenuItemVariant(Id, name, nameAr, price, i));
            else
                existing.Change(name, nameAr, price, i);
        }
    }

    public void Delete() => IsDeleted = true;

    public void Restore() => IsDeleted = false;
}

// One size of an item: "500g", "1 Kilo", "Family tray". Its price is what the size sells at, not
// added to the item's.
public sealed class MenuItemVariant
{
    private MenuItemVariant() { }

    internal MenuItemVariant(int menuItemId, string name, string? nameAr, decimal price, int displayOrder)
    {
        MenuItemId = menuItemId;
        Change(name, nameAr, price, displayOrder);
    }

    public int Id { get; private set; }
    public int MenuItemId { get; private set; }
    public string Name { get; private set; } = string.Empty;
    public string? NameAr { get; private set; }
    public decimal Price { get; private set; }
    public int DisplayOrder { get; private set; }

    internal void Change(string name, string? nameAr, decimal price, int displayOrder)
    {
        Name = MenuText.Name(name, "each size");
        NameAr = MenuText.Optional(nameAr, MenuItem.MaxNameLength);
        Price = price;
        DisplayOrder = displayOrder;
    }
}

// Something added to an item, at its own price: "Extra cheese", "Side rice". It can have a
// recipe of its own, which a sale with it takes too.
public sealed class AddOn
{
    private AddOn() { }

    public AddOn(string name, string? nameAr, decimal price) => Change(name, nameAr, price);

    public int Id { get; private set; }
    public string Name { get; private set; } = string.Empty;
    public string? NameAr { get; private set; }
    public decimal Price { get; private set; }
    public bool IsDeleted { get; private set; }

    public void Change(string name, string? nameAr, decimal price)
    {
        if (price < 0)
            throw new DomainException("A price cannot be negative.");
        Name = MenuText.Name(name, "the add-on");
        NameAr = MenuText.Optional(nameAr, MenuItem.MaxNameLength);
        Price = price;
    }

    public void Delete() => IsDeleted = true;

    public void Restore() => IsDeleted = false;
}

internal static class MenuText
{
    public static string Name(string? value, string what)
    {
        var name = value?.Trim();
        if (string.IsNullOrEmpty(name))
            throw new DomainException($"Name {what}.");
        if (name.Length > MenuItem.MaxNameLength)
            throw new DomainException($"Keep the name under {MenuItem.MaxNameLength} characters.");
        return name;
    }

    public static string? Optional(string? value, int max)
    {
        var text = string.IsNullOrWhiteSpace(value) ? null : value.Trim();
        if (text?.Length > max)
            throw new DomainException($"Keep the name under {max} characters.");
        return text;
    }
}

// The menu, loaded and saved by its numbers. Nothing on it is removed: deleted items and add-ons
// are marked so, and a category goes only when no item is in it.
public interface IMenuRepository
{
    Task<IReadOnlyList<MenuCategory>> GetCategoriesAsync(CancellationToken cancellationToken = default);

    Task<MenuCategory?> GetCategoryAsync(int id, CancellationToken cancellationToken = default);

    void AddCategory(MenuCategory category);

    void RemoveCategory(MenuCategory category);

    // Deleted ones too, with their sizes.
    Task<IReadOnlyList<MenuItem>> GetItemsAsync(CancellationToken cancellationToken = default);

    Task<MenuItem?> GetItemAsync(int id, CancellationToken cancellationToken = default);

    Task<int> NextItemNumberAsync(CancellationToken cancellationToken = default);

    void AddItem(MenuItem item);

    // Deleted ones too.
    Task<IReadOnlyList<AddOn>> GetAddOnsAsync(CancellationToken cancellationToken = default);

    Task<AddOn?> GetAddOnAsync(int id, CancellationToken cancellationToken = default);

    void AddAddOn(AddOn addOn);
}
```


> 📄 **`backend/src/Costing.Domain/Sales/SalesReceipt.cs`** — 294 سطر

```csharp
using Costing.Domain.Common;

namespace Costing.Domain.Sales;

// Where a sale was made: in the restaurant, taken away or delivered by it, or online (a delivery
// app or the website), whose orders pay their own delivery.
public enum SalesChannel
{
    DineIn = 1,
    Takeaway = 2,
    Delivery = 3,
    Online = 4,
}

// How a sale was paid. Only cash reaches the safe; the rest is reconciled apart.
public enum PaymentMethod
{
    Cash = 1,
    Visa = 2,
    Instapay = 3,
}

// A line taken off the bill, and when: what it did to the stock, as a point of sale voids it.
public enum LineVoid
{
    // On the bill.
    None = 0,

    // Before the kitchen had it: never made, no stock taken.
    BeforeKitchen = 1,

    // After the kitchen made it, before it was paid: its ingredients are waste.
    AfterKitchen = 2,

    // After it was paid: refunded (RefundedAmount), and its ingredients back into stock. It was
    // charged, so it stays in the bill's subtotal.
    AfterPayment = 3,
}

// How a receipt reached the system.
public enum SalesSource
{
    // Entered on the Sales tab, a bill or a day's totals.
    Entered = 1,

    // Imported from a sheet: a point of sale's export.
    Imported = 2,

    // A day's sales summary (ملخص المبيعات اليومية): what each item sold that day, entered or
    // imported from the day's sheet, for its stock and its theoretical cost. No bills, no money
    // taken: the day's money is its takings, on Financials. One a day.
    DailySummary = 3,
}

// One sale (فاتورة بيع): a bill paid, what was on it and how it added up, as a point of sale
// would print it. What every cost report reads as sales (the theoretical cost, the variance, the
// KPIs, the reconciliation of the safe), so the costs need no point of sale: receipts are
// entered here, a bill at a time or a day's totals as one, or imported from a sheet.
//
// Its lines take stock when it is recorded, each by the recipe its item sells by (a size's, or the
// dish's; and each add-on's), a portion's share of each ingredient as purchased: a line voided
// after the kitchen made it as waste, and one refunded after payment sold and put back (LineVoid).
// Voided, all its stock is put back, and it leaves the reports; it is kept, for the record.
//
//   subtotal = the lines charged: on the bill, or refunded after payment
//   total    = subtotal - discount + tax + delivery fee - points
//
// Its id is made by the app, so a retried entry is recorded once; an imported one also keeps the
// point of sale's own number (Reference), so a sheet imported twice is recorded once.
public sealed class SalesReceipt : AggregateRoot
{
    public const int MaxReferenceLength = 64;

    private readonly List<SalesReceiptLine> _lines = [];

    private SalesReceipt() { }

    public SalesReceipt(
        Guid id,
        string? reference,
        DateTime soldAtUtc,
        DateOnly businessDate,
        SalesChannel channel,
        PaymentMethod paymentMethod,
        IReadOnlyList<SalesReceiptLine> lines,
        decimal discountAmount,
        decimal deliveryFee,
        decimal taxAmount,
        decimal pointsAmount,
        decimal refundedAmount,
        string? notes,
        SalesSource source,
        string enteredBy)
    {
        if (!Enum.IsDefined(channel) || !Enum.IsDefined(paymentMethod))
            throw new DomainException("Say where the sale was made and how it was paid.");
        if (lines.Count == 0)
            throw new DomainException("A sale has at least one line.");
        if (discountAmount < 0 || deliveryFee < 0 || taxAmount < 0 || pointsAmount < 0 || refundedAmount < 0)
            throw new DomainException("The discount, delivery fee, tax, points and refunds cannot be negative.");
        var cleanReference = string.IsNullOrWhiteSpace(reference) ? null : reference.Trim();
        if (cleanReference?.Length > MaxReferenceLength)
            throw new DomainException($"Keep the receipt number under {MaxReferenceLength} characters.");
        if (notes?.Trim().Length > 300)
            throw new DomainException("Keep the notes under 300 characters.");

        Id = id;
        Reference = cleanReference;
        SoldAtUtc = DateTime.SpecifyKind(soldAtUtc, DateTimeKind.Utc);
        BusinessDate = businessDate;
        Channel = channel;
        PaymentMethod = paymentMethod;
        _lines.AddRange(lines);
        DiscountAmount = discountAmount;
        DeliveryFee = deliveryFee;
        TaxAmount = taxAmount;
        PointsAmount = pointsAmount;
        Notes = string.IsNullOrWhiteSpace(notes) ? null : notes.Trim();
        Source = source;
        EnteredBy = enteredBy;
        EnteredAtUtc = DateTime.UtcNow;

        if (DiscountAmount > BilledSubtotal)
            throw new DomainException("The discount cannot be more than the items.");
        TotalAmount = BilledSubtotal - DiscountAmount + TaxAmount + DeliveryFee - PointsAmount;
        if (TotalAmount < 0)
            throw new DomainException("The points cannot be more than the bill.");
        if (refundedAmount > TotalAmount)
            throw new DomainException("What was handed back cannot be more than what was paid.");
        RefundedAmount = refundedAmount;
    }

    // The point of sale's own number for it, if it came from one.
    public string? Reference { get; private set; }

    // When it was paid, and the business day that makes it (a night past midnight belongs to the
    // evening's).
    public DateTime SoldAtUtc { get; private set; }
    public DateOnly BusinessDate { get; private set; }

    public SalesChannel Channel { get; private set; }
    public bool IsOnline => Channel == SalesChannel.Online;
    public PaymentMethod PaymentMethod { get; private set; }

    public IReadOnlyCollection<SalesReceiptLine> Lines => _lines.AsReadOnly();

    // The lines charged: on the bill, or refunded after payment (their refund is RefundedAmount).
    public decimal BilledSubtotal => _lines.Where(l => l.Charged).Sum(l => l.LineTotal);

    // Off the items, before tax (a promotion).
    public decimal DiscountAmount { get; private set; }

    // Charged for delivery, after any delivery discount.
    public decimal DeliveryFee { get; private set; }

    public decimal TaxAmount { get; private set; }

    // Paid with loyalty points: a payment against the bill, after tax.
    public decimal PointsAmount { get; private set; }

    // What was charged.
    public decimal TotalAmount { get; private set; }

    // Handed back after it was paid. The lines it was for stay sold: they took their stock.
    public decimal RefundedAmount { get; private set; }

    public string? Notes { get; private set; }
    public SalesSource Source { get; private set; }
    public string EnteredBy { get; private set; } = string.Empty;
    public DateTime EnteredAtUtc { get; private set; }

    public DateTime? VoidedAtUtc { get; private set; }
    public string? VoidedBy { get; private set; }
    public bool IsVoided => VoidedAtUtc is not null;

    // Handed back after it was paid (a void after payment): `quantity` of a line refunded, at its
    // share of what was charged, so a bill partly paid with points gives back exactly the money
    // taken; the last line standing gets whatever is left. Part of a line is split off as a line of
    // its own. Returns the refunded line, for the caller to put its stock back (VoidReturn); the
    // line it was split from keeps what it took.
    public SalesReceiptLine Refund(Guid linePublicId, int quantity)
    {
        if (IsVoided)
            throw new DomainException("This sale is voided: there is nothing to refund.");
        var line = _lines.SingleOrDefault(l => l.PublicId == linePublicId) ?? throw new DomainException("That line is not on this sale.");
        if (!line.OnBill)
            throw new DomainException("That line is off the bill already.");
        if (quantity < 1 || quantity > line.Quantity)
            throw new DomainException($"Refund 1 to {line.Quantity}.");

        var refunded = line;
        if (quantity < line.Quantity)
        {
            refunded = line.SplitOff(quantity);
            _lines.Add(refunded);
        }

        var remaining = TotalAmount - RefundedAmount;
        var share = _lines.All(l => ReferenceEquals(l, refunded) || !l.OnBill)
            ? remaining
            : BilledSubtotal == 0 ? 0 : Math.Min(Math.Round(refunded.LineTotal * TotalAmount / BilledSubtotal, 2, MidpointRounding.AwayFromZero), remaining);
        refunded.MarkRefunded();
        RefundedAmount += share;
        return refunded;
    }

    // Taken back: it leaves the reports, and its stock is put back (the caller posts that).
    public void Void(string voidedBy)
    {
        if (IsVoided)
            throw new DomainException("This sale is voided already.");
        VoidedAtUtc = DateTime.UtcNow;
        VoidedBy = voidedBy;
    }
}

// One line of a sale: an item (a size of it), how many, with which add-ons, and what the line
// came to. PublicId names it to the stock it took. Voided: taken off the bill, and when.
public sealed class SalesReceiptLine
{
    private SalesReceiptLine() { }

    public SalesReceiptLine(
        int menuItemId, int? variantId, string menuItemName, string? variantName, int quantity, decimal lineTotal, IReadOnlyList<int> addOnIds,
        LineVoid voided = LineVoid.None)
    {
        if (quantity <= 0)
            throw new DomainException("A line sells at least one.");
        if (lineTotal < 0)
            throw new DomainException("A line's total cannot be negative.");
        PublicId = Guid.NewGuid();
        MenuItemId = menuItemId;
        VariantId = variantId;
        MenuItemName = menuItemName;
        VariantName = variantName;
        Quantity = quantity;
        PostedQuantity = quantity;
        LineTotal = lineTotal;
        AddOnIds = addOnIds.ToArray();
        Voided = Enum.IsDefined(voided) ? voided : throw new DomainException("Say when the line was voided.");
    }

    public Guid PublicId { get; private set; }
    public int MenuItemId { get; private set; }
    public int? VariantId { get; private set; }

    // As it was sold: the menu may be renamed since.
    public string MenuItemName { get; private set; } = string.Empty;
    public string? VariantName { get; private set; }

    public int Quantity { get; private set; }

    // How many its stock was taken for: Quantity until part of it is refunded and split off, when
    // what it took stays with it. A cost read from what it took is scaled by Quantity over this.
    public int PostedQuantity { get; private set; }

    public decimal LineTotal { get; private set; }
    public int[] AddOnIds { get; private set; } = [];
    public LineVoid Voided { get; private set; }

    // Still on the bill.
    public bool OnBill => Voided == LineVoid.None;

    // Charged: on the bill, or refunded after it was paid.
    public bool Charged => Voided is LineVoid.None or LineVoid.AfterPayment;

    // `quantity` of it moved onto a line of its own, at the same price and with the same add-ons.
    internal SalesReceiptLine SplitOff(int quantity)
    {
        var unit = LineTotal / Quantity;
        var moved = Math.Round(unit * quantity, 2, MidpointRounding.AwayFromZero);
        var split = new SalesReceiptLine(MenuItemId, VariantId, MenuItemName, VariantName, quantity, moved, AddOnIds);
        Quantity -= quantity;
        LineTotal -= moved;
        return split;
    }

    internal void MarkRefunded() => Voided = LineVoid.AfterPayment;
}

public interface ISalesReceiptRepository : IRepository<SalesReceipt>
{
    // Those paid from (inclusive) to (exclusive), voided ones left out, with their lines.
    Task<IReadOnlyList<SalesReceipt>> GetPaidAsync(DateTime fromUtc, DateTime toUtc, CancellationToken cancellationToken = default);

    // A business day's or a range's, voided ones too, newest first.
    Task<IReadOnlyList<SalesReceipt>> GetForDaysAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken = default);

    // The point of sale's numbers already recorded, of those asked.
    Task<IReadOnlySet<string>> GetReferencesAsync(IReadOnlyCollection<string> references, CancellationToken cancellationToken = default);

    // A business day's sales summary, if one is entered and not voided, with its lines.
    Task<SalesReceipt?> GetDailySummaryAsync(DateOnly date, CancellationToken cancellationToken = default);
}
```


## 8. المشتريات

`PurchaseInvoice`: مسودة ⇐ مرحّلة (`Posted`) ⇐ ملغاة (`Voided`). البند: خامة (يدخل المخزون) أو مصروف. `LineTotal` كما كُتب على الورقة، و `Discount` البند، و **`DiscountShare`** حصته من خصم الفاتورة (توزيع بالقرش، الفصل 05)، و `Cost` = الصافي الذي يدخل المتوسط. والدفع: نقدي من الخزنة، أو من إيراد يوم، أو آجل.

> 📄 **`backend/src/Costing.Domain/Purchases/PurchaseInvoice.cs`** — 388 سطر

```csharp
using Costing.Domain.Common;
using Costing.Domain.RawMaterials;
using Costing.Domain.StockMovements;

namespace Costing.Domain.Purchases;

public enum PurchaseInvoiceStatus
{
    // Being entered and checked: no stock has moved.
    Draft = 1,

    // Confirmed: its stock is in, its prices are in the average costs. Fixed from then on.
    Posted = 2,

    // Posted, then deleted with a manager's approval: its stock taken back out by reversing
    // entries, its expenses out of the reports. Kept, as the record of both.
    Voided = 3,
}

// How an invoice is paid. Chosen before it is posted.
public enum PurchasePaymentMethod
{
    // In cash from the safe (خصم من الخزنة).
    Safe = 1,

    // In cash from one day's takings (خصم من إيراد يوم), before they went into the safe.
    DayRevenue = 2,

    // Bought on credit (آجل): owed to the supplier until paid with a payment voucher.
    Credit = 3,

    // Posted before the treasury was kept: it touches neither the safe nor the supplier's account.
    BeforeTreasury = 4,
}

// What a line of an invoice is.
public enum PurchaseItemType
{
    // A raw material: posting takes it into stock and moves its average cost.
    Inventory = 1,

    // Not stock (cleaning supplies, a repair, a bill): posting records only what it cost, under
    // its category, for the profit and loss.
    Expense = 2,
}

// A supplier's invoice as the manager enters it: who from, their number and date, each line as it
// is written on the paper (5 kg, L.E 100), and a photo or scan of the paper itself. Saved as a
// draft while it is entered and reviewed; posting it takes the stock in, each line at the grams,
// millilitres or pieces it comes to, and moves each material's average cost. Expense lines, on the
// same invoice or one of their own, leave stock alone: they are only what they cost.
//
// Its id is made by the till and is the stock movements' SourceId, so a retry after a lost
// answer posts it once.
public sealed class PurchaseInvoice : AggregateRoot
{
    public const int MaxAttachmentBytes = 10 * 1024 * 1024;

    // What a photo or scan of an invoice can be.
    public static readonly IReadOnlySet<string> AttachmentTypes =
        new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "image/jpeg", "image/png", "image/webp", "application/pdf" };

    private readonly List<PurchaseInvoiceLine> _lines = [];

    private PurchaseInvoice() { }

    public PurchaseInvoice(Guid id, string createdBy)
    {
        Id = id;
        CreatedBy = createdBy;
        CreatedAtUtc = DateTime.UtcNow;
        Status = PurchaseInvoiceStatus.Draft;
    }

    public PurchaseInvoiceStatus Status { get; private set; }
    // Who it is from: one of the suppliers, or none on a delivery recorded before suppliers were kept.
    public Guid? SupplierId { get; private set; }
    public string? SupplierInvoiceNumber { get; private set; }
    public DateOnly? InvoiceDate { get; private set; }

    // How it is paid; required to post it. For a day's takings, which day's (RevenueDate).
    public PurchasePaymentMethod? PaymentMethod { get; private set; }
    public DateOnly? RevenueDate { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public string CreatedBy { get; private set; } = string.Empty;
    public DateTime? PostedAtUtc { get; private set; }
    public string? PostedBy { get; private set; }
    public DateTime? VoidedAtUtc { get; private set; }
    public string? VoidedBy { get; private set; }

    // A correction (تعديل فاتورة): the posted invoice it corrects (RevisionOf), voided and replaced
    // by it; and on that one, the invoice that replaced it (ReplacedBy). Nothing posted is rewritten.
    public Guid? RevisionOf { get; private set; }
    public Guid? ReplacedBy { get; private set; }

    // The attached photo or scan, described; its bytes are kept apart.
    public string? AttachmentFileName { get; private set; }
    public string? AttachmentContentType { get; private set; }
    public int? AttachmentBytes { get; private set; }
    public DateTime? AttachedAtUtc { get; private set; }
    public string? AttachedBy { get; private set; }
    public bool HasAttachment => AttachmentFileName is not null;

    public IReadOnlyList<PurchaseInvoiceLine> Lines => _lines.AsReadOnly();

    // A discount on the whole invoice (خصم الفاتورة), shared among its priced lines.
    public decimal Discount { get; private set; }

    // What the lines came to as written (Subtotal), and their own discounts.
    public decimal Subtotal => _lines.Sum(l => l.LineTotal ?? 0);
    public decimal LineDiscounts => _lines.Sum(l => l.Discount);

    // What the lines with a price came to after every discount: in all, what is paid (الصافي
    // المستحق), for stock, and for expenses.
    public decimal Total => _lines.Sum(l => l.Cost ?? 0);
    public decimal InventoryTotal => _lines.Where(l => l.ItemType == PurchaseItemType.Inventory).Sum(l => l.Cost ?? 0);
    public decimal ExpenseTotal => _lines.Where(l => l.ItemType == PurchaseItemType.Expense).Sum(l => l.Cost ?? 0);

    // This draft corrects a posted invoice. An invoice from before the treasury is corrected as one
    // too: the caller keeps it so, and it touches neither the safe nor a supplier's account.
    public void Corrects(PurchaseInvoice original)
    {
        if (Status != PurchaseInvoiceStatus.Draft)
            throw new DomainException("Only a new invoice corrects another.");
        if (original.Status != PurchaseInvoiceStatus.Posted)
            throw new DomainException(original.ReplacedBy is null
                ? "Only a posted invoice is corrected."
                : "This invoice has already been corrected: correct the invoice that replaced it.");
        RevisionOf = original.Id;
    }

    // Replaces the draft's details and lines. Each line is as written on the invoice: a quantity
    // in a unit that holds UnitSize of the material's own (5 in kg of 1000 g), or of an expense.
    // discount: the invoice's own, off the total after the lines' discounts.
    public void Record(
        Guid? supplierId,
        string? supplierInvoiceNumber,
        DateOnly? invoiceDate,
        IReadOnlyCollection<PurchaseInvoiceLineEntry> lines,
        PurchasePaymentMethod? paymentMethod = null,
        DateOnly? revenueDate = null,
        decimal discount = 0)
    {
        if (Status != PurchaseInvoiceStatus.Draft)
            throw new DomainException(Status == PurchaseInvoiceStatus.Voided
                ? "This invoice has been voided. Enter a new invoice for the delivery."
                : "This invoice has been posted. Its stock is in; enter a new invoice for another delivery.");
        var materials = lines.Where(l => l.ItemType == PurchaseItemType.Inventory).Select(l => l.RawMaterialId).ToList();
        if (materials.Distinct().Count() != materials.Count)
            throw new DomainException("Each material goes on the invoice once: add its quantities together.");
        var expenses = lines.Where(l => l.ItemType == PurchaseItemType.Expense).Select(l => l.ExpenseItemId).ToList();
        if (expenses.Distinct().Count() != expenses.Count)
            throw new DomainException("Each expense goes on the invoice once: add its amounts together.");
        if (supplierInvoiceNumber?.Trim().Length > 64)
            throw new DomainException("Keep the supplier's invoice number under 64 characters.");

        if (paymentMethod is { } method && (!Enum.IsDefined(method) || (method == PurchasePaymentMethod.BeforeTreasury && RevisionOf is null)))
            throw new DomainException("Choose how the invoice is paid: from the safe, from a day's takings, or on credit.");

        var recorded = lines.Select(l => new PurchaseInvoiceLine(Id, l)).ToList();
        ShareDiscount(recorded, discount);

        SupplierId = supplierId;
        SupplierInvoiceNumber = Clean(supplierInvoiceNumber);
        InvoiceDate = invoiceDate;
        PaymentMethod = paymentMethod;
        RevenueDate = paymentMethod == PurchasePaymentMethod.DayRevenue ? revenueDate : null;
        Discount = Math.Round(discount, 2, MidpointRounding.AwayFromZero);
        _lines.Clear();
        _lines.AddRange(recorded);
    }

    // The invoice's discount, shared among the priced lines by what each comes to after its own
    // discount, so each material's cost is what it really came to. To the piastre: each line's share
    // rounded down, and the piastres left go one each to the lines that lost the most to rounding.
    private static void ShareDiscount(IReadOnlyList<PurchaseInvoiceLine> lines, decimal discount)
    {
        if (discount < 0)
            throw new DomainException("A discount cannot be less than nothing. · الخصم لا يكون بالسالب.");
        var cents = (long)Math.Round(discount * 100, MidpointRounding.AwayFromZero);
        if (cents == 0)
            return;

        var priced = lines.Where(l => l.Cost > 0).ToList();
        var net = priced.Sum(l => l.Cost!.Value);
        if (priced.Count == 0)
            throw new DomainException("Give the lines their totals before taking a discount off the invoice. · أدخل إجمالي البنود قبل خصم الفاتورة.");
        if (cents > Math.Round(net * 100, MidpointRounding.AwayFromZero))
            throw new DomainException("The invoice's discount cannot be more than its lines come to. · خصم الفاتورة لا يزيد عن إجمالي البنود.");

        var exact = priced.Select(l => cents * l.Cost!.Value / net).ToList();
        var shares = exact.Select(e => (long)Math.Floor(e)).ToList();
        var left = cents - shares.Sum();
        foreach (var i in Enumerable.Range(0, priced.Count).OrderByDescending(i => exact[i] - shares[i]).ThenBy(i => i).Take((int)left))
            shares[i]++;
        for (var i = 0; i < priced.Count; i++)
            priced[i].Share(shares[i] / 100m);
    }

    // Takes the stock in and returns the ledger entries, for the caller to add in the same unit of
    // work: each material line at its quantity in the material's own unit, its cost moving the
    // average. Expense lines take nothing in: posted, what they cost is the record.
    public IReadOnlyList<StockMovement> Post(IReadOnlyDictionary<Guid, RawMaterial> materials, string postedBy)
    {
        EnsurePostable();

        var movements = _lines
            .Where(l => l.ItemType == PurchaseItemType.Inventory)
            .Select(l => (materials.GetValueOrDefault(l.RawMaterialId!.Value) ?? throw new NotFoundException(nameof(RawMaterial), l.RawMaterialId))
                .ReceivePurchase(l.Quantity, Id, l.Cost))
            .ToList();
        Status = PurchaseInvoiceStatus.Posted;
        PostedAtUtc = DateTime.UtcNow;
        PostedBy = postedBy;
        return movements;
    }

    // What would stop it being posted: checked again as it is.
    public void EnsurePostable()
    {
        if (Status != PurchaseInvoiceStatus.Draft)
            throw new DomainException($"This invoice has already been {Status.ToString().ToLowerInvariant()}.");
        if (_lines.Count == 0)
            throw new DomainException("Put at least one line on the invoice before posting it.");
        if (PaymentMethod == PurchasePaymentMethod.BeforeTreasury && RevisionOf is not null)
            return;
        EnsurePayable(PaymentMethod, RevenueDate);
    }

    // How a posted invoice is paid now: after a cash payment was rejected or voided, it is paid
    // again, another way. The caller makes sure it is unpaid.
    public void PayBy(PurchasePaymentMethod method, DateOnly? revenueDate)
    {
        if (Status != PurchaseInvoiceStatus.Posted)
            throw new DomainException("Only a posted invoice is paid.");
        if (PaymentMethod == PurchasePaymentMethod.Credit)
            throw new DomainException("This invoice is on credit: pay the supplier with a payment voucher.");
        EnsurePayable(method, revenueDate);
        PaymentMethod = method;
        RevenueDate = method == PurchasePaymentMethod.DayRevenue ? revenueDate : null;
    }

    private void EnsurePayable(PurchasePaymentMethod? method, DateOnly? revenueDate)
    {
        switch (method)
        {
            case null:
            case PurchasePaymentMethod.BeforeTreasury:
                throw new DomainException("Choose how the invoice is paid: from the safe, from a day's takings, or on credit.");
            case PurchasePaymentMethod.Credit when SupplierId is null:
                throw new DomainException("An invoice on credit is owed to a supplier: choose the supplier.");
            case PurchasePaymentMethod.DayRevenue when revenueDate is null:
                throw new DomainException("Choose the day whose takings paid the invoice.");
        }
    }

    // Marks a posted invoice void; replacedBy, the invoice that corrects it. The caller reverses
    // its stock entries in the same unit of work.
    public void Void(string voidedBy, Guid? replacedBy = null)
    {
        if (Status == PurchaseInvoiceStatus.Voided)
            return;
        if (Status != PurchaseInvoiceStatus.Posted)
            throw new DomainException("Only a posted invoice is voided; discard a draft instead.");
        Status = PurchaseInvoiceStatus.Voided;
        VoidedAtUtc = DateTime.UtcNow;
        VoidedBy = voidedBy;
        ReplacedBy = replacedBy;
    }

    // The paper, photographed or scanned. On a draft it can be replaced; once the invoice is
    // posted, a missing one can still be added, but what is attached stays, for the audit.
    public void Attach(string fileName, string contentType, int bytes, string attachedBy)
    {
        if (Status == PurchaseInvoiceStatus.Posted && HasAttachment)
            throw new DomainException("This posted invoice already has its paper attached; it is kept as it is.");
        if (!AttachmentTypes.Contains(contentType))
            throw new DomainException("Attach a photo (JPEG, PNG or WebP) or a PDF of the invoice.");
        if (bytes is <= 0 or > MaxAttachmentBytes)
            throw new DomainException("The file must be under 10 MB.");

        AttachmentFileName = Clean(Path.GetFileName(fileName)) is { } name ? name[..Math.Min(name.Length, 200)] : "invoice";
        AttachmentContentType = contentType.ToLowerInvariant();
        AttachmentBytes = bytes;
        AttachedAtUtc = DateTime.UtcNow;
        AttachedBy = attachedBy;
    }

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}

// A line as the manager enters it: Quantity in the unit chosen (UnitLabel), which holds UnitSize
// of the material's own unit; Cost is what the line came to as written, when the invoice gives
// it, and Discount what was taken off it (الخصم). An expense line names its ExpenseItemId instead
// of a material, is in its own units (UnitSize 1), and always has its cost: it is nothing else.
public sealed record PurchaseInvoiceLineEntry(
    Guid? RawMaterialId,
    decimal EnteredQuantity,
    string? UnitLabel,
    decimal UnitSize,
    decimal? Cost,
    PurchaseItemType ItemType = PurchaseItemType.Inventory,
    Guid? ExpenseItemId = null,
    decimal Discount = 0);

public sealed class PurchaseInvoiceLine : Entity
{
    private PurchaseInvoiceLine() { }

    internal PurchaseInvoiceLine(Guid invoiceId, PurchaseInvoiceLineEntry entry)
    {
        if (entry.EnteredQuantity <= 0)
            throw new DomainException("Each line needs a quantity greater than zero.");
        if (entry.Cost < 0)
            throw new DomainException("A line cannot cost less than nothing.");
        if (entry.UnitLabel?.Trim().Length > 32)
            throw new DomainException("Keep each line's unit under 32 characters.");
        if (entry.Discount < 0)
            throw new DomainException("A discount cannot be less than nothing. · الخصم لا يكون بالسالب.");
        if (entry.Discount > 0 && entry.Cost is null)
            throw new DomainException("Give a discounted line its total before the discount. · أدخل إجمالي البند قبل خصمه.");
        if (entry.Discount > entry.Cost)
            throw new DomainException("A line's discount cannot be more than the line. · خصم البند لا يزيد عن إجماليه.");

        InvoiceId = invoiceId;
        ItemType = entry.ItemType;
        EnteredQuantity = entry.EnteredQuantity;
        LineTotal = entry.Cost is { } total ? Math.Round(total, 2, MidpointRounding.AwayFromZero) : null;
        Discount = Math.Round(entry.Discount, 2, MidpointRounding.AwayFromZero);
        Cost = LineTotal - Discount;
        switch (entry.ItemType)
        {
            case PurchaseItemType.Inventory:
                if (entry.RawMaterialId is not { } materialId || materialId == Guid.Empty || entry.ExpenseItemId is not null)
                    throw new DomainException("Choose the material for each stock line.");
                if (entry.UnitSize <= 0)
                    throw new DomainException("Choose the unit each line is in.");
                RawMaterialId = materialId;
                UnitLabel = string.IsNullOrWhiteSpace(entry.UnitLabel) ? "unit" : entry.UnitLabel.Trim();
                UnitSize = entry.UnitSize;
                // To the thousandth, as stock is kept: 0.1 kg is 100 g.
                Quantity = Math.Round(entry.EnteredQuantity * entry.UnitSize, 3, MidpointRounding.AwayFromZero);
                break;
            case PurchaseItemType.Expense:
                if (entry.ExpenseItemId is not { } expenseId || expenseId == Guid.Empty || entry.RawMaterialId is not null)
                    throw new DomainException("Choose the expense for each expense line.");
                if (entry.Cost is null)
                    throw new DomainException("Give each expense line its amount.");
                ExpenseItemId = expenseId;
                UnitLabel = string.IsNullOrWhiteSpace(entry.UnitLabel) ? "unit" : entry.UnitLabel.Trim();
                UnitSize = 1;
                Quantity = Math.Round(entry.EnteredQuantity, 3, MidpointRounding.AwayFromZero);
                break;
            default:
                throw new DomainException("Say whether each line is stock or an expense.");
        }
    }

    public Guid InvoiceId { get; private set; }
    public PurchaseItemType ItemType { get; private set; } = PurchaseItemType.Inventory;

    // One or the other, as ItemType says.
    public Guid? RawMaterialId { get; private set; }
    public Guid? ExpenseItemId { get; private set; }

    // As written on the invoice: 5, in kg.
    public decimal EnteredQuantity { get; private set; }
    public string UnitLabel { get; private set; } = string.Empty;
    public decimal UnitSize { get; private set; }

    // What it comes to in the material's own unit: 5,000 g. An expense's is as entered.
    public decimal Quantity { get; private set; }

    // What the line came to as written (إجمالي البند), what was taken off it, and its share of the
    // invoice's discount.
    public decimal? LineTotal { get; private set; }
    public decimal Discount { get; private set; }
    public decimal DiscountShare { get; private set; }

    // What it really cost, after both discounts: what goes into the average cost and is paid.
    public decimal? Cost { get; private set; }

    internal void Share(decimal share)
    {
        DiscountShare = share;
        Cost = LineTotal - Discount - share;
    }
}
```


> 📄 **`backend/src/Costing.Domain/Purchases/IPurchaseInvoiceRepository.cs`** — 35 سطر

```csharp
using Costing.Domain.Common;

namespace Costing.Domain.Purchases;

// Returns invoices with their Lines loaded.
public interface IPurchaseInvoiceRepository : IRepository<PurchaseInvoice>
{
    Task<IReadOnlyList<PurchaseInvoice>> GetByStatusAsync(PurchaseInvoiceStatus status, CancellationToken cancellationToken = default);

    // For each supplier on an invoice: how many invoices (drafts too), and what the posted ones came to.
    Task<IReadOnlyDictionary<Guid, SupplierUse>> GetSupplierUseAsync(CancellationToken cancellationToken = default);

    Task<bool> AnyForSupplierAsync(Guid supplierId, CancellationToken cancellationToken = default);

    // For each expense item on an invoice: how many invoices (drafts too), and what it cost on the posted ones.
    Task<IReadOnlyDictionary<Guid, ExpenseItemUse>> GetExpenseItemUseAsync(CancellationToken cancellationToken = default);

    Task<bool> AnyForExpenseItemAsync(Guid expenseItemId, CancellationToken cancellationToken = default);

    // Only a draft is ever removed. A posted invoice is the record of what came in.
    void Remove(PurchaseInvoice draft);
}

public sealed record SupplierUse(int Invoices, decimal PostedTotal, DateTime? LastPostedAtUtc);

public sealed record ExpenseItemUse(int Invoices, decimal PostedTotal, DateTime? LastPostedAtUtc);

// The photo or scan of an invoice, kept apart from the invoice so a list of invoices never loads
// a megabyte each. Written in the same unit of work as the invoice.
public interface IPurchaseAttachmentStore
{
    void Put(Guid invoiceId, byte[] content);

    Task<byte[]?> GetAsync(Guid invoiceId, CancellationToken cancellationToken = default);
}
```


## 9. الجرد والهالك

`StockCount`: مسودة تُحفظ أثناء العد (العد قد يستغرق ساعة والتابلت قد ينام)، ثم تُرحّل. **النوع**: `Opening` (افتتاحي: بداية القيم، لا يُعتبر فرقًا) أو `Periodic` (دوري: الفرق = عجز/زيادة). الشرح المحاسبي في الفصل 05.

> 📄 **`backend/src/Costing.Domain/StockCounts/StockCount.cs`** — 183 سطر

```csharp
using Costing.Domain.Common;
using Costing.Domain.Production;
using Costing.Domain.RawMaterials;
using Costing.Domain.StockMovements;

namespace Costing.Domain.StockCounts;

public enum StockCountStatus
{
    // Being filled in: can be saved, finished on another device, or discarded.
    Draft = 1,

    // Stock was set to what was counted. Fixed from then on.
    Posted = 2,

    // Posted, then deleted with a manager's approval: its adjustments reversed, and no longer
    // a point the variance report measures from. Kept, as the record of both.
    Voided = 3,
}

public enum StockCountKind
{
    // The weekly count (جرد دوري): what is found against the records is a shortage or a surplus.
    Periodic = 1,

    // The stock found when costing starts (جرد افتتاحي): where each material's stock begins, valued
    // at its cost, with no shortage or surplus against the records before it. Once per material:
    // one counted already is counted periodically from then on.
    Opening = 2,
}

// A physical count of the stores, material by material. Filled in as a draft, then posted: each
// counted material's stock is set to what was on the shelf (a CountAdjustment in the ledger, or
// for an opening count OpeningStock), and what the ledger said at that moment is kept beside it,
// with the average cost then. Posted counts are the fixed points the variance report measures
// between: an opening count only ever as the first.
//
// A material with no line was not counted, which is not the same as counted at nothing: its
// stock is left alone.
public sealed class StockCount : AggregateRoot
{
    private readonly List<StockCountLine> _lines = [];

    private StockCount() { }

    // The id is made by the till, so a retry after a lost answer reaches the same count.
    public StockCount(Guid id, string startedBy, StockCountKind kind = StockCountKind.Periodic)
    {
        Id = id;
        StartedBy = startedBy;
        StartedAtUtc = DateTime.UtcNow;
        Status = StockCountStatus.Draft;
        SetKind(kind);
    }

    public StockCountStatus Status { get; private set; }
    public StockCountKind Kind { get; private set; } = StockCountKind.Periodic;
    public bool IsOpening => Kind == StockCountKind.Opening;
    public DateTime StartedAtUtc { get; private set; }
    public string StartedBy { get; private set; } = string.Empty;
    public DateTime? PostedAtUtc { get; private set; }
    public string? PostedBy { get; private set; }
    public DateTime? VoidedAtUtc { get; private set; }
    public string? VoidedBy { get; private set; }

    public IReadOnlyList<StockCountLine> Lines => _lines.AsReadOnly();

    // Periodic or opening, while it is a draft: started as one, it can be told it is the other.
    public void SetKind(StockCountKind kind)
    {
        if (!Enum.IsDefined(kind))
            throw new DomainException("Choose the kind of count: periodic or opening stock. · اختر نوع الجرد: دوري أو افتتاحي.");
        if (Status != StockCountStatus.Draft && kind != Kind)
            throw new DomainException($"This count has been {Status.ToString().ToLowerInvariant()}: its kind stays.");
        Kind = kind;
    }

    // Replaces the draft's figures with these, in each material's unit (grams, millilitres, pieces).
    public void Record(IReadOnlyCollection<(Guid RawMaterialId, decimal Counted)> counted)
    {
        if (Status != StockCountStatus.Draft)
            throw new DomainException($"This count has been {Status.ToString().ToLowerInvariant()}. Start a new count to count again.");
        if (counted.Any(c => c.Counted < 0))
            throw new DomainException("A counted quantity cannot be negative.");
        if (counted.Select(c => c.RawMaterialId).Distinct().Count() != counted.Count)
            throw new DomainException("Each material is counted once: add its quantities together.");

        var wanted = counted.ToDictionary(c => c.RawMaterialId, c => c.Counted);
        _lines.RemoveAll(l => !wanted.ContainsKey(l.RawMaterialId));
        foreach (var (rawMaterialId, quantity) in wanted)
        {
            if (_lines.Find(l => l.RawMaterialId == rawMaterialId) is { } line)
                line.Change(quantity);
            else
                _lines.Add(new StockCountLine(Id, rawMaterialId, quantity));
        }
    }

    // Sets each counted material's stock to what was counted, and returns the ledger entries for
    // the differences, for the caller to add in the same unit of work. Counting should happen
    // with the kitchen closed: a sale while the count is open is taken from stock the count
    // then overwrites.
    //
    // An opening count's entries are OpeningStock, not CountAdjustment: where stock begins. A prep
    // item in it never made yet, with no cost of its own, is valued by its recipe today (costs);
    // each line keeps the cost it was valued at.
    public IReadOnlyList<StockMovement> Post(IReadOnlyDictionary<Guid, RawMaterial> materials, string postedBy, RecipeCosts? costs = null)
    {
        if (Status != StockCountStatus.Draft)
            throw new DomainException($"This count has already been {Status.ToString().ToLowerInvariant()}.");
        if (_lines.Count == 0)
            throw new DomainException("Count at least one material before posting.");

        var movements = new List<StockMovement>(_lines.Count);
        foreach (var line in _lines)
        {
            var material = materials.GetValueOrDefault(line.RawMaterialId)
                ?? throw new NotFoundException(nameof(RawMaterial), line.RawMaterialId);
            var book = material.QuantityOnHand;
            if (IsOpening)
            {
                var byRecipe = costs?.Of(material.Id) is { ByRecipe: true, PerUnit: { } perUnit } ? perUnit : (decimal?)null;
                movements.Add(material.OpenStock(line.CountedQuantity, Id, byRecipe));
                line.Close(book, material.AverageCost);
            }
            else
            {
                line.Close(book, material.AverageCost);
                movements.Add(material.AdjustToCount(line.CountedQuantity, Id));
            }
        }

        Status = StockCountStatus.Posted;
        PostedAtUtc = DateTime.UtcNow;
        PostedBy = postedBy;
        return movements;
    }

    // Marks a posted count void. The caller reverses its adjustments in the same unit of work.
    public void Void(string voidedBy)
    {
        if (Status == StockCountStatus.Voided)
            return;
        if (Status != StockCountStatus.Posted)
            throw new DomainException("Only a posted count is voided; discard a draft instead.");
        Status = StockCountStatus.Voided;
        VoidedAtUtc = DateTime.UtcNow;
        VoidedBy = voidedBy;
    }
}

public sealed class StockCountLine : Entity
{
    private StockCountLine() { }

    internal StockCountLine(Guid stockCountId, Guid rawMaterialId, decimal countedQuantity)
    {
        StockCountId = stockCountId;
        RawMaterialId = rawMaterialId;
        CountedQuantity = countedQuantity;
    }

    public Guid StockCountId { get; private set; }
    public Guid RawMaterialId { get; private set; }

    // In the material's unit: grams, millilitres, pieces.
    public decimal CountedQuantity { get; private set; }

    // What the ledger said when the count was posted; null on a draft, which a counter should
    // not see anyway: they count what is on the shelf, not confirm a number.
    public decimal? BookQuantity { get; private set; }

    // The material's average cost per unit when the count was posted: what its variance is valued at.
    public decimal? UnitCost { get; private set; }

    internal void Change(decimal countedQuantity) => CountedQuantity = countedQuantity;

    internal void Close(decimal bookQuantity, decimal? unitCost)
    {
        BookQuantity = bookQuantity;
        UnitCost = unitCost;
    }
}
```


> 📄 **`backend/src/Costing.Domain/StockCounts/IStockCountRepository.cs`** — 21 سطر

```csharp
using Costing.Domain.Common;

namespace Costing.Domain.StockCounts;

// Returns counts with their Lines loaded.
public interface IStockCountRepository : IRepository<StockCount>
{
    // The count being filled in, if one is: there is at most one, so two managers do not count
    // the same stores twice without knowing.
    Task<StockCount?> GetDraftAsync(CancellationToken cancellationToken = default);

    Task<IReadOnlyList<StockCount>> GetAllAsync(CancellationToken cancellationToken = default);

    // Of these materials, those in a posted count other than this one (not voided), each with when
    // it was first posted: an opening count does not count them again.
    Task<IReadOnlyDictionary<Guid, DateTime>> CountedBeforeAsync(
        IReadOnlyCollection<Guid> rawMaterialIds, Guid exceptStockCountId, CancellationToken cancellationToken = default);

    // Only a draft is ever removed. A posted count is part of the stock's history.
    void Remove(StockCount draft);
}
```


`BreakageEntry`: الكسر (أطباق، كاسات): ليس مخزونًا؛ تكلفته على اليوم.

> 📄 **`backend/src/Costing.Domain/Waste/BreakageEntry.cs`** — 79 سطر

```csharp
using Costing.Domain.Common;

namespace Costing.Domain.Waste;

// Breakage (كسر) in Costing → Waste: plates, glasses and other consumables broken on a business
// day, at their cost, the second kind of waste beside spoiled stock. Not stock: nothing comes off
// the shelves; the cost is the day's. Entered on Waste. AssetItemId and AssetTransactionId name an
// asset system's own record of it, when one sends it; none for one entered here. What broke is
// said by its name as it was, and who broke it.
public sealed class BreakageEntry : AggregateRoot
{
    public const int MaxDescriptionLength = 150;
    public const int MaxNotesLength = 300;

    private BreakageEntry() { }

    public BreakageEntry(
        Guid id,
        DateOnly businessDate,
        Guid? assetItemId,
        Guid? assetTransactionId,
        string description,
        int quantity,
        decimal? unitCost,
        Guid? employeeId,
        string? notes,
        string recordedBy)
    {
        var name = description?.Trim() ?? string.Empty;
        if (name.Length == 0)
            throw new DomainException("Say what broke.");
        if (quantity < 1)
            throw new DomainException("Say how many broke.");
        if (unitCost < 0)
            throw new DomainException("A piece's cost is zero or more.");
        var trimmed = string.IsNullOrWhiteSpace(notes) ? null : notes.Trim();
        Id = id;
        BusinessDate = businessDate;
        AssetItemId = assetItemId;
        AssetTransactionId = assetTransactionId;
        Description = name[..Math.Min(name.Length, MaxDescriptionLength)];
        Quantity = quantity;
        UnitCost = unitCost;
        Cost = Math.Round((unitCost ?? 0) * quantity, 2, MidpointRounding.AwayFromZero);
        EmployeeId = employeeId;
        Notes = trimmed?[..Math.Min(trimmed.Length, MaxNotesLength)];
        RecordedBy = recordedBy;
        RecordedAtUtc = DateTime.UtcNow;
    }

    public DateOnly BusinessDate { get; private set; }
    public Guid? AssetItemId { get; private set; }
    public Guid? AssetTransactionId { get; private set; }
    public string Description { get; private set; } = string.Empty;
    public int Quantity { get; private set; }

    // None when the asset's cost was not known: the entry costs nothing, and says so.
    public decimal? UnitCost { get; private set; }
    public decimal Cost { get; private set; }

    // Who held it, when someone did.
    public Guid? EmployeeId { get; private set; }

    public string? Notes { get; private set; }
    public string RecordedBy { get; private set; } = string.Empty;
    public DateTime RecordedAtUtc { get; private set; }

    public DateTime? VoidedAtUtc { get; private set; }
    public string? VoidedBy { get; private set; }
    public bool IsVoided => VoidedAtUtc is not null;

    public void Void(string voidedBy)
    {
        if (IsVoided)
            throw new DomainException("This breakage has already been voided.");
        VoidedAtUtc = DateTime.UtcNow;
        VoidedBy = voidedBy;
    }
}
```


> 📄 **`backend/src/Costing.Domain/Waste/IBreakageEntryRepository.cs`** — 11 سطر

```csharp
using Costing.Domain.Common;

namespace Costing.Domain.Waste;

public interface IBreakageEntryRepository : IRepository<BreakageEntry>
{
    // The business days from `from` to `to`, voided ones too.
    Task<IReadOnlyList<BreakageEntry>> GetBetweenAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken = default);

    Task<BreakageEntry?> GetForTransactionAsync(Guid assetTransactionId, CancellationToken cancellationToken = default);
}
```


## 10. الخزنة

`SafeTransaction`: كل قيد في الخزنة. **صندوقان** (`CashFund`): الخزنة (`Safe`)، و **درج اليوم** (`DayRevenue`: إيراد يوم لم يُورَّد بعد؛ يمكن الدفع منه مباشرة). الأنواع: رصيد افتتاحي، تمويل، **توريد إيراد** (`RevenueTransfer`: كاش وفيزا **قبل الضريبة** + الضريبة فوقها)، إذن صرف مصروفات، سداد مورد، سداد فاتورة، سلفة موظف، صرف راتب، **سداد ضرائب** (`TaxPayment`)، و **صرف مسير رواتب** (`PayrollPayment`). و `Takings(...)` تفصل الضريبة من مبلغ شامل **بحيث يرجع الجمع للمبلغ المُدخل بالقرش** (الفصل 06).

> 📄 **`backend/src/Costing.Domain/Treasury/SafeTransaction.cs`** — 450 سطر

```csharp
using Costing.Domain.Common;

namespace Costing.Domain.Treasury;

// Where cash is kept. The safe (الخزنة) holds the restaurant's cash; each business day's cash
// takings are a fund of their own, the drawer, until they are entered, and a purchase can be paid
// straight out of them. Once a day's takings are in the safe, what is paid out of them, or put
// back by a void, moves the safe.
public enum CashFund
{
    Safe = 1,

    // One business day's cash sales (RevenueDate), before they go into the safe.
    DayRevenue = 2,
}

public enum SafeTransactionKind
{
    // The cash in the safe when the treasury starts.
    OpeningBalance = 1,

    // Money put into the safe from outside the sales: the owners', a loan.
    Funding = 2,

    // A day's takings entered (توريد إيراد) from its Z report: the cash and card sales, and the tax
    // collected on them, owed rather than earned. All of it goes into the safe, less what was paid
    // straight out of the day's takings; the voids and refunds are said.
    RevenueTransfer = 3,

    // A cash expense: a bill, wages, petty cash. On the profit and loss under its expense item.
    ExpenseVoucher = 4,

    // Paid to a supplier against what the restaurant owes them (سداد مورد), from the safe or
    // straight from a day's takings.
    SupplierPayment = 5,

    // A purchase invoice paid in cash when it was posted, from the safe or a day's takings.
    InvoicePayment = 6,

    // A cash advance to an employee (سلفة), from the safe or a day's takings. Not an expense: it
    // is owed by the employee until the payroll of its month (PayrollMonth) deducts it, and the
    // wages are counted there.
    EmployeeAdvance = 7,

    // An employee's salary paid (صرف راتب): their net pay for a month, or part of it.
    SalaryPayment = 8,

    // The tax collected paid over to the tax authority (سداد/توريد ضرائب), from the safe. Not an
    // expense: it settles what the takings collected and the safe held for it.
    TaxPayment = 9,

    // A month's payroll approved on HR paid out of the safe in one (صرف مسير الرواتب): its net cash
    // payable (PayrollRunId), the advances paid during the month taken off already. Its labor cost
    // is the run's, counted for the month it pays.
    PayrollPayment = 10,
}

// Where money put into the safe came from (مصدر التمويل).
public enum FundingSource
{
    // Cash already there, carried over from before (رصيد مرحل).
    CarriedOver = 1,

    // The owners' money (تمويل جاري / جاري الشركاء).
    OwnerFinancing = 2,

    Other = 3,
}

// One movement of cash into or out of the safe, or out of a day's takings: the treasury's ledger.
// Amount is signed (in is positive, out negative). Kept as entered: a wrong one is voided by a
// reversing entry dated the day it is voided, so a closed month's balance never moves.
//
// Its id is made by the till, so a retried voucher is recorded once.
public sealed class SafeTransaction : AggregateRoot
{
    // What can be paid out of a day's takings, as well as out of the safe: what the drawer pays
    // before they are entered is taken off them. An array, so EF turns Contains into SQL.
    public static readonly SafeTransactionKind[] PaidOutKinds =
    [
        SafeTransactionKind.InvoicePayment, SafeTransactionKind.SupplierPayment, SafeTransactionKind.EmployeeAdvance, SafeTransactionKind.SalaryPayment,
    ];

    private SafeTransaction() { }

    public const int MaxNotesLength = 500;

    private SafeTransaction(
        Guid id,
        SafeTransactionKind kind,
        CashFund fund,
        decimal amount,
        DateOnly businessDate,
        string? notes,
        string recordedBy,
        string? approvedBy)
    {
        if (notes?.Trim().Length > MaxNotesLength)
            throw new DomainException($"Keep the notes under {MaxNotesLength} characters. · الملاحظات {MaxNotesLength} حرف على الأكثر.");
        Id = id;
        Kind = kind;
        Fund = fund;
        Amount = amount;
        BusinessDate = businessDate;
        Notes = string.IsNullOrWhiteSpace(notes) ? null : notes.Trim();
        RecordedBy = recordedBy;
        ApprovedBy = approvedBy;
        RecordedAtUtc = DateTime.UtcNow;
    }

    public SafeTransactionKind Kind { get; private set; }
    public CashFund Fund { get; private set; }

    // In (positive) or out (negative) of the fund.
    public decimal Amount { get; private set; }

    // The business day it belongs to: the voucher's date.
    public DateOnly BusinessDate { get; private set; }

    // The day's takings it comes from: a transfer's, or a payment out of a day's takings.
    public DateOnly? RevenueDate { get; private set; }

    public FundingSource? Source { get; private set; }
    public Guid? SupplierId { get; private set; }
    public Guid? PurchaseInvoiceId { get; private set; }
    public Guid? ExpenseItemId { get; private set; }

    // An advance's or a salary's: whose, and the payroll month it counts in (its first day).
    public Guid? EmployeeId { get; private set; }
    public DateOnly? PayrollMonth { get; private set; }

    // A payroll payment's: the payroll run from HR it pays.
    public Guid? PayrollRunId { get; private set; }

    public string? Notes { get; private set; }

    // A day's takings: the cash sales of the day, before tax, as entered (إيراد الكاش). Signed as
    // Amount is; null for every other entry.
    public decimal? GrossAmount { get; private set; }

    // A day's sales by Visa or card (إيراد الفيزا), before tax: into the safe with the cash.
    public decimal CardAmount { get; private set; }

    // The tax collected on a day's sales (إجمالي الضريبة المحصلة), on top of the cash and card, signed
    // as they are: in the safe, but owed to the tax authority, not the restaurant's. As entered from
    // the Z report; or, for takings entered as including tax at the till's rate (TaxPercent), worked
    // out from them and taken off them.
    public bool IncludesTax { get; private set; }
    public decimal? TaxPercent { get; private set; }
    public decimal TaxAmount { get; private set; }

    // Voided and refunded on the day (قيمة الفويد والمرتجعات): said, not taken off again, as the
    // cash and card takings are what was collected after them. Why is in the notes.
    public decimal VoidsAmount { get; private set; }

    // All a day's takings collected (إجمالي الوارد): cash, card and the tax on them; and its net
    // sales, the cash and card before tax: the restaurant's revenue. Amount is what reached the
    // safe: all of it less what had been paid straight out of the day's takings by then (PaidOut).
    public decimal TakingsTotal => (GrossAmount ?? Amount) + CardAmount + TaxAmount;
    public decimal NetAmount => (GrossAmount ?? Amount) + CardAmount;
    public decimal PaidOut => GrossAmount is null ? 0 : TakingsTotal - Amount;

    public string RecordedBy { get; private set; } = string.Empty;
    public DateTime RecordedAtUtc { get; private set; }

    // The manager who approved it, when it was asked of one.
    public string? ApprovedBy { get; private set; }

    public Guid? ReversalOf { get; private set; }
    public bool IsReversal => ReversalOf is not null;
    public DateTime? VoidedAtUtc { get; private set; }
    public string? VoidedBy { get; private set; }
    public bool IsVoided => VoidedAtUtc is not null;

    // Advances handed out with no one named yet, for a manager to give out.
    public bool IsPendingAdvance => Kind == SafeTransactionKind.EmployeeAdvance && EmployeeId is null;

    public static SafeTransaction OpeningBalance(
        Guid id, decimal amount, DateOnly date, FundingSource source, string? notes, string recordedBy, string? approvedBy = null)
    {
        if (amount < 0)
            throw new DomainException("The opening balance is what is in the safe: zero or more.");
        if (source == FundingSource.Other)
            throw new DomainException("Say where the opening balance came from: carried over, or the owners' financing.");
        return new SafeTransaction(
            id, SafeTransactionKind.OpeningBalance, CashFund.Safe, Math.Round(amount, 2, MidpointRounding.AwayFromZero), date, notes, recordedBy, approvedBy)
        {
            Source = Defined(source),
        };
    }

    public static SafeTransaction Funding(
        Guid id, decimal amount, DateOnly date, FundingSource source, string? notes, string recordedBy, string? approvedBy = null) =>
        new(id, SafeTransactionKind.Funding, CashFund.Safe, Positive(amount), date, notes, recordedBy, approvedBy) { Source = Defined(source) };

    // A day's takings entered from its Z report: cash and card, the day's sales before tax (the cash
    // may differ from what the till says, so a shortfall shows on that day); tax, the tax collected
    // on them. All of it goes into the safe, less paidOut, what was paid straight out of the day's
    // takings before they were entered; when that is more, the rest comes out of the safe. With
    // taxPercent instead of tax, the cash and card include tax at that rate: it is worked out and
    // taken off them (Takings). voids: voided and refunded on the day, said.
    public static SafeTransaction RevenueTransfer(
        Guid id, decimal cash, DateOnly date, DateOnly revenueDate, string? notes, string recordedBy, string? approvedBy = null,
        decimal? taxPercent = null, decimal paidOut = 0, decimal card = 0, decimal? tax = null, decimal voids = 0)
    {
        if (revenueDate > date)
            throw new DomainException("A day's takings are moved into the safe on that day or after it.");
        if (paidOut < 0)
            throw new DomainException("What was paid out of a day's takings is zero or more.");
        if (voids < 0)
            throw new DomainException("The cash, card, tax and voids are zero or more. · المبالغ صفر أو أكثر.");
        var (net, cardNet, collected) = Takings(cash, card, tax, taxPercent);
        var entry = new SafeTransaction(
            id, SafeTransactionKind.RevenueTransfer, CashFund.Safe, net + cardNet + collected - Round(paidOut), date, notes, recordedBy, approvedBy)
        {
            RevenueDate = revenueDate,
            GrossAmount = net,
            CardAmount = cardNet,
            TaxAmount = collected,
            IncludesTax = (taxPercent is not null && tax is null) || collected > 0,
            TaxPercent = tax is null ? taxPercent : null,
            VoidsAmount = Round(voids),
        };
        return entry;
    }

    // A day's takings as the safe keeps them: the cash and the card before tax, and the tax collected
    // on them. As the Z report gives them (tax); or, with the till's rate instead (taxPercent), the
    // cash and card include tax: it is worked out from their sum and taken off each in proportion,
    // so the three add back up to what was entered.
    public static (decimal Cash, decimal Card, decimal Tax) Takings(decimal cash, decimal card, decimal? tax, decimal? taxPercent = null)
    {
        if (cash < 0 || card < 0 || tax < 0)
            throw new DomainException("The cash, card, tax and voids are zero or more. · المبالغ صفر أو أكثر.");
        var (cashIn, cardIn) = (Round(cash), Round(card));
        if (cashIn + cardIn <= 0)
            throw new DomainException("Enter the day's cash or card takings. · أدخل إيراد الكاش أو الفيزا.");
        if (tax is { } collected)
        {
            if (collected > cashIn + cardIn)
                throw new DomainException("The tax collected cannot be more than the day's sales. · الضريبة لا تزيد عن إجمالي المبيعات.");
            return (cashIn, cardIn, Round(collected));
        }
        if (taxPercent is not { } rate)
            return (cashIn, cardIn, 0);
        var within = TaxIn(cashIn + cardIn, rate);
        var offCash = Round(within * cashIn / (cashIn + cardIn));
        return (cashIn - offCash, cardIn - (within - offCash), within);
    }

    private static decimal Round(decimal amount) => Math.Round(amount, 2, MidpointRounding.AwayFromZero);

    // The tax in a sum that includes it: the sum less the sum before tax, which is the sum over
    // (1 + rate), to the piastre. So the two always add back up to the sum.
    public static decimal TaxIn(decimal gross, decimal percent)
    {
        if (percent is < 0 or >= 100)
            throw new DomainException("A tax rate is a percentage from 0 up to 100.");
        return gross - Math.Round(gross / (1 + percent / 100m), 2, MidpointRounding.AwayFromZero);
    }

    public static SafeTransaction ExpenseVoucher(
        Guid id, decimal amount, DateOnly date, Guid expenseItemId, string? notes, string recordedBy, string? approvedBy = null) =>
        new(id, SafeTransactionKind.ExpenseVoucher, CashFund.Safe, -Positive(amount), date, notes, recordedBy, approvedBy)
        {
            ExpenseItemId = expenseItemId,
        };

    // Tax paid over to the tax authority (سداد ضرائب), out of the safe: what the takings collected for it.
    public static SafeTransaction TaxPayment(
        Guid id, decimal amount, DateOnly date, string? notes, string recordedBy, string? approvedBy = null) =>
        new(id, SafeTransactionKind.TaxPayment, CashFund.Safe, -Positive(amount), date, notes, recordedBy, approvedBy);

    // From the safe, or from a day's takings (revenueDate), as an invoice is: out of the drawer
    // until they are entered, out of the safe once they are in it (takingsInSafe).
    public static SafeTransaction SupplierPayment(
        Guid id, decimal amount, DateOnly date, Guid supplierId, string? notes, string recordedBy, string? approvedBy = null,
        DateOnly? revenueDate = null, bool takingsInSafe = false)
    {
        if (revenueDate > date)
            throw new DomainException("A supplier is paid from the takings of the payment's day or a day before it.");
        return new SafeTransaction(
            id, SafeTransactionKind.SupplierPayment, revenueDate is null || takingsInSafe ? CashFund.Safe : CashFund.DayRevenue, -Positive(amount),
            date, notes, recordedBy, approvedBy)
        {
            SupplierId = supplierId,
            RevenueDate = revenueDate,
        };
    }

    // From the safe, or from a day's takings (revenueDate): out of the drawer until they are
    // entered, out of the safe once they are in it (takingsInSafe).
    public static SafeTransaction InvoicePayment(
        Guid id, decimal amount, DateOnly date, Guid invoiceId, Guid? supplierId, DateOnly? revenueDate, string recordedBy, string? approvedBy = null,
        bool takingsInSafe = false)
    {
        if (revenueDate > date)
            throw new DomainException("An invoice is paid from the takings of its day or a day before it.");
        return new SafeTransaction(
            id, SafeTransactionKind.InvoicePayment, revenueDate is null || takingsInSafe ? CashFund.Safe : CashFund.DayRevenue, -Positive(amount),
            date, null, recordedBy, approvedBy)
        {
            PurchaseInvoiceId = invoiceId,
            SupplierId = supplierId,
            RevenueDate = revenueDate,
        };
    }

    // Out of the safe, or of a day's takings, as a supplier is paid. Deducted from the pay of
    // payrollMonth: the month it is paid in, or a later one when that month's payroll is closed.
    public static SafeTransaction EmployeeAdvance(
        Guid id, decimal amount, DateOnly date, Guid employeeId, DateOnly payrollMonth, string? notes, string recordedBy,
        string? approvedBy = null, DateOnly? revenueDate = null, bool takingsInSafe = false)
    {
        if (revenueDate > date)
            throw new DomainException("An advance is paid from the takings of its day or a day before it.");
        if (Month(payrollMonth) < new DateOnly(date.Year, date.Month, 1))
            throw new DomainException("An advance is deducted from the pay of the month it is paid in, or a later one.");
        return new SafeTransaction(
            id, SafeTransactionKind.EmployeeAdvance, revenueDate is null || takingsInSafe ? CashFund.Safe : CashFund.DayRevenue, -Positive(amount),
            date, notes, recordedBy, approvedBy)
        {
            EmployeeId = employeeId,
            PayrollMonth = payrollMonth,
            RevenueDate = revenueDate,
        };
    }

    // Advances handed out with no one named yet (السلفيات المعلقة): a lump sum out of the safe or a
    // day's takings, given out to employees later, a share each (HR's AdvanceAllocation). Deducted
    // from no one's pay until then.
    public static SafeTransaction PendingAdvance(
        Guid id, decimal amount, DateOnly date, string? notes, string recordedBy, string? approvedBy = null, DateOnly? revenueDate = null,
        bool takingsInSafe = false)
    {
        if (revenueDate > date)
            throw new DomainException("An advance is paid from the takings of its day or a day before it.");
        return new SafeTransaction(
            id, SafeTransactionKind.EmployeeAdvance, revenueDate is null || takingsInSafe ? CashFund.Safe : CashFund.DayRevenue, -Positive(amount),
            date, notes, recordedBy, approvedBy)
        {
            RevenueDate = revenueDate,
        };
    }

    // A month's pay, on or after the month starts.
    public static SafeTransaction SalaryPayment(
        Guid id, decimal amount, DateOnly date, Guid employeeId, DateOnly payrollMonth, string? notes, string recordedBy,
        string? approvedBy = null, DateOnly? revenueDate = null, bool takingsInSafe = false)
    {
        if (revenueDate > date)
            throw new DomainException("A salary is paid from the takings of its day or a day before it.");
        if (Month(payrollMonth) > date)
            throw new DomainException("A month's salary is paid once the month has started.");
        return new SafeTransaction(
            id, SafeTransactionKind.SalaryPayment, revenueDate is null || takingsInSafe ? CashFund.Safe : CashFund.DayRevenue, -Positive(amount),
            date, notes, recordedBy, approvedBy)
        {
            EmployeeId = employeeId,
            PayrollMonth = payrollMonth,
            RevenueDate = revenueDate,
        };
    }

    // A month's payroll from HR paid out of the safe in one: its net cash payable.
    public static SafeTransaction PayrollPayment(
        Guid id, decimal amount, DateOnly date, Guid payrollRunId, DateOnly payrollMonth, string? notes, string recordedBy, string? approvedBy = null)
    {
        if (Month(payrollMonth) > date)
            throw new DomainException("A month's payroll is paid once the month has started.");
        return new SafeTransaction(id, SafeTransactionKind.PayrollPayment, CashFund.Safe, -Positive(amount), date, notes, recordedBy, approvedBy)
        {
            PayrollMonth = payrollMonth,
            PayrollRunId = payrollRunId,
        };
    }

    // Voids it: the opposite amount, entered on `today`, naming it. Voiding again is refused. A
    // payment out of a day's takings made before they were entered goes back into the safe when
    // they are in it now (takingsInSafe): it was taken off what went in.
    public SafeTransaction Void(Guid reversalId, DateOnly today, string voidedBy, bool takingsInSafe = false)
    {
        if (IsReversal)
            throw new DomainException("A reversal is not voided again.");
        if (IsVoided)
            throw new DomainException("This has already been voided.");
        VoidedAtUtc = DateTime.UtcNow;
        VoidedBy = voidedBy;
        var fund = Fund == CashFund.DayRevenue && takingsInSafe ? CashFund.Safe : Fund;
        return new SafeTransaction(reversalId, Kind, fund, -Amount, today, "Voided", voidedBy, null)
        {
            GrossAmount = -GrossAmount,
            CardAmount = -CardAmount,
            VoidsAmount = -VoidsAmount,
            IncludesTax = IncludesTax,
            TaxPercent = TaxPercent,
            TaxAmount = -TaxAmount,
            RevenueDate = RevenueDate,
            Source = Source,
            SupplierId = SupplierId,
            PurchaseInvoiceId = PurchaseInvoiceId,
            ExpenseItemId = ExpenseItemId,
            EmployeeId = EmployeeId,
            PayrollMonth = PayrollMonth,
            PayrollRunId = PayrollRunId,
            ReversalOf = Id,
        };
    }

    private static decimal Positive(decimal amount) =>
        amount > 0 ? Math.Round(amount, 2, MidpointRounding.AwayFromZero) : throw new DomainException("Enter an amount more than nothing.");

    private static DateOnly Month(DateOnly month) =>
        month.Day == 1 ? month : throw new DomainException("A payroll month is named by its first day.");

    private static FundingSource Defined(FundingSource source) =>
        Enum.IsDefined(source) ? source : throw new DomainException("Say where the money came from.");
}

public interface ISafeTransactionRepository : IRepository<SafeTransaction>
{
    // The safe's balance: everything in and out of it, up to and including `through` when given.
    Task<decimal> SafeBalanceAsync(DateOnly? through = null, CancellationToken cancellationToken = default);

    // A day's takings as entered, if they are and are not voided since.
    Task<SafeTransaction?> GetTakingsAsync(DateOnly revenueDate, CancellationToken cancellationToken = default);

    // What was paid straight out of a day's takings while they were not in the safe: what is taken
    // off them when they are entered.
    Task<decimal> PaidOutOfTakingsAsync(DateOnly revenueDate, CancellationToken cancellationToken = default);

    // What an invoice's cash payment is, if it was paid in cash and not voided since.
    Task<SafeTransaction?> GetPaymentOfInvoiceAsync(Guid invoiceId, CancellationToken cancellationToken = default);

    // Of these invoices, the ones paid in cash and not voided since.
    Task<IReadOnlySet<Guid>> PaidInvoicesAsync(IReadOnlyCollection<Guid> invoiceIds, CancellationToken cancellationToken = default);

    Task<bool> AnyOpeningBalanceAsync(CancellationToken cancellationToken = default);

    // The tax the takings collected, less what was paid over (TaxPayment): still owed, and held in
    // the safe for it. Voids net out with what they undo.
    Task<decimal> TaxOwedAsync(CancellationToken cancellationToken = default);

    // An employee's advances and salary payments counted in a payroll month, voids and their
    // reversals too: everyone's, or one employee's.
    Task<IReadOnlyList<SafeTransaction>> GetForPayrollMonthAsync(DateOnly month, Guid? employeeId = null, CancellationToken cancellationToken = default);

    // Advances handed out with no one named, not voided: every one, given out or not.
    Task<IReadOnlyList<SafeTransaction>> GetPendingAdvancesAsync(CancellationToken cancellationToken = default);
}
```


`SupplierLedgerEntry`: الرصيد الافتتاحي للمورد (ما كان مستحقًا قبل بدء النظام).

> 📄 **`backend/src/Costing.Domain/Treasury/SupplierLedgerEntry.cs`** — 83 سطر

```csharp
using Costing.Domain.Common;

namespace Costing.Domain.Treasury;

public enum SupplierLedgerKind
{
    // What was owed to the supplier when the treasury started: invoices from before it.
    OpeningBalance = 1,

    // An invoice bought on credit (آجل): owed until paid.
    CreditInvoice = 2,

    // A payment voucher: paid from the safe.
    Payment = 3,
}

// One line of a supplier's account (كشف حساب): what the restaurant came to owe them and what it
// paid. Amount is signed: a credit invoice adds to the debt, a payment takes from it. Kept as
// entered; a voided invoice or payment is undone by a reversing line, dated the day it is voided.
//
// Each line is about one record (SourceId): the invoice, the payment voucher, or the opening
// balance's own id; so a retry writes it once.
public sealed class SupplierLedgerEntry : AggregateRoot
{
    private SupplierLedgerEntry() { }

    private SupplierLedgerEntry(Guid supplierId, SupplierLedgerKind kind, decimal amount, DateOnly businessDate, Guid sourceId, string recordedBy)
    {
        SupplierId = supplierId;
        Kind = kind;
        Amount = Math.Round(amount, 2, MidpointRounding.AwayFromZero);
        BusinessDate = businessDate;
        SourceId = sourceId;
        RecordedBy = recordedBy;
        RecordedAtUtc = DateTime.UtcNow;
    }

    public Guid SupplierId { get; private set; }
    public SupplierLedgerKind Kind { get; private set; }

    // Positive: owed more; negative: owed less.
    public decimal Amount { get; private set; }

    public DateOnly BusinessDate { get; private set; }

    // The invoice, the payment voucher (its safe transaction), or the opening balance.
    public Guid SourceId { get; private set; }

    public string RecordedBy { get; private set; } = string.Empty;
    public DateTime RecordedAtUtc { get; private set; }
    public Guid? ReversalOf { get; private set; }
    public bool IsReversal => ReversalOf is not null;

    public static SupplierLedgerEntry Opening(Guid id, Guid supplierId, decimal owed, DateOnly date, string recordedBy) =>
        owed > 0
            ? new SupplierLedgerEntry(supplierId, SupplierLedgerKind.OpeningBalance, owed, date, id, recordedBy) { Id = id }
            : throw new DomainException("Enter what is owed to the supplier, more than nothing.");

    public static SupplierLedgerEntry CreditInvoice(Guid supplierId, Guid invoiceId, decimal total, DateOnly date, string recordedBy) =>
        total > 0
            ? new SupplierLedgerEntry(supplierId, SupplierLedgerKind.CreditInvoice, total, date, invoiceId, recordedBy)
            : throw new DomainException("An invoice on credit needs a total more than nothing.");

    public static SupplierLedgerEntry Payment(SafeTransaction payment) =>
        payment is { Kind: SafeTransactionKind.SupplierPayment, SupplierId: { } supplierId, IsReversal: false }
            ? new SupplierLedgerEntry(supplierId, SupplierLedgerKind.Payment, payment.Amount, payment.BusinessDate, payment.Id, payment.RecordedBy)
            : throw new DomainException("Only a supplier payment is paid against a supplier's account.");

    // The opposite line, dated `today`, naming this one.
    public SupplierLedgerEntry Reverse(DateOnly today, string by) =>
        IsReversal
            ? throw new DomainException("A reversal is not reversed again.")
            : new SupplierLedgerEntry(SupplierId, Kind, -Amount, today, SourceId, by) { ReversalOf = Id };
}

public interface ISupplierLedgerRepository : IRepository<SupplierLedgerEntry>
{
    // What is owed to the supplier now: every line added up.
    Task<decimal> BalanceAsync(Guid supplierId, CancellationToken cancellationToken = default);

    // The lines about one record, reversals too.
    Task<IReadOnlyList<SupplierLedgerEntry>> GetBySourceAsync(Guid sourceId, CancellationToken cancellationToken = default);
}
```


## 11. تقفيل اليوم

`EndOfDayReport`: يوم واحد لكل فرع: الفواتير (نقدي من الدرج أو آجل) بصورها، **المدفوعات من الدرج** (`EndOfDayPayout`: سداد مورد أو سلفة موظف، كلٌّ بإيصاله)، المبيعات (كاش، فيزا، ضريبة، إلغاءات)، و **العُهدة/الفكة** (`OpeningFloat`). ومعادلاته (شرحها في الفصل 05):

```text
CashSalesCollected = الكاش + ضريبة الكاش
CashPaidOut        = فواتير نقدية + سداد موردين + سلف موظفين
NetCashInTill      = العُهدة + CashSalesCollected − CashPaidOut      (ما يجب أن يكون في الدرج)
ExpectedIntoSafe   = إجمالي الإيراد − CashPaidOut                    (ما يجب أن يصل الخزنة)
```

> 📄 **`backend/src/Costing.Domain/EndOfDay/EndOfDayReport.cs`** — 485 سطر

```csharp
using System.Globalization;
using Costing.Domain.Common;
using Costing.Domain.Purchases;

namespace Costing.Domain.EndOfDay;

public enum EndOfDayStatus
{
    // Being filled in: invoices added, changed or taken off, the sales typed.
    Draft = 1,

    // Handed in (تأكيد وإرسال التقفيل): kept as it is, for the daily batch and the takings, until a
    // manager reopens it.
    Submitted = 2,
}

// How an invoice handed in at the end of the day was paid.
public enum EndOfDayInvoiceKind
{
    // Paid in cash out of the day's takings (فواتير نقدية).
    Cash = 1,

    // Not paid: owed to the supplier (فواتير آجل).
    Credit = 2,
}

// Cash handed out of the till during the day, its receipt photographed: to a supplier against what
// the restaurant owes them (إذن صرف مورد), or to an employee as an advance on their pay (سلفة).
public enum EndOfDayPayoutKind
{
    SupplierPayment = 1,
    EmployeeAdvance = 2,
}

// A photo or scan handed in, described; its bytes are kept apart (IEndOfDayPhotoStore).
public sealed record EndOfDayPhoto(string FileName, string ContentType, int Bytes)
{
    public static EndOfDayPhoto Of(string? fileName, string contentType, int bytes)
    {
        if (!PurchaseInvoice.AttachmentTypes.Contains(contentType))
            throw new DomainException("Attach a photo (JPEG, PNG or WebP) or a PDF. · أرفق صورة أو ملف PDF.");
        if (bytes is <= 0 or > PurchaseInvoice.MaxAttachmentBytes)
            throw new DomainException("The file must be under 10 MB. · الملف أقل من 10 ميجا.");
        var name = string.IsNullOrWhiteSpace(fileName) ? "invoice" : Path.GetFileName(fileName.Trim());
        return new EndOfDayPhoto(name[..Math.Min(name.Length, 200)], contentType.ToLowerInvariant(), bytes);
    }
}

// A day's close (تقفيل اليوم) as the branch hands it in: each invoice paid in cash out of the
// takings, each bought on credit, every one with its paper photographed, its supplier and the total
// written on it; the cash handed out of the till to suppliers and as advances to employees, each
// with its receipt; and the day's Z report, its cash and Visa sales before tax, the tax on them and
// the voids, with a photo of it if there is one, and the float the drawer opened with. The invoices
// become purchase invoices on the daily batch, each transcribed from its photo, and the sales the
// day's takings on Financials; the payments and advances become the safe's entries out of the day's
// takings when it is handed in (Vouchered). One a business day.
//
// The cash that should be in the drawer (NetCashInTill) is the float, and the cash sales with the
// tax collected on them, less every payment out of it: the cash invoices, the suppliers paid and the
// advances. The Visa and any other takings never reach the drawer.
public sealed class EndOfDayReport : AggregateRoot
{
    public const int MaxInvoices = 50;
    public const int MaxNotes = 500;
    public const int MaxInvoiceNote = 200;
    public const int MaxPayouts = 50;

    private readonly List<EndOfDayInvoice> _invoices = [];
    private readonly List<EndOfDayPayout> _payouts = [];

    private EndOfDayReport() { }

    public EndOfDayReport(Guid id, DateOnly date, string createdBy)
    {
        Id = id;
        Date = date;
        Status = EndOfDayStatus.Draft;
        CreatedBy = createdBy;
        CreatedAtUtc = UpdatedAtUtc = DateTime.UtcNow;
        UpdatedBy = createdBy;
    }

    public DateOnly Date { get; private set; }
    public EndOfDayStatus Status { get; private set; }

    // The Z report: cash and Visa sales before tax, the tax collected on both, voids and refunds.
    public decimal? CashAmount { get; private set; }
    public decimal? CardAmount { get; private set; }
    public decimal? TaxAmount { get; private set; }
    public decimal? VoidsAmount { get; private set; }
    public string? Notes { get; private set; }

    // The cash the drawer opened the day with (العهدة / الفكة).
    public decimal? OpeningFloat { get; private set; }

    // The Z report's own photo, if one was handed in.
    public string? SalesPhotoFileName { get; private set; }
    public string? SalesPhotoContentType { get; private set; }
    public int? SalesPhotoBytes { get; private set; }
    public EndOfDayPhoto? SalesPhoto => SalesPhotoFileName is null ? null : new(SalesPhotoFileName, SalesPhotoContentType!, SalesPhotoBytes ?? 0);

    public DateTime CreatedAtUtc { get; private set; }
    public string CreatedBy { get; private set; } = string.Empty;
    public DateTime UpdatedAtUtc { get; private set; }
    public string UpdatedBy { get; private set; } = string.Empty;
    public DateTime? SubmittedAtUtc { get; private set; }
    public string? SubmittedBy { get; private set; }
    public DateTime? ReopenedAtUtc { get; private set; }
    public string? ReopenedBy { get; private set; }

    public IReadOnlyList<EndOfDayInvoice> Invoices => _invoices.OrderBy(i => i.AddedAtUtc).ToList().AsReadOnly();

    public IReadOnlyList<EndOfDayPayout> Payouts => _payouts.OrderBy(p => p.AddedAtUtc).ToList().AsReadOnly();

    public bool IsSubmitted => Status == EndOfDayStatus.Submitted;

    public decimal TotalOf(EndOfDayInvoiceKind kind) => _invoices.Where(i => i.Kind == kind).Sum(i => i.ReportedTotal);

    public int CountOf(EndOfDayInvoiceKind kind) => _invoices.Count(i => i.Kind == kind);

    public decimal TotalOf(EndOfDayPayoutKind kind) => _payouts.Where(p => p.Kind == kind).Sum(p => p.Amount);

    public int CountOf(EndOfDayPayoutKind kind) => _payouts.Count(p => p.Kind == kind);

    // Cash and Visa before tax: the day's revenue.
    public decimal NetSales => (CashAmount ?? 0) + (CardAmount ?? 0);

    // All the Z report took in, the tax with it: what goes into the safe before anything paid out.
    public decimal TotalRevenue => NetSales + (TaxAmount ?? 0);

    // The day's cash once the cash invoices were paid out of it.
    public decimal CashAfterInvoices => (CashAmount ?? 0) - TotalOf(EndOfDayInvoiceKind.Cash);

    // The tax collected on the cash sales: the Z report gives the tax on the cash and Visa together,
    // the cash's share of it is in proportion, as the safe splits a day's tax.
    public decimal CashTax => NetSales > 0 ? Math.Round((TaxAmount ?? 0) * (CashAmount ?? 0) / NetSales, 2, MidpointRounding.AwayFromZero) : 0;

    // The cash the sales put in the drawer: the cash sales with the tax collected on them.
    public decimal CashSalesCollected => (CashAmount ?? 0) + CashTax;

    // Everything paid out of the drawer: the cash invoices, the suppliers paid, the advances.
    public decimal CashPaidOut => TotalOf(EndOfDayInvoiceKind.Cash) + TotalOf(EndOfDayPayoutKind.SupplierPayment) + TotalOf(EndOfDayPayoutKind.EmployeeAdvance);

    // The cash that should be in the drawer at the close (الصافي الفعلي المتبقي في الكاش): the float
    // and the cash sales, less what was paid out of it. The Visa never reaches the drawer.
    public decimal NetCashInTill => (OpeningFloat ?? 0) + CashSalesCollected - CashPaidOut;

    // What should reach the safe: everything the day took in, less all that was paid out of it, as
    // the takings will show once the invoices are posted and the payments entered from them.
    public decimal ExpectedIntoSafe => TotalRevenue - CashPaidOut;

    public EndOfDayInvoice Invoice(Guid invoiceId) =>
        _invoices.SingleOrDefault(i => i.Id == invoiceId) ?? throw new NotFoundException("End-of-day invoice", invoiceId);

    public void RecordSales(decimal? cash, decimal? card, decimal? tax, decimal? voids, string? notes, string by, decimal? openingFloat = null)
    {
        EnsureDraft();
        if (new[] { cash, card, tax, voids }.Any(n => n < 0))
            throw new DomainException("The cash, Visa, tax and voids are zero or more. · المبالغ صفر أو أكثر.");
        if (openingFloat < 0)
            throw new DomainException("The opening float is zero or more. · العهدة صفر أو أكثر.");
        var cleaned = Clean(notes);
        if (cleaned?.Length > MaxNotes)
            throw new DomainException("Keep the notes under 500 characters. · الملاحظات 500 حرف على الأكثر.");
        CashAmount = Money(cash);
        CardAmount = Money(card);
        TaxAmount = Money(tax);
        VoidsAmount = Money(voids);
        OpeningFloat = Money(openingFloat);
        Notes = cleaned;
        Touch(by);
    }

    public EndOfDayInvoice AddInvoice(Guid id, EndOfDayInvoiceKind kind, Guid supplierId, decimal reportedTotal, string? note, EndOfDayPhoto photo, string by)
    {
        EnsureDraft();
        if (_invoices.Any(i => i.Id == id))
            throw new DomainException("This invoice is handed in already.");
        if (_invoices.Count >= MaxInvoices)
            throw new DomainException($"A day holds at most {MaxInvoices} invoices. · {MaxInvoices} فاتورة على الأكثر في اليوم.");
        var invoice = new EndOfDayInvoice(id, Id, kind, supplierId, reportedTotal, note, photo);
        _invoices.Add(invoice);
        Touch(by);
        return invoice;
    }

    public void ChangeInvoice(Guid invoiceId, EndOfDayInvoiceKind kind, Guid supplierId, decimal reportedTotal, string? note, string by)
    {
        EnsureDraft();
        Unposted(invoiceId).Change(kind, supplierId, reportedTotal, note);
        Touch(by);
    }

    public void ReplaceInvoicePhoto(Guid invoiceId, EndOfDayPhoto photo, string by)
    {
        EnsureDraft();
        Unposted(invoiceId).Photographed(photo);
        Touch(by);
    }

    public void RemoveInvoice(Guid invoiceId, string by)
    {
        EnsureDraft();
        _invoices.Remove(Unposted(invoiceId));
        Touch(by);
    }

    public EndOfDayPayout Payout(Guid payoutId) =>
        _payouts.SingleOrDefault(p => p.Id == payoutId) ?? throw new NotFoundException("End-of-day payment", payoutId);

    // Cash handed out of the till: to a supplier (payee: the supplier) or an employee (payee: the
    // employee), with its receipt.
    public EndOfDayPayout AddPayout(Guid id, EndOfDayPayoutKind kind, Guid payeeId, decimal amount, string? note, EndOfDayPhoto receipt, string by)
    {
        EnsureDraft();
        if (_payouts.Any(p => p.Id == id))
            throw new DomainException("This payment is handed in already.");
        if (_payouts.Count >= MaxPayouts)
            throw new DomainException($"A day holds at most {MaxPayouts} payments and advances. · {MaxPayouts} على الأكثر في اليوم.");
        var payout = new EndOfDayPayout(id, Id, kind, payeeId, amount, note, receipt);
        _payouts.Add(payout);
        Touch(by);
        return payout;
    }

    public void ChangePayout(Guid payoutId, Guid payeeId, decimal amount, string? note, string by)
    {
        EnsureDraft();
        Unvouchered(payoutId).Change(payeeId, amount, note);
        Touch(by);
    }

    // A clearer photo of its receipt: the money is as it was, so even once in the safe.
    public void ReplacePayoutReceipt(Guid payoutId, EndOfDayPhoto receipt, string by)
    {
        EnsureDraft();
        Payout(payoutId).Photographed(receipt);
        Touch(by);
    }

    // Taken off. One whose safe entry a manager refused can go too: nothing was entered for it.
    public void RemovePayout(Guid payoutId, string by, bool voucherRefused = false)
    {
        EnsureDraft();
        _payouts.Remove(voucherRefused ? Payout(payoutId) : Unvouchered(payoutId));
        Touch(by);
    }

    // Its safe entry made, or asked of a manager, once the day is handed in: kept as it is from then,
    // and corrected on the safe.
    public void Vouchered(Guid payoutId)
    {
        if (!IsSubmitted)
            throw new DomainException("The end of day is not submitted yet: its payments go to the safe once it is handed in.");
        Payout(payoutId).VoucheredOn();
    }

    public void AttachSalesPhoto(EndOfDayPhoto photo, string by)
    {
        EnsureDraft();
        (SalesPhotoFileName, SalesPhotoContentType, SalesPhotoBytes) = (photo.FileName, photo.ContentType, photo.Bytes);
        Touch(by);
    }

    public void RemoveSalesPhoto(string by)
    {
        EnsureDraft();
        (SalesPhotoFileName, SalesPhotoContentType, SalesPhotoBytes) = (null, null, null);
        Touch(by);
    }

    // Handed in: kept as it is from now. It needs the day's sales; a day with no invoice is one
    // nothing was bought on.
    public void Submit(string by)
    {
        EnsureDraft();
        if (NetSales <= 0)
            throw new DomainException("Enter the day's sales report: its cash or Visa takings. · أدخل ريبورت المبيعات: إيراد الكاش أو الفيزا.");
        if ((TaxAmount ?? 0) > NetSales)
            throw new DomainException("The tax collected cannot be more than the day's sales. · الضريبة لا تزيد عن إجمالي المبيعات.");
        Status = EndOfDayStatus.Submitted;
        SubmittedAtUtc = DateTime.UtcNow;
        SubmittedBy = by;
        Touch(by);
    }

    // A manager's: back to a draft, to be corrected and handed in again. What is posted already
    // stays posted, and is corrected on its own invoice.
    public void Reopen(string by)
    {
        if (!IsSubmitted)
            throw new DomainException("This end of day is not submitted: it can be changed as it is. · التقفيل لم يُرسل بعد.");
        Status = EndOfDayStatus.Draft;
        ReopenedAtUtc = DateTime.UtcNow;
        ReopenedBy = by;
        Touch(by);
    }

    // An invoice handed in, posted on the daily batch as the purchase invoice given.
    public void Posted(Guid invoiceId, Guid purchaseInvoiceId)
    {
        if (!IsSubmitted)
            throw new DomainException("Its end of day is not submitted yet: it is posted once it is handed in. · لم يتم إرسال تقفيل هذا اليوم بعد.");
        var invoice = Invoice(invoiceId);
        if (invoice.PurchaseInvoiceId is { } posted && posted != purchaseInvoiceId)
            throw new DomainException("It is posted already, as another purchase invoice. · مرحلة بالفعل في فاتورة أخرى.");
        invoice.PostedAs(purchaseInvoiceId);
    }

    private EndOfDayPayout Unvouchered(Guid payoutId)
    {
        var payout = Payout(payoutId);
        if (payout.VoucheredAtUtc is not null)
            throw new DomainException("It went to the safe when the day was handed in: correct it on Financials → Safe. · مسجل في الخزنة: عدّله من الخزنة.");
        return payout;
    }

    private EndOfDayInvoice Unposted(Guid invoiceId)
    {
        var invoice = Invoice(invoiceId);
        if (invoice.PurchaseInvoiceId is not null)
            throw new DomainException("It is posted already as a purchase invoice: correct that invoice instead. · مرحلة بالفعل: عدّل فاتورة الشراء.");
        return invoice;
    }

    private void EnsureDraft()
    {
        if (IsSubmitted)
            throw new DomainException(
                $"The end of day of {Date.ToString("d MMM yyyy", CultureInfo.InvariantCulture)} is submitted{(SubmittedBy is null ? "" : $" by {SubmittedBy}")}: a manager reopens it to change it. " +
                "· تم إرسال تقفيل هذا اليوم: يعيد المدير فتحه للتعديل.");
    }

    private void Touch(string by)
    {
        UpdatedAtUtc = DateTime.UtcNow;
        UpdatedBy = by;
    }

    private static decimal? Money(decimal? value) => value is { } v ? Math.Round(v, 2, MidpointRounding.AwayFromZero) : null;

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}

// One invoice handed in: how it was paid, who from, the total written on it, a short note, and its
// photo; once on the daily batch, the purchase invoice it was posted as.
public sealed class EndOfDayInvoice : Entity
{
    private EndOfDayInvoice() { }

    internal EndOfDayInvoice(Guid id, Guid reportId, EndOfDayInvoiceKind kind, Guid supplierId, decimal reportedTotal, string? note, EndOfDayPhoto photo)
    {
        Id = id;
        ReportId = reportId;
        AddedAtUtc = DateTime.UtcNow;
        Change(kind, supplierId, reportedTotal, note);
        Photographed(photo);
    }

    public Guid ReportId { get; private set; }
    public EndOfDayInvoiceKind Kind { get; private set; }
    public Guid SupplierId { get; private set; }
    public decimal ReportedTotal { get; private set; }
    public string? Note { get; private set; }
    public string PhotoFileName { get; private set; } = string.Empty;
    public string PhotoContentType { get; private set; } = string.Empty;
    public int PhotoBytes { get; private set; }
    public EndOfDayPhoto Photo => new(PhotoFileName, PhotoContentType, PhotoBytes);
    public DateTime AddedAtUtc { get; private set; }

    // The purchase invoice it was posted as on the daily batch, and when.
    public Guid? PurchaseInvoiceId { get; private set; }
    public DateTime? PostedAtUtc { get; private set; }

    internal void Change(EndOfDayInvoiceKind kind, Guid supplierId, decimal reportedTotal, string? note)
    {
        if (!Enum.IsDefined(kind))
            throw new DomainException("Say whether it was paid in cash or is on credit. · نقدي أم آجل.");
        if (supplierId == Guid.Empty)
            throw new DomainException("Choose the supplier. · اختر المورد.");
        if (reportedTotal <= 0)
            throw new DomainException("Enter the invoice's total, more than nothing. · أدخل إجمالي الفاتورة.");
        var cleaned = string.IsNullOrWhiteSpace(note) ? null : note.Trim();
        if (cleaned?.Length > EndOfDayReport.MaxInvoiceNote)
            throw new DomainException("Keep the note under 200 characters. · الملاحظة 200 حرف على الأكثر.");
        Kind = kind;
        SupplierId = supplierId;
        ReportedTotal = Math.Round(reportedTotal, 2, MidpointRounding.AwayFromZero);
        Note = cleaned;
    }

    internal void Photographed(EndOfDayPhoto photo) =>
        (PhotoFileName, PhotoContentType, PhotoBytes) = (photo.FileName, photo.ContentType, photo.Bytes);

    internal void PostedAs(Guid purchaseInvoiceId)
    {
        PurchaseInvoiceId = purchaseInvoiceId;
        PostedAtUtc ??= DateTime.UtcNow;
    }
}

// Cash handed out of the till: to a supplier or an employee, the amount, a short note and its
// receipt (إيصال السداد / إيصال صرف السلفة); once the day is handed in, when its safe entry was made
// (or asked of a manager), the entry's id being the payment's own.
public sealed class EndOfDayPayout : Entity
{
    private EndOfDayPayout() { }

    internal EndOfDayPayout(Guid id, Guid reportId, EndOfDayPayoutKind kind, Guid payeeId, decimal amount, string? note, EndOfDayPhoto receipt)
    {
        if (!Enum.IsDefined(kind))
            throw new DomainException("Say whether a supplier was paid or an employee advanced. · مورد أم سلفة.");
        Id = id;
        ReportId = reportId;
        Kind = kind;
        AddedAtUtc = DateTime.UtcNow;
        Change(payeeId, amount, note);
        Photographed(receipt);
    }

    public Guid ReportId { get; private set; }
    public EndOfDayPayoutKind Kind { get; private set; }
    public Guid? SupplierId { get; private set; }
    public Guid? EmployeeId { get; private set; }
    public decimal Amount { get; private set; }
    public string? Note { get; private set; }
    public string ReceiptFileName { get; private set; } = string.Empty;
    public string ReceiptContentType { get; private set; } = string.Empty;
    public int ReceiptBytes { get; private set; }
    public EndOfDayPhoto Receipt => new(ReceiptFileName, ReceiptContentType, ReceiptBytes);
    public DateTime AddedAtUtc { get; private set; }

    // When its safe entry was made or asked for: the day handed in.
    public DateTime? VoucheredAtUtc { get; private set; }

    // Who was paid: the supplier, or the employee.
    public Guid PayeeId => (Kind == EndOfDayPayoutKind.SupplierPayment ? SupplierId : EmployeeId) ?? Guid.Empty;

    internal void Change(Guid payeeId, decimal amount, string? note)
    {
        if (payeeId == Guid.Empty)
            throw new DomainException(Kind == EndOfDayPayoutKind.SupplierPayment ? "Choose the supplier. · اختر المورد." : "Choose the employee. · اختر الموظف.");
        if (amount <= 0)
            throw new DomainException("Enter the amount paid, more than nothing. · أدخل المبلغ المدفوع.");
        var cleaned = string.IsNullOrWhiteSpace(note) ? null : note.Trim();
        if (cleaned?.Length > EndOfDayReport.MaxInvoiceNote)
            throw new DomainException("Keep the note under 200 characters. · الملاحظة 200 حرف على الأكثر.");
        var toSupplier = Kind == EndOfDayPayoutKind.SupplierPayment;
        SupplierId = toSupplier ? payeeId : null;
        EmployeeId = toSupplier ? null : payeeId;
        Amount = Math.Round(amount, 2, MidpointRounding.AwayFromZero);
        Note = cleaned;
    }

    internal void Photographed(EndOfDayPhoto receipt) =>
        (ReceiptFileName, ReceiptContentType, ReceiptBytes) = (receipt.FileName, receipt.ContentType, receipt.Bytes);

    internal void VoucheredOn() => VoucheredAtUtc ??= DateTime.UtcNow;
}

// Returns each day with its Invoices and Payouts loaded.
public interface IEndOfDayRepository : IRepository<EndOfDayReport>
{
    Task<EndOfDayReport?> GetByDateAsync(DateOnly date, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<EndOfDayReport>> GetBetweenAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken = default);

    // The day an invoice was handed in on.
    Task<EndOfDayReport?> GetByInvoiceAsync(Guid invoiceId, CancellationToken cancellationToken = default);

    // The day a payment or advance was handed in on.
    Task<EndOfDayReport?> GetByPayoutAsync(Guid payoutId, CancellationToken cancellationToken = default);
}

// The photos handed in, kept apart from the days so a list of them never loads a megabyte each:
// an invoice's or a payment's receipt by its id, the Z report's by its day's. Written in the same
// unit of work.
public interface IEndOfDayPhotoStore
{
    void Put(Guid id, byte[] content);

    Task<byte[]?> GetAsync(Guid id, CancellationToken cancellationToken = default);

    void Remove(Guid id);
}
```


## 12. الموظفون

`StaffMember`: اسم ووظيفة فقط (الموظف نفسه ملك نظام HR). `PayrollRun`: مسير شهر معتمد من HR (تكلفة العمالة وصافي النقدية)، و `StaffDeduction` (عجز خزنة/خصم على موظف).

> 📄 **`backend/src/Costing.Domain/Staff/StaffMember.cs`** — 50 سطر

```csharp
using Costing.Domain.Common;

namespace Costing.Domain.Staff;

// Someone the safe pays: an advance (سلفة) or a salary (صرف راتب). Only a name and a job here: the
// people themselves, their attendance and their pay, are an HR system's. Kept when they leave, as
// the safe's entries name them.
public sealed class StaffMember : AggregateRoot
{
    public const int MaxNameLength = 200;

    private StaffMember() { }

    public StaffMember(Guid id, string name, string? jobTitle)
    {
        Id = id;
        Change(name, jobTitle);
        CreatedAtUtc = DateTime.UtcNow;
    }

    public string Name { get; private set; } = string.Empty;
    public string? JobTitle { get; private set; }
    public bool IsActive { get; private set; } = true;
    public DateTime CreatedAtUtc { get; private set; }

    public void Change(string name, string? jobTitle)
    {
        var clean = name?.Trim();
        if (string.IsNullOrEmpty(clean))
            throw new DomainException("Name them.");
        if (clean.Length > MaxNameLength)
            throw new DomainException($"Keep the name under {MaxNameLength} characters.");
        var job = string.IsNullOrWhiteSpace(jobTitle) ? null : jobTitle.Trim();
        if (job?.Length > 100)
            throw new DomainException("Keep the job title under 100 characters.");
        Name = clean;
        JobTitle = job;
    }

    // Left: off the lists for new entries, still named on the old ones.
    public void Deactivate() => IsActive = false;

    public void Reactivate() => IsActive = true;
}

public interface IStaffMemberRepository : IRepository<StaffMember>
{
    // Left ones too, by name.
    Task<IReadOnlyList<StaffMember>> GetAllAsync(CancellationToken cancellationToken = default);
}
```


> 📄 **`backend/src/Costing.Domain/Staff/PayrollRun.cs`** — 220 سطر

```csharp
using System.Globalization;
using Costing.Domain.Common;

namespace Costing.Domain.Staff;

public enum PayrollRunStatus
{
    // Approved on HR and sent here: owed to the staff, to be paid out of the safe.
    Payable = 1,

    // Paid out of the safe (SafeTransactionId), and HR told so.
    Disbursed = 2,
}

// A month's payroll approved on HR and sent here (مسير رواتب معتمد), by HR's own id for it (Id, the
// idempotency key): what the work cost (LaborCost, for the profit and loss and the prime cost), how
// it was made (the base wages, what was added, the penalties) and what is still to be paid in cash
// (NetCashPayable): the pay less the advances already paid out of the safe during the month, so
// none is paid twice. By department too. Paid out of the safe as one entry (Disbursed); sent again
// as it was, nothing changes; sent changed while still to be paid, it is replaced; once paid, it
// cannot be.
public sealed class PayrollRun : AggregateRoot
{
    private readonly List<PayrollRunDepartment> _departments = [];

    private PayrollRun() { }

    public PayrollRun(Guid id, DateOnly period, string payloadHash)
    {
        if (id == Guid.Empty)
            throw new DomainException("A payroll run needs HR's id for it.");
        Id = id;
        Period = Month(period);
        PayloadHash = payloadHash;
        Status = PayrollRunStatus.Payable;
        ReceivedAtUtc = UpdatedAtUtc = DateTime.UtcNow;
        Revision = 1;
    }

    // The month it pays, by its first day.
    public DateOnly Period { get; private set; }
    public int Employees { get; private set; }
    public decimal TotalGrossWages { get; private set; }
    public decimal TotalAdditions { get; private set; }
    public decimal TotalPenalties { get; private set; }
    public decimal TotalAdvancesDeducted { get; private set; }
    // Last month's shortfall, settled from this month's pay: owed by the staff, not a cost.
    public decimal TotalBroughtForward { get; private set; }
    public decimal NetCashPayable { get; private set; }
    public decimal LaborCost { get; private set; }
    public string PayloadHash { get; private set; } = string.Empty;
    public int Revision { get; private set; }
    public PayrollRunStatus Status { get; private set; }
    public DateTime ReceivedAtUtc { get; private set; }
    public DateTime UpdatedAtUtc { get; private set; }
    public Guid? SafeTransactionId { get; private set; }
    public DateTime? DisbursedAtUtc { get; private set; }
    public string? DisbursedBy { get; private set; }

    public IReadOnlyList<PayrollRunDepartment> Departments => _departments.OrderBy(d => d.Name).ToList().AsReadOnly();

    public bool IsDisbursed => Status == PayrollRunStatus.Disbursed;

    public string PeriodName => Period.ToString("MMMM yyyy", CultureInfo.InvariantCulture);

    // Its figures as HR sent them; the labor cost is the base wages and what was added, less the
    // penalties: what the month's work cost the business.
    public void Set(
        int employees, decimal grossWages, decimal additions, decimal penalties, decimal advancesDeducted, decimal broughtForward, decimal netCashPayable,
        IReadOnlyList<PayrollRunDepartment> departments, string payloadHash)
    {
        if (IsDisbursed)
            throw new DomainException($"The payroll of {PeriodName} is paid out of the safe already: void that payment first to change it. · المسير مصروف بالفعل.");
        if (new[] { grossWages, additions, penalties, advancesDeducted, broughtForward, netCashPayable }.Any(n => n < 0) || employees < 0)
            throw new DomainException("A payroll's figures are zero or more.");
        Employees = employees;
        TotalGrossWages = Money(grossWages);
        TotalAdditions = Money(additions);
        TotalPenalties = Money(penalties);
        TotalAdvancesDeducted = Money(advancesDeducted);
        TotalBroughtForward = Money(broughtForward);
        NetCashPayable = Money(netCashPayable);
        LaborCost = Money(grossWages + additions - penalties);
        _departments.Clear();
        _departments.AddRange(departments);
        // Sent changed: a new revision of it.
        if (PayloadHash != payloadHash)
            Revision++;
        PayloadHash = payloadHash;
        UpdatedAtUtc = DateTime.UtcNow;
    }

    // Paid out of the safe by the entry given.
    public void Disbursed(Guid safeTransactionId, string by)
    {
        if (IsDisbursed && SafeTransactionId != safeTransactionId)
            throw new DomainException($"The payroll of {PeriodName} is paid already. · المسير مصروف بالفعل.");
        Status = PayrollRunStatus.Disbursed;
        SafeTransactionId = safeTransactionId;
        DisbursedAtUtc ??= DateTime.UtcNow;
        DisbursedBy ??= by;
    }

    // Its payment voided: owed again.
    public void Undisbursed()
    {
        Status = PayrollRunStatus.Payable;
        SafeTransactionId = null;
        DisbursedAtUtc = null;
        DisbursedBy = null;
    }

    public static DateOnly Month(DateOnly day) => new(day.Year, day.Month, 1);

    private static decimal Money(decimal value) => Math.Round(value, 2, MidpointRounding.AwayFromZero);
}

// A department's share of a payroll run, as HR named the department.
public sealed class PayrollRunDepartment : Entity
{
    private PayrollRunDepartment() { }

    public PayrollRunDepartment(string name, int employees, decimal grossWages, decimal additions, decimal penalties, decimal advancesDeducted,
        decimal netCashPayable)
    {
        Id = Guid.NewGuid();
        Name = string.IsNullOrWhiteSpace(name) ? "General" : name.Trim() is { Length: > 100 } n ? n[..100] : name.Trim();
        Employees = employees;
        GrossWages = Math.Round(grossWages, 2, MidpointRounding.AwayFromZero);
        Additions = Math.Round(additions, 2, MidpointRounding.AwayFromZero);
        Penalties = Math.Round(penalties, 2, MidpointRounding.AwayFromZero);
        AdvancesDeducted = Math.Round(advancesDeducted, 2, MidpointRounding.AwayFromZero);
        NetCashPayable = Math.Round(netCashPayable, 2, MidpointRounding.AwayFromZero);
    }

    public Guid PayrollRunId { get; private set; }
    public string Name { get; private set; } = string.Empty;
    public int Employees { get; private set; }
    public decimal GrossWages { get; private set; }
    public decimal Additions { get; private set; }
    public decimal Penalties { get; private set; }
    public decimal AdvancesDeducted { get; private set; }
    public decimal NetCashPayable { get; private set; }
    public decimal LaborCost => GrossWages + Additions - Penalties;
}

public enum StaffDeductionKind
{
    // The till short at the close (عجز خزنة), charged to who kept it.
    TillShortage = 1,

    // Something charged to an employee: a breakage, a meal, a loss (خصم على الموظف).
    StaffCharge = 2,
}

// An amount charged to an employee, to come off their pay: a till shortage or a staff charge. Kept
// here as a record (this system pays what HR says), and sent to HR, when linked, as a deduction
// from their pay. Voided, it is taken off there too.
public sealed class StaffDeduction : AggregateRoot
{
    public const int MaxReasonLength = 300;

    private StaffDeduction() { }

    public StaffDeduction(Guid id, Guid employeeId, DateOnly date, StaffDeductionKind kind, decimal amount, string? reason, string recordedBy)
    {
        if (employeeId == Guid.Empty)
            throw new DomainException("Choose the employee. · اختر الموظف.");
        if (!Enum.IsDefined(kind))
            throw new DomainException("Say whether it is a till shortage or a staff charge. · عجز خزنة أم خصم.");
        if (amount <= 0)
            throw new DomainException("Enter the amount, more than nothing. · أدخل المبلغ.");
        var why = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim();
        if (why?.Length > MaxReasonLength)
            throw new DomainException($"Keep the reason under {MaxReasonLength} characters.");
        Id = id;
        EmployeeId = employeeId;
        Date = date;
        Kind = kind;
        Amount = Math.Round(amount, 2, MidpointRounding.AwayFromZero);
        Reason = why;
        RecordedBy = recordedBy;
        RecordedAtUtc = DateTime.UtcNow;
    }

    public Guid EmployeeId { get; private set; }
    public DateOnly Date { get; private set; }
    public StaffDeductionKind Kind { get; private set; }
    public decimal Amount { get; private set; }
    public string? Reason { get; private set; }
    public string RecordedBy { get; private set; } = string.Empty;
    public DateTime RecordedAtUtc { get; private set; }
    public DateTime? VoidedAtUtc { get; private set; }
    public string? VoidedBy { get; private set; }
    public bool IsVoided => VoidedAtUtc is not null;

    public void Void(string by)
    {
        if (IsVoided)
            throw new DomainException("This deduction is voided already.");
        VoidedAtUtc = DateTime.UtcNow;
        VoidedBy = by;
    }
}

public interface IPayrollRunRepository : IRepository<PayrollRun>
{
    // The latest first.
    Task<IReadOnlyList<PayrollRun>> GetRecentAsync(int take, CancellationToken cancellationToken = default);

    // The run of a month, if one was sent.
    Task<PayrollRun?> GetForPeriodAsync(DateOnly period, CancellationToken cancellationToken = default);

    void Remove(PayrollRun run);
}

public interface IStaffDeductionRepository : IRepository<StaffDeduction>
{
    Task<IReadOnlyList<StaffDeduction>> GetBetweenAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken = default);
}
```


---

## 13. EF Core

### 13.1 الاتصال

`DATABASE_URL` (صيغة `postgres://user:pass@host:port/db` كما تعطيها Railway) أو `ConnectionStrings:Costing`.

> 📄 **`backend/src/Costing.Infrastructure/Persistence/DatabaseConnection.cs`** — 47 سطر

```csharp
using Microsoft.Extensions.Configuration;
using Npgsql;

namespace Costing.Infrastructure.Persistence;

// The database to use: DATABASE_URL when it is set (postgres://user:password@host:port/database,
// as Railway, Render and Heroku give it), else ConnectionStrings:Costing.
public static class DatabaseConnection
{
    public const string UrlVariable = "DATABASE_URL";

    public static string Resolve(IConfiguration configuration)
    {
        if (configuration[UrlVariable] is { Length: > 0 } url)
            return FromUrl(url);
        return configuration.GetConnectionString(DependencyInjection.ConnectionStringName) is { Length: > 0 } connectionString
            ? connectionString
            : throw new InvalidOperationException(
                $"No database: set {UrlVariable} (postgres://user:password@host:port/database) or ConnectionStrings:{DependencyInjection.ConnectionStringName}.");
    }

    // "postgresql://postgres:secret@postgres.railway.internal:5432/railway?sslmode=require" as
    // Npgsql takes it. The user name and password may be percent-encoded.
    public static string FromUrl(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme is not ("postgres" or "postgresql"))
            throw new InvalidOperationException($"{UrlVariable} is not a postgres:// address.");

        var credentials = uri.UserInfo.Split(':', 2);
        var builder = new NpgsqlConnectionStringBuilder
        {
            Host = uri.Host,
            Port = uri.IsDefaultPort || uri.Port <= 0 ? 5432 : uri.Port,
            Database = Uri.UnescapeDataString(uri.AbsolutePath.TrimStart('/')),
            Username = Uri.UnescapeDataString(credentials[0]),
            Password = credentials.Length > 1 ? Uri.UnescapeDataString(credentials[1]) : null,
        };
        foreach (var pair in uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var (key, value) = pair.Split('=', 2) is [var k, var v] ? (k, Uri.UnescapeDataString(v)) : (pair, string.Empty);
            if (key.Equals("sslmode", StringComparison.OrdinalIgnoreCase) && Enum.TryParse<SslMode>(value.Replace("-", string.Empty), ignoreCase: true, out var mode))
                builder.SslMode = mode;
        }

        return builder.ConnectionString;
    }
}
```


### 13.2 `CostingDbContext`: شرح سطر بسطر

- `public sealed class CostingDbContext(...) : DbContext(options), IUnitOfWork`: الـ DbContext **هو** وحدة العمل.
- `CostingSchema = "costing"`, `IdentitySchema = "identity"`.
- `ConfigureNpgsql`: استعلام واحد (`SingleQuery`)، وجدول تاريخ الـ migrations داخل `costing` **بالاسم**: مستخدم قاعدة بيانات اسمه `costing` يجعل `"$user"` في `search_path` يشير إلى schema `costing`، فلو تُرك الجدول للبحث الافتراضي قد لا يُوجد فتُعاد كل الـ migrations!
- `DbSet<…>` لكل جدول.
- `OnModelCreating`: `ApplyConfigurationsFromAssembly` (يجد كل إعدادات الجداول تلقائيًا)، ثم حلقة: `Id` لا تولّده القاعدة، `DomainEvents` لا تُخزَّن، و `Version` ⇐ `xmin` للتزامن.
- `ConfigureConventions`: كل `decimal` بدقة (10,2) افتراضيًا (والكميات تتجاوزه صراحة بـ `IsQuantity()`).
- `SaveChangesAsync`: `TouchRootsOfChangedChildren` (تعديل ابن يعلّم أباه معدّلًا ليُفحص `xmin` الخاص به)، وترجمة أخطاء EF/Npgsql (تزامن، تكرار فريد، مفتاح أجنبي) إلى `ConflictException`، فلا تعرف الطبقات العليا شيئًا عن EF.

> 📄 **`backend/src/Costing.Infrastructure/Persistence/CostingDbContext.cs`** — 168 سطر

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Infrastructure;
using Npgsql;
using Costing.Domain.Common;
using Costing.Domain.Access;
using Costing.Domain.Approvals;
using Costing.Domain.Categories;
using Costing.Domain.EndOfDay;
using Costing.Domain.Expenses;
using Costing.Domain.Menu;
using Costing.Domain.Production;
using Costing.Domain.Purchases;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;
using Costing.Domain.Sales;
using Costing.Domain.Staff;
using Costing.Domain.StockCounts;
using Costing.Domain.StockMovements;
using Costing.Domain.Suppliers;
using Costing.Domain.Treasury;
using Costing.Domain.Waste;
using Costing.Infrastructure.Identity;
using Costing.Infrastructure.Reports;

namespace Costing.Infrastructure.Persistence;

// The Costing & Financials database: the raw materials and their stock, recipes and prep items,
// the menu and its sales, purchases and suppliers, counts and waste, the safe, the approvals a
// manager gives, and the system's users.
public sealed class CostingDbContext(DbContextOptions<CostingDbContext> options) : DbContext(options), IUnitOfWork
{
    // Everything in one schema; the system's users apart.
    public const string CostingSchema = "costing";
    public const string IdentitySchema = "identity";

    // The app's and the design-time tools' own setup. The history of migrations is kept in the
    // costing schema by name: left to the search path, a database user named costing (whose
    // "$user" schema is costing once the first migration makes it) would look there, find none,
    // and apply them again.
    public static void ConfigureNpgsql(NpgsqlDbContextOptionsBuilder npgsql) => npgsql
        .UseQuerySplittingBehavior(QuerySplittingBehavior.SingleQuery)
        .MigrationsHistoryTable(HistoryRepository.DefaultTableName, CostingSchema);

    public DbSet<MenuCategory> MenuCategories => Set<MenuCategory>();
    public DbSet<MenuItem> MenuItems => Set<MenuItem>();
    public DbSet<MenuItemVariant> MenuItemVariants => Set<MenuItemVariant>();
    public DbSet<AddOn> AddOns => Set<AddOn>();
    public DbSet<SalesReceipt> SalesReceipts => Set<SalesReceipt>();
    public DbSet<StaffMember> Staff => Set<StaffMember>();

    public DbSet<RawMaterial> RawMaterials => Set<RawMaterial>();
    public DbSet<Recipe> Recipes => Set<Recipe>();
    public DbSet<RecipeCategory> RecipeCategories => Set<RecipeCategory>();
    public DbSet<StockMovement> StockMovements => Set<StockMovement>();
    public DbSet<StockCount> StockCounts => Set<StockCount>();
    public DbSet<PurchaseInvoice> PurchaseInvoices => Set<PurchaseInvoice>();
    public DbSet<PurchaseInvoiceAttachment> PurchaseInvoiceAttachments => Set<PurchaseInvoiceAttachment>();
    public DbSet<Supplier> Suppliers => Set<Supplier>();
    public DbSet<PurchaseCategory> PurchaseCategories => Set<PurchaseCategory>();
    public DbSet<ExpenseItem> ExpenseItems => Set<ExpenseItem>();
    public DbSet<ApprovalRequest> ApprovalRequests => Set<ApprovalRequest>();
    public DbSet<SafeTransaction> SafeTransactions => Set<SafeTransaction>();
    public DbSet<SupplierLedgerEntry> SupplierLedgerEntries => Set<SupplierLedgerEntry>();
    public DbSet<PrepRecipe> PrepRecipes => Set<PrepRecipe>();
    public DbSet<ProductionOrder> ProductionOrders => Set<ProductionOrder>();
    public DbSet<BreakageEntry> BreakageEntries => Set<BreakageEntry>();
    public DbSet<CostingSettings> CostingSettings => Set<CostingSettings>();
    public DbSet<FinancialSettings> FinancialSettings => Set<FinancialSettings>();
    public DbSet<SharedCost> SharedCosts => Set<SharedCost>();
    public DbSet<MonthlyExpenses> MonthlyExpenses => Set<MonthlyExpenses>();
    public DbSet<ManualSalesSheet> ManualSalesSheets => Set<ManualSalesSheet>();
    public DbSet<EndOfDayReport> EndOfDayReports => Set<EndOfDayReport>();
    public DbSet<EndOfDayPhotoContent> EndOfDayPhotos => Set<EndOfDayPhotoContent>();
    public DbSet<Domain.Integrations.PosLink> PosLinks => Set<Domain.Integrations.PosLink>();
    public DbSet<Domain.Integrations.PosZReport> PosZReports => Set<Domain.Integrations.PosZReport>();
    public DbSet<Domain.Integrations.PosDay> PosDays => Set<Domain.Integrations.PosDay>();
    public DbSet<Domain.Integrations.PosSyncLog> PosSyncLogs => Set<Domain.Integrations.PosSyncLog>();
    public DbSet<Domain.Integrations.HrLink> HrLinks => Set<Domain.Integrations.HrLink>();
    public DbSet<Domain.Integrations.SyncedEmployee> SyncedEmployees => Set<Domain.Integrations.SyncedEmployee>();
    public DbSet<Domain.Integrations.HrSyncLog> HrSyncLogs => Set<Domain.Integrations.HrSyncLog>();
    public DbSet<Domain.Integrations.HrOutboxItem> HrOutbox => Set<Domain.Integrations.HrOutboxItem>();
    public DbSet<Domain.Staff.PayrollRun> PayrollRuns => Set<Domain.Staff.PayrollRun>();
    public DbSet<Domain.Staff.StaffDeduction> StaffDeductions => Set<Domain.Staff.StaffDeduction>();

    public DbSet<UserTabAccess> UserTabAccess => Set<UserTabAccess>();
    public DbSet<Domain.Company.CompanySettings> CompanySettings => Set<Domain.Company.CompanySettings>();
    public DbSet<Company.CompanyLogo> CompanyLogos => Set<Company.CompanyLogo>();

    public DbSet<UserAccount> Users => Set<UserAccount>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(CostingDbContext).Assembly);

        // The domain's aggregates: ids generated in the domain, domain events never stored, and
        // optimistic concurrency on PostgreSQL's xmin.
        foreach (var entityType in modelBuilder.Model.GetEntityTypes().Where(t => typeof(Entity).IsAssignableFrom(t.ClrType)))
        {
            var entity = modelBuilder.Entity(entityType.ClrType);
            entity.Property(nameof(Entity.Id)).ValueGeneratedNever();

            if (typeof(AggregateRoot).IsAssignableFrom(entityType.ClrType))
            {
                entity.Ignore(nameof(AggregateRoot.DomainEvents));
                entity.Property<uint>("Version").IsRowVersion();
            }
        }
    }

    // Money, to two decimal places.
    protected override void ConfigureConventions(ModelConfigurationBuilder configurationBuilder) =>
        configurationBuilder.Properties<decimal>().HavePrecision(10, 2);

    public override async Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        ChangeTracker.DetectChanges();
        TouchRootsOfChangedChildren();
        try
        {
            return await base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
        }
        catch (Exception ex) when (ToConflict(ex) is { } conflict)
        {
            throw conflict;
        }
    }

    // The xmin check guards a row, but an aggregate can span several: an invoice's lines are rows
    // of their own. Marking the aggregate modified whenever one of its children changes puts
    // its row, and its check, into every save that touches it. Only the owning aggregate,
    // recognised by its collection navigation.
    private void TouchRootsOfChangedChildren()
    {
        var changedChildren = ChangeTracker.Entries()
            .Where(e => e.Entity is Entity and not AggregateRoot
                && e.State is EntityState.Added or EntityState.Modified or EntityState.Deleted)
            .ToList();

        foreach (var child in changedChildren)
        {
            foreach (var foreignKey in child.Metadata.GetForeignKeys()
                         .Where(fk => fk.PrincipalToDependent is not null
                             && typeof(AggregateRoot).IsAssignableFrom(fk.PrincipalEntityType.ClrType)))
            {
                var property = child.Property(foreignKey.Properties[0].Name);
                var rootId = (Guid?)(child.State == EntityState.Deleted ? property.OriginalValue : property.CurrentValue);
                var root = ChangeTracker.Entries<AggregateRoot>().FirstOrDefault(r => r.Entity.Id == rootId);
                if (root is { State: EntityState.Unchanged })
                    root.State = EntityState.Modified;
            }
        }
    }

    // The save failures a caller can act on, translated so no layer above this one ever handles
    // an EF Core or Npgsql type.
    private static ConflictException? ToConflict(Exception ex) => ex switch
    {
        DbUpdateConcurrencyException =>
            new ConflictException("Someone else changed this at the same time. Reload it and try again.", ex),
        DbUpdateException { InnerException: PostgresException { SqlState: PostgresErrorCodes.UniqueViolation } } =>
            new ConflictException("This conflicts with a record that already exists.", ex),
        // Removed while someone else put it to use: a category deleted as a material joined it.
        DbUpdateException { InnerException: PostgresException { SqlState: PostgresErrorCodes.ForeignKeyViolation } } =>
            new ConflictException("It was put to use at the same time. Reload and try again.", ex),
        _ => null,
    };
}
```


> 📄 **`backend/src/Costing.Infrastructure/Persistence/CostingDbContextFactory.cs`** — 19 سطر

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Costing.Infrastructure.Persistence;

// Used only by `dotnet ef`, so migrations can be added before the API exists:
//   dotnet ef migrations add <Name> --project backend/src/Costing.Infrastructure --startup-project backend/src/Costing.Infrastructure --output-dir Persistence/Migrations
// Adding a migration never connects to the database. Applying one reads the connection string
// from COSTING_CONNECTION.
internal sealed class CostingDbContextFactory : IDesignTimeDbContextFactory<CostingDbContext>
{
    public CostingDbContext CreateDbContext(string[] args)
    {
        var connectionString = Environment.GetEnvironmentVariable("COSTING_CONNECTION")
            ?? "Host=localhost;Port=5436;Database=costing;Username=costing;Password=costing-dev";

        return new CostingDbContext(new DbContextOptionsBuilder<CostingDbContext>().UseNpgsql(connectionString, CostingDbContext.ConfigureNpgsql).Options);
    }
}
```


### 13.3 الإعدادات بالـ Fluent API

`IsQuantity()` (دقة الكميات) و `IsEnumName()`:

> 📄 **`backend/src/Costing.Infrastructure/Persistence/Configurations/PropertyBuilderExtensions.cs`** — 24 سطر

```csharp
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Costing.Infrastructure.Persistence.Configurations;

internal static class PropertyBuilderExtensions
{
    // Stock quantities are in grams, millilitres or pieces, and a recipe can call for 2.5 g.
    // Money's two decimal places would round that away.
    public static PropertyBuilder<decimal> IsQuantity(this PropertyBuilder<decimal> property) =>
        property.HasPrecision(18, 3);

    public static PropertyBuilder<decimal?> IsQuantity(this PropertyBuilder<decimal?> property) =>
        property.HasPrecision(18, 3);

    // The cost of one gram, millilitre or piece: 0.36 a gram for beef at 360 a kg. Money's two
    // places would make it 0.36 and lose the rest of a 359.99 kg.
    public static PropertyBuilder<decimal?> IsUnitCost(this PropertyBuilder<decimal?> property) =>
        property.HasPrecision(18, 6);

    // Stored by name, as the delivery system stores them. A row stays readable, and adding an
    // enum value can never change what existing rows mean.
    public static PropertyBuilder<TEnum> IsEnumName<TEnum>(this PropertyBuilder<TEnum> property) =>
        property.HasConversion<string>().HasMaxLength(32);
}
```


`InventoryConfigurations.cs`: الخامات، الوصفات، المخزون، الجرد، المشتريات، الخزنة، الموردون، الموافقات. لاحظ: **وصفة فعّالة واحدة لكل هدف** (فهرس فريد مرشّح `NULLS NOT DISTINCT` على `(TargetKind, CatalogItemId, VariantId)`)، فهرس الحركات الفريد، خامة واحدة لكل بند جرد ولكل بند فاتورة، **طلب موافقة معلّق واحد لكل سجل** (فهرس فريد على `RecordId` بشرط `Status = 'Pending'`)، قيد عكسي واحد لكل قيد خزنة، `Cascade` على البنود و `Restrict` على المراجع، وفهرس `PayrollRunId` على قيود الخزنة.

> 📄 **`backend/src/Costing.Infrastructure/Persistence/Configurations/InventoryConfigurations.cs`** — 446 سطر

```csharp
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Costing.Domain.Staff;
using Costing.Domain.Approvals;
using Costing.Domain.Categories;
using Costing.Domain.Expenses;
using Costing.Domain.Production;
using Costing.Domain.Purchases;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;
using Costing.Domain.Waste;
using Costing.Domain.StockCounts;
using Costing.Domain.StockMovements;
using Costing.Domain.Suppliers;
using Costing.Domain.Treasury;

namespace Costing.Infrastructure.Persistence.Configurations;

internal sealed class RawMaterialConfiguration : IEntityTypeConfiguration<RawMaterial>
{
    public void Configure(EntityTypeBuilder<RawMaterial> builder)
    {
        builder.ToTable("RawMaterials", CostingDbContext.CostingSchema);
        builder.Property(m => m.Name).HasMaxLength(200);
        builder.Property(m => m.Unit).IsEnumName();
        builder.Property(m => m.Kind).IsEnumName();
        builder.Ignore(m => m.IsPrepItem);
        builder.Property(m => m.QuantityOnHand).IsQuantity();
        builder.Property(m => m.ReorderLevel).IsQuantity();
        builder.Property(m => m.Code).HasMaxLength(32);
        // A category is deleted only once what is in it has moved.
        builder.HasOne<PurchaseCategory>().WithMany().HasForeignKey(m => m.CategoryId).OnDelete(DeleteBehavior.Restrict);
        builder.Property(m => m.PurchaseUnit).HasMaxLength(32);
        builder.Property(m => m.PurchaseUnitSize).IsQuantity();
        builder.Property(m => m.AverageCost).IsUnitCost();
        builder.Property(m => m.DefaultYieldPercent).HasPrecision(5, 2).HasDefaultValue(100m);
        builder.Ignore(m => m.CostPerPurchaseUnit);
        builder.Ignore(m => m.IsArchived);
        builder.Property(m => m.ArchivedBy).HasMaxLength(200);
    }
}

internal sealed class RecipeConfiguration : IEntityTypeConfiguration<Recipe>
{
    public void Configure(EntityTypeBuilder<Recipe> builder)
    {
        builder.ToTable("Recipes", CostingDbContext.CostingSchema);
        builder.Ignore(r => r.Target);
        builder.Ignore(r => r.IsLinked);
        builder.Ignore(r => r.IsDeleted);
        builder.Property(r => r.Name).HasMaxLength(200);
        // A category deleted with recipes still in it has moved them first; any deleted recipe
        // left behind is uncategorized rather than holding the delete up.
        builder.HasOne<RecipeCategory>().WithMany().HasForeignKey(r => r.RecipeCategoryId).OnDelete(DeleteBehavior.SetNull);
        builder.Property(r => r.PlannedPrice).HasPrecision(18, 2);
        builder.Property(r => r.TargetKind).HasConversion<string>().HasMaxLength(32);
        builder.Property(r => r.DeletedBy).HasMaxLength(200);
        builder.Property(r => r.Portions).HasDefaultValue(1);

        // One active recipe per target; deleted and off-menu ones are left out. NULLS NOT
        // DISTINCT because VariantId is null for a base recipe and an add-on, and PostgreSQL
        // otherwise treats every null as different from every other, allowing a second base
        // recipe for the same item. Needs PostgreSQL 15 or newer.
        builder.HasIndex(r => new { r.TargetKind, r.CatalogItemId, r.VariantId })
            .IsUnique()
            .AreNullsDistinct(false)
            .HasFilter("\"DeletedAtUtc\" IS NULL AND \"CatalogItemId\" IS NOT NULL");

        builder.HasMany(r => r.Ingredients)
            .WithOne()
            .HasForeignKey(i => i.RecipeId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.Navigation(r => r.Ingredients)
            .HasField("_ingredients")
            .UsePropertyAccessMode(PropertyAccessMode.Field);
    }
}

internal sealed class RecipeCategoryConfiguration : IEntityTypeConfiguration<RecipeCategory>
{
    public void Configure(EntityTypeBuilder<RecipeCategory> builder)
    {
        builder.ToTable("RecipeCategories", CostingDbContext.CostingSchema);
        builder.Property(c => c.Name).HasMaxLength(100);
        builder.Property(c => c.NormalizedName).HasMaxLength(100);
        builder.Property(c => c.NameAr).HasMaxLength(100);
        builder.HasIndex(c => c.NormalizedName).IsUnique();
    }
}

internal sealed class RecipeIngredientConfiguration : IEntityTypeConfiguration<RecipeIngredient>
{
    public void Configure(EntityTypeBuilder<RecipeIngredient> builder)
    {
        builder.ToTable("RecipeIngredients", CostingDbContext.CostingSchema);
        builder.Property(i => i.Quantity).IsQuantity();
        builder.Property(i => i.YieldPercent).HasPrecision(5, 2).HasDefaultValue(100m);
        builder.Ignore(i => i.AsPurchasedQuantity);

        builder.HasOne<RawMaterial>()
            .WithMany()
            .HasForeignKey(i => i.RawMaterialId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasIndex(i => new { i.RecipeId, i.RawMaterialId }).IsUnique();
    }
}

internal sealed class StockMovementConfiguration : IEntityTypeConfiguration<StockMovement>
{
    public void Configure(EntityTypeBuilder<StockMovement> builder)
    {
        builder.ToTable("StockMovements", CostingDbContext.CostingSchema);
        builder.Property(m => m.Quantity).IsQuantity();
        builder.Property(m => m.Reason).IsEnumName();
        builder.Property(m => m.UnitCost).IsUnitCost();
        builder.Property(m => m.Note).HasMaxLength(200);
        builder.Property(m => m.RecordedBy).HasMaxLength(200);
        builder.Ignore(m => m.IsReversal);

        builder.HasOne<RawMaterial>()
            .WithMany()
            .HasForeignKey(m => m.RawMaterialId)
            .OnDelete(DeleteBehavior.Restrict);

        // The idempotency guarantee behind IStockMovementRepository.ExistsAsync: a redelivered
        // event that slipped past that check fails here instead of posting twice. SourceId is
        // the order item's PublicId. ReversalOf lets one reversing entry sit beside each; NULLS
        // NOT DISTINCT, or every original (no ReversalOf) would count as different from the next.
        builder.HasIndex(m => new { m.SourceId, m.Reason, m.RawMaterialId, m.ReversalOf }).IsUnique().AreNullsDistinct(false);
        builder.HasIndex(m => new { m.RawMaterialId, m.OccurredAtUtc });
    }
}

internal sealed class StockCountConfiguration : IEntityTypeConfiguration<StockCount>
{
    public void Configure(EntityTypeBuilder<StockCount> builder)
    {
        builder.ToTable("StockCounts", CostingDbContext.CostingSchema);
        builder.Property(c => c.Status).IsEnumName();
        builder.Property(c => c.Kind).IsEnumName().HasDefaultValue(StockCountKind.Periodic).HasSentinel((StockCountKind)0);
        builder.Ignore(c => c.IsOpening);
        builder.Property(c => c.StartedBy).HasMaxLength(200);
        builder.Property(c => c.PostedBy).HasMaxLength(200);
        builder.Property(c => c.VoidedBy).HasMaxLength(200);
        builder.HasMany(c => c.Lines).WithOne().HasForeignKey(l => l.StockCountId).OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(c => c.Lines).HasField("_lines").UsePropertyAccessMode(PropertyAccessMode.Field);
        builder.HasIndex(c => c.Status);
    }
}

internal sealed class StockCountLineConfiguration : IEntityTypeConfiguration<StockCountLine>
{
    public void Configure(EntityTypeBuilder<StockCountLine> builder)
    {
        builder.ToTable("StockCountLines", CostingDbContext.CostingSchema);
        builder.Property(l => l.CountedQuantity).IsQuantity();
        builder.Property(l => l.BookQuantity).IsQuantity();
        builder.Property(l => l.UnitCost).IsUnitCost();
        builder.HasOne<RawMaterial>().WithMany().HasForeignKey(l => l.RawMaterialId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(l => new { l.StockCountId, l.RawMaterialId }).IsUnique();
    }
}

internal sealed class PurchaseInvoiceConfiguration : IEntityTypeConfiguration<PurchaseInvoice>
{
    public void Configure(EntityTypeBuilder<PurchaseInvoice> builder)
    {
        builder.ToTable("PurchaseInvoices", CostingDbContext.CostingSchema);
        builder.Property(i => i.Status).IsEnumName();
        builder.Property(i => i.SupplierInvoiceNumber).HasMaxLength(64);
        builder.Property(i => i.CreatedBy).HasMaxLength(200);
        builder.Property(i => i.PostedBy).HasMaxLength(200);
        builder.Property(i => i.VoidedBy).HasMaxLength(200);
        builder.Property(i => i.AttachmentFileName).HasMaxLength(200);
        builder.Property(i => i.AttachmentContentType).HasMaxLength(64);
        builder.Property(i => i.AttachedBy).HasMaxLength(200);
        builder.Property(i => i.PaymentMethod).IsEnumName();
        builder.Property(i => i.Discount).HasPrecision(18, 2);
        builder.Ignore(i => i.HasAttachment);
        builder.Ignore(i => i.Total);
        builder.HasMany(i => i.Lines).WithOne().HasForeignKey(l => l.InvoiceId).OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(i => i.Lines).HasField("_lines").UsePropertyAccessMode(PropertyAccessMode.Field);
        builder.HasIndex(i => new { i.Status, i.PostedAtUtc });
        builder.HasOne<Supplier>().WithMany().HasForeignKey(i => i.SupplierId).OnDelete(DeleteBehavior.Restrict);
    }
}

// The safe's ledger: one row per cash movement, in or out, reversals beside what they undo.
internal sealed class SafeTransactionConfiguration : IEntityTypeConfiguration<SafeTransaction>
{
    public void Configure(EntityTypeBuilder<SafeTransaction> builder)
    {
        builder.ToTable("SafeTransactions", CostingDbContext.CostingSchema);
        builder.Property(t => t.Kind).IsEnumName();
        builder.Property(t => t.Fund).IsEnumName();
        builder.Property(t => t.Source).IsEnumName();
        builder.Property(t => t.Amount).HasPrecision(18, 2);
        builder.Property(t => t.TaxPercent).HasPrecision(5, 2);
        builder.Property(t => t.TaxAmount).HasPrecision(18, 2);
        builder.Property(t => t.GrossAmount).HasPrecision(18, 2);
        builder.Property(t => t.CardAmount).HasPrecision(18, 2);
        builder.Property(t => t.VoidsAmount).HasPrecision(18, 2);
        builder.Property(t => t.Notes).HasMaxLength(SafeTransaction.MaxNotesLength);
        builder.Property(t => t.RecordedBy).HasMaxLength(200);
        builder.Property(t => t.ApprovedBy).HasMaxLength(200);
        builder.Property(t => t.VoidedBy).HasMaxLength(200);
        builder.Ignore(t => t.NetAmount);
        builder.Ignore(t => t.TakingsTotal);
        builder.Ignore(t => t.PaidOut);
        builder.Ignore(t => t.IsReversal);
        builder.Ignore(t => t.IsVoided);
        builder.Ignore(t => t.IsPendingAdvance);
        builder.HasOne<Supplier>().WithMany().HasForeignKey(t => t.SupplierId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<PurchaseInvoice>().WithMany().HasForeignKey(t => t.PurchaseInvoiceId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<ExpenseItem>().WithMany().HasForeignKey(t => t.ExpenseItemId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<StaffMember>().WithMany().HasForeignKey(t => t.EmployeeId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<SafeTransaction>().WithMany().HasForeignKey(t => t.ReversalOf).OnDelete(DeleteBehavior.Restrict);
        // One reversal for each entry.
        builder.HasIndex(t => t.ReversalOf).IsUnique().HasFilter("\"ReversalOf\" IS NOT NULL");
        builder.HasIndex(t => t.PayrollRunId);
        builder.HasIndex(t => new { t.Fund, t.BusinessDate });
        builder.HasIndex(t => t.RevenueDate);
        builder.HasIndex(t => t.PurchaseInvoiceId);
        // An employee's advances and salaries, month by month.
        builder.HasIndex(t => new { t.EmployeeId, t.PayrollMonth }).HasFilter("\"EmployeeId\" IS NOT NULL");
    }
}

// What is owed to each supplier, line by line.
internal sealed class SupplierLedgerEntryConfiguration : IEntityTypeConfiguration<SupplierLedgerEntry>
{
    public void Configure(EntityTypeBuilder<SupplierLedgerEntry> builder)
    {
        builder.ToTable("SupplierLedgerEntries", CostingDbContext.CostingSchema);
        builder.Property(e => e.Kind).IsEnumName();
        builder.Property(e => e.Amount).HasPrecision(18, 2);
        builder.Property(e => e.RecordedBy).HasMaxLength(200);
        builder.Ignore(e => e.IsReversal);
        builder.HasOne<Supplier>().WithMany().HasForeignKey(e => e.SupplierId).OnDelete(DeleteBehavior.Restrict);
        // A record is on a supplier's account once, and undone once.
        builder.HasIndex(e => new { e.SourceId, e.ReversalOf }).IsUnique().AreNullsDistinct(false);
        builder.HasIndex(e => new { e.SupplierId, e.BusinessDate });
    }
}

internal sealed class SupplierConfiguration : IEntityTypeConfiguration<Supplier>
{
    public void Configure(EntityTypeBuilder<Supplier> builder)
    {
        builder.ToTable("Suppliers", CostingDbContext.CostingSchema);
        builder.Property(s => s.Name).HasMaxLength(200);
        builder.Property(s => s.NormalizedName).HasMaxLength(200);
        builder.Property(s => s.ContactPerson).HasMaxLength(200);
        builder.Property(s => s.Phone).HasMaxLength(32);
        builder.Property(s => s.Email).HasMaxLength(200);
        builder.Property(s => s.Notes).HasMaxLength(500);
        // Archived or not: two suppliers of one name would make the invoices ambiguous.
        builder.HasIndex(s => s.NormalizedName).IsUnique();
    }
}

internal sealed class PurchaseInvoiceLineConfiguration : IEntityTypeConfiguration<PurchaseInvoiceLine>
{
    public void Configure(EntityTypeBuilder<PurchaseInvoiceLine> builder)
    {
        // A line is a material or an expense, as its type says, never both or neither.
        builder.ToTable("PurchaseInvoiceLines", CostingDbContext.CostingSchema, t => t.HasCheckConstraint("CK_PurchaseInvoiceLines_Item",
            "(\"ItemType\" = 'Inventory' AND \"RawMaterialId\" IS NOT NULL AND \"ExpenseItemId\" IS NULL) OR " +
            "(\"ItemType\" = 'Expense' AND \"ExpenseItemId\" IS NOT NULL AND \"RawMaterialId\" IS NULL)"));
        builder.Property(l => l.EnteredQuantity).IsQuantity();
        builder.Property(l => l.UnitLabel).HasMaxLength(32);
        builder.Property(l => l.UnitSize).IsQuantity();
        builder.Property(l => l.Quantity).IsQuantity();
        builder.Property(l => l.LineTotal).HasPrecision(18, 2);
        builder.Property(l => l.Discount).HasPrecision(18, 2);
        builder.Property(l => l.DiscountShare).HasPrecision(18, 2);
        builder.Property(l => l.Cost).HasPrecision(18, 2);
        builder.Property(l => l.ItemType).IsEnumName();
        builder.HasOne<RawMaterial>().WithMany().HasForeignKey(l => l.RawMaterialId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<ExpenseItem>().WithMany().HasForeignKey(l => l.ExpenseItemId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(l => new { l.InvoiceId, l.RawMaterialId }).IsUnique();
        builder.HasIndex(l => new { l.InvoiceId, l.ExpenseItemId }).IsUnique();
    }
}

internal sealed class ApprovalRequestConfiguration : IEntityTypeConfiguration<ApprovalRequest>
{
    public void Configure(EntityTypeBuilder<ApprovalRequest> builder)
    {
        builder.ToTable("ApprovalRequests", CostingDbContext.CostingSchema);
        builder.Property(r => r.Module).IsEnumName();
        builder.Property(r => r.Action).IsEnumName();
        builder.Property(r => r.Status).IsEnumName();
        builder.Property(r => r.Summary).HasMaxLength(500);
        // What the manager reads, line by line, and what a new or changed record holds until
        // approved: both JSON, read and written whole.
        builder.Ignore(r => r.Changes);
        builder.Property<List<ApprovalChange>>("_changes")
            .HasColumnName("Changes")
            .HasColumnType("jsonb")
            .HasConversion(
                changes => JsonSerializer.Serialize(changes, (JsonSerializerOptions?)null),
                json => JsonSerializer.Deserialize<List<ApprovalChange>>(json, (JsonSerializerOptions?)null) ?? new List<ApprovalChange>(),
                new ValueComparer<List<ApprovalChange>>(
                    (a, b) => a!.SequenceEqual(b!),
                    changes => changes.Aggregate(0, (hash, change) => HashCode.Combine(hash, change.GetHashCode())),
                    changes => changes.ToList()));
        builder.Property(r => r.Payload).HasColumnType("jsonb");
        builder.Property(r => r.Reason).HasMaxLength(500);
        builder.Property(r => r.RequestedById).HasMaxLength(200);
        builder.Property(r => r.RequestedBy).HasMaxLength(200);
        builder.Property(r => r.DecidedBy).HasMaxLength(200);
        builder.Property(r => r.DecisionNote).HasMaxLength(500);
        builder.Ignore(r => r.IsPending);
        // At most one request waits for a record, whatever it asks: two would race to change it
        // twice. Record ids are Guids, unique across the modules.
        builder.HasIndex(r => r.RecordId).IsUnique().HasFilter("\"Status\" = 'Pending'");
        builder.HasIndex(r => new { r.Status, r.RequestedAtUtc });
    }
}

internal sealed class PurchaseCategoryConfiguration : IEntityTypeConfiguration<PurchaseCategory>
{
    public void Configure(EntityTypeBuilder<PurchaseCategory> builder)
    {
        builder.ToTable("PurchaseCategories", CostingDbContext.CostingSchema);
        builder.Property(c => c.Name).HasMaxLength(100);
        builder.Property(c => c.NormalizedName).HasMaxLength(100);
        builder.Property(c => c.NameAr).HasMaxLength(100);
        builder.Property(c => c.ExpenseLine).IsEnumName();
        // Raw materials or general expenses; the CategoryKinds migration gave each it had one.
        builder.Property(c => c.Kind).IsEnumName().HasDefaultValue(CategoryKind.RawMaterials).HasSentinel((CategoryKind)0);
        builder.Ignore(c => c.IsGeneral);
        builder.HasIndex(c => c.NormalizedName).IsUnique();
    }
}

internal sealed class ExpenseItemConfiguration : IEntityTypeConfiguration<ExpenseItem>
{
    public void Configure(EntityTypeBuilder<ExpenseItem> builder)
    {
        builder.ToTable("ExpenseItems", CostingDbContext.CostingSchema);
        builder.Property(e => e.Name).HasMaxLength(200);
        builder.Property(e => e.NormalizedName).HasMaxLength(200);
        builder.Property(e => e.NameAr).HasMaxLength(200);
        builder.Property(e => e.Unit).HasMaxLength(32);
        // Archived or not: two of one name would make the invoices ambiguous.
        builder.HasIndex(e => e.NormalizedName).IsUnique();
        builder.HasOne<PurchaseCategory>().WithMany().HasForeignKey(e => e.CategoryId).OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class BreakageEntryConfiguration : IEntityTypeConfiguration<BreakageEntry>
{
    public void Configure(EntityTypeBuilder<BreakageEntry> builder)
    {
        builder.ToTable("BreakageEntries", CostingDbContext.CostingSchema, t => t.HasCheckConstraint("CK_BreakageEntries_Quantity", "\"Quantity\" > 0"));
        builder.Property(b => b.Description).HasMaxLength(BreakageEntry.MaxDescriptionLength);
        builder.Property(b => b.Notes).HasMaxLength(BreakageEntry.MaxNotesLength);
        builder.Property(b => b.RecordedBy).HasMaxLength(200);
        builder.Property(b => b.VoidedBy).HasMaxLength(200);
        builder.Property(b => b.UnitCost).HasPrecision(18, 2);
        builder.Property(b => b.Cost).HasPrecision(18, 2);
        builder.Ignore(b => b.IsVoided);
        builder.HasOne<StaffMember>().WithMany().HasForeignKey(b => b.EmployeeId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(b => b.BusinessDate);
    }
}

internal sealed class PurchaseInvoiceAttachmentConfiguration : IEntityTypeConfiguration<PurchaseInvoiceAttachment>
{
    public void Configure(EntityTypeBuilder<PurchaseInvoiceAttachment> builder)
    {
        builder.ToTable("PurchaseInvoiceAttachments", CostingDbContext.CostingSchema);
        builder.HasKey(a => a.InvoiceId);
        builder.HasOne<PurchaseInvoice>().WithOne().HasForeignKey<PurchaseInvoiceAttachment>(a => a.InvoiceId).OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class PrepRecipeConfiguration : IEntityTypeConfiguration<PrepRecipe>
{
    public void Configure(EntityTypeBuilder<PrepRecipe> builder)
    {
        builder.ToTable("PrepRecipes", CostingDbContext.CostingSchema);
        builder.Ignore(r => r.PrepItemId);
        builder.Property(r => r.BatchQuantity).IsQuantity();
        // Its id is the prep item's: one recipe each, gone with it.
        builder.HasOne<RawMaterial>().WithOne().HasForeignKey<PrepRecipe>(r => r.Id).OnDelete(DeleteBehavior.Cascade);
        builder.HasMany(r => r.Ingredients).WithOne().HasForeignKey(i => i.PrepRecipeId).OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(r => r.Ingredients).HasField("_ingredients").UsePropertyAccessMode(PropertyAccessMode.Field);
        builder.HasOne<RecipeCategory>().WithMany().HasForeignKey(r => r.RecipeCategoryId).OnDelete(DeleteBehavior.SetNull);
    }
}

internal sealed class PrepIngredientConfiguration : IEntityTypeConfiguration<PrepIngredient>
{
    public void Configure(EntityTypeBuilder<PrepIngredient> builder)
    {
        builder.ToTable("PrepRecipeIngredients", CostingDbContext.CostingSchema);
        builder.Property(i => i.Quantity).IsQuantity();
        builder.Property(i => i.YieldPercent).HasPrecision(5, 2);
        builder.Ignore(i => i.AsPurchasedQuantity);
        builder.HasOne<RawMaterial>().WithMany().HasForeignKey(i => i.RawMaterialId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(i => new { i.PrepRecipeId, i.RawMaterialId }).IsUnique();
    }
}

internal sealed class ProductionOrderConfiguration : IEntityTypeConfiguration<ProductionOrder>
{
    public void Configure(EntityTypeBuilder<ProductionOrder> builder)
    {
        builder.ToTable("ProductionOrders", CostingDbContext.CostingSchema);
        builder.Property(o => o.Status).IsEnumName();
        builder.Property(o => o.VoidedBy).HasMaxLength(200);
        builder.Property(o => o.ApprovedBy).HasMaxLength(200);
        builder.Ignore(o => o.IsVoided);
        builder.Property(o => o.PlannedQuantity).IsQuantity();
        builder.Property(o => o.ProducedQuantity).IsQuantity();
        builder.Property(o => o.TotalCost).HasPrecision(18, 2);
        builder.Property(o => o.UnitCost).HasPrecision(18, 6);
        builder.Property(o => o.ProducedBy).HasMaxLength(200);
        builder.Property(o => o.Notes).HasMaxLength(200);
        builder.HasOne<RawMaterial>().WithMany().HasForeignKey(o => o.PrepItemId).OnDelete(DeleteBehavior.Restrict);
        builder.HasMany(o => o.Lines).WithOne().HasForeignKey(l => l.ProductionOrderId).OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(o => o.Lines).HasField("_lines").UsePropertyAccessMode(PropertyAccessMode.Field);
        builder.HasIndex(o => new { o.PrepItemId, o.ProducedAtUtc });
        builder.HasIndex(o => o.ProducedAtUtc);
    }
}

internal sealed class ProductionOrderLineConfiguration : IEntityTypeConfiguration<ProductionOrderLine>
{
    public void Configure(EntityTypeBuilder<ProductionOrderLine> builder)
    {
        builder.ToTable("ProductionOrderLines", CostingDbContext.CostingSchema);
        builder.Property(l => l.Quantity).IsQuantity();
        builder.Property(l => l.UnitCost).HasPrecision(18, 6);
        builder.Property(l => l.Cost).HasPrecision(18, 2);
        builder.HasOne<RawMaterial>().WithMany().HasForeignKey(l => l.RawMaterialId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(l => new { l.ProductionOrderId, l.RawMaterialId }).IsUnique();
    }
}
```


`MenuSalesConfigurations.cs`: رقم الصنف **يُعطى ولا يُولَّد** (هو كوده في التقارير)، والمبيعات، والموظفون، و `UserTabAccess`.

> 📄 **`backend/src/Costing.Infrastructure/Persistence/Configurations/MenuSalesConfigurations.cs`** — 117 سطر

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Costing.Domain.Access;
using Costing.Domain.Menu;
using Costing.Domain.Sales;
using Costing.Domain.Staff;

namespace Costing.Infrastructure.Persistence.Configurations;

internal sealed class MenuCategoryConfiguration : IEntityTypeConfiguration<MenuCategory>
{
    public void Configure(EntityTypeBuilder<MenuCategory> builder)
    {
        builder.ToTable("MenuCategories", CostingDbContext.CostingSchema);
        builder.Property(c => c.Id).UseIdentityByDefaultColumn();
        builder.Property(c => c.Name).HasMaxLength(MenuCategory.MaxNameLength);
        builder.Property(c => c.NameAr).HasMaxLength(MenuCategory.MaxNameLength);
        builder.HasIndex(c => c.Name).IsUnique();
    }
}

// An item's number is given (its code on the reports), never generated.
internal sealed class MenuItemConfiguration : IEntityTypeConfiguration<MenuItem>
{
    public void Configure(EntityTypeBuilder<MenuItem> builder)
    {
        builder.ToTable("MenuItems", CostingDbContext.CostingSchema);
        builder.Property(m => m.Id).ValueGeneratedNever();
        builder.Property(m => m.Name).HasMaxLength(MenuItem.MaxNameLength);
        builder.Property(m => m.NameAr).HasMaxLength(MenuItem.MaxNameLength);
        builder.Property(m => m.Category).HasMaxLength(MenuCategory.MaxNameLength);
        builder.Property(m => m.AddOnIds).HasDefaultValueSql("'{}'::integer[]");
        builder.HasIndex(m => m.Category);
        builder.HasMany(m => m.Variants).WithOne().HasForeignKey(v => v.MenuItemId).OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(m => m.Variants).AutoInclude();
    }
}

internal sealed class MenuItemVariantConfiguration : IEntityTypeConfiguration<MenuItemVariant>
{
    public void Configure(EntityTypeBuilder<MenuItemVariant> builder)
    {
        builder.ToTable("MenuItemVariants", CostingDbContext.CostingSchema);
        builder.Property(v => v.Id).UseIdentityByDefaultColumn();
        builder.Property(v => v.Name).HasMaxLength(MenuItem.MaxNameLength);
        builder.Property(v => v.NameAr).HasMaxLength(MenuItem.MaxNameLength);
    }
}

internal sealed class AddOnConfiguration : IEntityTypeConfiguration<AddOn>
{
    public void Configure(EntityTypeBuilder<AddOn> builder)
    {
        builder.ToTable("AddOns", CostingDbContext.CostingSchema);
        builder.Property(a => a.Id).UseIdentityByDefaultColumn();
        builder.Property(a => a.Name).HasMaxLength(MenuItem.MaxNameLength);
        builder.Property(a => a.NameAr).HasMaxLength(MenuItem.MaxNameLength);
    }
}

internal sealed class SalesReceiptConfiguration : IEntityTypeConfiguration<SalesReceipt>
{
    public void Configure(EntityTypeBuilder<SalesReceipt> builder)
    {
        builder.ToTable("SalesReceipts", CostingDbContext.CostingSchema);
        builder.Property(r => r.Reference).HasMaxLength(SalesReceipt.MaxReferenceLength);
        builder.HasIndex(r => r.Reference).IsUnique().HasFilter("\"Reference\" IS NOT NULL");
        builder.HasIndex(r => r.SoldAtUtc);
        builder.HasIndex(r => r.BusinessDate);
        builder.Property(r => r.Channel).IsEnumName();
        builder.Property(r => r.PaymentMethod).IsEnumName();
        builder.Property(r => r.Source).IsEnumName();
        builder.Property(r => r.Notes).HasMaxLength(300);
        builder.Property(r => r.EnteredBy).HasMaxLength(200);
        builder.Property(r => r.VoidedBy).HasMaxLength(200);
        builder.Ignore(r => r.IsOnline);
        builder.Ignore(r => r.BilledSubtotal);
        builder.Ignore(r => r.IsVoided);
        builder.OwnsMany(r => r.Lines, line =>
        {
            line.ToTable("SalesReceiptLines", CostingDbContext.CostingSchema);
            line.WithOwner().HasForeignKey("SalesReceiptId");
            line.Property<int>("Id").UseIdentityByDefaultColumn();
            line.HasKey("Id");
            line.HasIndex(l => l.PublicId).IsUnique();
            line.HasIndex(l => l.MenuItemId);
            line.Property(l => l.MenuItemName).HasMaxLength(MenuItem.MaxNameLength);
            line.Property(l => l.VariantName).HasMaxLength(MenuItem.MaxNameLength);
            line.Property(l => l.Voided).IsEnumName();
            line.Ignore(l => l.OnBill);
            line.Ignore(l => l.Charged);
        });
        builder.Navigation(r => r.Lines).AutoInclude();
    }
}

internal sealed class StaffMemberConfiguration : IEntityTypeConfiguration<StaffMember>
{
    public void Configure(EntityTypeBuilder<StaffMember> builder)
    {
        builder.ToTable("Staff", CostingDbContext.CostingSchema);
        builder.Property(s => s.Name).HasMaxLength(StaffMember.MaxNameLength);
        builder.Property(s => s.JobTitle).HasMaxLength(100);
    }
}

internal sealed class UserTabAccessConfiguration : IEntityTypeConfiguration<UserTabAccess>
{
    public void Configure(EntityTypeBuilder<UserTabAccess> builder)
    {
        builder.ToTable("UserTabAccess", CostingDbContext.CostingSchema);
        builder.Property(a => a.UserId).HasMaxLength(UserTabAccess.MaxUserIdLength);
        builder.HasIndex(a => a.UserId).IsUnique();
        builder.Property(a => a.Tabs).HasConversion<string>().HasMaxLength(300);
        builder.Property(a => a.SetBy).HasMaxLength(200);
    }
}
```


`EndOfDayConfigurations.cs`: تقرير واحد لكل يوم تجاري (فهرس فريد على التاريخ)، والصور في جدول منفصل.

> 📄 **`backend/src/Costing.Infrastructure/Persistence/Configurations/EndOfDayConfigurations.cs`** — 91 سطر

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Costing.Domain.EndOfDay;
using Costing.Domain.Purchases;
using Costing.Domain.Staff;
using Costing.Domain.Suppliers;

namespace Costing.Infrastructure.Persistence.Configurations;

internal sealed class EndOfDayReportConfiguration : IEntityTypeConfiguration<EndOfDayReport>
{
    public void Configure(EntityTypeBuilder<EndOfDayReport> builder)
    {
        builder.ToTable("EndOfDayReports", CostingDbContext.CostingSchema);
        builder.Property(d => d.Status).IsEnumName();
        builder.Property(d => d.CashAmount).HasPrecision(18, 2);
        builder.Property(d => d.CardAmount).HasPrecision(18, 2);
        builder.Property(d => d.TaxAmount).HasPrecision(18, 2);
        builder.Property(d => d.VoidsAmount).HasPrecision(18, 2);
        builder.Property(d => d.OpeningFloat).HasPrecision(18, 2);
        builder.Property(d => d.Notes).HasMaxLength(EndOfDayReport.MaxNotes);
        builder.Property(d => d.SalesPhotoFileName).HasMaxLength(200);
        builder.Property(d => d.SalesPhotoContentType).HasMaxLength(64);
        builder.Property(d => d.CreatedBy).HasMaxLength(200);
        builder.Property(d => d.UpdatedBy).HasMaxLength(200);
        builder.Property(d => d.SubmittedBy).HasMaxLength(200);
        builder.Property(d => d.ReopenedBy).HasMaxLength(200);
        builder.Ignore(d => d.SalesPhoto);
        builder.Ignore(d => d.IsSubmitted);
        builder.Ignore(d => d.NetSales);
        builder.Ignore(d => d.TotalRevenue);
        builder.Ignore(d => d.CashAfterInvoices);
        builder.Ignore(d => d.ExpectedIntoSafe);
        builder.Ignore(d => d.CashTax);
        builder.Ignore(d => d.CashSalesCollected);
        builder.Ignore(d => d.CashPaidOut);
        builder.Ignore(d => d.NetCashInTill);
        builder.HasMany(d => d.Invoices).WithOne().HasForeignKey(i => i.ReportId).OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(d => d.Invoices).HasField("_invoices").UsePropertyAccessMode(PropertyAccessMode.Field);
        builder.HasMany(d => d.Payouts).WithOne().HasForeignKey(p => p.ReportId).OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(d => d.Payouts).HasField("_payouts").UsePropertyAccessMode(PropertyAccessMode.Field);
        // One a business day.
        builder.HasIndex(d => d.Date).IsUnique();
    }
}

internal sealed class EndOfDayInvoiceConfiguration : IEntityTypeConfiguration<EndOfDayInvoice>
{
    public void Configure(EntityTypeBuilder<EndOfDayInvoice> builder)
    {
        builder.ToTable("EndOfDayInvoices", CostingDbContext.CostingSchema);
        builder.Property(i => i.Kind).IsEnumName();
        builder.Property(i => i.ReportedTotal).HasPrecision(18, 2);
        builder.Property(i => i.Note).HasMaxLength(EndOfDayReport.MaxInvoiceNote);
        builder.Property(i => i.PhotoFileName).HasMaxLength(200);
        builder.Property(i => i.PhotoContentType).HasMaxLength(64);
        builder.Ignore(i => i.Photo);
        builder.HasOne<Supplier>().WithMany().HasForeignKey(i => i.SupplierId).OnDelete(DeleteBehavior.Restrict);
        // A purchase invoice is the one an invoice handed in was posted as, once.
        builder.HasOne<PurchaseInvoice>().WithMany().HasForeignKey(i => i.PurchaseInvoiceId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(i => i.PurchaseInvoiceId).IsUnique();
    }
}

// Cash paid out of the till on the day: to a supplier or an employee, with its receipt.
internal sealed class EndOfDayPayoutConfiguration : IEntityTypeConfiguration<EndOfDayPayout>
{
    public void Configure(EntityTypeBuilder<EndOfDayPayout> builder)
    {
        builder.ToTable("EndOfDayPayouts", CostingDbContext.CostingSchema);
        builder.Property(p => p.Kind).IsEnumName();
        builder.Property(p => p.Amount).HasPrecision(18, 2);
        builder.Property(p => p.Note).HasMaxLength(EndOfDayReport.MaxInvoiceNote);
        builder.Property(p => p.ReceiptFileName).HasMaxLength(200);
        builder.Property(p => p.ReceiptContentType).HasMaxLength(64);
        builder.Ignore(p => p.Receipt);
        builder.Ignore(p => p.PayeeId);
        builder.HasOne<Supplier>().WithMany().HasForeignKey(p => p.SupplierId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<StaffMember>().WithMany().HasForeignKey(p => p.EmployeeId).OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class EndOfDayPhotoContentConfiguration : IEntityTypeConfiguration<EndOfDayPhotoContent>
{
    public void Configure(EntityTypeBuilder<EndOfDayPhotoContent> builder)
    {
        builder.ToTable("EndOfDayPhotos", CostingDbContext.CostingSchema);
        builder.HasKey(p => p.Id);
        builder.Property(p => p.Id).ValueGeneratedNever();
    }
}
```


إعدادات الشركة وشعارها (الشعار منفصل حتى لا تُحمّل الصورة مع كل قراءة):

> 📄 **`backend/src/Costing.Infrastructure/Company/CompanySettingsStore.cs`** — 75 سطر

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Costing.Domain.Company;
using Costing.Infrastructure.Persistence;
using Costing.Infrastructure.Persistence.Configurations;

namespace Costing.Infrastructure.Company;

// The logo's bytes: one row, apart from the settings, so reading them never loads the picture.
public sealed class CompanyLogo
{
    public int Id { get; init; } = CompanySettings.SingletonId;
    public byte[] Content { get; set; } = [];
}

internal sealed class CompanySettingsStore(CostingDbContext db) : ICompanySettingsStore
{
    public Task<CompanySettings?> GetAsync(CancellationToken cancellationToken = default) =>
        db.CompanySettings.SingleOrDefaultAsync(s => s.Id == CompanySettings.SingletonId, cancellationToken);

    public void Add(CompanySettings settings) => db.CompanySettings.Add(settings);

    public async Task PutLogoAsync(byte[]? content, CancellationToken cancellationToken = default)
    {
        var existing = await db.CompanyLogos.FindAsync([CompanySettings.SingletonId], cancellationToken);
        if (content is null)
        {
            if (existing is not null)
                db.CompanyLogos.Remove(existing);
        }
        else if (existing is null)
        {
            db.CompanyLogos.Add(new CompanyLogo { Content = content });
        }
        else
        {
            existing.Content = content;
        }
    }

    public async Task<byte[]?> GetLogoAsync(CancellationToken cancellationToken = default) =>
        await db.CompanyLogos.AsNoTracking()
            .Where(l => l.Id == CompanySettings.SingletonId)
            .Select(l => l.Content)
            .SingleOrDefaultAsync(cancellationToken);
}

internal sealed class CompanySettingsConfiguration : IEntityTypeConfiguration<CompanySettings>
{
    public void Configure(EntityTypeBuilder<CompanySettings> builder)
    {
        builder.ToTable("CompanySettings", CostingDbContext.CostingSchema, t => t.HasCheckConstraint("CK_CompanySettings_Single", $"\"Id\" = {CompanySettings.SingletonId}"));
        builder.HasKey(s => s.Id);
        builder.Property(s => s.Id).ValueGeneratedNever();
        builder.Property(s => s.Name).HasMaxLength(CompanySettings.MaxNameLength);
        builder.Property(s => s.CurrencySymbol).HasMaxLength(CompanySettings.MaxCurrencySymbolLength);
        builder.Property(s => s.CurrencyPosition).IsEnumName();
        builder.Property(s => s.Country).IsEnumName();
        builder.Property(s => s.TimeZoneId).HasMaxLength(64);
        builder.Property(s => s.LogoFileName).HasMaxLength(CompanySettings.MaxLogoFileNameLength);
        builder.Property(s => s.LogoContentType).HasMaxLength(50);
        builder.Property(s => s.UpdatedBy).HasMaxLength(200);
    }
}

internal sealed class CompanyLogoConfiguration : IEntityTypeConfiguration<CompanyLogo>
{
    public void Configure(EntityTypeBuilder<CompanyLogo> builder)
    {
        builder.ToTable("CompanyLogos", CostingDbContext.CostingSchema);
        builder.HasKey(l => l.Id);
        builder.Property(l => l.Id).ValueGeneratedNever();
        builder.HasOne<CompanySettings>().WithOne().HasForeignKey<CompanyLogo>(l => l.Id).OnDelete(DeleteBehavior.Cascade);
    }
}
```


جداول التقارير والإعدادات: نسبة تكلفة الطعام المستهدفة (30% افتراضيًا)، إعدادات الضريبة والخدمة، المصروفات الشهرية، التكاليف المشتركة، وورقة المبيعات اليدوية:

> 📄 **`backend/src/Costing.Infrastructure/Reports/CostingTables.cs`** — 221 سطر

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Costing.Domain.Common;
using Costing.Domain.RawMaterials;
using Costing.Infrastructure.Persistence;

namespace Costing.Infrastructure.Reports;

// The food cost a manager aims at, the Food Cost % Budget on a recipe card: 30% unless set.
// One row. A dish costing more than this share of its price is "above target".
public sealed class CostingSettings
{
    public const int SingletonId = 1;
    public const decimal DefaultFoodCostTarget = 30;

    public const decimal DefaultVarianceTolerance = 5;

    public int Id { get; init; } = SingletonId;
    public decimal FoodCostTargetPercent { get; set; } = DefaultFoodCostTarget;

    // How far actual usage may stray from standard, either way, before the variance report calls
    // it unfavourable or favourable: the template's ±5%.
    public decimal VarianceTolerancePercent { get; set; } = DefaultVarianceTolerance;

    // The menu categories that are drinks, by name: their sales and costs are the beverage cost %,
    // the rest the food cost %. None set, everything is food.
    public List<string> BeverageCategories { get; set; } = [];

    // The break-even worksheet's four options: weekly sales to try against this year's costs.
    // Empty until the manager sets them.
    public List<decimal> BreakEvenScenarios { get; set; } = [];
}

// The treasury's tax and service settings (إعدادات الضريبة والخدمة). The tax rate is not here: it is
// the one every bill is charged, set in the delivery system and synced to the till, so the two can
// never disagree. The service charge is kept for when bills carry one; nothing uses it yet.
public sealed class FinancialSettings
{
    public const int SingletonId = 1;

    public int Id { get; init; } = SingletonId;
    public decimal ServicePercent { get; set; }

    // The bills' tax (VAT) rate: what a day's takings entered with tax have taken off them. Null
    // until it is set.
    public decimal? TaxPercent { get; set; }

    public string? UpdatedBy { get; set; }
    public DateTime? UpdatedAtUtc { get; set; }
}

// What a month cost beyond its ingredients, as the manager enters it: what the KPIs need besides
// sales, and the income statement's lines for the break-even worksheet. Every figure is optional
// until known; a KPI that needs a missing one says so rather than showing 0.
public sealed class MonthlyExpenses
{
    public int Year { get; init; }
    public int Month { get; init; }

    // Wages, salaries and staff benefits: the labour cost %.
    public decimal? WagesAndBenefits { get; set; }

    // Hours worked by all staff in the month: sales per labour hour.
    public decimal? LabourHours { get; set; }

    // Utilities, marketing, repairs, supplies: the rest of the controllable costs.
    public decimal? OtherControllableCosts { get; set; }

    // Rent and the like.
    public decimal? OccupationCost { get; set; }

    public decimal? Interest { get; set; }
    public decimal? Depreciation { get; set; }

    public DateTime UpdatedAtUtc { get; set; }
    public string? UpdatedBy { get; set; }

    public void Validate()
    {
        if (Month is < 1 or > 12 || Year is < 2000 or > 2100)
            throw new DomainException("Choose a month.");
        if (new[] { WagesAndBenefits, LabourHours, OtherControllableCosts, OccupationCost, Interest, Depreciation }.Any(v => v < 0))
            throw new DomainException("A month's costs and hours cannot be negative.");
    }
}

// A cost no recipe names, spread over the meals that share it: frying oil, gas, takeaway boxes.
// Each month's total is either what that month's purchases of a raw material cost (the oil), or
// a fixed amount; it is shared out per meal sold in the month, across the whole menu or one
// category. The template's "total monthly oil cost ÷ total monthly meals sold".
public sealed class SharedCost
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public string Name { get; set; } = string.Empty;

    // One of the two.
    public Guid? RawMaterialId { get; set; }
    public decimal? MonthlyAmount { get; set; }

    // A menu category's name; null for every meal.
    public string? Category { get; set; }

    public void Validate()
    {
        if (string.IsNullOrWhiteSpace(Name))
            throw new DomainException("Name the shared cost, such as Frying oil.");
        if ((RawMaterialId is null) == (MonthlyAmount is null))
            throw new DomainException("A shared cost comes from a raw material's purchases or a fixed monthly amount, one of the two.");
        if (MonthlyAmount < 0)
            throw new DomainException("A monthly amount cannot be negative.");
        Name = Name.Trim();
        Category = string.IsNullOrWhiteSpace(Category) ? null : Category.Trim();
    }
}

// A month's sales as an accountant types them, for the theoretical cost report when the till's
// own are not to be used (the till was down, or a what-if): how many of each recipe, and how much
// of each prep item. Kept for the month, with who last entered it, so the report says whose
// figures it shows.
public sealed class ManualSalesSheet
{
    public int Year { get; init; }
    public int Month { get; init; }
    public List<ManualSalesLine> Lines { get; set; } = [];
    public DateTime UpdatedAtUtc { get; set; }
    public string? UpdatedBy { get; set; }
}

public enum ManualSalesItemKind
{
    Recipe = 1,
    PrepItem = 2,
}

// Portions of a recipe; for a prep item, its display unit (kg, L), as the sheet shows it.
public sealed class ManualSalesLine
{
    public int Year { get; init; }
    public int Month { get; init; }
    public ManualSalesItemKind Kind { get; init; }
    public Guid ItemId { get; init; }
    public decimal Quantity { get; set; }
}

internal sealed class ManualSalesSheetConfiguration : IEntityTypeConfiguration<ManualSalesSheet>
{
    public void Configure(EntityTypeBuilder<ManualSalesSheet> builder)
    {
        builder.ToTable("ManualSalesSheets", CostingDbContext.CostingSchema);
        builder.HasKey(s => new { s.Year, s.Month });
        builder.Property(s => s.UpdatedBy).HasMaxLength(200);
        builder.HasMany(s => s.Lines).WithOne().HasForeignKey(l => new { l.Year, l.Month }).OnDelete(DeleteBehavior.Cascade);
    }
}

// ItemId names a recipe or a prep item by its Kind: no foreign key, and one since removed is
// left out of the report.
internal sealed class ManualSalesLineConfiguration : IEntityTypeConfiguration<ManualSalesLine>
{
    public void Configure(EntityTypeBuilder<ManualSalesLine> builder)
    {
        builder.ToTable("ManualSalesLines", CostingDbContext.CostingSchema);
        builder.HasKey(l => new { l.Year, l.Month, l.Kind, l.ItemId });
        builder.Property(l => l.Kind).HasConversion<string>().HasMaxLength(32);
        builder.Property(l => l.Quantity).HasPrecision(18, 3);
    }
}

internal sealed class CostingSettingsConfiguration : IEntityTypeConfiguration<CostingSettings>
{
    public void Configure(EntityTypeBuilder<CostingSettings> builder)
    {
        builder.ToTable("CostingSettings", CostingDbContext.CostingSchema);
        builder.Property(s => s.Id).ValueGeneratedNever();
        builder.Property(s => s.FoodCostTargetPercent).HasPrecision(5, 2);
        builder.Property(s => s.VarianceTolerancePercent).HasPrecision(5, 2).HasDefaultValue(CostingSettings.DefaultVarianceTolerance);
        builder.Property(s => s.BeverageCategories).HasDefaultValueSql("'{}'::text[]");
        builder.Property(s => s.BreakEvenScenarios).HasDefaultValueSql("'{}'::numeric[]");
    }
}

internal sealed class SharedCostConfiguration : IEntityTypeConfiguration<SharedCost>
{
    public void Configure(EntityTypeBuilder<SharedCost> builder)
    {
        builder.ToTable("SharedCosts", CostingDbContext.CostingSchema);
        builder.Property(c => c.Id).ValueGeneratedNever();
        builder.Property(c => c.Name).HasMaxLength(100);
        builder.Property(c => c.Category).HasMaxLength(100);
        builder.Property(c => c.MonthlyAmount).HasPrecision(18, 2);
        builder.HasOne<RawMaterial>().WithMany().HasForeignKey(c => c.RawMaterialId).OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class MonthlyExpensesConfiguration : IEntityTypeConfiguration<MonthlyExpenses>
{
    public void Configure(EntityTypeBuilder<MonthlyExpenses> builder)
    {
        builder.ToTable("MonthlyExpenses", CostingDbContext.CostingSchema);
        builder.HasKey(e => new { e.Year, e.Month });
        builder.Property(e => e.WagesAndBenefits).HasPrecision(18, 2);
        builder.Property(e => e.LabourHours).HasPrecision(10, 2);
        builder.Property(e => e.OtherControllableCosts).HasPrecision(18, 2);
        builder.Property(e => e.OccupationCost).HasPrecision(18, 2);
        builder.Property(e => e.Interest).HasPrecision(18, 2);
        builder.Property(e => e.Depreciation).HasPrecision(18, 2);
        builder.Property(e => e.UpdatedBy).HasMaxLength(200);
    }
}

internal sealed class FinancialSettingsConfiguration : IEntityTypeConfiguration<FinancialSettings>
{
    public void Configure(EntityTypeBuilder<FinancialSettings> builder)
    {
        builder.ToTable("FinancialSettings", CostingDbContext.CostingSchema);
        builder.Property(s => s.Id).ValueGeneratedNever();
        builder.Property(s => s.ServicePercent).HasPrecision(5, 2);
        builder.Property(s => s.TaxPercent).HasPrecision(5, 2);
        builder.Property(s => s.UpdatedBy).HasMaxLength(200);
    }
}
```


### 13.4 المستودعات

قراءات العرض `AsNoTracking`، وقراءات التعديل متتبَّعة؛ ودوال بأسماء دقيقة بدل `IQueryable` يتسرب للأعلى.

> 📄 **`backend/src/Costing.Infrastructure/Persistence/InventoryRepositories.cs`** — 460 سطر

```csharp
using Microsoft.EntityFrameworkCore;
using Costing.Application.Common;
using Costing.Application.Approvals;
using Costing.Domain.Approvals;
using Costing.Domain.Categories;
using Costing.Domain.Expenses;
using Costing.Domain.Production;
using Costing.Domain.Purchases;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;
using Costing.Domain.StockCounts;
using Costing.Domain.StockMovements;
using Costing.Domain.Suppliers;
using Costing.Domain.Treasury;
using Costing.Domain.Waste;
using Costing.Infrastructure.Common;

namespace Costing.Infrastructure.Persistence;

internal sealed class RawMaterialRepository(CostingDbContext db) : IRawMaterialRepository
{
    public Task<RawMaterial?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        db.RawMaterials.SingleOrDefaultAsync(m => m.Id == id, cancellationToken);

    public void Add(RawMaterial aggregate) => db.RawMaterials.Add(aggregate);

    public async Task<IReadOnlyList<RawMaterial>> GetAllAsync(CancellationToken cancellationToken = default) =>
        await db.RawMaterials.OrderBy(m => m.Name).ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<RawMaterial>> GetByIdsAsync(IEnumerable<Guid> ids, CancellationToken cancellationToken = default)
    {
        var idList = ids.ToList();
        return await db.RawMaterials.Where(m => idList.Contains(m.Id)).ToListAsync(cancellationToken);
    }

    // Spelled out rather than RawMaterial.NeedsReorder, which is computed in C#.
    public async Task<IReadOnlyList<RawMaterial>> GetNeedingReorderAsync(CancellationToken cancellationToken = default) =>
        await db.RawMaterials.Where(m => m.QuantityOnHand <= m.ReorderLevel).OrderBy(m => m.Name).ToListAsync(cancellationToken);
}

internal sealed class RecipeRepository(CostingDbContext db) : IRecipeRepository
{
    private IQueryable<Recipe> WithIngredients => db.Recipes.Include(r => r.Ingredients);

    public Task<Recipe?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        WithIngredients.SingleOrDefaultAsync(r => r.Id == id, cancellationToken);

    public void Add(Recipe aggregate) => db.Recipes.Add(aggregate);

    public async Task<IReadOnlyList<Recipe>> GetAllAsync(CancellationToken cancellationToken = default) =>
        await WithIngredients.ToListAsync(cancellationToken);

    // The ones sales go by: not deleted, and linked to the menu.
    private IQueryable<Recipe> Active => WithIngredients.Where(r => r.DeletedAtUtc == null && r.CatalogItemId != null);

    public Task<Recipe?> GetByTargetAsync(RecipeTarget target, CancellationToken cancellationToken = default) =>
        Active.SingleOrDefaultAsync(
            r => r.TargetKind == target.Kind && r.CatalogItemId == target.CatalogItemId && r.VariantId == target.VariantId,
            cancellationToken);

    // Narrowed in SQL by catalog id, then matched exactly in memory. A recipe target is three
    // columns, which an IN list cannot express, and the candidates are a handful.
    public async Task<IReadOnlyList<Recipe>> GetByTargetsAsync(IReadOnlyCollection<RecipeTarget> targets, CancellationToken cancellationToken = default)
    {
        var catalogIds = targets.Select(t => (int?)t.CatalogItemId).Distinct().ToList();
        var candidates = await Active.Where(r => catalogIds.Contains(r.CatalogItemId)).ToListAsync(cancellationToken);
        return candidates.Where(r => targets.Contains(r.Target!.Value)).ToList();
    }

    public async Task<IReadOnlyList<Recipe>> GetInCategoryAsync(Guid categoryId, CancellationToken cancellationToken = default) =>
        await WithIngredients.Where(r => r.RecipeCategoryId == categoryId).ToListAsync(cancellationToken);

    public Task<int> CountUsingAsync(Guid rawMaterialId, CancellationToken cancellationToken = default) =>
        db.Recipes.AsNoTracking().CountAsync(r => r.DeletedAtUtc == null && r.Ingredients.Any(i => i.RawMaterialId == rawMaterialId), cancellationToken);

    public async Task<IReadOnlyDictionary<Guid, int>> CountByCategoryAsync(CancellationToken cancellationToken = default) =>
        await db.Recipes.AsNoTracking()
            .Where(r => r.DeletedAtUtc == null && r.RecipeCategoryId != null)
            .GroupBy(r => r.RecipeCategoryId!.Value)
            .ToDictionaryAsync(g => g.Key, g => g.Count(), cancellationToken);
}

internal sealed class RecipeCategoryRepository(CostingDbContext db) : IRecipeCategoryRepository
{
    public Task<RecipeCategory?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        db.RecipeCategories.SingleOrDefaultAsync(c => c.Id == id, cancellationToken);

    public void Add(RecipeCategory aggregate) => db.RecipeCategories.Add(aggregate);

    public void Remove(RecipeCategory category) => db.RecipeCategories.Remove(category);

    public async Task<IReadOnlyList<RecipeCategory>> GetAllAsync(CancellationToken cancellationToken = default) =>
        await db.RecipeCategories.AsNoTracking().ToListAsync(cancellationToken);

    public Task<RecipeCategory?> GetByNormalizedNameAsync(string normalizedName, CancellationToken cancellationToken = default) =>
        db.RecipeCategories.AsNoTracking().SingleOrDefaultAsync(c => c.NormalizedName == normalizedName, cancellationToken);
}

internal sealed class StockMovementRepository(CostingDbContext db) : IStockMovementRepository
{
    public Task<StockMovement?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        db.StockMovements.SingleOrDefaultAsync(m => m.Id == id, cancellationToken);

    public void Add(StockMovement aggregate) => db.StockMovements.Add(aggregate);

    public Task<bool> ExistsAsync(Guid sourceId, StockMovementReason reason, CancellationToken cancellationToken = default) =>
        db.StockMovements.AnyAsync(m => m.SourceId == sourceId && m.Reason == reason, cancellationToken);

    public async Task<IReadOnlyList<StockMovement>> GetBySourceAsync(Guid sourceId, StockMovementReason reason, CancellationToken cancellationToken = default) =>
        await db.StockMovements.AsNoTracking().Where(m => m.SourceId == sourceId && m.Reason == reason).ToListAsync(cancellationToken);
}

internal sealed class StockCountRepository(CostingDbContext db) : IStockCountRepository
{
    private IQueryable<StockCount> WithLines => db.StockCounts.Include(c => c.Lines);

    public Task<StockCount?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        WithLines.SingleOrDefaultAsync(c => c.Id == id, cancellationToken);

    public void Add(StockCount aggregate) => db.StockCounts.Add(aggregate);

    public void Remove(StockCount draft) => db.StockCounts.Remove(draft);

    public Task<StockCount?> GetDraftAsync(CancellationToken cancellationToken = default) =>
        WithLines.FirstOrDefaultAsync(c => c.Status == StockCountStatus.Draft, cancellationToken);

    public async Task<IReadOnlyList<StockCount>> GetAllAsync(CancellationToken cancellationToken = default) =>
        await WithLines.AsNoTracking().ToListAsync(cancellationToken);

    public async Task<IReadOnlyDictionary<Guid, DateTime>> CountedBeforeAsync(
        IReadOnlyCollection<Guid> rawMaterialIds, Guid exceptStockCountId, CancellationToken cancellationToken = default) =>
        await db.Set<StockCountLine>().AsNoTracking()
            .Where(l => rawMaterialIds.Contains(l.RawMaterialId))
            .Join(db.StockCounts.Where(c => c.Status == StockCountStatus.Posted && c.Id != exceptStockCountId),
                l => l.StockCountId, c => c.Id, (l, c) => new { l.RawMaterialId, PostedAtUtc = c.PostedAtUtc!.Value })
            .GroupBy(x => x.RawMaterialId)
            .Select(g => new { RawMaterialId = g.Key, First = g.Min(x => x.PostedAtUtc) })
            .ToDictionaryAsync(x => x.RawMaterialId, x => x.First, cancellationToken);
}

internal sealed class PurchaseInvoiceRepository(CostingDbContext db) : IPurchaseInvoiceRepository
{
    private IQueryable<PurchaseInvoice> WithLines => db.PurchaseInvoices.Include(i => i.Lines);

    public Task<PurchaseInvoice?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        WithLines.SingleOrDefaultAsync(i => i.Id == id, cancellationToken);

    public void Add(PurchaseInvoice aggregate) => db.PurchaseInvoices.Add(aggregate);

    public void Remove(PurchaseInvoice draft) => db.PurchaseInvoices.Remove(draft);

    public async Task<IReadOnlyList<PurchaseInvoice>> GetByStatusAsync(PurchaseInvoiceStatus status, CancellationToken cancellationToken = default) =>
        await WithLines.AsNoTracking().Where(i => i.Status == status).ToListAsync(cancellationToken);

    public async Task<IReadOnlyDictionary<Guid, SupplierUse>> GetSupplierUseAsync(CancellationToken cancellationToken = default)
    {
        var invoices = await db.PurchaseInvoices.AsNoTracking()
            .Where(i => i.SupplierId != null)
            .GroupBy(i => i.SupplierId!.Value)
            .Select(g => new { SupplierId = g.Key, Count = g.Count(), Last = g.Max(i => i.PostedAtUtc) })
            .ToListAsync(cancellationToken);
        var totals = await db.Set<PurchaseInvoiceLine>().AsNoTracking()
            .Join(db.PurchaseInvoices.Where(i => i.SupplierId != null && i.Status == PurchaseInvoiceStatus.Posted),
                l => l.InvoiceId, i => i.Id, (l, i) => new { SupplierId = i.SupplierId!.Value, l.Cost })
            .GroupBy(x => x.SupplierId)
            .Select(g => new { SupplierId = g.Key, Total = g.Sum(x => x.Cost ?? 0) })
            .ToDictionaryAsync(x => x.SupplierId, x => x.Total, cancellationToken);
        return invoices.ToDictionary(
            x => x.SupplierId,
            x => new SupplierUse(x.Count, totals.GetValueOrDefault(x.SupplierId), x.Last));
    }

    public Task<bool> AnyForSupplierAsync(Guid supplierId, CancellationToken cancellationToken = default) =>
        db.PurchaseInvoices.AnyAsync(i => i.SupplierId == supplierId, cancellationToken);

    public async Task<IReadOnlyDictionary<Guid, ExpenseItemUse>> GetExpenseItemUseAsync(CancellationToken cancellationToken = default)
    {
        var lines = await db.Set<PurchaseInvoiceLine>().AsNoTracking()
            .Where(l => l.ExpenseItemId != null)
            .Join(db.PurchaseInvoices, l => l.InvoiceId, i => i.Id, (l, i) => new { ExpenseItemId = l.ExpenseItemId!.Value, l.Cost, i.Status, i.PostedAtUtc })
            .ToListAsync(cancellationToken);
        return lines
            .GroupBy(l => l.ExpenseItemId)
            .ToDictionary(g => g.Key, g => new ExpenseItemUse(
                g.Count(),
                g.Where(l => l.Status == PurchaseInvoiceStatus.Posted).Sum(l => l.Cost ?? 0),
                g.Max(l => l.PostedAtUtc)));
    }

    public Task<bool> AnyForExpenseItemAsync(Guid expenseItemId, CancellationToken cancellationToken = default) =>
        db.Set<PurchaseInvoiceLine>().AnyAsync(l => l.ExpenseItemId == expenseItemId, cancellationToken);
}

internal sealed class ApprovalRequestRepository(CostingDbContext db) : IApprovalRequestRepository
{
    public Task<ApprovalRequest?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        db.ApprovalRequests.SingleOrDefaultAsync(r => r.Id == id, cancellationToken);

    public void Add(ApprovalRequest aggregate) => db.ApprovalRequests.Add(aggregate);

    public async Task<IReadOnlyList<ApprovalRequest>> GetPendingAsync(CancellationToken cancellationToken = default) =>
        await db.ApprovalRequests.AsNoTracking()
            .Where(r => r.Status == ApprovalStatus.Pending)
            .OrderBy(r => r.RequestedAtUtc)
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<ApprovalRequest>> GetDecidedAsync(int take, CancellationToken cancellationToken = default) =>
        await db.ApprovalRequests.AsNoTracking()
            .Where(r => r.Status != ApprovalStatus.Pending)
            .OrderByDescending(r => r.DecidedAtUtc)
            .Take(take)
            .ToListAsync(cancellationToken);

    // Tracked: a manager's own delete approves it.
    public Task<ApprovalRequest?> GetPendingForAsync(Guid recordId, CancellationToken cancellationToken = default) =>
        db.ApprovalRequests.SingleOrDefaultAsync(r => r.RecordId == recordId && r.Status == ApprovalStatus.Pending, cancellationToken);
}

internal sealed class SafeTransactionRepository(CostingDbContext db) : ISafeTransactionRepository
{
    public Task<SafeTransaction?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        db.SafeTransactions.SingleOrDefaultAsync(t => t.Id == id, cancellationToken);

    public void Add(SafeTransaction aggregate) => db.SafeTransactions.Add(aggregate);

    public async Task<decimal> SafeBalanceAsync(DateOnly? through = null, CancellationToken cancellationToken = default) =>
        await db.SafeTransactions
            .Where(t => t.Fund == CashFund.Safe && (through == null || t.BusinessDate <= through))
            .SumAsync(t => t.Amount, cancellationToken);

    // Tracked: voiding it marks it.
    public Task<SafeTransaction?> GetTakingsAsync(DateOnly revenueDate, CancellationToken cancellationToken = default) =>
        db.SafeTransactions.FirstOrDefaultAsync(
            t => t.Kind == SafeTransactionKind.RevenueTransfer && t.RevenueDate == revenueDate && t.ReversalOf == null && t.VoidedAtUtc == null,
            cancellationToken);

    // The drawer's own: payments out of the day while it was not in the safe, less their voids.
    public async Task<decimal> PaidOutOfTakingsAsync(DateOnly revenueDate, CancellationToken cancellationToken = default) =>
        -await db.SafeTransactions
            .Where(t => t.Fund == CashFund.DayRevenue && t.RevenueDate == revenueDate)
            .SumAsync(t => t.Amount, cancellationToken);

    // Tracked: voiding it marks it.
    public Task<SafeTransaction?> GetPaymentOfInvoiceAsync(Guid invoiceId, CancellationToken cancellationToken = default) =>
        db.SafeTransactions.SingleOrDefaultAsync(
            t => t.PurchaseInvoiceId == invoiceId && t.Kind == SafeTransactionKind.InvoicePayment && t.ReversalOf == null && t.VoidedAtUtc == null,
            cancellationToken);

    public async Task<IReadOnlySet<Guid>> PaidInvoicesAsync(IReadOnlyCollection<Guid> invoiceIds, CancellationToken cancellationToken = default) =>
        (await db.SafeTransactions.AsNoTracking()
            .Where(t => t.Kind == SafeTransactionKind.InvoicePayment && t.ReversalOf == null && t.VoidedAtUtc == null
                && t.PurchaseInvoiceId != null && invoiceIds.Contains(t.PurchaseInvoiceId.Value))
            .Select(t => t.PurchaseInvoiceId!.Value)
            .ToListAsync(cancellationToken))
        .ToHashSet();

    public async Task<IReadOnlyList<SafeTransaction>> GetForPayrollMonthAsync(
        DateOnly month, Guid? employeeId = null, CancellationToken cancellationToken = default) =>
        await db.SafeTransactions.AsNoTracking()
            .Where(t => t.PayrollMonth == month && t.EmployeeId != null && (employeeId == null || t.EmployeeId == employeeId))
            .OrderBy(t => t.BusinessDate).ThenBy(t => t.RecordedAtUtc)
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<SafeTransaction>> GetPendingAdvancesAsync(CancellationToken cancellationToken = default) =>
        await db.SafeTransactions.AsNoTracking()
            .Where(t => t.Kind == SafeTransactionKind.EmployeeAdvance && t.EmployeeId == null && t.ReversalOf == null && t.VoidedAtUtc == null)
            .OrderByDescending(t => t.BusinessDate).ThenByDescending(t => t.RecordedAtUtc)
            .ToListAsync(cancellationToken);

    public Task<bool> AnyOpeningBalanceAsync(CancellationToken cancellationToken = default) =>
        db.SafeTransactions.AnyAsync(t => t.Kind == SafeTransactionKind.OpeningBalance && t.ReversalOf == null && t.VoidedAtUtc == null, cancellationToken);

    public async Task<decimal> TaxOwedAsync(CancellationToken cancellationToken = default) =>
        await db.SafeTransactions
            .Where(t => t.Kind == SafeTransactionKind.RevenueTransfer || t.Kind == SafeTransactionKind.TaxPayment)
            .SumAsync(t => t.Kind == SafeTransactionKind.RevenueTransfer ? t.TaxAmount : t.Amount, cancellationToken);
}

internal sealed class SupplierLedgerRepository(CostingDbContext db) : ISupplierLedgerRepository
{
    public Task<SupplierLedgerEntry?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        db.SupplierLedgerEntries.SingleOrDefaultAsync(e => e.Id == id, cancellationToken);

    public void Add(SupplierLedgerEntry aggregate) => db.SupplierLedgerEntries.Add(aggregate);

    public async Task<decimal> BalanceAsync(Guid supplierId, CancellationToken cancellationToken = default) =>
        await db.SupplierLedgerEntries.Where(e => e.SupplierId == supplierId).SumAsync(e => e.Amount, cancellationToken);

    public async Task<IReadOnlyList<SupplierLedgerEntry>> GetBySourceAsync(Guid sourceId, CancellationToken cancellationToken = default) =>
        await db.SupplierLedgerEntries.Where(e => e.SourceId == sourceId).ToListAsync(cancellationToken);
}

internal sealed class PurchaseCategoryRepository(CostingDbContext db) : IPurchaseCategoryRepository
{
    public Task<PurchaseCategory?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        db.PurchaseCategories.SingleOrDefaultAsync(c => c.Id == id, cancellationToken);

    public void Add(PurchaseCategory aggregate) => db.PurchaseCategories.Add(aggregate);

    public void Remove(PurchaseCategory category) => db.PurchaseCategories.Remove(category);

    public async Task<IReadOnlyList<PurchaseCategory>> GetAllAsync(CancellationToken cancellationToken = default) =>
        await db.PurchaseCategories.AsNoTracking().ToListAsync(cancellationToken);

    public Task<PurchaseCategory?> GetByNormalizedNameAsync(string normalizedName, CancellationToken cancellationToken = default) =>
        db.PurchaseCategories.AsNoTracking().SingleOrDefaultAsync(c => c.NormalizedName == normalizedName, cancellationToken);

    public async Task<IReadOnlyDictionary<Guid, PurchaseCategoryUse>> GetUseAsync(CancellationToken cancellationToken = default)
    {
        var materials = await db.RawMaterials.AsNoTracking().GroupBy(m => m.CategoryId)
            .Select(g => new { g.Key, Count = g.Count(), Active = g.Count(m => m.ArchivedAtUtc == null) })
            .ToDictionaryAsync(x => x.Key, cancellationToken);
        var expenses = await db.ExpenseItems.AsNoTracking().GroupBy(e => e.CategoryId)
            .Select(g => new { g.Key, Count = g.Count(), Active = g.Count(e => !e.IsArchived) })
            .ToDictionaryAsync(x => x.Key, cancellationToken);
        return materials.Keys.Union(expenses.Keys)
            .ToDictionary(id => id, id => new PurchaseCategoryUse(
                materials.GetValueOrDefault(id)?.Count ?? 0, expenses.GetValueOrDefault(id)?.Count ?? 0,
                materials.GetValueOrDefault(id)?.Active ?? 0, expenses.GetValueOrDefault(id)?.Active ?? 0));
    }
}

internal sealed class ExpenseItemRepository(CostingDbContext db) : IExpenseItemRepository
{
    public Task<ExpenseItem?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        db.ExpenseItems.SingleOrDefaultAsync(e => e.Id == id, cancellationToken);

    public void Add(ExpenseItem aggregate) => db.ExpenseItems.Add(aggregate);

    public void Remove(ExpenseItem item) => db.ExpenseItems.Remove(item);

    public async Task<IReadOnlyList<ExpenseItem>> GetAllAsync(CancellationToken cancellationToken = default) =>
        await db.ExpenseItems.AsNoTracking().ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<ExpenseItem>> GetByIdsAsync(IReadOnlyCollection<Guid> ids, CancellationToken cancellationToken = default) =>
        await db.ExpenseItems.AsNoTracking().Where(e => ids.Contains(e.Id)).ToListAsync(cancellationToken);

    // Tracked: to be moved to another category.
    public async Task<IReadOnlyList<ExpenseItem>> GetInCategoryAsync(Guid categoryId, CancellationToken cancellationToken = default) =>
        await db.ExpenseItems.Where(e => e.CategoryId == categoryId).ToListAsync(cancellationToken);

    public Task<ExpenseItem?> GetByNormalizedNameAsync(string normalizedName, CancellationToken cancellationToken = default) =>
        db.ExpenseItems.AsNoTracking().SingleOrDefaultAsync(e => e.NormalizedName == normalizedName, cancellationToken);
}

internal sealed class SupplierRepository(CostingDbContext db) : ISupplierRepository
{
    public Task<Supplier?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        db.Suppliers.SingleOrDefaultAsync(s => s.Id == id, cancellationToken);

    public void Add(Supplier aggregate) => db.Suppliers.Add(aggregate);

    public void Remove(Supplier supplier) => db.Suppliers.Remove(supplier);

    public async Task<IReadOnlyList<Supplier>> GetAllAsync(CancellationToken cancellationToken = default) =>
        await db.Suppliers.AsNoTracking().ToListAsync(cancellationToken);

    public Task<Supplier?> GetByNormalizedNameAsync(string normalizedName, CancellationToken cancellationToken = default) =>
        db.Suppliers.AsNoTracking().SingleOrDefaultAsync(s => s.NormalizedName == normalizedName, cancellationToken);
}

// An invoice's photo or scan: one row per invoice, its bytes alone.
public sealed class PurchaseInvoiceAttachment
{
    public Guid InvoiceId { get; init; }
    public byte[] Content { get; set; } = [];
}

internal sealed class PurchaseAttachmentStore(CostingDbContext db) : IPurchaseAttachmentStore
{
    // Replaces what a draft had; the invoice's own rules say when that is allowed.
    public void Put(Guid invoiceId, byte[] content)
    {
        var existing = db.PurchaseInvoiceAttachments.Local.FirstOrDefault(a => a.InvoiceId == invoiceId)
            ?? db.PurchaseInvoiceAttachments.Find(invoiceId);
        if (existing is null)
            db.PurchaseInvoiceAttachments.Add(new PurchaseInvoiceAttachment { InvoiceId = invoiceId, Content = content });
        else
            existing.Content = content;
    }

    public async Task<byte[]?> GetAsync(Guid invoiceId, CancellationToken cancellationToken = default) =>
        await db.PurchaseInvoiceAttachments.AsNoTracking()
            .Where(a => a.InvoiceId == invoiceId)
            .Select(a => a.Content)
            .SingleOrDefaultAsync(cancellationToken);
}

internal sealed class PrepRecipeRepository(CostingDbContext db) : IPrepRecipeRepository
{
    private IQueryable<PrepRecipe> WithIngredients => db.PrepRecipes.Include(r => r.Ingredients);

    public Task<PrepRecipe?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        WithIngredients.SingleOrDefaultAsync(r => r.Id == id, cancellationToken);

    public void Add(PrepRecipe aggregate) => db.PrepRecipes.Add(aggregate);

    public async Task<IReadOnlyList<PrepRecipe>> GetAllAsync(CancellationToken cancellationToken = default) =>
        await WithIngredients.AsNoTracking().ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<PrepRecipe>> GetInCategoryAsync(Guid recipeCategoryId, CancellationToken cancellationToken = default) =>
        await WithIngredients.Where(r => r.RecipeCategoryId == recipeCategoryId).ToListAsync(cancellationToken);
}

internal sealed class ProductionOrderRepository(CostingDbContext db) : IProductionOrderRepository
{
    private IQueryable<ProductionOrder> WithLines => db.ProductionOrders.Include(o => o.Lines);

    public Task<ProductionOrder?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        WithLines.SingleOrDefaultAsync(o => o.Id == id, cancellationToken);

    public void Add(ProductionOrder aggregate) => db.ProductionOrders.Add(aggregate);

    public async Task<IReadOnlyList<ProductionOrder>> GetRecentAsync(Guid? prepItemId, int take, CancellationToken cancellationToken = default) =>
        await WithLines.AsNoTracking()
            .Where(o => prepItemId == null || o.PrepItemId == prepItemId)
            .OrderByDescending(o => o.ProducedAtUtc)
            .Take(take)
            .ToListAsync(cancellationToken);
}

// What a deletion request's summary needs from outside the inventory module: names from the
// menu the till holds (deleted items too, as an old recipe may name one), and the business date.
internal sealed class RecordDescriptions(CostingDbContext db, IBusinessCalendar clock) : IRecordDescriptions
{
    public async Task<string?> MenuItemNameAsync(RecipeTargetKind kind, int catalogItemId, int? variantId, CancellationToken cancellationToken)
    {
        if (kind == RecipeTargetKind.AddOn)
            return await db.AddOns.AsNoTracking().IgnoreQueryFilters().Where(a => a.Id == catalogItemId).Select(a => a.Name).SingleOrDefaultAsync(cancellationToken);

        var item = await db.MenuItems.AsNoTracking().IgnoreQueryFilters().Where(m => m.Id == catalogItemId).Select(m => m.Name).SingleOrDefaultAsync(cancellationToken);
        if (item is null || variantId is null)
            return item;
        var variant = await db.MenuItemVariants.AsNoTracking().Where(v => v.Id == variantId).Select(v => v.Name).SingleOrDefaultAsync(cancellationToken);
        return variant is null ? item : $"{item} ({variant})";
    }

    public DateOnly BusinessDateOf(DateTime utc) => clock.BusinessDateOf(utc);

    public DateOnly LocalDateOf(DateTime utc) => clock.LocalDateOf(utc);

    public DateTime LocalTimeOf(DateTime utc) => DateTime.SpecifyKind(clock.ToLocal(utc), DateTimeKind.Unspecified);
}

internal sealed class BreakageEntryRepository(CostingDbContext db) : IBreakageEntryRepository
{
    public Task<BreakageEntry?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        db.BreakageEntries.SingleOrDefaultAsync(b => b.Id == id, cancellationToken);

    public void Add(BreakageEntry aggregate) => db.BreakageEntries.Add(aggregate);

    public async Task<IReadOnlyList<BreakageEntry>> GetBetweenAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken = default) =>
        await db.BreakageEntries.AsNoTracking()
            .Where(b => b.BusinessDate >= from && b.BusinessDate <= to)
            .OrderByDescending(b => b.BusinessDate).ThenByDescending(b => b.RecordedAtUtc)
            .ToListAsync(cancellationToken);

    public Task<BreakageEntry?> GetForTransactionAsync(Guid assetTransactionId, CancellationToken cancellationToken = default) =>
        db.BreakageEntries.SingleOrDefaultAsync(b => b.AssetTransactionId == assetTransactionId, cancellationToken);
}
```


> 📄 **`backend/src/Costing.Infrastructure/Persistence/MenuSalesRepositories.cs`** — 114 سطر

```csharp
using Microsoft.EntityFrameworkCore;
using Costing.Domain.Access;
using Costing.Domain.Menu;
using Costing.Domain.Sales;
using Costing.Domain.Staff;

namespace Costing.Infrastructure.Persistence;

internal sealed class MenuRepository(CostingDbContext db) : IMenuRepository
{
    // A new item's number when none is given: after the highest there is, from 1001.
    private const int FirstNumber = 1001;

    public async Task<IReadOnlyList<MenuCategory>> GetCategoriesAsync(CancellationToken cancellationToken = default) =>
        await db.MenuCategories.OrderBy(c => c.DisplayOrder).ThenBy(c => c.Name).ToListAsync(cancellationToken);

    public Task<MenuCategory?> GetCategoryAsync(int id, CancellationToken cancellationToken = default) =>
        db.MenuCategories.SingleOrDefaultAsync(c => c.Id == id, cancellationToken);

    public void AddCategory(MenuCategory category) => db.MenuCategories.Add(category);

    public void RemoveCategory(MenuCategory category) => db.MenuCategories.Remove(category);

    public async Task<IReadOnlyList<MenuItem>> GetItemsAsync(CancellationToken cancellationToken = default) =>
        await db.MenuItems.OrderBy(m => m.Id).ToListAsync(cancellationToken);

    public Task<MenuItem?> GetItemAsync(int id, CancellationToken cancellationToken = default) =>
        db.MenuItems.SingleOrDefaultAsync(m => m.Id == id, cancellationToken);

    public async Task<int> NextItemNumberAsync(CancellationToken cancellationToken = default) =>
        Math.Max(FirstNumber, (await db.MenuItems.MaxAsync(m => (int?)m.Id, cancellationToken) ?? 0) + 1);

    public void AddItem(MenuItem item) => db.MenuItems.Add(item);

    public async Task<IReadOnlyList<AddOn>> GetAddOnsAsync(CancellationToken cancellationToken = default) =>
        await db.AddOns.OrderBy(a => a.Id).ToListAsync(cancellationToken);

    public Task<AddOn?> GetAddOnAsync(int id, CancellationToken cancellationToken = default) =>
        db.AddOns.SingleOrDefaultAsync(a => a.Id == id, cancellationToken);

    public void AddAddOn(AddOn addOn) => db.AddOns.Add(addOn);
}

internal sealed class SalesReceiptRepository(CostingDbContext db) : ISalesReceiptRepository
{
    public Task<SalesReceipt?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        db.SalesReceipts.SingleOrDefaultAsync(r => r.Id == id, cancellationToken);

    public void Add(SalesReceipt aggregate) => db.SalesReceipts.Add(aggregate);

    public async Task<IReadOnlyList<SalesReceipt>> GetPaidAsync(DateTime fromUtc, DateTime toUtc, CancellationToken cancellationToken = default) =>
        await db.SalesReceipts.AsNoTracking()
            .Where(r => r.VoidedAtUtc == null && r.SoldAtUtc >= fromUtc && r.SoldAtUtc < toUtc)
            .OrderBy(r => r.SoldAtUtc)
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<SalesReceipt>> GetForDaysAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken = default) =>
        await db.SalesReceipts.AsNoTracking()
            .Where(r => r.BusinessDate >= from && r.BusinessDate <= to)
            .OrderByDescending(r => r.SoldAtUtc).ThenByDescending(r => r.EnteredAtUtc)
            .ToListAsync(cancellationToken);

    public Task<SalesReceipt?> GetDailySummaryAsync(DateOnly date, CancellationToken cancellationToken = default) =>
        db.SalesReceipts.FirstOrDefaultAsync(
            r => r.BusinessDate == date && r.Source == SalesSource.DailySummary && r.VoidedAtUtc == null, cancellationToken);

    public async Task<IReadOnlySet<string>> GetReferencesAsync(IReadOnlyCollection<string> references, CancellationToken cancellationToken = default)
    {
        if (references.Count == 0)
            return new HashSet<string>();
        var asked = references.ToList();
        return (await db.SalesReceipts.AsNoTracking()
                .Where(r => r.Reference != null && asked.Contains(r.Reference))
                .Select(r => r.Reference!)
                .ToListAsync(cancellationToken))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
    }
}

internal sealed class StaffMemberRepository(CostingDbContext db) : IStaffMemberRepository
{
    public Task<StaffMember?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        db.Staff.SingleOrDefaultAsync(s => s.Id == id, cancellationToken);

    public void Add(StaffMember aggregate) => db.Staff.Add(aggregate);

    public async Task<IReadOnlyList<StaffMember>> GetAllAsync(CancellationToken cancellationToken = default) =>
        await db.Staff.OrderBy(s => s.Name).ToListAsync(cancellationToken);
}

internal sealed class UserTabAccessRepository(CostingDbContext db) : IUserTabAccessRepository
{
    public Task<UserTabAccess?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        db.UserTabAccess.SingleOrDefaultAsync(a => a.Id == id, cancellationToken);

    public void Add(UserTabAccess aggregate) => db.UserTabAccess.Add(aggregate);

    public Task<UserTabAccess?> GetByUserAsync(string userId, CancellationToken cancellationToken = default) =>
        db.UserTabAccess.SingleOrDefaultAsync(a => a.UserId == userId, cancellationToken);

    public async Task<IReadOnlyList<UserTabAccess>> GetAllAsync(CancellationToken cancellationToken = default) =>
        await db.UserTabAccess.ToListAsync(cancellationToken);

    public void Remove(UserTabAccess access) => db.UserTabAccess.Remove(access);
}

// The rate the treasury takes off a day's takings entered with the tax in them: the bills' own, as
// set on Tax & service.
internal sealed class FinancialTaxRate(CostingDbContext db) : Costing.Application.Treasury.ITaxRate
{
    public async Task<decimal> PercentAsync(CancellationToken cancellationToken) =>
        (await db.FinancialSettings.AsNoTracking().SingleOrDefaultAsync(cancellationToken))?.TaxPercent
        ?? throw new Costing.Domain.Common.DomainException("Set the tax rate on Financials → Tax & service first.");
}
```


> 📄 **`backend/src/Costing.Infrastructure/Persistence/EndOfDayRepositories.cs`** — 55 سطر

```csharp
using Microsoft.EntityFrameworkCore;
using Costing.Domain.EndOfDay;

namespace Costing.Infrastructure.Persistence;

internal sealed class EndOfDayRepository(CostingDbContext db) : IEndOfDayRepository
{
    private IQueryable<EndOfDayReport> WithInvoices => db.EndOfDayReports.Include(d => d.Invoices).Include(d => d.Payouts).AsSplitQuery();

    public Task<EndOfDayReport?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        WithInvoices.SingleOrDefaultAsync(d => d.Id == id, cancellationToken);

    public void Add(EndOfDayReport aggregate) => db.EndOfDayReports.Add(aggregate);

    public Task<EndOfDayReport?> GetByDateAsync(DateOnly date, CancellationToken cancellationToken = default) =>
        WithInvoices.SingleOrDefaultAsync(d => d.Date == date, cancellationToken);

    public async Task<IReadOnlyList<EndOfDayReport>> GetBetweenAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken = default) =>
        await WithInvoices.Where(d => d.Date >= from && d.Date <= to).ToListAsync(cancellationToken);

    public Task<EndOfDayReport?> GetByInvoiceAsync(Guid invoiceId, CancellationToken cancellationToken = default) =>
        WithInvoices.SingleOrDefaultAsync(d => d.Invoices.Any(i => i.Id == invoiceId), cancellationToken);

    public Task<EndOfDayReport?> GetByPayoutAsync(Guid payoutId, CancellationToken cancellationToken = default) =>
        WithInvoices.SingleOrDefaultAsync(d => d.Payouts.Any(p => p.Id == payoutId), cancellationToken);
}

// A photo handed in at the end of the day: one row each, its bytes alone.
public sealed class EndOfDayPhotoContent
{
    public Guid Id { get; init; }
    public byte[] Content { get; set; } = [];
}

internal sealed class EndOfDayPhotoStore(CostingDbContext db) : IEndOfDayPhotoStore
{
    public void Put(Guid id, byte[] content)
    {
        var existing = db.EndOfDayPhotos.Local.FirstOrDefault(p => p.Id == id) ?? db.EndOfDayPhotos.Find(id);
        if (existing is null)
            db.EndOfDayPhotos.Add(new EndOfDayPhotoContent { Id = id, Content = content });
        else
            existing.Content = content;
    }

    public async Task<byte[]?> GetAsync(Guid id, CancellationToken cancellationToken = default) =>
        db.EndOfDayPhotos.Local.FirstOrDefault(p => p.Id == id)?.Content
        ?? await db.EndOfDayPhotos.AsNoTracking().Where(p => p.Id == id).Select(p => p.Content).SingleOrDefaultAsync(cancellationToken);

    public void Remove(Guid id)
    {
        if ((db.EndOfDayPhotos.Local.FirstOrDefault(p => p.Id == id) ?? db.EndOfDayPhotos.Find(id)) is { } photo)
            db.EndOfDayPhotos.Remove(photo);
    }
}
```


### 13.5 إعادة المحاولة عند التصادم

أمر يحمل `IRetryOnConflict` ⇐ عند `ConflictException`: `ChangeTracker.Clear()` وإعادة من البداية (حتى 3 مرات).

> 📄 **`backend/src/Costing.Infrastructure/Persistence/RetryOnConflictBehavior.cs`** — 33 سطر

```csharp
using MediatR;
using Costing.Domain.Common;

namespace Costing.Infrastructure.Persistence;

// Runs an IRetryOnConflict request again, from a clean change tracker, when its save collides
// with another; a few times, a moment apart. Anything else, and a conflict that persists, goes
// back to the caller as before.
internal sealed class RetryOnConflictBehavior<TRequest, TResponse>(CostingDbContext db) : IPipelineBehavior<TRequest, TResponse>
    where TRequest : notnull
{
    private const int Attempts = 3;

    public async Task<TResponse> Handle(TRequest request, RequestHandlerDelegate<TResponse> next, CancellationToken cancellationToken)
    {
        if (request is not IRetryOnConflict)
            return await next(cancellationToken);

        for (var attempt = 1; ; attempt++)
        {
            try
            {
                return await next(cancellationToken);
            }
            catch (ConflictException) when (attempt < Attempts)
            {
                // What was loaded is stale: the handler reads it all again.
                db.ChangeTracker.Clear();
                await Task.Delay(TimeSpan.FromMilliseconds(50 * attempt), cancellationToken);
            }
        }
    }
}
```


## 14. الـ Migrations

```bash
dotnet ef migrations add <Name> \
  --project backend/src/Costing.Infrastructure \
  --startup-project backend/src/Costing.Infrastructure \
  --output-dir Persistence/Migrations
```

| # | Migration | ما أضافته (من اسمها) |
| --- | --- | --- |
| 1 | `20261101184148_InitialCreate` | Initial Create |
| 2 | `20261102193702_AddStockCountKind` | Add Stock Count Kind |
| 3 | `20261102203200_AddTakingsBreakdown` | Add Takings Breakdown |
| 4 | `20261103120817_AddPurchaseDiscounts` | Add Purchase Discounts |
| 5 | `20261103153917_UnifySafeTakings` | Unify Safe Takings |
| 6 | `20261104214140_AddEndOfDay` | Add End Of Day |
| 7 | `20261110093114_AddPosIntegration` | Add Pos Integration |
| 8 | `20261110170004_AddEndOfDayPayouts` | Add End Of Day Payouts |
| 9 | `20261110175322_AddHrIntegration` | Add Hr Integration |


### 14.1 `UnifySafeTakings`: migration تحوّل بيانات لا شكلًا فقط

قبلها كان التوريد: "الكاش **شامل** الضريبة، والفيزا خارج الخزنة". بعدها: الكاش والفيزا **قبل الضريبة**، والضريبة فوقهما، والفيزا تدخل الخزنة الموحدة. الـ migration تحوّل الصفوف القديمة بـ SQL:

```sql
UPDATE costing."SafeTransactions" SET
  "GrossAmount" = COALESCE("GrossAmount","Amount") - ROUND("TaxAmount" × حصة الكاش, 2),   -- الكاش قبل الضريبة
  "CardAmount"  = "CardAmount" - ("TaxAmount" − حصة الكاش من الضريبة),                    -- الفيزا قبل الضريبة
  "Amount"      = "Amount" + "CardAmount"                                                  -- الفيزا تدخل الخزنة
WHERE "Kind" = 'RevenueTransfer';
```

الضريبة القديمة وُزعت على الكاش والفيزا **بنسبة كل منهما** ثم قُرّبت للقرش. **الدرس:** حين يتغير معنى عمود، الـ migration يجب أن تحوّل البيانات القديمة لتحافظ على صحة التقارير التاريخية، ثم تختبرها على نسخة قديمة قبل الإنتاج (وهذا ما حدث: جُربت على قاعدة مؤقتة بنيت عند `AddPurchaseDiscounts` بصفوف بالشكل القديم).

### 14.2 `AddEndOfDayPayouts`

إضافية بحتة: عمود `OpeningFloat` في `EndOfDayReports`، وجدول `EndOfDayPayouts` (سداد الموردين وسلف الموظفين من الدرج، كلٌّ بإيصاله في `EndOfDayPhotos` بمفتاح الدفعة).

### 14.3 التطبيق التلقائي عند التشغيل

`DatabaseStartup`: `MigrateAsync()` (ما لم يُعطّل)، ثم إعدادات الشركة، ثم أول مدير.

> 📄 **`backend/src/Costing.Api/Hosting/DatabaseStartup.cs`** — 30 سطر

```csharp
using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Costing.Api.Auth;
using Costing.Application.Company;
using Costing.Infrastructure.Identity;
using Costing.Infrastructure.Persistence;

namespace Costing.Api.Hosting;

internal static class DatabaseStartup
{
    // Runs before the app listens: the database brought up to date, the company's settings read
    // (made from the configuration's Company section the first time), and the first manager made
    // when there is no user yet. Set Database:MigrateOnStartup to false where something else
    // applies the migrations.
    public static async Task PrepareDatabaseAsync(this WebApplication app)
    {
        await using var scope = app.Services.CreateAsyncScope();

        if (app.Configuration.GetValue("Database:MigrateOnStartup", defaultValue: true))
            await scope.ServiceProvider.GetRequiredService<CostingDbContext>().Database.MigrateAsync();

        await scope.ServiceProvider.GetRequiredService<ISender>().Send(new EnsureCompanySettingsCommand());

        var first = scope.ServiceProvider.GetRequiredService<IOptions<AuthOptions>>().Value.FirstManager;
        await scope.ServiceProvider.GetRequiredService<UserDirectory>()
            .EnsureFirstManagerAsync(first.Email, first.Name, first.Password, CancellationToken.None);
    }
}
```


[الفصل التالي: الهوية والصلاحيات والموافقات →](03-auth-permissions-and-approvals.md)
