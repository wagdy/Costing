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
    hint: { en: 'Price variance, the order planner, theoretical vs actual usage, ABC', ar: 'انحراف الأسعار وتخطيط الطلبيات والاستهلاك وتصنيف ABC' },
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
