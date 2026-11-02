import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { of } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { CostingApi } from '../../core/costing/costing.api';
import { Menu, MenuItem, MenuSalesApi, SalesLine, SalesReceipt, SalesReport } from '../../core/costing/menu-sales.api';
import { NotifyService } from '../../core/ui/notify.service';
import { Approvals } from './approvals';
import { BusinessDay } from './financials';
import { SaleDialog, SalesPage } from './sales-page';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

function line(overrides: Partial<SalesLine>): SalesLine {
  return {
    publicId: 'l1', menuItemId: 6101, variantId: null, menuItemName: 'Margherita', variantName: null, quantity: 1, lineTotal: 140, addOnIds: [],
    onBill: true, voided: 'None', ...overrides,
  };
}
function receipt(overrides: Partial<SalesReceipt>): SalesReceipt {
  return {
    id: 's1', reference: 'R-1', soldAtUtc: '2026-10-12T11:00:00Z', businessDate: '2026-10-12', channel: 'DineIn', paymentMethod: 'Cash',
    lines: [line({})], subtotal: 140, discountAmount: 0, deliveryFee: 0, taxAmount: 19.6, pointsAmount: 0, totalAmount: 159.6, refundedAmount: 0,
    notes: null, source: 'Entered', enteredBy: 'Sara', enteredAtUtc: '2026-10-12T11:01:00Z', voidedAtUtc: null, voidedBy: null, ...overrides,
  };
}
const two = line({ publicId: 'two', quantity: 2, lineTotal: 280 });
const handedBack = line({ publicId: 'back', menuItemName: 'Lemonade', lineTotal: 30, onBill: false, voided: 'AfterPayment' });
const report: SalesReport = {
  from: '2026-10-07',
  to: '2026-10-13',
  receipts: [
    receipt({ lines: [two, handedBack], totalAmount: 319.2, refundedAmount: 34.2 }),
    receipt({ id: 's2', reference: 'R-2', source: 'Imported', channel: 'Delivery', paymentMethod: 'Visa', voidedAtUtc: '2026-10-12T12:00:00Z', voidedBy: 'Omar' }),
    receipt({ id: 'asked', reference: null }),
  ],
  totals: {
    receipts: 2, items: 3, subtotal: 420, discounts: 0, deliveryFees: 0, tax: 39.2, points: 0, total: 478.8, refunded: 34.2,
    byPayment: { Cash: 444.6, Visa: 0, Instapay: 0 },
  },
};

describe('the sales', () => {
  const api = { sales: vi.fn(), refund: vi.fn(), importSales: vi.fn(), menu: vi.fn() };
  const approvals = { pendingFor: (id: string) => (id === 'asked' ? { id: 'r1' } : undefined), refresh: vi.fn(), delete: vi.fn() };
  const notify = { info: vi.fn(), error: vi.fn() };

  async function render() {
    TestBed.configureTestingModule({
      providers: [
        { provide: MenuSalesApi, useValue: api },
        { provide: CostingApi, useValue: { financialSettings: () => of({ taxPercent: 14 }) } },
        { provide: BusinessDay, useValue: { today: () => Promise.resolve('2026-10-13') } },
        { provide: Approvals, useValue: approvals },
        { provide: AuthService, useValue: { me: () => null, can: () => true } },
        { provide: NotifyService, useValue: notify },
        { provide: MatDialog, useValue: { open: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(SalesPage);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, page: fixture.componentInstance as unknown as Record<string, any> };
  }

  beforeEach(() => {
    api.sales.mockReset().mockReturnValue(of(report));
    api.refund.mockReset().mockReturnValue(of(receipt({ refundedAmount: 159.6 })));
    approvals.delete.mockReset().mockResolvedValue('Applied');
    notify.info.mockReset();
    vi.spyOn(window, 'prompt').mockReturnValue('1');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('opens on the business week to today, with the takings by how they were paid', async () => {
    const { el } = await render();

    expect(api.sales).toHaveBeenCalledWith('2026-10-07', '2026-10-13');
    expect([...el.querySelectorAll('.tile strong')].map(text)).toEqual(['L.E 478.80', 'L.E 444.60', 'L.E 0.00', 'L.E 0.00', 'L.E 39.20']);
    expect(text(el.querySelector('.tile.key small')!)).toBe('2 bills · 3 items');
  });

  it('lists each sale with its lines, what was taken off the bill, and whether it was voided or asked to be', async () => {
    const { el } = await render();
    const rows = [...el.querySelectorAll('tbody tr')];

    expect([...rows[0].querySelectorAll('.line')].map(text)).toEqual([
      '2 × Margherita · L.E 280.00 keyboard_return',
      '1 × Lemonade · L.E 30.00 Refunded',
    ]);
    expect(text(rows[0].querySelectorAll('td')[4])).toBe('L.E 319.20 − L.E 34.20 refunded');
    expect(text(rows[1].querySelectorAll('td')[1])).toBe('R-2Imported by SaraVoidedملغاة');
    expect(rows[1].querySelector('button')).toBeNull();
    expect(text(rows[2].querySelectorAll('td')[1])).toBe('—Entered by SaraVoid requestedطلب إلغاء');
    expect(rows[2].querySelector('[aria-label^="Void sale"]')).toBeNull();
  });

  it('refunds as many of a line as asked, and voids a sale through its approval', async () => {
    const { page } = await render();

    await page['refund'](report.receipts[0], two);
    expect(window.prompt).toHaveBeenCalledWith('Refund how many of 2 × Margherita? · كم مرتجع', '2');
    expect(api.refund).toHaveBeenCalledWith('s1', 'two', 1);
    expect(notify.info).toHaveBeenCalledWith('Refunded: L.E 159.60 handed back on this sale.');

    vi.mocked(window.prompt).mockReturnValue('3');
    await page['refund'](report.receipts[0], two);
    expect(api.refund).toHaveBeenCalledTimes(1);

    await page['voidSale'](report.receipts[0]);
    expect(approvals.delete).toHaveBeenCalledWith('Sale', 's1', 'sale R-1');
    expect(api.sales).toHaveBeenCalledTimes(3);
  });
});

describe('a sale entered', () => {
  const recordSale = vi.fn();
  const close = vi.fn();
  const item = (overrides: Partial<MenuItem>): MenuItem => ({
    id: 1, name: 'Item', nameAr: null, category: 'Pizza', price: 0, isPriceBasedOnAddons: false, isAvailable: true, isDeleted: false,
    sizes: [], addOnIds: [], ...overrides,
  });
  const menu: Menu = {
    categories: [],
    items: [
      item({ id: 6101, name: 'Margherita', price: 140, sizes: [{ id: 2, name: 'Large', nameAr: null, price: 180 }], addOnIds: [3] }),
      item({ id: 20, name: 'Lemonade', price: 30 }),
      item({ id: 99, name: 'Gone', price: 10, isDeleted: true }),
    ],
    addOns: [{ id: 3, name: 'Cheese', nameAr: null, price: 15, isDeleted: false }],
  };

  async function render(taxPercent: number | null) {
    TestBed.configureTestingModule({
      providers: [
        { provide: MenuSalesApi, useValue: { recordSale } },
        { provide: MAT_DIALOG_DATA, useValue: { menu, today: '2026-10-13', taxPercent } },
        { provide: MatDialogRef, useValue: { close } },
      ],
    });
    const fixture = TestBed.createComponent(SaleDialog);
    await fixture.whenStable();
    fixture.detectChanges();
    return { page: fixture.componentInstance as unknown as Record<string, any> };
  }

  beforeEach(() => {
    recordSale.mockReset();
    close.mockReset();
  });

  it('prices each line by the menu, leaves out what was voided before the kitchen, and puts on the tax', async () => {
    const saved = receipt({});
    recordSale.mockReturnValue(of(saved));
    const { page } = await render(14);

    expect(page['liveItems'].map((i: MenuItem) => i.name)).toEqual(['Margherita', 'Lemonade']);
    page['addLine']();
    page['addLine']();
    const [pizza, lemonade, voided] = page['lines']();
    Object.assign(pizza, { menuItemId: 6101, variantId: 2, quantity: 2, addOnIds: [3] });
    Object.assign(lemonade, { menuItemId: 20, lineTotal: 25 });
    Object.assign(voided, { menuItemId: 20, voided: 'BeforeKitchen' });
    page['discount'] = 10;
    page['touch']();

    expect(page['menuTotal'](pizza)).toBe(390);
    expect(page['subtotal']()).toBe(415);
    // (415 - 10) at 14%.
    expect(page['total']()).toBe(461.7);
    expect(page['tax']).toBe(56.7);

    Object.assign(page, { time: '13:40', reference: ' T-9 ' });
    await page['save']();
    const sent = recordSale.mock.lastCall![0];
    expect(sent).toMatchObject({
      reference: 'T-9', date: '2026-10-13', time: '13:40:00', channel: 'DineIn', paymentMethod: 'Cash', discountAmount: 10, taxAmount: 56.7,
    });
    expect(sent.lines).toEqual([
      { menuItemId: 6101, variantId: 2, quantity: 2, lineTotal: null, addOnIds: [3], voided: 'None' },
      { menuItemId: 20, variantId: null, quantity: 1, lineTotal: 25, addOnIds: [], voided: 'None' },
      { menuItemId: 20, variantId: null, quantity: 1, lineTotal: null, addOnIds: [], voided: 'BeforeKitchen' },
    ]);
    expect(close).toHaveBeenCalledWith(saved);
  });

  it('takes the tax as typed when there is no rate, or it was typed over', async () => {
    const { page } = await render(null);
    Object.assign(page['lines']()[0], { menuItemId: 20, quantity: 2 });
    page['touch']();

    expect(page['total']()).toBe(60);
    page['tax'] = 5;
    page['taxTyped'] = true;
    page['touch']();
    expect(page['total']()).toBe(65);
  });
});
