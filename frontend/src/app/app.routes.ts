import { Routes } from '@angular/router';
import { inject } from '@angular/core';
import { homePath, permissionGuard, signedInGuard, signedOutGuard } from './core/auth/guards';
import { Permissions } from './core/auth/permissions';
import { CostingAccess, costingTabGuard } from './core/costing/costing-tabs';

// Costing & Financials' sections: each guarded by its tab (CostingAccess), so a typed address opens
// only a section the user works. Opens on the first one they do.
const costingChildren: Routes = [
  { path: '', pathMatch: 'full', redirectTo: () => `/costing/${inject(CostingAccess).first() ?? 'approvals'}` },
  {
    path: 'materials',
    canActivate: [costingTabGuard('Materials')],
    loadComponent: () => import('./features/costing/materials-page').then((m) => m.MaterialsPage),
  },
  {
    path: 'recipes',
    canActivate: [costingTabGuard('Recipes')],
    loadComponent: () => import('./features/costing/recipes-shell').then((m) => m.RecipesShell),
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () => import('./features/costing/recipes-page').then((m) => m.RecipesPage),
      },
      {
        // ?targetKind=&catalogItemId=&variantId= to start linked to a menu item.
        path: 'new',
        data: { mode: 'new' },
        loadComponent: () => import('./features/costing/recipe-card-page').then((m) => m.RecipeCardPage),
      },
      {
        path: 'recipe/:recipeId',
        data: { mode: 'view' },
        loadComponent: () => import('./features/costing/recipe-card-page').then((m) => m.RecipeCardPage),
      },
      {
        path: 'recipe/:recipeId/edit',
        data: { mode: 'edit' },
        loadComponent: () => import('./features/costing/recipe-card-page').then((m) => m.RecipeCardPage),
      },
      {
        path: 'prep',
        loadComponent: () => import('./features/costing/prep-items-page').then((m) => m.PrepItemsPage),
      },
      {
        // 'new' for one not saved yet.
        path: 'prep/:id',
        loadComponent: () => import('./features/costing/prep-item-page').then((m) => m.PrepItemPage),
      },
      {
        path: 'categories',
        loadComponent: () => import('./features/costing/recipe-categories-page').then((m) => m.RecipeCategoriesPage),
      },
      // Where production was, under Recipes, before it was a section of its own.
      { path: 'production', redirectTo: '/costing/production' },
      {
        // A menu item's card by its menu numbers (?variantId= for a size): sent on to the recipe it
        // sells by.
        path: ':kind/:id',
        data: { mode: 'menu' },
        loadComponent: () => import('./features/costing/recipe-card-page').then((m) => m.RecipeCardPage),
      },
    ],
  },
  {
    // Production orders: prep items made in batches. ?prepItemId= to start with one chosen.
    path: 'production',
    canActivate: [costingTabGuard('Production')],
    loadComponent: () => import('./features/costing/production-page').then((m) => m.ProductionPage),
  },
  {
    // The menu: categories, items and sizes, add-ons.
    path: 'menu',
    canActivate: [costingTabGuard('Menu')],
    loadComponent: () => import('./features/costing/menu-page').then((m) => m.MenuPage),
  },
  {
    // Sales: entered, imported, refunded and voided.
    path: 'sales',
    canActivate: [costingTabGuard('Sales')],
    loadComponent: () => import('./features/costing/sales-page').then((m) => m.SalesPage),
  },
  {
    // The end of the day: the day's invoices and sales report handed in, for the daily batch and
    // the takings. ?date= to open a day.
    path: 'end-of-day',
    canActivate: [costingTabGuard('EndOfDay')],
    loadComponent: () => import('./features/costing/end-of-day-page').then((m) => m.EndOfDayPage),
  },
  {
    // Material & demand intelligence: prices and their recipe impact, the order planner,
    // theoretical against actual consumption, ABC and days on hand.
    path: 'intelligence',
    canActivate: [costingTabGuard('Intelligence')],
    loadComponent: () => import('./features/costing/intelligence-shell').then((m) => m.IntelligenceShell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'prices' },
      { path: 'prices', loadComponent: () => import('./features/costing/price-variance-page').then((m) => m.PriceVariancePage) },
      { path: 'orders', loadComponent: () => import('./features/costing/order-planner-page').then((m) => m.OrderPlannerPage) },
      { path: 'consumption', loadComponent: () => import('./features/costing/consumption-page').then((m) => m.ConsumptionPage) },
      { path: 'abc', loadComponent: () => import('./features/costing/abc-page').then((m) => m.AbcPage) },
    ],
  },
  {
    path: 'purchases',
    canActivate: [costingTabGuard('Purchases')],
    loadComponent: () => import('./features/costing/purchases-shell').then((m) => m.PurchasesShell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'new' },
      {
        path: 'new',
        loadComponent: () => import('./features/costing/purchases-page').then((m) => m.PurchasesPage),
      },
      {
        path: 'batch',
        loadComponent: () => import('./features/costing/purchase-batch-page').then((m) => m.PurchaseBatchPage),
      },
      {
        path: 'invoices',
        loadComponent: () => import('./features/costing/invoices-page').then((m) => m.InvoicesPage),
      },
      {
        path: 'invoices/:id',
        loadComponent: () => import('./features/costing/invoice-page').then((m) => m.InvoicePage),
      },
      {
        path: 'suppliers',
        loadComponent: () => import('./features/costing/suppliers-page').then((m) => m.SuppliersPage),
      },
      { path: 'spending', redirectTo: '/costing/reports/spending' },
      { path: 'expense-items', redirectTo: '/costing/expense-items' },
      {
        path: 'categories',
        loadComponent: () => import('./features/costing/purchase-categories-page').then((m) => m.PurchaseCategoriesPage),
      },
    ],
  },
  { path: 'invoices', pathMatch: 'full', redirectTo: 'purchases/invoices' },
  { path: 'invoices/:id', redirectTo: 'purchases/invoices/:id' },
  {
    // General expenses (OPEX): bought, never stock.
    path: 'expense-items',
    canActivate: [costingTabGuard('ExpenseItems')],
    loadComponent: () => import('./features/costing/expense-items-page').then((m) => m.ExpenseItemsPage),
  },
  {
    path: 'counts',
    canActivate: [costingTabGuard('Counts')],
    loadComponent: () => import('./features/costing/counts-page').then((m) => m.CountsPage),
  },
  {
    path: 'counts/:id',
    canActivate: [costingTabGuard('Counts')],
    loadComponent: () => import('./features/costing/count-sheet-page').then((m) => m.CountSheetPage),
  },
  {
    path: 'waste',
    canActivate: [costingTabGuard('Waste')],
    loadComponent: () => import('./features/costing/waste-page').then((m) => m.WastePage),
  },
  {
    // Financials (الماليات): the safe, its funding, takings, expense vouchers, what suppliers are owed
    // and paid, the staff it pays and their advances, the tax and service.
    path: 'financials',
    canActivate: [costingTabGuard('Financials')],
    loadComponent: () => import('./features/costing/financials-shell').then((m) => m.FinancialsShell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'safe' },
      { path: 'safe', loadComponent: () => import('./features/costing/safe-page').then((m) => m.SafePage) },
      { path: 'funding', loadComponent: () => import('./features/costing/funding-page').then((m) => m.FundingPage) },
      { path: 'reconciliation', loadComponent: () => import('./features/costing/reconciliation-page').then((m) => m.ReconciliationPage) },
      { path: 'daily-cash', loadComponent: () => import('./features/costing/daily-cash-page').then((m) => m.DailyCashPage) },
      { path: 'expenses', loadComponent: () => import('./features/costing/expense-vouchers-page').then((m) => m.ExpenseVouchersPage) },
      {
        // ?supplier= for one supplier's statement of account.
        path: 'suppliers',
        loadComponent: () => import('./features/costing/supplier-debts-page').then((m) => m.SupplierDebtsPage),
      },
      { path: 'payments', loadComponent: () => import('./features/costing/supplier-payments-page').then((m) => m.SupplierPaymentsPage) },
      { path: 'advances', loadComponent: () => import('./features/costing/advances-page').then((m) => m.AdvancesPage) },
      { path: 'staff', loadComponent: () => import('./features/costing/staff-page').then((m) => m.StaffPage) },
      { path: 'tax-service', loadComponent: () => import('./features/costing/tax-service-page').then((m) => m.TaxServicePage) },
    ],
  },
  {
    // Reports (التقارير): where the money went, the safe's money in and out, and the food cost reports.
    path: 'reports',
    canActivate: [costingTabGuard('Reports')],
    loadComponent: () => import('./features/costing/costing-reports-shell').then((m) => m.CostingReportsShell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'spending' },
      { path: 'spending', loadComponent: () => import('./features/costing/spending-page').then((m) => m.SpendingPage) },
      { path: 'treasury', loadComponent: () => import('./features/costing/treasury-page').then((m) => m.TreasuryPage) },
      { path: 'theoretical', loadComponent: () => import('./features/costing/theoretical-page').then((m) => m.TheoreticalPage) },
      { path: 'variance', loadComponent: () => import('./features/costing/variance-page').then((m) => m.VariancePage) },
      { path: 'kpis', loadComponent: () => import('./features/costing/kpis-page').then((m) => m.KpisPage) },
      { path: 'break-even', loadComponent: () => import('./features/costing/break-even-page').then((m) => m.BreakEvenPage) },
    ],
  },
  { path: 'theoretical', redirectTo: 'reports/theoretical' },
  { path: 'variance', redirectTo: 'reports/variance' },
  { path: 'kpis', redirectTo: 'reports/kpis' },
  { path: 'break-even', redirectTo: 'reports/break-even' },
  {
    // The cost targets, beverage categories, shared costs and monthly expenses.
    path: 'settings',
    canActivate: [costingTabGuard('CostSettings')],
    loadComponent: () => import('./features/costing/settings-page').then((m) => m.SettingsPage),
  },
  {
    // What waits for a manager: everyone who enters things sees their own; a manager decides.
    path: 'approvals',
    canActivate: [permissionGuard(Permissions.InventoryManage)],
    loadComponent: () => import('./features/costing/approvals-page').then((m) => m.ApprovalsPage),
  },
  {
    // Who works which section; a manager's.
    path: 'permissions',
    canActivate: [permissionGuard(Permissions.UsersManage)],
    loadComponent: () => import('./features/costing/permissions-page').then((m) => m.PermissionsPage),
  },
];

export const routes: Routes = [
  {
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
        // Costing & Financials (التكاليف والماليات): each section for whoever works it.
        path: 'costing',
        loadComponent: () => import('./features/costing/costing-shell').then((m) => m.CostingShell),
        children: costingChildren,
      },
      {
        // Who signs in to the system; a manager's.
        path: 'users',
        canActivate: [permissionGuard(Permissions.UsersManage)],
        loadComponent: () => import('./features/users/users-page').then((m) => m.UsersPage),
      },
      {
        // Company Settings: the name and logo, the currency, the country, the time zone; a manager's.
        path: 'settings',
        canActivate: [permissionGuard(Permissions.SettingsManage)],
        loadComponent: () => import('./features/settings/settings-page').then((m) => m.SettingsPage),
      },
      {
        // The link to the restaurant's POS: its key and the log of its calls; a manager's.
        path: 'settings/pos-integration',
        canActivate: [permissionGuard(Permissions.SettingsManage)],
        loadComponent: () => import('./features/settings/pos-integration-page').then((m) => m.PosIntegrationPage),
      },
      {
        // Their own account and password; where a user working no section lands.
        path: 'account',
        loadComponent: () => import('./features/account/account-page').then((m) => m.AccountPage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
