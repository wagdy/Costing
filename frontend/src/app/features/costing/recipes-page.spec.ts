import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { Permissions } from '../../core/auth/permissions';
import { CostingApi, ApprovalRequest, RecipeCategory, RecipeCostCard, WhereUsedReport } from '../../core/costing/costing.api';
import { IntelligenceApi } from '../../core/costing/intelligence.api';
import { NotifyService } from '../../core/ui/notify.service';
import { AddToMenuDialog } from './add-to-menu-dialog';
import { DeleteRequestDialog } from './approvals';
import { BulkSwapDialog } from './bulk-swap-dialog';
import { periodDays } from './period-bar';
import { RecipesPage } from './recipes-page';
import { SheetImportData, SheetImportDialog } from './sheet-import-dialog';

// Mona's request to delete a recipe, waiting for a manager.
function request(recipeId: string): ApprovalRequest {
  return {
    id: 'q1', module: 'Recipe', action: 'Delete', recordId: recipeId, summary: 'Recipe Classic Cheeseburger', changes: [], reason: 'Duplicate', requestedBy: 'Mona',
    requestedAtUtc: '2026-10-08T09:00:00Z', status: 'Pending', decidedBy: null, decidedAtUtc: null, decisionNote: null,
  };
}

function card(overrides: Partial<RecipeCostCard>): RecipeCostCard {
  return {
    targetKind: 'MenuItem',
    catalogItemId: 6,
    variantId: null,
    itemCode: '6',
    recipe: 'Classic Cheeseburger',
    recipeAr: null,
    category: 'Mains',
    hasRecipe: true,
    portions: 1,
    menuPrice: 120,
    foodCostTargetPercent: 30,
    lines: [],
    costPerRecipe: 30,
    ingredientCostPerPortion: 30,
    sharedCostPerPortion: 0,
    costPerPortion: 30,
    marginPerPortion: 90,
    foodCostPercentActual: 25,
    idealSellingPrice: 100,
    missingPrices: [],
    status: 'WithinTarget',
    recipeId: 'r1',
    recipeName: null,
    linkedTo: 'Classic Cheeseburger',
    isStandalone: false,
    plannedPrice: null,
    usesBaseRecipe: false,
    isDeleted: false,
    deletedAtUtc: null,
    deletedBy: null,
    recipeCategoryId: 'mains',
    recipeCategory: 'Mains',
    recipeCategoryAr: null,
    ...overrides,
  };
}

const burger = card({});
const trial = card({
  recipeId: 'r2', recipe: 'Smash trial', recipeName: 'Smash trial', targetKind: null, catalogItemId: null, itemCode: '', linkedTo: null,
  isStandalone: true, menuPrice: 60, plannedPrice: 60, foodCostPercentActual: 55, status: 'AboveTarget', recipeCategoryId: null, recipeCategory: null,
});
const mains: RecipeCategory = { id: 'mains', name: 'Mains', nameAr: null, recipes: 1, prepItems: 0 };
const sauces: RecipeCategory = { id: 'sauces', name: 'Sauces', nameAr: 'صوصات', recipes: 1, prepItems: 0 };
const garlicDip = card({
  recipeId: 'r4', recipe: 'Garlic dip', recipeName: 'Garlic dip', targetKind: null, catalogItemId: null, itemCode: '', linkedTo: null,
  isStandalone: true, menuPrice: null, costPerPortion: 4, foodCostPercentActual: null, status: 'NoPrice',
  recipeCategoryId: 'sauces', recipeCategory: 'Sauces', recipeCategoryAr: 'صوصات',
});
const unsorted = card({ recipeId: 'r5', recipe: 'Tray bake', recipeName: 'Tray bake', recipeCategoryId: null, recipeCategory: null, costPerPortion: 50, foodCostPercentActual: 40 });
const old = card({ recipeId: 'r3', recipe: 'Old burger', recipeName: 'Old burger', isDeleted: true, deletedAtUtc: '2026-10-01T10:00:00Z', deletedBy: 'Omar' });
// On the menu: the burger sells by r1; garlic bread and the shawarma's large tray have no recipe.
const menu = [
  burger,
  card({ catalogItemId: 1, itemCode: '1', recipe: 'Garlic Bread', linkedTo: 'Garlic Bread', hasRecipe: false, recipeId: null, menuPrice: 25 }),
  card({ catalogItemId: 10, variantId: 101, itemCode: '10-101', recipe: 'Shawarma (Large tray)', linkedTo: 'Shawarma (Large tray)', hasRecipe: false, recipeId: null }),
];

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

describe('the recipes', () => {
  const recipes = vi.fn();
  const deleteRecipe = vi.fn();
  const restoreRecipe = vi.fn();
  const requestDeletion = vi.fn();
  const approvalRequests = vi.fn();
  const exportRecipes = vi.fn();
  const importRecipes = vi.fn();
  const recipesTemplate = vi.fn();
  const materials = vi.fn(() => of([]));
  const whereUsed = vi.fn();
  const burdenedCosts = vi.fn();
  // The delete dialog, answered with a reason.
  const open = vi.fn();
  const notify = { info: vi.fn(), error: vi.fn() };

  // A manager approves deletions; anyone else (an accountant) asks for them. Whoever works the
  // menu (its tab, and changing stock records) puts a recipe on it.
  async function render({ manager = true, menuTab = false, canManage = true, tabs = null as string[] | null } = {}) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: CostingApi,
          useValue: {
            recipes, menu: () => of(menu), deleteRecipe, restoreRecipe, requestDeletion, approvalRequests, exportRecipes, importRecipes, recipesTemplate,
            recipeCategories: () => of([mains, sauces]), materials, whereUsed,
          },
        },
        { provide: IntelligenceApi, useValue: { burdenedCosts } },
        { provide: NotifyService, useValue: notify },
        { provide: MatDialog, useValue: { open } },
        {
          provide: AuthService,
          useValue: {
            me: () => (tabs ? { tabs } : menuTab ? { tabs: ['Recipes', 'Menu'] } : null),
            can: (p: string) => (p !== Permissions.ApprovalDecide || manager) && (p !== Permissions.InventoryManage || canManage),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(RecipesPage);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const rows = () => {
      fixture.detectChanges();
      return [...el.querySelectorAll('tbody tr')];
    };
    const button = (row: Element, label: string) =>
      [...row.querySelectorAll('button')].find((b) => text(b).includes(label) || b.getAttribute('aria-label')?.startsWith(label))!;
    return { el, rows, button, page: fixture.componentInstance as unknown as Record<string, any> };
  }

  beforeEach(() => {
    recipes.mockReset().mockReturnValue(of([burger, trial, old]));
    deleteRecipe.mockReset().mockReturnValue(of(undefined));
    restoreRecipe.mockReset().mockReturnValue(of({ id: 'r3', catalogItemId: null }));
    requestDeletion.mockReset();
    approvalRequests.mockReset().mockReturnValue(of({ pending: [], decided: [] }));
    open.mockReset().mockReturnValue({ afterClosed: () => of({ reason: 'Duplicate' }) });
    notify.info.mockReset();
    notify.error.mockReset();
    exportRecipes.mockReset().mockReturnValue(of(new Blob(['xlsx'])));
  });

  it('exports the recipes to Excel, and imports a sheet in the dialog, reading the list again when it changed it', async () => {
    const { el, page } = await render();
    expect([...el.querySelectorAll('.toolbar button, .toolbar a')].map(text).slice(-3)).toEqual([
      'download Export Excel تصدير إلى إكسل',
      'upload_file Import Excel استيراد من إكسل',
      'add Create New Recipe',
    ]);

    let saved: HTMLAnchorElement | undefined;
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved = this;
    });
    URL.createObjectURL = vi.fn(() => 'blob:export');
    URL.revokeObjectURL = vi.fn();
    await page['exportExcel']();
    expect(saved!.download).toMatch(/^recipes-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(notify.info).toHaveBeenCalledWith('Recipes exported to Excel. · تم تصدير الوصفات إلى إكسل.');
    click.mockRestore();

    open.mockReturnValue({ afterClosed: () => of(true) });
    const loads = recipes.mock.calls.length;
    await page['importExcel']();
    expect(open).toHaveBeenCalledWith(SheetImportDialog, expect.objectContaining({ width: '860px' }));
    const data = open.mock.lastCall![1].data as SheetImportData;
    expect([data.title.ar, data.templateName, data.noun.many]).toEqual(['استيراد الوصفات من إكسل', 'recipes-template.xlsx', 'recipes']);
    const file = new File(['xlsx'], 'recipes.xlsx');
    data.upload(file);
    data.template();
    expect(importRecipes).toHaveBeenCalledWith(file);
    expect(recipesTemplate).toHaveBeenCalled();
    expect(recipes.mock.calls.length).toBeGreaterThan(loads);
  });

  it('lists the recipes, each linked to the menu or standalone, with View, Edit and Delete', async () => {
    const { el, rows } = await render();

    expect(recipes).toHaveBeenCalledWith(true);
    expect(rows().map((r) => [...r.querySelectorAll('td')].slice(0, 7).map(text))).toEqual([
      ['Classic Cheeseburger', 'Mains', 'Linked to menu: Classic Cheeseburgerمرتبطة بالمنيو', '1', 'L.E 120.00', 'L.E 30.00', '25.0%'],
      ['Smash trial', 'Uncategorized', 'Standalone / Off-menuمستقلة', '1', 'L.E 60.00 planned', 'L.E 30.00', '55.0%'],
    ]);
    expect(rows().map((r) => [...r.querySelectorAll('td.actions button')].map((b) => b.getAttribute('aria-label') ?? text(b)))).toEqual([
      ['View Classic Cheeseburger', 'Edit Classic Cheeseburger', 'Delete Classic Cheeseburger'],
      ['View Smash trial', 'Edit Smash trial', 'Delete Smash trial'],
    ]);
    expect(text(el.querySelector('.counts')!)).toBe('2 recipes: 1 linked to the menu, 1 off it. 2 menu items have no recipe.');
    expect([...el.querySelectorAll('thead th button.sort')].map(text)).toEqual(['Recipe ↑', 'Category', 'Cost per portion', 'Food cost %']);
    expect(text(el.querySelector('a.create')!)).toBe('add Create New Recipe');
  });

  it('shows only those on the menu, or off it', async () => {
    const { page } = await render();

    page['view'].set('linked');
    expect(page['shown']()).toEqual([burger]);
    page['view'].set('standalone');
    expect(page['shown']()).toEqual([trial]);
  });

  it('views and edits a recipe', async () => {
    const { rows, button } = await render();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    button(rows()[1], 'View').click();
    expect(navigate).toHaveBeenLastCalledWith(['/costing/recipes/recipe', 'r2']);
    button(rows()[1], 'Edit').click();
    expect(navigate).toHaveBeenLastCalledWith(['/costing/recipes/recipe', 'r2', 'edit']);
  });

  it('deletes through the approvals, warning that a linked menu item stops taking stock', async () => {
    const { rows, button } = await render();
    requestDeletion.mockReturnValue(of({ outcome: 'Applied', request: { ...request('r1'), status: 'Approved' } }));

    button(rows()[0], 'Delete').click();

    await vi.waitFor(() => expect(requestDeletion).toHaveBeenCalledWith(expect.any(String), 'Recipe', 'r1', 'Duplicate'));
    expect(open).toHaveBeenCalledWith(
      DeleteRequestDialog,
      expect.objectContaining({
        data: {
          module: 'Recipe',
          what: 'Classic Cheeseburger',
          canApprove: true,
          detail: 'Sales of Classic Cheeseburger stop taking stock until another recipe is linked to it.',
        },
      }),
    );
    expect(notify.info).toHaveBeenCalledWith('Classic Cheeseburger deleted.');
    await vi.waitFor(() => expect(recipes).toHaveBeenCalledTimes(2));
  });

  it('asks a manager, for an accountant, and marks the recipe waiting and locked', async () => {
    const { rows, button } = await render({ manager: false });
    const asked = request('r1');
    requestDeletion.mockReturnValue(of({ outcome: 'Requested', request: asked }));
    approvalRequests.mockReturnValue(of({ pending: [asked], decided: [] }));

    button(rows()[0], 'Delete').click();

    await vi.waitFor(() => expect(notify.info).toHaveBeenCalledWith('Deletion request submitted to the manager for approval.'));
    expect(open.mock.lastCall![1].data.canApprove).toBe(false);
    await vi.waitFor(() => expect(rows()[0].classList).toContain('pending-deletion'));
    expect(text(rows()[0])).toContain('Deletion requested');
    expect(text(rows()[0])).toContain('by Mona');
    // Locked until a manager decides: no Edit, no second Delete. Nothing was deleted.
    expect(button(rows()[0], 'Edit')).toBeUndefined();
    expect(button(rows()[0], 'Delete')).toBeUndefined();
    expect(recipes).toHaveBeenCalledTimes(1);
  });

  it('can be talked out of deleting', async () => {
    const { rows, button } = await render();
    open.mockReturnValue({ afterClosed: () => of(undefined) });

    button(rows()[1], 'Delete').click();

    await vi.waitFor(() => expect(open).toHaveBeenCalled());
    expect(requestDeletion).not.toHaveBeenCalled();
  });

  it('shows the deleted ones apart, with who deleted them, to restore', async () => {
    const { page, rows, button } = await render();
    page['view'].set('deleted');

    expect(rows().map((r) => text(r.querySelectorAll('td')[7]))).toEqual(['Deleted 1 Oct 2026 by Omar']);
    button(rows()[0], 'Restore').click();

    await vi.waitFor(() => expect(restoreRecipe).toHaveBeenCalledWith('r3', 'Old burger'));
    expect(notify.info).toHaveBeenCalledWith('Old burger restored off the menu: Classic Cheeseburger has another recipe now.');
  });

  it('lists the menu items with no recipe, each a click from a new one linked to it', async () => {
    const { page, rows, button } = await render();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    page['view'].set('unrecipied');

    expect(rows().map((r) => [...r.querySelectorAll('td')].slice(0, 2).map(text))).toEqual([
      ['1', 'Garlic Bread'],
      ['10-101', 'Shawarma (Large tray)'],
    ]);
    button(rows()[1], 'Create recipe').click();
    expect(navigate).toHaveBeenCalledWith(['/costing/recipes/new'], { queryParams: { targetKind: 'MenuItem', catalogItemId: 10, variantId: 101 } });
  });

  it('puts a standalone recipe on the menu, one or all those shown, for whoever works the menu', async () => {
    recipes.mockReturnValue(of([burger, trial, garlicDip, old]));
    const { el, page, rows, button } = await render({ menuTab: true });
    const toolbarButton = () => {
      rows();
      return [...el.querySelectorAll('.toolbar button.to-menu')].map(text);
    };

    // Not for one on the menu already.
    expect(rows().map((r) => [...r.querySelectorAll('td.actions button')].map((b) => b.getAttribute('aria-label')))).toEqual([
      ['View Classic Cheeseburger', 'Edit Classic Cheeseburger', 'Delete Classic Cheeseburger'],
      ['View Garlic dip', 'Add Garlic dip to the menu', 'Edit Garlic dip', 'Delete Garlic dip'],
      ['View Smash trial', 'Add Smash trial to the menu', 'Edit Smash trial', 'Delete Smash trial'],
    ]);
    expect(toolbarButton()).toEqual(['restaurant_menu Add 2 to menu إضافة للمنيو']);

    open.mockReturnValue({ afterClosed: () => of(true) });
    button(rows()[2], 'Add Smash trial').click();
    await vi.waitFor(() => expect(recipes).toHaveBeenCalledTimes(2));
    expect(open).toHaveBeenLastCalledWith(AddToMenuDialog, expect.objectContaining({ data: { recipes: [trial] }, width: '820px' }));

    // Those shown: in one category, the one there.
    page['category'].set('sauces');
    expect(toolbarButton()).toEqual(['restaurant_menu Add 1 to menu إضافة للمنيو']);
    page['category'].set('');
    open.mockReturnValue({ afterClosed: () => of(false) });
    await page['addToMenu'](page['toMenu']());
    expect(open).toHaveBeenLastCalledWith(AddToMenuDialog, expect.objectContaining({ data: { recipes: [garlicDip, trial] }, width: '1000px' }));
    // Cancelled: not read again.
    expect(recipes).toHaveBeenCalledTimes(2);

    page['view'].set('linked');
    expect(toolbarButton()).toEqual([]);
  });

  it('does not offer the menu to one without its tab, or who cannot change stock records', async () => {
    recipes.mockReturnValue(of([trial]));
    const withoutTab = await render();
    expect(withoutTab.el.querySelector('.to-menu')).toBeNull();
    TestBed.resetTestingModule();

    const storekeeper = await render({ menuTab: true, canManage: false });
    expect(storekeeper.el.querySelector('.to-menu')).toBeNull();
  });

  describe('by category', () => {
    beforeEach(() => recipes.mockReturnValue(of([burger, trial, garlicDip, unsorted])));

    it('shows one category, or the uncategorized ones', async () => {
      const { page } = await render();

      page['category'].set('sauces');
      expect(page['shown']()).toEqual([garlicDip]);
      page['category'].set(page['uncategorized']);
      expect(page['shown']().map((c: RecipeCostCard) => c.recipe)).toEqual(['Smash trial', 'Tray bake']);
      page['category'].set('');
      expect(page['shown']()).toHaveLength(4);
    });

    it('starts on the category a count was clicked for', async () => {
      TestBed.configureTestingModule({
        providers: [
          provideRouter([]),
          { provide: CostingApi, useValue: { recipes, menu: () => of(menu), deleteRecipe, restoreRecipe, recipeCategories: () => of([mains, sauces]), materials } },
          { provide: IntelligenceApi, useValue: { burdenedCosts } },
          { provide: NotifyService, useValue: notify },
        ],
      });
      const fixture = TestBed.createComponent(RecipesPage);
      fixture.componentRef.setInput('category', 'sauces');
      await fixture.whenStable();

      expect((fixture.componentInstance as unknown as Record<string, any>)['shown']()).toEqual([garlicDip]);
      // In the advanced filters, opened on it.
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).querySelector('#advanced-filters')).not.toBeNull();
    });

    it('sorts by category, the uncategorized last, and back the other way', async () => {
      const { page, el } = await render();
      const names = () => page['shown']().map((c: RecipeCostCard) => c.recipe);

      expect(names()).toEqual(['Classic Cheeseburger', 'Garlic dip', 'Smash trial', 'Tray bake']);
      page['sortBy']('category');
      expect(names()).toEqual(['Classic Cheeseburger', 'Garlic dip', 'Smash trial', 'Tray bake']);
      page['sortBy']('category');
      expect(names()).toEqual(['Smash trial', 'Tray bake', 'Garlic dip', 'Classic Cheeseburger']);
      expect(page['ariaSort']('category')).toBe('descending');
    });

    it('sorts by cost and by food cost %, those with none last', async () => {
      const { page } = await render();
      const names = () => page['shown']().map((c: RecipeCostCard) => c.recipe);

      page['sortBy']('cost');
      expect(names()).toEqual(['Garlic dip', 'Classic Cheeseburger', 'Smash trial', 'Tray bake']);
      page['sortBy']('foodCost');
      expect(names()).toEqual(['Classic Cheeseburger', 'Tray bake', 'Smash trial', 'Garlic dip']);
    });

    it('finds a recipe by its category too', async () => {
      const { page } = await render();

      page['search'].set('صوصات');
      expect(page['shown']()).toEqual([garlicDip]);
    });
  });

  // Burger r1 (30, 25%), Smash trial r2 (30, 55%), Garlic dip r4 (4, no price), Tray bake r5 (50, 40%).
  describe('advanced filters (فلاتر الوصفات المتقدمة)', () => {
    beforeEach(() => {
      recipes.mockReturnValue(of([burger, trial, garlicDip, unsorted]));
      whereUsed.mockReset();
      burdenedCosts.mockReset();
    });
    const names = (page: Record<string, any>) => page['shown']().map((c: RecipeCostCard) => c.recipe);

    it('open in a drawer with the kitchen section, counted when on', async () => {
      const { el, page, rows } = await render();
      const toggle = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => text(b).includes('Advanced filters'))!;
      expect(el.querySelector('#advanced-filters')).toBeNull();
      expect(toggle.getAttribute('aria-expanded')).toBe('false');

      toggle.click();
      page['category'].set('sauces');
      rows();
      const drawer = el.querySelector('#advanced-filters')!;
      expect([...drawer.querySelectorAll('mat-label')].map(text)).toEqual([
        'Kitchen section · قسم المطبخ', 'Food cost above · التكلفة أعلى من', 'Cost a portion from · من', 'to · إلى',
      ]);
      expect(drawer.querySelector('app-material-picker')).not.toBeNull();
      expect(text(toggle.querySelector('.count')!)).toBe('1');
      expect(page['activeAdvanced']()).toBe(1);
      expect(materials).toHaveBeenCalled();
      expect(names(page)).toEqual(['Garlic dip']);
      page['clearAdvanced']();
      expect(page['activeAdvanced']()).toBe(0);
      expect(names(page)).toHaveLength(4);
    });

    it('keep the recipes with an item on them or inside their prep items', async () => {
      const used: WhereUsedReport = {
        materialId: 'tomatoes', material: 'Tomatoes', code: null, isPrepItem: false, unit: 'Gram', purchaseUnit: 'kg', purchaseUnitSize: 1000, dishes: 2, prepItems: 1,
        rows: [
          { kind: 'Dish', id: 'r1', name: 'Classic Cheeseburger', itemCode: '6', category: 'Mains', portions: 1, batchQuantity: null, batchUnit: null, price: 120,
            cost: 30, foodCostPercent: 25, quantity: 30, throughPrepItems: null, via: [], itemCost: 0.6 },
          { kind: 'OffMenuRecipe', id: 'r4', name: 'Garlic dip', itemCode: null, category: 'Sauces', portions: 1, batchQuantity: null, batchUnit: null, price: null,
            cost: 4, foodCostPercent: null, quantity: null, throughPrepItems: 10, via: ['Tomato base'], itemCost: 0.2 },
          { kind: 'PrepItem', id: 'r5', name: 'Tomato base', itemCode: null, category: null, portions: null, batchQuantity: 1000, batchUnit: 'Gram', price: null,
            cost: 20, foodCostPercent: null, quantity: 1000, throughPrepItems: null, via: [], itemCost: 20 },
        ],
      };
      whereUsed.mockReturnValue(of(used));
      const { page } = await render();

      await page['setContains']('tomatoes');
      expect(whereUsed).toHaveBeenCalledExactlyOnceWith('tomatoes');
      // A prep item's id is not a recipe's, even when one shares it.
      expect(names(page)).toEqual(['Classic Cheeseburger', 'Garlic dip']);
      expect(page['advancedNote']()).toBe('2 recipes have it, on the recipe or inside a prep item.');
      await page['setContains'](null);
      expect(names(page)).toHaveLength(4);
    });

    it('keep the food cost above a share, and the cost a portion between two figures', async () => {
      const { page } = await render();

      page['minFoodCost'].set(page['number']('30'));
      expect(names(page)).toEqual(['Smash trial', 'Tray bake']);
      page['minCost'].set(20);
      page['maxCost'].set(40);
      expect(names(page)).toEqual(['Smash trial']);
      page['minFoodCost'].set(page['number'](''));
      expect(names(page)).toEqual(['Classic Cheeseburger', 'Smash trial']);
      expect(page['activeAdvanced']()).toBe(1);
    });

    it('keep the true net margin below a share, from this month’s plate cost, for whoever sees it', async () => {
      burdenedCosts.mockReturnValue(of({ rows: [
        { recipeId: 'r1', trueNetMarginPercent: 12 }, { recipeId: 'r2', trueNetMarginPercent: -5 }, { recipeId: 'r5', trueNetMarginPercent: 8 }, { recipeId: null, trueNetMarginPercent: 1 },
      ] }));
      const withoutTab = await render();
      withoutTab.page['toggleAdvanced'](true);
      withoutTab.rows();
      expect(withoutTab.el.querySelector('#advanced-filters input[aria-label="Net margin below"]')).toBeNull();
      TestBed.resetTestingModule();

      const { el, page, rows } = await render({ tabs: ['Recipes', 'Intelligence'] });
      page['toggleAdvanced'](true);
      rows();
      expect(el.querySelector('#advanced-filters input[aria-label="Net margin below"]')).not.toBeNull();
      await page['setNetMargin'](10);
      const month = periodDays('month');
      expect(burdenedCosts).toHaveBeenCalledExactlyOnceWith({ from: month.from, to: month.to, method: null, source: 'Actual' });
      expect(names(page)).toEqual(['Smash trial', 'Tray bake']);
      await page['setNetMargin'](20);
      expect(burdenedCosts).toHaveBeenCalledTimes(1);
      expect(names(page)).toEqual(['Classic Cheeseburger', 'Smash trial', 'Tray bake']);
      // Each one's net margin under its food cost while the filter is on.
      expect(rows().map((r) => text(r.querySelectorAll('td')[6]))).toEqual(['25.0% net 12.0%', '55.0% net -5.0%', '40.0% net 8.0%']);
      expect(page['advancedNote']()).toBe('Net margin: this month so far, as Cost settings share labor and overheads.');
    });

    it('say so when nothing sold this month gives any dish a net margin', async () => {
      burdenedCosts.mockReturnValue(of({ rows: [{ recipeId: 'r1', trueNetMarginPercent: null }, { recipeId: 'r2', trueNetMarginPercent: null }] }));
      const { page } = await render({ tabs: ['Recipes', 'Intelligence'] });
      await page['setNetMargin'](30);
      expect(names(page)).toEqual([]);
      expect(page['advancedNote']()).toBe(
        'No dish has a net margin this month yet: nothing sold to share labor and overheads over. · لا يوجد هامش صافٍ بعد هذا الشهر.',
      );
    });
  });

  it('offers the bulk swap to whoever writes recipes, and reads them again once it is done', async () => {
    open.mockReturnValue({ afterClosed: () => of({ recipes: 2, prepItems: 0 }) });
    const { el } = await render();
    recipes.mockClear();
    [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => text(b).includes('Bulk swap material'))!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(open).toHaveBeenCalledWith(BulkSwapDialog, expect.objectContaining({ data: { fromMaterialId: undefined } }));
    expect(recipes).toHaveBeenCalledWith(true);

    TestBed.resetTestingModule();
    const storekeeper = await render({ canManage: false });
    expect([...storekeeper.el.querySelectorAll('button')].some((b) => text(b).includes('Bulk swap material'))).toBe(false);
  });
});
