import { Component, Injectable, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { firstValueFrom } from 'rxjs';
import {
  CostingApi,
  ExpenseItem,
  FundingSource,
  InvoicePaymentStatus,
  PurchasePaymentMethod,
  SafeEntry,
  SafeTransactionKind,
  SafeVoucherInput,
  SupplierBalance,
  TakingsPreview,
  TaxPosition,
  fundingSourceLabels,
  isRequested,
  paymentMethodLabels,
  safeKindLabels,
} from '../../core/costing/costing.api';
import { AuthService } from '../../core/auth/auth.service';
import { errorMessage } from '../../core/http/error-message';
import { EmployeePicker } from '../../core/costing/employee-picker';
import { MenuSalesApi } from '../../core/costing/menu-sales.api';
import { Employee } from '../../core/costing/staff';
import { Company } from '../../core/settings/company';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { NotifyService } from '../../core/ui/notify.service';
import { Approvals } from './approvals';

// The treasury's screens share these: dates as the till sends them, the dialog every safe entry is
// entered in, and the service that sends it, which is a request for anyone who may not approve.

// A day as the API takes it: 2026-10-12, in the till's own time.
export function isoDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function todayIso(): string {
  return isoDay(new Date());
}

export function monthBounds(year: number, month: number): { from: string; to: string } {
  return { from: isoDay(new Date(year, month - 1, 1)), to: isoDay(new Date(year, month, 0)) };
}

// The business day, as the server keeps it: between midnight and the hour the day starts it is
// still yesterday, the night the cash belongs to. Asked once, and kept; the browser's own date
// until it answers.
@Injectable({ providedIn: 'root' })
export class BusinessDay {
  private readonly api = inject(CostingApi);
  private asked: Promise<string> | null = null;

  today(): Promise<string> {
    this.asked ??= (async () => {
      try {
        return (await firstValueFrom(this.api.businessToday())).today;
      } catch {
        // Asked again next time.
        this.asked = null;
        return todayIso();
      }
    })();
    return this.asked;
  }
}

// What a safe entry starts with: its kind, and for some a supplier, an amount or a day's takings.
export interface SafeVoucherDialogData {
  kind: SafeTransactionKind;
  canApprove: boolean;
  // The till's business day: the entry's date unless another is chosen, and the latest.
  today?: string;
  supplierId?: string;
  // An advance's or a salary's employee, chosen already; a salary's month (its first day).
  employeeId?: string;
  payrollMonth?: string;
  amount?: number;
  revenueDate?: string;
}

// To the piastre.
const round = (n: number) => Math.round(n * 100) / 100;

// A day's takings as a ledger line shows them: the cash and the Visa before tax, the tax collected
// on them (and the till's rate, when it was worked out at it), so the net sales (cash + Visa) and all
// that was collected (with the tax), and what was paid straight out of it before it went into the
// safe. A reversal's are its entry's.
export function entryTax(
  e: SafeEntry,
): { percent: number | null; cash: number; card: number; tax: number; net: number; total: number; paidOut: number } | null {
  if (e.kind !== 'RevenueTransfer') {
    return null;
  }
  const cash = e.gross != null ? Math.abs(e.gross) : e.in || e.out;
  const card = Math.abs(e.card ?? 0);
  const tax = Math.abs(e.tax);
  const total = round(cash + card + tax);
  return {
    percent: e.includesTax ? e.taxPercent : null,
    cash,
    card,
    tax,
    net: round(cash + card),
    total,
    paidOut: round(total - Math.abs(e.in || e.out)),
  };
}

// The tax in a sum that includes it, as the server takes it off: the sum less the sum over
// (1 + rate), to the piastre.
export function taxIn(gross: number, percent: number): { net: number; tax: number } {
  const net = Math.round((gross / (1 + percent / 100)) * 100) / 100;
  return { net, tax: Math.round((gross - net) * 100) / 100 };
}

const sourcesFor: Partial<Record<SafeTransactionKind, FundingSource[]>> = {
  OpeningBalance: ['CarriedOver', 'OwnerFinancing'],
  Funding: ['OwnerFinancing', 'Other'],
};

// One safe entry, as it is entered: its date and amount, and what it needs: where the money came
// from (opening balance, funding), which day's takings (moving them in), what the expense is (an
// expense voucher), which supplier is paid and how much they are owed, or which employee an advance
// is for and whether the safe or a day's takings pay it. Closes with the entry to send, or nothing
// when cancelled.
@Component({
  selector: 'app-safe-voucher-dialog',
  imports: [
    EmployeePicker,
    FormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
    MoneyPipe,
  ],
  template: `
    <h2 mat-dialog-title>{{ label.en }} <span class="ar">{{ label.ar }}</span></h2>
    <mat-dialog-content>
      @if (loading()) {
        <mat-progress-bar mode="indeterminate" />
      }
      @if (expenseOrTax) {
        <mat-button-toggle-group class="pays" [value]="taxPayment() ? 'tax' : 'expense'" (change)="taxPayment.set($event.value === 'tax')"
          aria-label="What it pays">
          <mat-button-toggle value="expense">Operating expense <span class="ar">مصروف تشغيل</span></mat-button-toggle>
          <mat-button-toggle value="tax">Tax remittance <span class="ar">سداد/توريد ضرائب</span></mat-button-toggle>
        </mat-button-toggle-group>
      }
      <p class="muted">{{ taxPayment() ? taxExplanation : explanation }}</p>
      @if (taxPayment()) {
        <dl class="breakdown" aria-live="polite">
          <div>
            <dt>Tax held in the safe <span class="ar">الضريبة المستحقة بالخزنة</span></dt>
            <dd>{{ tax() ? (tax()!.owed | money) : '…' }}</dd>
          </div>
          @if (tax(); as t) {
            <div class="net">
              <dt>Left owed after this <span class="ar">المتبقي بعد السداد</span></dt>
              <dd [class.negative]="t.owed - (amount ?? 0) < 0">{{ t.owed - (amount ?? 0) | money }}</dd>
            </div>
          }
        </dl>
        @if (tax(); as t) {
          @if ((amount ?? 0) > t.owed) {
            <p class="warn small">More than the tax the takings collected and not paid over yet: still paid, if it is tax from before the treasury.</p>
          }
        }
      }
      <div class="form">
        @if (data.kind === 'SupplierPayment') {
          <mat-form-field class="wide">
            <mat-label>Supplier · المورد</mat-label>
            <mat-select [(ngModel)]="supplierId" (ngModelChange)="supplierChosen()" aria-label="Supplier">
              @for (s of owedSuppliers(); track s.supplierId) {
                <mat-option [value]="s.supplierId">{{ s.supplier }} · owed {{ s.balance | money }}</mat-option>
              } @empty {
                <mat-option disabled>No supplier is owed anything</mat-option>
              }
            </mat-select>
            @if (owed(); as o) {
              <mat-hint>Owed {{ o | money }}</mat-hint>
            }
          </mat-form-field>
        }
        @if (forEmployee) {
          <div class="wide picker">
            <app-employee-picker [employees]="payable()" [(value)]="employeeId" [disabled]="data.kind === 'SalaryPayment' && !!data.employeeId" [fill]="true"
              [none]="data.kind === 'EmployeeAdvance'" noneLabel="No one named: shared among the staff"
              [hint]="data.kind === 'EmployeeAdvance' && !employeeId() ? 'A lump sum handed out as advances, shared among the staff' : null" />
          </div>
          @if (data.kind === 'SalaryPayment') {
            <mat-form-field class="wide">
              <mat-label>The pay of · راتب شهر</mat-label>
              <input matInput type="month" [(ngModel)]="payMonth" aria-label="The pay of" />
              @if (payMonth) {
                <mat-hint>{{ monthName(payMonth + '-01') }}</mat-hint>
              }
            </mat-form-field>
          }
          <mat-form-field>
            <mat-label>Paid from · يُصرف من</mat-label>
            <mat-select [(ngModel)]="paidFrom" aria-label="Paid from">
              <mat-option value="Safe">The safe · الخزنة</mat-option>
              <mat-option value="DayRevenue">A day’s takings · إيراد يوم</mat-option>
            </mat-select>
          </mat-form-field>
          @if (paidFrom === 'DayRevenue') {
            <mat-form-field>
              <mat-label>Takings of · إيراد يوم</mat-label>
              <input matInput type="date" [(ngModel)]="revenueDate" [max]="date" aria-label="Takings of" />
            </mat-form-field>
          } @else {
            <span></span>
          }
        }
        @if (data.kind === 'ExpenseVoucher' && !taxPayment()) {
          <mat-form-field class="wide">
            <mat-label>Expense · المصروف</mat-label>
            <mat-select [(ngModel)]="expenseItemId" aria-label="Expense">
              @for (e of expenseItems(); track e.id) {
                <mat-option [value]="e.id">{{ e.name }} <span class="muted">· {{ e.category }}</span></mat-option>
              } @empty {
                <mat-option disabled>No expense items yet: add them under Purchases · Expense items</mat-option>
              }
            </mat-select>
          </mat-form-field>
        }
        @if (sources.length) {
          <mat-form-field class="wide">
            <mat-label>Source · المصدر</mat-label>
            <mat-select [(ngModel)]="source" aria-label="Source">
              @for (s of sources; track s) {
                <mat-option [value]="s">{{ sourceLabels[s].en }} · {{ sourceLabels[s].ar }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        }
        <mat-form-field>
          <mat-label>Amount · المبلغ</mat-label>
          <input matInput type="number" min="0" step="any" [(ngModel)]="amount" aria-label="Amount" />
          <span matTextSuffix>&nbsp;{{ company.currency() }}</span>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Date · التاريخ</mat-label>
          <input matInput type="date" [(ngModel)]="date" [max]="today" aria-label="Date" />
        </mat-form-field>
        <mat-form-field class="wide" subscriptSizing="dynamic">
          <mat-label>Notes · ملاحظات</mat-label>
          <input matInput [(ngModel)]="notes" maxlength="300" aria-label="Notes" />
        </mat-form-field>
      </div>
      @if (!data.canApprove) {
        <p class="ask">
          A manager approves safe entries: no cash moves until then. <span class="ar">يُرسل للمدير للموافقة.</span>
        </p>
      }
      @if (problem(); as p) {
        <p class="error">{{ p }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button (click)="done()" [disabled]="!!problem()">{{ data.canApprove ? 'Save' : 'Send for approval' }}</button>
    </mat-dialog-actions>
  `,
  styleUrl: './costing.scss',
  styles: `
    .form {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 4px 12px;
    }
    .wide {
      grid-column: span 2;
    }
    .ar {
      direction: rtl;
      unicode-bidi: isolate;
      margin-left: 6px;
      opacity: 0.75;
      font-size: 0.8em;
      white-space: nowrap;
    }
    .ask {
      padding: 8px 10px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--app-warn) 14%, transparent);
    }
    .error {
      color: var(--mat-sys-error);
    }
    .warn {
      margin: -4px 0 12px;
      color: var(--app-warn);
    }
    .small {
      font-size: 0.85em;
    }
    .pays {
      display: flex;
      margin-bottom: 8px;

      mat-button-toggle {
        flex: 1;
      }
    }
    .breakdown {
      display: grid;
      gap: 4px;
      margin: -4px 0 12px;
      padding: 10px 12px;
      border-radius: 8px;
      background: var(--mat-sys-surface-container);

      div {
        display: flex;
        justify-content: space-between;
        gap: 12px;
      }
      dt,
      dd {
        margin: 0;
      }
      dd {
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .net {
        padding-top: 4px;
        border-top: 1px solid var(--mat-sys-outline-variant);
        font-weight: 600;
      }
      .negative {
        color: var(--mat-sys-error);
      }
    }
  `,
})
export class SafeVoucherDialog {
  protected readonly company = inject(Company);
  private readonly api = inject(CostingApi);
  private readonly staffApi = inject(MenuSalesApi);
  private readonly ref = inject<MatDialogRef<SafeVoucherDialog, SafeVoucherInput>>(MatDialogRef);
  protected readonly data = inject<SafeVoucherDialogData>(MAT_DIALOG_DATA);

  protected readonly label = safeKindLabels[this.data.kind === 'TaxPayment' ? 'ExpenseVoucher' : this.data.kind];
  // An expense voucher pays an expense, or the tax held in the safe over to the tax authority.
  protected readonly expenseOrTax = this.data.kind === 'ExpenseVoucher' || this.data.kind === 'TaxPayment';
  protected readonly taxPayment = signal(this.data.kind === 'TaxPayment');
  protected readonly tax = signal<TaxPosition | null>(null);
  protected readonly sources = sourcesFor[this.data.kind] ?? [];
  protected readonly sourceLabels = fundingSourceLabels;
  protected readonly today = this.data.today ?? todayIso();
  protected readonly loading = signal(false);
  protected readonly expenseItems = signal<ExpenseItem[]>([]);
  private readonly employees = signal<Employee[]>([]);
  // Who an advance can go to: those still employed. A salary is anyone's, left or not.
  protected readonly payable = computed(() => this.employees().filter((e) => e.isActive || this.data.kind === 'SalaryPayment'));
  private readonly balances = signal<SupplierBalance[]>([]);
  protected readonly owedSuppliers = computed(() => this.balances().filter((b) => b.balance > 0));
  protected amount: number | null = this.data.amount ?? null;
  protected date = this.today;
  protected revenueDate = this.data.revenueDate ?? this.today;
  protected source: FundingSource | null = this.sources[0] ?? null;
  protected supplierId: string | null = this.data.supplierId ?? null;
  protected expenseItemId: string | null = null;
  protected readonly employeeId = signal<string | null>(this.data.employeeId ?? null);
  // An advance's or a salary's: who it is for, and the safe or a day's takings paying it.
  protected readonly forEmployee = this.data.kind === 'EmployeeAdvance' || this.data.kind === 'SalaryPayment';
  protected paidFrom: 'Safe' | 'DayRevenue' = this.data.revenueDate ? 'DayRevenue' : 'Safe';
  protected notes = '';
  // A salary's month, as a month field holds it ("2026-10"): the one chosen, or the entry's own.
  protected payMonth = (this.data.payrollMonth ?? this.today).slice(0, 7);

  protected readonly explanation = {
    OpeningBalance: 'The cash in the safe as the treasury starts: carried over from before, or put in by the owners.',
    Funding: 'Money put into the safe from outside the sales: the owners’ financing, or another source.',
    RevenueTransfer: '',
    ExpenseVoucher: 'Cash paid out of the safe for an expense: a bill, wages, petty cash. It counts on the profit and loss under its category.',
    SupplierPayment: 'Cash paid to a supplier from the safe, against what the restaurant owes them.',
    InvoicePayment: '',
    EmployeeAdvance:
      'Cash advanced to an employee (سلفة), from the safe or a day’s takings. It is not an expense: it comes off their pay for the month, on the payroll. ' +
      'Naming no one makes it a lump sum handed out as advances, shared among the staff.',
    SalaryPayment: 'Cash paid to an employee, from the safe or a day’s takings.',
    TaxPayment: '',
  }[this.data.kind];
  protected readonly taxExplanation =
    'The tax the takings collected, held in the safe, paid over to the tax authority. It comes out of the safe and off the tax owed; it is not an expense, so the profit and loss leaves it out.';

  constructor() {
    void this.load();
  }

  // "October 2026", from its first day.
  protected monthName(month: string): string {
    return new Date(`${month}T12:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  }

  protected owed(): number | null {
    return this.balances().find((b) => b.supplierId === this.supplierId)?.balance ?? null;
  }

  // A supplier chosen: what they are owed, to pay in full unless less is typed.
  protected supplierChosen(): void {
    this.amount = this.owed();
  }

  // What stops it being sent, said plainly.
  protected problem(): string | null {
    const opening = this.data.kind === 'OpeningBalance';
    if (this.amount === null || this.amount < 0 || (!opening && this.amount === 0)) {
      return opening ? null : 'Enter an amount more than nothing.';
    }
    if (!this.date) {
      return 'Enter the date.';
    }
    if (this.sources.length && !this.source) {
      return 'Choose where the money came from.';
    }
    if (this.data.kind === 'ExpenseVoucher' && !this.taxPayment() && !this.expenseItemId) {
      return 'Choose what the expense is.';
    }
    if (this.forEmployee) {
      // An advance may name no one: a lump sum, shared among the staff.
      if (!this.employeeId() && this.data.kind === 'SalaryPayment') {
        return 'Choose the employee.';
      }
      if (this.data.kind === 'SalaryPayment' && !this.payMonth) {
        return 'Choose the month whose pay this is.';
      }
      if (this.data.kind === 'SalaryPayment' && `${this.payMonth}-01` > this.date) {
        return 'A month’s salary is paid once the month has started.';
      }
      if (this.paidFrom === 'DayRevenue' && (!this.revenueDate || this.revenueDate > this.date)) {
        return `Choose the day whose takings pay it: that day or one before the ${this.data.kind === 'SalaryPayment' ? 'payment' : 'advance'}.`;
      }
    }
    if (this.data.kind === 'SupplierPayment') {
      const owed = this.owed();
      if (!this.supplierId) {
        return 'Choose the supplier.';
      }
      if (owed !== null && this.amount > owed) {
        return 'That is more than they are owed.';
      }
    }
    return null;
  }

  protected done(): void {
    if (this.problem() || this.amount === null) {
      return;
    }
    const voucher: SafeVoucherInput = {
      requestId: crypto.randomUUID(),
      transactionId: crypto.randomUUID(),
      kind: this.expenseOrTax ? (this.taxPayment() ? 'TaxPayment' : 'ExpenseVoucher') : this.data.kind,
      amount: this.amount,
      date: this.date,
      source: this.sources.length ? this.source : null,
      revenueDate: this.forEmployee && this.paidFrom === 'DayRevenue' ? this.revenueDate : null,
      supplierId: this.data.kind === 'SupplierPayment' ? this.supplierId : null,
      expenseItemId: this.data.kind === 'ExpenseVoucher' && !this.taxPayment() ? this.expenseItemId : null,
      notes: this.notes.trim() || null,
      reason: null,
      includesTax: false,
      employeeId: this.forEmployee ? this.employeeId() : null,
      payrollMonth: this.data.kind === 'SalaryPayment' ? `${this.payMonth}-01` : null,
    };
    this.ref.close(voucher);
  }

  private async load(): Promise<void> {
    if (!this.expenseOrTax && this.data.kind !== 'SupplierPayment' && !this.forEmployee) {
      return;
    }
    this.loading.set(true);
    try {
      if (this.forEmployee) {
        this.employees.set(await firstValueFrom(this.staffApi.staff()));
      } else if (this.expenseOrTax) {
        // What the tax owed is, for a tax remittance; it is only said, so the voucher works without it.
        const [items, tax] = await Promise.all([
          firstValueFrom(this.api.expenseItems()),
          firstValueFrom(this.api.taxPosition()).catch(() => null),
        ]);
        this.expenseItems.set(items);
        this.tax.set(tax);
      } else {
        this.balances.set(await firstValueFrom(this.api.supplierBalances()));
        if (this.supplierId && this.amount === null) {
          this.amount = this.owed();
        }
      }
    } finally {
      this.loading.set(false);
    }
  }
}

export interface TakingsDialogData {
  canApprove: boolean;
  // The till's business day: the latest a day's takings can be of.
  today: string;
  // The day, when it is chosen already (from the day's list on Funding).
  revenueDate?: string;
}

// A day's takings (توريد إيراد اليومية), as its Z report gives them, in its order: the date, the cash
// and the Visa sales before tax, the tax collected on them, the voids and refunds, and why. All of
// it goes into the safe, less what was paid straight out of the day's takings; the net sales (cash +
// Visa) are the revenue, and the tax is held in the safe for the tax authority, never revenue.
// Closes with the entry to send, or nothing when cancelled.
@Component({
  selector: 'app-takings-dialog',
  imports: [FormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule, MoneyPipe],
  template: `
    <h2 mat-dialog-title>Takings in <span class="inline-ar">توريد إيراد اليومية</span></h2>
    <mat-dialog-content>
      <p class="muted">
        The day's Z report: its cash and Visa sales before tax, the tax collected on them, and its voids. All of it goes into the safe; the
        tax is held there for the tax authority.
        <span class="note-ar" lang="ar" dir="rtl">تقرير Z لليوم: الكاش والفيزا والضريبة المحصلة والفويد. الإجمالي كله يدخل الخزنة، والضريبة التزام بها.</span>
      </p>
      <div class="form">
        <mat-form-field class="wide">
          <mat-label>Date · تاريخ اليومية</mat-label>
          <input matInput type="date" [(ngModel)]="revenueDate" (ngModelChange)="dayChosen()" [max]="data.today" aria-label="Date" />
        </mat-form-field>
        <mat-form-field floatLabel="always">
          <mat-label>Cash · إيراد الكاش</mat-label>
          <input matInput type="number" min="0" step="any" [(ngModel)]="cash" (ngModelChange)="touch()" aria-label="Cash" placeholder="0" />
          <span matTextSuffix>&nbsp;{{ company.currency() }}</span>
        </mat-form-field>
        <mat-form-field floatLabel="always">
          <mat-label>Visa / Card · إيراد الفيزا</mat-label>
          <input matInput type="number" min="0" step="any" [(ngModel)]="card" (ngModelChange)="touch()" aria-label="Visa or card" placeholder="0" />
          <span matTextSuffix>&nbsp;{{ company.currency() }}</span>
        </mat-form-field>
        <mat-form-field floatLabel="always">
          <mat-label>Total tax collected · إجمالي الضريبة المحصلة</mat-label>
          <input matInput type="number" min="0" step="any" [(ngModel)]="tax" (ngModelChange)="touch()" aria-label="Total tax collected" placeholder="0" />
          <span matTextSuffix>&nbsp;{{ company.currency() }}</span>
        </mat-form-field>
        <mat-form-field floatLabel="always">
          <mat-label>Voids &amp; refunds · قيمة الفويد والمرتجعات</mat-label>
          <input matInput type="number" min="0" step="any" [(ngModel)]="voids" (ngModelChange)="touch()" aria-label="Voids and refunds" placeholder="0" />
          <span matTextSuffix>&nbsp;{{ company.currency() }}</span>
        </mat-form-field>
        <mat-form-field class="wide">
          <mat-label>Void reasons / notes · أسباب الفويد وملاحظات اليومية</mat-label>
          <textarea matInput rows="3" [(ngModel)]="notes" (ngModelChange)="touch()" maxlength="500" aria-label="Void reasons and notes"></textarea>
          <mat-hint align="end">{{ notes.length }} / 500</mat-hint>
        </mat-form-field>
      </div>
      <dl class="breakdown" aria-live="polite">
        <div>
          <dt>Net sales revenue <span class="inline-ar">صافي إيراد المبيعات</span> <span class="muted small">cash + Visa, for the P&amp;L</span></dt>
          <dd>{{ figures().net | money }}</dd>
        </div>
        <div>
          <dt>Tax collected <span class="inline-ar">الضريبة المحصلة - التزام ضريبي بالخزنة</span> <span class="muted small">owed, never revenue</span></dt>
          <dd>{{ figures().tax | money }}</dd>
        </div>
        @if (paidOut()) {
          <div>
            <dt>Paid straight out of them <span class="inline-ar">المنصرف من الإيراد</span></dt>
            <dd>({{ paidOut() | money }})</dd>
          </div>
        }
        <div class="net">
          <dt>
            Total inflow into the safe <span class="inline-ar">إجمالي الوارد للخزنة</span>
            <span class="muted small">cash + Visa + tax{{ paidOut() ? ', less what was paid out of them' : '' }}</span>
          </dt>
          <dd [class.negative]="figures().intoSafe < 0">{{ figures().intoSafe | money }}</dd>
        </div>
      </dl>
      @if (figures().intoSafe < 0) {
        <p class="error small">What was paid out of these takings is {{ -figures().intoSafe | money }} more than they came to: that comes out of the safe.</p>
      }
      @if (!data.canApprove) {
        <p class="ask">A manager approves safe entries: no cash moves until then. <span class="inline-ar">يُرسل للمدير للموافقة.</span></p>
      }
      @if (problem(); as p) {
        <p class="error" role="alert">{{ p }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel <span class="inline-ar">إلغاء</span></button>
      <button mat-flat-button (click)="done()" [disabled]="!!problem()">
        {{ data.canApprove ? 'Save' : 'Send for approval' }} <span class="inline-ar">{{ data.canApprove ? 'حفظ' : 'إرسال للموافقة' }}</span>
      </button>
    </mat-dialog-actions>
  `,
  styleUrl: './costing.scss',
  styles: `
    .form {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 4px 12px;
    }
    .wide {
      grid-column: span 2;
    }
    .ask {
      padding: 8px 10px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--app-warn) 14%, transparent);
    }
    .error {
      color: var(--mat-sys-error);
    }
    .small {
      font-size: 0.85em;
    }
    .breakdown {
      display: grid;
      gap: 4px;
      margin: 4px 0 12px;
      padding: 10px 12px;
      border-radius: 8px;
      background: var(--mat-sys-surface-container);

      div {
        display: flex;
        justify-content: space-between;
        gap: 12px;
      }
      dt,
      dd {
        margin: 0;
      }
      dd {
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      dt .small {
        margin-inline-start: 8px;
      }
      .net {
        padding: 4px 0;
        border-top: 1px solid var(--mat-sys-outline-variant);
        border-bottom: 1px solid var(--mat-sys-outline-variant);
        font-weight: 600;
      }
      .negative {
        color: var(--mat-sys-error);
      }
    }
    @media (max-width: 520px) {
      .form {
        grid-template-columns: minmax(0, 1fr);
      }
      .wide {
        grid-column: auto;
      }
    }
  `,
})
export class TakingsDialog {
  protected readonly company = inject(Company);
  private readonly api = inject(CostingApi);
  private readonly ref = inject<MatDialogRef<TakingsDialog, SafeVoucherInput>>(MatDialogRef);
  protected readonly data = inject<TakingsDialogData>(MAT_DIALOG_DATA);

  protected revenueDate = this.data.revenueDate ?? this.data.today;
  protected cash: number | null = null;
  protected card: number | null = null;
  protected tax: number | null = null;
  protected voids: number | null = null;
  protected notes = '';
  // What was paid straight out of the day's takings, and what is entered for it already.
  protected readonly preview = signal<TakingsPreview | null>(null);
  protected readonly paidOut = computed(() => this.preview()?.paidOut ?? 0);
  // Bumped as a figure is typed.
  private readonly version = signal(0);

  protected readonly figures = computed(() => {
    this.version();
    const [cash, card, tax] = [this.cash, this.card, this.tax].map((n) => Number(n) || 0);
    return { net: round(cash + card), tax: round(tax), total: round(cash + card + tax), intoSafe: round(cash + card + tax - this.paidOut()) };
  });

  // What stops it being sent, said plainly in both languages.
  protected readonly problem = computed(() => {
    this.version();
    const figures = [this.cash, this.card, this.tax, this.voids];
    if (!this.revenueDate) {
      return 'Choose the date of the takings. · اختر تاريخ اليومية.';
    }
    if (this.revenueDate > this.data.today) {
      return 'Those takings are of a day that has not come yet. · هذا اليوم لم يأتِ بعد.';
    }
    const entered = this.preview()?.entered;
    if (entered != null) {
      return `These takings are entered already: ${this.company.money(entered)}. To change them, void that entry on the Safe tab and enter them again. · إيراد هذا اليوم مسجل بالفعل.`;
    }
    if (figures.some((n) => n !== null && `${n}` !== '' && (!Number.isFinite(Number(n)) || Number(n) < 0))) {
      return 'The cash, card, tax and voids are zero or more. · المبالغ صفر أو أكثر.';
    }
    if (this.figures().net <= 0) {
      return "Enter the day's cash or card takings. · أدخل إيراد الكاش أو الفيزا.";
    }
    if (this.figures().tax > this.figures().net) {
      return "The tax collected cannot be more than the day's sales. · الضريبة لا تزيد عن إجمالي المبيعات.";
    }
    if (this.notes.trim().length > 500) {
      return 'Keep the notes under 500 characters. · الملاحظات 500 حرف على الأكثر.';
    }
    return null;
  });

  constructor() {
    void this.loadPreview();
  }

  protected touch(): void {
    this.version.update((v) => v + 1);
  }

  protected dayChosen(): void {
    this.touch();
    void this.loadPreview();
  }

  protected done(): void {
    if (this.problem()) {
      return;
    }
    const amount = (n: number | null) => round(Number(n) || 0);
    this.ref.close({
      requestId: crypto.randomUUID(),
      transactionId: crypto.randomUUID(),
      kind: 'RevenueTransfer',
      amount: amount(this.cash),
      date: this.revenueDate,
      source: null,
      revenueDate: this.revenueDate,
      supplierId: null,
      expenseItemId: null,
      notes: this.notes.trim() || null,
      reason: null,
      includesTax: false,
      cardAmount: amount(this.card),
      taxAmount: amount(this.tax),
      voidsAmount: amount(this.voids),
    });
  }

  // Without it the breakdown shows nothing paid out; the server takes it off all the same.
  private async loadPreview(): Promise<void> {
    const day = this.revenueDate;
    if (!day) {
      this.preview.set(null);
      return;
    }
    try {
      const preview = await firstValueFrom(this.api.takingsPreview(day));
      if (this.revenueDate === day) this.preview.set(preview);
    } catch {
      this.preview.set(null);
    }
  }
}

export interface PayInvoiceDialogData {
  what: string;
  total: number;
  hasSupplier: boolean;
  canApprove: boolean;
  today?: string;
}

// How an unpaid cash invoice is paid now: from the safe, from a day's takings, or put on credit.
@Component({
  selector: 'app-pay-invoice-dialog',
  imports: [FormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule, MoneyPipe],
  template: `
    <h2 mat-dialog-title>Pay {{ data.what }} <span class="ar">سداد الفاتورة</span></h2>
    <mat-dialog-content>
      <p>{{ data.total | money }}, not paid yet: its cash payment was rejected or voided.</p>
      <mat-form-field class="wide">
        <mat-label>Paid · طريقة الدفع</mat-label>
        <mat-select [(ngModel)]="method" aria-label="How it is paid">
          @for (m of methods; track m) {
            <mat-option [value]="m" [disabled]="m === 'Credit' && !data.hasSupplier">{{ labels[m].en }} · {{ labels[m].ar }}</mat-option>
          }
        </mat-select>
        @if (!data.hasSupplier) {
          <mat-hint>On credit needs a supplier on the invoice.</mat-hint>
        }
      </mat-form-field>
      @if (method === 'DayRevenue') {
        <mat-form-field>
          <mat-label>Takings of · إيراد يوم</mat-label>
          <input matInput type="date" [(ngModel)]="revenueDate" [max]="today" aria-label="Takings of" />
        </mat-form-field>
      }
      @if (!data.canApprove && method !== 'Credit') {
        <p class="muted">A manager approves the payment: no cash moves until then.</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button [disabled]="!method || (method === 'DayRevenue' && !revenueDate)"
        [mat-dialog-close]="{ method, revenueDate: method === 'DayRevenue' ? revenueDate : null }">
        {{ data.canApprove || method === 'Credit' ? 'Pay' : 'Send for approval' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .wide {
      width: 100%;
    }
    .ar {
      direction: rtl;
      unicode-bidi: isolate;
      margin-left: 6px;
      opacity: 0.75;
      font-size: 0.8em;
    }
  `,
})
export class PayInvoiceDialog {
  protected readonly data = inject<PayInvoiceDialogData>(MAT_DIALOG_DATA);
  protected readonly methods: PurchasePaymentMethod[] = ['Safe', 'DayRevenue', 'Credit'];
  protected readonly labels = paymentMethodLabels;
  protected readonly today = this.data.today ?? todayIso();
  protected method: PurchasePaymentMethod | null = 'Safe';
  protected revenueDate = this.today;
}

// What a supplier was owed before the treasury: an opening debt.
@Component({
  selector: 'app-supplier-opening-dialog',
  imports: [FormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>Owed before the treasury <span class="ar">رصيد افتتاحي للمورد</span></h2>
    <mat-dialog-content>
      <p class="muted">What {{ data.supplier }} was owed from invoices entered before the treasury. No cash moves.</p>
      <mat-form-field>
        <mat-label>Owed · المبلغ المستحق</mat-label>
        <input matInput type="number" min="0" step="any" [(ngModel)]="owed" aria-label="Owed" />
        <span matTextSuffix>&nbsp;{{ company.currency() }}</span>
      </mat-form-field>
      <mat-form-field>
        <mat-label>As of · بتاريخ</mat-label>
        <input matInput type="date" [(ngModel)]="date" aria-label="As of" />
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button [disabled]="!owed || owed <= 0 || !date" [mat-dialog-close]="{ owed, date }">Save</button>
    </mat-dialog-actions>
  `,
  styles: `
    .ar {
      direction: rtl;
      unicode-bidi: isolate;
      margin-left: 6px;
      opacity: 0.75;
      font-size: 0.8em;
    }
  `,
})
export class SupplierOpeningDialog {
  protected readonly company = inject(Company);
  protected readonly data = inject<{ supplier: string; today?: string }>(MAT_DIALOG_DATA);
  protected owed: number | null = null;
  protected date = this.data.today ?? todayIso();
}

// Enters safe entries: at once for a manager, as a request for anyone else; and pays invoices.
@Injectable({ providedIn: 'root' })
export class Treasury {
  private readonly company = inject(Company);
  private readonly api = inject(CostingApi);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotifyService);
  private readonly approvals = inject(Approvals);
  private readonly businessDay = inject(BusinessDay);

  // Asks for it, then sends it. True when something was entered or asked for. A day's takings are
  // asked for as its Z report gives them.
  async enter(kind: SafeTransactionKind, preset: Partial<SafeVoucherDialogData> = {}): Promise<boolean> {
    const today = await this.businessDay.today();
    const canApprove = this.approvals.canApprove();
    const voucher = await firstValueFrom(
      kind === 'RevenueTransfer'
        ? this.dialog
            .open<TakingsDialog, TakingsDialogData, SafeVoucherInput>(TakingsDialog, {
              data: { canApprove, today, revenueDate: preset.revenueDate },
              width: '720px',
              maxWidth: '96vw',
            })
            .afterClosed()
        : this.dialog
            .open<SafeVoucherDialog, SafeVoucherDialogData, SafeVoucherInput>(SafeVoucherDialog, {
              data: { ...preset, kind, canApprove, today },
              width: '520px',
              maxWidth: '95vw',
            })
            .afterClosed(),
    );
    if (!voucher) {
      return false;
    }
    try {
      const result = await firstValueFrom(this.api.recordVoucher(voucher));
      if (isRequested(result)) {
        await this.approvals.requested(result);
      } else if (kind === 'RevenueTransfer') {
        this.notify.info(
          `Takings of ${voucher.revenueDate} entered: net sales ${this.company.money(result.netAmount ?? 0)}, tax ${this.company.money(result.taxAmount)}` +
            ` held for the tax authority, ${this.company.money(result.amount)} into the safe.`,
        );
      } else {
        // As sent: an expense voucher may have gone as a tax payment.
        this.notify.info(`${safeKindLabels[voucher.kind].en} entered: ${this.company.money(voucher.amount)}.`);
      }
      return true;
    } catch (error) {
      this.notify.error(error, 'The entry could not be saved.');
      return false;
    }
  }

  // An unpaid cash invoice, paid now. The status it is left in, or null when cancelled or refused.
  async payInvoice(invoiceId: string, data: Omit<PayInvoiceDialogData, 'canApprove' | 'today'>): Promise<InvoicePaymentStatus | null> {
    const today = await this.businessDay.today();
    const answer = await firstValueFrom(
      this.dialog
        .open<PayInvoiceDialog, PayInvoiceDialogData, { method: PurchasePaymentMethod; revenueDate: string | null }>(PayInvoiceDialog, {
          data: { ...data, canApprove: this.approvals.canApprove(), today },
          width: '440px',
        })
        .afterClosed(),
    );
    if (!answer) {
      return null;
    }
    try {
      const { paymentStatus } = await firstValueFrom(this.api.payPurchaseInvoice(invoiceId, crypto.randomUUID(), answer.method, answer.revenueDate));
      this.notify.info(
        paymentStatus === 'Pending'
          ? 'Payment submitted to the manager for approval. No cash moves until then.'
          : paymentStatus === 'OnCredit'
            ? 'Put on credit: owed to the supplier.'
            : 'Paid.',
      );
      await this.approvals.refresh();
      return paymentStatus;
    } catch (error) {
      this.notify.error(error, errorMessage(error, 'The invoice could not be paid.'));
      return null;
    }
  }

  async supplierOpening(supplierId: string, supplier: string): Promise<boolean> {
    const today = await this.businessDay.today();
    const answer = await firstValueFrom(
      this.dialog
        .open<SupplierOpeningDialog, { supplier: string; today: string }, { owed: number; date: string }>(SupplierOpeningDialog, { data: { supplier, today } })
        .afterClosed(),
    );
    if (!answer) {
      return false;
    }
    try {
      await firstValueFrom(this.api.supplierOpeningBalance(supplierId, crypto.randomUUID(), answer.owed, answer.date));
      this.notify.info(`${supplier}: owed ${this.company.money(answer.owed)} from before the treasury.`);
      return true;
    } catch (error) {
      this.notify.error(error, 'The opening debt could not be saved.');
      return false;
    }
  }
}
