import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

// Settings → POS Integration (/api/settings/pos-integration), a manager's: the key the POS sends in
// X-API-Key (made here, shown once, kept only as its hash), and the log of every call the POS made.

export type PosSyncOutcome = 'Recorded' | 'Updated' | 'Unchanged' | 'Refused' | 'Unauthorized' | 'Failed' | 'Served';

export interface PosSyncLog {
  id: string;
  atUtc: string;
  endpoint: string;
  outcome: PosSyncOutcome;
  message: string;
  zReportId: string | null;
  businessDate: string | null;
  detail: string | null;
}

export interface PosIntegration {
  hasKey: boolean;
  keyHint: string | null;
  keyCreatedAtUtc: string | null;
  keyCreatedBy: string | null;
  logs: PosSyncLog[];
}

// The key in full, this once.
export interface PosKey {
  key: string;
  keyHint: string;
  createdAtUtc: string;
  createdBy: string;
}

@Injectable({ providedIn: 'root' })
export class PosIntegrationApi {
  private readonly http = inject(HttpClient);

  get(logs = 200): Observable<PosIntegration> {
    return this.http.get<PosIntegration>('/api/settings/pos-integration', { params: { logs } });
  }

  newKey(): Observable<PosKey> {
    return this.http.post<PosKey>('/api/settings/pos-integration/key', {});
  }
}
