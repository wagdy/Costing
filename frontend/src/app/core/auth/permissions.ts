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
