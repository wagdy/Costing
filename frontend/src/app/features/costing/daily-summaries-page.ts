import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { CostingApi } from '../../core/costing/costing.api';
import { EndOfDay, EndOfDayApi, EndOfDaySequence, endOfDayStatusLabels } from '../../core/costing/end-of-day.api';
import { errorMessage } from '../../core/http/error-message';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { NotifyService } from '../../core/ui/notify.service';
import { Approvals } from './approvals';
import { EndOfDayUndo } from './end-of-day-undo';

// Daily summaries (ملخصات تقفيل الأيام) on Reports: every end of day handed in over a period, latest
// first, with what it took, paid out and posted. Days are closed in exact order; a manager corrects
// the last one closed by undoing it here (إلغاء وفتح اليوم), which reverses its takings, the POS's
// sales of the day, the purchase invoices posted from it and its payments, and opens it as a draft
// to hand in again. Never a day in the books locked: a manager locks them here too.
@Component({
  selector: 'app-daily-summaries-page',
  imports: [DatePipe, FormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressBarModule, MoneyPipe, RouterLink],
  template: `
    <header class="head">
      <h2>Daily summaries <span class="inline-ar">ملخصات تقفيل الأيام</span></h2>
      <p class="note">
        Each day's end of day as it was handed in. Days are closed in exact order, one after the last closed day; to correct one, a manager undoes the
        last closed day and it is handed in again.
        <span class="note-ar" lang="ar" dir="rtl">تُقفل الأيام بالترتيب؛ لتصحيح يوم يلغي المدير تقفيل آخر يوم ثم يُعاد إرساله.</span>
      </p>
    </header>

    @if (sequence(); as s) {
      <section class="sequence" aria-label="Sequence">
        <div class="fact">
          <span class="label">Last closed <span class="inline-ar">آخر يوم مُقفل</span></span>
          <strong>{{ s.lastClosedDate ? (s.lastClosedDate | date: 'EEE d MMM y') : 'None yet' }}</strong>
        </div>
        <div class="fact">
          <span class="label">Next to close <span class="inline-ar">اليوم التالي</span></span>
          <strong>
            @if (s.allClosed) {
              All closed up to today
            } @else {
              {{ s.nextExpectedDate ? (s.nextExpectedDate | date: 'EEE d MMM y') : 'Any day up to today' }}
            }
          </strong>
          @if (!s.allClosed) {
            <a mat-button routerLink="/costing/end-of-day"><mat-icon>event_available</mat-icon> Close it · تقفيل</a>
          }
        </div>
        <div class="fact">
          <span class="label">Books locked until <span class="inline-ar">الدفاتر مقفلة حتى</span></span>
          <strong>{{ s.booksLockedUntil ? (s.booksLockedUntil | date: 'd MMM y') : 'Not locked' }}</strong>
          @if (canDecide() && s.lastClosedDate) {
            <div class="lock">
              <mat-form-field subscriptSizing="dynamic">
                <mat-label>Lock until · إقفال حتى</mat-label>
                <input matInput type="date" [(ngModel)]="lockUntil" [max]="s.lastClosedDate" aria-label="Lock the books until" />
              </mat-form-field>
              <button mat-stroked-button (click)="lock(lockUntil)" [disabled]="busy() || !lockUntil || lockUntil === s.booksLockedUntil">
                <mat-icon>lock</mat-icon> Lock
              </button>
              @if (s.booksLockedUntil) {
                <button mat-button (click)="lock(null)" [disabled]="busy()"><mat-icon>lock_open</mat-icon> Unlock</button>
              }
            </div>
          }
        </div>
      </section>
    }

    <div class="toolbar">
      <mat-form-field subscriptSizing="dynamic">
        <mat-label>From · من</mat-label>
        <input matInput type="date" [ngModel]="from()" (ngModelChange)="setFrom($event)" [max]="to()" aria-label="From" />
      </mat-form-field>
      <mat-form-field subscriptSizing="dynamic">
        <mat-label>To · إلى</mat-label>
        <input matInput type="date" [ngModel]="to()" (ngModelChange)="setTo($event)" [min]="from()" aria-label="To" />
      </mat-form-field>
    </div>

    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    @if (error(); as e) {
      <p class="error">{{ e }}</p>
    } @else {
      <div class="table-wrap">
        <table class="grid days">
          <thead>
            <tr>
              <th>Date<span class="ar">التاريخ</span></th>
              <th>Status<span class="ar">الحالة</span></th>
              <th class="num">Revenue<span class="ar">الإيراد</span></th>
              <th class="num">Cash invoices<span class="ar">نقدي</span></th>
              <th class="num">Credit<span class="ar">آجل</span></th>
              <th class="num">Paid out<span class="ar">المدفوعات والسلف</span></th>
              <th class="num">Into the safe<span class="ar">المتوقع للخزنة</span></th>
              <th class="num">Takings in<span class="ar">التوريد</span></th>
              <th class="num">Posted<span class="ar">المرحّل</span></th>
              <th>Action<span class="ar">إجراء</span></th>
            </tr>
          </thead>
          <tbody>
            @for (d of days(); track d.id) {
              <tr [class.last]="d.date === sequence()?.lastClosedDate">
                <td class="nowrap">
                  <a [routerLink]="['/costing/end-of-day']" [queryParams]="{ date: d.date }">{{ d.date | date: 'EEE d MMM y' }}</a>
                  @if (d.date === sequence()?.lastClosedDate) {
                    <div class="small muted">Last closed · آخر يوم مُقفل</div>
                  }
                </td>
                <td>
                  <span class="tag" [class.ok]="d.status === 'Submitted'" [class.warn]="d.status === 'Draft'">
                    {{ statusLabels[d.status].en }}<span class="ar">{{ statusLabels[d.status].ar }}</span>
                  </span>
                  @if (d.status === 'Submitted') {
                    <div class="small muted">by {{ d.submittedBy }}, {{ d.submittedAtUtc | date: 'd MMM, HH:mm' }}</div>
                  } @else if (d.reopenedBy) {
                    <div class="small muted">undone by {{ d.reopenedBy }}{{ d.reopenReason ? ': ' + d.reopenReason : '' }}</div>
                  }
                </td>
                <td class="num">{{ d.totalRevenue | money }}</td>
                <td class="num">{{ d.cashInvoices }} · {{ d.cashInvoicesTotal | money }}</td>
                <td class="num">{{ d.creditInvoices }} · {{ d.creditInvoicesTotal | money }}</td>
                <td class="num">{{ d.supplierPaymentsTotal + d.advancesTotal | money }}</td>
                <td class="num">{{ d.expectedIntoSafe | money }}</td>
                <td class="num">{{ d.takingsEntered === null ? '—' : (d.takingsEntered | money) }}</td>
                <td class="num">{{ d.posted }} / {{ d.invoices.length }}</td>
                <td class="action">
                  @if (undoable(d)) {
                    <button mat-stroked-button class="undo" (click)="undo()" [disabled]="busy()">
                      <mat-icon>undo</mat-icon> Undo &amp; Reopen Day · إلغاء وفتح اليوم
                    </button>
                  } @else if (d.date === sequence()?.lastClosedDate && sequence()?.lastClosed?.locked) {
                    <span class="small muted"><mat-icon inline>lock</mat-icon> In the books locked</span>
                  }
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="10" class="muted">No day handed in over these dates.</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      @if (!canDecide()) {
        <p class="muted small">A manager undoes the last closed day to correct it.</p>
      }
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .head h2 {
      margin: 0 0 4px;
      font: var(--mat-sys-headline-small);
    }
    .sequence {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 8px;
      margin: 8px 0 16px;
    }
    .fact {
      display: grid;
      align-content: start;
      gap: 4px;
      padding: 12px 14px;
      border: 1px solid var(--app-line);
      border-radius: 14px;
      background: var(--mat-sys-surface-container-lowest);

      .label {
        font: var(--mat-sys-label-medium);
        color: var(--mat-sys-on-surface-variant);
      }
      strong {
        font: var(--mat-sys-title-medium);
      }
      a {
        justify-self: start;
      }
    }
    .lock {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      margin-top: 4px;
    }
    .nowrap {
      white-space: nowrap;
    }
    .small {
      font-size: 0.85em;
    }
    tr.last td {
      background: color-mix(in srgb, var(--mat-sys-primary) 5%, transparent);
    }
    .action {
      white-space: nowrap;
    }
    button.undo {
      color: var(--mat-sys-error);
      border-color: color-mix(in srgb, var(--mat-sys-error) 50%, transparent);
    }
  `,
})
export class DailySummariesPage {
  private readonly api = inject(EndOfDayApi);
  private readonly costing = inject(CostingApi);
  private readonly notify = inject(NotifyService);
  private readonly undoer = inject(EndOfDayUndo);
  private readonly approvals = inject(Approvals);
  protected readonly statusLabels = endOfDayStatusLabels;

  protected readonly sequence = signal<EndOfDaySequence | null>(null);
  protected readonly days = signal<EndOfDay[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly from = signal('');
  protected readonly to = signal('');
  protected readonly canDecide = computed(() => this.approvals.canApprove());
  protected lockUntil = '';

  constructor() {
    void this.start();
  }

  // Only the last closed day, by a manager, outside the books locked.
  protected undoable(day: EndOfDay): boolean {
    const s = this.sequence();
    return this.canDecide() && day.status === 'Submitted' && !!s?.lastClosed && day.date === s.lastClosedDate && !s.lastClosed.locked;
  }

  protected async undo(): Promise<void> {
    const preview = this.sequence()?.lastClosed;
    if (!preview) {
      return;
    }
    this.busy.set(true);
    try {
      if (await this.undoer.undo(preview)) {
        await this.load();
      }
    } finally {
      this.busy.set(false);
    }
  }

  protected async lock(until: string | null): Promise<void> {
    this.busy.set(true);
    try {
      const saved = await firstValueFrom(this.costing.lockBooks(until || null));
      this.notify.info(saved.booksLockedUntil ? `The books are locked until ${saved.booksLockedUntil}. · تم إقفال الدفاتر.` : 'The books are unlocked. · تم فتح الدفاتر.');
      await this.load();
    } catch (error) {
      this.notify.error(error, 'The books could not be locked.');
    } finally {
      this.busy.set(false);
    }
  }

  protected setFrom(day: string): void {
    if (day) {
      this.from.set(day);
      void this.load();
    }
  }

  protected setTo(day: string): void {
    if (day) {
      this.to.set(day);
      void this.load();
    }
  }

  private async start(): Promise<void> {
    try {
      const s = await firstValueFrom(this.api.sequence());
      this.sequence.set(s);
      this.lockUntil = s.booksLockedUntil ?? s.lastClosedDate ?? '';
      this.to.set(s.today);
      this.from.set(addDays(s.today, -30));
    } catch (error) {
      this.error.set(errorMessage(error, 'The days could not be loaded.'));
      this.loading.set(false);
      return;
    }
    await this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [sequence, days] = await Promise.all([firstValueFrom(this.api.sequence()), firstValueFrom(this.api.days(this.from(), this.to()))]);
      this.sequence.set(sequence);
      this.days.set(days);
      // Never past the last closed day: one undone since is open again.
      if (!this.lockUntil || (sequence.lastClosedDate && this.lockUntil > sequence.lastClosedDate)) {
        this.lockUntil = sequence.booksLockedUntil ?? sequence.lastClosedDate ?? '';
      }
    } catch (error) {
      this.error.set(errorMessage(error, 'The days could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
