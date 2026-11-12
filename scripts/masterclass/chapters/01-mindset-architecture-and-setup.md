# الفصل 01: العقلية، المعمارية، وتأسيس المشروع

[← الفهرس](00-index-and-build-roadmap.md) · [الفصل التالي: قاعدة البيانات →](02-database-schema-and-entities.md)

## 1. محاسبة تكاليف المطاعم كهندسة (F&B Cost Control)

قبل أي كود، يجب أن تفهم **ماذا يحاول المطعم أن يعرف**. صاحب المطعم يسأل خمسة أسئلة:

1. **كم تكلفني هذه الوجبة؟** (تكلفة الوصفة Recipe Cost)
2. **هل سعرها مناسب؟** (نسبة تكلفة الطعام Food Cost % = التكلفة ÷ سعر البيع قبل الضريبة)
3. **أين ذهب المخزون؟** (الفعلي مقابل النظري Actual vs Theoretical)
4. **أين ذهب المال؟** (الخزنة، المصروفات، الموردون)
5. **هل أربح؟ وكم أحتاج أن أبيع لأغطي تكاليفي؟** (قائمة الدخل P&L، نقطة التعادل Break-even)

### 1.1 المصطلحات التي ستراها في كل مكان

| المصطلح | المعنى | مثال |
| --- | --- | --- |
| **AP (As Purchased)** | الكمية كما اشتُريت | 1 كجم بصل بقشره |
| **EP (Edible Portion)** | الكمية الصالحة للاستخدام بعد التنظيف | 900 جم بعد التقشير |
| **Yield %** | نسبة الصافي: EP ÷ AP | 90% |
| **AP$ / unit** | سعر الوحدة كما اشتُريت (المتوسط المرجح) | 20 ج/كجم |
| **EP$ / unit** | سعر الوحدة الصالحة = AP$ ÷ Yield | 20 ÷ 0.9 = 22.22 ج/كجم |
| **المتوسط المرجح المتحرك** | متوسط تكلفة الوحدة في المخزن، يتحدث مع كل شراء | (رصيد×متوسط + كمية×سعر) ÷ (رصيد+كمية) |
| **المصنّع (Prep Item)** | منتج نصف مصنّع داخل المطبخ له وصفة دفعة (عجينة، صوص) | 10 كجم عجين من 6 كجم دقيق… |
| **COGS** | تكلفة البضاعة المباعة | مخزون أول + مشتريات − مخزون آخر |
| **Prime Cost** | تكلفة الطعام + تكلفة العمالة | أهم مؤشر في المطاعم (هدف ~60-65%) |
| **Variance** | الفرق بين ما خرج فعلًا من المخزن وما كان يجب أن يخرج بالوصفات | عجز = هدر/سرقة/زيادة في التقديم |

### 1.2 قرارات محاسبية جوهرية في هذا النظام

- **جرد مستمر (Perpetual Inventory):** كل عملية تحرك المخزون لحظيًا (شراء، إنتاج، بيع، هالك)، و **الجرد الدوري** يصحح الفرق ويكشفه. هذا عكس "الجرد الدوري فقط" حيث لا تعرف رصيدك إلا آخر الشهر.
- **المتوسط المرجح المتحرك (Moving Weighted Average)** وليس FIFO: أبسط وأدق لمطعم يخلط نفس الخامة من دفعات مختلفة في نفس الوعاء.
- **دفتر حركات لا يُعدَّل (Append-only Ledger):** الخطأ يُصحح بحركة عكسية، لا بتعديل القديمة. الرصيد يمكن إعادة بنائه دائمًا من الحركات.
- **الإيراد = صافي المبيعات قبل الضريبة:** الضريبة المحصلة **التزام** على المطعم تجاه الدولة، تدخل الخزنة نقدًا لكنها ليست ربحًا، وتخرج عند توريدها.
- **السلفة ليست مصروفًا:** هي مال للموظف يُخصم من راتبه؛ المصروف هو الراتب نفسه (تكلفة العمالة).

### 1.3 من المتطلبات إلى سياقات (Bounded Contexts)

| السياق | المجلد | ما يملكه |
| --- | --- | --- |
| الكتالوج | `RawMaterials`, `Categories`, `Expenses`, `Suppliers` | الخامات ووحداتها ومتوسط تكلفتها، الفئات، المصروفات العمومية، الموردون |
| الإنتاج | `Recipes`, `Production` | الوصفات، المصنعات ووصفات دفعاتها، أوامر الإنتاج، محركات التكلفة |
| المنيو والمبيعات | `Menu`, `Sales` | الأصناف والأحجام والإضافات، إيصالات وملخصات المبيعات |
| المخزون | `StockMovements`, `StockCounts`, `Waste` | دفتر الحركات، الجرد، الهالك والكسر |
| المشتريات | `Purchases` | الفواتير وبنودها وخصمها وصورها |
| الخزنة | `Treasury`, `EndOfDay`, `Staff` | قيود الخزنة، حساب الموردين، تقفيل اليوم، الموظفون والرواتب والخصومات |
| الإدارة | `Access`, `Approvals`, `Company` | الصلاحيات والأقسام، الموافقات، إعدادات الشركة |
| التكامل | `Integrations` | ربط POS وربط HR |

### 1.4 المعمارية: Clean Architecture بأربع طبقات

```text
Costing.Api            ← HTTP، JWT، الصلاحيات، ملفات Angular (wwwroot)
Costing.Infrastructure ← EF Core/PostgreSQL، التقارير (SQL ثقيل)، Excel، HttpClient، التشفير
Costing.Application    ← حالات الاستخدام (MediatR Commands/Queries)
Costing.Domain         ← الكيانات والقواعد والمعادلات (بلا أي حزمة خارجية)
          الاعتماد يتجه للداخل فقط ↓
```

ملاحظة معمارية مهمة في هذا المشروع: **التقارير الثقيلة** (`Reports/*Service.cs`: التكلفة النظرية، الفروقات، الـ KPIs، الخزنة، التحليلات) في **Infrastructure** وتُستدعى مباشرة من الـ Controllers، لأنها استعلامات تجميعية كبيرة تحتاج LINQ على EF مباشرة (قراءة فقط). بينما كل ما **يغيّر** البيانات يمر بـ MediatR في Application. هذا تطبيق عملي لفكرة **CQRS**: الكتابة عبر الدومين بقواعده، والقراءة الثقيلة بأقصر طريق.

## 2. تأسيس المشروع: كل أمر ولماذا

```bash
mkdir Costing && cd Costing && git init
mkdir -p backend/src backend/tests frontend dev docs scripts
dotnet new sln -n Costing --format slnx
dotnet new classlib -n Costing.Domain         -o backend/src/Costing.Domain         -f net10.0
dotnet new classlib -n Costing.Application    -o backend/src/Costing.Application    -f net10.0
dotnet new classlib -n Costing.Infrastructure -o backend/src/Costing.Infrastructure -f net10.0
dotnet new web      -n Costing.Api            -o backend/src/Costing.Api            -f net10.0
rm backend/src/*/Class1.cs
dotnet add backend/src/Costing.Application    reference backend/src/Costing.Domain
dotnet add backend/src/Costing.Infrastructure reference backend/src/Costing.Application
dotnet add backend/src/Costing.Api            reference backend/src/Costing.Infrastructure
dotnet sln Costing.slnx add backend/src/*/*.csproj
```

### 2.1 ملفات الجذر

`.gitignore`: مخرجات البناء والحزم ونسخة الواجهة داخل `wwwroot` والأسرار لا تدخل Git.

@@file .gitignore

`.dockerignore`: ما لا يدخل سياق بناء الصورة (الاختبارات، `dev/`، `docs/`، الأسرار).

@@file .dockerignore

`global.json`: يجعل `dotnet test` يعمل على **Microsoft.Testing.Platform**.

@@file global.json

`Costing.slnx`: الـ Solution بالصيغة الجديدة.

@@file Costing.slnx

### 2.2 قاعدة بيانات التطوير

PostgreSQL 16 في Docker على `127.0.0.1:5436` (منفذ خاص حتى لا يتصادم مع قواعد أخرى على نفس الجهاز)، بيانات في Volume مسمى. **لا تستخدم `down -v` أبدًا** (يحذف البيانات).

@@file dev/docker-compose.yml

### 2.3 ملفات المشاريع

الدومين بلا حزم إطلاقًا:

@@file backend/src/Costing.Domain/Costing.Domain.csproj

التطبيق: MediatR مثبّت بإصدار دقيق `[12.5.0]` (الأقواس = هذا الإصدار فقط، ترقية الإصدار الرئيسي قرار واعٍ):

@@file backend/src/Costing.Application/Costing.Application.csproj

البنية التحتية: EF Core + Npgsql، ClosedXML للإكسيل، Identity.Core لتشفير كلمات المرور، Http لـ `IHttpClientFactory` (ربط HR):

@@file backend/src/Costing.Infrastructure/Costing.Infrastructure.csproj

الـ API: JWT، OpenAPI، وفحص صحة قاعدة البيانات:

@@file backend/src/Costing.Api/Costing.Api.csproj

## 3. الإعدادات

ترتيب المصادر (الأخير يغلب): `appsettings.json` ⇐ `appsettings.{Environment}.json` ⇐ متغيرات البيئة (`Auth__SigningKey`) ⇐ سطر الأوامر. القيم السرية في `appsettings.json` فارغة عمدًا: نسيانها في الإنتاج يمنع التطبيق من البدء بدل أن يعمل بمفتاح ضعيف.

@@file backend/src/Costing.Api/appsettings.json

@@file backend/src/Costing.Api/appsettings.Development.json

@@file backend/src/Costing.Api/Properties/launchSettings.json

## 4. `Program.cs`: شرح سطر بسطر

**تسجيل الخدمات:**

1. `WebApplication.CreateBuilder(args)`: الإعدادات، البيئة، الـ Logging.
2. `builder.ListenOnPlatformPort()`: على Railway، استمع على `PORT` بكل العناوين (`0.0.0.0`).
3. `AddCostingApplication()`: MediatR وكل الـ Handlers والخدمات الداخلية.
4. `AddCostingInfrastructure(configuration)`: قاعدة البيانات، المستودعات، التقارير، الإكسيل، الربط، العامل الخلفي لـ HR.
5. `AddCostingAuthentication(configuration)`: JWT والسياسات وصلاحيات الأقسام (الفصل 03).
6. `AddControllers().AddJsonOptions(JsonStringEnumConverter)`: الـ enums كأسماء (`"Cash"`, `"Pending"`).
7. `AddOpenApi()`: وصف الـ API (للتطوير).
8. `AddProblemDetails(...)` + `AddExceptionHandler<ApplicationExceptionHandler>()`: شكل موحد للأخطاء.
9. `AddHealthChecks().AddDbContextCheck<CostingDbContext>(tags: ["ready"])`.
10. `AddRateLimiter`: 20 محاولة دخول في الدقيقة لكل عنوان IP، فوق قفل الحساب بعد 5 أخطاء.
11. `AddCors`: فقط لـ `ng serve` في التطوير.

**خط الـ Middleware (الترتيب مهم):**

12. `await app.PrepareDatabaseAsync()`: الـ migrations + إعدادات الشركة + أول مدير، **قبل** أي طلب.
13. `UseExceptionHandler()` أولًا ليلتقط أخطاء كل ما بعده، ثم `UseStatusCodePages()`.
14. `UseDefaultFiles()` + `UseStaticFiles(...)`: ملفات Angular **قبل** المصادقة (الصفحة عامة، البيانات محمية).
15. `UseCors()` ⇐ `UseAuthentication()` ⇐ `UseRateLimiter()` ⇐ `UseAuthorization()`.
16. `MapOpenApi()` في التطوير، `MapControllers()`.
17. `/health` و `/health/ready`.
18. `MapFallback(SpaHosting.ServeIndexAsync)`: أي مسار غير معروف يعيد `index.html` (عدا `/api`).
19. `public partial class Program;`: لاختبارات الـ API (`WebApplicationFactory<Program>`).

@@file backend/src/Costing.Api/Program.cs

### 4.1 الاستضافة والأخطاء

@@file backend/src/Costing.Api/Hosting/PlatformHosting.cs

`SpaHosting`: الملفات المجزأة الأسماء تُخزَّن سنة `immutable`، و `index.html` بـ `no-cache` (يُعاد التحقق منه كل مرة فيصل الإصدار الجديد فورًا).

@@file backend/src/Costing.Api/Hosting/SpaHosting.cs

`ApplicationExceptionHandler`: `DomainException` ⇐ 422، `NotFoundException` ⇐ 404، `ForbiddenException` ⇐ 403، `ConflictException` ⇐ 409؛ وأي خطأ آخر يُسجَّل برقم مرجعي ويصل للمتصفح بلا Stack Trace. ويضيف `errors: [detail]` الذي تقرؤه الواجهة.

@@file backend/src/Costing.Api/ErrorHandling/ApplicationExceptionHandler.cs

## 5. حقن الاعتمادات

طبقة التطبيق: MediatR يجد الـ Handlers تلقائيًا، والخدمات الداخلية المشتركة (`TreasuryWriter`, `InvoicePoster`, `HrOutbox`, …) بعمر `Scoped`.

@@file backend/src/Costing.Application/DependencyInjection.cs

البنية التحتية: كل "منفذ" يُربط بتطبيقه. `Singleton` للساعة وملف الشركة والتشفير؛ `Scoped` لكل ما يلمس `CostingDbContext`؛ `RetryOnConflictBehavior` يلف كل أمر؛ و `AddHttpClient` + `AddHostedService<HrSyncWorker>` للربط مع HR.

@@file backend/src/Costing.Infrastructure/DependencyInjection.cs

## 6. أدوات مشتركة

`ICompanyProfile`: إعدادات الشركة في الذاكرة لكل طلب، و `CompanyMoney` لكتابة المال بعملة الشركة في رسائل الأخطاء.

@@file backend/src/Costing.Application/Common/CompanyProfile.cs

`IBusinessCalendar`: "اليوم التجاري" الذي تنتمي له لحظة ما (ليلة بعد منتصف الليل تتبع يوم الأمس حتى تبدأ ساعة اليوم التجاري). **كل** الكود يسأل هذه الواجهة بدل `DateTime.Now`.

@@file backend/src/Costing.Application/Common/WorkClock.cs

@@file backend/src/Costing.Infrastructure/Common/WorkClock.cs

@@file backend/src/Costing.Application/Common/RepositoryExtensions.cs

`UploadedFile`: التحقق من نوع الملف **من أول بايتاته** (JPEG يبدأ بـ `FF D8 FF`، PNG بـ `89 50 4E 47`…) لا من اسمه.

@@file backend/src/Costing.Application/Common/UploadedFile.cs

### 6.1 إعدادات الشركة (نموذج CQRS صغير كامل)

والشعار (شعار الشركة وأيقونة المتصفح) فيها: PNG أو SVG أو JPEG أو WebP أو ICO حتى 2 ميجابايت. نوعه يُقرأ **من بايتاته** (`LogoImage.TypeOf`) لا مما قاله المتصفح، فملف ICO يصل بنوع `application/octet-stream` يُقبل كأيقونة. و SVG وثيقة XML قد تحمل سكربت، فلا يُقبل إلا إن قُرئ بلا DTD (فلا يجلب ملفًا ولا يتمدد)، وبلا `<script>` ولا `foreignObject` ولا معالج حدث `on…` ولا رابط إلا لنفسه (`#id`) أو لصورة داخله (`data:image/…`)؛ ثم يُخدم **معزولًا** (`Content-Security-Policy: …; sandbox`) فما فات الفحص لا يعمل أيضًا. ويُخدم الشعار لأي أحد (`GET /api/company-settings/logo`، والمسار القديم `api/settings` معه) بإصداره في العنوان (`?v=`): بالإصدار يُحفظ سنة (`immutable`)، وبدونه يُتحقق منه كل مرة بالـ ETag فيرد 304 إن لم يتغير. و `LogoUrl` في الـ DTO هو العنوان بإصداره، و `HasCustomLogo` هل رُفع شعار بدل أيقونة النظام.

@@file backend/src/Costing.Application/Company/Settings.cs

@@file backend/src/Costing.Api/Controllers/SettingsController.cs

## 7. شجرة المستودع

@@tree

[الفصل التالي: قاعدة البيانات والكيانات →](02-database-schema-and-entities.md)
