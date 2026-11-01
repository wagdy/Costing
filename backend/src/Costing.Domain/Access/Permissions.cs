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
