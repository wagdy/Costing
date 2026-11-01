import { Routes } from '@angular/router';
import { inject } from '@angular/core';
import { homePath, permissionGuard, signedInGuard, signedOutGuard } from './core/auth/guards';
import { Permissions } from './core/auth/permissions';
import { HrAccess, hrGiveGuard, hrGuard, hrTabGuard, portalHrMatch } from './core/hr/hr-access';
import { portalGuard } from './core/portal/portal-auth';

// HR & Payroll's tabs, the system's and the portal's alike: each guarded by its tab (HrAccess), so
// a typed address opens only a tab held. Opens on the first one held.
const hrChildren: Routes = [
  { path: '', pathMatch: 'full', redirectTo: () => `/hr/${inject(HrAccess).first() ?? 'now'}` },
  {
    // Who is in now, live from the attendance device.
    path: 'now',
    canActivate: [hrTabGuard('Now')],
    loadComponent: () => import('./features/hr/now-page').then((m) => m.NowPage),
  },
  {
    // HR analytics (لوحة التحليلات): attendance, labour cost by department and turnover, for a month
    // or the 3 or 12 to it.
    path: 'analytics',
    canActivate: [hrTabGuard('Analytics')],
    loadComponent: () => import('./features/hr/analytics-page').then((m) => m.AnalyticsPage),
  },
  {
    path: 'employees',
    canActivate: [hrTabGuard('Employees')],
    loadComponent: () => import('./features/hr/employees-page').then((m) => m.EmployeesPage),
  },
  {
    // An employee's profile: their details, ID card and the month's payslip.
    path: 'employees/:employeeId',
    canActivate: [hrTabGuard('Employees')],
    loadComponent: () => import('./features/hr/employee-profile-page').then((m) => m.EmployeeProfilePage),
  },
  {
    path: 'departments',
    canActivate: [hrTabGuard('Departments')],
    loadComponent: () => import('./features/hr/departments-page').then((m) => m.DepartmentsPage),
  },
  {
    // ?date=, or ?employee=&month= for one employee's month.
    path: 'attendance',
    canActivate: [hrTabGuard('Attendance')],
    loadComponent: () => import('./features/hr/attendance-page').then((m) => m.AttendancePage),
  },
  {
    // Shift rostering (جداول الشفتات): a week's grid of who is on which shift, or off. ?week= its
    // first day.
    path: 'roster',
    canActivate: [hrTabGuard('Roster')],
    loadComponent: () => import('./features/hr/roster-page').then((m) => m.RosterPage),
  },
  {
    // ?month= its first day.
    path: 'payroll',
    canActivate: [hrTabGuard('Payroll')],
    loadComponent: () => import('./features/hr/payroll-page').then((m) => m.PayrollPage),
  },
  {
    path: 'payroll/:employeeId',
    canActivate: [hrTabGuard('Payroll')],
    loadComponent: () => import('./features/hr/payslip-page').then((m) => m.PayslipPage),
  },
  {
    // The month's advances, and those handed out with no one named, to give out.
    path: 'advances',
    canActivate: [hrTabGuard('Advances')],
    loadComponent: () => import('./features/hr/hr-advances-page').then((m) => m.HrAdvancesPage),
  },
  {
    // Suspended days for a manager's punch-out, and the month's administrative penalties.
    path: 'corrections',
    canActivate: [hrTabGuard('Corrections')],
    loadComponent: () => import('./features/hr/corrections-page').then((m) => m.CorrectionsPage),
  },
  {
    // Leaves & Holidays (الإجازات والعطلات): the leave requests waiting for a manager and the
    // year's, everyone's balances, the leave types, and the year's public holidays (opening on the
    // workday's).
    path: 'leaves',
    canActivate: [hrTabGuard('Holidays')],
    loadComponent: () => import('./features/hr/leaves-shell').then((m) => m.LeavesShell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'requests' },
      { path: 'requests', loadComponent: () => import('./features/hr/leave-requests-page').then((m) => m.LeaveRequestsPage) },
      { path: 'balances', loadComponent: () => import('./features/hr/leave-balances-page').then((m) => m.LeaveBalancesPage) },
      { path: 'types', loadComponent: () => import('./features/hr/leave-types-page').then((m) => m.LeaveTypesPage) },
      { path: 'holidays', loadComponent: () => import('./features/hr/holidays-page').then((m) => m.HolidaysPage) },
    ],
  },
  // The public holidays' address before they were a part of Leaves & Holidays.
  { path: 'holidays', redirectTo: 'leaves/holidays' },
  {
    path: 'devices',
    canActivate: [hrTabGuard('Devices')],
    loadComponent: () => import('./features/hr/devices-page').then((m) => m.DevicesPage),
  },
  {
    // Employee permissions (صلاحيات الموظفين): who holds which tab; a manager's.
    path: 'permissions',
    canActivate: [hrGiveGuard],
    loadComponent: () => import('./features/hr/permissions-page').then((m) => m.PermissionsPage),
  },
];

// Custody & Assets' pages, the system's and the portal's alike.
const custodyChildren: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'assets' },
  {
    path: 'categories',
    loadComponent: () => import('./features/custody/categories-page').then((m) => m.CategoriesPage),
  },
  {
    path: 'assets',
    loadComponent: () => import('./features/custody/assets-page').then((m) => m.AssetsPage),
  },
  {
    path: 'vouchers',
    loadComponent: () => import('./features/custody/vouchers-page').then((m) => m.VouchersPage),
  },
  {
    // The consumables used up from the store (جرد الاستهلاكيات): their stock, received, used up
    // and counted.
    path: 'consumables',
    loadComponent: () => import('./features/custody/consumables-page').then((m) => m.ConsumablesPage),
  },
];

export const routes: Routes = [
  // The employee portal: the employee's own page, outside the system's shell, so none of its
  // navigation is there; the employee's token reaches /api/portal alone. They sign in on the one
  // sign-in, with their mobile number; /portal, the address they were given, opens it.
  { path: 'portal', pathMatch: 'full', redirectTo: 'sign-in' },
  {
    path: 'my-profile',
    canActivate: [portalGuard],
    loadComponent: () => import('./features/portal/my-profile-page').then((m) => m.MyProfilePage),
  },
  {
    // The HR tabs a manager gave an employee, in the portal: the system's own screens, only
    // theirs, and nothing else of the system around them. /hr is this only while no user is
    // signed in here; for a user it is its own section, below.
    path: 'hr',
    canMatch: [portalHrMatch],
    canActivate: [portalGuard, hrGuard],
    loadComponent: () => import('./features/portal/portal-hr-frame').then((m) => m.PortalHrFrame),
    children: [{ path: '', loadComponent: () => import('./features/hr/hr-shell').then((m) => m.HrShell), children: hrChildren }],
  },
  {
    // Custody & Assets, given as a tab, in the portal the same way.
    path: 'custody',
    canMatch: [portalHrMatch],
    canActivate: [portalGuard, hrTabGuard('Custody')],
    loadComponent: () => import('./features/portal/portal-hr-frame').then((m) => m.PortalHrFrame),
    children: [{ path: '', loadComponent: () => import('./features/custody/custody-shell').then((m) => m.CustodyShell), children: custodyChildren }],
  },
  {
    // Everyone's: a user with their email, an employee with their mobile number.
    path: 'sign-in',
    canActivate: [signedOutGuard],
    loadComponent: () => import('./features/sign-in/sign-in-page').then((m) => m.SignInPage),
  },
  {
    path: '',
    canActivate: [signedInGuard],
    loadComponent: () => import('./features/shell/shell').then((m) => m.Shell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: homePath },
      {
        // HR & Payroll (الموارد البشرية والرواتب): employees, their attendance and their pay; each
        // tab for whoever holds it.
        path: 'hr',
        canActivate: [hrGuard],
        loadComponent: () => import('./features/hr/hr-shell').then((m) => m.HrShell),
        children: hrChildren,
      },
      {
        // Custody & Assets: what the company owns, and whose custody each thing is in; for
        // whoever holds its tab.
        path: 'custody',
        canActivate: [hrTabGuard('Custody')],
        loadComponent: () => import('./features/custody/custody-shell').then((m) => m.CustodyShell),
        children: custodyChildren,
      },
      {
        // A manager's: what accountants have asked for, waiting for a decision.
        path: 'approvals',
        canActivate: [permissionGuard(Permissions.ApprovalDecide)],
        loadComponent: () => import('./features/approvals/approvals-page').then((m) => m.ApprovalsPage),
      },
      {
        // Who signs in to the system; a manager's.
        path: 'users',
        canActivate: [permissionGuard(Permissions.UsersManage)],
        loadComponent: () => import('./features/users/users-page').then((m) => m.UsersPage),
      },
      {
        // Company Settings: the name and logo, the currency, the country, the time zone, the
        // weekends; a manager's.
        path: 'settings',
        canActivate: [permissionGuard(Permissions.SettingsManage)],
        loadComponent: () => import('./features/settings/settings-page').then((m) => m.SettingsPage),
      },
      {
        // Their own account and password; where a user holding no tab lands.
        path: 'account',
        loadComponent: () => import('./features/account/account-page').then((m) => m.AccountPage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
