import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { CostingApi } from '../../core/costing/costing.api';
import { HrStaffApi, PayrollRun, StaffDeduction } from '../../core/costing/hr-staff.api';
import { MenuSalesApi } from '../../core/costing/menu-sales.api';
import { NotifyService } from '../../core/ui/notify.service';
import { PayrollPage } from './payroll-page';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

const october: PayrollRun = {
  id: 'run-10', period: '2026-10-01', employees: 2, totalGrossWages: 16_000, totalAdditions: 600, totalPenalties: 400, totalAdvancesDeducted: 1_000,
  totalBroughtForward: 0, netCashPayable: 15_200, laborCost: 16_200, status: 'Payable', revision: 1, receivedAtUtc: '2026-11-02T09:00:00Z',
  updatedAtUtc: '2026-11-02T09:00:00Z', safeTransactionId: null, disbursedAtUtc: null, disbursedBy: null, paymentRequested: false,
  departments: [{ name: 'Hall', employees: 1, grossWages: 8_000, additions: 300, penalties: 200, advancesDeducted: 500, netCashPayable: 7_600, laborCost: 8_100 }],
};

describe('payroll and deductions', () => {
  const hr = { status: vi.fn(), payrollRuns: vi.fn(), disburse: vi.fn(), deductions: vi.fn(), recordDeduction: vi.fn(), voidDeduction: vi.fn() };
  const notify = { info: vi.fn(), error: vi.fn() };
  const mona = { id: 'mona', name: 'Mona Adel', jobTitle: null, isActive: true, hrEmployeeId: 'e-17', code: '17', department: 'Hall' };

  async function render(manager = true) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: HrStaffApi, useValue: hr },
        { provide: MenuSalesApi, useValue: { staff: () => of([mona]) } },
        { provide: CostingApi, useValue: { businessToday: () => of({ today: '2026-11-10' }) } },
        { provide: AuthService, useValue: { me: () => null, can: () => manager } },
        { provide: NotifyService, useValue: notify },
      ],
    });
    const fixture = TestBed.createComponent(PayrollPage);
    const settle = async () => {
      await fixture.whenStable();
      fixture.detectChanges();
    };
    await settle();
    return { el: fixture.nativeElement as HTMLElement, settle, page: fixture.componentInstance as unknown as Record<string, any> };
  }

  beforeEach(() => {
    Object.values(hr).forEach((f) => f.mockReset());
    hr.status.mockReturnValue(of({ linked: true, employeesSyncedAtUtc: '2026-11-10T08:00:00Z' }));
    hr.payrollRuns.mockReturnValue(of([october]));
    hr.deductions.mockReturnValue(of([]));
    notify.info.mockReset();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });
  afterEach(() => TestBed.resetTestingModule());

  it('shows the payroll HR sent: its labor cost and its net cash, the advances already off it', async () => {
    const { el } = await render();
    expect(text(el.querySelector('.link-state')!)).toContain('Linked to HR');
    const run = el.querySelector('article.run')!;
    expect(text(run)).toContain('October 2026');
    expect(text(run)).toContain('To pay · مستحق الصرف');
    expect([...run.querySelectorAll('.figures .key dd')].map(text)).toEqual(['L.E 16,200.00', 'L.E 15,200.00']);
  });

  it('pays it out of the safe once, under ids made for it, and shows it paid', async () => {
    const { el, settle } = await render();
    hr.disburse.mockReturnValue(of({ outcome: 'Applied', transaction: { id: 't1' }, request: null }));
    hr.payrollRuns.mockReturnValue(of([{ ...october, status: 'Disbursed', disbursedAtUtc: '2026-11-10T10:00:00Z', disbursedBy: 'Boss' }]));

    [...el.querySelectorAll<HTMLButtonElement>('article.run button')].find((b) => text(b).includes('Pay out of the safe'))!.click();
    await settle();

    expect(hr.disburse).toHaveBeenCalledWith('run-10', expect.any(String), expect.any(String));
    expect(notify.info).toHaveBeenCalledWith('The payroll of October 2026 is paid out of the safe. · تم صرف المسير.');
    expect(text(el.querySelector('article.run')!)).toContain('Paid · تم الصرف');
    expect(el.querySelector('article.run footer button')).toBeNull();
  });

  it('charges a till shortage to an employee, under an id made once, and voids one', async () => {
    const { settle, page, el } = await render();
    const shortage: StaffDeduction = {
      id: 'd1', employeeId: 'mona', employee: 'Mona Adel', date: '2026-11-10', kind: 'TillShortage', amount: 80, reason: 'Short at close', recordedBy: 'Boss',
      recordedAtUtc: '2026-11-10T21:00:00Z', voidedAtUtc: null, voidedBy: null, fromHr: true,
    };
    await page['addDeduction']();
    expect(page['problem']()).toBe('Choose the employee. · اختر الموظف.');

    hr.recordDeduction.mockReturnValue(of(shortage));
    hr.deductions.mockReturnValue(of([shortage]));
    page['employeeId'].set('mona');
    Object.assign(page, { amount: 80, reason: ' Short at close ' });
    await page['addDeduction']();
    await settle();
    expect(hr.recordDeduction).toHaveBeenCalledWith({ id: expect.any(String), employeeId: 'mona', date: '2026-11-10', kind: 'TillShortage', amount: 80, reason: 'Short at close' });
    expect(text(el.querySelector('table[aria-label="Deductions"] tbody')!)).toContain('Mona Adel HR');

    hr.voidDeduction.mockReturnValue(of({ ...shortage, voidedAtUtc: '2026-11-10T22:00:00Z', voidedBy: 'Boss' }));
    await page['voidDeduction'](shortage);
    expect(hr.voidDeduction).toHaveBeenCalledWith('d1');
  });

  it('lets someone who may not pay read it, and nothing more', async () => {
    const { el } = await render(false);
    expect(el.querySelector('article.run footer button')).toBeNull();
    expect(el.querySelector('form.deduction-form')).toBeNull();
  });
});
