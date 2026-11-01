import { DatePipe } from '@angular/common';
import { Component, ElementRef, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';
import {
  ApprovalAction,
  ApprovalModule,
  ApprovalRequest,
  ApprovalsApi,
  actionLabels,
  moduleLabels,
} from '../../core/approvals/approvals.api';
import { errorMessage } from '../../core/http/error-message';
import { NotifyService } from '../../core/ui/notify.service';
import { ApprovalChanges } from './approval-changes';
import { Approvals, approvalEffect } from './approvals';

type Deciding = { id: string; decision: 'approve' | 'reject' };

// Pending approvals (طلبات معلقة): every request from an accountant, oldest first: a new or
// changed employee (leaving and coming back too), an advance, an asset or a custody voucher.
// Each shows what it asks, line by line, for a manager to approve (it is done) or reject (nothing
// changes). The last decisions are kept below, as the history of who asked and who decided.
@Component({
  selector: 'app-approvals-page',
  imports: [
    ApprovalChanges,
    DatePipe,
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
  ],
  template: `
    <header class="head">
      <h1>Approvals <span class="inline-ar">الموافقات</span></h1>
    </header>
    <p class="note">
      <span class="note-ar" lang="ar" dir="rtl">طلبات من المحاسبين: موظفون جدد أو معدَّلون، وسلف، وأصول، وأذونات عهدة. لا يتغير شيء حتى تقرر: يبقى السجل كما هو ولا يمكن تعديله، ولا يُنشأ شيء جديد.</span>
      Requests from accountants: new or changed employees, advances, assets and custody vouchers. Until you decide, nothing changes: the
      record stays as it is and cannot be changed, and nothing new is made.
    </p>
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    } @else if (error()) {
      <p class="error">{{ error() }}</p>
    } @else {
      <div class="table-wrap">
        <table class="grid">
          <thead>
            <tr>
              <th>Module<span class="ar">القسم</span></th>
              <th>Request<span class="ar">الطلب</span></th>
              <th>Record<span class="ar">السجل</span></th>
              <th>Requested by<span class="ar">مقدم الطلب</span></th>
              <th>Date<span class="ar">التاريخ</span></th>
              <th class="num"><span class="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (r of pending(); track r.id) {
              <tr class="pending">
                <td class="nowrap">{{ labels[r.module].en }}<span class="ar">{{ labels[r.module].ar }}</span></td>
                <td class="nowrap">
                  <span class="action" [class]="r.action">{{ actions[r.action].en }}<span class="ar">{{ actions[r.action].ar }}</span></span>
                </td>
                <td>
                  {{ r.summary }}
                  @if (r.reason) {
                    <div class="muted small">Reason: {{ r.reason }}</div>
                  }
                  @if (r.changes.length) {
                    <app-approval-changes [changes]="r.changes" />
                  }
                </td>
                <td class="nowrap">{{ r.requestedBy }}</td>
                <td class="nowrap">{{ r.requestedAtUtc | date: 'd MMM y, HH:mm' }}</td>
                <td class="num actions">
                  <button mat-flat-button class="approve" (click)="ask(r, 'approve')" [disabled]="saving() || !!deciding()">
                    <mat-icon>check</mat-icon> Approve
                  </button>
                  <button mat-stroked-button (click)="ask(r, 'reject')" [disabled]="saving() || !!deciding()">
                    <mat-icon>close</mat-icon> Reject
                  </button>
                </td>
              </tr>
              @if (deciding()?.id === r.id) {
                <tr class="confirm-row">
                  <td colspan="6">
                    <div class="confirm">
                      @if (deciding()!.decision === 'approve') {
                        <span>{{ question(r) }} {{ effect(r.module, r.action) }}</span>
                      } @else {
                        <span>Reject: {{ r.action === 'Create' ? 'nothing is made.' : 'it stays as it is.' }}</span>
                        <mat-form-field subscriptSizing="dynamic" class="note-field">
                          <mat-label>Note for {{ r.requestedBy }} · ملاحظة</mat-label>
                          <input matInput #noteInput [(ngModel)]="note" maxlength="500" (keydown.enter)="decide(r)" />
                        </mat-form-field>
                      }
                      <span class="spacer"></span>
                      <button mat-button (click)="cancel()" [disabled]="saving()">Cancel</button>
                      <button mat-flat-button (click)="decide(r)" [disabled]="saving()">
                        {{ deciding()!.decision === 'approve' ? approveLabel(r) : 'Reject' }}
                      </button>
                    </div>
                  </td>
                </tr>
              }
            } @empty {
              <tr><td colspan="6" class="muted">Nothing waiting for approval.</td></tr>
            }
          </tbody>
        </table>
      </div>

      @if (decided().length) {
        <h3>Recent decisions <span class="inline-ar">القرارات الأخيرة</span></h3>
        <div class="table-wrap">
          <table class="grid">
            <thead>
              <tr>
                <th>Module<span class="ar">القسم</span></th>
                <th>Record<span class="ar">السجل</span></th>
                <th>Requested by<span class="ar">مقدم الطلب</span></th>
                <th>Decision<span class="ar">القرار</span></th>
              </tr>
            </thead>
            <tbody>
              @for (r of decided(); track r.id) {
                <tr>
                  <td class="nowrap">{{ labels[r.module].en }}</td>
                  <td>
                    {{ r.summary }}
                    @if (r.reason) {
                      <div class="muted small">Reason: {{ r.reason }}</div>
                    }
                    @if (r.changes.length) {
                      <app-approval-changes [changes]="r.changes" />
                    }
                  </td>
                  <td class="nowrap">{{ r.requestedBy }}<div class="muted small">{{ r.requestedAtUtc | date: 'd MMM y, HH:mm' }}</div></td>
                  <td>
                    <span class="status" [class.approved]="r.status === 'Approved'" [class.rejected]="r.status === 'Rejected'">{{ outcome(r) }}</span>
                    by {{ r.decidedBy }}, {{ r.decidedAtUtc | date: 'd MMM y, HH:mm' }}
                    @if (r.decisionNote) {
                      <div class="muted small">{{ r.decisionNote }}</div>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    }
  `,
  styleUrl: '../shared/pages.scss',
  styles: `
    .head h1 {
      margin: 0 0 8px;
      font: var(--mat-sys-headline-small);
    }
    h3 {
      margin: 20px 0 8px;
      font: var(--mat-sys-title-medium);
    }
    tr.pending td {
      background: color-mix(in srgb, var(--app-warn) 8%, var(--mat-sys-surface));
    }
    .actions {
      white-space: nowrap;

      button + button {
        margin-left: 6px;
      }
    }
    .approve {
      --mat-button-filled-container-color: var(--app-ok);
    }
    .nowrap {
      white-space: nowrap;
    }
    .small {
      font-size: 0.85em;
    }
    tr.confirm-row td {
      background: var(--mat-sys-surface-container-high);
      color: var(--mat-sys-on-surface);
    }
    .confirm {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
    .note-field {
      min-width: 260px;
    }
    .spacer {
      flex: 1;
    }
    .status {
      padding: 1px 8px;
      border-radius: 999px;
      font: var(--mat-sys-label-small);

      &.approved {
        background: color-mix(in srgb, var(--mat-sys-error) 14%, transparent);
      }
      &.rejected {
        background: var(--mat-sys-surface-container-high);
      }
    }
    .action {
      padding: 1px 8px;
      border-radius: 999px;
      font: var(--mat-sys-label-small);
      background: var(--mat-sys-surface-container-high);

      &.Create {
        background: color-mix(in srgb, var(--app-ok) 18%, transparent);
      }
      &.Update {
        background: var(--mat-sys-secondary-container);
        color: var(--mat-sys-on-secondary-container);
      }
      .ar {
        display: inline;
        margin-left: 4px;
      }
    }
    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
    }
  `,
})
export class ApprovalsPage {
  private readonly api = inject(ApprovalsApi);
  private readonly notify = inject(NotifyService);
  private readonly approvals = inject(Approvals);

  protected readonly labels = moduleLabels;
  protected readonly actions = actionLabels;
  protected readonly effect = approvalEffect;
  protected readonly pending = signal<ApprovalRequest[]>([]);
  protected readonly decided = signal<ApprovalRequest[]>([]);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly deciding = signal<Deciding | null>(null);
  protected note = '';
  private readonly noteInput = viewChild<ElementRef<HTMLInputElement>>('noteInput');

  constructor() {
    void this.load();
    // Rejecting opens the note, ready to type in.
    effect(() => this.noteInput()?.nativeElement.focus());
  }

  protected ask(request: ApprovalRequest, decision: Deciding['decision']): void {
    this.note = '';
    this.deciding.set({ id: request.id, decision });
  }

  protected cancel(): void {
    this.deciding.set(null);
  }

  // "Approve it?", "Approve the change?"
  protected question(request: ApprovalRequest): string {
    return request.action === 'Create' ? 'Approve it?' : 'Approve the change?';
  }

  protected approveLabel(request: ApprovalRequest): string {
    return request.action === 'Create' ? 'Approve and add' : 'Approve the change';
  }

  // What was decided, as the history says it.
  protected outcome(request: ApprovalRequest): string {
    return request.status === 'Rejected' ? 'Rejected' : ApprovalsPage.done(request.module, request.action);
  }

  private static done(module: ApprovalModule, action: ApprovalAction): string {
    if (module === 'Advance') {
      return 'Recorded';
    }
    return action === 'Create' ? 'Added' : 'Changed';
  }

  protected async decide(request: ApprovalRequest): Promise<void> {
    const decision = this.deciding()?.decision;
    if (!decision || this.saving()) {
      return;
    }
    this.saving.set(true);
    try {
      if (decision === 'approve') {
        await firstValueFrom(this.api.approve(request.id));
        this.notify.info(`Approved: it is ${ApprovalsPage.done(request.module, request.action).toLowerCase()}.`);
      } else {
        await firstValueFrom(this.api.reject(request.id, this.note.trim() || null));
        this.notify.info(
          request.action === 'Create'
            ? `Rejected: nothing is made.`
            : `Rejected: it stays as it is, and ${request.requestedBy} can change it again.`,
        );
      }
      this.cancel();
      await this.load();
    } catch (error) {
      this.notify.error(error, 'The request could not be decided.');
    } finally {
      this.saving.set(false);
    }
  }

  private async load(): Promise<void> {
    try {
      const requests = await firstValueFrom(this.api.requests(30));
      this.pending.set(requests.pending);
      this.decided.set(requests.decided);
      // The tab's count and the other screens' marks follow.
      this.approvals.pending.set(requests.pending);
    } catch (error) {
      this.error.set(errorMessage(error, 'The approvals could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }
}
