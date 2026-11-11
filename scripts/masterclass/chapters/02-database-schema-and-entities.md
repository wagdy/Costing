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

@@file backend/src/Costing.Domain/Common/Entity.cs

@@file backend/src/Costing.Domain/Common/AggregateRoot.cs

@@file backend/src/Costing.Domain/Common/DomainEvent.cs

الاستثناءات: `DomainException` (قاعدة عمل رفضت، رسالتها للمستخدم ⇐ 422)، و `NotFound`/`Forbidden`/`Conflict`، و `IRetryOnConflict` (أمر آمن لإعادة التنفيذ).

@@file backend/src/Costing.Domain/Common/DomainException.cs

@@file backend/src/Costing.Domain/Common/ApplicationExceptions.cs

`IRepository<T>` مقيد بالجذور ولا `Remove` فيه افتراضيًا؛ و `IUnitOfWork`: كل تغييرات حالة الاستخدام في معاملة واحدة.

@@file backend/src/Costing.Domain/Common/IRepository.cs

@@file backend/src/Costing.Domain/Common/IUnitOfWork.cs

## 3. الشركة

`CompanySettings`: صف واحد: الاسم، العملة وموضعها (`L.E 1,400.00` أو `1,400.00 SAR`)، الدولة، المنطقة الزمنية، **ساعة بداية اليوم التجاري** (مطعم يغلق 2 فجرًا: مبيعات 1:30 فجرًا تتبع "أمس"). و `MoneyFormat.Format` يكتب المال بنفس الطريقة في كل مكان.

@@file backend/src/Costing.Domain/Company/CompanySettings.cs

## 4. الكتالوج

### 4.1 الوحدات: `UnitOfMeasure`

**وحدات أساسية فقط**: جرام، مللي، قطعة. شحنة 5 كجم تُسجل 5000 جم. لماذا؟ حتى لا تختلف الوصفة والفاتورة والجرد أبدًا على معنى "1".

@@file backend/src/Costing.Domain/RawMaterials/UnitOfMeasure.cs

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

@@file backend/src/Costing.Domain/RawMaterials/RawMaterial.cs

@@file backend/src/Costing.Domain/RawMaterials/IRawMaterialRepository.cs

### 4.3 الفئات والمصروفات والموردون

`PurchaseCategory`: فئة الشراء ونوعها (خامات أو مصروفات)، و **`ExpenseLine`**: أين تُحسب مصروفاتها في قائمة الدخل (أجور، مصروفات قابلة للتحكم، إشغال، …). المخزون المشترى لا يُحسب مصروفًا هنا: يصبح تكلفة مبيعات حين تستهلكه الوصفات.

@@file backend/src/Costing.Domain/Categories/PurchaseCategory.cs

`ExpenseItem`: ما يُشترى ولا يُخزَّن (منظفات، صيانة، كهرباء): يظهر في الفاتورة بجانب الخامات، لكنه لا يدخل المخزون ولا الوصفات أبدًا؛ تكلفته مصروف تحت فئته.

@@file backend/src/Costing.Domain/Expenses/ExpenseItem.cs

`Supplier`: مورد عليه فواتير لا يُحذف بل يُؤرشف.

@@file backend/src/Costing.Domain/Suppliers/Supplier.cs

## 5. دفتر المخزون

@@file backend/src/Costing.Domain/StockMovements/StockMovementReason.cs

@@file backend/src/Costing.Domain/StockMovements/StockMovement.cs

@@file backend/src/Costing.Domain/StockMovements/IStockMovementRepository.cs

## 6. الوصفات والإنتاج

- `Recipe`: وصفة طبق: لكل خامة **EP للوصفة كاملة** و Yield، وعدد الحصص (`Portions`). مرتبطة بهدف في الكتالوج (`RecipeTarget`: صنف منيو، أو حجم منه، أو إضافة): بيع وحدة من الهدف يخصم (EP ÷ Yield ÷ الحصص) من كل خامة.
- `RecipeIngredient`: الخامة، الكمية EP، و Yield (افتراضي الخامة إن لم يُحدد).
- `RecipeTarget`: معرّفات `int` للكتالوج فقط، فلا يعتمد المخزون على الكتالوج.
- `StockRequirements`: يحوّل سطر مبيعات إلى "كم تخصم من كل خامة".
- `PrepRecipe`: وصفة **دفعة** المصنّع ("10 كجم عجين = 6 كجم دقيق + 3.5 لتر ماء + 100 جم خميرة")؛ مكوناتها خامات أو مصنعات أخرى (تداخل)، و `AsPurchasedQuantity = Quantity × 100 ÷ Yield`.
- `ProductionOrder`: أمر إنتاج: المخطط والمنتج فعليًا، يُخرج المكونات بمتوسطها ويُدخل المصنّع بتكلفتها.

@@file backend/src/Costing.Domain/Recipes/RecipeTarget.cs

@@file backend/src/Costing.Domain/Recipes/RecipeIngredient.cs

@@file backend/src/Costing.Domain/Recipes/Recipe.cs

@@file backend/src/Costing.Domain/Recipes/RecipeCategory.cs

@@file backend/src/Costing.Domain/Recipes/IRecipeRepository.cs

@@file backend/src/Costing.Domain/Recipes/StockRequirements.cs

@@file backend/src/Costing.Domain/Production/PrepRecipe.cs

@@file backend/src/Costing.Domain/Production/ProductionOrder.cs

## 7. المنيو والمبيعات

`MenuItem` برقمه (كوده في كل التقارير، مثل `6101`)، وأحجامه (`6101-17`)، والإضافات (`A3`)، والفئات. `SalesReceipt`: إيصال مبيعات أو **ملخص يومي** (`SalesSource.DailySummary`، واحد لكل يوم)، بسطوره، والقناة وطريقة الدفع والإلغاءات.

@@file backend/src/Costing.Domain/Menu/MenuItem.cs

@@file backend/src/Costing.Domain/Sales/SalesReceipt.cs

## 8. المشتريات

`PurchaseInvoice`: مسودة ⇐ مرحّلة (`Posted`) ⇐ ملغاة (`Voided`). البند: خامة (يدخل المخزون) أو مصروف. `LineTotal` كما كُتب على الورقة، و `Discount` البند، و **`DiscountShare`** حصته من خصم الفاتورة (توزيع بالقرش، الفصل 05)، و `Cost` = الصافي الذي يدخل المتوسط. والدفع: نقدي من الخزنة، أو من إيراد يوم، أو آجل.

@@file backend/src/Costing.Domain/Purchases/PurchaseInvoice.cs

@@file backend/src/Costing.Domain/Purchases/IPurchaseInvoiceRepository.cs

## 9. الجرد والهالك

`StockCount`: مسودة تُحفظ أثناء العد (العد قد يستغرق ساعة والتابلت قد ينام)، ثم تُرحّل. **النوع**: `Opening` (افتتاحي: بداية القيم، لا يُعتبر فرقًا) أو `Periodic` (دوري: الفرق = عجز/زيادة). الشرح المحاسبي في الفصل 05.

@@file backend/src/Costing.Domain/StockCounts/StockCount.cs

@@file backend/src/Costing.Domain/StockCounts/IStockCountRepository.cs

`BreakageEntry`: الكسر (أطباق، كاسات): ليس مخزونًا؛ تكلفته على اليوم.

@@file backend/src/Costing.Domain/Waste/BreakageEntry.cs

@@file backend/src/Costing.Domain/Waste/IBreakageEntryRepository.cs

## 10. الخزنة

`SafeTransaction`: كل قيد في الخزنة. **صندوقان** (`CashFund`): الخزنة (`Safe`)، و **درج اليوم** (`DayRevenue`: إيراد يوم لم يُورَّد بعد؛ يمكن الدفع منه مباشرة). الأنواع: رصيد افتتاحي، تمويل، **توريد إيراد** (`RevenueTransfer`: كاش وفيزا **قبل الضريبة** + الضريبة فوقها)، إذن صرف مصروفات، سداد مورد، سداد فاتورة، سلفة موظف، صرف راتب، **سداد ضرائب** (`TaxPayment`)، و **صرف مسير رواتب** (`PayrollPayment`). و `Takings(...)` تفصل الضريبة من مبلغ شامل **بحيث يرجع الجمع للمبلغ المُدخل بالقرش** (الفصل 06).

@@file backend/src/Costing.Domain/Treasury/SafeTransaction.cs

`SupplierLedgerEntry`: الرصيد الافتتاحي للمورد (ما كان مستحقًا قبل بدء النظام).

@@file backend/src/Costing.Domain/Treasury/SupplierLedgerEntry.cs

## 11. تقفيل اليوم

`EndOfDayReport`: يوم واحد لكل فرع: الفواتير (نقدي من الدرج أو آجل) بصورها، **المدفوعات من الدرج** (`EndOfDayPayout`: سداد مورد أو سلفة موظف، كلٌّ بإيصاله)، المبيعات (كاش، فيزا، ضريبة، إلغاءات)، و **العُهدة/الفكة** (`OpeningFloat`). ومعادلاته (شرحها في الفصل 05):

```text
CashSalesCollected = الكاش + ضريبة الكاش
CashPaidOut        = فواتير نقدية + سداد موردين + سلف موظفين
NetCashInTill      = العُهدة + CashSalesCollected − CashPaidOut      (ما يجب أن يكون في الدرج)
ExpectedIntoSafe   = إجمالي الإيراد − CashPaidOut                    (ما يجب أن يصل الخزنة)
```

@@file backend/src/Costing.Domain/EndOfDay/EndOfDayReport.cs

## 12. الموظفون

`StaffMember`: اسم ووظيفة فقط (الموظف نفسه ملك نظام HR). `PayrollRun`: مسير شهر معتمد من HR (تكلفة العمالة وصافي النقدية)، و `StaffDeduction` (عجز خزنة/خصم على موظف).

@@file backend/src/Costing.Domain/Staff/StaffMember.cs

@@file backend/src/Costing.Domain/Staff/PayrollRun.cs

---

## 13. EF Core

### 13.1 الاتصال

`DATABASE_URL` (صيغة `postgres://user:pass@host:port/db` كما تعطيها Railway) أو `ConnectionStrings:Costing`.

@@file backend/src/Costing.Infrastructure/Persistence/DatabaseConnection.cs

### 13.2 `CostingDbContext`: شرح سطر بسطر

- `public sealed class CostingDbContext(...) : DbContext(options), IUnitOfWork`: الـ DbContext **هو** وحدة العمل.
- `CostingSchema = "costing"`, `IdentitySchema = "identity"`.
- `ConfigureNpgsql`: استعلام واحد (`SingleQuery`)، وجدول تاريخ الـ migrations داخل `costing` **بالاسم**: مستخدم قاعدة بيانات اسمه `costing` يجعل `"$user"` في `search_path` يشير إلى schema `costing`، فلو تُرك الجدول للبحث الافتراضي قد لا يُوجد فتُعاد كل الـ migrations!
- `DbSet<…>` لكل جدول.
- `OnModelCreating`: `ApplyConfigurationsFromAssembly` (يجد كل إعدادات الجداول تلقائيًا)، ثم حلقة: `Id` لا تولّده القاعدة، `DomainEvents` لا تُخزَّن، و `Version` ⇐ `xmin` للتزامن.
- `ConfigureConventions`: كل `decimal` بدقة (10,2) افتراضيًا (والكميات تتجاوزه صراحة بـ `IsQuantity()`).
- `SaveChangesAsync`: `TouchRootsOfChangedChildren` (تعديل ابن يعلّم أباه معدّلًا ليُفحص `xmin` الخاص به)، وترجمة أخطاء EF/Npgsql (تزامن، تكرار فريد، مفتاح أجنبي) إلى `ConflictException`، فلا تعرف الطبقات العليا شيئًا عن EF.

@@file backend/src/Costing.Infrastructure/Persistence/CostingDbContext.cs

@@file backend/src/Costing.Infrastructure/Persistence/CostingDbContextFactory.cs

### 13.3 الإعدادات بالـ Fluent API

`IsQuantity()` (دقة الكميات) و `IsEnumName()`:

@@file backend/src/Costing.Infrastructure/Persistence/Configurations/PropertyBuilderExtensions.cs

`InventoryConfigurations.cs`: الخامات، الوصفات، المخزون، الجرد، المشتريات، الخزنة، الموردون، الموافقات. لاحظ: **وصفة فعّالة واحدة لكل هدف** (فهرس فريد مرشّح `NULLS NOT DISTINCT` على `(TargetKind, CatalogItemId, VariantId)`)، فهرس الحركات الفريد، خامة واحدة لكل بند جرد ولكل بند فاتورة، **طلب موافقة معلّق واحد لكل سجل** (فهرس فريد على `RecordId` بشرط `Status = 'Pending'`)، قيد عكسي واحد لكل قيد خزنة، `Cascade` على البنود و `Restrict` على المراجع، وفهرس `PayrollRunId` على قيود الخزنة.

@@file backend/src/Costing.Infrastructure/Persistence/Configurations/InventoryConfigurations.cs

`MenuSalesConfigurations.cs`: رقم الصنف **يُعطى ولا يُولَّد** (هو كوده في التقارير)، والمبيعات، والموظفون، و `UserTabAccess`.

@@file backend/src/Costing.Infrastructure/Persistence/Configurations/MenuSalesConfigurations.cs

`EndOfDayConfigurations.cs`: تقرير واحد لكل يوم تجاري (فهرس فريد على التاريخ)، والصور في جدول منفصل.

@@file backend/src/Costing.Infrastructure/Persistence/Configurations/EndOfDayConfigurations.cs

إعدادات الشركة وشعارها (الشعار منفصل حتى لا تُحمّل الصورة مع كل قراءة):

@@file backend/src/Costing.Infrastructure/Company/CompanySettingsStore.cs

جداول التقارير والإعدادات: نسبة تكلفة الطعام المستهدفة (30% افتراضيًا)، إعدادات الضريبة والخدمة، المصروفات الشهرية، التكاليف المشتركة، وورقة المبيعات اليدوية:

@@file backend/src/Costing.Infrastructure/Reports/CostingTables.cs

### 13.4 المستودعات

قراءات العرض `AsNoTracking`، وقراءات التعديل متتبَّعة؛ ودوال بأسماء دقيقة بدل `IQueryable` يتسرب للأعلى.

@@file backend/src/Costing.Infrastructure/Persistence/InventoryRepositories.cs

@@file backend/src/Costing.Infrastructure/Persistence/MenuSalesRepositories.cs

@@file backend/src/Costing.Infrastructure/Persistence/EndOfDayRepositories.cs

### 13.5 إعادة المحاولة عند التصادم

أمر يحمل `IRetryOnConflict` ⇐ عند `ConflictException`: `ChangeTracker.Clear()` وإعادة من البداية (حتى 3 مرات).

@@file backend/src/Costing.Infrastructure/Persistence/RetryOnConflictBehavior.cs

## 14. الـ Migrations

```bash
dotnet ef migrations add <Name> \
  --project backend/src/Costing.Infrastructure \
  --startup-project backend/src/Costing.Infrastructure \
  --output-dir Persistence/Migrations
```

@@migrations

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

@@file backend/src/Costing.Api/Hosting/DatabaseStartup.cs

[الفصل التالي: الهوية والصلاحيات والموافقات →](03-auth-permissions-and-approvals.md)
