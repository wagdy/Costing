import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { of, throwError } from 'rxjs';
import { DailySalesImportResult, Menu, MenuItem, MenuSalesApi } from '../../core/costing/menu-sales.api';
import { NotifyService } from '../../core/ui/notify.service';
import { DailySalesDialog, DailySalesImportDialog, findOption, saleOptions } from './daily-sales-dialogs';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

const item = (overrides: Partial<MenuItem>): MenuItem => ({
  id: 1, name: 'Item', nameAr: null, category: 'Pizza', price: 0, isPriceBasedOnAddons: false, isAvailable: true, isDeleted: false,
  sizes: [], addOnIds: [], ...overrides,
});
const menu: Menu = {
  categories: [],
  items: [
    item({ id: 6201, name: 'Alfredo pasta', nameAr: 'باستا ألفريدو', price: 165 }),
    item({ id: 6101, name: 'Margherita', price: 140, sizes: [{ id: 1, name: 'Medium', nameAr: 'وسط', price: 140 }, { id: 2, name: 'Large', nameAr: 'كبير', price: 180 }] }),
    item({ id: 99, name: 'Gone', price: 10, isDeleted: true }),
  ],
  addOns: [],
};

describe('the menu as a day’s sales list it', () => {
  it('offers each item, and each size of one sold by size, by its code, and finds one typed by its label, code or name', () => {
    const options = saleOptions(menu);

    expect(options.map((o) => [o.label, o.price])).toEqual([
      ['6101-1 · Margherita (Medium)', 140],
      ['6101-2 · Margherita (Large)', 180],
      ['6201 · Alfredo pasta', 165],
    ]);
    expect(findOption(options, '6101-2 · margherita (large)')?.variantId).toBe(2);
    expect(findOption(options, '6201')?.menuItemId).toBe(6201);
    expect(findOption(options, ' باستا  ألفريدو ')?.menuItemId).toBe(6201);
    expect(findOption(options, 'Margherita (Large)')?.code).toBe('6101-2');
    // Sold by size: the item alone is not enough; one not on the menu is nothing.
    expect(findOption(options, 'Margherita')).toBeNull();
    expect(findOption(options, 'Gone')).toBeNull();
    expect(findOption(options, '')).toBeNull();
  });
});

describe('a day’s sales entered', () => {
  const recordDailySales = vi.fn();
  const close = vi.fn();

  async function render() {
    TestBed.configureTestingModule({
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { menu, today: '2026-10-13' } },
        { provide: MatDialogRef, useValue: { close } },
        { provide: MenuSalesApi, useValue: { recordDailySales } },
      ],
    });
    const fixture = TestBed.createComponent(DailySalesDialog);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const page = fixture.componentInstance as unknown as Record<string, any>;
    const type = async (input: HTMLInputElement, value: string) => {
      input.value = value;
      input.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      fixture.detectChanges();
    };
    // The quantities, as typed; the items, as chosen from the picker's list.
    const cells = () => [...el.querySelectorAll<HTMLInputElement>('input.cell')];
    const pick = async (row: number, key: string) => {
      page['rows']()[row].key = key;
      page['touch']();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    const add = async () => {
      page['add']();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    return { fixture, el, page, type, cells, add, pick };
  }

  beforeEach(() => {
    recordDailySales.mockReset().mockImplementation((id: string, date: string) => of({ id, businessDate: date }));
    close.mockReset();
  });

  it('asks only for the date and each item with how many sold, no bill or money fields', async () => {
    const { el, page } = await render();

    expect(text(el.querySelector('h2')!)).toBe('Daily sales summary ملخص المبيعات اليومية');
    expect([...el.querySelectorAll('input')].map((i) => i.getAttribute('aria-label'))).toEqual(['Date', 'Item 1', 'Quantity sold 1']);
    expect(text(el.querySelector('mat-dialog-content')!)).not.toMatch(/Receipt|Paid by|Discount|Delivery fee|Points|Refunded|Time/);
    // The picker offers each item and size by its code, with its category and the menu's price.
    expect((page['pickItems'] as { id: string; detail: string; cost: string }[]).map((i) => [i.id, i.detail, i.cost])).toEqual([
      ['6101-1', 'Pizza', 'L.E 140.00'],
      ['6101-2', 'Pizza', 'L.E 180.00'],
      ['6201', 'Pizza', 'L.E 165.00'],
    ]);
  });

  it('saves the day once every item is found and its quantity whole, an item twice sent twice for the server to add up', async () => {
    const { el, page, type, cells, add, pick } = await render();

    expect(page['problem']()).toBe('Add at least one item sold. · أضف صنفًا مباعًا واحدًا على الأقل.');
    await type(cells()[0], '2');
    expect(page['problem']()).toBe('Choose the item for each quantity from the list. · اختر الصنف لكل كمية من القائمة.');

    await pick(0, '6101-2');
    await add();
    await pick(1, '6201');
    await type(cells()[1], '1.5');
    expect(page['problem']()).toBe('Each quantity sold is a whole number, 1 or more. · الكمية رقم صحيح 1 أو أكثر.');
    expect(cells()[1].classList).toContain('missing');
    await type(cells()[1], '3');
    await add();
    await pick(2, '6201');
    await type(cells()[2], '1');
    expect(page['problem']()).toBeNull();
    expect(text(el.querySelector('.totals')!)).toBe('2 items · 6 sold · L.E 1,020.00 at menu prices');

    page['date'] = '2026-10-14';
    page['touch']();
    expect(page['problem']()).toBe('That day has not come yet. · هذا اليوم لم يأتِ بعد.');
    page['date'] = '2026-10-12';
    page['touch']();

    await page['save']();
    expect(recordDailySales).toHaveBeenCalledWith(expect.any(String), '2026-10-12', [
      { menuItemId: 6101, variantId: 2, quantity: 2 },
      { menuItemId: 6201, variantId: null, quantity: 3 },
      { menuItemId: 6201, variantId: null, quantity: 1 },
    ]);
    expect(close).toHaveBeenCalledWith(expect.objectContaining({ businessDate: '2026-10-12' }));
  });

  it('says why the server refused it, keeping what was typed', async () => {
    const { fixture, el, page, type, cells, pick } = await render();
    recordDailySales.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 422, error: { detail: 'The sales of 13 Oct 2026 are entered already (2 items, 6 sold).' } })),
    );

    await pick(0, '6201');
    await type(cells()[0], '4');
    await page['save']();
    fixture.detectChanges();

    expect(text(el.querySelector('.error')!)).toBe('The sales of 13 Oct 2026 are entered already (2 items, 6 sold).');
    expect(close).not.toHaveBeenCalled();
    expect(page['rows']()[0].key).toBe('6201');
    expect(cells()[0].value).toBe('4');
  });
});

describe('a day’s sheet imported', () => {
  const importDailySales = vi.fn();
  const dailySalesTemplate = vi.fn();
  const close = vi.fn();

  async function render() {
    TestBed.configureTestingModule({
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { today: '2026-10-13' } },
        { provide: MatDialogRef, useValue: { close } },
        { provide: MenuSalesApi, useValue: { importDailySales, dailySalesTemplate } },
        { provide: NotifyService, useValue: { info: vi.fn(), error: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(DailySalesImportDialog);
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, page: fixture.componentInstance as unknown as Record<string, any> };
  }

  const result: DailySalesImportResult = {
    date: '2026-10-12', saleId: 's1', items: 2, quantity: 17, value: 2_425,
    skipped: [{ row: 5, name: 'Shawarma', reason: 'There is no Shawarma on the menu.', reasonAr: 'لا يوجد Shawarma في المنيو.' }],
  };

  beforeEach(() => {
    importDailySales.mockReset().mockReturnValue(of(result));
    close.mockReset();
  });

  it('imports the sheet for the day chosen, and says what was recorded and each row left out, in both languages', async () => {
    const { fixture, el, page } = await render();

    page['date'] = '2026-10-12';
    const file = new File(['xlsx'], 'day.xlsx');
    await page['import'](file);
    fixture.detectChanges();

    expect(importDailySales).toHaveBeenCalledWith('2026-10-12', file);
    expect(text(el.querySelector('.note')!)).toContain('2 items, 17 sold, L.E 2,425.00 at menu prices, recorded for 2026-10-12');
    expect(text(el.querySelector('.skipped li')!)).toBe('Row 5 · Shawarma: There is no Shawarma on the menu. لا يوجد Shawarma في المنيو.');

    page['close']();
    expect(close).toHaveBeenCalledWith(true);
  });

  it('says when nothing could be read, and why the server refused a day entered already', async () => {
    importDailySales.mockReturnValue(of({ ...result, saleId: null, items: 0, quantity: 0, value: 0 }));
    const { fixture, el, page } = await render();

    await page['import'](new File(['xlsx'], 'day.xlsx'));
    fixture.detectChanges();
    expect(text(el.querySelector('.warn')!)).toContain('Nothing on the sheet could be read');
    page['close']();
    expect(close).toHaveBeenCalledWith(false);

    page['result'].set(null);
    importDailySales.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 422, error: { detail: 'The sales of 12 Oct 2026 are entered already.' } })));
    await page['import'](new File(['xlsx'], 'day.xlsx'));
    fixture.detectChanges();
    expect(text(el.querySelector('.error')!)).toBe('The sales of 12 Oct 2026 are entered already.');
  });
});
