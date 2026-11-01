import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthService } from '../../core/auth/auth.service';
import { Permissions } from '../../core/auth/permissions';
import { ConsumableItem, CustodyApi } from '../../core/custody/custody.api';
import { HrAccess } from '../../core/hr/hr-access';
import { BusinessDay } from '../../core/ui/business-day';
import { NotifyService } from '../../core/ui/notify.service';
import { ConsumableHistoryDialog, MovementDialog, MovementDialogData } from './consumable-dialogs';
import { ConsumablesPage } from './consumables-page';

const settle = async () => {
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r));
  }
};
const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();
// Element by element: the template leaves no space between them.
const cell = (el: Element): string =>
  [...el.childNodes]
    .map((n) => (n.nodeType === Node.ELEMENT_NODE ? cell(n as Element) : n.nodeType === Node.TEXT_NODE ? (n.textContent ?? '').trim() : ''))
    .filter(Boolean)
    .join(' ');

function item(id: string, name: string, extra: Partial<ConsumableItem> = {}): ConsumableItem {
  return {
    id, name, unit: 'pack', quantity: 120, unitCost: 3, totalCost: 360, reorderLevel: 20, isLow: false, notes: null, lastMovedOn: '2026-10-27',
    createdBy: 'Omar', createdAtUtc: '2026-10-01T08:00:00Z', ...extra,
  };
}

const napkins = item('napkins', 'Napkins');
const detergent = item('detergent', 'Detergent', { unit: 'litre', quantity: 2.5, unitCost: 40, totalCost: 100, reorderLevel: 5, isLow: true });
const cups = item('cups', 'Takeaway cups', { unit: 'piece', quantity: 0, unitCost: 1.5, totalCost: 0, reorderLevel: null, lastMovedOn: null });

describe('the consumables inventory', () => {
  const consumables = vi.fn();
  const deleteConsumable = vi.fn();
  const open = vi.fn();
  const notify = { info: vi.fn(), error: vi.fn() };

  async function render(manage = true, employee = false) {
    TestBed.configureTestingModule({
      providers: [
        { provide: CustodyApi, useValue: { consumables, deleteConsumable } },
        { provide: AuthService, useValue: { employeeActing: () => employee, me: () => null, can: (p: string) => manage || p !== Permissions.HrManage } },
        { provide: HrAccess, useValue: { canDecide: () => manage } },
        { provide: NotifyService, useValue: notify },
        { provide: MatDialog, useValue: { open } },
        { provide: BusinessDay, useValue: { today: () => Promise.resolve('2026-10-28') } },
      ],
    });
    const fixture = TestBed.createComponent(ConsumablesPage);
    const el = fixture.nativeElement as HTMLElement;
    const refresh = async () => {
      for (let i = 0; i < 3; i++) {
        fixture.detectChanges();
        await fixture.whenStable();
      }
      fixture.detectChanges();
    };
    await refresh();
    const rows = () => [...el.querySelectorAll('tbody tr')].map((r) => [...r.querySelectorAll('td')].slice(0, -1).map(cell));
    return { el, refresh, rows, page: fixture.componentInstance as unknown as Record<string, any> };
  }

  beforeEach(() => {
    consumables.mockReset().mockReturnValue(of([detergent, napkins, cups]));
    deleteConsumable.mockReset().mockReturnValue(of(undefined));
    open.mockReset();
    notify.info.mockReset();
    notify.error.mockReset();
  });

  it('lists what is in stock of each and what it is worth, marking what is low or out', async () => {
    const { el, rows } = await render();

    expect([...el.querySelectorAll('.tile')].map(cell)).toEqual([
      'Items · الأصناف 3',
      'Stock value · قيمة المخزون 460.00 at what each cost on average',
      'Low or out · ناقص أو نافد 2 to buy again',
    ]);
    expect(rows()).toEqual([
      ['Detergent Counted in litre', '2.5 litre Low ناقص', '5', '40.00', '100.00', '27 Oct 2026'],
      ['Napkins Counted in pack', '120 pack', '20', '3.00', '360.00', '27 Oct 2026'],
      ['Takeaway cups Counted in piece', '0 piece Out نافد', '—', '1.50', '0.00', '—'],
    ]);
    // Nothing to use of what is out; deleted only before anything was recorded of it.
    const [, , cupsRow] = [...el.querySelectorAll('tbody tr')];
    expect(cupsRow.querySelector<HTMLButtonElement>('[aria-label="Used up of Takeaway cups"]')!.disabled).toBe(true);
    expect([...el.querySelectorAll('[aria-label^="Delete "]')].map((b) => b.getAttribute('aria-label'))).toEqual(['Delete Takeaway cups']);
    // Its note in Arabic, then English.
    expect(text(el.querySelector('.note .note-ar')!)).toContain('الجرد يضبط الرصيد على الكمية الفعلية');
  });

  it('shows what is low or out when asked, from its smart filter', async () => {
    const { el, page, rows, refresh } = await render();

    expect(cell(el.querySelector('app-filter-select button')!)).toBe('inventory Stock · المخزون All items 3 expand_more');
    page['filter'].set('low');
    await refresh();
    expect(rows().map((r) => r[0])).toEqual(['Detergent Counted in litre', 'Takeaway cups Counted in piece']);
    page['filter'].set('out');
    await refresh();
    expect(rows().map((r) => r[0])).toEqual(['Takeaway cups Counted in piece']);
  });

  it('records stock in, used up and counted from each row, and its movements', async () => {
    open.mockReturnValue({ afterClosed: () => of({ ...napkins, quantity: 170 }) });
    const { el } = await render();

    el.querySelector<HTMLButtonElement>('[aria-label="Stock received of Napkins"]')!.click();
    await settle();
    expect(open.mock.lastCall![0]).toBe(MovementDialog);
    expect(open.mock.lastCall![1].data).toEqual({ item: napkins, type: 'Received', today: '2026-10-28', costHidden: false } satisfies MovementDialogData);
    expect(notify.info).toHaveBeenLastCalledWith('Recorded: Napkins now 170 pack.');
    expect(consumables).toHaveBeenCalledTimes(2);

    el.querySelector<HTMLButtonElement>('[aria-label="Count Napkins"]')!.click();
    await settle();
    expect(open.mock.lastCall![1].data.type).toBe('Counted');

    el.querySelector<HTMLButtonElement>('[aria-label="Napkins’s movements"]')!.click();
    expect(open.mock.lastCall![0]).toBe(ConsumableHistoryDialog);
    expect(open.mock.lastCall![1].data).toEqual({ itemId: 'napkins' });
  });

  it('shows an employee in the portal no cost, and someone who only sees it nothing to change', async () => {
    consumables.mockReturnValue(of([{ ...napkins, unitCost: null, totalCost: null }]));
    let { el } = await render(true, true);
    expect([...el.querySelectorAll('thead th')].map(cell)).toEqual(['Item الصنف', 'In stock الرصيد', 'Low at حد الطلب', 'Last moved آخر حركة', 'Actions']);
    expect(el.querySelectorAll('.tile')).toHaveLength(2);

    TestBed.resetTestingModule();
    ({ el } = await render(false));
    expect(el.querySelector('[aria-label^="Stock received"]')).toBeNull();
    expect(el.querySelector('[aria-label="Napkins’s movements"]')).not.toBeNull();
    expect(text(el.querySelector('.toolbar')!)).not.toContain('Add an item');
  });

  it('says in Arabic and English what to do while there is nothing', async () => {
    consumables.mockReturnValue(of([]));
    const { el } = await render();
    expect(text(el.querySelector('td.empty .note-ar')!)).toBe('لا توجد أصناف بعد. أضف المناديل والمنظفات والأكواب وما يُستهلك، ثم سجّل ما يرد منها وما يُصرف.');
    expect(text(el.querySelector('td.empty')!)).toContain('No items yet.');
  });
});

describe('a movement of a consumable', () => {
  const recordMovement = vi.fn();
  const close = vi.fn();

  async function render(type: MovementDialogData['type'], costHidden = false) {
    TestBed.configureTestingModule({
      providers: [
        { provide: CustodyApi, useValue: { recordMovement } },
        { provide: MatDialogRef, useValue: { close } },
        { provide: MAT_DIALOG_DATA, useValue: { item: napkins, type, today: '2026-10-28', costHidden } satisfies MovementDialogData },
      ],
    });
    const fixture = TestBed.createComponent(MovementDialog);
    const el = fixture.nativeElement as HTMLElement;
    const refresh = async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    await refresh();
    return { el, refresh, page: fixture.componentInstance as unknown as Record<string, any> };
  }

  beforeEach(() => {
    recordMovement.mockReset();
    close.mockReset();
  });

  it('says the stock it leaves, and sends it once under one id however often it is tried', async () => {
    recordMovement.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 0 }))).mockReturnValue(of({ item: { ...napkins, quantity: 90 }, movement: {} }));
    const { el, page, refresh } = await render('Consumed');

    page['quantity'].set(30);
    await refresh();
    expect(cell(el.querySelector('.after')!)).toBe('Leaves 90 pack الرصيد بعد الحركة');
    page['notes'] = ' The hall ';

    await page['save']();
    await refresh();
    expect(close).not.toHaveBeenCalled();
    await page['save']();
    const [first, second] = recordMovement.mock.calls.map((c) => c[1]);
    expect(second).toEqual({ movementId: first.movementId, type: 'Consumed', quantity: 30, unitCost: null, date: '2026-10-28', notes: 'The hall' });
    expect(close).toHaveBeenCalledWith({ ...napkins, quantity: 90 });
  });

  it('will not use up more than there is, and a count says the difference', async () => {
    let { el, page, refresh } = await render('Consumed');
    page['quantity'].set(121);
    await refresh();
    expect(text(el.querySelector('.after')!)).toBe('Only 120 pack in stock.');
    expect(el.querySelector<HTMLButtonElement>('mat-dialog-actions button:last-child')!.disabled).toBe(true);

    TestBed.resetTestingModule();
    ({ el, page, refresh } = await render('Counted'));
    page['quantity'].set(115);
    await refresh();
    expect(cell(el.querySelector('.after')!)).toBe('Leaves 115 pack · -5 on what was recorded الرصيد بعد الحركة');
  });

  it('asks a receipt its unit cost, unless costs are not shown here', async () => {
    let { el } = await render('Received');
    expect(el.querySelector("[aria-label=\"A unit's cost\"]")).not.toBeNull();
    TestBed.resetTestingModule();
    ({ el } = await render('Received', true));
    expect(el.querySelector("[aria-label=\"A unit's cost\"]")).toBeNull();
  });
});
