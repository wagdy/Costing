import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApprovalOutcome, ApprovalRequest, SafeTransaction } from './costing.api';
import { Employee } from './staff';

// The staff as the HR link leaves them, for the screens that choose one; the payrolls HR approved
// and sent, each paid out of the safe; and the deductions charged to an employee (a till shortage,
// a staff charge), sent to HR as deductions from their pay while it is linked.

export interface HrStatus {
  linked: boolean;
  employeesSyncedAtUtc: string | null;
}

export type PayrollRunStatus = 'Payable' | 'Disbursed';

export interface PayrollRunDepartment {
  name: string;
  employees: number;
  grossWages: number;
  additions: number;
  penalties: number;
  advancesDeducted: number;
  netCashPayable: number;
  laborCost: number;
}

export interface PayrollRun {
  id: string;
  period: string;
  employees: number;
  totalGrossWages: number;
  totalAdditions: number;
  totalPenalties: number;
  totalAdvancesDeducted: number;
  totalBroughtForward: number;
  netCashPayable: number;
  laborCost: number;
  status: PayrollRunStatus;
  revision: number;
  receivedAtUtc: string;
  updatedAtUtc: string;
  safeTransactionId: string | null;
  disbursedAtUtc: string | null;
  disbursedBy: string | null;
  paymentRequested: boolean;
  departments: PayrollRunDepartment[];
}

export interface SafeVoucherResult {
  outcome: ApprovalOutcome;
  transaction: SafeTransaction | null;
  request: ApprovalRequest | null;
}

export type StaffDeductionKind = 'TillShortage' | 'StaffCharge';

export const deductionKindLabels: Record<StaffDeductionKind, { en: string; ar: string }> = {
  TillShortage: { en: 'Till shortage', ar: 'عجز خزنة' },
  StaffCharge: { en: 'Staff charge', ar: 'خصم على الموظف' },
};

export interface StaffDeduction {
  id: string;
  employeeId: string;
  employee: string;
  date: string;
  kind: StaffDeductionKind;
  amount: number;
  reason: string | null;
  recordedBy: string;
  recordedAtUtc: string;
  voidedAtUtc: string | null;
  voidedBy: string | null;
  fromHr: boolean;
}

@Injectable({ providedIn: 'root' })
export class HrStaffApi {
  private readonly http = inject(HttpClient);

  status(): Observable<HrStatus> {
    return this.http.get<HrStatus>('/api/staff/hr-status');
  }

  // Someone new on the staff while HR is not linked (from the end of the day): the same name again
  // is the one there is.
  addLocal(id: string, name: string, jobTitle: string | null): Observable<Employee> {
    return this.http.post<Employee>('/api/staff/local', { id, name, jobTitle });
  }

  payrollRuns(): Observable<PayrollRun[]> {
    return this.http.get<PayrollRun[]>('/api/financials/payroll-runs');
  }

  // A manager's is paid at once (outcome Applied); anyone else's is asked of a manager (Requested).
  disburse(runId: string, transactionId: string, requestId: string): Observable<SafeVoucherResult> {
    return this.http.post<SafeVoucherResult>(`/api/financials/payroll-runs/${runId}/disburse`, { transactionId, requestId });
  }

  deductions(from: string, to: string): Observable<StaffDeduction[]> {
    return this.http.get<StaffDeduction[]>('/api/staff/deductions', { params: { from, to } });
  }

  recordDeduction(d: { id: string; employeeId: string; date: string; kind: StaffDeductionKind; amount: number; reason: string | null }): Observable<StaffDeduction> {
    return this.http.post<StaffDeduction>('/api/staff/deductions', d);
  }

  voidDeduction(id: string): Observable<StaffDeduction> {
    return this.http.post<StaffDeduction>(`/api/staff/deductions/${id}/void`, {});
  }
}
