import { DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';

// The reasons the end of day asks for before it bends its order: a day the restaurant did not trade
// (تسجيل يوم إغلاق أو صيانة), and a draft moved off the wrong date (سبب التعديل الإجباري). Both are
// required and kept on the day; each dialog gives back the reason typed, or nothing when cancelled.

export const maxAuditReason = 300;

export interface ClosedDayData {
  date: string;
}

@Component({
  selector: 'app-closed-day-dialog',
  imports: [DatePipe, FormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>Mark as a closed day? <span class="inline-ar">تسجيل كيوم مغلق</span></h2>
    <mat-dialog-content>
      <p class="muted">{{ data.date | date: 'EEEE d MMMM y' }}</p>
      <p>
        The restaurant did not trade that day: it is closed with nothing on it, so the next day can be closed.
        <span class="line-ar" lang="ar" dir="rtl">المطعم لم يعمل هذا اليوم: يُقفل بدون بيانات حتى يمكن تقفيل اليوم التالي.</span>
      </p>
      <mat-form-field class="full" subscriptSizing="dynamic">
        <mat-label>Reason · السبب</mat-label>
        <textarea matInput rows="2" [maxlength]="max" [(ngModel)]="reason" placeholder="Restaurant closed for plumbing maintenance" aria-label="Why the restaurant was closed" required></textarea>
      </mat-form-field>
      @if (missing) {
        <p class="error small" role="alert">Say why the restaurant was closed that day. · اذكر سبب الإغلاق.</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button [mat-dialog-close]="undefined">Cancel · إلغاء</button>
      <button mat-flat-button (click)="done()"><mat-icon>event_busy</mat-icon> Mark as closed · تسجيل كيوم مغلق</button>
    </mat-dialog-actions>
  `,
  styleUrl: './costing.scss',
  styles: `
    .full {
      width: 100%;
    }
    .line-ar {
      display: block;
      margin-top: 4px;
    }
    .small {
      font-size: 0.85em;
    }
  `,
})
export class ClosedDayDialog {
  protected readonly data = inject<ClosedDayData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<ClosedDayDialog, string>>(MatDialogRef);
  protected readonly max = maxAuditReason;
  protected reason = '';
  protected missing = false;

  protected done(): void {
    const reason = this.reason.trim();
    this.missing = !reason;
    if (reason) {
      this.ref.close(reason);
    }
  }
}

export interface ReassignDateData {
  from: string;
  to: string;
  invoices: number;
  payouts: number;
  hasSales: boolean;
}

@Component({
  selector: 'app-reassign-date-dialog',
  imports: [DatePipe, FormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>Move the data to {{ data.to | date: 'EEE d MMM y' }}? <span class="inline-ar">نقل البيانات وإصلاح التاريخ</span></h2>
    <mat-dialog-content>
      <p class="move" aria-label="The move">
        <span>{{ data.from | date: 'EEE d MMM y' }}</span>
        <mat-icon aria-hidden="true">arrow_forward</mat-icon>
        <strong>{{ data.to | date: 'EEE d MMM y' }}</strong>
      </p>
      <p>
        Everything on this draft moves with it: {{ what }}. The draft purchase invoices paid out of its day's takings move too.
        <span class="line-ar" lang="ar" dir="rtl">كل ما في المسودة يُنقل معها، والفواتير المسودة المدفوعة من إيراد اليوم.</span>
      </p>
      <p class="muted small">The reason is written into the day's notes, each invoice's note and its audit trail, which is never changed.</p>
      <mat-form-field class="full" subscriptSizing="dynamic">
        <mat-label>Reason for the change (required) · سبب التعديل الإجباري</mat-label>
        <textarea matInput rows="2" [maxlength]="max" [(ngModel)]="reason" placeholder="Entered under the wrong date" aria-label="Reason for the date change" required></textarea>
      </mat-form-field>
      @if (missing) {
        <p class="error small" role="alert">Give the reason for moving the day. · سبب التعديل إجباري.</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button [mat-dialog-close]="undefined">Cancel · إلغاء</button>
      <button mat-flat-button (click)="done()"><mat-icon>drive_file_move</mat-icon> Move the data · نقل البيانات</button>
    </mat-dialog-actions>
  `,
  styleUrl: './costing.scss',
  styles: `
    .move {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0 0 12px;
      padding: 10px 12px;
      border-radius: 10px;
      background: var(--mat-sys-surface-container);
      font: var(--mat-sys-title-small);
    }
    .full {
      width: 100%;
    }
    .line-ar {
      display: block;
      margin-top: 4px;
    }
    .small {
      font-size: 0.85em;
    }
  `,
})
export class ReassignDateDialog {
  protected readonly data = inject<ReassignDateData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<ReassignDateDialog, string>>(MatDialogRef);
  protected readonly max = maxAuditReason;
  protected reason = '';
  protected missing = false;
  protected readonly what =
    [
      `${this.data.invoices} ${this.data.invoices === 1 ? 'invoice' : 'invoices'}`,
      `${this.data.payouts} ${this.data.payouts === 1 ? 'payment' : 'payments'}`,
      this.data.hasSales ? 'the sales report' : null,
    ]
      .filter(Boolean)
      .join(', ') + ' and their photos';

  protected done(): void {
    const reason = this.reason.trim();
    this.missing = !reason;
    if (reason) {
      this.ref.close(reason);
    }
  }
}

export interface SalesOverrideData {
  date: string;
  shifts: string | null;
}

// A manager's Unlock / Manual override (فتح للتعديل اليدوي): the sales report synced from the POS
// opened to correct what the POS got wrong, the note why required (kept on the day's audit trail).
// Gives back the note, or nothing when cancelled.
@Component({
  selector: 'app-sales-override-dialog',
  imports: [DatePipe, FormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>Unlock the POS's figures? <span class="inline-ar">فتح أرقام نظام المبيعات للتعديل</span></h2>
    <mat-dialog-content>
      <p class="muted">{{ data.date | date: 'EEEE d MMMM y' }}{{ data.shifts ? ' · shift ' + data.shifts : '' }}</p>
      <p>
        The sales report came from the POS's Z reports and is locked so it is never typed twice. Unlock it only to correct what the POS got
        wrong: the takings go into the safe as you leave them, and the note stays on the day.
        <span class="line-ar" lang="ar" dir="rtl">الريبورت مسحوب من نظام المبيعات ومقفل لمنع الإدخال المزدوج. افتحه فقط لتصحيح خطأ، ويُحفظ السبب في سجل اليوم.</span>
      </p>
      <mat-form-field class="full" subscriptSizing="dynamic">
        <mat-label>Why · سبب التعديل</mat-label>
        <textarea matInput rows="2" [maxlength]="max" [(ngModel)]="note" placeholder="The card machine charged a guest twice" aria-label="Why the POS's figures are overridden" required></textarea>
      </mat-form-field>
      @if (missing) {
        <p class="error small" role="alert">Say why the POS's figures are overridden. · سبب التعديل إجباري.</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button [mat-dialog-close]="undefined">Cancel · إلغاء</button>
      <button mat-flat-button (click)="done()"><mat-icon>lock_open</mat-icon> Unlock · فتح للتعديل</button>
    </mat-dialog-actions>
  `,
  styleUrl: './costing.scss',
  styles: `
    .full {
      width: 100%;
    }
    .line-ar {
      display: block;
      margin-top: 4px;
    }
    .small {
      font-size: 0.85em;
    }
  `,
})
export class SalesOverrideDialog {
  protected readonly data = inject<SalesOverrideData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<SalesOverrideDialog, string>>(MatDialogRef);
  protected readonly max = maxAuditReason;
  protected note = '';
  protected missing = false;

  protected done(): void {
    const note = this.note.trim();
    this.missing = !note;
    if (note) {
      this.ref.close(note);
    }
  }
}
