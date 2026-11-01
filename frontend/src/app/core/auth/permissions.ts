// The API's Permissions (Costing.Domain.Access), by the same strings. A role's set arrives from
// GET /api/auth/me, worked out by the same RolePermissions table the API enforces, so a button
// shows exactly when the API would allow what it does.
export const Permissions = {
  // HR & Payroll and Custody & Assets: seeing them shows salaries; changing them is a request
  // for anyone who cannot approve.
  HrView: 'hr.view',
  HrManage: 'hr.manage',
  // A manager's: deciding others' requests, and what only a manager does.
  ApprovalDecide: 'approval.decide',
  // The system's users: added, changed, deactivated, their passwords reset.
  UsersManage: 'users.manage',
  // Company Settings: the name and logo, the currency, the country, the time zone, the weekends.
  SettingsManage: 'settings.manage',
} as const;

export type Permission = (typeof Permissions)[keyof typeof Permissions];
