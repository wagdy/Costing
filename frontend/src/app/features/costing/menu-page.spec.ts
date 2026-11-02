import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { of, throwError } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { Menu, MenuItem, MenuSalesApi } from '../../core/costing/menu-sales.api';
import { NotifyService } from '../../core/ui/notify.service';
import { MenuItemDialog, MenuPage } from './menu-page';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

function item(overrides: Partial<MenuItem>): MenuItem {
  return {
    id: 1, name: 'Item', nameAr: null, category: 'Pizza', price: 0, isPriceBasedOnAddons: false, isAvailable: true, isDeleted: false,
    sizes: [], addOnIds: [], ...overrides,
  };
}
const margherita = item({
  id: 6101, name: 'Margherita', nameAr: 'مارجريتا', sizes: [{ id: 1, name: 'Medium', nameAr: null, price: 160 }, { id: 2, name: 'Large', nameAr: 'كبير', price: 180 }],
  addOnIds: [3],
});
const lemonade = item({ id: 20, name: 'Lemonade', category: 'Drinks', price: 30, isAvailable: false });
const grill = item({ id: 30, name: 'Mixed grill', category: 'Grill', isPriceBasedOnAddons: true, isDeleted: true });
const menu: Menu = {
  categories: [
    { id: 1, name: 'Pizza', nameAr: 'بيتزا', displayOrder: 0, items: 1 },
    { id: 2, name: 'Drinks', nameAr: null, displayOrder: 1, items: 1 },
    { id: 3, name: 'Grill', nameAr: null, displayOrder: 2, items: 0 },
  ],
  items: [margherita, lemonade, grill],
  addOns: [{ id: 3, name: 'Cheese', nameAr: 'جبنة', price: 15, isDeleted: false }],
};

describe('the menu', () => {
  const api = { menu: vi.fn(), importMenu: vi.fn(), deleteItem: vi.fn(), restoreItem: vi.fn() };
  const notify = { info: vi.fn(), error: vi.fn() };
  const open = vi.fn();

  async function render(canChange = true) {
    TestBed.configureTestingModule({
      providers: [
        { provide: MenuSalesApi, useValue: api },
        { provide: AuthService, useValue: { me: () => null, can: () => canChange } },
        { provide: NotifyService, useValue: notify },
        { provide: MatDialog, useValue: { open } },
      ],
    });
    const fixture = TestBed.createComponent(MenuPage);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const rows = () => {
      fixture.detectChanges();
      // Its code, name, category, price, sizes (each its own line) and add-ons.
      return [...el.querySelectorAll('table[aria-label="Menu items"] tbody tr')].map((r) =>
        [...r.querySelectorAll('td')].slice(0, 6).map((td, i) => (i === 4 ? [...td.querySelectorAll('div')].map(text).join(' | ') || text(td) : text(td))),
      );
    };
    return { el, rows, page: fixture.componentInstance as unknown as Record<string, any> };
  }

  beforeEach(() => {
    api.menu.mockReset().mockReturnValue(of(menu));
    api.importMenu.mockReset();
    api.restoreItem.mockReset().mockReturnValue(of(grill));
    notify.info.mockReset();
    notify.error.mockReset();
    open.mockReset();
  });

  it('lists each item by its code, its sizes by theirs, priced by its own or its add-ons', async () => {
    const { el, rows } = await render();

    expect(rows()).toEqual([
      ['6101', 'Margheritaمارجريتا', 'Pizza', '—', '6101-1 · Medium · L.E 160.00 | 6101-2 · Large · L.E 180.00', 'Cheese'],
      ['20', 'LemonadeNot on saleغير متاح', 'Drinks', 'L.E 30.00', '—', '—'],
      ['30', 'Mixed grillDeletedمحذوف', 'Grill', 'By add-ons', '—', '—'],
    ]);
    // Each category with how many items it has; one with none can be deleted.
    expect([...el.querySelectorAll('.categories .chip')].map((c) => [text(c.querySelector('.count')!), c.querySelectorAll('button').length])).toEqual([
      ['1', 1], ['1', 1], ['0', 2],
    ]);
    expect([...el.querySelectorAll('table[aria-label="Add-ons"] tbody td')].slice(0, 3).map(text)).toEqual(['A3', 'Cheeseجبنة', 'L.E 15.00']);
  });

  it('finds an item by its name, its Arabic name or its code, in a category', async () => {
    const { rows, page } = await render();

    page['query'].set('مارج');
    expect(rows().map((r) => r[0])).toEqual(['6101']);
    page['query'].set('20');
    expect(rows().map((r) => r[0])).toEqual(['20']);
    page['query'].set('');
    page['category'].set('Drinks');
    expect(rows().map((r) => r[0])).toEqual(['20']);
    expect(page['categoryFilters']().map((f: { label: string; count: number }) => `${f.label} ${f.count}`)).toEqual([
      'All · الكل 2', 'Pizza 1', 'Drinks 1', 'Grill 0',
    ]);
  });

  it('brings a deleted item back, and says what an import added, changed and left out', async () => {
    api.importMenu.mockReturnValue(of({ added: 2, updated: 1, categoriesAdded: 1, skipped: [{ row: 7, name: 'Soup', reason: 'Give it a price.' }] }));
    const { el, page } = await render();

    await page['restore'](grill);
    expect(api.restoreItem).toHaveBeenCalledWith(30);
    expect(notify.info).toHaveBeenCalledWith('Mixed grill is back on the menu.');

    const input = { files: [new File(['x'], 'menu.xlsx')], value: 'C:\\fakepath\\menu.xlsx' } as unknown as HTMLInputElement;
    await page['import']({ target: input } as unknown as Event);
    TestBed.tick();
    expect(input.value).toBe('');
    expect(text(el.querySelector('[role=status]')!)).toBe('2 added, 1 changed, 1 new categories.Row 7 · Soup: Give it a price.');
  });

  it('shows the menu, and changes nothing, for whoever may not change it', async () => {
    const { el } = await render(false);

    expect(el.querySelectorAll('tbody button')).toHaveLength(0);
    expect([...el.querySelectorAll('.toolbar > button')].map(text)).toEqual([]);
  });
});

describe('an item of the menu', () => {
  const addItem = vi.fn();
  const saveItem = vi.fn();
  const close = vi.fn();

  async function render(existing?: MenuItem) {
    TestBed.configureTestingModule({
      providers: [
        { provide: MenuSalesApi, useValue: { addItem, saveItem } },
        { provide: MAT_DIALOG_DATA, useValue: { item: existing, menu } },
        { provide: MatDialogRef, useValue: { close } },
      ],
    });
    const fixture = TestBed.createComponent(MenuItemDialog);
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, page: fixture.componentInstance as unknown as Record<string, any> };
  }

  beforeEach(() => {
    addItem.mockReset();
    saveItem.mockReset();
    close.mockReset();
  });

  it('adds a new one in the first category, its sizes and add-ons as typed', async () => {
    const saved = item({ id: 6102, name: 'Pepperoni' });
    addItem.mockReturnValue(of(saved));
    const { page } = await render();

    expect(page['category']).toBe('Pizza');
    Object.assign(page, { name: ' Pepperoni ', nameAr: ' ', price: '150', sizes: [{ name: ' Large ', nameAr: '', price: '190' }], addOnIds: [3] });
    await page['save']();

    expect(addItem).toHaveBeenCalledWith({
      number: null, name: 'Pepperoni', nameAr: null, category: 'Pizza', price: 150, isPriceBasedOnAddons: false, isAvailable: true,
      sizes: [{ name: 'Large', nameAr: null, price: 190 }], addOnIds: [3],
    });
    expect(close).toHaveBeenCalledWith(saved);
  });

  it('changes one by its code, and says why the API refused it', async () => {
    saveItem.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 422, error: { detail: 'An item cannot have two sizes named Large.' } })));
    const { fixture, el, page } = await render(margherita);

    expect(page['sizes']).toEqual([{ name: 'Medium', nameAr: null, price: 160 }, { name: 'Large', nameAr: 'كبير', price: 180 }]);
    await page['save']();
    fixture.detectChanges();

    expect(saveItem.mock.lastCall![0]).toBe(6101);
    expect(close).not.toHaveBeenCalled();
    expect(text(el)).toContain('An item cannot have two sizes named Large.');
  });
});
