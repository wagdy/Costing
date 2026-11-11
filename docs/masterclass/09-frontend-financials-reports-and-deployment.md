# الفصل 09: شاشات الماليات والتقارير والإدارة، الاختبارات، والنشر

[← الفصل السابق](08-frontend-core-and-operations-screens.md) · [الفهرس](00-index-and-build-roadmap.md)

## 1. الماليات (الخزنة)

### 1.1 `financials.ts`: المشترك بين شاشات الخزنة

- `isoDay`, `todayIso`, `monthBounds`, `BusinessDay`: التواريخ كما يأخذها الـ API (اليوم التجاري من الخادم لا من جهاز المستخدم).
- **`SafeVoucherDialog`**: نافذة كل قيد خزنة (مصروف، سداد مورد، سلفة، راتب، تمويل، **سداد ضريبة** بمفتاح "توريد ضريبة")، ومن أين يُدفع (الخزنة أو إيراد يوم).
- `entryTax` / `taxIn`: نفس معادلة الباك إند لاستخراج الضريبة من مبلغ شامل.
- **`TakingsDialog`**: التوريد (كاش، فيزا، ضريبة، إلغاءات)، **مملوءًا مسبقًا من تقفيل اليوم المسلّم** حتى يُكتب فوقه.
- `PayInvoiceDialog`, `SupplierOpeningDialog`.
- **`Treasury`**: خدمة "أدخل قيدًا": للمدير تنفيذ، ولغيره طلب موافقة، والرسالة تقول أيهما حدث.

> 📄 **`frontend/src/app/features/costing/financials.ts`** — 1075 سطر

```ts
import { Component, Injectable, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
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
import { EndOfDay, EndOfDayApi } from '../../core/costing/end-of-day.api';
import { MenuSalesApi } from '../../core/costing/menu-sales.api';
import { Employee } from '../../core/costing/staff';
import { Company } from '../../core/settings/company';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { NotifyService } from '../../core/ui/notify.service';
import { Approvals } from './approvals';
import { viewPhoto } from './end-of-day-photo';

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
    PayrollPayment: '',
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
// Visa) are the revenue, and the tax is held in the safe for the tax authority, never revenue. A
// day whose end of day was handed in starts from its sales report, nothing typed over it yet.
// Closes with the entry to send, or nothing when cancelled.
@Component({
  selector: 'app-takings-dialog',
  imports: [FormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule, MoneyPipe],
  template: `
    <h2 mat-dialog-title>Takings in <span class="inline-ar">توريد إيراد اليومية</span></h2>
    <mat-dialog-content>
      <p class="muted">
        The day's Z report: its cash and Visa sales before tax, the tax collected on them, and its voids. All of it goes into the safe; the
        tax is held there for the tax authority.
        <span class="note-ar" lang="ar" dir="rtl">تقرير Z لليوم: الكاش والفيزا والضريبة المحصلة والفويد. الإجمالي كله يدخل الخزنة، والضريبة التزام بها.</span>
      </p>
      @if (handedIn(); as d) {
        <div class="from-day" role="status">
          <mat-icon>assignment_turned_in</mat-icon>
          <span>
            From the end of day handed in by {{ d.submittedBy }}: cash {{ d.cashAmount ?? 0 | money }}, Visa {{ d.cardAmount ?? 0 | money }}, tax
            {{ d.taxAmount ?? 0 | money }}. <span class="inline-ar">من تقفيل اليوم</span>
          </span>
          @if (differs()) {
            <button mat-button (click)="useHandedIn()">Use these · استخدام</button>
          }
          @if (d.salesPhoto; as photo) {
            <button mat-button (click)="viewZ(d, photo.fileName)"><mat-icon>receipt</mat-icon> Z report · تقرير Z</button>
          }
        </div>
      }
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
    .from-day {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px 8px;
      margin: 0 0 12px;
      padding: 8px 10px;
      border-radius: 8px;
      background: var(--tag-teal-bg, #e0f4f3);
      color: var(--tag-teal-fg, #0f766e);
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
  private readonly endOfDay = inject(EndOfDayApi);
  private readonly dialog = inject(MatDialog);

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
  // The day's end of day, submitted: its sales report is what the figures start from.
  protected readonly handedIn = signal<EndOfDay | null>(null);
  // A figure typed by hand: the end of day no longer fills them in by itself.
  private typed = false;

  // The figures are not the end of day's.
  protected readonly differs = computed(() => {
    this.version();
    const d = this.handedIn();
    return !!d && [[this.cash, d.cashAmount], [this.card, d.cardAmount], [this.tax, d.taxAmount], [this.voids, d.voidsAmount]]
      .some(([typed, given]) => (Number(typed) || 0) !== (given ?? 0));
  });

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
    this.typed = true;
    this.version.update((v) => v + 1);
  }

  protected dayChosen(): void {
    this.version.update((v) => v + 1);
    void this.loadPreview();
  }

  protected useHandedIn(): void {
    const d = this.handedIn();
    if (!d) {
      return;
    }
    [this.cash, this.card, this.tax, this.voids] = [d.cashAmount, d.cardAmount, d.taxAmount, d.voidsAmount];
    this.notes = d.notes ?? '';
    this.typed = false;
    this.version.update((v) => v + 1);
  }

  protected viewZ(day: EndOfDay, fileName: string): void {
    viewPhoto(this.dialog, () => this.endOfDay.photo(day.date, day.id), fileName);
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
      this.handedIn.set(null);
      return;
    }
    void this.loadHandedIn(day);
    try {
      const preview = await firstValueFrom(this.api.takingsPreview(day));
      if (this.revenueDate === day) this.preview.set(preview);
    } catch {
      this.preview.set(null);
    }
  }

  // The end of day of the day chosen, if it was handed in: nothing typed yet, its figures.
  private async loadHandedIn(day: string): Promise<void> {
    let found: EndOfDay | null = null;
    try {
      found = await firstValueFrom(this.endOfDay.day(day));
    } catch {
      found = null;
    }
    if (this.revenueDate !== day) {
      return;
    }
    this.handedIn.set(found?.status === 'Submitted' ? found : null);
    if (this.handedIn() && !this.typed) {
      this.useHandedIn();
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
```


> 📄 **`frontend/src/app/features/costing/financials-shell.ts`** — 37 سطر

```ts
import { Component, computed, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SubNav, SubNavTab } from '../shared/sub-nav';
import { AuthService } from '../../core/auth/auth.service';
import { Permissions } from '../../core/auth/permissions';

// Financials (الماليات): the safe, where its money comes from, each day's cash reconciled with its
// sales, the expense vouchers paid out of the safe, what is owed to suppliers and the payments made
// to them, the staff the safe pays and their advances, and the tax and service settings.
@Component({
  selector: 'app-financials-shell',
  imports: [RouterOutlet, SubNav],
  template: `
    <app-sub-nav label="Financials" [tabs]="tabs()" />
    <router-outlet />
  `,
  styleUrl: './costing.scss',
})
export class FinancialsShell {
  private readonly auth = inject(AuthService);

  private readonly allTabs: SubNavTab[] = [
    { path: 'safe', icon: 'account_balance_wallet', en: 'Safe', ar: 'الخزنة' },
    { path: 'funding', icon: 'savings', en: 'Funding sources', ar: 'مصادر التمويل' },
    { path: 'reconciliation', icon: 'rule', en: 'Reconciliation', ar: 'مطابقة الإيرادات' },
    { path: 'daily-cash', icon: 'calendar_view_day', en: 'Daily cash', ar: 'يومية الإيراد' },
    { path: 'expenses', icon: 'receipt', en: 'Expense vouchers', ar: 'إذن صرف مصروفات' },
    { path: 'suppliers', icon: 'account_balance', en: 'Supplier debts', ar: 'مديونيات الموردين' },
    { path: 'payments', icon: 'payments', en: 'Supplier payments', ar: 'أذونات صرف الموردين' },
    { path: 'advances', icon: 'request_quote', en: 'Advances', ar: 'السلفيات' },
    { path: 'staff', icon: 'badge', en: 'Staff', ar: 'الموظفين' },
    { path: 'payroll', icon: 'request_page', en: 'Payroll & deductions', ar: 'الرواتب والخصومات' },
    { path: 'tax-service', icon: 'percent', en: 'Tax & service', ar: 'الضريبة والخدمة' },
  ];

  protected readonly tabs = computed(() => this.allTabs);
}
```


### 1.2 الشاشات

`SafePage`: **الخزنة الموحدة** شهرًا بشهر: شريط من 7 بطاقات (الكاش، الفيزا، الضريبة، الصافي، التمويل، الداخل، الخارج، والضريبة المستحقة الآن)، ثم الدفتر بالرصيد بعد كل سطر، والقيد العكسي يسمّي ما ألغاه. و `TakingsBadges`: شارات التوريد على سطر الدفتر (الكاش والفيزا قبل الضريبة، الضريبة ونسبتها، الصافي، وما دُفع من الدرج قبله).

> 📄 **`frontend/src/app/features/costing/safe-page.ts`** — 335 سطر

```ts
import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import { CostingApi, SafeEntry, SafeMonth, SafeTransactionKind, fundingSourceLabels, safeKindLabels } from '../../core/costing/costing.api';
import { errorMessage } from '../../core/http/error-message';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { Approvals, pendingLabel } from './approvals';
import { Treasury } from './financials';
import { TakingsBadges } from './takings-badges';

// The safe (الخزنة), the one treasury: a day's cash, Visa and the tax collected on them all go in.
// Month by month, a strip read from start to finish: the cash, Visa and tax taken; all that came in,
// with the balance it opened with and the funding put in; all that went out; what is in it now;
// and the balance the month closed with (in less out). Then every entry, with the balance after it,
// a day's takings with their breakdown. Entries waiting for a manager are listed first: no cash has
// moved for them. An entry is voided, never edited: a reversing entry dated the day of the void.
@Component({
  selector: 'app-safe-page',
  imports: [DatePipe, MatButtonModule, MatIconModule, MatProgressBarModule, MatTooltipModule, MoneyPipe, TakingsBadges],
  template: `
    <div class="toolbar">
      <button mat-icon-button (click)="move(-1)" aria-label="The month before"><mat-icon>chevron_left</mat-icon></button>
      <strong class="month">{{ monthStart() | date: 'MMMM y' }}</strong>
      <button mat-icon-button (click)="move(1)" [disabled]="isThisMonth()" aria-label="The month after"><mat-icon>chevron_right</mat-icon></button>
      @if (!isThisMonth()) {
        <button mat-button (click)="thisMonth()">This month</button>
      }
      <span class="spacer"></span>
      @if (safe() && !safe()!.hasOpeningBalance) {
        <button mat-stroked-button (click)="enter('OpeningBalance')"><mat-icon>flag</mat-icon> Opening balance</button>
      }
      <button mat-stroked-button (click)="enter('Funding')"><mat-icon>savings</mat-icon> Add funding</button>
      <button mat-stroked-button (click)="enter('RevenueTransfer')"><mat-icon>point_of_sale</mat-icon> Takings in</button>
      <button mat-stroked-button (click)="enter('ExpenseVoucher')"><mat-icon>receipt</mat-icon> Expense voucher</button>
      <button mat-flat-button (click)="enter('SupplierPayment')"><mat-icon>payments</mat-icon> Pay a supplier</button>
    </div>
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    @if (error()) {
      <p class="error">{{ error() }}</p>
    } @else if (safe(); as s) {
      @if (!s.hasOpeningBalance) {
        <p class="note">
          The safe has no opening balance yet: enter the cash in it as the treasury starts, and whether it was carried over or put in by the owners.
          <span class="inline-ar">أدخل الرصيد الافتتاحي للخزنة.</span>
        </p>
      }
      <div class="strip" role="list" aria-label="The month's safe, from start to finish">
        <div class="tile" role="listitem">
          <span class="label">Total cash revenue <span class="ar">إجمالي إيراد الكاش</span></span>
          <strong>{{ s.cashTakings ?? 0 | money }}</strong>
        </div>
        <div class="tile" role="listitem">
          <span class="label">Total Visa revenue <span class="ar">إجمالي إيراد الفيزا</span></span>
          <strong>{{ s.cardTakings ?? 0 | money }}</strong>
        </div>
        <div class="tile" role="listitem">
          <span class="label">Total tax collected <span class="ar">إجمالي الضريبة</span></span>
          <strong>{{ s.taxCollected ?? 0 | money }}</strong>
          <small class="muted">{{ s.taxOwedNow ?? 0 | money }} held for the tax authority now</small>
        </div>
        <div class="tile" role="listitem">
          <span class="label">Total in / receipts <span class="ar">إجمالي الوارد / المقبوضات</span></span>
          <strong class="in">{{ s.totalIn ?? 0 | money }}</strong>
          <small class="muted">
            {{ s.openingBalance + (s.fundingIn ?? 0) | money }} opening balance &amp; external funding
            <span class="ar">الرصيد الافتتاحي والتمويل الخارجي</span>
          </small>
        </div>
        <div class="tile" role="listitem">
          <span class="label">Total out / payments <span class="ar">إجمالي المدفوعات / المنصرف</span></span>
          <strong class="out">{{ s.totalOut ?? 0 | money }}</strong>
        </div>
        <div class="tile key" role="listitem">
          <span class="label">In the safe now <span class="ar">رصيد الخزنة الحالي</span></span>
          <strong [class.negative]="s.balanceNow < 0">{{ s.balanceNow | money }}</strong>
        </div>
        <div class="tile" role="listitem">
          <span class="label">Closing balance <span class="ar">الرصيد الختامي</span></span>
          <strong [class.negative]="s.closingBalance < 0">{{ s.closingBalance | money }}</strong>
          <small class="muted">in less out, {{ isThisMonth() ? 'so far' : 'carried over to the next month' }}</small>
        </div>
      </div>
      @if (s.voidedIn || s.voidedOut) {
        <p class="note voided-note">
          Not in In or Out: {{ s.voidedIn | money }} in and {{ s.voidedOut | money }} out, voided this month along with their reversals.
          <span class="inline-ar">لا تشمل القيود الملغاة.</span>
        </p>
      }

      @if (waiting().length) {
        <h3>Waiting for approval <span class="inline-ar">بانتظار موافقة المدير</span></h3>
        <ul class="waiting">
          @for (r of waiting(); track r.id) {
            <li>
              <span class="pending-badge">{{ pendingLabel(r).en }}<span class="ar">{{ pendingLabel(r).ar }}</span></span>
              {{ r.summary }} <span class="muted small">· asked by {{ r.requestedBy }}, {{ r.requestedAtUtc | date: 'd MMM, HH:mm' }}: no cash has moved</span>
            </li>
          }
        </ul>
      }

      <div class="table-wrap">
        <table class="grid">
          <thead>
            <tr>
              <th>Date<span class="ar">التاريخ</span></th>
              <th>Entry<span class="ar">البيان</span></th>
              <th class="num">In<span class="ar">وارد</span></th>
              <th class="num">Out<span class="ar">منصرف</span></th>
              <th class="num">Balance<span class="ar">الرصيد</span></th>
              <th>By<span class="ar">بواسطة</span></th>
              <th class="num"><span class="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            <tr class="opening">
              <td class="nowrap">{{ s.from | date: 'd MMM' }}</td>
              <td colspan="3">Opened with <span class="muted">· {{ openingText(s) }}</span></td>
              <td class="num">{{ s.openingBalance | money }}</td>
              <td colspan="2"></td>
            </tr>
            @for (e of s.entries; track e.id) {
              @let asked = approvals.pendingFor(e.id);
              <tr [class.voided]="!!e.voidedAtUtc" [class.reversal]="!!e.reversalOf" [class.pending-deletion]="!!asked">
                <td class="nowrap">{{ e.date | date: 'd MMM' }}</td>
                <td>
                  <span class="kind" [class]="e.kind">{{ kinds[e.kind].en }}</span> {{ e.description }}
                  <app-takings-badges [entry]="e" />
                  @if (e.notes && !e.reversalOf) {
                    <div class="muted small">{{ e.notes }}</div>
                  }
                  @if (e.voidedAtUtc) {
                    <div><span class="voided-badge">Voided<span class="ar">ملغى</span></span>
                      <span class="muted small"> by {{ e.voidedBy }}, {{ e.voidedAtUtc | date: 'd MMM' }}</span></div>
                  } @else if (asked) {
                    <div><span class="pending-badge">{{ pendingLabel(asked).en }}<span class="ar">{{ pendingLabel(asked).ar }}</span></span>
                      <span class="muted small"> by {{ asked.requestedBy }}</span></div>
                  }
                </td>
                <td class="num in">{{ e.in ? (e.in | money) : '' }}</td>
                <td class="num out">{{ e.out ? (e.out | money) : '' }}</td>
                <td class="num" [class.negative]="(e.balance ?? 0) < 0">{{ e.balance === null ? '' : (e.balance | money) }}</td>
                <td>
                  {{ e.recordedBy || '—' }}
                  @if (e.approvedBy) {
                    <div class="muted small">approved by {{ e.approvedBy }}</div>
                  }
                </td>
                <td class="num">
                  @if (!e.voidedAtUtc && !e.reversalOf) {
                    @if (asked) {
                      <mat-icon class="locked" matTooltip="Waiting for a manager's approval">lock_clock</mat-icon>
                    } @else {
                      <button mat-icon-button class="danger" (click)="voidEntry(e)" matTooltip="Void" [attr.aria-label]="'Void ' + e.description">
                        <mat-icon>delete</mat-icon>
                      </button>
                    }
                  }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="7" class="muted">Nothing in or out of the safe this month.</td></tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .month {
      min-width: 140px;
      text-align: center;
      font: var(--mat-sys-title-medium);
    }
    /* Seven cards in order: in one row where there is room for them, four and three on a laptop,
       two to a row on a phone; an amount wraps before it would be cut off. */
    .strip {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin-bottom: 16px;

      .tile {
        align-content: start;
        padding: 12px 14px;
      }
      .label {
        display: grid;
        line-height: 1.3;
      }
      .ar {
        font-size: 11px;
        opacity: 0.8;
      }
      strong {
        font: var(--mat-sys-title-large);
        font-variant-numeric: tabular-nums;
        overflow-wrap: anywhere;
      }
      small {
        display: grid;
        font-size: 11.5px;
        line-height: 1.35;
      }
    }
    @media (min-width: 900px) {
      .strip {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }
    }
    @media (min-width: 1800px) {
      .strip {
        grid-template-columns: repeat(7, minmax(0, 1fr));
      }
    }
    h3 {
      margin: 16px 0 8px;
      font: var(--mat-sys-title-small);
    }
    .waiting {
      margin: 0 0 16px;
      padding: 0;
      list-style: none;
      display: grid;
      gap: 4px;
    }
    tr.opening td {
      background: var(--mat-sys-surface-container);
      font-weight: 500;
    }
    tr.voided td {
      color: var(--mat-sys-on-surface-variant);
    }
    tr.reversal td {
      color: var(--mat-sys-on-surface-variant);
      font-style: italic;
    }
    .in {
      color: var(--app-ok);
    }
    .out,
    .negative {
      color: var(--mat-sys-error);
    }
    .small {
      font-size: 0.85em;
    }
    .nowrap {
      white-space: nowrap;
    }
    .danger {
      color: var(--mat-sys-error);
    }
  `,
})
export class SafePage {
  private readonly api = inject(CostingApi);
  private readonly treasury = inject(Treasury);
  protected readonly approvals = inject(Approvals);
  protected readonly pendingLabel = pendingLabel;
  protected readonly kinds = safeKindLabels;

  protected readonly year = signal(new Date().getFullYear());
  protected readonly month = signal(new Date().getMonth() + 1);
  protected readonly safe = signal<SafeMonth | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly monthStart = computed(() => new Date(this.year(), this.month() - 1, 1));
  protected readonly isThisMonth = computed(() => this.year() === new Date().getFullYear() && this.month() === new Date().getMonth() + 1);
  // New safe entries asked for, and invoices whose cash payment waits: no cash has moved for them.
  protected readonly waiting = computed(() => this.approvals.waitingToBeMade('Treasury'));

  constructor() {
    void this.load();
    void this.approvals.refresh();
  }

  protected openingText(s: SafeMonth): string {
    switch (s.openingKind) {
      case 'CarriedOver':
        return 'carried over from the month before · رصيد مرحل';
      case 'OpeningEntry':
        return `the treasury opened this month${s.openingSource ? ': ' + fundingSourceLabels[s.openingSource].en.toLowerCase() : ''}`;
      default:
        return 'no opening balance yet';
    }
  }

  protected move(by: number): void {
    const next = new Date(this.year(), this.month() - 1 + by, 1);
    this.year.set(next.getFullYear());
    this.month.set(next.getMonth() + 1);
    void this.load();
  }

  protected thisMonth(): void {
    this.year.set(new Date().getFullYear());
    this.month.set(new Date().getMonth() + 1);
    void this.load();
  }

  protected async enter(kind: SafeTransactionKind): Promise<void> {
    if (await this.treasury.enter(kind)) {
      await this.load();
    }
  }

  // Voided for a manager (its cash goes back, dated today); asked of one for anyone else.
  protected async voidEntry(entry: SafeEntry): Promise<void> {
    const what = `the ${this.kinds[entry.kind].en.toLowerCase()} of ${new Date(entry.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
    if ((await this.approvals.delete('Treasury', entry.id, what, entry.description)) === 'Applied') {
      await this.load();
    }
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.safe.set(await firstValueFrom(this.api.safe(this.year(), this.month())));
    } catch (error) {
      this.error.set(errorMessage(error, 'The safe could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }
}
```


> 📄 **`frontend/src/app/features/costing/takings-badges.ts`** — 73 سطر

```ts
import { Component, computed, input } from '@angular/core';
import { SafeEntry } from '../../core/costing/costing.api';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { entryTax } from './financials';

// A day's takings on a ledger line, as badges: the cash and the Visa before tax, the tax collected
// on them (at the till's rate, when it was worked out at it), the net sales they come to, and what
// was paid straight out of them before they went into the safe. Nothing for any other entry.
@Component({
  selector: 'app-takings-badges',
  imports: [MoneyPipe],
  template: `
    @if (figures(); as t) {
      <span class="badges">
        <span class="chip cash">Cash <span class="ar">كاش</span> <b>{{ t.cash | money }}</b></span>
        <span class="chip visa">Visa <span class="ar">فيزا</span> <b>{{ t.card | money }}</b></span>
        <span class="chip tax"
          >Tax <span class="ar">ضريبة</span> <b>{{ t.tax | money }}</b>{{ t.percent !== null ? ' at ' + t.percent + '%' : '' }}</span
        >
        <span class="chip net">Net sales <span class="ar">صافي المبيعات</span> <b>{{ t.net | money }}</b></span>
        @if (t.paidOut) {
          <span class="chip paid">Paid out of it <span class="ar">منصرف منه</span> <b>{{ t.paidOut | money }}</b></span>
        }
      </span>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .badges {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 6px;
      margin-top: 4px;
    }
    .chip {
      display: inline-flex;
      align-items: baseline;
      gap: 4px;
      padding: 1px 8px;
      border-radius: 999px;
      border: 1px solid var(--app-slate-200, #e2e8f0);
      background: var(--app-slate-50, #f8fafc);
      color: var(--app-slate-600, #475569);
      font-size: 12px;
      line-height: 20px;
      white-space: nowrap;

      b {
        color: var(--app-slate-800, #1e293b);
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }
      .ar {
        opacity: 0.75;
        font-size: 11px;
      }
    }
    .chip.net {
      border-color: color-mix(in srgb, var(--mat-sys-primary) 35%, transparent);
      background: color-mix(in srgb, var(--mat-sys-primary) 8%, transparent);
    }
    .chip.tax {
      border-color: color-mix(in srgb, var(--app-warn) 40%, transparent);
      background: color-mix(in srgb, var(--app-warn) 8%, transparent);
    }
  `,
})
export class TakingsBadges {
  readonly entry = input.required<SafeEntry>();
  protected readonly figures = computed(() => entryTax(this.entry()));
}
```


`FundingPage` (مصادر التمويل بالشهر)، `ReconciliationPage` (**المطابقة**: A صافي مبيعات اليوم مقابل B قيمة مبيعاته بأسعار المنيو؛ الفرق تحت = خصومات/وجبات موظفين/كاش ناقص، وفوق = أصناف لم تُدخل)، و `DailyCashPage` (**يومية الإيراد**: إجمالي اليوم ناقص ما دُفع من درجه مباشرة = ما وصل الخزنة).

> 📄 **`frontend/src/app/features/costing/funding-page.ts`** — 242 سطر

```ts
import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';
import { CostingApi, DayRevenue, DayRevenueReport, FundingReport, safeKindLabels } from '../../core/costing/costing.api';
import { errorMessage } from '../../core/http/error-message';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { Treasury, monthBounds } from './financials';
import { TakingsBadges } from './takings-badges';

// Funding sources (مصادر التمويل): every sum put into the safe in a month, by where it came from:
// carried over, the owners' financing, another source, and the days' cash takings. Below, each
// day's cash: what the till and cash-on-delivery took, the takings entered for it (gross), what was
// paid straight out of them, what of them went into the safe, and the till's cash not entered. A
// day's takings are entered from its row.
@Component({
  selector: 'app-funding-page',
  imports: [DatePipe, MatButtonModule, MatIconModule, MatProgressBarModule, MoneyPipe, TakingsBadges],
  template: `
    <div class="toolbar">
      <button mat-icon-button (click)="move(-1)" aria-label="The month before"><mat-icon>chevron_left</mat-icon></button>
      <strong class="month">{{ monthStart() | date: 'MMMM y' }}</strong>
      <button mat-icon-button (click)="move(1)" [disabled]="isThisMonth()" aria-label="The month after"><mat-icon>chevron_right</mat-icon></button>
      <span class="spacer"></span>
      <button mat-stroked-button (click)="enter('Funding')"><mat-icon>savings</mat-icon> Add funding</button>
    </div>
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    @if (error()) {
      <p class="error">{{ error() }}</p>
    } @else if (funding(); as f) {
      <div class="tiles">
        <div class="tile key">
          <span class="label">Put into the safe · إجمالي الوارد</span>
          <strong>{{ f.total | money }}</strong>
        </div>
        <div class="tile">
          <span class="label">Days' takings · توريد الإيرادات</span>
          <strong>{{ f.revenue | money }}</strong>
        </div>
        <div class="tile">
          <span class="label">Owners' financing · جاري الشركاء</span>
          <strong>{{ f.ownerFinancing | money }}</strong>
        </div>
        <div class="tile">
          <span class="label">Carried over · رصيد مرحل</span>
          <strong>{{ f.carriedOver | money }}</strong>
        </div>
        <div class="tile">
          <span class="label">Other · مصادر أخرى</span>
          <strong>{{ f.other | money }}</strong>
        </div>
      </div>

      <div class="table-wrap">
        <table class="grid">
          <thead>
            <tr>
              <th>Date<span class="ar">التاريخ</span></th>
              <th>Source<span class="ar">المصدر</span></th>
              <th class="num">Amount<span class="ar">المبلغ</span></th>
              <th>By<span class="ar">بواسطة</span></th>
            </tr>
          </thead>
          <tbody>
            @for (e of f.entries; track e.id) {
              <tr [class.voided]="!!e.voidedAtUtc || !!e.reversalOf">
                <td class="nowrap">{{ e.date | date: 'd MMM' }}</td>
                <td>
                  <span class="kind">{{ kinds[e.kind].en }}</span> {{ e.description }}
                  <app-takings-badges [entry]="e" />
                  @if (e.notes && !e.reversalOf) {
                    <div class="muted small">{{ e.notes }}</div>
                  }
                  @if (e.voidedAtUtc) {
                    <span class="voided-badge">Voided<span class="ar">ملغى</span></span>
                  }
                </td>
                <td class="num" [class.negative]="e.out > 0">{{ (e.in || -e.out) | money }}</td>
                <td>{{ e.recordedBy || '—' }}@if (e.approvedBy) {<div class="muted small">approved by {{ e.approvedBy }}</div>}</td>
              </tr>
            } @empty {
              <tr><td colspan="4" class="muted">Nothing put into the safe this month.</td></tr>
            }
          </tbody>
        </table>
      </div>
    }

    <h3>Each day's takings <span class="inline-ar">إيرادات الأيام</span></h3>
    <p class="note">
      Each business day's Z report, from the treasury's opening balance on: its cash and Visa sales before tax, and so its net sales, and the
      tax collected on them (owed, not revenue). All of it goes into the safe, less what was paid straight out of it. A day with sales and no
      takings yet is a click from entering them.
      <span class="note-ar" lang="ar" dir="rtl">تقرير Z لكل يوم: الكاش والفيزا وصافي المبيعات والضريبة المحصلة. الإجمالي كله يدخل الخزنة بعد خصم المنصرف منه.</span>
    </p>
    @if (revenue(); as r) {
      <div class="table-wrap">
        <table class="grid">
          <thead>
            <tr>
              <th>Day<span class="ar">اليوم</span></th>
              <th class="num">Cash<span class="ar">الكاش</span></th>
              <th class="num">Visa<span class="ar">الفيزا</span></th>
              <th class="num">Tax<span class="ar">الضريبة</span></th>
              <th class="num">Net sales<span class="ar">صافي المبيعات</span></th>
              <th class="num">Voids<span class="ar">الفويد</span></th>
              <th class="num">Paid out of it<span class="ar">مدفوع منه</span></th>
              <th class="num">Into the safe<span class="ar">مورد للخزنة</span></th>
              <th class="num"><span class="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (d of r.days; track d.date) {
              <tr>
                <td class="nowrap">{{ d.date | date: 'EEE d MMM' }}</td>
                @if (d.entered) {
                  <td class="num">{{ d.cash | money }}</td>
                  <td class="num">{{ d.card ? (d.card | money) : '—' }}</td>
                  <td class="num">{{ d.tax ? (d.tax | money) : '—' }}</td>
                  <td class="num strong">{{ d.netSales | money }}</td>
                  <td class="num">{{ d.voids ? (d.voids | money) : '—' }}</td>
                } @else {
                  <td colspan="5" class="muted">No takings entered · لم يُسجل الإيراد</td>
                }
                <td class="num">{{ d.paidOut ? (d.paidOut | money) : '—' }}</td>
                <td class="num">{{ d.transferred ? (d.transferred | money) : '—' }}</td>
                <td class="num">
                  @if (!d.entered) {
                    <button mat-stroked-button (click)="moveIn(d)"><mat-icon>move_to_inbox</mat-icon> Enter takings</button>
                  }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="9" class="muted">No takings or sales this month.</td></tr>
            }
          </tbody>
          @if (r.days.length) {
            <tfoot>
              <tr>
                <td>The month</td>
                <td class="num">{{ r.cash | money }}</td>
                <td class="num">{{ r.card | money }}</td>
                <td class="num">{{ r.tax | money }}</td>
                <td class="num strong">{{ r.netSales | money }}</td>
                <td class="num">{{ r.voids | money }}</td>
                <td class="num">{{ r.paidOut | money }}</td>
                <td class="num">{{ r.transferred | money }}</td>
                <td></td>
              </tr>
            </tfoot>
          }
        </table>
      </div>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .month {
      min-width: 140px;
      text-align: center;
      font: var(--mat-sys-title-medium);
    }
    h3 {
      margin: 24px 0 8px;
      font: var(--mat-sys-title-medium);
    }
    tr.voided td {
      color: var(--mat-sys-on-surface-variant);
    }
    .negative {
      color: var(--mat-sys-error);
    }
    .strong {
      font-weight: 600;
    }
    .small {
      font-size: 0.85em;
    }
    .nowrap {
      white-space: nowrap;
    }
  `,
})
export class FundingPage {
  private readonly api = inject(CostingApi);
  private readonly treasury = inject(Treasury);
  protected readonly kinds = safeKindLabels;


  protected readonly year = signal(new Date().getFullYear());
  protected readonly month = signal(new Date().getMonth() + 1);
  protected readonly funding = signal<FundingReport | null>(null);
  protected readonly revenue = signal<DayRevenueReport | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly monthStart = computed(() => new Date(this.year(), this.month() - 1, 1));
  protected readonly isThisMonth = computed(() => this.year() === new Date().getFullYear() && this.month() === new Date().getMonth() + 1);

  constructor() {
    void this.load();
  }

  protected move(by: number): void {
    const next = new Date(this.year(), this.month() - 1 + by, 1);
    this.year.set(next.getFullYear());
    this.month.set(next.getMonth() + 1);
    void this.load();
  }

  protected async enter(kind: 'Funding'): Promise<void> {
    if (await this.treasury.enter(kind)) {
      await this.load();
    }
  }

  // A day's takings entered from its Z report, its day chosen already.
  protected async moveIn(day: DayRevenue): Promise<void> {
    if (await this.treasury.enter('RevenueTransfer', { revenueDate: day.date })) {
      await this.load();
    }
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    const { from, to } = monthBounds(this.year(), this.month());
    try {
      const [funding, revenue] = await Promise.all([firstValueFrom(this.api.funding(from, to)), firstValueFrom(this.api.dayRevenue(from, to))]);
      this.funding.set(funding);
      this.revenue.set(revenue);
    } catch (error) {
      this.error.set(errorMessage(error, 'The funding could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }
}
```


> 📄 **`frontend/src/app/features/costing/reconciliation-page.ts`** — 176 سطر

```ts
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';
import { CostingApi, ReconciliationReport } from '../../core/costing/costing.api';
import { errorMessage } from '../../core/http/error-message';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { monthBounds } from './financials';

// The reconciliation (مطابقة الإيرادات): each business day's net sales against what it sold at the
// menu's prices. A is the day's takings, cash and Visa, before the tax collected on them. B is every
// item of the day's sales summary at its menu price, before tax. The difference shows a day short
// (discounts, staff meals, cash missing) or over (money taken for items not entered).
@Component({
  selector: 'app-reconciliation-page',
  imports: [DatePipe, MatButtonModule, MatIconModule, MatProgressBarModule, MoneyPipe, NgTemplateOutlet],
  template: `
    <div class="toolbar">
      <button mat-icon-button (click)="move(-1)" aria-label="The month before"><mat-icon>chevron_left</mat-icon></button>
      <strong class="month">{{ monthStart() | date: 'MMMM y' }}</strong>
      <button mat-icon-button (click)="move(1)" [disabled]="isThisMonth()" aria-label="The month after"><mat-icon>chevron_right</mat-icon></button>
    </div>
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    @if (error()) {
      <p class="error">{{ error() }}</p>
    } @else if (report(); as r) {
      <div class="tiles">
        <div class="tile key">
          <span class="label">Net sales (A) · صافي المبيعات</span>
          <strong>{{ r.total.netSales | money }}</strong>
        </div>
        <div class="tile">
          <span class="label">Sold at menu prices (B) · المبيعات بأسعار المنيو</span>
          <strong>{{ r.total.itemSales | money }}</strong>
        </div>
        <div class="tile difference" [class.short]="r.total.difference < 0" [class.over]="r.total.difference > 0">
          <span class="label">Difference · الفرق</span>
          <strong>{{ r.total.difference | money }}</strong>
        </div>
        <div class="tile">
          <span class="label">Tax collected · الضريبة المحصلة</span>
          <strong>{{ r.total.tax | money }}</strong>
          <small class="muted">owed, not revenue</small>
        </div>
        <div class="tile">
          <span class="label">Voids &amp; refunds · الفويد والمرتجعات</span>
          <strong>{{ r.total.voids | money }}</strong>
        </div>
      </div>
      <p class="note">
        A: each day's takings as its Z report gave them, cash and Visa, before the tax collected on them. B: every item of the day's sales summary
        at its menu price, before tax. Below zero, the takings fall short of what was sold (discounts, staff meals, cash missing); above it,
        money came in for items not entered.
        <span class="note-ar" lang="ar" dir="rtl">الفرق بالسالب: الإيراد أقل من المبيعات بأسعار المنيو (خصومات أو وجبات عاملين أو عجز). بالموجب: إيراد لأصناف لم تُسجل.</span>
      </p>

      <ng-template #cells let-d>
        <td class="num">{{ d.cash | money }}</td>
        <td class="num">{{ d.card ? (d.card | money) : '—' }}</td>
        <td class="num">{{ d.tax ? (d.tax | money) : '—' }}</td>
        <td class="num strong">{{ d.netSales | money }}</td>
        <td class="num strong">{{ d.itemSales | money }}</td>
        <td class="num strong" [class.negative]="d.difference < 0" [class.over]="d.difference > 0">
          {{ d.difference | money }}
          @if (d.difference < 0) {
            <div class="small">short · عجز</div>
          } @else if (d.difference > 0) {
            <div class="small">not entered · زيادة</div>
          }
        </td>
        <td class="num">{{ d.voids ? (d.voids | money) : '—' }}</td>
      </ng-template>

      <div class="table-wrap">
        <table class="grid">
          <thead>
            <tr>
              <th>Day<span class="ar">اليوم</span></th>
              <th class="num">Cash<span class="ar">الكاش</span></th>
              <th class="num">Card<span class="ar">الفيزا</span></th>
              <th class="num">Tax<span class="ar">الضريبة</span></th>
              <th class="num">Net sales (A)<span class="ar">صافي المبيعات</span></th>
              <th class="num">At menu prices (B)<span class="ar">بأسعار المنيو</span></th>
              <th class="num">Difference<span class="ar">الفرق</span></th>
              <th class="num">Voids<span class="ar">الفويد</span></th>
            </tr>
          </thead>
          <tbody>
            @for (d of r.days; track d.date) {
              <tr>
                <td class="nowrap">{{ d.date | date: 'EEE d MMM' }}</td>
                <ng-container *ngTemplateOutlet="cells; context: { $implicit: d }" />
              </tr>
            } @empty {
              <tr><td colspan="8" class="muted">Nothing sold or entered this month.</td></tr>
            }
          </tbody>
          @if (r.days.length) {
            <tfoot>
              <tr>
                <td>The month</td>
                <ng-container *ngTemplateOutlet="cells; context: { $implicit: r.total }" />
              </tr>
            </tfoot>
          }
        </table>
      </div>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .month {
      min-width: 140px;
      text-align: center;
      font: var(--mat-sys-title-medium);
    }
    .negative,
    .tile.short strong {
      color: var(--mat-sys-error);
    }
    .over,
    .tile.over strong {
      color: var(--app-warn);
    }
    .strong {
      font-weight: 600;
    }
    .small {
      font-size: 0.8em;
      font-weight: 400;
    }
    .nowrap {
      white-space: nowrap;
    }
  `,
})
export class ReconciliationPage {
  private readonly api = inject(CostingApi);

  protected readonly year = signal(new Date().getFullYear());
  protected readonly month = signal(new Date().getMonth() + 1);
  protected readonly report = signal<ReconciliationReport | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly monthStart = computed(() => new Date(this.year(), this.month() - 1, 1));
  protected readonly isThisMonth = computed(() => this.year() === new Date().getFullYear() && this.month() === new Date().getMonth() + 1);

  constructor() {
    void this.load();
  }

  protected move(by: number): void {
    const next = new Date(this.year(), this.month() - 1 + by, 1);
    this.year.set(next.getFullYear());
    this.month.set(next.getMonth() + 1);
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    const { from, to } = monthBounds(this.year(), this.month());
    try {
      this.report.set(await firstValueFrom(this.api.reconciliation(from, to)));
    } catch (error) {
      this.error.set(errorMessage(error, 'The reconciliation could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }
}
```


> 📄 **`frontend/src/app/features/costing/daily-cash-page.ts`** — 308 سطر

```ts
import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { CostingApi, DailyCashDay, DailyCashReport } from '../../core/costing/costing.api';
import { errorMessage } from '../../core/http/error-message';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { monthBounds } from './financials';

// The daily cash (يومية الإيراد): each day's takings as they were spent, month by month. The gross
// entered for a day, less the invoices paid straight out of its takings, is what of it is in the
// safe. A day opens to its takings and invoices. Read only: the safe is as it is. Expense vouchers
// are paid from the safe, never from a day's takings, so they are not here.
@Component({
  selector: 'app-daily-cash-page',
  imports: [DatePipe, MatButtonModule, MatIconModule, MatProgressBarModule, MoneyPipe, RouterLink],
  template: `
    <div class="toolbar">
      <button mat-icon-button (click)="move(-1)" aria-label="The month before"><mat-icon>chevron_left</mat-icon></button>
      <strong class="month">{{ monthStart() | date: 'MMMM y' }}</strong>
      <button mat-icon-button (click)="move(1)" [disabled]="isThisMonth()" aria-label="The month after"><mat-icon>chevron_right</mat-icon></button>
      @if (!isThisMonth()) {
        <button mat-button (click)="thisMonth()">This month</button>
      }
    </div>
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    @if (error()) {
      <p class="error">{{ error() }}</p>
    } @else if (report(); as r) {
      <div class="tiles">
        <div class="tile key">
          <span class="label">Gross takings · إجمالي الإيراد</span>
          <strong>{{ r.gross | money }}</strong>
        </div>
        <div class="tile">
          <span class="label">Total deductions · إجمالي المنصرف</span>
          <strong class="out">{{ r.deductions | money }}</strong>
        </div>
        <div class="tile">
          <span class="label">Net to safe · الصافي للخزنة</span>
          <strong class="in">{{ r.netToSafe | money }}</strong>
        </div>
      </div>
      <p class="note">
        Each day's takings as entered, gross, less the invoices paid straight out of them: the rest is in the safe. Open a day for its
        invoices. Expense vouchers are paid from the safe, so they are not here; voided entries are left out.
        <span class="inline-ar">إجمالي الإيراد ناقص ما صرف منه للفواتير = الصافي للخزنة.</span>
      </p>

      <div class="table-wrap">
        <table class="grid">
          <thead>
            <tr>
              <th class="toggle"><span class="visually-hidden">Open</span></th>
              <th>Date<span class="ar">تاريخ اليومية</span></th>
              <th class="num">Gross takings<span class="ar">إجمالي الإيراد المسجل</span></th>
              <th class="num">Total deductions<span class="ar">إجمالي المنصرف</span></th>
              <th class="num">Net to safe<span class="ar">الصافي للخزنة</span></th>
            </tr>
          </thead>
          <tbody>
            @for (d of r.days; track d.date) {
              <tr class="clickable day" [class.open]="isOpen(d)" (click)="toggle(d)">
                <td class="toggle">
                  <button
                    mat-icon-button
                    [attr.aria-expanded]="isOpen(d)"
                    [attr.aria-label]="(isOpen(d) ? 'Close ' : 'Open ') + (d.date | date: 'd MMM')"
                    (click)="$event.stopPropagation(); toggle(d)"
                  >
                    <mat-icon>{{ isOpen(d) ? 'expand_more' : 'chevron_right' }}</mat-icon>
                  </button>
                </td>
                <td class="nowrap">{{ d.date | date: 'EEE d MMM' }}</td>
                <td class="num strong">{{ d.gross | money }}</td>
                <td class="num">{{ d.deductions ? (d.deductions | money) : '—' }}</td>
                <td class="num">{{ d.netToSafe ? (d.netToSafe | money) : '—' }}</td>
              </tr>
              @if (isOpen(d)) {
                <tr class="details">
                  <td colspan="5">
                    <h4>Takings entered <span class="inline-ar">الإيراد المسجل</span></h4>
                    @if (d.entered.length) {
                      <table class="lines">
                        <tbody>
                          @for (l of d.entered; track l.id) {
                            <tr class="entered">
                              <td class="when muted">{{ l.date | date: 'd MMM' }}</td>
                              <td>{{ l.description }}</td>
                              <td class="num">{{ l.amount | money }}</td>
                              <td class="by">{{ l.recordedBy }}</td>
                            </tr>
                          }
                        </tbody>
                      </table>
                    } @else {
                      <p class="muted small">Not entered yet.</p>
                    }
                    <h4>Paid out of these takings <span class="inline-ar">المنصرف من الإيراد</span></h4>
                    @if (d.paid.length) {
                      <table class="lines">
                        <tbody>
                          @for (l of d.paid; track l.id) {
                            <tr class="paid">
                              <td class="when muted">{{ l.date | date: 'd MMM' }}</td>
                              <td>
                                @if (l.purchaseInvoiceId) {
                                  <a [routerLink]="['/costing/purchases/invoices', l.purchaseInvoiceId]">{{ l.description }}</a>
                                } @else {
                                  {{ l.description }}
                                }
                                @if (l.items.length) {
                                  <div class="muted small">{{ l.items.join(', ') }}</div>
                                }
                              </td>
                              <td class="num">{{ l.amount | money }}</td>
                              <td class="by">
                                {{ l.recordedBy }}
                                @if (l.approvedBy) {
                                  <span class="muted small">approved by {{ l.approvedBy }}</span>
                                }
                              </td>
                            </tr>
                          }
                        </tbody>
                      </table>
                    } @else {
                      <p class="muted small">Nothing was paid out of these takings.</p>
                    }
                  </td>
                </tr>
              }
            } @empty {
              <tr><td colspan="5" class="muted">No takings entered or paid out this month.</td></tr>
            }
          </tbody>
          @if (r.days.length) {
            <tfoot>
              <tr>
                <td></td>
                <td>The month</td>
                <td class="num">{{ r.gross | money }}</td>
                <td class="num">{{ r.deductions | money }}</td>
                <td class="num">{{ r.netToSafe | money }}</td>
              </tr>
            </tfoot>
          }
        </table>
      </div>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .month {
      min-width: 140px;
      text-align: center;
      font: var(--mat-sys-title-medium);
    }
    .in {
      color: var(--app-ok);
    }
    .out {
      color: var(--mat-sys-error);
    }
    .strong {
      font-weight: 600;
    }
    .small {
      font-size: 0.85em;
    }
    .nowrap {
      white-space: nowrap;
    }
    table.grid th.toggle,
    table.grid td.toggle {
      width: 48px;
      padding: 0 0 0 4px;
    }
    tr.day.open td {
      background: var(--mat-sys-surface-container-low);
      border-bottom-color: transparent;
    }
    tr.details > td {
      padding: 4px 16px 16px 56px;
      background: var(--mat-sys-surface-container-low);
    }
    h4 {
      margin: 8px 0 4px;
      font: var(--mat-sys-title-small);
    }
    // The invoices and the counts line up: the same widths in both.
    table.lines {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    table.lines td {
      padding: 6px 8px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      vertical-align: top;
    }
    table.lines tr:last-child td {
      border-bottom: none;
    }
    table.lines td.when {
      width: 64px;
      white-space: nowrap;
    }
    table.lines td.num {
      width: 120px;
    }
    table.lines td.by {
      width: 170px;
    }
    table.lines td.by .small {
      display: block;
    }
    table.lines a {
      color: var(--mat-sys-primary);
      font-weight: 500;
      text-decoration: none;
    }
    table.lines a:hover,
    table.lines a:focus-visible {
      text-decoration: underline;
    }
    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
    }
    @media (max-width: 599px) {
      tr.details > td {
        padding-inline-start: 12px;
      }
      table.lines td.when {
        width: 48px;
      }
      table.lines td.num {
        width: 96px;
      }
      table.lines td.by {
        display: none;
      }
    }
  `,
})
export class DailyCashPage {
  private readonly api = inject(CostingApi);

  protected readonly year = signal(new Date().getFullYear());
  protected readonly month = signal(new Date().getMonth() + 1);
  protected readonly report = signal<DailyCashReport | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  private readonly open = signal<ReadonlySet<string>>(new Set());

  protected readonly monthStart = computed(() => new Date(this.year(), this.month() - 1, 1));
  protected readonly isThisMonth = computed(() => this.year() === new Date().getFullYear() && this.month() === new Date().getMonth() + 1);

  constructor() {
    void this.load();
  }

  protected isOpen(day: DailyCashDay): boolean {
    return this.open().has(day.date);
  }

  protected toggle(day: DailyCashDay): void {
    const open = new Set(this.open());
    if (!open.delete(day.date)) open.add(day.date);
    this.open.set(open);
  }

  protected move(by: number): void {
    const next = new Date(this.year(), this.month() - 1 + by, 1);
    this.year.set(next.getFullYear());
    this.month.set(next.getMonth() + 1);
    void this.load();
  }

  protected thisMonth(): void {
    this.year.set(new Date().getFullYear());
    this.month.set(new Date().getMonth() + 1);
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    this.open.set(new Set());
    const { from, to } = monthBounds(this.year(), this.month());
    try {
      this.report.set(await firstValueFrom(this.api.dailyCash(from, to)));
    } catch (error) {
      this.error.set(errorMessage(error, 'The daily cash could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }
}
```


المصروفات والموردون:

> 📄 **`frontend/src/app/features/costing/expense-vouchers-page.ts`** — 204 سطر

```ts
import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import { CostingApi, ExpenseVoucherReport, ExpenseVoucherRow } from '../../core/costing/costing.api';
import { errorMessage } from '../../core/http/error-message';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { Approvals, pendingLabel } from './approvals';
import { Treasury, monthBounds } from './financials';

// Expense vouchers (إذن صرف مصروفات): cash paid out of the safe for an expense (a bill, wages,
// petty cash), each under its expense item, so it counts on the profit and loss under its
// category, as an invoice's expense line does. The tax paid over (سداد ضرائب) is listed with them,
// marked, and never counted as an expense. A month at a time; voided ones are kept, struck out.
@Component({
  selector: 'app-expense-vouchers-page',
  imports: [DatePipe, MatButtonModule, MatIconModule, MatProgressBarModule, MatTooltipModule, MoneyPipe],
  template: `
    <div class="toolbar">
      <button mat-icon-button (click)="move(-1)" aria-label="The month before"><mat-icon>chevron_left</mat-icon></button>
      <strong class="month">{{ monthStart() | date: 'MMMM y' }}</strong>
      <button mat-icon-button (click)="move(1)" [disabled]="isThisMonth()" aria-label="The month after"><mat-icon>chevron_right</mat-icon></button>
      <span class="spacer"></span>
      @if (report(); as r) {
        <span class="muted">
          {{ r.total | money }} of expenses
          @if (r.taxPaid) {
            · {{ r.taxPaid | money }} tax paid over
          }
        </span>
      }
      <button mat-flat-button (click)="add()"><mat-icon>add</mat-icon> New expense voucher</button>
    </div>
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    @if (error()) {
      <p class="error">{{ error() }}</p>
    } @else if (report(); as r) {
      @if (waiting().length) {
        <ul class="waiting">
          @for (w of waiting(); track w.id) {
            <li>
              <span class="pending-badge">{{ pendingLabel(w).en }}<span class="ar">{{ pendingLabel(w).ar }}</span></span>
              {{ w.summary }} <span class="muted small">· asked by {{ w.requestedBy }}: no cash has moved</span>
            </li>
          }
        </ul>
      }
      <div class="table-wrap">
        <table class="grid">
          <thead>
            <tr>
              <th>Date<span class="ar">التاريخ</span></th>
              <th>Expense<span class="ar">المصروف</span></th>
              <th>Category<span class="ar">الفئة</span></th>
              <th class="num">Amount<span class="ar">المبلغ</span></th>
              <th>By<span class="ar">بواسطة</span></th>
              <th class="num"><span class="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (v of r.vouchers; track v.id) {
              @let asked = approvals.pendingFor(v.id);
              <tr [class.voided]="!!v.voidedAtUtc" [class.pending-deletion]="!!asked">
                <td class="nowrap">{{ v.date | date: 'd MMM' }}</td>
                <td>
                  {{ v.expenseItem }}
                  @if (v.isTaxPayment) {
                    <span class="tax-badge">Not an expense<span class="ar">ليس مصروفًا</span></span>
                  }
                  @if (v.notes) {
                    <div class="muted small">{{ v.notes }}</div>
                  }
                  @if (v.voidedAtUtc) {
                    <div><span class="voided-badge">Voided<span class="ar">ملغى</span></span>
                      <span class="muted small"> by {{ v.voidedBy }}, {{ v.voidedAtUtc | date: 'd MMM' }}</span></div>
                  } @else if (asked) {
                    <div><span class="pending-badge">{{ pendingLabel(asked).en }}<span class="ar">{{ pendingLabel(asked).ar }}</span></span></div>
                  }
                </td>
                <td>{{ v.category ?? '—' }}</td>
                <td class="num">{{ v.amount | money }}</td>
                <td>{{ v.recordedBy || '—' }}@if (v.approvedBy) {<div class="muted small">approved by {{ v.approvedBy }}</div>}</td>
                <td class="num">
                  @if (!v.voidedAtUtc) {
                    @if (asked) {
                      <mat-icon class="locked" matTooltip="Waiting for a manager's approval">lock_clock</mat-icon>
                    } @else {
                      <button mat-icon-button class="danger" (click)="voidVoucher(v)" matTooltip="Void" [attr.aria-label]="'Void ' + v.expenseItem">
                        <mat-icon>delete</mat-icon>
                      </button>
                    }
                  }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="6" class="muted">No expense vouchers this month.</td></tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .tax-badge {
      margin-inline-start: 6px;
      padding: 0 8px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--app-warn) 14%, transparent);
      color: var(--app-warn);
      font: var(--mat-sys-label-small);

      .ar {
        margin-inline-start: 4px;
      }
    }
    .month {
      min-width: 140px;
      text-align: center;
      font: var(--mat-sys-title-medium);
    }
    .waiting {
      margin: 0 0 12px;
      padding: 0;
      list-style: none;
      display: grid;
      gap: 4px;
    }
    tr.voided td {
      color: var(--mat-sys-on-surface-variant);
      text-decoration: line-through;
      text-decoration-color: color-mix(in srgb, currentColor 40%, transparent);
    }
    .small {
      font-size: 0.85em;
    }
    .nowrap {
      white-space: nowrap;
    }
    .danger {
      color: var(--mat-sys-error);
    }
  `,
})
export class ExpenseVouchersPage {
  private readonly api = inject(CostingApi);
  private readonly treasury = inject(Treasury);
  protected readonly approvals = inject(Approvals);
  protected readonly pendingLabel = pendingLabel;

  protected readonly year = signal(new Date().getFullYear());
  protected readonly month = signal(new Date().getMonth() + 1);
  protected readonly report = signal<ExpenseVoucherReport | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly monthStart = computed(() => new Date(this.year(), this.month() - 1, 1));
  protected readonly isThisMonth = computed(() => this.year() === new Date().getFullYear() && this.month() === new Date().getMonth() + 1);
  // Vouchers asked for, not paid yet.
  protected readonly waiting = computed(() => this.approvals.waitingToBeMade('Treasury').filter((r) => r.summary.startsWith('Expense voucher')));

  constructor() {
    void this.load();
    void this.approvals.refresh();
  }

  protected move(by: number): void {
    const next = new Date(this.year(), this.month() - 1 + by, 1);
    this.year.set(next.getFullYear());
    this.month.set(next.getMonth() + 1);
    void this.load();
  }

  protected async add(): Promise<void> {
    if (await this.treasury.enter('ExpenseVoucher')) {
      await this.load();
    }
  }

  protected async voidVoucher(voucher: ExpenseVoucherRow): Promise<void> {
    const day = new Date(voucher.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    if ((await this.approvals.delete('Treasury', voucher.id, `the ${voucher.expenseItem} voucher of ${day}`)) === 'Applied') {
      await this.load();
    }
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    const { from, to } = monthBounds(this.year(), this.month());
    try {
      this.report.set(await firstValueFrom(this.api.expenseVouchers(from, to)));
    } catch (error) {
      this.error.set(errorMessage(error, 'The expense vouchers could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }
}
```


> 📄 **`frontend/src/app/features/costing/supplier-debts-page.ts`** — 272 سطر

```ts
import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { CostingApi, Supplier, SupplierBalance, SupplierStatement } from '../../core/costing/costing.api';
import { errorMessage } from '../../core/http/error-message';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { Treasury } from './financials';

// Supplier debts (مديونيات الموردين): what the restaurant owes each supplier, from invoices bought
// on credit and what was owed before the treasury, less what was paid them. A supplier chosen
// shows their statement of account (كشف حساب): the credit invoices, the payments and the opening
// debt with the balance after each, and the invoices still owed (payments go to the oldest first).
// A payment voucher is issued from here.
@Component({
  selector: 'app-supplier-debts-page',
  imports: [DatePipe, FormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatProgressBarModule, MatSelectModule, MoneyPipe],
  template: `
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    @if (error()) {
      <p class="error">{{ error() }}</p>
    }
    <div class="tiles">
      <div class="tile key">
        <span class="label">Owed to suppliers · إجمالي المديونيات</span>
        <strong>{{ totalOwed() | money }}</strong>
      </div>
      <div class="tile">
        <span class="label">Suppliers owed · موردون دائنون</span>
        <strong>{{ owing().length }}</strong>
      </div>
    </div>
    <div class="table-wrap">
      <table class="grid">
        <thead>
          <tr>
            <th>Supplier<span class="ar">المورد</span></th>
            <th class="num">Credit purchases<span class="ar">إجمالي الفواتير الآجلة</span></th>
            <th class="num">Owed before<span class="ar">رصيد سابق</span></th>
            <th class="num">Paid<span class="ar">إجمالي المدفوعات</span></th>
            <th class="num">Owed now<span class="ar">الرصيد المتبقي</span></th>
            <th>Last paid<span class="ar">آخر سداد</span></th>
          </tr>
        </thead>
        <tbody>
          @for (b of balances(); track b.supplierId) {
            <tr class="clickable" [class.chosen]="b.supplierId === supplierId()" (click)="choose(b.supplierId)">
              <td>{{ b.supplier }}@if (b.isArchived) {<span class="muted"> · archived</span>}</td>
              <td class="num">{{ b.creditPurchases | money }}</td>
              <td class="num">{{ b.openingDebt ? (b.openingDebt | money) : '—' }}</td>
              <td class="num">{{ b.payments | money }}</td>
              <td class="num strong" [class.owed]="b.balance > 0">{{ b.balance | money }}</td>
              <td class="nowrap">{{ b.lastPaidOn ? (b.lastPaidOn | date: 'd MMM y') : '—' }}</td>
            </tr>
          } @empty {
            <tr><td colspan="6" class="muted">No supplier is owed anything. Invoices bought on credit show here.</td></tr>
          }
        </tbody>
      </table>
    </div>

    <div class="toolbar statement-bar">
      <mat-form-field subscriptSizing="dynamic" class="supplier">
        <mat-label>Statement of account for · كشف حساب</mat-label>
        <mat-select [ngModel]="supplierId()" (ngModelChange)="choose($event)" aria-label="Supplier">
          @for (s of suppliers(); track s.id) {
            <mat-option [value]="s.id">{{ s.name }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      @if (statement(); as st) {
        <span class="spacer"></span>
        <button mat-stroked-button (click)="opening(st)"><mat-icon>history</mat-icon> Owed from before</button>
        <button mat-flat-button (click)="pay(st)" [disabled]="st.balance <= 0"><mat-icon>payments</mat-icon> Pay {{ st.supplier }}</button>
      }
    </div>

    @if (statement(); as st) {
      <div class="tiles">
        <div class="tile">
          <span class="label">Credit purchases · إجمالي الفواتير الآجلة</span>
          <strong>{{ st.creditPurchases | money }}</strong>
          @if (st.openingDebt) {
            <small class="muted">and {{ st.openingDebt | money }} owed from before</small>
          }
        </div>
        <div class="tile">
          <span class="label">Payments made · إجمالي المدفوعات</span>
          <strong>{{ st.payments | money }}</strong>
        </div>
        <div class="tile key">
          <span class="label">Owed now · الرصيد المتبقي</span>
          <strong>{{ st.balance | money }}</strong>
          @if (st.balance < 0) {
            <small>{{ st.supplier }} owes the restaurant</small>
          }
        </div>
      </div>

      <h3>Invoices not fully paid <span class="inline-ar">فواتير غير مسددة</span></h3>
      <div class="table-wrap">
        <table class="grid">
          <thead>
            <tr>
              <th>Date<span class="ar">التاريخ</span></th>
              <th>Invoice no.<span class="ar">رقم الفاتورة</span></th>
              <th class="num">Total<span class="ar">الإجمالي</span></th>
              <th class="num">Paid<span class="ar">المسدد</span></th>
              <th class="num">Remaining<span class="ar">المتبقي</span></th>
              <th>Status<span class="ar">الحالة</span></th>
            </tr>
          </thead>
          <tbody>
            @for (i of st.openInvoices; track i.invoiceId) {
              <tr>
                <td class="nowrap">{{ i.date | date: 'd MMM y' }}</td>
                <td>{{ i.supplierInvoiceNumber ?? '—' }}</td>
                <td class="num">{{ i.total | money }}</td>
                <td class="num">{{ i.paid | money }}</td>
                <td class="num strong">{{ i.remaining | money }}</td>
                <td><span class="state" [class.partly]="i.status === 'PartlyPaid'">{{ i.status === 'PartlyPaid' ? 'Partly paid · مسددة جزئيًا' : 'Unpaid · غير مسددة' }}</span></td>
              </tr>
            } @empty {
              <tr><td colspan="6" class="muted">Every credit invoice is paid.</td></tr>
            }
          </tbody>
        </table>
      </div>

      <h3>Statement of account <span class="inline-ar">كشف الحساب</span></h3>
      <div class="table-wrap">
        <table class="grid">
          <thead>
            <tr>
              <th>Date<span class="ar">التاريخ</span></th>
              <th>Entry<span class="ar">البيان</span></th>
              <th class="num">Owed<span class="ar">مدين</span></th>
              <th class="num">Paid<span class="ar">دائن</span></th>
              <th class="num">Balance<span class="ar">الرصيد</span></th>
            </tr>
          </thead>
          <tbody>
            @for (l of st.lines; track l.id) {
              <tr [class.reversal]="l.isReversal">
                <td class="nowrap">{{ l.date | date: 'd MMM y' }}</td>
                <td>{{ l.description }}</td>
                <td class="num">{{ l.owed ? (l.owed | money) : '' }}</td>
                <td class="num">{{ l.paid ? (l.paid | money) : '' }}</td>
                <td class="num strong">{{ l.balance | money }}</td>
              </tr>
            } @empty {
              <tr><td colspan="5" class="muted">Nothing on {{ st.supplier }}'s account yet.</td></tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    h3 {
      margin: 20px 0 8px;
      font: var(--mat-sys-title-medium);
    }
    .statement-bar {
      margin-top: 20px;
    }
    .supplier {
      min-width: 280px;
    }
    tr.chosen td {
      background: var(--mat-sys-secondary-container);
    }
    tr.reversal td {
      color: var(--mat-sys-on-surface-variant);
      font-style: italic;
    }
    .owed {
      color: var(--mat-sys-error);
    }
    .strong {
      font-weight: 600;
    }
    .nowrap {
      white-space: nowrap;
    }
    .state {
      padding: 1px 8px;
      border-radius: 999px;
      font: var(--mat-sys-label-small);
      background: color-mix(in srgb, var(--mat-sys-error) 14%, transparent);

      &.partly {
        background: color-mix(in srgb, var(--app-warn) 22%, transparent);
      }
    }
  `,
})
export class SupplierDebtsPage {
  private readonly api = inject(CostingApi);
  private readonly treasury = inject(Treasury);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly balances = signal<SupplierBalance[]>([]);
  protected readonly suppliers = signal<Supplier[]>([]);
  protected readonly statement = signal<SupplierStatement | null>(null);
  protected readonly supplierId = signal<string | null>(this.route.snapshot.queryParamMap.get('supplier'));
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly owing = computed(() => this.balances().filter((b) => b.balance > 0));
  protected readonly totalOwed = computed(() => this.owing().reduce((sum, b) => sum + b.balance, 0));

  constructor() {
    void this.load();
  }

  protected choose(supplierId: string): void {
    this.supplierId.set(supplierId);
    void this.router.navigate([], { queryParams: { supplier: supplierId }, replaceUrl: true });
    void this.loadStatement();
  }

  protected async pay(statement: SupplierStatement): Promise<void> {
    if (await this.treasury.enter('SupplierPayment', { supplierId: statement.supplierId, amount: statement.balance })) {
      await this.load();
    }
  }

  protected async opening(statement: SupplierStatement): Promise<void> {
    if (await this.treasury.supplierOpening(statement.supplierId, statement.supplier)) {
      await this.load();
    }
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [balances, suppliers] = await Promise.all([firstValueFrom(this.api.supplierBalances()), firstValueFrom(this.api.suppliers(true))]);
      this.balances.set(balances);
      this.suppliers.set(suppliers);
      await this.loadStatement();
    } catch (error) {
      this.error.set(errorMessage(error, 'The supplier debts could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }

  private async loadStatement(): Promise<void> {
    const id = this.supplierId();
    if (!id) {
      this.statement.set(null);
      return;
    }
    try {
      this.statement.set(await firstValueFrom(this.api.supplierStatement(id)));
    } catch (error) {
      this.error.set(errorMessage(error, 'The statement could not be loaded.'));
    }
  }
}
```


> 📄 **`frontend/src/app/features/costing/supplier-payments-page.ts`** — 183 سطر

```ts
import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { CostingApi, SupplierPaymentRow } from '../../core/costing/costing.api';
import { errorMessage } from '../../core/http/error-message';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { Approvals, pendingLabel } from './approvals';
import { Treasury, monthBounds } from './financials';

// Supplier payment vouchers (أذونات صرف الموردين): cash paid from the safe to a supplier, each
// taken off what they are owed, a month at a time. A payment asked for by someone who may not
// approve is listed as waiting: no cash has moved and the debt is as it was.
@Component({
  selector: 'app-supplier-payments-page',
  imports: [DatePipe, MatButtonModule, MatIconModule, MatProgressBarModule, MatTooltipModule, MoneyPipe, RouterLink],
  template: `
    <div class="toolbar">
      <button mat-icon-button (click)="move(-1)" aria-label="The month before"><mat-icon>chevron_left</mat-icon></button>
      <strong class="month">{{ monthStart() | date: 'MMMM y' }}</strong>
      <button mat-icon-button (click)="move(1)" [disabled]="isThisMonth()" aria-label="The month after"><mat-icon>chevron_right</mat-icon></button>
      <span class="spacer"></span>
      <span class="muted">{{ total() | money }} paid</span>
      <button mat-flat-button (click)="add()"><mat-icon>add</mat-icon> New payment voucher</button>
    </div>
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    @if (error()) {
      <p class="error">{{ error() }}</p>
    } @else {
      @if (waiting().length) {
        <ul class="waiting">
          @for (w of waiting(); track w.id) {
            <li>
              <span class="pending-badge">{{ pendingLabel(w).en }}<span class="ar">{{ pendingLabel(w).ar }}</span></span>
              {{ w.summary }} <span class="muted small">· asked by {{ w.requestedBy }}: no cash has moved</span>
            </li>
          }
        </ul>
      }
      <div class="table-wrap">
        <table class="grid">
          <thead>
            <tr>
              <th>Date<span class="ar">التاريخ</span></th>
              <th>Supplier<span class="ar">المورد</span></th>
              <th class="num">Amount<span class="ar">المبلغ</span></th>
              <th>By<span class="ar">بواسطة</span></th>
              <th class="num"><span class="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (p of payments(); track p.id) {
              @let asked = approvals.pendingFor(p.id);
              <tr [class.voided]="!!p.voidedAtUtc" [class.pending-deletion]="!!asked">
                <td class="nowrap">{{ p.date | date: 'd MMM' }}</td>
                <td>
                  <a [routerLink]="['../suppliers']" [queryParams]="{ supplier: p.supplierId }">{{ p.supplier }}</a>
                  @if (p.fromTakingsOf) {
                    <div class="muted small">From the takings of {{ p.fromTakingsOf | date: 'd MMM' }} · من إيراد يوم</div>
                  }
                  @if (p.notes) {
                    <div class="muted small">{{ p.notes }}</div>
                  }
                  @if (p.voidedAtUtc) {
                    <div><span class="voided-badge">Voided<span class="ar">ملغى</span></span>
                      <span class="muted small"> by {{ p.voidedBy }}, {{ p.voidedAtUtc | date: 'd MMM' }}</span></div>
                  } @else if (asked) {
                    <div><span class="pending-badge">{{ pendingLabel(asked).en }}<span class="ar">{{ pendingLabel(asked).ar }}</span></span></div>
                  }
                </td>
                <td class="num">{{ p.amount | money }}</td>
                <td>{{ p.recordedBy || '—' }}@if (p.approvedBy) {<div class="muted small">approved by {{ p.approvedBy }}</div>}</td>
                <td class="num">
                  @if (!p.voidedAtUtc) {
                    @if (asked) {
                      <mat-icon class="locked" matTooltip="Waiting for a manager's approval">lock_clock</mat-icon>
                    } @else {
                      <button mat-icon-button class="danger" (click)="voidPayment(p)" matTooltip="Void" [attr.aria-label]="'Void the payment to ' + p.supplier">
                        <mat-icon>delete</mat-icon>
                      </button>
                    }
                  }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="5" class="muted">No payments to suppliers this month.</td></tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .month {
      min-width: 140px;
      text-align: center;
      font: var(--mat-sys-title-medium);
    }
    .waiting {
      margin: 0 0 12px;
      padding: 0;
      list-style: none;
      display: grid;
      gap: 4px;
    }
    tr.voided td {
      color: var(--mat-sys-on-surface-variant);
      text-decoration: line-through;
      text-decoration-color: color-mix(in srgb, currentColor 40%, transparent);
    }
    .small {
      font-size: 0.85em;
    }
    .nowrap {
      white-space: nowrap;
    }
    .danger {
      color: var(--mat-sys-error);
    }
  `,
})
export class SupplierPaymentsPage {
  private readonly api = inject(CostingApi);
  private readonly treasury = inject(Treasury);
  protected readonly approvals = inject(Approvals);
  protected readonly pendingLabel = pendingLabel;

  protected readonly year = signal(new Date().getFullYear());
  protected readonly month = signal(new Date().getMonth() + 1);
  protected readonly payments = signal<SupplierPaymentRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly monthStart = computed(() => new Date(this.year(), this.month() - 1, 1));
  protected readonly isThisMonth = computed(() => this.year() === new Date().getFullYear() && this.month() === new Date().getMonth() + 1);
  protected readonly total = computed(() => this.payments().filter((p) => !p.voidedAtUtc).reduce((sum, p) => sum + p.amount, 0));
  protected readonly waiting = computed(() => this.approvals.waitingToBeMade('Treasury').filter((r) => r.summary.startsWith('Supplier payment')));

  constructor() {
    void this.load();
    void this.approvals.refresh();
  }

  protected move(by: number): void {
    const next = new Date(this.year(), this.month() - 1 + by, 1);
    this.year.set(next.getFullYear());
    this.month.set(next.getMonth() + 1);
    void this.load();
  }

  protected async add(): Promise<void> {
    if (await this.treasury.enter('SupplierPayment')) {
      await this.load();
    }
  }

  protected async voidPayment(payment: SupplierPaymentRow): Promise<void> {
    const day = new Date(payment.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    if ((await this.approvals.delete('Treasury', payment.id, `the payment to ${payment.supplier} of ${day}`)) === 'Applied') {
      await this.load();
    }
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    const { from, to } = monthBounds(this.year(), this.month());
    try {
      this.payments.set(await firstValueFrom(this.api.supplierPayments(from, to)));
    } catch (error) {
      this.error.set(errorMessage(error, 'The payments could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }
}
```


> 📄 **`frontend/src/app/features/costing/supplier-payment-fields.ts`** — 128 سطر

```ts
import { Component, inject, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ErrorStateMatcher } from '@angular/material/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { SupplierBalance } from '../../core/costing/costing.api';
import { Company } from '../../core/settings/company';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { FormChecks, FormProblem } from './form-checks';

// Material's own: a field in error once touched and invalid.
const defaultMatcher = new ErrorStateMatcher();

// A supplier paid against what they are owed (سداد مورد): an old debt settled, no invoice and no
// stock. Its id is the payment's, made here: a retry pays once.
export interface SupplierPaymentEntry {
  id: string;
  supplierId: string | null;
  amount: number | null;
  notes: string;
}

export function newSupplierPayment(): SupplierPaymentEntry {
  return { id: crypto.randomUUID(), supplierId: null, amount: null, notes: '' };
}

// Who is paid, how much, and a note or receipt number: entered alike in the daily batch's payment
// blocks and on the new invoice screen's supplier payment. Only the suppliers owed something are
// offered, each with what they are owed; owed is what the chosen one is owed now (less the
// payments above it, in a batch: afterAbove), and more than that is flagged. Its fields sit in the
// form around it.
@Component({
  selector: 'app-supplier-payment-fields',
  imports: [FormsModule, MatFormFieldModule, MatInputModule, MatSelectModule, MoneyPipe],
  template: `
    <mat-form-field subscriptSizing="dynamic" class="supplier">
      <mat-label>Supplier · المورد</mat-label>
      <mat-select [(ngModel)]="payment().supplierId" (ngModelChange)="changed.emit()" [aria-label]="label() + ', supplier'"
        [errorStateMatcher]="marked(', supplier')">
        @for (s of suppliers(); track s.supplierId) {
          <mat-option [value]="s.supplierId">{{ s.supplier }} · owed {{ s.balance | money }}</mat-option>
        } @empty {
          <mat-option disabled>No supplier is owed anything: enter an old debt on Financials · Supplier debts</mat-option>
        }
      </mat-select>
      @if (owed(); as o) {
        <mat-hint>Owed {{ o | money }}{{ afterAbove() ? ' after the payments above' : '' }}</mat-hint>
      }
      <mat-error>{{ said(', supplier') }}</mat-error>
    </mat-form-field>
    <mat-form-field subscriptSizing="dynamic" class="amount">
      <mat-label>Payment amount · قيمة السداد</mat-label>
      <input matInput type="number" min="0" step="any" [(ngModel)]="payment().amount" (ngModelChange)="changed.emit()" [attr.aria-label]="label() + ', amount'"
        [errorStateMatcher]="marked(', amount')" />
      <span matTextSuffix>&nbsp;{{ company.currency() }}</span>
      @if (over()) {
        <mat-hint class="warn-text">More than they are owed.</mat-hint>
      }
      <mat-error>{{ said(', amount') }}</mat-error>
    </mat-form-field>
    <mat-form-field subscriptSizing="dynamic" class="notes">
      <mat-label>Notes / receipt no. · ملاحظات</mat-label>
      <input matInput [(ngModel)]="payment().notes" (ngModelChange)="changed.emit()" maxlength="300" [attr.aria-label]="label() + ', notes'" />
    </mat-form-field>
  `,
  styles: `
    :host {
      display: contents;
    }
    .supplier {
      min-width: 240px;
    }
    .amount {
      width: 170px;
    }
    .notes {
      min-width: 200px;
    }
    .warn-text {
      color: var(--mat-sys-error);
    }
  `,
})
export class SupplierPaymentFields {
  protected readonly company = inject(Company);
  readonly payment = input.required<SupplierPaymentEntry>();
  readonly suppliers = input.required<SupplierBalance[]>();
  readonly owed = input<number | null>(null);
  readonly afterAbove = input(false);
  // How its fields are named to a screen reader: "Supplier payment 2, amount".
  readonly label = input('Supplier payment');
  // The screen's checks, which mark a field once a send is refused for what it is missing.
  readonly checks = input<FormChecks | null>(null);
  readonly changed = output<void>();

  protected marked(field: string): ErrorStateMatcher {
    return this.checks()?.field(this.label() + field) ?? defaultMatcher;
  }

  protected said(field: string): string {
    return this.checks()?.message(this.label() + field) ?? '';
  }

  // More than they are owed: refused when sent.
  protected over(): boolean {
    return isOverOwed(this.payment(), this.owed());
  }
}

export function isOverOwed(payment: SupplierPaymentEntry, owed: number | null): boolean {
  return owed !== null && (payment.amount ?? 0) > owed + 0.001;
}

// What holds a payment up, by its fields: a supplier owed, an amount, no more than they are owed.
// label is the payment's, as its fields are named by it: "Supplier payment 2".
export function paymentProblems(payment: SupplierPaymentEntry, owed: number | null, label: string): FormProblem[] {
  const found: FormProblem[] = [];
  if (!payment.supplierId) {
    found.push({ where: label, what: 'choose the supplier', field: `${label}, supplier` });
  }
  if (!((payment.amount ?? 0) > 0)) {
    found.push({ where: label, what: 'enter the amount', field: `${label}, amount` });
  } else if (isOverOwed(payment, owed)) {
    found.push({ where: label, what: 'it is more than they are owed', field: `${label}, amount` });
  }
  return found;
}
```


السلف والموظفون والرواتب (مع ربط HR: الموظفون من HR بكودهم وقسمهم، ومسيرات HR وصرفها، والخصومات):

> 📄 **`frontend/src/app/features/costing/advance-fields.ts`** — 86 سطر

```ts
import { Component, inject, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ErrorStateMatcher } from '@angular/material/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { EmployeePicker } from '../../core/costing/employee-picker';
import { Employee } from '../../core/costing/staff';
import { Company } from '../../core/settings/company';
import { FormChecks, FormProblem } from './form-checks';

// Material's own: a field in error once touched and invalid.
const defaultMatcher = new ErrorStateMatcher();

// An employee's advance (سلفة) paid in the daily batch: out of the safe or the day's takings, as the
// batch is paid, and off the employee's pay for the month on the payroll. With no employee, it is a
// lump sum handed out as advances (سلف معلقة), shared among the staff. Its id is
// the advance's, made here: a retry pays once.
export interface AdvanceEntry {
  id: string;
  employeeId: string | null;
  amount: number | null;
  notes: string;
}

export function newAdvance(): AdvanceEntry {
  return { id: crypto.randomUUID(), employeeId: null, amount: null, notes: '' };
}

// Who is advanced (found by typing their name; or no one yet), how much, and a note. Only those
// employed are offered. Its fields sit in the form around it.
@Component({
  selector: 'app-advance-fields',
  imports: [EmployeePicker, FormsModule, MatFormFieldModule, MatInputModule],
  template: `
    <app-employee-picker [employees]="employees()" [value]="advance().employeeId" (valueChange)="advance().employeeId = $event; changed.emit()"
      [none]="true" noneLabel="No one named: shared among the staff" [ariaLabel]="label() + ', employee'" />
    <mat-form-field subscriptSizing="dynamic" class="amount">
      <mat-label>Amount · المبلغ</mat-label>
      <input matInput type="number" min="0" step="any" [(ngModel)]="advance().amount" (ngModelChange)="changed.emit()" [attr.aria-label]="label() + ', amount'"
        [errorStateMatcher]="marked(', amount')" />
      <span matTextSuffix>&nbsp;{{ company.currency() }}</span>
      <mat-error>{{ said(', amount') }}</mat-error>
    </mat-form-field>
    <mat-form-field subscriptSizing="dynamic" class="notes">
      <mat-label>Notes · ملاحظات</mat-label>
      <input matInput [(ngModel)]="advance().notes" (ngModelChange)="changed.emit()" maxlength="300" [attr.aria-label]="label() + ', notes'" />
    </mat-form-field>
  `,
  styles: `
    :host {
      display: contents;
    }
    .amount {
      width: 170px;
    }
    .notes {
      min-width: 200px;
    }
  `,
})
export class AdvanceFields {
  protected readonly company = inject(Company);
  readonly advance = input.required<AdvanceEntry>();
  readonly employees = input.required<Employee[]>();
  // How its fields are named to a screen reader: "Advance 2, amount".
  readonly label = input('Advance');
  readonly checks = input<FormChecks | null>(null);
  readonly changed = output<void>();

  protected marked(field: string): ErrorStateMatcher {
    return this.checks()?.field(this.label() + field) ?? defaultMatcher;
  }

  protected said(field: string): string {
    return this.checks()?.message(this.label() + field) ?? '';
  }
}

// What holds an advance up: its amount. No employee is a lump sum, given out later.
export function advanceProblems(advance: AdvanceEntry, label: string): FormProblem[] {
  const found: FormProblem[] = [];
  if (!((advance.amount ?? 0) > 0)) {
    found.push({ where: label, what: 'enter the amount', field: `${label}, amount` });
  }
  return found;
}
```


> 📄 **`frontend/src/app/features/costing/advances-page.ts`** — 232 سطر

```ts
import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import { AdvanceRow, CostingApi } from '../../core/costing/costing.api';
import { errorMessage } from '../../core/http/error-message';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { Approvals, pendingLabel } from './approvals';
import { Treasury, monthBounds } from './financials';

// Employees' advances (السلفيات): cash advanced to an employee from the safe or a day's takings, a
// month at a time. Each is owed until the payroll of its month deducts it; one asked for by
// someone who may not approve is listed as waiting, and no cash has moved. Each employee's total
// for the month is shown above the list. One naming no one is a lump sum, shared among the staff:
// counted apart, and deducted from no one's pay.
@Component({
  selector: 'app-advances-page',
  imports: [DatePipe, MatButtonModule, MatIconModule, MatProgressBarModule, MatTooltipModule, MoneyPipe],
  template: `
    <div class="toolbar">
      <button mat-icon-button (click)="move(-1)" aria-label="The month before"><mat-icon>chevron_left</mat-icon></button>
      <strong class="month">{{ monthStart() | date: 'MMMM y' }}</strong>
      <button mat-icon-button (click)="move(1)" [disabled]="isThisMonth()" aria-label="The month after"><mat-icon>chevron_right</mat-icon></button>
      <span class="spacer"></span>
      <span class="muted">{{ total() | money }} advanced</span>
      <button mat-flat-button (click)="add()"><mat-icon>add</mat-icon> New advance <span class="inline-ar">سلفة جديدة</span></button>
    </div>
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    @if (error()) {
      <p class="error">{{ error() }}</p>
    } @else {
      @if (waiting().length) {
        <ul class="waiting">
          @for (w of waiting(); track w.id) {
            <li>
              <span class="pending-badge">{{ pendingLabel(w).en }}<span class="ar">{{ pendingLabel(w).ar }}</span></span>
              {{ w.summary }} <span class="muted small">· asked by {{ w.requestedBy }}: no cash has moved</span>
            </li>
          }
        </ul>
      }
      @if (byEmployee().length) {
        <div class="totals" aria-label="Advanced to each employee this month">
          @for (e of byEmployee(); track e.employeeId) {
            <span class="chip"><strong>{{ e.employee }}</strong> {{ e.amount | money }}</span>
          }
        </div>
      }
      <div class="table-wrap">
        <table class="grid">
          <thead>
            <tr>
              <th>Date<span class="ar">التاريخ</span></th>
              <th>Employee<span class="ar">الموظف</span></th>
              <th>Off the pay of<span class="ar">يُخصم من راتب</span></th>
              <th class="num">Amount<span class="ar">المبلغ</span></th>
              <th>By<span class="ar">بواسطة</span></th>
              <th class="num"><span class="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (a of advances(); track a.id) {
              @let asked = approvals.pendingFor(a.id);
              <tr [class.voided]="!!a.voidedAtUtc" [class.pending-deletion]="!!asked">
                <td class="nowrap">{{ a.date | date: 'd MMM' }}</td>
                <td>
                  {{ a.employee }}
                  <div class="muted small">
                    @if (a.fromTakingsOf) {
                      From the takings of {{ a.fromTakingsOf | date: 'd MMM' }} · من إيراد يوم
                    } @else {
                      From the safe · من الخزنة
                    }
                  </div>
                  @if (a.notes) {
                    <div class="muted small">{{ a.notes }}</div>
                  }
                  @if (a.voidedAtUtc) {
                    <div><span class="voided-badge">Voided<span class="ar">ملغى</span></span>
                      <span class="muted small"> by {{ a.voidedBy }}, {{ a.voidedAtUtc | date: 'd MMM' }}</span></div>
                  } @else if (asked) {
                    <div><span class="pending-badge">{{ pendingLabel(asked).en }}<span class="ar">{{ pendingLabel(asked).ar }}</span></span></div>
                  }
                </td>
                <td class="nowrap">
                  @if (a.payrollMonth) {
                    {{ a.payrollMonth | date: 'MMMM y' }}
                  } @else {
                    <span class="muted">Shared among the staff <span class="ar">للتوزيع على الموظفين</span></span>
                  }
                </td>
                <td class="num">{{ a.amount | money }}</td>
                <td>{{ a.recordedBy || '—' }}@if (a.approvedBy) {<div class="muted small">approved by {{ a.approvedBy }}</div>}</td>
                <td class="num">
                  @if (!a.voidedAtUtc) {
                    @if (asked) {
                      <mat-icon class="locked" matTooltip="Waiting for a manager's approval">lock_clock</mat-icon>
                    } @else {
                      <button mat-icon-button class="danger" (click)="voidAdvance(a)" matTooltip="Void" [attr.aria-label]="'Void the advance to ' + a.employee">
                        <mat-icon>delete</mat-icon>
                      </button>
                    }
                  }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="6" class="muted">No advances this month.</td></tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .month {
      min-width: 140px;
      text-align: center;
      font: var(--mat-sys-title-medium);
    }
    .waiting {
      margin: 0 0 12px;
      padding: 0;
      list-style: none;
      display: grid;
      gap: 4px;
    }
    .totals {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 12px;
    }
    .chip {
      display: inline-flex;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 999px;
      background: var(--mat-sys-surface-container);
      font-variant-numeric: tabular-nums;
    }
    tr.voided td {
      color: var(--mat-sys-on-surface-variant);
      text-decoration: line-through;
      text-decoration-color: color-mix(in srgb, currentColor 40%, transparent);
    }
    .small {
      font-size: 0.85em;
    }
    .nowrap {
      white-space: nowrap;
    }
    .danger {
      color: var(--mat-sys-error);
    }
  `,
})
export class AdvancesPage {
  private readonly api = inject(CostingApi);
  private readonly treasury = inject(Treasury);
  protected readonly approvals = inject(Approvals);
  protected readonly pendingLabel = pendingLabel;

  protected readonly year = signal(new Date().getFullYear());
  protected readonly month = signal(new Date().getMonth() + 1);
  protected readonly advances = signal<AdvanceRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly monthStart = computed(() => new Date(this.year(), this.month() - 1, 1));
  protected readonly isThisMonth = computed(() => this.year() === new Date().getFullYear() && this.month() === new Date().getMonth() + 1);
  private readonly standing = computed(() => this.advances().filter((a) => !a.voidedAtUtc));
  protected readonly total = computed(() => this.standing().reduce((sum, a) => sum + a.amount, 0));
  protected readonly waiting = computed(() =>
    this.approvals.waitingToBeMade('Treasury').filter((r) => r.summary.startsWith('Employee advance') || r.summary.startsWith('Advances, not given out')),
  );

  // Each employee's total, largest first; the lump sums not named to anyone together.
  protected readonly byEmployee = computed(() => {
    const totals = new Map<string, { employeeId: string; employee: string; amount: number }>();
    for (const a of this.standing()) {
      const key = a.employeeId ?? 'not given out';
      const row = totals.get(key) ?? { employeeId: key, employee: a.employeeId ? a.employee : 'Not given out yet', amount: 0 };
      row.amount = Math.round((row.amount + a.amount) * 100) / 100;
      totals.set(key, row);
    }
    return [...totals.values()].sort((a, b) => b.amount - a.amount);
  });

  constructor() {
    void this.load();
    void this.approvals.refresh();
  }

  protected move(by: number): void {
    const next = new Date(this.year(), this.month() - 1 + by, 1);
    this.year.set(next.getFullYear());
    this.month.set(next.getMonth() + 1);
    void this.load();
  }

  protected async add(): Promise<void> {
    if (await this.treasury.enter('EmployeeAdvance')) {
      await this.load();
    }
  }

  protected async voidAdvance(advance: AdvanceRow): Promise<void> {
    const day = new Date(advance.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    if ((await this.approvals.delete('Treasury', advance.id, advance.employeeId ? `the advance to ${advance.employee} of ${day}` : `the advances of ${day}, not given out yet`)) === 'Applied') {
      await this.load();
    }
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    const { from, to } = monthBounds(this.year(), this.month());
    try {
      this.advances.set(await firstValueFrom(this.api.advances(from, to)));
    } catch (error) {
      this.error.set(errorMessage(error, 'The advances could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }
}
```


> 📄 **`frontend/src/app/features/costing/staff-page.ts`** — 248 سطر

```ts
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { Permissions } from '../../core/auth/permissions';
import { HrStaffApi } from '../../core/costing/hr-staff.api';
import { MenuSalesApi } from '../../core/costing/menu-sales.api';
import { Employee } from '../../core/costing/staff';
import { errorMessage } from '../../core/http/error-message';
import { NotifyService } from '../../core/ui/notify.service';
import { Treasury } from './financials';

// Staff (الموظفين): who the safe pays advances and salaries to, by name and job, and their salaries
// paid. Only that: their attendance and their payroll are an HR system's. While HR is linked they
// come from it (its code and department beside them), changed there and read again here. One who
// leaves is kept, as the safe's entries name them, and is off the lists for new ones.
@Component({
  selector: 'app-staff-page',
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressBarModule, MatSlideToggleModule],
  template: `
    @if (linked()) {
      <p class="hr-note" role="status">
        <mat-icon>link</mat-icon>
        The staff come from HR while it is linked: change them on HR, and they are read again here (every 6 hours, or on Settings → HR Integration).
        <span class="note-ar" lang="ar" dir="rtl">بيانات الموظفين من نظام الموارد البشرية أثناء الربط.</span>
      </p>
    }
    @if (canChange && !linked()) {
      <form class="toolbar add no-print" (ngSubmit)="add()" aria-label="Add someone">
        <mat-form-field subscriptSizing="dynamic">
          <mat-label>Name · الاسم</mat-label>
          <input matInput name="name" [(ngModel)]="name" maxlength="200" required />
        </mat-form-field>
        <mat-form-field subscriptSizing="dynamic">
          <mat-label>Job · الوظيفة</mat-label>
          <input matInput name="job" [(ngModel)]="job" maxlength="100" />
        </mat-form-field>
        <button mat-flat-button type="submit" [disabled]="saving() || !name.trim()"><mat-icon>person_add</mat-icon> Add <span class="inline-ar">إضافة</span></button>
      </form>
    }
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    } @else if (error(); as message) {
      <p class="error">{{ message }}</p>
    } @else {
      <div class="table-wrap narrow">
        <table class="grid" aria-label="Staff">
          <thead>
            <tr>
              <th>Name<span class="ar">الاسم</span></th>
              @if (anyFromHr()) {
                <th>Code<span class="ar">الكود</span></th>
                <th>Department<span class="ar">القسم</span></th>
              }
              <th>Job<span class="ar">الوظيفة</span></th>
              <th>Working<span class="ar">يعمل</span></th>
              <th><span class="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (e of sorted(); track e.id) {
              <tr [class.left]="!e.isActive">
                <td>
                  @if (editable(e)) {
                    <input class="inline" [ngModel]="e.name" (change)="rename(e, $any($event.target).value)" [attr.aria-label]="e.name + '’s name'" />
                  } @else {
                    <strong>{{ e.name }}</strong>
                    @if (e.hrEmployeeId) {<span class="hr-badge" title="From HR">HR</span>}
                  }
                </td>
                @if (anyFromHr()) {
                  <td class="num-code">{{ e.code ?? '' }}</td>
                  <td>{{ e.department ?? '' }}</td>
                }
                <td>
                  @if (editable(e)) {
                    <input class="inline" [ngModel]="e.jobTitle ?? ''" (change)="retitle(e, $any($event.target).value)" [attr.aria-label]="e.name + '’s job'" />
                  } @else {
                    {{ e.jobTitle ?? '—' }}
                  }
                </td>
                <td>
                  <mat-slide-toggle [checked]="e.isActive" (change)="setActive(e, $event.checked)" [disabled]="!editable(e)" [attr.aria-label]="e.name + ' working'">
                    {{ e.isActive ? 'Working · يعمل' : 'Left · ترك العمل' }}
                  </mat-slide-toggle>
                </td>
                <td class="num">
                  <button mat-stroked-button (click)="paySalary(e)"><mat-icon>payments</mat-icon> Pay salary <span class="inline-ar">صرف راتب</span></button>
                </td>
              </tr>
            } @empty {
              <tr>
                <td [attr.colspan]="anyFromHr() ? 6 : 4" class="empty">
                  No one yet. Add whoever the safe pays advances or salaries to.
                  <span class="note-ar" lang="ar" dir="rtl">لا يوجد موظفون بعد. أضف من تصرف لهم الخزنة سلفًا أو رواتب.</span>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <p class="note">
        <span class="note-ar" lang="ar" dir="rtl">الأسماء والوظائف فقط لصرف السلف والرواتب من الخزنة. الراتب المصروف يُحسب في تكلفة العمالة لشهره، وتُرى السلف في صفحة السلفيات.</span>
        Names and jobs only, for the advances and salaries the safe pays. A salary paid counts in its month’s labour cost; the advances are on
        Advances. Attendance and payroll are an HR system’s.
      </p>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .narrow {
      max-width: 900px;
    }
    .inline {
      width: 100%;
      padding: 4px 6px;
      border: 1px solid transparent;
      border-radius: 6px;
      background: transparent;
      font: inherit;
      color: inherit;
    }
    .inline:hover,
    .inline:focus {
      border-color: var(--app-line-strong);
      outline: none;
      background: var(--mat-sys-surface);
    }
    tr.left td {
      opacity: 0.65;
    }
    .hr-note {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin: 0 0 10px;
      padding: 8px 12px;
      border-radius: 12px;
      background: var(--tag-ok-bg, #dff5e6);
      color: var(--tag-ok-fg, #1b6b3a);
    }
    .hr-badge {
      margin-left: 6px;
      padding: 0 6px;
      border-radius: 6px;
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
      font: var(--mat-sys-label-small);
    }
    .num-code {
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class StaffPage {
  private readonly api = inject(MenuSalesApi);
  private readonly notify = inject(NotifyService);
  private readonly treasury = inject(Treasury);
  protected readonly canChange = inject(AuthService).can(Permissions.InventoryManage);

  private readonly hr = inject(HrStaffApi);
  protected readonly staff = signal<Employee[]>([]);
  // HR linked: its staff are changed on HR, and none is added here.
  protected readonly linked = signal(false);
  protected readonly anyFromHr = computed(() => this.staff().some((e) => !!e.hrEmployeeId));
  protected readonly sorted = computed(() => [...this.staff()].sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name)));
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected name = '';
  protected job = '';

  constructor() {
    void this.load();
  }

  protected async add(): Promise<void> {
    if (!this.name.trim()) {
      return;
    }
    this.saving.set(true);
    try {
      const saved = await firstValueFrom(this.api.saveStaff(crypto.randomUUID(), this.name.trim(), this.job.trim() || null, true));
      this.notify.info(`${saved.name} added.`);
      this.name = '';
      this.job = '';
      await this.load();
    } catch (error) {
      this.notify.error(error, 'They could not be added.');
    } finally {
      this.saving.set(false);
    }
  }

  protected editable(e: Employee): boolean {
    return this.canChange && !(this.linked() && e.hrEmployeeId);
  }

  protected rename(e: Employee, name: string): Promise<void> {
    return name.trim() && name.trim() !== e.name ? this.save(e, name.trim(), e.jobTitle, e.isActive) : Promise.resolve();
  }

  protected retitle(e: Employee, job: string): Promise<void> {
    return (job.trim() || null) !== e.jobTitle ? this.save(e, e.name, job.trim() || null, e.isActive) : Promise.resolve();
  }

  // A month's salary, from the safe or a day's takings: one who has left is paid what they are owed too.
  protected async paySalary(e: Employee): Promise<void> {
    await this.treasury.enter('SalaryPayment', { employeeId: e.id });
  }

  protected setActive(e: Employee, active: boolean): Promise<void> {
    return this.save(e, e.name, e.jobTitle, active);
  }

  private async save(e: Employee, name: string, job: string | null, active: boolean): Promise<void> {
    try {
      const saved = await firstValueFrom(this.api.saveStaff(e.id, name, job, active));
      this.staff.update((all) => all.map((x) => (x.id === saved.id ? saved : x)));
    } catch (error) {
      this.notify.error(error, 'It could not be saved.');
      await this.load();
    }
  }

  private async load(): Promise<void> {
    try {
      const [staff, hr] = await Promise.all([
        firstValueFrom(this.api.staff()),
        firstValueFrom(this.hr.status()).catch(() => ({ linked: false, employeesSyncedAtUtc: null })),
      ]);
      this.staff.set(staff);
      this.linked.set(hr.linked);
      this.error.set(null);
    } catch (error) {
      this.error.set(errorMessage(error, 'The staff could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }
}
```


> 📄 **`frontend/src/app/core/costing/hr-staff.api.ts`** — 113 سطر

```ts
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
```


> 📄 **`frontend/src/app/features/costing/payroll-page.ts`** — 461 سطر

```ts
import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { Permissions } from '../../core/auth/permissions';
import { CostingApi } from '../../core/costing/costing.api';
import { EmployeePicker } from '../../core/costing/employee-picker';
import { HrStaffApi, HrStatus, PayrollRun, StaffDeduction, StaffDeductionKind, deductionKindLabels } from '../../core/costing/hr-staff.api';
import { MenuSalesApi } from '../../core/costing/menu-sales.api';
import { Employee } from '../../core/costing/staff';
import { errorMessage } from '../../core/http/error-message';
import { Company } from '../../core/settings/company';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { NotifyService } from '../../core/ui/notify.service';
import { monthBounds } from './financials';

// Payroll & deductions (الرواتب والخصومات). The payrolls HR approved and sent here: what each month's
// work cost (its labor cost, on the profit and loss and the prime cost), and its net cash, paid out
// of the safe as one entry, HR told once it is paid. The advances paid during the month are
// already off that net, so none is paid twice. And the deductions charged to an employee, a till
// shortage or a staff charge, kept here and sent to HR as deductions from their pay while it is
// linked.
@Component({
  selector: 'app-payroll-page',
  imports: [
    DatePipe, EmployeePicker, FormsModule, MatButtonModule, MatButtonToggleModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressBarModule,
    MoneyPipe, RouterLink,
  ],
  template: `
    @if (status(); as s) {
      <p class="link-state" [class.on]="s.linked" role="status">
        <mat-icon>{{ s.linked ? 'link' : 'link_off' }}</mat-icon>
        @if (s.linked) {
          Linked to HR: the payroll comes from HR, and each deduction goes onto the employee's pay there. · مرتبط بنظام الموارد البشرية.
        } @else {
          HR is not linked: the deductions are kept here only, and no payroll comes in. · غير مرتبط بنظام الموارد البشرية.
        }
        @if (canSettings) {
          <a mat-button routerLink="/settings/hr-integration">HR Integration</a>
        }
      </p>
    }

    <section aria-labelledby="runs-title">
      <h2 id="runs-title"><mat-icon>request_page</mat-icon> Payroll from HR <span class="inline-ar">مسير الرواتب المعتمد</span></h2>
      @if (loadingRuns()) {
        <mat-progress-bar mode="indeterminate" />
      }
      <div class="runs">
        @for (r of runs(); track r.id) {
          <article class="run" [class.paid]="r.status === 'Disbursed'">
            <header>
              <strong class="period">{{ r.period | date: 'MMMM y' }}</strong>
              <span class="tag" [class]="r.status === 'Disbursed' ? 'ok' : r.paymentRequested ? 'info' : 'warn'">
                @if (r.status === 'Disbursed') {
                  Paid · تم الصرف
                } @else if (r.paymentRequested) {
                  Asked of a manager · بانتظار الموافقة
                } @else {
                  To pay · مستحق الصرف
                }
              </span>
              <span class="spacer"></span>
              <span class="muted small">{{ r.employees }} employees · received {{ r.receivedAtUtc | date: 'd MMM, HH:mm' }}@if (r.revision > 1) { · revision {{ r.revision }} }</span>
            </header>
            <dl class="figures">
              <div><dt>Gross wages<span class="ar">إجمالي الأجور</span></dt><dd>{{ r.totalGrossWages | money }}</dd></div>
              <div><dt>Additions<span class="ar">الإضافات والحوافز</span></dt><dd>+ {{ r.totalAdditions | money }}</dd></div>
              <div><dt>Penalties<span class="ar">الجزاءات</span></dt><dd>− {{ r.totalPenalties | money }}</dd></div>
              <div class="key"><dt>Labor cost<span class="ar">تكلفة العمالة</span></dt><dd>{{ r.laborCost | money }}</dd></div>
              <div><dt>Advances deducted<span class="ar">السلف المخصومة</span></dt><dd>− {{ r.totalAdvancesDeducted | money }}</dd></div>
              @if (r.totalBroughtForward) {
                <div><dt>Last month's shortfall<span class="ar">مرحل من الشهر السابق</span></dt><dd>− {{ r.totalBroughtForward | money }}</dd></div>
              }
              <div class="key"><dt>Net cash to pay<span class="ar">صافي النقدية للصرف</span></dt><dd>{{ r.netCashPayable | money }}</dd></div>
            </dl>
            @if (r.departments.length) {
              <details>
                <summary>By department · حسب القسم</summary>
                <table class="grid compact">
                  <thead><tr><th>Department</th><th class="num">Staff</th><th class="num">Labor cost</th><th class="num">Advances</th><th class="num">Net cash</th></tr></thead>
                  <tbody>
                    @for (d of r.departments; track d.name) {
                      <tr><td>{{ d.name }}</td><td class="num">{{ d.employees }}</td><td class="num">{{ d.laborCost | money }}</td>
                        <td class="num">{{ d.advancesDeducted | money }}</td><td class="num">{{ d.netCashPayable | money }}</td></tr>
                    }
                  </tbody>
                </table>
              </details>
            }
            <footer>
              @if (r.status === 'Disbursed') {
                <span class="muted small"><mat-icon class="tiny">check_circle</mat-icon> Paid out of the safe {{ r.disbursedAtUtc | date: 'd MMM y, HH:mm' }} by {{ r.disbursedBy }}; HR is told.</span>
              } @else if (canPay && !r.paymentRequested) {
                <button mat-flat-button (click)="disburse(r)" [disabled]="busy()"><mat-icon>payments</mat-icon> Pay out of the safe · صرف من الخزنة</button>
              }
            </footer>
          </article>
        } @empty {
          @if (!loadingRuns()) {
            <p class="empty">
              No payroll from HR yet. Once HR approves a month's payroll, it comes here to be paid out of the safe.
              <span class="note-ar" lang="ar" dir="rtl">لا يوجد مسير رواتب بعد. عند اعتماد المسير في نظام الموارد البشرية يصل هنا للصرف من الخزنة.</span>
            </p>
          }
        }
      </div>
    </section>

    <section aria-labelledby="deductions-title">
      <h2 id="deductions-title"><mat-icon>remove_circle_outline</mat-icon> Deductions <span class="inline-ar">الخصومات على الموظفين</span></h2>
      @if (canPay) {
        <form class="deduction-form" (ngSubmit)="addDeduction()" aria-label="New deduction">
          <mat-button-toggle-group name="kind" [(ngModel)]="kind" aria-label="Kind of deduction" hideSingleSelectionIndicator>
            @for (k of kinds; track k) {
              <mat-button-toggle [value]="k">{{ kindLabels[k].en }} · {{ kindLabels[k].ar }}</mat-button-toggle>
            }
          </mat-button-toggle-group>
          <app-employee-picker [employees]="activeStaff()" [(value)]="employeeId" [fill]="true" ariaLabel="Deduction, employee" />
          <mat-form-field subscriptSizing="dynamic">
            <mat-label>Date · التاريخ</mat-label>
            <input matInput type="date" name="date" [(ngModel)]="date" required />
          </mat-form-field>
          <mat-form-field subscriptSizing="dynamic" floatLabel="always">
            <mat-label>Amount · المبلغ</mat-label>
            <input matInput type="number" name="amount" min="0" step="any" inputmode="decimal" [(ngModel)]="amount" placeholder="0.00" data-western-digits />
            <span matTextSuffix>&nbsp;{{ company.currency() }}</span>
          </mat-form-field>
          <mat-form-field subscriptSizing="dynamic" class="reason">
            <mat-label>Reason · السبب</mat-label>
            <input matInput name="reason" [(ngModel)]="reason" maxlength="300" />
          </mat-form-field>
          <button mat-flat-button type="submit" [disabled]="busy()"><mat-icon>add</mat-icon> Add deduction · إضافة الخصم</button>
          @if (problem(); as p) {
            <p class="error" role="alert">{{ p }}</p>
          }
        </form>
      }
      <div class="toolbar">
        <button mat-icon-button (click)="move(-1)" aria-label="The month before"><mat-icon>chevron_left</mat-icon></button>
        <strong class="month">{{ monthStart() | date: 'MMMM y' }}</strong>
        <button mat-icon-button (click)="move(1)" [disabled]="isThisMonth()" aria-label="The month after"><mat-icon>chevron_right</mat-icon></button>
        <span class="spacer"></span>
        <span class="muted">{{ deductedTotal() | money }} deducted</span>
      </div>
      <div class="table-wrap">
        <table class="grid" aria-label="Deductions">
          <thead>
            <tr><th>Date<span class="ar">التاريخ</span></th><th>Employee<span class="ar">الموظف</span></th><th>Kind<span class="ar">النوع</span></th>
              <th>Reason<span class="ar">السبب</span></th><th class="num">Amount<span class="ar">المبلغ</span></th><th><span class="visually-hidden">Actions</span></th></tr>
          </thead>
          <tbody>
            @for (d of deductions(); track d.id) {
              <tr [class.voided]="d.voidedAtUtc">
                <td class="nowrap">{{ d.date | date: 'EEE d MMM' }}</td>
                <td>{{ d.employee }} @if (d.fromHr) {<span class="hr-badge" title="From HR">HR</span>}</td>
                <td>{{ kindLabels[d.kind].en }}<span class="ar">{{ kindLabels[d.kind].ar }}</span></td>
                <td>{{ d.reason ?? '' }}</td>
                <td class="num">{{ d.amount | money }}</td>
                <td class="num">
                  @if (d.voidedAtUtc) {
                    <span class="muted small">Voided by {{ d.voidedBy }}</span>
                  } @else if (canPay) {
                    <button mat-button (click)="voidDeduction(d)" [disabled]="busy()" [attr.aria-label]="'Void the deduction of ' + d.employee"><mat-icon>block</mat-icon> Void</button>
                  }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="6" class="empty">No deductions this month. · لا توجد خصومات هذا الشهر.</td></tr>
            }
          </tbody>
        </table>
      </div>
    </section>
  `,
  styleUrl: './costing.scss',
  styles: `
    h2 {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 20px 0 10px;
      font: var(--mat-sys-title-medium);
    }
    .link-state {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin: 0 0 8px;
      padding: 8px 12px;
      border-radius: 12px;
      background: var(--mat-sys-surface-container-high);
      color: var(--mat-sys-on-surface-variant);

      &.on {
        background: var(--tag-ok-bg, #dff5e6);
        color: var(--tag-ok-fg, #1b6b3a);
      }
    }
    .runs {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 420px), 1fr));
      gap: 12px;
    }
    .run {
      display: grid;
      gap: 10px;
      padding: 14px 16px;
      border: 1px solid var(--app-line);
      border-radius: 16px;
      background: var(--mat-sys-surface-container-lowest);
      box-shadow: var(--app-card-shadow);

      header,
      footer {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
      }
      footer {
        justify-content: flex-end;
      }
    }
    .period {
      font: var(--mat-sys-title-medium);
    }
    .figures {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 8px 16px;
      margin: 0;

      div {
        display: grid;
        gap: 2px;
      }
      dt {
        display: grid;
        font: var(--mat-sys-label-medium);
        color: var(--mat-sys-on-surface-variant);
      }
      dd {
        margin: 0;
        font-variant-numeric: tabular-nums;
      }
      .key dd {
        font: var(--mat-sys-title-medium);
        color: var(--mat-sys-primary);
      }
    }
    .ar {
      font-size: 0.85em;
      opacity: 0.85;
    }
    details summary {
      cursor: pointer;
      color: var(--mat-sys-primary);
    }
    .compact {
      margin-top: 6px;
    }
    .deduction-form {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 10px 12px;
      align-items: center;
      margin-bottom: 12px;
      padding: 12px;
      border: 1px dashed var(--app-line-strong);
      border-radius: 14px;

      mat-button-toggle-group,
      .error {
        grid-column: 1 / -1;
        justify-self: start;
      }
    }
    .small {
      font-size: 0.85em;
    }
    .tiny {
      width: 16px;
      height: 16px;
      font-size: 16px;
      vertical-align: -3px;
    }
    .nowrap {
      white-space: nowrap;
    }
    tr.voided td {
      opacity: 0.55;
      text-decoration: line-through;
    }
    .hr-badge {
      margin-left: 4px;
      padding: 0 6px;
      border-radius: 6px;
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
      font: var(--mat-sys-label-small);
    }
  `,
})
export class PayrollPage {
  private readonly hr = inject(HrStaffApi);
  private readonly staffApi = inject(MenuSalesApi);
  private readonly costing = inject(CostingApi);
  private readonly notify = inject(NotifyService);
  protected readonly company = inject(Company);
  private readonly auth = inject(AuthService);
  protected readonly canPay = this.auth.can(Permissions.InventoryManage);
  protected readonly canSettings = this.auth.can(Permissions.SettingsManage);

  protected readonly kindLabels = deductionKindLabels;
  protected readonly kinds: StaffDeductionKind[] = ['TillShortage', 'StaffCharge'];

  protected readonly status = signal<HrStatus | null>(null);
  protected readonly runs = signal<PayrollRun[]>([]);
  protected readonly staff = signal<Employee[]>([]);
  protected readonly deductions = signal<StaffDeduction[]>([]);
  protected readonly loadingRuns = signal(true);
  protected readonly busy = signal(false);
  protected readonly problem = signal<string | null>(null);

  protected readonly year = signal(new Date().getFullYear());
  protected readonly month = signal(new Date().getMonth() + 1);
  protected readonly monthStart = computed(() => new Date(this.year(), this.month() - 1, 1));
  protected readonly isThisMonth = computed(() => this.year() === new Date().getFullYear() && this.month() === new Date().getMonth() + 1);
  protected readonly activeStaff = computed(() => this.staff().filter((e) => e.isActive));
  protected readonly deductedTotal = computed(() => this.deductions().filter((d) => !d.voidedAtUtc).reduce((sum, d) => sum + d.amount, 0));

  protected kind: StaffDeductionKind = 'TillShortage';
  protected readonly employeeId = signal<string | null>(null);
  protected date = '';
  protected amount: number | null = null;
  protected reason = '';
  private deductionId = crypto.randomUUID();

  constructor() {
    void this.load();
  }

  protected move(by: number): void {
    const next = new Date(this.year(), this.month() - 1 + by, 1);
    this.year.set(next.getFullYear());
    this.month.set(next.getMonth() + 1);
    void this.loadDeductions();
  }

  protected async disburse(run: PayrollRun): Promise<void> {
    const period = new Date(run.period).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    if (!confirm(`Pay the payroll of ${period} out of the safe: ${this.company.money(run.netCashPayable)}? HR is told it is paid. · صرف المسير من الخزنة؟`)) {
      return;
    }
    this.busy.set(true);
    try {
      const result = await firstValueFrom(this.hr.disburse(run.id, crypto.randomUUID(), crypto.randomUUID()));
      this.notify.info(
        result.outcome === 'Applied'
          ? `The payroll of ${period} is paid out of the safe. · تم صرف المسير.`
          : `Asked of a manager: no cash has moved yet. · تم إرسال الطلب للموافقة.`,
      );
      await this.loadRuns();
    } catch (error) {
      this.notify.error(error, errorMessage(error, 'The payroll could not be paid.'));
    } finally {
      this.busy.set(false);
    }
  }

  protected async addDeduction(): Promise<void> {
    const amount = Number(this.amount);
    const problem = !this.employeeId()
      ? 'Choose the employee. · اختر الموظف.'
      : !this.date
        ? 'Choose the day. · اختر التاريخ.'
        : !(amount > 0)
          ? 'Enter the amount. · أدخل المبلغ.'
          : null;
    this.problem.set(problem);
    if (problem) {
      return;
    }
    this.busy.set(true);
    try {
      const saved = await firstValueFrom(this.hr.recordDeduction({
        id: this.deductionId, employeeId: this.employeeId()!, date: this.date, kind: this.kind, amount: Math.round(amount * 100) / 100,
        reason: this.reason.trim() || null,
      }));
      this.deductionId = crypto.randomUUID();
      this.notify.info(`${this.kindLabels[saved.kind].en} of ${this.company.money(saved.amount)} charged to ${saved.employee}.`);
      this.employeeId.set(null);
      this.amount = null;
      this.reason = '';
      await this.loadDeductions();
    } catch (error) {
      this.problem.set(errorMessage(error, 'The deduction could not be added.'));
    } finally {
      this.busy.set(false);
    }
  }

  protected async voidDeduction(d: StaffDeduction): Promise<void> {
    if (!confirm(`Void the ${this.kindLabels[d.kind].en.toLowerCase()} of ${this.company.money(d.amount)} charged to ${d.employee}? · إلغاء الخصم؟`)) {
      return;
    }
    this.busy.set(true);
    try {
      await firstValueFrom(this.hr.voidDeduction(d.id));
      await this.loadDeductions();
    } catch (error) {
      this.notify.error(error, errorMessage(error, 'The deduction could not be voided.'));
    } finally {
      this.busy.set(false);
    }
  }

  private async load(): Promise<void> {
    try {
      this.date = (await firstValueFrom(this.costing.businessToday())).today;
    } catch {
      this.date = new Date().toISOString().slice(0, 10);
    }
    await Promise.all([
      this.loadRuns(),
      this.loadDeductions(),
      firstValueFrom(this.hr.status()).then((s) => this.status.set(s), () => this.status.set(null)),
      firstValueFrom(this.staffApi.staff()).then((s) => this.staff.set(s), () => this.staff.set([])),
    ]);
  }

  private async loadRuns(): Promise<void> {
    this.loadingRuns.set(true);
    try {
      this.runs.set(await firstValueFrom(this.hr.payrollRuns()));
    } catch (error) {
      this.notify.error(error, errorMessage(error, 'The payrolls could not be loaded.'));
    } finally {
      this.loadingRuns.set(false);
    }
  }

  private async loadDeductions(): Promise<void> {
    const { from, to } = monthBounds(this.year(), this.month());
    try {
      this.deductions.set(await firstValueFrom(this.hr.deductions(from, to)));
    } catch (error) {
      this.notify.error(error, errorMessage(error, 'The deductions could not be loaded.'));
    }
  }
}
```


`TaxServicePage`: نسبة الضريبة التي تُطبَّق على كل فاتورة (والتوريد الشامل يُفصل بها)، ونسبة الخدمة.

> 📄 **`frontend/src/app/features/costing/tax-service-page.ts`** — 147 سطر

```ts
import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { Permissions } from '../../core/auth/permissions';
import { CostingApi, FinancialSettings } from '../../core/costing/costing.api';
import { errorMessage } from '../../core/http/error-message';
import { NotifyService } from '../../core/ui/notify.service';

// Tax and service (إعدادات الضريبة والخدمة), a manager's to set. The tax rate is the one every bill is
// charged: a day's takings entered with the tax in them have it taken off at this rate, and the sales
// entered have it on their bills. The service charge is kept for when bills carry one; nothing is
// calculated from it yet.
@Component({
  selector: 'app-tax-service-page',
  imports: [DatePipe, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatProgressBarModule],
  template: `
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    } @else if (error()) {
      <p class="error">{{ error() }}</p>
    } @else if (settings(); as s) {
      <section class="block">
        <h2>Tax <span class="inline-ar">الضريبة</span></h2>
        <p class="note">The rate every bill is charged. A day's takings entered with the tax in them have it taken off at this rate.</p>
        <mat-form-field subscriptSizing="dynamic" class="percent">
          <mat-label>Tax rate · نسبة الضريبة</mat-label>
          <input matInput type="number" min="0" max="99.99" step="0.5" [(ngModel)]="tax" [disabled]="!canEdit()" aria-label="Tax rate" />
          <span matTextSuffix>%</span>
        </mat-form-field>
        @if (s.taxPercent === null) {
          <p class="muted small">Not set yet: takings are entered without tax until it is.</p>
        }
      </section>

      <section class="block">
        <h2>Service <span class="inline-ar">الخدمة</span></h2>
        <p class="note">The service charge, kept for when bills carry one. Nothing is calculated from it yet.</p>
        <div class="toolbar">
          <mat-form-field subscriptSizing="dynamic" class="percent">
            <mat-label>Service · نسبة الخدمة</mat-label>
            <input matInput type="number" min="0" max="99.99" step="0.5" [(ngModel)]="service" [disabled]="!canEdit()" aria-label="Service" />
            <span matTextSuffix>%</span>
          </mat-form-field>
          @if (canEdit()) {
            <button mat-flat-button (click)="save()" [disabled]="!!problem() || !changed() || busy()">Save <span class="inline-ar">حفظ</span></button>
          }
        </div>
        @if (problem(); as p) {
          <p class="error">{{ p }}</p>
        }
        @if (!canEdit()) {
          <p class="muted small">A manager sets the tax and the service charge.</p>
        }
        @if (s.updatedBy) {
          <p class="muted small">Last set by {{ s.updatedBy }}, {{ s.updatedAtUtc | date: 'd MMM y, HH:mm' }}</p>
        }
      </section>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .block {
      margin-bottom: 28px;

      h2 {
        margin: 0 0 4px;
        font: var(--mat-sys-title-medium);
      }
    }
    .percent {
      width: 200px;
    }
    .small {
      font-size: 0.85em;
    }
  `,
})
export class TaxServicePage {
  private readonly api = inject(CostingApi);
  private readonly auth = inject(AuthService);
  private readonly notify = inject(NotifyService);

  protected readonly settings = signal<FinancialSettings | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly canEdit = computed(() => this.auth.can(Permissions.ApprovalDecide));

  protected tax: number | null = null;
  protected service: number | null = null;

  constructor() {
    void this.load();
  }

  protected problem(): string | null {
    if (this.tax !== null && (this.tax < 0 || this.tax >= 100)) {
      return 'The tax is a percentage from 0 up to 100.';
    }
    if (this.tax === null && this.settings()?.taxPercent != null) {
      return 'Enter the tax rate: 0 for none.';
    }
    return this.service === null || this.service < 0 || this.service >= 100 ? 'The service charge is a percentage from 0 up to 100.' : null;
  }

  protected changed(): boolean {
    const s = this.settings();
    return !!s && (this.service !== s.servicePercent || this.tax !== s.taxPercent);
  }

  protected async save(): Promise<void> {
    if (this.problem() || this.service === null) {
      return;
    }
    this.busy.set(true);
    try {
      const saved = await firstValueFrom(this.api.saveFinancialSettings(this.service, this.tax ?? undefined));
      this.settings.set(saved);
      this.tax = saved.taxPercent;
      this.service = saved.servicePercent;
      this.notify.info(`Tax ${saved.taxPercent ?? 0}%, service charge ${saved.servicePercent}%.`);
    } catch (error) {
      this.notify.error(error, 'The tax and service could not be saved.');
    } finally {
      this.busy.set(false);
    }
  }

  private async load(): Promise<void> {
    try {
      const settings = await firstValueFrom(this.api.financialSettings());
      this.settings.set(settings);
      this.tax = settings.taxPercent;
      this.service = settings.servicePercent;
    } catch (error) {
      this.error.set(errorMessage(error, 'The tax and service settings could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }
}
```


## 2. التحليلات الذكية

العقد `intelligence.api.ts` (كل الكميات بوحدة الشراء)، ثم شاشة لكل محرك (المعادلات في الفصل 06):

- `PriceVariancePage`: المتوسط الذي دخلت به الخامة مقابل آخر سعر صافٍ، التغير ونسبته، الكمية، و **أثره على كل طبق ومصنّع** (الأكبر أولًا).
- `OrderPlannerPage`: أيام النظر للخلف، أيام التغطية، النمو، أو رقم لكل طبق؛ ثم ما يُصنع من المصنعات وما يُطلب من الخامات بوحدات شراء كاملة، وورقة الطلب.
- `ConsumptionPage`: الفعلي مقابل النظري لكل خامة بحكم السماحية، و "مبيع بلا وصفة".
- `AbcPage`: A/B/C وأيام الكفاية وخطر النفاد.

> 📄 **`frontend/src/app/core/costing/intelligence.api.ts`** — 278 سطر

```ts
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

// Material & demand intelligence (تحليلات الخامات والطلبيات): every quantity in the material's
// purchase unit (kg, L, a carton), every price per it.

export interface NamedId {
  id: string;
  name: string;
  nameAr: string | null;
}

export type PriceImpactKind = 'Dish' | 'PrepItem';

// What a material's price change does to a dish (per portion; points of its food cost) or a prep
// item (per its purchase unit; share of its cost): quantity is how much of the material goes in.
export interface PriceImpactLine {
  kind: PriceImpactKind;
  id: string;
  name: string;
  nameAr: string | null;
  per: string;
  quantity: number;
  costChange: number;
  against: number | null;
  points: number | null;
}

// One material over the period: the moving average it came in with, the latest net price paid, the
// change and its share, what was bought, and its impact: (latest − baseline) × bought.
export interface PriceVarianceRow {
  rawMaterialId: string;
  code: string | null;
  material: string;
  categoryId: string;
  category: string | null;
  categoryAr: string | null;
  purchaseUnit: string;
  baselineCost: number | null;
  latestCost: number | null;
  unitVariance: number | null;
  changePercent: number | null;
  quantityPurchased: number;
  impact: number | null;
  invoices: number;
  latestPurchasedOn: string | null;
  latestSupplierId: string | null;
  latestSupplier: string | null;
  supplierIds: string[];
  affected: PriceImpactLine[];
}

export interface PriceVarianceReport {
  from: string;
  to: string;
  totalImpact: number;
  increases: number;
  decreases: number;
  rising: number;
  falling: number;
  affectedDishes: number;
  largestRise: string | null;
  largestRisePercent: number | null;
  rows: PriceVarianceRow[];
  categories: NamedId[];
  suppliers: NamedId[];
}

// What a dish (a size, when it has sizes) is expected to sell a day.
export interface DishExpectation {
  menuItemId: number;
  variantId: number | null;
  expectedDaily: number;
}

export interface OrderPlanRequest {
  lookbackDays: number;
  coverageDays: number;
  growthPercent: number;
  dishes: DishExpectation[];
}

export interface PlannedDish {
  menuItemId: number;
  variantId: number | null;
  code: string;
  name: string;
  nameAr: string | null;
  hasRecipe: boolean;
  averageDaily: number;
  expectedDaily: number;
  // Expected as the manager set it, not by the sales and the growth.
  expected: boolean;
}

// One bought material: what to order for the days ahead, the prep items on hand netted first.
// recommended: the need less the shelf; suggested: rounded up to whole purchase units.
export interface OrderPlanLine {
  rawMaterialId: string;
  code: string | null;
  material: string;
  categoryId: string;
  category: string | null;
  categoryAr: string | null;
  purchaseUnit: string;
  onHand: number;
  averageDailyUsage: number;
  expectedUsage: number;
  reorderLevel: number;
  recommended: number;
  suggested: number;
  unitPrice: number | null;
  estimatedCost: number | null;
  supplierId: string | null;
  supplier: string | null;
  belowReorder: boolean;
}

export interface OrderPlan {
  lookbackFrom: string;
  lookbackTo: string;
  lookbackDays: number;
  coverageDays: number;
  growthPercent: number;
  dishes: PlannedDish[];
  lines: OrderPlanLine[];
  toOrder: number;
  estimatedTotal: number;
  belowReorder: number;
  noPrice: string[];
}

export type OrderSheetGrouping = 'Category' | 'Supplier';

export type VarianceEvaluation = 'WithinLimit' | 'Unfavourable' | 'Favourable' | 'SharedCost';

// One bought material: actual usage (opening + purchases − logged waste − closing) against what the
// sales should have taken by the recipes, through the prep items, with what is held in the prep
// items' stock (heldInPrep, part of the theoretical).
export interface ConsumptionRow {
  rawMaterialId: string;
  code: string | null;
  material: string;
  categoryId: string;
  category: string | null;
  categoryAr: string | null;
  purchaseUnit: string;
  opening: number;
  purchases: number;
  waste: number;
  closing: number;
  actualUsage: number;
  theoreticalUsage: number;
  heldInPrep: number;
  unexplainedQuantity: number;
  unexplainedPercent: number | null;
  unitCost: number | null;
  varianceCost: number | null;
  evaluation: VarianceEvaluation;
}

export interface SoldWithoutRecipe {
  itemCode: string;
  menuItem: string;
  quantity: number;
}

export interface ConsumptionReport {
  from: string;
  to: string;
  tolerancePercent: number;
  theoreticalValue: number;
  actualValue: number;
  unexplainedValue: number;
  highLoss: number;
  rows: ConsumptionRow[];
  soldWithoutRecipe: SoldWithoutRecipe[];
}

export type AbcClass = 'A' | 'B' | 'C';

export interface AbcRow {
  rawMaterialId: string;
  code: string | null;
  material: string;
  categoryId: string;
  category: string | null;
  categoryAr: string | null;
  purchaseUnit: string;
  consumption: number;
  consumptionValue: number;
  sharePercent: number;
  cumulativePercent: number;
  class: AbcClass;
  onHand: number;
  stockValue: number | null;
  averageDaily: number;
  daysOnHand: number | null;
  stockoutRisk: boolean;
  deadStock: boolean;
}

export interface AbcClassSummary {
  class: AbcClass;
  materials: number;
  value: number;
  sharePercent: number;
}

export interface AbcReport {
  from: string;
  to: string;
  days: number;
  consumptionValue: number;
  classes: AbcClassSummary[];
  stockoutRisks: number;
  deadStock: number;
  deadStockValue: number;
  stockValue: number;
  rows: AbcRow[];
}

export const evaluationLabels: Record<VarianceEvaluation, { en: string; ar: string }> = {
  WithinLimit: { en: 'Within limit', ar: 'ضمن الحد' },
  Unfavourable: { en: 'High loss', ar: 'فاقد مرتفع' },
  Favourable: { en: 'Under use', ar: 'استهلاك أقل' },
  SharedCost: { en: 'Shared cost', ar: 'تكلفة مشتركة' },
};

// Filtering a sheet as the screen does: one category, one supplier, the words typed.
export interface PriceSheetFilter {
  categoryId?: string | null;
  supplierId?: string | null;
  search?: string | null;
}

@Injectable({ providedIn: 'root' })
export class IntelligenceApi {
  private readonly http = inject(HttpClient);

  prices(from: string, to: string): Observable<PriceVarianceReport> {
    return this.http.get<PriceVarianceReport>('/api/costing/intelligence/prices', { params: { from, to } });
  }

  pricesSheet(from: string, to: string, filter: PriceSheetFilter = {}): Observable<Blob> {
    const params: Record<string, string> = { from, to };
    if (filter.categoryId) params['categoryId'] = filter.categoryId;
    if (filter.supplierId) params['supplierId'] = filter.supplierId;
    if (filter.search?.trim()) params['search'] = filter.search.trim();
    return this.http.get('/api/costing/intelligence/prices/sheet', { params, responseType: 'blob' });
  }

  plan(request: OrderPlanRequest): Observable<OrderPlan> {
    return this.http.post<OrderPlan>('/api/costing/intelligence/orders', request);
  }

  // The order as approved: each material's quantity in its purchase unit.
  orderSheet(lines: { rawMaterialId: string; quantity: number }[], groupBy: OrderSheetGrouping, coverageDays: number): Observable<Blob> {
    return this.http.post('/api/costing/intelligence/orders/sheet', { lines, groupBy, coverageDays }, { responseType: 'blob' });
  }

  consumption(from: string, to: string): Observable<ConsumptionReport> {
    return this.http.get<ConsumptionReport>('/api/costing/intelligence/consumption', { params: { from, to } });
  }

  consumptionSheet(from: string, to: string): Observable<Blob> {
    return this.http.get('/api/costing/intelligence/consumption/sheet', { params: { from, to }, responseType: 'blob' });
  }

  abc(from: string, to: string): Observable<AbcReport> {
    return this.http.get<AbcReport>('/api/costing/intelligence/abc', { params: { from, to } });
  }

  abcSheet(from: string, to: string): Observable<Blob> {
    return this.http.get('/api/costing/intelligence/abc/sheet', { params: { from, to }, responseType: 'blob' });
  }
}
```


> 📄 **`frontend/src/app/features/costing/intelligence-shell.ts`** — 24 سطر

```ts
import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SubNav, SubNavTab } from '../shared/sub-nav';

// Material & demand intelligence (تحليلات الخامات والطلبيات): what the purchase prices did and what
// that does to the dishes; what to order for the days ahead; what was used against what the sales
// should have taken; and which materials hold the money, and how long the stock lasts.
@Component({
  selector: 'app-intelligence-shell',
  imports: [RouterOutlet, SubNav],
  template: `
    <app-sub-nav label="Material & demand intelligence" [tabs]="tabs" />
    <router-outlet />
  `,
  styleUrl: './costing.scss',
})
export class IntelligenceShell {
  protected readonly tabs: SubNavTab[] = [
    { path: 'prices', icon: 'price_change', en: 'Price variance & recipe impact', ar: 'انحراف الأسعار وأثره' },
    { path: 'orders', icon: 'shopping_basket', en: 'Smart order planner', ar: 'تخطيط الطلبيات' },
    { path: 'consumption', icon: 'compare_arrows', en: 'Theoretical vs actual', ar: 'النظري مقابل الفعلي' },
    { path: 'abc', icon: 'stacked_bar_chart', en: 'ABC & days on hand', ar: 'تصنيف ABC وكفاية المخزون' },
  ];
}
```


> 📄 **`frontend/src/app/features/costing/price-variance-page.ts`** — 329 سطر

```ts
import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';
import { IntelligenceApi, PriceVarianceReport, PriceVarianceRow } from '../../core/costing/intelligence.api';
import { errorMessage } from '../../core/http/error-message';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { NotifyService } from '../../core/ui/notify.service';
import { saveBlob } from '../../core/ui/save-blob';
import { FilterOption, FilterSelect } from '../shared/filter-select';
import { SearchField } from '../shared/search-field';
import { SortOption, SortState, smartMatch, sortItems } from '../shared/smart-search';
import { SortControl } from '../shared/sort-control';
import { PeriodBar, periodDays } from './period-bar';

type PriceSort = 'impact' | 'change' | 'material';

const sorts: SortOption<PriceSort>[] = [
  { key: 'impact', en: 'Impact (L.E)', ar: 'الأثر المالي', descending: true },
  { key: 'change', en: 'Price change %', ar: 'نسبة التغير', descending: true },
  { key: 'material', en: 'Material', ar: 'الخامة' },
];

// Purchase price variance & recipe impact (انحراف أسعار الخامات وأثره المالي): each material bought
// in the period, the moving average it came in with against the latest net price paid, the change
// and its share, what was bought, and the financial impact, (latest − baseline) × bought. Opened, a
// row shows each dish and prep item it goes into, and what the change does to its portion's cost
// and food cost.
@Component({
  selector: 'app-price-variance-page',
  imports: [DatePipe, DecimalPipe, FilterSelect, MatButtonModule, MatIconModule, MatProgressBarModule, MoneyPipe, PeriodBar, SearchField, SortControl],
  template: `
    <div class="toolbar">
      <app-period-bar [(from)]="from" [(to)]="to" />
      <span class="spacer"></span>
      <button mat-stroked-button (click)="download()" [disabled]="!report()"><mat-icon>download</mat-icon> Excel</button>
    </div>
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    @if (error()) {
      <p class="error">{{ error() }}</p>
    } @else if (report(); as r) {
      <div class="tiles">
        <div class="tile key">
          <span class="label">Financial impact · الأثر المالي للانحراف</span>
          <strong [class.loss]="r.totalImpact > 0" [class.gain]="r.totalImpact < 0">{{ r.totalImpact | money }}</strong>
          <small class="muted">(latest − baseline) × bought, every material</small>
        </div>
        <div class="tile">
          <span class="label">Prices up · ارتفاع</span>
          <strong class="loss">{{ r.rising }}</strong>
          <small class="muted">{{ r.increases | money }} more paid</small>
        </div>
        <div class="tile">
          <span class="label">Prices down · انخفاض</span>
          <strong class="gain">{{ r.falling }}</strong>
          <small class="muted">{{ (r.decreases ? -r.decreases : 0) | money }} saved</small>
        </div>
        <div class="tile">
          <span class="label">Dishes affected · الأطباق المتأثرة</span>
          <strong>{{ r.affectedDishes }}</strong>
          <small class="muted">by a price that went up</small>
        </div>
        <div class="tile">
          <span class="label">Largest rise · أعلى ارتفاع</span>
          <strong>{{ r.largestRisePercent === null ? '—' : '+' + (r.largestRisePercent | number: '1.1-1') + '%' }}</strong>
          <small class="muted">{{ r.largestRise ?? 'No price went up' }}</small>
        </div>
      </div>

      <div class="toolbar smart">
        <app-search-field [(value)]="search" placeholder="Material or code · الخامة أو الكود" />
        <div class="pills">
          <app-filter-select label="Category · القسم" icon="category" [options]="categoryFilters()" [(value)]="category" />
          <app-filter-select label="Supplier · المورد" icon="local_shipping" [options]="supplierFilters()" [(value)]="supplier" />
          <app-sort-control [options]="sorts" [(sort)]="sort" />
        </div>
      </div>

      <div class="table-wrap">
        <table class="grid prices">
          <thead>
            <tr>
              <th>Material<span class="ar">الخامة</span></th>
              <th class="num">Baseline avg<span class="ar">متوسط السعر السابق</span></th>
              <th class="num">Latest net<span class="ar">آخر سعر شراء صافي</span></th>
              <th class="num">Change<span class="ar">فرق السعر ونسبة التغير</span></th>
              <th class="num">Bought<span class="ar">الكمية المشتراة</span></th>
              <th class="num">Impact<span class="ar">الأثر المالي</span></th>
              <th class="num">Recipes<span class="ar">الوصفات المتأثرة</span></th>
            </tr>
          </thead>
          <tbody>
            @for (row of shown(); track row.rawMaterialId) {
              <tr class="row" [class.open]="isOpen(row)" (click)="toggle(row)" (keydown.enter)="toggle(row)" tabindex="0"
                [attr.aria-expanded]="isOpen(row)">
                <td>
                  <mat-icon class="chevron">{{ isOpen(row) ? 'expand_less' : 'expand_more' }}</mat-icon>
                  <strong>{{ row.material }}</strong>
                  <div class="muted small">{{ row.code ? row.code + ' · ' : '' }}per {{ row.purchaseUnit }}{{ row.category ? ' · ' + row.category : '' }}</div>
                </td>
                <td class="num">{{ row.baselineCost === null ? '—' : (row.baselineCost | money) }}</td>
                <td class="num">{{ row.latestCost === null ? '—' : (row.latestCost | money) }}</td>
                <td class="num" [class.loss]="(row.unitVariance ?? 0) > 0" [class.gain]="(row.unitVariance ?? 0) < 0">
                  {{ row.unitVariance === null ? '—' : (row.unitVariance > 0 ? '+' : '') + (row.unitVariance | money) }}
                  @if (row.changePercent !== null) {
                    <div class="small">{{ row.changePercent > 0 ? '+' : '' }}{{ row.changePercent | number: '1.1-1' }}%</div>
                  }
                </td>
                <td class="num">{{ row.quantityPurchased | number: '1.0-3' }} {{ row.purchaseUnit }}</td>
                <td class="num" [class.loss]="(row.impact ?? 0) > 0" [class.gain]="(row.impact ?? 0) < 0">
                  <strong>{{ row.impact === null ? '—' : (row.impact | money) }}</strong>
                </td>
                <td class="num">{{ row.affected.length || '—' }}</td>
              </tr>
              @if (isOpen(row)) {
                <tr class="detail">
                  <td colspan="7">
                    <div class="supplier muted small">
                      Latest from {{ row.latestSupplier ?? 'no supplier' }}{{ row.latestPurchasedOn ? ', ' + (row.latestPurchasedOn | date: 'd MMM y') : '' }}
                      · {{ row.invoices }} {{ row.invoices === 1 ? 'invoice' : 'invoices' }} in these days
                      <span class="ar">آخر مورد</span>
                    </div>
                    @if (row.affected.length) {
                      <table class="grid affected">
                        <thead>
                          <tr>
                            <th>Dish or prep item<span class="ar">الصنف</span></th>
                            <th class="num">Uses<span class="ar">الكمية</span></th>
                            <th class="num">Cost change<span class="ar">تغير التكلفة</span></th>
                            <th class="num">Price or cost<span class="ar">السعر أو التكلفة</span></th>
                            <th class="num">Food cost<span class="ar">نسبة التكلفة</span></th>
                          </tr>
                        </thead>
                        <tbody>
                          @for (a of row.affected; track a.kind + a.id) {
                            <tr>
                              <td>
                                <span class="kind" [class.prep]="a.kind === 'PrepItem'">{{ a.kind === 'Dish' ? 'Dish · طبق' : 'Prep item · مُصنّع' }}</span>
                                {{ a.name }}
                                @if (a.nameAr) {
                                  <span class="ar">{{ a.nameAr }}</span>
                                }
                              </td>
                              <td class="num">{{ a.quantity | number: '1.0-3' }} {{ row.purchaseUnit }} / {{ a.per }}</td>
                              <td class="num" [class.loss]="a.costChange > 0" [class.gain]="a.costChange < 0">
                                {{ a.costChange > 0 ? '+' : '' }}{{ a.costChange | money }} / {{ a.per }}
                              </td>
                              <td class="num">{{ a.against === null ? '—' : (a.against | money) }}</td>
                              <td class="num" [class.loss]="(a.points ?? 0) > 0" [class.gain]="(a.points ?? 0) < 0">
                                @if (a.points === null) {
                                  —
                                } @else {
                                  {{ a.points > 0 ? '+' : '' }}{{ a.points | number: '1.1-1' }}{{ a.kind === 'Dish' ? ' pts' : '%' }}
                                }
                              </td>
                            </tr>
                          }
                        </tbody>
                      </table>
                    } @else {
                      <p class="muted small">No dish or prep item uses it{{ row.unitVariance === 0 ? ', and its price held' : '' }}.</p>
                    }
                  </td>
                </tr>
              }
            } @empty {
              <tr><td colspan="7" class="muted">Nothing bought in these days{{ filtered() ? ' that matches' : '' }}.</td></tr>
            }
          </tbody>
        </table>
      </div>
      <p class="note small">
        Baseline: the moving average each material came in with, from its stock ledger before the first day. Latest: the last net price paid
        in the period, after the invoice's discounts. A dish's food cost moves by the change in its portion's cost over its menu price; a prep
        item's, over what it costs now.
        <span class="note-ar" lang="ar" dir="rtl">السعر السابق: متوسط التكلفة قبل الفترة. آخر سعر: صافي آخر فاتورة بعد الخصم.</span>
      </p>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .loss {
      color: var(--mat-sys-error);
    }
    .gain {
      color: var(--app-ok);
    }
    .small {
      font-size: 0.85em;
    }
    tr.row {
      cursor: pointer;

      &:focus-visible {
        outline: 2px solid var(--mat-sys-primary);
        outline-offset: -2px;
      }
    }
    .chevron {
      vertical-align: middle;
      margin-inline-end: 4px;
      color: var(--app-slate-500, #64748b);
    }
    tr.detail > td {
      background: var(--app-slate-50, #f8fafc);
    }
    .supplier {
      margin: 0 0 8px;
    }
    .affected {
      margin: 0;
      background: var(--mat-sys-surface);
    }
    .kind {
      margin-inline-end: 6px;
      background: color-mix(in srgb, var(--mat-sys-primary) 10%, transparent);
      color: var(--mat-sys-primary);

      &.prep {
        background: color-mix(in srgb, #0d9488 12%, transparent);
        color: #0f766e;
      }
    }
  `,
})
export class PriceVariancePage {
  private readonly api = inject(IntelligenceApi);
  private readonly notify = inject(NotifyService);

  protected readonly from = signal(periodDays('month').from);
  protected readonly to = signal(periodDays('month').to);
  protected readonly report = signal<PriceVarianceReport | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly opened = signal(new Set<string>());

  protected readonly search = signal('');
  protected readonly category = signal('');
  protected readonly supplier = signal('');
  protected readonly sorts = sorts;
  protected readonly sort = signal<SortState<PriceSort>>({ key: 'impact', direction: -1 });

  protected readonly categoryFilters = computed<FilterOption[]>(() => {
    const r = this.report();
    return [
      { value: '', label: 'All · الكل', count: r?.rows.length ?? 0 },
      ...(r?.categories ?? []).map((c) => ({
        value: c.id, label: c.nameAr ? `${c.name} · ${c.nameAr}` : c.name, count: r!.rows.filter((row) => row.categoryId === c.id).length,
      })),
    ];
  });

  protected readonly supplierFilters = computed<FilterOption[]>(() => {
    const r = this.report();
    return [
      { value: '', label: 'All · الكل', count: r?.rows.length ?? 0 },
      ...(r?.suppliers ?? []).map((s) => ({ value: s.id, label: s.name, count: r!.rows.filter((row) => row.supplierIds.includes(s.id)).length })),
    ];
  });

  protected readonly filtered = computed(() => !!(this.search() || this.category() || this.supplier()));

  protected readonly shown = computed(() =>
    sortItems(
      (this.report()?.rows ?? []).filter(
        (r) =>
          (!this.category() || r.categoryId === this.category()) &&
          (!this.supplier() || r.supplierIds.includes(this.supplier())) &&
          smartMatch(this.search(), r.material, r.code, r.category),
      ),
      this.sort(),
      (r, key) => (key === 'impact' ? r.impact : key === 'change' ? r.changePercent : r.material),
      (r) => r.material,
    ),
  );

  constructor() {
    effect(() => {
      const [from, to] = [this.from(), this.to()];
      untracked(() => void this.load(from, to));
    });
  }

  protected isOpen(row: PriceVarianceRow): boolean {
    return this.opened().has(row.rawMaterialId);
  }

  protected toggle(row: PriceVarianceRow): void {
    this.opened.update((opened) => {
      const next = new Set(opened);
      if (!next.delete(row.rawMaterialId)) {
        next.add(row.rawMaterialId);
      }
      return next;
    });
  }

  // As filtered on screen.
  protected async download(): Promise<void> {
    try {
      const blob = await firstValueFrom(
        this.api.pricesSheet(this.from(), this.to(), { categoryId: this.category(), supplierId: this.supplier(), search: this.search() }),
      );
      saveBlob(blob, `price-variance-${this.from()}-to-${this.to()}.xlsx`);
    } catch (error) {
      this.notify.error(error, 'The sheet could not be made.');
    }
  }

  private async load(from: string, to: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const report = await firstValueFrom(this.api.prices(from, to));
      if (this.from() === from && this.to() === to) {
        this.report.set(report);
      }
    } catch (error) {
      this.report.set(null);
      this.error.set(errorMessage(error, 'The price variance could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }
}
```


> 📄 **`frontend/src/app/features/costing/order-planner-page.ts`** — 476 سطر

```ts
import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';
import { IntelligenceApi, OrderPlan, OrderPlanLine, OrderSheetGrouping, PlannedDish } from '../../core/costing/intelligence.api';
import { errorMessage } from '../../core/http/error-message';
import { Company } from '../../core/settings/company';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { NotifyService } from '../../core/ui/notify.service';
import { saveBlob } from '../../core/ui/save-blob';
import { FilterOption, FilterSelect } from '../shared/filter-select';
import { SearchField } from '../shared/search-field';
import { smartMatch } from '../shared/smart-search';

const dishKey = (d: { menuItemId: number; variantId: number | null }) => `${d.menuItemId}-${d.variantId ?? ''}`;

// The smart order planner (تخطيط وإنشاء الطلبيات الذكية): the last days' sales a day, for the days
// ahead, grown by the manager's expectation (a weekend, a holiday) or set dish by dish; broken down
// through the recipes and the prep items (those on hand used first) into what each bought material
// needs; that plus its reorder level, less the shelf, rounded up to whole purchase units, at the
// latest net price. The manager approves each quantity, and downloads the order as a sheet, by
// category or by supplier.
@Component({
  selector: 'app-order-planner-page',
  imports: [
    DatePipe,
    DecimalPipe,
    FilterSelect,
    FormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MoneyPipe,
    SearchField,
  ],
  template: `
    <section class="controls" aria-label="What the order is planned from">
      <div class="control">
        <span class="label">Look back <span class="ar">فترة الرجوع للمبيعات</span></span>
        <mat-button-toggle-group [value]="lookback()" (change)="lookback.set($event.value)" aria-label="Days of sales looked back">
          @for (d of [7, 14, 30]; track d) {
            <mat-button-toggle [value]="d">{{ d }} days</mat-button-toggle>
          }
        </mat-button-toggle-group>
      </div>
      <div class="control">
        <span class="label">Cover <span class="ar">أيام التغطية المطلوبة</span></span>
        <div class="row">
          <mat-button-toggle-group [value]="coverage()" (change)="coverage.set($event.value)" aria-label="Days the order covers">
            @for (d of [3, 7, 14]; track d) {
              <mat-button-toggle [value]="d">{{ d }} days</mat-button-toggle>
            }
          </mat-button-toggle-group>
          <mat-form-field subscriptSizing="dynamic" class="days">
            <mat-label>Or · أو</mat-label>
            <input matInput type="number" min="1" max="60" step="1" [ngModel]="coverage()" (ngModelChange)="setCoverage($event)" aria-label="Days covered" />
            <span matTextSuffix>&nbsp;days</span>
          </mat-form-field>
        </div>
      </div>
      <div class="control">
        <span class="label">Expected sales <span class="ar">توقعات المبيعات من المدير</span></span>
        <div class="row">
          <mat-form-field subscriptSizing="dynamic" class="growth">
            <mat-label>Growth · نسبة النمو</mat-label>
            <input matInput type="number" min="-90" max="500" step="5" [ngModel]="growth()" (ngModelChange)="setGrowth($event)" aria-label="Growth percent" />
            <span matTextSuffix>&nbsp;%</span>
          </mat-form-field>
          <button mat-stroked-button (click)="showDishes.update((v) => !v)" [attr.aria-expanded]="showDishes()">
            <mat-icon>{{ showDishes() ? 'expand_less' : 'tune' }}</mat-icon> Per dish <span class="ar">لكل طبق</span>
            @if (expectations().size) {
              <span class="count">{{ expectations().size }}</span>
            }
          </button>
        </div>
      </div>
    </section>

    @if (showDishes() && plan(); as p) {
      <section class="dishes" aria-label="Expected sales per dish">
        <p class="muted small">
          A dish's expected sales a day replace its last {{ p.lookbackDays }} days' average grown by {{ p.growthPercent }}%. Cleared, it follows
          them again.
        </p>
        <div class="table-wrap">
          <table class="grid">
            <thead>
              <tr>
                <th>Dish<span class="ar">الطبق</span></th>
                <th class="num">Sold a day<span class="ar">متوسط البيع اليومي</span></th>
                <th class="num">Expected a day<span class="ar">المتوقع يوميًا</span></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (d of p.dishes; track d.code) {
                <tr>
                  <td>
                    <span class="muted small">{{ d.code }}</span> {{ d.name }}
                    @if (!d.hasRecipe) {
                      <span class="flag">No recipe · بدون وصفة</span>
                    }
                  </td>
                  <td class="num">{{ d.averageDaily | number: '1.0-2' }}</td>
                  <td class="num">
                    <mat-form-field subscriptSizing="dynamic" class="expected">
                      <input matInput type="number" min="0" step="any" [ngModel]="expectationOf(d)" (ngModelChange)="expect(d, $event)"
                        [placeholder]="(d.averageDaily * (1 + p.growthPercent / 100) | number: '1.0-2') ?? ''" [attr.aria-label]="'Expected a day, ' + d.name" />
                    </mat-form-field>
                  </td>
                  <td>
                    @if (expectations().has(key(d))) {
                      <button mat-icon-button (click)="expect(d, null)" [attr.aria-label]="'Clear the expectation of ' + d.name"><mat-icon>close</mat-icon></button>
                    }
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="4" class="muted">No dish sells by a recipe yet.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    }

    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    @if (error()) {
      <p class="error">{{ error() }}</p>
    } @else if (plan(); as p) {
      <div class="tiles">
        <div class="tile key">
          <span class="label">Approved order · الطلبية المعتمدة</span>
          <strong>{{ approvedTotal() | money }}</strong>
          <small class="muted">{{ approvedLines() }} {{ approvedLines() === 1 ? 'material' : 'materials' }} · estimated at the latest net prices</small>
        </div>
        <div class="tile">
          <span class="label">Suggested · المقترح</span>
          <strong>{{ p.estimatedTotal | money }}</strong>
          <small class="muted">{{ p.toOrder }} to order</small>
        </div>
        <div class="tile">
          <span class="label">Below reorder level · تحت حد الطلب</span>
          <strong [class.loss]="p.belowReorder > 0">{{ p.belowReorder }}</strong>
        </div>
        <div class="tile">
          <span class="label">Planned from · مبني على</span>
          <strong>{{ p.coverageDays }} days</strong>
          <small class="muted">ahead, from the sales of {{ p.lookbackFrom | date: 'd MMM' }} – {{ p.lookbackTo | date: 'd MMM' }}</small>
        </div>
      </div>
      @if (p.noPrice.length) {
        <p class="note small">No price yet for {{ p.noPrice.join(', ') }}: their cost is left out.</p>
      }

      <div class="toolbar smart">
        <app-search-field [(value)]="search" placeholder="Material or code · الخامة أو الكود" />
        <div class="pills">
          <app-filter-select label="Show · عرض" icon="filter_list" [options]="showFilters()" [(value)]="show" />
          <app-filter-select label="Category · القسم" icon="category" [options]="categoryFilters()" [(value)]="category" />
        </div>
        <span class="spacer"></span>
        <button mat-button (click)="resetApproved()" [disabled]="!approved().size">Back to suggested</button>
        <mat-button-toggle-group [value]="groupBy()" (change)="groupBy.set($event.value)" aria-label="Group the sheet by" class="group">
          <mat-button-toggle value="Category">By category</mat-button-toggle>
          <mat-button-toggle value="Supplier">By supplier</mat-button-toggle>
        </mat-button-toggle-group>
        <button mat-flat-button (click)="download()" [disabled]="!approvedLines()"><mat-icon>download</mat-icon> Excel order sheet</button>
      </div>

      <div class="table-wrap">
        <table class="grid plan">
          <thead>
            <tr>
              <th>Material<span class="ar">الخامة</span></th>
              <th class="num">On hand<span class="ar">الرصيد المتاح</span></th>
              <th class="num">A day<span class="ar">متوسط الاستهلاك اليومي</span></th>
              <th class="num">Expected<span class="ar">الاستهلاك المتوقع</span></th>
              <th class="num">Reorder level<span class="ar">حد الطلب</span></th>
              <th class="num">Suggested<span class="ar">الكمية المرشحة</span></th>
              <th class="num">Approved<span class="ar">الكمية المعتمدة</span></th>
              <th class="num">Estimated cost<span class="ar">التكلفة التقديرية</span></th>
            </tr>
          </thead>
          <tbody>
            @for (line of shown(); track line.rawMaterialId) {
              <tr [class.below]="line.belowReorder">
                <td>
                  <strong>{{ line.material }}</strong>
                  <div class="muted small">
                    {{ line.code ? line.code + ' · ' : '' }}{{ line.category ?? 'Uncategorized' }}{{ line.supplier ? ' · ' + line.supplier : '' }}
                  </div>
                </td>
                <td class="num" [class.loss]="line.onHand < 0">{{ line.onHand | number: '1.0-3' }} {{ line.purchaseUnit }}</td>
                <td class="num">{{ line.averageDailyUsage | number: '1.0-3' }}</td>
                <td class="num">{{ line.expectedUsage | number: '1.0-3' }}</td>
                <td class="num">{{ line.reorderLevel | number: '1.0-3' }}</td>
                <td class="num"><strong>{{ line.suggested | number: '1.0-3' }}</strong> {{ line.purchaseUnit }}</td>
                <td class="num">
                  <mat-form-field subscriptSizing="dynamic" class="approved">
                    <input matInput type="number" min="0" step="any" [ngModel]="approvedOf(line)" (ngModelChange)="approve(line, $event)"
                      [attr.aria-label]="'Approved, ' + line.material" />
                    <span matTextSuffix>&nbsp;{{ line.purchaseUnit }}</span>
                  </mat-form-field>
                </td>
                <td class="num">{{ line.unitPrice === null ? '—' : (approvedOf(line) * line.unitPrice | money) }}</td>
              </tr>
            } @empty {
              <tr><td colspan="8" class="muted">Nothing to order{{ search() || category() || show() ? ' that matches' : '' }}.</td></tr>
            }
          </tbody>
          <tfoot>
            <tr>
              <td colspan="7">Approved order · الطلبية المعتمدة</td>
              <td class="num">{{ approvedTotal() | money }}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p class="note small">
        Expected usage: the dishes' expected sales over the days covered, through the recipes and the prep items (each ingredient as purchased,
        its yield allowed for), the prep items on hand used first. Suggested = expected + reorder level − on hand, never below nothing, rounded up
        to whole purchase units; costed at the latest net price paid.
        <span class="note-ar" lang="ar" dir="rtl">الكمية المرشحة = الاستهلاك المتوقع + حد الطلب − الرصيد، مقربة لأعلى لوحدة الشراء.</span>
      </p>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .controls {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: 12px 24px;
      margin-bottom: 12px;
      padding: 12px 14px;
      border-radius: 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface);
    }
    .control {
      display: grid;
      gap: 4px;

      .label {
        font: var(--mat-sys-label-medium);
        color: var(--mat-sys-on-surface-variant);
      }
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
    .ar {
      margin-inline-start: 4px;
      font-size: 0.85em;
      opacity: 0.8;
    }
    .controls .ar {
      display: inline;
    }
    .controls button {
      white-space: nowrap;
    }
    .days {
      width: 110px;
    }
    .growth {
      width: 140px;
    }
    .count {
      margin-inline-start: 6px;
      padding: 0 7px;
      border-radius: 999px;
      background: var(--mat-sys-primary);
      color: var(--mat-sys-on-primary);
      font-size: 12px;
    }
    .dishes {
      margin-bottom: 16px;
    }
    .expected {
      width: 110px;
    }
    .approved {
      width: 130px;
    }
    .flag {
      margin-inline-start: 6px;
      color: var(--app-warn);
      font-size: 0.85em;
    }
    .loss {
      color: var(--mat-sys-error);
    }
    .small {
      font-size: 0.85em;
    }
    tr.below td:first-child {
      box-shadow: inset 3px 0 0 var(--app-warn);
    }
    .group {
      flex: none;
    }
  `,
})
export class OrderPlannerPage {
  private readonly api = inject(IntelligenceApi);
  private readonly notify = inject(NotifyService);
  private readonly company = inject(Company);

  protected readonly lookback = signal(14);
  protected readonly coverage = signal(7);
  protected readonly growth = signal(0);
  // Expected sales a day, by dish, as the manager set them.
  protected readonly expectations = signal(new Map<string, { menuItemId: number; variantId: number | null; expectedDaily: number }>());
  protected readonly showDishes = signal(false);

  protected readonly plan = signal<OrderPlan | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  // Quantities the manager changed, by material; the rest are as suggested.
  protected readonly approved = signal(new Map<string, number>());

  protected readonly search = signal('');
  protected readonly category = signal('');
  protected readonly show = signal('');
  protected readonly groupBy = signal<OrderSheetGrouping>('Category');

  protected readonly showFilters = computed<FilterOption[]>(() => {
    const lines = this.plan()?.lines ?? [];
    return [
      { value: '', label: 'All · الكل', count: lines.length },
      { value: 'order', label: 'To order · للطلب', count: lines.filter((l) => this.approvedOf(l) > 0).length },
      { value: 'below', label: 'Below reorder · تحت حد الطلب', count: lines.filter((l) => l.belowReorder).length },
    ];
  });

  protected readonly categoryFilters = computed<FilterOption[]>(() => {
    const lines = this.plan()?.lines ?? [];
    const categories = [...new Map(lines.map((l) => [l.categoryId, l])).values()];
    return [
      { value: '', label: 'All · الكل', count: lines.length },
      ...categories.map((c) => ({
        value: c.categoryId,
        label: c.categoryAr ? `${c.category} · ${c.categoryAr}` : (c.category ?? 'Uncategorized'),
        count: lines.filter((l) => l.categoryId === c.categoryId).length,
      })),
    ];
  });

  protected readonly shown = computed(() =>
    (this.plan()?.lines ?? []).filter(
      (l) =>
        (!this.category() || l.categoryId === this.category()) &&
        (this.show() !== 'order' || this.approvedOf(l) > 0) &&
        (this.show() !== 'below' || l.belowReorder) &&
        smartMatch(this.search(), l.material, l.code, l.category, l.supplier),
    ),
  );

  protected readonly approvedLines = computed(() => (this.plan()?.lines ?? []).filter((l) => this.approvedOf(l) > 0).length);
  protected readonly approvedTotal = computed(() =>
    Math.round((this.plan()?.lines ?? []).reduce((sum, l) => sum + this.approvedOf(l) * (l.unitPrice ?? 0), 0) * 100) / 100,
  );

  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    // Planned again as the inputs change: at once for a choice, after a pause for what is typed.
    effect(() => {
      const request = {
        lookbackDays: this.lookback(),
        coverageDays: this.coverage(),
        growthPercent: this.growth(),
        dishes: [...this.expectations().values()],
      };
      untracked(() => {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => void this.load(request), this.plan() ? 300 : 0);
      });
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  protected key(dish: PlannedDish): string {
    return dishKey(dish);
  }

  protected expectationOf(dish: PlannedDish): number | null {
    return this.expectations().get(dishKey(dish))?.expectedDaily ?? null;
  }

  protected expect(dish: PlannedDish, value: number | string | null): void {
    const next = new Map(this.expectations());
    const number = value === null || value === '' ? null : Number(value);
    if (number === null || !Number.isFinite(number) || number < 0) {
      next.delete(dishKey(dish));
    } else {
      next.set(dishKey(dish), { menuItemId: dish.menuItemId, variantId: dish.variantId, expectedDaily: number });
    }
    this.expectations.set(next);
  }

  protected setCoverage(value: number | string | null): void {
    const days = Math.round(Number(value));
    if (Number.isFinite(days) && days >= 1 && days <= 60) {
      this.coverage.set(days);
    }
  }

  protected setGrowth(value: number | string | null): void {
    const percent = Number(value);
    if (value !== '' && value !== null && Number.isFinite(percent) && percent >= -90 && percent <= 500) {
      this.growth.set(percent);
    }
  }

  protected approvedOf(line: OrderPlanLine): number {
    return this.approved().get(line.rawMaterialId) ?? line.suggested;
  }

  protected approve(line: OrderPlanLine, value: number | string | null): void {
    const number = Number(value);
    const next = new Map(this.approved());
    if (value === '' || value === null || !Number.isFinite(number) || number < 0) {
      next.delete(line.rawMaterialId);
    } else {
      next.set(line.rawMaterialId, number);
    }
    this.approved.set(next);
  }

  protected resetApproved(): void {
    this.approved.set(new Map());
  }

  protected async download(): Promise<void> {
    const plan = this.plan();
    if (!plan) {
      return;
    }
    const lines = plan.lines.filter((l) => this.approvedOf(l) > 0).map((l) => ({ rawMaterialId: l.rawMaterialId, quantity: this.approvedOf(l) }));
    try {
      const blob = await firstValueFrom(this.api.orderSheet(lines, this.groupBy(), plan.coverageDays));
      saveBlob(blob, `order-${plan.lookbackTo}.xlsx`);
      this.notify.info(`Order sheet made: ${lines.length} ${lines.length === 1 ? 'material' : 'materials'}, ${this.company.money(this.approvedTotal())}.`);
    } catch (error) {
      this.notify.error(error, 'The order sheet could not be made.');
    }
  }

  private async load(request: { lookbackDays: number; coverageDays: number; growthPercent: number; dishes: { menuItemId: number; variantId: number | null; expectedDaily: number }[] }): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.plan.set(await firstValueFrom(this.api.plan(request)));
    } catch (error) {
      this.error.set(errorMessage(error, 'The order could not be planned.'));
    } finally {
      this.loading.set(false);
    }
  }
}
```


> 📄 **`frontend/src/app/features/costing/consumption-page.ts`** — 279 سطر

```ts
import { DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';
import { ConsumptionReport, IntelligenceApi, VarianceEvaluation, evaluationLabels } from '../../core/costing/intelligence.api';
import { errorMessage } from '../../core/http/error-message';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { NotifyService } from '../../core/ui/notify.service';
import { saveBlob } from '../../core/ui/save-blob';
import { FilterOption, FilterSelect } from '../shared/filter-select';
import { SearchField } from '../shared/search-field';
import { SortOption, SortState, smartMatch, sortItems } from '../shared/smart-search';
import { SortControl } from '../shared/sort-control';
import { PeriodBar, periodDays } from './period-bar';

type ConsumptionSort = 'cost' | 'percent' | 'material';

const sorts: SortOption<ConsumptionSort>[] = [
  { key: 'cost', en: 'Variance cost', ar: 'قيمة الانحراف', descending: true },
  { key: 'percent', en: 'Variance %', ar: 'نسبة الانحراف', descending: true },
  { key: 'material', en: 'Material', ar: 'الخامة' },
];

// Theoretical against actual consumption (استهلاك الخامات: النظري مقابل الفعلي): for each bought
// material over the period, what the stores say was used (opening + purchases − logged waste −
// closing) against what the sales should have taken by the recipes, through the prep items; the
// difference no record explains, valued at the average cost now. Beyond the tolerance, in red:
// waste not recorded, over-portioning, or stock walking out.
@Component({
  selector: 'app-consumption-page',
  imports: [DecimalPipe, FilterSelect, MatButtonModule, MatIconModule, MatProgressBarModule, MoneyPipe, PeriodBar, SearchField, SortControl],
  template: `
    <div class="toolbar">
      <app-period-bar [(from)]="from" [(to)]="to" />
      <span class="spacer"></span>
      <button mat-stroked-button (click)="download()" [disabled]="!report()"><mat-icon>download</mat-icon> Excel</button>
    </div>
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    @if (error()) {
      <p class="error">{{ error() }}</p>
    } @else if (report(); as r) {
      <div class="tiles">
        <div class="tile key">
          <span class="label">Unexplained variance · قيمة الانحراف غير المبرر</span>
          <strong [class.loss]="r.unexplainedValue > 0">{{ r.unexplainedValue | money }}</strong>
          <small class="muted">at the average cost now</small>
        </div>
        <div class="tile">
          <span class="label">High-loss materials · خامات بفاقد مرتفع</span>
          <strong [class.loss]="r.highLoss > 0">{{ r.highLoss }}</strong>
          <small class="muted">more than {{ r.tolerancePercent }}% over the recipes</small>
        </div>
        <div class="tile">
          <span class="label">Theoretical usage · الاستهلاك النظري</span>
          <strong>{{ r.theoreticalValue | money }}</strong>
          <small class="muted">what the sales should have taken</small>
        </div>
        <div class="tile">
          <span class="label">Actual usage · الاستهلاك الفعلي</span>
          <strong>{{ r.actualValue | money }}</strong>
          <small class="muted">what left the stores</small>
        </div>
      </div>
      @if (r.soldWithoutRecipe.length) {
        <p class="note small">
          Sold with no recipe, so in no theoretical usage:
          {{ withoutRecipe() }}.
          <span class="note-ar" lang="ar" dir="rtl">أصناف مباعة بدون وصفة.</span>
        </p>
      }

      <div class="toolbar smart">
        <app-search-field [(value)]="search" placeholder="Material or code · الخامة أو الكود" />
        <div class="pills">
          <app-filter-select label="Evaluation · التقييم" icon="flag" [options]="evaluationFilters()" [(value)]="evaluation" />
          <app-filter-select label="Category · القسم" icon="category" [options]="categoryFilters()" [(value)]="category" />
          <app-sort-control [options]="sorts" [(sort)]="sort" />
        </div>
      </div>

      <div class="table-wrap">
        <table class="grid consumption">
          <thead>
            <tr>
              <th>Material<span class="ar">الخامة</span></th>
              <th class="num">Opening<span class="ar">أول المدة</span></th>
              <th class="num">Purchases<span class="ar">المشتريات</span></th>
              <th class="num">Logged waste<span class="ar">الهالك المسجل</span></th>
              <th class="num">Closing<span class="ar">آخر المدة</span></th>
              <th class="num">Actual<span class="ar">الاستهلاك الفعلي</span></th>
              <th class="num">Theoretical<span class="ar">الاستهلاك النظري</span></th>
              <th class="num">Unexplained<span class="ar">الانحراف غير المبرر</span></th>
              <th class="num">Variance cost<span class="ar">قيمة الانحراف</span></th>
            </tr>
          </thead>
          <tbody>
            @for (row of shown(); track row.rawMaterialId) {
              <tr [class.high-loss]="row.evaluation === 'Unfavourable'">
                <td>
                  <strong>{{ row.material }}</strong>
                  <div class="muted small">{{ row.code ? row.code + ' · ' : '' }}in {{ row.purchaseUnit }}{{ row.category ? ' · ' + row.category : '' }}</div>
                  <span class="evaluation" [class]="row.evaluation">{{ labels[row.evaluation].en }}<span class="ar">{{ labels[row.evaluation].ar }}</span></span>
                </td>
                <td class="num">{{ row.opening | number: '1.0-3' }}</td>
                <td class="num">{{ row.purchases | number: '1.0-3' }}</td>
                <td class="num">{{ row.waste | number: '1.0-3' }}</td>
                <td class="num">{{ row.closing | number: '1.0-3' }}</td>
                <td class="num"><strong>{{ row.actualUsage | number: '1.0-3' }}</strong></td>
                <td class="num">
                  <strong>{{ row.theoreticalUsage | number: '1.0-3' }}</strong>
                  @if (row.heldInPrep) {
                    <div class="muted small">{{ row.heldInPrep | number: '1.0-3' }} in prep stock</div>
                  }
                </td>
                <td class="num" [class.loss]="row.unexplainedQuantity > 0" [class.gain]="row.unexplainedQuantity < 0">
                  {{ row.unexplainedQuantity > 0 ? '+' : '' }}{{ row.unexplainedQuantity | number: '1.0-3' }}
                  @if (row.unexplainedPercent !== null) {
                    <div class="small">{{ row.unexplainedPercent > 0 ? '+' : '' }}{{ row.unexplainedPercent | number: '1.1-1' }}%</div>
                  }
                </td>
                <td class="num" [class.loss]="(row.varianceCost ?? 0) > 0" [class.gain]="(row.varianceCost ?? 0) < 0">
                  <strong>{{ row.varianceCost === null ? '—' : (row.varianceCost | money) }}</strong>
                </td>
              </tr>
            } @empty {
              <tr><td colspan="9" class="muted">Nothing moved in these days{{ search() || category() || evaluation() ? ' that matches' : '' }}.</td></tr>
            }
          </tbody>
          <tfoot>
            <tr>
              <td colspan="8">Unexplained variance · الانحراف غير المبرر</td>
              <td class="num">{{ r.unexplainedValue | money }}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p class="note small">
        Actual = opening + purchases − logged waste − closing, the stock book either side of the period (an opening count in it is where its
        stock began). Theoretical = each dish sold × its recipe as purchased, through the prep items, plus what is still held in the prep items
        made from it. A prep item's logged waste counts as its ingredients'. Unexplained = actual − theoretical, at the average cost now.
        <span class="note-ar" lang="ar" dir="rtl">الفعلي = أول المدة + المشتريات − الهالك المسجل − آخر المدة. النظري = المبيعات × الوصفة.</span>
      </p>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .loss {
      color: var(--mat-sys-error);
    }
    .gain {
      color: var(--app-ok);
    }
    .small {
      font-size: 0.85em;
    }
    tr.high-loss td {
      background: color-mix(in srgb, var(--mat-sys-error) 7%, transparent);
    }
    tr.high-loss td:first-child {
      box-shadow: inset 3px 0 0 var(--mat-sys-error);
    }
    .evaluation {
      display: inline-block;
      margin-top: 4px;
      padding: 0 8px;
      border-radius: 999px;
      font-size: 11.5px;
      line-height: 20px;
      background: var(--app-slate-100, #f1f5f9);
      color: var(--app-slate-600, #475569);

      .ar {
        margin-inline-start: 4px;
        opacity: 0.8;
      }
      &.Unfavourable {
        background: color-mix(in srgb, var(--mat-sys-error) 14%, transparent);
        color: var(--mat-sys-error);
      }
      &.Favourable {
        background: color-mix(in srgb, var(--app-ok) 14%, transparent);
        color: var(--app-ok);
      }
    }
  `,
})
export class ConsumptionPage {
  private readonly api = inject(IntelligenceApi);
  private readonly notify = inject(NotifyService);
  protected readonly labels = evaluationLabels;

  protected readonly from = signal(periodDays('month').from);
  protected readonly to = signal(periodDays('month').to);
  protected readonly report = signal<ConsumptionReport | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly search = signal('');
  protected readonly category = signal('');
  protected readonly evaluation = signal('');
  protected readonly sorts = sorts;
  protected readonly sort = signal<SortState<ConsumptionSort>>({ key: 'cost', direction: -1 });

  protected readonly evaluationFilters = computed<FilterOption[]>(() => {
    const rows = this.report()?.rows ?? [];
    return [
      { value: '', label: 'All · الكل', count: rows.length },
      ...(['Unfavourable', 'Favourable', 'WithinLimit', 'SharedCost'] as VarianceEvaluation[])
        .map((e) => ({ value: e, label: `${evaluationLabels[e].en} · ${evaluationLabels[e].ar}`, count: rows.filter((r) => r.evaluation === e).length }))
        .filter((o) => o.count > 0),
    ];
  });

  protected readonly categoryFilters = computed<FilterOption[]>(() => {
    const rows = this.report()?.rows ?? [];
    const categories = [...new Map(rows.map((r) => [r.categoryId, r])).values()];
    return [
      { value: '', label: 'All · الكل', count: rows.length },
      ...categories.map((c) => ({
        value: c.categoryId,
        label: c.categoryAr ? `${c.category} · ${c.categoryAr}` : (c.category ?? 'Uncategorized'),
        count: rows.filter((r) => r.categoryId === c.categoryId).length,
      })),
    ];
  });

  protected readonly shown = computed(() =>
    sortItems(
      (this.report()?.rows ?? []).filter(
        (r) =>
          (!this.category() || r.categoryId === this.category()) &&
          (!this.evaluation() || r.evaluation === this.evaluation()) &&
          smartMatch(this.search(), r.material, r.code, r.category),
      ),
      this.sort(),
      (r, key) => (key === 'cost' ? r.varianceCost : key === 'percent' ? r.unexplainedPercent : r.material),
      (r) => r.material,
    ),
  );

  protected readonly withoutRecipe = computed(() =>
    (this.report()?.soldWithoutRecipe ?? []).map((s) => `${s.itemCode} ${s.menuItem} (${s.quantity})`).join(', '),
  );

  constructor() {
    effect(() => {
      const [from, to] = [this.from(), this.to()];
      untracked(() => void this.load(from, to));
    });
  }

  protected async download(): Promise<void> {
    try {
      saveBlob(await firstValueFrom(this.api.consumptionSheet(this.from(), this.to())), `consumption-${this.from()}-to-${this.to()}.xlsx`);
    } catch (error) {
      this.notify.error(error, 'The sheet could not be made.');
    }
  }

  private async load(from: string, to: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const report = await firstValueFrom(this.api.consumption(from, to));
      if (this.from() === from && this.to() === to) {
        this.report.set(report);
      }
    } catch (error) {
      this.report.set(null);
      this.error.set(errorMessage(error, 'The consumption could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }
}
```


> 📄 **`frontend/src/app/features/costing/abc-page.ts`** — 281 سطر

```ts
import { DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';
import { AbcClass, AbcReport, IntelligenceApi } from '../../core/costing/intelligence.api';
import { errorMessage } from '../../core/http/error-message';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { NotifyService } from '../../core/ui/notify.service';
import { saveBlob } from '../../core/ui/save-blob';
import { FilterOption, FilterSelect } from '../shared/filter-select';
import { SearchField } from '../shared/search-field';
import { SortOption, SortState, smartMatch, sortItems } from '../shared/smart-search';
import { SortControl } from '../shared/sort-control';
import { PeriodBar, periodDays } from './period-bar';

type AbcSort = 'value' | 'days' | 'stock' | 'material';

const sorts: SortOption<AbcSort>[] = [
  { key: 'value', en: 'Worth used', ar: 'قيمة الاستهلاك', descending: true },
  { key: 'days', en: 'Days on hand', ar: 'أيام الكفاية' },
  { key: 'stock', en: 'Stock value', ar: 'قيمة المخزون', descending: true },
  { key: 'material', en: 'Material', ar: 'الخامة' },
];

const classLabels: Record<AbcClass, { en: string; ar: string; hint: string }> = {
  A: { en: 'Class A', ar: 'الفئة A', hint: 'Top 75% of what was used: control daily' },
  B: { en: 'Class B', ar: 'الفئة B', hint: 'The next 15%: control weekly' },
  C: { en: 'Class C', ar: 'الفئة C', hint: 'The last 10%: bulk, low cost' },
};

// ABC classification & days on hand (تصنيف ABC وكفاية المخزون): each bought material by what the
// period used of it (sold, made into prep items, wasted, short at a count) at the cost then, the
// largest first: A the materials up to three quarters of it, B the next 15%, C the rest. What is on
// the shelf, what it uses a day, and so how many days it lasts: under two, a stockout risk; stock
// with nothing used of it in the period, dead stock, the cash it ties up.
@Component({
  selector: 'app-abc-page',
  imports: [DecimalPipe, FilterSelect, MatButtonModule, MatIconModule, MatProgressBarModule, MoneyPipe, PeriodBar, SearchField, SortControl],
  template: `
    <div class="toolbar">
      <app-period-bar [(from)]="from" [(to)]="to" />
      <span class="spacer"></span>
      <button mat-stroked-button (click)="download()" [disabled]="!report()"><mat-icon>download</mat-icon> Excel</button>
    </div>
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    @if (error()) {
      <p class="error">{{ error() }}</p>
    } @else if (report(); as r) {
      <div class="tiles">
        @for (c of r.classes; track c.class) {
          <div class="tile" [class.key]="c.class === 'A'">
            <span class="label"><span class="abc" [class]="c.class">{{ c.class }}</span> {{ classes[c.class].en }} · {{ classes[c.class].ar }}</span>
            <strong>{{ c.materials }}</strong>
            <small class="muted">{{ c.value | money }} · {{ c.sharePercent | number: '1.1-1' }}% of what was used</small>
          </div>
        }
        <div class="tile">
          <span class="label">Stockout risk · خطر النفاد</span>
          <strong [class.loss]="r.stockoutRisks > 0">{{ r.stockoutRisks }}</strong>
          <small class="muted">less than 2 days on hand</small>
        </div>
        <div class="tile">
          <span class="label">Dead / slow stock · مخزون راكد</span>
          <strong [class.warn]="r.deadStock > 0">{{ r.deadStock }}</strong>
          <small class="muted">{{ r.deadStockValue | money }} tied up, nothing used in {{ r.days }} days</small>
        </div>
      </div>

      <div class="toolbar smart">
        <app-search-field [(value)]="search" placeholder="Material or code · الخامة أو الكود" />
        <div class="pills">
          <app-filter-select label="Class · الفئة" icon="stacked_bar_chart" [options]="classFilters()" [(value)]="klass" />
          <app-filter-select label="Flag · تنبيه" icon="flag" [options]="flagFilters()" [(value)]="flag" />
          <app-sort-control [options]="sorts" [(sort)]="sort" />
        </div>
      </div>

      <div class="table-wrap">
        <table class="grid abc-table">
          <thead>
            <tr>
              <th>Class<span class="ar">الفئة</span></th>
              <th>Material<span class="ar">الخامة</span></th>
              <th class="num">Used<span class="ar">الاستهلاك</span></th>
              <th class="num">Worth<span class="ar">القيمة</span></th>
              <th class="num">Share<span class="ar">النسبة · التراكمي</span></th>
              <th class="num">On hand<span class="ar">الرصيد</span></th>
              <th class="num">A day<span class="ar">يوميًا</span></th>
              <th class="num">Days on hand<span class="ar">أيام الكفاية</span></th>
              <th>Flag<span class="ar">تنبيه</span></th>
            </tr>
          </thead>
          <tbody>
            @for (row of shown(); track row.rawMaterialId) {
              <tr [class.risk]="row.stockoutRisk" [class.dead]="row.deadStock">
                <td><span class="abc" [class]="row.class">{{ row.class }}</span></td>
                <td>
                  <strong>{{ row.material }}</strong>
                  <div class="muted small">{{ row.code ? row.code + ' · ' : '' }}in {{ row.purchaseUnit }}{{ row.category ? ' · ' + row.category : '' }}</div>
                </td>
                <td class="num">{{ row.consumption | number: '1.0-3' }}</td>
                <td class="num"><strong>{{ row.consumptionValue | money }}</strong></td>
                <td class="num">
                  {{ row.sharePercent | number: '1.1-1' }}%
                  <div class="muted small">{{ row.cumulativePercent | number: '1.1-1' }}%</div>
                </td>
                <td class="num">
                  {{ row.onHand | number: '1.0-3' }}
                  <div class="muted small">{{ row.stockValue === null ? 'no price' : (row.stockValue | money) }}</div>
                </td>
                <td class="num">{{ row.averageDaily | number: '1.0-3' }}</td>
                <td class="num" [class.loss]="row.stockoutRisk">{{ row.daysOnHand === null ? '—' : (row.daysOnHand | number: '1.1-1') }}</td>
                <td>
                  @if (row.stockoutRisk) {
                    <span class="flag risk">Stockout risk · خطر النفاد</span>
                  } @else if (row.deadStock) {
                    <span class="flag dead">Dead stock · راكد</span>
                  }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="9" class="muted">No bought material{{ search() || klass() || flag() ? ' matches' : ' yet' }}.</td></tr>
            }
          </tbody>
          <tfoot>
            <tr>
              <td colspan="3">Used in {{ r.days }} days · الاستهلاك</td>
              <td class="num">{{ r.consumptionValue | money }}</td>
              <td colspan="2" class="num">{{ r.stockValue | money }} on hand</td>
              <td colspan="3"></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p class="note small">
        Used: sold, made into prep items, wasted, or short at a count, valued at the cost when it happened. Classes by the running share of that
        worth: A to 75%, B to 90%, C the rest. Days on hand = on hand ÷ used a day over the period's days so far.
        <span class="note-ar" lang="ar" dir="rtl">أيام الكفاية = الرصيد ÷ متوسط الاستهلاك اليومي.</span>
      </p>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .loss {
      color: var(--mat-sys-error);
    }
    .warn {
      color: var(--app-warn);
    }
    .small {
      font-size: 0.85em;
    }
    .abc {
      display: inline-grid;
      place-items: center;
      width: 24px;
      height: 24px;
      border-radius: 6px;
      font-weight: 700;
      font-size: 12px;
      color: #fff;

      &.A {
        background: #4f46e5;
      }
      &.B {
        background: #64748b;
      }
      &.C {
        background: #cbd5e1;
        color: #334155;
      }
    }
    .flag {
      padding: 0 8px;
      border-radius: 999px;
      font-size: 11.5px;
      line-height: 20px;
      white-space: nowrap;

      &.risk {
        background: color-mix(in srgb, var(--mat-sys-error) 14%, transparent);
        color: var(--mat-sys-error);
      }
      &.dead {
        background: color-mix(in srgb, var(--app-warn) 16%, transparent);
        color: var(--app-warn);
      }
    }
    tr.risk td:first-child {
      box-shadow: inset 3px 0 0 var(--mat-sys-error);
    }
    tr.dead td:first-child {
      box-shadow: inset 3px 0 0 var(--app-warn);
    }
  `,
})
export class AbcPage {
  private readonly api = inject(IntelligenceApi);
  private readonly notify = inject(NotifyService);
  protected readonly classes = classLabels;

  protected readonly from = signal(periodDays('month').from);
  protected readonly to = signal(periodDays('month').to);
  protected readonly report = signal<AbcReport | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly search = signal('');
  protected readonly klass = signal('');
  protected readonly flag = signal('');
  protected readonly sorts = sorts;
  protected readonly sort = signal<SortState<AbcSort>>({ key: 'value', direction: -1 });

  protected readonly classFilters = computed<FilterOption[]>(() => {
    const rows = this.report()?.rows ?? [];
    return [
      { value: '', label: 'All · الكل', count: rows.length },
      ...(['A', 'B', 'C'] as AbcClass[]).map((c) => ({ value: c, label: `${classLabels[c].en} · ${classLabels[c].ar}`, count: rows.filter((r) => r.class === c).length })),
    ];
  });

  protected readonly flagFilters = computed<FilterOption[]>(() => {
    const rows = this.report()?.rows ?? [];
    return [
      { value: '', label: 'All · الكل', count: rows.length },
      { value: 'risk', label: 'Stockout risk · خطر النفاد', count: rows.filter((r) => r.stockoutRisk).length },
      { value: 'dead', label: 'Dead stock · راكد', count: rows.filter((r) => r.deadStock).length },
    ];
  });

  protected readonly shown = computed(() =>
    sortItems(
      (this.report()?.rows ?? []).filter(
        (r) =>
          (!this.klass() || r.class === this.klass()) &&
          (this.flag() !== 'risk' || r.stockoutRisk) &&
          (this.flag() !== 'dead' || r.deadStock) &&
          smartMatch(this.search(), r.material, r.code, r.category),
      ),
      this.sort(),
      (r, key) => (key === 'value' ? r.consumptionValue : key === 'days' ? r.daysOnHand : key === 'stock' ? r.stockValue : r.material),
      (r) => r.material,
    ),
  );

  constructor() {
    effect(() => {
      const [from, to] = [this.from(), this.to()];
      untracked(() => void this.load(from, to));
    });
  }

  protected async download(): Promise<void> {
    try {
      saveBlob(await firstValueFrom(this.api.abcSheet(this.from(), this.to())), `abc-${this.from()}-to-${this.to()}.xlsx`);
    } catch (error) {
      this.notify.error(error, 'The sheet could not be made.');
    }
  }

  private async load(from: string, to: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const report = await firstValueFrom(this.api.abc(from, to));
      if (this.from() === from && this.to() === to) {
        this.report.set(report);
      }
    } catch (error) {
      this.report.set(null);
      this.error.set(errorMessage(error, 'The ABC report could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }
}
```


## 3. التقارير

- `SpendingPage` + `SpendingPie`: أين ذهب المال: ثلاث فطائر (مخزون مقابل مصروفات، ثم كل منهما بالفئة)، ثم عمود لكل فئة. (`SpendingPie` رسم SVG يدوي بلا مكتبة رسوم.)
- `TreasuryPage`: تحليل الخزنة والتدفقات لأي فترة.
- `TheoreticalPage`: التكلفة النظرية للمبيعات وورقة المبيعات اليدوية.
- `VariancePage`: الفروقات بين جردين (أحمر عجز، أزرق زيادة، ضمن السماحية).
- `KpisPage`: المؤشرات بالمدى الصحي وسبب النقص، وقائمة الدخل، وإدخال المصروفات الشهرية.
- `BreakEvenPage`: ورقة نقطة التعادل وسيناريوهاتها الأربعة.

> 📄 **`frontend/src/app/features/costing/costing-reports-shell.ts`** — 25 سطر

```ts
import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SubNav, SubNavTab } from '../shared/sub-nav';

// Reports (التقارير): where the money went, stock and expenses; the safe's money in and out; then the
// food cost reports, the month's KPIs and the break-even worksheet.
@Component({
  selector: 'app-costing-reports-shell',
  imports: [RouterOutlet, SubNav],
  template: `
    <app-sub-nav label="Reports" [tabs]="tabs" />
    <router-outlet />
  `,
  styleUrl: './costing.scss',
})
export class CostingReportsShell {
  protected readonly tabs: SubNavTab[] = [
    { path: 'spending', icon: 'pie_chart', en: 'Spending analysis', ar: 'تحليل الإنفاق' },
    { path: 'treasury', icon: 'account_balance', en: 'Safe & treasury', ar: 'تحليل الخزنة والتدفقات النقدية' },
    { path: 'theoretical', icon: 'calculate', en: 'Theoretical cost', ar: 'التكلفة النظرية' },
    { path: 'variance', icon: 'compare_arrows', en: 'Variance', ar: 'الانحراف' },
    { path: 'kpis', icon: 'insights', en: 'KPIs', ar: 'المؤشرات' },
    { path: 'break-even', icon: 'balance', en: 'Break-even', ar: 'نقطة التعادل' },
  ];
}
```


> 📄 **`frontend/src/app/features/costing/spending-page.ts`** — 588 سطر

```ts
import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';
import { CategorySpending, CostingApi, SpendingReport, expenseLineLabels } from '../../core/costing/costing.api';
import { errorMessage } from '../../core/http/error-message';
import { Company } from '../../core/settings/company';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { PieSlice, SpendingPie, pieColors } from './spending-pie';

type Period = 'month' | 'last-month' | 'quarter' | 'year' | 'custom';

// Spending analysis (تحليل الإنفاق) over any period: how the money went, stock and expenses, from
// the posted invoices, each on its own date. Three pies first: stock against expenses, then each
// split by category. Then a bar per category, split into what went into stock and what was
// expenses, largest first; the table below has the figures and, opened, what was bought under each.
@Component({
  selector: 'app-spending-page',
  imports: [
    DatePipe,
    DecimalPipe,
    FormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MoneyPipe,
    SpendingPie,
  ],
  template: `
    <div class="toolbar">
      <mat-button-toggle-group [value]="period()" (change)="choose($event.value)" aria-label="Period" class="periods">
        <mat-button-toggle value="month">This month</mat-button-toggle>
        <mat-button-toggle value="last-month">Last month</mat-button-toggle>
        <mat-button-toggle value="quarter">3 months</mat-button-toggle>
        <mat-button-toggle value="year">This year</mat-button-toggle>
      </mat-button-toggle-group>
      <mat-form-field subscriptSizing="dynamic" class="day">
        <mat-label>From · من</mat-label>
        <input matInput type="date" [ngModel]="from()" (ngModelChange)="custom('from', $event)" [max]="to()" />
      </mat-form-field>
      <mat-form-field subscriptSizing="dynamic" class="day">
        <mat-label>To · إلى</mat-label>
        <input matInput type="date" [ngModel]="to()" (ngModelChange)="custom('to', $event)" [min]="from()" />
      </mat-form-field>
      <span class="spacer"></span>
      <button mat-button (click)="exportCsv()" [disabled]="!report()?.categories?.length"><mat-icon>download</mat-icon> CSV</button>
      <button mat-button (click)="print()" [disabled]="!report()"><mat-icon>print</mat-icon> Print</button>
    </div>
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    @if (error()) {
      <p class="error">{{ error() }}</p>
    } @else if (report(); as r) {
      <header class="report-head">
        <h2>Spending analysis <span class="inline-ar">تحليل الإنفاق</span></h2>
        <div class="muted">{{ r.from | date: 'd MMM y' }} – {{ r.to | date: 'd MMM y' }} · posted invoices, each on its own date</div>
      </header>
      <div class="tiles">
        <div class="tile">
          <span class="label">Total spent · إجمالي المشتريات</span>
          <strong>{{ r.total | money }}</strong>
        </div>
        <div class="tile">
          <span class="label"><span class="swatch stock"></span>Into stock · خامات</span>
          <strong>{{ r.inventory | money }}</strong>
          <small class="muted">cost of sales as the recipes use it</small>
        </div>
        <div class="tile">
          <span class="label"><span class="swatch expense"></span>Expenses · مصروفات</span>
          <strong>{{ r.expenses | money }}</strong>
          <small class="muted">overheads in the KPIs' profit and loss</small>
        </div>
        <div class="tile">
          <span class="label">Invoices · الفواتير</span>
          <strong>{{ r.invoices }}</strong>
        </div>
      </div>

      @if (r.categories.length) {
        <div class="pies">
          <app-spending-pie
            heading="Stock and expenses"
            headingAr="الخامات والمصروفات"
            [slices]="split()"
            shareOf="of all spending"
            empty="Nothing was spent in these days."
          />
          <app-spending-pie
            heading="Into stock, by category"
            headingAr="الخامات حسب القسم"
            [slices]="stockByCategory()"
            shareOf="of what went into stock"
            empty="Nothing went into stock in these days."
          />
          <app-spending-pie
            heading="Expenses, by category"
            headingAr="المصروفات حسب القسم"
            [slices]="expensesByCategory()"
            shareOf="of the expenses"
            empty="No expenses in these days."
          />
        </div>

        <section class="chart" aria-label="Spending by category, stock and expenses">
          <div class="legend" aria-hidden="true">
            <span><span class="swatch stock"></span>Into stock</span>
            <span><span class="swatch expense"></span>Expenses</span>
          </div>
          <div class="bars">
            @for (c of r.categories; track c.categoryId) {
              <div
                class="bar-row"
                tabindex="0"
                [attr.aria-label]="describe(c)"
                (mouseenter)="hovered.set(c.categoryId)"
                (mouseleave)="hovered.set(null)"
                (focus)="hovered.set(c.categoryId)"
                (blur)="hovered.set(null)"
              >
                <span class="name">
                  {{ c.category }}
                  @if (c.categoryAr) {
                    <span class="ar">{{ c.categoryAr }}</span>
                  }
                </span>
                <span class="track">
                  @if (c.inventory > 0) {
                    <span class="segment stock" [style.width.%]="width(c.inventory)"></span>
                  }
                  @if (c.expenses > 0) {
                    <span class="segment expense" [style.width.%]="width(c.expenses)"></span>
                  }
                </span>
                <span class="value">
                  {{ c.total | money }}
                  <small class="muted">{{ c.sharePercent === null ? '' : (c.sharePercent | number: '1.1-1') + '%' }}</small>
                </span>
                @if (hovered() === c.categoryId) {
                  <span class="tip" role="tooltip">
                    <strong>{{ c.category }}</strong>
                    <span class="tip-row"><span class="swatch stock"></span>Into stock <b>{{ c.inventory | money }}</b></span>
                    <span class="tip-row"><span class="swatch expense"></span>Expenses <b>{{ c.expenses | money }}</b></span>
                    <span class="tip-row">Share of all spending <b>{{ c.sharePercent | number: '1.1-1' }}%</b></span>
                  </span>
                }
              </div>
            }
          </div>
        </section>

        <div class="table-wrap">
          <table class="grid">
            <thead>
              <tr>
                <th>Category<span class="ar">الفئة</span></th>
                <th>Expenses count as<span class="ar">تُحتسب المصروفات ضمن</span></th>
                <th class="num">Into stock<span class="ar">خامات</span></th>
                <th class="num">Expenses<span class="ar">مصروفات</span></th>
                <th class="num">Total<span class="ar">الإجمالي</span></th>
                <th class="num">Share<span class="ar">النسبة</span></th>
              </tr>
            </thead>
            <tbody>
              @for (c of r.categories; track c.categoryId) {
                <tr class="clickable" (click)="toggle(c.categoryId)" [attr.aria-expanded]="open().has(c.categoryId)">
                  <td>
                    <mat-icon class="chevron">{{ open().has(c.categoryId) ? 'expand_more' : 'chevron_right' }}</mat-icon>
                    {{ c.category }}
                  </td>
                  <td class="muted">{{ c.expenses > 0 ? lines[c.expenseLine].en : '—' }}</td>
                  <td class="num">{{ c.inventory | money }}</td>
                  <td class="num">{{ c.expenses | money }}</td>
                  <td class="num"><strong>{{ c.total | money }}</strong></td>
                  <td class="num">{{ c.sharePercent === null ? '—' : (c.sharePercent | number: '1.1-1') + '%' }}</td>
                </tr>
                @if (open().has(c.categoryId)) {
                  @for (i of c.items; track i.itemType + i.itemId) {
                    <tr class="item">
                      <td>
                        {{ i.name }}
                        @if (i.itemType === 'Expense') {
                          <span class="badge expense">Expense · مصروف</span>
                        }
                      </td>
                      <td class="muted">{{ i.quantity | number: '1.0-3' }} {{ i.unit }} · {{ i.lines }} {{ i.lines === 1 ? 'line' : 'lines' }}</td>
                      <td class="num">{{ i.itemType === 'Inventory' ? (i.total | money) : '' }}</td>
                      <td class="num">{{ i.itemType === 'Expense' ? (i.total | money) : '' }}</td>
                      <td class="num">{{ i.total | money }}</td>
                      <td></td>
                    </tr>
                  }
                }
              }
            </tbody>
            <tfoot>
              <tr>
                <td colspan="2">Total · الإجمالي</td>
                <td class="num">{{ r.inventory | money }}</td>
                <td class="num">{{ r.expenses | money }}</td>
                <td class="num">{{ r.total | money }}</td>
                <td class="num">100%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      } @else {
        <p class="note">No invoices were posted for these days.</p>
      }
      @if (r.unpricedLines) {
        <p class="note">
          {{ r.unpricedLines }} {{ r.unpricedLines === 1 ? 'line was' : 'lines were' }} received with no price: in stock, but not in these
          figures.
        </p>
      }
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    :host {
      /* The reference palette's first two categorical slots, validated together on the light surface. */
      --series-stock: #2a78d6;
      --series-expense: #eb6834;
    }
    .periods {
      flex-wrap: wrap;
    }
    .day {
      width: 160px;
    }
    .report-head {
      margin-bottom: 12px;

      h2 {
        margin: 0 0 4px;
        font: var(--mat-sys-title-large);
      }
    }
    .tiles {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 8px;
      margin-bottom: 16px;
    }
    .tile {
      display: grid;
      gap: 2px;
      padding: 12px 14px;
      border-radius: 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface);

      .label {
        display: flex;
        align-items: center;
        gap: 6px;
        font: var(--mat-sys-label-medium);
        color: var(--mat-sys-on-surface-variant);
      }
      strong {
        font: var(--mat-sys-headline-small);
      }
    }
    .swatch {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 3px;
      flex: none;
      print-color-adjust: exact;
      -webkit-print-color-adjust: exact;

      &.stock {
        background: var(--series-stock);
      }
      &.expense {
        background: var(--series-expense);
      }
    }
    .pies {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 8px;
      margin-bottom: 16px;
    }
    .chart {
      padding: 12px 14px;
      margin-bottom: 16px;
      border-radius: 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface);
    }
    .legend {
      display: flex;
      gap: 16px;
      margin-bottom: 10px;
      font: var(--mat-sys-label-medium);
      color: var(--mat-sys-on-surface-variant);

      > span {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
    }
    .bars {
      display: grid;
      gap: 4px;
    }
    .bar-row {
      position: relative;
      display: grid;
      grid-template-columns: minmax(90px, 180px) 1fr auto;
      align-items: center;
      gap: 10px;
      padding: 4px 6px;
      border-radius: 8px;
      outline: none;

      &:hover,
      &:focus-visible {
        background: var(--mat-sys-surface-container-low);
      }
      &:focus-visible {
        box-shadow: inset 0 0 0 2px var(--mat-sys-primary);
      }
    }
    .name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;

      .ar {
        display: inline;
        margin-left: 6px;
      }
    }
    .track {
      display: flex;
      gap: 2px;
      height: 14px;
      min-width: 0;
    }
    .segment {
      height: 100%;
      min-width: 3px;
      print-color-adjust: exact;
      -webkit-print-color-adjust: exact;

      &.stock {
        background: var(--series-stock);
      }
      &.expense {
        background: var(--series-expense);
      }
      &:last-child {
        border-radius: 0 4px 4px 0;
      }
    }
    .value {
      min-width: 120px;
      text-align: end;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;

      small {
        margin-left: 6px;
      }
    }
    .tip {
      position: absolute;
      z-index: 3;
      top: calc(100% - 2px);
      left: min(40%, 220px);
      display: grid;
      gap: 2px;
      min-width: 200px;
      padding: 8px 10px;
      border-radius: 8px;
      background: var(--mat-sys-inverse-surface);
      color: var(--mat-sys-inverse-on-surface);
      font: var(--mat-sys-body-small);
      box-shadow: var(--mat-sys-level2);
      pointer-events: none;
    }
    .tip-row {
      display: flex;
      align-items: center;
      gap: 6px;

      b {
        margin-left: auto;
        padding-left: 12px;
      }
    }
    .chevron {
      vertical-align: middle;
      margin-right: 2px;
      color: var(--mat-sys-on-surface-variant);
    }
    tr.item td {
      background: var(--mat-sys-surface-container-lowest);
      font-size: 0.92em;
    }
    tr.item td:first-child {
      padding-left: 38px;
    }
    .badge.expense {
      background: color-mix(in srgb, var(--app-warn) 16%, transparent);
      color: var(--app-warn);
    }
    @media (max-width: 600px) {
      .bar-row {
        grid-template-columns: 1fr auto;
      }
      .track {
        grid-column: 1 / -1;
        grid-row: 2;
      }
    }
  `,
})
export class SpendingPage {
  protected readonly company = inject(Company);
  private readonly api = inject(CostingApi);

  protected readonly lines = expenseLineLabels;
  protected readonly period = signal<Period>('month');
  protected readonly from = signal(SpendingPage.iso(SpendingPage.firstOfMonth(new Date())));
  protected readonly to = signal(SpendingPage.iso(new Date()));
  protected readonly report = signal<SpendingReport | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly hovered = signal<string | null>(null);
  protected readonly open = signal(new Set<string>());

  // The pies: stock against expenses, then what each category put into each. The first two
  // colours are the bars' own.
  protected readonly split = computed<PieSlice[]>(() => {
    const r = this.report();
    return r
      ? [
          { key: 'stock', en: 'Into stock', ar: 'خامات', amount: r.inventory, color: pieColors[0] },
          { key: 'expenses', en: 'Expenses', ar: 'مصروفات', amount: r.expenses, color: pieColors[1] },
        ]
      : [];
  });
  protected readonly stockByCategory = computed(() => this.byCategory('inventory'));
  protected readonly expensesByCategory = computed(() => this.byCategory('expenses'));

  // The bars are drawn against the largest category, which fills the track.
  private readonly largest = computed(() => Math.max(0, ...(this.report()?.categories ?? []).map((c) => c.total)));

  constructor() {
    effect(() => {
      const from = this.from();
      const to = this.to();
      untracked(() => void this.load(from, to));
    });
  }

  protected choose(period: Period): void {
    const today = new Date();
    const first = SpendingPage.firstOfMonth(today);
    const [from, to] =
      period === 'last-month'
        ? [new Date(first.getFullYear(), first.getMonth() - 1, 1), new Date(first.getFullYear(), first.getMonth(), 0)]
        : period === 'quarter'
          ? [new Date(first.getFullYear(), first.getMonth() - 2, 1), today]
          : period === 'year'
            ? [new Date(today.getFullYear(), 0, 1), today]
            : [first, today];
    this.period.set(period);
    this.from.set(SpendingPage.iso(from));
    this.to.set(SpendingPage.iso(to));
  }

  // Days typed in: the period is whatever they say. Cleared or half typed, it stays as it was.
  protected custom(end: 'from' | 'to', value: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) {
      return;
    }
    this.period.set('custom');
    (end === 'from' ? this.from : this.to).set(value);
  }

  protected width(amount: number): number {
    const largest = this.largest();
    return largest > 0 ? (amount / largest) * 100 : 0;
  }

  protected describe(c: CategorySpending): string {
    return `${c.category}: ${this.company.money(c.total)}, ${c.inventory.toFixed(2)} into stock and ${c.expenses.toFixed(2)} expenses, ${c.sharePercent ?? 0}% of all spending`;
  }

  private byCategory(part: 'inventory' | 'expenses'): PieSlice[] {
    return (this.report()?.categories ?? []).map((c) => ({ key: c.categoryId, en: c.category, ar: c.categoryAr, amount: c[part] }));
  }

  protected toggle(categoryId: string): void {
    this.open.update((open) => {
      const next = new Set(open);
      if (!next.delete(categoryId)) {
        next.add(categoryId);
      }
      return next;
    });
  }

  protected print(): void {
    window.print();
  }

  // For a spreadsheet: a byte order mark so Excel reads the Arabic names as UTF-8. A row per
  // category, then each item under it.
  protected exportCsv(): void {
    const r = this.report();
    if (!r) {
      return;
    }
    const rows: (string | number)[][] = [
      ['Category · الفئة', 'Item · الصنف', 'Type', 'Quantity', 'Unit', 'Into Stock', 'Expenses', 'Total', 'Share %'],
    ];
    for (const c of r.categories) {
      rows.push([c.category, '', '', '', '', c.inventory.toFixed(2), c.expenses.toFixed(2), c.total.toFixed(2), c.sharePercent?.toFixed(1) ?? '']);
      for (const i of c.items) {
        rows.push([
          c.category,
          i.name,
          i.itemType === 'Expense' ? 'Expense' : 'Stock',
          i.quantity,
          i.unit,
          i.itemType === 'Inventory' ? i.total.toFixed(2) : '',
          i.itemType === 'Expense' ? i.total.toFixed(2) : '',
          i.total.toFixed(2),
          '',
        ]);
      }
    }
    rows.push(['Total', '', '', '', '', r.inventory.toFixed(2), r.expenses.toFixed(2), r.total.toFixed(2), '100.0']);
    const csv = rows.map((cells) => cells.map(SpendingPage.cell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `spending-analysis-${r.from}-to-${r.to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  private async load(from: string, to: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const report = await firstValueFrom(this.api.spending(from, to));
      // Moved on while it loaded: what came back is for other days.
      if (this.from() === from && this.to() === to) {
        this.report.set(report);
      }
    } catch (error) {
      this.report.set(null);
      this.error.set(errorMessage(error, 'The spending could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }

  private static cell(value: string | number): string {
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  private static firstOfMonth(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  private static iso(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
}
```


> 📄 **`frontend/src/app/features/costing/spending-pie.ts`** — 322 سطر

```ts
import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, input, signal } from '@angular/core';
import { Company } from '../../core/settings/company';
import { MoneyPipe } from '../../core/ui/money.pipe';

// One slice of a pie: what it is and how much. A colour of its own, or the next of the palette.
export interface PieSlice {
  key: string;
  en: string;
  ar: string | null;
  amount: number;
  color?: string;
}

interface DrawnSlice extends PieSlice {
  color: string;
  percent: number;
  path: string;
  // Where its tooltip points, as percentages of the pie's box.
  tipX: number;
  tipY: number;
  // For "Other": how many it holds.
  count?: number;
}

// The reference palette's categorical slots, in order, validated together on the light surface,
// and a grey kept for "Other".
export const pieColors = ['#2a78d6', '#eb6834', '#1b998b', '#8e5bc4', '#d9a404', '#c23b6e', '#5c9e31'];
const otherColor = '#7a8794';

// Past this many, the smallest go together as "Other": a pie of slivers says nothing.
const mostSlices = 8;

const size = 200;
const centre = size / 2;
const outer = 90;
const inner = 54;

// A ring of slices, largest first from the top, the total in its middle, with a legend that has
// every slice's amount and share. Pointing at a slice or its legend row says the same in a tooltip.
@Component({
  selector: 'app-spending-pie',
  imports: [DecimalPipe, MoneyPipe],
  template: `
    <h3>{{ heading() }} <span class="inline-ar">{{ headingAr() }}</span></h3>
    @if (total() > 0) {
      <div class="pie">
        <svg [attr.viewBox]="'0 0 ' + size + ' ' + size" role="img" [attr.aria-label]="describe()">
          @for (s of drawn(); track s.key; let i = $index) {
            <path
              [attr.d]="s.path"
              [attr.fill]="s.color"
              fill-rule="evenodd"
              [class.faded]="hovered() !== null && hovered() !== i"
              (mouseenter)="hovered.set(i)"
              (mouseleave)="hovered.set(null)"
            />
          }
        </svg>
        <div class="centre" aria-hidden="true">
          <small>{{ company.currency() }}</small>
          <strong>{{ total() | number: '1.0-0' }}</strong>
        </div>
        @if (tip(); as t) {
          <div class="tip" role="tooltip" [style.left.%]="t.tipX" [style.top.%]="t.tipY">
            <strong>{{ t.en }}</strong>
            @if (t.ar) {
              <span class="ar">{{ t.ar }}</span>
            }
            @if (t.count) {
              <span>{{ t.count }} categories</span>
            }
            <b class="amount">{{ t.amount | money }}</b>
            <span>{{ t.percent | number: '1.1-1' }}% {{ shareOf() }}</span>
          </div>
        }
      </div>
      <ul class="legend">
        @for (s of drawn(); track s.key; let i = $index) {
          <li
            tabindex="0"
            [class.active]="hovered() === i"
            (mouseenter)="hovered.set(i)"
            (mouseleave)="hovered.set(null)"
            (focus)="hovered.set(i)"
            (blur)="hovered.set(null)"
          >
            <span class="swatch" [style.background]="s.color"></span>
            <span class="name">
              {{ s.en }}
              @if (s.ar) {
                <span class="ar">{{ s.ar }}</span>
              }
            </span>
            <span class="amount">{{ s.amount | money }}</span>
            <span class="percent">{{ s.percent | number: '1.1-1' }}%</span>
          </li>
        }
      </ul>
    } @else {
      <p class="none">{{ empty() }}</p>
    }
  `,
  styles: `
    :host {
      display: block;
      padding: 12px 14px;
      border-radius: 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface);
      break-inside: avoid;
    }
    h3 {
      margin: 0 0 10px;
      font: var(--mat-sys-title-small);
    }
    .pie {
      position: relative;
      width: 100%;
      max-width: 200px;
      margin: 0 auto 12px;
    }
    svg {
      display: block;
      width: 100%;
      height: auto;
    }
    path {
      stroke: var(--mat-sys-surface);
      stroke-width: 1.5;
      transition: opacity 120ms;
      print-color-adjust: exact;
      -webkit-print-color-adjust: exact;

      &.faded {
        opacity: 0.35;
      }
    }
    .centre {
      position: absolute;
      inset: 0;
      display: grid;
      place-content: center;
      text-align: center;
      pointer-events: none;

      small {
        font: var(--mat-sys-label-small);
        color: var(--mat-sys-on-surface-variant);
      }
      strong {
        font: var(--mat-sys-title-medium);
        font-variant-numeric: tabular-nums;
      }
    }
    .tip {
      position: absolute;
      z-index: 3;
      transform: translate(-50%, calc(-100% - 6px));
      display: grid;
      gap: 2px;
      min-width: 170px;
      padding: 8px 10px;
      border-radius: 8px;
      background: var(--mat-sys-inverse-surface);
      color: var(--mat-sys-inverse-on-surface);
      font: var(--mat-sys-body-small);
      box-shadow: var(--mat-sys-level2);
      pointer-events: none;

      .ar {
        display: block;
      }
    }
    .tip .amount {
      font-variant-numeric: tabular-nums;
    }
    .legend {
      display: grid;
      gap: 2px;
      margin: 0;
      padding: 0;
      list-style: none;

      li {
        display: grid;
        grid-template-columns: auto 1fr auto 52px;
        align-items: center;
        gap: 8px;
        padding: 3px 6px;
        border-radius: 6px;
        font: var(--mat-sys-body-small);
        outline: none;

        &.active {
          background: var(--mat-sys-surface-container-low);
        }
        &:focus-visible {
          box-shadow: inset 0 0 0 2px var(--mat-sys-primary);
        }
      }
    }
    .swatch {
      width: 10px;
      height: 10px;
      border-radius: 3px;
      print-color-adjust: exact;
      -webkit-print-color-adjust: exact;
    }
    .name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;

      .ar {
        display: inline;
        margin-left: 6px;
        color: var(--mat-sys-on-surface-variant);
      }
    }
    .amount,
    .percent {
      text-align: end;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    .percent {
      color: var(--mat-sys-on-surface-variant);
    }
    .none {
      margin: 24px 0;
      text-align: center;
      color: var(--mat-sys-on-surface-variant);
    }
    @media print {
      .tip {
        display: none;
      }
    }
  `,
})
export class SpendingPie {
  protected readonly company = inject(Company);
  readonly heading = input.required<string>();
  readonly headingAr = input<string>('');
  readonly slices = input.required<PieSlice[]>();
  // What the share is of, said in the tooltip: "of all spending".
  readonly shareOf = input<string>('of the total');
  readonly empty = input<string>('Nothing for these days.');

  protected readonly size = size;
  protected readonly hovered = signal<number | null>(null);

  // Only what was spent; nothing and less than nothing have no slice.
  protected readonly total = computed(() => this.slices().reduce((sum, s) => sum + (s.amount > 0 ? s.amount : 0), 0));

  protected readonly drawn = computed<DrawnSlice[]>(() => {
    const total = this.total();
    if (total <= 0) {
      return [];
    }
    const largestFirst = this.slices()
      .filter((s) => s.amount > 0)
      .sort((a, b) => b.amount - a.amount);
    const kept = largestFirst.length > mostSlices ? largestFirst.slice(0, mostSlices - 1) : largestFirst;
    const rest = largestFirst.slice(kept.length);
    const slices: (PieSlice & { color: string; count?: number })[] = kept.map((s, i) => ({ ...s, color: s.color ?? pieColors[i % pieColors.length] }));
    if (rest.length) {
      slices.push({ key: 'other', en: 'Other', ar: 'أخرى', amount: rest.reduce((sum, s) => sum + s.amount, 0), color: otherColor, count: rest.length });
    }

    let start = -Math.PI / 2;
    return slices.map((s) => {
      const sweep = (s.amount / total) * Math.PI * 2;
      const end = start + sweep;
      const middle = start + sweep / 2;
      const drawn: DrawnSlice = {
        ...s,
        percent: (s.amount / total) * 100,
        path: SpendingPie.arc(start, end),
        tipX: ((centre + ((outer + inner) / 2) * Math.cos(middle)) / size) * 100,
        tipY: ((centre + ((outer + inner) / 2) * Math.sin(middle)) / size) * 100,
      };
      start = end;
      return drawn;
    });
  });

  protected readonly tip = computed(() => {
    const i = this.hovered();
    return i === null ? null : (this.drawn()[i] ?? null);
  });

  protected describe(): string {
    const slices = this.drawn().map((s) => `${s.en} ${this.company.money(s.amount)}, ${s.percent.toFixed(1)}%`);
    return `${this.heading()}: ${slices.join('; ')}`;
  }

  // A ring's slice from one angle to another, clockwise. The whole ring is drawn as two halves,
  // since one arc cannot end where it starts.
  private static arc(from: number, to: number): string {
    const at = (angle: number, radius: number) => `${round(centre + radius * Math.cos(angle))} ${round(centre + radius * Math.sin(angle))}`;
    if (to - from >= Math.PI * 2 - 1e-9) {
      const ring = (radius: number, sweep: 0 | 1) =>
        `M ${at(from, radius)} A ${radius} ${radius} 0 1 ${sweep} ${at(from + Math.PI, radius)} A ${radius} ${radius} 0 1 ${sweep} ${at(from, radius)} Z`;
      return `${ring(outer, 1)} ${ring(inner, 0)}`;
    }
    const large = to - from > Math.PI ? 1 : 0;
    return [
      `M ${at(from, outer)}`,
      `A ${outer} ${outer} 0 ${large} 1 ${at(to, outer)}`,
      `L ${at(to, inner)}`,
      `A ${inner} ${inner} 0 ${large} 0 ${at(from, inner)}`,
      'Z',
    ].join(' ');
  }
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
```


> 📄 **`frontend/src/app/features/costing/treasury-page.ts`** — 506 سطر

```ts
import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';
import { CostingApi, TreasuryAnalytics, TreasuryFlowLine } from '../../core/costing/costing.api';
import { errorMessage } from '../../core/http/error-message';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { isoDay } from './financials';
import { PieSlice, SpendingPie } from './spending-pie';

type Period = 'month' | 'last-month' | 'quarter' | 'year' | 'custom';

// Safe & treasury analytics (تحليل الخزنة والتدفقات النقدية) over any period, counted as the Safe tab's
// strip counts a month. Where the money came from (cash and Visa sales, the tax collected on them,
// the balance it opened with, funding) and where it went (suppliers, expense vouchers by category,
// the staff, the tax paid over), each a pie and a table of amounts and shares; the tax held for the
// tax authority, collected less paid over; and day by day, in, out, the net, the balance after it
// and the voids with why.
@Component({
  selector: 'app-treasury-page',
  imports: [
    DatePipe,
    FormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MoneyPipe,
    SpendingPie,
  ],
  template: `
    <div class="toolbar">
      <mat-button-toggle-group [value]="period()" (change)="choose($event.value)" aria-label="Period" class="periods">
        <mat-button-toggle value="month">This month</mat-button-toggle>
        <mat-button-toggle value="last-month">Last month</mat-button-toggle>
        <mat-button-toggle value="quarter">3 months</mat-button-toggle>
        <mat-button-toggle value="year">This year</mat-button-toggle>
      </mat-button-toggle-group>
      <mat-form-field subscriptSizing="dynamic" class="day">
        <mat-label>From · من</mat-label>
        <input matInput type="date" [ngModel]="from()" (ngModelChange)="custom('from', $event)" [max]="to()" />
      </mat-form-field>
      <mat-form-field subscriptSizing="dynamic" class="day">
        <mat-label>To · إلى</mat-label>
        <input matInput type="date" [ngModel]="to()" (ngModelChange)="custom('to', $event)" [min]="from()" />
      </mat-form-field>
      <span class="spacer"></span>
      <button mat-button (click)="exportCsv()" [disabled]="!report()"><mat-icon>download</mat-icon> CSV</button>
      <button mat-button (click)="print()" [disabled]="!report()"><mat-icon>print</mat-icon> Print</button>
    </div>
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    @if (error()) {
      <p class="error">{{ error() }}</p>
    } @else if (report(); as r) {
      <header class="report-head">
        <h2>Safe &amp; treasury analytics <span class="inline-ar">تحليل الخزنة والتدفقات النقدية</span></h2>
        <div class="muted">
          {{ r.from | date: 'd MMM y' }} – {{ r.to | date: 'd MMM y' }} · the safe's ledger, each entry on its own date; an entry voided in these days
          and its void left out
        </div>
      </header>
      <div class="tiles">
        <div class="tile">
          <span class="label">Opening balance · الرصيد الافتتاحي</span>
          <strong>{{ r.openingBalance | money }}</strong>
          <small class="muted">brought forward</small>
        </div>
        <div class="tile">
          <span class="label">Total in · إجمالي الوارد</span>
          <strong class="in">{{ r.totalIn | money }}</strong>
          <small class="muted">with the opening balance</small>
        </div>
        <div class="tile">
          <span class="label">Total out · إجمالي المنصرف</span>
          <strong class="out">{{ r.totalOut | money }}</strong>
        </div>
        <div class="tile">
          <span class="label">Net cash flow · صافي التدفق النقدي</span>
          <strong [class.negative]="r.netFlow < 0">{{ r.netFlow | money }}</strong>
          <small class="muted">in less out, in these days</small>
        </div>
        <div class="tile key">
          <span class="label">Closing balance · الرصيد الختامي</span>
          <strong [class.negative]="r.closingBalance < 0">{{ r.closingBalance | money }}</strong>
        </div>
      </div>

      <div class="pies">
        <app-spending-pie
          heading="Where it came from"
          headingAr="تحليل مصادر الوارد"
          [slices]="inflowSlices()"
          shareOf="of all that came in"
          empty="Nothing came into the safe in these days."
        />
        <app-spending-pie
          heading="Where it went"
          headingAr="تحليل أوجه الصرف"
          [slices]="outflowSlices()"
          shareOf="of all that went out"
          empty="Nothing went out of the safe in these days."
        />
      </div>

      <div class="breakdowns">
        <section aria-labelledby="inflows-title">
          <h3 id="inflows-title">Inflow breakdown <span class="inline-ar">تحليل مصادر الوارد</span></h3>
          <div class="table-wrap">
            <table class="grid flows">
              <thead>
                <tr>
                  <th>Source<span class="ar">المصدر</span></th>
                  <th class="num">Amount<span class="ar">المبلغ</span></th>
                  <th class="num">Share<span class="ar">النسبة</span></th>
                </tr>
              </thead>
              <tbody>
                @for (line of r.inflows; track line.key) {
                  <tr>
                    <td>{{ line.en }} <span class="ar">{{ line.ar }}</span></td>
                    <td class="num">{{ line.amount | money }}</td>
                    <td class="num">{{ share(line) }}</td>
                  </tr>
                  @for (item of line.items; track item.key) {
                    <tr class="item">
                      <td>{{ item.en }} <span class="ar">{{ item.ar }}</span></td>
                      <td class="num">{{ item.amount | money }}</td>
                      <td class="num">{{ share(item) }}</td>
                    </tr>
                  }
                }
              </tbody>
              <tfoot>
                <tr>
                  <td>Total in · إجمالي الوارد</td>
                  <td class="num">{{ r.totalIn | money }}</td>
                  <td class="num">{{ r.totalIn ? '100%' : '' }}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <section aria-labelledby="outflows-title">
          <h3 id="outflows-title">Outflow breakdown <span class="inline-ar">تحليل أوجه الصرف</span></h3>
          <div class="table-wrap">
            <table class="grid flows">
              <thead>
                <tr>
                  <th>Paid for<span class="ar">أوجه الصرف</span></th>
                  <th class="num">Amount<span class="ar">المبلغ</span></th>
                  <th class="num">Share<span class="ar">النسبة</span></th>
                </tr>
              </thead>
              <tbody>
                @for (line of r.outflows; track line.key) {
                  <tr>
                    <td>{{ line.en }} <span class="ar">{{ line.ar }}</span></td>
                    <td class="num">{{ line.amount | money }}</td>
                    <td class="num">{{ share(line) }}</td>
                  </tr>
                  @for (item of line.items; track item.key) {
                    @if (item.amount) {
                      <tr class="item">
                        <td>{{ item.en }} <span class="ar">{{ item.ar }}</span></td>
                        <td class="num">{{ item.amount | money }}</td>
                        <td class="num">{{ share(item) }}</td>
                      </tr>
                    }
                  }
                }
              </tbody>
              <tfoot>
                <tr>
                  <td>Total out · إجمالي المنصرف</td>
                  <td class="num">{{ r.totalOut | money }}</td>
                  <td class="num">{{ r.totalOut ? '100%' : '' }}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      </div>

      <section class="tax-card" aria-labelledby="tax-title">
        <h3 id="tax-title">Tax liability reconciliation <span class="inline-ar">موقف التسوية الضريبية</span></h3>
        <p class="muted small">To {{ r.to | date: 'd MMM y' }}: the tax every day's takings collected, less what was paid over by tax payments.</p>
        <dl class="equation">
          <div>
            <dt>Total tax collected in the safe <span class="ar">إجمالي الضريبة المحصلة بالخزنة</span></dt>
            <dd>{{ r.taxToDate.collected | money }}</dd>
          </div>
          <div>
            <dt>Less tax paid via vouchers <span class="ar">المسدد بأذون الصرف</span></dt>
            <dd>({{ r.taxToDate.paid | money }})</dd>
          </div>
          <div class="result">
            <dt>Remaining unpaid tax liability in the safe <span class="ar">رصيد الضريبة المتبقي بالخزنة</span></dt>
            <dd [class.negative]="r.taxToDate.owed < 0">{{ r.taxToDate.owed | money }}</dd>
          </div>
        </dl>
        <p class="muted small">
          In these days: {{ r.taxCollected | money }} collected, {{ r.taxPaid | money }} paid over.
          @if (r.taxToDate.owed < 0) {
            More has been paid over than the takings collected: tax from before the treasury, or a payment entered twice.
          }
        </p>
      </section>

      <section aria-labelledby="days-title">
        <h3 id="days-title">Daily cash flow &amp; voids <span class="inline-ar">حركة التدفق اليومي والفويد</span></h3>
        <div class="table-wrap">
          <table class="grid days">
            <thead>
              <tr>
                <th>Day<span class="ar">اليوم</span></th>
                <th class="num">Total in<span class="ar">إجمالي الوارد</span></th>
                <th class="num">Total out<span class="ar">إجمالي المنصرف</span></th>
                <th class="num">Net daily cash flow<span class="ar">صافي التدفق اليومي</span></th>
                <th class="num">Running safe balance<span class="ar">رصيد الخزنة</span></th>
                <th class="num">Voids<span class="ar">الفويد</span></th>
                <th>Void reasons<span class="ar">أسباب الفويد</span></th>
              </tr>
            </thead>
            <tbody>
              <tr class="opening">
                <td colspan="4">Brought forward · رصيد مرحل</td>
                <td class="num">{{ r.openingBalance | money }}</td>
                <td colspan="2"></td>
              </tr>
              @for (d of r.days; track d.date) {
                <tr>
                  <td class="nowrap">{{ d.date | date: 'EEE d MMM' }}</td>
                  <td class="num in">{{ d.in ? (d.in | money) : '' }}</td>
                  <td class="num out">{{ d.out ? (d.out | money) : '' }}</td>
                  <td class="num" [class.negative]="d.net < 0">{{ d.net | money }}</td>
                  <td class="num" [class.negative]="d.balance < 0">{{ d.balance | money }}</td>
                  <td class="num">{{ d.voids ? (d.voids | money) : '' }}</td>
                  <td class="reasons">{{ d.voidReasons.join(' · ') }}</td>
                </tr>
              } @empty {
                <tr><td colspan="7" class="muted">Nothing in or out of the safe in these days.</td></tr>
              }
            </tbody>
            <tfoot>
              <tr>
                <td>Total · الإجمالي</td>
                <td class="num">{{ dayTotals().in | money }}</td>
                <td class="num">{{ dayTotals().out | money }}</td>
                <td class="num" [class.negative]="r.netFlow < 0">{{ r.netFlow | money }}</td>
                <td class="num">{{ r.closingBalance | money }}</td>
                <td class="num">{{ r.voids | money }}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .periods {
      flex-wrap: wrap;
    }
    .day {
      width: 160px;
    }
    .report-head {
      margin-bottom: 12px;

      h2 {
        margin: 0 0 4px;
        font: var(--mat-sys-title-large);
      }
    }
    h3 {
      margin: 0 0 8px;
      font: var(--mat-sys-title-small);
    }
    section {
      margin-bottom: 16px;
    }
    .tile small {
      font-size: 12px;
    }
    .in {
      color: var(--app-ok);
    }
    .out,
    .negative {
      color: var(--mat-sys-error);
    }
    .small {
      font-size: 0.85em;
    }
    .nowrap {
      white-space: nowrap;
    }
    .pies {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 8px;
      margin-bottom: 16px;
    }
    .breakdowns {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
      gap: 0 16px;
    }
    .flows {
      .ar {
        display: inline;
        margin-inline-start: 6px;
      }
      tr.item td:first-child {
        padding-inline-start: 28px;
        color: var(--mat-sys-on-surface-variant);
      }
    }
    .tax-card {
      max-width: 640px;
      padding: 12px 16px;
      border-radius: 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface);
    }
    .equation {
      display: grid;
      gap: 6px;
      margin: 8px 0;

      div {
        display: flex;
        justify-content: space-between;
        gap: 16px;
      }
      dt,
      dd {
        margin: 0;
      }
      dt .ar {
        margin-inline-start: 6px;
        opacity: 0.75;
        font-size: 0.85em;
      }
      dd {
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .result {
        padding-top: 6px;
        border-top: 1px solid var(--mat-sys-outline-variant);
        font-weight: 600;
      }
    }
    .days {
      tr.opening td {
        background: var(--mat-sys-surface-container);
        font-weight: 500;
      }
      .reasons {
        min-width: 180px;
        color: var(--mat-sys-on-surface-variant);
      }
    }
    @media print {
      .toolbar {
        display: none;
      }
    }
  `,
})
export class TreasuryPage {
  private readonly api = inject(CostingApi);

  protected readonly period = signal<Period>('month');
  protected readonly from = signal(isoDay(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  protected readonly to = signal(isoDay(new Date()));
  protected readonly report = signal<TreasuryAnalytics | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  // The pies: each line in, and each line out, in the palette's order.
  protected readonly inflowSlices = computed<PieSlice[]>(() => (this.report()?.inflows ?? []).map(TreasuryPage.slice));
  protected readonly outflowSlices = computed<PieSlice[]>(() => (this.report()?.outflows ?? []).map(TreasuryPage.slice));

  // The days' in and out together; the net and the balance are the report's own.
  protected readonly dayTotals = computed(() => {
    const days = this.report()?.days ?? [];
    return { in: days.reduce((sum, d) => sum + d.in, 0), out: days.reduce((sum, d) => sum + d.out, 0) };
  });

  constructor() {
    effect(() => {
      const from = this.from();
      const to = this.to();
      untracked(() => void this.load(from, to));
    });
  }

  protected choose(period: Period): void {
    const today = new Date();
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    const [from, to] =
      period === 'last-month'
        ? [new Date(first.getFullYear(), first.getMonth() - 1, 1), new Date(first.getFullYear(), first.getMonth(), 0)]
        : period === 'quarter'
          ? [new Date(first.getFullYear(), first.getMonth() - 2, 1), today]
          : period === 'year'
            ? [new Date(today.getFullYear(), 0, 1), today]
            : [first, today];
    this.period.set(period);
    this.from.set(isoDay(from));
    this.to.set(isoDay(to));
  }

  // Days typed in: the period is whatever they say. Cleared or half typed, it stays as it was.
  protected custom(end: 'from' | 'to', value: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) {
      return;
    }
    this.period.set('custom');
    (end === 'from' ? this.from : this.to).set(value);
  }

  protected share(line: TreasuryFlowLine): string {
    return line.sharePercent === null ? '' : `${line.sharePercent.toFixed(1)}%`;
  }

  protected print(): void {
    window.print();
  }

  // For a spreadsheet: a byte order mark so Excel reads the Arabic as UTF-8. Where it came from and
  // went, then day by day.
  protected exportCsv(): void {
    const r = this.report();
    if (!r) {
      return;
    }
    const rows: (string | number)[][] = [['Section', 'Line · البند', 'Amount', 'Share %']];
    const flows = (section: string, lines: TreasuryFlowLine[], depth = 0): void => {
      for (const line of lines) {
        rows.push([section, `${'  '.repeat(depth)}${line.en}${line.ar ? ' · ' + line.ar : ''}`, line.amount.toFixed(2), line.sharePercent?.toFixed(1) ?? '']);
        flows(section, line.items, depth + 1);
      }
    };
    flows('In', r.inflows);
    rows.push(['In', 'Total in', r.totalIn.toFixed(2), '100.0']);
    flows('Out', r.outflows);
    rows.push(['Out', 'Total out', r.totalOut.toFixed(2), '100.0']);
    rows.push(['Tax', 'Collected to date', r.taxToDate.collected.toFixed(2), '']);
    rows.push(['Tax', 'Paid over to date', r.taxToDate.paid.toFixed(2), '']);
    rows.push(['Tax', 'Still owed', r.taxToDate.owed.toFixed(2), '']);
    rows.push([]);
    rows.push(['Day · اليوم', 'Total in', 'Total out', 'Net', 'Balance', 'Voids', 'Void reasons']);
    rows.push(['Brought forward', '', '', '', r.openingBalance.toFixed(2), '', '']);
    for (const d of r.days) {
      rows.push([d.date, d.in.toFixed(2), d.out.toFixed(2), d.net.toFixed(2), d.balance.toFixed(2), d.voids.toFixed(2), d.voidReasons.join(' · ')]);
    }
    const csv = rows.map((cells) => cells.map(TreasuryPage.cell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `treasury-analytics-${r.from}-to-${r.to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  private async load(from: string, to: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const report = await firstValueFrom(this.api.treasuryAnalytics(from, to));
      // Moved on while it loaded: what came back is for other days.
      if (this.from() === from && this.to() === to) {
        this.report.set(report);
      }
    } catch (error) {
      this.report.set(null);
      this.error.set(errorMessage(error, 'The safe’s analysis could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }

  private static slice(line: TreasuryFlowLine): PieSlice {
    return { key: line.key, en: line.en, ar: line.ar, amount: line.amount };
  }

  private static cell(value: string | number): string {
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }
}
```


> 📄 **`frontend/src/app/features/costing/theoretical-page.ts`** — 739 سطر

```ts
import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, ElementRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom, forkJoin } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { Permissions } from '../../core/auth/permissions';
import {
  CostingApi,
  ManualSalesItem,
  ManualSalesSheet,
  TheoreticalCostReport,
  TheoreticalCostRow,
  TheoreticalSource,
  statusLabels,
} from '../../core/costing/costing.api';
import { errorMessage } from '../../core/http/error-message';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { NotifyService } from '../../core/ui/notify.service';

// A group of the sales sheet: a recipe category, or the prep items.
interface SheetGroup {
  name: string;
  items: ManualSalesItem[];
}

// The Monthly Theoretical Cost report: what the month's sales should have cost by their recipes,
// at what the ingredients cost when each was sold. Net sales are before VAT, as menu prices are.
// The sales come from the till, or, where they were rung up elsewhere, from quantities typed in
// for the month: kept for it, and costed by today's recipes at today's prices.
@Component({
  selector: 'app-theoretical-page',
  imports: [
    DatePipe,
    DecimalPipe,
    FormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MoneyPipe,
  ],
  template: `
    <div class="toolbar">
      <mat-form-field subscriptSizing="dynamic">
        <mat-label>Month · الشهر</mat-label>
        <input matInput type="month" [ngModel]="month()" (ngModelChange)="pick($event)" [max]="thisMonth" />
      </mat-form-field>
      <mat-button-toggle-group class="source-toggle" [value]="source()" (change)="choose($event.value)" aria-label="Where the sales come from">
        <mat-button-toggle value="Pos">
          <span class="toggle-label">
            Fetch sales from POS<span class="ar">استقبال المبيعات من الكاشير</span>
          </span>
        </mat-button-toggle>
        <mat-button-toggle value="Manual">
          <span class="toggle-label">
            Manual sales entry<span class="ar">إدخال المبيعات يدوياً</span>
          </span>
        </mat-button-toggle>
      </mat-button-toggle-group>
      <span class="spacer"></span>
      @if (!editing()) {
        @if (source() === 'Manual' && canEdit() && report()) {
          <button mat-stroked-button (click)="edit()"><mat-icon>edit_note</mat-icon> Edit quantities</button>
        }
        <button mat-button (click)="exportCsv()" [disabled]="!report()?.rows?.length"><mat-icon>download</mat-icon> CSV</button>
        <button mat-button (click)="print()" [disabled]="!report()"><mat-icon>print</mat-icon> Print</button>
      }
    </div>
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    @if (error()) {
      <p class="error">{{ error() }}</p>
    } @else if (editing()) {
      @if (sheet(); as s) {
        <header class="report-head">
          <h2>Sales for {{ monthName() }} <span class="inline-ar">مبيعات الشهر</span></h2>
          <p class="note">
            Type how many of each were sold in the month: recipes in portions, prep items in their unit. Leave the rest empty.
            Enter or Tab goes to the next. They are kept for the month, and costed by today's recipes at today's prices.
            <span class="inline-ar">أدخل الكمية المباعة لكل صنف خلال الشهر.</span>
          </p>
        </header>
        @if (s.items.length) {
          <div class="table-wrap">
            <table class="grid sheet">
              <thead>
                <tr>
                  <th>Item code<span class="ar">كود الصنف</span></th>
                  <th>Item<span class="ar">الصنف</span></th>
                  <th class="num">Cost / unit<span class="ar">التكلفة/وحدة</span></th>
                  <th class="num">Price<span class="ar">السعر</span></th>
                  <th class="num qty-head">Qty sold<span class="ar">الكمية المباعة</span></th>
                  <th class="num">Sales<span class="ar">المبيعات</span></th>
                  <th class="num">Ingredient cost<span class="ar">تكلفة المكونات</span></th>
                </tr>
              </thead>
              @for (g of groups(); track g.name) {
                <tbody>
                  <tr class="group">
                    <th colspan="7">{{ g.name }}</th>
                  </tr>
                  @for (item of g.items; track key(item)) {
                    <tr [class.entered]="(quantity(item) ?? 0) > 0">
                      <td class="code">{{ item.code ?? '—' }}</td>
                      <td>
                        {{ item.name }}
                        @if (item.nameAr) {
                          <span class="ar">{{ item.nameAr }}</span>
                        }
                      </td>
                      <td class="num">{{ item.costPerUnit === null ? '—' : (item.costPerUnit | money) }}</td>
                      <td class="num">{{ item.price === null ? '—' : (item.price | money) }}</td>
                      <td class="num">
                        <span class="qty-cell">
                          <input
                            class="qty-in"
                            type="number"
                            min="0"
                            [step]="item.kind === 'Recipe' ? 1 : 'any'"
                            [attr.inputmode]="item.kind === 'Recipe' ? 'numeric' : 'decimal'"
                            placeholder="—"
                            [class.invalid]="!!problemWith(item)"
                            [attr.aria-invalid]="!!problemWith(item)"
                            [attr.aria-label]="item.name + ', sold in ' + unitOf(item)"
                            [title]="problemWith(item) ?? ''"
                            [ngModel]="quantity(item)"
                            (ngModelChange)="enter(item, $event)"
                            (focus)="select($event)"
                            (keydown.enter)="next($event)"
                          />
                          <span class="unit muted">{{ unitOf(item) }}</span>
                        </span>
                      </td>
                      <td class="num">{{ item.price !== null && quantity(item) ? (item.price * quantity(item)! | money) : '' }}</td>
                      <td class="num">{{ item.costPerUnit !== null && quantity(item) ? (item.costPerUnit * quantity(item)! | money) : '' }}</td>
                    </tr>
                  }
                </tbody>
              }
              <tfoot>
                <tr>
                  <td colspan="4">
                    Total · الإجمالي
                    <small class="muted">{{ entered() }} of {{ s.items.length }} entered</small>
                  </td>
                  <td class="num">{{ totals().portions }} {{ totals().portions === 1 ? 'portion' : 'portions' }}</td>
                  <td class="num">{{ totals().sales | money }}</td>
                  <td class="num">{{ totals().cost | money }}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        } @else {
          <p class="note">There are no recipes or prep items yet. Write the recipes first, then type their sales in here.</p>
        }
        <div class="actions">
          @if (invalid()) {
            <span class="error">{{ invalid() }}</span>
          } @else if (dirty()) {
            <span class="muted">Not saved yet: Generate report saves them.</span>
          }
          <span class="spacer"></span>
          @if (s.enteredAtUtc) {
            <button mat-button (click)="cancel()" [disabled]="saving()">Cancel</button>
          }
          <button mat-flat-button class="generate" (click)="generate()" [disabled]="saving() || !!invalid() || !s.items.length">
            <mat-icon>summarize</mat-icon> Generate report<span class="inline-ar">إنشاء التقرير</span>
          </button>
        </div>
      }
    } @else if (report(); as r) {
      <header class="report-head">
        <h2>Monthly theoretical cost <span class="inline-ar">التكلفة النظرية الشهرية</span></h2>
        <div class="muted">
          From<span class="inline-ar">من</span>: <strong>{{ r.from }}</strong> &nbsp; To<span class="inline-ar">إلى</span>:
          <strong>{{ r.to }}</strong> &nbsp;·&nbsp; Food cost target<span class="inline-ar">النسبة المستهدفة</span>:
          <strong>{{ r.foodCostTargetPercent | number: '1.0-1' }}%</strong>
        </div>
        <div class="source-line">
          @if (r.source === 'Manual') {
            <span class="source-badge manual">
              <mat-icon>edit_note</mat-icon> Data source: Manual entry<span class="inline-ar">مصدر البيانات: إدخال يدوي</span>
            </span>
            <span class="muted">
              @if (r.enteredAtUtc) {
                Entered{{ r.enteredBy ? ' by ' + r.enteredBy : '' }} on {{ r.enteredAtUtc | date: 'd MMM y, HH:mm' }} ·
              }
              costed by today's recipes at today's prices
            </span>
          } @else {
            <span class="source-badge pos">
              <mat-icon>point_of_sale</mat-icon> Data source: Live POS<span class="inline-ar">مصدر البيانات: الكاشير</span>
            </span>
          }
        </div>
      </header>
      <div class="table-wrap">
        <table class="grid">
          <thead>
            <tr>
              <th>Item code<span class="ar">كود الصنف</span></th>
              @if (r.source === 'Manual') {
                <th>Item<span class="ar">الصنف</span></th>
              } @else {
                <th>Menu item<span class="ar">صنف المنيو</span></th>
              }
              <th class="num">Quantity sold<span class="ar">الكمية المباعة</span></th>
              <th class="num">Net sales<span class="ar">صافي المبيعات</span></th>
              <th class="num">Recipe cost / unit<span class="ar">تكلفة الوصفة/وحدة</span></th>
              <th class="num">Theoretical cost<span class="ar">التكلفة النظرية</span></th>
              <th class="num">Food cost %<span class="ar">نسبة تكلفة الطعام</span></th>
              <th>Status<span class="ar">الحالة</span></th>
            </tr>
          </thead>
          <tbody>
            @for (row of r.rows; track rowKey(row)) {
              <tr>
                <td class="code">{{ row.itemCode || '—' }}</td>
                <td>
                  {{ row.menuItem }}
                  @if (row.menuItemAr) {
                    <span class="ar">{{ row.menuItemAr }}</span>
                  }
                </td>
                <td class="num">{{ row.quantitySold | number: '1.0-3' }}{{ row.unit ? ' ' + row.unit : '' }}</td>
                <td class="num">{{ row.prepItemId ? '—' : (row.netSales | money) }}</td>
                <td class="num">{{ row.status === 'NoRecipe' ? '—' : (row.recipeCostPerUnit | money) }}</td>
                <td class="num">
                  @if (row.status !== 'NoRecipe') {
                    {{ row.theoreticalCost | money }}
                    @if (row.sharedCost > 0) {
                      <small class="muted shared">incl. {{ row.sharedCost | money }} shared</small>
                    }
                  } @else if (row.sharedCost > 0) {
                    <!-- Its share of the month's oil and the like: in the total, so shown here too. -->
                    {{ row.sharedCost | money }}
                    <small class="muted shared">shared only</small>
                  } @else {
                    —
                  }
                  @if (row.quantityCostedNow > 0) {
                    <small class="muted shared">{{ row.quantityCostedNow }} at today's prices *</small>
                  }
                </td>
                <td class="num">{{ row.status === 'NoRecipe' || row.foodCostPercent === null ? '—' : (row.foodCostPercent | number: '1.1-1') + '%' }}</td>
                <td>
                  @if (row.prepItemId) {
                    <span class="status NoPrice">Prep item<span class="ar">صنف تحضير</span></span>
                  } @else {
                    <span class="status" [class]="row.status">
                      {{ statusLabels[row.status].en }}<span class="ar">{{ statusLabels[row.status].ar }}</span>
                    </span>
                  }
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="8" class="muted">
                  {{ r.source === 'Manual' ? 'No quantities have been entered for this month.' : 'Nothing was sold in this month.' }}
                </td>
              </tr>
            }
          </tbody>
          @if (r.rows.length) {
            <tfoot>
              <tr>
                <td colspan="2">Total · الإجمالي</td>
                <td class="num">{{ r.quantitySold | number: '1.0-3' }}</td>
                <td class="num">{{ r.netSales | money }}</td>
                <td></td>
                <td class="num">{{ r.theoreticalCost | money }}</td>
                <td class="num">{{ r.foodCostPercent === null ? '—' : (r.foodCostPercent | number: '1.1-1') + '%' }}</td>
                <td></td>
              </tr>
            </tfoot>
          }
        </table>
      </div>
      @if (costedNow(r)) {
        <p class="note">
          * Sold before the dish had a recipe, so no cost was recorded at the time: costed by its recipe now, at today's
          average prices.
        </p>
      }
      @if (unrecipedSales(r); as missing) {
        <p class="note">
          {{ missing.count }} {{ missing.count === 1 ? 'menu item' : 'menu items' }} sold this month {{ missing.count === 1 ? 'has' : 'have' }}
          no recipe ({{ missing.sales | money }} of sales): {{ missing.count === 1 ? 'it counts' : 'they count' }} in net sales at no
          ingredient cost, so the total food cost % reads low until {{ missing.count === 1 ? 'it has one' : 'they have recipes' }}.
        </p>
      }
      @if (r.source === 'Manual' && unpricedCost(r); as unpriced) {
        <p class="note">
          Cost with no sales against it ({{ unpriced | money }}): prep items, and recipes off the menu with no planned price. It is in the
          theoretical cost but not in net sales, so the total food cost % reads high by it.
        </p>
      }
    } @else if (source() === 'Manual' && !loading()) {
      <p class="note">No quantities have been entered for this month. Someone who manages stock types them in.</p>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .report-head {
      margin-bottom: 12px;

      h2 {
        margin: 0 0 4px;
        font: var(--mat-sys-title-large);
      }
      .note {
        margin: 0;
      }
    }
    .shared {
      display: block;
    }
    .source-toggle .toggle-label {
      display: inline-flex;
      flex-direction: column;
      line-height: 1.25;
      padding: 4px 0;
    }
    .source-toggle .ar {
      text-align: center;
    }
    .source-line {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px 12px;
      margin-top: 8px;
    }
    .source-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 12px 3px 8px;
      border-radius: 999px;
      font: var(--mat-sys-label-large);
      print-color-adjust: exact;
      -webkit-print-color-adjust: exact;

      mat-icon {
        width: 18px;
        height: 18px;
        font-size: 18px;
      }
      &.pos {
        background: color-mix(in srgb, var(--app-ok) 16%, transparent);
        color: var(--app-ok);
      }
      &.manual {
        background: color-mix(in srgb, var(--app-warn) 16%, transparent);
        color: var(--app-warn);
      }
    }
    table.sheet {
      tr.group th {
        background: var(--mat-sys-surface-container-low);
        color: var(--mat-sys-on-surface);
        font: var(--mat-sys-title-small);
      }
      tr.entered td {
        background: color-mix(in srgb, var(--mat-sys-primary) 6%, transparent);
      }
      td {
        padding-top: 4px;
        padding-bottom: 4px;
      }
    }
    .qty-cell {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .qty-in {
      width: 96px;
      padding: 6px 8px;
      border: 1px solid var(--mat-sys-outline);
      border-radius: 8px;
      background: var(--mat-sys-surface);
      color: var(--mat-sys-on-surface);
      font: var(--mat-sys-body-large);
      text-align: end;

      &:focus {
        outline: 2px solid var(--mat-sys-primary);
        outline-offset: -1px;
        border-color: var(--mat-sys-primary);
      }
      &.invalid {
        border-color: var(--mat-sys-error);
        outline-color: var(--mat-sys-error);
      }
    }
    .unit {
      min-width: 3.5em;
      text-align: start;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 12px;
      margin-top: 12px;

      .spacer {
        flex: 1;
      }
    }
  `,
})
export class TheoreticalPage {
  private readonly api = inject(CostingApi);
  private readonly auth = inject(AuthService);
  private readonly notify = inject(NotifyService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly statusLabels = statusLabels;
  protected readonly thisMonth = TheoreticalPage.monthOf(new Date());
  // Typing the month's sales in is for someone who manages stock; anyone here can read them.
  protected readonly canEdit = computed(() => this.auth.can(Permissions.InventoryManage));

  protected readonly month = signal(this.thisMonth);
  protected readonly source = signal<TheoreticalSource>('Pos');
  protected readonly report = signal<TheoreticalCostReport | null>(null);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  // The month's sales sheet, and what is typed into it: kept for each month while on this page,
  // so looking at the till's figures, or another month, loses nothing.
  protected readonly sheet = signal<ManualSalesSheet | null>(null);
  protected readonly editing = signal(false);
  private readonly drafts = signal<Record<string, Record<string, number | null>>>({});

  protected readonly monthName = computed(() => {
    const [year, m] = this.month().split('-').map(Number);
    return new Date(year, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  });

  protected readonly groups = computed<SheetGroup[]>(() => {
    const groups: SheetGroup[] = [];
    for (const item of this.sheet()?.items ?? []) {
      const last = groups.at(-1);
      if (last?.name === item.group) {
        last.items.push(item);
      } else {
        groups.push({ name: item.group, items: [item] });
      }
    }
    return groups;
  });

  private readonly typed = computed(() => this.drafts()[this.month()] ?? {});

  protected readonly entered = computed(() => (this.sheet()?.items ?? []).filter((i) => (this.quantity(i) ?? 0) > 0).length);

  protected readonly totals = computed(() => {
    let portions = 0;
    let sales = 0;
    let cost = 0;
    for (const item of this.sheet()?.items ?? []) {
      const quantity = this.quantity(item) ?? 0;
      if (quantity <= 0) {
        continue;
      }
      if (item.kind === 'Recipe') {
        portions += quantity;
      }
      sales += (item.price ?? 0) * quantity;
      cost += (item.costPerUnit ?? 0) * quantity;
    }
    return { portions, sales, cost };
  });

  // The first thing wrong with what is typed in, said so it can be put right.
  protected readonly invalid = computed(() => {
    const items = this.sheet()?.items ?? [];
    const wrong = items.filter((i) => this.problemWith(i));
    if (!wrong.length) {
      return null;
    }
    return wrong.length === 1 ? `${wrong[0].name}: ${this.problemWith(wrong[0])}` : `${wrong.length} quantities need correcting (marked in red).`;
  });

  protected readonly dirty = computed(() => this.drafts()[this.month()] !== undefined);

  constructor() {
    effect(() => {
      const month = this.month();
      const source = this.source();
      untracked(() => void this.load(month, source));
    });
  }

  protected pick(month: string): void {
    // Cleared or half typed: keep the month on screen.
    if (/^\d{4}-\d{2}$/.test(month)) {
      this.month.set(month);
    }
  }

  protected choose(source: TheoreticalSource): void {
    this.source.set(source);
  }

  protected key(item: ManualSalesItem): string {
    return `${item.kind}:${item.itemId}`;
  }

  protected rowKey(row: TheoreticalCostRow): string {
    return row.recipeId ?? row.prepItemId ?? row.itemCode;
  }

  protected unitOf(item: ManualSalesItem): string {
    return item.kind === 'Recipe' ? 'portions' : item.unit;
  }

  protected quantity(item: ManualSalesItem): number | null {
    const typed = this.typed();
    const key = this.key(item);
    return key in typed ? typed[key] : item.quantity;
  }

  protected problemWith(item: ManualSalesItem): string | null {
    const quantity = this.quantity(item);
    if (quantity === null) {
      return null;
    }
    if (!Number.isFinite(quantity) || quantity < 0) {
      return 'cannot be less than 0.';
    }
    if (item.kind === 'Recipe' && !Number.isInteger(quantity)) {
      return 'portions are whole numbers.';
    }
    return null;
  }

  protected enter(item: ManualSalesItem, value: number | string | null): void {
    const quantity = value === null || value === '' ? null : Number(value);
    const month = this.month();
    this.drafts.update((drafts) => ({ ...drafts, [month]: { ...(drafts[month] ?? {}), [this.key(item)]: quantity } }));
  }

  protected select(event: Event): void {
    (event.target as HTMLInputElement).select();
  }

  // Enter goes on down the sheet, as Tab does; Shift+Enter back up. From the last, to Generate.
  protected next(event: Event): void {
    event.preventDefault();
    const inputs = [...this.host.nativeElement.querySelectorAll<HTMLInputElement>('input.qty-in')];
    const at = inputs.indexOf(event.target as HTMLInputElement);
    const step = (event as KeyboardEvent).shiftKey ? -1 : 1;
    const to = inputs[at + step];
    if (to) {
      to.focus();
    } else if (step > 0) {
      this.host.nativeElement.querySelector<HTMLButtonElement>('button.generate')?.focus();
    }
  }

  protected edit(): void {
    this.editing.set(true);
  }

  protected cancel(): void {
    this.forget(this.month());
    this.editing.set(false);
  }

  protected async generate(): Promise<void> {
    const sheet = this.sheet();
    if (!sheet || this.invalid()) {
      return;
    }
    const lines = sheet.items
      .map((item) => ({ kind: item.kind, itemId: item.itemId, quantity: this.quantity(item) ?? 0 }))
      .filter((line) => line.quantity > 0);
    const month = this.month();
    this.saving.set(true);
    try {
      const report = await firstValueFrom(this.api.saveManualSales(sheet.year, sheet.month, lines));
      const saved = new Map(lines.map((l) => [`${l.kind}:${l.itemId}`, l.quantity]));
      this.sheet.set({
        ...sheet,
        items: sheet.items.map((item) => ({ ...item, quantity: saved.get(this.key(item)) ?? null })),
        enteredBy: report.enteredBy,
        enteredAtUtc: report.enteredAtUtc,
      });
      this.forget(month);
      this.report.set(report);
      this.editing.set(false);
      this.notify.info(lines.length ? 'Saved. The report is from the quantities entered.' : 'Saved with nothing entered.');
    } catch (error) {
      this.notify.error(error, 'The quantities could not be saved.');
    } finally {
      this.saving.set(false);
    }
  }

  protected unrecipedSales(report: TheoreticalCostReport): { count: number; sales: number } | null {
    const rows = report.rows.filter((r) => r.status === 'NoRecipe');
    return rows.length ? { count: rows.length, sales: rows.reduce((sum, r) => sum + r.netSales, 0) } : null;
  }

  protected costedNow(report: TheoreticalCostReport): boolean {
    return report.rows.some((r) => r.quantityCostedNow > 0);
  }

  // Typed in, what was costed with no price to set it against.
  protected unpricedCost(report: TheoreticalCostReport): number {
    return report.rows.filter((r) => r.netSales === 0).reduce((sum, r) => sum + r.theoreticalCost, 0);
  }

  protected print(): void {
    window.print();
  }

  // For a spreadsheet: a byte order mark so Excel reads the Arabic names as UTF-8. The last line
  // says where the sales came from.
  protected exportCsv(): void {
    const r = this.report();
    if (!r) {
      return;
    }
    const header = [
      'Item Code · كود الصنف',
      'Menu Item · صنف المنيو',
      'Menu Item (Arabic)',
      'Category',
      'Quantity Sold · الكمية المباعة',
      'Net Sales · صافي المبيعات',
      'Recipe Cost/Unit · تكلفة الوصفة/وحدة',
      'Theoretical Cost · التكلفة النظرية',
      'Shared Cost',
      "Qty Costed at Today's Prices",
      'Food Cost % · نسبة تكلفة الطعام',
      'Status · الحالة',
    ];
    const noRecipe = (status: string) => status === 'NoRecipe';
    const rows = r.rows.map((row) => [
      row.itemCode,
      row.menuItem,
      row.menuItemAr ?? '',
      row.category,
      // A prep item's quantity is in its unit, not portions: said so, rather than summed with them.
      row.unit ? `${row.quantitySold} ${row.unit}` : row.quantitySold,
      row.netSales.toFixed(2),
      noRecipe(row.status) ? '' : row.recipeCostPerUnit.toFixed(2),
      noRecipe(row.status) && row.sharedCost === 0 ? '' : row.theoreticalCost.toFixed(2),
      row.sharedCost.toFixed(2),
      row.quantityCostedNow,
      noRecipe(row.status) || row.foodCostPercent === null ? '' : row.foodCostPercent.toFixed(1),
      row.prepItemId ? 'Prep item · صنف تحضير' : `${statusLabels[row.status].en} · ${statusLabels[row.status].ar}`,
    ]);
    const total = ['Total', '', '', '', r.quantitySold, r.netSales.toFixed(2), '', r.theoreticalCost.toFixed(2), '', '', r.foodCostPercent?.toFixed(1) ?? '', ''];
    const source =
      r.source === 'Manual'
        ? [`Data Source: Manual Entry · مصدر البيانات: إدخال يدوي${r.enteredBy ? ` (${r.enteredBy}, ${r.enteredAtUtc?.slice(0, 10)})` : ''}`]
        : ['Data Source: Live POS · مصدر البيانات: الكاشير'];
    const csv = [header, ...rows, total, source].map((cells) => cells.map(TheoreticalPage.cell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `theoretical-cost-${this.month()}${r.source === 'Manual' ? '-manual' : ''}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  private forget(month: string): void {
    this.drafts.update((drafts) => {
      const rest = { ...drafts };
      delete rest[month];
      return rest;
    });
  }

  private async load(month: string, source: TheoreticalSource): Promise<void> {
    const [year, m] = month.split('-').map(Number);
    this.loading.set(true);
    this.error.set(null);
    this.report.set(null);
    this.sheet.set(null);
    this.editing.set(false);
    // Moved on while it loaded: what came back is for another month, or the other source.
    const stale = () => this.month() !== month || this.source() !== source;
    try {
      if (source === 'Pos') {
        const report = await firstValueFrom(this.api.theoretical(year, m));
        if (!stale()) {
          this.report.set(report);
        }
        return;
      }
      const { sheet, report } = await firstValueFrom(
        forkJoin({ sheet: this.api.manualSales(year, m), report: this.api.theoretical(year, m, 'Manual') }),
      );
      if (stale()) {
        return;
      }
      this.sheet.set(sheet);
      // Never entered, or part typed before looking away: straight to the sheet.
      const neverEntered = !sheet.enteredAtUtc;
      this.report.set(neverEntered ? null : report);
      this.editing.set(this.canEdit() && (neverEntered || this.dirty()));
    } catch (error) {
      if (stale()) {
        return;
      }
      this.report.set(null);
      this.error.set(errorMessage(error, source === 'Pos' ? 'The report could not be loaded.' : 'The sales sheet could not be loaded.'));
    } finally {
      if (!stale()) {
        this.loading.set(false);
      }
    }
  }

  private static cell(value: string | number): string {
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  private static monthOf(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }
}
```


> 📄 **`frontend/src/app/features/costing/variance-page.ts`** — 390 سطر

```ts
import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  CostingApi,
  StockCountSummary,
  VarianceReport,
  VarianceRow,
  countUnit,
  evaluationLabels,
} from '../../core/costing/costing.api';
import { errorMessage } from '../../core/http/error-message';
import { MoneyPipe } from '../../core/ui/money.pipe';

// Pillar 3: what left the stores between two counts against what the recipes say the sales
// took. Red is a shortfall beyond the tolerance (waste, theft, over-portioning, a recipe written
// too light); blue a surplus (under-portioning, a recipe too heavy, a delivery never entered).
// Quantities are as bought, before trimming, and valued at the average purchase cost.
@Component({
  selector: 'app-variance-page',
  imports: [DatePipe, DecimalPipe, FormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatProgressBarModule, MatSelectModule, MoneyPipe, RouterLink],
  template: `
    <div class="toolbar">
      <mat-form-field subscriptSizing="dynamic">
        <mat-label>From count · جرد البداية</mat-label>
        <mat-select [ngModel]="report()?.from?.id" (ngModelChange)="pick('from', $event)">
          @for (c of posted(); track c.id) {
            <mat-option [value]="c.id">
              {{ c.postedAtUtc | date: 'EEE d MMM, HH:mm' }} · {{ c.kind === 'Opening' ? 'Opening stock · جرد افتتاحي' : c.postedBy }}
            </mat-option>
          }
        </mat-select>
      </mat-form-field>
      <mat-form-field subscriptSizing="dynamic">
        <mat-label>To count · جرد النهاية</mat-label>
        <mat-select [ngModel]="report()?.to?.id" (ngModelChange)="pick('to', $event)">
          @for (c of periodic(); track c.id) {
            <mat-option [value]="c.id">{{ c.postedAtUtc | date: 'EEE d MMM, HH:mm' }} · {{ c.postedBy }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      <span class="spacer"></span>
      <button mat-button (click)="exportCsv()" [disabled]="!report()?.rows?.length"><mat-icon>download</mat-icon> CSV</button>
      <button mat-button (click)="print()" [disabled]="!report()"><mat-icon>print</mat-icon> Print</button>
    </div>
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    @if (error()) {
      <p class="error">{{ error() }}</p>
      <p class="note"><a routerLink="/costing/counts">Stock counts · الجرد</a></p>
    } @else if (report(); as r) {
      <header class="report-head">
        <h2>Variance analysis <span class="inline-ar">تحليل الانحراف</span></h2>
        <div class="muted">
          From<span class="inline-ar">من</span>: <strong>{{ r.from.postedAtUtc | date: 'd MMM y, HH:mm' }}</strong>
          @if (r.from.opening) {
            (opening stock<span class="inline-ar">جرد افتتاحي</span>)
          }
          &nbsp; To<span class="inline-ar">إلى</span>: <strong>{{ r.to.postedAtUtc | date: 'd MMM y, HH:mm' }}</strong>
          &nbsp;·&nbsp; Tolerance<span class="inline-ar">الحد المسموح</span>: <strong>±{{ r.tolerancePercent | number: '1.0-1' }}%</strong>
        </div>
      </header>

      <div class="figures">
        <div class="box" [class.deficit]="r.netVarianceValue > 0" [class.surplus]="r.netVarianceValue < 0">
          <span class="label">Net variance<span class="ar">صافي قيمة الانحراف</span></span>
          <strong>{{ r.netVarianceValue | money }}</strong>
          <small class="muted">{{ r.netVarianceValue > 0 ? 'more used than the recipes say' : r.netVarianceValue < 0 ? 'less used than the recipes say' : 'as the recipes say' }}</small>
        </div>
        <div class="box">
          <span class="label">Recorded waste<span class="ar">الهالك المسجل</span></span>
          <strong>{{ r.recordedWasteValue | money }}</strong>
        </div>
        <div class="box" [class.deficit]="r.unexplainedValue > 0" [class.surplus]="r.unexplainedValue < 0">
          <span class="label">Unexplained<span class="ar">غير مبرر</span></span>
          <strong>{{ r.unexplainedValue | money }}</strong>
          <small class="muted">not covered by recorded waste</small>
        </div>
        <div class="box" [class.deficit]="r.unfavourableCount > 0">
          <span class="label">Unfavourable materials<span class="ar">خامات غير مواتية</span></span>
          <strong>{{ r.unfavourableCount }} of {{ r.rows.length }}</strong>
        </div>
        <div class="box">
          <span class="label">Largest variance<span class="ar">أكبر انحراف نسبي</span></span>
          <strong>{{ r.largestRelativePercent === null ? '—' : (r.largestRelativePercent | number: '1.1-1') + '%' }}</strong>
          <small class="muted">{{ r.largestRelativeMaterial ?? '' }}</small>
        </div>
      </div>

      <div class="table-wrap">
        <table class="grid">
          <thead>
            <tr>
              <th>Code<span class="ar">الكود</span></th>
              <th>Material<span class="ar">الخامة</span></th>
              <th class="num">Opening<span class="ar">رصيد أول</span></th>
              <th class="num">Received<span class="ar">الوارد</span></th>
              <th class="num">Waste<span class="ar">الهالك</span></th>
              <th class="num">Standard usage<span class="ar">الاستهلاك المعياري</span></th>
              <th class="num">Expected closing<span class="ar">المتوقع</span></th>
              <th class="num">Closing count<span class="ar">رصيد آخر</span></th>
              <th class="num">Actual usage<span class="ar">الاستهلاك الفعلي</span></th>
              <th class="num">Variance<span class="ar">الانحراف</span></th>
              <th class="num">%<span class="ar">النسبة</span></th>
              <th class="num">Unit cost<span class="ar">تكلفة الوحدة</span></th>
              <th class="num">Variance value<span class="ar">قيمة الانحراف</span></th>
              <th class="num">Unexplained<span class="ar">غير مبرر</span></th>
              <th class="eval-col">Evaluation<span class="ar">التقييم</span></th>
            </tr>
          </thead>
          <tbody>
            @for (row of r.rows; track row.rawMaterialId) {
              <tr [class.deficit]="row.evaluation === 'Unfavourable'" [class.surplus]="row.evaluation === 'Favourable'">
                <td class="code">{{ row.code ?? '' }}</td>
                <td>{{ row.material }}</td>
                <td class="num">{{ qty(row, row.opening) }}</td>
                <td class="num">{{ qty(row, row.received) }}</td>
                <td class="num">
                  {{ qty(row, row.rawWaste + row.productWaste) }}
                  @if (row.rawWaste && row.productWaste) {
                    <small class="muted block">{{ qty(row, row.rawWaste) }} raw · {{ qty(row, row.productWaste) }} dishes</small>
                  }
                </td>
                <td class="num">{{ qty(row, row.standardUsage) }}</td>
                <td class="num">{{ qty(row, row.expectedClosing) }}</td>
                <td class="num">{{ qty(row, row.closing) }}</td>
                <td class="num">{{ qty(row, row.actualUsage) }}</td>
                @if (row.evaluation === 'SharedCost') {
                  <!-- No recipe uses it, so no standard: what was used, and what it was worth. -->
                  <td class="num">—</td>
                  <td class="num">—</td>
                  <td class="num">{{ row.unitCost === null ? 'No price' : (row.unitCost * unitOf(row).size | money) + ' / ' + unitOf(row).label }}</td>
                  <td class="num muted">{{ row.varianceValue === null ? '—' : (row.varianceValue | money) }} used</td>
                  <td class="num">—</td>
                } @else {
                  <td class="num strong">{{ signed(row, row.varianceQuantity) }}</td>
                  <td class="num">{{ row.variancePercent === null ? '—' : (row.variancePercent > 0 ? '+' : '') + (row.variancePercent | number: '1.1-1') + '%' }}</td>
                  <td class="num">{{ row.unitCost === null ? 'No price' : (row.unitCost * unitOf(row).size | money) + ' / ' + unitOf(row).label }}</td>
                  <td class="num strong">{{ row.varianceValue === null ? '—' : (row.varianceValue | money) }}</td>
                  <td class="num">{{ row.unexplainedValue === null ? signed(row, row.unexplainedQuantity) : (row.unexplainedValue | money) }}</td>
                }
                <td>
                  <span class="eval" [class]="row.evaluation">
                    {{ labels[row.evaluation].en }}<span class="ar">{{ labels[row.evaluation].ar }}</span>
                  </span>
                  @if (coveredByWaste(row, r.tolerancePercent)) {
                    <small class="muted block">covered by recorded waste · يغطيه الهالك المسجل</small>
                  }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="15" class="muted">No material was counted in both counts.</td></tr>
            }
          </tbody>
          @if (r.rows.length) {
            <tfoot>
              <tr>
                <td colspan="12">Total · الإجمالي</td>
                <td class="num">{{ r.netVarianceValue | money }}</td>
                <td class="num">{{ r.unexplainedValue | money }}</td>
                <td></td>
              </tr>
            </tfoot>
          }
        </table>
      </div>

      <div class="notes">
        @if (r.soldWithoutStock.length) {
          <p class="note warn">
            <strong>Sold without a recipe, so they took nothing from stock:</strong>
            @for (s of r.soldWithoutStock; track s.itemCode; let last = $last) {
              {{ s.menuItem }} × {{ s.quantity }}{{ last ? '.' : ',' }}
            }
            Their ingredients show above as a shortfall: write their recipes before reading it as waste.
          </p>
        }
        @if (r.notInBothCounts.length) {
          <p class="note">Not in both counts, so not in the report: {{ r.notInBothCounts.join(', ') }}.</p>
        }
        @if (r.missingPrices.length) {
          <p class="note">No price, so no value: {{ r.missingPrices.join(', ') }}.</p>
        }
        @if (sharedRows(r)) {
          <p class="note">Shared costs, such as frying oil, are in no recipe: their usage is shown, but left out of the totals.</p>
        }
        <p class="note">
          Variance = actual usage − standard usage, and includes recorded waste; unexplained is what remains once the waste is taken out.
          Quantities are as bought, before trimming.
        </p>
      </div>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .report-head {
      margin-bottom: 12px;

      h2 {
        margin: 0 0 4px;
        font: var(--mat-sys-title-large);
      }
    }
    .figures {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
      gap: 8px;
      margin-bottom: 12px;
    }
    .box {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 10px 12px;
      border-radius: 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface);

      .label {
        font: var(--mat-sys-label-medium);
        color: var(--mat-sys-on-surface-variant);
      }
      strong {
        font: var(--mat-sys-title-large);
      }
    }
    .strong {
      font-weight: 600;
    }
    .block {
      display: block;
    }
    .eval-col {
      min-width: 190px;
    }
    .notes {
      margin-top: 12px;
    }
    .warn {
      color: var(--mat-sys-on-surface);
    }
  `,
})
export class VariancePage {
  private readonly api = inject(CostingApi);

  protected readonly labels = evaluationLabels;

  protected readonly counts = signal<StockCountSummary[]>([]);
  protected readonly posted = computed(() => this.counts().filter((c) => c.status === 'Posted'));
  // The report ends at a periodic count: the opening stock is only ever where it starts.
  protected readonly periodic = computed(() => this.posted().filter((c) => c.kind !== 'Opening'));
  // What was asked for; null ids are the server's choice, the last two counts. The selects show
  // the counts the report actually covers.
  private readonly request = signal<{ from: string | null; to: string | null }>({ from: null, to: null });
  protected readonly report = signal<VarianceReport | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    void firstValueFrom(this.api.stockCounts())
      .then((counts) => this.counts.set(counts))
      .catch(() => undefined);
    effect(() => {
      const { from, to } = this.request();
      untracked(() => void this.load(from, to));
    });
  }

  protected pick(end: 'from' | 'to', id: string): void {
    // Moving the end alone lets the server take the count before it as the start.
    this.request.set(end === 'to' ? { from: null, to: id } : { from: id, to: this.report()?.to.id ?? null });
  }

  // In kg, litres or pieces, as the stores are counted.
  protected qty(row: VarianceRow, quantity: number): string {
    const unit = this.unitOf(row);
    return `${(quantity / unit.size).toLocaleString('en-EG', { maximumFractionDigits: 3 })} ${unit.label}`;
  }

  protected unitOf(row: VarianceRow): { label: string; size: number } {
    return countUnit(row.unit, row.purchaseUnitSize);
  }

  protected signed(row: VarianceRow, quantity: number): string {
    return (quantity > 0 ? '+' : '') + this.qty(row, quantity);
  }

  // A shortfall the recorded waste accounts for, within the tolerance: a loss, but not a mystery.
  protected coveredByWaste(row: VarianceRow, tolerance: number): boolean {
    if (row.evaluation !== 'Unfavourable' || row.rawWaste + row.productWaste <= 0) {
      return false;
    }
    return row.standardUsage > 0
      ? Math.abs((row.unexplainedQuantity / row.standardUsage) * 100) <= tolerance
      : row.unexplainedQuantity <= 0;
  }

  protected sharedRows(report: VarianceReport): boolean {
    return report.rows.some((r) => r.evaluation === 'SharedCost');
  }

  protected print(): void {
    window.print();
  }

  // For a spreadsheet: a byte order mark so Excel reads the Arabic as UTF-8. Quantities in kg,
  // litres and pieces, as on screen.
  protected exportCsv(): void {
    const r = this.report();
    if (!r) {
      return;
    }
    const header = [
      'Code · الكود',
      'Material · الخامة',
      'Category',
      'Unit',
      'Opening · رصيد أول',
      'Received · الوارد',
      'Waste Raw · هالك خام',
      'Waste Dishes · هالك منتج',
      'Standard Usage · الاستهلاك المعياري',
      'Expected Closing · المتوقع',
      'Closing Count · رصيد آخر',
      'Actual Usage · الاستهلاك الفعلي',
      'Variance · الانحراف',
      'Variance % · النسبة',
      'Unit Cost · تكلفة الوحدة',
      'Variance Value · قيمة الانحراف',
      'Unexplained Value · غير مبرر',
      'Evaluation · التقييم',
    ];
    const n = (row: VarianceRow, q: number) => String(Math.round((q / this.unitOf(row).size) * 1000) / 1000);
    const rows = r.rows.map((row) => [
      row.code ?? '',
      row.material,
      row.category ?? '',
      this.unitOf(row).label,
      n(row, row.opening),
      n(row, row.received),
      n(row, row.rawWaste),
      n(row, row.productWaste),
      n(row, row.standardUsage),
      n(row, row.expectedClosing),
      n(row, row.closing),
      n(row, row.actualUsage),
      n(row, row.varianceQuantity),
      row.variancePercent?.toFixed(1) ?? '',
      row.unitCost === null ? '' : (row.unitCost * this.unitOf(row).size).toFixed(2),
      row.varianceValue?.toFixed(2) ?? '',
      row.unexplainedValue?.toFixed(2) ?? '',
      `${evaluationLabels[row.evaluation].en} · ${evaluationLabels[row.evaluation].ar}`,
    ]);
    const total = ['Total', '', '', '', '', '', '', '', '', '', '', '', '', '', '', r.netVarianceValue.toFixed(2), r.unexplainedValue.toFixed(2), ''];
    const csv = [header, ...rows, total].map((cells) => cells.map(VariancePage.cell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `variance-${r.from.postedAtUtc.slice(0, 10)}-to-${r.to.postedAtUtc.slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  private async load(from: string | null, to: string | null): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const report = await firstValueFrom(this.api.variance(from, to));
      this.report.set(report);
    } catch (error) {
      this.report.set(null);
      this.error.set(errorMessage(error, 'The variance report could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }

  private static cell(value: string): string {
    return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  }
}
```


> 📄 **`frontend/src/app/features/costing/kpis-page.ts`** — 570 سطر

```ts
import { DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { Permissions } from '../../core/auth/permissions';
import { CostingApi, Kpi, KpiReport, MonthlyExpenses, expenseLineLabels, kpiLabels } from '../../core/costing/costing.api';
import { errorMessage } from '../../core/http/error-message';
import { Company } from '../../core/settings/company';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { NotifyService } from '../../core/ui/notify.service';

type Tone = 'ok' | 'bad' | 'check' | 'none';

const expenseFields: { key: keyof MonthlyExpenses; en: string; ar: string; hours?: boolean }[] = [
  { key: 'wagesAndBenefits', en: 'Wages and benefits', ar: 'الرواتب والمزايا' },
  { key: 'labourHours', en: 'Labour hours', ar: 'ساعات العمل', hours: true },
  { key: 'occupationCost', en: 'Rent, not on invoices', ar: 'الإيجار (بدون فاتورة)' },
  { key: 'otherControllableCosts', en: 'Other controllable, not on invoices', ar: 'تكاليف أخرى (بدون فاتورة)' },
  { key: 'interest', en: 'Interest', ar: 'الفوائد' },
  { key: 'depreciation', en: 'Depreciation', ar: 'الإهلاك' },
];

// Pillar 4: the template's financial KPIs for a business month, each against its healthy range.
// Sales and recipe costs come from the till, losses from the stock ledger, expenses from the
// month's posted purchase invoices; wages, hours and what is paid without an invoice are entered
// here. A KPI missing what it needs says so, never 0.
@Component({
  selector: 'app-kpis-page',
  imports: [DecimalPipe, FormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressBarModule, MoneyPipe, RouterLink],
  template: `
    <div class="toolbar">
      <mat-form-field subscriptSizing="dynamic">
        <mat-label>Month · الشهر</mat-label>
        <input matInput type="month" [ngModel]="month()" (ngModelChange)="pick($event)" [max]="thisMonth" />
      </mat-form-field>
      <span class="spacer"></span>
      <button mat-button (click)="print()" [disabled]="!report()"><mat-icon>print</mat-icon> Print</button>
    </div>
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    @if (error()) {
      <p class="error">{{ error() }}</p>
    } @else if (report(); as r) {
      <header class="report-head">
        <h2>Financial KPIs <span class="inline-ar">مؤشرات الأداء المالية</span></h2>
        <div class="muted">
          From<span class="inline-ar">من</span>: <strong>{{ r.from }}</strong> &nbsp; To<span class="inline-ar">إلى</span>:
          <strong>{{ r.to }}</strong> &nbsp;·&nbsp; {{ r.statement.takingsDays ?? 0 }} {{ r.statement.takingsDays === 1 ? 'day' : 'days' }} of takings
          entered<span class="inline-ar">أيام الإيراد المسجلة</span>
        </div>
      </header>

      <div class="kpis">
        @for (k of r.kpis; track k.key) {
          <div class="kpi" [class]="tone(k)">
            <div class="name">
              {{ labels[k.key].en }}
              <span class="ar">{{ labels[k.key].ar }}</span>
            </div>
            @if (k.value !== null) {
              <strong class="value">
                {{ labels[k.key].money ? (k.value | money) : (k.value | number: '1.1-1') + '%' }}
              </strong>
            } @else {
              <strong class="value muted">—</strong>
            }
            <div class="status">
              @switch (k.status) {
                @case ('Healthy') {
                  Healthy · صحي
                }
                @case ('Above') {
                  Above the healthy range · أعلى من المعدل
                }
                @case ('Below') {
                  Below the healthy range · أقل من المعدل
                }
                @case ('NoRange') {
                  Depends on the restaurant · يختلف
                }
                @default {
                  {{ k.missing }}
                }
              }
            </div>
            @if (k.healthyFrom !== null) {
              <div class="range muted">Healthy<span class="inline-ar">المعدل الصحي</span>: {{ k.healthyFrom }}–{{ k.healthyTo }}%</div>
            }
            @if (k.key === 'FoodCost' && k.value !== null) {
              <div class="range muted">
                Recipes {{ share(r.statement.foodRecipeCost, r.statement.foodSales) | number: '1.1-1' }}% + losses
                {{ share(lossTotal(r), r.statement.foodSales) | number: '1.1-1' }}%
              </div>
            }
            @if (tone(k) === 'check') {
              <div class="range">{{ lowHint(k) }}</div>
            }
            <div class="formula muted">{{ labels[k.key].formula }}<span class="ar">{{ labels[k.key].formulaAr }}</span></div>
          </div>
        }
      </div>

      @if (r.itemsWithoutRecipe > 0) {
        <p class="note warn">
          {{ r.itemsWithoutRecipe }} {{ r.itemsWithoutRecipe === 1 ? 'dish' : 'dishes' }} sold this month {{ r.itemsWithoutRecipe === 1 ? 'has' : 'have' }} no recipe
          ({{ r.salesWithoutRecipe | money }} of sales): their ingredients are not in the costs, so the cost % reads low.
          <a routerLink="/costing/recipes">Recipes</a>
        </p>
      }
      @if (r.beverageCategories.length === 0) {
        <p class="note">Every sale counts as food until the drinks categories are marked in <a routerLink="/costing/settings">Settings</a>.</p>
      }

      <div class="columns">
        <section>
          <h3>The month <span class="inline-ar">قائمة الدخل</span></h3>
          <div class="table-wrap">
            <table class="grid statement">
              <tbody>
                <tr class="takings">
                  <td>Gross takings · إجمالي الإيراد <span class="muted small">cash {{ r.statement.cashTakings ?? 0 | money }} + Visa {{ r.statement.cardTakings ?? 0 | money }} + tax {{ r.statement.taxCollected ?? 0 | money }}</span></td>
                  <td class="num">{{ r.statement.grossTakings ?? 0 | money }}</td>
                  <td></td>
                </tr>
                <tr class="takings tax">
                  <td>Less tax collected · الضريبة المحصلة <span class="muted small">owed, not revenue</span></td>
                  <td class="num">({{ r.statement.taxCollected ?? 0 | money }})</td>
                  <td></td>
                </tr>
                <tr><td>Food sales · مبيعات الطعام</td><td class="num">{{ r.statement.foodSales | money }}</td><td class="num muted"></td></tr>
                <tr><td>Beverage sales · مبيعات المشروبات</td><td class="num">{{ r.statement.beverageSales | money }}</td><td></td></tr>
                @if (r.statement.deliveryFees) {
                  <tr><td>Delivery fees · رسوم التوصيل</td><td class="num">{{ r.statement.deliveryFees | money }}</td><td></td></tr>
                }
                <tr class="total"><td>Revenue (net sales) · صافي المبيعات</td><td class="num">{{ r.statement.revenue | money }}</td><td class="num">100%</td></tr>
                <tr><td>Food cost · تكلفة الطعام</td><td class="num">{{ r.statement.foodRecipeCost | money }}</td><td class="num muted">{{ pct(r.statement.foodRecipeCost, r) }}</td></tr>
                <tr><td>Beverage cost · تكلفة المشروبات</td><td class="num">{{ r.statement.beverageRecipeCost | money }}</td><td class="num muted">{{ pct(r.statement.beverageRecipeCost, r) }}</td></tr>
                <tr><td>Kitchen waste · هالك المطبخ</td><td class="num">{{ r.statement.kitchenWaste | money }}</td><td class="num muted">{{ pct(r.statement.kitchenWaste, r) }}</td></tr>
                <tr><td>Spoilage · الهالك المسجل</td><td class="num">{{ r.statement.spoilage | money }}</td><td class="num muted">{{ pct(r.statement.spoilage, r) }}</td></tr>
                <tr><td>Count differences · فروق الجرد</td><td class="num">{{ r.statement.countDifferences | money }}</td><td class="num muted">{{ pct(r.statement.countDifferences, r) }}</td></tr>
                <tr class="total"><td>Cost of sales · تكلفة المبيعات</td><td class="num">{{ r.statement.costOfSales | money }}</td><td class="num">{{ pct(r.statement.costOfSales, r) }}</td></tr>
                <tr class="total"><td>Gross profit · الربح الإجمالي</td><td class="num">{{ r.statement.grossProfit | money }}</td><td class="num">{{ pct(r.statement.grossProfit, r) }}</td></tr>
                <tr>
                  <td>
                    Wages and benefits · الرواتب
                    @if (r.statement.loggedWages) {
                      <small class="muted part">{{ parts(r.statement.wagesAndBenefits, r.statement.loggedWages) }}</small>
                    }
                  </td>
                  <td class="num">{{ combined(r.statement.wagesAndBenefits, r.statement.loggedWages) }}</td>
                  <td class="num muted">{{ pct(sum(r.statement.wagesAndBenefits, r.statement.loggedWages), r) }}</td>
                </tr>
                <tr>
                  <td>
                    Rent and occupation · الإيجار
                    @if (r.statement.loggedOccupationCost) {
                      <small class="muted part">{{ parts(r.statement.occupationCost, r.statement.loggedOccupationCost) }}</small>
                    }
                  </td>
                  <td class="num">{{ combined(r.statement.occupationCost, r.statement.loggedOccupationCost) }}</td>
                  <td class="num muted">{{ pct(sum(r.statement.occupationCost, r.statement.loggedOccupationCost), r) }}</td>
                </tr>
                <tr>
                  <td>
                    Controllable costs · تكاليف قابلة للتحكم
                    @if (r.statement.loggedControllableCosts) {
                      <small class="muted part">{{ parts(r.statement.otherControllableCosts, r.statement.loggedControllableCosts) }}</small>
                    }
                  </td>
                  <td class="num">{{ combined(r.statement.otherControllableCosts, r.statement.loggedControllableCosts) }}</td>
                  <td class="num muted">{{ pct(sum(r.statement.otherControllableCosts, r.statement.loggedControllableCosts), r) }}</td>
                </tr>
                @if (r.statement.loggedOtherFixedCosts) {
                  <tr>
                    <td>Other fixed costs · تكاليف ثابتة أخرى <small class="muted part">from invoices</small></td>
                    <td class="num">{{ r.statement.loggedOtherFixedCosts | money }}</td>
                    <td class="num muted">{{ pct(r.statement.loggedOtherFixedCosts, r) }}</td>
                  </tr>
                }
                <tr><td>Interest · الفوائد</td><td class="num">{{ entered(r.statement.interest) }}</td><td class="num muted">{{ pct(r.statement.interest, r) }}</td></tr>
                <tr><td>Depreciation · الإهلاك</td><td class="num">{{ entered(r.statement.depreciation) }}</td><td class="num muted">{{ pct(r.statement.depreciation, r) }}</td></tr>
                <tr class="total"><td>Total expenses · إجمالي المصروفات</td><td class="num">{{ r.statement.totalExpenses | money }}</td><td class="num">{{ pct(r.statement.totalExpenses, r) }}</td></tr>
                <tr class="total" [class.loss]="(r.statement.netProfit ?? 0) < 0">
                  <td>Net profit · صافي الربح</td>
                  <td class="num">{{ r.statement.netProfit === null ? 'Enter the wages' : (r.statement.netProfit | money) }}</td>
                  <td class="num">{{ pct(r.statement.netProfit, r) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="note small">
            Revenue is the month's net sales: its takings, cash and Visa before the tax collected on them, which is owed to the tax authority
            and never profit (gross takings = net sales + tax). Food and beverage sales share it as the month's sales are, at the menu's prices.
            Food and beverage cost: what the sales took by their recipes, with shared costs such as frying oil on the meals. Losses are counted
            against food. Expenses on the month's posted purchase invoices are taken off on their category's line, with what is entered by hand.
            @if (r.statement.voids) {
              Voids and refunds on the days: {{ r.statement.voids | money }}, already out of the takings.
            }
            <span class="note-ar" lang="ar" dir="rtl">الإيراد = صافي المبيعات (الكاش + الفيزا − الضريبة). الضريبة المحصلة التزام على المطعم وليست ربحًا.</span>
          </p>
          @if (r.statement.loggedExpenses?.length) {
            <div class="logged">
              <strong>From purchase invoices · من فواتير المشتريات</strong>
              @for (e of r.statement.loggedExpenses; track e.categoryId) {
                <div class="logged-row">
                  <span>{{ e.category }} <span class="muted">· {{ lineLabels[e.expenseLine].en }}</span></span>
                  <span class="num">{{ e.amount | money }}</span>
                </div>
              }
              <a routerLink="/costing/reports/spending" class="small">Spending analysis →</a>
            </div>
          }
        </section>

        <section class="no-print">
          <h3>Monthly costs <span class="inline-ar">التكاليف الشهرية</span></h3>
          <p class="note small">
            What {{ monthName() }} cost beyond its ingredients and its purchase invoices. Leave a figure empty until it is known. Expenses
            posted on purchase invoices (bills, cleaning, repairs) are added on their own: do not type them here too.
          </p>
          <div class="expenses">
            @for (f of fields; track f.key) {
              <mat-form-field subscriptSizing="dynamic" floatLabel="always">
                <mat-label>{{ f.en }} · {{ f.ar }}</mat-label>
                @if (!f.hours) {
                  <span matTextPrefix>{{ company.currency() }}&nbsp;</span>
                }
                <input matInput type="number" min="0" step="any" [ngModel]="draft()[f.key]" (ngModelChange)="set(f.key, $event)" [disabled]="!canEdit()" />
                @if (f.hours) {
                  <span matTextSuffix>&nbsp;h</span>
                }
              </mat-form-field>
            }
          </div>
          @if (canEdit()) {
            <div class="toolbar">
              <span class="muted small">
                @if (r.expenses.updatedBy) {
                  Last saved by {{ r.expenses.updatedBy }}.
                }
              </span>
              <span class="spacer"></span>
              <button mat-flat-button (click)="saveExpenses()" [disabled]="saving() || !changed()">Save the month's costs</button>
            </div>
          }
        </section>
      </div>

      <h3>Item profitability <span class="inline-ar">ربحية العنصر</span></h3>
      <p class="note small">Selling price − ingredient cost, over what was sold this month. The most profitable first.</p>
      <div class="table-wrap">
        <table class="grid">
          <thead>
            <tr>
              <th>Item code<span class="ar">كود الصنف</span></th>
              <th>Menu item<span class="ar">صنف المنيو</span></th>
              <th class="num">Sold<span class="ar">المباع</span></th>
              <th class="num">Net sales<span class="ar">صافي المبيعات</span></th>
              <th class="num">Ingredient cost<span class="ar">تكلفة المكونات</span></th>
              <th class="num">Profit<span class="ar">الربح</span></th>
              <th class="num">Profit per item<span class="ar">ربح الوحدة</span></th>
              <th class="num">Margin<span class="ar">الهامش</span></th>
            </tr>
          </thead>
          <tbody>
            @for (item of r.items; track item.itemCode; let i = $index) {
              <tr [class.top]="i < 3 && item.profit !== null && item.profit > 0">
                <td class="code">{{ item.itemCode }}</td>
                <td>
                  {{ item.menuItem }}
                  @if (item.beverage) {
                    <small class="muted"> · drink</small>
                  }
                  @if (item.menuItemAr) {
                    <span class="ar">{{ item.menuItemAr }}</span>
                  }
                </td>
                <td class="num">{{ item.quantitySold }}</td>
                <td class="num">{{ item.netSales | money }}</td>
                <td class="num">{{ item.cost === null ? 'No recipe' : (item.cost | money) }}</td>
                <td class="num strong">{{ item.profit === null ? '—' : (item.profit | money) }}</td>
                <td class="num">{{ item.profitPerUnit === null ? '—' : (item.profitPerUnit | money) }}</td>
                <td class="num">{{ item.marginPercent === null ? '—' : (item.marginPercent | number: '1.1-1') + '%' }}</td>
              </tr>
            } @empty {
              <tr><td colspan="8" class="muted">Nothing was sold this month.</td></tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .report-head {
      margin-bottom: 12px;

      h2 {
        margin: 0 0 4px;
        font: var(--mat-sys-title-large);
      }
    }
    h3 {
      margin: 20px 0 8px;
      font: var(--mat-sys-title-medium);
    }
    .kpis {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
      gap: 10px;
    }
    .kpi {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 12px;
      border-radius: 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface);

      .name {
        font: var(--mat-sys-title-small);
      }
      .value {
        font: var(--mat-sys-headline-small);
      }
      .status {
        font: var(--mat-sys-label-large);
      }
      .range,
      .formula {
        font: var(--mat-sys-body-small);
      }
      .formula {
        margin-top: auto;
        padding-top: 6px;
      }
      &.ok {
        border-color: var(--app-ok);
        background: color-mix(in srgb, var(--app-ok) 10%, var(--mat-sys-surface));
      }
      &.bad {
        border-color: var(--mat-sys-error);
        background: color-mix(in srgb, var(--mat-sys-error) 9%, var(--mat-sys-surface));

        .value,
        .status {
          color: var(--mat-sys-error);
        }
      }
      &.check {
        border-color: #b26a00;
        background: color-mix(in srgb, #f5a623 12%, var(--mat-sys-surface));
      }
    }
    .columns {
      display: grid;
      grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
      gap: 16px;
    }
    @media (max-width: 900px) {
      .columns {
        grid-template-columns: 1fr;
      }
    }
    .statement tr.takings td {
      color: var(--mat-sys-on-surface-variant);
    }
    .statement .small {
      font-size: 0.85em;
    }
    .statement tr.total td {
      font-weight: 600;
      background: var(--mat-sys-surface-container-low);
    }
    .statement tr.loss td {
      color: var(--mat-sys-error);
    }
    .part {
      display: block;
      font-weight: 400;
    }
    .logged {
      display: grid;
      gap: 4px;
      padding: 10px 12px;
      margin-bottom: 12px;
      border-radius: 12px;
      border: 1px solid var(--mat-sys-outline-variant);
    }
    .logged-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
    }
    .expenses {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
      gap: 10px;
      margin-bottom: 8px;
    }
    tr.top td {
      background: color-mix(in srgb, var(--app-ok) 10%, var(--mat-sys-surface));
    }
    .strong {
      font-weight: 600;
    }
    .small {
      font: var(--mat-sys-body-small);
    }
    .warn {
      color: var(--mat-sys-on-surface);
    }
  `,
})
export class KpisPage {
  protected readonly company = inject(Company);
  private readonly api = inject(CostingApi);
  private readonly auth = inject(AuthService);
  private readonly notify = inject(NotifyService);

  protected readonly labels = kpiLabels;
  protected readonly fields = expenseFields;
  protected readonly canEdit = computed(() => this.auth.can(Permissions.InventoryManage));
  protected readonly thisMonth = KpisPage.monthOf(new Date());

  protected readonly month = signal(this.thisMonth);
  protected readonly report = signal<KpiReport | null>(null);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly draft = signal<MonthlyExpenses>(KpisPage.blank());

  protected readonly changed = computed(() => {
    const saved = this.report()?.expenses;
    const draft = this.draft();
    return !!saved && expenseFields.some((f) => (saved[f.key] ?? null) !== (draft[f.key] ?? null));
  });

  protected readonly monthName = computed(() => {
    const [year, month] = this.month().split('-').map(Number);
    return new Date(year, month - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  });

  constructor() {
    effect(() => {
      const month = this.month();
      untracked(() => void this.load(month));
    });
  }

  // Green in range; red on the side that hurts (a cost above, a margin below); amber on the
  // other side of a cost, which more often means a recipe or a price is missing than a windfall.
  protected tone(kpi: Kpi): Tone {
    switch (kpi.status) {
      case 'Healthy':
        return 'ok';
      case 'Above':
        return kpi.highIsBad ? 'bad' : 'ok';
      case 'Below':
        return kpi.highIsBad ? 'check' : 'bad';
      default:
        return 'none';
    }
  }

  // Under the range on a cost: more often something left out than a saving.
  protected lowHint(kpi: Kpi): string {
    return kpi.key === 'LabourCost'
      ? 'Low: check every wage and benefit is entered.'
      : 'Low: check every dish has a recipe and every material a price.';
  }

  protected lossTotal(r: KpiReport): number {
    return r.statement.kitchenWaste + r.statement.spoilage + r.statement.countDifferences;
  }

  protected share(part: number, whole: number): number | null {
    return whole > 0 ? (part / whole) * 100 : null;
  }

  // As a share of revenue, for the statement's last column.
  protected pct(value: number | null, r: KpiReport): string {
    return value === null || r.statement.revenue <= 0 ? '' : `${((value / r.statement.revenue) * 100).toFixed(1)}%`;
  }

  protected readonly lineLabels = expenseLineLabels;

  protected sum(typed: number | null, logged: number): number | null {
    return typed === null && !logged ? null : (typed ?? 0) + logged;
  }

  // A line made of what was entered and what the invoices logged.
  protected combined(typed: number | null, logged: number): string {
    return this.entered(this.sum(typed, logged));
  }

  protected parts(typed: number | null, logged: number): string {
    const money = (v: number) => v.toLocaleString('en-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return typed ? `${money(logged)} invoices + ${money(typed)} entered` : `${money(logged)} from invoices`;
  }

  protected entered(value: number | null): string {
    return value === null ? 'Not entered' : this.company.money(value);
  }

  protected pick(month: string): void {
    if (/^\d{4}-\d{2}$/.test(month)) {
      this.month.set(month);
    }
  }

  protected set(key: keyof MonthlyExpenses, value: number | string | null): void {
    const number = value === '' || value === null ? null : Number(value);
    this.draft.update((draft) => ({ ...draft, [key]: Number.isFinite(number) ? number : null }));
  }

  protected async saveExpenses(): Promise<void> {
    const [year, month] = this.month().split('-').map(Number);
    this.saving.set(true);
    try {
      const draft = this.draft();
      await firstValueFrom(
        this.api.saveExpenses(year, month, Object.fromEntries(expenseFields.map((f) => [f.key, draft[f.key] ?? null])) as unknown as MonthlyExpenses),
      );
      this.notify.info(`${this.monthName()}'s costs saved.`);
      await this.load(this.month());
    } catch (error) {
      this.notify.error(error, "The month's costs could not be saved.");
    } finally {
      this.saving.set(false);
    }
  }

  protected print(): void {
    window.print();
  }

  private async load(month: string): Promise<void> {
    const [year, m] = month.split('-').map(Number);
    this.loading.set(true);
    this.error.set(null);
    try {
      const report = await firstValueFrom(this.api.kpis(year, m));
      this.report.set(report);
      this.draft.set({ ...report.expenses });
    } catch (error) {
      this.report.set(null);
      this.error.set(errorMessage(error, 'The KPIs could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }

  private static blank(): MonthlyExpenses {
    return { wagesAndBenefits: null, labourHours: null, otherControllableCosts: null, occupationCost: null, interest: null, depreciation: null };
  }

  private static monthOf(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }
}
```


> 📄 **`frontend/src/app/features/costing/break-even-page.ts`** — 477 سطر

```ts
import { DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { Permissions } from '../../core/auth/permissions';
import { BreakEvenColumn, BreakEvenWorksheet, CostingApi, breakEvenColumn } from '../../core/costing/costing.api';
import { errorMessage } from '../../core/http/error-message';
import { Company } from '../../core/settings/company';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { NotifyService } from '../../core/ui/notify.service';

type Row = { label: string; ar: string; value: (c: BreakEvenColumn) => number | null; indent?: boolean; strong?: boolean; percent?: boolean; profit?: boolean };

// The template's rows, top to bottom.
const rows: Row[] = [
  { label: 'Gross sales (a year)', ar: 'إجمالي المبيعات السنوية', value: (c) => c.grossSales },
  { label: 'Less: cost of sales', ar: 'ناقص: تكلفة المبيعات', value: (c) => c.costOfSales, indent: true },
  { label: 'Gross profit', ar: 'الربح الإجمالي', value: (c) => c.grossProfit, strong: true },
  { label: 'Profit margin', ar: 'هامش الربح', value: (c) => c.profitMarginPercent, indent: true, percent: true },
  { label: 'Controllable costs', ar: 'التكاليف القابلة للتحكم', value: (c) => c.controllableCosts },
  { label: 'Occupation cost', ar: 'تكلفة الإشغال', value: (c) => c.occupationCost, indent: true },
  { label: 'Interest', ar: 'الفوائد', value: (c) => c.interest, indent: true },
  { label: 'Depreciation', ar: 'الإهلاك', value: (c) => c.depreciation, indent: true },
  { label: 'Other fixed costs', ar: 'تكاليف ثابتة أخرى', value: (c) => c.otherFixedCosts, indent: true },
  { label: 'Total fixed costs', ar: 'إجمالي التكاليف الثابتة', value: (c) => c.totalFixedCosts, strong: true },
  { label: 'Restaurant profit', ar: 'ربح المطعم', value: (c) => c.restaurantProfit, strong: true, profit: true },
];

// The chart's frame, in SVG units.
const chart = { width: 680, height: 320, left: 78, right: 16, top: 16, bottom: 40 };

// The sixth template: the Break-Even Analysis and Scenario Worksheet. The Income Statement
// column is the chosen months at a year's pace; the four options try other weekly sales against
// the same costs, at the same cost of sales ratio. The chart shows where sales meet total costs.
@Component({
  selector: 'app-break-even-page',
  imports: [DecimalPipe, FormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressBarModule, MoneyPipe, RouterLink],
  template: `
    <div class="toolbar">
      <mat-form-field subscriptSizing="dynamic">
        <mat-label>From · من</mat-label>
        <input matInput type="month" [ngModel]="from()" (ngModelChange)="pick('from', $event)" [max]="thisMonth" />
      </mat-form-field>
      <mat-form-field subscriptSizing="dynamic">
        <mat-label>To · إلى</mat-label>
        <input matInput type="month" [ngModel]="to()" (ngModelChange)="pick('to', $event)" [max]="thisMonth" />
      </mat-form-field>
      <span class="spacer"></span>
      @if (canEdit() && optionsChanged()) {
        <button mat-button (click)="saveOptions()" [disabled]="saving()"><mat-icon>bookmark</mat-icon> Keep these options</button>
      }
      <button mat-button (click)="print()" [disabled]="!sheet()"><mat-icon>print</mat-icon> Print</button>
    </div>
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    @if (error()) {
      <p class="error">{{ error() }}</p>
    } @else if (sheet(); as s) {
      <header class="report-head">
        <h2>Break-even analysis and scenario worksheet <span class="inline-ar">تحليل نقطة التعادل والسيناريوهات</span></h2>
        <div class="muted">
          Income statement from {{ s.days }} {{ s.days === 1 ? 'day' : 'days' }} of sales, {{ s.from }} to {{ s.to }}, at a year's pace
          (weekly × 52); costs from the months' entered costs × 12.
        </div>
      </header>

      @if (s.monthsWithoutCosts.length) {
        <p class="note warn">
          No costs entered for {{ s.monthsWithoutCosts.join(', ') }}: the fixed costs come from the other months.
          Enter them on the <a routerLink="/costing/reports/kpis">KPIs</a> tab.
        </p>
      }

      <div class="table-wrap">
        <table class="grid sheet">
          <thead>
            <tr>
              <th></th>
              <th class="num">Income statement<span class="ar">قائمة الدخل</span></th>
              @for (o of options(); track $index) {
                <th class="num">Option #{{ $index + 1 }}<span class="ar">خيار {{ $index + 1 }}</span></th>
              }
            </tr>
          </thead>
          <tbody>
            <tr class="weekly">
              <td>Weekly sales<span class="ar">المبيعات الأسبوعية</span></td>
              <td class="num strong">{{ s.weeklySales | money }}</td>
              @for (o of options(); track $index; let i = $index) {
                <td class="num">
                  <mat-form-field subscriptSizing="dynamic" class="option">
                    <span matTextPrefix>{{ company.currency() }}&nbsp;</span>
                    <input matInput type="number" min="0" step="any" [ngModel]="o" (ngModelChange)="setOption(i, $event)" [attr.aria-label]="'Option ' + (i + 1) + ' weekly sales'" />
                  </mat-form-field>
                </td>
              }
            </tr>
            @for (row of rows; track row.label) {
              <tr [class.strong]="row.strong">
                <td [class.indent]="row.indent">{{ row.label }}<span class="ar">{{ row.ar }}</span></td>
                @for (c of columns(); track $index) {
                  @let v = row.value(c);
                  <td class="num" [class.positive]="row.profit && v !== null && v > 0" [class.negative]="row.profit && v !== null && v < 0">
                    {{ v === null ? '—' : row.percent ? (v | number: '1.0-1') + '%' : (v | money) }}
                  </td>
                }
              </tr>
            }
          </tbody>
        </table>
      </div>
      @if (s.controllableFromInvoices || s.occupationFromInvoices || s.otherFixedCosts) {
        <p class="note invoices">
          From purchase invoices, at a year's pace:
          @if (s.controllableFromInvoices) {
            <strong>{{ s.controllableFromInvoices | money }}</strong> of the controllable costs;
          }
          @if (s.occupationFromInvoices) {
            <strong>{{ s.occupationFromInvoices | money }}</strong> of the occupation cost;
          }
          @if (s.otherFixedCosts) {
            all <strong>{{ s.otherFixedCosts | money }}</strong> of the other fixed costs;
          }
          the rest is what is entered on the KPIs tab. Each expense counts on its category's line.
          <span class="inline-ar">المصروفات المسجلة في فواتير المشتريات.</span>
        </p>
      }

      <section class="chart">
        <h3>Break-even chart <span class="inline-ar">رسم نقطة التعادل</span></h3>
        @if (s.breakEvenYearlySales !== null) {
          <p class="muted">
            Break even at <strong>{{ s.breakEvenYearlySales | money }}</strong> yearly sales, which is
            <strong>{{ s.breakEvenWeeklySales | money }}</strong> weekly sales.
            <span class="inline-ar">نقطة التعادل</span>
          </p>
          @if (plot(); as p) {
            <svg [attr.viewBox]="'0 0 ' + frame.width + ' ' + frame.height" role="img"
              [attr.aria-label]="'Break-even chart: break even at ' + (s.breakEvenWeeklySales | money) + ' weekly sales'">
              @for (t of p.yTicks; track t.value) {
                <line class="gridline" [attr.x1]="frame.left" [attr.x2]="frame.width - frame.right" [attr.y1]="t.y" [attr.y2]="t.y" />
                <text class="tick" [attr.x]="frame.left - 6" [attr.y]="t.y + 4" text-anchor="end">{{ t.label }}</text>
              }
              @for (t of p.xTicks; track t.value) {
                <text class="tick" [attr.x]="t.x" [attr.y]="frame.height - frame.bottom + 16" text-anchor="middle">{{ t.label }}</text>
              }
              <text class="axis" [attr.x]="(frame.left + frame.width - frame.right) / 2" [attr.y]="frame.height - 4" text-anchor="middle">
                Weekly sales ({{ company.currency() }}) · المبيعات الأسبوعية
              </text>
              <line class="fixed" [attr.x1]="p.x(0)" [attr.y1]="p.y(s.totalFixedCosts)" [attr.x2]="p.x(p.xMax)" [attr.y2]="p.y(s.totalFixedCosts)" />
              <line class="costs" [attr.x1]="p.x(0)" [attr.y1]="p.y(s.totalFixedCosts)" [attr.x2]="p.x(p.xMax)" [attr.y2]="p.y(s.totalFixedCosts + p.xMax * 52 * s.costOfSalesRatio)" />
              <line class="sales" [attr.x1]="p.x(0)" [attr.y1]="p.y(0)" [attr.x2]="p.x(p.xMax)" [attr.y2]="p.y(p.xMax * 52)" />
              @for (o of p.points; track o.label) {
                <circle [attr.class]="o.profit >= 0 ? 'point positive' : 'point negative'" [attr.cx]="p.x(o.weekly)" [attr.cy]="p.y(o.weekly * 52)" r="5" />
                <text class="point-label" [attr.x]="p.x(o.weekly)" [attr.y]="p.y(o.weekly * 52) - 9" text-anchor="middle">{{ o.label }}</text>
              }
              <rect class="breakeven" [attr.x]="p.x(s.breakEvenWeeklySales!) - 6" [attr.y]="p.y(s.breakEvenYearlySales) - 6" width="12" height="12" />
            </svg>
          }
          <div class="legend">
            <span><i class="key sales"></i>Sales · المبيعات</span>
            <span><i class="key costs"></i>Total costs · إجمالي التكاليف</span>
            <span><i class="key fixed"></i>Fixed costs · التكاليف الثابتة</span>
            <span><i class="key breakeven"></i>Break even · التعادل</span>
            <span><i class="key positive"></i>Profit · ربح</span>
            <span><i class="key negative"></i>Loss · خسارة</span>
          </div>
        } @else if (s.monthsWithoutCosts.length && s.totalFixedCosts === 0) {
          <p class="note">Enter the months' costs on the <a routerLink="/costing/reports/kpis">KPIs</a> tab: break-even needs the fixed costs.</p>
        } @else {
          <p class="error">Every sale costs more than it brings in at these months' cost of sales: no level of sales breaks even.</p>
        }
      </section>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .report-head {
      margin-bottom: 12px;

      h2 {
        margin: 0 0 4px;
        font: var(--mat-sys-title-large);
      }
    }
    h3 {
      margin: 20px 0 4px;
      font: var(--mat-sys-title-medium);
    }
    .sheet {
      td.indent {
        padding-left: 28px;
      }
      tr.strong td,
      .strong {
        font-weight: 600;
      }
      tr.weekly td {
        background: color-mix(in srgb, #f5d000 18%, var(--mat-sys-surface));
      }
      td.positive {
        background: color-mix(in srgb, var(--app-ok) 18%, var(--mat-sys-surface));
      }
      td.negative {
        background: color-mix(in srgb, var(--mat-sys-error) 14%, var(--mat-sys-surface));
        color: var(--mat-sys-error);
      }
    }
    .option {
      width: 150px;
    }
    .chart svg {
      width: 100%;
      max-width: 820px;
      height: auto;
      display: block;
    }
    .gridline {
      stroke: var(--mat-sys-outline-variant);
      stroke-width: 1;
    }
    .tick,
    .axis,
    .point-label {
      font-size: 11px;
      fill: var(--mat-sys-on-surface-variant);
    }
    .point-label {
      fill: var(--mat-sys-on-surface);
      font-weight: 600;
    }
    .sales {
      stroke: #1e88e5;
      stroke-width: 2.5;
    }
    .costs {
      stroke: #263238;
      stroke-width: 2;
      stroke-dasharray: 6 5;
    }
    .fixed {
      stroke: #ef6c00;
      stroke-width: 2;
      stroke-dasharray: 10 6;
    }
    .breakeven {
      fill: var(--mat-sys-surface);
      stroke: #263238;
      stroke-width: 2;
    }
    .point.positive {
      fill: var(--app-ok);
    }
    .point.negative {
      fill: var(--mat-sys-error);
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 16px;
      font: var(--mat-sys-body-small);
      margin-top: 6px;

      .key {
        display: inline-block;
        width: 18px;
        height: 4px;
        margin-right: 6px;
        vertical-align: middle;
        border-radius: 2px;

        &.sales {
          background: #1e88e5;
        }
        &.costs {
          background: #263238;
        }
        &.fixed {
          background: #ef6c00;
        }
        &.breakeven {
          width: 10px;
          height: 10px;
          border: 2px solid #263238;
          background: transparent;
        }
        &.positive {
          background: var(--app-ok);
          height: 10px;
          width: 10px;
          border-radius: 50%;
        }
        &.negative {
          background: var(--mat-sys-error);
          height: 10px;
          width: 10px;
          border-radius: 50%;
        }
      }
    }
    .warn {
      color: var(--mat-sys-on-surface);
    }
  `,
})
export class BreakEvenPage {
  protected readonly company = inject(Company);
  private readonly api = inject(CostingApi);
  private readonly auth = inject(AuthService);
  private readonly notify = inject(NotifyService);

  protected readonly rows = rows;
  protected readonly frame = chart;
  protected readonly canEdit = computed(() => this.auth.can(Permissions.InventoryManage));
  protected readonly thisMonth = BreakEvenPage.monthOf(new Date());

  protected readonly from = signal(this.thisMonth);
  protected readonly to = signal(this.thisMonth);
  protected readonly sheet = signal<BreakEvenWorksheet | null>(null);
  protected readonly options = signal<number[]>([]);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  // The income statement, then each option, worked out as the template does.
  protected readonly columns = computed<BreakEvenColumn[]>(() => {
    const sheet = this.sheet();
    if (!sheet) {
      return [];
    }
    const base: BreakEvenColumn = {
      weeklySales: sheet.weeklySales,
      grossSales: sheet.grossSales,
      costOfSales: sheet.costOfSales,
      grossProfit: sheet.grossProfit,
      profitMarginPercent: sheet.grossSales > 0 ? (sheet.grossProfit / sheet.grossSales) * 100 : null,
      controllableCosts: sheet.controllableCosts,
      occupationCost: sheet.occupationCost,
      interest: sheet.interest,
      depreciation: sheet.depreciation,
      otherFixedCosts: sheet.otherFixedCosts,
      totalFixedCosts: sheet.totalFixedCosts,
      restaurantProfit: sheet.restaurantProfit,
    };
    return [base, ...this.options().map((weekly) => breakEvenColumn(sheet, weekly ?? 0))];
  });

  protected readonly optionsChanged = computed(() => {
    const saved = this.sheet()?.scenarios ?? [];
    return this.options().join('|') !== saved.join('|');
  });

  // Weekly sales across, a year's money up; ticks at round numbers.
  protected readonly plot = computed(() => {
    const sheet = this.sheet();
    if (!sheet || sheet.breakEvenWeeklySales === null || sheet.breakEvenYearlySales === null) {
      return null;
    }
    const columns = this.columns();
    const xMax = BreakEvenPage.nice(Math.max(sheet.breakEvenWeeklySales, ...columns.map((c) => c.weeklySales)) * 1.2);
    const yTop = Math.max(xMax * 52, sheet.totalFixedCosts + xMax * 52 * sheet.costOfSalesRatio);
    const yMax = BreakEvenPage.nice(yTop * 1.05);
    const plotWidth = chart.width - chart.left - chart.right;
    const plotHeight = chart.height - chart.top - chart.bottom;
    const x = (weekly: number) => chart.left + (weekly / xMax) * plotWidth;
    const y = (yearly: number) => chart.top + plotHeight - (Math.max(0, Math.min(yearly, yMax)) / yMax) * plotHeight;
    const ticks = (max: number) => [0, 0.25, 0.5, 0.75, 1].map((f) => max * f);
    return {
      xMax,
      x,
      y,
      xTicks: ticks(xMax).map((value) => ({ value, x: x(value), label: BreakEvenPage.short(value) })),
      yTicks: ticks(yMax).map((value) => ({ value, y: y(value), label: BreakEvenPage.short(value) })),
      points: columns.map((c, i) => ({ label: i === 0 ? 'Now' : `#${i}`, weekly: c.weeklySales, profit: c.restaurantProfit })),
    };
  });

  constructor() {
    effect(() => {
      const from = this.from();
      const to = this.to();
      untracked(() => void this.load(from, to));
    });
  }

  protected pick(end: 'from' | 'to', month: string): void {
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return;
    }
    // Keep the run the right way round.
    if (end === 'from') {
      this.from.set(month);
      if (month > this.to()) {
        this.to.set(month);
      }
    } else {
      this.to.set(month);
      if (month < this.from()) {
        this.from.set(month);
      }
    }
  }

  protected setOption(index: number, value: number | string | null): void {
    const weekly = value === '' || value === null ? 0 : Number(value);
    this.options.update((options) => options.map((o, i) => (i === index ? (Number.isFinite(weekly) && weekly >= 0 ? weekly : 0) : o)));
  }

  protected async saveOptions(): Promise<void> {
    this.saving.set(true);
    try {
      const saved = await firstValueFrom(this.api.saveBreakEvenScenarios(this.options()));
      this.sheet.update((sheet) => (sheet ? { ...sheet, scenarios: saved } : sheet));
      this.options.set([...saved]);
      this.notify.info('Options kept.');
    } catch (error) {
      this.notify.error(error, 'The options could not be kept.');
    } finally {
      this.saving.set(false);
    }
  }

  protected print(): void {
    window.print();
  }

  private async load(from: string, to: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const sheet = await firstValueFrom(this.api.breakEven(from, to));
      this.sheet.set(sheet);
      // Until the manager keeps their own: more, much more, less and much less than now.
      this.options.set(
        sheet.scenarios.length === 4 ? [...sheet.scenarios] : [1.2, 1.5, 0.75, 0.6].map((f) => BreakEvenPage.round(sheet.weeklySales * f)),
      );
    } catch (error) {
      this.sheet.set(null);
      this.error.set(errorMessage(error, 'The worksheet could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }

  // A round figure for an option: to 10 under 1,000, to 100 under 10,000, then to 1,000.
  private static round(value: number): number {
    const step = value < 1000 ? 10 : value < 10000 ? 100 : 1000;
    return Math.round(value / step) * step;
  }

  // The next round number above, for an axis that ends on one without much empty space: 2.73M
  // ends at 3M, not 5M.
  private static nice(value: number): number {
    if (value <= 0) {
      return 1;
    }
    const power = 10 ** Math.floor(Math.log10(value));
    const step = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((s) => s * power >= value)!;
    return step * power;
  }

  private static short(value: number): string {
    return value >= 1_000_000 ? `${+(value / 1_000_000).toFixed(2)}M` : value >= 1000 ? `${+(value / 1000).toFixed(1)}k` : `${Math.round(value)}`;
  }

  private static monthOf(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }
}
```


## 4. الإعدادات والصلاحيات والموافقات والمستخدمون

`SettingsPage` (إعدادات التكلفة): نسبة تكلفة الطعام المستهدفة، فئات المشروبات، التكاليف المشتركة، المصروفات الشهرية.

> 📄 **`frontend/src/app/features/costing/settings-page.ts`** — 379 سطر

```ts
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatRadioModule } from '@angular/material/radio';
import { MatSelectModule } from '@angular/material/select';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { Permissions } from '../../core/auth/permissions';
import { CostingApi, MaterialCost, SaveSharedCost, SharedCost } from '../../core/costing/costing.api';
import { errorMessage } from '../../core/http/error-message';
import { MenuSalesApi } from '../../core/costing/menu-sales.api';
import { Company } from '../../core/settings/company';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { NotifyService } from '../../core/ui/notify.service';

interface Draft {
  id: string | null;
  name: string;
  source: 'material' | 'amount';
  rawMaterialId: string | null;
  monthlyAmount: number | null;
  // '' for all meals: a select shows null as nothing chosen.
  category: string;
}

// The food cost target, and the costs no single recipe carries: frying oil, gas, packaging. Each
// is a month's total, from what was bought of a material or a fixed amount, shared across the
// meals sold that month (all of them, or one category's).
@Component({
  selector: 'app-settings-page',
  imports: [
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatRadioModule,
    MatSelectModule,
    MoneyPipe,
  ],
  template: `
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    } @else if (error()) {
      <p class="error">{{ error() }}</p>
    } @else {
      <section class="block">
        <h2>Targets <span class="inline-ar">الأهداف</span></h2>
        <p class="note">
          A dish whose ingredients cost more than the food cost target's share of its price is marked above target. A material whose
          actual usage strays further than the tolerance from standard, either way, is marked in the variance report.
        </p>
        <div class="toolbar">
          <mat-form-field subscriptSizing="dynamic" class="target">
            <mat-label>Food cost target · نسبة التكلفة</mat-label>
            <input matInput type="number" min="1" max="100" step="0.5" [(ngModel)]="target" [disabled]="!canEdit()" />
            <span matTextSuffix>%</span>
          </mat-form-field>
          <mat-form-field subscriptSizing="dynamic" class="target">
            <mat-label>Variance tolerance · الحد المسموح</mat-label>
            <span matTextPrefix>±&nbsp;</span>
            <input matInput type="number" min="0.5" max="50" step="0.5" [(ngModel)]="tolerance" [disabled]="!canEdit()" />
            <span matTextSuffix>%</span>
          </mat-form-field>
          @if (canEdit()) {
            <button mat-flat-button (click)="saveTarget()" [disabled]="!targetValid() || (target === savedTarget && tolerance === savedTolerance) || busy()">
              Save
            </button>
          }
        </div>
      </section>

      <section class="block">
        <h2>Drinks <span class="inline-ar">المشروبات</span></h2>
        <p class="note">The menu categories that are drinks: their sales and costs make the beverage cost %, the rest the food cost %.</p>
        <div class="toolbar">
          <mat-form-field subscriptSizing="dynamic" class="drinks">
            <mat-label>Drinks categories · فئات المشروبات</mat-label>
            <mat-select multiple [(ngModel)]="beverages" [disabled]="!canEdit()">
              @for (c of categories(); track c) {
                <mat-option [value]="c">{{ c }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          @if (canEdit()) {
            <button mat-flat-button (click)="saveBeverages()" [disabled]="sameBeverages() || busy()">Save</button>
          }
        </div>
      </section>

      <section class="block">
        <h2>Shared costs <span class="inline-ar">التكاليف المشتركة</span></h2>
        <p class="note">
          Each month's total is shared equally across the meals sold that month, and added to their cost.
          A recipe card uses last month's figure per meal.
        </p>
        <div class="table-wrap">
          <table class="grid">
            <thead>
              <tr>
                <th>Name<span class="ar">الاسم</span></th>
                <th>Month's cost from<span class="ar">مصدر التكلفة الشهرية</span></th>
                <th>Shared across<span class="ar">موزعة على</span></th>
                @if (canEdit()) {
                  <th></th>
                }
              </tr>
            </thead>
            <tbody>
              @for (cost of shared(); track cost.id) {
                <tr>
                  <td>{{ cost.name }}</td>
                  <td>
                    @if (cost.rawMaterialName) {
                      What was bought of {{ cost.rawMaterialName }}
                    } @else {
                      {{ cost.monthlyAmount | money }} a month
                    }
                  </td>
                  <td>{{ cost.category ? cost.category + ' meals' : 'All meals (not drinks)' }}</td>
                  @if (canEdit()) {
                    <td class="num">
                      @if (confirming() === cost.id) {
                        <span>Remove?</span>
                        <button mat-button (click)="confirming.set(null)">Keep</button>
                        <button mat-button class="danger" (click)="remove(cost)" [disabled]="busy()">Remove</button>
                      } @else {
                        <button mat-icon-button (click)="edit(cost)" [attr.aria-label]="'Change ' + cost.name"><mat-icon>edit</mat-icon></button>
                        <button mat-icon-button (click)="confirming.set(cost.id)" [attr.aria-label]="'Remove ' + cost.name"><mat-icon>delete</mat-icon></button>
                      }
                    </td>
                  }
                </tr>
              } @empty {
                <tr><td [attr.colspan]="canEdit() ? 4 : 3" class="muted">None. Frying oil is the usual one.</td></tr>
              }
            </tbody>
          </table>
        </div>

        @if (canEdit()) {
          @if (draft(); as d) {
            <div class="editor">
              <h3>{{ d.id ? 'Change ' + d.name : 'New shared cost' }}</h3>
              <mat-form-field subscriptSizing="dynamic">
                <mat-label>Name · الاسم</mat-label>
                <input matInput [(ngModel)]="d.name" placeholder="Frying oil" />
              </mat-form-field>
              <mat-radio-group [(ngModel)]="d.source" class="sources" aria-label="Where the month's cost comes from">
                <mat-radio-button value="material">From what was bought of a material</mat-radio-button>
                <mat-radio-button value="amount">A fixed amount each month</mat-radio-button>
              </mat-radio-group>
              @if (d.source === 'material') {
                <mat-form-field subscriptSizing="dynamic">
                  <mat-label>Material · الخامة</mat-label>
                  <mat-select [(ngModel)]="d.rawMaterialId">
                    @for (m of materials(); track m.id) {
                      <mat-option [value]="m.id">{{ m.name }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
              } @else {
                <mat-form-field subscriptSizing="dynamic">
                  <mat-label>Each month · شهريًا</mat-label>
                  <span matTextPrefix>{{ company.currency() }}&nbsp;</span>
                  <input matInput type="number" min="0" step="any" [(ngModel)]="d.monthlyAmount" />
                </mat-form-field>
              }
              <mat-form-field subscriptSizing="dynamic">
                <mat-label>Shared across · موزعة على</mat-label>
                <mat-select [(ngModel)]="d.category">
                  <mat-option value="">All meals, not drinks · كل الوجبات</mat-option>
                  @for (c of categories(); track c) {
                    <mat-option [value]="c">{{ c }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
              <div class="toolbar">
                <span class="spacer"></span>
                <button mat-button (click)="draft.set(null)">Cancel</button>
                <button mat-flat-button (click)="saveShared(d)" [disabled]="busy()">Save</button>
              </div>
            </div>
          } @else {
            <button mat-button class="add" (click)="edit(null)"><mat-icon>add</mat-icon> Add a shared cost</button>
          }
        }
      </section>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .block {
      margin-bottom: 28px;

      h2 {
        margin: 0 0 4px;
        font: var(--mat-sys-title-medium);
      }
    }
    .drinks {
      min-width: 280px;
    }
    .target {
      width: 200px;
    }
    .add {
      margin-top: 8px;
    }
    .danger {
      color: var(--mat-sys-error);
    }
    .sources {
      display: flex;
      flex-wrap: wrap;
      gap: 0 16px;
    }
    .editor {
      display: grid;
      gap: 12px;
      max-width: 520px;
      margin-top: 12px;
      padding: 16px;
      border-radius: 12px;
      border: 1px solid var(--mat-sys-outline-variant);

      h3 {
        margin: 0;
        font: var(--mat-sys-title-small);
      }
    }
  `,
})
export class SettingsPage {
  protected readonly company = inject(Company);
  private readonly api = inject(CostingApi);
  private readonly auth = inject(AuthService);
  private readonly menuApi = inject(MenuSalesApi);
  private readonly menuCategories = signal<string[]>([]);
  private readonly notify = inject(NotifyService);

  protected readonly canEdit = computed(() => this.auth.can(Permissions.InventoryManage));
  protected readonly categories = computed(() => this.menuCategories());

  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly shared = signal<SharedCost[]>([]);
  protected readonly materials = signal<MaterialCost[]>([]);
  protected readonly draft = signal<Draft | null>(null);
  // The shared cost whose removal waits for a second tap.
  protected readonly confirming = signal<string | null>(null);

  protected target = 30;
  protected savedTarget = 30;
  protected tolerance = 5;
  protected savedTolerance = 5;
  protected beverages: string[] = [];
  private savedBeverages: string[] = [];

  constructor() {
    void this.load();
    firstValueFrom(this.menuApi.menu()).then(
      (menu) => this.menuCategories.set(menu.categories.map((c) => c.name)),
      () => this.menuCategories.set([]),
    );
  }

  protected targetValid(): boolean {
    const percent = (value: unknown) => typeof value === 'number' && value > 0 && value < 100;
    return percent(this.target) && percent(this.tolerance);
  }

  protected async saveTarget(): Promise<void> {
    this.busy.set(true);
    try {
      const saved = await firstValueFrom(
        this.api.saveSettings({ foodCostTargetPercent: this.target, varianceTolerancePercent: this.tolerance }),
      );
      this.target = this.savedTarget = saved.foodCostTargetPercent;
      this.tolerance = this.savedTolerance = saved.varianceTolerancePercent ?? this.tolerance;
      this.notify.info('Targets saved.');
    } catch (error) {
      this.notify.error(error, 'The targets could not be saved.');
    } finally {
      this.busy.set(false);
    }
  }

  protected sameBeverages(): boolean {
    return [...this.beverages].sort().join('|') === [...this.savedBeverages].sort().join('|');
  }

  protected async saveBeverages(): Promise<void> {
    this.busy.set(true);
    try {
      const saved = await firstValueFrom(
        this.api.saveSettings({ foodCostTargetPercent: this.savedTarget, beverageCategories: this.beverages }),
      );
      this.beverages = [...(saved.beverageCategories ?? [])];
      this.savedBeverages = [...this.beverages];
      this.notify.info('Drinks categories saved.');
    } catch (error) {
      this.notify.error(error, 'The drinks categories could not be saved.');
    } finally {
      this.busy.set(false);
    }
  }

  protected edit(cost: SharedCost | null): void {
    this.draft.set({
      id: cost?.id ?? null,
      name: cost?.name ?? '',
      source: cost && cost.rawMaterialId === null ? 'amount' : 'material',
      rawMaterialId: cost?.rawMaterialId ?? null,
      monthlyAmount: cost?.monthlyAmount ?? null,
      category: cost?.category ?? '',
    });
  }

  protected async saveShared(draft: Draft): Promise<void> {
    const request: SaveSharedCost = {
      name: draft.name.trim(),
      rawMaterialId: draft.source === 'material' ? draft.rawMaterialId : null,
      monthlyAmount: draft.source === 'amount' ? draft.monthlyAmount : null,
      category: draft.category || null,
    };
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.saveSharedCost(draft.id, request));
      this.notify.info(`${request.name} saved.`);
      this.draft.set(null);
      this.shared.set(await firstValueFrom(this.api.sharedCosts()));
    } catch (error) {
      this.notify.error(error, 'The shared cost could not be saved.');
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(cost: SharedCost): Promise<void> {
    this.confirming.set(null);
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.deleteSharedCost(cost.id));
      this.notify.info(`${cost.name} removed.`);
      this.shared.set(await firstValueFrom(this.api.sharedCosts()));
    } catch (error) {
      this.notify.error(error, 'The shared cost could not be removed.');
    } finally {
      this.busy.set(false);
    }
  }

  private async load(): Promise<void> {
    try {
      const [settings, shared, materials] = await Promise.all([
        firstValueFrom(this.api.settings()),
        firstValueFrom(this.api.sharedCosts()),
        firstValueFrom(this.api.materials()),
      ]);
      this.target = this.savedTarget = settings.foodCostTargetPercent;
      this.tolerance = this.savedTolerance = settings.varianceTolerancePercent ?? 5;
      this.beverages = [...(settings.beverageCategories ?? [])];
      this.savedBeverages = [...this.beverages];
      this.shared.set(shared);
      this.materials.set(materials);
    } catch (error) {
      this.error.set(errorMessage(error, 'The costing settings could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }
}
```


`PermissionsPage`: صف لكل مستخدم بأقسامه الفعلية، و `TabsDialog` لتعليم الأقسام أو العودة لأقسام الدور.

> 📄 **`frontend/src/app/features/costing/permissions-page.ts`** — 218 سطر

```ts
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';
import { CostingTab, costingTabs } from '../../core/costing/costing-tabs';
import { MenuSalesApi, UserTabs } from '../../core/costing/menu-sales.api';
import { errorMessage } from '../../core/http/error-message';
import { NotifyService } from '../../core/ui/notify.service';
import { roleLabels } from '../../core/users/users.api';

// What the dialog closes with: the sections ticked, or null for the role's own again.
export interface TabsChoice {
  tabs: CostingTab[] | null;
}

// A user's sections, each with what it lets them do: ticked, only those from now on; "Their
// role's" puts them back to what their role works.
@Component({
  selector: 'app-tabs-dialog',
  imports: [FormsModule, MatButtonModule, MatCheckboxModule, MatDialogModule],
  template: `
    <h2 mat-dialog-title>{{ data.name }}’s sections <span class="inline-ar">صلاحيات {{ data.name }}</span></h2>
    <mat-dialog-content>
      <p class="muted">{{ roleLabels[data.role].en }} · {{ roleLabels[data.role].ar }}</p>
      <div class="tabs">
        @for (t of tabs; track t.tab) {
          <mat-checkbox class="tab-option" [attr.data-tab]="t.tab" [checked]="chosen.has(t.tab)" (change)="tick(t.tab, $event.checked)">
            <span class="name">{{ t.en }} <span class="inline-ar">{{ t.ar }}</span></span>
            <span class="hint">{{ t.hint.en }} · {{ t.hint.ar }}</span>
          </mat-checkbox>
        }
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      @if (data.restricted) {
        <button mat-button class="reset" (click)="ref.close({ tabs: null })">Their role’s · حسب الدور</button>
      }
      <span class="spacer"></span>
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button (click)="save()">Save · حفظ</button>
    </mat-dialog-actions>
  `,
  styles: `
    .tabs {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 6px 16px;
    }
    .name {
      display: block;
      font: var(--mat-sys-label-large);
    }
    .hint {
      display: block;
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
    }
    .inline-ar {
      direction: rtl;
      unicode-bidi: isolate;
      opacity: 0.75;
      margin-left: 6px;
    }
    .spacer {
      flex: 1;
    }
    .muted {
      color: var(--mat-sys-on-surface-variant);
    }
  `,
})
export class TabsDialog {
  protected readonly data = inject<UserTabs>(MAT_DIALOG_DATA);
  protected readonly ref = inject(MatDialogRef<TabsDialog, TabsChoice>);
  protected readonly tabs = costingTabs;
  protected readonly roleLabels = roleLabels;
  protected readonly chosen = new Set<CostingTab>(this.data.tabs);

  protected tick(tab: CostingTab, on: boolean): void {
    if (on) {
      this.chosen.add(tab);
    } else {
      this.chosen.delete(tab);
    }
  }

  protected save(): void {
    this.ref.close({ tabs: costingTabs.map((t) => t.tab).filter((t) => this.chosen.has(t)) });
  }
}

// Permissions (الصلاحيات), a manager's: the sections each user works. A manager works every one,
// always; anyone else their role's (an accountant the purchases, the safe and the reports; a cost
// controller the recipes, the menu, the sales and the reports; a storekeeper the stock) until a
// manager ticks theirs. The server holds them to it on every request.
@Component({
  selector: 'app-permissions-page',
  imports: [MatButtonModule, MatIconModule, MatProgressBarModule],
  template: `
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    } @else if (error(); as message) {
      <p class="error">{{ message }}</p>
    } @else {
      <div class="table-wrap">
        <table class="grid access" aria-label="Permissions">
          <thead>
            <tr>
              <th>User<span class="ar">المستخدم</span></th>
              <th>Sections<span class="ar">الأقسام</span></th>
              <th><span class="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (u of users(); track u.id) {
              <tr>
                <td>
                  <strong>{{ u.name }}</strong>
                  <div class="muted small">{{ roleLabels[u.role].en }} · {{ roleLabels[u.role].ar }}</div>
                </td>
                <td>
                  <div class="chips">
                    @for (t of u.tabs; track t) {
                      <span class="tag info">{{ label(t) }}</span>
                    } @empty {
                      <span class="muted">None · لا شيء</span>
                    }
                  </div>
                  <div class="muted small">
                    @if (u.restricted) {
                      Ticked by {{ u.setBy }}
                    } @else {
                      Their role’s · حسب الدور
                    }
                  </div>
                </td>
                <td class="num">
                  <button mat-stroked-button (click)="change(u)"><mat-icon>tune</mat-icon> Change <span class="inline-ar">تعديل</span></button>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="3" class="empty">
                  No one but managers yet: add users on Users, then give them their sections here.
                  <span class="note-ar" lang="ar" dir="rtl">لا يوجد مستخدمون غير المديرين بعد: أضفهم من صفحة المستخدمين.</span>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <p class="note">
        <span class="note-ar" lang="ar" dir="rtl">المدير يعمل في كل الأقسام دائمًا. غيره يعمل في أقسام دوره حتى يحدد المدير أقسامه، فتصبح هي فقط. التعديلات التي يقررها المدير (الحذف والإلغاء والتصنيع والخزنة) تنتظر موافقته.</span>
        A manager works every section, always. Anyone else works their role’s until a manager ticks theirs; then only those. What only a manager
        decides (deletes, voids, production, the safe) waits for a manager’s approval.
      </p>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-bottom: 4px;
    }
    .small {
      font-size: 0.85em;
    }
  `,
})
export class PermissionsPage {
  private readonly api = inject(MenuSalesApi);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotifyService);
  protected readonly roleLabels = roleLabels;

  protected readonly users = signal<UserTabs[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  constructor() {
    void this.load();
  }

  protected label(tab: CostingTab): string {
    return costingTabs.find((t) => t.tab === tab)?.en ?? tab;
  }

  protected async change(user: UserTabs): Promise<void> {
    const choice = await firstValueFrom(this.dialog.open(TabsDialog, { data: user, width: '720px', maxWidth: '96vw' }).afterClosed());
    if (!choice) {
      return;
    }
    try {
      const saved = await firstValueFrom(this.api.setTabs(user.id, choice.tabs));
      this.users.update((all) => all.map((u) => (u.id === saved.id ? saved : u)));
      this.notify.info(saved.restricted ? `${saved.name} works ${saved.tabs.length} sections now.` : `${saved.name} works their role’s sections again.`);
    } catch (error) {
      this.notify.error(error, 'The sections could not be saved.');
    }
  }

  private async load(): Promise<void> {
    try {
      this.users.set(await firstValueFrom(this.api.access()));
      this.error.set(null);
    } catch (error) {
      this.error.set(errorMessage(error, 'The permissions could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }
}
```


`Approvals` (الخدمة): **أثر الحذف لكل وحدة** بكلمات المحاسب ("الدفاتر لا تُعدَّل؛ القيد المرحّل يُلغى")، شارة الانتظار، ونافذة سبب الحذف. و `ApprovalsPage`: الطلبات بسطور التغيير، وتصحيح الفاتورة/الدفعة **بأثره على كل خامة** (`NetRow`)، والقرار. و `ApprovalChanges`: "الكمية: 10 كجم ← 12 كجم"، والجديد بقيمته فقط، والمحذوف مشطوب.

> 📄 **`frontend/src/app/features/costing/approvals.ts`** — 223 سطر

```ts
import { Component, Injectable, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { Permissions } from '../../core/auth/permissions';
import { ApprovalAction, ApprovalModule, ApprovalOutcome, ApprovalRequest, ApprovalResult, CostingApi } from '../../core/costing/costing.api';
import { NotifyService } from '../../core/ui/notify.service';

// What deleting does, module by module: the books are never edited, a posted record is voided.
export const consequences: Record<ApprovalModule, string> = {
  Recipe: 'It is kept, marked deleted, and can be restored; past reports are not changed.',
  PurchaseInvoice:
    'It is kept, marked voided: its goods go back out of stock at its own prices and its cash payment goes back where it came from (or it comes off its supplier’s account), dated today; its spending leaves the reports of its own date.',
  Waste: 'What it took from stock goes back in, dated today. It is kept in the approvals history.',
  StockCount: 'Its adjustments are undone, dated today, and the variance report no longer measures from it.',
  RawMaterial: 'It leaves the lists: it can no longer be bought, counted or put in a recipe. The records that name it keep it.',
  PrepItem: 'It leaves the lists: it can no longer be made, counted or put in a recipe. The batches that name it keep it.',
  ProductionOrder: 'It is kept, marked voided: its ingredients go back into stock and the prep item comes back out, at the costs it was made at, dated today.',
  Treasury: 'It is kept, marked voided: its cash goes back where it came from, dated today, and a supplier payment goes back on the supplier’s account.',
  PurchaseCategory:
    'The category goes and what is in it moves, converted as listed: raw materials made expense items have their past invoice lines restated as expenses on their own dates and their stock ledger taken out; expense items made raw materials start with nothing on hand.',
  Sale: 'It is kept, marked voided: everything its lines took from stock goes back in, as it was taken, and it leaves the reports.',
  Breakage: 'It is kept, marked voided: its cost leaves the day it was entered on.',
};

// The posted records, which are voided rather than deleted.
export const voids: ReadonlySet<ApprovalModule> = new Set(['PurchaseInvoice', 'Waste', 'StockCount', 'ProductionOrder', 'Treasury', 'Sale', 'Breakage']);

// What approving a new or changed record does, for the manager deciding it.
export function approvalEffect(module: ApprovalModule, action: ApprovalAction): string {
  if (action === 'Delete') {
    return consequences[module];
  }
  if (module === 'Treasury') {
    return 'The cash moves now: into the safe, or out of it (or out of a day’s takings), as entered.';
  }
  if (module === 'PurchaseInvoice') {
    return 'The invoice is voided and the corrected one posted in its place: its stock, cash and supplier’s account are redone, at the average costs at this moment.';
  }
  if (module === 'RawMaterial') {
    return 'The material is counted in the new unit from now: its stock, average cost, invoices, recipes, counts and batches are restated by the conversion, every amount of money as it was.';
  }
  if (module === 'ProductionOrder') {
    return action === 'Create'
      ? 'The batch is made now: its ingredients leave stock and the prep item comes in, at the average costs at this moment.'
      : 'The batch is reversed and made again with the new quantities, at the average costs at this moment.';
  }
  return action === 'Create'
    ? 'The prep item is added, and can then be made and used in recipes.'
    : 'The changes are saved, and the next batches are made by them.';
}

// "Deletion requested", "Change requested": a pending request's mark on its row.
export function pendingLabel(request: ApprovalRequest): { en: string; ar: string } {
  switch (request.action) {
    case 'Create':
      return { en: 'Waiting for approval', ar: 'بانتظار الموافقة' };
    case 'Update':
      return { en: 'Change requested', ar: 'طلب تعديل' };
    default:
      return { en: voids.has(request.module) ? 'Void requested' : 'Deletion requested', ar: voids.has(request.module) ? 'طلب إلغاء' : 'طلب حذف' };
  }
}

export interface DeleteRequestDialogData {
  module: ApprovalModule;
  // What the record is called, as the screen shows it: "Tomatoes", "Invoice F-1001".
  what: string;
  canApprove: boolean;
  // What else it means, for this record: "Sales of Latte stop taking stock".
  detail?: string;
}

// Asks before deleting. Someone who may approve deletions deletes; anyone else asks a manager,
// with a reason if they like. Closes with the reason, or nothing when cancelled.
@Component({
  selector: 'app-delete-request-dialog',
  imports: [FormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>
      @if (data.canApprove) {
        {{ isVoid ? 'Void' : 'Delete' }} {{ data.what }}? <span class="ar">{{ isVoid ? 'إلغاء' : 'حذف' }}</span>
      } @else {
        Ask to {{ isVoid ? 'void' : 'delete' }} {{ data.what }}? <span class="ar">{{ isVoid ? 'طلب إلغاء' : 'طلب حذف' }}</span>
      }
    </h2>
    <mat-dialog-content>
      @if (data.detail) {
        <p><strong>{{ data.detail }}</strong></p>
      }
      @if (data.canApprove) {
        <p>{{ consequence }}</p>
      } @else {
        <p class="ask">
          A manager approves deletions. Until they decide it stays as it is, counted in the figures, and cannot be changed.
          <span class="ar">يُرسل الطلب للمدير للموافقة.</span>
        </p>
        <p class="muted">If approved: {{ consequence }}</p>
      }
      <mat-form-field class="reason" subscriptSizing="dynamic">
        <mat-label>Reason · السبب</mat-label>
        <textarea matInput [(ngModel)]="reason" maxlength="500" rows="2" [placeholder]="data.canApprove ? 'Optional' : 'Optional: tells the manager why'"></textarea>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button [class.danger-fill]="data.canApprove" [mat-dialog-close]="{ reason: reason.trim() || null }">
        {{ data.canApprove ? (isVoid ? 'Void' : 'Delete') : 'Ask the manager' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .reason {
      width: 100%;
      margin-top: 4px;
    }
    .ar {
      direction: rtl;
      unicode-bidi: isolate;
      white-space: nowrap;
      margin-left: 6px;
      opacity: 0.75;
      font-size: 0.8em;
    }
    .ask {
      padding: 8px 10px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--app-warn) 14%, transparent);
    }
    .muted {
      color: var(--mat-sys-on-surface-variant);
    }
    .danger-fill {
      background: var(--mat-sys-error);
      color: var(--mat-sys-on-error);
    }
  `,
})
export class DeleteRequestDialog {
  protected readonly data = inject<DeleteRequestDialogData>(MAT_DIALOG_DATA);
  protected readonly isVoid = voids.has(this.data.module);
  protected readonly consequence = consequences[this.data.module];
  protected reason = '';
}

// Maker-checker for the costing screens: what waits for a manager (to mark those rows and lock
// them, and to list the new prep items and batches not made yet), the delete itself, which is a
// request for anyone who may not approve, and the word that a save went to a manager.
@Injectable({ providedIn: 'root' })
export class Approvals {
  private readonly api = inject(CostingApi);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotifyService);

  readonly pending = signal<ApprovalRequest[]>([]);
  readonly canApprove = computed(() => this.auth.can(Permissions.ApprovalDecide));
  private readonly byRecord = computed(() => new Map(this.pending().map((r) => [r.recordId, r])));

  // The request waiting for this record, whatever it asks, if one is: it is locked meanwhile.
  pendingFor(recordId: string): ApprovalRequest | undefined {
    return this.byRecord().get(recordId);
  }

  // The new ones of a module waiting to be made: prep items and batches that do not exist yet.
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

  async refresh(): Promise<void> {
    if (!this.auth.can(Permissions.InventoryManage)) {
      return;
    }
    try {
      this.pending.set((await firstValueFrom(this.api.approvalRequests())).pending);
    } catch {
      // The screens still work; their rows are simply not marked until the next refresh.
    }
  }

  // Asks first, then deletes (for a manager) or sends the request (for anyone else). Null when
  // cancelled or refused.
  async delete(module: ApprovalModule, recordId: string, what: string, detail?: string): Promise<ApprovalOutcome | null> {
    const answer = await firstValueFrom(
      this.dialog
        .open<DeleteRequestDialog, DeleteRequestDialogData, { reason: string | null }>(DeleteRequestDialog, {
          data: { module, what, canApprove: this.canApprove(), ...(detail ? { detail } : {}) },
          width: '480px',
        })
        .afterClosed(),
    );
    if (!answer) {
      return null;
    }
    try {
      const result = await firstValueFrom(this.api.requestDeletion(crypto.randomUUID(), module, recordId, answer.reason));
      this.notify.info(
        result.outcome === 'Requested'
          ? 'Deletion request submitted to the manager for approval.'
          : `${what.charAt(0).toUpperCase()}${what.slice(1)} ${voids.has(module) ? 'voided' : 'deleted'}.`,
      );
      await this.refresh();
      return result.outcome;
    } catch (error) {
      this.notify.error(error, `${what} could not be deleted.`);
      return null;
    }
  }
}
```


> 📄 **`frontend/src/app/features/costing/approval-changes.ts`** — 56 سطر

```ts
import { Component, input } from '@angular/core';
import { ApprovalChange } from '../../core/costing/costing.api';

// What a request changes, line by line, as the manager reads it: "Quantity to produce: 10 kg →
// 12 kg". Something new has only its value; something taken away is struck through.
@Component({
  selector: 'app-approval-changes',
  template: `
    <ul class="changes">
      @for (c of changes(); track $index) {
        <li>
          <span class="label">{{ c.label }}:</span>&ngsp;
          @if (c.before === null) {
            <span class="after">{{ c.after }}</span>
          } @else if (c.after === null) {
            <span class="before">{{ c.before }}</span>&ngsp;<span class="gone">removed · حُذف</span>
          } @else {
            <span class="before">{{ c.before }}</span>&ngsp;<span class="arrow" aria-label="becomes">→</span>&ngsp;<span class="after">{{ c.after }}</span>
          }
        </li>
      }
    </ul>
  `,
  styles: `
    .changes {
      margin: 6px 0 0;
      padding: 0;
      list-style: none;
      font-size: 0.9em;

      li + li {
        margin-top: 2px;
      }
    }
    .label {
      color: var(--mat-sys-on-surface-variant);
    }
    .before {
      color: var(--mat-sys-on-surface-variant);
      text-decoration: line-through;
    }
    .after {
      font-weight: 600;
    }
    .arrow {
      color: var(--mat-sys-on-surface-variant);
    }
    .gone {
      font-size: 0.85em;
      color: var(--mat-sys-error);
    }
  `,
})
export class ApprovalChanges {
  readonly changes = input.required<ApprovalChange[]>();
}
```


> 📄 **`frontend/src/app/features/costing/approvals-page.ts`** — 542 سطر

```ts
import { DatePipe, DecimalPipe } from '@angular/common';
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
  ApprovalPreview,
  ApprovalRequest,
  CostingApi,
  UnitOfMeasure,
  actionLabels,
  moduleLabels,
} from '../../core/costing/costing.api';
import { errorMessage } from '../../core/http/error-message';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { NotifyService } from '../../core/ui/notify.service';
import { ApprovalChanges } from './approval-changes';
import { Approvals, approvalEffect, voids } from './approvals';

type Deciding = { id: string; decision: 'approve' | 'reject' };
type Preview = { id: string; data: ApprovalPreview | null; error: string | null };

// One material's movement on a correction: what the batch took (or made), what the corrected one
// takes (or makes), and what that does to its stock.
interface NetRow {
  material: string;
  unit: UnitOfMeasure;
  was: number;
  now: number;
  change: number;
}

const baseLabels: Record<UnitOfMeasure, string> = { Gram: 'g', Millilitre: 'ml', Piece: 'pc' };

// Pending approvals (طلبات معلقة): every request from staff without approval rights, oldest
// first: deletions in recipes, purchases, waste, stock counts, raw materials, prep items and
// production; new and changed prep items; new and corrected batches. Each shows what it asks,
// line by line, for a manager to approve (it is done) or reject (nothing changes). A batch shows,
// before it is approved, what it would move now at today's averages: what the manager signs off
// on. The last decisions are kept below, as the history of who asked and who decided.
@Component({
  selector: 'app-approvals-page',
  imports: [
    ApprovalChanges,
    DatePipe,
    DecimalPipe,
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MoneyPipe,
  ],
  template: `
    <p class="note">
      Requests from staff without approval rights: deletions, and new or changed prep items and production batches. Until you decide, nothing
      changes: the record stays in every figure and cannot be changed, and nothing new is made or moved.
      <span class="inline-ar">طلبات بانتظار موافقة المدير.</span>
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
                <tr class="confirm-row" [class.deleting]="deciding()!.decision === 'approve' && r.action === 'Delete'">
                  <td colspan="6">
                    @if (deciding()!.decision === 'approve' && preview()?.id === r.id) {
                      @let p = preview()!;
                      @if (p.error) {
                        <p class="error">{{ p.error }}</p>
                      } @else if (!p.data) {
                        <mat-progress-bar mode="indeterminate" />
                      } @else if (p.data?.replaces; as was) {
                        <div class="moves">
                          <strong>What approving moves now <span class="inline-ar">حركة المخزون عند الموافقة</span></strong>
                          <p class="muted small">
                            The batch made {{ was.producedAtUtc | date: 'd MMM, HH:mm' }} is reversed (what it took goes back, what it made comes back out),
                            then made again with the new quantities at today's averages. The net change in stock:
                          </p>
                          <table class="grid compact">
                            <thead>
                              <tr>
                                <th>Material<span class="ar">الصنف</span></th>
                                <th class="num">Was<span class="ar">قبل</span></th>
                                <th class="num">Now<span class="ar">بعد</span></th>
                                <th class="num">Stock change<span class="ar">صافي الحركة</span></th>
                              </tr>
                            </thead>
                            <tbody>
                              @for (n of net(p.data!); track n.material) {
                                <tr>
                                  <td>{{ n.material }}</td>
                                  <td class="num">{{ n.was | number: '1.0-3' }} {{ base(n.unit) }}</td>
                                  <td class="num">{{ n.now | number: '1.0-3' }} {{ base(n.unit) }}</td>
                                  <td class="num strong" [class.out]="n.change < 0">{{ n.change > 0 ? '+' : '' }}{{ n.change | number: '1.0-3' }} {{ base(n.unit) }}</td>
                                </tr>
                              }
                            </tbody>
                            <tfoot>
                              <tr>
                                <td colspan="3">Batch cost: {{ was.totalCost | money }} before, at today's averages</td>
                                <td class="num strong">{{ p.data!.batch.totalCost === null ? '—' : (p.data!.batch.totalCost | money) }}</td>
                              </tr>
                            </tfoot>
                          </table>
                          @if (p.data!.batch.missingPrices.length) {
                            <p class="error">{{ p.data!.batch.missingPrices.join(', ') }} {{ p.data!.batch.missingPrices.length === 1 ? 'has' : 'have' }} no cost now: it cannot be made until it has one.</p>
                          }
                        </div>
                      } @else {
                        @let b = p.data!.batch;
                        <div class="moves">
                          <strong>What approving moves now, at today's averages <span class="inline-ar">حركة المخزون عند الموافقة</span></strong>
                          <table class="grid compact">
                            <thead>
                              <tr>
                                <th>Out of stock<span class="ar">يُصرف</span></th>
                                <th class="num">Quantity<span class="ar">الكمية</span></th>
                                <th class="num">Average cost<span class="ar">متوسط التكلفة</span></th>
                                <th class="num">Cost<span class="ar">التكلفة</span></th>
                              </tr>
                            </thead>
                            <tbody>
                              @for (l of b.lines; track l.rawMaterialId) {
                                <tr [class.short]="l.short !== null">
                                  <td>{{ l.material }}</td>
                                  <td class="num">{{ l.quantity | number: '1.0-3' }} {{ base(l.unit) }}</td>
                                  <td class="num muted">{{ l.costPerPurchaseUnit === null ? 'No cost yet' : (l.costPerPurchaseUnit | money) + ' / ' + l.purchaseUnit }}</td>
                                  <td class="num">{{ l.cost === null ? '—' : (l.cost | money) }}</td>
                                </tr>
                              }
                            </tbody>
                            <tfoot>
                              <tr>
                                <td colspan="3">
                                  Into stock: {{ b.producedQuantity / b.displayUnitSize | number: '1.0-3' }} {{ b.displayUnit }} of
                                  {{ b.prepItem }}, at {{ b.unitCostPerDisplayUnit === null ? '—' : (b.unitCostPerDisplayUnit | money) }} / {{ b.displayUnit }}
                                </td>
                                <td class="num strong">{{ b.totalCost === null ? '—' : (b.totalCost | money) }}</td>
                              </tr>
                            </tfoot>
                          </table>
                          @if (b.missingPrices.length) {
                            <p class="error">{{ b.missingPrices.join(', ') }} {{ b.missingPrices.length === 1 ? 'has' : 'have' }} no cost now: it cannot be made until it has one.</p>
                          } @else if (b.shortages.length) {
                            <p class="muted small">The records show too little {{ b.shortages.join(', ') }}: they go below zero until a delivery or a count puts them right.</p>
                          }
                        </div>
                      }
                    }
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
                      <button mat-flat-button [class.danger-fill]="deciding()!.decision === 'approve' && r.action === 'Delete'" (click)="decide(r)"
                        [disabled]="saving() || (deciding()!.decision === 'approve' && blocked(r))">
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
  styleUrl: './costing.scss',
  styles: `
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
    tr.confirm-row.deleting td {
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
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
    .danger-fill:not(:disabled) {
      background: var(--mat-sys-error);
      color: var(--mat-sys-on-error);
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
      &.Delete {
        background: color-mix(in srgb, var(--mat-sys-error) 14%, transparent);
      }
      .ar {
        display: inline;
        margin-left: 4px;
      }
    }
    .moves {
      margin-bottom: 10px;
      padding: 10px 12px;
      border-radius: 12px;
      background: var(--mat-sys-surface);
      color: var(--mat-sys-on-surface);

      table {
        margin-top: 6px;
      }
      tr.short td {
        background: var(--mat-sys-error-container);
      }
    }
    .strong {
      font-weight: 600;
    }
    .out {
      color: var(--mat-sys-error);
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
  private readonly api = inject(CostingApi);
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
  // What approving a batch would move, loaded as its approval is asked about.
  protected readonly preview = signal<Preview | null>(null);
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
    this.preview.set(null);
    if (decision === 'approve' && request.module === 'ProductionOrder' && request.action !== 'Delete') {
      void this.loadPreview(request.id);
    }
  }

  protected cancel(): void {
    this.deciding.set(null);
    this.preview.set(null);
  }

  protected base(unit: UnitOfMeasure): string {
    return baseLabels[unit];
  }

  // "Void it?", "Approve the change?"
  protected question(request: ApprovalRequest): string {
    switch (request.action) {
      case 'Delete':
        return voids.has(request.module) ? 'Void it?' : 'Delete it?';
      case 'Create':
        return 'Approve it?';
      default:
        return request.module === 'ProductionOrder' ? 'Approve the correction?' : 'Approve the change?';
    }
  }

  protected approveLabel(request: ApprovalRequest): string {
    const batch = request.module === 'ProductionOrder';
    switch (request.action) {
      case 'Delete':
        return voids.has(request.module) ? 'Approve and void' : 'Approve and delete';
      case 'Create':
        return batch ? 'Approve and make' : 'Approve and add';
      default:
        return batch ? 'Approve the correction' : 'Approve the change';
    }
  }

  // A batch with an ingredient that has no cost now cannot be made: there is nothing to approve yet.
  protected blocked(request: ApprovalRequest): boolean {
    const preview = this.preview();
    return request.module === 'ProductionOrder' && request.action !== 'Delete' && (!preview?.data || preview.data.batch.missingPrices.length > 0);
  }

  // A correction's net movement, material by material: each ingredient back by what the batch
  // took and out by what the corrected one takes; the prep item out by what it made and in by
  // what the corrected one makes.
  protected net(preview: ApprovalPreview): NetRow[] {
    const was = preview.replaces!;
    const rows = new Map<string, NetRow>();
    for (const l of was.lines) {
      rows.set(l.rawMaterialId, { material: l.material, unit: l.unit, was: l.quantity, now: 0, change: 0 });
    }
    for (const l of preview.batch.lines) {
      const row = rows.get(l.rawMaterialId) ?? { material: l.material, unit: l.unit, was: 0, now: 0, change: 0 };
      rows.set(l.rawMaterialId, { ...row, now: l.quantity });
    }
    const ingredients = [...rows.values()].map((r) => ({ ...r, change: r.was - r.now }));
    const made = preview.batch.producedQuantity;
    return [
      ...ingredients,
      { material: `${preview.batch.prepItem} (made)`, unit: preview.batch.unit, was: was.producedQuantity, now: made, change: made - was.producedQuantity },
    ];
  }

  // What was decided, as the history says it.
  protected outcome(request: ApprovalRequest): string {
    return request.status === 'Rejected' ? 'Rejected' : ApprovalsPage.done(request.module, request.action);
  }

  private static done(module: ApprovalModule, action: ApprovalAction): string {
    const batch = module === 'ProductionOrder';
    switch (action) {
      case 'Delete':
        return voids.has(module) ? 'Voided' : 'Deleted';
      case 'Create':
        return batch ? 'Made' : 'Added';
      default:
        return batch ? 'Corrected' : 'Changed';
    }
  }

  protected async decide(request: ApprovalRequest): Promise<void> {
    const decision = this.deciding()?.decision;
    if (!decision || this.saving()) {
      return;
    }
    this.saving.set(true);
    try {
      if (decision === 'approve') {
        await firstValueFrom(this.api.approveRequest(request.id));
        this.notify.info(`Approved: it is ${ApprovalsPage.done(request.module, request.action).toLowerCase()}.`);
      } else {
        await firstValueFrom(this.api.rejectRequest(request.id, this.note.trim() || null));
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

  private async loadPreview(requestId: string): Promise<void> {
    this.preview.set({ id: requestId, data: null, error: null });
    try {
      const data = await firstValueFrom(this.api.approvalPreview(requestId));
      if (this.preview()?.id === requestId) {
        this.preview.set({ id: requestId, data, error: null });
      }
    } catch (error) {
      if (this.preview()?.id === requestId) {
        this.preview.set({ id: requestId, data: null, error: errorMessage(error, 'What it would move could not be worked out.') });
      }
    }
  }

  private async load(): Promise<void> {
    try {
      const requests = await firstValueFrom(this.api.approvalRequests(30));
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
```


المستخدمون والحساب:

> 📄 **`frontend/src/app/core/users/users.api.ts`** — 63 سطر

```ts
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { UserRole } from '../api/models';

// Who signs in to the system (GET /api/users), a manager's to keep. isLocked: too many wrong
// passwords, for a few minutes; a new password lifts it.
export interface User {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
  createdAtUtc: string;
  lastSignInAtUtc: string | null;
  isLocked: boolean;
}

export interface NewUser {
  email: string;
  fullName: string;
  role: UserRole;
  password: string;
}

export interface UserChange {
  email: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
}

// A password is this long at least, as the API asks.
export const MinPasswordLength = 8;

export const roleLabels: Record<UserRole, { en: string; ar: string }> = {
  Manager: { en: 'Manager', ar: 'مدير' },
  Accountant: { en: 'Accountant', ar: 'محاسب' },
  CostController: { en: 'Cost controller', ar: 'مراقب تكاليف' },
  Storekeeper: { en: 'Storekeeper', ar: 'أمين المخزن' },
};

@Injectable({ providedIn: 'root' })
export class UsersApi {
  private readonly http = inject(HttpClient);

  all(): Observable<User[]> {
    return this.http.get<User[]>('/api/users');
  }

  create(user: NewUser): Observable<User> {
    return this.http.post<User>('/api/users', user);
  }

  update(id: string, change: UserChange): Observable<User> {
    return this.http.put<User>(`/api/users/${encodeURIComponent(id)}`, change);
  }

  // Signs them out wherever they are signed in, and lifts a lockout.
  resetPassword(id: string, password: string): Observable<void> {
    return this.http.put<void>(`/api/users/${encodeURIComponent(id)}/password`, { password });
  }
}
```


> 📄 **`frontend/src/app/features/users/users-page.ts`** — 180 سطر

```ts
import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { errorMessage } from '../../core/http/error-message';
import { NotifyService } from '../../core/ui/notify.service';
import { NewUser, User, UserChange, UsersApi, roleLabels } from '../../core/users/users.api';
import { ResetPasswordDialog, UserDialog, UserDialogData } from './user-dialogs';

const rank = (user: User) => (user.role === 'Manager' ? 0 : 1);

// Users (المستخدمون): who signs in to the system, a manager's to keep. Each is a manager, an
// accountant, a cost controller or a storekeeper, signs in with their email and a password, and is
// deactivated rather than deleted. There is always one active manager. The sections each works are
// on Costing → Permissions.
@Component({
  selector: 'app-users-page',
  imports: [DatePipe, MatButtonModule, MatIconModule, MatProgressBarModule],
  template: `
    <header class="head">
      <h1>Users <span class="inline-ar">المستخدمون</span></h1>
    </header>
    <div class="toolbar">
      <p class="note"><span class="note-ar" lang="ar" dir="rtl">من يسجّل الدخول إلى النظام: المديرون، والمحاسبون ومراقبو التكاليف وأمناء المخزن الذين يعملون في الأقسام التي يحددها المدير في صفحة الصلاحيات.</span> Who signs in to the system: managers, and the accountants, cost controllers and storekeepers who work the sections a manager gives them on Permissions.</p>
      <span class="spacer"></span>
      <button mat-flat-button (click)="add()"><mat-icon>person_add</mat-icon> Add a user</button>
    </div>
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    } @else if (error()) {
      <p class="error">{{ error() }}</p>
    } @else {
      <div class="table-wrap">
        <table class="grid">
          <thead>
            <tr>
              <th>Name<span class="ar">الاسم</span></th>
              <th>Email<span class="ar">البريد الإلكتروني</span></th>
              <th>Role<span class="ar">الدور</span></th>
              <th>Last signed in<span class="ar">آخر دخول</span></th>
              <th class="num"><span class="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (u of sorted(); track u.id) {
              <tr [class.inactive]="!u.isActive">
                <td>
                  {{ u.fullName }}
                  @if (u.id === auth.me()?.id) {
                    <span class="tag">You</span>
                  }
                  @if (!u.isActive) {
                    <span class="tag">Deactivated</span>
                  } @else if (u.isLocked) {
                    <span class="tag warn">Locked: too many wrong passwords</span>
                  }
                </td>
                <td>{{ u.email }}</td>
                <td>{{ labels[u.role].en }}<span class="ar">{{ labels[u.role].ar }}</span></td>
                <td class="muted">{{ u.lastSignInAtUtc ? (u.lastSignInAtUtc | date: 'd MMM y, HH:mm') : 'Never' }}</td>
                <td class="num actions">
                  <button mat-stroked-button (click)="change(u)"><mat-icon>edit</mat-icon> Change</button>
                  <button mat-stroked-button (click)="resetPassword(u)"><mat-icon>key</mat-icon> New password</button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
  styleUrl: '../shared/pages.scss',
  styles: `
    .head h1 {
      margin: 0 0 8px;
      font: var(--mat-sys-headline-small);
    }
    .toolbar .note {
      margin: 0;
    }
    .actions {
      white-space: nowrap;

      button + button {
        margin-left: 6px;
      }
    }
    tr.inactive td {
      color: var(--mat-sys-on-surface-variant);
    }
    .tag {
      margin-inline-start: 6px;
    }
    .muted {
      color: var(--mat-sys-on-surface-variant);
    }
  `,
})
export class UsersPage {
  private readonly api = inject(UsersApi);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotifyService);
  protected readonly auth = inject(AuthService);

  protected readonly labels = roleLabels;
  protected readonly users = signal<User[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  // The active first, managers before accountants, then by name.
  protected readonly sorted = computed(() =>
    [...this.users()].sort(
      (a, b) => Number(b.isActive) - Number(a.isActive) || rank(a) - rank(b) || a.fullName.localeCompare(b.fullName),
    ),
  );

  constructor() {
    void this.load();
  }

  protected async add(): Promise<void> {
    const user = await firstValueFrom(this.dialog.open<UserDialog, UserDialogData, NewUser>(UserDialog, { data: {}, width: '460px' }).afterClosed());
    if (!user) {
      return;
    }
    try {
      const made = await firstValueFrom(this.api.create(user));
      this.users.update((all) => [...all, made]);
      this.notify.info(`${made.fullName} can sign in with ${made.email} and the password you gave.`);
    } catch (error) {
      this.notify.error(error, 'The user could not be added.');
    }
  }

  protected async change(user: User): Promise<void> {
    const change = await firstValueFrom(
      this.dialog
        .open<UserDialog, UserDialogData, UserChange>(UserDialog, { data: { user, self: user.id === this.auth.me()?.id }, width: '460px' })
        .afterClosed(),
    );
    if (!change) {
      return;
    }
    try {
      const saved = await firstValueFrom(this.api.update(user.id, change));
      this.users.update((all) => all.map((u) => (u.id === saved.id ? saved : u)));
      this.notify.info(saved.isActive ? `${saved.fullName} saved.` : `${saved.fullName} is deactivated and signed out.`);
    } catch (error) {
      this.notify.error(error, 'The user could not be saved.');
    }
  }

  protected async resetPassword(user: User): Promise<void> {
    const password = await firstValueFrom(this.dialog.open<ResetPasswordDialog, User, string>(ResetPasswordDialog, { data: user, width: '420px' }).afterClosed());
    if (!password) {
      return;
    }
    try {
      await firstValueFrom(this.api.resetPassword(user.id, password));
      this.users.update((all) => all.map((u) => (u.id === user.id ? { ...u, isLocked: false } : u)));
      this.notify.info(`${user.fullName} signs in with the new password.`);
    } catch (error) {
      this.notify.error(error, 'The password could not be set.');
    }
  }

  private async load(): Promise<void> {
    try {
      this.users.set(await firstValueFrom(this.api.all()));
    } catch (error) {
      this.error.set(errorMessage(error, 'The users could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }
}
```


> 📄 **`frontend/src/app/features/users/user-dialogs.ts`** — 132 سطر

```ts
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { UserRole } from '../../core/api/models';
import { MinPasswordLength, NewUser, User, UserChange, roleLabels } from '../../core/users/users.api';

const dialogStyles = `
  .wide {
    width: 100%;
  }
  .muted {
    color: var(--mat-sys-on-surface-variant);
  }
  .ar {
    direction: rtl;
    unicode-bidi: isolate;
    margin-left: 6px;
    opacity: 0.75;
    font-size: 0.8em;
  }
`;

export interface UserDialogData {
  // The user changed; none for someone new.
  user?: User;
  // Their own account: they keep their manager's rights, which another manager takes away.
  self?: boolean;
}

// A user added (with the password they first sign in with) or changed. Closes with what to send.
@Component({
  selector: 'app-user-dialog',
  imports: [FormsModule, MatButtonModule, MatCheckboxModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <h2 mat-dialog-title>{{ data.user ? 'Change ' + data.user.fullName : 'Add a user' }} <span class="ar">{{ data.user ? 'تعديل مستخدم' : 'مستخدم جديد' }}</span></h2>
    <mat-dialog-content>
      <mat-form-field class="wide">
        <mat-label>Full name · الاسم</mat-label>
        <input matInput [(ngModel)]="fullName" maxlength="200" aria-label="Full name" />
      </mat-form-field>
      <mat-form-field class="wide">
        <mat-label>Email · البريد الإلكتروني</mat-label>
        <input matInput type="email" [(ngModel)]="email" maxlength="256" autocomplete="off" aria-label="Email" />
      </mat-form-field>
      <mat-form-field class="wide">
        <mat-label>Role · الدور</mat-label>
        <mat-select [(ngModel)]="role" [disabled]="!!data.self" aria-label="Role">
          @for (r of roles; track r) {
            <mat-option [value]="r">{{ labels[r].en }} · {{ labels[r].ar }}</mat-option>
          }
        </mat-select>
        <mat-hint>{{ roleHints[role] }}</mat-hint>
      </mat-form-field>
      @if (data.user) {
        <mat-checkbox [(ngModel)]="isActive" [disabled]="!!data.self">Active: can sign in · نشط</mat-checkbox>
        @if (data.self) {
          <p class="muted">Your own role and access are another manager's to change.</p>
        }
      } @else {
        <mat-form-field class="wide">
          <mat-label>Password · كلمة المرور</mat-label>
          <input matInput type="text" [(ngModel)]="password" autocomplete="new-password" aria-label="Password" />
          <mat-hint>{{ minLength }} characters at least. Give it to them; they can change it on their account.</mat-hint>
        </mat-form-field>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button [disabled]="!ready()" [mat-dialog-close]="result()">Save</button>
    </mat-dialog-actions>
  `,
  styles: dialogStyles,
})
export class UserDialog {
  protected readonly data = inject<UserDialogData>(MAT_DIALOG_DATA);
  protected readonly roles: UserRole[] = ['Manager', 'Accountant', 'CostController', 'Storekeeper'];
  protected readonly labels = roleLabels;
  // What each does, until a manager ticks their sections on Permissions.
  protected readonly roleHints: Record<UserRole, string> = {
    Manager: 'Works every section, and approves what the others ask.',
    Accountant: 'Purchases, the safe and the reports; their changes wait for a manager.',
    CostController: 'Recipes, the menu, sales, counts and the cost reports; their changes wait for a manager.',
    Storekeeper: 'The stock: materials, purchases, counts, waste and production; sees no costs.',
  };
  protected readonly minLength = MinPasswordLength;
  protected fullName = this.data.user?.fullName ?? '';
  protected email = this.data.user?.email ?? '';
  protected role: UserRole = this.data.user?.role ?? 'Accountant';
  protected isActive = this.data.user?.isActive ?? true;
  protected password = '';

  protected ready(): boolean {
    return !!this.fullName.trim() && this.email.includes('@') && (!!this.data.user || this.password.length >= MinPasswordLength);
  }

  protected result(): NewUser | UserChange {
    const common = { email: this.email.trim(), fullName: this.fullName.trim(), role: this.role };
    return this.data.user ? { ...common, isActive: this.isActive } : { ...common, password: this.password };
  }
}

// A new password for someone who forgot theirs, or is locked out. Closes with it.
@Component({
  selector: 'app-reset-password-dialog',
  imports: [FormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>A new password for {{ data.fullName }} <span class="ar">كلمة مرور جديدة</span></h2>
    <mat-dialog-content>
      <p class="muted">They are signed out wherever they are signed in, and sign in again with this one.</p>
      <mat-form-field class="wide">
        <mat-label>New password · كلمة المرور</mat-label>
        <input matInput type="text" [(ngModel)]="password" autocomplete="new-password" aria-label="New password" />
        <mat-hint>{{ minLength }} characters at least.</mat-hint>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button [disabled]="password.length < minLength" [mat-dialog-close]="password">Set the password</button>
    </mat-dialog-actions>
  `,
  styles: dialogStyles,
})
export class ResetPasswordDialog {
  protected readonly data = inject<User>(MAT_DIALOG_DATA);
  protected readonly minLength = MinPasswordLength;
  protected password = '';
}
```


> 📄 **`frontend/src/app/features/account/account-page.ts`** — 132 سطر

```ts
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { AuthService } from '../../core/auth/auth.service';
import { CostingAccess } from '../../core/costing/costing-tabs';
import { errorMessage } from '../../core/http/error-message';
import { NotifyService } from '../../core/ui/notify.service';
import { MinPasswordLength, roleLabels } from '../../core/users/users.api';

// Their own account (حسابي): who they are signed in as, and their password, changed with the
// one they have now. Changing it signs them out everywhere else. Where a user lands who holds no
// tab yet, until a manager gives them some.
@Component({
  selector: 'app-account-page',
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule],
  template: `
    <header class="head">
      <h1>Your account <span class="inline-ar">حسابي</span></h1>
    </header>
    @if (auth.me(); as me) {
      <dl class="who">
        <dt>Name</dt>
        <dd>{{ me.fullName }}</dd>
        <dt>Email</dt>
        <dd>{{ me.email }}</dd>
        <dt>Role</dt>
        <dd>{{ labels[me.role].en }}<span class="inline-ar">{{ labels[me.role].ar }}</span></dd>
      </dl>
      @if (noTabs()) {
        <p class="note"><span class="note-ar" lang="ar" dir="rtl">ليس لديك أي قسم في التكاليف والماليات بعد. يمنحها المدير من صفحة الصلاحيات.</span> You work no section of Costing &amp; Financials yet. A manager gives them on Permissions.</p>
      }
    }

    <h2>Change your password <span class="inline-ar">تغيير كلمة المرور</span></h2>
    <form class="password" (ngSubmit)="change()">
      <mat-form-field>
        <mat-label>Current password</mat-label>
        <input matInput type="password" name="current" autocomplete="current-password" [(ngModel)]="current" [disabled]="busy()" />
      </mat-form-field>
      <mat-form-field>
        <mat-label>New password</mat-label>
        <input matInput type="password" name="next" autocomplete="new-password" [(ngModel)]="next" [disabled]="busy()" />
        <mat-hint>{{ minLength }} characters at least.</mat-hint>
      </mat-form-field>
      <mat-form-field>
        <mat-label>New password again</mat-label>
        <input matInput type="password" name="again" autocomplete="new-password" [(ngModel)]="again" [disabled]="busy()" />
      </mat-form-field>
      @if (error(); as message) {
        <p class="error" role="alert">{{ message }}</p>
      }
      <div>
        <button mat-flat-button type="submit" [disabled]="busy()"><mat-icon>key</mat-icon> Change the password</button>
      </div>
    </form>
  `,
  styleUrl: '../shared/pages.scss',
  styles: `
    .head h1 {
      margin: 0 0 8px;
      font: var(--mat-sys-headline-small);
    }
    h2 {
      margin: 24px 0 8px;
      font: var(--mat-sys-title-medium);
    }
    .who {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 6px 16px;
      margin: 0 0 12px;

      dt {
        color: var(--mat-sys-on-surface-variant);
      }
      dd {
        margin: 0;
      }
    }
    .password {
      display: grid;
      gap: 4px;
      max-width: 360px;
    }
  `,
})
export class AccountPage {
  protected readonly auth = inject(AuthService);
  private readonly access = inject(CostingAccess);
  private readonly notify = inject(NotifyService);

  protected readonly labels = roleLabels;
  protected readonly minLength = MinPasswordLength;
  protected readonly noTabs = computed(() => this.access.tabs().size === 0);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected current = '';
  protected next = '';
  protected again = '';

  protected async change(): Promise<void> {
    if (this.busy()) {
      return;
    }
    if (!this.current || !this.next) {
      this.error.set('Enter your current password and the new one.');
      return;
    }
    if (this.next.length < MinPasswordLength) {
      this.error.set(`A password is ${MinPasswordLength} characters at least.`);
      return;
    }
    if (this.next !== this.again) {
      this.error.set('The new password is not the same both times.');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.changePassword(this.current, this.next);
      this.current = this.next = this.again = '';
      this.notify.info('Password changed. You are signed out everywhere else.');
    } catch (error) {
      this.error.set(errorMessage(error, 'The password could not be changed.'));
    } finally {
      this.busy.set(false);
    }
  }
}
```


### 4.1 إعدادات الشركة وشاشات الربط

> 📄 **`frontend/src/app/features/settings/settings-tabs.ts`** — 8 سطر

```ts
import { SubNavTab } from '../shared/sub-nav';

// Settings' pages, a manager's: the company, the link to the restaurant's POS, and the link to HR.
export const settingsTabs: readonly SubNavTab[] = [
  { path: '/settings', icon: 'business', en: 'Company', ar: 'الشركة', fallback: true },
  { path: '/settings/pos-integration', icon: 'point_of_sale', en: 'POS Integration', ar: 'ربط نقطة البيع' },
  { path: '/settings/hr-integration', icon: 'groups', en: 'HR Integration', ar: 'ربط الموارد البشرية' },
];
```


> 📄 **`frontend/src/app/features/settings/settings-page.ts`** — 336 سطر

```ts
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { firstValueFrom } from 'rxjs';
import { errorMessage } from '../../core/http/error-message';
import { Company, CompanySettings, Country, CurrencyPosition, SettingsApi, countryLabels, formatMoney } from '../../core/settings/company';
import { NotifyService } from '../../core/ui/notify.service';
import { SubNav } from '../shared/sub-nav';
import { settingsTabs } from './settings-tabs';

// Every time zone this browser knows, for the list; the saved one always among them.
function timeZones(saved: string): string[] {
  const known = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['Africa/Cairo', 'Asia/Riyadh', 'Asia/Dubai', 'UTC'];
  return known.includes(saved) ? known : [saved, ...known];
}

// Company Settings (إعدادات الشركة), a manager's: the company's name and logo, how money is written
// everywhere (screens, Excel sheets and the API's messages), the country, and the time zone and
// the hour the business day starts. Changing the time zone is said plainly before it is saved: it
// moves which day new sales and entries fall on.
@Component({
  selector: 'app-settings-page',
  imports: [
    SubNav,
    FormsModule,
    MatAutocompleteModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
  ],
  template: `
    <header class="head">
      <h1>Company settings <span class="inline-ar">إعدادات الشركة</span></h1>
    </header>
    <app-sub-nav label="Settings" [tabs]="tabs" />

    <section class="card" aria-labelledby="identity-title">
      <h2 id="identity-title">The company <span class="inline-ar">الشركة</span></h2>
      <mat-form-field class="wide">
        <mat-label>Company name · اسم الشركة</mat-label>
        <input matInput name="name" [(ngModel)]="name" maxlength="200" aria-label="Company name" />
      </mat-form-field>
      <div class="logo">
        @if (company.logoUrl(); as url) {
          <img [src]="url" alt="The company's logo" />
        } @else {
          <span class="no-logo">No logo yet · لا يوجد شعار</span>
        }
        <div class="logo-actions">
          <button mat-stroked-button type="button" (click)="picker.click()" [disabled]="busy()">
            <mat-icon>upload</mat-icon> {{ company.settings().hasLogo ? 'Replace the logo' : 'Upload a logo' }}
          </button>
          @if (company.settings().hasLogo) {
            <button mat-button type="button" (click)="removeLogo()" [disabled]="busy()"><mat-icon>delete</mat-icon> Take it off</button>
          }
          <span class="muted small">PNG, JPEG or WebP, a megabyte at most. Shown on the sign-in page and the top bar.</span>
          <input #picker type="file" hidden accept="image/png,image/jpeg,image/webp" (change)="uploadLogo(picker)" aria-label="Logo file" />
        </div>
      </div>
    </section>

    <section class="card" aria-labelledby="money-title">
      <h2 id="money-title">Money <span class="inline-ar">العملة</span></h2>
      <div class="row">
        <mat-form-field>
          <mat-label>Currency symbol · رمز العملة</mat-label>
          <input matInput name="currency" [ngModel]="currencySymbol()" (ngModelChange)="currencySymbol.set($event)" maxlength="8" placeholder="L.E, $, SAR" aria-label="Currency symbol" />
        </mat-form-field>
        <mat-button-toggle-group name="position" [ngModel]="currencyPosition()" (ngModelChange)="currencyPosition.set($event)" aria-label="Where the symbol goes" hideSingleSelectionIndicator>
          <mat-button-toggle value="Before">Before the amount</mat-button-toggle>
          <mat-button-toggle value="After">After it</mat-button-toggle>
        </mat-button-toggle-group>
      </div>
      <p class="muted">Amounts read <strong class="preview">{{ preview() }}</strong> on every screen, in the Excel sheets and in the system's messages.</p>
    </section>

    <section class="card" aria-labelledby="place-title">
      <h2 id="place-title">Country and time <span class="inline-ar">الدولة والوقت</span></h2>
      <div class="row">
        <mat-form-field>
          <mat-label>Country · الدولة</mat-label>
          <mat-select name="country" [(ngModel)]="country" aria-label="Country">
            @for (c of countries; track c) {
              <mat-option [value]="c">{{ countryLabels[c].en }} · {{ countryLabels[c].ar }}</mat-option>
            }
          </mat-select>
          <mat-hint>Where the company is</mat-hint>
        </mat-form-field>
        <mat-form-field class="zone">
          <mat-label>Time zone · المنطقة الزمنية</mat-label>
          <input matInput name="zone" [ngModel]="timeZoneId()" (ngModelChange)="timeZoneId.set($event)" [matAutocomplete]="zones" aria-label="Time zone" />
          <mat-autocomplete #zones="matAutocomplete">
            @for (z of shownZones(); track z) {
              <mat-option [value]="z">{{ z }}</mat-option>
            }
          </mat-autocomplete>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Business day starts · بداية يوم العمل</mat-label>
          <mat-select name="hour" [(ngModel)]="workdayStartsAtHour" aria-label="Business day starts">
            @for (h of hours; track h) {
              <mat-option [value]="h">{{ h < 10 ? '0' + h : h }}:00</mat-option>
            }
          </mat-select>
          <mat-hint>A night past midnight is the evening's day until then</mat-hint>
        </mat-form-field>
      </div>

      @if (zoneChanged()) {
        <div class="zone-warning" role="alert">
          <mat-icon>warning</mat-icon>
          <div>
            <strong>Changing the time zone from {{ company.settings().timeZoneId }} to {{ timeZoneId() }}</strong>
            <p>
              From the moment it is saved, new sales, takings and entries fall on business days by the new zone's clock, and today's business day
              may change. What is recorded already stays on its day.
            </p>
            <p class="inline-ar">تغيير المنطقة الزمنية يغيّر توزيع المبيعات والقيود الجديدة على أيام العمل، وما سُجل يبقى في يومه.</p>
            <mat-checkbox name="zoneUnderstood" [(ngModel)]="zoneUnderstood">I understand</mat-checkbox>
          </div>
        </div>
      }

    </section>

    @if (error(); as message) {
      <p class="error" role="alert">{{ message }}</p>
    }
    <div class="actions">
      <button mat-flat-button (click)="save()" [disabled]="busy() || (zoneChanged() && !zoneUnderstood)"><mat-icon>save</mat-icon> Save the settings</button>
      @if (busy()) {
        <mat-progress-bar mode="indeterminate" />
      }
    </div>
  `,
  styleUrl: '../shared/pages.scss',
  styles: `
    .head h1 {
      margin: 0 0 12px;
      font: var(--mat-sys-headline-small);
    }
    .card {
      max-width: 860px;
      margin-bottom: 16px;
      padding: 16px 20px;
      border-radius: 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface);

      h2 {
        margin: 0 0 12px;
        font: var(--mat-sys-title-medium);
      }
    }
    .wide {
      width: 100%;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 16px;
    }
    .zone {
      min-width: 260px;
    }
    .logo {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 16px;

      img {
        max-height: 72px;
        max-width: 200px;
        object-fit: contain;
      }
    }
    .no-logo {
      display: inline-grid;
      place-items: center;
      width: 120px;
      height: 72px;
      border: 1px dashed var(--mat-sys-outline);
      border-radius: 8px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-small);
      text-align: center;
    }
    .logo-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
    .preview {
      font-variant-numeric: tabular-nums;
    }
    .zone-warning {
      display: flex;
      gap: 12px;
      margin: 8px 0 16px;
      padding: 12px 16px;
      border-radius: 12px;
      border: 2px solid var(--mat-sys-error);
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);

      mat-icon {
        flex: none;
        color: var(--mat-sys-error);
      }
      p {
        margin: 6px 0;
      }
    }
    .label {
      font: var(--mat-sys-label-large);
    }
    .actions {
      max-width: 860px;
      display: grid;
      gap: 8px;
      justify-items: start;
    }
    .small {
      font-size: 0.85em;
    }
    .muted {
      color: var(--mat-sys-on-surface-variant);
    }
  `,
})
export class SettingsPage {
  protected readonly tabs = settingsTabs;
  private readonly api = inject(SettingsApi);
  private readonly notify = inject(NotifyService);
  protected readonly company = inject(Company);

  protected readonly countries: Country[] = ['Egypt', 'SaudiArabia'];
  protected readonly countryLabels = countryLabels;
  protected readonly hours = Array.from({ length: 13 }, (_, h) => h);
  private readonly zones = timeZones(this.company.settings().timeZoneId);

  protected name = this.company.settings().name;
  protected readonly currencySymbol = signal(this.company.settings().currencySymbol);
  protected readonly currencyPosition = signal<CurrencyPosition>(this.company.settings().currencyPosition);
  protected country: Country = this.company.settings().country;
  protected readonly timeZoneId = signal(this.company.settings().timeZoneId);
  protected workdayStartsAtHour = this.company.settings().workdayStartsAtHour;
  protected zoneUnderstood = false;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly preview = computed(() => formatMoney(1400, this.currencySymbol().trim(), this.currencyPosition()));
  protected readonly zoneChanged = computed(() => this.timeZoneId().trim() !== this.company.settings().timeZoneId);
  protected readonly shownZones = computed(() => {
    const typed = this.timeZoneId().trim().toLowerCase();
    return (typed ? this.zones.filter((z) => z.toLowerCase().includes(typed)) : this.zones).slice(0, 50);
  });

  protected async save(): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const zoneChanged = this.zoneChanged();
      const saved = await firstValueFrom(
        this.api.save({
          name: this.name.trim(),
          currencySymbol: this.currencySymbol().trim(),
          currencyPosition: this.currencyPosition(),
          country: this.country,
          timeZoneId: this.timeZoneId().trim(),
          workdayStartsAtHour: this.workdayStartsAtHour,
        }),
      );
      this.saved(saved);
      this.zoneUnderstood = false;
      this.notify.info(zoneChanged ? 'Settings saved. New entries fall on business days by the new time zone.' : 'Settings saved.');
    } catch (error) {
      this.error.set(errorMessage(error, 'The settings could not be saved.'));
    } finally {
      this.busy.set(false);
    }
  }

  protected async uploadLogo(picker: HTMLInputElement): Promise<void> {
    const file = picker.files?.[0];
    picker.value = '';
    if (!file) {
      return;
    }
    if (file.size > 1024 * 1024) {
      this.notify.error(null, 'A logo is a megabyte at most: save a smaller picture.');
      return;
    }
    await this.act(() => firstValueFrom(this.api.uploadLogo(file)), 'Logo saved.', 'The logo could not be saved.');
  }

  protected async removeLogo(): Promise<void> {
    await this.act(() => firstValueFrom(this.api.removeLogo()), 'Logo taken off.', 'The logo could not be taken off.');
  }

  private async act(call: () => Promise<CompanySettings>, done: string, failed: string): Promise<void> {
    this.busy.set(true);
    try {
      this.saved(await call());
      this.notify.info(done);
    } catch (error) {
      this.notify.error(error, failed);
    } finally {
      this.busy.set(false);
    }
  }

  // The app's settings are the saved ones at once: the money everywhere, the logo, the name.
  private saved(settings: CompanySettings): void {
    this.company.settings.set(settings);
  }
}
```


`PosIntegrationPage`: المفتاح (يُعرض مرة للنسخ، ثم آخر أربعة حروف فقط)، وما يستدعيه الـ POS، وسجل المزامنة بفلاتر (الكل، تقارير Z، المشاكل)، وتحديث كل 20 ثانية.

> 📄 **`frontend/src/app/core/settings/pos-integration.ts`** — 48 سطر

```ts
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

// Settings → POS Integration (/api/settings/pos-integration), a manager's: the key the POS sends in
// X-API-Key (made here, shown once, kept only as its hash), and the log of every call the POS made.

export type PosSyncOutcome = 'Recorded' | 'Updated' | 'Unchanged' | 'Refused' | 'Unauthorized' | 'Failed' | 'Served';

export interface PosSyncLog {
  id: string;
  atUtc: string;
  endpoint: string;
  outcome: PosSyncOutcome;
  message: string;
  zReportId: string | null;
  businessDate: string | null;
  detail: string | null;
}

export interface PosIntegration {
  hasKey: boolean;
  keyHint: string | null;
  keyCreatedAtUtc: string | null;
  keyCreatedBy: string | null;
  logs: PosSyncLog[];
}

// The key in full, this once.
export interface PosKey {
  key: string;
  keyHint: string;
  createdAtUtc: string;
  createdBy: string;
}

@Injectable({ providedIn: 'root' })
export class PosIntegrationApi {
  private readonly http = inject(HttpClient);

  get(logs = 200): Observable<PosIntegration> {
    return this.http.get<PosIntegration>('/api/settings/pos-integration', { params: { logs } });
  }

  newKey(): Observable<PosKey> {
    return this.http.post<PosKey>('/api/settings/pos-integration/key', {});
  }
}
```


> 📄 **`frontend/src/app/features/settings/pos-integration-page.ts`** — 339 سطر

```ts
import { DatePipe } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import { errorMessage } from '../../core/http/error-message';
import { PosIntegration, PosIntegrationApi, PosKey, PosSyncLog, PosSyncOutcome } from '../../core/settings/pos-integration';
import { NotifyService } from '../../core/ui/notify.service';
import { SubNav } from '../shared/sub-nav';
import { settingsTabs } from './settings-tabs';

type LogFilter = 'all' | 'problems' | 'reports';

const outcomeLabels: Record<PosSyncOutcome, { en: string; ar: string; tone: string }> = {
  Recorded: { en: 'Recorded', ar: 'سُجل', tone: 'ok' },
  Updated: { en: 'Updated', ar: 'تم التحديث', tone: 'info' },
  Unchanged: { en: 'Sent again', ar: 'مكرر', tone: 'faint' },
  Refused: { en: 'Refused', ar: 'مرفوض', tone: 'bad' },
  Unauthorized: { en: 'Wrong key', ar: 'مفتاح خاطئ', tone: 'bad' },
  Failed: { en: 'Failed', ar: 'فشل', tone: 'bad' },
  Served: { en: 'Read', ar: 'قراءة', tone: 'teal' },
};

// Settings → POS Integration (ربط نقطة البيع), a manager's. The key the restaurant's POS proves
// itself by: made here and pasted into the POS (Settings → Integrations → Costing), shown in full
// only when it is made, kept as its hash; made again, the old one stops working. And the log of
// every call the POS made: each Z report recorded, updated, sent again or refused (and why), the
// menu read, the link tested, a wrong key.
@Component({
  selector: 'app-pos-integration-page',
  imports: [DatePipe, MatButtonModule, MatIconModule, MatProgressBarModule, MatTooltipModule, SubNav],
  template: `
    <header class="head">
      <h1>POS integration <span class="inline-ar">ربط نقطة البيع</span></h1>
    </header>
    <app-sub-nav label="Settings" [tabs]="tabs" />

    <p class="note">
      <span class="note-ar" lang="ar" dir="rtl">نقطة البيع تسحب المنيو من هنا وترسل تقرير Z لكل وردية: يُسجل كملخص مبيعات اليوم (يخصم الخامات حسب الوصفات، والملغي بعد التحضير كهالك) وكإيراد اليوم في الخزنة.</span>
      The restaurant's POS reads the menu from here and sends each shift's Z report: it becomes the day's sales summary (the stock taken by the
      recipes, what was voided after the kitchen taken as waste) and the day's takings in the safe. A report sent again changes nothing; sent
      corrected, it replaces what it made. A day whose sales or takings were entered by hand is left alone, and the report refused.
    </p>

    <section class="card" aria-labelledby="key-title">
      <h2 id="key-title"><mat-icon>key</mat-icon> Integration API key <span class="inline-ar">مفتاح الربط</span></h2>
      @if (state(); as s) {
        @if (made(); as key) {
          <div class="made" role="status">
            <p><strong>Copy this key now:</strong> it is shown this once. Paste it into the POS: Settings → Integrations → Costing → API key.
              <span class="inline-ar">انسخ المفتاح الآن، لن يظهر مرة أخرى.</span></p>
            <div class="key-row">
              <code class="key" data-testid="new-key">{{ key.key }}</code>
              <button mat-flat-button (click)="copy(key.key)"><mat-icon>content_copy</mat-icon> {{ copied() ? 'Copied' : 'Copy' }}</button>
            </div>
          </div>
        }
        @if (s.hasKey) {
          <dl class="facts">
            <dt>Key</dt><dd><code>{{ s.keyHint }}</code></dd>
            <dt>Made</dt><dd>{{ s.keyCreatedAtUtc | date: 'd MMM y, HH:mm' }} · {{ s.keyCreatedBy }}</dd>
          </dl>
        } @else {
          <p class="muted">No key yet: the POS cannot connect until one is made. · لا يوجد مفتاح بعد.</p>
        }
        <div class="actions">
          <button mat-flat-button (click)="newKey()" [disabled]="busy()">
            <mat-icon>{{ s.hasKey ? 'autorenew' : 'add' }}</mat-icon> {{ s.hasKey ? 'Regenerate key · مفتاح جديد' : 'Generate key · إنشاء مفتاح' }}
          </button>
        </div>
      }

      <h3>What the POS calls <span class="inline-ar">عناوين الربط</span></h3>
      <p class="muted">The POS's Costing URL is <code>{{ origin }}</code>; every call sends the key in <code>X-API-Key</code>.</p>
      <ul class="endpoints">
        <li><code>GET /api/integrations/pos/ping</code> the link test</li>
        <li><code>GET /api/integrations/pos/menu</code> the menu: categories, items, sizes (6101-17), prices, codes</li>
        <li><code>POST /api/integrations/pos/z-report</code> a shift's Z report</li>
        <li><code>POST /api/integrations/pos/events</code> the POS's own events (day.closed)</li>
      </ul>
    </section>

    <section class="card" aria-labelledby="log-title">
      <div class="log-head">
        <h2 id="log-title"><mat-icon>sync</mat-icon> Sync log <span class="inline-ar">سجل المزامنة</span></h2>
        <span class="spacer"></span>
        <div class="pills" role="tablist" aria-label="Show">
          @for (f of filters; track f.key) {
            <button type="button" role="tab" class="pill" [class.on]="filter() === f.key" [attr.aria-selected]="filter() === f.key" (click)="filter.set(f.key)">
              {{ f.en }} <span class="count">{{ count(f.key) }}</span>
            </button>
          }
        </div>
        <button mat-icon-button (click)="load()" aria-label="Refresh the log" matTooltip="Refresh"><mat-icon>refresh</mat-icon></button>
      </div>
      @if (loading()) {
        <mat-progress-bar mode="indeterminate" />
      }
      <div class="table-wrap">
        <table class="grid">
          <thead>
            <tr><th>When<span class="ar">الوقت</span></th><th>Call<span class="ar">الطلب</span></th><th>Outcome<span class="ar">النتيجة</span></th>
              <th>Day<span class="ar">اليوم</span></th><th>What happened<span class="ar">التفاصيل</span></th></tr>
          </thead>
          <tbody>
            @for (l of shown(); track l.id) {
              <tr [class.problem]="isProblem(l)">
                <td class="when">{{ l.atUtc | date: 'd MMM, HH:mm:ss' }}</td>
                <td><code>{{ l.endpoint }}</code></td>
                <td><span class="tag" [class]="labels[l.outcome].tone">{{ labels[l.outcome].en }}<span class="ar">{{ labels[l.outcome].ar }}</span></span></td>
                <td>{{ l.businessDate ?? '' }}</td>
                <td class="message">{{ l.message }}</td>
              </tr>
            } @empty {
              <tr><td colspan="5" class="muted">Nothing yet: the POS has not called. · لا توجد عمليات بعد.</td></tr>
            }
          </tbody>
        </table>
      </div>
    </section>
  `,
  styleUrl: '../shared/pages.scss',
  styles: `
    .head h1 {
      margin: 0 0 8px;
      font: var(--mat-sys-headline-small);
    }
    .card {
      margin: 0 0 16px;
      padding: 16px 20px;
      border-radius: 16px;
      border: 1px solid var(--app-line);
      background: var(--mat-sys-surface-container-lowest);
      box-shadow: var(--app-card-shadow);
    }
    h2 {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0 0 12px;
      font: var(--mat-sys-title-medium);
    }
    h3 {
      margin: 20px 0 6px;
      font: var(--mat-sys-title-small);
    }
    .muted {
      color: var(--mat-sys-on-surface-variant);
    }
    .made {
      margin-bottom: 12px;
      padding: 12px 14px;
      border-radius: 12px;
      background: var(--tag-warn-bg, #fff3d6);
      color: var(--tag-warn-fg, #8a5300);

      p {
        margin: 0 0 8px;
      }
    }
    .key-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
    .key {
      flex: 1;
      min-width: 0;
      padding: 8px 10px;
      border-radius: 8px;
      background: var(--mat-sys-surface-container-lowest);
      color: var(--mat-sys-on-surface);
      overflow-wrap: anywhere;
      user-select: all;
    }
    .facts {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 4px 16px;
      margin: 0 0 12px;

      dt {
        color: var(--mat-sys-on-surface-variant);
      }
      dd {
        margin: 0;
      }
    }
    .endpoints {
      margin: 0;
      padding-left: 18px;
      line-height: 1.8;
    }
    .log-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;

      h2 {
        margin: 0;
      }
    }
    .pills {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .pill {
      height: 32px;
      padding: 0 12px;
      border: 1px solid var(--app-line-strong);
      border-radius: 999px;
      background: transparent;
      color: inherit;
      font: var(--mat-sys-label-large);
      cursor: pointer;

      &.on {
        background: var(--mat-sys-primary);
        border-color: var(--mat-sys-primary);
        color: var(--mat-sys-on-primary);
      }
      .count {
        margin-left: 4px;
        opacity: 0.8;
      }
    }
    .table-wrap {
      margin-top: 10px;
    }
    td.when {
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    td.message {
      max-width: 640px;
      overflow-wrap: anywhere;
    }
    tr.problem td.message {
      color: var(--tag-bad-fg, #b3261e);
    }
    .tag .ar {
      display: inline;
      margin-left: 4px;
    }
  `,
})
export class PosIntegrationPage implements OnInit, OnDestroy {
  private readonly api = inject(PosIntegrationApi);
  private readonly notify = inject(NotifyService);

  protected readonly tabs = settingsTabs;
  protected readonly labels = outcomeLabels;
  protected readonly origin = typeof location === 'undefined' ? '' : location.origin;
  protected readonly filters: { key: LogFilter; en: string }[] = [
    { key: 'all', en: 'All' },
    { key: 'reports', en: 'Z reports' },
    { key: 'problems', en: 'Problems' },
  ];

  protected readonly state = signal<PosIntegration | null>(null);
  protected readonly made = signal<PosKey | null>(null);
  protected readonly copied = signal(false);
  protected readonly busy = signal(false);
  protected readonly loading = signal(false);
  protected readonly filter = signal<LogFilter>('all');

  protected readonly shown = computed(() => (this.state()?.logs ?? []).filter((l) => this.matches(l, this.filter())));

  // The log comes in as the POS calls: looked at again every 20 seconds while the page is open.
  private readonly timer = setInterval(() => void this.load(false), 20_000);

  ngOnInit(): void {
    void this.load();
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  protected count(filter: LogFilter): number {
    return (this.state()?.logs ?? []).filter((l) => this.matches(l, filter)).length;
  }

  protected isProblem(l: PosSyncLog): boolean {
    return l.outcome === 'Refused' || l.outcome === 'Unauthorized' || l.outcome === 'Failed';
  }

  protected async newKey(): Promise<void> {
    if (this.state()?.hasKey && !confirm('Make a new key? The POS stops connecting until the new key is pasted into it. · سيتوقف المفتاح الحالي.')) {
      return;
    }
    this.busy.set(true);
    try {
      this.made.set(await firstValueFrom(this.api.newKey()));
      this.copied.set(false);
      await this.load();
    } catch (error) {
      this.notify.error(error, errorMessage(error, 'The key could not be made.'));
    } finally {
      this.busy.set(false);
    }
  }

  protected async copy(key: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(key);
      this.copied.set(true);
    } catch {
      this.notify.error(null, 'Copy it by hand: select the key and copy.');
    }
  }

  protected async load(showProgress = true): Promise<void> {
    if (showProgress) this.loading.set(true);
    try {
      this.state.set(await firstValueFrom(this.api.get()));
    } catch (error) {
      if (showProgress) this.notify.error(error, errorMessage(error, 'The POS integration could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }

  private matches(l: PosSyncLog, filter: LogFilter): boolean {
    switch (filter) {
      case 'problems':
        return this.isProblem(l);
      case 'reports':
        return l.endpoint === 'z-report' || l.endpoint === 'events';
      default:
        return true;
    }
  }
}
```


`HrIntegrationPage`: التفعيل، عنوان HR ومفتاحه (حقل كلمة مرور **يُفرَّغ بعد الحفظ**، والـ placeholder يعرض "محفوظ: ••••XXXX")، اختبار الاتصال، مفتاح هذا النظام لـ HR (مرة واحدة)، مزامنة الموظفين، ما ينتظر الإرسال مع "أعد المحاولة"، وسجل المزامنة في الاتجاهين. المؤقت يُلغى في `ngOnDestroy`، والتحديث الدوري لا يمس ما يُكتب في النموذج.

> 📄 **`frontend/src/app/core/settings/hr-integration.ts`** — 108 سطر

```ts
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

// Settings → HR Integration (/api/settings/hr-integration), a manager's: the link to the HR &
// Payroll system, both ways and only while it is switched on. HR's address and HR's key (pasted
// here, kept encrypted, never shown again); this system's key for HR (made here, shown once, kept
// as its hash); the link tested; HR's employees read; the sync log and what waits to be sent.

export type HrSyncDirection = 'Inbound' | 'Outbound';
export type HrSyncOutcome = 'Read' | 'Recorded' | 'Unchanged' | 'Updated' | 'Sent' | 'Refused' | 'Failed' | 'Unauthorized';
export type HrOutboxStatus = 'Pending' | 'Sent' | 'Failed';

export interface HrSyncLog {
  id: string;
  atUtc: string;
  direction: HrSyncDirection;
  call: string;
  outcome: HrSyncOutcome;
  message: string;
  reference: string | null;
  detail: string | null;
}

export interface HrOutboxItem {
  id: string;
  kind: string;
  action: string;
  idempotencyKey: string;
  summary: string;
  status: HrOutboxStatus;
  attempts: number;
  nextAttemptAtUtc: string;
  lastError: string | null;
  createdAtUtc: string;
  sentAtUtc: string | null;
}

export interface HrIntegration {
  enabled: boolean;
  baseUrl: string | null;
  hasHrKey: boolean;
  hrKeyHint: string | null;
  hasKey: boolean;
  keyHint: string | null;
  keyCreatedAtUtc: string | null;
  keyCreatedBy: string | null;
  employeesSyncedAtUtc: string | null;
  employeesSynced: number;
  pending: number;
  failed: number;
  logs: HrSyncLog[];
  outbox: HrOutboxItem[];
}

export interface HrKey {
  key: string;
  keyHint: string;
  createdAtUtc: string;
}

export interface HrTestResult {
  ok: boolean;
  message: string;
}

export interface HrEmployeeSync {
  received: number;
  added: number;
  updated: number;
  left: number;
  atUtc: string;
}

@Injectable({ providedIn: 'root' })
export class HrIntegrationApi {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/settings/hr-integration';

  get(): Observable<HrIntegration> {
    return this.http.get<HrIntegration>(this.base);
  }

  // hrKey: HR's key when a new one is pasted; null keeps the one kept.
  save(enabled: boolean, baseUrl: string | null, hrKey: string | null): Observable<HrIntegration> {
    return this.http.put<HrIntegration>(this.base, { enabled, baseUrl, hrKey });
  }

  newKey(): Observable<HrKey> {
    return this.http.post<HrKey>(`${this.base}/key`, {});
  }

  test(): Observable<HrTestResult> {
    return this.http.post<HrTestResult>(`${this.base}/test`, {});
  }

  syncEmployees(): Observable<HrEmployeeSync> {
    return this.http.post<HrEmployeeSync>(`${this.base}/sync-employees`, {});
  }

  sendNow(): Observable<{ sent: number }> {
    return this.http.post<{ sent: number }>(`${this.base}/outbox/send`, {});
  }

  retry(itemId: string): Observable<HrOutboxItem> {
    return this.http.post<HrOutboxItem>(`${this.base}/outbox/${itemId}/retry`, {});
  }
}
```


> 📄 **`frontend/src/app/features/settings/hr-integration-page.ts`** — 590 سطر

```ts
import { DatePipe } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import { errorMessage } from '../../core/http/error-message';
import { HrIntegration, HrIntegrationApi, HrKey, HrOutboxItem, HrSyncLog, HrSyncOutcome, HrTestResult } from '../../core/settings/hr-integration';
import { NotifyService } from '../../core/ui/notify.service';
import { SubNav } from '../shared/sub-nav';
import { settingsTabs } from './settings-tabs';

type LogFilter = 'all' | 'in' | 'out' | 'problems';

export const hrOutcomeLabels: Record<HrSyncOutcome, { en: string; ar: string; tone: string }> = {
  Read: { en: 'Read', ar: 'قراءة', tone: 'teal' },
  Recorded: { en: 'Recorded', ar: 'سُجل', tone: 'ok' },
  Updated: { en: 'Updated', ar: 'تم التحديث', tone: 'info' },
  Unchanged: { en: 'Sent again', ar: 'مكرر', tone: 'faint' },
  Sent: { en: 'Sent', ar: 'أُرسل', tone: 'ok' },
  Refused: { en: 'Refused', ar: 'مرفوض', tone: 'bad' },
  Failed: { en: 'Failed', ar: 'فشل', tone: 'bad' },
  Unauthorized: { en: 'Wrong key', ar: 'مفتاح خاطئ', tone: 'bad' },
};

const callLabels: Record<string, string> = {
  ping: 'Link test',
  employees: 'Employees',
  'employee-advance': 'Advance',
  'employee-deduction': 'Deduction',
  'payroll-settled': 'Payroll paid',
  'payroll-run': 'Payroll run',
};

// Settings → HR Integration (ربط الموارد البشرية), a manager's. The link to the HR & Payroll
// system, off until it is switched on here, and then both ways: HR's employees read into the staff,
// each advance paid out of the safe (with its signed receipt) and each deduction sent to HR, the
// month's payroll HR approves taken in (its labor cost, its net cash to pay), and HR told when it
// is paid. Off, the staff are kept here and nothing is sent or heard.
@Component({
  selector: 'app-hr-integration-page',
  imports: [
    DatePipe, FormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressBarModule, MatSlideToggleModule, MatTooltipModule,
    SubNav,
  ],
  template: `
    <header class="head">
      <h1>HR integration <span class="inline-ar">ربط الموارد البشرية</span></h1>
    </header>
    <app-sub-nav label="Settings" [tabs]="tabs" />

    <p class="note">
      <span class="note-ar" lang="ar" dir="rtl">عند التفعيل: يُقرأ الموظفون من نظام الموارد البشرية، وتُرسل كل سلفة تُصرف من الخزنة (مع صورة الإيصال) وكل خصم (عجز خزنة / خصم على الموظف) إلى مسير الرواتب، ويصل المسير المعتمد هنا كتكلفة عمالة وصافي نقدي للصرف من الخزنة. عند الإيقاف يعمل النظام وحده تماماً.</span>
      Switched on, the staff come from HR; each advance paid out of the safe (with its signed receipt) and each deduction (a till shortage, a staff
      charge) goes onto their pay there; and the payroll HR approves comes here as the month's labor cost and its net cash, to pay out of the safe,
      HR told once it is paid. Switched off, this system works on its own: the staff are kept here and nothing is sent or heard.
    </p>

    @if (state(); as s) {
      <section class="card" aria-labelledby="link-title">
        <div class="title-row">
          <h2 id="link-title"><mat-icon>hub</mat-icon> The link <span class="inline-ar">الربط</span></h2>
          <span class="status" [class.on]="s.enabled" role="status">
            <span class="dot"></span>{{ s.enabled ? 'Linked · مفعّل' : 'Not linked · غير مفعّل' }}
          </span>
        </div>
        <form class="link-form" (ngSubmit)="save()" aria-label="HR link">
          <mat-slide-toggle name="enabled" [(ngModel)]="enabled" [disabled]="busy()">Enabled · تفعيل الربط</mat-slide-toggle>
          <mat-form-field subscriptSizing="dynamic">
            <mat-label>HR's address (base URL) · عنوان نظام الموارد البشرية</mat-label>
            <input matInput name="baseUrl" [(ngModel)]="baseUrl" placeholder="https://hr.example.com" inputmode="url" autocomplete="off" />
          </mat-form-field>
          <mat-form-field subscriptSizing="dynamic">
            <mat-label>HR's key (X-API-Key) · مفتاح الموارد البشرية</mat-label>
            <input matInput name="hrKey" [(ngModel)]="hrKey" type="password" autocomplete="off"
              [placeholder]="s.hasHrKey ? 'Kept: ' + s.hrKeyHint + ' (paste a new one to replace it)' : 'Paste the key made on HR'" />
            <mat-hint>Made on HR: Settings → Costing Integration → Generate key. Kept encrypted, never shown again.</mat-hint>
          </mat-form-field>
          <div class="actions">
            <button mat-stroked-button type="button" (click)="test()" [disabled]="busy() || !s.baseUrl || !s.hasHrKey">
              <mat-icon>network_check</mat-icon> Test connection · اختبار الاتصال
            </button>
            <button mat-flat-button type="submit" [disabled]="busy()"><mat-icon>save</mat-icon> Save · حفظ</button>
          </div>
        </form>
        @if (tested(); as t) {
          <p class="result" [class.bad]="!t.ok" role="status"><mat-icon>{{ t.ok ? 'check_circle' : 'error' }}</mat-icon> {{ t.message }}</p>
        }
      </section>

      <section class="card" aria-labelledby="key-title">
        <h2 id="key-title"><mat-icon>key</mat-icon> This system's key for HR <span class="inline-ar">مفتاح الربط لنظام الموارد البشرية</span></h2>
        <p class="muted">HR sends it in <code>X-API-Key</code> when it sends a payroll here. Paste it on HR: Settings → Costing Integration → Costing's key.</p>
        @if (made(); as key) {
          <div class="made" role="status">
            <p><strong>Copy this key now:</strong> it is shown this once. <span class="inline-ar">انسخ المفتاح الآن، لن يظهر مرة أخرى.</span></p>
            <div class="key-row">
              <code class="key" data-testid="new-key">{{ key.key }}</code>
              <button mat-flat-button (click)="copy(key.key)"><mat-icon>content_copy</mat-icon> {{ copied() ? 'Copied' : 'Copy' }}</button>
            </div>
          </div>
        }
        @if (s.hasKey) {
          <dl class="facts">
            <dt>Key</dt><dd><code>{{ s.keyHint }}</code></dd>
            <dt>Made</dt><dd>{{ s.keyCreatedAtUtc | date: 'd MMM y, HH:mm' }} · {{ s.keyCreatedBy }}</dd>
          </dl>
        } @else {
          <p class="muted">No key yet: HR cannot send its payroll here until one is made. · لا يوجد مفتاح بعد.</p>
        }
        <button mat-stroked-button (click)="newKey()" [disabled]="busy()">
          <mat-icon>{{ s.hasKey ? 'autorenew' : 'add' }}</mat-icon> {{ s.hasKey ? 'Regenerate key · مفتاح جديد' : 'Generate key · إنشاء مفتاح' }}
        </button>
        <h3>What HR calls here <span class="inline-ar">عناوين الربط</span></h3>
        <ul class="endpoints">
          <li><code>GET {{ origin }}/api/integrations/hr/ping</code> the link test</li>
          <li><code>POST {{ origin }}/api/integrations/hr/payroll-run</code> a month's payroll approved on HR</li>
        </ul>
      </section>

      <section class="card" aria-labelledby="staff-title">
        <h2 id="staff-title"><mat-icon>badge</mat-icon> Employees from HR <span class="inline-ar">الموظفون من الموارد البشرية</span></h2>
        <p class="muted">
          @if (s.employeesSyncedAtUtc) {
            {{ s.employeesSynced }} employees, read {{ s.employeesSyncedAtUtc | date: 'd MMM y, HH:mm' }}. Read again every 6 hours while linked.
          } @else {
            Not read yet. · لم تتم المزامنة بعد.
          }
        </p>
        <button mat-stroked-button (click)="sync()" [disabled]="busy() || !s.enabled"><mat-icon>sync</mat-icon> Sync employees now · مزامنة الموظفين</button>
        @if (synced(); as r) {
          <p class="result" role="status"><mat-icon>check_circle</mat-icon> {{ r }}</p>
        }
      </section>

      <section class="card" aria-labelledby="outbox-title">
        <div class="log-head">
          <h2 id="outbox-title"><mat-icon>outbox</mat-icon> Waiting to be sent <span class="inline-ar">في انتظار الإرسال</span></h2>
          <span class="chip">{{ s.pending }} waiting</span>
          @if (s.failed) {
            <span class="chip bad">{{ s.failed }} refused</span>
          }
          <span class="spacer"></span>
          <button mat-stroked-button (click)="sendNow()" [disabled]="busy() || !s.enabled || !s.pending"><mat-icon>send</mat-icon> Send now · إرسال الآن</button>
        </div>
        <div class="table-wrap">
          <table class="grid" aria-label="Waiting to be sent">
            <thead>
              <tr><th>Made<span class="ar">التاريخ</span></th><th>What<span class="ar">البيان</span></th><th>Status<span class="ar">الحالة</span></th>
                <th>Tries<span class="ar">المحاولات</span></th><th><span class="visually-hidden">Actions</span></th></tr>
            </thead>
            <tbody>
              @for (i of s.outbox; track i.id) {
                <tr>
                  <td class="when">{{ i.createdAtUtc | date: 'd MMM, HH:mm' }}</td>
                  <td class="message">{{ i.summary }}
                    @if (i.lastError && i.status !== 'Sent') {
                      <div class="why">{{ i.lastError }}</div>
                    }
                  </td>
                  <td><span class="tag" [class]="outboxTone(i)">{{ i.status === 'Pending' ? 'Waiting' : i.status === 'Sent' ? 'Sent' : 'Refused' }}</span></td>
                  <td class="num">{{ i.attempts }}</td>
                  <td class="num">
                    @if (i.status === 'Failed') {
                      <button mat-button (click)="retry(i)" [disabled]="busy()"><mat-icon>replay</mat-icon> Try again</button>
                    }
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="5" class="muted">Nothing to send. · لا يوجد ما يُرسل.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    }

    <section class="card" aria-labelledby="log-title">
      <div class="log-head">
        <h2 id="log-title"><mat-icon>sync_alt</mat-icon> Sync log <span class="inline-ar">سجل المزامنة</span></h2>
        <span class="spacer"></span>
        <div class="pills" role="tablist" aria-label="Show">
          @for (f of filters; track f.key) {
            <button type="button" role="tab" class="pill" [class.on]="filter() === f.key" [attr.aria-selected]="filter() === f.key" (click)="filter.set(f.key)">
              {{ f.en }} <span class="count">{{ count(f.key) }}</span>
            </button>
          }
        </div>
        <button mat-icon-button (click)="load()" aria-label="Refresh the log" matTooltip="Refresh"><mat-icon>refresh</mat-icon></button>
      </div>
      @if (loading()) {
        <mat-progress-bar mode="indeterminate" />
      }
      <div class="table-wrap">
        <table class="grid" aria-label="Sync log">
          <thead>
            <tr><th>When<span class="ar">الوقت</span></th><th>Way<span class="ar">الاتجاه</span></th><th>Call<span class="ar">الطلب</span></th>
              <th>Outcome<span class="ar">النتيجة</span></th><th>What happened<span class="ar">التفاصيل</span></th></tr>
          </thead>
          <tbody>
            @for (l of shown(); track l.id) {
              <tr [class.problem]="isProblem(l)">
                <td class="when">{{ l.atUtc | date: 'd MMM, HH:mm:ss' }}</td>
                <td><mat-icon class="way" [attr.aria-label]="l.direction === 'Inbound' ? 'From HR' : 'To HR'">{{ l.direction === 'Inbound' ? 'south_west' : 'north_east' }}</mat-icon>
                  {{ l.direction === 'Inbound' ? 'From HR' : 'To HR' }}</td>
                <td>{{ callLabel(l.call) }}</td>
                <td><span class="tag" [class]="labels[l.outcome].tone">{{ labels[l.outcome].en }}<span class="ar">{{ labels[l.outcome].ar }}</span></span></td>
                <td class="message">{{ l.message }}</td>
              </tr>
            } @empty {
              <tr><td colspan="5" class="muted">Nothing yet. · لا توجد عمليات بعد.</td></tr>
            }
          </tbody>
        </table>
      </div>
    </section>
  `,
  styleUrl: '../shared/pages.scss',
  styles: `
    .head h1 {
      margin: 0 0 8px;
      font: var(--mat-sys-headline-small);
    }
    .card {
      margin: 0 0 16px;
      padding: 16px 20px;
      border-radius: 16px;
      border: 1px solid var(--app-line);
      background: var(--mat-sys-surface-container-lowest);
      box-shadow: var(--app-card-shadow);
    }
    h2 {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0 0 12px;
      font: var(--mat-sys-title-medium);
    }
    h3 {
      margin: 20px 0 6px;
      font: var(--mat-sys-title-small);
    }
    .muted {
      color: var(--mat-sys-on-surface-variant);
    }
    .title-row,
    .log-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;

      h2 {
        margin: 0;
      }
    }
    .title-row {
      justify-content: space-between;
      margin-bottom: 12px;
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
      padding: 4px 12px;
      border-radius: 999px;
      background: var(--mat-sys-surface-container-high);
      font: var(--mat-sys-label-large);

      .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--mat-sys-outline);
      }
      &.on {
        background: var(--tag-ok-bg, #dff5e6);
        color: var(--tag-ok-fg, #1b6b3a);

        .dot {
          background: currentColor;
        }
      }
    }
    .link-form {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 12px 16px;
      align-items: center;

      mat-slide-toggle,
      .actions {
        grid-column: 1 / -1;
      }
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 8px;
    }
    .result {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 12px 0 0;
      color: var(--tag-ok-fg, #1b6b3a);

      &.bad {
        color: var(--tag-bad-fg, #b3261e);
      }
    }
    .made {
      margin-bottom: 12px;
      padding: 12px 14px;
      border-radius: 12px;
      background: var(--tag-warn-bg, #fff3d6);
      color: var(--tag-warn-fg, #8a5300);

      p {
        margin: 0 0 8px;
      }
    }
    .key-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
    .key {
      flex: 1;
      min-width: 0;
      padding: 8px 10px;
      border-radius: 8px;
      background: var(--mat-sys-surface-container-lowest);
      color: var(--mat-sys-on-surface);
      overflow-wrap: anywhere;
      user-select: all;
    }
    .facts {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 4px 16px;
      margin: 0 0 12px;

      dt {
        color: var(--mat-sys-on-surface-variant);
      }
      dd {
        margin: 0;
      }
    }
    .endpoints {
      margin: 0;
      padding-left: 18px;
      line-height: 1.8;
      overflow-wrap: anywhere;
    }
    .chip {
      padding: 2px 10px;
      border-radius: 999px;
      background: var(--mat-sys-surface-container-high);
      font: var(--mat-sys-label-medium);

      &.bad {
        background: var(--tag-bad-bg, #fde7e7);
        color: var(--tag-bad-fg, #b3261e);
      }
    }
    .pills {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .pill {
      height: 32px;
      padding: 0 12px;
      border: 1px solid var(--app-line-strong);
      border-radius: 999px;
      background: transparent;
      color: inherit;
      font: var(--mat-sys-label-large);
      cursor: pointer;

      &.on {
        background: var(--mat-sys-primary);
        border-color: var(--mat-sys-primary);
        color: var(--mat-sys-on-primary);
      }
      .count {
        margin-left: 4px;
        opacity: 0.8;
      }
    }
    .table-wrap {
      margin-top: 10px;
    }
    td.when {
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    td.message {
      max-width: 640px;
      overflow-wrap: anywhere;
    }
    .why,
    tr.problem td.message {
      color: var(--tag-bad-fg, #b3261e);
    }
    .way {
      width: 16px;
      height: 16px;
      font-size: 16px;
      vertical-align: -3px;
    }
    .tag .ar {
      display: inline;
      margin-left: 4px;
    }
  `,
})
export class HrIntegrationPage implements OnInit, OnDestroy {
  private readonly api = inject(HrIntegrationApi);
  private readonly notify = inject(NotifyService);

  protected readonly tabs = settingsTabs;
  protected readonly labels = hrOutcomeLabels;
  protected readonly origin = typeof location === 'undefined' ? '' : location.origin;
  protected readonly filters: { key: LogFilter; en: string }[] = [
    { key: 'all', en: 'All' },
    { key: 'in', en: 'From HR' },
    { key: 'out', en: 'To HR' },
    { key: 'problems', en: 'Problems' },
  ];

  protected readonly state = signal<HrIntegration | null>(null);
  protected readonly made = signal<HrKey | null>(null);
  protected readonly tested = signal<HrTestResult | null>(null);
  protected readonly synced = signal<string | null>(null);
  protected readonly copied = signal(false);
  protected readonly busy = signal(false);
  protected readonly loading = signal(false);
  protected readonly filter = signal<LogFilter>('all');

  protected enabled = false;
  protected baseUrl = '';
  protected hrKey = '';

  protected readonly shown = computed(() => (this.state()?.logs ?? []).filter((l) => this.matches(l, this.filter())));

  // The log comes in as the two systems call each other: looked at again every 20 seconds.
  private readonly timer = setInterval(() => void this.load(false), 20_000);

  ngOnInit(): void {
    void this.load(true, true);
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  protected callLabel(call: string): string {
    return callLabels[call] ?? call;
  }

  protected count(filter: LogFilter): number {
    return (this.state()?.logs ?? []).filter((l) => this.matches(l, filter)).length;
  }

  protected isProblem(l: HrSyncLog): boolean {
    return l.outcome === 'Refused' || l.outcome === 'Unauthorized' || l.outcome === 'Failed';
  }

  protected outboxTone(i: HrOutboxItem): string {
    return i.status === 'Sent' ? 'ok' : i.status === 'Failed' ? 'bad' : 'info';
  }

  protected async save(): Promise<void> {
    await this.run(async () => {
      const saved = await firstValueFrom(this.api.save(this.enabled, this.baseUrl.trim() || null, this.hrKey.trim() || null));
      this.fill(saved);
      this.notify.info(saved.enabled ? 'The HR link is on. · تم تفعيل الربط.' : 'The HR link is off: this system works on its own. · تم إيقاف الربط.');
    }, 'The link could not be saved.');
  }

  protected async test(): Promise<void> {
    await this.run(async () => {
      this.tested.set(await firstValueFrom(this.api.test()));
      await this.load(false);
    }, 'The link could not be tested.');
  }

  protected async sync(): Promise<void> {
    await this.run(async () => {
      const r = await firstValueFrom(this.api.syncEmployees());
      this.synced.set(`${r.received} read from HR: ${r.added} added, ${r.updated} changed, ${r.left} marked as left.`);
      await this.load(false);
    }, 'HR’s employees could not be read.');
  }

  protected async sendNow(): Promise<void> {
    await this.run(async () => {
      const { sent } = await firstValueFrom(this.api.sendNow());
      this.notify.info(sent ? `${sent} sent to HR.` : 'Nothing could be sent now: see the sync log.');
      await this.load(false);
    }, 'It could not be sent now.');
  }

  protected async retry(item: HrOutboxItem): Promise<void> {
    await this.run(async () => {
      await firstValueFrom(this.api.retry(item.id));
      await firstValueFrom(this.api.sendNow());
      await this.load(false);
    }, 'It could not be tried again.');
  }

  protected async newKey(): Promise<void> {
    if (this.state()?.hasKey && !confirm('Make a new key? HR stops sending its payroll here until the new key is pasted on HR. · سيتوقف المفتاح الحالي.')) {
      return;
    }
    await this.run(async () => {
      this.made.set(await firstValueFrom(this.api.newKey()));
      this.copied.set(false);
      await this.load(false);
    }, 'The key could not be made.');
  }

  protected async copy(key: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(key);
      this.copied.set(true);
    } catch {
      this.notify.error(null, 'Copy it by hand: select the key and copy.');
    }
  }

  protected async load(showProgress = true, fillForm = false): Promise<void> {
    if (showProgress) this.loading.set(true);
    try {
      const state = await firstValueFrom(this.api.get());
      if (fillForm) {
        this.fill(state);
      } else {
        this.state.set(state);
      }
    } catch (error) {
      if (showProgress) this.notify.error(error, errorMessage(error, 'The HR integration could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }

  private fill(state: HrIntegration): void {
    this.state.set(state);
    this.enabled = state.enabled;
    this.baseUrl = state.baseUrl ?? '';
    this.hrKey = '';
  }

  private async run(work: () => Promise<void>, failed: string): Promise<void> {
    this.busy.set(true);
    try {
      await work();
    } catch (error) {
      this.notify.error(error, errorMessage(error, failed));
    } finally {
      this.busy.set(false);
    }
  }

  private matches(l: HrSyncLog, filter: LogFilter): boolean {
    switch (filter) {
      case 'problems':
        return this.isProblem(l);
      case 'in':
        return l.direction === 'Inbound';
      case 'out':
        return l.direction === 'Outbound';
      default:
        return true;
    }
  }
}
```


---

## 5. الاختبارات

### 5.1 الهرم

| المشروع | ماذا يختبر | يحتاج قاعدة بيانات؟ |
| --- | --- | --- |
| `Costing.Domain.Tests` | المعادلات والقواعد (المتوسط، الخصم، الضريبة، تكلفة المصنعات، التفجير…) | لا |
| `Costing.Application.Tests` | حالات الاستخدام مع MediatR الحقيقي و Fakes في الذاكرة | لا |
| `Costing.Infrastructure.Tests` | EF الحقيقي، التقارير، الإكسيل، الربط | نعم: `COSTING_TEST_DB` |
| `Costing.Api.Tests` | HTTP كامل عبر `WebApplicationFactory<Program>` | نعم |
| Frontend (Vitest) | كل شاشة وخدمة مع API مزيف | لا |

```bash
export COSTING_TEST_DB="Host=localhost;Port=5436;Username=costing;Password=costing-dev"
dotnet test --solution Costing.slnx                       # 0 failed, 0 skipped
dotnet test --project backend/tests/Costing.Domain.Tests -- --filter-class "*RecipeCostsTests"
cd frontend && npx ng test --watch=false
```

⚠️ **بدون `COSTING_TEST_DB` تُتخطى اختبارات قاعدة البيانات وتبدو ناجحة.** اقرأ سطر `skipped:` دائمًا.

### 5.2 مشاريع الاختبار

> 📄 **`backend/tests/Costing.Domain.Tests/Costing.Domain.Tests.csproj`** — 25 سطر

```xml
<Project Sdk="Microsoft.NET.Sdk">

  <!-- The domain's rules, on their own. Runs on Microsoft.Testing.Platform (the repository's global.json opts dotnet
       test in); the project is an executable too, so `dotnet run` runs the tests. -->
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <OutputType>Exe</OutputType>
    <IsPackable>false</IsPackable>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="xunit.v3" Version="4.0.1" />
  </ItemGroup>

  <ItemGroup>
    <ProjectReference Include="..\..\src\Costing.Domain\Costing.Domain.csproj" />
  </ItemGroup>

  <ItemGroup>
    <Using Include="Xunit" />
  </ItemGroup>

</Project>
```


> 📄 **`backend/tests/Costing.Application.Tests/Costing.Application.Tests.csproj`** — 29 سطر

```xml
<Project Sdk="Microsoft.NET.Sdk">

  <!-- The use cases, wired as the app wires them, against in-memory fakes. Runs on Microsoft.Testing.Platform (the repository's global.json opts dotnet
       test in); the project is an executable too, so `dotnet run` runs the tests. -->
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <OutputType>Exe</OutputType>
    <IsPackable>false</IsPackable>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.Extensions.DependencyInjection" Version="10.0.11" />
  </ItemGroup>

  <ItemGroup>
    <PackageReference Include="xunit.v3" Version="4.0.1" />
  </ItemGroup>

  <ItemGroup>
    <ProjectReference Include="..\..\src\Costing.Application\Costing.Application.csproj" />
  </ItemGroup>

  <ItemGroup>
    <Using Include="Xunit" />
  </ItemGroup>

</Project>
```


> 📄 **`backend/tests/Costing.Infrastructure.Tests/Costing.Infrastructure.Tests.csproj`** — 30 سطر

```xml
<Project Sdk="Microsoft.NET.Sdk">

  <!-- The costs and the treasury against a real PostgreSQL (COSTING_TEST_DB, skipped when unset), the business calendar and the
       import sheets. Runs on Microsoft.Testing.Platform (the repository's global.json opts dotnet
       test in); the project is an executable too, so `dotnet run` runs the tests. -->
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <OutputType>Exe</OutputType>
    <IsPackable>false</IsPackable>
  </PropertyGroup>

  <ItemGroup>
    <FrameworkReference Include="Microsoft.AspNetCore.App" />
  </ItemGroup>

  <ItemGroup>
    <PackageReference Include="xunit.v3" Version="4.0.1" />
  </ItemGroup>

  <ItemGroup>
    <ProjectReference Include="..\..\src\Costing.Infrastructure\Costing.Infrastructure.csproj" />
  </ItemGroup>

  <ItemGroup>
    <Using Include="Xunit" />
  </ItemGroup>

</Project>
```


> 📄 **`backend/tests/Costing.Api.Tests/Costing.Api.Tests.csproj`** — 26 سطر

```xml
<Project Sdk="Microsoft.NET.Sdk">

  <!-- The API over HTTP, hosted in process (WebApplicationFactory) with everything real behind
       it: PostgreSQL (COSTING_TEST_DB, skipped when unset). -->
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <OutputType>Exe</OutputType>
    <IsPackable>false</IsPackable>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="xunit.v3" Version="4.0.1" />
    <PackageReference Include="Microsoft.AspNetCore.Mvc.Testing" Version="10.0.12" />
  </ItemGroup>

  <ItemGroup>
    <ProjectReference Include="..\..\src\Costing.Api\Costing.Api.csproj" />
  </ItemGroup>

  <ItemGroup>
    <Using Include="Xunit" />
  </ItemGroup>

</Project>
```


### 5.3 اختبارات المحاسبة في الدومين

تكلفة المصنعات بوصفاتها (المتداخلة، الدوران، الأسعار الناقصة)، والتفجير، وفاتورة الشراء (الخصم بالقرش)، والخزنة (فصل الضريبة):

> 📄 **`backend/tests/Costing.Domain.Tests/RecipeCostsTests.cs`** — 100 سطر

```csharp
using Costing.Domain.Production;
using Costing.Domain.RawMaterials;

namespace Costing.Domain.Tests;

// What a recipe is costed from: each material's average cost, and a prep item never made yet by its
// own batch recipe today, its ingredients priced the same way.
public class RecipeCostsTests
{
    // Bought by the kg, at that price a kg.
    private static RawMaterial Bought(string name, decimal? perKg, UnitOfMeasure unit = UnitOfMeasure.Gram)
    {
        var material = new RawMaterial(name, unit);
        if (perKg is { } price)
            material.SetCost(price);
        return material;
    }

    private static (RawMaterial Item, PrepRecipe Recipe) Prep(string name, decimal batch, params (RawMaterial Material, decimal Quantity, decimal? Yield)[] lines)
    {
        var item = new RawMaterial(name, UnitOfMeasure.Gram, kind: MaterialKind.Prep);
        var recipe = new PrepRecipe(item, batch);
        recipe.Replace(lines);
        return (item, recipe);
    }

    private static RecipeCosts Costs(IEnumerable<RawMaterial> materials, params PrepRecipe[] recipes) =>
        new(materials.ToDictionary(m => m.Id), recipes);

    [Fact]
    public void A_bought_material_and_a_prep_item_made_already_are_at_their_average_cost()
    {
        var flour = Bought("Flour", 30);
        var (dough, recipe) = Prep("Dough", 1000, (flour, 600, null));
        dough.ReceiveProduction(1000, Guid.NewGuid(), 25);

        var costs = Costs([flour, dough], recipe);

        Assert.Equal(((decimal?)0.03m, false), (costs.Of(flour.Id).PerUnit, costs.Of(flour.Id).ByRecipe));
        Assert.Empty(costs.Of(flour.Id).Missing);
        Assert.Equal(((decimal?)0.025m, false), (costs.Of(dough.Id).PerUnit, costs.Of(dough.Id).ByRecipe));
        Assert.Empty(costs.Of(dough.Id).Missing);
    }

    [Fact]
    public void A_prep_item_never_made_or_made_at_nothing_is_costed_by_its_recipe_its_yields_lost()
    {
        var flour = Bought("Flour", 30);
        var butter = Bought("Butter", 200);
        // 2 kg a batch: 200 g of flour, and 200 g of butter at a 80% yield (250 g as bought).
        var (sauce, recipe) = Prep("White sauce", 2000, (flour, 200, null), (butter, 200, 80));

        var cost = Costs([flour, butter, sauce], recipe).Of(sauce.Id);
        Assert.Equal(((decimal?)((6m + 50m) / 2000), true), (cost.PerUnit, cost.ByRecipe));
        Assert.Empty(cost.Missing);

        // A batch costing nothing is no cost to go by either.
        sauce.ReceiveProduction(2000, Guid.NewGuid(), 0);
        Assert.Equal(0m, sauce.AverageCost);
        Assert.True(Costs([flour, butter, sauce], recipe).Of(sauce.Id).ByRecipe);
    }

    [Fact]
    public void One_made_with_another_never_made_is_costed_through_both_and_what_has_no_price_is_named_through_them()
    {
        var flour = Bought("Flour", 30);
        var cream = Bought("Cream", null, UnitOfMeasure.Millilitre);
        var (sauce, sauceRecipe) = Prep("White sauce", 1000, (flour, 500, null));
        var (alfredo, alfredoRecipe) = Prep("Alfredo base", 1100, (sauce, 1000, null), (cream, 100, null));
        var (bake, bakeRecipe) = Prep("Pasta bake", 500, (alfredo, 550, null));

        var costs = Costs([flour, cream, sauce, alfredo, bake], sauceRecipe, alfredoRecipe, bakeRecipe);

        // The sauce 15 a kg; the base 15 for its 1.1 kg, short of the cream; the bake from it.
        Assert.Equal(0.015m, costs.Of(sauce.Id).PerUnit);
        Assert.Equal(((decimal?)(15m / 1100), true), (costs.Of(alfredo.Id).PerUnit, costs.Of(alfredo.Id).ByRecipe));
        Assert.Equal(["Alfredo base: Cream"], costs.Of(alfredo.Id).Missing);
        Assert.Equal(["Pasta bake: Alfredo base: Cream"], costs.Of(bake.Id).Missing);
        Assert.Equal(550 * (15m / 1100) / 500, costs.Of(bake.Id).PerUnit);
        var (batchCost, priced, missing) = costs.Batch(alfredoRecipe);
        Assert.Equal((15m, true), (batchCost, priced));
        Assert.Equal(["Cream"], missing);
    }

    [Fact]
    public void One_with_no_ingredient_priced_or_no_recipe_has_no_price_and_is_named()
    {
        var cream = Bought("Cream", null, UnitOfMeasure.Millilitre);
        var (sauce, recipe) = Prep("Cream sauce", 1000, (cream, 900, null));
        var plain = new RawMaterial("Stock", UnitOfMeasure.Millilitre, kind: MaterialKind.Prep);

        var costs = Costs([cream, sauce, plain], recipe);

        Assert.Equal(((decimal?)null, false), (costs.Of(sauce.Id).PerUnit, costs.Of(sauce.Id).ByRecipe));
        Assert.Equal(["Cream sauce"], costs.Of(sauce.Id).Missing);
        Assert.Equal(((decimal?)null, false), (costs.Of(plain.Id).PerUnit, costs.Of(plain.Id).ByRecipe));
        Assert.Equal(["Stock"], costs.Of(plain.Id).Missing);
        Assert.Equal(RecipeCost.None, costs.Of(Guid.NewGuid()));
    }
}
```


> 📄 **`backend/tests/Costing.Domain.Tests/MaterialExplosionTests.cs`** — 57 سطر

```csharp
using Costing.Domain.Production;
using Costing.Domain.RawMaterials;

namespace Costing.Domain.Tests;

// The bill of materials: a prep item broken into what was bought for it, as purchased, through any
// prep item inside it.
public class MaterialExplosionTests
{
    private static RawMaterial Bought(string name) => new(name, UnitOfMeasure.Gram);
    private static RawMaterial Prep(string name) => new(name, UnitOfMeasure.Gram, kind: MaterialKind.Prep);

    [Fact]
    public void A_prep_item_breaks_into_what_was_bought_its_yields_allowed_for()
    {
        var (tomatoes, garlic, flour) = (Bought("Tomatoes"), Bought("Garlic"), Bought("Flour"));
        // 1 kg of sauce: 900 g of tomatoes used at 90% (1 kg bought) and 50 g of garlic.
        var sauce = Prep("Pizza sauce");
        var sauceRecipe = new PrepRecipe(sauce, 1_000);
        sauceRecipe.Replace([(tomatoes, 900m, 90m), (garlic, 50m, null)]);
        // 2 kg of bases: 1.5 kg of flour and 500 g of the sauce.
        var bases = Prep("Pizza bases");
        var basesRecipe = new PrepRecipe(bases, 2_000);
        basesRecipe.Replace([(flour, 1_500m, null), (sauce, 500m, null)]);
        var explosion = new MaterialExplosion([sauceRecipe, basesRecipe]);

        Assert.Equal(new Dictionary<Guid, decimal> { [tomatoes.Id] = 1m, [garlic.Id] = 0.05m }, explosion.PerUnit(sauce.Id));
        // 100 g of bases: 75 g of flour, and 25 g of sauce, which is 25 g of tomatoes and 1.25 g of garlic.
        var hundred = explosion.Explode([new(bases.Id, 100m), new(flour.Id, 10m)]);
        Assert.Equal((85m, 25m, 1.25m), (hundred[flour.Id], hundred[tomatoes.Id], hundred[garlic.Id]));
        Assert.Equal(new Dictionary<Guid, decimal> { [garlic.Id] = 1m }, explosion.PerUnit(garlic.Id));

        // One level down, for making it; and the bases before the sauce they are made with.
        Assert.Equal([(flour.Id, 75m), (sauce.Id, 25m)], explosion.Ingredients(bases.Id, 100));
        Assert.Equal([bases.Id, sauce.Id], explosion.TopDown());
        Assert.True(explosion.IsMade(sauce.Id));
        Assert.False(explosion.IsMade(flour.Id));
    }

    [Fact]
    public void A_prep_item_with_no_recipe_or_made_with_itself_stays_as_itself()
    {
        var (flour, unwritten) = (Bought("Flour"), Prep("Stock, not written yet"));
        // Never saved so, but guarded against: a dough made with a starter made with the dough.
        var (dough, starter) = (Prep("Mother dough"), Prep("Starter"));
        var doughRecipe = new PrepRecipe(dough, 1_000);
        doughRecipe.Replace([(flour, 500m, null), (starter, 500m, null)]);
        var starterRecipe = new PrepRecipe(starter, 1_000);
        starterRecipe.Replace([(dough, 1_000m, null)]);
        var explosion = new MaterialExplosion([doughRecipe, starterRecipe]);

        Assert.Equal(new Dictionary<Guid, decimal> { [unwritten.Id] = 1m }, explosion.PerUnit(unwritten.Id));
        var perGram = explosion.PerUnit(dough.Id);
        Assert.Equal((0.5m, 0.5m), (perGram[flour.Id], perGram[dough.Id]));
        Assert.Equal(2, explosion.TopDown().Count);
    }
}
```


> 📄 **`backend/tests/Costing.Domain.Tests/PurchaseInvoiceTests.cs`** — 188 سطر

```csharp
using Costing.Domain.Common;
using Costing.Domain.Purchases;
using Costing.Domain.RawMaterials;
using Costing.Domain.StockMovements;

namespace Costing.Domain.Tests;

// A supplier's invoice in two steps: entered as written and kept as a draft, which moves nothing;
// then posted, which takes the stock in at the material's own units and moves the average cost.
public class PurchaseInvoiceTests
{
    private static PurchaseInvoiceLineEntry Kg(RawMaterial material, decimal kg, decimal? cost) => new(material.Id, kg, "kg", 1000, cost);

    [Fact]
    public void A_draft_keeps_the_lines_as_written_and_moves_no_stock()
    {
        var tomatoes = new RawMaterial("Tomatoes", UnitOfMeasure.Gram);
        var oil = new RawMaterial("Frying oil", UnitOfMeasure.Millilitre);
        var invoice = new PurchaseInvoice(Guid.NewGuid(), "Omar");
        var nileFarms = Guid.NewGuid();

        invoice.Record(nileFarms, " F-1001 ", new DateOnly(2026, 10, 7),
            [Kg(tomatoes, 5, 100), new PurchaseInvoiceLineEntry(oil.Id, 0.1m, "L", 1000, 9.5m)], PurchasePaymentMethod.Safe);

        Assert.Equal((PurchaseInvoiceStatus.Draft, (Guid?)nileFarms, "F-1001", 109.5m), (invoice.Status, invoice.SupplierId, invoice.SupplierInvoiceNumber, invoice.Total));
        Assert.Equal([(5m, "kg", 5000m), (0.1m, "L", 100m)], invoice.Lines.Select(l => (l.EnteredQuantity, l.UnitLabel, l.Quantity)));
        Assert.Equal((0m, (decimal?)null), (tomatoes.QuantityOnHand, tomatoes.AverageCost));
    }

    [Fact]
    public void Posting_takes_the_stock_in_and_moves_the_average_cost_once()
    {
        var tomatoes = new RawMaterial("Tomatoes", UnitOfMeasure.Gram);
        var invoice = new PurchaseInvoice(Guid.NewGuid(), "Omar");
        invoice.Record(Guid.NewGuid(), null, null, [Kg(tomatoes, 5, 100)], PurchasePaymentMethod.Safe);

        var movements = invoice.Post(new Dictionary<Guid, RawMaterial> { [tomatoes.Id] = tomatoes }, "Omar");

        Assert.Equal((PurchaseInvoiceStatus.Posted, "Omar"), (invoice.Status, invoice.PostedBy));
        Assert.Equal((5000m, 0.02m, 20m), (tomatoes.QuantityOnHand, tomatoes.AverageCost, tomatoes.CostPerPurchaseUnit));
        var movement = Assert.Single(movements);
        Assert.Equal((StockMovementReason.Purchase, invoice.Id, 5000m), (movement.Reason, movement.SourceId, movement.Quantity));

        Assert.Throws<DomainException>(() => invoice.Post(new Dictionary<Guid, RawMaterial> { [tomatoes.Id] = tomatoes }, "Omar"));
        Assert.Throws<DomainException>(() => invoice.Record(Guid.NewGuid(), null, null, [Kg(tomatoes, 1, 10)], PurchasePaymentMethod.Safe));
        Assert.Equal(5000m, tomatoes.QuantityOnHand);
    }

    // An expense line beside the stock: in the invoice's total, split out as expenses, and posting
    // takes only the stock in. An expense is always its amount, in its own units.
    [Fact]
    public void Expense_lines_are_their_cost_and_take_no_stock()
    {
        var tomatoes = new RawMaterial("Tomatoes", UnitOfMeasure.Gram);
        var cleaning = Guid.NewGuid();
        var invoice = new PurchaseInvoice(Guid.NewGuid(), "Omar");

        invoice.Record(null, null, null,
            [Kg(tomatoes, 5, 100), new PurchaseInvoiceLineEntry(null, 4, " bottle ", 250, 80, PurchaseItemType.Expense, cleaning)], PurchasePaymentMethod.Safe);
        var expense = invoice.Lines.Single(l => l.ItemType == PurchaseItemType.Expense);
        Assert.Equal(((Guid?)null, (Guid?)cleaning, 4m, "bottle", 1m, 4m), (expense.RawMaterialId, expense.ExpenseItemId, expense.EnteredQuantity, expense.UnitLabel, expense.UnitSize, expense.Quantity));
        Assert.Equal((100m, 80m, 180m), (invoice.InventoryTotal, invoice.ExpenseTotal, invoice.Total));

        var movement = Assert.Single(invoice.Post(new Dictionary<Guid, RawMaterial> { [tomatoes.Id] = tomatoes }, "Omar"));
        Assert.Equal((tomatoes.Id, 5000m), (movement.RawMaterialId, movement.Quantity));

        var other = new PurchaseInvoice(Guid.NewGuid(), "Omar");
        PurchaseInvoiceLineEntry Expense(Guid? item, decimal? cost, Guid? material = null) => new(material, 1, null, 1, cost, PurchaseItemType.Expense, item);
        Assert.Throws<DomainException>(() => other.Record(null, null, null, [Expense(cleaning, null)]));
        Assert.Throws<DomainException>(() => other.Record(null, null, null, [Expense(null, 10)]));
        Assert.Throws<DomainException>(() => other.Record(null, null, null, [Expense(cleaning, 10, tomatoes.Id)]));
        Assert.Throws<DomainException>(() => other.Record(null, null, null, [Expense(cleaning, 10), Expense(cleaning, 20)]));
        Assert.Throws<DomainException>(() => other.Record(null, null, null, [new(null, 1, "kg", 1000, 10)]));
        // Expenses only: posted, and nothing moves.
        other.Record(null, null, null, [Expense(cleaning, 10)], PurchasePaymentMethod.Safe);
        Assert.Empty(other.Post(new Dictionary<Guid, RawMaterial>(), "Omar"));
    }

    [Fact]
    public void An_invoice_refuses_what_cannot_be_on_it()
    {
        var tomatoes = new RawMaterial("Tomatoes", UnitOfMeasure.Gram);
        var invoice = new PurchaseInvoice(Guid.NewGuid(), "Omar");

        Assert.Throws<DomainException>(() => invoice.Record(null, null, null, [Kg(tomatoes, 1, 10), Kg(tomatoes, 2, 20)], PurchasePaymentMethod.Safe));
        Assert.Throws<DomainException>(() => invoice.Record(null, null, null, [Kg(tomatoes, 0, 10)], PurchasePaymentMethod.Safe));
        Assert.Throws<DomainException>(() => invoice.Record(null, null, null, [Kg(tomatoes, 1, -1)], PurchasePaymentMethod.Safe));
        Assert.Throws<DomainException>(() => invoice.Post(new Dictionary<Guid, RawMaterial>(), "Omar"));
    }

    // A receipt with discounts: a line's own off that line, the invoice's shared among the priced
    // lines by what each comes to after its own. What is paid and what goes into the average cost
    // are the net, never the price before the discount.
    [Fact]
    public void Discounts_come_off_what_is_paid_and_what_the_stock_cost()
    {
        var tomatoes = new RawMaterial("Tomatoes", UnitOfMeasure.Gram);
        var oil = new RawMaterial("Frying oil", UnitOfMeasure.Millilitre);
        var cleaning = Guid.NewGuid();
        var invoice = new PurchaseInvoice(Guid.NewGuid(), "Omar");

        invoice.Record(null, null, null,
        [
            Kg(tomatoes, 5, 100) with { Discount = 10 },
            new PurchaseInvoiceLineEntry(oil.Id, 2, "L", 1000, 50),
            new PurchaseInvoiceLineEntry(null, 1, null, 1, 60, PurchaseItemType.Expense, cleaning),
        ], PurchasePaymentMethod.Safe, discount: 20);

        // 90, 50 and 60 after the line's own: 200, of which 20 off is 9, 5 and 6.
        Assert.Equal(
            [(100m, 10m, 9m, 81m), (50m, 0m, 5m, 45m), (60m, 0m, 6m, 54m)],
            invoice.Lines.Select(l => (l.LineTotal!.Value, l.Discount, l.DiscountShare, l.Cost!.Value)));
        Assert.Equal((210m, 10m, 20m, 180m), (invoice.Subtotal, invoice.LineDiscounts, invoice.Discount, invoice.Total));
        Assert.Equal((126m, 54m), (invoice.InventoryTotal, invoice.ExpenseTotal));

        invoice.Post(new Dictionary<Guid, RawMaterial> { [tomatoes.Id] = tomatoes, [oil.Id] = oil }, "Omar");
        // L.E 81 for 5 kg: 16.20 a kg, not the 20 written on the paper.
        Assert.Equal((0.0162m, 16.2m), (tomatoes.AverageCost, tomatoes.CostPerPurchaseUnit));
        Assert.Equal(0.0225m, oil.AverageCost);
    }

    // Shared to the piastre, the piastre left over to the first line; a line with no price, or none
    // left after its own discount, takes no share.
    [Fact]
    public void The_invoice_discount_is_shared_to_the_piastre()
    {
        RawMaterial Material(string name) => new(name, UnitOfMeasure.Gram);
        var (a, b, c, d) = (Material("A"), Material("B"), Material("C"), Material("D"));
        var invoice = new PurchaseInvoice(Guid.NewGuid(), "Omar");

        invoice.Record(null, null, null,
            [Kg(a, 1, 10), Kg(b, 1, 10), Kg(c, 1, 10), Kg(d, 1, null), Kg(Material("E"), 1, 5) with { Discount = 5 }],
            PurchasePaymentMethod.Safe, discount: 10);

        Assert.Equal([3.34m, 3.33m, 3.33m, 0m, 0m], invoice.Lines.Select(l => l.DiscountShare));
        Assert.Equal([6.66m, 6.67m, 6.67m, null, 0m], invoice.Lines.Select(l => l.Cost));
        Assert.Equal((35m, 20m), (invoice.Subtotal, invoice.Total));

        // Recorded again without one: as written.
        invoice.Record(null, null, null, [Kg(a, 1, 10)], PurchasePaymentMethod.Safe);
        Assert.Equal((0m, 0m, 10m), (invoice.Discount, invoice.Lines.Single().DiscountShare, invoice.Total));
    }

    [Fact]
    public void A_discount_is_never_more_than_what_it_comes_off()
    {
        var tomatoes = new RawMaterial("Tomatoes", UnitOfMeasure.Gram);
        var invoice = new PurchaseInvoice(Guid.NewGuid(), "Omar");
        void Record(PurchaseInvoiceLineEntry line, decimal discount = 0) => invoice.Record(null, null, null, [line], PurchasePaymentMethod.Safe, discount: discount);

        Assert.Throws<DomainException>(() => Record(Kg(tomatoes, 1, 10) with { Discount = -1 }));
        Assert.Throws<DomainException>(() => Record(Kg(tomatoes, 1, 10) with { Discount = 10.01m }));
        Assert.Throws<DomainException>(() => Record(Kg(tomatoes, 1, null) with { Discount = 1 }));
        Assert.Throws<DomainException>(() => Record(Kg(tomatoes, 1, 10), -1));
        Assert.Throws<DomainException>(() => Record(Kg(tomatoes, 1, 10) with { Discount = 4 }, 6.01m));
        Assert.Throws<DomainException>(() => Record(Kg(tomatoes, 1, null), 1));
        Assert.Empty(invoice.Lines);

        // All of it off: a gift, at nothing.
        Record(Kg(tomatoes, 1, 10) with { Discount = 4 }, 6);
        Assert.Equal(0m, invoice.Total);
    }

    // The paper can be replaced while the invoice is a draft. Once posted, a missing one can still
    // be added, but one attached stays as it is.
    [Fact]
    public void The_attached_paper_is_kept_once_the_invoice_is_posted()
    {
        var tomatoes = new RawMaterial("Tomatoes", UnitOfMeasure.Gram);
        var invoice = new PurchaseInvoice(Guid.NewGuid(), "Omar");
        invoice.Record(null, null, null, [Kg(tomatoes, 1, 20)], PurchasePaymentMethod.Safe);

        Assert.Throws<DomainException>(() => invoice.Attach("invoice.svg", "image/svg+xml", 100, "Omar"));
        Assert.Throws<DomainException>(() => invoice.Attach("huge.jpg", "image/jpeg", PurchaseInvoice.MaxAttachmentBytes + 1, "Omar"));
        invoice.Attach("first.jpg", "image/jpeg", 1000, "Omar");
        invoice.Attach("../../second.pdf", "application/pdf", 2000, "Omar");
        Assert.Equal(("second.pdf", "application/pdf", 2000), (invoice.AttachmentFileName, invoice.AttachmentContentType, invoice.AttachmentBytes));

        invoice.Post(new Dictionary<Guid, RawMaterial> { [tomatoes.Id] = tomatoes }, "Omar");
        Assert.Throws<DomainException>(() => invoice.Attach("third.png", "image/png", 3000, "Omar"));

        var forgotten = new PurchaseInvoice(Guid.NewGuid(), "Omar");
        forgotten.Record(null, null, null, [Kg(tomatoes, 1, 20)], PurchasePaymentMethod.Safe);
        forgotten.Post(new Dictionary<Guid, RawMaterial> { [tomatoes.Id] = tomatoes }, "Omar");
        forgotten.Attach("late.jpg", "image/jpeg", 1000, "Sara");
        Assert.True(forgotten.HasAttachment);
    }
}
```


> 📄 **`backend/tests/Costing.Domain.Tests/TreasuryTests.cs`** — 185 سطر

```csharp
using Costing.Domain.Common;
using Costing.Domain.Purchases;
using Costing.Domain.RawMaterials;
using Costing.Domain.Treasury;

namespace Costing.Domain.Tests;

// The treasury's rules: how an invoice may be paid, and safe and supplier entries that are kept
// as entered and undone by reversing ones.
public class TreasuryTests
{
    private static readonly DateOnly Today = new(2026, 10, 12);

    [Fact]
    public void An_invoice_is_posted_only_once_it_says_how_it_is_paid()
    {
        var tomatoes = new RawMaterial("Tomatoes", UnitOfMeasure.Gram);
        var stock = new Dictionary<Guid, RawMaterial> { [tomatoes.Id] = tomatoes };
        PurchaseInvoice Invoice(Guid? supplier, PurchasePaymentMethod? method, DateOnly? revenueDate = null)
        {
            var invoice = new PurchaseInvoice(Guid.NewGuid(), "Mona");
            invoice.Record(supplier, null, null, [new PurchaseInvoiceLineEntry(tomatoes.Id, 5, "kg", 1000, 100)], method, revenueDate);
            return invoice;
        }

        Assert.Throws<DomainException>(() => Invoice(null, null).Post(stock, "Mona"));
        // On credit it is owed to someone: a supplier is required.
        Assert.Throws<DomainException>(() => Invoice(null, PurchasePaymentMethod.Credit).Post(stock, "Mona"));
        // From a day's takings: which day's.
        Assert.Throws<DomainException>(() => Invoice(null, PurchasePaymentMethod.DayRevenue).Post(stock, "Mona"));
        // Before the treasury is for the invoices from before it, not for a new one.
        Assert.Throws<DomainException>(() => Invoice(null, PurchasePaymentMethod.BeforeTreasury));

        var credit = Invoice(Guid.NewGuid(), PurchasePaymentMethod.Credit);
        Assert.Single(credit.Post(stock, "Mona"));
        var fromTakings = Invoice(null, PurchasePaymentMethod.DayRevenue, Today);
        fromTakings.Post(stock, "Mona");
        Assert.Equal((PurchasePaymentMethod.DayRevenue, (DateOnly?)Today), (fromTakings.PaymentMethod, fromTakings.RevenueDate));

        // A cash invoice whose payment was rejected is paid again, another way; one on credit is not.
        fromTakings.PayBy(PurchasePaymentMethod.Safe, null);
        Assert.Equal((PurchasePaymentMethod.Safe, (DateOnly?)null), (fromTakings.PaymentMethod, fromTakings.RevenueDate));
        Assert.Throws<DomainException>(() => credit.PayBy(PurchasePaymentMethod.Safe, null));
    }

    [Fact]
    public void Cash_in_is_positive_cash_out_negative_and_a_void_undoes_it_on_its_own_day()
    {
        var funding = SafeTransaction.Funding(Guid.NewGuid(), 5_000, Today.AddDays(-10), FundingSource.OwnerFinancing, " From Karim ", "Omar");
        var expense = SafeTransaction.ExpenseVoucher(Guid.NewGuid(), 1_250.555m, Today.AddDays(-3), Guid.NewGuid(), null, "Mona", "Omar");
        Assert.Equal((5_000m, "From Karim"), (funding.Amount, funding.Notes));
        Assert.Equal((-1_250.56m, CashFund.Safe, "Omar"), (expense.Amount, expense.Fund, expense.ApprovedBy));

        var reversal = expense.Void(Guid.NewGuid(), Today, "Omar");
        Assert.Equal((1_250.56m, Today, (Guid?)expense.Id, SafeTransactionKind.ExpenseVoucher), (reversal.Amount, reversal.BusinessDate, reversal.ReversalOf, reversal.Kind));
        Assert.True(expense.IsVoided);
        Assert.Throws<DomainException>(() => expense.Void(Guid.NewGuid(), Today, "Omar"));
        Assert.Throws<DomainException>(() => reversal.Void(Guid.NewGuid(), Today, "Omar"));

        Assert.Throws<DomainException>(() => SafeTransaction.Funding(Guid.NewGuid(), 0, Today, FundingSource.Other, null, "Omar"));
        Assert.Throws<DomainException>(() => SafeTransaction.OpeningBalance(Guid.NewGuid(), 100, Today, FundingSource.Other, null, "Omar"));
        // Takings are moved in on their day or after, never before.
        Assert.Throws<DomainException>(() => SafeTransaction.RevenueTransfer(Guid.NewGuid(), 100, Today, Today.AddDays(1), null, "Omar"));

        // Paid from a day's takings: out of that day's cash, not the safe.
        var fromTakings = SafeTransaction.InvoicePayment(Guid.NewGuid(), 300, Today, Guid.NewGuid(), null, Today.AddDays(-1), "Omar");
        Assert.Equal((CashFund.DayRevenue, -300m), (fromTakings.Fund, fromTakings.Amount));
    }

    [Fact]
    public void Takings_with_the_tax_in_them_go_into_the_safe_whole_with_the_tax_kept_apart()
    {
        // 1,140 at 14%: 1,000 before tax and 140 of tax, and all 1,140 in the safe.
        var takings = SafeTransaction.RevenueTransfer(Guid.NewGuid(), 1_140, Today, Today, null, "Omar", taxPercent: 14);
        Assert.Equal(
            (1_140m, true, (decimal?)14m, 140m, 1_000m),
            (takings.Amount, takings.IncludesTax, takings.TaxPercent, takings.TaxAmount, takings.NetAmount));

        // To the piastre, and the two always add back up: 100 is 87.72 before tax and 12.28 of tax.
        var odd = SafeTransaction.RevenueTransfer(Guid.NewGuid(), 100, Today, Today, null, "Omar", taxPercent: 14);
        Assert.Equal((12.28m, 87.72m), (odd.TaxAmount, odd.NetAmount));

        // Without the tax in them, all of it is takings.
        var plain = SafeTransaction.RevenueTransfer(Guid.NewGuid(), 500, Today, Today, null, "Omar");
        Assert.Equal((false, (decimal?)null, 0m, 500m), (plain.IncludesTax, plain.TaxPercent, plain.TaxAmount, plain.NetAmount));

        // A void takes the tax back with the cash.
        var reversal = takings.Void(Guid.NewGuid(), Today, "Omar");
        Assert.Equal((-1_140m, -140m, (decimal?)14m), (reversal.Amount, reversal.TaxAmount, reversal.TaxPercent));

        Assert.Throws<DomainException>(() => SafeTransaction.RevenueTransfer(Guid.NewGuid(), 100, Today, Today, null, "Omar", taxPercent: 100));
        Assert.Throws<DomainException>(() => SafeTransaction.RevenueTransfer(Guid.NewGuid(), 100, Today, Today, null, "Omar", taxPercent: -1));
    }

    // The safe is the one treasury: a day's cash and Visa sales and the tax collected on them all go
    // in. The net sales are the cash and Visa; the tax is held for the tax authority.
    [Fact]
    public void A_days_cash_visa_and_tax_all_go_into_the_safe()
    {
        var takings = SafeTransaction.RevenueTransfer(Guid.NewGuid(), 1_000, Today, Today, "2 voids", "Omar", card: 500, tax: 210, voids: 35);
        Assert.Equal(
            (1_710m, 1_710m, 1_500m, 210m, 0m, 35m),
            (takings.Amount, takings.TakingsTotal, takings.NetAmount, takings.TaxAmount, takings.PaidOut, takings.VoidsAmount));

        // The drawer paid 300 out of them first: the rest goes in.
        var paid = SafeTransaction.RevenueTransfer(Guid.NewGuid(), 1_000, Today, Today, null, "Omar", paidOut: 300, card: 500, tax: 210);
        Assert.Equal((1_410m, 300m), (paid.Amount, paid.PaidOut));
        var reversal = paid.Void(Guid.NewGuid(), Today, "Omar");
        Assert.Equal((-1_410m, -1_710m, -1_500m, -300m), (reversal.Amount, reversal.TakingsTotal, reversal.NetAmount, reversal.PaidOut));

        // With the till's rate, the cash and Visa entered include the tax: it is worked out and
        // taken off each in proportion, and the three add back up to what was entered.
        Assert.Equal((1_000m, 500m, 210m), SafeTransaction.Takings(1_140, 570, null, 14));
        Assert.Equal((87.72m, 0m, 12.28m), SafeTransaction.Takings(100, 0, null, 14));

        Assert.Throws<DomainException>(() => SafeTransaction.RevenueTransfer(Guid.NewGuid(), 100, Today, Today, null, "Omar", card: 50, tax: 150.01m));
        Assert.Throws<DomainException>(() => SafeTransaction.RevenueTransfer(Guid.NewGuid(), 0, Today, Today, null, "Omar", tax: 0));
        Assert.Throws<DomainException>(() => SafeTransaction.RevenueTransfer(Guid.NewGuid(), 100, Today, Today, null, "Omar", card: -1));
    }

    // The tax paid over (سداد ضرائب): out of the safe, never an expense.
    [Fact]
    public void Tax_paid_over_comes_out_of_the_safe()
    {
        var paid = SafeTransaction.TaxPayment(Guid.NewGuid(), 210, Today, "October's VAT", "Omar");
        Assert.Equal((SafeTransactionKind.TaxPayment, CashFund.Safe, -210m, (Guid?)null), (paid.Kind, paid.Fund, paid.Amount, paid.ExpenseItemId));
        Assert.Equal(210m, paid.Void(Guid.NewGuid(), Today, "Omar").Amount);
        Assert.Throws<DomainException>(() => SafeTransaction.TaxPayment(Guid.NewGuid(), 0, Today, null, "Omar"));
    }

    [Fact]
    public void A_days_takings_go_into_the_safe_gross_less_what_was_paid_out_of_them()
    {
        // The POS says 10,495 with tax in it; the drawer paid 1,454.07 out of it: 9,040.93 into the
        // safe, the tax worked out of it and kept apart.
        var takings = SafeTransaction.RevenueTransfer(Guid.NewGuid(), 10_495, Today, Today, null, "Omar", taxPercent: 14, paidOut: 1_454.07m);
        Assert.Equal(
            ((decimal?)9_206.14m, 9_040.93m, 1_454.07m, 1_288.86m, 9_206.14m),
            (takings.GrossAmount, takings.Amount, takings.PaidOut, takings.TaxAmount, takings.NetAmount));
        // Paid out more than the gross: the rest comes out of the safe.
        Assert.Equal(-20m, SafeTransaction.RevenueTransfer(Guid.NewGuid(), 50, Today, Today, null, "Omar", paidOut: 70).Amount);
        Assert.Throws<DomainException>(() => SafeTransaction.RevenueTransfer(Guid.NewGuid(), 50, Today, Today, null, "Omar", paidOut: -1));
        // Voided, the gross goes back with what went in.
        var reversal = takings.Void(Guid.NewGuid(), Today, "Omar");
        Assert.Equal(((decimal?)-9_206.14m, -9_040.93m), (reversal.GrossAmount, reversal.Amount));

        // Paid out of a day's takings once they are in the safe: out of the safe.
        var later = SafeTransaction.InvoicePayment(Guid.NewGuid(), 45, Today, Guid.NewGuid(), null, Today, "Omar", takingsInSafe: true);
        Assert.Equal((CashFund.Safe, -45m), (later.Fund, later.Amount));

        // The drawer's payment voided once they are in the safe goes back into it; before, into the drawer.
        var drawer = SafeTransaction.InvoicePayment(Guid.NewGuid(), 50, Today, Guid.NewGuid(), null, Today, "Omar");
        Assert.Equal((CashFund.Safe, 50m), (drawer.Void(Guid.NewGuid(), Today, "Omar", takingsInSafe: true).Fund, 50m));
        var early = SafeTransaction.InvoicePayment(Guid.NewGuid(), 50, Today, Guid.NewGuid(), null, Today, "Omar");
        Assert.Equal(CashFund.DayRevenue, early.Void(Guid.NewGuid(), Today, "Omar").Fund);

        // A supplier paid out of a day's takings, as an invoice is: the drawer's, then the safe's.
        var supplier = Guid.NewGuid();
        Assert.Equal((CashFund.DayRevenue, (DateOnly?)Today, -600m),
            Fund(SafeTransaction.SupplierPayment(Guid.NewGuid(), 600, Today, supplier, "Receipt R-12", "Omar", revenueDate: Today)));
        Assert.Equal(CashFund.Safe, SafeTransaction.SupplierPayment(Guid.NewGuid(), 600, Today, supplier, null, "Omar", revenueDate: Today, takingsInSafe: true).Fund);
        Assert.Equal(CashFund.Safe, SafeTransaction.SupplierPayment(Guid.NewGuid(), 600, Today, supplier, null, "Omar").Fund);
        Assert.Throws<DomainException>(() => SafeTransaction.SupplierPayment(Guid.NewGuid(), 600, Today, supplier, null, "Omar", revenueDate: Today.AddDays(1)));
        static (CashFund, DateOnly?, decimal) Fund(SafeTransaction t) => (t.Fund, t.RevenueDate, t.Amount);
    }

    [Fact]
    public void A_supplier_is_owed_what_was_bought_on_credit_less_what_was_paid()
    {
        var supplier = Guid.NewGuid();
        var opening = SupplierLedgerEntry.Opening(Guid.NewGuid(), supplier, 1_000, Today.AddDays(-30), "Omar");
        var invoice = SupplierLedgerEntry.CreditInvoice(supplier, Guid.NewGuid(), 2_500, Today.AddDays(-5), "Mona");
        var payment = SafeTransaction.SupplierPayment(Guid.NewGuid(), 1_500, Today, supplier, null, "Mona", "Omar");
        var paid = SupplierLedgerEntry.Payment(payment);

        Assert.Equal(2_000m, opening.Amount + invoice.Amount + paid.Amount);
        Assert.Equal((supplier, payment.Id, SupplierLedgerKind.Payment), (paid.SupplierId, paid.SourceId, paid.Kind));

        // Voided, the payment's line is undone: owed as before it.
        var undone = paid.Reverse(Today, "Omar");
        Assert.Equal((1_500m, (Guid?)paid.Id), (undone.Amount, undone.ReversalOf));
        Assert.Throws<DomainException>(() => undone.Reverse(Today, "Omar"));
        Assert.Throws<DomainException>(() => SupplierLedgerEntry.Payment(SafeTransaction.Funding(Guid.NewGuid(), 10, Today, FundingSource.Other, null, "Omar")));
    }
}
```


### 5.4 حالات الاستخدام: الجرد الافتتاحي ومدفوعات تقفيل اليوم

> 📄 **`backend/tests/Costing.Application.Tests/OpeningStockTests.cs`** — 106 سطر

```csharp
using Costing.Application.Approvals;
using Costing.Application.RawMaterials;
using Costing.Application.StockCounts;
using Costing.Domain.Approvals;
using Costing.Domain.Common;
using Costing.Domain.Production;
using Costing.Domain.RawMaterials;
using Costing.Domain.StockCounts;
using Costing.Domain.StockMovements;
using CountLine = Costing.Application.StockCounts.StockCountLine;

namespace Costing.Application.Tests;

// The opening stock (جرد افتتاحي): where each material's stock begins when costing starts,
// valued at its cost, with no shortage or surplus against the nothing the records had.
public class OpeningStockTests
{
    private readonly TestCosting _pos = new();

    // Priced from the materials sheet, nothing bought yet; and a dough never made.
    private async Task<(RawMaterial Flour, RawMaterial Cheese, RawMaterial Dough)> SeedAsync()
    {
        var flour = (await _pos.Send(new CreateRawMaterialCommand("Flour", UnitOfMeasure.Gram, CostPerPurchaseUnit: 30))).Id;
        var cheese = (await _pos.Send(new CreateRawMaterialCommand("Cheese", UnitOfMeasure.Gram, CostPerPurchaseUnit: 300))).Id;
        var dough = new RawMaterial("Dough", UnitOfMeasure.Gram, kind: MaterialKind.Prep);
        _pos.Inventory.Add(dough);
        var recipe = new PrepRecipe(dough, 1000);
        recipe.Replace([((await Material(flour)), 600m, (decimal?)null)]);
        _pos.Inventory.PrepRecipes.Add(recipe);
        return (await Material(flour), await Material(cheese), dough);
    }

    private async Task<RawMaterial> Material(Guid id) => (await _pos.Inventory.GetByIdAsync(id))!;

    private Task<StockCountDto> Save(Guid id, StockCountKind? kind, params (RawMaterial Material, decimal Quantity)[] lines) =>
        _pos.Send(new SaveStockCountCommand(id, lines.Select(l => new CountLine(l.Material.Id, l.Quantity)).ToList(), "Omar", kind));

    private Task<StockCountDto> Post(Guid id) => _pos.Send(new PostStockCountCommand(id, "Omar"));

    [Fact]
    public async Task It_sets_where_stock_begins_valued_at_each_cost_with_no_difference_recorded()
    {
        var (flour, cheese, dough) = await SeedAsync();
        var id = Guid.NewGuid();

        Assert.Equal(StockCountKind.Opening, (await Save(id, StockCountKind.Opening, (flour, 25_000), (cheese, 4_000), (dough, 3_000))).Kind);
        // Saved again as the counter goes on: still the opening stock.
        await Save(id, null, (flour, 25_000), (cheese, 4_000), (dough, 3_000));
        var posted = await Post(id);

        Assert.Equal((StockCountStatus.Posted, StockCountKind.Opening), (posted.Status, posted.Kind));
        Assert.Equal((25_000m, 4_000m, 3_000m), (flour.QuantityOnHand, cheese.QuantityOnHand, dough.QuantityOnHand));
        var movements = _pos.Inventory.Movements.All;
        Assert.Equal(3, movements.Count);
        Assert.All(movements, m => Assert.Equal((StockMovementReason.OpeningStock, id), (m.Reason, m.SourceId)));
        Assert.DoesNotContain(movements, m => m.Reason == StockMovementReason.CountAdjustment);
        // Its value: each at the cost it has, the dough at its recipe's (600 g of flour a kg: 18 a kg).
        Assert.Equal(0.018m, dough.AverageCost);
        Assert.Equal(750m + 1_200m + 54m, posted.Lines.Sum(l => l.CountedQuantity * l.UnitCost!.Value));
        Assert.Equal(StockCountKind.Opening, Assert.Single(await _pos.Send(new GetStockCountsQuery())).Kind);

        // Counted again a week later: a periodic count, its difference measured from the opening stock.
        var week = Guid.NewGuid();
        await Save(week, StockCountKind.Periodic, (flour, 24_000));
        await Post(week);
        var shortage = Assert.Single(_pos.Inventory.Movements.All, m => m.SourceId == week);
        Assert.Equal((StockMovementReason.CountAdjustment, -1_000m, 0.03m), (shortage.Reason, shortage.Quantity, shortage.UnitCost));
    }

    [Fact]
    public async Task A_material_is_opened_once_and_again_only_once_its_count_is_voided()
    {
        var (flour, cheese, _) = await SeedAsync();
        var opening = Guid.NewGuid();
        await Save(opening, StockCountKind.Opening, (flour, 25_000), (cheese, 4_000));
        await Post(opening);

        // Forgotten the first time: the oil opens on its own.
        var oil = await Material((await _pos.Send(new CreateRawMaterialCommand("Oil", UnitOfMeasure.Millilitre, CostPerPurchaseUnit: 80))).Id);
        var more = Guid.NewGuid();
        await Save(more, StockCountKind.Opening, (oil, 5_000));
        await Post(more);
        Assert.Equal(5_000m, oil.QuantityOnHand);

        // The flour again, as opening stock: refused, and nothing posted.
        var again = Guid.NewGuid();
        await Save(again, StockCountKind.Opening, (flour, 30_000), (oil, 4_000));
        var refused = await Assert.ThrowsAsync<DomainException>(() => Post(again));
        Assert.StartsWith("Flour and Oil were counted already, first on ", refused.Message);
        Assert.Contains("Count them in a periodic count, or leave them out of the opening stock.", refused.Message);
        Assert.Contains("تُجرد جردًا دوريًا", refused.Message);
        Assert.Equal(25_000m, flour.QuantityOnHand);
        await _pos.Send(new DiscardStockCountCommand(again));

        // The opening count voided, its stock taken back out: the cheese can be opened again.
        var voided = await _pos.Send(new RequestDeletionCommand(Guid.NewGuid(), ApprovalModule.StockCount, opening, "Counted the wrong store", "u1", "Omar", CanApprove: true));
        Assert.Equal(ApprovalOutcome.Applied, voided.Outcome);
        Assert.Equal((0m, 0m), (flour.QuantityOnHand, cheese.QuantityOnHand));
        Assert.Equal(2, _pos.Inventory.Movements.All.Count(m => m.SourceId == opening && m.IsReversal && m.Reason == StockMovementReason.OpeningStock));
        Assert.StartsWith("Opening stock count posted ", voided.Request.Summary);

        await _pos.Send(new RecordStockCountCommand(Guid.NewGuid(), [new CountLine(cheese.Id, 3_500)], "Omar", StockCountKind.Opening));
        Assert.Equal(3_500m, cheese.QuantityOnHand);
        Assert.Equal(StockMovementReason.OpeningStock, _pos.Inventory.Movements.All.Last().Reason);
    }
}
```


> 📄 **`backend/tests/Costing.Application.Tests/EndOfDayPayoutTests.cs`** — 155 سطر

```csharp
using Costing.Application.Approvals;
using Costing.Application.EndOfDay;
using Costing.Application.Staff;
using Costing.Application.Suppliers;
using Costing.Application.Treasury;
using Costing.Domain.Approvals;
using Costing.Domain.Common;
using Costing.Domain.EndOfDay;
using Costing.Domain.Treasury;

namespace Costing.Application.Tests;

// The cash paid out of the till at the end of the day, each with its receipt: to suppliers, against
// what they are owed, and as advances to employees. Handed in, each becomes the safe's entry out of
// the day's takings: a manager's at once, a cashier's asked of a manager. The takings, once entered,
// reach the safe less what was paid out of them; an advance is deducted in its month's payroll.
public class EndOfDayPayoutTests
{
    private static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, 0x4A, 0x46, 0x49, 0x46];
    private static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0];

    private readonly TestCosting _pos = new();
    private readonly DateOnly _today = DateOnly.FromDateTime(DateTime.UtcNow);
    private readonly Guid _nile = Guid.NewGuid();
    private readonly Guid _mona = Guid.NewGuid();

    private async Task SetUpAsync()
    {
        await _pos.Send(new SaveSupplierCommand(_nile, "Nile Mills"));
        // Owed 1,000 from before.
        await _pos.Send(new SetSupplierOpeningBalanceCommand(Guid.NewGuid(), _nile, 1_000, _today.AddDays(-10), "Omar"));
        await _pos.Send(new SaveStaffMemberCommand(_mona, "Mona", "Cashier", true));
    }

    private Task<EndOfDayDto> Pay(Guid id, Guid supplier, decimal amount, byte[]? receipt = null) =>
        _pos.Send(new AddEndOfDayPayoutCommand(
            _today, id, EndOfDayPayoutKind.SupplierPayment, supplier, amount, null, "receipt.jpg", "image/jpeg", receipt ?? Jpeg, "Ali"));

    private Task<EndOfDayDto> Advance(Guid id, Guid employee, decimal amount, byte[]? receipt = null) =>
        _pos.Send(new AddEndOfDayPayoutCommand(
            _today, id, EndOfDayPayoutKind.EmployeeAdvance, employee, amount, "Rent", "signed.jpg", "image/jpeg", receipt ?? Jpeg, "Ali"));

    private Task<EndOfDayDto> Sales() => _pos.Send(new SaveEndOfDaySalesCommand(_today, 1_000, 500, 210, 0, null, "Ali", OpeningFloat: 500));

    private async Task<EndOfDayVoucherState> StateOf(Guid payout) =>
        (await _pos.Send(new GetEndOfDayQuery(_today)))!.Payouts.Single(p => p.Id == payout).Voucher;

    [Fact]
    public async Task A_cashiers_payments_are_asked_of_a_manager_and_once_approved_come_out_of_the_days_takings()
    {
        await SetUpAsync();

        // More than the supplier is owed, alone or with the day's other payments to them: refused.
        var tooMuch = await Assert.ThrowsAsync<DomainException>(() => Pay(Guid.NewGuid(), _nile, 1_200));
        Assert.StartsWith("Nile Mills is owed L.E 1,000.00: pay that much or less.", tooMuch.Message);
        var paid = Guid.NewGuid();
        await Pay(paid, _nile, 600);
        var together = await Assert.ThrowsAsync<DomainException>(() => Pay(Guid.NewGuid(), _nile, 500));
        Assert.Contains("is owed L.E 400.00 after the day's other payments to them", together.Message);
        // A receipt that is not what it says: refused.
        var fake = await Assert.ThrowsAsync<DomainException>(() => Advance(Guid.NewGuid(), _mona, 10, Png));
        Assert.StartsWith("That file is not the photo or PDF it says it is.", fake.Message);

        var advanced = Guid.NewGuid();
        var day = await Advance(advanced, _mona, 250);
        Assert.Equal((1, 600m, 1, 250m), (day.SupplierPayments, day.SupplierPaymentsTotal, day.Advances, day.AdvancesTotal));
        Assert.Equal(["Nile Mills", "Mona"], day.Payouts.Select(p => p.Payee));
        Assert.Equal(Jpeg, await _pos.EndOfDays.GetAsync(advanced));
        // Sent again after an answer was lost: still two.
        Assert.Equal(2, (await Advance(advanced, _mona, 250)).Payouts.Count);

        // The float 500 and the cash 1,000 with its share of the tax, 140; less 600 and 250.
        day = await Sales();
        Assert.Equal((500m, 140m, 1_140m, 850m, 790m), (day.OpeningFloat!.Value, day.CashTax, day.CashSalesCollected, day.CashPaidOut, day.NetCashInTill));
        Assert.Equal(1_710m - 850m, day.ExpectedIntoSafe);

        // Handed in by a cashier: each asked of a manager, nothing in the safe yet.
        day = await _pos.Send(new SubmitEndOfDayCommand(_today, "Ali", "staff-ali", CanApprove: false));
        Assert.All(day.Payouts, p => Assert.Equal(EndOfDayVoucherState.Requested, p.Voucher));
        Assert.Null(await _pos.Inventory.Safe.GetByIdAsync(paid));
        Assert.Equal(ApprovalStatus.Pending, (await _pos.Inventory.ApprovalRequests.GetByIdAsync(paid))!.Status);

        // Approved: the payment out of the day's takings and off the supplier's account; the advance
        // Mona's, deducted in this month's payroll.
        await _pos.Send(new ApproveRequestCommand(paid, "Omar"));
        await _pos.Send(new ApproveRequestCommand(advanced, "Omar"));
        var payment = (await _pos.Inventory.Safe.GetByIdAsync(paid))!;
        Assert.Equal((SafeTransactionKind.SupplierPayment, CashFund.DayRevenue, -600m, (DateOnly?)_today), (payment.Kind, payment.Fund, payment.Amount, payment.RevenueDate));
        Assert.Equal(400m, await _pos.Inventory.SupplierLedger.BalanceAsync(_nile));
        var advance = (await _pos.Inventory.Safe.GetByIdAsync(advanced))!;
        Assert.Equal((SafeTransactionKind.EmployeeAdvance, (Guid?)_mona, (DateOnly?)new DateOnly(_today.Year, _today.Month, 1)),
            (advance.Kind, advance.EmployeeId, advance.PayrollMonth));
        Assert.Equal(EndOfDayVoucherState.InSafe, await StateOf(paid));

        // The day's takings entered: what was paid out of them taken off what reaches the safe.
        await _pos.Send(new RecordSafeVoucherCommand(
            Guid.NewGuid(), new SafeVoucher(Guid.NewGuid(), SafeTransactionKind.RevenueTransfer, 1_000, _today, RevenueDate: _today, CardAmount: 500, TaxAmount: 210),
            null, "staff-omar", "Omar", true));
        var takings = (await _pos.Inventory.Safe.GetTakingsAsync(_today))!;
        Assert.Equal((1_710m, 850m, day.ExpectedIntoSafe), (takings.TakingsTotal, takings.PaidOut, takings.Amount));
    }

    [Fact]
    public async Task A_managers_go_to_the_safe_at_once_and_one_a_manager_refused_can_be_taken_off()
    {
        await SetUpAsync();
        var paid = Guid.NewGuid();
        await Pay(paid, _nile, 100);
        await Sales();

        // Handed in by a manager: in the safe at once.
        var day = await _pos.Send(new SubmitEndOfDayCommand(_today, "Omar", "staff-omar", CanApprove: true));
        Assert.Equal(EndOfDayVoucherState.InSafe, day.Payouts.Single().Voucher);
        Assert.Equal(900m, await _pos.Inventory.SupplierLedger.BalanceAsync(_nile));

        // Reopened: what went to the safe is corrected there; a new advance is asked of a manager
        // when the day is handed in again.
        await _pos.Send(new ReopenEndOfDayCommand(_today, "Omar"));
        var locked = await Assert.ThrowsAsync<DomainException>(() => _pos.Send(new ChangeEndOfDayPayoutCommand(_today, paid, _nile, 50, null, "Ali")));
        Assert.StartsWith("It went to the safe when the day was handed in", locked.Message);
        var advanced = Guid.NewGuid();
        await Advance(advanced, _mona, 75);
        await _pos.Send(new SubmitEndOfDayCommand(_today, "Ali", "staff-ali", CanApprove: false));
        Assert.Equal(EndOfDayVoucherState.Requested, await StateOf(advanced));

        // Refused: nothing entered, so it can be taken off (once the day is reopened).
        await _pos.Send(new RejectRequestCommand(advanced, "No signature on the receipt", "Omar"));
        Assert.Equal(EndOfDayVoucherState.Refused, await StateOf(advanced));
        await _pos.Send(new ReopenEndOfDayCommand(_today, "Omar"));
        day = await _pos.Send(new RemoveEndOfDayPayoutCommand(_today, advanced, "Ali"));
        Assert.Equal([paid], day.Payouts.Select(p => p.Id));
        Assert.Null(await _pos.EndOfDays.GetAsync(advanced));
    }

    [Fact]
    public async Task An_advance_goes_to_someone_on_the_staff_and_a_payment_to_a_supplier_on_the_list()
    {
        await SetUpAsync();
        var karim = Guid.NewGuid();
        await _pos.Send(new SaveStaffMemberCommand(karim, "Karim", null, false));

        var left = await Assert.ThrowsAsync<DomainException>(() => Advance(Guid.NewGuid(), karim, 50));
        Assert.StartsWith("Karim has left", left.Message);
        var nobody = await Assert.ThrowsAsync<DomainException>(() => Advance(Guid.NewGuid(), Guid.NewGuid(), 50));
        Assert.StartsWith("Choose the employee from the list", nobody.Message);
        var noSupplier = await Assert.ThrowsAsync<DomainException>(() => Pay(Guid.NewGuid(), Guid.NewGuid(), 50));
        Assert.StartsWith("Choose the supplier from the list", noSupplier.Message);
        // Nothing owed to a new supplier: nothing to pay.
        var delta = Guid.NewGuid();
        await _pos.Send(new SaveSupplierCommand(delta, "Delta Dairy"));
        var owesNothing = await Assert.ThrowsAsync<DomainException>(() => Pay(Guid.NewGuid(), delta, 50));
        Assert.StartsWith("Nothing is owed to Delta Dairy", owesNothing.Message);
        Assert.Null(await _pos.Send(new GetEndOfDayQuery(_today)) is { } made ? made.Payouts.FirstOrDefault() : null);
    }
}
```


### 5.5 البنية التحتية: قاعدة بيانات حقيقية والتحليلات

`TestSystem`: قاعدة باسم عشوائي لكل اختبار، الـ migrations، ثم الحذف.

> 📄 **`backend/tests/Costing.Infrastructure.Tests/TestSystem.cs`** — 129 سطر

```csharp
using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Costing.Application;
using Costing.Infrastructure.Persistence;
using Costing.Infrastructure.Reports;

namespace Costing.Infrastructure.Tests;

// The system wired exactly as the API wires it, against a real PostgreSQL, with the test menu on
// it and a stand-in till (Till.cs) to sell from. Each test gets its own database, created and
// dropped around it.
public sealed class TestSystem : IAsyncDisposable
{
    private IHost _host = null!;
    private string _connectionString = null!;

    public static string? DatabaseServer => Environment.GetEnvironmentVariable("COSTING_TEST_DB");

    public static async Task<TestSystem> StartAsync()
    {
        if (DatabaseServer is null)
            Assert.Skip("Set COSTING_TEST_DB to a PostgreSQL 15+ connection string (without Database=) to run the integration tests.");

        var system = new TestSystem { _connectionString = $"{DatabaseServer};Database=costing_test_{Guid.NewGuid():N}" };
        var builder = Host.CreateApplicationBuilder();
        builder.Logging.ClearProviders();
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            [$"ConnectionStrings:{DependencyInjection.ConnectionStringName}"] = system._connectionString,
            // Never a hosting platform's database, whatever this machine's environment says.
            [DatabaseConnection.UrlVariable] = string.Empty,
            // The till's: Cairo, the day from 04:00, amounts in L.E.
            ["Company:CurrencySymbol"] = "L.E",
        });
        builder.Services.AddCostingApplication();
        builder.Services.AddCostingInfrastructure(builder.Configuration);
        builder.Services.AddMediatR(config => config.RegisterServicesFromAssembly(typeof(TestSystem).Assembly));
        builder.Services.AddSingleton<Till>();
        system._host = builder.Build();

        await using (var scope = system._host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CostingDbContext>();
            await db.Database.MigrateAsync();
            await TestMenu.SeedAsync(db);
            await scope.ServiceProvider.GetRequiredService<ISender>().Send(new Costing.Application.Company.EnsureCompanySettingsCommand());
        }

        await system._host.StartAsync();
        return system;
    }

    // Who is at the till: the stand-in keeps no users, so this is only for the reading.
    public TestSystem As(string userId, object role) => this;

    public async Task<T> Send<T>(IRequest<T> request)
    {
        await using var scope = _host.Services.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<ISender>().Send(request);
    }

    public async Task Send(IRequest request)
    {
        await using var scope = _host.Services.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<ISender>().Send(request);
    }

    public async Task<T> Db<T>(Func<CostingDbContext, Task<T>> query)
    {
        await using var scope = _host.Services.CreateAsyncScope();
        return await query(scope.ServiceProvider.GetRequiredService<CostingDbContext>());
    }

    public T Service<T>(IServiceScope scope) where T : notnull => scope.ServiceProvider.GetRequiredService<T>();

    public IServiceScope Scope() => _host.Services.CreateScope();

    public static async Task<bool> WaitFor(Func<Task<bool>> condition, int seconds = 15)
    {
        var waited = System.Diagnostics.Stopwatch.StartNew();
        while (waited.Elapsed < TimeSpan.FromSeconds(seconds))
        {
            if (await condition())
                return true;
            await Task.Delay(100);
        }
        return false;
    }

    public async ValueTask DisposeAsync()
    {
        await _host.StopAsync();
        _host.Dispose();

        var options = new DbContextOptionsBuilder<CostingDbContext>().UseNpgsql(_connectionString).Options;
        await using var db = new CostingDbContext(options);
        await db.Database.EnsureDeletedAsync();
    }
}

// The menu the tests sell from, numbered as a point of sale's would be: a burger at 120 with
// cheese at 15 on it, shawarma by the kilo tray at 400, and lemonade at 30 in Drinks. The bills'
// tax, 14%.
public static class TestMenu
{
    public const int Burger = 1, Shawarma = 10, KiloTray = 101, Cheese = 7, Lemonade = 20;
    public const decimal TaxPercent = 14m;

    public static async Task SeedAsync(CostingDbContext db)
    {
        await db.Database.ExecuteSqlRawAsync("""
            INSERT INTO costing."MenuCategories" ("Id", "Name", "DisplayOrder") VALUES (1, 'Mains', 1), (2, 'Drinks', 2);
            INSERT INTO costing."AddOns" ("Id", "Name", "Price", "IsDeleted") VALUES (7, 'Cheese', 15, false);
            INSERT INTO costing."MenuItems" ("Id", "Name", "Category", "Price", "IsAvailable", "IsPriceBasedOnAddons", "IsDeleted", "AddOnIds") VALUES
                (1, 'Burger', 'Mains', 120, true, false, false, ARRAY[7]),
                (10, 'Shawarma', 'Mains', 0, true, false, false, ARRAY[]::integer[]),
                (20, 'Lemonade', 'Drinks', 30, true, false, false, ARRAY[]::integer[]);
            INSERT INTO costing."MenuItemVariants" ("Id", "MenuItemId", "Name", "Price", "DisplayOrder") VALUES (101, 10, 'Kilo tray', 400, 0);
            INSERT INTO costing."FinancialSettings" ("Id", "ServicePercent", "TaxPercent") VALUES (1, 0, 14);
            SELECT setval(pg_get_serial_sequence('costing."MenuCategories"', 'Id'), 100);
            SELECT setval(pg_get_serial_sequence('costing."AddOns"', 'Id'), 100);
            SELECT setval(pg_get_serial_sequence('costing."MenuItemVariants"', 'Id'), 1000);
            """);
    }
}
```


> 📄 **`backend/tests/Costing.Infrastructure.Tests/IntelligenceTests.cs`** — 148 سطر

```csharp
using ClosedXML.Excel;
using Microsoft.EntityFrameworkCore;
using Costing.Application.Production;
using Costing.Application.Purchases;
using Costing.Application.RawMaterials;
using Costing.Application.Recipes;
using Costing.Application.Sales;
using Costing.Application.StockCounts;
using Costing.Application.Suppliers;
using Costing.Domain.Purchases;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;
using Costing.Domain.StockMovements;
using Costing.Infrastructure.Excel;
using Costing.Infrastructure.Reports;

namespace Costing.Infrastructure.Tests;

// Material & demand intelligence over one kitchen's few days: tomatoes bought at 20 a kilo ten days
// ago and at 25 today, made into pizza sauce, the sauce and a patty in the burger; fifteen burgers
// sold yesterday, tomatoes spoiled and found short at a count, saffron bought and never used.
public class IntelligenceTests
{
    [Fact]
    public async Task The_stores_are_read_for_prices_orders_consumption_and_value()
    {
        await using var node = await TestSystem.StartAsync();
        Assert.True(await TestSystem.WaitFor(() => node.Db(db => db.MenuItems.AnyAsync())));
        var ct = TestContext.Current.CancellationToken;
        using var scope = node.Scope();
        var intelligence = node.Service<IntelligenceService>(scope);
        var today = intelligence.Today;
        var yesterday = today.AddDays(-1);

        var tomatoes = (await node.Send(new CreateRawMaterialCommand("Tomatoes", UnitOfMeasure.Gram, ReorderLevel: 12_500, PurchaseUnit: "kg", PurchaseUnitSize: 1000))).Id;
        var patty = (await node.Send(new CreateRawMaterialCommand("Beef patty", UnitOfMeasure.Piece, PurchaseUnit: "piece", PurchaseUnitSize: 1))).Id;
        var saffron = (await node.Send(new CreateRawMaterialCommand("Saffron", UnitOfMeasure.Gram, PurchaseUnit: "kg", PurchaseUnitSize: 1000))).Id;
        var nile = (await node.Send(new SaveSupplierCommand(Guid.NewGuid(), "Nile Farms"))).Id;
        async Task Invoice(Guid id, DateOnly date, IReadOnlyList<PurchaseInvoiceLineEntry> lines)
        {
            await node.Send(new SavePurchaseInvoiceCommand(id, nile, null, date, lines, "Omar", PurchasePaymentMethod.Credit));
            await node.Send(new PostPurchaseInvoiceCommand(id, "Omar"));
        }

        // Ten days ago: 10 kg of tomatoes at 20 a kilo, and 50 g of saffron; its stock came in then.
        var first = Guid.NewGuid();
        await Invoice(first, today.AddDays(-10), [new(tomatoes, 10, "kg", 1000, 200), new(saffron, 50, "g", 1, 100)]);
        await node.Db(db => db.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE costing.\"StockMovements\" SET \"OccurredAtUtc\" = {DateTime.UtcNow.AddDays(-10)} WHERE \"SourceId\" = {first}", ct));

        // The sauce is tomatoes, a kilo for a kilo; the burger a patty and 100 g of sauce.
        var sauce = (await node.Send(new SavePrepItemCommand(null, "Pizza sauce", UnitOfMeasure.Gram, 1_000, [new(tomatoes, 1_000)], DisplayUnit: "kg", DisplayUnitSize: 1000))).Id;
        await node.Send(new SetRecipeCommand(RecipeTargetKind.MenuItem, TestMenu.Burger, null, [new(patty, 1), new(sauce, 100)]));

        // Today: 5 kg of tomatoes at 25 a kilo and twenty patties at 20; two kilos of sauce made.
        await Invoice(Guid.NewGuid(), today, [new(tomatoes, 5, "kg", 1000, 125), new(patty, 20, "piece", 1, 400)]);
        await node.Send(new MakeProductionOrderCommand(Guid.NewGuid(), sauce, 2_000, 2_000, null, "Omar"));
        // Fifteen burgers sold yesterday; 500 g of tomatoes spoiled, and the count finds 500 g short.
        await node.Send(new RecordDailySalesCommand(Guid.NewGuid(), yesterday, [new(TestMenu.Burger, null, 15)], "Omar"));
        Assert.True(await TestSystem.WaitFor(async () => await node.Db(db => db.StockMovements.CountAsync(m => m.Reason == StockMovementReason.Sale)) == 2));
        await node.Send(new RecordSpoilageCommand(Guid.NewGuid(), [new(tomatoes, 500, "Rotten")], "Omar"));
        await node.Send(new RecordStockCountCommand(Guid.NewGuid(), [new(tomatoes, 12_000)], "Omar"));

        // ---- Prices: tomatoes came in at an average of 20 a kilo and were last bought at 25.
        var prices = await intelligence.GetPriceVarianceAsync(yesterday, today, ct);
        Assert.Equal(["Tomatoes", "Beef patty"], prices.Rows.Select(r => r.Material));
        var tomato = prices.Rows[0];
        Assert.Equal((20m, 25m, 5m, 25m, 5m, 25m, "Nile Farms", "kg"),
            (tomato.BaselineCost, tomato.LatestCost, tomato.UnitVariance, tomato.ChangePercent, tomato.QuantityPurchased, tomato.Impact, tomato.LatestSupplier, tomato.PurchaseUnit));
        // A kilo of sauce is a kilo of tomatoes: 5 more a kilo, of its 21.67. A burger has 100 g: 0.50 more, 0.4 points of its 120.
        Assert.Equal(
            [(PriceImpactKind.PrepItem, "Pizza sauce", "kg", 1m, 5m, (decimal?)21.67m, (decimal?)23.1m), (PriceImpactKind.Dish, "Burger", "portion", 0.1m, 0.5m, 120m, 0.4m)],
            tomato.Affected.Select(a => (a.Kind, a.Name, a.Per, a.Quantity, a.CostChange, a.Against, a.Points)));
        // The patty has no price before today: its first is its baseline, so no change.
        Assert.Equal((20m, 20m, 0m, 0m), (prices.Rows[1].BaselineCost, prices.Rows[1].LatestCost, prices.Rows[1].Impact, prices.Rows[1].ChangePercent));
        Assert.Empty(prices.Rows[1].Affected);
        Assert.Equal((25m, 25m, 0m, 1, 0, 1, "Tomatoes", 25m),
            (prices.TotalImpact, prices.Increases, prices.Decreases, prices.Rising, prices.Falling, prices.AffectedDishes, prices.LargestRise, prices.LargestRisePercent));
        Assert.Equal([new NamedId(nile, "Nile Farms")], prices.Suppliers);

        // ---- The order: a week like the last, 15 burgers. Patties: 15 less the 5 left; sauce: 1.5 kg
        // less the 0.5 kg made, so 1 kg of tomatoes, with the 12.5 kg reorder level against 12 kg left.
        var plan = await intelligence.PlanOrderAsync(new OrderPlanRequest(7, 7), ct);
        Assert.Equal((today.AddDays(-7), yesterday), (plan.LookbackFrom, plan.LookbackTo));
        var burger = Assert.Single(plan.Dishes);
        Assert.Equal(("1", true, 2.143m, 2.143m, false), (burger.Code, burger.HasRecipe, burger.AverageDaily, burger.ExpectedDaily, burger.Expected));
        Assert.Equal(
            [("Beef patty", 5m, 2.143m, 15m, 0m, 10m, 10m, (decimal?)20m, (decimal?)200m, false), ("Tomatoes", 12m, 0.214m, 1m, 12.5m, 1.5m, 2m, 25m, 50m, true)],
            plan.Lines.Select(l => (l.Material, l.OnHand, l.AverageDailyUsage, l.ExpectedUsage, l.ReorderLevel, l.Recommended, l.Suggested, l.UnitPrice, l.EstimatedCost, l.BelowReorder)));
        Assert.Equal((2, 250m, 1), (plan.ToOrder, plan.EstimatedTotal, plan.BelowReorder));

        // Three burgers a day expected: 21; or the week's sales doubled: 30.
        var expected = await intelligence.PlanOrderAsync(new OrderPlanRequest(7, 7, 0, [new(TestMenu.Burger, null, 3)]), ct);
        Assert.Equal([16m, 3m], expected.Lines.Select(l => l.Suggested));
        Assert.True(expected.Dishes.Single().Expected);
        var doubled = await intelligence.PlanOrderAsync(new OrderPlanRequest(7, 7, 100), ct);
        Assert.Equal(25m, doubled.Lines.Single(l => l.Material == "Beef patty").Suggested);
        await Assert.ThrowsAsync<Costing.Domain.Common.DomainException>(() => intelligence.PlanOrderAsync(new OrderPlanRequest(0, 7), ct));

        // The approved order as a sheet, by category and by supplier.
        var order = await intelligence.OrderSheetAsync(new OrderSheetRequest([new(patty, 10), new(tomatoes, 2)], CoverageDays: 7), ct);
        Assert.Equal((250m, 2), (order.Total, order.Rows.Count));
        Assert.All(order.Rows, r => Assert.Equal("General", r.Group));
        var bySupplier = await intelligence.OrderSheetAsync(new OrderSheetRequest([new(patty, 10)], OrderSheetGrouping.Supplier), ct);
        Assert.Equal(("Nile Farms", "General"), (bySupplier.Rows.Single().Group, bySupplier.Rows.Single().Other));
        using (var book = new XLWorkbook(IntelligenceWorkbooks.OrderSheet(order)))
        {
            var sheet = book.Worksheet("Order");
            Assert.Equal("Purchase order sheet · طلبية الشراء", sheet.Cell(1, 1).GetString());
            Assert.Equal(("General", "Beef patty", 250d), (sheet.Cell(5, 1).GetString(), sheet.Cell(6, 2).GetString(), sheet.Cell(9, 6).GetDouble()));
        }

        // ---- Consumption: 10 kg + 5 kg − 0.5 kg spoiled − 12 kg left = 2.5 kg used; the sales took
        // 1.5 kg through the sauce, and 0.5 kg is in the sauce still on the shelf: 0.5 kg unexplained.
        var consumption = await intelligence.GetConsumptionAsync(yesterday, today, ct);
        Assert.Equal(["Tomatoes", "Beef patty", "Saffron"], consumption.Rows.Select(r => r.Material));
        var used = consumption.Rows[0];
        Assert.Equal((10m, 5m, 0.5m, 12m, 2.5m, 2m, 0.5m, 0.5m, 25m, 10.83m, VarianceEvaluation.Unfavourable),
            (used.Opening, used.Purchases, used.Waste, used.Closing, used.ActualUsage, used.TheoreticalUsage, used.HeldInPrep, used.UnexplainedQuantity,
                used.UnexplainedPercent, used.VarianceCost, used.Evaluation));
        Assert.Equal((15m, 15m, 0m, VarianceEvaluation.WithinLimit),
            (consumption.Rows[1].ActualUsage, consumption.Rows[1].TheoreticalUsage, consumption.Rows[1].UnexplainedQuantity, consumption.Rows[1].Evaluation));
        Assert.Equal((10.83m, 1), (consumption.UnexplainedValue, consumption.HighLoss));
        Assert.Empty(consumption.SoldWithoutRecipe);

        // ---- ABC over the two days: the patties, 300, are A; the tomatoes, 65, B; the saffron, never
        // used, is dead stock worth 100. Five patties left at 7.5 a day: less than a day.
        var abc = await intelligence.GetAbcAsync(yesterday, today, ct);
        Assert.Equal(2, abc.Days);
        Assert.Equal(
            [("Beef patty", AbcClass.A, 300m, 82.2m, (decimal?)0.7m, true, false), ("Tomatoes", AbcClass.B, 65m, 17.8m, 8m, false, false),
             ("Saffron", AbcClass.C, 0m, 0m, null, false, true)],
            abc.Rows.Select(r => (r.Material, r.Class, r.ConsumptionValue, r.SharePercent, r.DaysOnHand, r.StockoutRisk, r.DeadStock)));
        Assert.Equal((365m, 1, 1, 100m), (abc.ConsumptionValue, abc.StockoutRisks, abc.DeadStock, abc.DeadStockValue));
        Assert.Equal([(AbcClass.A, 1), (AbcClass.B, 1), (AbcClass.C, 1)], abc.Classes.Select(c => (c.Class, c.Materials)));

        // Each report as a workbook.
        foreach (var stream in new[]
                 {
                     IntelligenceWorkbooks.PriceVariance(prices, prices.Rows), IntelligenceWorkbooks.Consumption(consumption), IntelligenceWorkbooks.Abc(abc),
                 })
        {
            using var book = new XLWorkbook(stream);
            // Its first row of figures, under the header.
            Assert.NotEmpty(book.Worksheet(1).Row(5).CellsUsed());
        }
    }
}
```


### 5.6 الـ API عبر HTTP: ربط الـ POS

> 📄 **`backend/tests/Costing.Api.Tests/TestApi.cs`** — 155 سطر

```csharp
using System.Diagnostics;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Costing.Api.Controllers;
using Costing.Domain.Access;
using Costing.Infrastructure.Persistence;

// How money is written is the process's own (CompanyMoney: one company per deployment), and each
// test's API sets it as it starts: the tests run one at a time, so none reads another's currency.
[assembly: Xunit.v3.Parallelization(Mode = Xunit.Sdk.ParallelMode.None)]

namespace Costing.Api.Tests;

// The API exactly as Program.cs builds it, in process, on its own database. On start it has
// migrated and created the first manager, "Boss".
public sealed class TestApi : IAsyncDisposable
{
    public const string BossEmail = "boss@example.com", BossPassword = "boss-password";
    public const string AccountantEmail = "mona@example.com", AccountantPassword = "mona-password";

    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter() } };

    private WebApplicationFactory<Program> _factory = null!;
    private string _connectionString = null!;

    public static string? DatabaseServer => Environment.GetEnvironmentVariable("COSTING_TEST_DB");

    public IServiceProvider Services => _factory.Services;

    // The accountant's user id, once AccountantAsync has made them.
    public string? AccountantId { get; private set; }

    // `settings`: more of the API's settings, for a test that needs one.
    public static Task<TestApi> StartAsync(IReadOnlyDictionary<string, string>? settings = null)
    {
        if (DatabaseServer is null)
            Assert.Skip("Set COSTING_TEST_DB to a PostgreSQL 15+ connection string (without Database=) to run the API tests.");

        var api = new TestApi { _connectionString = $"{DatabaseServer};Database=costing_api_test_{Guid.NewGuid():N}" };

        // UseSetting, not ConfigureAppConfiguration: Program reads the connection string and the
        // signing key while building, before anything added later would be seen. "Testing", so
        // appsettings.Development.json and its database stay out of it.
        api._factory = new WebApplicationFactory<Program>().WithWebHostBuilder(web =>
        {
            web.UseEnvironment("Testing");
            web.UseSetting($"ConnectionStrings:{Costing.Infrastructure.DependencyInjection.ConnectionStringName}", api._connectionString);
            // Never a hosting platform's database, whatever this machine's environment says.
            web.UseSetting(Costing.Infrastructure.Persistence.DatabaseConnection.UrlVariable, string.Empty);
            web.UseSetting("Auth:SigningKey", "test-only-signing-key-0123456789-0123456789");
            web.UseSetting("Auth:FirstManager:Email", BossEmail);
            web.UseSetting("Auth:FirstManager:Name", "Boss");
            web.UseSetting("Auth:FirstManager:Password", BossPassword);
            foreach (var (key, value) in settings ?? new Dictionary<string, string>())
                web.UseSetting(key, value);
            web.ConfigureLogging(logging => logging.ClearProviders());
        });

        // Starts the host: migration, then the first manager.
        _ = api._factory.Server;
        return Task.FromResult(api);
    }

    public HttpClient Anonymous() => _factory.CreateClient();

    public HttpClient Anonymous(WebApplicationFactoryClientOptions options) => _factory.CreateClient(options);

    public async Task<HttpClient> SignInAsync(string email, string password)
    {
        var client = _factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/auth/sign-in", new SignInRequest(email, password));
        Assert.True(response.IsSuccessStatusCode, $"Sign-in as {email} failed: {(int)response.StatusCode} {await response.Content.ReadAsStringAsync()}");
        var signedIn = (await response.Content.ReadFromJsonAsync<SignInResponse>(Json))!;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", signedIn.Token);
        return client;
    }

    public Task<HttpClient> ManagerAsync() => SignInAsync(BossEmail, BossPassword);

    // Mona, the accountant, added by the manager as a user.
    public async Task<HttpClient> AccountantAsync(HttpClient manager)
    {
        if (AccountantId is null)
        {
            var response = await manager.PostAsJsonAsync("/api/users", new CreateUserRequest(AccountantEmail, "Mona", UserRole.Accountant, AccountantPassword), Json);
            Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
            AccountantId = (await response.Content.ReadFromJsonAsync<UserDto>(Json))!.Id;
        }

        return await SignInAsync(AccountantEmail, AccountantPassword);
    }

    // A user of the role, added by the manager, signed in. Their user id is in UserIds by email.
    public async Task<HttpClient> UserAsync(HttpClient manager, string name, UserRole role)
    {
        var email = $"{name.ToLowerInvariant()}@example.com";
        if (!UserIds.ContainsKey(email))
        {
            var response = await manager.PostAsJsonAsync("/api/users", new CreateUserRequest(email, name, role, $"{name}-password"), Json);
            Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
            UserIds[email] = (await response.Content.ReadFromJsonAsync<UserDto>(Json))!.Id;
        }

        return await SignInAsync(email, $"{name}-password");
    }

    public Dictionary<string, string> UserIds { get; } = [];

    public async Task<T> Db<T>(Func<CostingDbContext, Task<T>> query)
    {
        await using var scope = Services.CreateAsyncScope();
        return await query(scope.ServiceProvider.GetRequiredService<CostingDbContext>());
    }

    // On the Stopwatch, which a laptop's sleep does not move.
    public static async Task<bool> WaitFor(Func<Task<bool>> condition, int seconds = 15)
    {
        var waited = Stopwatch.StartNew();
        while (waited.Elapsed < TimeSpan.FromSeconds(seconds))
        {
            if (await condition())
                return true;
            await Task.Delay(100);
        }
        return false;
    }

    public async ValueTask DisposeAsync()
    {
        await _factory.DisposeAsync();

        var options = new DbContextOptionsBuilder<CostingDbContext>().UseNpgsql(_connectionString).Options;
        await using var db = new CostingDbContext(options);
        await db.Database.EnsureDeletedAsync();
    }
}

public static class HttpAssertions
{
    // What the app would show: errors[0] of the ProblemDetails.
    public static async Task<string?> ErrorOf(HttpResponseMessage response)
    {
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return body.TryGetProperty("errors", out var errors) && errors.ValueKind == JsonValueKind.Array
            ? errors[0].GetString()
            : null;
    }
}
```


> 📄 **`backend/tests/Costing.Api.Tests/PosIntegrationApiTests.cs`** — 108 سطر

```csharp
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace Costing.Api.Tests;

// The POS link over HTTP: a manager makes the key (shown once, kept as its hash); the POS calls with
// it in X-API-Key, a wrong one or none refused and logged; the menu read; a Z report sent here and
// as the POS's own day.closed event, the second the same report sent again.
public sealed class PosIntegrationApiTests
{
    private static CancellationToken Cancel => TestContext.Current.CancellationToken;

    private static async Task<JsonElement> Json(HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, $"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync(Cancel)}");
        return await response.Content.ReadFromJsonAsync<JsonElement>(Cancel);
    }

    [Fact]
    public async Task A_manager_makes_the_key_the_POS_calls_with_it_and_every_call_is_logged()
    {
        await using var api = await TestApi.StartAsync();
        var manager = await api.ManagerAsync();
        var accountant = await api.AccountantAsync(manager);
        var pos = api.Anonymous();

        Assert.Equal(HttpStatusCode.Forbidden, (await accountant.PostAsync("/api/settings/pos-integration/key", null, Cancel)).StatusCode);
        var none = await Json(await manager.GetAsync("/api/settings/pos-integration", Cancel));
        Assert.False(none.GetProperty("hasKey").GetBoolean());

        var made = await Json(await manager.PostAsync("/api/settings/pos-integration/key", null, Cancel));
        var key = made.GetProperty("key").GetString()!;
        Assert.StartsWith("cpk_", key);
        // Only the hash is kept.
        Assert.False(await api.Db(db => db.PosLinks.AnyAsync(l => l.KeyHash == key, Cancel)));

        // No key, a wrong key: refused.
        Assert.Equal(HttpStatusCode.Unauthorized, (await pos.GetAsync("/api/integrations/pos/ping", Cancel)).StatusCode);
        pos.DefaultRequestHeaders.Add("X-Api-Key", "cpk_not-it");
        Assert.Equal(HttpStatusCode.Unauthorized, (await pos.GetAsync("/api/integrations/pos/menu", Cancel)).StatusCode);
        pos.DefaultRequestHeaders.Remove("X-Api-Key");
        pos.DefaultRequestHeaders.Add("X-Api-Key", key);

        var ping = await Json(await pos.GetAsync("/api/integrations/pos/ping", Cancel));
        Assert.True(ping.GetProperty("ok").GetBoolean());
        var menu = await Json(await pos.GetAsync("/api/integrations/pos/menu", Cancel));
        Assert.Equal(JsonValueKind.Array, menu.GetProperty("items").ValueKind);

        // A Z report of a day with nothing sold but takings: recorded; then the POS's own envelope
        // for the same shift, read the same: nothing changes.
        var shift = Guid.NewGuid();
        var date = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-2)).ToString("yyyy-MM-dd");
        var report = new
        {
            zReportId = shift,
            date,
            shiftNumber = 1,
            takings = new { totalCash = 400m, totalCard = 100m, totalTax = 70m, voidsAmount = 0m, voidReasons = Array.Empty<object>() },
            soldItems = Array.Empty<object>(),
        };
        var recorded = await Json(await pos.PostAsJsonAsync("/api/integrations/pos/z-report", report, Cancel));
        Assert.Equal("Recorded", recorded.GetProperty("outcome").GetString());

        var envelope = new
        {
            id = Guid.NewGuid(),
            kind = "day.closed",
            branchCode = "BR-01",
            occurredAtUtc = DateTime.UtcNow,
            data = new
            {
                shiftId = shift,
                shiftNumber = 1,
                businessDate = date,
                soldItems = Array.Empty<object>(),
                waste = Array.Empty<object>(),
                takings = new { cash = 400m, card = 100m, tax = 70m, voidsBefore = new { count = 0, amount = 0m }, voidsAfter = new { count = 0, amount = 0m, reasons = Array.Empty<object>() } },
            },
        };
        var resent = await pos.PostAsJsonAsync("/api/integrations/pos/events", envelope, Cancel);
        // Read as the same report, the envelope's own fields aside: nothing changes.
        var resentBody = await Json(resent);
        Assert.Equal("Unchanged", resentBody.GetProperty("outcome").GetString());
        Assert.Equal(1, await api.Db(db => db.SafeTransactions.CountAsync(t => t.ReversalOf == null && t.VoidedAtUtc == null && t.RevenueDate != null, Cancel)));

        // An event Costing does not use: answered, left.
        Assert.Equal(HttpStatusCode.Accepted,
            (await pos.PostAsJsonAsync("/api/integrations/pos/events", new { id = Guid.NewGuid(), kind = "staff.meal", data = new { } }, Cancel)).StatusCode);

        // A report it cannot place: 422, nothing recorded.
        var refused = await pos.PostAsJsonAsync("/api/integrations/pos/z-report",
            new { zReportId = Guid.NewGuid(), date, takings = report.takings, soldItems = new[] { new { itemCode = 9999, quantitySold = 1 } } }, Cancel);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, refused.StatusCode);

        var logs = await Json(await manager.GetAsync("/api/settings/pos-integration", Cancel));
        Assert.True(logs.GetProperty("hasKey").GetBoolean());
        Assert.Equal(made.GetProperty("keyHint").GetString(), logs.GetProperty("keyHint").GetString());
        var outcomes = logs.GetProperty("logs").EnumerateArray().Select(l => l.GetProperty("outcome").GetString()).Reverse().ToList();
        Assert.Equal(["Unauthorized", "Unauthorized", "Served", "Served", "Recorded", "Unchanged", "Served", "Refused"], outcomes);
        Assert.DoesNotContain(logs.GetProperty("logs").EnumerateArray(), l => l.GetRawText().Contains(key));

        // A new key: the old one stops working.
        await Json(await manager.PostAsync("/api/settings/pos-integration/key", null, Cancel));
        Assert.Equal(HttpStatusCode.Unauthorized, (await pos.GetAsync("/api/integrations/pos/ping", Cancel)).StatusCode);
    }
}
```


### 5.7 الفرونت إند

`fixtures.ts`: ما يعيده `/api/auth/me` لكل دور (جدول الصلاحيات والأقسام نفسه)، وشركة اختبار.

> 📄 **`frontend/src/testing/fixtures.ts`** — 40 سطر

```ts
import { Me } from '../app/core/api/models';
import { allCostingTabs } from '../app/core/costing/costing-tabs';
import { CompanySettings } from '../app/core/settings/company';

// What GET /api/auth/me returns for each role: the API's RolePermissions table, and the sections
// each works by its role.
export const managerMe: Me = {
  id: 'user-manager',
  fullName: 'Omar',
  email: 'omar@example.com',
  role: 'Manager',
  permissions: ['approval.decide', 'costing.view', 'inventory.manage', 'inventory.view', 'settings.manage', 'users.manage'],
  tabs: [...allCostingTabs],
};

export const accountantMe: Me = {
  id: 'user-accountant',
  fullName: 'Mona',
  email: 'mona@example.com',
  role: 'Accountant',
  permissions: ['costing.view', 'inventory.manage', 'inventory.view'],
  tabs: ['Materials', 'Sales', 'Purchases', 'ExpenseItems', 'Financials', 'Reports'],
};

export const storekeeperMe: Me = {
  id: 'user-storekeeper',
  fullName: 'Samir',
  email: 'samir@example.com',
  role: 'Storekeeper',
  permissions: ['inventory.manage', 'inventory.view'],
  tabs: ['Materials', 'Production', 'Purchases', 'Counts', 'Waste'],
};

// What GET /api/settings returns: a company in Egypt, its money written "L.E 1,400.00".
export function aCompany(overrides: Partial<CompanySettings> = {}): CompanySettings {
  return {
    name: 'Acme', currencySymbol: 'L.E', currencyPosition: 'Before', country: 'Egypt', timeZoneId: 'Africa/Cairo', workdayStartsAtHour: 4,
    hasLogo: false, logoVersion: 0, ...overrides,
  };
}
```


البحث الذكي العربي، والـ Guards:

> 📄 **`frontend/src/app/features/shared/smart-search.spec.ts`** — 46 سطر

```ts
import { compareValues, searchable, smartMatch, sortItems } from './smart-search';

describe('searching a list', () => {
  it('folds case, accents, Arabic letter forms, tashkeel and digits', () => {
    expect(searchable('  Crème   Brûlée ')).toBe('creme brulee');
    expect(searchable('أُرز إسكندراني')).toBe('ارز اسكندراني');
    expect(searchable('صلصة')).toBe('صلصه');
    expect(searchable('مقلى')).toBe('مقلي');
    expect(searchable('شاورمـــا')).toBe('شاورما');
    expect(searchable('٦١٠١')).toBe('6101');
    expect(searchable(null)).toBe('');
  });

  it('finds every word typed in any field, in any order', () => {
    expect(smartMatch('chick 12', 'Chicken breast', 'ING-12')).toBe(true);
    expect(smartMatch('12 chick', 'Chicken breast', 'ING-12')).toBe(true);
    expect(smartMatch('chick 13', 'Chicken breast', 'ING-12')).toBe(false);
    expect(smartMatch('ارز', 'Rice', 'أرز')).toBe(true);
    expect(smartMatch('', 'anything')).toBe(true);
  });
});

describe('sorting a list', () => {
  const items = [
    { name: 'Béchamel', cost: 40 },
    { name: 'Alfredo', cost: null },
    { name: 'Dough', cost: 18 },
    { name: 'Cheese', cost: 40 },
  ];

  it('sorts by the value asked, either way, those with none last both ways, ties by name', () => {
    const names = (direction: 1 | -1) => sortItems(items, { key: 'cost', direction }, (i) => i.cost, (i) => i.name).map((i) => i.name);

    expect(names(1)).toEqual(['Dough', 'Béchamel', 'Cheese', 'Alfredo']);
    expect(names(-1)).toEqual(['Béchamel', 'Cheese', 'Dough', 'Alfredo']);
    expect(items[0].name).toBe('Béchamel');
  });

  it('compares text by the reader’s language, numbers by size, and in code order', () => {
    expect(compareValues('item 2', 'item 10')).toBeLessThan(0);
    expect(compareValues(9, 10)).toBeLessThan(0);
    expect(compareValues('ب', 'أ')).toBeGreaterThan(0);
    expect(Number.isNaN(compareValues(null, 1))).toBe(true);
    expect(compareValues(null, undefined)).toBe(0);
  });
});
```


> 📄 **`frontend/src/app/core/auth/guards.spec.ts`** — 39 سطر

```ts
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { AuthService } from './auth.service';
import { permissionGuard, signedInGuard, signedOutGuard } from './guards';
import { Permissions } from './permissions';

describe('the section guards', () => {
  function run(guard: () => unknown, auth: { signedIn?: boolean; can?: (p: string) => boolean }): string | boolean {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { me: () => null, isSignedIn: () => auth.signedIn ?? true, can: auth.can ?? (() => true) } },
      ],
    });
    const result = TestBed.runInInjectionContext(guard) as boolean | UrlTree;
    return typeof result === 'boolean' ? result : TestBed.inject(Router).serializeUrl(result);
  }

  const route = {} as ActivatedRouteSnapshot;
  const state = {} as RouterStateSnapshot;

  it('lets a manager into the approvals and the users', () => {
    expect(run(() => permissionGuard(Permissions.ApprovalDecide)(route, state), {})).toBe(true);
    TestBed.resetTestingModule();
    expect(run(() => permissionGuard(Permissions.UsersManage)(route, state), {})).toBe(true);
  });

  // An accountant who typed the address goes back to HR, which sends them on if they hold no tab.
  it('sends an accountant from a manager’s section back to HR', () => {
    const accountant = new Set<string>([Permissions.InventoryView, Permissions.InventoryManage]);
    expect(run(() => permissionGuard(Permissions.ApprovalDecide)(route, state), { can: (p) => accountant.has(p) })).toBe('/costing');
  });

  it('sends whoever is not signed in to sign in, and whoever is away from it', () => {
    expect(run(() => signedInGuard(route, state), { signedIn: false })).toBe('/sign-in');
    TestBed.resetTestingModule();
    expect(run(() => signedOutGuard(route, state), { signedIn: true })).toBe('/costing');
  });
});
```


## 6. Docker و Railway

### 6.1 الـ `Dockerfile` متعدد المراحل

1. **`app`** (`node:22-bookworm-slim`): `package.json` و `package-lock.json` أولًا ثم `npm ci` (طبقة الحزم تُعاد استخدامها إن لم تتغير)، ثم `node scripts/build.mjs --configuration production`.
2. **`api`** (`dotnet/sdk:10.0`): ملفات الـ `.csproj` وحدها ثم `dotnet restore` (نفس الفكرة)، ثم `dotnet publish -c Release`، ثم نسخ ملفات Angular إلى `wwwroot`.
3. **`runtime`** (`dotnet/aspnet:10.0`): المخرجات فقط، `ASPNETCORE_ENVIRONMENT=Production`، `ASPNETCORE_FORWARDEDHEADERS_ENABLED=true` (عنوان العميل الحقيقي خلف الـ proxy، لحد المحاولات)، `PORT=8080`، `USER $APP_UID` (لا root)، ولا أسرار في الصورة أبدًا.

> 📄 **`Dockerfile`** — 50 سطر

```dockerfile
# syntax=docker/dockerfile:1

# Costing & Financials as one image: the Angular app built, then served by the .NET API from its
# wwwroot.
#
#   docker build -t costing .
#   docker run -p 8080:8080 -e DATABASE_URL=postgres://… -e Auth__SigningKey=… costing
#
# On Railway: the API listens on Railway's PORT, behind its HTTPS domain. See docs/deploy-railway.md.

# ---- 1. The Angular app ----
FROM node:22-bookworm-slim AS app
WORKDIR /src/frontend
ENV NG_CLI_ANALYTICS=false CI=1
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
# Through scripts/build.mjs: `ng build` itself never exits after building (see the script).
RUN node scripts/build.mjs --configuration production --output-path /app-dist

# ---- 2. The API, with the app in its wwwroot ----
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS api
WORKDIR /src
# The projects alone first, so a code change does not download the packages again.
COPY backend/src/Costing.Domain/Costing.Domain.csproj backend/src/Costing.Domain/
COPY backend/src/Costing.Application/Costing.Application.csproj backend/src/Costing.Application/
COPY backend/src/Costing.Infrastructure/Costing.Infrastructure.csproj backend/src/Costing.Infrastructure/
COPY backend/src/Costing.Api/Costing.Api.csproj backend/src/Costing.Api/
RUN dotnet restore backend/src/Costing.Api/Costing.Api.csproj
COPY backend/src/ backend/src/
RUN dotnet publish backend/src/Costing.Api/Costing.Api.csproj -c Release -o /publish --no-restore /p:UseAppHost=false
COPY --from=app /app-dist/browser/ /publish/wwwroot/

# ---- 3. The runtime ----
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=api /publish ./

# Production; behind the platform's proxy, the client's own address and scheme from its
# forwarded headers (the sign-in limits are per address). PORT, the database, the signing key and
# the first manager come from the platform's variables, never from this file.
ENV ASPNETCORE_ENVIRONMENT=Production \
    ASPNETCORE_FORWARDEDHEADERS_ENABLED=true \
    PORT=8080

# The web port (PORT): the app and its API.
EXPOSE 8080

USER $APP_UID
ENTRYPOINT ["dotnet", "Costing.Api.dll"]
```


### 6.2 `railway.json`

البناء بالـ Dockerfile، **فحص الصحة `/health/ready`** (لا تُحوَّل الحركة للنسخة الجديدة قبل أن تطبق الـ migrations وتصل لقاعدة البيانات؛ نشر فاشل = القديمة تبقى)، وإعادة التشغيل عند الفشل.

> 📄 **`railway.json`** — 13 سطر

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "healthcheckPath": "/health/ready",
    "healthcheckTimeout": 120,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 5
  }
}
```


### 6.3 متغيرات الإنتاج

| المتغير | المعنى |
| --- | --- |
| `DATABASE_URL` | من خدمة PostgreSQL على Railway |
| `Auth__SigningKey` | 32 بايت على الأقل (`openssl rand -base64 48`). **تغييره** يُخرج الجميع ويجعل مفتاح HR المشفّر غير مقروء |
| `Auth__FirstManager__Email` / `__Name` / `__Password` | أول مدير عند أول تشغيل؛ غيّر كلمة المرور بعده |
| `Company__*` | القيم الأولى لإعدادات الشركة فقط |
| `Database__MigrateOnStartup` | `false` إن طُبقت الـ migrations خارجيًا |
| `PORT` | تضبطه Railway |

## 7. سكربت التوليد والتحقق

هذا الماستر كلاس نفسه يُبنى بسكربت، ويُتحقق منه آليًا:

- **القوالب** في `scripts/masterclass/chapters/*.md`: الشرح العربي + توجيهات `@@file <path>` و `@@tree` و `@@migrations`.
- **البناء:** `python3 scripts/masterclass/build.py` يكتب `docs/masterclass/*.md`.
- **التحقق** (يفشل البناء بأي منها):
  1. **التغطية:** كل ملف إنتاجي متتبَّع في Git (عدا الـ migrations والاختبارات و `docs/` وهذا المجلد) مضمّن **مرة واحدة بالضبط**.
  2. **Markdown:** كل كتلة كود مغلقة (السور يُختار أطول من أطول سلسلة backticks في الملف)، لا توجيه متروك، وكل رابط لفصل موجود.
  3. **الأسرار:** لا شيء يشبه JWT أو مفتاحًا خاصًا أو مفتاح AWS/GitHub أو مفتاح ربط حقيقيًا (`cpk_`/`chr_`/`hrk_` بطول حقيقي).
- **`--check`:** يبني في مجلد مؤقت ويقارن بـ `docs/masterclass`؛ إن تغيّر الكود ولم يُعَد البناء يفشل ("stale"). مناسب للتشغيل قبل كل commit أو في CI.

> حين تضيف ملف كود جديدًا، سيفشل البناء بـ `not embedded: <path>` حتى تضيف له `@@file` وشرحًا في الفصل المناسب. هكذا لا يتأخر التوثيق عن الكود أبدًا.

> 📄 **`scripts/masterclass/build.py`** — 189 سطر

````python
#!/usr/bin/env python3
"""The Arabic masterclass (docs/masterclass): built from its chapters' templates, and checked.

  python3 scripts/masterclass/build.py            build docs/masterclass from scripts/masterclass/chapters
  python3 scripts/masterclass/build.py --check    build into a temporary folder and fail if docs/masterclass
                                                  differs from it (the code changed since the last build)

A chapter template is Markdown with directives, each alone on its line:
  @@file <path>        the file, word for word, in a fenced block, with its path and line count
  @@tree               the repository's tree (its tracked files, without the migrations' designers)
  @@migrations         the migrations, one row each

Every build also verifies, and fails on any of them:
  - coverage: every production source and configuration file is embedded exactly once across the
    chapters (backend/src, frontend, the csproj files, angular.json, Dockerfile, railway.json, ...);
    the migrations, the tests, docs/ and this folder are not required (tests may be embedded);
  - Markdown: every fenced block is closed, no directive is left, every link to a chapter exists;
  - secrets: nothing in the chapters looks like a token, a private key or a real integration key.
"""
import argparse
import filecmp
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
CHAPTERS = os.path.join(HERE, 'chapters')
OUT = os.path.join(REPO, 'docs', 'masterclass')

LANG = {
    '.cs': 'csharp', '.ts': 'ts', '.html': 'html', '.scss': 'scss', '.css': 'css', '.json': 'json', '.csproj': 'xml',
    '.slnx': 'xml', '.yml': 'yaml', '.yaml': 'yaml', '.mjs': 'js', '.js': 'js', '.py': 'python', '': 'text',
}

# What a production file is not: generated, a test, documentation, or this generator.
NOT_REQUIRED = [
    re.compile(r'/Migrations/'),
    re.compile(r'\.spec\.ts$'),
    re.compile(r'^docs/'),
    re.compile(r'^backend/tests/'),
    re.compile(r'^scripts/masterclass/'),
    re.compile(r'^README\.md$'),
    re.compile(r'^frontend/package-lock\.json$'),
    re.compile(r'^frontend/public/'),
]

# What must never be published in a chapter. The test keys the tests use are written to look
# like keys on purpose and are allowed by name below.
SECRETS = [
    (re.compile(r'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}'), 'a JWT'),
    (re.compile(r'-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----'), 'a private key'),
    (re.compile(r'AKIA[0-9A-Z]{16}'), 'an AWS access key'),
    (re.compile(r'gh[pousr]_[A-Za-z0-9]{30,}'), 'a GitHub token'),
    (re.compile(r'\b(cpk|chr|hrk)_[A-Za-z0-9_-]{32,}'), 'an integration key'),
]
ALLOWED_SECRETS = re.compile(r'test-key|0123456789abcdef|example')


def lang_of(path):
    name = os.path.basename(path)
    if name == 'Dockerfile':
        return 'dockerfile'
    if name in ('.gitignore', '.dockerignore'):
        return 'gitignore'
    return LANG.get(os.path.splitext(name)[1], 'text')


def tracked():
    # Tracked files, and new ones not yet added (but not ignored): a file written today is covered
    # before it is committed.
    out = subprocess.run(['git', '-C', REPO, 'ls-files', '--cached', '--others', '--exclude-standard'], capture_output=True, text=True, check=True).stdout
    return sorted({t for t in out.split('\n') if t and os.path.isfile(os.path.join(REPO, t))})


def build(out_dir):
    files = tracked()
    required = {f for f in files if not any(p.search(f) for p in NOT_REQUIRED)}
    seen = {}
    problems = []

    def embed(path, chapter):
        full = os.path.join(REPO, path)
        if not os.path.isfile(full):
            problems.append(f'{chapter}: no such file {path}')
            return ''
        text = open(full, encoding='utf-8').read().rstrip('\n')
        lines = text.count('\n') + 1
        run = max((len(m) for m in re.findall(r'`+', text)), default=0)
        fence = '`' * max(3, run + 1)
        seen.setdefault(path, []).append(chapter)
        return f'> 📄 **`{path}`** — {lines} سطر\n\n{fence}{lang_of(path)}\n{text}\n{fence}\n'

    def tree():
        shown, lines = set(), ['```text', 'Costing/']
        for f in sorted(t for t in files if not t.endswith('.Designer.cs') and not t.startswith('docs/masterclass/')):
            parts = f.split('/')
            for i in range(len(parts) - 1):
                d = '/'.join(parts[: i + 1])
                if d not in shown:
                    shown.add(d)
                    lines.append('    ' * (i + 1) + parts[i] + '/')
            lines.append('    ' * len(parts) + parts[-1])
        return '\n'.join(lines + ['```']) + '\n'

    def migrations():
        rows = ['| # | Migration | ما أضافته (من اسمها) |', '| --- | --- | --- |']
        names = sorted(t for t in files if '/Migrations/' in t and t.endswith('.cs') and not t.endswith('.Designer.cs') and 'ModelSnapshot' not in t)
        for i, n in enumerate(names, 1):
            base = os.path.basename(n)[:-3]
            name = base.partition('_')[2]
            rows.append(f'| {i} | `{base}` | {re.sub(r"(?<!^)(?=[A-Z])", " ", name)} |')
        return '\n'.join(rows) + '\n'

    os.makedirs(out_dir, exist_ok=True)
    chapters = sorted(n for n in os.listdir(CHAPTERS) if n.endswith('.md'))
    for name in chapters:
        result = []
        for line in open(os.path.join(CHAPTERS, name), encoding='utf-8').read().split('\n'):
            if line.startswith('@@file '):
                result.append(embed(line[7:].strip(), name))
            elif line.strip() == '@@tree':
                result.append(tree())
            elif line.strip() == '@@migrations':
                result.append(migrations())
            else:
                result.append(line)
        open(os.path.join(out_dir, name), 'w', encoding='utf-8').write('\n'.join(result).rstrip('\n') + '\n')

    # Coverage.
    for path in sorted(required - set(seen)):
        problems.append(f'not embedded: {path}')
    for path, where in sorted(seen.items()):
        if len(where) > 1:
            problems.append(f'embedded {len(where)} times: {path} ({", ".join(where)})')

    # Markdown and secrets.
    for name in chapters:
        text = open(os.path.join(out_dir, name), encoding='utf-8').read()
        fence = None
        for number, line in enumerate(text.split('\n'), 1):
            m = re.match(r'^(`{3,})(\S*)\s*$', line)
            if m:
                if fence is None:
                    fence = m.group(1)
                elif m.group(1) == fence and not m.group(2):
                    fence = None
            if fence is None and line.startswith('@@'):
                problems.append(f'{name}:{number}: directive left: {line}')
        if fence is not None:
            problems.append(f'{name}: a fenced block is never closed')
        for target in re.findall(r'\]\(((?:\d\d-)[^)#]+\.md)(?:#[^)]*)?\)', text):
            if not os.path.isfile(os.path.join(out_dir, target)):
                problems.append(f'{name}: links to a chapter that is not there: {target}')
        for pattern, what in SECRETS:
            for m in pattern.finditer(text):
                if not ALLOWED_SECRETS.search(m.group(0)):
                    problems.append(f'{name}: looks like {what}: {m.group(0)[:12]}…')

    embedded_lines = sum(open(os.path.join(REPO, p), encoding='utf-8').read().count('\n') + 1 for p in seen)
    return problems, len(required), len(seen), embedded_lines, chapters


def main():
    parser = argparse.ArgumentParser(description='Build or check docs/masterclass.')
    parser.add_argument('--check', action='store_true', help='fail if docs/masterclass is not what the chapters and the code build now')
    args = parser.parse_args()

    if args.check:
        with tempfile.TemporaryDirectory() as temp:
            problems, required, embedded, lines, chapters = build(temp)
            stale = [n for n in chapters if not os.path.isfile(os.path.join(OUT, n)) or not filecmp.cmp(os.path.join(temp, n), os.path.join(OUT, n), shallow=False)]
            problems += [f'stale: docs/masterclass/{n} (run scripts/masterclass/build.py)' for n in stale]
    else:
        problems, required, embedded, lines, chapters = build(OUT)

    for p in problems:
        print('FAIL', p)
    print(f'{embedded} files embedded ({required} required), {lines} lines of code, in {len(chapters)} chapters')
    if not args.check:
        for n in chapters:
            print(f'  docs/masterclass/{n}: {os.path.getsize(os.path.join(OUT, n)) // 1024} KB')
    sys.exit(1 if problems else 0)


if __name__ == '__main__':
    main()
````


---

## خاتمة

رأيت نظامًا ماليًا كاملًا من الداخل: دفتر مخزون لا يُعدَّل ومتوسط مرجح متحرك، تكلفة مصنعات متداخلة قبل أول دفعة، توزيع خصم بالقرش، فصل الضريبة كالتزام، تقفيل يوم بأدلة مصورة، خزنة موحدة بقيود عكسية، تحليلات تجيب أسئلة صاحب المطعم الحقيقية، وربط موثوق بنظامين آخرين. خطتك المقترحة:

1. ابنِ نسخة مصغرة باتباع [خارطة البناء](00-index-and-build-roadmap.md): خامات + فاتورة + وصفة + ملخص مبيعات + تقرير نظري.
2. احسب كل معادلة في هذا الماستر كلاس بورقة وقلم مرة واحدة، ثم اكتبها كاختبار Domain.
3. أكمل فجوة `costing.view` (الفصل 03) كتمرين كامل: سياسة، فلتر استجابة، إخفاء في الواجهة، واختبار API.
4. اقرأ ملفًا صعبًا كل يوم (`RawMaterial.cs`، `RecipeCosts.cs`، `IntelligenceService.cs`، `PosIntegration.cs`) واشرحه بصوت عالٍ.

بالتوفيق.
