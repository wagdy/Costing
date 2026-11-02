import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Route, provideRouter } from '@angular/router';
import { routes } from '../../app.routes';
import { Permissions } from '../../core/auth/permissions';
import { CostingAccess, CostingTab } from '../../core/costing/costing-tabs';
import { Approvals } from './approvals';
import { CostingShell } from './costing-shell';
import { CostingReportsShell } from './costing-reports-shell';
import { AuthService } from '../../core/auth/auth.service';
import { Treasury } from './financials';
import { PurchasesShell } from './purchases-shell';

// The route of that path, anywhere under these.
function find(list: Route[] | undefined, path: string): Route | undefined {
  for (const route of list ?? []) {
    if (route.path === path) {
      return route;
    }
    const inside = find(route.children, path);
    if (inside) {
      return inside;
    }
  }
  return undefined;
}

describe('the costing navigation', () => {
  it('gives the expense items a tab of their own, and sends their old address under Purchases there', () => {
    const costing = find(routes, 'costing')!;
    const own = costing.children!.find((r) => r.path === 'expense-items')!;
    expect(own.loadComponent).toBeDefined();

    const purchases = costing.children!.find((r) => r.path === 'purchases')!;
    expect(purchases.children!.find((r) => r.path === 'expense-items')!.redirectTo).toBe('/costing/expense-items');
  });

  it('gathers the reports under Reports, the spending first, and sends their old addresses there', () => {
    const costing = find(routes, 'costing')!;
    const reports = costing.children!.find((r) => r.path === 'reports')!;
    expect(reports.loadComponent).toBeDefined();
    expect(reports.children!.map((r) => [r.path, r.redirectTo ?? (r.loadComponent ? 'page' : undefined)])).toEqual([
      ['', 'spending'],
      ['spending', 'page'],
      ['theoretical', 'page'],
      ['variance', 'page'],
      ['kpis', 'page'],
      ['break-even', 'page'],
    ]);

    for (const old of ['theoretical', 'variance', 'kpis', 'break-even']) {
      expect(costing.children!.find((r) => r.path === old)).toEqual({ path: old, redirectTo: `reports/${old}` });
    }
    const purchases = costing.children!.find((r) => r.path === 'purchases')!;
    expect(purchases.children!.find((r) => r.path === 'spending')!.redirectTo).toBe('/costing/reports/spending');
  });

  it('lists the sections a user works in the sidebar, then Approvals and Permissions for whoever has them', async () => {
    const shell = async (tabs: CostingTab[], can: (p: string) => boolean) => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          provideRouter([]),
          { provide: AuthService, useValue: { me: () => null, can } },
          { provide: CostingAccess, useValue: { has: (t: CostingTab) => tabs.includes(t) } },
          { provide: Approvals, useValue: { canApprove: () => true, pending: signal([{}, {}]), refresh: vi.fn() } },
        ],
      });
      const fixture = TestBed.createComponent(CostingShell);
      await fixture.whenStable();
      return (fixture.componentInstance as unknown as Record<string, any>)['sections']() as { path: string; en: string; ar: string; count?: number }[];
    };

    const manager = await shell(
      ['Materials', 'Recipes', 'Production', 'Menu', 'Sales', 'Purchases', 'ExpenseItems', 'Counts', 'Waste', 'Financials', 'Reports', 'CostSettings'],
      () => true,
    );
    expect(manager.map((s) => s.path)).toEqual([
      'materials', 'recipes', 'production', 'menu', 'sales', 'purchases', 'expense-items', 'counts', 'waste', 'financials', 'reports', 'settings',
      'approvals', 'permissions',
    ]);
    expect(manager.find((s) => s.path === 'approvals')).toMatchObject({ en: 'Approvals', ar: 'طلبات معلقة', count: 2 });

    // A storekeeper: the stock, and what they asked for; no Permissions.
    const storekeeper = await shell(['Materials', 'Purchases', 'Counts', 'Waste', 'Production'], (p) => p !== Permissions.UsersManage);
    expect(storekeeper.map((s) => s.path)).toEqual(['materials', 'production', 'purchases', 'counts', 'waste', 'approvals']);
  });

  it('opens Reports on the spending analysis, then the food cost reports', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(CostingReportsShell);
    await fixture.whenStable();
    fixture.detectChanges();

    // Its address, icon, and name in English and Arabic.
    const link = (a: Element) => [
      a.getAttribute('href'),
      a.querySelector('mat-icon')!.textContent!.trim(),
      a.querySelector('.en')!.textContent!.trim(),
      a.querySelector('.ar')!.textContent!.trim(),
    ];
    expect([...(fixture.nativeElement as HTMLElement).querySelectorAll('nav a')].map(link)).toEqual([
      ['/spending', 'pie_chart', 'Spending analysis', 'تحليل الإنفاق'],
      ['/theoretical', 'calculate', 'Theoretical cost', 'التكلفة النظرية'],
      ['/variance', 'compare_arrows', 'Variance', 'الانحراف'],
      ['/kpis', 'insights', 'KPIs', 'المؤشرات'],
      ['/break-even', 'balance', 'Break-even', 'نقطة التعادل'],
    ]);
  });

  it('keeps Purchases to buying: no expense items or spending there, and the categories called simply Categories', async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AuthService, useValue: { me: () => null, can: () => true } }, { provide: Treasury, useValue: { enter: vi.fn() } }],
    });
    const fixture = TestBed.createComponent(PurchasesShell);
    await fixture.whenStable();
    const tabs = (fixture.componentInstance as unknown as Record<string, any>)['tabs'] as { path: string; en: string; ar: string }[];

    expect(tabs.map((t) => t.path)).toEqual(['new', 'batch', 'invoices', 'suppliers', 'categories']);
    expect(tabs.find((t) => t.path === 'categories')).toMatchObject({ en: 'Categories', ar: 'الأقسام' });
  });

  it('pays an employee advance from Purchases in the dialog Financials does, for whoever works Financials', async () => {
    const enter = vi.fn().mockResolvedValue(true);
    const has = vi.fn(() => true);
    const can = () => true;
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { me: () => null, can } },
        { provide: CostingAccess, useValue: { has } },
        { provide: Treasury, useValue: { enter } },
      ],
    });
    const fixture = TestBed.createComponent(PurchasesShell);
    fixture.detectChanges();
    const button = () => [...(fixture.nativeElement as HTMLElement).querySelectorAll('nav button')].find((b) => b.textContent!.includes('New advance'));

    (button() as HTMLButtonElement).click();
    expect(enter).toHaveBeenCalledWith('EmployeeAdvance');
    TestBed.resetTestingModule();

    has.mockReturnValue(false);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { me: () => null, can } },
        { provide: CostingAccess, useValue: { has } },
        { provide: Treasury, useValue: { enter } },
      ],
    });
    const viewer = TestBed.createComponent(PurchasesShell);
    viewer.detectChanges();
    expect([...(viewer.nativeElement as HTMLElement).querySelectorAll('nav button')].length).toBe(0);
  });
});
