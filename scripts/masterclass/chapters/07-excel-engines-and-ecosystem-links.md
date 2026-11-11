# الفصل 07: محركات الإكسيل والربط مع الأنظمة الأخرى

[← الفصل السابق](06-financials-safe-tax-and-intelligence.md) · [الفهرس](00-index-and-build-roadmap.md) · [الفصل التالي: نواة الفرونت إند وشاشات التشغيل →](08-frontend-core-and-operations-screens.md)

## 1. محركات الإكسيل

### 1.1 المبادئ

المطاعم تعيش على الإكسيل. النظام يحترم ذلك بقواعد صارمة:

1. **القالب = التصدير:** ما تصدّره بنفس أعمدة القالب، فتعدّله وتستورده كما هو (أو تنقله لتثبيت آخر).
2. **الأعمدة تُعرف بعنوانها لا بموقعها**، بالإنجليزية أو العربية، مع تجاهل الحروف الكبيرة والمسافات. نقل عمود أو إضافة عمود لا يكسر شيئًا.
3. **الاستيراد "Upsert":** يطابق بالكود ثم بالاسم؛ الخلية الفارغة تُترك كما هي (لا تمسح قيمة موجودة)؛ والتكلفة تُستبدل فقط إن اختلفت عند 4 خانات عشرية.
4. **لا شيء يُتخطى بصمت:** كل صف مرفوض يعود برقمه في الشيت وسببه بالعربية والإنجليزية.
5. **الأرقام العربية والتواريخ والوحدات** تُفهم كما يكتبها الإنسان (`SheetText`).

### 1.2 `SheetBook`: محرك مشترك

- `Column`: مفتاح في الكود، العنوان، **كل العناوين البديلة** التي قد يُوجد بها (عربي/إنجليزي)، ملاحظة العنوان، وكيف تُكتب أرقامه.
- `SheetList`: **قائمة منسدلة** على عمود: مصدرها نطاق في شيت مرجعي، و `Strict` ⇐ `XLErrorStyle.Stop` (لا يُقبل إلا من القائمة)، أو `Information`/`Warning` إن سُمح بغيرها.
- `ReferenceSheet(Hidden = true)`: شيت مرجعي **مخفي** (`XLWorksheetVisibility.Hidden`) يحمل قيم القوائم.
- القراءة: إيجاد الأعمدة بالعناوين، وقراءة الصفوف كخلايا نصية كما يراها الإنسان.

@@file backend/src/Costing.Infrastructure/Excel/SheetBook.cs

@@file backend/src/Costing.Application/Common/SheetText.cs

### 1.3 الخامات والمصروفات

`RawMaterialSheet` + `RawMaterialWorkbook`: كل خامة بفئتها ووحدتها ووحدة شرائها وحجمها وتكلفة وحدة الشراء والـ Yield وحد الطلب. والمصروفات بنفس الأسلوب.

@@file backend/src/Costing.Application/RawMaterials/RawMaterialSheet.cs

@@file backend/src/Costing.Infrastructure/Excel/RawMaterialWorkbook.cs

@@file backend/src/Costing.Application/Expenses/ExpenseItemSheet.cs

@@file backend/src/Costing.Infrastructure/Excel/ExpenseItemWorkbook.cs

### 1.4 شيت الوصفات الذكي: القوائم المنسدلة المخفية

**المشكلة:** المستخدم يكتب "دقيق" والنظام فيه "Flour"، أو يكتب الكمية بالكيلو والنظام بالجرام. الحل:

- **صف لكل مكوّن**، واسم الوصفة على أول صفوفها (الاسم الفارغ = الصف الذي فوقه).
- **عمود المكوّن قائمة منسدلة صارمة** مصدرها شيت مخفي `Ingredients` فيه **تسمية** كل خامة ومصنّع **مع وحدة كتابة الكمية**: `"Flour (Kg)"`، `"Pizza dough · مصنّع (Kg)"`. فالمستخدم لا يخطئ في الاسم ولا الوحدة.
- **الكمية تُكتب بالكيلو/اللتر/القطعة** وتُحوّل للوحدة الأساسية (`SheetNumbers`, `IngredientLookup`).
- **عمود الوصفة** يقبل أكواد المنيو (`"6101-2 · Margherita (Large)"`, `"A3 · …"`) أو اسم وصفة خارج المنيو.
- **كل وصفة تُستبدل كاملة أو لا شيء**، ويُحتفظ بالـ Yield.
- النتيجة **مسعّرة** فورًا (`CostedSheetItem`) بأسعار اليوم.
- المصنعات: استيراد المدير يحفظها؛ استيراد غيره يصبح طلبات موافقة. والمصنعات الجديدة في نفس الشيت **مرتبة حسب الاعتماد** (مصنّع يدخل في آخر يُنشأ قبله).

@@file backend/src/Costing.Application/Recipes/IngredientSheet.cs

@@file backend/src/Costing.Application/Recipes/RecipeSheet.cs

@@file backend/src/Costing.Application/Production/PrepRecipeSheet.cs

@@file backend/src/Costing.Infrastructure/Excel/RecipeWorkbooks.cs

### 1.5 شيت المصنعات القديم (مصنعات)

صيغة المطابخ والأنظمة القديمة: اسم المصنّع في صف وحده، صف عناوين (الصنف | الوحدة | الكمية)، ثم مكوناته. كل واحد مصنّع بالجرام ومسعّر بوصفته، والخامات الناقصة تُضاف.

@@file backend/src/Costing.Application/Production/PrepItemImport.cs

@@file backend/src/Costing.Infrastructure/Excel/PrepItemWorkbook.cs

### 1.6 المنيو والمبيعات اليومية وشيتات التقارير

`MenuWorkbook` و `DailySalesWorkbook` (عمودان: الكود والكمية). و `ReportWorkbook`: محرك تقارير عام (أعمدة بعناوين عربية وإنجليزية وتنسيق أرقام، صفوف بأنواع: بيانات/إجمالي/عنوان مجموعة) تستخدمه شيتات التحليلات وورقة الطلب.

@@file backend/src/Costing.Infrastructure/Excel/MenuSalesWorkbooks.cs

@@file backend/src/Costing.Infrastructure/Excel/ReportWorkbook.cs

### 1.7 واجهة الاستيراد

`SheetImportDialog`: نافذة واحدة لكل الاستيرادات (اسم ما في الشيت، قواعده، تنزيل القالب، الرفع، والنتيجة: المضاف، المحدّث، المتخطى بأسبابه). و `PrepImportDialog` لنتيجة المصنعات، و `recipeSheetRules` القواعد المشتركة.

@@file frontend/src/app/features/costing/sheet-import-dialog.ts

@@file frontend/src/app/features/costing/prep-import-dialog.ts

@@file frontend/src/app/features/costing/recipe-sheet-rules.ts

---

## 2. ربط نقطة البيع (POS Link)

### 2.1 الفكرة

نقطة البيع (نظام منفصل) **تقرأ المنيو** من هنا، و **ترسل تقرير Z** لكل وردية. لا تلمس قاعدة البيانات أبدًا: HTTP فقط، بمفتاح.

| النداء | ماذا يفعل |
| --- | --- |
| `GET /api/integrations/pos/ping` | اختبار الربط |
| `GET /api/integrations/pos/menu` | المنيو: الفئات، الأصناف بأرقامها وأسعارها، الأحجام بأكوادها (`6101-17`)، الإضافات (`A3`) |
| `POST /api/integrations/pos/z-report` | تقرير وردية |
| `POST /api/integrations/pos/events` | ظرف أحداث الـ POS: `day.closed` يُقرأ كتقرير Z، وغيره يُرد بـ 202 ويُترك |

### 2.2 المفتاح

`cpk_` + 32 بايت عشوائية، يُعرض **مرة واحدة**، ويُخزن **SHA-256 فقط** مع آخر أربعة حروف للتمييز، ويُقارن بزمن ثابت. "مفتاح جديد" يُبطل القديم فورًا. يُرسل في `X-API-Key` (أو `X-Pos-Node-Key`)؛ خطأ ⇐ 401 ويُسجّل.

### 2.3 ماذا يصنع تقرير Z (شرح محاسبي)

```text
تقرير Z (وردية) ──► PosDay (يجمع كل ورديات اليوم)
                      ├─► ملخص مبيعات اليوم (DailySummary): كل صنف مُباع يخصم مخزونه بالوصفة
                      │      والأصناف الملغاة بعد المطبخ (wastedItems) ⇐ تخصم مخزونها كهالك (Waste)، بلا تحصيل
                      └─► توريد اليوم في الخزنة (RevenueTransfer): الكاش والفيزا قبل الضريبة + الضريبة،
                             والإلغاءات وأسبابها في الملاحظات
```

قواعد الـ Idempotency والتعديل:

1. **`zReportId`** معرّف الوردية في الـ POS، ثابت في كل إرسال.
2. **نفس المحتوى مرة أخرى** (نفس `PayloadHash`) ⇐ `Unchanged`، لا شيء يتغير.
3. **تقرير معدّل** (صُحّحت الوردية) ⇐ ما صنعه يُلغى (المخزون يعود، التوريد يُعكس) ويُعاد صنع اليوم كاملًا ⇐ `Updated`.
4. **ورديتان في يوم واحد** ⇐ ملخص واحد وتوريد واحد من كل تقارير اليوم؛ الوردية الثانية تعيد صنع اليوم بالاثنتين.
5. **الكل أو لا شيء:** الملخص والتوريد في حفظ واحد. سطر لا يُطابق المنيو (كود غير موجود، صنف بالأحجام بلا حجم) يرفض التقرير كله 422 مع تسمية كل سطر.
6. **يوم أُدخل يدويًا يُترك:** إن كان ملخص اليوم أو توريده مُدخلًا يدويًا (أو بالشيت)، يُرفض التقرير 422 مع تسمية ما يمنعه. ألغِ اليدوي لتسمح بالتقرير.
7. تصادم مع تعديل آخر في نفس اللحظة ⇐ يُعاد تلقائيًا؛ إن استمر ⇐ 503 فيعيد الـ POS الإرسال لاحقًا.

@@file backend/src/Costing.Domain/Integrations/PosIntegration.cs

@@file backend/src/Costing.Application/Integrations/PosIntegration.cs

@@file backend/src/Costing.Infrastructure/Persistence/PosIntegrationPersistence.cs

`PosIntegrationController`: `PosKeyFilter` (Action Filter يتحقق من المفتاح ويسجل الرفض بلا المفتاح نفسه)، ونماذج الطلب، و `PosIntegrationSettingsController` لصفحة الإعدادات.

@@file backend/src/Costing.Api/Controllers/PosIntegrationController.cs

---

## 3. الربط ثنائي الاتجاه مع الموارد البشرية (HR Link)

### 3.1 الاتجاهان

| الاتجاه | النداء | متى |
| --- | --- | --- |
| HR ⇐ هنا | `GET {hr}/api/integrations/hr/employees` | قراءة الموظفين: عند التفعيل، كل 6 ساعات، أو "مزامنة الآن" |
| HR ⇐ هنا | `GET {hr}/api/integrations/costing/ping` | اختبار الاتصال |
| هنا ⇐ HR | `POST /api/integrations/hr/payroll-run` | HR اعتمد مسير شهر |
| هنا ⇐ HR | `GET /api/integrations/hr/ping` | اختبار من HR |
| HR ⇐ هنا (Outbox) | `POST {hr}/api/integrations/costing/employee-advance` | سلفة صُرفت من الخزنة (مع الإيصال) أو أُلغيت |
| HR ⇐ هنا (Outbox) | `POST {hr}/api/integrations/costing/employee-deduction` | عجز خزنة أو خصم، أو إلغاؤه |
| HR ⇐ هنا (Outbox) | `POST {hr}/api/integrations/costing/payroll-settled` | صُرف المسير من الخزنة، أو أُلغي الصرف |

**مغلق افتراضيًا:** بدون تفعيل، الموظفون يُدارون هنا، ولا شيء يُرسل أو يُستقبل.

### 3.2 مفتاحان، ومعاملتان مختلفتان

1. **مفتاحنا لـ HR (`chr_…`)**: نصنعه ونعرضه مرة، ونخزن **SHA-256 فقط**، ونقارن بزمن ثابت. (المفتاح 256 بت عشوائي، فالـ Hash السريع آمن؛ البطء ضروري لكلمات المرور الضعيفة فقط.)
2. **مفتاح HR لنا**: نحتاجه **كما هو** لنرسله في `X-API-Key`، فنخزنه **مشفّرًا بـ AES-GCM**:

```text
المفتاح = HKDF-SHA256(Auth:SigningKey, 32 بايت, info = "Costing.HrLink.Key")
التشفير: nonce عشوائي 12 بايت، tag 16 بايت
المخزّن = "v1." + Base64(nonce ‖ tag ‖ ciphertext)
```

- **GCM** يعطي سرية **وسلامة**: أي تعديل في النص المشفر يفشل عند فك التشفير (الـ tag).
- **HKDF** يشتق مفتاح تشفير مخصصًا لهذا الاستخدام من السر الموجود، بدل إعادة استخدام مفتاح توقيع JWT كما هو.
- **`v1.`** نسخة الصيغة، لتغيير الخوارزمية مستقبلًا مع قراءة القديم.
- تغيير `Auth:SigningKey` يجعل المفتاح غير مقروء ⇐ يُلصق من جديد (رسالة واضحة).

### 3.3 مزامنة الموظفين

`SyncHrEmployeesCommand`: كل موظف من HR يصبح `SyncedEmployee` مرتبطًا بـ `StaffMember` هنا (موظف محلي بنفس الاسم من قبل الربط **يُربط** بدل تكرار)، بكوده وقسمه، ويُحدّث عند التغير (والعدّاد "تغيّر" يحسب ما تغيّر فعلًا فقط)، ومن اختفى من قائمة HR يُعلَّم "ترك العمل". أثناء الربط: لا تعديل للموظفين هنا ولا إضافة محلية.

### 3.4 مسير الرواتب من HR

```json
{ "idempotencyKey": "…", "payrollPeriod": "2026-10", "employees": 3,
  "totalGrossWages": 18000, "totalAdditions": 0, "totalPenalties": 15680,
  "totalAdvancesDeducted": 0, "totalBroughtForward": 0, "netCashPayable": 2320,
  "departments": [{ "department": "Hall", "employees": 2, "...": "..." }] }
```

- **تكلفة العمالة** = الإجمالي + الإضافات − الجزاءات ⇐ أجور الشهر في الـ KPIs وقائمة الدخل **بدلًا** من الرواتب المصروفة (لا الاثنان).
- **صافي النقدية المستحق** يُصرف من الخزنة **مرة واحدة** بقيد `PayrollPayment` (المدير فورًا، غيره طلب).
- **لا خصم مزدوج للسلف:** السلف خرجت من الخزنة وقت صرفها، و HR خصمها من صافي الرواتب؛ فالمسير يُصرف بالصافي فقط، والسلف ليست مصروفًا أصلًا.
- نفس المسير مرة أخرى (نفس الـ hash) ⇐ `Unchanged`؛ معدّل قبل الصرف ⇐ يُستبدل (`Updated`، والمراجعة تزيد)؛ بعد الصرف ⇐ مرفوض.

### 3.5 `HrOutbox`: الطابور الصادر

**لماذا لا نستدعي HR مباشرة عند صرف السلفة؟** لأن HR قد يكون متوقفًا، أو تنقطع الشبكة بعد أن يستلم وقبل الرد. الحل **Transactional Outbox**:

```text
TreasuryWriter.ApplyAsync(سلفة) ──► قيد الخزنة + عنصر في HrOutbox  ← في نفس الحفظ (معًا أو لا شيء)
HrSyncWorker (كل 10 ثوانٍ) ──► HrOutboxSender.SendDueAsync():
    المستحق بالترتيب (25 كل مرة)، كلٌّ بـ Idempotency-Key = معرّف قيد الخزنة
    السلفة من تقفيل اليوم: يُقرأ إيصالها من EndOfDayPhotos ويُرسل Base64 مع الرسالة
    2xx أو 409 ⇐ Sent
    400/401/403/404/422 ⇐ Failed بسبب HR (ينتظر "أعد المحاولة")
    شبكة/5xx ⇐ إعادة بعد 15ث، تتضاعف حتى 10 دقائق، ويتوقف الباقي للحفاظ على الترتيب
```

ومع الـ Idempotency عند HR (يحفظ السلفة بنفس المعرّف)، "مرة على الأقل" تصبح عمليًا "مرة واحدة بالضبط". والإلغاء يُرسل بنفس المفتاح و `action: "void"`. **سجل المزامنة** (`HrSyncLogs`) يُكتب في Scope مستقل حتى يبقى سجل الرفض رغم إلغاء معاملة الطلب.

@@file backend/src/Costing.Domain/Integrations/HrIntegration.cs

@@file backend/src/Costing.Application/Integrations/HrIntegration.cs

### 3.6 البنية التحتية: AES-GCM و HttpClient والعامل الخلفي (سطرًا سطرًا لأهم الأجزاء)

- `HrKeyProtector.Key`: يقرأ `Auth:SigningKey`، يرفض الفارغ، ويشتق 32 بايت بـ `HKDF.DeriveKey(SHA256, …, info)`.
- `Protect`: `RandomNumberGenerator.GetBytes(12)` nonce، `new AesGcm(Key, 16)`، `Encrypt(nonce, plain, cipher, tag)`، ثم `"v1." + Base64([nonce, tag, cipher])`.
- `Unprotect`: يتحقق من البادئة، يقسم البايتات `[..12]`, `[12..28]`, `[28..]`، و `Decrypt` يرمي إن عُبث بها ⇐ يعيد `null` (لا يرمي للأعلى).
- `HrGateway`: `IHttpClientFactory` (مهلة 20 ثانية)، يضيف `X-API-Key` و `Idempotency-Key`، ويصنّف الرد.
- `HrOutboxSender`: كما في المخطط أعلاه، ويضيف `contentBase64` للإيصال من مخزن الصور.
- `HrSyncWorker`: `PeriodicTimer` كل 10 ثوانٍ، Scope جديد لكل دورة، لا يعمل والرابط مغلق، ومزامنة الموظفين كل 6 ساعات مع تأجيل 5 دقائق بعد فشل، ويبتلع الأخطاء بعد تسجيلها (لا يموت العامل الخلفي).

@@file backend/src/Costing.Infrastructure/Integrations/HrIntegrationServices.cs

@@file backend/src/Costing.Infrastructure/Persistence/HrIntegrationPersistence.cs

`HrIntegrationController.cs`: `HrIntegrationController` (ما يستدعيه HR، بـ `HrKeyFilter`)، `HrIntegrationSettingsController` (صفحة الإعدادات)، `PayrollRunsController` (المسيرات وصرفها)، و `StaffHrController` (حالة الربط، الإضافة المحلية، الخصومات).

@@file backend/src/Costing.Api/Controllers/HrIntegrationController.cs

[الفصل التالي: نواة الفرونت إند وشاشات التشغيل →](08-frontend-core-and-operations-screens.md)
