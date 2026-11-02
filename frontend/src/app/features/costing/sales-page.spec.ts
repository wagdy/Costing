import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { Menu, MenuSalesApi, SalesLine, SalesReceipt, SalesReport } from '../../core/costing/menu-sales.api';
import { NotifyService } from '../../core/ui/notify.service';
import { Approvals } from './approvals';
import { DailySalesDialog, DailySalesImportDialog } from './daily-sales-dialogs';
import { BusinessDay } from './financials';
import { SalesPage } from './sales-page';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

function line(overrides: Partial<SalesLine>): SalesLine {
  return {
    publicId: 'l1', menuItemId: 6101, variantId: null, menuItemName: 'Margherita', variantName: null, quantity: 1, lineTotal: 140, addOnIds: [],
    onBill: true, voided: 'None', ...overrides,
  };
}
function summary(overrides: Partial<SalesReceipt>): SalesReceipt {
  return {
    id: 's1', reference: null, soldAtUtc: '2026-10-12T10:00:00Z', businessDate: '2026-10-12', channel: 'DineIn', paymentMethod: 'Cash',
    lines: [line({})], subtotal: 140, discountAmount: 0, deliveryFee: 0, taxAmount: 0, pointsAmount: 0, totalAmount: 140, refundedAmount: 0,
    notes: 'Daily sales summary', source: 'DailySummary', enteredBy: 'Sara', enteredAtUtc: '2026-10-13T01:00:00Z', voidedAtUtc: null, voidedBy: null,
    ...overrides,
  };
}
// The 12th: eight items, two hidden until asked. The 11th: voided. The 10th: its void asked for.
const many = Array.from({ length: 8 }, (_, i) => line({ publicId: `l${i}`, menuItemName: `Dish ${i + 1}`, quantity: i + 1, lineTotal: 10 * (i + 1) }));
const report: SalesReport = {
  from: '2026-10-07',
  to: '2026-10-13',
  receipts: [
    summary({ lines: [...many, line({ publicId: 'big', variantName: 'Large', quantity: 4, lineTotal: 720 })], subtotal: 1_080 }),
    summary({ id: 's2', businessDate: '2026-10-11', voidedAtUtc: '2026-10-12T12:00:00Z', voidedBy: 'Omar' }),
    summary({ id: 'asked', businessDate: '2026-10-10', source: 'Entered', reference: 'R-9' }),
  ],
  totals: { receipts: 2, items: 41, subtotal: 1_220, discounts: 0, deliveryFees: 0, tax: 0, points: 0, total: 1_220, refunded: 0, byPayment: { Cash: 1_220, Visa: 0, Instapay: 0 } },
};
const menu: Menu = {
  categories: [],
  items: [{ id: 6101, name: 'Margherita', nameAr: null, category: 'Pizza', price: 140, isPriceBasedOnAddons: false, isAvailable: true, isDeleted: false, sizes: [], addOnIds: [] }],
  addOns: [],
};

describe('the sales', () => {
  const api = { sales: vi.fn(), menu: vi.fn() };
  const approvals = { pendingFor: (id: string) => (id === 'asked' ? { id: 'r1' } : undefined), refresh: vi.fn(), delete: vi.fn() };
  const notify = { info: vi.fn(), error: vi.fn() };
  const open = vi.fn();

  async function render({ canChange = true } = {}) {
    TestBed.configureTestingModule({
      providers: [
        { provide: MenuSalesApi, useValue: api },
        { provide: BusinessDay, useValue: { today: () => Promise.resolve('2026-10-13') } },
        { provide: Approvals, useValue: approvals },
        { provide: AuthService, useValue: { me: () => null, can: () => canChange } },
        { provide: NotifyService, useValue: notify },
        { provide: MatDialog, useValue: { open } },
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
    api.menu.mockReset().mockReturnValue(of(menu));
    approvals.delete.mockReset().mockResolvedValue('Applied');
    notify.info.mockReset();
    notify.error.mockReset();
    open.mockReset();
  });

  it('opens on the business week to today: the days entered, the items sold and what they come to at menu prices, no money taken', async () => {
    const { el } = await render();

    expect(api.sales).toHaveBeenCalledWith('2026-10-07', '2026-10-13');
    expect([...el.querySelectorAll('.tile')].map((t) => [text(t.querySelector('.label')!), text(t.querySelector('strong')!)])).toEqual([
      ['Days entered · الأيام المسجلة', '2'],
      ['Items sold · الكميات المباعة', '41'],
      ['At menu prices · بأسعار المنيو', 'L.E 1,220.00'],
    ]);
    expect([...el.querySelectorAll('.toolbar button')].map(text)).toEqual([
      'upload_file Import a day استيراد يوم',
      'add Daily sales summary ملخص المبيعات اليومية',
    ]);
    expect(text(el.querySelector('p.note')!)).toContain('Sales are for stock and food cost only');
  });

  it('lists each day with its items, more on asking, and whether it was voided or asked to be', async () => {
    const { fixture, el, page } = await render();
    const rows = () => {
      fixture.detectChanges();
      return [...el.querySelectorAll('tbody tr')];
    };

    expect([...rows()[0].querySelectorAll('.line')].map(text)).toEqual(['1 × Dish 1', '2 × Dish 2', '3 × Dish 3', '4 × Dish 4', '5 × Dish 5', '6 × Dish 6']);
    expect([...rows()[0].querySelectorAll('td')].slice(2, 4).map(text)).toEqual(['40', 'L.E 1,080.00']);
    page['toggle']('s1');
    expect(rows()[0].querySelectorAll('.line')).toHaveLength(9);
    expect(text(rows()[0].querySelectorAll('.line')[8])).toBe('4 × Margherita (Large)');

    expect(text(rows()[1].querySelectorAll('td')[0])).toBe('Sun 11 Oct Daily summary · Sara Voidedملغاة');
    expect(rows()[1].querySelector('button')).toBeNull();
    expect(text(rows()[2].querySelectorAll('td')[0])).toBe('Sat 10 Oct Bill R-9 · Sara Void requestedطلب إلغاء');
    expect(rows()[2].querySelector('[aria-label^="Void"]')).toBeNull();
  });

  it('enters a day by hand in its dialog, imports one from its sheet, and voids one through its approval', async () => {
    const { page } = await render();

    const saved = summary({ businessDate: '2026-10-13', lines: [line({ quantity: 3 })], subtotal: 420 });
    open.mockReturnValue({ afterClosed: () => of(saved) });
    await page['enterDay']();
    expect(open).toHaveBeenLastCalledWith(DailySalesDialog, expect.objectContaining({ data: { menu, today: '2026-10-13' }, disableClose: true }));
    expect(notify.info).toHaveBeenCalledWith('Sales of 2026-10-13 saved: 3 sold, L.E 420.00 at menu prices, their stock taken.');
    expect(api.sales).toHaveBeenCalledTimes(2);

    open.mockReturnValue({ afterClosed: () => of(true) });
    await page['importDay']();
    expect(open).toHaveBeenLastCalledWith(DailySalesImportDialog, expect.objectContaining({ data: { today: '2026-10-13' } }));
    expect(api.sales).toHaveBeenCalledTimes(3);

    await page['voidSale'](report.receipts[0]);
    expect(approvals.delete).toHaveBeenCalledWith('Sale', 's1', 'the sales of 2026-10-12');
    expect(api.sales).toHaveBeenCalledTimes(4);
  });

  it('says so when the menu has nothing to sell yet, and offers nothing to change to one who cannot', async () => {
    api.menu.mockReturnValue(of({ ...menu, items: [] }));
    const { page } = await render();
    await page['enterDay']();
    expect(open).not.toHaveBeenCalled();
    expect(notify.error).toHaveBeenCalledWith(null, expect.stringContaining('The menu has no items yet'));
    TestBed.resetTestingModule();

    const { el } = await render({ canChange: false });
    expect(el.querySelectorAll('.toolbar button')).toHaveLength(0);
  });
});
