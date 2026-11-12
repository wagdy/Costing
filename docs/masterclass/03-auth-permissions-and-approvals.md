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

> 📄 **`backend/src/Costing.Domain/Access/Permissions.cs`** — 60 سطر

```csharp
namespace Costing.Domain.Access;

// The system's users, by what they do:
// - a manager does everything, decides what the others ask, and gives each their tabs;
// - an accountant keeps the purchases, suppliers, the safe and the reports;
// - a cost controller keeps the recipes, the menu's costs, the sales and the reports;
// - a storekeeper keeps the stock: what comes in, what is counted, made and wasted.
// Each works the tabs a manager gives them (CostingTabs), their role's until then; what only a
// manager does (deletes, prep items, production, safe entries, corrections) waits for a manager's
// approval.
public enum UserRole
{
    Manager = 1,
    Accountant = 2,
    CostController = 3,
    Storekeeper = 4,
}

// What a user may do, as the API's policies and the app's buttons read it.
public static class Permissions
{
    // Stock, materials, suppliers and the menu, seen.
    public const string InventoryView = "inventory.view";

    // Entered and changed: what a manager decides is asked of one.
    public const string InventoryManage = "inventory.manage";

    // The costs: recipe cards, the reports, the safe.
    public const string CostingView = "costing.view";

    // A manager's: approving and rejecting requests, and what only a manager does.
    public const string ApprovalDecide = "approval.decide";

    // The system's users: added, changed, deactivated, their passwords reset, their tabs given.
    public const string UsersManage = "users.manage";

    // Company Settings: the name and logo, the currency, the country, the time zone, the tax.
    public const string SettingsManage = "settings.manage";

    public static IReadOnlyList<string> All { get; } = [InventoryView, InventoryManage, CostingView, ApprovalDecide, UsersManage, SettingsManage];
}

// What each role may do. Fail closed: a role missing here gets nothing.
public static class RolePermissions
{
    private static readonly IReadOnlySet<string> None = new HashSet<string>();

    private static readonly IReadOnlyDictionary<UserRole, IReadOnlySet<string>> ByRole =
        new Dictionary<UserRole, IReadOnlySet<string>>
        {
            [UserRole.Manager] = new HashSet<string>(Permissions.All),
            [UserRole.Accountant] = new HashSet<string> { Permissions.InventoryView, Permissions.InventoryManage, Permissions.CostingView },
            [UserRole.CostController] = new HashSet<string> { Permissions.InventoryView, Permissions.InventoryManage, Permissions.CostingView },
            [UserRole.Storekeeper] = new HashSet<string> { Permissions.InventoryView, Permissions.InventoryManage },
        };

    public static IReadOnlySet<string> For(UserRole role) => ByRole.TryGetValue(role, out var permissions) ? permissions : None;

    public static bool Has(UserRole role, string permission) => For(role).Contains(permission);
}
```


### 2.1 الأقسام الديناميكية: `CostingTabs`

- `[Flags] enum CostingTabs`: 14 قسمًا، بت لكل قسم (`Materials = 1`, `ExpenseItems = 2`, `Purchases = 4`, … `EndOfDay = 8192`). حقل واحد يحمل أي مجموعة أقسام، ويُخزن **بالاسم** (`"Materials, Purchases"`).
- `CostingTabSet.DefaultFor(role)`: أقسام كل دور افتراضيًا (الجدول أعلاه).
- `UserTabAccess`: إذا "علّم" المدير أقسام مستخدم معين، تصبح **هي فقط** أقسامه. بدونها: أقسام دوره.

والمدير يحصل دائمًا على `CostingTabs.All` (كل الأقسام الأربعة عشر) في `TabCaller` بغض النظر عن أي تخصيص. و `CostingTabSet.Each` ترتيب عرض الأقسام في الواجهة.

> 📄 **`backend/src/Costing.Domain/Access/CostingTabs.cs`** — 130 سطر

```csharp
using Costing.Domain.Common;

namespace Costing.Domain.Access;

// The sections of Costing & Financials (التكاليف والماليات), one bit each: what a user sees and
// works. A manager holds them all, always. Kept by name, "Materials, Purchases"; sent and read as
// a list of names, ["Materials", "Purchases"].
[Flags]
public enum CostingTabs
{
    None = 0,

    // Raw materials: their units, prices, stock and history.
    Materials = 1,

    // General expense items, what the safe's vouchers and invoices are filed under.
    ExpenseItems = 1 << 1,

    // Purchase invoices, the daily batch, suppliers and purchase categories.
    Purchases = 1 << 2,

    // The safe, funding, reconciliation, daily cash, expense vouchers, supplier debts and payments,
    // advances and salaries, tax and service.
    Financials = 1 << 3,

    // Waste (spoilage and breakage).
    Waste = 1 << 4,

    // Stock counts.
    Counts = 1 << 5,

    // Recipes, prep items and recipe categories.
    Recipes = 1 << 6,

    // Production orders: prep items made from their batch recipes.
    Production = 1 << 7,

    // The menu: items, sizes, add-ons and categories, what recipes sell by.
    Menu = 1 << 8,

    // Sales: receipts entered or imported, which take stock by recipe.
    Sales = 1 << 9,

    // Spending, theoretical cost, variance, KPIs and break-even.
    Reports = 1 << 10,

    // The cost targets, beverage categories, shared costs and monthly expenses.
    CostSettings = 1 << 11,

    // Material & demand intelligence: purchase price variance and what it does to the recipes, the
    // order planner, theoretical against actual consumption, ABC and days on hand.
    Intelligence = 1 << 12,

    // The end of the day (تقفيل اليوم): the day's invoices photographed, cash and on credit, and its
    // sales report, handed in for the daily batch and the takings. Alone, it is a branch's only page.
    EndOfDay = 1 << 13,

    All = Materials | ExpenseItems | Purchases | Financials | Waste | Counts | Recipes | Production | Menu | Sales | Reports | CostSettings
        | Intelligence | EndOfDay,
}

public static class CostingTabSet
{
    // In the order the sections are shown.
    public static readonly IReadOnlyList<CostingTabs> Each =
    [
        CostingTabs.Materials, CostingTabs.Recipes, CostingTabs.Production, CostingTabs.Menu, CostingTabs.Intelligence, CostingTabs.Sales,
        CostingTabs.EndOfDay, CostingTabs.Purchases,
        CostingTabs.ExpenseItems, CostingTabs.Counts, CostingTabs.Waste, CostingTabs.Financials, CostingTabs.Reports, CostingTabs.CostSettings,
    ];

    // Each tab on its own, for the API: ["Materials", "Purchases"].
    public static IReadOnlyList<CostingTabs> Split(CostingTabs tabs) => Each.Where(t => tabs.HasFlag(t)).ToList();

    // The tabs named, any not a tab left out.
    public static CostingTabs Join(IEnumerable<CostingTabs>? tabs) => (tabs ?? []).Aggregate(CostingTabs.None, (all, t) => all | t) & CostingTabs.All;

    public static bool HasAny(this CostingTabs held, CostingTabs anyOf) => (held & anyOf) != CostingTabs.None;

    // What each role works until a manager ticks theirs.
    public static CostingTabs DefaultFor(UserRole role) => role switch
    {
        UserRole.Manager => CostingTabs.All,
        UserRole.Accountant => CostingTabs.Materials | CostingTabs.ExpenseItems | CostingTabs.Purchases | CostingTabs.Financials | CostingTabs.Sales
            | CostingTabs.Reports | CostingTabs.Intelligence | CostingTabs.EndOfDay,
        UserRole.CostController => CostingTabs.Materials | CostingTabs.Recipes | CostingTabs.Production | CostingTabs.Menu | CostingTabs.Sales
            | CostingTabs.Counts | CostingTabs.Waste | CostingTabs.Reports | CostingTabs.CostSettings | CostingTabs.Intelligence,
        UserRole.Storekeeper => CostingTabs.Materials | CostingTabs.Purchases | CostingTabs.Counts | CostingTabs.Waste | CostingTabs.Production
            | CostingTabs.EndOfDay,
        _ => CostingTabs.None,
    };
}

// The tabs a manager ticked for a user who is not a manager, by the user's id. None for a user:
// their role's (CostingTabSet.DefaultFor); once a manager ticks theirs, only those.
public sealed class UserTabAccess : AggregateRoot
{
    public const int MaxUserIdLength = 450;

    private UserTabAccess() { }

    public UserTabAccess(string userId, CostingTabs tabs, string setBy)
    {
        if (string.IsNullOrWhiteSpace(userId))
            throw new DomainException("Say whose tabs these are.");
        UserId = userId.Trim();
        Set(tabs, setBy);
    }

    public string UserId { get; private set; } = string.Empty;
    public CostingTabs Tabs { get; private set; }
    public string SetBy { get; private set; } = string.Empty;
    public DateTime SetAtUtc { get; private set; }

    public void Set(CostingTabs tabs, string setBy)
    {
        Tabs = tabs & CostingTabs.All;
        SetBy = setBy;
        SetAtUtc = DateTime.UtcNow;
    }
}

public interface IUserTabAccessRepository : IRepository<UserTabAccess>
{
    Task<UserTabAccess?> GetByUserAsync(string userId, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<UserTabAccess>> GetAllAsync(CancellationToken cancellationToken = default);

    void Remove(UserTabAccess access);
}
```


### 2.2 إخفاء التكاليف عن أمين المخزن: الحقيقة كما هي في الكود

التصميم المقصود: صلاحية `costing.view` تفصل "رؤية التكاليف" عن "إدخال الكميات"، وأمين المخزن **لا يملكها** في `RolePermissions`. وتعليق `RawMaterialDto` يقول إن قائمة الخامات العامة بلا تكاليف.

**لكن بأمانة:** `Permissions.CostingView` **معرّفة ولا يفرضها أي endpoint حاليًا** (لا يوجد `[Authorize(Policy = Permissions.CostingView)]` في أي Controller، ولا تستخدمها الواجهة لإخفاء شيء). الحماية الفعلية اليوم هي **الأقسام**: أمين المخزن لا يملك افتراضيًا أقسام الوصفات والتقارير والتحليلات والماليات وإعدادات التكلفة، فلا يصل لشاشاتها ولا لنقاط نهايتها. لكن ما في قسم الخامات والمشتريات (مثل متوسط تكلفة الخامة وأسعار الفاتورة) يبقى مرئيًا له.

**كيف تُكمل الفجوة (تمرين مهم):** ضع `[Authorize(Policy = Permissions.CostingView)]` على نقاط التكلفة في `CostingController`، واجعل DTOs الخامات تُرسل التكلفة `null` لمن لا يملكها (فلتر استجابة كما يفعل نظام HR في `HrPrivacyFilter`)، وأخفِ أعمدة التكلفة في الواجهة بـ `*appCan="Permissions.CostingView"`، ثم اكتب اختبار API يتأكد أن أمين المخزن يتلقى `null`.

## 3. المصادقة: JWT

### 3.1 الخيارات والـ Claims والتوكن

`AuthOptions`: `SigningKey` (32 بايت على الأقل؛ "من يملكه يستطيع الدخول باسم أي أحد")، عمر التوكن، وأول مدير. `UserClaims`: أسماء قصيرة (`sub`, `name`, `role`, `pwd_set`). `TokenService`: HMAC-SHA256، Issuer/Audience = `costing`، ووقت ضبط كلمة المرور داخل التوكن.

> 📄 **`backend/src/Costing.Api/Auth/AuthOptions.cs`** — 27 سطر

```csharp
namespace Costing.Api.Auth;

public sealed class AuthOptions
{
    public const string Section = "Auth";

    // HMAC key for signing tokens; at least 32 bytes. Generate one per installation, for example
    // `openssl rand -base64 48`. Anyone who has it can sign in as anyone.
    public string SigningKey { get; set; } = string.Empty;

    // A working day. A deactivated user, a new role or a new password is refused at once
    // regardless (see AuthenticationSetup), so this is about how often people sign in again.
    public int TokenLifetimeHours { get; set; } = 12;

    public FirstManagerOptions FirstManager { get; set; } = new();
}

// Creates the first manager when there is no user yet; see UserDirectory.EnsureFirstManagerAsync.
// Take the password out of the configuration once it has.
public sealed class FirstManagerOptions
{
    public string? Email { get; set; }

    public string? Name { get; set; }

    public string? Password { get; set; }
}
```


> 📄 **`backend/src/Costing.Api/Auth/UserClaims.cs`** — 30 سطر

```csharp
using System.Globalization;
using System.Security.Claims;
using Costing.Domain.Access;

namespace Costing.Api.Auth;

// What a user's token says about who holds it: their user id, name and role, and when their
// password was set, so a new one signs them out at once.
//
// Short claim names, read back as they are: AuthenticationSetup turns off the inbound mapping
// that would otherwise rename them to long XML-namespace claim types.
public static class UserClaims
{
    public const string Id = "sub";
    public const string Name = "name";
    public const string Role = "role";
    public const string PasswordSetAt = "pwd_set";

    public static string? IdOf(ClaimsPrincipal user) => user.FindFirstValue(Id);

    public static string NameOf(ClaimsPrincipal user) => user.FindFirstValue(Name) ?? string.Empty;

    // Null for anything but a role name this build knows. A number is refused too, though
    // Enum.TryParse would take it.
    public static UserRole? RoleOf(ClaimsPrincipal user) =>
        user.FindFirstValue(Role) is { } value && Enum.GetNames<UserRole>().Contains(value) ? Enum.Parse<UserRole>(value) : null;

    public static long? PasswordSetAtOf(ClaimsPrincipal user) =>
        long.TryParse(user.FindFirstValue(PasswordSetAt), NumberStyles.None, CultureInfo.InvariantCulture, out var ticks) ? ticks : null;
}
```


> 📄 **`backend/src/Costing.Api/Auth/TokenService.cs`** — 43 سطر

```csharp
using System.Globalization;
using System.Security.Claims;
using System.Text;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Costing.Domain.Access;
using Costing.Infrastructure.Identity;

namespace Costing.Api.Auth;

public sealed class TokenService(IOptions<AuthOptions> options, TimeProvider time)
{
    public const string Issuer = "costing";
    public const string Audience = "costing";

    private static readonly JsonWebTokenHandler Handler = new();

    // A user's: their id, name and role, and when their password was set.
    public (string Token, DateTime ExpiresAtUtc) Issue(UserAccount user) => Create(
    [
        new Claim(UserClaims.Id, user.Id),
        new Claim(UserClaims.Name, user.FullName),
        new Claim(UserClaims.Role, user.Role.ToString()),
        new Claim(UserClaims.PasswordSetAt, user.PasswordSetAtUtc.Ticks.ToString(CultureInfo.InvariantCulture)),
    ]);

    private (string Token, DateTime ExpiresAtUtc) Create(IReadOnlyList<Claim> claims)
    {
        var expiresAtUtc = time.GetUtcNow().UtcDateTime.AddHours(options.Value.TokenLifetimeHours);
        var token = Handler.CreateToken(new SecurityTokenDescriptor
        {
            Issuer = Issuer,
            Audience = Audience,
            Expires = expiresAtUtc,
            Subject = new ClaimsIdentity(claims),
            SigningCredentials = new SigningCredentials(SigningKey(options.Value), SecurityAlgorithms.HmacSha256),
        });
        return (token, expiresAtUtc);
    }

    public static SymmetricSecurityKey SigningKey(AuthOptions options) => new(Encoding.UTF8.GetBytes(options.SigningKey));
}
```


### 3.2 `AuthenticationSetup`: سطرًا سطرًا

1. **مفتاح أقل من 32 بايت ⇐ التطبيق لا يبدأ.** الفشل المبكر أفضل من توكنات قابلة للتزوير.
2. `AddJwtBearer` مع `MapInboundClaims = false` و `TokenValidationParameters` (الجهة، الجمهور، المفتاح، سماحية دقيقة).
3. **`OnTokenValidated`**: بعد التحقق من التوقيع، اسأل `UserDirectory`: هل المستخدم ما زال نشطًا؟ بنفس الدور؟ بنفس وقت كلمة المرور (بدقة الميكروثانية: `Ticks / 10`)؟ وإلا 401. هكذا **تعطيل مستخدم أو تغيير دوره أو كلمة مروره يسري فورًا**، لا بعد انتهاء التوكن.
4. **السياسة الافتراضية والاحتياطية = "مستخدم مسجّل"**: أي endpoint نُسي عليه `[Authorize]` مغلق تلقائيًا (Secure by Default).
5. سياسة لكل صلاحية، تُمنح بجدول `RolePermissions` نفسه الذي تقرؤه الواجهة من `/api/auth/me`.

> 📄 **`backend/src/Costing.Api/Auth/AuthenticationSetup.cs`** — 87 سطر

```csharp
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.IdentityModel.Tokens;
using Costing.Domain.Access;
using Costing.Infrastructure.Identity;

namespace Costing.Api.Auth;

internal static class AuthenticationSetup
{
    public static IServiceCollection AddCostingAuthentication(this IServiceCollection services, IConfiguration configuration)
    {
        var section = configuration.GetSection(AuthOptions.Section);
        var options = section.Get<AuthOptions>() ?? new AuthOptions();

        // The usual floor for HS256. Failing at startup means a misconfigured machine never
        // serves at all, rather than serving forgeable tokens.
        if (Encoding.UTF8.GetByteCount(options.SigningKey) < 32)
            throw new InvalidOperationException($"{AuthOptions.Section}:SigningKey must be at least 32 bytes. Generate one with `openssl rand -base64 48`.");

        services.Configure<AuthOptions>(section);
        services.AddSingleton<TokenService>();
        services.AddHttpContextAccessor();
        services.AddScoped<TabCaller>();
        services.AddScoped<IAuthorizationHandler, CostingTabHandler>();
        services.AddSingleton<IAuthorizationPolicyProvider, CostingTabPolicyProvider>();

        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer(jwt =>
            {
                jwt.MapInboundClaims = false;
                jwt.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidIssuer = TokenService.Issuer,
                    ValidAudience = TokenService.Audience,
                    IssuerSigningKey = TokenService.SigningKey(options),
                    NameClaimType = UserClaims.Name,
                    RoleClaimType = UserClaims.Role,
                    ClockSkew = TimeSpan.FromMinutes(1),
                };

                jwt.Events = new JwtBearerEvents
                {
                    // A token alone would keep a deactivated user signed in until it ran out, and
                    // a demoted manager would keep manager rights as long. So every request also
                    // checks that the user is still active, with the role the token claims and
                    // the password it was signed in with.
                    OnTokenValidated = async context =>
                    {
                        var principal = context.Principal!;
                        var userId = UserClaims.IdOf(principal);
                        var active = userId is null
                            ? null
                            : await context.HttpContext.RequestServices.GetRequiredService<UserDirectory>()
                                .GetActiveAsync(userId, context.HttpContext.RequestAborted);

                        if (active is not { } user || user.Role != UserClaims.RoleOf(principal)
                            || user.PasswordSetAtUtc.Ticks / 10 != UserClaims.PasswordSetAtOf(principal) / 10)
                            context.Fail("This account has been deactivated, or its role or password has changed. Sign in again.");
                    },
                };
            });

        // Signed in as a user, for an endpoint that says [Authorize] and for one that forgets to
        // (the fallback), so a new endpoint is closed by default rather than open.
        var staff = new AuthorizationPolicyBuilder()
            .RequireAuthenticatedUser()
            .RequireAssertion(context => UserClaims.RoleOf(context.User) is not null)
            .Build();
        var authorization = services.AddAuthorizationBuilder()
            .SetDefaultPolicy(staff)
            .SetFallbackPolicy(staff);

        // One policy per permission, named by the permission itself:
        //   [Authorize(Policy = Permissions.UsersManage)]
        // Granted by the RolePermissions table, the one the app reads too.
        foreach (var permission in Permissions.All)
        {
            authorization.AddPolicy(permission, policy => policy
                .RequireAuthenticatedUser()
                .RequireAssertion(context => UserClaims.RoleOf(context.User) is { } role && RolePermissions.Has(role, permission)));
        }

        return services;
    }
}
```


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

> 📄 **`backend/src/Costing.Api/Auth/TabAccess.cs`** — 80 سطر

```csharp
using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Options;
using Costing.Domain.Access;

namespace Costing.Api.Auth;

// An endpoint's sections (CostingTabs): whoever holds any of them may call it.
//   [CostingTab(CostingTabs.Materials)]                          seen on Materials
//   [CostingTab(CostingTabs.Materials | CostingTabs.Recipes)]   read on either
// A change still needs its permission too (InventoryManage, ApprovalDecide), on the endpoint.
//
// A manager holds every tab. Anyone else holds those a manager ticked for them, their role's
// until then (CostingTabSet.DefaultFor).
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, AllowMultiple = true)]
public sealed class CostingTabAttribute : AuthorizeAttribute
{
    public CostingTabAttribute(CostingTabs tabs)
    {
        Tabs = tabs;
        Policy = CostingTabPolicy.Name(new CostingTabRequirement(tabs));
    }

    public CostingTabs Tabs { get; }
}

public sealed record CostingTabRequirement(CostingTabs Tabs) : IAuthorizationRequirement;

// "costing-tab:8": the tabs as their number.
public static class CostingTabPolicy
{
    private const string Prefix = "costing-tab:";

    public static string Name(CostingTabRequirement r) => Prefix + ((int)r.Tabs).ToString(CultureInfo.InvariantCulture);

    public static CostingTabRequirement? Parse(string name) =>
        name.StartsWith(Prefix, StringComparison.Ordinal)
        && int.TryParse(name[Prefix.Length..], NumberStyles.None, CultureInfo.InvariantCulture, out var tabs) && tabs != 0
            ? new CostingTabRequirement((CostingTabs)tabs & CostingTabs.All)
            : null;
}

// The tab policies made as they are asked for; every other policy as registered.
internal sealed class CostingTabPolicyProvider(IOptions<AuthorizationOptions> options) : DefaultAuthorizationPolicyProvider(options)
{
    public override async Task<AuthorizationPolicy?> GetPolicyAsync(string policyName) =>
        CostingTabPolicy.Parse(policyName) is { } requirement
            ? new AuthorizationPolicyBuilder().RequireAuthenticatedUser().AddRequirements(requirement).Build()
            : await base.GetPolicyAsync(policyName);
}

internal sealed class CostingTabHandler(TabCaller caller) : AuthorizationHandler<CostingTabRequirement>
{
    protected override async Task HandleRequirementAsync(AuthorizationHandlerContext context, CostingTabRequirement requirement)
    {
        if ((await caller.TabsAsync()).HasAny(requirement.Tabs))
            context.Succeed(requirement);
    }
}

// Who is calling, and the tabs they hold: read once a request.
public sealed class TabCaller(IHttpContextAccessor accessor, IUserTabAccessRepository access)
{
    private CostingTabs? tabs;

    private ClaimsPrincipal User => accessor.HttpContext?.User ?? new ClaimsPrincipal();

    public async Task<CostingTabs> TabsAsync(CancellationToken cancellationToken = default) => tabs ??= await ReadAsync(cancellationToken);

    private async Task<CostingTabs> ReadAsync(CancellationToken cancellationToken)
    {
        var user = User;
        if (UserClaims.RoleOf(user) is not { } role)
            return CostingTabs.None;
        if (role == UserRole.Manager)
            return CostingTabs.All;
        return UserClaims.IdOf(user) is { } id && await access.GetByUserAsync(id, cancellationToken) is { } row ? row.Tabs : CostingTabSet.DefaultFor(role);
    }
}
```


### 3.4 المستخدمون وكلمات المرور

`UserDirectory`: PBKDF2 (عبر `PasswordHasher` من ASP.NET Identity) بـ Salt عشوائي، 5 أخطاء ⇐ قفل 5 دقائق، **تحقق وهمي لبريد غير موجود** حتى لا يكشف زمن الرد وجود البريد (Timing Attack)، إعادة تشفير صامتة عند `SuccessRehashNeeded`، أول مدير من الإعدادات، و **يبقى دائمًا مدير نشط واحد** على الأقل.

> 📄 **`backend/src/Costing.Infrastructure/Identity/Users.cs`** — 214 سطر

```csharp
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.Extensions.Logging;
using Costing.Domain.Common;
using Costing.Domain.Access;
using Costing.Infrastructure.Persistence;
using Costing.Infrastructure.Persistence.Configurations;

namespace Costing.Infrastructure.Identity;

// Someone who works in this system: a manager, an accountant, a cost controller or a storekeeper,
// signing in with their email and password.
public sealed class UserAccount
{
    public const int MaxEmailLength = 256;
    public const int MaxNameLength = 200;
    public const int MinPasswordLength = 8;

    public string Id { get; set; } = string.Empty;

    public string Email { get; set; } = string.Empty;

    // Upper case, for finding an email however it is typed.
    public string NormalizedEmail { get; set; } = string.Empty;

    public string FullName { get; set; } = string.Empty;

    public UserRole Role { get; set; }

    public bool IsActive { get; set; } = true;

    public string PasswordHash { get; set; } = string.Empty;

    // When the password was last set: a new one signs them out wherever they are signed in.
    public DateTime PasswordSetAtUtc { get; set; }

    public int FailedSignInAttempts { get; set; }

    public DateTime? LockedUntilUtc { get; set; }

    public DateTime CreatedAtUtc { get; set; }

    public DateTime? LastSignInAtUtc { get; set; }
}

internal sealed class UserAccountConfiguration : IEntityTypeConfiguration<UserAccount>
{
    public void Configure(EntityTypeBuilder<UserAccount> builder)
    {
        builder.ToTable("Users", CostingDbContext.IdentitySchema);
        builder.HasKey(u => u.Id);
        builder.Property(u => u.Id).HasMaxLength(64);
        builder.Property(u => u.Email).HasMaxLength(UserAccount.MaxEmailLength);
        builder.Property(u => u.NormalizedEmail).HasMaxLength(UserAccount.MaxEmailLength);
        builder.HasIndex(u => u.NormalizedEmail).IsUnique();
        builder.Property(u => u.FullName).HasMaxLength(UserAccount.MaxNameLength);
        builder.Property(u => u.Role).IsEnumName();
        builder.Property(u => u.PasswordHash).HasMaxLength(200);
    }
}

public sealed record SignInOutcome(UserAccount? User, DateTime? LockedUntilUtc);

// Who may sign in, and with what: email and password, five misses locking the account for five
// minutes. A manager adds the users, changes their role, deactivates them and resets their
// passwords; there is always at least one active manager.
public sealed class UserDirectory(CostingDbContext db, ILogger<UserDirectory> logger)
{
    private const int MaxFailedAttempts = 5;
    private static readonly TimeSpan LockoutDuration = TimeSpan.FromMinutes(5);
    private static readonly PasswordHasher<UserAccount> Hasher = new();

    // A hash to check a password against when no user has the email, so a wrong email takes as
    // long as a wrong password and does not say which emails are known.
    private static readonly Lazy<string> Nobody = new(() => Hasher.HashPassword(new UserAccount(), Guid.NewGuid().ToString("N")));

    public async Task<IReadOnlyList<UserAccount>> GetAllAsync(CancellationToken cancellationToken) =>
        await db.Users.AsNoTracking().OrderBy(u => u.FullName).ToListAsync(cancellationToken);

    public Task<UserAccount?> GetAsync(string id, CancellationToken cancellationToken) =>
        db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.Id == id, cancellationToken);

    // Null when the user is gone or deactivated. Checked on every request, so a deactivation, a
    // new role or a new password takes effect at once rather than when a token expires.
    public async Task<(UserRole Role, DateTime PasswordSetAtUtc)?> GetActiveAsync(string id, CancellationToken cancellationToken) =>
        await db.Users.AsNoTracking()
            .Where(u => u.Id == id && u.IsActive)
            .Select(u => new { u.Role, u.PasswordSetAtUtc })
            .SingleOrDefaultAsync(cancellationToken) is { } found
            ? (found.Role, found.PasswordSetAtUtc)
            : null;

    public async Task<SignInOutcome> SignInAsync(string? email, string? password, CancellationToken cancellationToken)
    {
        var normalized = Normalize(email);
        var user = normalized.Length == 0 ? null : await db.Users.SingleOrDefaultAsync(u => u.NormalizedEmail == normalized && u.IsActive, cancellationToken);
        if (user is null)
        {
            Hasher.VerifyHashedPassword(new UserAccount(), Nobody.Value, password ?? string.Empty);
            return new SignInOutcome(null, null);
        }
        if (user.LockedUntilUtc > DateTime.UtcNow)
            return new SignInOutcome(null, user.LockedUntilUtc);

        var result = Hasher.VerifyHashedPassword(user, user.PasswordHash, password ?? string.Empty);
        if (result == PasswordVerificationResult.Failed)
        {
            if (++user.FailedSignInAttempts >= MaxFailedAttempts)
            {
                user.FailedSignInAttempts = 0;
                user.LockedUntilUtc = DateTime.UtcNow + LockoutDuration;
                logger.LogWarning("User {UserId} locked after {Attempts} wrong passwords", user.Id, MaxFailedAttempts);
            }
            await db.SaveChangesAsync(cancellationToken);
            return new SignInOutcome(null, user.LockedUntilUtc);
        }

        if (result == PasswordVerificationResult.SuccessRehashNeeded)
            user.PasswordHash = Hasher.HashPassword(user, password!);
        user.FailedSignInAttempts = 0;
        user.LockedUntilUtc = null;
        user.LastSignInAtUtc = DateTime.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        return new SignInOutcome(user, null);
    }

    public async Task<UserAccount> CreateAsync(string email, string fullName, UserRole role, string password, CancellationToken cancellationToken)
    {
        var user = new UserAccount { Id = Guid.NewGuid().ToString("N"), CreatedAtUtc = DateTime.UtcNow, IsActive = true };
        await SetDetailsAsync(user, email, fullName, role, cancellationToken);
        SetPassword(user, password);
        db.Users.Add(user);
        await db.SaveChangesAsync(cancellationToken);
        return user;
    }

    public async Task<UserAccount> UpdateAsync(string id, string email, string fullName, UserRole role, bool isActive, CancellationToken cancellationToken)
    {
        var user = await db.Users.SingleOrDefaultAsync(u => u.Id == id, cancellationToken) ?? throw new NotFoundException("User", id);
        if ((role != UserRole.Manager || !isActive) && user is { Role: UserRole.Manager, IsActive: true }
            && !await db.Users.AnyAsync(u => u.Id != id && u.IsActive && u.Role == UserRole.Manager, cancellationToken))
            throw new DomainException("This is the only active manager: make someone else a manager first.");
        await SetDetailsAsync(user, email, fullName, role, cancellationToken);
        user.IsActive = isActive;
        await db.SaveChangesAsync(cancellationToken);
        return user;
    }

    // A manager's reset, or their own change: either lifts a lockout and signs them out elsewhere.
    public async Task SetPasswordAsync(string id, string password, CancellationToken cancellationToken)
    {
        var user = await db.Users.SingleOrDefaultAsync(u => u.Id == id, cancellationToken) ?? throw new NotFoundException("User", id);
        SetPassword(user, password);
        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task ChangeOwnPasswordAsync(string id, string current, string password, CancellationToken cancellationToken)
    {
        var user = await db.Users.SingleOrDefaultAsync(u => u.Id == id, cancellationToken) ?? throw new NotFoundException("User", id);
        if (Hasher.VerifyHashedPassword(user, user.PasswordHash, current ?? string.Empty) == PasswordVerificationResult.Failed)
            throw new DomainException("Your current password is not right.");
        SetPassword(user, password);
        await db.SaveChangesAsync(cancellationToken);
    }

    // First run: with no user at all, nobody could sign in to add anyone. So the first manager
    // comes from configuration; once there is a user, the configuration is not read again, and
    // the password should be taken out of it.
    public async Task EnsureFirstManagerAsync(string? email, string? name, string? password, CancellationToken cancellationToken)
    {
        if (await db.Users.AnyAsync(cancellationToken))
            return;
        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(password))
        {
            logger.LogWarning("There is no user yet. Set Auth:FirstManager:Email, Name and Password to create the first manager.");
            return;
        }

        await CreateAsync(email, name, UserRole.Manager, password, cancellationToken);
        logger.LogWarning("Created the first manager, {Email}, from Auth:FirstManager. Take the password out of the configuration now.", email.Trim());
    }

    private async Task SetDetailsAsync(UserAccount user, string email, string fullName, UserRole role, CancellationToken cancellationToken)
    {
        var trimmed = email?.Trim() ?? string.Empty;
        if (trimmed.Length is 0 or > UserAccount.MaxEmailLength || !trimmed.Contains('@') || trimmed.StartsWith('@') || trimmed.EndsWith('@'))
            throw new DomainException("Enter their email address: name@company.com.");
        var name = fullName?.Trim() ?? string.Empty;
        if (name.Length is 0 or > UserAccount.MaxNameLength)
            throw new DomainException("Enter their full name.");
        if (!Enum.IsDefined(role))
            throw new DomainException("Choose their role: manager, accountant, cost controller or storekeeper.");
        var normalized = Normalize(trimmed);
        if (await db.Users.AnyAsync(u => u.Id != user.Id && u.NormalizedEmail == normalized, cancellationToken))
            throw new DomainException($"{trimmed} is someone else's already.");
        user.Email = trimmed;
        user.NormalizedEmail = normalized;
        user.FullName = name;
        user.Role = role;
    }

    private static void SetPassword(UserAccount user, string password)
    {
        if ((password ?? string.Empty).Length < UserAccount.MinPasswordLength)
            throw new DomainException($"A password is {UserAccount.MinPasswordLength} characters at least.");
        user.PasswordHash = Hasher.HashPassword(user, password!);
        user.PasswordSetAtUtc = DateTime.UtcNow;
        user.FailedSignInAttempts = 0;
        user.LockedUntilUtc = null;
    }

    private static string Normalize(string? email) => (email ?? string.Empty).Trim().ToUpperInvariant();
}
```


`AuthController`: `POST sign-in` (مع حد المحاولات)، `GET me` (المصدر الوحيد للدور والصلاحيات والأقسام في الواجهة)، `POST password` (تغيير كلمة المرور يسقط كل التوكنات القديمة ويعيد توكنًا جديدًا لهذه الجلسة).

> 📄 **`backend/src/Costing.Api/Controllers/AuthController.cs`** — 75 سطر

```csharp
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Costing.Api.Auth;
using Costing.Domain.Access;
using Costing.Infrastructure.Common;
using Costing.Infrastructure.Identity;

namespace Costing.Api.Controllers;

// Signing in: a user with their email and password.
[ApiController]
[Route("api/auth")]
public sealed class AuthController(UserDirectory users, TokenService tokens, BusinessCalendar clock) : ControllerBase
{
    public const string SignInRateLimit = "sign-in";

    // One answer for an email nobody has and a wrong password, so it does not say whose emails
    // are known.
    [AllowAnonymous]
    [EnableRateLimiting(SignInRateLimit)]
    [HttpPost("sign-in")]
    public async Task<ActionResult<SignInResponse>> SignIn(SignInRequest request, CancellationToken cancellationToken)
    {
        var outcome = await users.SignInAsync(request.Email, request.Password, cancellationToken);
        if (outcome.User is not { } user)
        {
            var detail = outcome.LockedUntilUtc is { } lockedUntil
                ? $"Too many wrong passwords. Try again after {clock.ToLocal(lockedUntil):HH:mm}."
                : "Wrong email or password.";
            return Problem(statusCode: StatusCodes.Status401Unauthorized, title: "Sign-in failed.", detail: detail);
        }

        var (token, expiresAtUtc) = tokens.Issue(user);
        return new SignInResponse(token, expiresAtUtc, Me.For(user.Id, user.FullName, user.Email, user.Role));
    }

    // Who is signed in, and what they may do: the permissions come from RolePermissions, so the
    // app shows and hides buttons by the same rules the API enforces. Tabs: the sections they
    // work, every one for a manager, anyone else's as a manager ticked them (their role's until then).
    [HttpGet("me")]
    public async Task<Me> GetMe([FromServices] TabCaller caller, CancellationToken cancellationToken)
    {
        var id = UserClaims.IdOf(User)!;
        var user = await users.GetAsync(id, cancellationToken);
        return Me.For(id, user?.FullName ?? User.FindFirst(UserClaims.Name)?.Value ?? string.Empty, user?.Email ?? string.Empty, UserClaims.RoleOf(User)!.Value) with
        {
            Tabs = CostingTabSet.Split(await caller.TabsAsync(cancellationToken)),
        };
    }

    // Their own password changed, with the one they have now. Signs them out elsewhere; this
    // answer brings them a new token for here.
    [HttpPost("password")]
    public async Task<SignInResponse> ChangePassword(ChangePasswordRequest request, CancellationToken cancellationToken)
    {
        var id = UserClaims.IdOf(User)!;
        await users.ChangeOwnPasswordAsync(id, request.CurrentPassword, request.NewPassword, cancellationToken);
        var user = (await users.GetAsync(id, cancellationToken))!;
        var (token, expiresAtUtc) = tokens.Issue(user);
        return new SignInResponse(token, expiresAtUtc, Me.For(user.Id, user.FullName, user.Email, user.Role));
    }
}

public sealed record SignInRequest(string? Email, string? Password);

public sealed record SignInResponse(string Token, DateTime ExpiresAtUtc, Me User);

public sealed record ChangePasswordRequest(string CurrentPassword, string NewPassword);

public sealed record Me(string Id, string FullName, string Email, UserRole Role, IReadOnlyList<string> Permissions, IReadOnlyList<CostingTabs>? Tabs = null)
{
    public static Me For(string id, string fullName, string email, UserRole role) =>
        new(id, fullName, email, role, RolePermissions.For(role).Order(StringComparer.Ordinal).ToList());
}
```


`UsersController`: إضافة، تعديل الدور والحالة، وإعادة تعيين كلمة المرور؛ للمدير فقط.

> 📄 **`backend/src/Costing.Api/Controllers/UsersController.cs`** — 51 سطر

```csharp
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Costing.Api.Auth;
using Costing.Domain.Access;
using Costing.Infrastructure.Identity;

namespace Costing.Api.Controllers;

// The system's users, a manager's: added with a first password, changed (name, email, role,
// active), and their password reset. There is always an active manager.
[ApiController]
[Route("api/users")]
[Authorize(Policy = Permissions.UsersManage)]
public sealed class UsersController(UserDirectory users) : ControllerBase
{
    [HttpGet]
    public async Task<IReadOnlyList<UserDto>> GetAll(CancellationToken cancellationToken) =>
        (await users.GetAllAsync(cancellationToken)).Select(UserDto.From).ToList();

    [HttpPost]
    public async Task<UserDto> Create(CreateUserRequest request, CancellationToken cancellationToken) =>
        UserDto.From(await users.CreateAsync(request.Email, request.FullName, request.Role, request.Password, cancellationToken));

    [HttpPut("{userId}")]
    public async Task<UserDto> Update(string userId, UpdateUserRequest request, CancellationToken cancellationToken)
    {
        if (userId == UserClaims.IdOf(User) && (!request.IsActive || request.Role != UserRole.Manager))
            throw new Costing.Domain.Common.DomainException("You cannot take your own manager's rights away: another manager does that.");
        return UserDto.From(await users.UpdateAsync(userId, request.Email, request.FullName, request.Role, request.IsActive, cancellationToken));
    }

    // Also lifts a lockout, and signs them out wherever they are signed in.
    [HttpPut("{userId}/password")]
    public async Task<IActionResult> ResetPassword(string userId, ResetPasswordRequest request, CancellationToken cancellationToken)
    {
        await users.SetPasswordAsync(userId, request.Password, cancellationToken);
        return NoContent();
    }
}

public sealed record UserDto(string Id, string Email, string FullName, UserRole Role, bool IsActive, DateTime CreatedAtUtc, DateTime? LastSignInAtUtc, bool IsLocked)
{
    public static UserDto From(UserAccount u) =>
        new(u.Id, u.Email, u.FullName, u.Role, u.IsActive, u.CreatedAtUtc, u.LastSignInAtUtc, u.LockedUntilUtc > DateTime.UtcNow);
}

public sealed record CreateUserRequest(string Email, string FullName, UserRole Role, string Password);

public sealed record UpdateUserRequest(string Email, string FullName, UserRole Role, bool IsActive);

public sealed record ResetPasswordRequest(string Password);
```


### 3.5 توزيع الأقسام: `UserTabs.cs`

`GetUserTabsQuery` (كل مستخدم: أقسامه الفعلية وهل هي "مخصصة")، و `SetUserTabsCommand` (المدير يعلّم أقسامًا أو يعيد المستخدم لأقسام دوره). نقطة النهاية `api/access` في `MenuSalesController.cs` (الفصل 04).

> 📄 **`backend/src/Costing.Application/Access/UserTabs.cs`** — 68 سطر

```csharp
using MediatR;
using Costing.Domain.Access;
using Costing.Domain.Common;

namespace Costing.Application.Access;

// Permissions (الصلاحيات): the sections of Costing & Financials each user works. A manager holds
// them all and alone gives them; everyone else works their role's (CostingTabSet.DefaultFor) until a
// manager ticks theirs, then only those.

// A system user, as the API reads them from the users.
public sealed record UserAccountRef(string Id, string Name, UserRole Role);

// Restricted once a manager has ticked their tabs; their role's until then.
public sealed record UserTabsDto(string Id, string Name, UserRole Role, bool Restricted, IReadOnlyList<CostingTabs> Tabs, string? SetBy, DateTime? SetAtUtc);

// Every user who is not a manager, by name.
public sealed record GetUserTabsQuery(IReadOnlyList<UserAccountRef> Users) : IRequest<IReadOnlyList<UserTabsDto>>;

internal sealed class GetUserTabsHandler(IUserTabAccessRepository access) : IRequestHandler<GetUserTabsQuery, IReadOnlyList<UserTabsDto>>
{
    public async Task<IReadOnlyList<UserTabsDto>> Handle(GetUserTabsQuery request, CancellationToken cancellationToken)
    {
        var rows = (await access.GetAllAsync(cancellationToken)).ToDictionary(a => a.UserId);
        return request.Users
            .Where(u => u.Role != UserRole.Manager)
            .OrderBy(u => u.Name, StringComparer.CurrentCultureIgnoreCase)
            .Select(u => UserTabsDtos.Of(u, rows.GetValueOrDefault(u.Id)))
            .ToList();
    }
}

// A user's tabs: only those from now on. Null puts them back to their role's.
public sealed record SetUserTabsCommand(UserAccountRef User, CostingTabs? Tabs, string SetBy) : IRequest<UserTabsDto>;

internal sealed class SetUserTabsHandler(IUserTabAccessRepository access, IUnitOfWork unitOfWork) : IRequestHandler<SetUserTabsCommand, UserTabsDto>
{
    public async Task<UserTabsDto> Handle(SetUserTabsCommand request, CancellationToken cancellationToken)
    {
        if (request.User.Role == UserRole.Manager)
            throw new DomainException("A manager works every section, always.");
        var row = await access.GetByUserAsync(request.User.Id, cancellationToken);
        if (request.Tabs is not { } tabs)
        {
            if (row is not null)
                access.Remove(row);
            row = null;
        }
        else if (row is null)
        {
            row = new UserTabAccess(request.User.Id, tabs, request.SetBy);
            access.Add(row);
        }
        else
        {
            row.Set(tabs, request.SetBy);
        }

        await unitOfWork.SaveChangesAsync(cancellationToken);
        return UserTabsDtos.Of(request.User, row);
    }
}

internal static class UserTabsDtos
{
    public static UserTabsDto Of(UserAccountRef user, UserTabAccess? row) =>
        new(user.Id, user.Name, user.Role, row is not null, CostingTabSet.Split(row?.Tabs ?? CostingTabSet.DefaultFor(user.Role)), row?.SetBy, row?.SetAtUtc);
}
```


## 4. محرك الموافقات (Maker-Checker)

### 4.1 الفكرة المحاسبية

في أي نظام مالي محترم، **من يُدخل لا يعتمد**. المحاسب يُدخل فاتورة أو يطلب حذف قيد؛ المدير يرى "ماذا سيتغير" ثم يوافق أو يرفض. وطوال الانتظار:

- السجل **كما هو** (لا شيء يتغير قبل الموافقة)، ويُحسب في الأرقام،
- و **مقفول**: لا تعديل آخر عليه حتى يُحسم الطلب (فهرس فريد: طلب معلّق واحد لكل سجل).

### 4.2 `ApprovalRequest`

الوحدة (`ApprovalModule`: وصفات، مشتريات، هالك، جرد، خامات، إنتاج، الخزنة، الكسر، …)، الفعل (إنشاء/تعديل/حذف)، الملخص، **سطور التغيير** (`ApprovalChange`: "الكمية: 10 كجم ← 12 كجم")، الحمولة (`Payload` JSON بما أُدخل)، والقرار ومن اتخذه ومتى. ومعرّفه يصنعه التطبيق (Idempotent).

> 📄 **`backend/src/Costing.Domain/Approvals/ApprovalRequest.cs`** — 246 سطر

```csharp
using Costing.Domain.Common;

namespace Costing.Domain.Approvals;

// The records a manager decides about.
public enum ApprovalModule
{
    // Soft-deleted: kept, off the lists and out of the sales.
    Recipe = 1,

    // A posted invoice, voided: its goods taken back out of stock, its expenses out of the reports.
    PurchaseInvoice = 2,

    // A waste (spoilage) entry, voided: what it took from stock put back.
    Waste = 3,

    // A posted stock count, voided: its adjustments undone.
    StockCount = 4,

    // Archived: off the lists, kept for the records that name it.
    RawMaterial = 5,

    // Added or changed (its details and its batch recipe), or archived as a raw material is.
    PrepItem = 6,

    // Made (the ingredients out, the prep item in), corrected (the batch reversed and made again)
    // or voided (reversed).
    ProductionOrder = 7,

    // A safe entry: opening balance, funding, a day's takings moved in, an expense voucher, a
    // supplier payment, or an invoice paid in cash. Entered when approved, or voided (reversed).
    Treasury = 8,

    // Deleted, what was in it moved to another category, and on the way its raw materials made
    // expense items or its expense items raw materials, as the request holds.
    PurchaseCategory = 9,

    // A sale recorded, voided: what it took from stock put back, and out of the reports.
    Sale = 10,

    // Breakage entered on Waste, voided: its cost off the day.
    Breakage = 11,
}

public enum ApprovalAction
{
    Create = 1,
    Update = 2,
    Delete = 3,
}

public enum ApprovalStatus
{
    // Waiting for a manager. The record is as it was (a new one does not exist yet), counts as
    // before, and cannot be changed.
    Pending = 1,

    // Done: deleted, added or changed.
    Approved = 2,

    // Left as it was.
    Rejected = 3,
}

// One line of what a request changes, as the manager reads it: "Quantity to produce: 10 kg → 12 kg".
// Before is empty for something new, After for something taken away.
public sealed record ApprovalChange(string Label, string? Before, string? After);

// One change asked for and decided: the maker-checker record. Someone without approval rights
// asks; nothing changes while it waits; a manager approves (and it is done) or rejects (and it is
// not). A manager's own delete or correction is recorded too, approved as it is made. Kept
// either way, as the history of who asked for what and who decided.
//
// A deletion needs only the record. A new or changed prep item or production order also holds
// what was entered (Payload, as the module writes it), applied on approval and only then: a new
// one does not exist until it is approved, and a changed one stays as it was. A category's
// deletion holds where its contents go and what they become.
//
// Its id is made by the app, so a retried request is recorded once.
public sealed class ApprovalRequest : AggregateRoot
{
    private List<ApprovalChange> _changes = [];

    private ApprovalRequest() { }

    private ApprovalRequest(
        Guid id,
        ApprovalModule module,
        ApprovalAction action,
        Guid recordId,
        string summary,
        IReadOnlyList<ApprovalChange> changes,
        string? payload,
        string? reason,
        string requestedById,
        string requestedBy)
    {
        if (!Enum.IsDefined(module) || !Enum.IsDefined(action))
            throw new DomainException("Say what is to be done.");
        if (action != ApprovalAction.Delete
            && module is not (ApprovalModule.PrepItem or ApprovalModule.ProductionOrder or ApprovalModule.Treasury or ApprovalModule.PurchaseInvoice
                or ApprovalModule.RawMaterial))
            throw new DomainException(
                "Only prep items, production orders, safe entries, invoices and raw materials are added or changed through an approval.");
        if (action == ApprovalAction.Update && module == ApprovalModule.Treasury)
            throw new DomainException("A safe entry is not changed: void it and enter it again.");
        // An invoice is only corrected through one, and a raw material's unit changed: a new one
        // of either is entered as it is.
        if (action == ApprovalAction.Create && module is (ApprovalModule.PurchaseInvoice or ApprovalModule.RawMaterial))
            throw new DomainException("A new one is entered as it is, not asked for.");
        if (action != ApprovalAction.Delete && string.IsNullOrWhiteSpace(payload))
            throw new DomainException("Say what the change is.");
        if (string.IsNullOrWhiteSpace(summary))
            throw new DomainException("Describe what the request is about.");
        if (reason?.Trim().Length > 500)
            throw new DomainException("Keep the reason under 500 characters.");

        Id = id;
        Module = module;
        Action = action;
        RecordId = recordId;
        Summary = summary.Trim();
        _changes = [.. changes];
        Payload = payload;
        Reason = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim();
        RequestedById = requestedById;
        RequestedBy = requestedBy;
        RequestedAtUtc = DateTime.UtcNow;
        Status = ApprovalStatus.Pending;
    }

    // A deletion, asked for.
    public static ApprovalRequest Ask(
        Guid id, ApprovalModule module, Guid recordId, string summary, string? reason, string requestedById, string requestedBy) =>
        new(id, module, ApprovalAction.Delete, recordId, summary, [], null, reason, requestedById, requestedBy);

    // A new or changed record, asked for, with what was entered.
    public static ApprovalRequest AskToChange(
        Guid id,
        ApprovalModule module,
        ApprovalAction action,
        Guid recordId,
        string summary,
        IReadOnlyList<ApprovalChange> changes,
        string payload,
        string? reason,
        string requestedById,
        string requestedBy) =>
        new(id, module, action, recordId, summary, changes, payload, reason, requestedById, requestedBy);

    // A manager doing it themselves: asked and approved at once, by them.
    public static ApprovalRequest Decided(
        Guid id, ApprovalModule module, Guid recordId, string summary, string? reason, string managerId, string manager)
    {
        var request = new ApprovalRequest(id, module, ApprovalAction.Delete, recordId, summary, [], null, reason, managerId, manager);
        request.Approve(manager);
        return request;
    }

    public static ApprovalRequest DecidedChange(
        Guid id,
        ApprovalModule module,
        ApprovalAction action,
        Guid recordId,
        string summary,
        IReadOnlyList<ApprovalChange> changes,
        string payload,
        string? reason,
        string managerId,
        string manager)
    {
        var request = new ApprovalRequest(id, module, action, recordId, summary, changes, payload, reason, managerId, manager);
        request.Approve(manager);
        return request;
    }

    public ApprovalModule Module { get; private set; }
    public ApprovalAction Action { get; private set; }

    // The record's id in its module: the recipe, invoice, waste entry, count, material, prep item
    // or production order. For a new one, the id it is given when approved.
    public Guid RecordId { get; private set; }

    // What it was when asked about ("Invoice F-1001 · Nile Farms · L.E 1,850.00"), so the
    // decision is made on what was asked and the history reads after the record is gone.
    public string Summary { get; private set; } = string.Empty;

    // What a new or changed record would be, field by field, against what it is now.
    public IReadOnlyList<ApprovalChange> Changes => _changes.AsReadOnly();

    // What was entered, as the module reads it back on approval. Null for a deletion.
    public string? Payload { get; private set; }

    public string? Reason { get; private set; }

    public string RequestedById { get; private set; } = string.Empty;
    public string RequestedBy { get; private set; } = string.Empty;
    public DateTime RequestedAtUtc { get; private set; }

    public ApprovalStatus Status { get; private set; }
    public string? DecidedBy { get; private set; }
    public DateTime? DecidedAtUtc { get; private set; }

    // Why a rejection was made, for the one who asked.
    public string? DecisionNote { get; private set; }

    public bool IsPending => Status == ApprovalStatus.Pending;

    // The caller does what was asked in the same unit of work.
    public void Approve(string decidedBy)
    {
        if (Status == ApprovalStatus.Approved)
            return;
        if (Status != ApprovalStatus.Pending)
            throw new DomainException("This request was rejected; ask again.");
        Status = ApprovalStatus.Approved;
        DecidedBy = decidedBy;
        DecidedAtUtc = DateTime.UtcNow;
    }

    public void Reject(string decidedBy, string? note)
    {
        if (Status == ApprovalStatus.Rejected)
            return;
        if (Status != ApprovalStatus.Pending)
            throw new DomainException("This has already been approved.");
        if (note?.Trim().Length > 500)
            throw new DomainException("Keep the note under 500 characters.");
        Status = ApprovalStatus.Rejected;
        DecidedBy = decidedBy;
        DecidedAtUtc = DateTime.UtcNow;
        DecisionNote = string.IsNullOrWhiteSpace(note) ? null : note.Trim();
    }
}

public interface IApprovalRequestRepository : IRepository<ApprovalRequest>
{
    // Waiting for a decision, oldest first.
    Task<IReadOnlyList<ApprovalRequest>> GetPendingAsync(CancellationToken cancellationToken = default);

    // Decided, newest first.
    Task<IReadOnlyList<ApprovalRequest>> GetDecidedAsync(int take, CancellationToken cancellationToken = default);

    // The one waiting for this record, whatever it asks: at most one does.
    Task<ApprovalRequest?> GetPendingForAsync(Guid recordId, CancellationToken cancellationToken = default);
}
```


### 4.3 `ApprovalRequests.cs`

- `ApprovalLocks.EnsureNotPendingAsync`: يمنع تعديل سجل عليه طلب معلق، برسالة "فلان طلب تعديل هذا؛ يُعدل بعد قرار المدير".
- `ApproveRequestCommand`: يطبّق المطلوب ويغلق الطلب **في حفظ واحد**؛ الموافقة مرتين لا تغيّر شيئًا. إن لم يعد التطبيق ممكنًا يبقى الطلب معلقًا.
- `RejectRequestCommand`: يرفض بملاحظة، والسجل يبقى كما هو ويُفتح قفله.
- `IRecordDescriptions`: كل وحدة تصف سجلاتها للمدير.

> 📄 **`backend/src/Costing.Application/Approvals/ApprovalRequests.cs`** — 245 سطر

```csharp
using System.Text.Json;
using System.Text.Json.Serialization;
using MediatR;
using Costing.Domain.Common;
using Costing.Application.Categories;
using Costing.Application.Common;
using Costing.Application.Production;
using Costing.Application.Purchases;
using Costing.Application.RawMaterials;
using Costing.Application.Treasury;
using Costing.Domain.Approvals;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;
using Costing.Domain.StockMovements;

namespace Costing.Application.Approvals;

// Maker-checker for the costing modules. Whoever may decide (ApprovalDecide) acts at once;
// anyone else asks, and nothing changes until a manager approves: a deletion (Deletions.cs) in
// recipes, purchases, waste, stock counts, raw materials, prep items and production orders, and
// a new or changed prep item or production order (PrepItems.cs, ProductionOrders.cs). One table
// holds them all, keyed by the record each is about; a record with a request waiting is locked.

// What a summary needs from outside the inventory module: a menu item's name for a recipe
// linked to it, and the restaurant's business date of a moment.
public interface IRecordDescriptions
{
    Task<string?> MenuItemNameAsync(RecipeTargetKind kind, int catalogItemId, int? variantId, CancellationToken cancellationToken);

    DateOnly BusinessDateOf(DateTime utc);

    // The calendar date in the restaurant: after midnight, a day ahead of the business date
    // until the business day starts.
    DateOnly LocalDateOf(DateTime utc);

    // The restaurant's wall clock at a moment.
    DateTime LocalTimeOf(DateTime utc);
}

public enum ApprovalOutcome
{
    // Asked: waiting for a manager.
    Requested = 1,

    // Done: the asker could approve it.
    Applied = 2,
}

public sealed record ApprovalRequestDto(
    Guid Id,
    ApprovalModule Module,
    ApprovalAction Action,
    Guid RecordId,
    string Summary,
    IReadOnlyList<ApprovalChange> Changes,
    string? Reason,
    string RequestedBy,
    DateTime RequestedAtUtc,
    ApprovalStatus Status,
    string? DecidedBy,
    DateTime? DecidedAtUtc,
    string? DecisionNote)
{
    public static ApprovalRequestDto From(ApprovalRequest r) => new(
        r.Id, r.Module, r.Action, r.RecordId, r.Summary, r.Changes, r.Reason, r.RequestedBy, r.RequestedAtUtc, r.Status, r.DecidedBy,
        r.DecidedAtUtc, r.DecisionNote);
}

public sealed record ApprovalResultDto(ApprovalOutcome Outcome, ApprovalRequestDto Request)
{
    // Requested while it waits; Applied once approved.
    public static ApprovalResultDto Of(ApprovalRequest request) =>
        new(request.IsPending ? ApprovalOutcome.Requested : ApprovalOutcome.Applied, ApprovalRequestDto.From(request));
}

public static class ApprovalLocks
{
    // A record with a request waiting is not changed meanwhile: the manager decides on what was
    // asked about.
    public static async Task EnsureNotPendingAsync(this IApprovalRequestRepository requests, Guid recordId, CancellationToken cancellationToken)
    {
        if (await requests.GetPendingForAsync(recordId, cancellationToken) is { } pending)
            throw new DomainException($"{pending.RequestedBy} has asked {What(pending)}. It can be changed once a manager has decided.");
    }

    // "for this to be deleted", "to change this".
    internal static string What(ApprovalRequest pending) => pending.Action switch
    {
        ApprovalAction.Delete => "for this to be deleted",
        ApprovalAction.Update => "to change this",
        _ when pending.Module == ApprovalModule.Treasury => "to pay this",
        _ => "for this",
    };
}

// What a new or changed record holds while it waits, as JSON: enums by name, so the stored
// request reads plainly.
internal static class ApprovalPayload
{
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter() } };

    public static string Write<T>(T change) => JsonSerializer.Serialize(change, Options);

    public static T Read<T>(ApprovalRequest request) =>
        JsonSerializer.Deserialize<T>(request.Payload ?? throw new DomainException("This request holds no change to apply."), Options)
        ?? throw new DomainException("This request's change could not be read.");
}

// A manager's yes: what was asked is done (deleted, voided, archived, added, changed, made) and
// the request closed, together. Approving again, after a lost answer, changes nothing. When it
// can no longer be done (a price missing, an ingredient gone), it stays waiting, for the manager
// to put right or reject.
public sealed record ApproveRequestCommand(Guid RequestId, string StaffName) : IRequest<ApprovalRequestDto>, IRetryOnConflict;

internal sealed class ApproveRequestHandler(
    IApprovalRequestRepository requests,
    DeletionTargets deletions,
    PrepItemWriter prepItems,
    ProductionWriter production,
    TreasuryWriter treasury,
    InvoiceCorrector invoices,
    MaterialUnitWriter units,
    CategoryDeleter categoryDeleter,
    IRawMaterialRepository materials,
    IStockMovementRepository movements,
    IUnitOfWork unitOfWork) : IRequestHandler<ApproveRequestCommand, ApprovalRequestDto>
{
    public async Task<ApprovalRequestDto> Handle(ApproveRequestCommand request, CancellationToken cancellationToken)
    {
        var approval = await requests.GetRequiredAsync(request.RequestId, cancellationToken);
        if (approval.Status == ApprovalStatus.Approved)
            return ApprovalRequestDto.From(approval);

        approval.Approve(request.StaffName);
        switch (approval.Action, approval.Module)
        {
            // A category deleted, what is in it moved and converted as asked, and saved with it.
            case (ApprovalAction.Delete, ApprovalModule.PurchaseCategory):
                await categoryDeleter.ApplyApprovedAsync(
                    approval.RecordId, ApprovalPayload.Read<CategoryDeletion>(approval), approval.Id, request.StaffName, cancellationToken);
                break;

            case (ApprovalAction.Delete, _):
                foreach (var reversal in await deletions.DeleteAsync(approval.Module, approval.RecordId, request.StaffName, cancellationToken))
                    movements.Add(reversal);
                break;

            case (_, ApprovalModule.PrepItem):
                await prepItems.SaveAsync(
                    ApprovalPayload.Read<PrepItemChange>(approval), approval.Action == ApprovalAction.Update ? approval.RecordId : null,
                    approval.RecordId, cancellationToken);
                break;

            case (ApprovalAction.Create, ApprovalModule.ProductionOrder):
                await production.MakeAsync(
                    ApprovalPayload.Read<ProductionChange>(approval), approval.RequestedBy, request.StaffName, cancellationToken);
                break;

            case (ApprovalAction.Create, ApprovalModule.Treasury):
                await treasury.ApplyAsync(ApprovalPayload.Read<SafeVoucher>(approval), approval.RequestedBy, request.StaffName, cancellationToken);
                break;

            // An invoice corrected: the original voided, the correction posted in its place.
            case (ApprovalAction.Update, ApprovalModule.PurchaseInvoice):
                await invoices.ApplyAsync(
                    await invoices.OriginalAsync(approval.RecordId, cancellationToken), ApprovalPayload.Read<InvoiceCorrection>(approval),
                    approval.RequestedBy, request.StaffName, cancellationToken);
                break;

            // A material counted in another unit: everything recorded restated, and saved with it.
            case (ApprovalAction.Update, ApprovalModule.RawMaterial):
                await units.ApplyAsync(
                    await materials.GetRequiredAsync(approval.RecordId, cancellationToken), ApprovalPayload.Read<MaterialUnitChange>(approval), approval.Id,
                    cancellationToken);
                break;

            case (ApprovalAction.Update, ApprovalModule.ProductionOrder):
                await production.ReviseAsync(
                    await production.OrderAsync(approval.RecordId, cancellationToken), ApprovalPayload.Read<ProductionChange>(approval),
                    by: request.StaffName, approvedBy: request.StaffName, cancellationToken);
                break;

            default:
                throw new DomainException("This request cannot be approved here.");
        }

        await unitOfWork.SaveChangesAsync(cancellationToken);
        return ApprovalRequestDto.From(approval);
    }
}

// A manager's no: the record stays as it is, unlocked; a new one is never made. The request is
// kept, with the note.
public sealed record RejectRequestCommand(Guid RequestId, string? Note, string StaffName) : IRequest<ApprovalRequestDto>;

internal sealed class RejectRequestHandler(IApprovalRequestRepository requests, IUnitOfWork unitOfWork)
    : IRequestHandler<RejectRequestCommand, ApprovalRequestDto>
{
    public async Task<ApprovalRequestDto> Handle(RejectRequestCommand request, CancellationToken cancellationToken)
    {
        var approval = await requests.GetRequiredAsync(request.RequestId, cancellationToken);
        approval.Reject(request.StaffName, request.Note);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return ApprovalRequestDto.From(approval);
    }
}

// What waits for a decision, oldest first; with Decided, also the last decisions, newest first.
public sealed record GetApprovalRequestsQuery(int Decided = 0) : IRequest<ApprovalRequestsDto>;

public sealed record ApprovalRequestsDto(IReadOnlyList<ApprovalRequestDto> Pending, IReadOnlyList<ApprovalRequestDto> Decided);

internal sealed class GetApprovalRequestsHandler(IApprovalRequestRepository requests) : IRequestHandler<GetApprovalRequestsQuery, ApprovalRequestsDto>
{
    public async Task<ApprovalRequestsDto> Handle(GetApprovalRequestsQuery request, CancellationToken cancellationToken) => new(
        (await requests.GetPendingAsync(cancellationToken)).Select(ApprovalRequestDto.From).ToList(),
        request.Decided > 0
            ? (await requests.GetDecidedAsync(request.Decided, cancellationToken)).Select(ApprovalRequestDto.From).ToList()
            : []);
}

// What approving a batch waiting for it would move, worked out now: each ingredient taken at its
// average cost at this moment, and the prep item put in at their total. For a correction, also
// the batch it replaces, whose entries go back first: the manager sees the net movement. What the
// manager signs off on. Null for any other request.
public sealed record ApprovalPreviewDto(ProductionPreviewDto Batch, ProductionOrderDto? Replaces);

public sealed record GetApprovalPreviewQuery(Guid RequestId) : IRequest<ApprovalPreviewDto?>;

internal sealed class GetApprovalPreviewHandler(IApprovalRequestRepository requests, ProductionWriter production, IRawMaterialRepository materials)
    : IRequestHandler<GetApprovalPreviewQuery, ApprovalPreviewDto?>
{
    public async Task<ApprovalPreviewDto?> Handle(GetApprovalPreviewQuery request, CancellationToken cancellationToken)
    {
        var approval = await requests.GetRequiredAsync(request.RequestId, cancellationToken);
        if (approval.Module != ApprovalModule.ProductionOrder || approval.Action == ApprovalAction.Delete || !approval.IsPending)
            return null;
        var change = ApprovalPayload.Read<ProductionChange>(approval);
        var batch = await production.PreviewAsync(change.PrepItemId, change.PlannedQuantity, change.ProducedQuantity, cancellationToken);
        if (approval.Action != ApprovalAction.Update)
            return new ApprovalPreviewDto(batch, null);
        var replaced = await production.OrderAsync(approval.RecordId, cancellationToken);
        return new ApprovalPreviewDto(batch, ProductionOrderDto.From(replaced, (await materials.GetAllAsync(cancellationToken)).ToDictionary(m => m.Id)));
    }
}
```


### 4.4 الحذف كموافقة: `Deletions.cs`

**في الدفاتر لا يُحذف شيء مُرحّل؛ يُلغى (Void).** حذف فاتورة مرحّلة = حركات مخزون عكسية بنفس تكلفتها + عكس قيد الخزنة أو حساب المورد. حذف قيد خزنة = قيد عكسي بتاريخ اليوم. `DeletionTargets` يعرف لكل وحدة كيف "يلغي" سجلها، و `RequestDeletionCommand`: من يملك القرار يلغي فورًا (ويُسجل كموافَق منه)، وغيره يطلب. نقطة النهاية `POST api/inventory/deletion-requests` في `InventoryController` (الفصل 05).

> 📄 **`backend/src/Costing.Application/Approvals/Deletions.cs`** — 373 سطر

```csharp
using System.Globalization;
using MediatR;
using Costing.Domain.Common;
using Costing.Application.Common;
using Costing.Application.Production;
using Costing.Application.RawMaterials;
using Costing.Application.Treasury;
using Costing.Domain.Approvals;
using Costing.Domain.Production;
using Costing.Domain.Purchases;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;
using Costing.Domain.Sales;
using Costing.Domain.Waste;
using Costing.Domain.StockCounts;
using Costing.Domain.StockMovements;
using Costing.Domain.Suppliers;
using Costing.Domain.Treasury;

namespace Costing.Application.Approvals;

// Deletion, as maker-checker: whoever may approve deletes at once (and it is recorded as approved
// by them); anyone else asks, and the record is left as it is, counted and locked, until a
// manager decides. The API says which by CanApprove, from the signed-in role's permissions.

// Each module's record: described as it is now when deletion is asked for (refused there if it
// cannot be deleted), and deleted on approval. Every check is made again at approval, since the
// record may have changed in between.
internal sealed class DeletionTargets(
    IRecipeRepository recipes,
    IPurchaseInvoiceRepository invoices,
    ISupplierRepository suppliers,
    IStockMovementRepository movements,
    IStockCountRepository counts,
    IRawMaterialRepository materials,
    IPrepRecipeRepository prepRecipes,
    IProductionOrderRepository productionOrders,
    ProductionWriter production,
    ISafeTransactionRepository safe,
    TreasuryWriter treasury,
    IRecordDescriptions descriptions,
    ISalesReceiptRepository sales,
    IBreakageEntryRepository breakage)
{
    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

    public async Task<string> DescribeAsync(ApprovalModule module, Guid recordId, CancellationToken cancellationToken) => module switch
    {
        ApprovalModule.Recipe => await DescribeRecipeAsync(await RecipeAsync(recordId, cancellationToken), cancellationToken),
        ApprovalModule.PurchaseInvoice => await DescribeInvoiceAsync(await InvoiceAsync(recordId, cancellationToken), cancellationToken),
        ApprovalModule.Waste => await DescribeWasteAsync(await WasteAsync(recordId, cancellationToken), cancellationToken),
        ApprovalModule.StockCount => DescribeCount(await CountAsync(recordId, cancellationToken)),
        ApprovalModule.RawMaterial => DescribeMaterial(await MaterialAsync(recordId, cancellationToken, check: true)),
        ApprovalModule.PrepItem => DescribeMaterial(await PrepItemAsync(recordId, cancellationToken)),
        ApprovalModule.ProductionOrder => await DescribeBatchAsync(await BatchAsync(recordId, cancellationToken), cancellationToken),
        ApprovalModule.Treasury => await treasury.DescribeAsync(await SafeEntryAsync(recordId, cancellationToken), cancellationToken),
        ApprovalModule.Sale => DescribeSale(await SaleAsync(recordId, cancellationToken)),
        ApprovalModule.Breakage => DescribeBreakage(await BreakageAsync(recordId, cancellationToken)),
        _ => throw new DomainException("That cannot be deleted here."),
    };

    // Returns the ledger entries a void adds, for the caller to save with the decision.
    public async Task<IReadOnlyList<StockMovement>> DeleteAsync(ApprovalModule module, Guid recordId, string by, CancellationToken cancellationToken)
    {
        switch (module)
        {
            case ApprovalModule.Recipe:
                (await RecipeAsync(recordId, cancellationToken)).Delete(by);
                return [];

            case ApprovalModule.PurchaseInvoice:
                return await VoidInvoiceAsync(await InvoiceAsync(recordId, cancellationToken), by, null, cancellationToken);

            case ApprovalModule.Waste:
                await WasteAsync(recordId, cancellationToken);
                return await ReverseAsync(recordId, StockMovementReason.Spoilage, by, cancellationToken);

            case ApprovalModule.StockCount:
            {
                var count = await CountAsync(recordId, cancellationToken);
                var reversals = await ReverseAsync(
                    count.Id, count.IsOpening ? StockMovementReason.OpeningStock : StockMovementReason.CountAdjustment, by, cancellationToken);
                count.Void(by);
                return reversals;
            }

            case ApprovalModule.RawMaterial:
                (await MaterialAsync(recordId, cancellationToken, check: true)).Archive(by);
                return [];

            case ApprovalModule.PrepItem:
                (await PrepItemAsync(recordId, cancellationToken)).Archive(by);
                return [];

            // Its cash put back, dated today, by the writer, which adds it itself.
            case ApprovalModule.Treasury:
                await treasury.VoidAsync(await SafeEntryAsync(recordId, cancellationToken), by, cancellationToken);
                return [];

            // Its entries reversed by the writer, which adds them itself.
            case ApprovalModule.ProductionOrder:
                await production.VoidAsync(await BatchAsync(recordId, cancellationToken), by, null, cancellationToken);
                return [];

            // What each line took, wasted or put back, reversed exactly as it was posted.
            case ApprovalModule.Sale:
            {
                var sale = await SaleAsync(recordId, cancellationToken);
                var reversals = new List<StockMovement>();
                foreach (var line in sale.Lines)
                {
                    foreach (var reason in new[] { StockMovementReason.Sale, StockMovementReason.Waste, StockMovementReason.VoidReturn })
                        reversals.AddRange(await ReverseAsync(line.PublicId, reason, by, cancellationToken));
                }
                sale.Void(by);
                return reversals;
            }

            case ApprovalModule.Breakage:
                (await BreakageAsync(recordId, cancellationToken)).Void(by);
                return [];

            default:
                throw new DomainException("That cannot be deleted here.");
        }
    }

    // ---- Sales: voided, their stock put back ----

    private async Task<SalesReceipt> SaleAsync(Guid id, CancellationToken cancellationToken)
    {
        var sale = await sales.GetByIdAsync(id, cancellationToken) ?? throw new NotFoundException("Sale", id);
        if (sale.IsVoided)
            throw new DomainException("This sale has already been voided.");
        return sale;
    }

    private static string DescribeSale(SalesReceipt sale) => string.Join(" · ", new[]
    {
        sale.Reference is { } reference ? $"Sale {reference}" : "Sale",
        sale.BusinessDate.ToString("d MMM yyyy", Invariant),
        $"{sale.Lines.Where(l => l.OnBill).Sum(l => l.Quantity)} items",
        sale.TotalAmount.ToString("N2", Invariant),
    });

    private async Task<BreakageEntry> BreakageAsync(Guid id, CancellationToken cancellationToken)
    {
        var entry = await breakage.GetByIdAsync(id, cancellationToken) ?? throw new NotFoundException("Breakage", id);
        if (entry.IsVoided)
            throw new DomainException("This breakage has already been voided.");
        return entry;
    }

    private static string DescribeBreakage(BreakageEntry entry) =>
        $"Breakage · {entry.Quantity} × {entry.Description} · {entry.BusinessDate.ToString("d MMM yyyy", Invariant)} · {entry.Cost.ToString("N2", Invariant)}";

    // ---- Recipes: soft-deleted ----

    private async Task<Recipe> RecipeAsync(Guid id, CancellationToken cancellationToken)
    {
        var recipe = await recipes.GetByIdAsync(id, cancellationToken) ?? throw new NotFoundException(nameof(Recipe), id);
        if (recipe.IsDeleted)
            throw new DomainException("This recipe has already been deleted.");
        return recipe;
    }

    private async Task<string> DescribeRecipeAsync(Recipe recipe, CancellationToken cancellationToken)
    {
        var linked = recipe.Target is { } target
            ? await descriptions.MenuItemNameAsync(target.Kind, target.CatalogItemId, target.VariantId, cancellationToken)
            : null;
        var name = recipe.Name ?? linked ?? "A recipe";
        return linked is not null && linked != name ? $"Recipe {name} (for {linked})" : $"Recipe {name}";
    }

    // ---- Purchase invoices: voided ----

    private async Task<PurchaseInvoice> InvoiceAsync(Guid id, CancellationToken cancellationToken)
    {
        var invoice = await invoices.GetByIdAsync(id, cancellationToken) ?? throw new NotFoundException(nameof(PurchaseInvoice), id);
        return invoice.Status switch
        {
            PurchaseInvoiceStatus.Posted => invoice,
            PurchaseInvoiceStatus.Draft => throw new DomainException("This invoice is a draft: discard it instead, no approval needed."),
            _ => throw new DomainException("This invoice has already been voided."),
        };
    }

    private async Task<string> DescribeInvoiceAsync(PurchaseInvoice invoice, CancellationToken cancellationToken)
    {
        var supplier = invoice.SupplierId is { } id ? (await suppliers.GetByIdAsync(id, cancellationToken))?.Name : null;
        var date = invoice.InvoiceDate ?? descriptions.BusinessDateOf(invoice.PostedAtUtc ?? invoice.CreatedAtUtc);
        return string.Join(" · ", new[]
        {
            invoice.SupplierInvoiceNumber is { } number ? $"Invoice {number}" : "Invoice",
            supplier,
            date.ToString("d MMM yyyy", Invariant),
            $"{invoice.Lines.Count} {(invoice.Lines.Count == 1 ? "line" : "lines")}",
            CompanyMoney.Text(invoice.Total),
        }.Where(p => p is not null));
    }

    // ---- Waste entries: voided ----

    private async Task<IReadOnlyList<StockMovement>> WasteAsync(Guid spoilageId, CancellationToken cancellationToken)
    {
        var entries = await movements.GetBySourceAsync(spoilageId, StockMovementReason.Spoilage, cancellationToken);
        if (entries.Count == 0)
            throw new NotFoundException("Waste entry", spoilageId);
        if (entries.Any(m => m.IsReversal))
            throw new DomainException("This waste entry has already been voided.");
        return entries;
    }

    private async Task<string> DescribeWasteAsync(IReadOnlyList<StockMovement> entries, CancellationToken cancellationToken)
    {
        var byId = (await materials.GetByIdsAsync(entries.Select(e => e.RawMaterialId).Distinct(), cancellationToken)).ToDictionary(m => m.Id);
        var lines = entries
            .Select(e => byId.GetValueOrDefault(e.RawMaterialId) is { } m
                ? $"{m.Name} {(-e.Quantity / m.PurchaseUnitSize).ToString("0.###", Invariant)} {m.PurchaseUnit}{(e.Note is null ? "" : $" ({e.Note})")}"
                : "a removed material")
            .ToList();
        var value = entries.Sum(e => -e.Quantity * (e.UnitCost ?? 0));
        var first = entries[0];
        return $"Waste of {descriptions.BusinessDateOf(first.OccurredAtUtc).ToString("d MMM yyyy", Invariant)}" +
               (first.RecordedBy is null ? "" : $" by {first.RecordedBy}") +
               $": {string.Join(", ", lines.Take(3))}{(lines.Count > 3 ? $" and {lines.Count - 3} more" : "")} · {CompanyMoney.Text(value)}";
    }

    // ---- Stock counts: voided ----

    private async Task<StockCount> CountAsync(Guid id, CancellationToken cancellationToken)
    {
        var count = await counts.GetByIdAsync(id, cancellationToken) ?? throw new NotFoundException(nameof(StockCount), id);
        return count.Status switch
        {
            StockCountStatus.Posted => count,
            StockCountStatus.Draft => throw new DomainException("This count is a draft: discard it instead, no approval needed."),
            _ => throw new DomainException("This count has already been voided."),
        };
    }

    private string DescribeCount(StockCount count) =>
        $"{(count.IsOpening ? "Opening stock count" : "Stock count")} posted {descriptions.BusinessDateOf(count.PostedAtUtc!.Value).ToString("d MMM yyyy", Invariant)}" +
        $"{(count.PostedBy is { Length: > 0 } by ? $" by {by}" : "")} · {count.Lines.Count} {(count.Lines.Count == 1 ? "material" : "materials")}";

    // ---- Raw materials: archived ----

    private async Task<RawMaterial> MaterialAsync(Guid id, CancellationToken cancellationToken, bool check)
    {
        var material = await materials.GetByIdAsync(id, cancellationToken) ?? throw new NotFoundException(nameof(RawMaterial), id);
        if (material.IsArchived)
            throw new DomainException($"{material.Name} has already been deleted.");
        if (!check)
            return material;

        var inRecipes = await recipes.CountUsingAsync(id, cancellationToken);
        var inPrep = (await prepRecipes.GetAllAsync(cancellationToken)).Count(r => r.Ingredients.Any(i => i.RawMaterialId == id));
        if (inRecipes + inPrep > 0)
            throw new DomainException(
                $"{material.Name} is in {inRecipes + inPrep} {(inRecipes + inPrep == 1 ? "recipe" : "recipes")}. Take it out of them first.");
        if (material.QuantityOnHand != 0)
            throw new DomainException(
                $"{material.Name} still has stock on hand. Count it to zero or record its waste first, so its value is not lost from the books.");
        return material;
    }

    // ---- Safe entries: voided ----

    private async Task<SafeTransaction> SafeEntryAsync(Guid id, CancellationToken cancellationToken)
    {
        var entry = await safe.GetByIdAsync(id, cancellationToken) ?? throw new NotFoundException("Safe entry", id);
        if (entry.IsReversal)
            throw new DomainException("This undoes another entry: it is not voided itself.");
        if (entry.IsVoided)
            throw new DomainException("This has already been voided.");
        return entry;
    }

    // ---- Prep items: archived, as a raw material is ----

    private async Task<RawMaterial> PrepItemAsync(Guid id, CancellationToken cancellationToken)
    {
        var item = await MaterialAsync(id, cancellationToken, check: true);
        return item.IsPrepItem ? item : throw new DomainException($"{item.Name} is a bought material, not a prep item.");
    }

    // ---- Production orders: voided, their entries reversed ----

    private async Task<ProductionOrder> BatchAsync(Guid id, CancellationToken cancellationToken)
    {
        var order = await productionOrders.GetByIdAsync(id, cancellationToken) ?? throw new NotFoundException(nameof(ProductionOrder), id);
        return order.IsVoided ? throw new DomainException("This batch has already been voided.") : order;
    }

    private async Task<string> DescribeBatchAsync(ProductionOrder order, CancellationToken cancellationToken) =>
        ProductionWriter.Describe(order, await materials.GetByIdAsync(order.PrepItemId, cancellationToken), descriptions);

    private static string DescribeMaterial(RawMaterial material) =>
        $"{(material.IsPrepItem ? "Prep item" : "Raw material")} {(material.Code is { } code ? $"{code} · " : "")}{material.Name}";

    // The reversing entries for what a source put in or took out, each material moved back.
    // A posted invoice voided: its goods back out of stock, its cash back where it came from, and
    // what it put on its supplier's account off it. replacedBy, the invoice correcting it.
    public async Task<IReadOnlyList<StockMovement>> VoidInvoiceAsync(PurchaseInvoice invoice, string by, Guid? replacedBy, CancellationToken cancellationToken)
    {
        var reversals = await ReverseAsync(invoice.Id, StockMovementReason.Purchase, by, cancellationToken);
        await treasury.UndoInvoiceAsync(invoice, by, cancellationToken);
        invoice.Void(by, replacedBy);
        return reversals;
    }

    private async Task<IReadOnlyList<StockMovement>> ReverseAsync(Guid sourceId, StockMovementReason reason, string by, CancellationToken cancellationToken)
    {
        var originals = (await movements.GetBySourceAsync(sourceId, reason, cancellationToken)).Where(m => !m.IsReversal).ToList();
        if (originals.Count == 0)
            return [];
        var byId = await materials.GetRequiredByIdsAsync(originals.Select(m => m.RawMaterialId).Distinct().ToList(), cancellationToken);
        return originals.Select(m => byId[m.RawMaterialId].Reverse(m, by)).ToList();
    }
}

// Deletes it, for someone who may approve; asks a manager to, for anyone else. RequestId is made
// by the till: a retry after a lost answer finds the request already made.
public sealed record RequestDeletionCommand(
    Guid RequestId, ApprovalModule Module, Guid RecordId, string? Reason, string StaffId, string StaffName, bool CanApprove)
    : IRequest<ApprovalResultDto>, IRetryOnConflict;

internal sealed class RequestDeletionHandler(
    IApprovalRequestRepository requests,
    DeletionTargets targets,
    IStockMovementRepository movements,
    IUnitOfWork unitOfWork) : IRequestHandler<RequestDeletionCommand, ApprovalResultDto>
{
    public async Task<ApprovalResultDto> Handle(RequestDeletionCommand request, CancellationToken cancellationToken)
    {
        if (await requests.GetByIdAsync(request.RequestId, cancellationToken) is { } already)
            return new ApprovalResultDto(already.IsPending ? ApprovalOutcome.Requested : ApprovalOutcome.Applied, ApprovalRequestDto.From(already));

        var pending = await requests.GetPendingForAsync(request.RecordId, cancellationToken);
        if (pending is not null && !request.CanApprove)
            throw new DomainException($"{pending.RequestedBy} has already asked {ApprovalLocks.What(pending)}. A manager will decide.");
        if (pending is not null && pending.Action != ApprovalAction.Delete)
            throw new DomainException($"{pending.RequestedBy} has asked {ApprovalLocks.What(pending)}: decide that first, on Pending approvals.");

        var summary = await targets.DescribeAsync(request.Module, request.RecordId, cancellationToken);
        ApprovalRequest decided;
        if (!request.CanApprove)
        {
            decided = ApprovalRequest.Ask(request.RequestId, request.Module, request.RecordId, summary, request.Reason, request.StaffId, request.StaffName);
            requests.Add(decided);
            await unitOfWork.SaveChangesAsync(cancellationToken);
            return new ApprovalResultDto(ApprovalOutcome.Requested, ApprovalRequestDto.From(decided));
        }

        // A manager deleting what someone has already asked about decides that request.
        if (pending is not null)
        {
            pending.Approve(request.StaffName);
            decided = pending;
        }
        else
        {
            decided = ApprovalRequest.Decided(request.RequestId, request.Module, request.RecordId, summary, request.Reason, request.StaffId, request.StaffName);
            requests.Add(decided);
        }

        foreach (var reversal in await targets.DeleteAsync(request.Module, request.RecordId, request.StaffName, cancellationToken))
            movements.Add(reversal);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return new ApprovalResultDto(ApprovalOutcome.Applied, ApprovalRequestDto.From(decided));
    }
}
```


## 5. الجانب الآخر: المصادقة والأقسام في الواجهة

`Me`, `SignInResponse`: تطابق DTOs الـ API حرفيًا.

> 📄 **`frontend/src/app/core/api/models.ts`** — 25 سطر

```ts
import { CostingTab } from '../costing/costing-tabs';

// Who uses the system: a manager, who does everything, decides what the others ask and gives
// each their sections; an accountant (purchases, the safe, the reports); a cost controller
// (recipes, the menu, sales, the reports); a storekeeper (the stock: purchases in, counts,
// production, waste).
export type UserRole = 'Manager' | 'Accountant' | 'CostController' | 'Storekeeper';

// GET /api/auth/me: who is signed in and what they may do. tabs: the sections they work, every
// one for a manager, anyone else's as a manager ticked them (their role's until then).
export interface Me {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  permissions: string[];
  tabs?: CostingTab[] | null;
}

// POST /api/auth/sign-in, and a password changed: the token, good until expiresAtUtc.
export interface SignInResponse {
  token: string;
  expiresAtUtc: string;
  user: Me;
}
```


`AuthService`: التوكن في `localStorage` كـ "مرشح" فقط حتى يؤكده `GET /api/auth/me`؛ الدور والصلاحيات من الخادم لا من التوكن. و `can(permission)` يقرر إظهار الأزرار.

> 📄 **`frontend/src/app/core/auth/auth.service.ts`** — 106 سطر

```ts
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Me, SignInResponse } from '../api/models';
import { Permission } from './permissions';

const TokenKey = 'costing.token';

// Who is signed in to the system, and what they may do.
//
// The role and permissions come from GET /api/auth/me and nowhere else: not from the sign-in
// response, not from the token, not from anything stored in the browser. The stored token is
// only a candidate until the API has said whose it is, so a role changed or a user deactivated
// takes effect here the next time /me is asked.

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private readonly _token = signal<string | null>(readStoredToken());
  private readonly _me = signal<Me | null>(null);
  private readonly permissions = computed(() => new Set(this._me()?.permissions ?? []));

  readonly token = this._token.asReadonly();
  readonly me = this._me.asReadonly();
  readonly isSignedIn = computed(() => this._me() !== null);

  can(permission: Permission): boolean {
    return this.permissions().has(permission);
  }

  canAny(permissions: readonly Permission[]): boolean {
    return permissions.some((permission) => this.can(permission));
  }

  // At start-up: confirm a stored token with the API. A 401 means it is no good; anything else
  // (the server down) leaves it for the sign-in screen to try again.
  async restore(): Promise<void> {
    if (this._token() === null) {
      return;
    }
    try {
      await this.loadMe();
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 401) {
        this.clear();
      }
    }
  }

  async signIn(email: string, password: string): Promise<Me> {
    const response = await firstValueFrom(this.http.post<SignInResponse>('/api/auth/sign-in', { email, password }));
    this.store(response.token);
    return this.loadMe();
  }

  // Their own password changed: signed out everywhere else, and signed in again here with the
  // token the answer brings.
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const response = await firstValueFrom(this.http.post<SignInResponse>('/api/auth/password', { currentPassword, newPassword }));
    this.store(response.token);
    await this.loadMe();
  }

  // `expired` when the API has stopped accepting the token: it ran out, the password was changed
  // or reset, or the user was deactivated or given another role.
  signOut(reason?: 'expired'): void {
    this.clear();
    void this.router.navigate(['/sign-in'], { queryParams: reason ? { reason } : {} });
  }

  private async loadMe(): Promise<Me> {
    const me = await firstValueFrom(this.http.get<Me>('/api/auth/me'));
    this._me.set(me);
    return me;
  }

  private store(token: string): void {
    this._token.set(token);
    try {
      localStorage.setItem(TokenKey, token);
    } catch {
      // Private browsing or storage switched off: signed in for this tab only.
    }
  }

  private clear(): void {
    this._token.set(null);
    this._me.set(null);
    try {
      localStorage.removeItem(TokenKey);
    } catch {
      // Nothing stored to remove.
    }
  }
}

function readStoredToken(): string | null {
  try {
    return localStorage.getItem(TokenKey);
  } catch {
    return null;
  }
}
```


> 📄 **`frontend/src/app/core/auth/permissions.ts`** — 19 سطر

```ts
// The API's Permissions (Costing.Domain.Access), by the same strings. A role's set arrives from
// GET /api/auth/me, worked out by the same RolePermissions table the API enforces, so a button
// shows exactly when the API would allow what it does.
export const Permissions = {
  // Stock, materials, suppliers and the menu, seen.
  InventoryView: 'inventory.view',
  // Entered and changed: what a manager decides is asked of one.
  InventoryManage: 'inventory.manage',
  // The costs: recipe cards, the reports, the safe.
  CostingView: 'costing.view',
  // A manager's: deciding others' requests, and what only a manager does.
  ApprovalDecide: 'approval.decide',
  // The system's users: added, changed, deactivated, their passwords reset, their sections given.
  UsersManage: 'users.manage',
  // Company Settings: the name and logo, the currency, the country, the time zone.
  SettingsManage: 'settings.manage',
} as const;

export type Permission = (typeof Permissions)[keyof typeof Permissions];
```


> 📄 **`frontend/src/app/core/auth/guards.ts`** — 24 سطر

```ts
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { Permission } from './permissions';

// Where a user lands: Costing & Financials, on the first section they work.
export const homePath = '/costing';

// Signed in, as /api/auth/me confirmed at start-up or sign-in.
export const signedInGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isSignedIn() ? true : inject(Router).createUrlTree(['/sign-in']);
};

// The sign-in: one already signed in goes on to the system.
export const signedOutGuard: CanActivateFn = () =>
  inject(AuthService).isSignedIn() ? inject(Router).createUrlTree([homePath]) : true;

// A section only some roles have: its link is hidden from the rest, and this keeps a typed
// address from opening it. The API refuses the data either way.
export const permissionGuard =
  (permission: Permission): CanActivateFn =>
  () =>
    inject(AuthService).can(permission) ? true : inject(Router).createUrlTree([homePath]);
```


`*appCan`: يُظهر العنصر لمن يملك الصلاحية فقط.

> 📄 **`frontend/src/app/core/auth/can.directive.ts`** — 36 سطر

```ts
import { Directive, TemplateRef, ViewContainerRef, effect, inject, input } from '@angular/core';
import { AuthService } from './auth.service';
import { Permission } from './permissions';

// Shows its element only when the signed-in user has the permission (or any of them, given a
// list), and takes it away again the moment they do not:
//
//   <button *appCan="Permissions.ApprovalDecide" ...>Approve</button>
//
// The permissions are the ones GET /api/auth/me returned, so this hides exactly what the API
// would refuse. An accountant therefore never sees what only a manager decides.
@Directive({ selector: '[appCan]' })
export class CanDirective {
  private readonly auth = inject(AuthService);
  private readonly template = inject(TemplateRef<unknown>);
  private readonly container = inject(ViewContainerRef);

  readonly appCan = input.required<Permission | readonly Permission[]>();

  private shown = false;

  constructor() {
    effect(() => {
      const wanted = this.appCan();
      const allowed = typeof wanted === 'string' ? this.auth.can(wanted) : this.auth.canAny(wanted);

      if (allowed && !this.shown) {
        this.container.createEmbeddedView(this.template);
        this.shown = true;
      } else if (!allowed && this.shown) {
        this.container.clear();
        this.shown = false;
      }
    });
  }
}
```


`costing-tabs.ts`: الأقسام بمجموعاتها (الكتالوج والإنتاج، التشغيل والمخزون، الماليات والإدارة) وأيقوناتها، و `CostingAccess` (هل يملك القسم؟ أول قسم له)، و `costingTabGuard(tab)`.

> **Guards الواجهة ليست أمانًا.** هي تجربة مستخدم (إخفاء ما لا يملكه). الأمان الحقيقي في الـ API: `[CostingTab]` و `[Authorize]`.

> 📄 **`frontend/src/app/core/costing/costing-tabs.ts`** — 102 سطر

```ts
import { Injectable, computed, inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';

// The sections of Costing & Financials, as the API names them (CostingTabs): what a manager gives
// each user, a manager having them all. Anyone else works their role's until a manager ticks theirs.
export type CostingTab =
  | 'Materials'
  | 'Recipes'
  | 'Production'
  | 'Menu'
  | 'Intelligence'
  | 'Sales'
  | 'EndOfDay'
  | 'Purchases'
  | 'ExpenseItems'
  | 'Counts'
  | 'Waste'
  | 'Financials'
  | 'Reports'
  | 'CostSettings';

// The sidebar's three groups.
export const costingGroups = {
  catalog: { key: 'catalog', en: 'Catalog & production', ar: 'الأصناف والإنتاج' },
  operations: { key: 'operations', en: 'Operations & inventory', ar: 'التشغيل والمخزون' },
  finance: { key: 'finance', en: 'Financials & admin', ar: 'الماليات والإدارة' },
} as const;

export interface CostingTabInfo {
  tab: CostingTab;
  // The sidebar group it is listed under.
  group: (typeof costingGroups)[keyof typeof costingGroups];
  // Its address under /costing.
  path: string;
  en: string;
  ar: string;
  // Its Material icon, beside its name in the sidebar.
  icon: string;
  // What holding it lets them do, as the Permissions page says it.
  hint: { en: string; ar: string };
}

// In the order the sidebar shows them.
export const costingTabs: readonly CostingTabInfo[] = [
  { tab: 'Materials', group: costingGroups.catalog, path: 'materials', en: 'Raw materials', ar: 'الخامات', icon: 'inventory', hint: { en: 'Materials, their units, prices and stock', ar: 'الخامات ووحداتها وأسعارها ومخزونها' } },
  { tab: 'Recipes', group: costingGroups.catalog, path: 'recipes', en: 'Recipes', ar: 'الوصفات', icon: 'menu_book', hint: { en: 'Recipe cards, prep items and recipe categories', ar: 'بطاقات الوصفات والمصنعات وأقسامها' } },
  { tab: 'Production', group: costingGroups.catalog, path: 'production', en: 'Production', ar: 'الإنتاج', icon: 'soup_kitchen', hint: { en: 'Prep items made in batches', ar: 'تشغيل المصنعات' } },
  { tab: 'Menu', group: costingGroups.catalog, path: 'menu', en: 'Menu', ar: 'قائمة الطعام', icon: 'restaurant_menu', hint: { en: 'Items, sizes, add-ons and their prices', ar: 'الأصناف والأحجام والإضافات وأسعارها' } },
  {
    tab: 'Intelligence', group: costingGroups.catalog, path: 'intelligence', en: 'Material & demand intelligence', ar: 'تحليلات الخامات والطلبيات', icon: 'query_stats',
    hint: { en: 'Price variance, the order planner, theoretical vs actual usage, ABC, menu engineering', ar: 'انحراف الأسعار وتخطيط الطلبيات والاستهلاك وتصنيف ABC وهندسة المنيو' },
  },
  { tab: 'Sales', group: costingGroups.operations, path: 'sales', en: 'Sales', ar: 'المبيعات', icon: 'point_of_sale', hint: { en: 'Sales entered or imported, refunds', ar: 'المبيعات المدخلة أو المستوردة والمرتجعات' } },
  {
    tab: 'EndOfDay', group: costingGroups.operations, path: 'end-of-day', en: 'End of the day', ar: 'تقفيل اليوم', icon: 'assignment_turned_in',
    hint: { en: "The day's invoices photographed, cash and on credit, and its sales report", ar: 'تصوير فواتير اليوم النقدية والآجل وريبورت المبيعات' },
  },
  { tab: 'Purchases', group: costingGroups.operations, path: 'purchases', en: 'Purchases', ar: 'المشتريات', icon: 'shopping_cart', hint: { en: 'Invoices, the daily batch, suppliers and categories', ar: 'الفواتير ويومية المشتريات والموردين والأقسام' } },
  { tab: 'ExpenseItems', group: costingGroups.operations, path: 'expense-items', en: 'Expense items', ar: 'المصروفات العمومية', icon: 'receipt_long', hint: { en: 'General expenses, not stock', ar: 'المصروفات العامة غير المخزنية' } },
  { tab: 'Counts', group: costingGroups.operations, path: 'counts', en: 'Stock counts', ar: 'الجرد', icon: 'fact_check', hint: { en: 'Counts, drafted and posted', ar: 'الجرد مسودة ثم ترحيل' } },
  { tab: 'Waste', group: costingGroups.operations, path: 'waste', en: 'Waste', ar: 'الهالك', icon: 'delete_sweep', hint: { en: 'Spoilage and breakage', ar: 'التالف والكسر' } },
  { tab: 'Financials', group: costingGroups.finance, path: 'financials', en: 'Financials', ar: 'الماليات', icon: 'account_balance_wallet', hint: { en: 'The safe, takings, suppliers owed, staff payments', ar: 'الخزنة والإيرادات ومديونيات الموردين ومدفوعات الموظفين' } },
  { tab: 'Reports', group: costingGroups.finance, path: 'reports', en: 'Reports', ar: 'التقارير', icon: 'insights', hint: { en: 'Spending, theoretical cost, variance, KPIs, break-even', ar: 'الإنفاق والتكلفة النظرية والانحراف والمؤشرات ونقطة التعادل' } },
  { tab: 'CostSettings', group: costingGroups.finance, path: 'settings', en: 'Cost settings', ar: 'إعدادات التكاليف', icon: 'tune', hint: { en: 'Targets, shared costs, monthly expenses', ar: 'المستهدفات والتكاليف المشتركة والمصروفات الشهرية' } },
];

export const allCostingTabs: readonly CostingTab[] = costingTabs.map((t) => t.tab);

// The tabs a list names, in the order shown; anything that is not a tab left out.
export function costingTabsOf(names: readonly unknown[] | null | undefined): CostingTab[] {
  const named = new Set(names ?? []);
  return allCostingTabs.filter((t) => named.has(t));
}

// The sections the signed-in user works, as /api/auth/me says.
@Injectable({ providedIn: 'root' })
export class CostingAccess {
  private readonly auth = inject(AuthService);

  readonly tabs = computed(() => new Set(costingTabsOf(this.auth.me()?.tabs)));

  has(tab: CostingTab): boolean {
    return this.tabs().has(tab);
  }

  // The first section they work, to open on.
  first(): string | null {
    return costingTabs.find((t) => this.has(t.tab))?.path ?? null;
  }
}

// A section opened by its address only for whoever works it: the first one they do otherwise.
export const costingTabGuard =
  (tab: CostingTab): CanActivateFn =>
  () => {
    const access = inject(CostingAccess);
    if (access.has(tab))
      return true;
    const first = access.first();
    return inject(Router).createUrlTree(first ? ['/costing', first] : ['/account']);
  };
```


### 5.1 شاشة الدخول

بريد وكلمة مرور، `busy` يمنع الضغط المزدوج، رسالة الخادم تُعرض كما هي ("مقفل 5 دقائق")، و `?reason=expired` يعرض "انتهت الجلسة". `ViewEncapsulation.None` لتنسيق حقول Material، وكل القواعد تحت `.sign-in`.

> 📄 **`frontend/src/app/features/sign-in/sign-in-page.ts`** — 74 سطر

```ts
import { Component, ViewEncapsulation, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { homePath } from '../../core/auth/guards';
import { errorMessage } from '../../core/http/error-message';
import { Company } from '../../core/settings/company';

// The sign-in: a user's email and password. They go on to the system (homePath: the first section
// of Costing & Financials they work).
//
// Unencapsulated, to style the Material fields inside; every rule is under .sign-in.
@Component({
  selector: 'app-sign-in-page',
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressSpinnerModule],
  templateUrl: './sign-in-page.html',
  styleUrl: './sign-in-page.scss',
  encapsulation: ViewEncapsulation.None,
})
export class SignInPage {
  protected readonly company = inject(Company);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  // ?reason=expired, when the API stopped accepting the last session.
  readonly reason = input<string>();

  protected readonly login = signal('');
  protected readonly secret = signal('');
  protected readonly showSecret = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  // The company's mark when it has no logo: its name's first letters.
  protected readonly initials = computed(() =>
    this.company
      .name()
      .split(/[\s&·-]+/)
      .filter((word) => /^\p{L}/u.test(word))
      .slice(0, 2)
      .map((word) => word[0].toUpperCase())
      .join(''),
  );

  protected async submit(): Promise<void> {
    if (this.busy()) {
      return;
    }
    const login = this.login().trim();
    if (!login || !this.secret()) {
      this.error.set('Enter your email and your password.');
      return;
    }
    if (!login.includes('@')) {
      this.error.set('Enter your email: it has an @ in it.');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.signIn(login, this.secret());
      await this.router.navigate([homePath]);
    } catch (error) {
      this.error.set(errorMessage(error, 'Sign-in failed.'));
      this.secret.set('');
    } finally {
      this.busy.set(false);
    }
  }
}
```


> 📄 **`frontend/src/app/features/sign-in/sign-in-page.html`** — 87 سطر

```html
<main class="sign-in">
  <section class="card">
    <header class="brand">
      <div class="mark" [class.logo]="company.logoUrl()">
        @if (company.logoUrl(); as logo) {
          <img [src]="logo" alt="" />
        } @else if (initials()) {
          <span>{{ initials() }}</span>
        } @else {
          <mat-icon>calculate</mat-icon>
        }
      </div>
      <h1>{{ company.name() }}</h1>
      @if (company.settings().name) {
        <p class="product">Costing &amp; Financials <span class="ar">التكاليف والماليات</span></p>
      }
    </header>

    <div class="welcome">
      <h2>Sign in <span class="ar">تسجيل الدخول</span></h2>
      <p>With your email and your password. <span class="ar">بالبريد الإلكتروني وكلمة المرور</span></p>
    </div>

    @if (reason() === 'expired') {
      <p class="notice" role="status">
        <mat-icon>lock_clock</mat-icon>
        <span>Your session has ended. Sign in again. <span class="ar">سجّل الدخول مرة أخرى</span></span>
      </p>
    }

    <form (ngSubmit)="submit()" aria-label="Sign in">
      <mat-form-field class="field" appearance="outline" hideRequiredMarker>
        <mat-icon matPrefix>alternate_email</mat-icon>
        <mat-label>Email · البريد الإلكتروني</mat-label>
        <input
          matInput
          name="login"
          type="email"
          autocomplete="username"
          autocapitalize="none"
          spellcheck="false"
          [(ngModel)]="login"
          [disabled]="busy()"
          required
        />
      </mat-form-field>

      <mat-form-field class="field" appearance="outline" hideRequiredMarker>
        <mat-icon matPrefix>lock</mat-icon>
        <mat-label>Password · كلمة المرور</mat-label>
        <input
          matInput
          name="secret"
          [type]="showSecret() ? 'text' : 'password'"
          autocomplete="current-password"
          [(ngModel)]="secret"
          [disabled]="busy()"
          required
        />
        <button
          mat-icon-button
          matSuffix
          type="button"
          (click)="showSecret.set(!showSecret())"
          [attr.aria-label]="showSecret() ? 'Hide the password' : 'Show the password'"
        >
          <mat-icon>{{ showSecret() ? 'visibility_off' : 'visibility' }}</mat-icon>
        </button>
      </mat-form-field>

      @if (error(); as message) {
        <p class="error" role="alert"><mat-icon>error_outline</mat-icon><span>{{ message }}</span></p>
      }

      <!-- Not disabled while the fields fill: Enter straight after typing (or after the browser fills them in) still signs in. -->
      <button mat-flat-button class="submit" type="submit" [disabled]="busy()">
        @if (busy()) {
          <mat-spinner diameter="20" />
        }
        {{ busy() ? 'Signing in…' : 'Sign in' }}
        @if (!busy()) {
          <mat-icon iconPositionEnd>arrow_forward</mat-icon>
        }
      </button>
    </form>
  </section>
</main>
```


> 📄 **`frontend/src/app/features/sign-in/sign-in-page.scss`** — 265 سطر

```scss
@use '@angular/material' as mat;

// Unencapsulated (see SignInPage): everything is under .sign-in.
.sign-in {
  --sign-in-accent: color-mix(in srgb, var(--mat-sys-primary) 70%, var(--mat-sys-tertiary));

  position: relative;
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 24px 16px;
  box-sizing: border-box;
  overflow: hidden;
  background:
    radial-gradient(60rem 40rem at 0% 0%, color-mix(in srgb, var(--mat-sys-primary) 14%, transparent), transparent 60%),
    radial-gradient(50rem 36rem at 100% 100%, color-mix(in srgb, var(--mat-sys-tertiary) 12%, transparent), transparent 60%),
    var(--mat-sys-surface-container-low);

  @include mat.form-field-overrides(
    (
      outlined-container-shape: 14px,
      outlined-outline-color: var(--mat-sys-outline-variant),
      outlined-hover-outline-color: var(--mat-sys-outline),
      outlined-focus-outline-color: var(--mat-sys-primary),
      outlined-focus-outline-width: 2px,
    )
  );

  .card {
    position: relative;
    width: min(420px, 100%);
    padding: 36px 32px 32px;
    box-sizing: border-box;
    border-radius: 28px;
    background: var(--mat-sys-surface-container-lowest);
    border: 1px solid color-mix(in srgb, var(--mat-sys-outline-variant) 60%, transparent);
    box-shadow:
      0 1px 2px rgb(15 23 42 / 6%),
      0 12px 32px -8px rgb(15 23 42 / 14%),
      0 32px 64px -24px color-mix(in srgb, var(--mat-sys-primary) 22%, transparent);
    animation: sign-in-rise 420ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }

  // The company: its logo or initials in a tile, its name, and the product beneath.
  .brand {
    display: grid;
    justify-items: center;
    text-align: center;
    gap: 6px;

    h1 {
      margin: 10px 0 0;
      font: var(--mat-sys-headline-small);
      font-weight: 650;
      letter-spacing: -0.01em;
      color: var(--mat-sys-on-surface);
    }
  }

  .mark {
    display: grid;
    place-items: center;
    width: 64px;
    height: 64px;
    border-radius: 20px;
    background: linear-gradient(135deg, var(--mat-sys-primary), var(--sign-in-accent));
    color: var(--mat-sys-on-primary);
    box-shadow: 0 10px 24px -8px color-mix(in srgb, var(--mat-sys-primary) 60%, transparent);
    font: 600 24px / 1 var(--mat-sys-headline-small-font);
    letter-spacing: 0.02em;

    mat-icon {
      width: 32px;
      height: 32px;
      font-size: 32px;
    }

    &.logo {
      width: auto;
      min-width: 64px;
      max-width: 180px;
      padding: 10px 14px;
      box-sizing: border-box;
      background: var(--mat-sys-surface-container-lowest);
      border: 1px solid var(--mat-sys-outline-variant);
      box-shadow: 0 8px 20px -10px rgb(15 23 42 / 25%);
    }

    img {
      display: block;
      max-height: 44px;
      max-width: 100%;
      object-fit: contain;
    }
  }

  .product {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    padding: 4px 12px;
    border-radius: 999px;
    background: var(--mat-sys-surface-container);
    color: var(--mat-sys-on-surface-variant);
    font: var(--mat-sys-label-medium);
  }

  .welcome {
    margin: 28px 0 20px;

    h2 {
      margin: 0;
      font: var(--mat-sys-title-large);
      font-weight: 600;
    }

    p {
      margin: 4px 0 0;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-medium);
    }
  }

  .notice {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 0 16px;
    padding: 12px 14px;
    border-radius: 14px;
    background: var(--mat-sys-tertiary-container);
    color: var(--mat-sys-on-tertiary-container);
    font: var(--mat-sys-body-medium);
  }

  form {
    display: grid;
    gap: 6px;
  }

  .field {
    width: 100%;

    .mat-mdc-text-field-wrapper {
      background: var(--mat-sys-surface-container-lowest);
      border-radius: 14px;
      transition: box-shadow 160ms ease;
    }

    // A soft ring of the brand's colour round the field being typed in.
    &.mat-focused .mat-mdc-text-field-wrapper {
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--mat-sys-primary) 14%, transparent);
    }

    .mat-mdc-form-field-icon-prefix > .mat-icon {
      padding: 0 4px 0 12px;
      color: var(--mat-sys-on-surface-variant);
    }

    &.mat-focused .mat-mdc-form-field-icon-prefix > .mat-icon {
      color: var(--mat-sys-primary);
    }
  }

  .error {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 4px 0 6px;
    padding: 10px 12px;
    border-radius: 12px;
    background: var(--mat-sys-error-container);
    color: var(--mat-sys-on-error-container);
    font: var(--mat-sys-body-medium);

    mat-icon {
      flex: none;
      width: 20px;
      height: 20px;
      font-size: 20px;
    }
  }

  // Sign in: the brand's gradient, rounded, lifting a little under the pointer.
  .submit.mat-mdc-unelevated-button {
    height: 52px;
    margin-top: 10px;
    border-radius: 14px;
    background-image: linear-gradient(135deg, var(--mat-sys-primary), var(--sign-in-accent));
    color: var(--mat-sys-on-primary);
    font: var(--mat-sys-label-large);
    font-size: 16px;
    letter-spacing: 0.01em;
    box-shadow: 0 10px 22px -10px color-mix(in srgb, var(--mat-sys-primary) 70%, transparent);
    transition:
      transform 160ms ease,
      box-shadow 160ms ease,
      filter 160ms ease;

    .mat-icon {
      transition: transform 160ms ease;
    }

    &:hover:not(:disabled) {
      transform: translateY(-1px);
      filter: brightness(1.06);
      box-shadow: 0 14px 28px -10px color-mix(in srgb, var(--mat-sys-primary) 80%, transparent);

      .mat-icon {
        transform: translateX(3px);
      }
    }

    &:active:not(:disabled) {
      transform: translateY(0);
    }

    &:disabled {
      color: var(--mat-sys-on-primary);
      opacity: 0.8;
    }

    mat-spinner {
      display: inline-block;
      margin-right: 10px;
      vertical-align: middle;
      --mat-progress-spinner-active-indicator-color: var(--mat-sys-on-primary);
    }
  }

  .ar {
    direction: rtl;
    unicode-bidi: isolate;
    opacity: 0.8;
    margin-left: 6px;
  }
}

@media (max-width: 480px) {
  .sign-in .card {
    padding: 28px 20px 24px;
    border-radius: 24px;
  }
}

@keyframes sign-in-rise {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .sign-in .card,
  .sign-in .submit.mat-mdc-unelevated-button,
  .sign-in .submit .mat-icon {
    animation: none;
    transition: none;
  }
}
```


[الفصل التالي: الخامات والوصفات والمصنعات والمنيو →](04-catalog-materials-recipes-and-menu.md)
