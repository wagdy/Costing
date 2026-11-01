import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { of, throwError } from 'rxjs';
import { Department, Employee, EmployeeInput, HrApi } from '../../core/hr/hr.api';
import { NotifyService } from '../../core/ui/notify.service';
import { Company, CompanySettings } from '../../core/settings/company';
import { aCompany } from '../../../testing/fixtures';
import { EmployeeDialog, EmployeeDialogData } from './employee-dialog';
import { EmploymentDialog, EmploymentDialogData } from './employment-dialog';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

const hassan: Employee = {
  id: 'hassan', name: 'Hassan', jobTitle: 'Checker', monthlySalary: 5_400, shiftStartsAt: '16:00:00', shiftEndsAt: '01:00:00', daysOff: ['Friday'],
  deviceUserId: '7', hiredOn: '2026-01-01', leftOn: null, isActive: true, dailyRate: 180, hourlyRate: 20, nationalId: null, mobileNumber: null, idPhoto: null, employmentType: 'Monthly', dailyWage: 0, departmentId: 'general', jobRoleId: null,
};

const departments: Department[] = [
  { id: 'general', name: 'General', isGeneral: true, employed: 1, everyone: 1, roles: [], monthlyCost: 0, dailyCost: 0 },
  {
    id: 'accounts', name: 'Key accounts', isGeneral: false, employed: 0, everyone: 0,
    roles: [{ id: 'checker', departmentId: 'accounts', name: 'Checker', employed: 1, monthlyCost: 0, dailyCost: 0 }, { id: 'helper', departmentId: 'accounts', name: 'Key accounts helper', employed: 0, monthlyCost: 0, dailyCost: 0 }],
    monthlyCost: 0, dailyCost: 0,
  },
];

describe('the employee form', () => {
  const saveEmployee = vi.fn();
  const close = vi.fn();
  const notify = { info: vi.fn(), error: vi.fn() };

  // The company's settings as the app has them, when a test says.
  async function render(data: Omit<EmployeeDialogData, 'departments'> & { departments?: Department[] }, company?: CompanySettings) {
    TestBed.configureTestingModule({
      providers: [
        { provide: HrApi, useValue: { saveEmployee } },
        { provide: NotifyService, useValue: notify },
        { provide: MatDialogRef, useValue: { close } },
        { provide: MAT_DIALOG_DATA, useValue: { departments, ...data } },
      ],
    });
    if (company) {
      TestBed.inject(Company).settings.set(company);
    }
    const fixture = TestBed.createComponent(EmployeeDialog);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    // As typing does: the dialog marked for a fresh look.
    const refresh = async () => {
      fixture.componentRef.changeDetectorRef.markForCheck();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    return { el, refresh, page: fixture.componentInstance as unknown as Record<string, any> };
  }

  beforeEach(() => {
    saveEmployee.mockReset().mockImplementation((id: string, input: EmployeeInput) => of({ ...hassan, id, name: input.name }));
    close.mockReset();
    notify.error.mockReset();
  });

  it('says what is missing, field by field, and sends nothing', async () => {
    const { el, page, refresh } = await render({ canApprove: true, today: '2026-10-20' });
    page['salary'] = null;
    page['daysOff'] = ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

    await page['save']();
    await refresh();

    expect(saveEmployee).not.toHaveBeenCalled();
    expect(notify.error.mock.lastCall![1]).toBe(
      'Cannot submit. Full name: enter their full name. Role: enter what they do. Base salary: enter the salary. And 1 more, marked in red.',
    );
    expect([...el.querySelectorAll('mat-error')].map(text)).toEqual(['Enter their full name', 'Enter what they do', 'Enter the salary']);
    expect(text(el.querySelector('.days .error')!)).toBe('Leave at least one working day');
  });

  it('adds one with a nine-hour work schedule, its rates, and its days off, under a new id', async () => {
    const { el, page, refresh } = await render({ canApprove: true, today: '2026-10-20' });
    Object.assign(page, { name: ' Mona ', jobTitle: 'Warehouse clerk', salary: 4_050, shiftStart: '16:30', daysOff: ['Friday'], deviceUserId: ' 12 ' });
    await refresh();

    expect([...el.querySelectorAll('mat-hint')].map(text)).toContain('Nine hours: ends 01:30 the next day');
    expect([...el.querySelectorAll('mat-hint')].map(text)).toContain('A month: 135.00 a day · 15.00 an hour');
    await page['save']();

    const [id, input] = saveEmployee.mock.lastCall! as [string, EmployeeInput];
    expect(input).toMatchObject({
      name: 'Mona', jobTitle: 'Warehouse clerk', employmentType: 'Monthly', monthlySalary: 4_050, dailyWage: 0, departmentId: 'general', jobRoleId: null, shiftStartsAt: '16:30:00',
      daysOff: ['Friday'], hiredOn: '2026-10-20', deviceUserId: '12', reason: null,
    });
    expect(id).not.toBe(input.requestId);
    expect(close).toHaveBeenCalledWith(expect.objectContaining({ id, name: 'Mona' }));
  });

  it('takes their full name, national ID and mobile, in Arabic digits too, and says when one is not right', async () => {
    const { el, page, refresh } = await render({ canApprove: true, today: '2026-10-20' });
    expect([...el.querySelectorAll('mat-label')].map(text)).toEqual(expect.arrayContaining(['Full name · الاسم بالكامل', 'National ID · رقم البطاقة', 'Mobile · رقم الموبايل']));
    Object.assign(page, { name: 'Mona Adel Hassan', jobTitle: 'Warehouse clerk', salary: 4_000, nationalId: '2900101', mobileNumber: 'call me' });

    await page['save']();
    await refresh();
    expect(saveEmployee).not.toHaveBeenCalled();
    expect([...el.querySelectorAll('mat-error')].map(text)).toEqual([
      'The card has 14 digits, not 7',
      'Digits only, such as 01012345678',
    ]);

    Object.assign(page, { nationalId: ' ٢٩٠٠١٠١ ٠١٢٣٤٥٦ ', mobileNumber: '٠١٠ ١٢٣٤-٥٦٧٨' });
    await page['save']();
    expect(saveEmployee.mock.lastCall![1]).toMatchObject({ name: 'Mona Adel Hassan', nationalId: '٢٩٠٠١٠١ ٠١٢٣٤٥٦', mobileNumber: '٠١٠ ١٢٣٤-٥٦٧٨' });
  });

  it('takes a Saudi ID or Iqama in Saudi Arabia, starts someone new on its weekends, and keeps an ID they have', async () => {
    const saudi = aCompany({ country: 'SaudiArabia', weekends: ['Friday', 'Saturday'] });
    const { el, page, refresh } = await render({ canApprove: true, today: '2026-10-20' }, saudi);
    expect(page['daysOff']).toEqual(['Friday', 'Saturday']);
    expect([...el.querySelectorAll('mat-hint')].map(text)).toContain('10 digits (ID 1…, Iqama 2…), or a passport no.');
    Object.assign(page, { name: 'Faisal', jobTitle: 'Warehouse clerk', salary: 6_000, nationalId: '3012345678' });

    await page['save']();
    await refresh();
    expect(saveEmployee).not.toHaveBeenCalled();
    expect([...el.querySelectorAll('mat-error')].map(text)).toEqual(['An ID starts 1, an Iqama 2']);
    page['nationalId'] = '2012345678';
    await page['save']();
    expect(saveEmployee.mock.lastCall![1]).toMatchObject({ nationalId: '2012345678', daysOff: ['Friday', 'Saturday'] });

    // Hassan's Egyptian card stays, and so do his own days off.
    TestBed.resetTestingModule();
    saveEmployee.mockClear();
    const edit = await render({ employee: { ...hassan, nationalId: '29001010123456' }, canApprove: true, today: '2026-10-20' }, saudi);
    expect(edit.page['daysOff']).toEqual(['Friday']);
    await edit.page['save']();
    expect(saveEmployee.mock.lastCall![1]).toMatchObject({ nationalId: '29001010123456', daysOff: ['Friday'] });
  });

  it('keeps the national ID and mobile they have when something else is changed, and a passport’s number is fine', async () => {
    const { page } = await render({ employee: { ...hassan, nationalId: 'A1234567', mobileNumber: '+201012345678' }, canApprove: true, today: '2026-10-20' });
    page['salary'] = 5_600;
    await page['save']();
    expect(saveEmployee.mock.lastCall![1]).toMatchObject({ monthlySalary: 5_600, nationalId: 'A1234567', mobileNumber: '+201012345678' });

    page['nationalId'] = ' ';
    await page['save']();
    expect(saveEmployee.mock.lastCall![1]).toMatchObject({ nationalId: null });
  });

  it('takes a daily wage instead of a salary, and the department chosen', async () => {
    const { el, page, refresh } = await render({ canApprove: true, today: '2026-10-20' });
    Object.assign(page, { name: 'Samir', jobTitle: 'Key accounts helper', employmentType: 'Daily', salary: 270, departmentId: 'accounts' });
    await refresh();

    expect([...el.querySelectorAll('mat-label')].map(text)).toContain('Daily wage · الأجر اليومي');
    expect([...el.querySelectorAll('mat-label')].map(text)).not.toContain('Base salary · الراتب الأساسي');
    expect([...el.querySelectorAll('mat-hint')].map(text)).toContain('A day worked: 30.00 an hour; nothing for a day not worked');
    await page['save']();
    expect(saveEmployee.mock.lastCall![1]).toMatchObject({ employmentType: 'Daily', monthlySalary: 0, dailyWage: 270, departmentId: 'accounts' });
  });

  it('takes one of the department’s roles, or a new one by its name', async () => {
    const { el, page, refresh } = await render({ canApprove: true, today: '2026-10-20' });
    Object.assign(page, { name: 'Samir', jobTitle: ' key accounts HELPER ', salary: 4_000, departmentId: 'accounts' });
    await refresh();

    expect([...el.querySelectorAll('mat-hint')].map(text)).toContain("One of the department's roles, or a new one");
    await page['save']();
    expect(saveEmployee.mock.lastCall![1]).toMatchObject({ jobTitle: 'Key accounts helper', jobRoleId: 'helper', departmentId: 'accounts' });

    page['jobTitle'] = 'Dishwasher';
    await refresh();
    expect([...el.querySelectorAll('mat-hint')].map(text)).toContain('A new role in Key accounts');
    expect(page['roles']()).toEqual([]);
    page['jobTitle'] = 'he';
    expect(page['roles']().map((r: { name: string }) => r.name)).toEqual(['Checker', 'Key accounts helper']);
  });

  it('needs a department that is there', async () => {
    const { page } = await render({ canApprove: true, today: '2026-10-20', departments: [] });
    Object.assign(page, { name: 'Samir', jobTitle: 'Helper', salary: 4_000 });

    await page['save']();
    expect(saveEmployee).not.toHaveBeenCalled();
    expect(notify.error.mock.lastCall![1]).toContain('Department: choose their department');
  });

  it('takes flexible hours, with no start time, and opens on one from the attendance device', async () => {
    const { el, page, refresh } = await render({ canApprove: true, today: '2026-10-20', fromDevice: { name: 'منى', deviceUserId: '12' } });
    expect([page['name'], page['deviceUserId'], page['flexible']]).toEqual(['منى', '12', false]);

    Object.assign(page, { jobTitle: 'Warehouse clerk', salary: 4_050, flexible: true, shiftStart: '' });
    await refresh();
    expect(el.querySelector('input[type=time]')).toBeNull();
    expect(text(el.querySelector('.flexible')!)).toBe('No start time: nothing is late for them, and hours past nine in a day are overtime.');
    await page['save']();
    expect(saveEmployee.mock.lastCall![1]).toMatchObject({ name: 'منى', shiftStartsAt: null, deviceUserId: '12' });

    TestBed.resetTestingModule();
    const edited = await render({ employee: { ...hassan, shiftStartsAt: null, shiftEndsAt: null }, canApprove: true, today: '2026-10-20' });
    expect(edited.page['flexible']).toBe(true);
  });

  it('changes one as it is, and an accountant sends it for approval with a reason', async () => {
    const { el, page } = await render({ employee: hassan, canApprove: false, today: '2026-10-20' });

    expect(text(el.querySelector('h2')!)).toBe('Edit Hassan تعديل بيانات الموظف');
    expect(text(el.querySelector('.ask')!)).toContain('A manager approves employees and their changes');
    expect([...el.querySelectorAll('mat-dialog-actions button')].map(text)).toEqual(['Cancel', 'Send for approval']);
    page['salary'] = 6_000;
    page['reason'] = 'Promoted';
    await page['save']();

    expect(saveEmployee.mock.lastCall![0]).toBe('hassan');
    expect(saveEmployee.mock.lastCall![1]).toMatchObject({ monthlySalary: 6_000, shiftStartsAt: '16:00:00', daysOff: ['Friday'], deviceUserId: '7', reason: 'Promoted' });
  });

  it('shows why the system refuses it, and stays open', async () => {
    saveEmployee.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 422, error: { errors: ['Hassan has number 7 on the attendance device already.'] } })));
    const { el, page, refresh } = await render({ canApprove: true, today: '2026-10-20' });
    Object.assign(page, { name: 'Karim', jobTitle: 'Warehouse clerk', salary: 4_000, deviceUserId: '7' });

    await page['save']();
    await refresh();

    expect(text(el.querySelector('[role=alert]')!)).toBe('Hassan has number 7 on the attendance device already.');
    expect(close).not.toHaveBeenCalled();
  });
});

describe('an employee leaving or coming back', () => {
  const leave = vi.fn();
  const comeBack = vi.fn();
  const close = vi.fn();

  async function render(data: EmploymentDialogData) {
    TestBed.configureTestingModule({
      providers: [
        { provide: HrApi, useValue: { leave, comeBack } },
        { provide: MatDialogRef, useValue: { close } },
        { provide: MAT_DIALOG_DATA, useValue: data },
      ],
    });
    const fixture = TestBed.createComponent(EmploymentDialog);
    await fixture.whenStable();
    fixture.detectChanges();
    return { el: fixture.nativeElement as HTMLElement, page: fixture.componentInstance as unknown as Record<string, any> };
  }

  beforeEach(() => {
    leave.mockReset().mockReturnValue(of({ ...hassan, isActive: false }));
    comeBack.mockReset().mockReturnValue(of(hassan));
  });

  it('leaves on the day chosen, paid to it', async () => {
    const { el, page } = await render({ employee: hassan, mode: 'leave', canApprove: true, today: '2026-10-20' });

    expect(text(el.querySelector('h2')!)).toBe('Hassan leaves إنهاء الخدمة');
    page['day'] = '2026-10-15';
    await page['save']();
    expect(leave).toHaveBeenCalledWith('hassan', '2026-10-15', null);
    expect(close).toHaveBeenCalled();
  });

  it('comes back, asked of a manager by an accountant', async () => {
    const left = { ...hassan, isActive: false, leftOn: '2026-09-30' };
    const { el, page } = await render({ employee: left, mode: 'return', canApprove: false, today: '2026-10-20' });

    expect([...el.querySelectorAll('mat-dialog-actions button')].map(text)).toEqual(['Cancel', 'Send for approval']);
    page['reason'] = ' Rehired ';
    await page['save']();
    expect(comeBack).toHaveBeenCalledWith('hassan', '2026-10-20', 'Rehired');
  });
});
