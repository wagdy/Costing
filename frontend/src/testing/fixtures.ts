import { Me } from '../app/core/api/models';
import { allCostingTabs } from '../app/core/costing/costing-tabs';
import { CompanySettings } from '../app/core/settings/company';

// What GET /api/auth/me returns for each role: the API's RolePermissions table, and the sections
// each works by its role.
export const managerMe: Me = {
  id: 'user-manager',
  fullName: 'Omar',
  email: 'omar@example.com',
  role: 'Manager',
  permissions: ['approval.decide', 'costing.view', 'inventory.manage', 'inventory.view', 'settings.manage', 'users.manage'],
  tabs: [...allCostingTabs],
};

export const accountantMe: Me = {
  id: 'user-accountant',
  fullName: 'Mona',
  email: 'mona@example.com',
  role: 'Accountant',
  permissions: ['costing.view', 'inventory.manage', 'inventory.view'],
  tabs: ['Materials', 'Sales', 'Purchases', 'ExpenseItems', 'Financials', 'Reports'],
};

export const storekeeperMe: Me = {
  id: 'user-storekeeper',
  fullName: 'Samir',
  email: 'samir@example.com',
  role: 'Storekeeper',
  permissions: ['inventory.manage', 'inventory.view'],
  tabs: ['Materials', 'Production', 'Purchases', 'Counts', 'Waste'],
};

// What GET /api/settings returns: a company in Egypt, its money written "L.E 1,400.00".
export function aCompany(overrides: Partial<CompanySettings> = {}): CompanySettings {
  return {
    name: 'Acme', currencySymbol: 'L.E', currencyPosition: 'Before', country: 'Egypt', timeZoneId: 'Africa/Cairo', workdayStartsAtHour: 4,
    hasLogo: false, logoVersion: 0, ...overrides,
  };
}
