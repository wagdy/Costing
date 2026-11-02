import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { Permissions } from '../../core/auth/permissions';
import {
  LineVoid,
  Menu,
  MenuItem,
  MenuSalesApi,
  PaymentMethod,
  SaleInput,
  SalesChannel,
  SalesImportResult,
  SalesLine,
  SalesReceipt,
  SalesReport,
  channelLabels,
  paymentLabels,
  voidLabels,
} from '../../core/costing/menu-sales.api';
import { CostingApi } from '../../core/costing/costing.api';
import { errorMessage } from '../../core/http/error-message';
import { Company } from '../../core/settings/company';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { NotifyService } from '../../core/ui/notify.service';
import { saveBlob } from '../../core/ui/save-blob';
import { Approvals } from './approvals';
import { BusinessDay } from './financials';

interface DraftLine {
  menuItemId: number | null;
  variantId: number | null;
  quantity: number;
  addOnIds: number[];
  // Typed: what the line came to; none, the menu's price.
  lineTotal: number | null;
  voided: LineVoid;
}

export interface SaleDialogData {
  menu: Menu;
  today: string;
  // The bills' tax, percent: the tax is worked out at it until typed; none, until typed.
  taxPercent: number | null;
}

const money = (n: number) => Math.round(n * 100) / 100;

// A sale as a bill is printed: when and where, how it was paid, its lines (an item, a size, its
// add-ons, how many; a line voided before the kitchen, after it, or refunded), and how it added
// up. A day's totals can be entered as one, its lines the day's items. Closes with the sale as
// recorded; its stock is taken as it is.
@Component({
  selector: 'app-sale-dialog',
  imports: [FormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule, MoneyPipe],
  template: `
    <h2 mat-dialog-title>New sale <span class="inline-ar">فاتورة بيع جديدة</span></h2>
    <mat-dialog-content>
      <form id="sale-form" (ngSubmit)="save()">
        <div class="row">
          <mat-form-field>
            <mat-label>Day · اليوم</mat-label>
            <input matInput type="date" name="date" [(ngModel)]="date" [max]="data.today" required />
          </mat-form-field>
          <mat-form-field class="small">
            <mat-label>Time · الوقت</mat-label>
            <input matInput name="time" [(ngModel)]="time" placeholder="13:40" />
            <mat-hint>Blank: the day's totals</mat-hint>
          </mat-form-field>
          <mat-form-field>
            <mat-label>Receipt number · رقم الفاتورة</mat-label>
            <input matInput name="reference" [(ngModel)]="reference" maxlength="64" />
          </mat-form-field>
          <mat-form-field>
            <mat-label>Place · نوع الطلب</mat-label>
            <mat-select name="channel" [(ngModel)]="channel">
              @for (c of channels; track c) {
                <mat-option [value]="c">{{ channelLabels[c].en }} · {{ channelLabels[c].ar }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-form-field>
            <mat-label>Paid by · طريقة الدفع</mat-label>
            <mat-select name="payment" [(ngModel)]="payment">
              @for (p of payments; track p) {
                <mat-option [value]="p">{{ paymentLabels[p].en }} · {{ paymentLabels[p].ar }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        </div>

        <h3>Items <span class="inline-ar">الأصناف</span></h3>
        @for (line of lines(); track $index; let i = $index) {
          <div class="row line">
            <mat-form-field class="item" subscriptSizing="dynamic">
              <mat-label>Item · الصنف</mat-label>
              <mat-select [name]="'item' + i" [(ngModel)]="line.menuItemId" (ngModelChange)="line.variantId = null; line.addOnIds = []; touch()" required>
                @for (m of liveItems; track m.id) {
                  <mat-option [value]="m.id">{{ m.id }} · {{ m.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            @if (itemOf(line)?.sizes?.length) {
              <mat-form-field class="size" subscriptSizing="dynamic">
                <mat-label>Size · الحجم</mat-label>
                <mat-select [name]="'size' + i" [(ngModel)]="line.variantId" (ngModelChange)="touch()" required>
                  @for (s of itemOf(line)!.sizes; track s.id) {
                    <mat-option [value]="s.id">{{ s.name }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            }
            @if (addOnsOf(line).length) {
              <mat-form-field class="size" subscriptSizing="dynamic">
                <mat-label>Add-ons · الإضافات</mat-label>
                <mat-select [name]="'addOns' + i" [(ngModel)]="line.addOnIds" (ngModelChange)="touch()" multiple>
                  @for (a of addOnsOf(line); track a.id) {
                    <mat-option [value]="a.id">{{ a.name }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            }
            <mat-form-field class="qty" subscriptSizing="dynamic">
              <mat-label>How many · العدد</mat-label>
              <input matInput type="number" min="1" step="1" [name]="'qty' + i" [(ngModel)]="line.quantity" (ngModelChange)="touch()" required />
            </mat-form-field>
            <mat-form-field class="qty" subscriptSizing="dynamic">
              <mat-label>Line total · الإجمالي</mat-label>
              <input matInput type="number" min="0" step="0.01" [name]="'total' + i" [(ngModel)]="line.lineTotal" (ngModelChange)="touch()"
                [placeholder]="(menuTotal(line) | money)" />
            </mat-form-field>
            <mat-form-field class="size" subscriptSizing="dynamic">
              <mat-label>On the bill · الحالة</mat-label>
              <mat-select [name]="'void' + i" [(ngModel)]="line.voided" (ngModelChange)="touch()">
                @for (v of voids; track v) {
                  <mat-option [value]="v">{{ voidLabels[v].en }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <button mat-icon-button type="button" (click)="removeLine(i)" [disabled]="lines().length === 1" aria-label="Remove the line"><mat-icon>close</mat-icon></button>
          </div>
        }
        <button mat-button type="button" (click)="addLine()"><mat-icon>add</mat-icon> Add an item <span class="inline-ar">إضافة صنف</span></button>

        <div class="row totals">
          <mat-form-field class="qty">
            <mat-label>Discount · الخصم</mat-label>
            <input matInput type="number" min="0" step="0.01" name="discount" [(ngModel)]="discount" (ngModelChange)="touch()" />
          </mat-form-field>
          <mat-form-field class="qty">
            <mat-label>Delivery fee · التوصيل</mat-label>
            <input matInput type="number" min="0" step="0.01" name="delivery" [(ngModel)]="delivery" (ngModelChange)="touch()" />
          </mat-form-field>
          <mat-form-field class="qty">
            <mat-label>Tax · الضريبة</mat-label>
            <input matInput type="number" min="0" step="0.01" name="tax" [(ngModel)]="tax" (ngModelChange)="taxTyped = true; touch()" />
            @if (data.taxPercent !== null && !taxTyped) {
              <mat-hint>{{ data.taxPercent }}% of the items</mat-hint>
            }
          </mat-form-field>
          <mat-form-field class="qty">
            <mat-label>Points · النقاط</mat-label>
            <input matInput type="number" min="0" step="0.01" name="points" [(ngModel)]="points" (ngModelChange)="touch()" />
          </mat-form-field>
          <mat-form-field class="qty">
            <mat-label>Refunded · المرتجع</mat-label>
            <input matInput type="number" min="0" step="0.01" name="refunded" [(ngModel)]="refunded" (ngModelChange)="touch()" />
          </mat-form-field>
        </div>
        <mat-form-field class="full">
          <mat-label>Notes · ملاحظات</mat-label>
          <input matInput name="notes" [(ngModel)]="notes" maxlength="300" />
        </mat-form-field>
        <p class="sum">
          Items {{ subtotal() | money }} · Total <strong>{{ total() | money }}</strong>
          <span class="inline-ar">الإجمالي</span>
        </p>
      </form>
      @if (error(); as message) {
        <p class="error" role="alert">{{ message }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button type="submit" form="sale-form" [disabled]="saving()">Record · تسجيل</button>
    </mat-dialog-actions>
  `,
  styles: `
    form {
      display: grid;
      gap: 4px;
      min-width: min(860px, 86vw);
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 10px;
    }
    .item {
      flex: 1 1 220px;
    }
    .size {
      width: 170px;
    }
    .qty,
    .small {
      width: 130px;
    }
    .full {
      width: 100%;
    }
    .line {
      padding: 6px 0;
      border-bottom: 1px dashed var(--app-line);
    }
    h3 {
      margin: 8px 0 4px;
      font: var(--mat-sys-title-small);
    }
    .sum {
      margin: 4px 0 0;
      font: var(--mat-sys-title-medium);
    }
    .inline-ar {
      direction: rtl;
      unicode-bidi: isolate;
      opacity: 0.75;
      margin-left: 6px;
    }
    .error {
      color: var(--mat-sys-error);
    }
  `,
})
export class SaleDialog {
  protected readonly data = inject<SaleDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<SaleDialog, SalesReceipt>);
  private readonly api = inject(MenuSalesApi);

  protected readonly channels: SalesChannel[] = ['DineIn', 'Takeaway', 'Delivery', 'Online'];
  protected readonly payments: PaymentMethod[] = ['Cash', 'Visa', 'Instapay'];
  protected readonly voids: LineVoid[] = ['None', 'BeforeKitchen', 'AfterKitchen', 'AfterPayment'];
  protected readonly channelLabels = channelLabels;
  protected readonly paymentLabels = paymentLabels;
  protected readonly voidLabels = voidLabels;
  protected readonly liveItems = this.data.menu.items.filter((i) => !i.isDeleted);

  protected date = this.data.today;
  protected time = '';
  protected reference = '';
  protected channel: SalesChannel = 'DineIn';
  protected payment: PaymentMethod = 'Cash';
  protected discount = 0;
  protected delivery = 0;
  protected tax = 0;
  protected taxTyped = false;
  protected points = 0;
  protected refunded = 0;
  protected notes = '';
  protected readonly lines = signal<DraftLine[]>([this.blank()]);
  // Bumped as anything is typed: the sums follow.
  private readonly changed = signal(0);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  // One sale, one id: a retry after a lost answer records it once.
  private readonly id = crypto.randomUUID();

  protected readonly subtotal = computed(() => {
    this.changed();
    return money(this.lines().filter((l) => l.voided === 'None' || l.voided === 'AfterPayment').reduce((sum, l) => sum + this.totalOf(l), 0));
  });

  protected readonly total = computed(() => {
    // The discount, the tax and the rest are typed into plain fields: read again as each is.
    this.changed();
    const subtotal = this.subtotal();
    if (!this.taxTyped && this.data.taxPercent !== null) {
      this.tax = money(((subtotal - (Number(this.discount) || 0)) * this.data.taxPercent) / 100);
    }
    return money(subtotal - (Number(this.discount) || 0) + (Number(this.tax) || 0) + (Number(this.delivery) || 0) - (Number(this.points) || 0));
  });

  protected touch(): void {
    this.changed.update((n) => n + 1);
  }

  protected itemOf(line: DraftLine): MenuItem | undefined {
    return this.data.menu.items.find((i) => i.id === line.menuItemId);
  }

  protected addOnsOf(line: DraftLine) {
    const allowed = new Set(this.itemOf(line)?.addOnIds ?? []);
    return this.data.menu.addOns.filter((a) => allowed.has(a.id) && !a.isDeleted);
  }

  // The menu's price for the line: the size's or the item's, with its add-ons', times how many.
  protected menuTotal(line: DraftLine): number {
    const item = this.itemOf(line);
    if (!item) {
      return 0;
    }
    const unit =
      (line.variantId ? (item.sizes.find((s) => s.id === line.variantId)?.price ?? 0) : item.price) +
      line.addOnIds.reduce((sum, id) => sum + (this.data.menu.addOns.find((a) => a.id === id)?.price ?? 0), 0);
    return money(unit * (Number(line.quantity) || 0));
  }

  protected addLine(): void {
    this.lines.update((lines) => [...lines, this.blank()]);
  }

  protected removeLine(index: number): void {
    this.lines.update((lines) => lines.filter((_, i) => i !== index));
  }

  protected async save(): Promise<void> {
    this.saving.set(true);
    this.error.set(null);
    this.total();
    const sale: SaleInput = {
      id: this.id,
      reference: this.reference.trim() || null,
      date: this.date,
      time: this.time.trim() ? `${this.time.trim()}${this.time.trim().length === 5 ? ':00' : ''}` : null,
      channel: this.channel,
      paymentMethod: this.payment,
      lines: this.lines().map((l) => ({
        menuItemId: l.menuItemId!,
        variantId: l.variantId,
        quantity: Number(l.quantity),
        lineTotal: l.lineTotal === null || `${l.lineTotal}` === '' ? null : Number(l.lineTotal),
        addOnIds: l.addOnIds,
        voided: l.voided,
      })),
      discountAmount: Number(this.discount) || 0,
      deliveryFee: Number(this.delivery) || 0,
      taxAmount: Number(this.tax) || 0,
      pointsAmount: Number(this.points) || 0,
      refundedAmount: Number(this.refunded) || 0,
      notes: this.notes.trim() || null,
    };
    try {
      this.ref.close(await firstValueFrom(this.api.recordSale(sale)));
    } catch (error) {
      this.error.set(errorMessage(error, 'The sale could not be recorded.'));
    } finally {
      this.saving.set(false);
    }
  }

  private totalOf(line: DraftLine): number {
    return line.lineTotal === null || `${line.lineTotal}` === '' ? this.menuTotal(line) : Number(line.lineTotal);
  }

  private blank(): DraftLine {
    return { menuItemId: null, variantId: null, quantity: 1, addOnIds: [], lineTotal: null, voided: 'None' };
  }
}

// Sales (المبيعات): what the menu sold, as every cost report reads it. A bill entered as it was
// printed, a day's totals entered as one, or a point of sale's export imported from its sheet;
// each line takes its stock by its recipe as it is recorded. A line handed back after it was paid
// is refunded here (its share of the charge into the refund, its stock back); a sale entered by
// mistake is voided, by a manager or on their approval, its stock all put back.
@Component({
  selector: 'app-sales-page',
  imports: [DatePipe, FormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressBarModule, MatTooltipModule, MoneyPipe],
  template: `
    <div class="toolbar no-print">
      <mat-form-field subscriptSizing="dynamic" class="day">
        <mat-label>From · من</mat-label>
        <input matInput type="date" [ngModel]="from()" (ngModelChange)="pick($event, to())" aria-label="From" />
      </mat-form-field>
      <mat-form-field subscriptSizing="dynamic" class="day">
        <mat-label>To · إلى</mat-label>
        <input matInput type="date" [ngModel]="to()" (ngModelChange)="pick(from(), $event)" aria-label="To" />
      </mat-form-field>
      <span class="spacer"></span>
      @if (canChange) {
        <button mat-stroked-button (click)="template()"><mat-icon>download</mat-icon> Template <span class="inline-ar">النموذج</span></button>
        <button mat-stroked-button type="button" (click)="picker.click()" [disabled]="busy()"><mat-icon>upload_file</mat-icon> Import <span class="inline-ar">استيراد</span></button>
        <input #picker type="file" accept=".xlsx" (change)="import($event)" hidden aria-label="The sales sheet" />
        <button mat-flat-button (click)="newSale()"><mat-icon>add</mat-icon> New sale <span class="inline-ar">فاتورة جديدة</span></button>
      }
    </div>

    @if (imported(); as result) {
      <div class="note" role="status">
        <strong>{{ result.receipts }} sales imported ({{ result.lines }} lines){{ result.alreadyRecorded ? ', ' + result.alreadyRecorded + ' recorded already' : '' }}.</strong>
        @for (s of result.skipped; track s.row) {
          <div class="muted small">Row {{ s.row }}{{ s.name ? ' · ' + s.name : '' }}: {{ s.reason }}</div>
        }
      </div>
    }

    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    } @else if (error(); as message) {
      <p class="error">{{ message }}</p>
    } @else if (report(); as r) {
      <div class="tiles">
        <div class="tile key">
          <span class="label">Sales · المبيعات</span>
          <strong>{{ r.totals.total | money }}</strong>
          <small>{{ r.totals.receipts }} bills · {{ r.totals.items }} items</small>
        </div>
        <div class="tile">
          <span class="label">Cash · نقدي</span>
          <strong>{{ r.totals.byPayment.Cash | money }}</strong>
          <small class="muted">less what was handed back</small>
        </div>
        <div class="tile">
          <span class="label">Visa · فيزا</span>
          <strong>{{ r.totals.byPayment.Visa | money }}</strong>
        </div>
        <div class="tile">
          <span class="label">Instapay · إنستاباي</span>
          <strong>{{ r.totals.byPayment.Instapay | money }}</strong>
        </div>
        <div class="tile">
          <span class="label">Tax · الضريبة</span>
          <strong>{{ r.totals.tax | money }}</strong>
          <small class="muted">refunded {{ r.totals.refunded | money }}</small>
        </div>
      </div>

      <div class="table-wrap">
        <table class="grid" aria-label="Sales">
          <thead>
            <tr>
              <th>Day<span class="ar">اليوم</span></th>
              <th>Receipt<span class="ar">الفاتورة</span></th>
              <th>Items<span class="ar">الأصناف</span></th>
              <th>Place · paid by<span class="ar">النوع · الدفع</span></th>
              <th class="num">Total<span class="ar">الإجمالي</span></th>
              <th><span class="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (s of r.receipts; track s.id) {
              <tr [class.voided]="s.voidedAtUtc">
                <td class="nowrap">
                  {{ s.businessDate | date: 'd MMM' }}
                  <div class="muted small">{{ s.soldAtUtc | date: 'HH:mm' }}</div>
                </td>
                <td>
                  <strong>{{ s.reference ?? '—' }}</strong>
                  <div class="muted small">{{ s.source === 'Imported' ? 'Imported' : 'Entered' }} by {{ s.enteredBy }}</div>
                  @if (s.voidedAtUtc) {
                    <span class="tag bad">Voided<span class="ar">ملغاة</span></span>
                  } @else if (approvals.pendingFor(s.id)) {
                    <span class="pending-badge">Void requested<span class="ar">طلب إلغاء</span></span>
                  }
                </td>
                <td>
                  @for (l of s.lines; track l.publicId) {
                    <div class="small line" [class.off]="!l.onBill">
                      {{ l.quantity }} × {{ l.menuItemName }}{{ l.variantName ? ' (' + l.variantName + ')' : '' }}
                      · {{ l.lineTotal | money }}
                      @if (l.voided !== 'None') {
                        <span class="tag warn">{{ voidLabels[l.voided].en }}</span>
                      }
                      @if (canChange && l.onBill && !s.voidedAtUtc) {
                        <button mat-icon-button class="mini" (click)="refund(s, l)" [attr.aria-label]="'Refund ' + l.menuItemName" matTooltip="Refund · مرتجع">
                          <mat-icon>keyboard_return</mat-icon>
                        </button>
                      }
                    </div>
                  }
                </td>
                <td>
                  {{ channelLabels[s.channel].en }}
                  <div class="muted small">{{ paymentLabels[s.paymentMethod].en }}</div>
                </td>
                <td class="num">
                  {{ s.totalAmount | money }}
                  @if (s.refundedAmount) {
                    <div class="small bad">− {{ s.refundedAmount | money }} refunded</div>
                  }
                </td>
                <td class="num actions">
                  @if (canChange && !s.voidedAtUtc && !approvals.pendingFor(s.id)) {
                    <button mat-icon-button (click)="voidSale(s)" [attr.aria-label]="'Void sale ' + (s.reference ?? '')" matTooltip="Void · إلغاء"><mat-icon>undo</mat-icon></button>
                  }
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="6" class="empty">
                  No sales in these days. Enter a bill or a day's totals, or import a point of sale's export.
                  <span class="note-ar" lang="ar" dir="rtl">لا توجد مبيعات في هذه الأيام. أدخل فاتورة أو إجمالي يوم، أو استورد ملف المبيعات.</span>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <p class="note">
        <span class="note-ar" lang="ar" dir="rtl">كل صنف مباع يخصم من المخزون بوصفته عند تسجيله. الصنف الملغي بعد المطبخ هالك، والمرتجع بعد الدفع يعود للمخزون. إلغاء الفاتورة يعيد كل ما خصمته، ويحتاج موافقة المدير.</span>
        Every item sold takes its stock by its recipe as it is recorded. One voided after the kitchen made it is waste; one refunded after it
        was paid goes back to stock. Voiding a sale puts back all it took, on a manager's say.
      </p>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .day {
      width: 170px;
    }
    tr.voided td {
      opacity: 0.6;
    }
    .line.off {
      opacity: 0.7;
    }
    .mini {
      --mat-icon-button-state-layer-size: 28px;
      width: 28px;
      height: 28px;
      padding: 2px;
      vertical-align: middle;
    }
    .mini mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
    .small {
      font-size: 0.85em;
    }
    .bad {
      color: var(--mat-sys-error);
    }
  `,
})
export class SalesPage {
  private readonly company = inject(Company);
  private readonly api = inject(MenuSalesApi);
  private readonly costing = inject(CostingApi);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotifyService);
  private readonly businessDay = inject(BusinessDay);
  protected readonly approvals = inject(Approvals);
  protected readonly canChange = inject(AuthService).can(Permissions.InventoryManage);
  protected readonly channelLabels = channelLabels;
  protected readonly paymentLabels = paymentLabels;
  protected readonly voidLabels = voidLabels;

  protected readonly from = signal('');
  protected readonly to = signal('');
  protected readonly report = signal<SalesReport | null>(null);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly imported = signal<SalesImportResult | null>(null);

  constructor() {
    void (async () => {
      const today = await this.businessDay.today();
      const weekAgo = new Date(`${today}T12:00:00`);
      weekAgo.setDate(weekAgo.getDate() - 6);
      this.to.set(today);
      this.from.set(weekAgo.toISOString().slice(0, 10));
      await this.load();
    })();
    void this.approvals.refresh();
  }

  protected pick(from: string, to: string): void {
    if (/^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to) {
      this.from.set(from);
      this.to.set(to);
      void this.load();
    }
  }

  protected async newSale(): Promise<void> {
    const [menu, settings] = await Promise.all([
      firstValueFrom(this.api.menu()),
      firstValueFrom(this.costing.financialSettings()).catch(() => null),
    ]);
    if (!menu.items.some((i) => !i.isDeleted)) {
      this.notify.error(null, 'The menu has no items yet: add them on Menu first.');
      return;
    }
    const sale = await firstValueFrom(
      this.dialog
        .open(SaleDialog, { data: { menu, today: await this.businessDay.today(), taxPercent: settings?.taxPercent ?? null } satisfies SaleDialogData, width: '920px', maxWidth: '96vw' })
        .afterClosed(),
    );
    if (sale) {
      this.notify.info(`Sale recorded: ${this.company.money(sale.totalAmount)}, its stock taken.`);
      await this.load();
    }
  }

  protected async refund(sale: SalesReceipt, line: SalesLine): Promise<void> {
    const asked = line.quantity === 1 ? '1' : prompt(`Refund how many of ${line.quantity} × ${line.menuItemName}? · كم مرتجع`, String(line.quantity));
    const quantity = Number(asked);
    if (!asked || !Number.isInteger(quantity) || quantity < 1 || quantity > line.quantity) {
      return;
    }
    if (line.quantity === 1 && !confirm(`Refund ${line.menuItemName}? Its share of the bill goes into the refund and its stock back.`)) {
      return;
    }
    try {
      const saved = await firstValueFrom(this.api.refund(sale.id, line.publicId, quantity));
      this.notify.info(`Refunded: ${this.company.money(saved.refundedAmount)} handed back on this sale.`);
      await this.load();
    } catch (error) {
      this.notify.error(error, 'The refund could not be recorded.');
    }
  }

  protected async voidSale(sale: SalesReceipt): Promise<void> {
    const what = sale.reference ? `sale ${sale.reference}` : `the sale of ${sale.businessDate}`;
    if ((await this.approvals.delete('Sale', sale.id, what)) === 'Applied') {
      await this.load();
    }
  }

  protected async template(): Promise<void> {
    try {
      saveBlob(await firstValueFrom(this.api.salesTemplate()), 'sales-template.xlsx');
    } catch (error) {
      this.notify.error(error, 'The template could not be downloaded.');
    }
  }

  protected async import(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    this.busy.set(true);
    try {
      this.imported.set(await firstValueFrom(this.api.importSales(file)));
      await this.load();
    } catch (error) {
      this.notify.error(error, 'The sheet could not be imported.');
    } finally {
      this.busy.set(false);
    }
  }

  private async load(): Promise<void> {
    try {
      this.report.set(await firstValueFrom(this.api.sales(this.from(), this.to())));
      this.error.set(null);
    } catch (error) {
      this.error.set(errorMessage(error, 'The sales could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }
}
