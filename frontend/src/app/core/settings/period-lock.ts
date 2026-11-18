import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

// Period lock & month-end close (إقفال الفترة المحاسبية وتجميد الدفاتر), as the API keeps it on
// the company's settings: the books closed until a day; nothing dated on or before it is entered,
// changed or voided, the API answering 423 Locked.

export type SecurityAuditAction = 'PeriodLocked' | 'PeriodUnlocked';

// A line of the security audit log: as it reads ("PeriodLocked: 31-Oct-2026 by Wagdy"), with the
// lock's day before and after (yyyy-MM-dd) and the reason of an unlock.
export interface SecurityAuditEntry {
  id: string;
  occurredAtUtc: string;
  action: SecurityAuditAction;
  description: string;
  previousValue: string | null;
  newValue: string | null;
  reason: string | null;
  by: string;
}

// lastClosedDay: the last end of day closed, the latest a lock may go; suggestedUntil: the latest
// month's end that can be closed now; history: the lock's changes, the latest first.
export interface PeriodLock {
  lockedUntil: string | null;
  today: string;
  lastClosedDay: string | null;
  suggestedUntil: string | null;
  history: SecurityAuditEntry[];
}

// What a manager types to close the books.
export const lockConfirmationWord = 'LOCK';

// An unlock's reason: at least this long, at most 500 characters.
export const minUnlockReason = 5;
export const maxUnlockReason = 500;

@Injectable({ providedIn: 'root' })
export class PeriodLockApi {
  private readonly http = inject(HttpClient);

  get(): Observable<PeriodLock> {
    return this.http.get<PeriodLock>('/api/settings/period-lock');
  }

  lock(until: string, confirmation: string): Observable<PeriodLock> {
    return this.http.post<PeriodLock>('/api/settings/period-lock/lock', { until, confirmation });
  }

  // Back to an earlier day, or lifted (null); the owner's, with why.
  unlock(until: string | null, reason: string): Observable<PeriodLock> {
    return this.http.post<PeriodLock>('/api/settings/period-lock/unlock', { until, reason });
  }
}
