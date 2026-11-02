import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { of, throwError } from 'rxjs';
import { SheetImportResult } from '../../core/costing/costing.api';
import { SheetImportData, SheetImportDialog } from './sheet-import-dialog';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

const result: SheetImportResult = {
  created: [{ row: 2, id: 'c', name: 'Chicken breast' }],
  updated: [{ row: 3, id: 't', name: 'Tomatoes', changes: ['Category', 'Cost'] }],
  unchanged: 40,
  skipped: [
    { row: 4, name: null, reason: 'No material name.', reasonAr: 'لا يوجد اسم للخامة.' },
    { row: 5, name: 'Milk', reason: 'Milk is counted by the Liter, not the Kg.' },
  ],
  categoriesAdded: ['Poultry'],
};

describe('importing a sheet', () => {
  const upload = vi.fn();
  const template = vi.fn();
  const close = vi.fn();

  async function render() {
    const data: SheetImportData = {
      title: { en: 'Import raw materials from Excel', ar: 'استيراد الخامات من إكسل' },
      noun: { one: 'material', many: 'materials', ar: 'الخامة' },
      rules: [{ en: 'A blank cell leaves that detail as it is.', ar: 'الخلية الفارغة تترك البيان كما هو.' }],
      templateName: 'raw-materials-template.xlsx',
      template,
      upload,
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close } },
      ],
    });
    const fixture = TestBed.createComponent(SheetImportDialog);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const page = fixture.componentInstance as unknown as Record<string, any>;
    const choose = async (file: File) => {
      await page['import'](file);
      fixture.detectChanges();
    };
    const button = (label: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => text(b).includes(label))!;
    return { fixture, el, page, choose, button };
  }

  beforeEach(() => {
    upload.mockReset().mockReturnValue(of(result));
    template.mockReset().mockReturnValue(of(new Blob(['xlsx'])));
    close.mockReset();
  });

  it('says what a sheet does, in both languages, and takes the file dropped or chosen', async () => {
    const { el, fixture } = await render();

    expect(text(el.querySelector('h2')!)).toBe('Import raw materials from Excel استيراد الخامات من إكسل');
    expect(text(el.querySelector('.rules li')!)).toBe('A blank cell leaves that detail as it is. الخلية الفارغة تترك البيان كما هو.');
    expect(el.querySelector<HTMLInputElement>('input[type=file]')!.accept).toContain('.xlsx');

    const file = new File(['xlsx'], 'materials.xlsx');
    const drop = new Event('drop') as DragEvent;
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [file] } });
    el.querySelector('.drop')!.dispatchEvent(drop);
    await fixture.whenStable();
    expect(upload).toHaveBeenCalledWith(file);
  });

  it('counts what it added, changed and left as it was, and lists each change and each row skipped and why', async () => {
    const { el, choose, button } = await render();

    await choose(new File(['xlsx'], 'materials.xlsx'));

    expect([...el.querySelectorAll('.count')].map(text)).toEqual(['1 added أُضيف', '1 changed عُدّل', '40 unchanged بلا تغيير', '2 skipped لم يُستورد']);
    expect(el.querySelector('.count.skipped')!.classList).toContain('bad');
    expect(text(el)).toContain('New categories · أقسام جديدة: Poultry');
    expect([...el.querySelectorAll('.changed-rows tbody td')].map(text)).toEqual(['3', 'Tomatoes', 'category · القسم، cost · التكلفة']);
    expect([...el.querySelectorAll('.skipped-rows tbody tr')].map((r) => [...r.querySelectorAll('td')].map(text))).toEqual([
      ['4', '—', 'No material name. لا يوجد اسم للخامة.'],
      ['5', 'Milk', 'Milk is counted by the Liter, not the Kg.'],
    ]);

    // Done: closed saying the list changed.
    button('Done').click();
    expect(close).toHaveBeenCalledWith(true);
  });

  it('refuses a file that is not a workbook before sending it, and says why the server refused one', async () => {
    const { el, choose, button } = await render();

    await choose(new File(['a,b'], 'materials.csv'));
    expect(upload).not.toHaveBeenCalled();
    expect(text(el.querySelector('.error')!)).toContain('materials.csv is not an Excel file (.xlsx)');

    upload.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 422, error: { detail: 'No sheet has the Material Name heading.' } })));
    await choose(new File(['?'], 'notes.xlsx'));
    expect(text(el.querySelector('.error strong')!)).toBe('The file could not be imported. · تعذّر استيراد الملف.');
    expect(text(el.querySelector('.error')!)).toContain('No sheet has the Material Name heading.');

    // Nothing imported: closed saying nothing changed.
    button('Cancel').click();
    expect(close).toHaveBeenCalledWith(false);
  });

  it('says so when the sheet changes nothing, and imports another file from there', async () => {
    upload.mockReturnValue(of({ created: [], updated: [], unchanged: 12, skipped: [], categoriesAdded: [] }));
    const { el, choose, button, fixture } = await render();

    await choose(new File(['xlsx'], 'materials.xlsx'));
    expect(text(el.querySelector('.summary')!)).toBe('Nothing to change: the materials are as the sheet has them. · لا شيء للتعديل: البيانات كما في الملف.');

    button('Import another file').click();
    fixture.detectChanges();
    expect(el.querySelector('.drop')).not.toBeNull();
  });

  it('downloads the template under its own name', async () => {
    const { page } = await render();
    let saved: HTMLAnchorElement | undefined;
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved = this;
    });
    URL.createObjectURL = vi.fn(() => 'blob:template');
    URL.revokeObjectURL = vi.fn();

    await page['downloadTemplate']();

    expect(template).toHaveBeenCalled();
    expect(saved!.download).toBe('raw-materials-template.xlsx');
    click.mockRestore();
  });
});
