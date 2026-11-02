import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Me } from '../../core/api/models';
import { AuthService } from '../../core/auth/auth.service';
import { Permission, Permissions } from '../../core/auth/permissions';
import { ConnectivityService } from '../../core/connectivity/connectivity.service';
import { managerMe, accountantMe } from '../../../testing/fixtures';
import { Approvals } from '../costing/approvals';
import { Shell } from './shell';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

describe('the top bar', () => {
  const signOut = vi.fn();
  const refresh = vi.fn();

  let detect: () => void;

  async function render(me: Me, online = true, waiting = 0): Promise<HTMLElement> {
    const can = (permission: Permission) => me.permissions.includes(permission);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { isSignedIn: () => true, me: signal(me), can, canAny: (permissions: readonly Permission[]) => permissions.some(can), signOut } },
        { provide: ConnectivityService, useValue: { online: signal(online) } },
        {
          provide: Approvals,
          useValue: { pending: signal(Array.from({ length: waiting }, (_, i) => ({ id: `q${i}` }))), refresh, canApprove: () => can(Permissions.ApprovalDecide) },
        },
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
    signOut.mockReset();
    refresh.mockReset();
  });

  it('gives a manager Costing & Financials, the users and the settings, with what waits for them counted', async () => {
    const el = await render(managerMe, true, 2);

    expect(nav(el)).toEqual(['Costing & Financials', 'Users', 'Settings']);
    expect(text(el.querySelector('nav .count')!)).toBe('2');
    expect(text(el.querySelector('.user-name')!)).toBe('Omar');
    expect(refresh).toHaveBeenCalled();
    expect(el.querySelector('.banner')).toBeNull();
  });

  // The users and the company's settings are a manager's; what waits is counted for whoever decides it.
  it('gives an accountant Costing & Financials alone, and no count to decide', async () => {
    const el = await render(accountantMe, true, 2);

    expect(nav(el)).toEqual(['Costing & Financials']);
    expect(el.querySelector('nav .count')).toBeNull();
  });

  it('says when the server cannot be reached', async () => {
    const el = await render(managerMe, false);

    expect(text(el.querySelector('.banner')!)).toContain('The server cannot be reached.');
    expect(text(el.querySelector('.links')!)).toContain('Reconnecting…');
  });

  it('signs out from the user’s menu, which names their role', async () => {
    const el = await render(accountantMe);

    (el.querySelector('button.user') as HTMLButtonElement).click();
    detect();
    expect(text(document.querySelector('.who')!)).toBe('MonaAccountant · mona@example.com');
    const out = [...document.querySelectorAll<HTMLButtonElement>('button[mat-menu-item]')].find((b) => text(b).includes('Sign out'))!;
    out.click();
    await new Promise((resolve) => setTimeout(resolve));

    expect(signOut).toHaveBeenCalled();
  });
});
