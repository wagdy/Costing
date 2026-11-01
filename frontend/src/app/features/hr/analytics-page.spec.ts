import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { HrAnalytics, HrApi } from '../../core/hr/hr.api';
import { BusinessDay } from '../../core/ui/business-day';
import { AnalyticsPage, niceScale, tenure } from './analytics-page';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();
// Element by element: the template leaves no space between them.
const cell = (el: Element): string =>
  [...el.childNodes]
    .map((n) => (n.nodeType === Node.ELEMENT_NODE ? cell(n as Element) : n.nodeType === Node.TEXT_NODE ? (n.textContent ?? '').trim() : ''))
    .filter(Boolean)
    .join(' ');

const october: HrAnalytics = {
  from: '2026-10-01',
  to: '2026-10-31',
  months: 1,
  departmentId: null,
  bucket: 'Day',
  attendance: {
    scheduledDays: 40, workedDays: 36, onTimeDays: 30, lateDays: 6, absentDays: 4, lateMinutes: 135, overtimeMinutes: 300, attendanceRate: 90, onTimeRate: 83.3,
  },
  trend: Array.from({ length: 31 }, (_, i) => ({
    from: `2026-10-${String(i + 1).padStart(2, '0')}`,
    to: `2026-10-${String(i + 1).padStart(2, '0')}`,
    onTime: i === 0 ? 4 : 1,
    late: i === 1 ? 2 : 0,
    absent: i === 2 ? 1 : 0,
  })),
  mostLate: [
    { employeeId: 'hassan', name: 'Hassan', jobTitle: 'Chef', department: 'Kitchen', scheduledDays: 31, lateDays: 4, lateMinutes: 95, absentDays: 1 },
    { employeeId: 'mona', name: 'Mona', jobTitle: 'Cashier', department: 'Service', scheduledDays: 9, lateDays: 2, lateMinutes: 40, absentDays: 3 },
  ],
  mostAbsent: [
    { employeeId: 'mona', name: 'Mona', jobTitle: 'Cashier', department: 'Service', scheduledDays: 9, lateDays: 2, lateMinutes: 40, absentDays: 3 },
  ],
  departments: [
    { departmentId: 'kitchen', name: 'Kitchen', employed: 3, contractedCost: 20_000, actualCost: 18_000, share: 60 },
    { departmentId: 'service', name: 'Service', employed: 2, contractedCost: 10_000, actualCost: 12_000, share: 40 },
  ],
  totalContracted: 30_000,
  totalActual: 30_000,
  turnover: {
    startsOn: '2026-10-01', endsOn: '2026-10-31', headcountStart: 4, headcountEnd: 5, joined: 2, left: 1, averageHeadcount: 4.5, turnoverRate: 22.2, averageTenureDays: 400,
  },
};

describe('HR analytics', () => {
  const analytics = vi.fn();
  const departments = vi.fn();

  async function render() {
    TestBed.configureTestingModule({
      providers: [
        { provide: HrApi, useValue: { analytics, departments } },
        { provide: BusinessDay, useValue: { today: () => Promise.resolve('2026-11-01') } },
      ],
    });
    const fixture = TestBed.createComponent(AnalyticsPage);
    const el = fixture.nativeElement as HTMLElement;
    const refresh = async () => {
      for (let i = 0; i < 3; i++) {
        fixture.detectChanges();
        await fixture.whenStable();
      }
      fixture.detectChanges();
    };
    await refresh();
    return { el, refresh, page: fixture.componentInstance as unknown as Record<string, any> };
  }

  beforeEach(() => {
    analytics.mockReset().mockReturnValue(of({ ...october, from: '2026-11-01', to: '2026-11-30' }));
    departments.mockReset().mockReturnValue(of([
      { id: 'kitchen', name: 'Kitchen' },
      { id: 'service', name: 'Service' },
    ]));
  });

  it('opens on this month, and moves a month, three or twelve at a time, of everyone or a department', async () => {
    const { el, page, refresh } = await render();
    expect(analytics).toHaveBeenLastCalledWith('2026-11-01', 1, undefined);
    expect(text(el.querySelector('.month')!)).toBe('November 2026');
    expect(el.querySelector<HTMLButtonElement>('button[aria-label="The month after"]')!.disabled).toBe(true);

    analytics.mockReturnValue(of(october));
    el.querySelector<HTMLButtonElement>('button[aria-label="The month before"]')!.click();
    await refresh();
    expect(analytics).toHaveBeenLastCalledWith('2026-10-01', 1, undefined);
    expect(text(el.querySelector('h2.period')!)).toBe('October 2026 لوحة التحليلات');

    analytics.mockReturnValue(of({ ...october, from: '2026-08-01', months: 3, bucket: 'Week', trend: [] }));
    page['pickMonths'](3);
    await refresh();
    expect(analytics).toHaveBeenLastCalledWith('2026-10-01', 3, undefined);
    expect(text(el.querySelector('h2.period')!)).toBe('August – October 2026 لوحة التحليلات');

    analytics.mockReturnValue(of({ ...october, from: '2025-11-01', months: 12, bucket: 'Month', trend: [] }));
    page['pickMonths'](12);
    page['pickDepartment']('kitchen');
    await refresh();
    expect(analytics).toHaveBeenLastCalledWith('2026-10-01', 12, 'kitchen');
    expect(text(el.querySelector('h2.period')!)).toBe('November 2025 – October 2026 لوحة التحليلات');
    expect(el.querySelector('app-filter-select')).not.toBeNull();
  });

  it('shows attendance and punctuality: the rates, the trend with a legend and a table, and who was late or absent most', async () => {
    analytics.mockReturnValue(of(october));
    const { el } = await render();

    const tiles = [...el.querySelectorAll('section')[0].querySelectorAll('.tile')].map(cell);
    expect(tiles).toEqual([
      'Attendance rate · نسبة الحضور 90% 36 of 40 working days worked',
      'Absence days · أيام الغياب 4 working days with no punch',
      'Late · التأخير 2h 15m 6 late arrivals · 83.3% on time',
      'Overtime · الوقت الإضافي 5h 00m after the shifts\' end',
    ]);

    // A column a day, stacked on time, late and absent, on a scale of 0 to 4.
    const columns = [...el.querySelectorAll('.column')];
    expect(columns.length).toBe(31);
    expect([...el.querySelectorAll('.y span')].map(text)).toEqual(['0', '1', '2', '3', '4']);
    expect(columns[0].getAttribute('aria-label')).toBe('Thu, 1 Oct 2026: on time 4 · late 0 · absent 0');
    expect([...columns[1].querySelectorAll('.stack i')].map((i) => [i.className, (i as HTMLElement).style.height])).toEqual([
      ['late', '50%'],
      ['on-time', '25%'],
    ]);
    expect([...columns[2].querySelectorAll('.stack i')].map((i) => i.className)).toEqual(['absent', 'on-time']);
    // Every fifth day named under it.
    expect(columns.map((c) => text(c.querySelector('.x')!)).filter(Boolean)).toEqual(['1', '6', '11', '16', '21', '26', '31']);
    expect(text(el.querySelector('.legend')!)).toBe('On time · في الموعدLate · متأخرAbsent · غائب');
    expect(el.querySelector('.chart')!.getAttribute('aria-label')).toBe('30 days on time, 6 late and 4 absent, by day. The table under the chart has each.');
    expect([...el.querySelectorAll('.as-table tbody tr')].slice(0, 2).map((r) => [...r.querySelectorAll('td')].map(text))).toEqual([
      ['Thu, 1 Oct 2026', '4', '0', '0'],
      ['Fri, 2 Oct 2026', '1', '2', '0'],
    ]);

    const [late, absent] = [...el.querySelectorAll('.pair table')];
    expect([...late.querySelectorAll('tbody tr')].map((r) => [...r.querySelectorAll('td')].map(cell))).toEqual([
      ['Hassan Chef · Kitchen', '4', '1h 35m'],
      ['Mona Cashier · Service', '2', '40m'],
    ]);
    expect([...absent.querySelectorAll('tbody tr')].map((r) => [...r.querySelectorAll('td')].map(cell))).toEqual([['Mona Cashier · Service', '3', '9']]);
  });

  it('compares each department’s actual labour cost with its contracted, and shows the turnover', async () => {
    analytics.mockReturnValue(of(october));
    const { el, page, refresh } = await render();

    const costs = el.querySelectorAll('section')[1];
    expect([...costs.querySelectorAll('.tile')].map(cell)).toEqual([
      'Contracted · التكلفة التعاقدية 30,000.00 the monthly salaries in full',
      'Actual · التكلفة الفعلية 30,000.00 what the work cost, as the payroll has it',
      'Difference · الفرق 0.00 as contracted',
    ]);
    // On one scale, the largest of them all: the kitchen's contracted 20,000.
    const rows = [...costs.querySelectorAll('.bar-row')];
    expect(rows.map((r) => [cell(r.querySelector('.who')!), cell(r.querySelector('.figure')!)])).toEqual([
      ['Kitchen 3 employed', '18,000.00 60% · of 20,000.00'],
      ['Service 2 employed', '12,000.00 40% · of 10,000.00'],
    ]);
    expect(rows.map((r) => [(r.querySelector('.bar') as HTMLElement).style.width, (r.querySelector('.tick') as HTMLElement).style.insetInlineStart])).toEqual([
      ['90%', '100%'],
      ['60%', '50%'],
    ]);
    expect(rows[1].querySelector('.track')!.getAttribute('aria-label')).toBe('Service: actual 12,000.00 of 10,000.00 contracted · 40% of the cost');

    // Below contracted: said in words, not with a minus.
    analytics.mockReturnValue(of({ ...october, totalActual: 27_500 }));
    page['pickMonths'](1);
    await refresh();
    expect(cell(costs.querySelectorAll('.tile')[2])).toBe('Difference · الفرق 2,500.00 below contracted');

    expect([...el.querySelectorAll('section')[2].querySelectorAll('.tile')].map(cell)).toEqual([
      'Headcount · عدد الموظفين 4 → 5 1 Oct to 31 Oct 2026',
      'Joined · تعيينات جديدة 2 hired in the period',
      'Left · ترك العمل 1 their last day in the period',
      'Turnover rate · معدل الدوران 22.2% 1 left of 4.5 on average',
      'Average tenure · متوسط مدة الخدمة 1 y 1 mo of those employed at the end',
    ]);
    expect(el.querySelector('.note .note-ar')).not.toBeNull();
  });

  it('says why the costs are not shown, says when no working day has passed, and says what went wrong', async () => {
    analytics.mockReturnValue(of({
      ...october,
      attendance: { ...october.attendance, scheduledDays: 0 },
      departments: october.departments.map((d) => ({ ...d, contractedCost: null, actualCost: null, share: null })),
      totalContracted: null,
      totalActual: null,
    }));
    const { el, page, refresh } = await render();
    expect(el.querySelector('.bar-row')).toBeNull();
    expect(text(el.querySelector('.hidden-costs')!)).toBe(
      'تظهر تكلفة العمالة لمن لديه صلاحية مسير الرواتب أو الموظفين أو الأقسام. Labour costs are shown to whoever holds the Payroll, Employees or Departments permission.',
    );
    expect(el.querySelector('.chart')).toBeNull();
    expect(text(el.querySelector('.empty-chart')!)).toBe('No working days have passed in this period yet. · لم تمر أيام عمل في هذه الفترة بعد.');

    analytics.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 422, error: { detail: 'Show one month, three or twelve.' } })));
    page['pickMonths'](3);
    await refresh();
    expect(text(el.querySelector('.error')!)).toBe('Show one month, three or twelve.');
  });

  it('scales at 1, 2 or 5 of a power of ten, and says a tenure in years, months or days', () => {
    expect(niceScale(0)).toEqual([0, 1]);
    expect(niceScale(3)).toEqual([0, 1, 2, 3]);
    expect(niceScale(37)).toEqual([0, 10, 20, 30, 40]);
    expect(niceScale(130)).toEqual([0, 50, 100, 150]);
    expect([tenure(1), tenure(20), tenure(45), tenure(365), tenure(800)]).toEqual(['1 day', '20 days', '1 mo', '1 y', '2 y 2 mo']);
  });
});
