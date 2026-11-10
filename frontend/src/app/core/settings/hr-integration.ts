import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

// Settings → HR Integration (/api/settings/hr-integration), a manager's: the link to the HR &
// Payroll system, both ways and only while it is switched on. HR's address and HR's key (pasted
// here, kept encrypted, never shown again); this system's key for HR (made here, shown once, kept
// as its hash); the link tested; HR's employees read; the sync log and what waits to be sent.

export type HrSyncDirection = 'Inbound' | 'Outbound';
export type HrSyncOutcome = 'Read' | 'Recorded' | 'Unchanged' | 'Updated' | 'Sent' | 'Refused' | 'Failed' | 'Unauthorized';
export type HrOutboxStatus = 'Pending' | 'Sent' | 'Failed';

export interface HrSyncLog {
  id: string;
  atUtc: string;
  direction: HrSyncDirection;
  call: string;
  outcome: HrSyncOutcome;
  message: string;
  reference: string | null;
  detail: string | null;
}

export interface HrOutboxItem {
  id: string;
  kind: string;
  action: string;
  idempotencyKey: string;
  summary: string;
  status: HrOutboxStatus;
  attempts: number;
  nextAttemptAtUtc: string;
  lastError: string | null;
  createdAtUtc: string;
  sentAtUtc: string | null;
}

export interface HrIntegration {
  enabled: boolean;
  baseUrl: string | null;
  hasHrKey: boolean;
  hrKeyHint: string | null;
  hasKey: boolean;
  keyHint: string | null;
  keyCreatedAtUtc: string | null;
  keyCreatedBy: string | null;
  employeesSyncedAtUtc: string | null;
  employeesSynced: number;
  pending: number;
  failed: number;
  logs: HrSyncLog[];
  outbox: HrOutboxItem[];
}

export interface HrKey {
  key: string;
  keyHint: string;
  createdAtUtc: string;
}

export interface HrTestResult {
  ok: boolean;
  message: string;
}

export interface HrEmployeeSync {
  received: number;
  added: number;
  updated: number;
  left: number;
  atUtc: string;
}

@Injectable({ providedIn: 'root' })
export class HrIntegrationApi {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/settings/hr-integration';

  get(): Observable<HrIntegration> {
    return this.http.get<HrIntegration>(this.base);
  }

  // hrKey: HR's key when a new one is pasted; null keeps the one kept.
  save(enabled: boolean, baseUrl: string | null, hrKey: string | null): Observable<HrIntegration> {
    return this.http.put<HrIntegration>(this.base, { enabled, baseUrl, hrKey });
  }

  newKey(): Observable<HrKey> {
    return this.http.post<HrKey>(`${this.base}/key`, {});
  }

  test(): Observable<HrTestResult> {
    return this.http.post<HrTestResult>(`${this.base}/test`, {});
  }

  syncEmployees(): Observable<HrEmployeeSync> {
    return this.http.post<HrEmployeeSync>(`${this.base}/sync-employees`, {});
  }

  sendNow(): Observable<{ sent: number }> {
    return this.http.post<{ sent: number }>(`${this.base}/outbox/send`, {});
  }

  retry(itemId: string): Observable<HrOutboxItem> {
    return this.http.post<HrOutboxItem>(`${this.base}/outbox/${itemId}/retry`, {});
  }
}
