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
