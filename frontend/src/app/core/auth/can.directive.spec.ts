import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Me } from '../api/models';
import { accountantMe, managerMe } from '../../../testing/fixtures';
import { AuthService } from './auth.service';
import { CanDirective } from './can.directive';
import { Permissions } from './permissions';

@Component({
  imports: [CanDirective],
  template: `
    <button *appCan="P.HrManage" id="change">Change</button>
    <button *appCan="P.ApprovalDecide" id="approve">Approve</button>
    <a *appCan="P.UsersManage" id="users">Users</a>
    <span *appCan="[P.ApprovalDecide, P.UsersManage]" id="any-manager">manager</span>
  `,
})
class Screen {
  protected readonly P = Permissions;
}

describe('role-based buttons', () => {
  let auth: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  // The sign-in response is answered with a manager's rights on purpose: the app must ignore it
  // and believe only GET /api/auth/me.
  async function signInAs(me: Me): Promise<void> {
    const signedIn = auth.signIn(me.email, 'a-password');
    const signIn = http.expectOne('/api/auth/sign-in');
    expect(signIn.request.body).toEqual({ email: me.email, password: 'a-password' });
    signIn.flush({ token: 'token-' + me.id, expiresAtUtc: '2026-10-04T00:00:00Z', user: managerMe });
    await new Promise((resolve) => setTimeout(resolve));
    const meRequest = http.expectOne('/api/auth/me');
    expect(meRequest.request.headers.has('Authorization')).toBe(false); // the interceptor is not in this test bed
    meRequest.flush(me);
    await signedIn;
  }

  async function render(): Promise<HTMLElement> {
    const fixture = TestBed.createComponent(Screen);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('takes the role from /api/auth/me, never from the sign-in response', async () => {
    await signInAs(accountantMe);

    expect(auth.me()?.role).toBe('Accountant');
    expect(auth.can(Permissions.UsersManage)).toBe(false);
    expect(auth.can(Permissions.HrManage)).toBe(true);
    expect(localStorage.getItem('hr-payroll.token')).toBe('token-user-accountant');
  });

  it('shows an accountant changes, and nothing a manager decides', async () => {
    await signInAs(accountantMe);
    const screen = await render();

    expect(screen.querySelector('#change')).not.toBeNull();
    expect(screen.querySelector('#approve')).toBeNull();
    expect(screen.querySelector('#users')).toBeNull();
    expect(screen.querySelector('#any-manager')).toBeNull();
  });

  it('gives a manager everything', async () => {
    await signInAs(managerMe);
    const screen = await render();

    for (const id of ['change', 'approve', 'users', 'any-manager']) {
      expect(screen.querySelector('#' + id), id).not.toBeNull();
    }
  });

  it('keeps the new token when the password is changed, and asks who it is again', async () => {
    await signInAs(accountantMe);

    const changed = auth.changePassword('a-password', 'a-better-one');
    const request = http.expectOne('/api/auth/password');
    expect(request.request.body).toEqual({ currentPassword: 'a-password', newPassword: 'a-better-one' });
    request.flush({ token: 'token-new', expiresAtUtc: '2026-10-04T00:00:00Z', user: accountantMe });
    await new Promise((resolve) => setTimeout(resolve));
    http.expectOne('/api/auth/me').flush(accountantMe);
    await changed;

    expect(auth.token()).toBe('token-new');
    expect(localStorage.getItem('hr-payroll.token')).toBe('token-new');
  });
});
