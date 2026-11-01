import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { EmployeeHrAccess, HrApi, StaffHrAccess } from '../../core/hr/hr.api';
import { NotifyService } from '../../core/ui/notify.service';
import { AccessDialog, AccessDialogData, PermissionsPage, holderOf } from './permissions-page';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();
// Element by element: the template leaves no space between them.
const cell = (el: Element): string =>
  [...el.childNodes]
    .map((n) => (n.nodeType === Node.ELEMENT_NODE ? cell(n as Element) : n.nodeType === Node.TEXT_NODE ? (n.textContent ?? '').trim() : ''))
    .filter(Boolean)
    .join(' ');

const hassan: EmployeeHrAccess = { id: 'hassan', name: 'Hassan', jobTitle: 'Supervisor', department: 'Key accounts', hasMobile: true, hasPin: true, tabs: ['Now', 'Attendance'] };
const kemo: EmployeeHrAccess = { id: 'kemo', name: 'Kemo', jobTitle: 'Checker', department: 'Key accounts', hasMobile: false, hasPin: false, tabs: [] };
const mona: StaffHrAccess = { id: 'staff-accountant', name: 'Mona', role: 'Accountant', restricted: false, tabs: [], setBy: null, setAtUtc: null };

describe('employee permissions', () => {
  const access = vi.fn();
  const setEmployeeTabs = vi.fn();
  const setStaffTabs = vi.fn();
  const open = vi.fn();
  const notify = { info: vi.fn(), error: vi.fn() };

  async function render() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: HrApi, useValue: { access, setEmployeeTabs, setStaffTabs } },
        { provide: MatDialog, useValue: { open } },
        { provide: NotifyService, useValue: notify },
      ],
    });
    const fixture = TestBed.createComponent(PermissionsPage);
    const el = fixture.nativeElement as HTMLElement;
    const refresh = async () => {
      for (let i = 0; i < 3; i++) {
        fixture.detectChanges();
        await fixture.whenStable();
      }
      fixture.detectChanges();
    };
    await refresh();
    const rows = () => [...el.querySelectorAll('table.access tbody tr')].map((r) => [...r.querySelectorAll('td')].slice(0, 3).map(cell));
    return { el, refresh, rows, page: fixture.componentInstance as unknown as Record<string, any> };
  }

  beforeEach(() => {
    access.mockReset().mockReturnValue(of({ employees: [hassan, kemo], staff: [mona] }));
    setEmployeeTabs.mockReset();
    setStaffTabs.mockReset();
    open.mockReset();
    notify.info.mockReset();
    notify.error.mockReset();
  });

  it('lists only those with permissions: an employee given tabs, and an accountant with every one until ticked', async () => {
    const { el, rows, page, refresh } = await render();

    expect(rows()).toEqual([
      ['H Hassan Supervisor · Key accounts', 'Now Attendance', 'Portal · البوابة'],
      ['M Mona Accountant · محاسب', 'Every permission · كل الصلاحيات Until you tick theirs', 'The system · النظام'],
    ]);
    expect(cell(el.querySelector('.toolbar .add')!)).toBe('add Add permission إضافة صلاحية');

    page['query'].set('kem');
    await refresh();
    expect(text(el.querySelector('td.empty')!)).toContain('No one with permissions is called that.');
  });

  it('adds permission for someone picked from everyone, and changes or takes off a row’s', async () => {
    const { rows, page, refresh } = await render();

    // Added: Kemo, from everyone, given Shift Rostering alone.
    setEmployeeTabs.mockReturnValue(of({ ...kemo, tabs: ['Roster'] }));
    open.mockReturnValue({ afterClosed: () => of({ person: holderOf(kemo), tabs: ['Roster'] }) });
    await page['add']();
    expect(open.mock.lastCall![0]).toBe(AccessDialog);
    const data: AccessDialogData = open.mock.lastCall![1].data;
    expect(data.person).toBeUndefined();
    expect(data.people.map((p) => p.name)).toEqual(['Hassan', 'Kemo', 'Mona']);
    expect(setEmployeeTabs).toHaveBeenCalledWith('kemo', ['Roster']);
    expect(notify.info).toHaveBeenLastCalledWith('Kemo’s permissions: Shift Rostering.');
    await refresh();
    expect(rows().map((r) => r.slice(0, 2))).toEqual([
      ['H Hassan Supervisor · Key accounts', 'Now Attendance'],
      ['K Kemo Checker · Key accounts', 'Shift Rostering'],
      ['M Mona Accountant · محاسب', 'Every permission · كل الصلاحيات Until you tick theirs'],
    ]);
    expect(rows()[1][2]).toBe('No mobile number');

    // Changed: the row's own, in the dialog.
    setStaffTabs.mockReturnValue(of({ ...mona, restricted: true, tabs: ['Payroll', 'Advances'], setBy: 'Omar', setAtUtc: '2026-10-25T18:00:00Z' }));
    open.mockReturnValue({ afterClosed: () => of({ person: holderOf(mona, true), tabs: ['Payroll', 'Advances'] }) });
    await page['change'](holderOf(mona, true));
    expect(open.mock.lastCall![1].data.person.key).toBe('staff:staff-accountant');
    expect(setStaffTabs).toHaveBeenCalledWith('staff-accountant', ['Payroll', 'Advances']);
    await refresh();
    expect(rows()[2]).toEqual(['M Mona Accountant · محاسب', 'Payroll Advances', 'The system · النظام by Omar, 25 Oct 2026']);

    // Taken off: off the list.
    setEmployeeTabs.mockReturnValue(of({ ...hassan, tabs: [] }));
    await page['remove'](holderOf(hassan));
    expect(setEmployeeTabs).toHaveBeenLastCalledWith('hassan', []);
    expect(notify.info).toHaveBeenLastCalledWith('Hassan has no permissions now.');
    await refresh();
    expect(rows().map((r) => r[0])).toEqual(['K Kemo Checker · Key accounts', 'M Mona Accountant · محاسب']);

    // Cancelled: nothing sent. Refused: said.
    open.mockReturnValue({ afterClosed: () => of(undefined) });
    await page['add']();
    expect(setEmployeeTabs).toHaveBeenCalledTimes(2);
    setEmployeeTabs.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 422, error: { detail: 'Kemo has left: bring them back before giving them HR tabs.' } })));
    open.mockReturnValue({ afterClosed: () => of({ person: holderOf(kemo), tabs: ['Now'] }) });
    await page['add']();
    expect(notify.error).toHaveBeenLastCalledWith('Kemo has left: bring them back before giving them HR tabs.');
  });
});

describe('the add permission dialog', () => {
  const close = vi.fn();
  const people = [holderOf(hassan), holderOf(kemo), holderOf(mona, true)];

  async function render(data: AccessDialogData) {
    TestBed.configureTestingModule({
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close } },
      ],
    });
    const fixture = TestBed.createComponent(AccessDialog);
    const refresh = async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    await refresh();
    return { el: fixture.nativeElement as HTMLElement, refresh, page: fixture.componentInstance as unknown as Record<string, any> };
  }

  beforeEach(() => {
    close.mockReset();
  });

  it('picks who from a searched list, then their permissions, Shift Rostering among them on its own', async () => {
    const { el, page, refresh } = await render({ people });

    expect(text(el.querySelector('h2')!)).toBe('Add permission إضافة صلاحية');
    expect([...el.querySelectorAll('.tab-option')].map((c) => c.getAttribute('data-tab'))).toEqual([
      'Now', 'Analytics', 'Employees', 'Departments', 'Attendance', 'Roster', 'Corrections', 'Payroll', 'Advances', 'Holidays', 'Devices', 'Custody',
    ]);
    expect(cell(el.querySelector('.tab-option[data-tab="Roster"] .mdc-label')!)).toBe(
      'Shift Rostering جداول الشفتات Shifts, and who works which each day · الشفتات ومن يعمل في كل منها',
    );
    expect([...el.querySelectorAll('.step h4')].map(cell)).toEqual(['HR & Payroll الموارد البشرية والرواتب', 'Custody & Assets العهدة والأصول']);

    // Saved with no one picked: said what is missing.
    page['save']();
    await refresh();
    expect(text(el.querySelector('.error')!)).toBe('Choose who first. · اختر الشخص أولًا');
    expect(close).not.toHaveBeenCalled();

    // Searched, then picked: their tabs ticked as they are.
    page['typed']('kem');
    expect(page['matches']().map((p: { name: string }) => p.name)).toEqual(['Kemo']);
    page['typed']('employee:hassan');
    await refresh();
    expect(page['query']()).toBe('Hassan');
    expect([...page['chosen']()]).toEqual(['Now', 'Attendance']);

    page['tick']('Roster', true);
    page['tick']('Now', false);
    page['save']();
    expect(close).toHaveBeenCalledWith({ person: people[0], tabs: ['Attendance', 'Roster'] });
  });

  it('opens on someone’s own when changing theirs, every tab for an accountant not ticked yet, and says what a portal needs', async () => {
    let { el, page } = await render({ people, person: people[2] });
    expect(text(el.querySelector('h2')!)).toBe('Mona’s permissions تعديل الصلاحيات');
    expect(el.querySelector<HTMLInputElement>('input[aria-label="Who"]')!.disabled).toBe(true);
    expect(page['every']()).toBe(true);

    TestBed.resetTestingModule();
    ({ el, page } = await render({ people, person: people[1] }));
    expect(text(el.querySelector('.warn')!)).toContain('They need a mobile number and a PIN to sign in to the portal: set them on their profile.');
  });
});
