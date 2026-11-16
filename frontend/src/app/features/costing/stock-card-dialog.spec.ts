import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { CostingTab, CostingAccess } from '../../core/costing/costing-tabs';
import { CostingApi, ProductionOrder, StockCard, StockCardLine, WhereUsedReport } from '../../core/costing/costing.api';
import { BulkSwapDialog } from './bulk-swap-dialog';
import { NotifyService } from '../../core/ui/notify.service';
import { InvoiceViewDialog } from './invoice-view-dialog';
import { ProductionOrderDialog } from './production-order-dialog';
import { StockCardDialog } from './stock-card-dialog';

function line(overrides: Partial<StockCardLine>): StockCardLine {
  return {
    movementId: 'm', date: '2026-11-02', occurredAtUtc: '2026-11-02T09:00:00Z', reason: 'Purchase', type: 'Purchases', isReversal: false,
    sourceKind: 'PurchaseInvoice', sourceId: 'inv-1', hasSource: true, sourceDate: '2026-11-02', reference: 'Invoice F-1 · فاتورة F-1',
    details: 'Nile Farms', quantityIn: 0, quantityOut: 0, balance: 0, unitCost: 20, value: 0, averageCostAfter: 20, recordedBy: null, ...overrides,
  };
}

// Tomatoes over November: 10 kg bought at 20, 5 kg at 25, 2 kg into the sauce, the burgers' sales,
// 0.5 kg short at the count; 12 kg left, worth 260.
const card: StockCard = {
  rawMaterialId: 'tomatoes', code: 'ING-7', material: 'Tomatoes', isPrepItem: false, unit: 'Gram', purchaseUnit: 'kg', purchaseUnitSize: 1000,
  from: '2026-11-01', to: '2026-11-30', type: null, openingBalance: 0, openingAverageCost: null, totalIn: 15, totalOut: 3, closingBalance: 12,
  closingAverageCost: 21.667, closingValue: 260, onHand: 12, averageCost: 21.667,
  lines: [
    line({ movementId: '1', quantityIn: 10, balance: 10, value: 200 }),
    line({ movementId: '2', sourceId: 'inv-2', reference: 'Invoice F-2 · فاتورة F-2', quantityIn: 5, balance: 15, unitCost: 25, value: 125, averageCostAfter: 21.6667 }),
    line({
      movementId: '3', reason: 'ProductionInput', type: 'Production', sourceKind: 'ProductionOrder', sourceId: 'batch-1', reference: 'Production batch · تشغيلة إنتاج',
      details: 'Batch: 2 kg of Pizza sauce', quantityOut: 2, balance: 13, unitCost: 21.667, value: -43.33, averageCostAfter: 21.667,
    }),
    line({
      movementId: '4', reason: 'Sale', type: 'Sales', sourceKind: 'SalesReceipt', sourceId: 'receipt-1', sourceDate: '2026-11-01',
      reference: 'Daily sales summary · ملخص المبيعات اليومية', details: '15 × Burger', quantityOut: 0.5, balance: 12.5, unitCost: 21.667, averageCostAfter: 21.667,
    }),
    line({
      movementId: '5', reason: 'CountAdjustment', type: 'CountAdjustment', sourceKind: 'StockCount', sourceId: 'count-1', reference: 'Stock count · جرد',
      details: null, quantityOut: 0.5, balance: 12, unitCost: 21.667, averageCostAfter: 21.667, recordedBy: 'Omar',
    }),
  ],
};

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

// Tomatoes on the burger itself, and inside the pizza sauce the pizza is made with.
const usage: WhereUsedReport = {
  materialId: 'tomatoes', material: 'Tomatoes', code: 'ING-7', isPrepItem: false, unit: 'Gram', purchaseUnit: 'kg', purchaseUnitSize: 1000,
  dishes: 2, prepItems: 1,
  rows: [
    {
      kind: 'Dish', id: 'burger', name: 'Burger', itemCode: '1', category: 'Mains', portions: 1, batchQuantity: null, batchUnit: null, price: 120, cost: 35,
      foodCostPercent: 29.2, quantity: 30, throughPrepItems: null, via: [], itemCost: 0.65,
    },
    {
      kind: 'Dish', id: 'pizza', name: 'Margherita', itemCode: '4', category: 'Pizza', portions: 1, batchQuantity: null, batchUnit: null, price: 150, cost: 40,
      foodCostPercent: 26.7, quantity: null, throughPrepItems: 60, via: ['Pizza sauce'], itemCost: 1.3,
    },
    {
      kind: 'PrepItem', id: 'sauce', name: 'Pizza sauce', itemCode: 'PREP-1', category: 'Sauces', portions: null, batchQuantity: 2000, batchUnit: 'Gram',
      price: null, cost: 43.33, foodCostPercent: null, quantity: 2000, throughPrepItems: null, via: [], itemCost: 43.33,
    },
  ],
};

describe('the item’s stock card', () => {
  const stockCard = vi.fn();
  const stockCardSheet = vi.fn();
  const productionOrder = vi.fn();
  const whereUsed = vi.fn();
  const open = vi.fn();
  const close = vi.fn();
  const error = vi.fn();

  async function render(tabs: CostingTab[] = ['Purchases', 'Production', 'Counts', 'Sales', 'Waste'], canManage = true) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: CostingApi, useValue: { stockCard, stockCardSheet, productionOrder, whereUsed } },
        { provide: CostingAccess, useValue: { has: (tab: CostingTab) => tabs.includes(tab) } },
        { provide: AuthService, useValue: { can: () => canManage } },
        { provide: MatDialog, useValue: { open } },
        { provide: MatDialogRef, useValue: { close } },
        { provide: NotifyService, useValue: { error, info: vi.fn() } },
        { provide: MAT_DIALOG_DATA, useValue: { id: 'tomatoes', name: 'Tomatoes', from: '2026-11-01', to: '2026-11-30' } },
      ],
    });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(StockCardDialog);
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, navigate };
  }

  beforeEach(() => {
    stockCard.mockReset().mockReturnValue(of(card));
    whereUsed.mockReset().mockReturnValue(of(usage));
    stockCardSheet.mockReset().mockReturnValue(of(new Blob(['x'])));
    productionOrder.mockReset();
    open.mockReset();
    close.mockReset();
    error.mockReset();
    URL.createObjectURL = vi.fn(() => 'blob:card');
    URL.revokeObjectURL = vi.fn();
  });

  it('opens on the period it was given, with the balance in, out and left, and the moving average', async () => {
    const { el } = await render();
    expect(stockCard).toHaveBeenCalledExactlyOnceWith('tomatoes', '2026-11-01', '2026-11-30', null);
    expect(text(el.querySelector('h2')!)).toContain('Tomatoes · Stock card كارتة الصنف');
    expect(text(el.querySelector('h2 .title-sub')!)).toBe('ING-7 · in kg');
    const tiles = [...el.querySelectorAll('.tile')].map((t) => [t.querySelector('.label')!.textContent!.trim(), t.querySelector('strong')!.textContent!.trim()]);
    expect(tiles.map((t) => t[1])).toEqual(['0', '+15', '−3', '12', expect.stringContaining('21.667')]);
    expect(tiles.map((t) => t[0])).toEqual([
      'Opening balance · رصيد أول المدة',
      'Total in (+) · إجمالي الوارد',
      'Total out (−) · إجمالي المنصرف',
      'Closing on hand · رصيد آخر المدة',
      'Moving avg cost (AP$) · متوسط التكلفة',
    ]);
    // Each tile's (ⓘ), and the ledger's own for its running figures.
    expect(el.querySelectorAll('.tile app-info-tip').length).toBe(5);
    expect(el.querySelectorAll('thead app-info-tip').length).toBe(3);
  });

  it('lists every movement oldest first, between the opening and the closing balance', async () => {
    const { el } = await render();
    const rows = [...el.querySelectorAll('tbody tr')].map((r) => [...r.querySelectorAll('td')].map((c) => text(c)));
    expect(rows[0]).toEqual(['1 Nov 2026', 'Opening balance · رصيد أول المدة', '0', '', '—']);
    expect(rows.slice(1).map((r) => [r[3], r[4], r[5]])).toEqual([
      ['+10', '', '10'],
      ['+5', '', '15'],
      ['', '−2', '13'],
      ['', '−0.5', '12.5'],
      ['', '−0.5', '12'],
    ]);
    expect(rows[5][1]).toContain('Count adjustment · تسوية جرد');
    // The day's sales are under their own day, the day before the movement.
    expect(rows[4][1]).toContain('dated 1 Nov 2026 · بتاريخ');
    expect(rows[1][1]).not.toContain('dated');
    expect(rows[5][2]).toBe('— by Omar');
    expect([...el.querySelectorAll('tfoot td')].map((c) => text(c))).toEqual([
      '30 Nov 2026', 'Closing balance · رصيد آخر المدة', '+15', '−3', '12', 'L.E 260.00', 'L.E 21.667',
    ]);
  });

  it('shows one kind of movement when filtered, asked of the server', async () => {
    const { fixture } = await render();
    (fixture.componentInstance as unknown as { type: { set(v: string): void } }).type.set('Sales');
    await fixture.whenStable();
    expect(stockCard).toHaveBeenLastCalledWith('tomatoes', '2026-11-01', '2026-11-30', 'Sales');
  });

  it('opens an invoice over the card, its material marked, to check or correct it', async () => {
    const { el } = await render();
    const refs = [...el.querySelectorAll<HTMLButtonElement>('button.ref')];
    expect(refs.map((b) => text(b))).toEqual([
      'Invoice F-1 · فاتورة F-1 open_in_new',
      'Invoice F-2 · فاتورة F-2 open_in_new',
      'Production batch · تشغيلة إنتاج open_in_new',
      'Daily sales summary · ملخص المبيعات اليومية open_in_new',
      'Stock count · جرد open_in_new',
    ]);
    refs[1].click();
    expect(open).toHaveBeenCalledExactlyOnceWith(InvoiceViewDialog, expect.objectContaining({ data: { invoiceId: 'inv-2', highlightMaterialId: 'tomatoes' } }));
    expect(close).not.toHaveBeenCalled();
  });

  it('opens the production batch over the card, and the count and the day’s sales on their pages', async () => {
    const order = { id: 'batch-1', prepItem: 'Pizza sauce' } as unknown as ProductionOrder;
    productionOrder.mockReturnValue(of(order));
    const { fixture, el, navigate } = await render();
    const refs = [...el.querySelectorAll<HTMLButtonElement>('button.ref')];

    refs[2].click();
    await fixture.whenStable();
    expect(productionOrder).toHaveBeenCalledWith('batch-1');
    expect(open).toHaveBeenCalledExactlyOnceWith(ProductionOrderDialog, expect.objectContaining({ data: order }));

    refs[3].click();
    expect(close).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenLastCalledWith(['/costing/sales'], { queryParams: { day: '2026-11-01', receipt: 'receipt-1' } });

    refs[4].click();
    expect(navigate).toHaveBeenLastCalledWith(['/costing/counts', 'count-1'], { queryParams: undefined });
  });

  it('leaves a reference as text where its tab is not the user’s', async () => {
    const { el } = await render(['Counts']);
    expect([...el.querySelectorAll('button.ref')].map((b) => text(b))).toEqual(['Stock count · جرد open_in_new']);
    expect(el.querySelectorAll('.ref.plain').length).toBe(4);
  });

  it('downloads the card as filtered', async () => {
    const { el } = await render();
    [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => text(b).includes('Excel'))!.click();
    await Promise.resolve();
    expect(stockCardSheet).toHaveBeenCalledExactlyOnceWith('tomatoes', '2026-11-01', '2026-11-30', null);
  });

  it('lists the recipes it is in, on them or inside their prep items, and swaps it out of them', async () => {
    const { fixture, el, navigate } = await render(['Recipes']);
    expect(whereUsed).toHaveBeenCalledExactlyOnceWith('tomatoes');
    const tabs = [...el.querySelectorAll('[role="tab"]')].map(text);
    expect(tabs).toEqual(['Movements · حركة الصنف', 'Linked recipes · وصفات مرتبطة (3)']);

    fixture.componentInstance['tab'].set(1);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(text(el.querySelector('.linked-bar')!)).toContain('Used in 2 dishes and 1 prep item');
    const rows = [...el.querySelectorAll('table.linked tbody tr')];
    expect(rows.map((r) => [...r.querySelectorAll('td')].map(text))).toEqual([
      ['Dish · طبقBurger1 · Mains', 'L.E 120.00', '30 g', 'L.E 0.65', 'L.E 35.00a portion', '29.2%'],
      ['Dish · طبقMargherita4 · Pizza', 'L.E 150.00', '60 g in Pizza sauce', 'L.E 1.30', 'L.E 40.00a portion', '26.7%'],
      ['Prep item · مصنّعPizza saucePREP-1 · Sauces', '—', '2,000 ga batch of 2,000 g', 'L.E 43.33', 'L.E 43.33a batch', '—'],
    ]);
    expect(el.querySelectorAll('table.linked app-info-tip').length).toBe(2);

    // A name opens its recipe card, or the prep item's page.
    rows[2].querySelector<HTMLButtonElement>('button.ref')!.click();
    expect(navigate).toHaveBeenLastCalledWith(['/costing/recipes/prep', 'sauce'], { queryParams: undefined });

    // The swap starts from this item, and the list is read again once it is done.
    open.mockReturnValue({ afterClosed: () => of({ recipes: 1, prepItems: 1 }) });
    [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => text(b).includes('Bulk swap material'))!.click();
    await fixture.whenStable();
    expect(open).toHaveBeenCalledWith(BulkSwapDialog, expect.objectContaining({ data: { fromMaterialId: 'tomatoes' } }));
    expect(whereUsed).toHaveBeenCalledTimes(2);
  });

  it('offers the swap only to whoever writes recipes', async () => {
    const { fixture, el } = await render(['Recipes'], false);
    fixture.componentInstance['tab'].set(1);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelectorAll('table.linked tbody tr').length).toBe(3);
    expect([...el.querySelectorAll('button')].some((b) => text(b).includes('Bulk swap material'))).toBe(false);
  });

  it('says why when the card cannot be loaded', async () => {
    stockCard.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404, error: { detail: 'Raw material was not found.' } })));
    const { el } = await render();
    expect(el.querySelector('[role="alert"]')).not.toBeNull();
    expect(el.querySelector('table')).toBeNull();
  });
});
