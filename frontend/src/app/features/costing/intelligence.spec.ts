import { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { CostingAccess, CostingTab } from '../../core/costing/costing-tabs';
import {
  AbcReport,
  ConsumptionReport,
  IntelligenceApi,
  MenuEngineeringReport,
  MenuEngineeringRow,
  OrderPlan,
  OrderPlanLine,
  PriceVarianceReport,
  PriceVarianceRow,
} from '../../core/costing/intelligence.api';
import { NotifyService } from '../../core/ui/notify.service';
import { AbcPage } from './abc-page';
import { ConsumptionPage } from './consumption-page';
import { InvoiceViewDialog } from './invoice-view-dialog';
import { MenuEngineeringPage } from './menu-engineering-page';
import { OrderPlannerPage } from './order-planner-page';
import { PriceVariancePage } from './price-variance-page';
import { StockCardDialog } from './stock-card-dialog';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();
const cells = (row: Element) => [...row.querySelectorAll(':scope > td')].map(text);

// The dialogs the reports open (an invoice, a stock card), and the tabs the user works.
const dialogOpen = vi.fn();
let tabs: CostingTab[] = ['Intelligence', 'Purchases'];

async function render<T>(component: Type<T>, api: Partial<Record<keyof IntelligenceApi, unknown>>) {
  dialogOpen.mockReset();
  TestBed.configureTestingModule({
    providers: [
      { provide: IntelligenceApi, useValue: api },
      { provide: NotifyService, useValue: { info: vi.fn(), error: vi.fn() } },
      { provide: MatDialog, useValue: { open: dialogOpen } },
      { provide: CostingAccess, useValue: { has: (tab: CostingTab) => tabs.includes(tab) } },
    ],
  });
  const fixture = TestBed.createComponent(component);
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, page: fixture.componentInstance as unknown as Record<string, any> };
}

function priceRow(overrides: Partial<PriceVarianceRow>): PriceVarianceRow {
  return {
    rawMaterialId: 'm', code: null, material: 'M', categoryId: 'veg', category: 'Vegetables', categoryAr: 'خضار', purchaseUnit: 'kg',
    baselineCost: 20, latestCost: 20, unitVariance: 0, changePercent: 0, quantityPurchased: 1, impact: 0, invoices: 1, latestPurchasedOn: '2026-10-05',
    latestSupplierId: 'nile', latestSupplier: 'Nile Farms', supplierIds: ['nile'], affected: [], latestInvoiceId: 'inv-latest', ...overrides,
  };
}

// Tomatoes up from 20 to 25 a kilo, 5 kg bought: 25 more paid, the sauce and the burger costing more.
const prices: PriceVarianceReport = {
  from: '2026-10-01', to: '2026-10-31', totalImpact: 25, increases: 25, decreases: 0, rising: 1, falling: 0, affectedDishes: 1,
  largestRise: 'Tomatoes', largestRisePercent: 25,
  rows: [
    priceRow({
      rawMaterialId: 'tomatoes', code: 'ING-7', material: 'Tomatoes', latestCost: 25, unitVariance: 5, changePercent: 25, quantityPurchased: 5, impact: 25,
      affected: [
        { kind: 'PrepItem', id: 'sauce', name: 'Pizza sauce', nameAr: null, per: 'kg', quantity: 1, costChange: 5, against: 21.67, points: 23.1 },
        { kind: 'Dish', id: 'burger', name: 'Burger', nameAr: 'برجر', per: 'portion', quantity: 0.1, costChange: 0.5, against: 120, points: 0.4 },
      ],
    }),
    priceRow({ rawMaterialId: 'rice', material: 'Rice', categoryId: 'dry', category: 'Dry goods', categoryAr: null, supplierIds: ['delta'], latestSupplier: 'Delta' }),
  ],
  categories: [{ id: 'dry', name: 'Dry goods', nameAr: null }, { id: 'veg', name: 'Vegetables', nameAr: 'خضار' }],
  suppliers: [{ id: 'delta', name: 'Delta', nameAr: null }, { id: 'nile', name: 'Nile Farms', nameAr: null }],
};

describe('purchase price variance', () => {
  const api = { prices: vi.fn((_from: string, _to: string) => of(prices)), pricesSheet: vi.fn((_from: string, _to: string, _filter: object) => of(new Blob(['x']))) };

  beforeEach(() => {
    api.prices.mockClear();
    api.pricesSheet.mockClear();
    URL.createObjectURL = vi.fn(() => 'blob:sheet');
    URL.revokeObjectURL = vi.fn();
  });

  it('shows what the prices did, and opened, what each change does to the dishes and prep items', async () => {
    const { fixture, el, page } = await render(PriceVariancePage, api);

    expect(api.prices.mock.lastCall![0]).toMatch(/^\d{4}-\d{2}-01$/);
    expect([...el.querySelectorAll('.tile strong')].map(text)).toEqual(['L.E 25.00', '1', '0', '1', '+25.0%']);
    const rows = [...el.querySelectorAll('tbody tr.row')];
    expect(cells(rows[0])).toEqual([
      'expand_moreTomatoesING-7 · per kg · Vegetables', 'L.E 20.00', 'L.E 25.00', '+L.E 5.00 +25.0%', '5 kg', 'L.E 25.00', '2',
    ]);

    (rows[0] as HTMLElement).click();
    fixture.detectChanges();
    const detail = el.querySelector('tr.detail')!;
    expect(text(detail.querySelector('.supplier')!)).toContain('Latest from Nile Farms, 5 Oct 2026 · 1 invoice in these days');
    expect([...detail.querySelectorAll('.affected tbody tr')].map(cells)).toEqual([
      ['Prep item · مُصنّع Pizza sauce', '1 kg / kg', '+L.E 5.00 / kg', 'L.E 21.67', '+23.1%'],
      ['Dish · طبق Burger برجر', '0.1 kg / portion', '+L.E 0.50 / portion', 'L.E 120.00', '+0.4 pts'],
    ]);
  });

  it('keeps each card to its figure, its (ⓘ) saying what it is and how it is worked out', async () => {
    const { el } = await render(PriceVariancePage, api);
    expect(el.querySelectorAll('.tile small.muted').length).toBe(0);
    expect(el.querySelector('.note')).toBeNull();
    expect([...el.querySelectorAll('.tile app-info-tip button')].map((b) => b.getAttribute('aria-label'))).toEqual([
      'About Financial impact · الأثر المالي للانحراف',
      'About Prices up · ارتفاع الأسعار',
      'About Prices down · انخفاض الأسعار',
      'About Dishes affected · الأطباق المتأثرة',
      'About Largest rise · أعلى ارتفاع',
    ]);
    expect([...el.querySelectorAll('.tile .chip')].map(text)).toEqual(['+L.E 25.00', '−L.E 0.00', 'Tomatoes']);
    expect([...el.querySelectorAll('thead app-info-tip button')].map((b) => b.getAttribute('aria-label'))).toEqual([
      'About Baseline avg · متوسط السعر السابق',
      'About Latest net · آخر سعر شراء صافي',
      'About Change · فرق السعر ونسبة التغير',
      'About Impact · الأثر المالي',
    ]);
  });

  it('opens the latest price’s invoice, its material marked, and the material’s stock card over the period', async () => {
    const { fixture, el, page } = await render(PriceVariancePage, api);
    el.querySelector<HTMLButtonElement>('[aria-label="Open the invoice of the latest price of Tomatoes"]')!.click();
    expect(dialogOpen).toHaveBeenCalledExactlyOnceWith(InvoiceViewDialog, expect.objectContaining({ data: { invoiceId: 'inv-latest', highlightMaterialId: 'tomatoes' } }));
    // Not a click on the row: it stays closed.
    fixture.detectChanges();
    expect(el.querySelector('tr.detail')).toBeNull();

    el.querySelector<HTMLButtonElement>('[aria-label="Stock card of Tomatoes"]')!.click();
    expect(dialogOpen).toHaveBeenLastCalledWith(
      StockCardDialog,
      expect.objectContaining({ data: { id: 'tomatoes', name: 'Tomatoes', from: page['from'](), to: page['to']() } }),
    );
  });

  it('leaves the latest price as a figure for one who does not work the purchases', async () => {
    tabs = ['Intelligence'];
    try {
      const { el } = await render(PriceVariancePage, api);
      expect(el.querySelector('[aria-label^="Open the invoice"]')).toBeNull();
      expect(cells(el.querySelector('tbody tr.row')!)[2]).toBe('L.E 25.00');
    } finally {
      tabs = ['Intelligence', 'Purchases'];
    }
  });

  it('filters by supplier and category, and downloads the sheet as filtered', async () => {
    const { fixture, el, page } = await render(PriceVariancePage, api);

    page['supplier'].set('delta');
    fixture.detectChanges();
    expect([...el.querySelectorAll('tbody tr.row td:first-child strong')].map(text)).toEqual(['Rice']);
    expect(page['supplierFilters']().map((o: { label: string; count: number }) => `${o.label} ${o.count}`)).toEqual(['All · الكل 2', 'Delta 1', 'Nile Farms 1']);

    page['supplier'].set('');
    page['category'].set('veg');
    fixture.detectChanges();
    expect([...el.querySelectorAll('tbody tr.row td:first-child strong')].map(text)).toEqual(['Tomatoes']);

    await page['download']();
    expect(api.pricesSheet).toHaveBeenCalledWith(expect.any(String), expect.any(String), { categoryId: 'veg', supplierId: '', search: '' });
    expect(URL.createObjectURL).toHaveBeenCalled();
  });
});

function planLine(overrides: Partial<OrderPlanLine>): OrderPlanLine {
  return {
    rawMaterialId: 'm', code: null, material: 'M', categoryId: 'general', category: 'General', categoryAr: null, purchaseUnit: 'kg', onHand: 0,
    averageDailyUsage: 0, expectedUsage: 0, reorderLevel: 0, recommended: 0, suggested: 0, unitPrice: null, estimatedCost: null, supplierId: null,
    supplier: null, belowReorder: false, ...overrides,
  };
}

// Patties: 15 needed, 5 left, 10 to order at 20; tomatoes: 2 kg at 25, below their reorder level.
const plan: OrderPlan = {
  lookbackFrom: '2026-10-05', lookbackTo: '2026-10-18', lookbackDays: 14, coverageDays: 7, growthPercent: 0,
  dishes: [{ menuItemId: 1, variantId: null, code: '1', name: 'Burger', nameAr: null, hasRecipe: true, averageDaily: 2.143, expectedDaily: 2.143, expected: false }],
  lines: [
    planLine({
      rawMaterialId: 'patty', material: 'Beef patty', purchaseUnit: 'piece', onHand: 5, averageDailyUsage: 2.143, expectedUsage: 15, recommended: 10,
      suggested: 10, unitPrice: 20, estimatedCost: 200, supplier: 'Nile Farms',
    }),
    planLine({
      rawMaterialId: 'tomatoes', material: 'Tomatoes', onHand: 12, averageDailyUsage: 0.214, expectedUsage: 1, reorderLevel: 12.5, recommended: 1.5,
      suggested: 2, unitPrice: 25, estimatedCost: 50, belowReorder: true,
    }),
    planLine({ rawMaterialId: 'rice', material: 'Rice', onHand: 40, averageDailyUsage: 1, expectedUsage: 7, unitPrice: 30, estimatedCost: 0 }),
  ],
  toOrder: 2, estimatedTotal: 250, belowReorder: 1, noPrice: [],
};

describe('the order planner', () => {
  const api = { plan: vi.fn((_request: object) => of(plan)), orderSheet: vi.fn((_lines: object[], _by: string, _days: number) => of(new Blob(['x']))) };

  beforeEach(() => {
    api.plan.mockClear();
    api.orderSheet.mockClear();
    URL.createObjectURL = vi.fn(() => 'blob:sheet');
    URL.revokeObjectURL = vi.fn();
  });

  it('plans from the last days’ sales, and the approved quantities make the order', async () => {
    const { fixture, el, page } = await render(OrderPlannerPage, api);
    await vi.waitFor(() => expect(api.plan).toHaveBeenCalledWith({ lookbackDays: 14, coverageDays: 7, growthPercent: 0, dishes: [] }));
    fixture.detectChanges();

    expect([...el.querySelectorAll('.tile strong')].map(text)).toEqual(['L.E 250.00', 'L.E 250.00', '1', '7 days']);
    expect(cells(el.querySelector('table.plan tbody tr')!)).toEqual([
      'Beef patty General · Nile Farms', '5 piece', '2.143', '15', '0', '10 piece', 'piece', 'L.E 200.00',
    ]);

    // Twelve patties, not ten: 290 in all. Only what is ordered is shown, then sent.
    page['approve'](plan.lines[0], 12);
    page['show'].set('order');
    fixture.detectChanges();
    expect(page['approvedTotal']()).toBe(290);
    expect([...el.querySelectorAll('table.plan tbody tr strong')].map(text).filter((t) => !/^\d/.test(t))).toEqual(['Beef patty', 'Tomatoes']);
    page['groupBy'].set('Supplier');
    await page['download']();
    expect(api.orderSheet).toHaveBeenCalledWith(
      [{ rawMaterialId: 'patty', quantity: 12 }, { rawMaterialId: 'tomatoes', quantity: 2 }], 'Supplier', 7,
    );

    page['resetApproved']();
    expect(page['approvedTotal']()).toBe(250);
  });

  it('plans again as the manager expects otherwise: growth, cover, or a dish set by hand', async () => {
    const { page } = await render(OrderPlannerPage, api);
    await vi.waitFor(() => expect(api.plan).toHaveBeenCalledTimes(1));

    page['setGrowth'](20);
    page['setCoverage'](3);
    page['expect'](plan.dishes[0], 4);
    await vi.waitFor(() =>
      expect(api.plan).toHaveBeenLastCalledWith({ lookbackDays: 14, coverageDays: 3, growthPercent: 20, dishes: [{ menuItemId: 1, variantId: null, expectedDaily: 4 }] }),
    );
    expect(page['expectationOf'](plan.dishes[0])).toBe(4);

    // Out of bounds is not taken; cleared, the dish follows its sales again.
    page['setCoverage'](90);
    page['expect'](plan.dishes[0], null);
    await vi.waitFor(() => expect(api.plan).toHaveBeenLastCalledWith({ lookbackDays: 14, coverageDays: 3, growthPercent: 20, dishes: [] }));
  });
});

const consumption: ConsumptionReport = {
  from: '2026-10-01', to: '2026-10-31', tolerancePercent: 5, theoreticalValue: 343.33, actualValue: 353.34, unexplainedValue: 10.83, highLoss: 1,
  rows: [
    {
      rawMaterialId: 'tomatoes', code: null, material: 'Tomatoes', categoryId: 'veg', category: 'Vegetables', categoryAr: null, purchaseUnit: 'kg',
      opening: 10, purchases: 5, waste: 0.5, closing: 12, actualUsage: 2.5, theoreticalUsage: 2, heldInPrep: 0.5, unexplainedQuantity: 0.5,
      unexplainedPercent: 25, unitCost: 21.67, varianceCost: 10.83, evaluation: 'Unfavourable',
    },
    {
      rawMaterialId: 'patty', code: null, material: 'Beef patty', categoryId: 'meat', category: 'Meat', categoryAr: null, purchaseUnit: 'piece',
      opening: 0, purchases: 20, waste: 0, closing: 5, actualUsage: 15, theoreticalUsage: 15, heldInPrep: 0, unexplainedQuantity: 0,
      unexplainedPercent: 0, unitCost: 20, varianceCost: 0, evaluation: 'WithinLimit',
    },
  ],
  soldWithoutRecipe: [{ itemCode: '10-101', menuItem: 'Shawarma (Kilo tray)', quantity: 2 }],
};

describe('theoretical against actual consumption', () => {
  it('sets what left the stores against what the sales should have taken, the high losses in red', async () => {
    const { fixture, el, page } = await render(ConsumptionPage, { consumption: vi.fn(() => of(consumption)), consumptionSheet: vi.fn() });

    expect([...el.querySelectorAll('.tile strong')].map(text)).toEqual(['L.E 10.83', '1', 'L.E 343.33', 'L.E 353.34']);
    expect(text(el.querySelector('.note')!)).toContain('10-101 Shawarma (Kilo tray) (2)');
    const rows = [...el.querySelectorAll('table.consumption tbody tr')];
    expect(rows[0].classList).toContain('high-loss');
    expect(cells(rows[0])).toEqual([
      'Tomatoesin kg · VegetablesHigh lossفاقد مرتفع', '10', '5', '0.5', '12', '2.5', '20.5 in prep stock', '+0.5 +25.0%', 'L.E 10.83',
    ]);
    expect(rows[1].classList).not.toContain('high-loss');

    page['evaluation'].set('WithinLimit');
    fixture.detectChanges();
    expect([...el.querySelectorAll('table.consumption tbody tr td:first-child strong')].map(text)).toEqual(['Beef patty']);
  });
});

const abc: AbcReport = {
  from: '2026-10-01', to: '2026-10-31', days: 2, consumptionValue: 365, stockoutRisks: 1, deadStock: 1, deadStockValue: 100, stockValue: 460,
  classes: [
    { class: 'A', materials: 1, value: 300, sharePercent: 82.2 },
    { class: 'B', materials: 1, value: 65, sharePercent: 17.8 },
    { class: 'C', materials: 1, value: 0, sharePercent: 0 },
  ],
  rows: [
    {
      rawMaterialId: 'patty', code: null, material: 'Beef patty', categoryId: 'meat', category: 'Meat', categoryAr: null, purchaseUnit: 'piece',
      consumption: 15, consumptionValue: 300, sharePercent: 82.2, cumulativePercent: 82.2, class: 'A', onHand: 5, stockValue: 100, averageDaily: 7.5,
      daysOnHand: 0.7, stockoutRisk: true, deadStock: false,
    },
    {
      rawMaterialId: 'tomatoes', code: null, material: 'Tomatoes', categoryId: 'veg', category: 'Vegetables', categoryAr: null, purchaseUnit: 'kg',
      consumption: 3, consumptionValue: 65, sharePercent: 17.8, cumulativePercent: 100, class: 'B', onHand: 12, stockValue: 260, averageDaily: 1.5,
      daysOnHand: 8, stockoutRisk: false, deadStock: false,
    },
    {
      rawMaterialId: 'saffron', code: null, material: 'Saffron', categoryId: 'dry', category: 'Spices', categoryAr: null, purchaseUnit: 'kg',
      consumption: 0, consumptionValue: 0, sharePercent: 0, cumulativePercent: 100, class: 'C', onHand: 0.05, stockValue: 100, averageDaily: 0,
      daysOnHand: null, stockoutRisk: false, deadStock: true,
    },
  ],
};

describe('ABC and days on hand', () => {
  it('classes the materials by what they used, and flags a stockout risk and dead stock', async () => {
    const { fixture, el, page } = await render(AbcPage, { abc: vi.fn(() => of(abc)), abcSheet: vi.fn() });

    expect([...el.querySelectorAll('.tile')].map((t) => text(t.querySelector('strong')!))).toEqual(['1', '1', '1', '1', '1']);
    // The dead stock's worth beside its count; what it means and how it is found, its (ⓘ)'s.
    expect(text(el.querySelectorAll('.tile')[4].querySelector('.chip')!)).toBe('L.E 100.00');
    expect(el.querySelectorAll('.tile small.muted').length).toBe(0);
    expect([...el.querySelectorAll('.tile app-info-tip button')].map((b) => b.getAttribute('aria-label'))).toEqual([
      'About Class A · الفئة A', 'About Class B · الفئة B', 'About Class C · الفئة C', 'About Stockout risk · خطر النفاد', 'About Dead stock · مخزون راكد',
    ]);
    const rows = [...el.querySelectorAll('table.abc-table tbody tr')];
    expect(rows.map((r) => [text(r.querySelector('.abc')!), text(r.querySelectorAll('td')[1].querySelector('strong')!), text(r.querySelectorAll('td')[7]), text(r.querySelectorAll('td')[8])])).toEqual([
      ['A', 'Beef patty', '0.7', 'Stockout risk · خطر النفاد'],
      ['B', 'Tomatoes', '8.0', ''],
      ['C', 'Saffron', '—', 'Dead stock · راكد'],
    ]);

    page['flag'].set('dead');
    fixture.detectChanges();
    expect(el.querySelectorAll('table.abc-table tbody tr').length).toBe(1);
    page['flag'].set('');
    page['sort'].set({ key: 'days', direction: 1 });
    fixture.detectChanges();
    // The fewest days first; none at the end.
    expect([...el.querySelectorAll('table.abc-table tbody tr td:nth-child(2) strong')].map(text)).toEqual(['Beef patty', 'Tomatoes', 'Saffron']);
  });
});

function dish(overrides: Partial<MenuEngineeringRow>): MenuEngineeringRow {
  return {
    itemCode: '1', menuItemId: 1, variantId: null, menuItem: 'Dish', menuItemAr: null, category: 'Mains', quantitySold: 1, menuMixPercent: 1, netSales: 1,
    averagePrice: 1, foodCostPerPortion: 1, foodCostPercent: 30, contributionMargin: 1, totalContribution: 1, popular: false, profitable: false, class: 'Dog',
    suggestedPrice: 1, status: 'WithinTarget', ...overrides,
  };
}

// The four dishes of a hundred sold, as the server placed them, and lemonade with no recipe.
const menu: MenuEngineeringReport = {
  from: '2026-11-01', to: '2026-11-30', category: null, foodCostTargetPercent: 30, items: 4, quantitySold: 100, netSales: 8550, totalContribution: 6350,
  averageContribution: 63.5, popularityThresholdPercent: 17.5, foodCostPercent: 25.7,
  classes: [
    { class: 'Star', items: 1, quantitySold: 40, contribution: 4000, contributionSharePercent: 63 },
    { class: 'Plowhorse', items: 1, quantitySold: 50, contribution: 1500, contributionSharePercent: 23.6 },
    { class: 'Puzzle', items: 1, quantitySold: 5, contribution: 750, contributionSharePercent: 11.8 },
    { class: 'Dog', items: 1, quantitySold: 5, contribution: 100, contributionSharePercent: 1.6 },
  ],
  rows: [
    dish({ itemCode: '1', menuItem: 'Burger', quantitySold: 40, menuMixPercent: 40, averagePrice: 120, foodCostPerPortion: 20, foodCostPercent: 16.7,
      contributionMargin: 100, totalContribution: 4000, popular: true, profitable: true, class: 'Star', suggestedPrice: 66.67 }),
    dish({ itemCode: '31', menuItemId: 31, menuItem: 'Fries', quantitySold: 50, menuMixPercent: 50, averagePrice: 40, foodCostPerPortion: 10, foodCostPercent: 25,
      contributionMargin: 30, totalContribution: 1500, popular: true, class: 'Plowhorse', suggestedPrice: 33.33 }),
    dish({ itemCode: '30', menuItemId: 30, menuItem: 'Steak', quantitySold: 5, menuMixPercent: 5, averagePrice: 300, foodCostPerPortion: 150, foodCostPercent: 50,
      contributionMargin: 150, totalContribution: 750, profitable: true, class: 'Puzzle', suggestedPrice: 500, status: 'AboveTarget' }),
    dish({ itemCode: '32', menuItemId: 32, menuItem: 'Soup', quantitySold: 5, menuMixPercent: 5, averagePrice: 50, foodCostPerPortion: 30, foodCostPercent: 60,
      contributionMargin: 20, totalContribution: 100, class: 'Dog', suggestedPrice: 100, status: 'AboveTarget' }),
    dish({ itemCode: '20', menuItemId: 20, menuItem: 'Lemonade', category: 'Drinks', quantitySold: 10, menuMixPercent: null, netSales: 300, averagePrice: 30,
      foodCostPerPortion: null, foodCostPercent: null, contributionMargin: null, totalContribution: null, class: null, suggestedPrice: null, status: 'NoRecipe' }),
  ],
  unclassified: 1,
  categories: ['Drinks', 'Mains'],
};

describe('menu engineering', () => {
  const api = {
    menuEngineering: vi.fn((_from: string, _to: string, _category: string | null) => of(menu)),
    menuEngineeringSheet: vi.fn((_from: string, _to: string, _category: string | null) => of(new Blob(['x']))),
  };

  beforeEach(() => {
    api.menuEngineering.mockClear();
    api.menuEngineeringSheet.mockClear();
    URL.createObjectURL = vi.fn(() => 'blob:sheet');
    URL.revokeObjectURL = vi.fn();
  });

  it('places each dish in the matrix, each quadrant with its (ⓘ) and what to do with it', async () => {
    const { el } = await render(MenuEngineeringPage, api);
    expect(api.menuEngineering.mock.lastCall![0]).toMatch(/^\d{4}-\d{2}-01$/);
    expect(api.menuEngineering.mock.lastCall![2]).toBeNull();
    expect([...el.querySelectorAll('.tile strong')].map(text)).toEqual(['L.E 6,350.00', 'L.E 63.50', '17.5%', '25.7%']);
    const quadrants = [...el.querySelectorAll('.quadrant')];
    expect(quadrants.map((q) => [text(q.querySelector('h3')!), text(q.querySelector('.count')!), [...q.querySelectorAll('.names li')].map(text)])).toEqual([
      ['Stars · النجوم', '1', ['Burger']],
      ['Plowhorses · خيول العمل', '1', ['Fries']],
      ['Puzzles · الألغاز', '1', ['Steak']],
      ['Dogs · الأصناف الضعيفة', '1', ['Soup']],
    ]);
    expect(quadrants.map((q) => q.querySelector('app-info-tip button')!.getAttribute('aria-label'))).toEqual([
      'About Stars · النجوم', 'About Plowhorses · خيول العمل', 'About Puzzles · الألغاز', 'About Dogs · الأصناف الضعيفة',
    ]);
  });

  it('lists every dish with its margin and the price that meets the target, the unplaced apart', async () => {
    const { el } = await render(MenuEngineeringPage, api);
    const rows = [...el.querySelectorAll('.menu-table tbody tr')];
    expect(rows.map((r) => [cells(r)[0], text(r.querySelector('td:nth-child(2) strong')!), cells(r)[6], cells(r)[8]])).toEqual([
      ['star Stars النجوم', 'Burger', 'L.E 100.00', 'L.E 66.67'],
      ['agriculture Plowhorses خيول العمل', 'Fries', 'L.E 30.00', 'L.E 33.33'],
      ['extension Puzzles الألغاز', 'Steak', 'L.E 150.00', 'L.E 500.00+L.E 200.00'],
      ['trending_down Dogs الأصناف الضعيفة', 'Soup', 'L.E 20.00', 'L.E 100.00+L.E 50.00'],
      ['No recipe · بدون وصفة', 'Lemonade', '—', '—'],
    ]);
  });

  it('shows one quadrant, one category, and downloads the sheet for it', async () => {
    const { fixture, el, page } = await render(MenuEngineeringPage, api);
    [...el.querySelectorAll<HTMLButtonElement>('.quadrant.Puzzle button')].find((b) => text(b).startsWith('Show these'))!.click();
    fixture.detectChanges();
    expect([...el.querySelectorAll('.menu-table tbody tr td:nth-child(2) strong')].map(text)).toEqual(['Steak']);

    page['category'].set('Mains');
    await fixture.whenStable();
    expect(api.menuEngineering).toHaveBeenLastCalledWith(expect.any(String), expect.any(String), 'Mains');
    await page['download']();
    expect(api.menuEngineeringSheet).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'Mains');
  });
});
