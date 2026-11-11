# الفصل 03: الهوية، الصلاحيات، والموافقات

[← الفصل السابق](02-database-schema-and-entities.md) · [الفهرس](00-index-and-build-roadmap.md) · [الفصل التالي: الخامات والوصفات والمنيو →](04-catalog-materials-recipes-and-menu.md)

## 1. ثلاث طبقات للأمان في هذا النظام

```text
1. الهوية (Authentication)   من أنت؟           بريد + كلمة مرور ⇐ JWT
2. الصلاحية (Authorization)  ماذا يُسمح لدورك؟  Permissions (inventory.view, approval.decide, ...)
                              وأي أقسام تعمل فيها؟ CostingTabs ([CostingTab(...)])
3. الرقابة (Maker-Checker)   هل يُنفَّذ الآن؟    من لا يملك القرار ⇐ طلب موافقة (ApprovalRequest)
```

## 2. الأدوار الأربعة

| الدور | يعمل في (افتراضيًا) | الصلاحيات |
| --- | --- | --- |
| **المدير (Manager)** | كل الأقسام دائمًا | كل شيء: القرار في الموافقات، المستخدمون، الإعدادات، توزيع الأقسام |
| **المحاسب (Accountant)** | الخامات، المصروفات، المشتريات، الماليات، المبيعات، التقارير، التحليلات، تقفيل اليوم | عرض وإدخال وعرض التكاليف |
| **مراقب التكاليف (Cost Controller)** | الخامات، الوصفات، الإنتاج، المنيو، المبيعات، الجرد، الهالك، التقارير، إعدادات التكلفة، التحليلات | عرض وإدخال وعرض التكاليف |
| **أمين المخزن (Storekeeper)** | الخامات، المشتريات، الجرد، الهالك، الإنتاج، تقفيل اليوم | عرض وإدخال فقط (**بدون** `costing.view`) |

**مبدأ "يُغلق افتراضيًا" (Fail Closed):** دور غير موجود في جدول `RolePermissions` لا يحصل على أي شيء.

@@file backend/src/Costing.Domain/Access/Permissions.cs

### 2.1 الأقسام الديناميكية: `CostingTabs`

- `[Flags] enum CostingTabs`: 14 قسمًا، بت لكل قسم (`Materials = 1`, `ExpenseItems = 2`, `Purchases = 4`, … `EndOfDay = 8192`). حقل واحد يحمل أي مجموعة أقسام، ويُخزن **بالاسم** (`"Materials, Purchases"`).
- `CostingTabSet.DefaultFor(role)`: أقسام كل دور افتراضيًا (الجدول أعلاه).
- `UserTabAccess`: إذا "علّم" المدير أقسام مستخدم معين، تصبح **هي فقط** أقسامه. بدونها: أقسام دوره.

والمدير يحصل دائمًا على `CostingTabs.All` (كل الأقسام الأربعة عشر) في `TabCaller` بغض النظر عن أي تخصيص. و `CostingTabSet.Each` ترتيب عرض الأقسام في الواجهة.

@@file backend/src/Costing.Domain/Access/CostingTabs.cs

### 2.2 إخفاء التكاليف عن أمين المخزن: الحقيقة كما هي في الكود

التصميم المقصود: صلاحية `costing.view` تفصل "رؤية التكاليف" عن "إدخال الكميات"، وأمين المخزن **لا يملكها** في `RolePermissions`. وتعليق `RawMaterialDto` يقول إن قائمة الخامات العامة بلا تكاليف.

**لكن بأمانة:** `Permissions.CostingView` **معرّفة ولا يفرضها أي endpoint حاليًا** (لا يوجد `[Authorize(Policy = Permissions.CostingView)]` في أي Controller، ولا تستخدمها الواجهة لإخفاء شيء). الحماية الفعلية اليوم هي **الأقسام**: أمين المخزن لا يملك افتراضيًا أقسام الوصفات والتقارير والتحليلات والماليات وإعدادات التكلفة، فلا يصل لشاشاتها ولا لنقاط نهايتها. لكن ما في قسم الخامات والمشتريات (مثل متوسط تكلفة الخامة وأسعار الفاتورة) يبقى مرئيًا له.

**كيف تُكمل الفجوة (تمرين مهم):** ضع `[Authorize(Policy = Permissions.CostingView)]` على نقاط التكلفة في `CostingController`، واجعل DTOs الخامات تُرسل التكلفة `null` لمن لا يملكها (فلتر استجابة كما يفعل نظام HR في `HrPrivacyFilter`)، وأخفِ أعمدة التكلفة في الواجهة بـ `*appCan="Permissions.CostingView"`، ثم اكتب اختبار API يتأكد أن أمين المخزن يتلقى `null`.

## 3. المصادقة: JWT

### 3.1 الخيارات والـ Claims والتوكن

`AuthOptions`: `SigningKey` (32 بايت على الأقل؛ "من يملكه يستطيع الدخول باسم أي أحد")، عمر التوكن، وأول مدير. `UserClaims`: أسماء قصيرة (`sub`, `name`, `role`, `pwd_set`). `TokenService`: HMAC-SHA256، Issuer/Audience = `costing`، ووقت ضبط كلمة المرور داخل التوكن.

@@file backend/src/Costing.Api/Auth/AuthOptions.cs

@@file backend/src/Costing.Api/Auth/UserClaims.cs

@@file backend/src/Costing.Api/Auth/TokenService.cs

### 3.2 `AuthenticationSetup`: سطرًا سطرًا

1. **مفتاح أقل من 32 بايت ⇐ التطبيق لا يبدأ.** الفشل المبكر أفضل من توكنات قابلة للتزوير.
2. `AddJwtBearer` مع `MapInboundClaims = false` و `TokenValidationParameters` (الجهة، الجمهور، المفتاح، سماحية دقيقة).
3. **`OnTokenValidated`**: بعد التحقق من التوقيع، اسأل `UserDirectory`: هل المستخدم ما زال نشطًا؟ بنفس الدور؟ بنفس وقت كلمة المرور (بدقة الميكروثانية: `Ticks / 10`)؟ وإلا 401. هكذا **تعطيل مستخدم أو تغيير دوره أو كلمة مروره يسري فورًا**، لا بعد انتهاء التوكن.
4. **السياسة الافتراضية والاحتياطية = "مستخدم مسجّل"**: أي endpoint نُسي عليه `[Authorize]` مغلق تلقائيًا (Secure by Default).
5. سياسة لكل صلاحية، تُمنح بجدول `RolePermissions` نفسه الذي تقرؤه الواجهة من `/api/auth/me`.

@@file backend/src/Costing.Api/Auth/AuthenticationSetup.cs

### 3.3 السمة `[CostingTab(...)]`

```csharp
[HttpGet("materials")]
[CostingTab(CostingTabs.Materials | CostingTabs.Recipes)]   // يملك أيًّا منهما
```

- `CostingTabAttribute` تولّد اسم سياسة من رقم الأقسام (`Materials | Recipes` = 1 + 64 ⇐ `"costing-tab:65"`) بدل تسجيل سياسة لكل تركيبة.
- `CostingTabPolicyProvider` يصنع السياسة من اسمها عند الطلب.
- `TabCaller` يقرأ أقسام المتصل **مرة لكل طلب**: المدير الكل، وغيره `UserTabAccess` أو `DefaultFor(role)`.
- `CostingTabHandler`: ينجح إن تقاطعت أقسام المتصل مع أقسام الـ endpoint.

لماذا "أيّ منها" (OR)؟ لأن بيانات مثل قائمة الموردين تحتاجها أقسام عدة (المشتريات، تقفيل اليوم، الماليات)، فالـ endpoint يقول "من يعمل في أيٍّ منها".

@@file backend/src/Costing.Api/Auth/TabAccess.cs

### 3.4 المستخدمون وكلمات المرور

`UserDirectory`: PBKDF2 (عبر `PasswordHasher` من ASP.NET Identity) بـ Salt عشوائي، 5 أخطاء ⇐ قفل 5 دقائق، **تحقق وهمي لبريد غير موجود** حتى لا يكشف زمن الرد وجود البريد (Timing Attack)، إعادة تشفير صامتة عند `SuccessRehashNeeded`، أول مدير من الإعدادات، و **يبقى دائمًا مدير نشط واحد** على الأقل.

@@file backend/src/Costing.Infrastructure/Identity/Users.cs

`AuthController`: `POST sign-in` (مع حد المحاولات)، `GET me` (المصدر الوحيد للدور والصلاحيات والأقسام في الواجهة)، `POST password` (تغيير كلمة المرور يسقط كل التوكنات القديمة ويعيد توكنًا جديدًا لهذه الجلسة).

@@file backend/src/Costing.Api/Controllers/AuthController.cs

`UsersController`: إضافة، تعديل الدور والحالة، وإعادة تعيين كلمة المرور؛ للمدير فقط.

@@file backend/src/Costing.Api/Controllers/UsersController.cs

### 3.5 توزيع الأقسام: `UserTabs.cs`

`GetUserTabsQuery` (كل مستخدم: أقسامه الفعلية وهل هي "مخصصة")، و `SetUserTabsCommand` (المدير يعلّم أقسامًا أو يعيد المستخدم لأقسام دوره). نقطة النهاية `api/access` في `MenuSalesController.cs` (الفصل 04).

@@file backend/src/Costing.Application/Access/UserTabs.cs

## 4. محرك الموافقات (Maker-Checker)

### 4.1 الفكرة المحاسبية

في أي نظام مالي محترم، **من يُدخل لا يعتمد**. المحاسب يُدخل فاتورة أو يطلب حذف قيد؛ المدير يرى "ماذا سيتغير" ثم يوافق أو يرفض. وطوال الانتظار:

- السجل **كما هو** (لا شيء يتغير قبل الموافقة)، ويُحسب في الأرقام،
- و **مقفول**: لا تعديل آخر عليه حتى يُحسم الطلب (فهرس فريد: طلب معلّق واحد لكل سجل).

### 4.2 `ApprovalRequest`

الوحدة (`ApprovalModule`: وصفات، مشتريات، هالك، جرد، خامات، إنتاج، الخزنة، الكسر، …)، الفعل (إنشاء/تعديل/حذف)، الملخص، **سطور التغيير** (`ApprovalChange`: "الكمية: 10 كجم ← 12 كجم")، الحمولة (`Payload` JSON بما أُدخل)، والقرار ومن اتخذه ومتى. ومعرّفه يصنعه التطبيق (Idempotent).

@@file backend/src/Costing.Domain/Approvals/ApprovalRequest.cs

### 4.3 `ApprovalRequests.cs`

- `ApprovalLocks.EnsureNotPendingAsync`: يمنع تعديل سجل عليه طلب معلق، برسالة "فلان طلب تعديل هذا؛ يُعدل بعد قرار المدير".
- `ApproveRequestCommand`: يطبّق المطلوب ويغلق الطلب **في حفظ واحد**؛ الموافقة مرتين لا تغيّر شيئًا. إن لم يعد التطبيق ممكنًا يبقى الطلب معلقًا.
- `RejectRequestCommand`: يرفض بملاحظة، والسجل يبقى كما هو ويُفتح قفله.
- `IRecordDescriptions`: كل وحدة تصف سجلاتها للمدير.

@@file backend/src/Costing.Application/Approvals/ApprovalRequests.cs

### 4.4 الحذف كموافقة: `Deletions.cs`

**في الدفاتر لا يُحذف شيء مُرحّل؛ يُلغى (Void).** حذف فاتورة مرحّلة = حركات مخزون عكسية بنفس تكلفتها + عكس قيد الخزنة أو حساب المورد. حذف قيد خزنة = قيد عكسي بتاريخ اليوم. `DeletionTargets` يعرف لكل وحدة كيف "يلغي" سجلها، و `RequestDeletionCommand`: من يملك القرار يلغي فورًا (ويُسجل كموافَق منه)، وغيره يطلب. نقطة النهاية `POST api/inventory/deletion-requests` في `InventoryController` (الفصل 05).

@@file backend/src/Costing.Application/Approvals/Deletions.cs

## 5. الجانب الآخر: المصادقة والأقسام في الواجهة

`Me`, `SignInResponse`: تطابق DTOs الـ API حرفيًا.

@@file frontend/src/app/core/api/models.ts

`AuthService`: التوكن في `localStorage` كـ "مرشح" فقط حتى يؤكده `GET /api/auth/me`؛ الدور والصلاحيات من الخادم لا من التوكن. و `can(permission)` يقرر إظهار الأزرار.

@@file frontend/src/app/core/auth/auth.service.ts

@@file frontend/src/app/core/auth/permissions.ts

@@file frontend/src/app/core/auth/guards.ts

`*appCan`: يُظهر العنصر لمن يملك الصلاحية فقط.

@@file frontend/src/app/core/auth/can.directive.ts

`costing-tabs.ts`: الأقسام بمجموعاتها (الكتالوج والإنتاج، التشغيل والمخزون، الماليات والإدارة) وأيقوناتها، و `CostingAccess` (هل يملك القسم؟ أول قسم له)، و `costingTabGuard(tab)`.

> **Guards الواجهة ليست أمانًا.** هي تجربة مستخدم (إخفاء ما لا يملكه). الأمان الحقيقي في الـ API: `[CostingTab]` و `[Authorize]`.

@@file frontend/src/app/core/costing/costing-tabs.ts

### 5.1 شاشة الدخول

بريد وكلمة مرور، `busy` يمنع الضغط المزدوج، رسالة الخادم تُعرض كما هي ("مقفل 5 دقائق")، و `?reason=expired` يعرض "انتهت الجلسة". `ViewEncapsulation.None` لتنسيق حقول Material، وكل القواعد تحت `.sign-in`.

@@file frontend/src/app/features/sign-in/sign-in-page.ts

@@file frontend/src/app/features/sign-in/sign-in-page.html

@@file frontend/src/app/features/sign-in/sign-in-page.scss

[الفصل التالي: الخامات والوصفات والمصنعات والمنيو →](04-catalog-materials-recipes-and-menu.md)
