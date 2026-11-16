import { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { Permissions } from '../../core/auth/permissions';
import { ApAgingReport, CostingApi, MaterialCost, StaffMealReport, SupplierAccount } from '../../core/costing/costing.api';
import { InflationReport, IntelligenceApi, VendorPriceReport } from '../../core/costing/intelligence.api';
import { NotifyService } from '../../core/ui/notify.service';
import { ApAgingPage } from './ap-aging-page';
import { Approvals } from './approvals';
import { InflationPage } from './inflation-page';
import { InvoiceViewDialog } from './invoice-view-dialog';
import { StaffMealsPage } from './staff-meals-page';
import { SupplierStatementDialog } from './supplier-statement-dialog';
import { VendorPricesPage } from './vendor-prices-page';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();
const cells = (row: Element) => [...row.querySelectorAll(':scope > td')].map(text);

const open = vi.fn();
const recordStaffMeal = vi.fn();
const simulateInflation = vi.fn();

async function render<T>(component: Type<T>, costing: Record<string, unknown>, intelligence: Record<string, unknown> = {}, data?: unknown) {
  open.mockReset();
  TestBed.configureTestingModule({
    providers: [
      { provide: CostingApi, useValue: costing },
      { provide: IntelligenceApi, useValue: intelligence },
      { provide: MatDialog, useValue: { open } },
      { provide: NotifyService, useValue: { info: vi.fn(), error: vi.fn() } },
      { provide: AuthService, useValue: { me: () => null, can: (p: string) => p === Permissions.InventoryManage } },
      { provide: Approvals, useValue: { refresh: vi.fn(), pendingFor: () => undefined, delete: vi.fn(() => Promise.resolve('Applied')) } },
      ...(data ? [{ provide: MAT_DIALOG_DATA, useValue: data }] : []),
    ],
  });
  const fixture = TestBed.createComponent(component);
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, page: fixture.componentInstance as unknown as Record<string, any> };
}

const aging: ApAgingReport = {
  asOf: '2026-11-16', totalOwed: 5300, current: 3000, days1To30: 2000, days31To60: 0, days61To90: 0, over90: 300,
  rows: [{
    supplierId: 's1', supplier: 'Nile Farms', paymentTermsDays: 30, totalOwed: 5300, current: 3000, days1To30: 2000, days31To60: 0, days61To90: 0,
    over90: 300, openInvoices: 3, oldestDueDate: '2026-08-08',
  }],
};

describe('AP aging (أعمار ديون الموردين)', () => {
  it('splits what is owed by how late it is, and opens a supplier\'s statement', async () => {
    const apAging = vi.fn(() => of(aging));
    const { el } = await render(ApAgingPage, { apAging });

    expect(apAging).toHaveBeenCalledWith(null);
    expect([...el.querySelectorAll('.tile strong')].map(text)).toEqual(['L.E 5,300.00', 'L.E 3,000.00', 'L.E 2,000.00', 'L.E 0.00', 'L.E 0.00', 'L.E 300.00']);
    expect(el.querySelector('.tile.oldest')).not.toBeNull();
    const row = el.querySelector('table.aging tbody tr')!;
    expect(cells(row)).toEqual([
      'Nile Farmspays in 30 days · 3 open', 'L.E 5,300.00', 'L.E 3,000.00', 'L.E 2,000.00', '—', '—', 'L.E 300.00', '8 Aug 2026',
    ]);
    (row as HTMLElement).click();
    expect(open).toHaveBeenCalledWith(SupplierStatementDialog, expect.objectContaining({ data: { supplierId: 's1', supplier: 'Nile Farms' } }));
  });
});

const account: SupplierAccount = {
  supplierId: 's1', supplier: 'Nile Farms', paymentTermsDays: 30, from: '2026-09-17', to: '2026-11-16', openingBalance: 1500, creditInvoices: 5000,
  cashInvoices: 400, payments: 1200, closingBalance: 5300, owedBefore: 0, openInvoices: [],
  lines: [
    { id: 'l1', date: '2026-09-27', kind: 'CreditInvoice', reference: 'Invoice F-2', description: 'Invoice on credit · فاتورة آجل', paid: 0, owed: 2000, balance: 3500, sourceId: 'f2', isReversal: false, recordedBy: 'Omar', approvedBy: null, fromTakingsOf: null, notes: null },
    { id: 'l2', date: '2026-11-16', kind: 'Payment', reference: 'Payment voucher', description: 'Payment, from the safe · من الخزنة', paid: 1200, owed: 0, balance: 2300, sourceId: 'p1', isReversal: false, recordedBy: 'Mona', approvedBy: 'Omar', fromTakingsOf: null, notes: 'Cheque 44' },
  ],
};

describe('a supplier\'s statement of account (كشف حساب مورد)', () => {
  it('runs the balance from what was owed coming in, and opens each document', async () => {
    const supplierAccount = vi.fn((_id: string, _from: string, _to: string) => of(account));
    const { fixture, el, page } = await render(SupplierStatementDialog, { supplierAccount, supplierAccountSheet: vi.fn(() => of(new Blob())) }, {},
      { supplierId: 's1', supplier: 'Nile Farms' });

    expect(supplierAccount.mock.lastCall![0]).toBe('s1');
    expect([...el.querySelectorAll('.tile strong')].map(text)).toEqual(['L.E 1,500.00', 'L.E 5,000.00', 'L.E 400.00', 'L.E 1,200.00', 'L.E 5,300.00']);
    const rows = [...el.querySelectorAll('table.statement tbody tr')];
    expect(cells(rows[0]).slice(1)).toEqual(['Opening balance · رصيد أول المدة', 'L.E 1,500.00']);
    expect(cells(rows[1]).slice(2)).toEqual(['Invoice on credit · فاتورة آجل', '', 'L.E 2,000.00', 'L.E 3,500.00']);

    // An invoice opens over it; a payment shows its voucher's details in place.
    rows[1].querySelector('button')!.click();
    expect(open).toHaveBeenCalledWith(InvoiceViewDialog, expect.objectContaining({ data: { invoiceId: 'f2' } }));
    page['open'](account.lines[1]);
    fixture.detectChanges();
    expect(text(el.querySelector('tr.voucher')!)).toBe('Recorded by Mona, approved by Omar · from the safe · Cheque 44');
    // The columns add up: a cash invoice is paid and owed at once.
    expect(cells(el.querySelector('table.statement tfoot tr')!).slice(1)).toEqual(['L.E 1,600.00', 'L.E 5,400.00', 'L.E 5,300.00']);
  });

  it('adds what was owed before the treasury, entered in the period, like an invoice', async () => {
    const before = { ...account, openingBalance: 1000, owedBefore: 500 };
    const { el } = await render(SupplierStatementDialog, { supplierAccount: vi.fn(() => of(before)), supplierAccountSheet: vi.fn() }, {},
      { supplierId: 's1', supplier: 'Nile Farms' });
    expect([...el.querySelectorAll('.tile .label')].map(text)[1]).toBe('+ Owed before the treasury · رصيد سابق');
    expect([...el.querySelectorAll('.tile strong')].map(text)).toEqual(['L.E 1,000.00', 'L.E 500.00', 'L.E 5,000.00', 'L.E 400.00', 'L.E 1,200.00', 'L.E 5,300.00']);
    expect(cells(el.querySelector('table.statement tfoot tr')!).slice(1)).toEqual(['L.E 1,600.00', 'L.E 5,900.00', 'L.E 5,300.00']);
  });
});

const vendors: VendorPriceReport = {
  from: '2026-08-16', to: '2026-11-16', materials: 1, withChoice: 1,
  rows: [{
    rawMaterialId: 't', code: null, material: 'Tomatoes', categoryId: 'veg', category: 'Vegetables', categoryAr: null, purchaseUnit: 'kg', spreadPercent: 150,
    suppliers: [
      { supplierId: 'd', supplier: 'Delta Farms', lastPrice: 80, lastDate: '2026-11-11', lowestPrice: 80, highestPrice: 80, averagePrice: 80, quantity: 10, purchases: 1, bestPrice: true },
      { supplierId: 'n', supplier: 'Nile Farms', lastPrice: 200, lastDate: '2026-11-16', lowestPrice: 100, highestPrice: 300, averagePrice: 200, quantity: 32, purchases: 4, bestPrice: false },
    ],
  }],
};

describe('the vendor price matrix (مقارنة أسعار الموردين)', () => {
  it('lists each supplier of a material cheapest first, the best marked', async () => {
    const { el } = await render(VendorPricesPage, {}, { vendorPrices: vi.fn(() => of(vendors)), vendorPricesSheet: vi.fn() });
    const rows = [...el.querySelectorAll('table.vendors tbody tr')];
    expect(rows.map((r) => r.querySelector('td:not(.material)')!.textContent!.trim())).toEqual(['Delta Farms', 'Nile Farms']);
    expect(text(rows[0].querySelector('td.material')!)).toBe('Tomatoes Vegetables · per kg +150% spread');
    expect(text(rows[0].querySelector('.best-badge')!)).toBe('verified Best price · الأقل سعراً');
    expect(rows[1].querySelector('.best-badge')).toBeNull();
    expect(cells(rows[1])).toEqual(['Nile Farms', 'L.E 200.00', '16 Nov 2026', 'L.E 100.00', 'L.E 300.00', 'L.E 200.00', '32 · 4×', '']);
  });

  it('marks no best price where there is no choice of supplier', async () => {
    const single: VendorPriceReport = { ...vendors, withChoice: 0, rows: [{ ...vendors.rows[0], spreadPercent: null, suppliers: [vendors.rows[0].suppliers[0]] }] };
    const { el } = await render(VendorPricesPage, {}, { vendorPrices: vi.fn(() => of(single)), vendorPricesSheet: vi.fn() });
    expect(el.querySelectorAll('table.vendors tbody tr').length).toBe(1);
    expect(el.querySelector('.best-badge')).toBeNull();
    expect(el.querySelector('tr.best')).toBeNull();
  });
});

const meals: StaffMealReport = {
  from: '2026-11-01', to: '2026-11-16', dailyBudget: 30, staffMeals: 40, hospitality: 20, recipeTasting: 0, daysOverBudget: 1,
  days: [{ date: '2026-11-16', staffMeals: 40, hospitality: 20, recipeTasting: 0, overBudget: true }],
  entries: [{
    entryId: 'e1', kind: 'StaffMeal', date: '2026-11-16', recordedAtUtc: '2026-11-16T12:00:00Z', recordedBy: 'Omar', note: '2 × Burger · Lunch',
    lines: [{ rawMaterialId: 'patty', material: 'Patty', purchaseUnit: 'piece', quantity: 2, value: 40, note: '2 × Burger · Lunch' }], value: 40,
  }],
};
const patty = { id: 'patty', name: 'Patty', code: null, unit: 'Piece', purchaseUnit: 'piece', purchaseUnitSize: 1, kind: 'Purchased' } as unknown as MaterialCost;

describe('staff meals & hospitality (وجبات العاملين والضيافة)', () => {
  it('sets each day\'s staff meals against the budget, and logs a dish or a material apart from waste', async () => {
    recordStaffMeal.mockReset().mockReturnValue(of({ entryId: 'e2' }));
    const { el, page } = await render(StaffMealsPage, {
      staffMeals: vi.fn(() => of(meals)), recordStaffMeal, materials: () => of([patty]),
      recipes: () => of([{ recipeId: 'r1', recipe: 'Burger', itemCode: '1', category: 'Mains', isDeleted: false }]),
    });

    expect([...el.querySelectorAll('.tile strong')].map(text)).toEqual(['L.E 40.00', 'L.E 20.00', 'L.E 0.00', '1']);
    expect(text(el.querySelector('table.days .over-badge')!)).toBe('warning Over budget · تجاوز الحد (+L.E 10.00)');
    expect(cells(el.querySelector('table.entries tbody tr')!).slice(1, 3)).toEqual(['restaurant Staff meal', '2 × Burger · LunchPatty 2 piece']);

    // Two burgers by their recipe, and a patty given to a guest, in one entry of hospitality.
    page['kind'].set('Hospitality');
    page['change'](0, { recipeId: 'r1', quantity: 2 });
    page['add']();
    page['change'](1, { by: 'material', rawMaterialId: 'patty', quantity: 1 });
    expect(page['valid']()).toBe(true);
    page['change'](0, { quantity: 1.5 });
    expect(page['valid']()).toBe(false);
    page['change'](0, { quantity: 2 });
    await page['record']();
    expect(recordStaffMeal).toHaveBeenCalledWith({
      entryId: expect.any(String), kind: 'Hospitality', note: null,
      lines: [{ rawMaterialId: null, recipeId: 'r1', quantity: 2 }, { rawMaterialId: 'patty', recipeId: null, quantity: 1 }],
    });
  });
});

const simulation: InflationReport = {
  salesFrom: '2026-10-18', salesTo: '2026-11-16', foodCostTargetPercent: 30, materialsChanged: 2, dishes: 1, newlyAboveTarget: 1, monthlyProfitImpact: -525,
  materials: [],
  items: [
    {
      kind: 'Dish', itemCode: '1', recipeId: 'r1', prepItemId: null, name: 'Burger', category: 'Mains', unit: 'portion', sellingPrice: 120, currentCost: 35,
      simulatedCost: 52.5, change: 17.5, changePercent: 50, currentFoodCostPercent: 29.2, simulatedFoodCostPercent: 43.8, aboveTarget: true, newlyAboveTarget: true,
      suggestedPriceKeepFoodCost: 180, suggestedPriceKeepMargin: 137.5, quantityLast30Days: 30, monthlyProfitImpact: -525,
    },
    {
      kind: 'PrepItem', itemCode: '', recipeId: null, prepItemId: 'd', name: 'Dough', category: 'Prep item · مصنّع', unit: 'kg', sellingPrice: null, currentCost: 25,
      simulatedCost: 30, change: 5, changePercent: 20, currentFoodCostPercent: null, simulatedFoodCostPercent: null, aboveTarget: false, newlyAboveTarget: false,
      suggestedPriceKeepFoodCost: null, suggestedPriceKeepMargin: null, quantityLast30Days: 0, monthlyProfitImpact: null,
    },
  ],
};

describe('the inflation & pricing simulator (محاكي التضخم والتسعير)', () => {
  it('costs every dish again at the prices tried, the most specific rule first, and saves nothing', async () => {
    simulateInflation.mockReset().mockReturnValue(of(simulation));
    const { fixture, el, page } = await render(InflationPage, { materials: () => of([{ ...patty, categoryId: 'meat', category: 'Meat' }]) },
      { simulateInflation, simulateInflationSheet: vi.fn() });

    expect(simulateInflation).toHaveBeenCalledWith({ globalPercent: null, categories: [], materials: [] });
    expect([...el.querySelectorAll('.tile strong')].map(text)).toEqual(['L.E -525.00', '1', '2', '1']);
    const row = el.querySelector('table.simulated tbody tr')!;
    expect(row.classList).toContain('breach');
    expect(cells(row)).toEqual([
      'Burger1 · Mains · per portion', 'L.E 120.00', 'L.E 35.00 → L.E 52.50', '+L.E 17.50 +50.0%', '29.2% → 43.8%error Over target · تجاوز',
      'L.E 180.00', 'L.E 137.50', 'L.E -525.00 30 sold',
    ]);

    // A global %, a category's, and a material's own price: sent as typed, after a pause.
    page['global'].set(10);
    page['addCategory']();
    page['patchCategory'](0, { categoryId: 'meat', percent: 20 });
    page['addMaterial']();
    page['patchMaterial'](0, { rawMaterialId: 'patty', price: 30 });
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(simulateInflation).toHaveBeenLastCalledWith({
      globalPercent: 10, categories: [{ categoryId: 'meat', percent: 20 }], materials: [{ rawMaterialId: 'patty', costPerPurchaseUnit: 30 }],
    });

    // The prep items apart.
    page['kind'].set('PrepItem');
    fixture.detectChanges();
    expect(cells(el.querySelector('table.simulated tbody tr')!)).toEqual(['DoughPrep item · مصنّع · per kg', '—', 'L.E 25.00 → L.E 30.00', '+L.E 5.00 +20.0%']);
  });
});
