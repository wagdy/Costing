import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { CostingTab, CostingAccess } from '../../core/costing/costing-tabs';
import { CostingApi, ProductionOrder, StockCard, StockCardLine } from '../../core/costing/costing.api';
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

describe('the item’s stock card', () => {
  const stockCard = vi.fn();
  const stockCardSheet = vi.fn();
  const productionOrder = vi.fn();
  const open = vi.fn();
  const close = vi.fn();
  const error = vi.fn();

  async function render(tabs: CostingTab[] = ['Purchases', 'Production', 'Counts', 'Sales', 'Waste']) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: CostingApi, useValue: { stockCard, stockCardSheet, productionOrder } },
        { provide: CostingAccess, useValue: { has: (tab: CostingTab) => tabs.includes(tab) } },
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

  it('says why when the card cannot be loaded', async () => {
    stockCard.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404, error: { detail: 'Raw material was not found.' } })));
    const { el } = await render();
    expect(el.querySelector('[role="alert"]')).not.toBeNull();
    expect(el.querySelector('table')).toBeNull();
  });
});
