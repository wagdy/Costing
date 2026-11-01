import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Me } from '../../core/api/models';
import { AuthService } from '../../core/auth/auth.service';
import { Permission } from '../../core/auth/permissions';
import { ConnectivityService } from '../../core/connectivity/connectivity.service';
import { HrHubService } from '../../core/realtime/hr-hub.service';
import { managerMe, accountantMe } from '../../../testing/fixtures';
import { Approvals } from '../approvals/approvals';
import { Shell } from './shell';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

describe('the top bar', () => {
  const start = vi.fn().mockResolvedValue(undefined);
  const stop = vi.fn().mockResolvedValue(undefined);
  const signOut = vi.fn();

  let detect: () => void;

  async function render(me: Me, online = true, waiting = 0): Promise<HTMLElement> {
    const can = (permission: Permission) => me.permissions.includes(permission);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { employeeActing: () => false, isSignedIn: () => true, me: signal(me), can, canAny: (permissions: readonly Permission[]) => permissions.some(can), signOut } },
        { provide: ConnectivityService, useValue: { online: signal(online) } },
        { provide: HrHubService, useValue: { start, stop } },
        { provide: Approvals, useValue: { pending: signal(Array.from({ length: waiting }, (_, i) => ({ id: `q${i}` }))), refresh: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(Shell);
    detect = () => fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const nav = (el: HTMLElement) => [...el.querySelectorAll('nav a')].map((a) => a.getAttribute('aria-label'));

  beforeEach(() => {
    start.mockClear();
    stop.mockClear();
    signOut.mockReset();
  });

  it('gives a manager every section, with what waits for them counted', async () => {
    const el = await render(managerMe, true, 2);

    expect(nav(el)).toEqual(['HR & Payroll', 'Custody & Assets', 'Approvals', 'Users', 'Settings']);
    expect(text(el.querySelector('nav .count')!)).toBe('2');
    expect(text(el.querySelector('.user-name')!)).toBe('Omar');
    expect(start).toHaveBeenCalled();
    expect(el.querySelector('.banner')).toBeNull();
  });

  // An accountant works the tabs a manager ticked for them; approvals and users are a manager's.
  it('gives an accountant the tabs they hold, and none of a manager’s', async () => {
    const el = await render({ ...accountantMe, hrTabs: ['Employees', 'Attendance'] });

    expect(nav(el)).toEqual(['HR & Payroll']);
  });

  it('says when the server cannot be reached', async () => {
    const el = await render(managerMe, false);

    expect(text(el.querySelector('.banner')!)).toContain('The server cannot be reached.');
    expect(text(el.querySelector('.links')!)).toContain('Reconnecting…');
  });

  it('closes the live connection, then signs out', async () => {
    const el = await render(managerMe);

    (el.querySelector('button.user') as HTMLButtonElement).click();
    detect();
    const out = [...document.querySelectorAll<HTMLButtonElement>('button[mat-menu-item]')].find((b) => text(b).includes('Sign out'))!;
    out.click();
    await new Promise((resolve) => setTimeout(resolve));

    expect(stop).toHaveBeenCalled();
    expect(signOut).toHaveBeenCalled();
  });
});
