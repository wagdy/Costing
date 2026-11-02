import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { Permission } from './permissions';

// Where a user lands: Costing & Financials, on the first section they work.
export const homePath = '/costing';

// Signed in, as /api/auth/me confirmed at start-up or sign-in.
export const signedInGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isSignedIn() ? true : inject(Router).createUrlTree(['/sign-in']);
};

// The sign-in: one already signed in goes on to the system.
export const signedOutGuard: CanActivateFn = () =>
  inject(AuthService).isSignedIn() ? inject(Router).createUrlTree([homePath]) : true;

// A section only some roles have: its link is hidden from the rest, and this keeps a typed
// address from opening it. The API refuses the data either way.
export const permissionGuard =
  (permission: Permission): CanActivateFn =>
  () =>
    inject(AuthService).can(permission) ? true : inject(Router).createUrlTree([homePath]);
