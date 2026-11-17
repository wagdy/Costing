import { DatePipe } from '@angular/common';
import { Component, Injectable, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { firstValueFrom } from 'rxjs';
import { EndOfDayApi, EndOfDayUndone, EndOfDayUndoPreview } from '../../core/costing/end-of-day.api';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { NotifyService } from '../../core/ui/notify.service';

// The manager's undo of the last closed day (إلغاء وفتح اليوم), asked as a danger: what it reverses
// (its takings in the safe, the POS's sales of the day or those entered by hand, the purchase
// invoices posted from it, its payments in the safe) and why, kept on the day. Only the last closed
// day: the days before it stay as they are.
@Component({
  selector: 'app-end-of-day-undo-dialog',
  imports: [DatePipe, FormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule, MoneyPipe],
  template: `
    @let p = data;
    <h2 mat-dialog-title class="danger-title">
      <mat-icon>warning</mat-icon> Undo &amp; reopen {{ p.date | date: 'EEE d MMM y' }}? <span class="inline-ar">إلغاء وفتح اليوم</span>
    </h2>
    <mat-dialog-content>
      <p class="danger-text" role="alert">
        <strong>Are you sure?</strong> This will reverse the cash taking and POS integration for this day so it can be recorded again correctly.
        <span class="line-ar" lang="ar" dir="rtl">هل أنت متأكد؟ سيتم عكس توريد النقدية وربط نقاط البيع لهذا اليوم ليُسجَّل من جديد بشكل صحيح.</span>
      </p>
      <ul class="reverses" aria-label="What is reversed">
        <li>
          <mat-icon>savings</mat-icon>
          <span>Takings in the safe <span class="inline-ar">توريد الإيراد</span></span>
          <strong>{{ p.takings === null ? 'None entered' : (p.takings | money) + ' voided' }}</strong>
        </li>
        <li>
          <mat-icon>point_of_sale</mat-icon>
          <span>Sales summary{{ p.zReports ? ', from the POS' : '' }} <span class="inline-ar">ملخص المبيعات</span></span>
          <strong>{{ p.salesItems ? p.salesItems + (p.salesItems === 1 ? ' item' : ' items') + ' voided, stock put back' : 'None' }}</strong>
        </li>
        <li>
          <mat-icon>receipt_long</mat-icon>
          <span>Purchase invoices posted from it <span class="inline-ar">الفواتير المرحلة</span></span>
          <strong>{{ p.postedInvoices ? p.postedInvoices + ' · ' + (p.postedInvoicesTotal | money) + ' voided, to post again' : 'None' }}</strong>
        </li>
        <li>
          <mat-icon>payments</mat-icon>
          <span>Payments &amp; advances in the safe <span class="inline-ar">المدفوعات والسلف</span></span>
          <strong>{{ p.payouts ? p.payouts + ' · ' + (p.payoutsTotal | money) + ' voided' : 'None' }}</strong>
        </li>
      </ul>
      <p class="muted small">
        It becomes a draft again, to correct and submit; any payment still waiting for a manager is refused.
        @if (p.zReports) {
          The POS’s {{ p.zReports === 1 ? 'Z report is' : p.zReports + ' Z reports are' }} recorded again when the POS sends {{ p.zReports === 1 ? 'it' : 'them' }} again.
        }
        Only the last closed day is undone: the days before it stay as they are.
      </p>
      <mat-form-field class="full" subscriptSizing="dynamic">
        <mat-label>Why · السبب</mat-label>
        <textarea matInput rows="2" maxlength="500" [(ngModel)]="reason" aria-label="Why it is undone"></textarea>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button [mat-dialog-close]="null">Cancel · إلغاء</button>
      <button mat-flat-button class="danger" (click)="done()"><mat-icon>undo</mat-icon> Undo &amp; reopen day · إلغاء وفتح اليوم</button>
    </mat-dialog-actions>
  `,
  styleUrl: './costing.scss',
  styles: `
    .danger-title {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--mat-sys-error);
    }
    .danger-text {
      margin: 0 0 12px;
      padding: 10px 12px;
      border-radius: 10px;
      background: color-mix(in srgb, var(--mat-sys-error) 10%, transparent);
      color: var(--mat-sys-on-surface);

      .line-ar {
        display: block;
        margin-top: 4px;
      }
    }
    .reverses {
      display: grid;
      gap: 6px;
      margin: 0 0 12px;
      padding: 0;
      list-style: none;

      li {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: center;
        gap: 10px;
        padding: 8px 10px;
        border: 1px solid var(--app-line);
        border-radius: 10px;
      }
      mat-icon {
        color: var(--mat-sys-on-surface-variant);
      }
      strong {
        font-variant-numeric: tabular-nums;
        text-align: end;
      }
    }
    .full {
      width: 100%;
    }
    .small {
      font-size: 0.85em;
    }
    button.danger {
      --mat-button-filled-container-color: var(--mat-sys-error);
      --mat-button-filled-label-text-color: var(--mat-sys-on-error);
    }
  `,
})
export class EndOfDayUndoDialog {
  protected readonly data = inject<EndOfDayUndoPreview>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<EndOfDayUndoDialog, { reason: string | null }>>(MatDialogRef);
  protected reason = '';

  protected done(): void {
    this.ref.close({ reason: this.reason.trim() || null });
  }
}

// Asked, then undone: the answer, or null when it was not (cancelled, or refused: said here).
@Injectable({ providedIn: 'root' })
export class EndOfDayUndo {
  private readonly dialog = inject(MatDialog);
  private readonly api = inject(EndOfDayApi);
  private readonly notify = inject(NotifyService);

  async undo(preview: EndOfDayUndoPreview): Promise<EndOfDayUndone | null> {
    const asked = await firstValueFrom(
      this.dialog
        .open<EndOfDayUndoDialog, EndOfDayUndoPreview, { reason: string | null }>(EndOfDayUndoDialog, { data: preview, width: '560px', maxWidth: '96vw' })
        .afterClosed(),
    );
    if (!asked) {
      return null;
    }
    try {
      const undone = await firstValueFrom(this.api.voidLast(preview.date, asked.reason));
      this.notify.info(`${undoneSummary(undone)} · تم إلغاء تقفيل اليوم وإعادة فتحه.`);
      return undone;
    } catch (error) {
      this.notify.error(error, 'The day could not be undone.');
      return null;
    }
  }
}

// What an undo reversed, said in a line.
export function undoneSummary(u: EndOfDayUndone): string {
  const done = [
    u.takingsVoided ? 'takings voided' : null,
    u.salesVoided ? 'sales summary voided' : null,
    u.invoicesVoided ? `${u.invoicesVoided} purchase ${u.invoicesVoided === 1 ? 'invoice' : 'invoices'} voided` : null,
    u.payoutsVoided ? `${u.payoutsVoided} ${u.payoutsVoided === 1 ? 'payment' : 'payments'} voided` : null,
    u.requestsRefused ? `${u.requestsRefused} ${u.requestsRefused === 1 ? 'request' : 'requests'} refused` : null,
  ].filter(Boolean);
  return `Reopened ${u.day.date}${done.length ? `: ${done.join(', ')}` : ''}.`;
}
