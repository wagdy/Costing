import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { MenuSalesApi } from '../../core/costing/menu-sales.api';
import { Employee } from '../../core/costing/staff';
import { NotifyService } from '../../core/ui/notify.service';
import { Treasury } from './financials';
import { StaffPage } from './staff-page';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

describe('the staff', () => {
  const staff = vi.fn();
  const saveStaff = vi.fn();
  const enter = vi.fn();
  const notify = { info: vi.fn(), error: vi.fn() };
  const hassan: Employee = { id: 'hassan', name: 'Hassan', jobTitle: 'Chef', isActive: true };
  const gone: Employee = { id: 'gone', name: 'Adel', jobTitle: null, isActive: false };
  const mona: Employee = { id: 'mona', name: 'Mona', jobTitle: 'Cashier', isActive: true };

  async function render(canChange = true) {
    TestBed.configureTestingModule({
      providers: [
        { provide: MenuSalesApi, useValue: { staff, saveStaff } },
        { provide: AuthService, useValue: { me: () => null, can: () => canChange } },
        { provide: Treasury, useValue: { enter } },
        { provide: NotifyService, useValue: notify },
      ],
    });
    const fixture = TestBed.createComponent(StaffPage);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const names = () => {
      fixture.detectChanges();
      return [...el.querySelectorAll('tbody tr')].map((r) => r.querySelector<HTMLInputElement>('input.inline')?.value ?? text(r.querySelector('td')!));
    };
    return { fixture, el, names, page: fixture.componentInstance as unknown as Record<string, any> };
  }

  beforeEach(() => {
    staff.mockReset().mockReturnValue(of([gone, mona, hassan]));
    saveStaff.mockReset();
    enter.mockReset().mockResolvedValue(true);
    notify.info.mockReset();
  });

  it('lists who is working first, by name, and whoever has left after them', async () => {
    const { el, names } = await render();

    expect(names()).toEqual(['Hassan', 'Mona', 'Adel']);
    expect(el.querySelector('tbody tr:last-child')!.classList).toContain('left');
    expect([...el.querySelectorAll('mat-slide-toggle')].map(text)).toEqual(['Working · يعمل', 'Working · يعمل', 'Left · ترك العمل']);
  });

  it('adds someone, renames them, and marks one who left, kept for the entries that name them', async () => {
    saveStaff.mockImplementation((id: string, name: string, jobTitle: string | null, isActive: boolean) => of({ id, name, jobTitle, isActive }));
    const { page } = await render();

    Object.assign(page, { name: ' Samir ', job: ' ' });
    await page['add']();
    expect(saveStaff).toHaveBeenLastCalledWith(expect.any(String), 'Samir', null, true);
    expect(notify.info).toHaveBeenCalledWith('Samir added.');
    expect([page['name'], page['job']]).toEqual(['', '']);

    // Unchanged, nothing is saved.
    await page['rename'](hassan, ' Hassan ');
    expect(saveStaff).toHaveBeenCalledTimes(1);
    await page['rename'](hassan, 'Hassan Ali');
    expect(saveStaff).toHaveBeenLastCalledWith('hassan', 'Hassan Ali', 'Chef', true);
    await page['setActive'](mona, false);
    expect(saveStaff).toHaveBeenLastCalledWith('mona', 'Mona', 'Cashier', false);
    expect(page['sorted']().map((e: Employee) => e.name)).toEqual(['Hassan Ali', 'Adel', 'Mona']);
  });

  it('pays a salary to anyone on the list, who has left or not, from the safe', async () => {
    const { el } = await render(false);

    const pay = [...el.querySelectorAll<HTMLButtonElement>('tbody td.num button')];
    expect(pay.map(text)).toEqual(['payments Pay salary صرف راتب', 'payments Pay salary صرف راتب', 'payments Pay salary صرف راتب']);
    pay[2].click();
    expect(enter).toHaveBeenCalledWith('SalaryPayment', { employeeId: 'gone' });
    // Who may not change the list sees it as it is.
    expect(el.querySelector('form.add')).toBeNull();
    expect(el.querySelectorAll('input.inline')).toHaveLength(0);
  });
});
