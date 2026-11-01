import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

// Maker-checker: what a manager decides. An accountant's new or changed employee (leaving and
// coming back too), an advance, and an asset or a custody voucher.
export type ApprovalModule = 'Employee' | 'Advance' | 'Custody';
export type ApprovalAction = 'Create' | 'Update';
export type ApprovalStatus = 'Pending' | 'Approved' | 'Rejected';
export type ApprovalOutcome = 'Requested' | 'Applied';

export const moduleLabels: Record<ApprovalModule, { en: string; ar: string }> = {
  Employee: { en: 'Employee', ar: 'الموظفين' },
  Advance: { en: 'Advance', ar: 'السلفيات' },
  Custody: { en: 'Custody', ar: 'العهدة' },
};

export const actionLabels: Record<ApprovalAction, { en: string; ar: string }> = {
  Create: { en: 'New', ar: 'جديد' },
  Update: { en: 'Change', ar: 'تعديل' },
};

// One line of what a request changes: "Pay: 4,000.00 a month → 4,500.00 a month". before is null
// for something new, after for something taken away.
export interface ApprovalChange {
  label: string;
  before: string | null;
  after: string | null;
}

// summary: the record as it was when asked about (for a new one, what it would be). recordId:
// the record's, or for a new one the id it is given when approved. decidedBy, decidedAtUtc and
// decisionNote are set once a manager has decided.
export interface ApprovalRequest {
  id: string;
  module: ApprovalModule;
  action: ApprovalAction;
  recordId: string;
  summary: string;
  changes: ApprovalChange[];
  reason: string | null;
  requestedBy: string;
  requestedAtUtc: string;
  status: ApprovalStatus;
  decidedBy: string | null;
  decidedAtUtc: string | null;
  decisionNote: string | null;
}

export interface ApprovalRequests {
  pending: ApprovalRequest[];
  decided: ApprovalRequest[];
}

export interface ApprovalResult {
  outcome: ApprovalOutcome;
  request: ApprovalRequest;
}

// A save answered with a request (someone who may not approve) rather than the record itself.
export function isRequested<T extends object>(result: T | ApprovalResult): result is ApprovalResult {
  return 'outcome' in result && 'request' in result;
}

@Injectable({ providedIn: 'root' })
export class ApprovalsApi {
  private readonly http = inject(HttpClient);

  // What waits for a manager; with decided, the last decisions too (a manager's).
  requests(decided = 0): Observable<ApprovalRequests> {
    return this.http.get<ApprovalRequests>('/api/approval-requests', { params: { decided } });
  }

  approve(requestId: string): Observable<ApprovalRequest> {
    return this.http.post<ApprovalRequest>(`/api/approval-requests/${requestId}/approve`, {});
  }

  reject(requestId: string, note: string | null): Observable<ApprovalRequest> {
    return this.http.post<ApprovalRequest>(`/api/approval-requests/${requestId}/reject`, { note });
  }
}
