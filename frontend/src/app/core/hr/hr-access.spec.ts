import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { Permissions } from '../auth/permissions';
import { authInterceptor } from '../http/interceptors';
import { PortalAuth } from '../portal/portal-auth';
import { HrAccess, hrGiveGuard, hrGuard, hrTabGuard, portalHrMatch } from './hr-access';

// A token as the API makes them, its payload what matters here.
function jwt(payload: object): string {
  const json = new TextEncoder().encode(JSON.stringify(payload));
  const b64 = btoa(String.fromCharCode(...json)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `header.${b64}.signature`;
}

function portalSession(hrTabs: unknown): void {
  localStorage.setItem(
    'hr-payroll.portal-session',
    JSON.stringify({ token: jwt({ sub: 'hassan', name: 'حسن', role: 'Employee', hr_tabs: hrTabs }), expiresAtUtc: new Date(Date.now() + 3_600_000).toISOString(), employeeId: 'hassan', name: 'حسن' }),
  );
}

const all = ['Now', 'Analytics', 'Employees', 'Departments', 'Attendance', 'Roster', 'Corrections', 'Payroll', 'Advances', 'Holidays', 'Devices', 'Custody'];

describe('who holds which HR tab', () => {
  beforeEach(() => localStorage.clear());

  function staff(me: object | null, can: (p: string) => boolean) {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: AuthService, useValue: { employeeActing: () => false, me: signal(me), can } }],
    });
    return TestBed.inject(HrAccess);
  }

  const guard = (fn: ReturnType<typeof hrTabGuard>) =>
    TestBed.runInInjectionContext(() => fn({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot)) as true | UrlTree;
  const url = (result: true | UrlTree) => (result === true ? true : TestBed.inject(Router).serializeUrl(result));

  it('gives a manager every tab and the Permissions tab', () => {
    const access = staff({ hrTabs: all }, () => true);
    expect([...access.tabs()]).toEqual(all);
    expect(access.canGive()).toBe(true);
    expect(access.canDecide('Holidays')).toBe(true);
    expect(access.first()).toBe('now');
    expect(url(guard(hrGiveGuard))).toBe(true);
  });

  it('gives an accountant the tabs a manager ticked, and sends a typed address to the first one they hold', () => {
    const access = staff({ hrTabs: ['Payroll', 'Advances'] }, (p) => p === Permissions.HrView || p === Permissions.HrManage);
    expect([...access.tabs()]).toEqual(['Payroll', 'Advances']);
    expect(access.canGive()).toBe(false);
    // What only a manager does stays a manager's, even in an accountant's own tab.
    expect(access.canDecide('Payroll')).toBe(false);
    expect(url(guard(hrTabGuard('Payroll')))).toBe(true);
    expect(url(guard(hrTabGuard('Attendance')))).toBe('/hr/payroll');
    expect(url(guard(hrGiveGuard))).toBe('/hr/payroll');
    expect(url(guard(hrGuard))).toBe(true);
  });

  it('sends whoever holds no tab of HR to Custody when they hold it, or else to their account', () => {
    const none = staff({ hrTabs: [] }, (p) => p === Permissions.HrView || p === Permissions.HrManage);
    expect(none.any()).toBe(false);
    expect(url(guard(hrGuard))).toBe('/account');
    expect(url(guard(hrTabGuard('Now')))).toBe('/account');
    expect(url(guard(hrTabGuard('Custody')))).toBe('/account');

    TestBed.resetTestingModule();
    const custody = staff({ hrTabs: ['Custody'] }, (p) => p === Permissions.HrView || p === Permissions.HrManage);
    expect(url(guard(hrGuard))).toBe('/custody');
    expect(url(guard(hrTabGuard('Custody')))).toBe(true);
    expect(custody.first()).toBeNull();
  });

  it('reads an /me without tabs as every tab for whoever sees HR', () => {
    const older = staff({ permissions: [Permissions.HrView] }, (p) => p === Permissions.HrView);
    expect([...older.tabs()]).toEqual(all);
  });
});

describe('an employee working their HR tabs in the portal', () => {
  beforeEach(() => localStorage.clear());

  function setUp() {
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting()] });
    return { auth: TestBed.inject(AuthService), portal: TestBed.inject(PortalAuth), access: TestBed.inject(HrAccess) };
  }

  it('reads their tabs from the token, a list or one name, anything not a tab left out', () => {
    portalSession(['Attendance', 'Now', 'Key accounts']);
    expect(setUp().portal.hrTabs()).toEqual(['Now', 'Attendance']);
    TestBed.resetTestingModule();
    portalSession('Payroll');
    expect(setUp().portal.hrTabs()).toEqual(['Payroll']);
    TestBed.resetTestingModule();
    portalSession(undefined);
    expect(setUp().portal.hrTabs()).toEqual([]);
  });

  it('acts with no user signed in: their tabs, an accountant’s rights in them, a manager’s work in them alone, and nothing to give', () => {
    portalSession(['Now', 'Attendance', 'Custody']);
    const { auth, access } = setUp();
    expect(auth.employeeActing()).toBe(true);
    expect(TestBed.runInInjectionContext(() => portalHrMatch({}, []))).toBe(true);
    expect([...access.tabs()]).toEqual(['Now', 'Attendance', 'Custody']);
    expect(access.any()).toBe(true);
    expect(access.canGive()).toBe(false);
    expect([access.canDecide('Attendance'), access.canDecide('Custody'), access.canDecide('Holidays')]).toEqual([true, true, false]);
    expect(access.outside()).toBe('/my-profile');
    expect([Permissions.HrView, Permissions.HrManage, Permissions.ApprovalDecide, Permissions.UsersManage].map((p) => auth.can(p))).toEqual([
      true, true, false, false,
    ]);
  });

  it('sends their token to HR and the portal, never to the users’ API, and a 401 from HR signs them out of the portal', () => {
    portalSession(['Now']);
    const { portal } = setUp();
    const http = TestBed.inject(HttpClient);
    const backend = TestBed.inject(HttpTestingController);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const bearer = `Bearer ${portal.token()}`;

    http.get('/api/hr/attendance/now').subscribe();
    expect(backend.expectOne('/api/hr/attendance/now').request.headers.get('Authorization')).toBe(bearer);
    http.get('/api/users').subscribe();
    expect(backend.expectOne('/api/users').request.headers.has('Authorization')).toBe(false);

    http.get('/api/hr/employees').subscribe({ error: () => undefined });
    backend.expectOne('/api/hr/employees').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(portal.isSignedIn()).toBe(false);
    expect(navigate).toHaveBeenCalledWith(['/sign-in'], { queryParams: { reason: 'expired' } });
    backend.verify();
  });

  it('is not the one acting while a user is signed in here', () => {
    portalSession(['Now']);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { employeeActing: () => false, me: signal({ hrTabs: all }), can: () => true } },
      ],
    });
    expect(TestBed.runInInjectionContext(() => portalHrMatch({}, []))).toBe(false);
    expect(TestBed.inject(HrAccess).canGive()).toBe(true);
  });

  it('counts Custody alone as no tab of HR’s own: HR & Payroll is closed, Custody open', () => {
    portalSession(['Custody']);
    const { access } = setUp();
    expect(access.has('Custody')).toBe(true);
    expect(access.any()).toBe(false);
    expect(access.first()).toBeNull();
  });
});
