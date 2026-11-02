import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { of, throwError } from 'rxjs';
import { RecipeCostCard } from '../../core/costing/costing.api';
import { Menu, MenuItem, MenuSalesApi, RecipesToMenuResult } from '../../core/costing/menu-sales.api';
import { AddToMenuData, AddToMenuDialog } from './add-to-menu-dialog';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

// A recipe off the menu, as the recipes list has it.
function standalone(id: string, name: string, overrides: Partial<RecipeCostCard> = {}): RecipeCostCard {
  return {
    targetKind: null, catalogItemId: null, variantId: null, itemCode: '', recipe: name, recipeAr: null, category: null, hasRecipe: true,
    portions: 1, menuPrice: null, foodCostTargetPercent: 30, lines: [], costPerRecipe: 30, ingredientCostPerPortion: 30, sharedCostPerPortion: 0,
    costPerPortion: 30, marginPerPortion: null, foodCostPercentActual: null, idealSellingPrice: 100, missingPrices: [], status: 'NoPrice',
    recipeId: id, recipeName: name, linkedTo: null, isStandalone: true, plannedPrice: null, usesBaseRecipe: false, isDeleted: false,
    deletedAtUtc: null, deletedBy: null, recipeCategoryId: null, recipeCategory: null, recipeCategoryAr: null,
    ...overrides,
  };
}

const alfredo = standalone('r1', 'Alfredo pasta', { costPerPortion: 45, plannedPrice: 165, recipeCategoryId: 'p', recipeCategory: 'Pasta' });
const toast = standalone('r2', 'Cheese toast', { costPerPortion: 15 });
// Named as the burger on the menu.
const burger = standalone('r3', 'burger', { costPerPortion: 40 });

const menuItem = (id: number, name: string, price: number): MenuItem => ({
  id, name, nameAr: null, category: 'Mains', price, isPriceBasedOnAddons: false, isAvailable: true, isDeleted: false, sizes: [], addOnIds: [],
});
const menu: Menu = {
  categories: [
    { id: 1, name: 'Mains', nameAr: null, displayOrder: 1, items: 1 },
    { id: 2, name: 'Drinks', nameAr: null, displayOrder: 2, items: 0 },
  ],
  items: [menuItem(1, 'Burger', 120)],
  addOns: [],
};

const result: RecipesToMenuResult = {
  linked: [
    { recipeId: 'r1', recipe: 'Alfredo pasta', menuItemId: 1001, category: 'Pasta', price: 165, created: true },
    { recipeId: 'r3', recipe: 'burger', menuItemId: 1, category: 'Mains', price: 120, created: false },
  ],
  skipped: [{ recipeId: 'r2', recipe: 'Cheese toast', reason: 'Cheese toast waits for a manager’s approval.', reasonAr: 'بانتظار موافقة المدير.' }],
  categoriesAdded: ['Pasta'],
};

describe('adding recipes to the menu', () => {
  const addRecipesToMenu = vi.fn();
  const close = vi.fn();

  async function render(recipes: RecipeCostCard[] = [alfredo, toast, burger], menuOf = of(menu)) {
    TestBed.configureTestingModule({
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { recipes } satisfies AddToMenuData },
        { provide: MatDialogRef, useValue: { close } },
        { provide: MenuSalesApi, useValue: { menu: () => menuOf, addRecipesToMenu } },
      ],
    });
    const fixture = TestBed.createComponent(AddToMenuDialog);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const page = fixture.componentInstance as unknown as Record<string, any>;
    const rows = () => {
      fixture.detectChanges();
      return [...el.querySelectorAll('table.rows tbody tr')];
    };
    const button = (label: string) => {
      fixture.detectChanges();
      return [...el.querySelectorAll<HTMLButtonElement>('mat-dialog-actions button')].find((b) => text(b).includes(label))!;
    };
    const type = async (input: HTMLInputElement, value: string) => {
      input.value = value;
      input.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      fixture.detectChanges();
    };
    return { fixture, el, page, rows, button, type };
  }

  beforeEach(() => {
    addRecipesToMenu.mockReset().mockReturnValue(of(result));
    close.mockReset();
  });

  it('lists each, chosen, with its cost, its kitchen category and planned price to start from, and links one of a menu item’s name to it', async () => {
    const { el, rows } = await render();

    expect(text(el.querySelector('h2')!)).toBe('Add to the menu إضافة للمنيو');
    expect(rows().map((r) => [...r.querySelectorAll('td')].slice(1).map(text))).toEqual([
      ['Alfredo pasta', 'L.E 45.00', '', 'L.E', '27.3%'],
      ['Cheese toast', 'L.E 15.00', '', 'L.E', '—'],
      ['burger', 'L.E 40.00', 'On the menu as 1 at L.E 120.00: linked to it. موجود في المنيو بكود 1: يُربط به.'],
    ]);
    const inputs = [...el.querySelectorAll<HTMLInputElement>('input.cell')];
    expect(inputs.map((i) => i.value)).toEqual(['Pasta', '165', '', '']);
    expect([...el.querySelectorAll('datalist option')].map((o) => o.getAttribute('value'))).toEqual(['Mains', 'Drinks']);
    expect(text(el.querySelector('.chosen-count')!)).toBe('3 chosen · مختارة');
  });

  it('waits for a category and a price for each new one, filling the category for those with none', async () => {
    const { el, page, button, type } = await render();

    expect(text(el.querySelector('.warn')!)).toContain('1 chosen recipe has no category or price yet');
    expect(button('Add 3 to the menu').disabled).toBe(true);
    expect(el.querySelectorAll('input.cell.missing')).toHaveLength(2);

    page['allCategory'] = 'Snacks';
    page['fillCategory']();
    const [pastaCategory, , , toastPrice] = [...el.querySelectorAll<HTMLInputElement>('input.cell')];
    await type(toastPrice, '45');
    expect(pastaCategory.value).toBe('Pasta');
    expect(el.querySelector('.warn')).toBeNull();
    expect(text(el.querySelectorAll('table.rows tbody tr')[1].querySelectorAll('td')[5])).toBe('33.3%');

    button('Add 3 to the menu').click();
    await page['add']();
    expect(addRecipesToMenu).toHaveBeenCalledWith([
      { recipeId: 'r1', category: 'Pasta', price: 165 },
      { recipeId: 'r2', category: 'Snacks', price: 45 },
      { recipeId: 'r3', category: null, price: null },
    ]);
  });

  it('adds only those chosen, and none when none is', async () => {
    const { page, button } = await render();

    page['chooseAll'](false);
    expect(button('Add 0 to the menu').disabled).toBe(true);
    page['rows']()[0].chosen = true;
    page['touch']();
    expect(button('Add 1 to the menu').disabled).toBe(false);
    await page['add']();
    expect(addRecipesToMenu).toHaveBeenCalledWith([{ recipeId: 'r1', category: 'Pasta', price: 165 }]);
  });

  it('finds a recipe by its name among many', async () => {
    const { page, rows } = await render();

    page['query'].set('  CHEESE ');
    expect(rows().map((r) => text(r.querySelectorAll('td')[1]))).toEqual(['Cheese toast']);
  });

  it('says what went on the menu, by its code, and what did not and why, in both languages; done, the list is read again', async () => {
    const { fixture, el, page, button } = await render([alfredo, burger]);

    await page['add']();
    fixture.detectChanges();
    expect([...el.querySelectorAll('.count')].map(text)).toEqual(['2 on the menu أُضيفت للمنيو', '1 not added لم تُضف']);
    expect(text(el.querySelector('.note')!)).toContain('Now on Sales: choose them on a new sale, or import them by name or code.');
    expect(text(el.querySelector('.muted')!)).toBe('New menu categories · أقسام جديدة في المنيو: Pasta');
    expect([...el.querySelectorAll('table.linked tbody tr')].map((r) => [...r.querySelectorAll('td')].map(text))).toEqual([
      ['1001', 'Alfredo pasta', 'Pasta', 'L.E 165.00', 'New item · صنف جديد'],
      ['1', 'burger', 'Mains', 'L.E 120.00', 'Linked to the item there · رُبطت بالصنف الموجود'],
    ]);
    expect(text(el.querySelector('.skipped li')!)).toBe('Cheese toast: Cheese toast waits for a manager’s approval. بانتظار موافقة المدير.');

    button('Done').click();
    expect(close).toHaveBeenCalledWith(true);
  });

  it('says why it could not, keeping what was typed; cancelled, nothing changed', async () => {
    const { fixture, el, page, button } = await render([alfredo]);
    addRecipesToMenu.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 400, error: { detail: 'Choose the recipes to put on the menu.' } })));

    // One recipe: no finding or filling.
    expect(el.querySelector('.toolbar')).toBeNull();
    await page['add']();
    fixture.detectChanges();
    expect(text(el.querySelector('.error')!)).toBe('Choose the recipes to put on the menu.');
    expect(button('Add 1 to the menu')).toBeTruthy();

    button('Cancel').click();
    expect(close).toHaveBeenCalledWith(false);
  });

  it('says when the menu could not be loaded', async () => {
    const { el } = await render([alfredo], throwError(() => new HttpErrorResponse({ status: 0 })));

    expect(text(el.querySelector('.error')!)).toBe('The server cannot be reached. Check this device is connected.');
  });
});
