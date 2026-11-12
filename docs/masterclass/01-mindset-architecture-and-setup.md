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

> 📄 **`.gitignore`** — 22 سطر

```gitignore
# Build output
bin/
obj/
node_modules/
dist/
.angular/

# The API's copy of the built app
backend/src/Costing.Api/wwwroot/

# Local settings and secrets
.env
*.user
.vs/
.idea/
.DS_Store
.env.*
.vscode/

# Database dumps
dev/backups/
*.dump
```


`.dockerignore`: ما لا يدخل سياق بناء الصورة (الاختبارات، `dev/`، `docs/`، الأسرار).

> 📄 **`.dockerignore`** — 18 سطر

```gitignore
# Built on the inside: nothing from this machine's builds, packages or secrets goes in.
**/bin/
**/obj/
**/node_modules/
**/.angular/
**/dist/
backend/src/Costing.Api/wwwroot/
backend/tests/
dev/
docs/
.git/
.vs/
.idea/
.vscode/
**/.DS_Store
**/*.user
.env
**/.env
```


`global.json`: يجعل `dotnet test` يعمل على **Microsoft.Testing.Platform**.

> 📄 **`global.json`** — 5 سطر

```json
{
  "test": {
    "runner": "Microsoft.Testing.Platform"
  }
}
```


`Costing.slnx`: الـ Solution بالصيغة الجديدة.

> 📄 **`Costing.slnx`** — 15 سطر

```xml
<Solution>
  <Folder Name="/backend/" />
  <Folder Name="/backend/src/">
    <Project Path="backend/src/Costing.Domain/Costing.Domain.csproj" />
    <Project Path="backend/src/Costing.Application/Costing.Application.csproj" />
    <Project Path="backend/src/Costing.Infrastructure/Costing.Infrastructure.csproj" />
    <Project Path="backend/src/Costing.Api/Costing.Api.csproj" />
  </Folder>
  <Folder Name="/backend/tests/">
    <Project Path="backend/tests/Costing.Domain.Tests/Costing.Domain.Tests.csproj" />
    <Project Path="backend/tests/Costing.Application.Tests/Costing.Application.Tests.csproj" />
    <Project Path="backend/tests/Costing.Infrastructure.Tests/Costing.Infrastructure.Tests.csproj" />
    <Project Path="backend/tests/Costing.Api.Tests/Costing.Api.Tests.csproj" />
  </Folder>
</Solution>
```


### 2.2 قاعدة بيانات التطوير

PostgreSQL 16 في Docker على `127.0.0.1:5436` (منفذ خاص حتى لا يتصادم مع قواعد أخرى على نفس الجهاز)، بيانات في Volume مسمى. **لا تستخدم `down -v` أبدًا** (يحذف البيانات).

> 📄 **`dev/docker-compose.yml`** — 25 سطر

```yaml
# The development database: PostgreSQL on localhost:5436, its data in a named volume.
#   docker compose -f dev/docker-compose.yml up -d
# Never `down -v`: -v deletes the volume, and the data with it.
name: costing-dev

services:
  db:
    image: postgres:16-alpine
    container_name: costing-dev-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: costing
      POSTGRES_PASSWORD: costing-dev
      POSTGRES_DB: costing
    ports:
      - "127.0.0.1:5436:5432"
    volumes:
      - costing-dev-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U costing -d costing"]
      interval: 5s
      retries: 10

volumes:
  costing-dev-data:
```


### 2.3 ملفات المشاريع

الدومين بلا حزم إطلاقًا:

> 📄 **`backend/src/Costing.Domain/Costing.Domain.csproj`** — 13 سطر

```xml
<Project Sdk="Microsoft.NET.Sdk">

  <!-- The costing model: raw materials and their stock, recipes and prep items, production, the
       menu and its sales, purchases, counts and waste, the safe, the approvals a manager gives,
       and who works which section. No references: everything else depends on it. -->

  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>

</Project>
```


التطبيق: MediatR مثبّت بإصدار دقيق `[12.5.0]` (الأقواس = هذا الإصدار فقط، ترقية الإصدار الرئيسي قرار واعٍ):

> 📄 **`backend/src/Costing.Application/Costing.Application.csproj`** — 21 سطر

```xml
<Project Sdk="Microsoft.NET.Sdk">

  <!-- The use cases, as MediatR requests: the stock, the costs, the menu and sales, the safe, and
       the approvals they share. Infrastructure supplies the repositories and the clock. -->

  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>

  <ItemGroup>
    <ProjectReference Include="..\Costing.Domain\Costing.Domain.csproj" />
  </ItemGroup>

  <ItemGroup>
    <PackageReference Include="MediatR" Version="[12.5.0]" />
    <PackageReference Include="Microsoft.Extensions.Logging.Abstractions" Version="10.0.11" />
  </ItemGroup>

</Project>
```


البنية التحتية: EF Core + Npgsql، ClosedXML للإكسيل، Identity.Core لتشفير كلمات المرور، Http لـ `IHttpClientFactory` (ربط HR):

> 📄 **`backend/src/Costing.Infrastructure/Costing.Infrastructure.csproj`** — 32 سطر

```xml
<Project Sdk="Microsoft.NET.Sdk">

  <!-- The database (PostgreSQL), the cost reports and the treasury's, the Excel sheets, and the
       system's users. Implements the application's ports. -->

  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>

  <ItemGroup>
    <ProjectReference Include="..\Costing.Application\Costing.Application.csproj" />
  </ItemGroup>

  <ItemGroup>
    <PackageReference Include="ClosedXML" Version="0.105.1" />
    <PackageReference Include="Npgsql.EntityFrameworkCore.PostgreSQL" Version="10.0.0" />
    <!-- Pins EF Core for every project that uses this one: the Design package lifts EF Core to
         its own patch here, which a consumer such as the API would otherwise not load. -->
    <PackageReference Include="Microsoft.EntityFrameworkCore.Relational" Version="10.0.12" />
    <PackageReference Include="Microsoft.EntityFrameworkCore.Design" Version="10.0.12">
      <PrivateAssets>all</PrivateAssets>
      <IncludeAssets>runtime; build; native; contentfiles; analyzers; buildtransitive</IncludeAssets>
    </PackageReference>
    <PackageReference Include="Microsoft.Extensions.Hosting.Abstractions" Version="10.0.12" />
    <PackageReference Include="Microsoft.Extensions.Http" Version="10.0.12" />
    <PackageReference Include="Microsoft.Extensions.Identity.Core" Version="10.0.12" />
    <PackageReference Include="Microsoft.Extensions.Options.ConfigurationExtensions" Version="10.0.12" />
  </ItemGroup>

</Project>
```


الـ API: JWT، OpenAPI، وفحص صحة قاعدة البيانات:

> 📄 **`backend/src/Costing.Api/Costing.Api.csproj`** — 25 سطر

```xml
<Project Sdk="Microsoft.NET.Sdk.Web">

  <!-- The HTTP API and the Angular app's files. -->

  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>

  <ItemGroup>
    <ProjectReference Include="..\Costing.Infrastructure\Costing.Infrastructure.csproj" />
  </ItemGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.AspNetCore.Authentication.JwtBearer" Version="10.0.12" />
    <PackageReference Include="Microsoft.AspNetCore.OpenApi" Version="10.0.12" />
    <PackageReference Include="Microsoft.Extensions.Diagnostics.HealthChecks.EntityFrameworkCore" Version="10.0.12" />
  </ItemGroup>

  <ItemGroup>
    <InternalsVisibleTo Include="Costing.Api.Tests" />
  </ItemGroup>

</Project>
```


## 3. الإعدادات

ترتيب المصادر (الأخير يغلب): `appsettings.json` ⇐ `appsettings.{Environment}.json` ⇐ متغيرات البيئة (`Auth__SigningKey`) ⇐ سطر الأوامر. القيم السرية في `appsettings.json` فارغة عمدًا: نسيانها في الإنتاج يمنع التطبيق من البدء بدل أن يعمل بمفتاح ضعيف.

> 📄 **`backend/src/Costing.Api/appsettings.json`** — 38 سطر

```json
{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning",
      "Microsoft.AspNetCore.DataProtection": "Error",
      "Microsoft.EntityFrameworkCore.Database.Command": "Warning"
    }
  },
  "AllowedHosts": "*",
  "Urls": "http://0.0.0.0:5100",
  "ConnectionStrings": {
    "Costing": ""
  },
  "Database": {
    "MigrateOnStartup": true
  },
  "Auth": {
    "SigningKey": "",
    "TokenLifetimeHours": 12,
    "FirstManager": {
      "Email": "",
      "Name": "",
      "Password": ""
    }
  },
  "Company": {
    "Name": "My company",
    "TimeZoneId": "Africa/Cairo",
    "WorkdayStartsAtHour": 4,
    "Country": "Egypt",
    "CurrencySymbol": "L.E",
    "CurrencyPosition": "Before"
  },
  "Cors": {
    "AllowedOrigins": []
  }
}
```


> 📄 **`backend/src/Costing.Api/appsettings.Development.json`** — 17 سطر

```json
{
  "Urls": "http://localhost:5100",
  "ConnectionStrings": {
    "Costing": "Host=localhost;Port=5436;Database=costing;Username=costing;Password=costing-dev"
  },
  "Auth": {
    "SigningKey": "development-only-signing-key-never-use-this-in-production",
    "FirstManager": {
      "Email": "manager@example.com",
      "Name": "Manager",
      "Password": "change-me-now"
    }
  },
  "Cors": {
    "AllowedOrigins": [ "http://localhost:4230" ]
  }
}
```


> 📄 **`backend/src/Costing.Api/Properties/launchSettings.json`** — 14 سطر

```json
{
  "$schema": "https://json.schemastore.org/launchsettings.json",
  "profiles": {
    "http": {
      "commandName": "Project",
      "dotnetRunMessages": true,
      "launchBrowser": false,
      "applicationUrl": "http://localhost:5100",
      "environmentVariables": {
        "ASPNETCORE_ENVIRONMENT": "Development"
      }
    }
  }
}
```


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

> 📄 **`backend/src/Costing.Api/Program.cs`** — 88 سطر

```csharp
using System.Globalization;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.AspNetCore.RateLimiting;
using Costing.Application;
using Costing.Api.Auth;
using Costing.Api.Controllers;
using Costing.Api.ErrorHandling;
using Costing.Api.Hosting;
using Costing.Infrastructure;
using Costing.Infrastructure.Persistence;

var builder = WebApplication.CreateBuilder(args);
// On a hosting platform, its PORT.
builder.ListenOnPlatformPort();

builder.Services.AddCostingApplication();
builder.Services.AddCostingInfrastructure(builder.Configuration);
builder.Services.AddCostingAuthentication(builder.Configuration);

// Enums travel as names ("Cash", "Pending").
builder.Services.AddControllers()
    .AddJsonOptions(o => o.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.AddOpenApi();

builder.Services.AddProblemDetails(o => o.CustomizeProblemDetails = ApplicationExceptionHandler.Customize);
builder.Services.AddExceptionHandler<ApplicationExceptionHandler>();

// /health says the process is up, /health/ready that it can reach its database too.
builder.Services.AddHealthChecks().AddDbContextCheck<CostingDbContext>(name: "database", tags: ["ready"]);

// Per address, on top of each account's own lockout: one browser cannot cycle through passwords
// across every account.
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.OnRejected = async (context, cancellationToken) =>
    {
        if (context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter))
            context.HttpContext.Response.Headers.RetryAfter = ((int)retryAfter.TotalSeconds).ToString(NumberFormatInfo.InvariantInfo);
        await context.HttpContext.Response.WriteAsJsonAsync(
            new { errors = new[] { "Too many sign-in attempts. Wait a minute and try again." } }, cancellationToken);
    };
    o.AddPolicy(AuthController.SignInRateLimit, context => RateLimitPartition.GetFixedWindowLimiter(
        context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 20, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
});

// Only needed when the Angular app is served from somewhere else, such as `ng serve` during
// development.
builder.Services.AddCors(o => o.AddDefaultPolicy(policy => policy
    .WithOrigins(builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [])
    .AllowAnyHeader()
    .AllowAnyMethod()
    .AllowCredentials()));

var app = builder.Build();

await app.PrepareDatabaseAsync();

app.UseExceptionHandler();
app.UseStatusCodePages();

// Before authentication: the page itself is public, and only the API behind it needs a
// sign-in.
app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions { OnPrepareResponse = SpaHosting.SetCacheHeaders });

app.UseCors();
app.UseAuthentication();
app.UseRateLimiter();
app.UseAuthorization();

if (app.Environment.IsDevelopment())
    app.MapOpenApi().AllowAnonymous();

app.MapControllers();

app.MapHealthChecks("/health", new HealthCheckOptions { Predicate = _ => false }).AllowAnonymous();
app.MapHealthChecks("/health/ready", new HealthCheckOptions { Predicate = check => check.Tags.Contains("ready") }).AllowAnonymous();

app.MapFallback(SpaHosting.ServeIndexAsync).AllowAnonymous();

app.Run();

// For the API tests' WebApplicationFactory.
public partial class Program;
```


### 4.1 الاستضافة والأخطاء

> 📄 **`backend/src/Costing.Api/Hosting/PlatformHosting.cs`** — 15 سطر

```csharp
namespace Costing.Api.Hosting;

// On a hosting platform that gives the app its port in PORT (Railway, Render, Heroku): the API
// listens there on every address. With no PORT, the configuration's Urls as they are.
internal static class PlatformHosting
{
    public const string PortVariable = "PORT";

    public static void ListenOnPlatformPort(this WebApplicationBuilder builder)
    {
        if (!int.TryParse(builder.Configuration[PortVariable], out var webPort) || webPort <= 0)
            return;
        builder.WebHost.UseUrls($"http://0.0.0.0:{webPort}");
    }
}
```


`SpaHosting`: الملفات المجزأة الأسماء تُخزَّن سنة `immutable`، و `index.html` بـ `no-cache` (يُعاد التحقق منه كل مرة فيصل الإصدار الجديد فورًا).

> 📄 **`backend/src/Costing.Api/Hosting/SpaHosting.cs`** — 36 سطر

```csharp
using Microsoft.AspNetCore.StaticFiles;

namespace Costing.Api.Hosting;

// The Angular app, built into wwwroot. Served from here, the tills load the UI and call the API
// on one origin, from the one machine that has to be running anyway, with or without internet.
internal static class SpaHosting
{
    // Deep links such as /inventory are Angular routes, not files, so any path nothing else
    // matched gets index.html and the app's router takes it from there. Not under /api or
    // /hubs: an unknown path there is a genuine 404, and answering it with a web page would
    // hand the caller HTML where it expects JSON.
    public static async Task ServeIndexAsync(HttpContext context)
    {
        var path = context.Request.Path;
        var index = context.RequestServices.GetRequiredService<IWebHostEnvironment>().WebRootFileProvider.GetFileInfo("index.html");

        if (path.StartsWithSegments("/api") || path.StartsWithSegments("/hubs") || !index.Exists)
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }

        context.Response.ContentType = "text/html; charset=utf-8";
        context.Response.Headers.CacheControl = "no-cache";
        await context.Response.SendFileAsync(index);
    }

    // index.html is always revalidated, so a browser picks up a new build on its next reload.
    // Everything else the Angular build emits has a content hash in its name and can be cached
    // for good.
    public static void SetCacheHeaders(StaticFileResponseContext context) =>
        context.Context.Response.Headers.CacheControl = context.File.Name == "index.html"
            ? "no-cache"
            : "public, max-age=31536000, immutable";
}
```


`ApplicationExceptionHandler`: `DomainException` ⇐ 422، `NotFoundException` ⇐ 404، `ForbiddenException` ⇐ 403، `ConflictException` ⇐ 409؛ وأي خطأ آخر يُسجَّل برقم مرجعي ويصل للمتصفح بلا Stack Trace. ويضيف `errors: [detail]` الذي تقرؤه الواجهة.

> 📄 **`backend/src/Costing.Api/ErrorHandling/ApplicationExceptionHandler.cs`** — 75 سطر

```csharp
using Microsoft.AspNetCore.Diagnostics;
using Costing.Domain.Common;

namespace Costing.Api.ErrorHandling;

// Turns the exceptions the lower layers throw on purpose into the right status code, with the
// message as ProblemDetails.detail. Those messages are written to be shown to the user as they
// are ("Choose monthly or daily pay.", "A leave ends on or after the day it starts.").
//
// Anything else is a fault: logged here with a reference, and answered with only that
// reference, so no stack trace reaches a browser. On .NET 10 the exception middleware does not
// log what a handler has handled, so each failure is logged once, here.
internal sealed class ApplicationExceptionHandler(
    IProblemDetailsService problemDetails,
    ILogger<ApplicationExceptionHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        // Too late to send a different response; let the host drop the connection.
        if (httpContext.Response.HasStarted)
            return false;

        var (status, title, detail) = exception switch
        {
            DomainException => (StatusCodes.Status422UnprocessableEntity, "The request breaks a business rule.", exception.Message),
            NotFoundException => (StatusCodes.Status404NotFound, "Not found.", exception.Message),
            ForbiddenException => (StatusCodes.Status403Forbidden, "Not allowed.", exception.Message),
            ConflictException => (StatusCodes.Status409Conflict, "Conflict.", exception.Message),

            // The browser closed the tab or lost the network mid-request. Nothing to tell anyone.
            OperationCanceledException when httpContext.RequestAborted.IsCancellationRequested => (499, "Client closed request.", (string?)null),

            _ => (StatusCodes.Status500InternalServerError, "An unexpected error occurred.", (string?)null),
        };

        if (status == StatusCodes.Status500InternalServerError)
        {
            var reference = httpContext.TraceIdentifier;
            logger.LogError(exception, "Unhandled exception on {Method} {Path} (reference {Reference})",
                httpContext.Request.Method, httpContext.Request.Path, reference);
            detail = $"Something went wrong on our end. Please try again. (reference {reference})";
        }

        httpContext.Response.StatusCode = status;
        return await problemDetails.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = httpContext,
            Exception = exception,
            ProblemDetails = { Status = status, Title = title, Detail = detail },
        });
    }

    // Applied to every ProblemDetails the API writes: the ones above, controller Problem()
    // calls, and the bare 401/403/404s from UseStatusCodePages.
    //
    // Adds an `errors` array holding the detail, the shape the Angular app reads
    // (err.error?.errors?.[0]). Model-validation 400s keep their own `errors`, an object keyed by
    // field, which the app handles too.
    public static void Customize(ProblemDetailsContext context)
    {
        var problem = context.ProblemDetails;
        problem.Extensions.TryAdd("traceId", context.HttpContext.TraceIdentifier);

        problem.Detail ??= problem.Status switch
        {
            StatusCodes.Status401Unauthorized => "Sign in again.",
            StatusCodes.Status403Forbidden => "You are not allowed to do that.",
            StatusCodes.Status404NotFound => "Not found.",
            _ => null,
        };

        if (problem is not HttpValidationProblemDetails && problem.Detail is { } detail)
            problem.Extensions.TryAdd("errors", new[] { detail });
    }
}
```


## 5. حقن الاعتمادات

طبقة التطبيق: MediatR يجد الـ Handlers تلقائيًا، والخدمات الداخلية المشتركة (`TreasuryWriter`, `InvoicePoster`, `HrOutbox`, …) بعمر `Scoped`.

> 📄 **`backend/src/Costing.Application/DependencyInjection.cs`** — 28 سطر

```csharp
using Microsoft.Extensions.DependencyInjection;

namespace Costing.Application;

public static class DependencyInjection
{
    // Infrastructure supplies the repositories, the unit of work and the clock.
    public static IServiceCollection AddCostingApplication(this IServiceCollection services)
    {
        services.AddMediatR(config => config.RegisterServicesFromAssembly(typeof(DependencyInjection).Assembly));
        services.AddScoped<Sales.SaleStockPoster>();
        services.AddScoped<Sales.SaleWriter>();
        services.AddScoped<Sales.DailySalesWriter>();
        services.AddScoped<Approvals.DeletionTargets>();
        services.AddScoped<Production.PrepItemWriter>();
        services.AddScoped<Production.ProductionWriter>();
        services.AddScoped<Treasury.TreasuryWriter>();
        services.AddScoped<Purchases.InvoiceRecorder>();
        services.AddScoped<Purchases.InvoicePoster>();
        services.AddScoped<Purchases.InvoiceCorrector>();
        services.AddScoped<RawMaterials.MaterialUnitWriter>();
        services.AddScoped<Categories.CategoryDeleter>();
        services.AddScoped<EndOfDay.EndOfDayDays>();
        services.AddScoped<Integrations.HrOutbox>();
        services.AddScoped<Integrations.StaffDeductionReading>();
        return services;
    }
}
```


البنية التحتية: كل "منفذ" يُربط بتطبيقه. `Singleton` للساعة وملف الشركة والتشفير؛ `Scoped` لكل ما يلمس `CostingDbContext`؛ `RetryOnConflictBehavior` يلف كل أمر؛ و `AddHttpClient` + `AddHostedService<HrSyncWorker>` للربط مع HR.

> 📄 **`backend/src/Costing.Infrastructure/DependencyInjection.cs`** — 119 سطر

```csharp
using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Costing.Application.Common;
using Costing.Domain.Access;
using Costing.Domain.Approvals;
using Costing.Domain.Categories;
using Costing.Domain.Common;
using Costing.Domain.Company;
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
using Costing.Infrastructure.Common;
using Costing.Infrastructure.Reports;
using Costing.Infrastructure.Identity;
using Costing.Infrastructure.Persistence;

namespace Costing.Infrastructure;

public static class DependencyInjection
{
    public const string ConnectionStringName = "Costing";

    // Every port of the application, except the live notifications, which come from the API's hub.
    public static IServiceCollection AddCostingInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        // DATABASE_URL first (a hosting platform's), else ConnectionStrings:Costing.
        var connectionString = DatabaseConnection.Resolve(configuration);

        services.Configure<CompanyOptions>(configuration.GetSection(CompanyOptions.Section));
        services.AddSingleton<ICompanyProfile, CompanyProfileStore>();
        services.AddSingleton<BusinessCalendar>();
        services.AddSingleton<IBusinessCalendar>(sp => sp.GetRequiredService<BusinessCalendar>());
        services.TryAddSingleton(TimeProvider.System);

        services.AddDbContext<CostingDbContext>(o => o.UseNpgsql(connectionString, CostingDbContext.ConfigureNpgsql));
        services.AddScoped<IUnitOfWork>(sp => sp.GetRequiredService<CostingDbContext>());
        services.AddTransient(typeof(IPipelineBehavior<,>), typeof(RetryOnConflictBehavior<,>));

        // Company Settings.
        services.AddScoped<ICompanySettingsStore, Company.CompanySettingsStore>();

        // Approvals.
        services.AddScoped<IApprovalRequestRepository, ApprovalRequestRepository>();

        // The menu, its sales, and the staff the safe pays.
        services.AddScoped<IMenuRepository, MenuRepository>();
        services.AddScoped<Domain.Integrations.IPosLinkStore, PosLinkStore>();
        services.AddScoped<Domain.Integrations.IPosZReportRepository, PosZReportRepository>();
        services.AddScoped<Domain.Integrations.IPosDayRepository, PosDayRepository>();
        services.AddScoped<Domain.Integrations.IPosSyncJournal, PosSyncJournal>();
        // The HR link: its stores, HR's key kept encrypted, the calls to HR, and its clock.
        services.AddScoped<Domain.Integrations.IHrLinkStore, HrLinkStore>();
        services.AddScoped<Domain.Integrations.ISyncedEmployeeRepository, SyncedEmployeeRepository>();
        services.AddScoped<Domain.Integrations.IHrOutboxRepository, HrOutboxRepository>();
        services.AddScoped<Domain.Integrations.IHrSyncJournal, HrSyncJournal>();
        services.AddScoped<Domain.Staff.IPayrollRunRepository, PayrollRunRepository>();
        services.AddScoped<Domain.Staff.IStaffDeductionRepository, StaffDeductionRepository>();
        services.AddSingleton<Application.Integrations.IHrKeyProtector, Integrations.HrKeyProtector>();
        services.AddHttpClient(Integrations.HrGateway.ClientName, client => client.Timeout = TimeSpan.FromSeconds(20));
        services.AddScoped<Application.Integrations.IHrGateway, Integrations.HrGateway>();
        services.AddScoped<Integrations.IHrOutboxSender, Integrations.HrOutboxSender>();
        services.AddHostedService<Integrations.HrSyncWorker>();
        services.AddScoped<ISalesReceiptRepository, SalesReceiptRepository>();
        services.AddScoped<IStaffMemberRepository, StaffMemberRepository>();
        services.AddScoped<IUserTabAccessRepository, UserTabAccessRepository>();

        // Stock, recipes, purchases and the safe.
        services.AddScoped<IRawMaterialRepository, RawMaterialRepository>();
        services.AddScoped<Costing.Application.RawMaterials.IMaterialUnits, MaterialUnits>();
        services.AddScoped<Costing.Application.Categories.IItemConversions, ItemConversions>();
        services.AddScoped<IRecipeRepository, RecipeRepository>();
        services.AddScoped<IRecipeCategoryRepository, RecipeCategoryRepository>();
        services.AddScoped<IStockMovementRepository, StockMovementRepository>();
        services.AddScoped<IStockCountRepository, StockCountRepository>();
        services.AddScoped<IPurchaseInvoiceRepository, PurchaseInvoiceRepository>();
        services.AddScoped<IPurchaseAttachmentStore, PurchaseAttachmentStore>();
        services.AddScoped<Costing.Domain.EndOfDay.IEndOfDayRepository, EndOfDayRepository>();
        services.AddScoped<Costing.Domain.EndOfDay.IEndOfDayPhotoStore, EndOfDayPhotoStore>();
        services.AddScoped<ISupplierRepository, SupplierRepository>();
        services.AddScoped<IPurchaseCategoryRepository, PurchaseCategoryRepository>();
        services.AddScoped<ISafeTransactionRepository, SafeTransactionRepository>();
        services.AddScoped<ISupplierLedgerRepository, SupplierLedgerRepository>();
        services.AddScoped<Costing.Application.Approvals.IRecordDescriptions, RecordDescriptions>();
        services.AddScoped<Costing.Application.Treasury.ITaxRate, FinancialTaxRate>();
        services.AddScoped<IExpenseItemRepository, ExpenseItemRepository>();
        services.AddScoped<IPrepRecipeRepository, PrepRecipeRepository>();
        services.AddScoped<IProductionOrderRepository, ProductionOrderRepository>();
        services.AddScoped<IBreakageEntryRepository, BreakageEntryRepository>();

        // The cost reports and the treasury.
        services.AddScoped<SalesLedger>();
        services.AddScoped<CostingService>();
        services.AddScoped<VarianceService>();
        services.AddScoped<KpiService>();
        services.AddScoped<BreakEvenService>();
        services.AddScoped<PurchaseSpendingService>();
        services.AddScoped<TreasuryService>();
        services.AddScoped<IntelligenceService>();
        services.AddScoped<StockCardService>();

        // The system's users.
        services.AddScoped<UserDirectory>();

        return services;
    }
}
```


## 6. أدوات مشتركة

`ICompanyProfile`: إعدادات الشركة في الذاكرة لكل طلب، و `CompanyMoney` لكتابة المال بعملة الشركة في رسائل الأخطاء.

> 📄 **`backend/src/Costing.Application/Common/CompanyProfile.cs`** — 47 سطر

```csharp
using Costing.Domain.Company;

namespace Costing.Application.Common;

// The company's settings as they stand (CompanySettings), at hand on every request without the
// database: how money is written in messages, the country, and the clock's time zone and
// business day.
public sealed record CompanyProfile(
    string Name,
    MoneyFormat Money,
    Country Country,
    string TimeZoneId,
    int WorkdayStartsAtHour,
    bool HasLogo,
    DateTime? LogoUpdatedAtUtc)
{
    public static CompanyProfile From(CompanySettings settings) => new(
        settings.Name, settings.Money, settings.Country, settings.TimeZoneId, settings.WorkdayStartsAtHour, settings.HasLogo,
        settings.LogoUpdatedAtUtc);
}

// Kept in memory for the whole app, read at start-up from the database and replaced as a manager
// saves the settings. One API process holds it: a second one would not see the other's saves
// until it starts again.
public interface ICompanyProfile
{
    CompanyProfile Current { get; }

    void Set(CompanyProfile profile);
}

// How amounts are written in the system's own messages ("Takings of 12 Oct · L.E 1,140.00"): the
// company's currency, as Company Settings has it. Set with the profile (ICompanyProfile.Set), so
// the messages follow a save at once; L.E until the settings are read.
public static class CompanyMoney
{
    private static volatile MoneyFormat _format = new("L.E", CurrencyPosition.Before);

    public static MoneyFormat Format
    {
        get => _format;
        set => _format = value;
    }

    // "L.E 1,140.00"; another number format: "#,0.00##" for a unit cost.
    public static string Text(decimal amount, string numberFormat = "N2") => _format.Format(amount, numberFormat);
}
```


`IBusinessCalendar`: "اليوم التجاري" الذي تنتمي له لحظة ما (ليلة بعد منتصف الليل تتبع يوم الأمس حتى تبدأ ساعة اليوم التجاري). **كل** الكود يسأل هذه الواجهة بدل `DateTime.Now`.

> 📄 **`backend/src/Costing.Application/Common/WorkClock.cs`** — 19 سطر

```csharp
namespace Costing.Application.Common;

// The business's clock, in its own time zone: the business day a moment belongs to (a night past
// midnight still the evening's day until the day starts), and its calendar date on the wall.
public interface IBusinessCalendar
{
    DateOnly BusinessDateOf(DateTime utc);

    // The calendar date on the wall: after midnight, a day ahead of the business day until it starts.
    DateOnly LocalDateOf(DateTime utc);

    DateTime ToLocal(DateTime utc);

    // A wall-clock time as UTC; one skipped by a daylight-saving change, the hour after it.
    DateTime ToUtc(DateTime local);

    // The day's span in UTC: [FromUtc, ToUtc).
    (DateTime FromUtc, DateTime ToUtc) Bounds(DateOnly businessDate);
}
```


> 📄 **`backend/src/Costing.Infrastructure/Common/WorkClock.cs`** — 85 سطر

```csharp
using Microsoft.Extensions.Options;
using Costing.Application.Common;
using Costing.Domain.Company;

namespace Costing.Infrastructure.Common;

// The company's settings as the configuration first gives them (the Company section): only until
// the first start has made the settings row, which a manager changes on Company Settings after.
public sealed class CompanyOptions
{
    public const string Section = "Company";

    public string Name { get; set; } = "My company";

    // IANA id. Works on Linux, macOS and Windows alike.
    public string TimeZoneId { get; set; } = "Africa/Cairo";

    // The hour the business day rolls over, in local time. With 4, a sale at 01:30 belongs to the
    // evening before: a night past midnight is one day.
    public int WorkdayStartsAtHour { get; set; } = 4;

    public Country Country { get; set; } = Country.Egypt;

    // Empty: amounts are written as numbers alone.
    public string CurrencySymbol { get; set; } = string.Empty;

    public CurrencyPosition CurrencyPosition { get; set; } = CurrencyPosition.Before;
}

// The company's settings held for the whole app (ICompanyProfile): the configuration's until the
// database's are read at start-up, then each save's.
public sealed class CompanyProfileStore(IOptions<CompanyOptions> options) : ICompanyProfile
{
    private volatile CompanyProfile _current = new(
        options.Value.Name, new MoneyFormat(options.Value.CurrencySymbol, options.Value.CurrencyPosition), options.Value.Country,
        options.Value.TimeZoneId, options.Value.WorkdayStartsAtHour, HasLogo: false, LogoUpdatedAtUtc: null);

    public CompanyProfile Current => _current;

    public void Set(CompanyProfile profile)
    {
        _current = profile;
        CompanyMoney.Format = profile.Money;
    }
}

// Everything is stored in UTC. This is the one place that knows the company's local time: which
// business day a moment belongs to, and the day's span. It follows the time zone and the hour the
// business day starts of Company Settings as they are saved.
public sealed class BusinessCalendar(ICompanyProfile company) : IBusinessCalendar
{
    private volatile Zone _zone = new(string.Empty, TimeZoneInfo.Utc);

    public DateTime ToLocal(DateTime utc) => TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), ZoneNow());

    public DateOnly BusinessDateOf(DateTime utc) => DateOnly.FromDateTime(ToLocal(utc).AddHours(-company.Current.WorkdayStartsAtHour));

    public DateOnly LocalDateOf(DateTime utc) => DateOnly.FromDateTime(ToLocal(utc));

    public (DateTime FromUtc, DateTime ToUtc) Bounds(DateOnly businessDate)
    {
        var start = businessDate.ToDateTime(new TimeOnly(company.Current.WorkdayStartsAtHour, 0));
        return (ToUtc(start), ToUtc(start.AddDays(1)));
    }

    // A local time skipped by a daylight-saving change does not exist; the hour after it does.
    public DateTime ToUtc(DateTime local)
    {
        var zone = ZoneNow();
        local = DateTime.SpecifyKind(local, DateTimeKind.Unspecified);
        return TimeZoneInfo.ConvertTimeToUtc(zone.IsInvalidTime(local) ? local.AddHours(1) : local, zone);
    }

    // Looked up once a zone, not each time.
    private TimeZoneInfo ZoneNow()
    {
        var id = company.Current.TimeZoneId;
        var zone = _zone;
        if (zone.Id != id)
            _zone = zone = new Zone(id, TimeZoneInfo.FindSystemTimeZoneById(id));
        return zone.Info;
    }

    private sealed record Zone(string Id, TimeZoneInfo Info);
}
```


> 📄 **`backend/src/Costing.Application/Common/RepositoryExtensions.cs`** — 12 سطر

```csharp
using Costing.Domain.Common;

namespace Costing.Application.Common;

public static class RepositoryExtensions
{
    public static async Task<TAggregate> GetRequiredAsync<TAggregate>(
        this IRepository<TAggregate> repository, Guid id, CancellationToken cancellationToken)
        where TAggregate : AggregateRoot =>
        await repository.GetByIdAsync(id, cancellationToken)
            ?? throw new NotFoundException(typeof(TAggregate).Name, id);
}
```


`UploadedFile`: التحقق من نوع الملف **من أول بايتاته** (JPEG يبدأ بـ `FF D8 FF`، PNG بـ `89 50 4E 47`…) لا من اسمه.

> 📄 **`backend/src/Costing.Application/Common/UploadedFile.cs`** — 20 سطر

```csharp
namespace Costing.Application.Common;

// A photo or PDF someone uploaded, shown in the browser later.
internal static class UploadedFile
{
    // Checked, not taken on trust: it must be the picture or PDF its type says, by its first bytes.
    public static bool LooksLike(string contentType, byte[] content)
    {
        bool StartsWith(params byte[] prefix) => content.Length >= prefix.Length && content.AsSpan(0, prefix.Length).SequenceEqual(prefix);
        return contentType.ToLowerInvariant() switch
        {
            "image/jpeg" => StartsWith(0xFF, 0xD8, 0xFF),
            "image/png" => StartsWith(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A),
            "image/webp" => content.Length >= 12 && StartsWith((byte)'R', (byte)'I', (byte)'F', (byte)'F')
                && content.AsSpan(8, 4).SequenceEqual("WEBP"u8),
            "application/pdf" => StartsWith((byte)'%', (byte)'P', (byte)'D', (byte)'F'),
            _ => false,
        };
    }
}
```


### 6.1 إعدادات الشركة (نموذج CQRS صغير كامل)

> 📄 **`backend/src/Costing.Application/Company/Settings.cs`** — 142 سطر

```csharp
using MediatR;
using Costing.Application.Common;
using Costing.Domain.Common;
using Costing.Domain.Company;

namespace Costing.Application.Company;

// Company Settings (إعدادات الشركة): the company's name and logo, how money is written, the
// country, the time zone and the hour its business day starts. Read by everyone (the sign-in page
// shows the name and logo before anyone signs in); changed by a manager. A save is at once in the
// app's profile (ICompanyProfile), so the clock and the messages follow it without a restart.

public sealed record CompanySettingsDto(
    string Name,
    string CurrencySymbol,
    CurrencyPosition CurrencyPosition,
    Country Country,
    string TimeZoneId,
    int WorkdayStartsAtHour,
    bool HasLogo,
    // Changes whenever the logo does, for the app to ask for the new one.
    long LogoVersion)
{
    public static CompanySettingsDto From(CompanyProfile p) => new(
        p.Name, p.Money.Symbol, p.Money.Position, p.Country, p.TimeZoneId, p.WorkdayStartsAtHour, p.HasLogo,
        p.LogoUpdatedAtUtc?.Ticks ?? 0);
}

public sealed record GetCompanySettingsQuery : IRequest<CompanySettingsDto>;

internal sealed class GetCompanySettingsHandler(ICompanyProfile profile) : IRequestHandler<GetCompanySettingsQuery, CompanySettingsDto>
{
    public Task<CompanySettingsDto> Handle(GetCompanySettingsQuery request, CancellationToken cancellationToken) =>
        Task.FromResult(CompanySettingsDto.From(profile.Current));
}

public sealed record CompanySettingsInput(
    string Name,
    string? CurrencySymbol,
    CurrencyPosition CurrencyPosition,
    Country Country,
    string TimeZoneId,
    int WorkdayStartsAtHour);

// A manager's.
public sealed record UpdateCompanySettingsCommand(CompanySettingsInput Settings, string StaffName) : IRequest<CompanySettingsDto>;

internal sealed class UpdateCompanySettingsHandler(ICompanySettingsStore store, ICompanyProfile profile, IUnitOfWork unitOfWork)
    : IRequestHandler<UpdateCompanySettingsCommand, CompanySettingsDto>
{
    public async Task<CompanySettingsDto> Handle(UpdateCompanySettingsCommand request, CancellationToken cancellationToken)
    {
        var s = request.Settings;
        var settings = await CompanySettingsRow.GetOrMakeAsync(store, profile, cancellationToken);
        settings.Update(s.Name, s.CurrencySymbol ?? string.Empty, s.CurrencyPosition, s.Country, s.TimeZoneId, s.WorkdayStartsAtHour, request.StaffName);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        profile.Set(CompanyProfile.From(settings));
        return CompanySettingsDto.From(profile.Current);
    }
}

// The logo (شعار الشركة): a PNG, JPEG or WebP of up to a megabyte, checked by its first bytes,
// replacing the one there was. A manager's.
public sealed record UploadCompanyLogoCommand(string FileName, string ContentType, byte[] Content, string StaffName) : IRequest<CompanySettingsDto>;

internal sealed class UploadCompanyLogoHandler(ICompanySettingsStore store, ICompanyProfile profile, IUnitOfWork unitOfWork)
    : IRequestHandler<UploadCompanyLogoCommand, CompanySettingsDto>
{
    public async Task<CompanySettingsDto> Handle(UploadCompanyLogoCommand request, CancellationToken cancellationToken)
    {
        var settings = await CompanySettingsRow.GetOrMakeAsync(store, profile, cancellationToken);
        if (CompanySettings.LogoTypes.Contains(request.ContentType) && !UploadedFile.LooksLike(request.ContentType, request.Content))
            throw new DomainException("That file is not the picture it says it is.");
        settings.AttachLogo(request.FileName, request.ContentType, request.Content.Length, request.StaffName);
        await store.PutLogoAsync(request.Content, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        profile.Set(CompanyProfile.From(settings));
        return CompanySettingsDto.From(profile.Current);
    }
}

public sealed record RemoveCompanyLogoCommand(string StaffName) : IRequest<CompanySettingsDto>;

internal sealed class RemoveCompanyLogoHandler(ICompanySettingsStore store, ICompanyProfile profile, IUnitOfWork unitOfWork)
    : IRequestHandler<RemoveCompanyLogoCommand, CompanySettingsDto>
{
    public async Task<CompanySettingsDto> Handle(RemoveCompanyLogoCommand request, CancellationToken cancellationToken)
    {
        var settings = await CompanySettingsRow.GetOrMakeAsync(store, profile, cancellationToken);
        settings.RemoveLogo(request.StaffName);
        await store.PutLogoAsync(null, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        profile.Set(CompanyProfile.From(settings));
        return CompanySettingsDto.From(profile.Current);
    }
}

public sealed record CompanyLogoFile(string FileName, string ContentType, byte[] Content);

public sealed record GetCompanyLogoQuery : IRequest<CompanyLogoFile?>;

internal sealed class GetCompanyLogoHandler(ICompanySettingsStore store) : IRequestHandler<GetCompanyLogoQuery, CompanyLogoFile?>
{
    public async Task<CompanyLogoFile?> Handle(GetCompanyLogoQuery request, CancellationToken cancellationToken)
    {
        if (await store.GetAsync(cancellationToken) is not { HasLogo: true } settings)
            return null;
        return await store.GetLogoAsync(cancellationToken) is { } content
            ? new CompanyLogoFile(settings.LogoFileName!, settings.LogoContentType!, content)
            : null;
    }
}

// Made at start-up from the configuration's Company section (CompanyProfile's first values); the
// database's once it is there.
public sealed record EnsureCompanySettingsCommand : IRequest<CompanyProfile>;

internal sealed class EnsureCompanySettingsHandler(ICompanySettingsStore store, ICompanyProfile profile, IUnitOfWork unitOfWork)
    : IRequestHandler<EnsureCompanySettingsCommand, CompanyProfile>
{
    public async Task<CompanyProfile> Handle(EnsureCompanySettingsCommand request, CancellationToken cancellationToken)
    {
        var settings = await CompanySettingsRow.GetOrMakeAsync(store, profile, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        profile.Set(CompanyProfile.From(settings));
        return profile.Current;
    }
}

internal static class CompanySettingsRow
{
    // The row, or one made from the profile as it stands (the configuration's values).
    public static async Task<CompanySettings> GetOrMakeAsync(ICompanySettingsStore store, ICompanyProfile profile, CancellationToken cancellationToken)
    {
        if (await store.GetAsync(cancellationToken) is { } settings)
            return settings;
        var p = profile.Current;
        settings = new CompanySettings(p.Name, p.Money.Symbol, p.Money.Position, p.Country, p.TimeZoneId, p.WorkdayStartsAtHour);
        store.Add(settings);
        return settings;
    }
}
```


> 📄 **`backend/src/Costing.Api/Controllers/SettingsController.cs`** — 61 سطر

```csharp
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Costing.Api.Auth;
using Costing.Application.Company;
using Costing.Domain.Access;
using Costing.Domain.Company;

namespace Costing.Api.Controllers;

// Company Settings (إعدادات الشركة). Read by anyone, signed in or not: the sign-in page shows the
// company's name and logo before anyone signs in, and nothing here is a secret.
// Changed by a manager (settings.manage).
[ApiController]
[Route("api/settings")]
public sealed class SettingsController(ISender sender) : ControllerBase
{
    [HttpGet]
    [AllowAnonymous]
    public Task<CompanySettingsDto> Get(CancellationToken cancellationToken) => sender.Send(new GetCompanySettingsQuery(), cancellationToken);

    // The time zone moves which business day new sales, takings and entries fall on from now on;
    // what is recorded already stays on its day.
    [HttpPut]
    [Authorize(Policy = Permissions.SettingsManage)]
    public Task<CompanySettingsDto> Update(CompanySettingsInput request, CancellationToken cancellationToken) =>
        sender.Send(new UpdateCompanySettingsCommand(request, StaffName), cancellationToken);

    [HttpGet("logo")]
    [AllowAnonymous]
    public async Task<IActionResult> GetLogo(CancellationToken cancellationToken)
    {
        if (await sender.Send(new GetCompanyLogoQuery(), cancellationToken) is not { } logo)
            return NotFound();
        Response.Headers.XContentTypeOptions = "nosniff";
        // Asked for by its version (?v=), so a new logo is a new address.
        Response.Headers.CacheControl = "public, max-age=86400";
        return File(logo.Content, logo.ContentType);
    }

    // A PNG, JPEG or WebP of up to a megabyte, replacing the one there was.
    [HttpPut("logo")]
    [Authorize(Policy = Permissions.SettingsManage)]
    [RequestSizeLimit(CompanySettings.MaxLogoBytes + 64 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = CompanySettings.MaxLogoBytes + 64 * 1024)]
    public async Task<ActionResult<CompanySettingsDto>> UploadLogo(IFormFile file, CancellationToken cancellationToken)
    {
        if (file.Length > CompanySettings.MaxLogoBytes)
            return UnprocessableEntity(new { errors = new[] { "A logo is a megabyte at most: save a smaller picture." } });
        using var content = new MemoryStream();
        await file.CopyToAsync(content, cancellationToken);
        return await sender.Send(new UploadCompanyLogoCommand(file.FileName, file.ContentType, content.ToArray(), StaffName), cancellationToken);
    }

    [HttpDelete("logo")]
    [Authorize(Policy = Permissions.SettingsManage)]
    public Task<CompanySettingsDto> RemoveLogo(CancellationToken cancellationToken) =>
        sender.Send(new RemoveCompanyLogoCommand(StaffName), cancellationToken);

    private string StaffName => User.FindFirst(UserClaims.Name)?.Value ?? string.Empty;
}
```


## 7. شجرة المستودع

```text
Costing/
    .dockerignore
    .gitignore
    Costing.slnx
    Dockerfile
    README.md
    backend/
        src/
            Costing.Api/
                Auth/
                    AuthOptions.cs
                    AuthenticationSetup.cs
                    TabAccess.cs
                    TokenService.cs
                    UserClaims.cs
                Controllers/
                    AuthController.cs
                    CostingController.cs
                    EndOfDayController.cs
                    FinancialsController.cs
                    HrIntegrationController.cs
                    IntelligenceController.cs
                    InventoryController.cs
                    MenuSalesController.cs
                    PosIntegrationController.cs
                    SettingsController.cs
                    UsersController.cs
                Costing.Api.csproj
                ErrorHandling/
                    ApplicationExceptionHandler.cs
                Hosting/
                    DatabaseStartup.cs
                    PlatformHosting.cs
                    SpaHosting.cs
                Program.cs
                Properties/
                    launchSettings.json
                appsettings.Development.json
                appsettings.json
            Costing.Application/
                Access/
                    UserTabs.cs
                Approvals/
                    ApprovalRequests.cs
                    Deletions.cs
                Categories/
                    CategoryDeletion.cs
                    PurchaseCategories.cs
                Common/
                    CompanyProfile.cs
                    RepositoryExtensions.cs
                    SheetText.cs
                    UploadedFile.cs
                    WorkClock.cs
                Company/
                    Settings.cs
                Costing.Application.csproj
                DependencyInjection.cs
                EndOfDay/
                    EndOfDays.cs
                Expenses/
                    ExpenseItemSheet.cs
                    ExpenseItems.cs
                Integrations/
                    HrIntegration.cs
                    PosIntegration.cs
                Menu/
                    Menu.cs
                Production/
                    PrepItemImport.cs
                    PrepItems.cs
                    PrepRecipeSheet.cs
                    ProductionOrders.cs
                Purchases/
                    InvoiceCorrections.cs
                    PurchaseBatch.cs
                    PurchaseInvoices.cs
                RawMaterials/
                    MaterialUnits.cs
                    RawMaterialRepositoryExtensions.cs
                    RawMaterialSheet.cs
                    RawMaterials.cs
                    StockIntake.cs
                Recipes/
                    IngredientSheet.cs
                    RecipeCategories.cs
                    RecipeSheet.cs
                    Recipes.cs
                    RecipesToMenu.cs
                Sales/
                    DailySales.cs
                    Sales.cs
                Staff/
                    Staff.cs
                StockCounts/
                    StockCounts.cs
                Suppliers/
                    Suppliers.cs
                Treasury/
                    Treasury.cs
                Waste/
                    Breakage.cs
            Costing.Domain/
                Access/
                    CostingTabs.cs
                    Permissions.cs
                Approvals/
                    ApprovalRequest.cs
                Categories/
                    PurchaseCategory.cs
                Common/
                    AggregateRoot.cs
                    ApplicationExceptions.cs
                    DomainEvent.cs
                    DomainException.cs
                    Entity.cs
                    IRepository.cs
                    IUnitOfWork.cs
                Company/
                    CompanySettings.cs
                Costing.Domain.csproj
                EndOfDay/
                    EndOfDayReport.cs
                Expenses/
                    ExpenseItem.cs
                Integrations/
                    HrIntegration.cs
                    PosIntegration.cs
                Menu/
                    MenuItem.cs
                Production/
                    MaterialExplosion.cs
                    PrepRecipe.cs
                    ProductionOrder.cs
                    RecipeCosts.cs
                Purchases/
                    IPurchaseInvoiceRepository.cs
                    PurchaseInvoice.cs
                RawMaterials/
                    IRawMaterialRepository.cs
                    RawMaterial.cs
                    UnitOfMeasure.cs
                Recipes/
                    IRecipeRepository.cs
                    Recipe.cs
                    RecipeCategory.cs
                    RecipeIngredient.cs
                    RecipeTarget.cs
                    StockRequirements.cs
                Sales/
                    SalesReceipt.cs
                Staff/
                    PayrollRun.cs
                    StaffMember.cs
                StockCounts/
                    IStockCountRepository.cs
                    StockCount.cs
                StockMovements/
                    IStockMovementRepository.cs
                    StockMovement.cs
                    StockMovementReason.cs
                Suppliers/
                    Supplier.cs
                Treasury/
                    SafeTransaction.cs
                    SupplierLedgerEntry.cs
                Waste/
                    BreakageEntry.cs
                    IBreakageEntryRepository.cs
            Costing.Infrastructure/
                Common/
                    WorkClock.cs
                Company/
                    CompanySettingsStore.cs
                Costing.Infrastructure.csproj
                DependencyInjection.cs
                Excel/
                    ExpenseItemWorkbook.cs
                    MenuSalesWorkbooks.cs
                    PrepItemWorkbook.cs
                    RawMaterialWorkbook.cs
                    RecipeWorkbooks.cs
                    ReportWorkbook.cs
                    SheetBook.cs
                Identity/
                    Users.cs
                Integrations/
                    HrIntegrationServices.cs
                Persistence/
                    Configurations/
                        EndOfDayConfigurations.cs
                        InventoryConfigurations.cs
                        MenuSalesConfigurations.cs
                        PropertyBuilderExtensions.cs
                    CostingDbContext.cs
                    CostingDbContextFactory.cs
                    DatabaseConnection.cs
                    EndOfDayRepositories.cs
                    HrIntegrationPersistence.cs
                    InventoryRepositories.cs
                    ItemConversions.cs
                    MaterialUnits.cs
                    MenuSalesRepositories.cs
                    Migrations/
                        20261101184148_InitialCreate.cs
                        20261102193702_AddStockCountKind.cs
                        20261102203200_AddTakingsBreakdown.cs
                        20261103120817_AddPurchaseDiscounts.cs
                        20261103153917_UnifySafeTakings.cs
                        20261104214140_AddEndOfDay.cs
                        20261110093114_AddPosIntegration.cs
                        20261110170004_AddEndOfDayPayouts.cs
                        20261110175322_AddHrIntegration.cs
                        CostingDbContextModelSnapshot.cs
                    PosIntegrationPersistence.cs
                    RetryOnConflictBehavior.cs
                Reports/
                    BreakEvenService.cs
                    CostingService.MenuEngineering.cs
                    CostingService.cs
                    CostingTables.cs
                    IntelligenceService.cs
                    KpiService.cs
                    PurchaseSpendingService.cs
                    SalesLedger.cs
                    StockCardService.cs
                    TreasuryService.cs
                    VarianceService.cs
        tests/
            Costing.Api.Tests/
                Costing.Api.Tests.csproj
                CostingApiTests.cs
                HrIntegrationApiTests.cs
                PosIntegrationApiTests.cs
                SettingsApiTests.cs
                TestApi.cs
            Costing.Application.Tests/
                CompanySettingsFlowTests.cs
                Costing.Application.Tests.csproj
                EndOfDayPayoutTests.cs
                EndOfDayTests.cs
                ExpenseItemImportTests.cs
                HrIntegrationTests.cs
                InventoryTests.cs
                MenuSalesFlowTests.cs
                OpeningStockTests.cs
                PrepItemImportTests.cs
                PrepRecipeSheetTests.cs
                RawMaterialImportTests.cs
                RecipeSheetTests.cs
                RecipesToMenuTests.cs
                TestCosting.cs
                TreasuryTests.cs
            Costing.Domain.Tests/
                ApprovalTests.cs
                CompanySettingsTests.cs
                Costing.Domain.Tests.csproj
                CostingTests.cs
                EndOfDayTests.cs
                MaterialExplosionTests.cs
                MenuSalesTests.cs
                ProductionTests.cs
                PurchaseInvoiceTests.cs
                RecipeCostsTests.cs
                RecipeTests.cs
                StockCountTests.cs
                StockRequirementsTests.cs
                SupplierTests.cs
                TreasuryTests.cs
            Costing.Infrastructure.Tests/
                Costing.Infrastructure.Tests.csproj
                CostingTests.cs
                DatabaseConnectionTests.cs
                DatabaseTests.cs
                IntelligenceTests.cs
                PosIntegrationTests.cs
                TestSystem.cs
                Till.cs
                WorkClockTests.cs
                WorkbookTests.cs
    dev/
        docker-compose.yml
    docs/
        company-settings.md
        costing-and-financials.md
        deploy-railway.md
    frontend/
        angular.json
        package-lock.json
        package.json
        proxy.conf.json
        public/
            favicon.ico
        scripts/
            build.mjs
        src/
            app/
                app.config.ts
                app.routes.ts
                app.ts
                core/
                    api/
                        models.ts
                    auth/
                        auth.service.ts
                        can.directive.spec.ts
                        can.directive.ts
                        guards.spec.ts
                        guards.ts
                        permissions.ts
                    connectivity/
                        connectivity.service.spec.ts
                        connectivity.service.ts
                    costing/
                        costing-tabs.ts
                        costing.api.ts
                        employee-picker.ts
                        end-of-day.api.ts
                        hr-staff.api.ts
                        intelligence.api.ts
                        menu-sales.api.ts
                        staff.ts
                    http/
                        error-message.spec.ts
                        error-message.ts
                        interceptors.ts
                    settings/
                        company.spec.ts
                        company.ts
                        hr-integration.ts
                        pos-integration.ts
                    ui/
                        form-checks.ts
                        money.pipe.ts
                        notify.service.ts
                        paper-preview.spec.ts
                        paper-preview.ts
                        save-blob.ts
                        western-digits.spec.ts
                        western-digits.ts
                    users/
                        users.api.ts
                features/
                    account/
                        account-page.spec.ts
                        account-page.ts
                    costing/
                        abc-page.ts
                        add-to-menu-dialog.spec.ts
                        add-to-menu-dialog.ts
                        advance-fields.ts
                        advances-page.spec.ts
                        advances-page.ts
                        approval-changes.ts
                        approvals-page.spec.ts
                        approvals-page.ts
                        approvals.spec.ts
                        approvals.ts
                        break-even-page.spec.ts
                        break-even-page.ts
                        category-delete-dialog.spec.ts
                        category-delete-dialog.ts
                        category-filters.spec.ts
                        consumption-page.ts
                        costing-navigation.spec.ts
                        costing-reports-shell.ts
                        costing-shell.ts
                        costing.scss
                        count-sheet-page.spec.ts
                        count-sheet-page.ts
                        counts-page.spec.ts
                        counts-page.ts
                        daily-cash-page.spec.ts
                        daily-cash-page.ts
                        daily-sales-dialogs.spec.ts
                        daily-sales-dialogs.ts
                        end-of-day-page.ts
                        end-of-day-payouts.ts
                        end-of-day-photo.ts
                        end-of-day.spec.ts
                        expense-item-dialog.ts
                        expense-items-page.spec.ts
                        expense-items-page.ts
                        expense-vouchers-page.ts
                        financials-shell.ts
                        financials.spec.ts
                        financials.ts
                        form-checks.ts
                        funding-page.spec.ts
                        funding-page.ts
                        info-tip.spec.ts
                        info-tip.ts
                        info-tips.ts
                        intelligence-shell.ts
                        intelligence.spec.ts
                        invoice-lines.spec.ts
                        invoice-lines.ts
                        invoice-page.spec.ts
                        invoice-page.ts
                        invoice-paper.spec.ts
                        invoice-paper.ts
                        invoice-view-dialog.ts
                        invoice-view.ts
                        invoices-page.spec.ts
                        invoices-page.ts
                        kpis-page.spec.ts
                        kpis-page.ts
                        material-dialog.spec.ts
                        material-dialog.ts
                        material-history-dialog.spec.ts
                        material-history-dialog.ts
                        material-picker.ts
                        materials-page.spec.ts
                        materials-page.ts
                        menu-engineering-page.ts
                        menu-page.spec.ts
                        menu-page.ts
                        order-planner-page.ts
                        payroll-page.spec.ts
                        payroll-page.ts
                        period-bar.ts
                        permissions-page.spec.ts
                        permissions-page.ts
                        prep-import-dialog.ts
                        prep-import.spec.ts
                        prep-item-page.spec.ts
                        prep-item-page.ts
                        prep-items-page.spec.ts
                        prep-items-page.ts
                        price-variance-page.ts
                        production-order-dialog.ts
                        production-page.spec.ts
                        production-page.ts
                        purchase-batch-page.spec.ts
                        purchase-batch-page.ts
                        purchase-categories-page.spec.ts
                        purchase-categories-page.ts
                        purchase-category-dialog.spec.ts
                        purchase-category-dialog.ts
                        purchase-category-field.ts
                        purchases-page.spec.ts
                        purchases-page.ts
                        purchases-shell.ts
                        quick-material-dialog.spec.ts
                        quick-material-dialog.ts
                        recipe-card-page.spec.ts
                        recipe-card-page.ts
                        recipe-categories-page.spec.ts
                        recipe-categories-page.ts
                        recipe-category-dialog.spec.ts
                        recipe-category-dialog.ts
                        recipe-sheet-rules.ts
                        recipes-page.spec.ts
                        recipes-page.ts
                        recipes-shell.ts
                        reconciliation-page.spec.ts
                        reconciliation-page.ts
                        safe-page.spec.ts
                        safe-page.ts
                        sales-page.spec.ts
                        sales-page.ts
                        settings-page.ts
                        sheet-import-dialog.spec.ts
                        sheet-import-dialog.ts
                        spending-page.spec.ts
                        spending-page.ts
                        spending-pie.spec.ts
                        spending-pie.ts
                        staff-page.spec.ts
                        staff-page.ts
                        stock-card-dialog.spec.ts
                        stock-card-dialog.ts
                        supplier-debts-page.spec.ts
                        supplier-debts-page.ts
                        supplier-dialog.spec.ts
                        supplier-dialog.ts
                        supplier-payment-fields.ts
                        supplier-payments-page.ts
                        suppliers-page.spec.ts
                        suppliers-page.ts
                        takings-badges.ts
                        tax-service-page.spec.ts
                        tax-service-page.ts
                        theoretical-page.spec.ts
                        theoretical-page.ts
                        treasury-page.spec.ts
                        treasury-page.ts
                        variance-page.spec.ts
                        variance-page.ts
                        waste-page.ts
                    settings/
                        hr-integration-page.spec.ts
                        hr-integration-page.ts
                        pos-integration-page.spec.ts
                        pos-integration-page.ts
                        settings-page.spec.ts
                        settings-page.ts
                        settings-tabs.ts
                    shared/
                        filter-select.spec.ts
                        filter-select.ts
                        grid-keys.ts
                        item-picker.ts
                        pages.scss
                        pick-row.ts
                        search-field.ts
                        shared-ui.spec.ts
                        side-layout.ts
                        smart-search.spec.ts
                        smart-search.ts
                        sort-control.ts
                        sub-nav.ts
                    shell/
                        shell.html
                        shell.scss
                        shell.spec.ts
                        shell.ts
                    sign-in/
                        sign-in-page.html
                        sign-in-page.scss
                        sign-in-page.spec.ts
                        sign-in-page.ts
                    users/
                        user-dialogs.ts
                        users-page.spec.ts
                        users-page.ts
            index.html
            main.ts
            styles.scss
            testing/
                fixtures.ts
        tsconfig.app.json
        tsconfig.json
        tsconfig.spec.json
        vitest.config.ts
    global.json
    railway.json
    scripts/
        masterclass/
            build.py
            chapters/
                00-index-and-build-roadmap.md
                01-mindset-architecture-and-setup.md
                02-database-schema-and-entities.md
                03-auth-permissions-and-approvals.md
                04-catalog-materials-recipes-and-menu.md
                05-purchases-end-of-day-and-inventory.md
                06-financials-safe-tax-and-intelligence.md
                07-excel-engines-and-ecosystem-links.md
                08-frontend-core-and-operations-screens.md
                09-frontend-financials-reports-and-deployment.md
```


[الفصل التالي: قاعدة البيانات والكيانات →](02-database-schema-and-entities.md)
