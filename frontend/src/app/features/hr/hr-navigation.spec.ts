import { TestBed } from '@angular/core/testing';
import { Route, Router, provideRouter } from '@angular/router';
import { routes } from '../../app.routes';
import { AuthService } from '../../core/auth/auth.service';
import { Permissions } from '../../core/auth/permissions';
import { Component, signal } from '@angular/core';
import { HrShell } from './hr-shell';
import { CorrectionsCount } from './corrections-count';
import { PendingLeaves } from './pending-leaves';
import { hrGuard, portalHrMatch } from '../../core/hr/hr-access';

// The route of that path, anywhere under these.
function find(list: Route[] | undefined, path: string): Route | undefined {
  for (const route of list ?? []) {
    if (route.path === path) {
      return route;
    }
    const inside = find(route.children, path);
    if (inside) {
      return inside;
    }
  }
  return undefined;
}

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

describe('the HR navigation', () => {
  it('gives HR & Payroll a section of its own, each tab guarded by its own, and the same tabs in the portal', () => {
    const shell = routes.find((r) => r.path === '' && r.children)!;
    const system = shell.children!.find((r) => r.path === 'hr')!;
    expect(system.canActivate).toEqual([hrGuard]);
    expect(system.children!.map((r) => [r.path, typeof r.redirectTo === 'function' ? 'first held' : r.loadComponent ? 'page' : undefined, r.canActivate?.length ?? 0])).toEqual([
      ['', 'first held', 0],
      ['now', 'page', 1],
      ['analytics', 'page', 1],
      ['employees', 'page', 1],
      ['employees/:employeeId', 'page', 1],
      ['departments', 'page', 1],
      ['attendance', 'page', 1],
      ['roster', 'page', 1],
      ['payroll', 'page', 1],
      ['payroll/:employeeId', 'page', 1],
      ['advances', 'page', 1],
      ['corrections', 'page', 1],
      ['leaves', 'page', 1],
      ['holidays', undefined, 0],
      ['devices', 'page', 1],
      ['permissions', 'page', 1],
    ]);
    // The portal's /hr, before the system's: only while an employee is the one signed in, around the same tabs.
    const portal = routes.find((r) => r.path === 'hr')!;
    expect(routes.indexOf(portal)).toBeLessThan(routes.indexOf(shell));
    expect(portal.canMatch).toEqual([portalHrMatch]);
    expect(portal.children![0].children).toBe(system.children);
    // Leaves & Holidays: the requests first, and the public holidays' old address kept.
    const leaves = system.children!.find((r) => r.path === 'leaves')!;
    expect(leaves.children!.map((r) => r.path)).toEqual(['', 'requests', 'balances', 'types', 'holidays']);
    expect(leaves.children![0].redirectTo).toBe('requests');
    expect(system.children!.find((r) => r.path === 'holidays')!.redirectTo).toBe('leaves/holidays');
  });

  it('gives the system Custody, a manager’s Approvals, Users and Settings, and each user their account', () => {
    const shell = routes.find((r) => r.path === '' && r.children)!;
    expect(shell.children!.map((r) => [r.path, r.canActivate?.length ?? 0])).toEqual([
      ['', 0],
      ['hr', 1],
      ['custody', 1],
      ['approvals', 1],
      ['users', 1],
      ['settings', 1],
      ['account', 0],
    ]);
    expect(shell.children!.find((r) => r.path === 'custody')!.children!.map((r) => r.path)).toEqual(['', 'categories', 'assets', 'vouchers', 'consumables']);
  });

  async function shellOf(hrTabs: string[], manager: boolean) {
    const count = signal(0);
    const refresh = vi.fn();
    const leaves = signal(0);
    const refreshLeaves = vi.fn();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: CorrectionsCount, useValue: { count, refresh } },
        { provide: PendingLeaves, useValue: { count: leaves, refresh: refreshLeaves } },
        { provide: AuthService, useValue: { employeeActing: () => false, me: signal({ hrTabs }), can: (p: string) => manager || p !== Permissions.ApprovalDecide } },
      ],
    });
    const fixture = TestBed.createComponent(HrShell);
    await fixture.whenStable();
    fixture.detectChanges();
    return { el: fixture.nativeElement as HTMLElement, fixture, count, refresh, leaves, refreshLeaves };
  }

  it('has a tab each for now, analytics, the employees, departments, attendance, corrections, payroll, advances, leaves and holidays, and devices, counting what waits, and Permissions for a manager', async () => {
    const all = ['Now', 'Analytics', 'Employees', 'Departments', 'Attendance', 'Roster', 'Corrections', 'Payroll', 'Advances', 'Holidays', 'Devices'];
    const { el, fixture, count, refresh, leaves, refreshLeaves } = await shellOf(all, true);

    expect(text(el.querySelector('h1')!)).toBe('HR & Payroll الموارد البشرية والرواتب');
    expect([...el.querySelectorAll('nav a')].map((a) => a.getAttribute('href'))).toEqual([
      '/now', '/analytics', '/employees', '/departments', '/attendance', '/roster', '/corrections', '/payroll', '/advances', '/leaves', '/devices', '/permissions',
    ]);
    // Analytics right below Now; Shift Rostering beside Attendance.
    expect(text(el.querySelectorAll('nav a .label')[1])).toBe('Analyticsالتحليلات');
    expect(text(el.querySelectorAll('nav a .label')[5])).toBe('Shift Rosteringجداول الشفتات');
    expect(text(el.querySelectorAll('nav a .label')[9])).toBe('Leaves & Holidaysالإجازات والعطلات');
    expect(text(el.querySelectorAll('nav a .label')[11])).toBe('Permissionsصلاحيات الموظفين');
    // Each with its icon.
    expect([...el.querySelectorAll('nav a mat-icon')].map(text)).toEqual([
      'how_to_reg', 'insights', 'groups', 'account_tree', 'event_available', 'calendar_view_week', 'rule', 'payments', 'request_quote', 'beach_access', 'fingerprint',
      'admin_panel_settings',
    ]);
    expect(refresh).toHaveBeenCalled();
    expect(el.querySelector('.count')).toBeNull();

    count.set(2);
    fixture.detectChanges();
    expect(el.querySelectorAll('nav a')[6].querySelector('.count')!.getAttribute('aria-label')).toBe('2 waiting');
    expect(text(el.querySelector('.count')!)).toBe('2');

    // The leave requests waiting for a manager, on Leaves & Holidays.
    expect(refreshLeaves).toHaveBeenCalled();
    leaves.set(3);
    fixture.detectChanges();
    expect(el.querySelectorAll('nav a')[9].querySelector('.count')!.getAttribute('aria-label')).toBe('3 leave requests waiting');
  });

  it('shows an accountant only the tabs a manager ticked for them, and no Permissions', async () => {
    const { el } = await shellOf(['Payroll', 'Advances'], false);
    expect([...el.querySelectorAll('nav a')].map((a) => a.getAttribute('href'))).toEqual(['/payroll', '/advances']);
  });

  // On a phone the sidebar is a drawer, opened from the bar above the page that names the tab open.
  it('opens the sections from the menu button, marks the tab open, and closes on Escape, the backdrop or a tab picked', async () => {
    @Component({ template: '' })
    class Page {}
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'payroll', component: Page }, { path: 'advances', component: Page }]),
        { provide: CorrectionsCount, useValue: { count: signal(1), refresh: vi.fn() } },
        { provide: PendingLeaves, useValue: { count: signal(0), refresh: vi.fn() } },
        { provide: AuthService, useValue: { employeeActing: () => false, me: signal({ hrTabs: ['Payroll', 'Advances', 'Corrections'] }), can: (p: string) => p !== Permissions.ApprovalDecide } },
      ],
    });
    const fixture = TestBed.createComponent(HrShell);
    const el = fixture.nativeElement as HTMLElement;
    const refresh = async () => {
      await fixture.whenStable();
      fixture.detectChanges();
    };
    await TestBed.inject(Router).navigateByUrl('/payroll');
    await refresh();
    const menu = el.querySelector<HTMLButtonElement>('.mobile-bar button')!;
    const side = el.querySelector('aside')!;

    expect(text(el.querySelector('.current')!)).toBe('Payrollمسير الرواتب');
    expect(el.querySelector('nav a.active')!.getAttribute('href')).toBe('/payroll');
    expect(el.querySelector('nav a.active')!.getAttribute('aria-current')).toBe('page');
    // Something waits in a tab: a dot on the menu button.
    expect(menu.querySelector('.dot')).not.toBeNull();
    expect([side.classList.contains('open'), menu.getAttribute('aria-expanded'), el.querySelector('.backdrop')]).toEqual([false, 'false', null]);

    menu.click();
    await refresh();
    expect([side.classList.contains('open'), menu.getAttribute('aria-expanded'), side.getAttribute('role')]).toEqual([true, 'true', 'dialog']);
    expect(document.activeElement?.getAttribute('href')).toBe('/payroll');

    side.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await refresh();
    expect(side.classList.contains('open')).toBe(false);
    expect(document.activeElement).toBe(menu);

    menu.click();
    await refresh();
    el.querySelector<HTMLElement>('.backdrop')!.click();
    await refresh();
    expect(side.classList.contains('open')).toBe(false);

    menu.click();
    await refresh();
    el.querySelector<HTMLAnchorElement>('nav a[href="/advances"]')!.click();
    await refresh();
    expect(side.classList.contains('open')).toBe(false);
    expect(text(el.querySelector('.current')!)).toBe('Advancesالسلفيات');
  });
});
