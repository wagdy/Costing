import { DatePipe, formatDate } from '@angular/common';
import { Component, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule, NgModel } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { Permissions } from '../../core/auth/permissions';
import { errorMessage } from '../../core/http/error-message';
import { PeriodLock, PeriodLockApi, SecurityAuditEntry, lockConfirmationWord, maxUnlockReason, minUnlockReason } from '../../core/settings/period-lock';
import { NotifyService } from '../../core/ui/notify.service';
import { SubNav } from '../shared/sub-nav';
import { settingsTabs } from './settings-tabs';

// A day as the API takes it, moved by whole days.
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// A day as the toasts say it: 31 Oct 2026.
function day(iso: string | null): string {
  return iso ? formatDate(iso, 'd MMM y', 'en-US') : '';
}

// Settings → Period lock & month-end close (إقفال الفترة المحاسبية وتجميد الدفاتر), a manager's.
// Where the books stand, said plainly; a new period closed by typing LOCK; a closed period opened
// again by the owner alone, with the reason kept; and the security audit log of every change under
// it. Once closed, nothing dated on or before the day is entered, changed or voided anywhere: the
// API refuses it (423 Locked) with the day and the lock.
@Component({
  selector: 'app-period-lock-page',
  imports: [
    DatePipe,
    FormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatTooltipModule,
    SubNav,
  ],
  template: `
    <header class="head">
      <h1>Period lock <span class="inline-ar">إقفال الدفاتر</span></h1>
    </header>
    <app-sub-nav label="Settings" [tabs]="tabs" />

    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    @if (error(); as message) {
      <p class="error" role="alert">{{ message }}</p>
    }

    @if (state(); as s) {
      <section class="panel" [class.is-locked]="!!s.lockedUntil" aria-labelledby="lock-title">
        <h2 id="lock-title">
          <mat-icon>lock_clock</mat-icon>
          Period Lock &amp; Month-End Close <span class="inline-ar">إقفال الفترة المحاسبية</span>
        </h2>

        <div class="status" role="status">
          @if (s.lockedUntil) {
            <mat-icon>lock</mat-icon>
            <div>
              <strong>All books are locked up to {{ s.lockedUntil | date: 'MMMM d, y' }}.</strong> No changes allowed before this date.
              <span class="ar" lang="ar" dir="rtl">جميع الدفاتر مقفلة حتى {{ s.lockedUntil | date: 'd MMM y' }}، ولا يُسمح بأي تعديل قبل هذا التاريخ.</span>
            </div>
          } @else {
            <mat-icon>lock_open</mat-icon>
            <div>
              <strong>No period is locked.</strong> Every day can still be entered, changed and voided.
              <span class="ar" lang="ar" dir="rtl">لا توجد فترة مقفلة: يمكن تعديل أي يوم.</span>
            </div>
          }
        </div>

        <p class="holds">
          A locked day keeps its purchases and invoice voids, sales and the POS's Z reports, end of day, safe vouchers, waste, stock counts,
          production, fixed assets, payroll and the month's expenses exactly as they are: nothing dated on or before it is added, changed or voided.
          <span class="ar" lang="ar" dir="rtl">اليوم المقفل لا تُضاف إليه ولا تُعدل ولا تُلغى فيه أي حركة: مشتريات، مبيعات، تقفيل يومي، خزنة، هالك، جرد، إنتاج، أصول، رواتب.</span>
        </p>

        @if (reopened(); as r) {
          <div class="reopened" role="note">
            <mat-icon>history_toggle_off</mat-icon>
            <div>
              Opened again on {{ r.entry.occurredAtUtc | date: 'd MMM y, HH:mm' }} by {{ r.entry.by }}: “{{ r.entry.reason }}”.
              Lock it again up to {{ r.previous | date: 'd MMM y' }} once the adjustment is done.
              <span class="ar" lang="ar" dir="rtl">أعد الإقفال بعد الانتهاء من التعديل.</span>
            </div>
            <button mat-stroked-button type="button" (click)="lockDate.set(r.previous)">
              <mat-icon>lock</mat-icon> Lock again until {{ r.previous | date: 'd MMM y' }}
            </button>
          </div>
        }

        <div class="actions">
          <section class="action" aria-labelledby="new-lock-title">
            <h3 id="new-lock-title"><mat-icon>lock</mat-icon> Lock a new period <span class="inline-ar">إقفال فترة جديدة</span></h3>
            <p class="muted">
              Close the books up to a month's end, at the latest {{ maxLock() | date: 'd MMM y' }}
              ({{ s.lastClosedDay && s.lastClosedDay < s.today ? 'the last end of day closed' : 'today' }}).
            </p>
            <mat-form-field subscriptSizing="dynamic">
              <mat-label>Lock the books until · إقفال حتى</mat-label>
              <input matInput type="date" [ngModel]="lockDate()" (ngModelChange)="lockDate.set($event)" [min]="minLock() ?? ''" [max]="maxLock()"
                aria-label="Lock the books until" />
            </mat-form-field>
            @if (s.suggestedUntil && s.suggestedUntil !== lockDate()) {
              <button mat-button type="button" class="suggest" (click)="lockDate.set(s.suggestedUntil)">
                <mat-icon>event</mat-icon> Month end: {{ s.suggestedUntil | date: 'd MMM y' }}
              </button>
            }
            <mat-form-field subscriptSizing="dynamic">
              <mat-label>Type {{ word }} to confirm · اكتب {{ word }} للتأكيد</mat-label>
              <input matInput [ngModel]="confirmation()" (ngModelChange)="confirmation.set($event)" autocomplete="off" spellcheck="false"
                aria-label="Type LOCK to confirm" />
            </mat-form-field>
            <button mat-flat-button class="danger" type="button" (click)="lock()" [disabled]="!canLock()">
              <mat-icon>lock</mat-icon> Lock books · إقفال الدفاتر
            </button>
          </section>

          <section class="action" aria-labelledby="unlock-title">
            <h3 id="unlock-title"><mat-icon>lock_open</mat-icon> Temporary unlock <span class="inline-ar">فتح الفترة استثنائياً</span></h3>
            @if (!mayUnlock) {
              <p class="muted">Only the owner can open a closed period again. <span class="inline-ar">فتح الفترة للمالك فقط.</span></p>
            } @else if (!s.lockedUntil) {
              <p class="muted">Nothing is locked. <span class="inline-ar">لا توجد فترة مقفلة.</span></p>
            } @else {
              <p class="muted">Roll the lock back for an adjustment, then lock it again. The reason is kept in the audit log.</p>
              <mat-checkbox [ngModel]="liftAll()" (ngModelChange)="liftAll.set($event)">Lift the lock entirely · فتح جميع الفترات</mat-checkbox>
              @if (!liftAll()) {
                <mat-form-field subscriptSizing="dynamic">
                  <mat-label>Keep the books closed until · الإبقاء مقفلاً حتى</mat-label>
                  <input matInput type="date" [ngModel]="unlockTo()" (ngModelChange)="unlockTo.set($event)" [max]="dayBefore(s.lockedUntil)"
                    aria-label="Keep the books closed until" />
                </mat-form-field>
              }
              <mat-form-field class="reason">
                <mat-label>Reason for the exceptional unlock · سبب الفتح الاستثنائي</mat-label>
                <textarea matInput rows="2" #reasonField="ngModel" [ngModel]="reason()" (ngModelChange)="reason.set($event)" [maxlength]="maxReason" required
                  aria-label="Reason for the exceptional unlock"></textarea>
                <mat-hint align="end">{{ reason().length }}/{{ maxReason }}</mat-hint>
              </mat-form-field>
              <button mat-stroked-button class="danger-outline" type="button" (click)="unlock()" [disabled]="!canUnlock()">
                <mat-icon>lock_open</mat-icon> Unlock · فتح الفترة
              </button>
            }
          </section>
        </div>
      </section>

      <section class="card" aria-labelledby="history-title">
        <h2 id="history-title"><mat-icon>history</mat-icon> Audit history <span class="inline-ar">سجل التدقيق</span></h2>
        @if (s.history.length) {
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When · التاريخ</th>
                  <th>Action · الإجراء</th>
                  <th>Locked until · مقفل حتى</th>
                  <th>By · بواسطة</th>
                  <th>Reason · السبب</th>
                </tr>
              </thead>
              <tbody>
                @for (e of s.history; track e.id) {
                  <tr [matTooltip]="e.description">
                    <td class="when">{{ e.occurredAtUtc | date: 'd MMM y, HH:mm' }}</td>
                    <td>
                      @if (e.action === 'PeriodLocked') {
                        <span class="tag bad"><mat-icon>lock</mat-icon> Locked <span class="ar">إقفال</span></span>
                      } @else {
                        <span class="tag warn"><mat-icon>lock_open</mat-icon> Unlocked <span class="ar">فتح</span></span>
                      }
                    </td>
                    <td class="change">
                      {{ e.previousValue ? (e.previousValue | date: 'd MMM y') : '—' }} → {{ e.newValue ? (e.newValue | date: 'd MMM y') : 'Open' }}
                    </td>
                    <td>{{ e.by }}</td>
                    <td class="reason-cell">{{ e.reason ?? '—' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else {
          <p class="muted">No period has been locked yet. <span class="inline-ar">لم يتم إقفال أي فترة بعد.</span></p>
        }
      </section>
    }
  `,
  styles: `
    .head h1 {
      margin: 0 0 8px;
      font: var(--mat-sys-headline-small);
    }
    h2 {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0 0 12px;
      font: var(--mat-sys-title-medium);
    }
    h3 {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 0 0 6px;
      font: var(--mat-sys-title-small);
    }
    .ar {
      display: block;
      margin-top: 2px;
      color: var(--mat-sys-on-surface-variant);
    }
    .muted {
      margin: 0 0 10px;
      color: var(--mat-sys-on-surface-variant);
    }
    .error {
      color: var(--app-danger);
    }
    .panel {
      margin: 0 0 16px;
      padding: 16px 20px;
      border-radius: 16px;
      border: 1px solid color-mix(in srgb, var(--tag-bad-fg) 35%, transparent);
      border-top: 4px solid var(--tag-bad-fg);
      background: var(--mat-sys-surface-container-lowest);
      box-shadow: var(--app-card-shadow);

      h2 {
        color: var(--tag-bad-fg);
      }
    }
    .status {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      padding: 12px 14px;
      border-radius: 12px;
      background: var(--tag-neutral-bg);
      color: var(--tag-neutral-fg);

      mat-icon {
        flex: none;
      }
    }
    .is-locked .status {
      background: var(--tag-bad-bg);
      color: var(--tag-bad-fg);
    }
    .holds {
      margin: 12px 0;
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
    }
    .reopened {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
      margin: 0 0 12px;
      padding: 10px 14px;
      border-radius: 12px;
      background: var(--tag-warn-bg);
      color: var(--tag-warn-fg);

      div {
        flex: 1 1 280px;
      }
    }
    .actions {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 16px;
    }
    .action {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 10px;
      padding: 14px 16px;
      border-radius: 12px;
      border: 1px solid var(--app-line);

      mat-form-field {
        width: 100%;
        max-width: 360px;
      }
      .reason {
        max-width: none;
      }
    }
    .suggest {
      margin-top: -6px;
    }
    .danger {
      --mdc-filled-button-container-color: var(--tag-bad-fg);
      --mat-button-filled-container-color: var(--tag-bad-fg);
      --mdc-filled-button-label-text-color: #fff;
      --mat-button-filled-label-text-color: #fff;
    }
    .danger-outline {
      --mdc-outlined-button-label-text-color: var(--tag-bad-fg);
      --mat-button-outlined-label-text-color: var(--tag-bad-fg);
    }
    .card {
      margin: 0 0 16px;
      padding: 16px 20px;
      border-radius: 16px;
      border: 1px solid var(--app-line);
      background: var(--mat-sys-surface-container-lowest);
      box-shadow: var(--app-card-shadow);
    }
    .table-wrap {
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font: var(--mat-sys-body-medium);
    }
    th,
    td {
      padding: 8px 10px;
      text-align: start;
      border-bottom: 1px solid var(--app-line);
      vertical-align: top;
    }
    th {
      font: var(--mat-sys-label-medium);
      color: var(--mat-sys-on-surface-variant);
      white-space: nowrap;
    }
    .when,
    .change {
      white-space: nowrap;
    }
    .reason-cell {
      min-width: 180px;
    }
    .tag {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 999px;
      font: var(--mat-sys-label-medium);
      white-space: nowrap;

      mat-icon {
        width: 16px;
        height: 16px;
        font-size: 16px;
      }
      .ar {
        display: inline;
        margin: 0;
        color: inherit;
      }
      &.bad {
        background: var(--tag-bad-bg);
        color: var(--tag-bad-fg);
      }
      &.warn {
        background: var(--tag-warn-bg);
        color: var(--tag-warn-fg);
      }
    }
  `,
})
export class PeriodLockPage implements OnInit {
  private readonly api = inject(PeriodLockApi);
  private readonly notify = inject(NotifyService);

  protected readonly tabs = settingsTabs;
  protected readonly word = lockConfirmationWord;
  protected readonly maxReason = maxUnlockReason;
  protected readonly mayUnlock = inject(AuthService).can(Permissions.SettingsUnlockPeriods);

  protected readonly state = signal<PeriodLock | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected readonly lockDate = signal('');
  protected readonly confirmation = signal('');
  protected readonly liftAll = signal(false);
  protected readonly unlockTo = signal('');
  protected readonly reason = signal('');
  // The reason's field, set back to untouched once an unlock is done (empty, it is not an error).
  private readonly reasonField = viewChild('reasonField', { read: NgModel });

  // The earliest a new lock may go (the day after the lock), and the latest (today, and the last
  // end of day closed).
  protected readonly minLock = computed(() => {
    const locked = this.state()?.lockedUntil;
    return locked ? addDays(locked, 1) : null;
  });
  protected readonly maxLock = computed(() => {
    const s = this.state();
    if (!s) {
      return '';
    }
    return s.lastClosedDay && s.lastClosedDay < s.today ? s.lastClosedDay : s.today;
  });

  protected readonly canLock = computed(() => {
    const day = this.lockDate();
    const min = this.minLock();
    return (
      !this.busy() && !!day && this.confirmation().trim() === lockConfirmationWord && (!min || day >= min) && day <= this.maxLock()
    );
  });

  protected readonly canUnlock = computed(() => {
    const locked = this.state()?.lockedUntil;
    const to = this.unlockTo();
    return (
      !this.busy() &&
      this.mayUnlock &&
      !!locked &&
      this.reason().trim().length >= minUnlockReason &&
      (this.liftAll() || (!!to && to < locked))
    );
  });

  // Opened again since it was closed, and not closed again: the day it was, to close it again.
  protected readonly reopened = computed((): { entry: SecurityAuditEntry; previous: string } | null => {
    const s = this.state();
    const latest = s?.history[0];
    if (!s || latest?.action !== 'PeriodUnlocked' || !latest.previousValue) {
      return null;
    }
    return !s.lockedUntil || latest.previousValue > s.lockedUntil ? { entry: latest, previous: latest.previousValue } : null;
  });

  ngOnInit(): void {
    void this.load();
  }

  protected dayBefore(iso: string): string {
    return addDays(iso, -1);
  }

  protected async lock(): Promise<void> {
    if (!this.canLock()) {
      return;
    }
    this.busy.set(true);
    try {
      const saved = await firstValueFrom(this.api.lock(this.lockDate(), this.confirmation().trim()));
      this.show(saved);
      this.notify.info(`The books are locked until ${day(saved.lockedUntil)}. · تم إقفال الدفاتر.`);
    } catch (error) {
      this.notify.error(error, 'The books could not be locked.');
    } finally {
      this.busy.set(false);
    }
  }

  protected async unlock(): Promise<void> {
    if (!this.canUnlock()) {
      return;
    }
    this.busy.set(true);
    try {
      const saved = await firstValueFrom(this.api.unlock(this.liftAll() ? null : this.unlockTo(), this.reason().trim()));
      this.show(saved);
      this.notify.info(
        saved.lockedUntil
          ? `The books are now closed until ${day(saved.lockedUntil)}. · تم فتح الفترة استثنائياً.`
          : 'The lock is lifted: every day is open. · تم فتح جميع الفترات.',
      );
    } catch (error) {
      this.notify.error(error, 'The period could not be opened.');
    } finally {
      this.busy.set(false);
    }
  }

  private show(saved: PeriodLock): void {
    this.state.set(saved);
    this.confirmation.set('');
    this.reason.set('');
    this.reasonField()?.reset('');
    this.liftAll.set(false);
    this.lockDate.set(saved.suggestedUntil ?? '');
    this.unlockTo.set(saved.lockedUntil ? addDays(saved.lockedUntil, -1) : '');
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.show(await firstValueFrom(this.api.get()));
    } catch (error) {
      this.error.set(errorMessage(error, 'The period lock could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }
}
