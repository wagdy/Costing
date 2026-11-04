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
