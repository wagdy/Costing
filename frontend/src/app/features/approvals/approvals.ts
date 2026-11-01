import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApprovalAction, ApprovalModule, ApprovalRequest, ApprovalResult, ApprovalsApi } from '../../core/approvals/approvals.api';
import { AuthService } from '../../core/auth/auth.service';
import { Permissions } from '../../core/auth/permissions';
import { NotifyService } from '../../core/ui/notify.service';

// What approving a new or changed record does, for the manager deciding it.
export function approvalEffect(module: ApprovalModule, action: ApprovalAction): string {
  switch (module) {
    case 'Employee':
      return action === 'Create'
        ? 'The employee is added to the payroll: their days are counted from the day they start.'
        : 'The change is saved: a new salary or work schedule counts in every month not yet finalized.';
    case 'Advance':
      return 'The advance is recorded: it comes off their pay for its month.';
    default:
      return action === 'Create'
        ? 'It is recorded as asked: the asset added, or the custody voucher entered.'
        : 'The change is saved, as asked.';
  }
}

// "Waiting for approval", "Change requested": a pending request's mark on its row.
export function pendingLabel(request: ApprovalRequest): { en: string; ar: string } {
  return request.action === 'Create'
    ? { en: 'Waiting for approval', ar: 'بانتظار الموافقة' }
    : { en: 'Change requested', ar: 'طلب تعديل' };
}

// Maker-checker for the HR and custody screens: what waits for a manager (to mark those rows and
// lock them, and to list the new ones not made yet), and the word that a save went to a manager.
@Injectable({ providedIn: 'root' })
export class Approvals {
  private readonly api = inject(ApprovalsApi);
  private readonly auth = inject(AuthService);
  private readonly notify = inject(NotifyService);

  readonly pending = signal<ApprovalRequest[]>([]);
  readonly canApprove = computed(() => this.auth.can(Permissions.ApprovalDecide));
  private readonly byRecord = computed(() => new Map(this.pending().map((r) => [r.recordId, r])));

  // The request waiting for this record, whatever it asks, if one is: it is locked meanwhile.
  pendingFor(recordId: string): ApprovalRequest | undefined {
    return this.byRecord().get(recordId);
  }

  // The new ones of a module waiting to be made: employees and advances that do not exist yet.
  waitingToBeMade(module: ApprovalModule): ApprovalRequest[] {
    return this.pending().filter((r) => r.module === module && r.action === 'Create');
  }

  // Says that a save went to a manager rather than being made, and marks it.
  async requested(result: ApprovalResult): Promise<void> {
    this.notify.info(
      result.request.action === 'Create'
        ? 'Submitted to the manager for approval. Nothing is made until it is approved.'
        : 'Change submitted to the manager for approval. It stays as it was until then.',
    );
    await this.refresh();
  }

  // For a user of the system who changes HR. An employee working their tabs in the portal cannot
  // read the requests: their rows are not marked, and the API still refuses a locked record.
  async refresh(): Promise<void> {
    if (!this.auth.isSignedIn() || !this.auth.can(Permissions.HrManage)) {
      return;
    }
    try {
      this.pending.set((await firstValueFrom(this.api.requests())).pending);
    } catch {
      // The screens still work; their rows are simply not marked until the next refresh.
    }
  }
}
