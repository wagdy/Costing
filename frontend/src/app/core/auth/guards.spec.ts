import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { AuthService } from './auth.service';
import { permissionGuard, signedInGuard, signedOutGuard } from './guards';
import { Permissions } from './permissions';

describe('the section guards', () => {
  function run(guard: () => unknown, auth: { signedIn?: boolean; can?: (p: string) => boolean }): string | boolean {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { employeeActing: () => false, me: () => null, isSignedIn: () => auth.signedIn ?? true, can: auth.can ?? (() => true) } },
      ],
    });
    const result = TestBed.runInInjectionContext(guard) as boolean | UrlTree;
    return typeof result === 'boolean' ? result : TestBed.inject(Router).serializeUrl(result);
  }

  const route = {} as ActivatedRouteSnapshot;
  const state = {} as RouterStateSnapshot;

  it('lets a manager into the approvals and the users', () => {
    expect(run(() => permissionGuard(Permissions.ApprovalDecide)(route, state), {})).toBe(true);
    TestBed.resetTestingModule();
    expect(run(() => permissionGuard(Permissions.UsersManage)(route, state), {})).toBe(true);
  });

  // An accountant who typed the address goes back to HR, which sends them on if they hold no tab.
  it('sends an accountant from a manager’s section back to HR', () => {
    const accountant = new Set<string>([Permissions.HrView, Permissions.HrManage]);
    expect(run(() => permissionGuard(Permissions.ApprovalDecide)(route, state), { can: (p) => accountant.has(p) })).toBe('/hr');
  });

  it('sends whoever is not signed in to sign in, and whoever is away from it', () => {
    expect(run(() => signedInGuard(route, state), { signedIn: false })).toBe('/sign-in');
    TestBed.resetTestingModule();
    expect(run(() => signedOutGuard(route, state), { signedIn: true })).toBe('/hr');
  });
});
