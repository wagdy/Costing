import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { UserRole } from '../api/models';

// Who signs in to the system (GET /api/users), a manager's to keep. isLocked: too many wrong
// passwords, for a few minutes; a new password lifts it.
export interface User {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
  createdAtUtc: string;
  lastSignInAtUtc: string | null;
  isLocked: boolean;
}

export interface NewUser {
  email: string;
  fullName: string;
  role: UserRole;
  password: string;
}

export interface UserChange {
  email: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
}

// A password is this long at least, as the API asks.
export const MinPasswordLength = 8;

export const roleLabels: Record<UserRole, { en: string; ar: string }> = {
  Manager: { en: 'Manager', ar: 'مدير' },
  Accountant: { en: 'Accountant', ar: 'محاسب' },
};

@Injectable({ providedIn: 'root' })
export class UsersApi {
  private readonly http = inject(HttpClient);

  all(): Observable<User[]> {
    return this.http.get<User[]>('/api/users');
  }

  create(user: NewUser): Observable<User> {
    return this.http.post<User>('/api/users', user);
  }

  update(id: string, change: UserChange): Observable<User> {
    return this.http.put<User>(`/api/users/${encodeURIComponent(id)}`, change);
  }

  // Signs them out wherever they are signed in, and lifts a lockout.
  resetPassword(id: string, password: string): Observable<void> {
    return this.http.put<void>(`/api/users/${encodeURIComponent(id)}/password`, { password });
  }
}
