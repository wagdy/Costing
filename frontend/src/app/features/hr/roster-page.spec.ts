import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { HrAccess } from '../../core/hr/hr-access';
import { Employee, HrApi, Roster, RosterCell, WorkShift } from '../../core/hr/hr.api';
import { BusinessDay } from '../../core/ui/business-day';
import { NotifyService } from '../../core/ui/notify.service';
import { RosterPage } from './roster-page';
import { ShiftDialog, parseTime } from './shift-dialog';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();
// Element by element: the template leaves no space between them.
const cell = (el: Element): string =>
  [...el.childNodes]
    .map((n) => (n.nodeType === Node.ELEMENT_NODE ? cell(n as Element) : n.nodeType === Node.TEXT_NODE ? (n.textContent ?? '').trim() : ''))
    .filter(Boolean)
    .join(' ');

const morning: WorkShift = { id: 'morning', name: 'Morning', startsAt: '08:00:00', endsAt: '16:00:00', minutes: 480, tone: 'Amber', rosteredDays: 1 };
const night: WorkShift = { id: 'night', name: 'Night', startsAt: '22:00:00', endsAt: '06:00:00', minutes: 480, tone: 'Violet', rosteredDays: 0 };

const week = ['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'];

function day(date: string, extra: Partial<RosterCell> = {}): RosterCell {
  return {
    date, rostered: false, shiftId: null, off: false, startsAt: '10:00:00', endsAt: '19:00:00', mark: null, holidayName: null, employed: true, locked: false,
    ...extra,
  };
}

const hassan = { id: 'hassan', name: 'Hassan Ali', jobTitle: 'Waiter' } as Employee;
const mona = { id: 'mona', name: 'Mona', jobTitle: 'Cashier' } as Employee;

function roster(first = week[0]): Roster {
  return {
    from: first, to: week[6], shifts: [morning, night],
    rows: [
      {
        employee: hassan,
        days: [
          day(week[0], { rostered: true, shiftId: 'morning', startsAt: '08:00:00', endsAt: '16:00:00' }),
          day(week[1], { rostered: true, off: true, startsAt: null, endsAt: null }),
          day(week[2], { mark: 'Leave' }),
          day(week[3], { holidayName: 'Armed Forces Day' }),
          day(week[4]),
          day(week[5], { locked: true }),
          day(week[6], { off: true, startsAt: null, endsAt: null }),
        ],
      },
      { employee: mona, days: week.map((d, i) => day(d, i === 0 ? { employed: false, startsAt: null, endsAt: null } : { startsAt: null, endsAt: null })) },
    ],
  };
}

describe('the shift roster', () => {
  const rosterOf = vi.fn();
  const setRoster = vi.fn();
  const notify = { info: vi.fn(), error: vi.fn() };

  async function render(manage = true) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: HrApi, useValue: { roster: rosterOf, setRoster, departments: () => of([]) } },
        { provide: HrAccess, useValue: { canDecide: () => manage } },
        { provide: BusinessDay, useValue: { today: () => Promise.resolve('2026-10-28') } },
        { provide: NotifyService, useValue: notify },
      ],
    });
    const fixture = TestBed.createComponent(RosterPage);
    const el = fixture.nativeElement as HTMLElement;
    const refresh = async () => {
      for (let i = 0; i < 3; i++) {
        fixture.detectChanges();
        await fixture.whenStable();
      }
      fixture.detectChanges();
    };
    await refresh();
    const cells = (row: number) => [...el.querySelectorAll('tbody tr')[row].querySelectorAll('td.cell-td .cell')];
    return { el, refresh, cells, page: fixture.componentInstance as unknown as Record<string, any> };
  }

  beforeEach(() => {
    rosterOf.mockReset().mockReturnValue(of(roster()));
    setRoster.mockReset().mockReturnValue(of(undefined));
    notify.info.mockReset();
    notify.error.mockReset();
  });

  it('shows the week, Saturday to Friday, each day as rostered or as their own schedule', async () => {
    const { el, cells } = await render();

    expect(rosterOf).toHaveBeenCalledWith('2026-10-24', '2026-10-30', undefined);
    expect(text(el.querySelector('.range')!)).toBe('24 Oct – 30 Oct 2026');
    expect([...el.querySelectorAll('thead th.day')].map(cell)).toEqual([
      'Sat 24 السبت', 'Sun 25 الأحد', 'Mon 26 الاثنين', 'Tue 27 الثلاثاء', 'Wed 28 الأربعاء', 'Thu 29 الخميس', 'Fri 30 الجمعة',
    ]);
    expect(el.querySelector('thead th.today')!.textContent).toContain('Wed');
    // Its own classes, Material's aside.
    const classes = (c: Element) => [...c.classList].filter((k) => !k.startsWith('mat-')).sort().join(' ');
    expect(cells(0).map((c) => [cell(c), classes(c)])).toEqual([
      ['Morning 08:00–16:00', 'cell shift tone-Amber'],
      ['Day off راحة', 'cell off'],
      ['Usual 10:00–19:00 Leave · إجازة', 'cell usual'],
      ['Usual 10:00–19:00 Armed Forces Day', 'cell usual'],
      ['Usual 10:00–19:00', 'cell usual'],
      ['Usual 10:00–19:00 lock', 'cell locked usual'],
      ['Weekly off راحة أسبوعية', 'cell usual-off'],
    ]);
    // A locked day, and one before they started, are not picked.
    expect(cells(0).map((c) => c.tagName)).toEqual(['BUTTON', 'BUTTON', 'BUTTON', 'BUTTON', 'BUTTON', 'DIV', 'BUTTON']);
    expect(cell(cells(1)[0])).toBe('—');
    expect(cell(cells(1)[1])).toBe('Flexible ساعات مرنة');
    // Who works each day: not off, on leave, on a holiday, or not employed.
    expect([...el.querySelectorAll('tfoot td')].map(cell)).toEqual(['Working · على رأس العمل', '1', '1', '1', '1', '2', '2', '1']);
    expect([...el.querySelectorAll('.legend .chip')].map(cell)).toEqual(['Morning 08:00–16:00', 'Night 22:00–06:00 +1', 'Day off · راحة', 'Their own schedule · الجدول المعتاد']);
  });

  it('puts a day on a shift from its menu, and a row’s whole week at once', async () => {
    const { cells, refresh, page } = await render();

    (cells(0)[4] as HTMLButtonElement).click();
    await refresh();
    const items = [...document.querySelectorAll<HTMLButtonElement>('.mat-mdc-menu-item')];
    expect(items.map(cell)).toEqual(['Morning 08:00–16:00', 'Night 22:00–06:00 +1', 'event_busy Day off · راحة', 'restart_alt Their own schedule · الجدول المعتاد']);
    items[1].click();
    await refresh();
    expect(setRoster).toHaveBeenLastCalledWith([{ employeeId: 'hassan', date: '2026-10-28', shiftId: 'night', dayOff: false }]);
    expect(notify.info).toHaveBeenLastCalledWith('Saved · تم الحفظ');
    expect(rosterOf).toHaveBeenCalledTimes(2);

    // The whole week: each day employed and open.
    await page['assignTo'](roster().rows[0], null, { shiftId: null, dayOff: true });
    expect(setRoster.mock.lastCall![0].map((c: { date: string }) => c.date)).toEqual(week.filter((d) => d !== '2026-10-29'));
    await page['assignTo'](roster().rows[1], null, { shiftId: 'morning', dayOff: false });
    expect(setRoster.mock.lastCall![0]).toHaveLength(6);
  });

  it('repeats the week before’s roster onto this one, leaving what it said nothing of', async () => {
    const { page } = await render();
    rosterOf.mockReturnValueOnce(of({ ...roster(), from: '2026-10-17' }));

    await page['repeatLastWeek']();
    expect(rosterOf).toHaveBeenCalledWith('2026-10-17', '2026-10-23', undefined);
    expect(setRoster).toHaveBeenLastCalledWith([
      { employeeId: 'hassan', date: '2026-10-24', shiftId: 'morning', dayOff: false },
      { employeeId: 'hassan', date: '2026-10-25', shiftId: null, dayOff: true },
    ]);
    expect(notify.info).toHaveBeenLastCalledWith('2 days repeated from the week before.');
  });

  it('moves a week at a time', async () => {
    const { page, refresh } = await render();
    page['move'](7);
    await refresh();
    expect(rosterOf).toHaveBeenLastCalledWith('2026-10-31', '2026-11-06', undefined);
  });

  it('shows whoever cannot change it the roster alone', async () => {
    const { el, cells } = await render(false);
    expect(cells(0).every((c) => c.tagName === 'DIV')).toBe(true);
    expect(el.querySelector('.row-menu')).toBeNull();
    expect(text(el.querySelector('.toolbar')!)).not.toContain('Shifts');
    expect(text(el.querySelector('.note .note-ar')!)).toContain('اليوم المُسجَّل في الجدول يُحاسَب على شفته');
  });
});

describe('a shift’s hours as typed', () => {
  it('reads them however they come, and nothing that is not a time', () => {
    expect(['8', '08', '0800', '8:30', '08.30', '1630', '16:30', ' 4pm ', '4:30 PM', '12am', '12pm', '٠٨:٣٠', '4 م'].map(parseTime)).toEqual([
      '08:00', '08:00', '08:00', '08:30', '08:30', '16:30', '16:30', '16:00', '16:30', '00:00', '12:00', '08:30', '16:00',
    ]);
    expect(['', 'noon', '24', '8:60', '13pm', '0pm', '123456'].map(parseTime)).toEqual([null, null, null, null, null, null, null]);
  });
});

describe('the shifts', () => {
  const saveShift = vi.fn();
  const deleteShift = vi.fn();
  const close = vi.fn();

  async function render() {
    TestBed.configureTestingModule({
      providers: [
        { provide: HrApi, useValue: { saveShift, deleteShift } },
        { provide: MatDialogRef, useValue: { close } },
        { provide: MAT_DIALOG_DATA, useValue: { shifts: [morning, night] } },
      ],
    });
    const fixture = TestBed.createComponent(ShiftDialog);
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
    saveShift.mockReset();
    deleteShift.mockReset().mockReturnValue(of(undefined));
    close.mockReset();
  });

  it('adds one with its hours and colour, and deletes only one on no day', async () => {
    saveShift.mockImplementation((id: string, input: Record<string, string>) => of({ ...input, id, minutes: 480, rosteredDays: 0 }));
    const { el, page, refresh } = await render();

    expect([...el.querySelectorAll('.shifts li')].map((li) => cell(li.querySelector('.what')!))).toEqual([
      'Morning 08:00–16:00 · 8h · on 1 day', 'Night 22:00–06:00 +1 · 8h',
    ]);
    expect([...el.querySelectorAll<HTMLButtonElement>('.shifts .danger')].map((b) => b.disabled)).toEqual([true, false]);

    const type = async (label: string, value: string) => {
      const input = el.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      await refresh();
    };
    // Pressed with something missing, it says what instead of doing nothing.
    const add = () => el.querySelector<HTMLButtonElement>('mat-dialog-actions button:first-child')!;
    expect(add().disabled).toBe(false);
    add().click();
    await refresh();
    expect(text(el.querySelector('.error')!)).toBe('Give the shift its name. · اكتب اسم الشفت');
    await type('Name', ' Evening ');
    add().click();
    await refresh();
    expect(text(el.querySelector('.error')!)).toBe('Enter when it starts, like 08:00. · أدخل وقت البداية');
    expect(saveShift).not.toHaveBeenCalled();

    await type('Starts', '4pm');
    el.querySelector<HTMLInputElement>('input[aria-label="Starts"]')!.dispatchEvent(new Event('blur'));
    await refresh();
    expect(el.querySelector<HTMLInputElement>('input[aria-label="Starts"]')!.value).toBe('16:00');
    await type('Ends', '0');
    el.querySelector<HTMLButtonElement>('.tone[aria-label="Teal"]')!.click();
    await refresh();
    expect(text(el.querySelectorAll('mat-hint')[1])).toBe('The next morning · صباح اليوم التالي');
    await page['save']();
    await refresh();
    expect(saveShift.mock.lastCall![1]).toEqual({ name: 'Evening', startsAt: '16:00:00', endsAt: '00:00:00', tone: 'Teal' });
    expect(el.querySelectorAll('.shifts li')).toHaveLength(3);

    await page['remove'](night);
    await refresh();
    expect(deleteShift).toHaveBeenCalledWith('night');
    el.querySelector<HTMLButtonElement>('mat-dialog-actions button:last-child')!.click();
    expect(close).toHaveBeenCalledWith(true);
  });
});
