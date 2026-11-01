import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Me, SignInResponse } from '../api/models';
import { PortalAuth } from '../portal/portal-auth';
import { Permission, Permissions } from './permissions';

const TokenKey = 'hr-payroll.token';

// Who is signed in to the system, and what they may do.
//
// The role and permissions come from GET /api/auth/me and nowhere else: not from the sign-in
// response, not from the token, not from anything stored in the browser. The stored token is
// only a candidate until the API has said whose it is, so a role changed or a user deactivated
// takes effect here the next time /me is asked.
//
// With no user signed in and an employee signed in to the portal, the employee is the one acting
// (employeeActing): in the HR tabs a manager gave them (/hr), they may do what an accountant does
// there, see HR and change it, their changes asked of a manager, and nothing else. Their token,
// not this one, then goes to /api/hr (authInterceptor).
const ActingEmployee: ReadonlySet<Permission> = new Set([Permissions.HrView, Permissions.HrManage]);

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly portal = inject(PortalAuth);

  private readonly _token = signal<string | null>(readStoredToken());
  private readonly _me = signal<Me | null>(null);
  private readonly permissions = computed(() => new Set(this._me()?.permissions ?? []));

  readonly token = this._token.asReadonly();
  readonly me = this._me.asReadonly();
  readonly isSignedIn = computed(() => this._me() !== null);
  readonly employeeActing = computed(() => this._me() === null && this.portal.isSignedIn());

  can(permission: Permission): boolean {
    return this.employeeActing() ? ActingEmployee.has(permission) : this.permissions().has(permission);
  }

  canAny(permissions: readonly Permission[]): boolean {
    return permissions.some((permission) => this.can(permission));
  }

  // At start-up: confirm a stored token with the API. A 401 means it is no good; anything else
  // (the server down) leaves it for the sign-in screen to try again.
  async restore(): Promise<void> {
    if (this._token() === null) {
      return;
    }
    try {
      await this.loadMe();
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 401) {
        this.clear();
      }
    }
  }

  async signIn(email: string, password: string): Promise<Me> {
    const response = await firstValueFrom(this.http.post<SignInResponse>('/api/auth/sign-in', { email, password }));
    this.store(response.token);
    return this.loadMe();
  }

  // Their own password changed: signed out everywhere else, and signed in again here with the
  // token the answer brings.
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const response = await firstValueFrom(this.http.post<SignInResponse>('/api/auth/password', { currentPassword, newPassword }));
    this.store(response.token);
    await this.loadMe();
  }

  // `expired` when the API has stopped accepting the token: it ran out, the password was changed
  // or reset, or the user was deactivated or given another role.
  signOut(reason?: 'expired'): void {
    this.clear();
    void this.router.navigate(['/sign-in'], { queryParams: reason ? { reason } : {} });
  }

  private async loadMe(): Promise<Me> {
    const me = await firstValueFrom(this.http.get<Me>('/api/auth/me'));
    this._me.set(me);
    return me;
  }

  private store(token: string): void {
    this._token.set(token);
    try {
      localStorage.setItem(TokenKey, token);
    } catch {
      // Private browsing or storage switched off: signed in for this tab only.
    }
  }

  private clear(): void {
    this._token.set(null);
    this._me.set(null);
    try {
      localStorage.removeItem(TokenKey);
    } catch {
      // Nothing stored to remove.
    }
  }
}

function readStoredToken(): string | null {
  try {
    return localStorage.getItem(TokenKey);
  } catch {
    return null;
  }
}
