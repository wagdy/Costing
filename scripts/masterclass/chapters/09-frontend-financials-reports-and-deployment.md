# الفصل 09: شاشات الماليات والتقارير والإدارة، الاختبارات، والنشر

[← الفصل السابق](08-frontend-core-and-operations-screens.md) · [الفهرس](00-index-and-build-roadmap.md)

## 1. الماليات (الخزنة)

### 1.1 `financials.ts`: المشترك بين شاشات الخزنة

- `isoDay`, `todayIso`, `monthBounds`, `BusinessDay`: التواريخ كما يأخذها الـ API (اليوم التجاري من الخادم لا من جهاز المستخدم).
- **`SafeVoucherDialog`**: نافذة كل قيد خزنة (مصروف، سداد مورد، سلفة، راتب، تمويل، **سداد ضريبة** بمفتاح "توريد ضريبة")، ومن أين يُدفع (الخزنة أو إيراد يوم).
- `entryTax` / `taxIn`: نفس معادلة الباك إند لاستخراج الضريبة من مبلغ شامل.
- **`TakingsDialog`**: التوريد (كاش، فيزا، ضريبة، إلغاءات)، **مملوءًا مسبقًا من تقفيل اليوم المسلّم** حتى يُكتب فوقه.
- `PayInvoiceDialog`, `SupplierOpeningDialog`.
- **`Treasury`**: خدمة "أدخل قيدًا": للمدير تنفيذ، ولغيره طلب موافقة، والرسالة تقول أيهما حدث.

@@file frontend/src/app/features/costing/financials.ts

@@file frontend/src/app/features/costing/financials-shell.ts

### 1.2 الشاشات

`SafePage`: **الخزنة الموحدة** شهرًا بشهر: شريط من 7 بطاقات (الكاش، الفيزا، الضريبة، الصافي، التمويل، الداخل، الخارج، والضريبة المستحقة الآن)، ثم الدفتر بالرصيد بعد كل سطر، والقيد العكسي يسمّي ما ألغاه. و `TakingsBadges`: شارات التوريد على سطر الدفتر (الكاش والفيزا قبل الضريبة، الضريبة ونسبتها، الصافي، وما دُفع من الدرج قبله).

@@file frontend/src/app/features/costing/safe-page.ts

@@file frontend/src/app/features/costing/takings-badges.ts

`FundingPage` (مصادر التمويل بالشهر)، `ReconciliationPage` (**المطابقة**: A صافي مبيعات اليوم مقابل B قيمة مبيعاته بأسعار المنيو؛ الفرق تحت = خصومات/وجبات موظفين/كاش ناقص، وفوق = أصناف لم تُدخل)، و `DailyCashPage` (**يومية الإيراد**: إجمالي اليوم ناقص ما دُفع من درجه مباشرة = ما وصل الخزنة).

@@file frontend/src/app/features/costing/funding-page.ts

@@file frontend/src/app/features/costing/reconciliation-page.ts

@@file frontend/src/app/features/costing/daily-cash-page.ts

المصروفات والموردون:

@@file frontend/src/app/features/costing/expense-vouchers-page.ts

@@file frontend/src/app/features/costing/supplier-debts-page.ts

@@file frontend/src/app/features/costing/supplier-payments-page.ts

@@file frontend/src/app/features/costing/supplier-payment-fields.ts

السلف والموظفون والرواتب (مع ربط HR: الموظفون من HR بكودهم وقسمهم، ومسيرات HR وصرفها، والخصومات):

@@file frontend/src/app/features/costing/advance-fields.ts

@@file frontend/src/app/features/costing/advances-page.ts

@@file frontend/src/app/features/costing/staff-page.ts

@@file frontend/src/app/core/costing/hr-staff.api.ts

@@file frontend/src/app/features/costing/payroll-page.ts

`TaxServicePage`: نسبة الضريبة التي تُطبَّق على كل فاتورة (والتوريد الشامل يُفصل بها)، ونسبة الخدمة.

@@file frontend/src/app/features/costing/tax-service-page.ts

## 2. التحليلات الذكية

العقد `intelligence.api.ts` (كل الكميات بوحدة الشراء)، ثم شاشة لكل محرك (المعادلات في الفصل 06):

- `PriceVariancePage`: المتوسط الذي دخلت به الخامة مقابل آخر سعر صافٍ، التغير ونسبته، الكمية، و **أثره على كل طبق ومصنّع** (الأكبر أولًا).
- `OrderPlannerPage`: أيام النظر للخلف، أيام التغطية، النمو، أو رقم لكل طبق؛ ثم ما يُصنع من المصنعات وما يُطلب من الخامات بوحدات شراء كاملة، وورقة الطلب.
- `ConsumptionPage`: الفعلي مقابل النظري لكل خامة بحكم السماحية، و "مبيع بلا وصفة".
- `AbcPage`: A/B/C وأيام الكفاية وخطر النفاد.

@@file frontend/src/app/core/costing/intelligence.api.ts

@@file frontend/src/app/features/costing/intelligence-shell.ts

@@file frontend/src/app/features/costing/price-variance-page.ts

@@file frontend/src/app/features/costing/order-planner-page.ts

@@file frontend/src/app/features/costing/consumption-page.ts

@@file frontend/src/app/features/costing/abc-page.ts

## 3. التقارير

- `SpendingPage` + `SpendingPie`: أين ذهب المال: ثلاث فطائر (مخزون مقابل مصروفات، ثم كل منهما بالفئة)، ثم عمود لكل فئة. (`SpendingPie` رسم SVG يدوي بلا مكتبة رسوم.)
- `TreasuryPage`: تحليل الخزنة والتدفقات لأي فترة.
- `TheoreticalPage`: التكلفة النظرية للمبيعات وورقة المبيعات اليدوية.
- `VariancePage`: الفروقات بين جردين (أحمر عجز، أزرق زيادة، ضمن السماحية).
- `KpisPage`: المؤشرات بالمدى الصحي وسبب النقص، وقائمة الدخل، وإدخال المصروفات الشهرية.
- `BreakEvenPage`: ورقة نقطة التعادل وسيناريوهاتها الأربعة.

@@file frontend/src/app/features/costing/costing-reports-shell.ts

@@file frontend/src/app/features/costing/spending-page.ts

@@file frontend/src/app/features/costing/spending-pie.ts

@@file frontend/src/app/features/costing/treasury-page.ts

@@file frontend/src/app/features/costing/theoretical-page.ts

@@file frontend/src/app/features/costing/variance-page.ts

@@file frontend/src/app/features/costing/kpis-page.ts

@@file frontend/src/app/features/costing/break-even-page.ts

## 4. الإعدادات والصلاحيات والموافقات والمستخدمون

`SettingsPage` (إعدادات التكلفة): نسبة تكلفة الطعام المستهدفة، فئات المشروبات، التكاليف المشتركة، المصروفات الشهرية.

@@file frontend/src/app/features/costing/settings-page.ts

`PermissionsPage`: صف لكل مستخدم بأقسامه الفعلية، و `TabsDialog` لتعليم الأقسام أو العودة لأقسام الدور.

@@file frontend/src/app/features/costing/permissions-page.ts

`Approvals` (الخدمة): **أثر الحذف لكل وحدة** بكلمات المحاسب ("الدفاتر لا تُعدَّل؛ القيد المرحّل يُلغى")، شارة الانتظار، ونافذة سبب الحذف. و `ApprovalsPage`: الطلبات بسطور التغيير، وتصحيح الفاتورة/الدفعة **بأثره على كل خامة** (`NetRow`)، والقرار. و `ApprovalChanges`: "الكمية: 10 كجم ← 12 كجم"، والجديد بقيمته فقط، والمحذوف مشطوب.

@@file frontend/src/app/features/costing/approvals.ts

@@file frontend/src/app/features/costing/approval-changes.ts

@@file frontend/src/app/features/costing/approvals-page.ts

المستخدمون والحساب:

@@file frontend/src/app/core/users/users.api.ts

@@file frontend/src/app/features/users/users-page.ts

@@file frontend/src/app/features/users/user-dialogs.ts

@@file frontend/src/app/features/account/account-page.ts

### 4.1 إعدادات الشركة وشاشات الربط

@@file frontend/src/app/features/settings/settings-tabs.ts

@@file frontend/src/app/features/settings/settings-page.ts

`PosIntegrationPage`: المفتاح (يُعرض مرة للنسخ، ثم آخر أربعة حروف فقط)، وما يستدعيه الـ POS، وسجل المزامنة بفلاتر (الكل، تقارير Z، المشاكل)، وتحديث كل 20 ثانية.

@@file frontend/src/app/core/settings/pos-integration.ts

@@file frontend/src/app/features/settings/pos-integration-page.ts

`HrIntegrationPage`: التفعيل، عنوان HR ومفتاحه (حقل كلمة مرور **يُفرَّغ بعد الحفظ**، والـ placeholder يعرض "محفوظ: ••••XXXX")، اختبار الاتصال، مفتاح هذا النظام لـ HR (مرة واحدة)، مزامنة الموظفين، ما ينتظر الإرسال مع "أعد المحاولة"، وسجل المزامنة في الاتجاهين. المؤقت يُلغى في `ngOnDestroy`، والتحديث الدوري لا يمس ما يُكتب في النموذج.

@@file frontend/src/app/core/settings/hr-integration.ts

@@file frontend/src/app/features/settings/hr-integration-page.ts

---

## 5. الاختبارات

### 5.1 الهرم

| المشروع | ماذا يختبر | يحتاج قاعدة بيانات؟ |
| --- | --- | --- |
| `Costing.Domain.Tests` | المعادلات والقواعد (المتوسط، الخصم، الضريبة، تكلفة المصنعات، التفجير…) | لا |
| `Costing.Application.Tests` | حالات الاستخدام مع MediatR الحقيقي و Fakes في الذاكرة | لا |
| `Costing.Infrastructure.Tests` | EF الحقيقي، التقارير، الإكسيل، الربط | نعم: `COSTING_TEST_DB` |
| `Costing.Api.Tests` | HTTP كامل عبر `WebApplicationFactory<Program>` | نعم |
| Frontend (Vitest) | كل شاشة وخدمة مع API مزيف | لا |

```bash
export COSTING_TEST_DB="Host=localhost;Port=5436;Username=costing;Password=costing-dev"
dotnet test --solution Costing.slnx                       # 0 failed, 0 skipped
dotnet test --project backend/tests/Costing.Domain.Tests -- --filter-class "*RecipeCostsTests"
cd frontend && npx ng test --watch=false
```

⚠️ **بدون `COSTING_TEST_DB` تُتخطى اختبارات قاعدة البيانات وتبدو ناجحة.** اقرأ سطر `skipped:` دائمًا.

### 5.2 مشاريع الاختبار

@@file backend/tests/Costing.Domain.Tests/Costing.Domain.Tests.csproj

@@file backend/tests/Costing.Application.Tests/Costing.Application.Tests.csproj

@@file backend/tests/Costing.Infrastructure.Tests/Costing.Infrastructure.Tests.csproj

@@file backend/tests/Costing.Api.Tests/Costing.Api.Tests.csproj

### 5.3 اختبارات المحاسبة في الدومين

تكلفة المصنعات بوصفاتها (المتداخلة، الدوران، الأسعار الناقصة)، والتفجير، وفاتورة الشراء (الخصم بالقرش)، والخزنة (فصل الضريبة):

@@file backend/tests/Costing.Domain.Tests/RecipeCostsTests.cs

@@file backend/tests/Costing.Domain.Tests/MaterialExplosionTests.cs

@@file backend/tests/Costing.Domain.Tests/PurchaseInvoiceTests.cs

@@file backend/tests/Costing.Domain.Tests/TreasuryTests.cs

### 5.4 حالات الاستخدام: الجرد الافتتاحي ومدفوعات تقفيل اليوم

@@file backend/tests/Costing.Application.Tests/OpeningStockTests.cs

@@file backend/tests/Costing.Application.Tests/EndOfDayPayoutTests.cs

### 5.5 البنية التحتية: قاعدة بيانات حقيقية والتحليلات

`TestSystem`: قاعدة باسم عشوائي لكل اختبار، الـ migrations، ثم الحذف.

@@file backend/tests/Costing.Infrastructure.Tests/TestSystem.cs

@@file backend/tests/Costing.Infrastructure.Tests/IntelligenceTests.cs

### 5.6 الـ API عبر HTTP: ربط الـ POS

@@file backend/tests/Costing.Api.Tests/TestApi.cs

@@file backend/tests/Costing.Api.Tests/PosIntegrationApiTests.cs

### 5.7 الفرونت إند

`fixtures.ts`: ما يعيده `/api/auth/me` لكل دور (جدول الصلاحيات والأقسام نفسه)، وشركة اختبار.

@@file frontend/src/testing/fixtures.ts

البحث الذكي العربي، والـ Guards:

@@file frontend/src/app/features/shared/smart-search.spec.ts

@@file frontend/src/app/core/auth/guards.spec.ts

## 6. Docker و Railway

### 6.1 الـ `Dockerfile` متعدد المراحل

1. **`app`** (`node:22-bookworm-slim`): `package.json` و `package-lock.json` أولًا ثم `npm ci` (طبقة الحزم تُعاد استخدامها إن لم تتغير)، ثم `node scripts/build.mjs --configuration production`.
2. **`api`** (`dotnet/sdk:10.0`): ملفات الـ `.csproj` وحدها ثم `dotnet restore` (نفس الفكرة)، ثم `dotnet publish -c Release`، ثم نسخ ملفات Angular إلى `wwwroot`.
3. **`runtime`** (`dotnet/aspnet:10.0`): المخرجات فقط، `ASPNETCORE_ENVIRONMENT=Production`، `ASPNETCORE_FORWARDEDHEADERS_ENABLED=true` (عنوان العميل الحقيقي خلف الـ proxy، لحد المحاولات)، `PORT=8080`، `USER $APP_UID` (لا root)، ولا أسرار في الصورة أبدًا.

@@file Dockerfile

### 6.2 `railway.json`

البناء بالـ Dockerfile، **فحص الصحة `/health/ready`** (لا تُحوَّل الحركة للنسخة الجديدة قبل أن تطبق الـ migrations وتصل لقاعدة البيانات؛ نشر فاشل = القديمة تبقى)، وإعادة التشغيل عند الفشل.

@@file railway.json

### 6.3 متغيرات الإنتاج

| المتغير | المعنى |
| --- | --- |
| `DATABASE_URL` | من خدمة PostgreSQL على Railway |
| `Auth__SigningKey` | 32 بايت على الأقل (`openssl rand -base64 48`). **تغييره** يُخرج الجميع ويجعل مفتاح HR المشفّر غير مقروء |
| `Auth__FirstManager__Email` / `__Name` / `__Password` | أول مدير عند أول تشغيل؛ غيّر كلمة المرور بعده |
| `Company__*` | القيم الأولى لإعدادات الشركة فقط |
| `Database__MigrateOnStartup` | `false` إن طُبقت الـ migrations خارجيًا |
| `PORT` | تضبطه Railway |

## 7. سكربت التوليد والتحقق

هذا الماستر كلاس نفسه يُبنى بسكربت، ويُتحقق منه آليًا:

- **القوالب** في `scripts/masterclass/chapters/*.md`: الشرح العربي + توجيهات `@@file <path>` و `@@tree` و `@@migrations`.
- **البناء:** `python3 scripts/masterclass/build.py` يكتب `docs/masterclass/*.md`.
- **التحقق** (يفشل البناء بأي منها):
  1. **التغطية:** كل ملف إنتاجي متتبَّع في Git (عدا الـ migrations والاختبارات و `docs/` وهذا المجلد) مضمّن **مرة واحدة بالضبط**.
  2. **Markdown:** كل كتلة كود مغلقة (السور يُختار أطول من أطول سلسلة backticks في الملف)، لا توجيه متروك، وكل رابط لفصل موجود.
  3. **الأسرار:** لا شيء يشبه JWT أو مفتاحًا خاصًا أو مفتاح AWS/GitHub أو مفتاح ربط حقيقيًا (`cpk_`/`chr_`/`hrk_` بطول حقيقي).
- **`--check`:** يبني في مجلد مؤقت ويقارن بـ `docs/masterclass`؛ إن تغيّر الكود ولم يُعَد البناء يفشل ("stale"). مناسب للتشغيل قبل كل commit أو في CI.

> حين تضيف ملف كود جديدًا، سيفشل البناء بـ `not embedded: <path>` حتى تضيف له `@@file` وشرحًا في الفصل المناسب. هكذا لا يتأخر التوثيق عن الكود أبدًا.

@@file scripts/masterclass/build.py

---

## خاتمة

رأيت نظامًا ماليًا كاملًا من الداخل: دفتر مخزون لا يُعدَّل ومتوسط مرجح متحرك، تكلفة مصنعات متداخلة قبل أول دفعة، توزيع خصم بالقرش، فصل الضريبة كالتزام، تقفيل يوم بأدلة مصورة، خزنة موحدة بقيود عكسية، تحليلات تجيب أسئلة صاحب المطعم الحقيقية، وربط موثوق بنظامين آخرين. خطتك المقترحة:

1. ابنِ نسخة مصغرة باتباع [خارطة البناء](00-index-and-build-roadmap.md): خامات + فاتورة + وصفة + ملخص مبيعات + تقرير نظري.
2. احسب كل معادلة في هذا الماستر كلاس بورقة وقلم مرة واحدة، ثم اكتبها كاختبار Domain.
3. أكمل فجوة `costing.view` (الفصل 03) كتمرين كامل: سياسة، فلتر استجابة، إخفاء في الواجهة، واختبار API.
4. اقرأ ملفًا صعبًا كل يوم (`RawMaterial.cs`، `RecipeCosts.cs`، `IntelligenceService.cs`، `PosIntegration.cs`) واشرحه بصوت عالٍ.

بالتوفيق.
