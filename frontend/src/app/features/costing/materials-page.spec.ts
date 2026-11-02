import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { MatDialog } from '@angular/material/dialog';
import { of, throwError } from 'rxjs';
import { CostingApi, MaterialCost, RawMaterialImportResult } from '../../core/costing/costing.api';
import { NotifyService } from '../../core/ui/notify.service';
import { Approvals } from './approvals';
import { MaterialHistoryDialog } from './material-history-dialog';
import { MaterialsPage } from './materials-page';
import { SheetImportData, SheetImportDialog } from './sheet-import-dialog';

const result: RawMaterialImportResult = {
  created: [{ row: 2, id: 'c', name: 'Chicken breast', category: 'Poultry', unit: 'Gram', purchaseUnit: 'kg', costPerPurchaseUnit: 185 }],
  updated: [],
  unchanged: 0,
  skipped: [],
  categoriesAdded: ['Poultry'],
};

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

describe('raw materials to and from Excel', () => {
  const materials = vi.fn();
  const rawMaterialsTemplate = vi.fn();
  const importRawMaterials = vi.fn();
  const exportRawMaterials = vi.fn();
  const open = vi.fn();
  const notify = { info: vi.fn(), error: vi.fn() };

  async function render() {
    TestBed.configureTestingModule({
      providers: [
        { provide: CostingApi, useValue: { materials, rawMaterialsTemplate, importRawMaterials, exportRawMaterials } },
        { provide: MatDialog, useValue: { open } },
        { provide: NotifyService, useValue: notify },
        { provide: Approvals, useValue: { refresh: vi.fn(), pendingFor: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(MaterialsPage);
    await fixture.whenStable();
    fixture.detectChanges();
    return { el: fixture.nativeElement as HTMLElement, page: fixture.componentInstance as unknown as Record<string, any> };
  }

  beforeEach(() => {
    materials.mockReset().mockReturnValue(of([]));
    rawMaterialsTemplate.mockReset().mockReturnValue(of(new Blob(['xlsx'])));
    importRawMaterials.mockReset().mockReturnValue(of(result));
    exportRawMaterials.mockReset().mockReturnValue(of(new Blob(['xlsx'])));
    open.mockReset().mockReturnValue({ afterClosed: () => of(true) });
    notify.info.mockReset();
    notify.error.mockReset();
  });

  it('offers the export and the import beside a new material', async () => {
    const { el } = await render();

    expect([...el.querySelectorAll('.toolbar button')].map(text)).toEqual([
      'download Export Excelتصدير إلى إكسل',
      'upload_file Import Excelاستيراد من إكسل',
      'add New material',
    ]);
  });

  it('exports the list under the day it was written, and says so in both languages', async () => {
    const { page } = await render();
    let saved: HTMLAnchorElement | undefined;
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved = this;
    });
    URL.createObjectURL = vi.fn(() => 'blob:export');
    URL.revokeObjectURL = vi.fn();

    await page['exportExcel']();

    expect(exportRawMaterials).toHaveBeenCalled();
    expect(saved!.download).toMatch(/^raw-materials-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(notify.info).toHaveBeenCalledWith('Raw materials exported to Excel. · تم تصدير الخامات إلى إكسل.');
    expect(page['busy']()).toBe(false);

    exportRawMaterials.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    await page['exportExcel']();
    expect(notify.error).toHaveBeenCalledWith(expect.anything(), 'The raw materials could not be exported. · تعذّر تصدير الخامات.');
    click.mockRestore();
  });

  it('imports in the dialog, its template and upload the raw materials’, and reads the list again when it changed it', async () => {
    const { page } = await render();

    await page['importExcel']();

    expect(open).toHaveBeenCalledWith(SheetImportDialog, expect.objectContaining({ width: '760px' }));
    const data = open.mock.lastCall![1].data as SheetImportData;
    expect([data.title.en, data.templateName, data.noun.many]).toEqual(['Import raw materials from Excel', 'raw-materials-template.xlsx', 'materials']);
    const file = new File(['xlsx'], 'materials.xlsx');
    data.upload(file).subscribe();
    data.template().subscribe();
    expect(importRawMaterials).toHaveBeenCalledWith(file);
    expect(rawMaterialsTemplate).toHaveBeenCalled();
    expect(materials).toHaveBeenCalledTimes(2);

    // Closed with nothing changed: not read again.
    open.mockReturnValue({ afterClosed: () => of(false) });
    await page['importExcel']();
    expect(materials).toHaveBeenCalledTimes(2);
  });
});

describe('changing a material', () => {
  const materials = vi.fn();
  const saveMaterial = vi.fn();
  const changeMaterialUnit = vi.fn();
  const open = vi.fn();
  const notify = { info: vi.fn(), error: vi.fn() };
  const approvals = { refresh: vi.fn(), pendingFor: vi.fn(), requested: vi.fn() };
  const tomatoes = { id: 'tomatoes', name: 'Tomatoes', unit: 'Gram' } as unknown as MaterialCost;
  const details = { name: 'Tomatoes', code: null, categoryId: 'veg', defaultYieldPercent: 100, purchaseUnit: 'kg', purchaseUnitSize: 1000, costPerPurchaseUnit: null, reorderLevel: 1000 };
  const unitChange = { requestId: 'r1', unit: 'Piece', oneNewIsOld: 60, purchaseUnit: 'crate', purchaseUnitSize: 100, costPerPurchaseUnit: null, reorderLevel: null, reason: null };

  async function render(closedWith: unknown) {
    open.mockReturnValue({ afterClosed: () => of(closedWith) });
    TestBed.configureTestingModule({
      providers: [
        { provide: CostingApi, useValue: { materials, saveMaterial, changeMaterialUnit } },
        { provide: MatDialog, useValue: { open } },
        { provide: NotifyService, useValue: notify },
        { provide: Approvals, useValue: approvals },
      ],
    });
    const fixture = TestBed.createComponent(MaterialsPage);
    await fixture.whenStable();
    return fixture.componentInstance as unknown as Record<string, any>;
  }

  beforeEach(() => {
    materials.mockReset().mockReturnValue(of([]));
    saveMaterial.mockReset().mockReturnValue(of({}));
    changeMaterialUnit.mockReset();
    notify.info.mockReset();
    notify.error.mockReset();
    approvals.pendingFor.mockReset();
    approvals.requested.mockReset();
  });

  it('saves its details, then changes its unit: at once for a manager', async () => {
    changeMaterialUnit.mockReturnValue(of({ outcome: 'Applied', request: { id: 'r1' } }));
    const page = await render({ material: details, unitChange });

    await page['edit'](tomatoes);

    expect(saveMaterial).toHaveBeenCalledWith('tomatoes', details);
    expect(changeMaterialUnit).toHaveBeenCalledWith('tomatoes', unitChange);
    expect(saveMaterial.mock.invocationCallOrder[0]).toBeLessThan(changeMaterialUnit.mock.invocationCallOrder[0]);
    expect(notify.info).toHaveBeenCalledWith('Tomatoes saved, counted in pieces now.');
  });

  it('says an accountant’s change went to a manager', async () => {
    const request = { id: 'r1', module: 'RawMaterial', action: 'Update' };
    changeMaterialUnit.mockReturnValue(of({ outcome: 'Requested', request }));
    const page = await render({ material: details, unitChange });

    await page['edit'](tomatoes);

    expect(approvals.requested).toHaveBeenCalledWith({ outcome: 'Requested', request });
  });

  it('keeps the details saved and says why when the unit is refused', async () => {
    changeMaterialUnit.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 422, error: { errors: ['Tomatoes is counted in pieces already.'] } })));
    const page = await render({ material: details, unitChange });

    await page['edit'](tomatoes);

    expect(saveMaterial).toHaveBeenCalled();
    expect(notify.error).toHaveBeenCalledWith(null, 'Tomatoes was saved, but its unit was not changed: Tomatoes is counted in pieces already.');
  });

  it('sends no unit change when the unit stayed, and nothing while a request about it waits', async () => {
    const page = await render({ material: details, unitChange: null });
    await page['edit'](tomatoes);
    expect(changeMaterialUnit).not.toHaveBeenCalled();
    expect(notify.info).toHaveBeenCalledWith('Tomatoes saved.');

    approvals.pendingFor.mockReturnValue({ action: 'Update', module: 'RawMaterial' });
    open.mockClear();
    await page['edit'](tomatoes);
    expect(open).not.toHaveBeenCalled();
    expect(notify.info).toHaveBeenCalledWith('Tomatoes: change requested, waiting for a manager. It can be changed once that is decided.');
  });
});

describe('a material’s purchase history from its row', () => {
  it('is a button on each bought material, not a prep item, and opens the card', async () => {
    const open = vi.fn();
    const row = (id: string, name: string, kind: 'Purchased' | 'Prep') =>
      ({ id, name, kind, code: null, category: null, unit: 'Gram', purchaseUnit: 'kg', purchaseUnitSize: 1000, costPerPurchaseUnit: null,
        defaultYieldPercent: 100, quantityOnHand: 0, stockValue: null, lastPurchaseCostPerPurchaseUnit: null }) as unknown as MaterialCost;
    const tomatoes = row('tomatoes', 'Tomatoes', 'Purchased');
    TestBed.configureTestingModule({
      providers: [
        { provide: CostingApi, useValue: { materials: () => of([tomatoes, row('sauce', 'Tomato sauce', 'Prep')]) } },
        { provide: MatDialog, useValue: { open } },
        { provide: NotifyService, useValue: { info: vi.fn(), error: vi.fn() } },
        { provide: Approvals, useValue: { refresh: vi.fn(), pendingFor: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(MaterialsPage);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect([...el.querySelectorAll('[aria-label^="Purchase history of"]')].map((b) => b.getAttribute('aria-label'))).toEqual(['Purchase history of Tomatoes']);
    el.querySelector<HTMLButtonElement>('[aria-label="Purchase history of Tomatoes"]')!.click();
    expect(open).toHaveBeenCalledWith(MaterialHistoryDialog, { data: tomatoes, width: '960px', maxWidth: '95vw' });
    // The row's own click, which opens the material to change, is not set off.
    expect(open).toHaveBeenCalledTimes(1);
  });
});
