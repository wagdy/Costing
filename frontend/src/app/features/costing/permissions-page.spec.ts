import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { of, throwError } from 'rxjs';
import { MenuSalesApi, UserTabs } from '../../core/costing/menu-sales.api';
import { NotifyService } from '../../core/ui/notify.service';
import { PermissionsPage, TabsDialog } from './permissions-page';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

const mona: UserTabs = { id: 'mona', name: 'Mona', role: 'Accountant', restricted: false, tabs: ['Purchases', 'Financials'], setBy: null, setAtUtc: null };
const samir: UserTabs = { id: 'samir', name: 'Samir', role: 'Storekeeper', restricted: true, tabs: ['Counts'], setBy: 'Omar', setAtUtc: '2026-10-30T09:00:00Z' };

describe('the permissions', () => {
  const access = vi.fn();
  const setTabs = vi.fn();
  const open = vi.fn();
  const notify = { info: vi.fn(), error: vi.fn() };

  async function render() {
    TestBed.configureTestingModule({
      providers: [
        { provide: MenuSalesApi, useValue: { access, setTabs } },
        { provide: MatDialog, useValue: { open } },
        { provide: NotifyService, useValue: notify },
      ],
    });
    const fixture = TestBed.createComponent(PermissionsPage);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const rows = () => {
      fixture.detectChanges();
      // Their name and role, the sections they work, and whose they are.
      return [...el.querySelectorAll('tbody tr')].map((r) => [
        text(r.querySelector('strong')!),
        text(r.querySelector('td .small')!),
        [...r.querySelectorAll('.tag')].map(text).join(', '),
        text(r.querySelectorAll('td')[1].querySelector('.small')!),
      ]);
    };
    return { el, rows, page: fixture.componentInstance as unknown as Record<string, any> };
  }

  beforeEach(() => {
    access.mockReset().mockReturnValue(of([mona, samir]));
    setTabs.mockReset();
    open.mockReset();
    notify.info.mockReset();
    notify.error.mockReset();
  });

  it('lists each user with the sections they work, their role’s or those a manager ticked', async () => {
    const { rows } = await render();

    expect(rows()).toEqual([
      ['Mona', 'Accountant · محاسب', 'Purchases, Financials', 'Their role’s · حسب الدور'],
      ['Samir', 'Storekeeper · أمين المخزن', 'Stock counts', 'Ticked by Omar'],
    ]);
  });

  it('saves the sections ticked, or puts them back to their role’s', async () => {
    const { page, rows } = await render();

    open.mockReturnValue({ afterClosed: () => of({ tabs: ['Materials', 'Sales'] }) });
    setTabs.mockReturnValue(of({ ...mona, restricted: true, tabs: ['Materials', 'Sales'], setBy: 'Omar' }));
    await page['change'](mona);
    expect(open.mock.lastCall![1].data).toBe(mona);
    expect(setTabs).toHaveBeenCalledWith('mona', ['Materials', 'Sales']);
    expect(notify.info).toHaveBeenLastCalledWith('Mona works 2 sections now.');
    expect(rows()[0].slice(2)).toEqual(['Raw materials, Sales', 'Ticked by Omar']);

    open.mockReturnValue({ afterClosed: () => of({ tabs: null }) });
    setTabs.mockReturnValue(of({ ...samir, restricted: false, tabs: ['Materials', 'Production', 'Purchases', 'Counts', 'Waste'], setBy: null }));
    await page['change'](samir);
    expect(setTabs).toHaveBeenLastCalledWith('samir', null);
    expect(notify.info).toHaveBeenLastCalledWith('Samir works their role’s sections again.');

    // Cancelled: nothing is saved.
    open.mockReturnValue({ afterClosed: () => of(undefined) });
    await page['change'](mona);
    expect(setTabs).toHaveBeenCalledTimes(2);
  });

  it('says why the sections could not be saved, or loaded', async () => {
    open.mockReturnValue({ afterClosed: () => of({ tabs: [] }) });
    setTabs.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403 })));
    const { page } = await render();
    await page['change'](mona);
    expect(notify.error).toHaveBeenCalledWith(expect.any(HttpErrorResponse), 'The sections could not be saved.');
    TestBed.resetTestingModule();

    access.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    const failed = await render();
    expect(text(failed.el.querySelector('.error')!)).toContain('could not be loaded');
  });
});

describe('a user’s sections', () => {
  const close = vi.fn();

  async function render(user: UserTabs) {
    TestBed.configureTestingModule({
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: user },
        { provide: MatDialogRef, useValue: { close } },
      ],
    });
    const fixture = TestBed.createComponent(TabsDialog);
    await fixture.whenStable();
    fixture.detectChanges();
    return { el: fixture.nativeElement as HTMLElement, page: fixture.componentInstance as unknown as Record<string, any> };
  }

  beforeEach(() => close.mockReset());

  it('offers every section with what it lets them do, the ones they work ticked, in the sidebar’s order', async () => {
    const { el, page } = await render(samir);

    const options = [...el.querySelectorAll('.tab-option')];
    expect(options).toHaveLength(12);
    expect(options.map((o) => o.getAttribute('data-tab'))).toEqual([
      'Materials', 'Recipes', 'Production', 'Menu', 'Sales', 'Purchases', 'ExpenseItems', 'Counts', 'Waste', 'Financials', 'Reports', 'CostSettings',
    ]);
    expect(text(options[7].querySelector('.name')!)).toBe('Stock counts الجرد');
    expect(text(options[7].querySelector('.hint')!)).toBe('Counts, drafted and posted · الجرد مسودة ثم ترحيل');
    expect(options[7].querySelector('input')!.checked).toBe(true);
    // Ticked by a manager: they can be put back to their role's.
    expect([...el.querySelectorAll('button')].map(text)).toContain('Their role’s · حسب الدور');

    page['tick']('Sales', true);
    page['tick']('Counts', false);
    page['tick']('Materials', true);
    page['save']();
    expect(close).toHaveBeenCalledWith({ tabs: ['Materials', 'Sales'] });
  });

  it('offers no going back for one who works their role’s already', async () => {
    const { el } = await render(mona);
    expect([...el.querySelectorAll('button')].map(text)).not.toContain('Their role’s · حسب الدور');
  });
});
