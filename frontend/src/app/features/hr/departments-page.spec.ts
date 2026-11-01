import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { Department, HrApi } from '../../core/hr/hr.api';
import { NotifyService } from '../../core/ui/notify.service';
import { Approvals } from '../approvals/approvals';
import { DeleteDepartmentDialog, DeleteRoleDialog, DepartmentDialog, DepartmentsPage } from './departments-page';
import { HrAccess } from '../../core/hr/hr-access';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();
// Element by element: the template leaves no space between them.
const cell = (el: Element): string =>
  [...el.childNodes]
    .map((n) => (n.nodeType === Node.ELEMENT_NODE ? cell(n as Element) : n.nodeType === Node.TEXT_NODE ? (n.textContent ?? '').trim() : ''))
    .filter(Boolean)
    .join(' ');

const general: Department = { id: 'general', name: 'General', isGeneral: true, employed: 1, everyone: 1, roles: [], monthlyCost: 0, dailyCost: 0 };
const accounts: Department = { id: 'accounts', name: 'Key accounts', isGeneral: false, employed: 3, everyone: 4, roles: [], monthlyCost: 0, dailyCost: 0 };
const empty: Department = { id: 'empty', name: 'Management', isGeneral: false, employed: 0, everyone: 0, roles: [], monthlyCost: 0, dailyCost: 0 };

describe('the departments', () => {
  const departments = vi.fn();
  const saveDepartment = vi.fn();
  const deleteDepartment = vi.fn();
  const saveRole = vi.fn();
  const deleteRole = vi.fn();
  const open = vi.fn();
  const notify = { info: vi.fn(), error: vi.fn() };
  const canApprove = signal(true);

  async function render() {
    TestBed.configureTestingModule({
      providers: [
        { provide: HrApi, useValue: { departments, saveDepartment, deleteDepartment, saveRole, deleteRole } },
        { provide: Approvals, useValue: { canApprove } },
        { provide: HrAccess, useValue: { has: () => true, canDecide: () => canApprove() } },
        { provide: NotifyService, useValue: notify },
        { provide: MatDialog, useValue: { open } },
      ],
    });
    const fixture = TestBed.createComponent(DepartmentsPage);
    await fixture.whenStable();
    fixture.detectChanges();
    return { el: fixture.nativeElement as HTMLElement, page: fixture.componentInstance as unknown as Record<string, any> };
  }

  beforeEach(() => {
    departments.mockReset().mockReturnValue(of([general, accounts, empty]));
    saveDepartment.mockReset().mockReturnValue(of(accounts));
    deleteDepartment.mockReset().mockReturnValue(of(undefined));
    saveRole.mockReset().mockReturnValue(of({}));
    deleteRole.mockReset().mockReturnValue(of(undefined));
    open.mockReset();
    notify.info.mockReset();
    canApprove.set(true);
  });

  it('lists the departments and how many are in each, General kept', async () => {
    const { el } = await render();

    const groups = [...el.querySelectorAll('tbody.department')];
    expect(groups.map((g) => [...g.querySelectorAll('tr')].map((r) => [...r.querySelectorAll('td.role-cell, td:nth-child(3)')].map(text)))).toEqual([
      [['No role yet', '1']],
      [['No role yet', '3']],
      [['No roles yet', '0']],
    ]);
    expect(text(groups[0].querySelector('td.name .muted')!)).toBe('Where new employees start · always there');
    expect(text(groups[1].querySelector('td.name')!)).toContain('4 with those who left');
    expect(groups[0].querySelector('button[aria-label^="Delete"]')).toBeNull();
    expect(groups[1].querySelector('button[aria-label="Delete Key accounts"]')).not.toBeNull();
  });

  it('says what each role and each department costs, monthly salaries and daily wages apart, and its share', async () => {
    const clerk = { id: 'clerk', departmentId: 'general', name: 'Warehouse clerk', employed: 1, monthlyCost: 4_050, dailyCost: 0 };
    const checker = { id: 'checker', departmentId: 'accounts', name: 'Checker', employed: 2, monthlyCost: 10_800, dailyCost: 0 };
    const helper = { id: 'helper', departmentId: 'accounts', name: 'Helper', employed: 1, monthlyCost: 0, dailyCost: 270 };
    departments.mockReturnValue(of([
      { ...general, roles: [clerk], monthlyCost: 4_050 },
      // One in Key accounts holds no role yet.
      { ...accounts, employed: 4, roles: [checker, helper], monthlyCost: 16_800, dailyCost: 270 },
      empty,
    ]));
    const { el } = await render();
    const [, kitchenRows, management] = [...el.querySelectorAll('tbody.department')];
    const rows = [...kitchenRows.querySelectorAll('tr')];

    expect(rows.map((r) => text(r.querySelector('td.role-cell')!).replace(/editclose/g, '').trim())).toEqual(['Checker', 'Helper', 'No role yet']);
    expect(rows.map((r) => cell(r.querySelector('td.role-cell + td + td')!))).toEqual([
      '10,800.00 a month', '270.00 a day', '6,000.00 a month',
    ]);
    expect(rows[0].querySelector('td.total')!.getAttribute('rowspan')).toBe('3');
    expect(cell(rows[0].querySelector('td.total')!)).toBe('16,800.00 a month + 270.00 a day 81% of the salaries');
    expect(cell(management.querySelector('td.total')!)).toBe('—');
    expect(cell(el.querySelector('tfoot tr')!)).toBe('All departments · الإجمالي 5 20,850.00 a month + 270.00 a day');
  });

  it('adds and renames one', async () => {
    const { page } = await render();

    open.mockReturnValue({ afterClosed: () => of('Sales') });
    await page['add']();
    expect(open.mock.lastCall![0]).toBe(DepartmentDialog);
    expect(saveDepartment).toHaveBeenCalledWith(expect.any(String), 'Sales');
    expect(notify.info).toHaveBeenCalledWith('Sales added.');

    open.mockReturnValue({ afterClosed: () => of('Key accounts & Bar') });
    await page['rename'](accounts);
    expect(open.mock.lastCall![1].data).toEqual({ name: 'Key accounts' });
    expect(saveDepartment).toHaveBeenLastCalledWith('accounts', 'Key accounts & Bar');
  });

  it('lists each department’s roles, added, renamed and deleted with their holders moved', async () => {
    const checker = { id: 'checker', departmentId: 'accounts', name: 'Checker', employed: 2, monthlyCost: 10_800, dailyCost: 0 };
    const helper = { id: 'helper', departmentId: 'accounts', name: 'Helper', employed: 1, monthlyCost: 4_000, dailyCost: 0 };
    const withRoles = { ...accounts, roles: [checker, helper], monthlyCost: 14_800 };
    departments.mockReturnValue(of([empty, withRoles]));
    const { el, page } = await render();

    const [none, kitchenRows] = [...el.querySelectorAll('tbody.department')];
    expect([...kitchenRows.querySelectorAll('.role')].map((r) => text(r).replace(/editclose/g, '').trim())).toEqual(['Checker', 'Helper']);
    expect([...kitchenRows.querySelectorAll('tr')].map((r) => text(r.querySelector('td.role-cell + td')!))).toEqual(['2', '1']);
    expect(text(none.querySelector('td.role-cell')!)).toBe('No roles yet');

    open.mockReturnValue({ afterClosed: () => of('Carpenter') });
    await page['addRole'](withRoles);
    expect(open.mock.lastCall![1].data).toEqual({ title: 'Add a role to Key accounts', placeholder: 'Engineer, technician, supervisor' });
    expect(saveRole).toHaveBeenCalledWith('accounts', expect.any(String), 'Carpenter');

    open.mockReturnValue({ afterClosed: () => of('Head checker') });
    await page['renameRole'](withRoles, checker);
    expect(saveRole).toHaveBeenLastCalledWith('accounts', 'checker', 'Head checker');
    expect(notify.info).toHaveBeenLastCalledWith('Renamed Head checker, for whoever holds it.');

    open.mockReturnValue({ afterClosed: () => of({ moveTo: 'checker' }) });
    await page['removeRole'](withRoles, helper);
    expect(open.mock.lastCall![0]).toBe(DeleteRoleDialog);
    expect(open.mock.lastCall![1].data).toEqual({ role: helper, department: 'Key accounts', others: [checker] });
    expect(deleteRole).toHaveBeenCalledWith('helper', 'checker');
    expect(notify.info).toHaveBeenLastCalledWith('The Helper role deleted: they are Checker now.');
  });

  it('deletes one, moving its employees to another first', async () => {
    const { page } = await render();

    open.mockReturnValue({ afterClosed: () => of({ moveTo: 'general' }) });
    await page['remove'](accounts);
    expect(open.mock.lastCall![0]).toBe(DeleteDepartmentDialog);
    expect(open.mock.lastCall![1].data).toEqual({ department: accounts, others: [general, empty] });
    expect(deleteDepartment).toHaveBeenCalledWith('accounts', 'general');
    expect(notify.info).toHaveBeenCalledWith('Key accounts deleted: its employees are in General now.');

    open.mockReturnValue({ afterClosed: () => of({ moveTo: null }) });
    await page['remove'](empty);
    expect(deleteDepartment).toHaveBeenLastCalledWith('empty', null);
  });

  it('asks where the employees go before deleting one that has any', async () => {
    async function dialog(department: Department) {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [{ provide: MAT_DIALOG_DATA, useValue: { department, others: [general] } }] });
      const fixture = TestBed.createComponent(DeleteDepartmentDialog);
      await fixture.whenStable();
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    }

    const full = await dialog(accounts);
    expect(text(full.querySelector('mat-dialog-content p')!)).toBe('Its 4 employees move to another department first, those who left too.');
    expect((full.querySelector('mat-dialog-actions button:last-child') as HTMLButtonElement).disabled).toBe(true);
    const none = await dialog(empty);
    expect(text(none.querySelector('mat-dialog-content p')!)).toBe('Nobody is in it.');
    expect((none.querySelector('mat-dialog-actions button:last-child') as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows an accountant the departments, with nothing to change', async () => {
    canApprove.set(false);
    const { el } = await render();

    expect(el.querySelectorAll('button').length).toBe(0);
  });
});
