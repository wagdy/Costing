import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { PortalAuth } from '../portal/portal-auth';
import { AuthService } from './auth.service';
import { Permission } from './permissions';

// Where a user lands: HR & Payroll, which sends whoever holds none of its tabs on to Custody &
// Assets, or to their own account (HrAccess.outside).
export const homePath = '/hr';

// Signed in, as /api/auth/me confirmed at start-up or sign-in.
export const signedInGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isSignedIn() ? true : inject(Router).createUrlTree(['/sign-in']);
};

// The sign-in: one already signed in goes on, a user to the system and an employee to their
// portal.
export const signedOutGuard: CanActivateFn = () => {
  const router = inject(Router);
  if (inject(AuthService).isSignedIn()) {
    return router.createUrlTree([homePath]);
  }
  return inject(PortalAuth).isSignedIn() ? router.createUrlTree(['/my-profile']) : true;
};

// A section only some roles have: its link is hidden from the rest, and this keeps a typed
// address from opening it. The API refuses the data either way.
export const permissionGuard =
  (permission: Permission): CanActivateFn =>
  () =>
    inject(AuthService).can(permission) ? true : inject(Router).createUrlTree([homePath]);
