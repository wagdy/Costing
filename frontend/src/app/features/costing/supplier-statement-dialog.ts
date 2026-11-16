import { DatePipe } from '@angular/common';
import { Component, effect, inject, signal, untracked } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogTitle } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import { CostingApi, SupplierAccount, SupplierAccountEntryKind, SupplierAccountLine } from '../../core/costing/costing.api';
import { errorMessage } from '../../core/http/error-message';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { NotifyService } from '../../core/ui/notify.service';
import { saveBlob } from '../../core/ui/save-blob';
import { InfoTip } from './info-tip';
import { showInvoice } from './invoice-view-dialog';
import { PeriodBar, periodDays } from './period-bar';

export interface SupplierStatementData {
  supplierId: string;
  supplier: string;
}

export const accountKindLabels: Record<SupplierAccountEntryKind, { en: string; ar: string; icon: string }> = {
  OpeningBalance: { en: 'Owed before', ar: 'رصيد سابق', icon: 'history' },
  CreditInvoice: { en: 'Credit invoice', ar: 'فاتورة آجل', icon: 'receipt_long' },
  CashInvoice: { en: 'Cash invoice', ar: 'فاتورة نقدي', icon: 'payments' },
  Payment: { en: 'Payment', ar: 'سداد', icon: 'outbound' },
};

// A supplier's account over a period (كشف حساب مورد تفصيلي): what was owed coming in, each credit
// and cash invoice and each payment with the running balance owed, and what is owed going out. An
// invoice opens over it; a payment shows its voucher's details in place. From Suppliers, Supplier
// debts and the AP aging alike.
@Component({
  selector: 'app-supplier-statement-dialog',
  imports: [
    DatePipe,
    InfoTip,
    MatButtonModule,
    MatDialogActions,
    MatDialogClose,
    MatDialogContent,
    MatDialogTitle,
    MatIconModule,
    MatProgressBarModule,
    MatTooltipModule,
    MoneyPipe,
    PeriodBar,
  ],
  template: `
    <h2 mat-dialog-title>{{ data.supplier }} · Statement of account <span class="inline-ar">كشف حساب مورد</span></h2>
    <mat-dialog-content>
      <div class="toolbar">
        <app-period-bar [(from)]="from" [(to)]="to" />
        <span class="spacer"></span>
        <button mat-stroked-button (click)="download()" [disabled]="!account()"><mat-icon>download</mat-icon> Export statement · Excel</button>
      </div>
      @if (loading()) {
        <mat-progress-bar mode="indeterminate" />
      }
      @if (error()) {
        <p class="error">{{ error() }}</p>
      } @else if (account(); as a) {
        <div class="tiles">
          <div class="tile">
            <span class="label">Opening balance owed · رصيد أول المدة <app-info-tip tip="stOpening" /></span>
            <strong>{{ a.openingBalance | money }}</strong>
          </div>
          @if (a.owedBefore) {
            <div class="tile">
              <span class="label">+ Owed before the treasury · رصيد سابق</span>
              <strong>{{ a.owedBefore | money }}</strong>
            </div>
          }
          <div class="tile">
            <span class="label">+ Credit invoices · فواتير آجل</span>
            <strong>{{ a.creditInvoices | money }}</strong>
          </div>
          <div class="tile">
            <span class="label">Cash invoices · فواتير نقدي</span>
            <strong>{{ a.cashInvoices | money }}</strong>
            <small class="chip">paid at once</small>
          </div>
          <div class="tile">
            <span class="label">− Payments made · مسدد للمورد</span>
            <strong>{{ a.payments | money }}</strong>
          </div>
          <div class="tile key">
            <span class="label">Closing balance owed · الرصيد المستحق حالياً <app-info-tip tip="stClosing" /></span>
            <strong>{{ a.closingBalance | money }}</strong>
            <small class="chip">pays in {{ a.paymentTermsDays }} {{ a.paymentTermsDays === 1 ? 'day' : 'days' }}</small>
          </div>
        </div>

        <div class="table-wrap">
          <table class="grid statement">
            <thead>
              <tr>
                <th>Date<span class="ar">التاريخ</span></th>
                <th>Document<span class="ar">المستند</span></th>
                <th>Description<span class="ar">البيان</span></th>
                <th class="num">Paid (−)<span class="ar">مسدد</span></th>
                <th class="num">Owed (+)<span class="ar">مستحق</span></th>
                <th class="num">Balance owed<span class="ar">الرصيد التراكمي</span></th>
              </tr>
            </thead>
            <tbody>
              <tr class="carried">
                <td class="nowrap">{{ a.from | date: 'd MMM y' }}</td>
                <td colspan="4">Opening balance · رصيد أول المدة</td>
                <td class="num strong">{{ a.openingBalance | money }}</td>
              </tr>
              @for (l of a.lines; track l.id + l.kind) {
                <tr [class.reversal]="l.isReversal">
                  <td class="nowrap">{{ l.date | date: 'd MMM y' }}</td>
                  <td>
                    <button mat-button class="doc" (click)="open(l)" [matTooltip]="l.kind === 'Payment' ? 'Show the voucher · تفاصيل السند' : 'Open the invoice · فتح الفاتورة'"
                      [disabled]="l.kind === 'OpeningBalance'">
                      <mat-icon>{{ labels[l.kind].icon }}</mat-icon> {{ labels[l.kind].en }} · {{ l.reference }}
                    </button>
                  </td>
                  <td>{{ l.description }}</td>
                  <td class="num">{{ l.paid ? (l.paid | money) : '' }}</td>
                  <td class="num">{{ l.owed ? (l.owed | money) : '' }}</td>
                  <td class="num strong">{{ l.balance | money }}</td>
                </tr>
                @if (expanded() === l.id) {
                  <tr class="voucher">
                    <td></td>
                    <td colspan="5">
                      Recorded by {{ l.recordedBy ?? '—' }}{{ l.approvedBy ? ', approved by ' + l.approvedBy : '' }}
                      {{ l.fromTakingsOf ? '· from the takings of ' + (l.fromTakingsOf | date: 'd MMM y') : '· from the safe' }}
                      {{ l.notes ? '· ' + l.notes : '' }}
                    </td>
                  </tr>
                }
              } @empty {
                <tr><td colspan="6" class="muted">Nothing on {{ a.supplier }}'s account in these days.</td></tr>
              }
            </tbody>
            <tfoot>
              <tr>
                <td colspan="3">Closing balance · الرصيد المستحق</td>
                <td class="num">{{ a.payments + a.cashInvoices | money }}</td>
                <td class="num">{{ a.owedBefore + a.creditInvoices + a.cashInvoices | money }}</td>
                <td class="num">{{ a.closingBalance | money }}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Close</button>
    </mat-dialog-actions>
  `,
  styleUrl: './costing.scss',
  styles: `
    .tiles {
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    }
    .chip {
      justify-self: start;
      padding: 0 8px;
      border-radius: 999px;
      font: var(--mat-sys-label-small);
      background: var(--mat-sys-surface-container-high);
    }
    .doc {
      margin-inline-start: -12px;
    }
    tr.carried td,
    tfoot td {
      font-weight: 600;
    }
    tr.reversal td {
      color: var(--mat-sys-on-surface-variant);
      text-decoration: line-through;
    }
    tr.voucher td {
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
      background: var(--mat-sys-surface-container-low);
    }
  `,
})
export class SupplierStatementDialog {
  protected readonly data = inject<SupplierStatementData>(MAT_DIALOG_DATA);
  private readonly api = inject(CostingApi);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotifyService);
  protected readonly labels = accountKindLabels;

  // This year to today unless another period is chosen.
  protected readonly from = signal(periodDays('year').from);
  protected readonly to = signal(periodDays('year').to);
  protected readonly account = signal<SupplierAccount | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly expanded = signal<string | null>(null);

  constructor() {
    effect(() => {
      const [from, to] = [this.from(), this.to()];
      untracked(() => void this.load(from, to));
    });
  }

  // An invoice opens over the statement; a payment shows its voucher's details under its line.
  protected open(line: SupplierAccountLine): void {
    if (line.kind === 'Payment') {
      this.expanded.set(this.expanded() === line.id ? null : line.id);
    } else if (line.kind !== 'OpeningBalance') {
      showInvoice(this.dialog, line.sourceId);
    }
  }

  protected async download(): Promise<void> {
    try {
      saveBlob(
        await firstValueFrom(this.api.supplierAccountSheet(this.data.supplierId, this.from(), this.to())),
        `statement-${this.data.supplier}-${this.from()}-to-${this.to()}.xlsx`,
      );
    } catch (error) {
      this.notify.error(error, 'The statement could not be downloaded.');
    }
  }

  private async load(from: string, to: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.account.set(await firstValueFrom(this.api.supplierAccount(this.data.supplierId, from, to)));
    } catch (error) {
      this.error.set(errorMessage(error, 'The statement could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }
}

// Opens a supplier's statement of account over whatever screen it is asked from.
export function showSupplierStatement(dialog: MatDialog, supplierId: string, supplier: string): void {
  dialog.open<SupplierStatementDialog, SupplierStatementData>(SupplierStatementDialog, {
    data: { supplierId, supplier },
    width: '1100px',
    maxWidth: '96vw',
    autoFocus: 'dialog',
  });
}
