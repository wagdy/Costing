import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { AdvancesReport, Employee, HrApi, PendingAdvance } from '../../core/hr/hr.api';
import { NotifyService } from '../../core/ui/notify.service';
import { Approvals } from '../approvals/approvals';
import { BusinessDay } from '../../core/ui/business-day';
import { AdvanceDialog } from './advance-dialog';
import { DistributeAdvanceDialog } from './distribute-advance-dialog';
import { HrAdvancesPage } from './hr-advances-page';
import { HrAccess } from '../../core/hr/hr-access';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

function employee(id: string, name: string, extra: Partial<Employee> = {}): Employee {
  return {
    id, name, jobTitle: 'Checker', jobRoleId: null, employmentType: 'Monthly', monthlySalary: 5_000, dailyWage: 0, departmentId: 'general', shiftStartsAt: '10:00:00',
    shiftEndsAt: '19:00:00', daysOff: [], deviceUserId: null, hiredOn: '2026-01-01', leftOn: null, isActive: true, dailyRate: 166.67, hourlyRate: 18.52, nationalId: null, mobileNumber: null, idPhoto: null, ...extra,
  };
}

const lump: PendingAdvance = {
  id: 'lump', date: '2026-10-22', amount: 1_000, allocated: 500, remaining: 500, notes: 'Operations', recordedBy: 'Sara',
  shares: [{ id: 's1', employeeId: 'hassan', employee: 'Hassan', amount: 500, payrollMonth: '2026-10-01', notes: 'Gear', allocatedBy: 'Omar', allocatedAtUtc: '2026-10-22T10:00:00Z' }],
  fullyAllocated: false,
};
const done: PendingAdvance = { ...lump, id: 'done', date: '2026-10-05', amount: 300, allocated: 300, remaining: 0, notes: null, shares: [], fullyAllocated: true };
const untouched: PendingAdvance = { ...lump, id: 'eid', date: '2026-10-21', amount: 200, allocated: 0, remaining: 200, notes: 'Eid', shares: [] };

const report: AdvancesReport = {
  month: '2026-10-01',
  allocated: [
    { id: 'a1', origin: 'Direct', advanceId: 'a1', employeeId: 'mona', employee: 'Mona', amount: 150, date: '2026-10-20', payrollMonth: '2026-10-01',
      notes: null, recordedBy: 'Omar' },
    { id: 's1', origin: 'Share', advanceId: 'lump', employeeId: 'hassan', employee: 'Hassan', amount: 500, date: '2026-10-22', payrollMonth: '2026-10-01',
      notes: 'Gear', recordedBy: 'Omar' },
  ],
  pending: [lump, done],
};

describe('HR’s advances', () => {
  const advances = vi.fn();
  const takeBackAdvanceShare = vi.fn();
  const recordHrAdvance = vi.fn();
  const voidHrAdvance = vi.fn();
  const open = vi.fn();
  const notify = { info: vi.fn(), error: vi.fn() };
  const canApprove = signal(true);
  const approvals = { canApprove, refresh: vi.fn(), waitingToBeMade: vi.fn(() => []), requested: vi.fn() };

  async function render() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: HrApi,
          useValue: {
            advances, takeBackAdvanceShare, recordHrAdvance, voidHrAdvance,
            employees: () => of([employee('hassan', 'Hassan'), employee('mona', 'Mona'), employee('gone', 'Gone', { isActive: false, leftOn: '2026-09-30' })]),
          },
        },
        { provide: Approvals, useValue: approvals },
        { provide: HrAccess, useValue: { has: () => true, canDecide: () => approvals.canApprove() } },
        { provide: AuthService, useValue: { employeeActing: () => false, me: () => null, can: () => true } },
        { provide: BusinessDay, useValue: { today: () => Promise.resolve('2026-10-22') } },
        { provide: NotifyService, useValue: notify },
        { provide: MatDialog, useValue: { open } },
      ],
    });
    const fixture = TestBed.createComponent(HrAdvancesPage);
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, page: fixture.componentInstance as unknown as Record<string, any> };
  }

  // The page opens on this month's advances by the clock: October's, as the report here is,
  // whatever day the tests are run on. Only the date is fixed; timers run as they do.
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-22T12:00:00'));
    advances.mockReset().mockReturnValue(of(report));
    takeBackAdvanceShare.mockReset().mockReturnValue(of({ ...lump, allocated: 0, remaining: 1_000, shares: [] }));
    recordHrAdvance.mockReset();
    voidHrAdvance.mockReset().mockReturnValue(of({}));
    approvals.requested.mockReset();
    open.mockReset();
    notify.info.mockReset();
    canApprove.set(true);
  });

  it('lists the lump sums waiting, with what is given out and what is left, and who has a share', async () => {
    const { el } = await render();

    expect(text(el.querySelector('.toolbar > .muted')!)).toBe('650.00 off this month\'s pay · 500.00 to give out');
    const [waiting, allGiven] = [...el.querySelectorAll('section.lump')];
    expect(text(waiting.querySelector('header')!)).toBe(
      '1,000.00 handed out 22 Oct Operations · entered by Sara500.00 leftمتبقيcall_split Distribute توزيع',
    );
    expect([...waiting.querySelectorAll('tbody td')].slice(0, 3).map(text)).toEqual(['HassanGear', 'October 2026', '500.00']);
    expect(text(allGiven.querySelector('.status')!)).toBe('Fully allocatedتم التوزيع بالكامل');
    expect(allGiven.querySelector('header button')).toBeNull();
  });

  it('gives a lump sum out through the Distribute dialog, to those employed on its day, and takes a share back', async () => {
    const { page } = await render();
    open.mockReturnValue({ afterClosed: () => of({ ...lump, allocated: 1_000, remaining: 0, fullyAllocated: true }) });

    await page['distribute'](lump);
    expect(open.mock.lastCall![0]).toBe(DistributeAdvanceDialog);
    expect(open.mock.lastCall![1].data.employees.map((e: Employee) => e.id)).toEqual(['hassan', 'mona']);
    expect(notify.info).toHaveBeenCalledWith('All 1,000.00 given out: each share comes off its employee\'s pay.');
    expect(advances).toHaveBeenCalledTimes(2);

    await page['takeBack'](lump.shares[0]);
    expect(takeBackAdvanceShare).toHaveBeenCalledWith('s1');
    expect(notify.info).toHaveBeenLastCalledWith('Hassan\'s 500.00 is taken back, to give out again.');
  });

  it('records an advance in its own dialog, and an accountant’s goes to a manager', async () => {
    const { page } = await render();
    const input = { advanceId: 't1', requestId: 'r1', amount: 250, date: '2026-10-22', employeeId: 'mona', notes: 'Rent' };
    open.mockReturnValue({ afterClosed: () => of(input) });
    recordHrAdvance.mockReturnValue(of({ id: 't1', amount: 250, date: '2026-10-22', employeeId: 'mona', employee: 'Mona', payrollMonth: '2026-10-01' }));

    await page['newAdvance']();
    expect(open.mock.lastCall![0]).toBe(AdvanceDialog);
    expect(open.mock.lastCall![1].data).toMatchObject({ canApprove: true, today: '2026-10-22' });
    expect(open.mock.lastCall![1].data.employees.map((e: Employee) => e.id)).toEqual(['hassan', 'mona', 'gone']);
    expect(recordHrAdvance).toHaveBeenCalledWith(input);
    expect(notify.info).toHaveBeenCalledWith('250.00 recorded: it comes off Mona\'s pay.');

    const asked = { outcome: 'Requested', request: { id: 'q1', action: 'Create' } };
    recordHrAdvance.mockReturnValue(of(asked));
    await page['newAdvance']();
    expect(approvals.requested).toHaveBeenCalledWith(asked);
  });

  it('lets a manager void a lump sum none of which is given out, and an advance to one employee', async () => {
    advances.mockReturnValue(of({ ...report, pending: [untouched, lump] }));
    const { el, page } = await render();

    const [eid, given] = [...el.querySelectorAll('section.lump header')];
    expect(text(eid)).toContain('200.00 handed out 21 Oct Eid');
    expect(eid.querySelector('button[aria-label="Void these advances"]')).not.toBeNull();
    expect(given.querySelector('button[aria-label="Void these advances"]')).toBeNull();
    await page['voidAdvance']('eid', 200);
    expect(voidHrAdvance).toHaveBeenCalledWith('eid');
    expect(notify.info).toHaveBeenLastCalledWith('200.00 of advances voided.');

    await page['voidAdvance']('a1', 150, report.allocated[0]);
    expect(notify.info).toHaveBeenLastCalledWith('The advance to Mona is voided: it no longer comes off their pay.');
  });

  it('shows the month’s advances off whose pay, paid to them or a share; and nothing to change to whoever may not approve', async () => {
    canApprove.set(false);
    const { fixture, el, page } = await render();
    expect(el.querySelectorAll('section.lump button').length).toBe(0);

    page['view'].set('allocated');
    fixture.detectChanges();
    const rows = [...el.querySelectorAll('tbody tr')].map((r) => [...r.querySelectorAll('td')].map(text));
    expect(rows.map((r) => r.slice(1, 4))).toEqual([
      ['Mona', 'Advance to themسلفة مباشرة', '150.00'],
      ['HassanGear', 'Share of the advances of 22 Octحصة من سلفة', '500.00'],
    ]);
    expect(text(el.querySelector('tfoot')!)).toBe("Off October's pay · Payroll650.00");
  });
});
