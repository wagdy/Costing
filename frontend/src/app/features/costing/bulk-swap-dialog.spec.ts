import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { of, throwError } from 'rxjs';
import { CostingApi, MaterialCost, SwapPreview, UnitOfMeasure, WhereUsedReport } from '../../core/costing/costing.api';
import { NotifyService } from '../../core/ui/notify.service';
import { BulkSwapDialog } from './bulk-swap-dialog';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();
const cells = (row: Element) => [...row.querySelectorAll(':scope > td')].map(text);

function material(id: string, name: string, perGram: number, unit: UnitOfMeasure = 'Gram', kind: MaterialCost['kind'] = 'Purchased'): MaterialCost {
  const size = unit === 'Piece' ? 1 : 1000;
  return {
    id, code: null, name, category: 'Dairy', categoryId: 'dairy', unit, purchaseUnit: unit === 'Piece' ? 'piece' : 'kg', purchaseUnitSize: size,
    costPerPurchaseUnit: perGram * size, defaultYieldPercent: 100, quantityOnHand: 0, reorderLevel: 0, stockValue: null,
    lastPurchaseCostPerPurchaseUnit: null, lastPurchasedAtUtc: null, costPerUnit: perGram, kind,
  };
}

const brandA = material('brandA', 'Mozzarella A', 0.3);
const brandB = material('brandB', 'Mozzarella B', 0.26);
const slices = material('slices', 'Cheese slices', 2, 'Piece');
const sauce = material('sauce', 'Cheese sauce', 0.15, 'Gram', 'Prep');

const usage: WhereUsedReport = {
  materialId: 'brandA', material: 'Mozzarella A', code: null, isPrepItem: false, unit: 'Gram', purchaseUnit: 'kg', purchaseUnitSize: 1000, dishes: 3, prepItems: 1,
  rows: [
    { kind: 'Dish', id: 'margherita', name: 'Margherita', itemCode: '1', category: 'Pizza', portions: 1, batchQuantity: null, batchUnit: null, price: 150,
      cost: 40, foodCostPercent: 26.7, quantity: 100, throughPrepItems: null, via: [], itemCost: 30 },
    { kind: 'Dish', id: 'four-cheese', name: 'Four cheese', itemCode: '2', category: 'Pizza', portions: 1, batchQuantity: null, batchUnit: null, price: 200,
      cost: 60, foodCostPercent: 30, quantity: 60, throughPrepItems: null, via: [], itemCost: 18 },
    { kind: 'Dish', id: 'lasagne', name: 'Lasagne', itemCode: '3', category: 'Pasta', portions: 1, batchQuantity: null, batchUnit: null, price: 180,
      cost: 60, foodCostPercent: 33.3, quantity: null, throughPrepItems: 40, via: ['Cheese sauce'], itemCost: 12 },
    { kind: 'PrepItem', id: 'sauce', name: 'Cheese sauce', itemCode: 'PREP-2', category: 'Sauces', portions: null, batchQuantity: 1000, batchUnit: 'Gram',
      price: null, cost: 150, foodCostPercent: null, quantity: 500, throughPrepItems: null, via: [], itemCost: 150 },
  ],
};

// 80 g of Mozzarella B for 100 of A: the pizzas and the sauce cheaper; the garlic bread waits for a
// manager; the lasagne moves through the sauce.
const preview: SwapPreview = {
  from: { id: 'brandA', name: 'Mozzarella A', code: null, isPrepItem: false, unit: 'Gram', purchaseUnit: 'kg', purchaseUnitSize: 1000, costPerUnit: 0.3 },
  to: { id: 'brandB', name: 'Mozzarella B', code: null, isPrepItem: false, unit: 'Gram', purchaseUnit: 'kg', purchaseUnitSize: 1000, costPerUnit: 0.26 },
  ratio: 0.8,
  unitsDiffer: false,
  rows: [
    { kind: 'Dish', id: 'four-cheese', name: 'Four cheese', itemCode: '2', category: 'Pizza', portions: 1, batchQuantity: null, oldQuantity: 60, newQuantity: 48,
      merged: true, oldCost: 60, newCost: 56.48, costDelta: -3.52, price: 200, oldFoodCostPercent: 30, newFoodCostPercent: 28.2, selected: true, blocked: null,
      fromNextBatch: false },
    { kind: 'Dish', id: 'garlic', name: 'Garlic bread', itemCode: '5', category: 'Sides', portions: 1, batchQuantity: null, oldQuantity: 20, newQuantity: 16,
      merged: false, oldCost: 10, newCost: 9.16, costDelta: -0.84, price: 45, oldFoodCostPercent: 22.2, newFoodCostPercent: 20.4, selected: false,
      blocked: 'Mona has asked a manager about it · بانتظار موافقة', fromNextBatch: false },
    { kind: 'Dish', id: 'margherita', name: 'Margherita', itemCode: '1', category: 'Pizza', portions: 1, batchQuantity: null, oldQuantity: 100, newQuantity: 80,
      merged: false, oldCost: 40, newCost: 30.8, costDelta: -9.2, price: 150, oldFoodCostPercent: 26.7, newFoodCostPercent: 20.5, selected: true, blocked: null,
      fromNextBatch: false },
    { kind: 'PrepItem', id: 'sauce', name: 'Cheese sauce', itemCode: 'PREP-2', category: 'Sauces', portions: null, batchQuantity: 1000, oldQuantity: 500,
      newQuantity: 400, merged: false, oldCost: 150, newCost: 104, costDelta: -46, price: null, oldFoodCostPercent: null, newFoodCostPercent: null,
      selected: true, blocked: null, fromNextBatch: true },
  ],
  knockOn: [
    { kind: 'Dish', id: 'lasagne', name: 'Lasagne', itemCode: '3', via: ['Cheese sauce'], oldCost: 60, newCost: 55.4, costDelta: -4.6, price: 180,
      oldFoodCostPercent: 33.3, newFoodCostPercent: 30.8, fromNextBatch: true },
  ],
};

describe('the bulk material swap (معالج الاستبدال الشامل)', () => {
  const materials = vi.fn();
  const whereUsed = vi.fn();
  const previewBulkSwap = vi.fn();
  const bulkSwap = vi.fn();
  const close = vi.fn();
  const info = vi.fn();

  async function render(data: { fromMaterialId?: string | null } | null = null) {
    TestBed.configureTestingModule({
      providers: [
        { provide: CostingApi, useValue: { materials, whereUsed, previewBulkSwap, bulkSwap } },
        { provide: MatDialogRef, useValue: { close } },
        { provide: NotifyService, useValue: { info, error: vi.fn() } },
        { provide: MAT_DIALOG_DATA, useValue: data },
      ],
    });
    const fixture = TestBed.createComponent(BulkSwapDialog);
    await fixture.whenStable();
    fixture.detectChanges();
    const page = fixture.componentInstance as unknown as Record<string, any>;
    const el = fixture.nativeElement as HTMLElement;
    const settle = async () => {
      await fixture.whenStable();
      fixture.detectChanges();
    };
    const button = (label: string) => [...el.querySelectorAll<HTMLButtonElement>('mat-dialog-actions button')].find((b) => text(b).includes(label))!;
    return { fixture, el, page, settle, button };
  }

  beforeEach(() => {
    materials.mockReset().mockReturnValue(of([brandA, brandB, slices, sauce]));
    whereUsed.mockReset().mockReturnValue(of(usage));
    previewBulkSwap.mockReset().mockReturnValue(of(preview));
    bulkSwap.mockReset().mockReturnValue(of({ recipes: 2, prepItems: 1 }));
    close.mockReset();
    info.mockReset();
  });

  it('walks from the old item to the new one, the ratio and the recipes, and swaps those ticked', async () => {
    const { el, page, settle, button } = await render();
    expect(page['step']()).toBe(1);
    expect(button('Next').disabled).toBe(true);

    // Step 1: where the old item is, on recipes themselves.
    page['pickFrom']('brandA');
    await settle();
    expect(whereUsed).toHaveBeenCalledExactlyOnceWith('brandA');
    expect(text(el.querySelector('.usage')!)).toBe('receipt_long On 2 recipes and 1 prep item · في 2 وصفة و1 مصنّع');
    button('Next').click();
    await settle();

    // Step 2: anything but the old item.
    expect(page['candidates']().map((m: MaterialCost) => m.id)).toEqual(['brandB', 'slices', 'sauce']);
    page['to'].set('brandB');
    await settle();
    expect(text(el.querySelector('.pair')!)).toBe('Old · القديمةMozzarella AL.E 300.00 / kgarrow_forwardNew · الجديدةMozzarella BL.E 260.00 / kg');
    button('Next').click();
    await settle();

    // Step 3: 1:1 to start; 80 g of B for 100 of A.
    expect(page['ratio']()).toBe(1);
    expect(el.querySelectorAll('.ratio app-info-tip, .lead app-info-tip').length).toBe(1);
    page['replacement'].set(80);
    await settle();
    expect(page['ratio']()).toBe(0.8);
    expect(el.querySelector('.warn')).toBeNull();
    button('Next').click();
    await settle();

    // Step 4: every row it can, ticked; the one waiting for a manager locked.
    expect(previewBulkSwap).toHaveBeenCalledExactlyOnceWith({ fromMaterialId: 'brandA', toMaterialId: 'brandB', ratio: 0.8 });
    const rows = [...el.querySelectorAll('table.swap tbody tr')];
    expect(rows.map((r) => cells(r).slice(1))).toEqual([
      ['restaurant DishFour cheese 2 · for 1 portion', '60', '48 added to what is there', 'L.E 60.00', 'L.E 56.48', '−L.E 3.52', '30.0% → 28.2%'],
      ['restaurant DishGarlic bread 5 · for 1 portion lock Mona has asked a manager about it · بانتظار موافقة', '20', '16', 'L.E 10.00', 'L.E 9.16', '−L.E 0.84', '22.2% → 20.4%'],
      ['restaurant DishMargherita 1 · for 1 portion', '100', '80', 'L.E 40.00', 'L.E 30.80', '−L.E 9.20', '26.7% → 20.5%'],
      ['soup_kitchen Prep itemCheese sauce PREP-2 · for a batch of 1,000 g schedule from the next batch · من الدفعة القادمة', '500', '400', 'L.E 150.00', 'L.E 104.00', '−L.E 46.00', '— → —'],
    ]);
    expect(page['chosenRecipes']()).toEqual(['four-cheese', 'margherita']);
    expect(page['chosenPrep']()).toEqual(['sauce']);
    expect(rows[1].querySelector('input[type="checkbox"]')!.hasAttribute('disabled')).toBe(true);
    expect(el.querySelectorAll('table.swap thead app-info-tip').length).toBe(1);
    expect(cells(el.querySelector('table.knock-on tbody tr')!)).toEqual(['Lasagnefrom the next batch · من الدفعة القادمة', 'Cheese sauce', 'L.E 60.00', 'L.E 55.40', '−L.E 4.60', '33.3% → 30.8%']);
    expect(text(el.querySelector('.summary')!)).toBe('2 recipes and 1 prep item chosen');

    // Unticked, it keeps the old item: the costs again without it.
    page['choose'](preview.rows[0], false);
    await page['refresh']();
    expect(previewBulkSwap).toHaveBeenLastCalledWith({
      fromMaterialId: 'brandA', toMaterialId: 'brandB', ratio: 0.8, recipeIds: ['margherita'], prepItemIds: ['sauce'],
    });

    button('Swap').click();
    await settle();
    expect(bulkSwap).toHaveBeenCalledExactlyOnceWith({
      fromMaterialId: 'brandA', toMaterialId: 'brandB', ratio: 0.8, recipeIds: ['margherita'], prepItemIds: ['sauce'],
    });
    expect(info).toHaveBeenCalledExactlyOnceWith('Mozzarella A swapped for Mozzarella B in 2 recipes and 1 prep item. · تم الاستبدال.');
    expect(close).toHaveBeenCalledExactlyOnceWith({ recipes: 2, prepItems: 1 });
  });

  it('starts from the stock card’s item, warns of other units, and needs a ratio', async () => {
    const { el, page, settle, button } = await render({ fromMaterialId: 'brandA' });
    expect(page['step']()).toBe(2);
    expect([...el.querySelectorAll('.steps li')].map((li) => li.className)).toEqual(['done', 'current', '', '']);

    page['to'].set('slices');
    page['step'].set(3);
    await settle();
    expect(text(el.querySelector('.warn')!)).toContain('Mozzarella A is in g, Cheese slices in pc: check the ratio');
    page['replacement'].set(0);
    await settle();
    expect(page['ratio']()).toBeNull();
    expect(button('Next').disabled).toBe(true);
    page['resetRatio']();
    await settle();
    expect(page['ratio']()).toBe(1);

    // A ratio past 1,000 is none.
    page['base'].set(1);
    page['replacement'].set(1001);
    expect(page['ratio']()).toBeNull();
  });

  it('keeps the wizard open and says why when the swap is refused', async () => {
    bulkSwap.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 422, error: { detail: 'Margherita no longer has Mozzarella A.' } })));
    const { el, page, settle, button } = await render({ fromMaterialId: 'brandA' });
    page['to'].set('brandB');
    page['step'].set(3);
    await settle();
    button('Next').click();
    await settle();
    button('Swap').click();
    await settle();
    expect(close).not.toHaveBeenCalled();
    expect(text(el.querySelector('[role="alert"]')!)).toContain('Margherita no longer has Mozzarella A.');
  });

  it('cannot go on from an item on no recipe itself', async () => {
    whereUsed.mockReturnValue(of({ ...usage, rows: [usage.rows[2]] }));
    const { el, page, settle, button } = await render();
    page['pickFrom']('brandA');
    await settle();
    expect(text(el.querySelector('.usage')!)).toBe('info Mozzarella A is on no recipe itself, only inside prep items: nothing to swap.');
    expect(button('Next').disabled).toBe(true);
  });
});
