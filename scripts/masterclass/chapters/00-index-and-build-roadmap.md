# الماستر كلاس: بناء نظام التكاليف والماليات (Costing & Financials) من الصفر

> **لمن هذا؟** لمطوّر Full-Stack في بدايته، يريد أن يتعلم كيف يفكر مهندس كبير **ومحاسب تكاليف** معًا وهو يبني نظامًا حقيقيًا لمطعم: الخامات والوصفات والمصنعات، المشتريات والخزنة والضرائب، الجرد والهالك، التحليلات الذكية، وربطه بنقطة البيع ونظام الموارد البشرية.
>
> **ما الذي ستجده؟** عشرة فصول متتالية. كل فصل يشرح **لماذا** (المحاسبة والتصميم) قبل **كيف** (الكود)، ثم يعرض **الكود الحقيقي كاملًا** من المستودع `wagdy/Costing`، ملفًا ملفًا، بلا `// ... rest of code`.

## كيف بُني هذا الماستر كلاس (اقرأ أولًا)

1. **الكود هنا هو كود المستودع نفسه، حرفيًا.** كل كتلة كود مسبوقة بـ 📄 ومسار الملف وعدد أسطره، ومضمّنة من الملف كما هو. الشرح العربي كُتب يدويًا؛ والكود يُدرَج آليًا من المستودع حتى لا يختلف عن الحقيقة أبدًا.
2. **كل ملف إنتاجي مضمّن مرة واحدة بالضبط**، والتحقق آلي: السكربت `scripts/masterclass/build.py` يفشل إذا نقص ملف أو تكرر، أو بقيت كتلة كود مفتوحة، أو رابط لفصل غير موجود، أو ظهر شيء يشبه سرًّا (توكن، مفتاح). وبالأمر `--check` يفشل إذا تغيّر الكود ولم يُعَد بناء الفصول (الفصل 09 يشرح السكربت).
3. **الاستثناءات المقصودة فقط:** ملفات الـ Migrations (يولّدها `dotnet ef`؛ نشرح كيف تُولَّد ونعرض قائمتها)، والاختبارات (نعرض منها أمثلة كاملة حقيقية في الفصل 09)، و `package-lock.json` والأيقونة و `README.md`.
4. **مستويان من الشرح:** كل ملف له فقرة: ما هو، ولماذا صُمم هكذا، والمعادلة المحاسبية وراءه إن وجدت. والملفات المحورية لها **شرح سطر بسطر**: `Program.cs`، الـ `DbContext`، محركات التكلفة (`RawMaterial` و `RecipeCosts` و `MaterialExplosion`)، تقفيل اليوم والخزنة والتوريد، محركات التحليلات الأربعة وهندسة المنيو وكارتة الصنف، محركي الربط (POS و HR بالـ Outbox و AES-GCM)، `app.config.ts`، والشاشات الرئيسية.
5. **الصدق قبل كل شيء.** إذا وُصف شيء في طلبك بشكل لا يطابق المستودع، أقول ذلك وأشرح الحقيقة. مثال: "الأقسام الـ 16" هي في الكود **14 قسمًا للصلاحيات** (`CostingTabs`) + الموافقات + الإعدادات وروابطها؛ والخريطة أدناه تعرض الستة عشر هكذا.

## فهرس الفصول

| # | الفصل | ماذا ستتعلم |
| --- | --- | --- |
| 00 | [الفهرس وخارطة البناء](00-index-and-build-roadmap.md) | هذا الملف: خريطة تدفق البيانات والمحاسبة، والترتيب الزمني لبناء النظام |
| 01 | [العقلية والمعمارية والتأسيس](01-mindset-architecture-and-setup.md) | محاسبة تكاليف المطاعم كهندسة، الطبقات الأربع، أوامر الإنشاء، `Program.cs` سطرًا سطرًا، شجرة المجلدات |
| 02 | [قاعدة البيانات والكيانات](02-database-schema-and-entities.md) | الـ schemas، كل الكيانات، الـ `DbContext`، العلاقات والفهارس، الـ Migrations (ومنها `UnifySafeTakings` و `AddEndOfDayPayouts`) |
| 03 | [الهوية والصلاحيات والموافقات](03-auth-permissions-and-approvals.md) | JWT، الأدوار الأربعة، `[CostingTab]` و `UserTabAccess`، إخفاء التكاليف عن أمين المخزن، محرك الموافقات والحذف |
| 04 | [الخامات والوصفات والمصنعات والمنيو](04-catalog-materials-recipes-and-menu.md) | وحدات الشراء والهدر (Yield)، المتوسط المرجح، تكلفة المصنّع بوصفته قبل أول تشغيلة، أوامر الإنتاج، المنيو و "أضف للمنيو" |
| 05 | [المشتريات وتقفيل اليوم والمخزون](05-purchases-end-of-day-and-inventory.md) | الفواتير ويومية المشتريات، توزيع الخصم بالقرش، تقفيل اليوم وصافي الكاش، ملخص المبيعات، الجرد الافتتاحي والدوري، الهالك والكسر |
| 06 | [الماليات والخزنة والضريبة والتحليلات](06-financials-safe-tax-and-intelligence.md) | الخزنة الموحدة، فصل الضريبة كالتزام، السلف والرواتب، PPV، مخطط الطلبيات، النظري مقابل الفعلي، ABC، هندسة المنيو، كارتة الصنف، الـ KPIs وقائمة الدخل ونقطة التعادل |
| 07 | [محركات الإكسيل والربط](07-excel-engines-and-ecosystem-links.md) | الاستيراد والتصدير والقوائم المنسدلة المخفية، ربط الـ POS (ping/menu/z-report/events)، الربط ثنائي الاتجاه مع HR (AES-GCM و `HrOutbox`) |
| 08 | [نواة الفرونت إند وشاشات التشغيل](08-frontend-core-and-operations-screens.md) | Angular الحديث، البحث الذكي العربي، التنقل بـ Enter داخل الجداول، شاشات الخامات والوصفات والإنتاج والمنيو والمشتريات وتقفيل اليوم والجرد والهالك |
| 09 | [شاشات الماليات والتقارير والنشر](09-frontend-financials-reports-and-deployment.md) | الخزنة والتحليلات والتقارير والإعدادات والصلاحيات والموافقات وشاشات الربط، الاختبارات، Dockerfile و railway.json وسكربت التوليد |

## خريطة تدفق البيانات والمحاسبة بين الأقسام الـ 16

```text
                       ┌──────────────── الكتالوج (Catalog) ────────────────┐
                       │ 1 Materials الخامات      2 ExpenseItems المصروفات  │
                       │ 3 Recipes الوصفات/المصنعات  4 Menu المنيو           │
                       └────────┬─────────────────────────────┬────────────┘
                                │ تكلفة الوحدة (المتوسط المرجح)  │ ربط الصنف بالوصفة
  ┌─────────────────┐   شراء    ▼                              ▼
  │ 5 Purchases     │ ──────► رصيد ومتوسط ◄── 6 Production ── 7 Sales المبيعات
  │ المشتريات       │  مخزون    الخامة       (يأخذ الخامات      (ملخص يومي: يخصم
  │ + يومية المشتريات│          (Stock Ledger) ويضيف المصنّع)     الخامات بالوصفة)
  └──────┬──────────┘             ▲   ▲                              ▲
         │ نقدي/آجل                 │   │ 8 Waste الهالك والكسر          │ Z-report
         ▼                          │   │                                │
  ┌──────────────┐   تقفيل  ┌──────┴───┴──────┐                 ┌───────┴──────┐
  │ 10 Financials │◄────────│ 9 EndOfDay       │                 │ POS نقطة البيع│ (ربط خارجي)
  │ الخزنة/التوريد │  اليوم  │ تقفيل اليوم       │                 └──────────────┘
  │ الضريبة/السلف │          └──────────────────┘
  └──────┬───────┘                 11 Counts الجرد ──► الفروقات (Variance)
         │ سلف/خصومات ⇄ مسير معتمد
         ▼
  ┌──────────────┐   12 Reports التقارير (KPIs، قائمة الدخل، نقطة التعادل، النظري/الفعلي)
  │ HR الموارد    │   13 Intelligence التحليلات (PPV، مخطط الطلبيات، الاستهلاك، ABC)
  │ البشرية (ربط)  │   14 CostSettings إعدادات التكلفة (نسبة الهدف، التكاليف المشتركة)
  └──────────────┘   15 Approvals الموافقات (كل حذف/تعديل لمن لا يملك القرار)
                      16 Settings الإعدادات (الشركة، ربط POS، ربط HR، المستخدمون والصلاحيات)
```

**اقرأ الخريطة كمحاسب:**

- **المخزون (Stock Ledger) هو القلب:** كل حركة (شراء، إنتاج، بيع، هالك، جرد) سطر لا يُعدَّل أبدًا. الرصيد = مجموع الحركات، والمتوسط المرجح يتحرك مع كل شراء.
- **تكلفة البضاعة المباعة (COGS)** تأتي من المبيعات × الوصفات × متوسط التكلفة **وقت البيع**.
- **الإيراد** يأتي من التوريد (كاش + فيزا قبل الضريبة)، و **الضريبة التزام** على المطعم للدولة لا إيراد له.
- **الخزنة** وعاء نقدي واحد: يدخلها الإيراد والتمويل، ويخرج منها المصروفات وسداد الموردين والسلف والرواتب وتوريد الضريبة.
- **الفرق بين النظري والفعلي** (Variance) هو ما يكشف السرقة والهدر وأخطاء الوصفات.

---

## خارطة البناء الزمنية: من مجلد فارغ إلى نظام منشور

الترتيب المنطقي الصحيح (من الداخل للخارج، مع اختبار كل طبقة)، وليس الترتيب التاريخي الذي كُتب به المستودع.

> **قاعدة ذهبية:** لا تنتقل لخطوة قبل أن تنجح اختبارات الخطوة التي قبلها، وانظر دائمًا إلى سطر `skipped:` (يجب أن يكون 0).

### المرحلة 0: الأدوات

- [ ] **Step 1 — الأدوات:** .NET SDK 10، Node.js 22 و npm 10، Docker، Git، و:
  ```bash
  dotnet tool install --global dotnet-ef
  ```

### المرحلة 1: الهيكل وقاعدة البيانات (الفصل 01)

- [ ] **Step 2 — المستودع:**
  ```bash
  mkdir Costing && cd Costing && git init
  mkdir -p backend/src backend/tests frontend dev docs scripts
  ```
- [ ] **Step 3 — ملفات الجذر:** `.gitignore`، `.dockerignore`، `global.json`.
- [ ] **Step 4 — قاعدة التطوير:** `dev/docker-compose.yml` ثم `docker compose -f dev/docker-compose.yml up -d` (PostgreSQL على 5436).

### المرحلة 2: مشاريع الباك إند (الفصل 01)

- [ ] **Step 5 — الـ Solution والمشاريع:**
  ```bash
  dotnet new sln -n Costing --format slnx
  for p in Domain Application Infrastructure; do dotnet new classlib -n Costing.$p -o backend/src/Costing.$p -f net10.0; done
  dotnet new web -n Costing.Api -o backend/src/Costing.Api -f net10.0
  rm backend/src/*/Class1.cs
  dotnet add backend/src/Costing.Application reference backend/src/Costing.Domain
  dotnet add backend/src/Costing.Infrastructure reference backend/src/Costing.Application
  dotnet add backend/src/Costing.Api reference backend/src/Costing.Infrastructure
  dotnet sln Costing.slnx add backend/src/*/*.csproj
  ```
- [ ] **Step 6 — الحزم:** كما في ملفات الـ csproj في الفصل 01 (MediatR، Npgsql EF Core، ClosedXML، JwtBearer، HealthChecks، Http، Identity.Core…).
- [ ] **Step 7 — مشاريع الاختبار الأربعة** (xUnit v3، `OutputType=Exe`) كما في الفصل 09.
- [ ] **Step 8 — تحقق:** `dotnet build Costing.slnx`.

### المرحلة 3: الدومين (الفصول 02 و 03 و 04)

- [ ] **Step 9 — الأساسيات:** `Domain/Common/*`.
- [ ] **Step 10 — الشركة والصلاحيات:** `Company/CompanySettings.cs`، `Access/Permissions.cs`، `Access/CostingTabs.cs`.
- [ ] **Step 11 — الكتالوج:** `RawMaterials/UnitOfMeasure.cs` ثم `RawMaterial.cs` (المتوسط المرجح!)، `Categories/PurchaseCategory.cs`، `Expenses/ExpenseItem.cs`، `Suppliers/Supplier.cs`.
- [ ] **Step 12 — دفتر المخزون:** `StockMovements/*` (حركة لا تُعدَّل).
- [ ] **Step 13 — الوصفات والمصنعات:** `Recipes/*`، `Production/PrepRecipe.cs`، `ProductionOrder.cs`، ثم المحركات: `RecipeCosts.cs` و `MaterialExplosion.cs`.
- [ ] **Step 14 — المنيو والمبيعات:** `Menu/MenuItem.cs`، `Sales/SalesReceipt.cs`.
- [ ] **Step 15 — المشتريات والجرد والهالك:** `Purchases/*`، `StockCounts/*`، `Waste/*`.
- [ ] **Step 16 — الخزنة وتقفيل اليوم والموظفون:** `Treasury/*`، `EndOfDay/EndOfDayReport.cs`، `Staff/*`.
- [ ] **Step 17 — الموافقات والتكامل:** `Approvals/ApprovalRequest.cs`، `Integrations/*`.
- [ ] **Step 18 — تحقق:** `dotnet test --project backend/tests/Costing.Domain.Tests`.

### المرحلة 4: EF Core وقاعدة البيانات (الفصل 02)

- [ ] **Step 19 — الاتصال والـ DbContext والإعدادات:** `DatabaseConnection.cs`، `CostingDbContext.cs`، `Configurations/*`، `CostingDbContextFactory.cs`.
- [ ] **Step 20 — أول Migration:**
  ```bash
  dotnet ef migrations add InitialCreate \
    --project backend/src/Costing.Infrastructure \
    --startup-project backend/src/Costing.Infrastructure \
    --output-dir Persistence/Migrations
  ```
- [ ] **Step 21 — المستودعات** (`InventoryRepositories.cs`, `MenuSalesRepositories.cs`, `EndOfDayRepositories.cs`) و `RetryOnConflictBehavior.cs`.
- [ ] **Step 22 — تحقق:**
  ```bash
  export COSTING_TEST_DB="Host=localhost;Port=5436;Username=costing;Password=costing-dev"
  dotnet test --project backend/tests/Costing.Infrastructure.Tests
  ```

### المرحلة 5: حالات الاستخدام والتقارير (الفصول 03 إلى 07)

- [ ] **Step 23 — المشترك:** `Application/DependencyInjection.cs`، `Common/*`، `Company/Settings.cs`.
- [ ] **Step 24 — الموافقات والحذف والصلاحيات:** `Approvals/*`، `Access/UserTabs.cs`.
- [ ] **Step 25 — الكتالوج:** الخامات والوحدات والفئات والمصروفات والموردون والوصفات والمصنعات وأوامر الإنتاج والمنيو.
- [ ] **Step 26 — العمليات:** فواتير الشراء ويومية المشتريات وتعديل الفاتورة، تقفيل اليوم، المبيعات والملخص اليومي، الجرد، الكسر.
- [ ] **Step 27 — الخزنة:** `Treasury/Treasury.cs`، `Staff/Staff.cs`.
- [ ] **Step 28 — التقارير والتحليلات:** `Reports/*` (CostingService, VarianceService, KpiService, BreakEvenService, TreasuryService, IntelligenceService, PurchaseSpendingService).
- [ ] **Step 29 — الإكسيل:** `Excel/SheetBook.cs` ثم كل Workbook، ثم أوامر الاستيراد والتصدير.
- [ ] **Step 30 — الربط:** `Integrations/PosIntegration.cs` ثم `HrIntegration.cs` والبنية التحتية لهما، و migration لكل منهما.
- [ ] **Step 31 — تحقق:** `dotnet test --project backend/tests/Costing.Application.Tests`.

### المرحلة 6: الـ API (الفصول 01 و 03 إلى 07)

- [ ] **Step 32 — الإعدادات والمصادقة والاستضافة:** `appsettings*.json`، `Auth/*`، `Hosting/*`، `ErrorHandling/*`، `Program.cs`.
- [ ] **Step 33 — الـ Controllers:** Auth، Users، Settings، Inventory، Costing، MenuSales، EndOfDay، Financials، Intelligence، PosIntegration، HrIntegration.
- [ ] **Step 34 — شغّل وتحقق:**
  ```bash
  dotnet run --project backend/src/Costing.Api --launch-profile http
  curl http://localhost:5100/health/ready
  export COSTING_TEST_DB="Host=localhost;Port=5436;Username=costing;Password=costing-dev"
  dotnet test --solution Costing.slnx      # 0 failed, 0 skipped
  ```

### المرحلة 7: الفرونت إند (الفصلان 08 و 09)

- [ ] **Step 35 — أنشئ التطبيق:**
  ```bash
  npx @angular/cli@21 new frontend --style=scss --routing --ssr=false --skip-git
  cd frontend && npx ng add @angular/material@21
  npm install material-icons
  npm install -D vitest jsdom prettier
  ```
  ثم طابق الإعدادات مع الفصل 08.
- [ ] **Step 36 — النواة:** `main.ts`، `app.config.ts`، `app.routes.ts`، `core/*`، `features/shared/*`، `features/shell/*`، `features/sign-in/*`.
- [ ] **Step 37 — شاشات التشغيل:** الخامات، الوصفات والمصنعات، الإنتاج، المنيو، المشتريات ويومية المشتريات، تقفيل اليوم، المبيعات، الجرد، الهالك.
- [ ] **Step 38 — شاشات الماليات والتقارير والإدارة:** الخزنة والتمويل والمطابقة ويومية الإيراد والمصروفات والموردين والسلف والموظفين والرواتب والضريبة، التحليلات الخمسة (مع هندسة المنيو)، التقارير، الإعدادات، الصلاحيات، الموافقات، المستخدمون، شاشات الربط.
- [ ] **Step 39 — تحقق:**
  ```bash
  npx ng test --watch=false
  node scripts/build.mjs --configuration production
  ```

### المرحلة 8: النشر (الفصل 09)

- [ ] **Step 40 — Dockerfile و railway.json**، ثم `docker build -t costing .` وتشغيل محلي.
- [ ] **Step 41 — Railway:** خدمة من المستودع + PostgreSQL + المتغيرات (`DATABASE_URL`، `Auth__SigningKey`، `Auth__FirstManager__*`) + فحص `/health/ready`.
- [ ] **Step 42 — التوثيق:** عدّل `docs/` ثم أعد بناء الماستر كلاس وتحقق منه:
  ```bash
  python3 scripts/masterclass/build.py
  python3 scripts/masterclass/build.py --check
  ```
