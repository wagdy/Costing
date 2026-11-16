import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { of, throwError } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { Permissions } from '../../core/auth/permissions';
import { ComboOffer, ComboOffersReport, CostingApi, RecipeCostCard } from '../../core/costing/costing.api';
import { NotifyService } from '../../core/ui/notify.service';
import { ComboDialog, ComboDialogData } from './combo-dialog';
import { CombosPage } from './combos-page';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();
const cells = (row: Element) => [...row.querySelectorAll(':scope > td')].map(text);

function card(recipeId: string, recipe: string, cost: number, price: number | null, itemCode = ''): RecipeCostCard {
  return {
    targetKind: itemCode ? 'MenuItem' : null, catalogItemId: null, variantId: null, itemCode, recipe, recipeAr: null, category: 'Mains', hasRecipe: true,
    portions: 1, menuPrice: price, foodCostTargetPercent: 30, lines: [], costPerRecipe: cost, ingredientCostPerPortion: cost, sharedCostPerPortion: 0,
    costPerPortion: cost, marginPerPortion: null, foodCostPercentActual: null, idealSellingPrice: 0, missingPrices: [], status: 'WithinTarget', recipeId,
    recipeName: null, linkedTo: null, isStandalone: !itemCode, plannedPrice: null, usesBaseRecipe: false, isDeleted: false, deletedAtUtc: null, deletedBy: null,
    recipeCategoryId: null, recipeCategory: null, recipeCategoryAr: null,
  };
}

const burger = card('burger', 'Burger', 35, 120, '1');
const lemonade = card('lemonade', 'Lemonade', 2, 30, '20');
const dip = card('dip', 'Garlic dip', 4, null);

const duo: ComboOffer = {
  id: 'duo', code: 9001, name: 'Burger duo', nameAr: 'ثنائي البرجر', sellingPrice: 250, isActive: true, isDeleted: false,
  items: [
    { recipeId: 'burger', dish: 'Burger', itemCode: '1', quantity: 2, costPerPortion: 35, lineCost: 70, price: 120, linePrice: 240, isDeleted: false, missingPrices: [] },
    { recipeId: 'lemonade', dish: 'Lemonade', itemCode: '20', quantity: 2, costPerPortion: 2, lineCost: 4, price: 30, linePrice: 60, isDeleted: false, missingPrices: [] },
  ],
  totalCost: 74, originalPrice: 300, savings: 50, savingsPercent: 16.7, foodCostPercent: 29.6, foodCostTargetPercent: 30, status: 'WithinTarget', missingPrices: [],
};

describe('combo offers (العروض المجمعة)', () => {
  const combos = vi.fn();
  const recipes = vi.fn();
  const saveCombo = vi.fn();
  const deleteCombo = vi.fn();
  const open = vi.fn();
  const close = vi.fn();
  const info = vi.fn();

  beforeEach(() => {
    combos.mockReset().mockReturnValue(of({ nextCode: 9002, foodCostTargetPercent: 30, combos: [duo] } satisfies ComboOffersReport));
    recipes.mockReset().mockReturnValue(of([burger, lemonade, dip]));
    saveCombo.mockReset().mockReturnValue(of({ id: 'new', code: 9002 }));
    deleteCombo.mockReset().mockReturnValue(of(undefined));
    open.mockReset().mockReturnValue({ afterClosed: () => of(true) });
    close.mockReset();
    info.mockReset();
  });

  function providers(canManage = true) {
    return [
      { provide: CostingApi, useValue: { combos, recipes, saveCombo, deleteCombo } },
      { provide: MatDialog, useValue: { open } },
      { provide: NotifyService, useValue: { info, error: vi.fn() } },
      { provide: AuthService, useValue: { can: (p: string) => p !== Permissions.InventoryManage || canManage } },
    ];
  }

  it('lists each combo with its dishes, its cost, its price apart and its food cost %', async () => {
    TestBed.configureTestingModule({ providers: providers() });
    const fixture = TestBed.createComponent(CombosPage);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    const row = el.querySelector('table.combos tbody tr')!;
    expect(cells(row).slice(0, 7)).toEqual([
      '9001', 'Burger duoثنائي البرجر', '2× Burger + 2× Lemonade', 'L.E 250.00', 'L.E 74.00', 'L.E 300.00 saves 16.7%', '29.6%Within target',
    ]);
    expect(el.querySelectorAll('table.combos thead app-info-tip').length).toBe(3);

    // A new one starts at the next number, with every recipe to choose from; saved, the list is read again.
    [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => text(b).includes('New combo'))!.click();
    await fixture.whenStable();
    expect(open).toHaveBeenCalledWith(ComboDialog, expect.objectContaining({
      data: { combo: null, nextCode: 9002, foodCostTargetPercent: 30, recipes: [burger, lemonade, dip] },
    }));
    expect(combos).toHaveBeenCalledTimes(2);
  });

  it('builds a combo from recipes, worked out as it is filled in, and saves it', async () => {
    TestBed.configureTestingModule({
      providers: [
        ...providers(),
        { provide: MatDialogRef, useValue: { close } },
        { provide: MAT_DIALOG_DATA, useValue: { combo: null, nextCode: 9002, foodCostTargetPercent: 30, recipes: [burger, lemonade, dip] } satisfies ComboDialogData },
      ],
    });
    const fixture = TestBed.createComponent(ComboDialog);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const page = fixture.componentInstance as unknown as Record<string, any>;
    const tiles = () => {
      fixture.detectChanges();
      return [...el.querySelectorAll('.summary .tile strong')].map(text);
    };

    expect(page['code']()).toBe(9002);
    expect(el.querySelectorAll('.summary app-info-tip').length).toBe(3);
    page['name'].set('Burger duo');
    page['change'](0, { recipeId: 'burger', quantity: 2 });
    page['change'](1, { recipeId: 'lemonade', quantity: 2 });
    page['price'].set(250);
    expect(tiles()).toEqual(['L.E 74.00', 'L.E 300.00', '29.6%']);
    expect(text(el.querySelectorAll('.summary .chip')[0])).toBe('saves L.E 50.00 · 16.7%');
    expect(cells(el.querySelectorAll('table.dishes tbody tr')[0]).slice(2, 5)).toEqual(['L.E 35.00', 'L.E 70.00', 'L.E 240.00']);

    // A dish with no price of its own: no price apart. Cheaper, the food cost goes over the target.
    page['add']();
    page['change'](2, { recipeId: 'dip', quantity: 1 });
    page['price'].set(200);
    expect(tiles()).toEqual(['L.E 78.00', '—', '39.0%']);
    expect(el.querySelector('.summary .tile.key')!.classList).toContain('over');
    page['remove'](2);

    await page['save']();
    expect(saveCombo).toHaveBeenCalledWith(expect.any(String), {
      code: 9002, name: 'Burger duo', nameAr: null, sellingPrice: 200, isActive: true, items: [{ recipeId: 'burger', quantity: 2 }, { recipeId: 'lemonade', quantity: 2 }],
    });
    expect(close).toHaveBeenCalledWith(true);
  });

  it('says what is missing, and why the server refused it, without closing', async () => {
    saveCombo.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 422, error: { detail: 'Number 9002 is Burger\'s on the menu: choose another.' } })));
    TestBed.configureTestingModule({
      providers: [
        ...providers(),
        { provide: MatDialogRef, useValue: { close } },
        { provide: MAT_DIALOG_DATA, useValue: { combo: duo, nextCode: 9002, foodCostTargetPercent: 30, recipes: [burger, lemonade] } satisfies ComboDialogData },
      ],
    });
    const fixture = TestBed.createComponent(ComboDialog);
    await fixture.whenStable();
    fixture.detectChanges();
    const page = fixture.componentInstance as unknown as Record<string, any>;
    const el = fixture.nativeElement as HTMLElement;

    // A combo kept: its code fixed, its dishes as saved.
    expect((el.querySelector('input[aria-label="Code"]') as HTMLInputElement).disabled).toBe(true);
    expect(page['lines']()).toEqual([{ recipeId: 'burger', quantity: 2 }, { recipeId: 'lemonade', quantity: 2 }]);

    page['price'].set(null);
    await page['save']();
    expect(page['problem']()).toBe("Set the combo's price. · حدد سعر العرض.");
    page['price'].set(250);
    page['change'](0, { quantity: 0 });
    await page['save']();
    expect(page['problem']()).toBe('Choose each dish and how many of it, 1 to 99. · اختر الأصناف وعددها.');
    page['change'](0, { quantity: 2 });
    await page['save']();
    expect(saveCombo.mock.lastCall![0]).toBe('duo');
    expect(page['problem']()).toContain("Number 9002 is Burger's on the menu");
    expect(close).not.toHaveBeenCalled();
  });

  it('shows the combos without building them to anyone who may not change recipes', async () => {
    TestBed.configureTestingModule({ providers: providers(false) });
    const fixture = TestBed.createComponent(CombosPage);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('table.combos tbody tr').length).toBe(1);
    expect([...el.querySelectorAll('button')].some((b) => /New combo|Edit|Delete/.test(text(b) + (b.getAttribute('aria-label') ?? '')))).toBe(false);
  });
});
