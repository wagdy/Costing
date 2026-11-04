import { DatePipe } from '@angular/common';
import { Component, ElementRef, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  CostingApi,
  PurchaseBatchResult,
  PurchasePaymentMethod,
  SupplierBalance,
  paymentMethodLabels,
  paymentStatusLabels,
  Supplier,
} from '../../core/costing/costing.api';
import { AuthService } from '../../core/auth/auth.service';
import { Permissions } from '../../core/auth/permissions';
import { CostingAccess } from '../../core/costing/costing-tabs';
import { EndOfDay, EndOfDayApi, EndOfDayInvoice, EndOfDayInvoiceKind } from '../../core/costing/end-of-day.api';
import { MenuSalesApi } from '../../core/costing/menu-sales.api';
import { Employee } from '../../core/costing/staff';
import { errorMessage } from '../../core/http/error-message';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { NotifyService } from '../../core/ui/notify.service';
import { AdvanceEntry, AdvanceFields, advanceProblems, newAdvance } from './advance-fields';
import { Approvals } from './approvals';
import { PhotoSource, PhotoViewer } from './end-of-day-photo';
import { BusinessDay } from './financials';
import { FormChecks, FormProblem } from './form-checks';
import { InvoiceLine, InvoiceLines, InvoiceLinesTable, InvoiceSupplier, PurchaseCatalog } from './invoice-lines';
import { paperIcon, viewInvoicePaper } from './invoice-paper';
import { SupplierPaymentEntry, SupplierPaymentFields, newSupplierPayment, paymentProblems } from './supplier-payment-fields';
import { PickRow } from '../shared/pick-row';

// One invoice of the batch: its id, made here; its supplier, number and lines, entered as on the
// invoice screen; and the photo or scan of its paper, sent once the invoice is posted. On credit
// whatever the batch is paid by (credit). One handed in at the end of the day (handedIn) has its
// photo for its paper, shown above its lines to type them from, and the total written on it.
interface BatchBlock {
  id: string;
  supplier: InvoiceSupplier;
  number: string;
  editor: InvoiceLines;
  paper: File | null;
  credit: boolean;
  handedIn: HandedIn | null;
  // The photo above the lines, or hidden to give them the room.
  photoShown: boolean;
}

// An invoice handed in at the end of a day, as its block starts from it.
interface HandedIn {
  date: string;
  invoiceId: string;
  kind: EndOfDayInvoiceKind;
  reportedTotal: number;
  note: string | null;
  fileName: string;
  contentType: string;
  source: PhotoSource;
}

// What a paper can be, as the invoice screen takes it.
const paperTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const paperMaxBytes = 10 * 1024 * 1024;

// A supplier paid in the batch (سداد مورد): an old debt settled, no invoice and no stock, entered as
// on the new invoice screen.
type PaymentBlock = SupplierPaymentEntry;

// What is kept in the browser while a batch is being entered, so a reload does not lose it.
interface StoredBatch {
  invoiceDate: string;
  paymentMethod: PurchasePaymentMethod | null;
  revenueDate: string;
  // A paper chosen is not kept: a reload asks for it again.
  blocks: {
    id: string;
    supplierId: string | null;
    supplierName: string | null;
    number: string;
    lines: Omit<InvoiceLine, 'entry'>[];
    discount?: number | null;
    credit?: boolean;
    handedIn?: Omit<HandedIn, 'source'> | null;
  }[];
  payments?: PaymentBlock[];
  advances?: AdvanceEntry[];
}

const storageKey = 'otantik-till.purchase-batch';

// A day's purchases entered together (يومية المشتريات المجمعة): the date and how they were paid,
// chosen once, then an invoice for each supplier, each entered as on the invoice screen, and
// suppliers paid against what they are owed. Sent together, each invoice becomes its own posted
// invoice, its stock in and paid as chosen: on credit owed to its supplier, in cash paid for a
// manager and asked of one for anyone else. A payment is cash, never on credit, and never more than
// the supplier is owed; so is an employee's advance (سلفة), which comes off their pay for the month.
// None is saved unless all can be. Each invoice's paper (إرفاق الفاتورة) is attached once it is
// posted, kept in the invoices' archive as one entered alone. A batch not sent yet is kept in this
// browser, but for its papers.
@Component({
  selector: 'app-purchase-batch-page',
  providers: [PurchaseCatalog],
  imports: [PickRow,
    DatePipe,
    FormsModule,
    InvoiceLinesTable,
    MatAutocompleteModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
    MoneyPipe,
    PhotoViewer,
    RouterLink,
    SupplierPaymentFields,
    AdvanceFields,
  ],
  template: `
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    } @else if (error()) {
      <p class="error">{{ error() }}</p>
    } @else {
      @if (posted(); as result) {
        <section class="posted" role="status">
          <h2>
            {{ sentLabel(result) }}
            <span class="inline-ar">تم ترحيل اليومية</span>
          </h2>
          @if (result.invoices.length) {
          <div class="table-wrap">
            <table class="grid">
              <thead>
                <tr>
                  <th>Supplier<span class="ar">المورد</span></th>
                  <th>Invoice no.<span class="ar">رقم الفاتورة</span></th>
                  <th class="num">Net payable<span class="ar">الصافي المستحق</span></th>
                  <th>Payment<span class="ar">السداد</span></th>
                  <th>Paper<span class="ar">الفاتورة</span></th>
                </tr>
              </thead>
              <tbody>
                @for (inv of result.invoices; track inv.id) {
                  <tr>
                    <td><a [routerLink]="['/costing/purchases/invoices', inv.id]">{{ inv.supplierName ?? 'No supplier' }}</a></td>
                    <td>{{ inv.supplierInvoiceNumber ?? '—' }}</td>
                    <td class="num">{{ inv.total | money }}</td>
                    <td>{{ statusLabels[inv.paymentStatus].en }}<span class="ar">{{ statusLabels[inv.paymentStatus].ar }}</span></td>
                    <td class="paper-cell">
                      @if (inv.attachment; as paper) {
                        <button mat-button (click)="viewPaper(inv.id, paper.fileName)"><mat-icon>{{ icon(paper.fileName) }}</mat-icon> {{ paper.fileName }}</button>
                      } @else if (unsent().get(inv.id); as file) {
                        <span class="warn-text">{{ file.name }} not attached</span>
                        <button mat-button (click)="sendPaper(inv.id, file)" [disabled]="saving()"><mat-icon>refresh</mat-icon> Try again</button>
                      } @else {
                        <span class="muted">—</span>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          }
          @if (result.payments.length) {
            <div class="table-wrap">
              <table class="grid payments-made">
                <thead>
                  <tr>
                    <th>Supplier paid<span class="ar">المورد</span></th>
                    <th>Notes<span class="ar">ملاحظات</span></th>
                    <th class="num">Amount<span class="ar">القيمة</span></th>
                    <th>Payment<span class="ar">السداد</span></th>
                  </tr>
                </thead>
                <tbody>
                  @for (pay of result.payments; track pay.transactionId) {
                    <tr>
                      <td>{{ pay.supplier }}</td>
                      <td>{{ pay.notes ?? '—' }}</td>
                      <td class="num">{{ pay.amount | money }}</td>
                      <td>
                        @if (pay.outcome === 'Applied') {
                          Paid<span class="ar">تم السداد</span>
                        } @else {
                          Waits for a manager<span class="ar">بانتظار موافقة المدير</span>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
          @if (result.advances?.length) {
            <div class="table-wrap">
              <table class="grid payments-made">
                <thead>
                  <tr>
                    <th>Employee advanced<span class="ar">الموظف</span></th>
                    <th>Notes<span class="ar">ملاحظات</span></th>
                    <th class="num">Amount<span class="ar">القيمة</span></th>
                    <th>Advance<span class="ar">السلفة</span></th>
                  </tr>
                </thead>
                <tbody>
                  @for (adv of result.advances; track adv.transactionId) {
                    <tr>
                      <td>{{ adv.employee }}</td>
                      <td>{{ adv.notes ?? '—' }}</td>
                      <td class="num">{{ adv.amount | money }}</td>
                      <td>
                        @if (adv.outcome === 'Applied' && !adv.employeeId) {
                          Paid, shared among the staff<span class="ar">صُرفت، للتوزيع على الموظفين</span>
                        } @else if (adv.outcome === 'Applied') {
                          Paid, off their pay<span class="ar">صُرفت</span>
                        } @else {
                          Waits for a manager<span class="ar">بانتظار موافقة المدير</span>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
          <button mat-button (click)="posted.set(null)">Done</button>
        </section>
      }

      <p class="note">
        A day's purchases from several suppliers, entered together: the date and how they were paid once, then an invoice for each
        supplier. Each is posted as its own invoice, on its supplier's account. A supplier paid an old debt, with no invoice, is a
        supplier payment.
        <span class="inline-ar">يومية المشتريات المجمعة: كل مورد بفاتورة مستقلة.</span>
      </p>
      <div class="header">
        <mat-form-field subscriptSizing="dynamic">
          <mat-label>Invoice date · تاريخ الفواتير</mat-label>
          <input matInput type="date" [(ngModel)]="invoiceDate" (ngModelChange)="dateChosen()" aria-label="Invoice date"
            [errorStateMatcher]="checks.field('Invoice date')" />
          <mat-error>{{ checks.message('Invoice date') }}</mat-error>
        </mat-form-field>
        <mat-form-field subscriptSizing="dynamic" class="payment">
          <mat-label>Paid · طريقة الدفع</mat-label>
          <mat-select [(ngModel)]="paymentMethod" (ngModelChange)="changed()" aria-label="How they are paid" required
            [errorStateMatcher]="checks.field('How they are paid')">
            @for (m of paymentMethods; track m) {
              <mat-option [value]="m" [disabled]="m === 'Credit' && (payments().length > 0 || advances().length > 0)">{{ paymentLabels[m].en }} · {{ paymentLabels[m].ar }}</mat-option>
            }
          </mat-select>
          @if (paymentMethod && paymentMethod !== 'Credit' && anyCredit()) {
            <mat-hint>The cash invoices are paid so; those on credit are owed to their supplier.</mat-hint>
          } @else if (paymentMethod !== 'Credit' && (payments().length || advances().length)) {
            <mat-hint>{{ payments().length ? 'Supplier payments' : 'Advances' }} are cash: not on credit.</mat-hint>
          } @else if (paymentMethod === 'Credit') {
            <mat-hint>Each owed to its supplier until paid by a payment voucher.</mat-hint>
          } @else if (!paymentMethod) {
            <mat-hint>Required to post them.</mat-hint>
          }
          <mat-error>{{ checks.message('How they are paid') }}</mat-error>
        </mat-form-field>
        @if (paymentMethod === 'DayRevenue') {
          <mat-form-field subscriptSizing="dynamic">
            <mat-label>Takings of · إيراد يوم</mat-label>
            <input matInput type="date" [(ngModel)]="revenueDate" (ngModelChange)="changed()" [max]="today" aria-label="Takings of"
              [errorStateMatcher]="checks.field('Takings of')" />
            <mat-error>{{ checks.message('Takings of') }}</mat-error>
          </mat-form-field>
        }
      </div>
      @if (!approvals.canApprove() && paymentMethod && paymentMethod !== 'Credit') {
        <p class="ask">Each invoice's cash payment, each supplier payment and each advance goes to a manager for approval; the stock is in at once.</p>
      }

      @if (handedInDay(); as d) {
        <section class="handed-in" role="status" [class.waiting]="d.status !== 'Submitted'">
          <mat-icon>assignment_turned_in</mat-icon>
          <div class="handed-in-text">
            @if (d.status === 'Submitted') {
              <strong>End of day of {{ d.date | date: 'EEE d MMM' }} handed in <span class="inline-ar">تقفيل اليوم</span></strong>
              <span>
                {{ d.cashInvoices }} cash ({{ d.cashInvoicesTotal | money }}) · {{ d.creditInvoices }} on credit ({{ d.creditInvoicesTotal | money }})
                · by {{ d.submittedBy }}.
                @if (d.posted === d.invoices.length) {
                  {{ d.invoices.length ? 'All posted.' : 'No invoices.' }}
                } @else {
                  {{ d.invoices.length - d.posted }} to post below, each with its photo{{ d.posted ? '; ' + d.posted + ' posted already' : '' }}.
                }
              </span>
            } @else {
              <strong>The end of day of this date is not submitted yet <span class="inline-ar">لم يتم إرسال تقفيل هذا اليوم بعد</span></strong>
              <span>{{ d.invoices.length }} {{ d.invoices.length === 1 ? 'invoice' : 'invoices' }} handed in so far: they come here once it is submitted.</span>
            }
          </div>
          @if (canCloseDay()) {
            <a mat-button [routerLink]="['/costing/end-of-day']" [queryParams]="{ date: d.date }">Open · فتح</a>
          }
        </section>
      }

      @for (block of blocks(); track block.id; let i = $index) {
        <section class="block" [class.from-day]="!!block.handedIn" [attr.aria-label]="'Invoice ' + (i + 1)">
          <div class="block-head">
            <h3>Invoice {{ i + 1 }} <span class="inline-ar">فاتورة {{ i + 1 }}</span></h3>
            @if (block.handedIn; as h) {
              <span class="tag teal" title="Handed in at the end of the day">Handed in · {{ h.kind === 'Cash' ? 'cash' : 'on credit' }}<span class="ar">من التقفيل</span></span>
            }
            <mat-form-field subscriptSizing="dynamic" class="supplier">
              <mat-label>Supplier · المورد</mat-label>
              <input matInput [(ngModel)]="block.supplier.entry" (ngModelChange)="block.supplier.entered($event); changed()" [matAutocomplete]="suppliersList"
                placeholder="Choose or type a name" [attr.aria-label]="'Invoice ' + (i + 1) + ', supplier'"
                [errorStateMatcher]="checks.field('Invoice ' + (i + 1) + ', supplier')" />
              <mat-icon matSuffix>arrow_drop_down</mat-icon>
              <mat-autocomplete #suppliersList="matAutocomplete" [displayWith]="block.supplier.label" panelClass="pick-panel" [panelWidth]="380" [autoActiveFirstOption]="true">
                @for (s of block.supplier.matches(); track s.id) {
                  <mat-option [value]="s"><app-pick-row [name]="s.name" kind="supplier" [detail]="supplierDetail(s)" [cost]="s.invoices ? s.invoices + (s.invoices === 1 ? ' invoice' : ' invoices') : null" /></mat-option>
                }
                @if (block.supplier.typedNew(); as name) {
                  <mat-option [value]="{ addNew: name }" class="add-new"><mat-icon>add</mat-icon> Add new supplier: "{{ name }}"</mat-option>
                }
              </mat-autocomplete>
              @if (block.supplier.unresolved()) {
                <mat-hint class="warn-text">Choose the supplier from the list, or add it.</mat-hint>
              } @else if ((paymentMethod === 'Credit' || block.credit) && !block.supplier.id) {
                <mat-hint class="warn-text">On credit, it is owed to a supplier: choose one.</mat-hint>
              }
              <mat-error>{{ checks.message('Invoice ' + (i + 1) + ', supplier') }}</mat-error>
            </mat-form-field>
            <mat-form-field subscriptSizing="dynamic" class="number">
              <mat-label>Invoice no. · رقم الفاتورة</mat-label>
              <input matInput [(ngModel)]="block.number" (ngModelChange)="changed()" maxlength="64" data-western-digits [attr.aria-label]="'Invoice ' + (i + 1) + ', number'" />
            </mat-form-field>
            <div class="paid-as">
              <mat-button-toggle-group [value]="paymentMethod === 'Credit' || block.credit ? 'Credit' : 'Cash'" (change)="payAs(block, $event.value)"
                [disabled]="paymentMethod === 'Credit'" hideSingleSelectionIndicator [attr.aria-label]="'Invoice ' + (i + 1) + ', paid'">
                <mat-button-toggle value="Cash">Cash · نقدي</mat-button-toggle>
                <mat-button-toggle value="Credit">On credit · آجل</mat-button-toggle>
              </mat-button-toggle-group>
              @if (block.handedIn; as h) {
                @if (h.kind === 'Cash' && (paymentMethod === 'Credit' || block.credit)) {
                  <small class="warn-text">Handed in as paid in cash · سُلمت كنقدي</small>
                } @else if (h.kind === 'Credit' && paymentMethod !== 'Credit' && !block.credit) {
                  <small class="warn-text">Handed in as on credit · سُلمت كآجل</small>
                }
              }
            </div>
            <div class="paper">
              <input #file type="file" [accept]="paperAccept" hidden (change)="choosePaper(block, file)" [attr.aria-label]="'Invoice ' + (i + 1) + ', paper'" />
              @if (block.handedIn; as h) {
                <button mat-button (click)="block.photoShown = !block.photoShown; changed()" [attr.aria-label]="'Invoice ' + (i + 1) + ', ' + (block.photoShown ? 'hide' : 'show') + ' the photo'">
                  <mat-icon>{{ block.photoShown ? 'hide_image' : 'image' }}</mat-icon> {{ block.photoShown ? 'Hide photo' : 'Show photo' }}
                </button>
              } @else if (block.paper; as p) {
                <span class="paper-name" [title]="p.name"><mat-icon>{{ icon(p.name) }}</mat-icon> {{ p.name }}</span>
                <button mat-icon-button (click)="file.click()" [disabled]="saving()" title="Replace · استبدال"
                  [attr.aria-label]="'Invoice ' + (i + 1) + ', replace the paper'">
                  <mat-icon>swap_horiz</mat-icon>
                </button>
                <button mat-icon-button (click)="dropPaper(block)" [disabled]="saving()" [attr.aria-label]="'Invoice ' + (i + 1) + ', take the paper off'">
                  <mat-icon>close</mat-icon>
                </button>
              } @else {
                <button mat-stroked-button (click)="file.click()" [disabled]="saving()">
                  <mat-icon>add_a_photo</mat-icon> Attach the paper <span class="inline-ar">إرفاق الفاتورة</span>
                </button>
              }
            </div>
            <span class="spacer"></span>
            @if (block.handedIn; as h) {
              @let left = leftOf(block);
              <span class="reported" [class.matched]="left === 0" [attr.aria-label]="'Invoice ' + (i + 1) + ', reported total'">
                Reported · المُبلغ: <strong>{{ h.reportedTotal | money }}</strong>
                @if (left === 0) {
                  <span class="match"><mat-icon>check_circle</mat-icon> Matched · مطابق</span>
                } @else if (left > 0) {
                  <span class="gap">{{ left | money }} to go · متبقي</span>
                } @else {
                  <span class="gap">{{ -left | money }} over · زيادة</span>
                }
              </span>
            }
            <strong class="block-total">{{ block.editor.total() | money }}</strong>
            <button mat-icon-button (click)="removeBlock(i)" [disabled]="blocks().length === 1 && !payments().length && !advances().length" [attr.aria-label]="'Take invoice ' + (i + 1) + ' off the batch'">
              <mat-icon>delete</mat-icon>
            </button>
          </div>
          @if (block.handedIn; as h) {
            @if (h.note) {
              <p class="handed-note muted"><mat-icon>sticky_note_2</mat-icon> {{ h.note }}</p>
            }
            <div class="transcribe">
              @if (block.photoShown) {
                <app-photo-viewer [source]="h.source" [fileName]="h.fileName" />
              }
              <app-invoice-lines [editor]="block.editor" [label]="'Invoice ' + (i + 1) + ', '" [checks]="checks" />
            </div>
          } @else {
            <app-invoice-lines [editor]="block.editor" [label]="'Invoice ' + (i + 1) + ', '" [checks]="checks" />
          }
        </section>
      }

      @for (pay of payments(); track pay.id; let j = $index) {
        <section class="block payment-block" [attr.aria-label]="'Supplier payment ' + (j + 1)">
          <div class="block-head">
            <h3>Supplier payment {{ j + 1 }} <span class="inline-ar">سداد مورد {{ j + 1 }}</span></h3>
            <app-supplier-payment-fields [payment]="pay" [suppliers]="owedSuppliers()" [owed]="owedBefore(j)" [afterAbove]="paidAbove(j) > 0"
              [label]="'Supplier payment ' + (j + 1)" [checks]="checks" (changed)="changed()" />
            <span class="spacer"></span>
            <button mat-icon-button (click)="removePayment(j)" [attr.aria-label]="'Take supplier payment ' + (j + 1) + ' off the batch'">
              <mat-icon>delete</mat-icon>
            </button>
          </div>
        </section>
      }

      @for (adv of advances(); track adv.id; let k = $index) {
        <section class="block payment-block" [attr.aria-label]="'Advance ' + (k + 1)">
          <div class="block-head">
            <h3>Employee advance {{ k + 1 }} <span class="inline-ar">سلفة {{ k + 1 }}</span></h3>
            <app-advance-fields [advance]="adv" [employees]="employees()" [label]="'Advance ' + (k + 1)" [checks]="checks" (changed)="changed()" />
            <span class="spacer"></span>
            <button mat-icon-button (click)="removeAdvance(k)" [attr.aria-label]="'Take advance ' + (k + 1) + ' off the batch'">
              <mat-icon>delete</mat-icon>
            </button>
          </div>
        </section>
      }

      <div class="toolbar actions">
        <button mat-stroked-button (click)="addBlock()"><mat-icon>add</mat-icon> Add another invoice <span class="inline-ar">فاتورة أخرى</span></button>
        <button mat-stroked-button (click)="addPayment()" [disabled]="paymentMethod === 'Credit'">
          <mat-icon>payments</mat-icon> Add supplier payment <span class="inline-ar">سداد مورد</span>
        </button>
        @if (canAdvance()) {
          <button mat-stroked-button (click)="addAdvance()" [disabled]="paymentMethod === 'Credit'">
            <mat-icon>request_quote</mat-icon> Add employee advance <span class="inline-ar">سلفة موظف</span>
          </button>
        }
        <span class="spacer"></span>
        <span class="batch-total">{{ countLabel() }} · <strong>{{ total() | money }}</strong></span>
        <button mat-button (click)="startAgain()" [disabled]="saving()">Start again</button>
        <button mat-flat-button (click)="submit()" [disabled]="saving()">
          <mat-icon>inventory</mat-icon> Submit batch <span class="inline-ar">ترحيل اليومية</span>
        </button>
      </div>
      @if (saving()) {
        <mat-progress-bar mode="indeterminate" />
      }
      @if (problems(); as p) {
        <p class="error problems" role="alert">{{ p }}</p>
      }
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 12px;
      margin-bottom: 12px;
    }
    .payment {
      min-width: 230px;
    }
    .block {
      margin: 0 0 16px;
      padding: 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 12px;
    }
    .block-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 12px;
      margin-bottom: 8px;

      h3 {
        margin: 0;
        font: var(--mat-sys-title-small);
      }
    }
    /* Sized, so the supplier, number, paper and total share one line. */
    .supplier {
      width: 250px;
    }
    .number {
      width: 190px;
    }
    .payment-block {
      border-style: dashed;
    }
    .block-total,
    .batch-total strong {
      font: var(--mat-sys-title-medium);
    }
    .add-new {
      color: var(--mat-sys-primary);
      font-weight: 500;
    }
    .warn-text {
      color: var(--mat-sys-error);
    }
    .actions {
      align-items: center;
      margin-top: 4px;
    }
    .problems {
      white-space: pre-line;
    }
    .ask {
      padding: 8px 10px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--app-warn) 14%, transparent);
    }
    .paper {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .paper-name {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      max-width: 140px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--app-slate-700, #334155);

      mat-icon {
        flex: none;
        color: var(--app-slate-500, #64748b);
      }
    }
    .paper-cell {
      white-space: nowrap;
    }
    .paid-as {
      display: grid;
      gap: 2px;
    }
    .from-day {
      border-color: color-mix(in srgb, var(--tag-teal-fg, #0f766e) 35%, var(--mat-sys-outline-variant));
    }
    .handed-in {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      margin: 0 0 14px;
      padding: 10px 12px;
      border-radius: 12px;
      background: var(--tag-teal-bg, #e0f4f3);
      color: var(--tag-teal-fg, #0f766e);

      &.waiting {
        background: var(--tag-warn-bg, #fff3d6);
        color: var(--tag-warn-fg, #8a5300);
      }
      a {
        margin-left: auto;
      }
    }
    .handed-in-text {
      display: grid;
      gap: 2px;
    }
    .handed-note {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 0 0 8px;
    }
    .reported {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px 8px;
      padding: 4px 10px;
      border-radius: 999px;
      background: var(--mat-sys-surface-container-high);
      font: var(--mat-sys-label-large);
      font-variant-numeric: tabular-nums;

      .gap {
        color: var(--app-warn);
      }
      &.matched {
        background: var(--tag-ok-bg, #e6f4ea);
        color: var(--tag-ok-fg, #1e6b34);
      }
      .match {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        font-weight: 600;

        mat-icon {
          width: 18px;
          height: 18px;
          font-size: 18px;
        }
      }
    }
    /* The photo right above its lines, as wide as the block: the lines need some 980px, which leaves a photo beside them too
       narrow to read without zooming. Hidden, the lines have the block to themselves. */
    .transcribe {
      display: grid;
      gap: 12px;

      app-photo-viewer {
        --viewer-height: max(360px, 44vh);
      }
    }
    .posted {
      margin-bottom: 16px;
      padding: 12px;
      border-radius: 12px;
      background: var(--mat-sys-secondary-container);

      h2 {
        margin: 0 0 8px;
        font: var(--mat-sys-title-medium);
      }
    }
  `,
})
export class PurchaseBatchPage {
  // A supplier as the picker shows it: whom to call there, and how.
  protected supplierDetail(supplier: Supplier): string | null {
    return [supplier.contactPerson, supplier.phone].filter(Boolean).join(' · ') || null;
  }

  private readonly api = inject(CostingApi);
  private readonly notify = inject(NotifyService);
  private readonly businessDay = inject(BusinessDay);
  private readonly catalog = inject(PurchaseCatalog);
  protected readonly approvals = inject(Approvals);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly dialog = inject(MatDialog);
  private readonly endOfDay = inject(EndOfDayApi);
  private readonly route = inject(ActivatedRoute);
  // The end of day of the batch's date, as handed in: its invoices are the blocks.
  protected readonly handedInDay = signal<EndOfDay | null>(null);

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  // What stopped the batch, each problem by its invoice or payment; nothing was saved.
  protected readonly problems = signal<string | null>(null);
  // The invoices and payments the last batch made.
  protected readonly posted = signal<PurchaseBatchResult | null>(null);
  // Papers of the last batch that could not be sent, by their invoice: tried again from there.
  protected readonly unsent = signal(new Map<string, File>());
  protected readonly paperAccept = paperTypes.join(',');
  protected readonly icon = paperIcon;
  protected readonly blocks = signal<BatchBlock[]>([this.block()]);
  protected readonly payments = signal<PaymentBlock[]>([]);
  protected readonly advances = signal<AdvanceEntry[]>([]);
  // Who can be advanced: the staff still working. Only for whoever works Financials.
  private readonly staffApi = inject(MenuSalesApi);
  private readonly access = inject(CostingAccess);
  private readonly auth = inject(AuthService);
  protected readonly canAdvance = computed(() => this.access.has('Financials'));
  protected readonly canCloseDay = computed(() => this.access.has('EndOfDay'));
  // Some invoice on credit in a batch paid in cash.
  protected readonly anyCredit = computed(() => {
    this.headerVersion();
    return this.blocks().some((b) => b.credit);
  });
  private readonly staff = signal<Employee[]>([]);
  protected readonly employees = computed(() => this.staff().filter((e) => e.isActive));
  // What each supplier is owed, for paying them: only those owed something can be paid.
  private readonly balances = signal<SupplierBalance[]>([]);
  protected readonly owedSuppliers = computed(() => this.balances().filter((b) => b.balance > 0));

  protected invoiceDate = PurchaseBatchPage.today();
  protected paymentMethod: PurchasePaymentMethod | null = null;
  protected revenueDate = PurchaseBatchPage.today();
  protected today = PurchaseBatchPage.today();
  protected readonly paymentMethods: PurchasePaymentMethod[] = ['Safe', 'DayRevenue', 'Credit'];
  protected readonly paymentLabels = paymentMethodLabels;
  protected readonly statusLabels = paymentStatusLabels;

  // The header's fields are plain; this bumps so what reads them follows.
  private readonly headerVersion = signal(0);

  protected readonly total = computed(() => {
    this.headerVersion();
    return (
      this.blocks().reduce((sum, b) => sum + b.editor.total(), 0) +
      this.payments().reduce((sum, p) => sum + (p.amount ?? 0), 0) +
      this.advances().reduce((sum, a) => sum + (a.amount ?? 0), 0)
    );
  });

  // "2 invoices, 1 payment, 1 advance".
  protected readonly countLabel = computed(() => {
    const [invoices, payments, advances] = [this.blocks().length, this.payments().length, this.advances().length];
    const parts = [
      invoices ? `${invoices} ${invoices === 1 ? 'invoice' : 'invoices'}` : '',
      payments ? `${payments} ${payments === 1 ? 'payment' : 'payments'}` : '',
      advances ? `${advances} ${advances === 1 ? 'advance' : 'advances'}` : '',
    ];
    return parts.filter(Boolean).join(', ') || 'Nothing yet';
  });

  // Every invoice ready as on the invoice screen, each with its supplier on credit; every payment
  // to a supplier owed it, never on credit; the payment chosen, and from a day's takings, the day.
  // Each said by its field.
  protected readonly missing = computed((): FormProblem[] => {
    this.headerVersion();
    const blocks = this.blocks();
    const payments = this.payments();
    const advances = this.advances();
    const found: FormProblem[] = [];
    if (!this.invoiceDate) {
      found.push({ where: 'Invoice date', what: 'choose the date', field: 'Invoice date' });
    }
    if (this.paymentMethod === null) {
      found.push({ where: 'Paid', what: 'choose how they were paid', field: 'How they are paid' });
    } else if (this.paymentMethod === 'DayRevenue' && !this.revenueDate) {
      found.push({ where: 'Takings of', what: 'choose the day', field: 'Takings of' });
    } else if (this.paymentMethod === 'Credit' && (payments.length || advances.length)) {
      found.push({
        where: 'Paid',
        what: `${payments.length ? 'supplier payments' : 'advances'} are cash: choose the safe or a day's takings`,
        field: 'How they are paid',
      });
    }
    if (!blocks.length && !payments.length && !advances.length) {
      found.push({ where: 'The batch', what: 'add an invoice, a supplier payment or an advance', field: '' });
    }
    blocks.forEach((b, i) => {
      b.supplier.version();
      const name = `Invoice ${i + 1}`;
      if (b.supplier.unresolved()) {
        found.push({ where: name, what: 'choose the supplier from the list, or add it', field: `${name}, supplier` });
      } else if ((this.paymentMethod === 'Credit' || b.credit) && b.supplier.id === null) {
        found.push({ where: name, what: 'on credit, choose who it is owed to', field: `${name}, supplier` });
      }
      if (b.handedIn && this.invoiceDate && b.handedIn.date !== this.invoiceDate) {
        found.push({ where: name, what: `it was handed in on ${b.handedIn.date}: post it with that date`, field: 'Invoice date' });
      }
      found.push(...b.editor.problems(`${name}, `));
    });
    payments.forEach((p, j) => found.push(...paymentProblems(p, this.owedBefore(j), `Supplier payment ${j + 1}`)));
    advances.forEach((a, k) => found.push(...advanceProblems(a, `Advance ${k + 1}`)));
    return found;
  });
  protected readonly ready = computed(() => this.missing().length === 0);
  // Submit batch is never greyed out: clicked with something missing, it says what.
  protected readonly checks = new FormChecks(() => this.missing());

  constructor() {
    // Kept in this browser as it is typed, until it is sent.
    effect(() => {
      this.headerVersion();
      const blocks = this.blocks();
      blocks.forEach((b) => {
        b.editor.version();
        b.supplier.version();
      });
      if (!this.loading()) {
        this.store();
      }
    });
    void this.load();
  }

  protected changed(): void {
    this.headerVersion.update((v) => v + 1);
    this.problems.set(null);
  }

  // Another date: the invoices handed in on the one before, not typed into yet, go; the new
  // date's come.
  protected dateChosen(): void {
    this.blocks.update((blocks) => blocks.filter((b) => !b.handedIn || b.handedIn.date === this.invoiceDate || !this.untouched(b, true)));
    if (!this.blocks().length && !this.payments().length && !this.advances().length) {
      this.blocks.set([this.block()]);
    }
    this.changed();
    void this.loadHandedIn();
  }

  protected payAs(block: BatchBlock, paid: 'Cash' | 'Credit'): void {
    block.credit = paid === 'Credit';
    this.changed();
  }

  // What is left of the total handed in once the lines, after their discounts, are typed: none
  // when they match it.
  protected leftOf(block: BatchBlock): number {
    return block.handedIn ? Math.round((block.handedIn.reportedTotal - block.editor.total()) * 100) / 100 : 0;
  }

  protected addBlock(): void {
    this.blocks.update((blocks) => [...blocks, this.block()]);
  }

  protected removeBlock(index: number): void {
    this.blocks.update((blocks) => blocks.filter((_, i) => i !== index));
  }

  // A supplier payment added: the empty invoice the batch starts with goes, so a batch of payments
  // alone can be sent.
  protected addPayment(): void {
    const blocks = this.blocks();
    if (blocks.length === 1 && this.untouched(blocks[0])) {
      this.blocks.set([]);
    }
    this.payments.update((payments) => [...payments, newSupplierPayment()]);
    this.changed();
  }

  protected removePayment(index: number): void {
    this.payments.update((payments) => payments.filter((_, i) => i !== index));
    if (!this.payments().length && !this.advances().length && !this.blocks().length) {
      this.blocks.set([this.block()]);
    }
    this.changed();
  }

  // An advance added: as a payment, the empty invoice the batch starts with goes.
  protected addAdvance(): void {
    const blocks = this.blocks();
    if (blocks.length === 1 && this.untouched(blocks[0])) {
      this.blocks.set([]);
    }
    this.advances.update((advances) => [...advances, newAdvance()]);
    this.changed();
  }

  protected removeAdvance(index: number): void {
    this.advances.update((advances) => advances.filter((_, i) => i !== index));
    if (!this.payments().length && !this.advances().length && !this.blocks().length) {
      this.blocks.set([this.block()]);
    }
    this.changed();
  }

  // What the supplier of payment `index` is owed, less what the payments above it pay them.
  protected owedBefore(index: number): number | null {
    const pay = this.payments()[index];
    const owed = pay?.supplierId ? this.balances().find((b) => b.supplierId === pay.supplierId)?.balance : undefined;
    return owed === undefined ? null : Math.round((owed - this.paidAbove(index)) * 100) / 100;
  }

  protected paidAbove(index: number): number {
    const supplierId = this.payments()[index]?.supplierId;
    return this.payments()
      .slice(0, index)
      .filter((p) => p.supplierId === supplierId)
      .reduce((sum, p) => sum + (p.amount ?? 0), 0);
  }

  // A photo or scan of the invoice's paper, kept with it until the batch is sent.
  protected choosePaper(block: BatchBlock, input: HTMLInputElement): void {
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    if (!paperTypes.includes(file.type)) {
      this.notify.error(null, 'Attach a photo (JPEG, PNG or WebP) or a PDF of the invoice.');
      return;
    }
    if (file.size > paperMaxBytes) {
      this.notify.error(null, 'The file must be under 10 MB.');
      return;
    }
    block.paper = file;
    this.changed();
  }

  protected dropPaper(block: BatchBlock): void {
    block.paper = null;
    this.changed();
  }

  protected viewPaper(invoiceId: string, fileName: string): void {
    viewInvoicePaper(this.dialog, invoiceId, fileName);
  }

  // A posted invoice's paper, attached to it in the archive. Refused, it waits to be tried again,
  // and says so unless the batch says it (say).
  protected async sendPaper(invoiceId: string, file: File, say = true): Promise<boolean> {
    try {
      const saved = await firstValueFrom(this.api.attachPurchaseInvoiceFile(invoiceId, file));
      this.posted.update((result) => result && { ...result, invoices: result.invoices.map((i) => (i.id === invoiceId ? saved : i)) });
      this.unsent.update((unsent) => {
        const left = new Map(unsent);
        left.delete(invoiceId);
        return left;
      });
      return true;
    } catch (error) {
      this.unsent.update((unsent) => new Map(unsent).set(invoiceId, file));
      if (say) {
        this.notify.error(error, `${file.name} could not be attached.`);
      }
      return false;
    }
  }

  // "2 invoices posted, 1 supplier paid, 1 advance paid".
  protected sentLabel(result: PurchaseBatchResult): string {
    const [invoices, payments, advances] = [result.invoices.length, result.payments.length, result.advances?.length ?? 0];
    return [
      invoices ? `${invoices === 1 ? '1 invoice' : `${invoices} invoices`} posted` : '',
      payments ? `${payments === 1 ? '1 supplier' : `${payments} suppliers`} paid` : '',
      advances ? `${advances === 1 ? '1 advance' : `${advances} advances`} paid` : '',
    ]
      .filter(Boolean)
      .join(', ');
  }

  protected startAgain(): void {
    this.checks.clear();
    this.blocks.set([this.block()]);
    this.payments.set([]);
    this.advances.set([]);
    this.paymentMethod = null;
    this.invoiceDate = this.today;
    this.revenueDate = this.today;
    this.problems.set(null);
    this.changed();
    void this.loadHandedIn();
  }

  // Sent together: each invoice made and posted, or none. Done, the batch starts again with new ids;
  // refused, it stays on screen with each problem said by its invoice.
  protected async submit(): Promise<void> {
    if (this.saving() || !this.checks.passed(this.notify, this.host.nativeElement) || !this.paymentMethod) {
      return;
    }
    this.saving.set(true);
    this.problems.set(null);
    // Each paper goes to its invoice once it is posted.
    const papers = this.blocks().filter((b) => b.paper).map((b) => ({ invoiceId: b.id, file: b.paper! }));
    try {
      const made = await firstValueFrom(
        this.api.postPurchaseBatch({
          invoiceDate: this.invoiceDate,
          paymentMethod: this.paymentMethod,
          revenueDate: this.paymentMethod === 'DayRevenue' ? this.revenueDate : null,
          invoices: this.blocks().map((b) => ({
            invoiceId: b.id,
            supplierId: b.supplier.id,
            supplierInvoiceNumber: b.number.trim() || null,
            lines: b.editor.toSave(),
            discount: b.editor.discount() ?? 0,
            onCredit: b.credit,
            endOfDayInvoiceId: b.handedIn?.invoiceId ?? null,
          })),
          payments: this.payments().map((p) => ({ transactionId: p.id, supplierId: p.supplierId!, amount: p.amount!, notes: p.notes.trim() || null })),
          advances: this.advances().map((a) => ({ transactionId: a.id, employeeId: a.employeeId, amount: a.amount!, notes: a.notes.trim() || null })),
        }),
      );
      this.posted.set(made);
      this.unsent.set(new Map());
      this.checks.clear();
      this.blocks.set([this.block()]);
      this.payments.set([]);
      this.advances.set([]);
      this.changed();
      void this.approvals.refresh();
      void this.loadHandedIn();
      const sent = await Promise.all(papers.map((p) => this.sendPaper(p.invoiceId, p.file, false)));
      const attached = sent.filter((ok) => ok).length;
      const pending =
        made.invoices.filter((i) => i.paymentStatus === 'Pending').length +
        made.payments.filter((p) => p.outcome === 'Requested').length +
        (made.advances ?? []).filter((a) => a.outcome === 'Requested').length;
      const said =
        `${this.sentLabel(made)}.` +
        (attached ? ` ${attached === 1 ? '1 paper' : `${attached} papers`} attached.` : '') +
        (pending ? ` ${pending === 1 ? '1 payment waits' : `${pending} payments wait`} for a manager's approval.` : '');
      if (attached < papers.length) {
        this.notify.error(null, `${said} ${papers.length - attached === 1 ? 'A paper' : 'Some papers'} could not be attached: try again below.`);
      } else {
        this.notify.info(said);
      }
      await Promise.all([this.catalog.loadMaterials(), this.loadBalances()]);
    } catch (error) {
      this.problems.set(errorMessage(error, 'The batch could not be posted.'));
    } finally {
      this.saving.set(false);
    }
  }

  private block(): BatchBlock {
    return {
      id: crypto.randomUUID(),
      supplier: new InvoiceSupplier(this.catalog),
      number: '',
      editor: new InvoiceLines(this.catalog),
      paper: null,
      credit: false,
      handedIn: null,
      photoShown: true,
    };
  }

  // An invoice handed in at the end of the day, as a block: its supplier, paid as it was, its photo.
  private handedInBlock(date: string, invoice: EndOfDayInvoice): BatchBlock {
    const block = this.block();
    block.supplier.set(invoice.supplierId, invoice.supplier);
    block.credit = invoice.kind === 'Credit';
    block.handedIn = {
      date,
      invoiceId: invoice.id,
      kind: invoice.kind,
      reportedTotal: invoice.reportedTotal,
      note: invoice.note,
      fileName: invoice.photo.fileName,
      contentType: invoice.photo.contentType,
      source: this.photoSource(date, invoice.id),
    };
    return block;
  }

  private photoSource(date: string, invoiceId: string): PhotoSource {
    return () => this.endOfDay.photo(date, invoiceId);
  }

  // The end of day of the batch's date: each invoice handed in and not posted yet, a block of its
  // own (once), the empty one the batch starts with going; one posted since, gone from here. Paid
  // as not chosen yet: out of that day's takings, or on credit when every one is.
  private async loadHandedIn(): Promise<void> {
    const date = this.invoiceDate;
    if (!date) {
      this.handedInDay.set(null);
      return;
    }
    let day: EndOfDay | null;
    try {
      day = await firstValueFrom(this.endOfDay.day(date));
    } catch {
      day = null;
    }
    if (this.invoiceDate !== date) {
      return;
    }
    this.handedInDay.set(day);
    if (day?.status !== 'Submitted') {
      return;
    }
    const posted = new Set(day.invoices.filter((i) => i.purchaseInvoiceId).map((i) => i.id));
    let blocks = this.blocks().filter((b) => !(b.handedIn && b.handedIn.date === date && posted.has(b.handedIn.invoiceId)));
    const present = new Set(blocks.filter((b) => b.handedIn).map((b) => b.handedIn!.invoiceId));
    const fresh = day.invoices.filter((i) => !i.purchaseInvoiceId && !present.has(i.id)).map((i) => this.handedInBlock(date, i));
    if (fresh.length) {
      if (blocks.length === 1 && this.untouched(blocks[0])) {
        blocks = [];
      }
      blocks = [...fresh, ...blocks];
      if (this.paymentMethod === null) {
        const anyCash = fresh.some((b) => !b.credit);
        this.paymentMethod = anyCash ? 'DayRevenue' : 'Credit';
        this.revenueDate = date;
      }
    }
    this.blocks.set(blocks.length ? blocks : [this.block()]);
    this.changed();
  }

  // Nothing entered on it yet; one handed in counts as nothing entered unless asked (handedIn).
  private untouched(block: BatchBlock, handedIn = false): boolean {
    return (
      (handedIn || !block.handedIn) &&
      (handedIn || !block.supplier.id) &&
      !(typeof block.supplier.entry === 'string' && block.supplier.entry.trim()) &&
      !block.number.trim() &&
      !block.paper &&
      block.editor.lines().every((l) => !l.rawMaterialId && !l.expenseItemId)
    );
  }

  // Only for whoever works Financials; without it, no advance can be added.
  private async loadEmployees(): Promise<void> {
    if (this.canAdvance()) {
      try {
        this.staff.set(await firstValueFrom(this.staffApi.staff()));
      } catch {
        this.staff.set([]);
      }
    }
  }

  private async loadBalances(): Promise<void> {
    this.balances.set(await firstValueFrom(this.api.supplierBalances()));
  }

  private store(): void {
    const batch: StoredBatch = {
      invoiceDate: this.invoiceDate,
      paymentMethod: this.paymentMethod,
      revenueDate: this.revenueDate,
      blocks: this.blocks().map((b) => ({
        id: b.id,
        supplierId: b.supplier.id,
        supplierName: typeof b.supplier.entry === 'string' ? b.supplier.entry : null,
        number: b.number,
        lines: b.editor.lines().map(({ entry, ...line }) => ({ ...line, ...(typeof entry === 'string' ? { typed: entry } : {}) })),
        discount: b.editor.discount(),
        credit: b.credit,
        handedIn: b.handedIn ? (({ source, ...kept }) => kept)(b.handedIn) : null,
      })),
      payments: this.payments().map((p) => ({ ...p })),
      advances: this.advances().map((a) => ({ ...a })),
    };
    try {
      const empty =
        !batch.payments?.length &&
        !batch.advances?.length &&
        batch.blocks.length === 1 &&
        !batch.blocks[0].supplierId &&
        batch.blocks[0].lines.every((l) => !l.rawMaterialId && !l.expenseItemId);
      if (empty && !batch.paymentMethod) {
        localStorage.removeItem(storageKey);
      } else {
        localStorage.setItem(storageKey, JSON.stringify(batch));
      }
    } catch {
      // Storage refused: the batch is only on screen.
    }
  }

  // A batch left unsent in this browser, back on screen as it was.
  private restore(): void {
    let stored: StoredBatch | null = null;
    try {
      stored = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as StoredBatch | null;
    } catch {
      stored = null;
    }
    if (!stored?.blocks?.length && !stored?.payments?.length && !stored?.advances?.length) {
      return;
    }
    this.advances.set((stored.advances ?? []).map((a) => ({ id: a.id, employeeId: a.employeeId ?? null, amount: a.amount ?? null, notes: a.notes ?? '' })));
    this.payments.set((stored.payments ?? []).map((p) => ({ id: p.id, supplierId: p.supplierId ?? null, amount: p.amount ?? null, notes: p.notes ?? '' })));
    this.invoiceDate = stored.invoiceDate || this.today;
    this.paymentMethod = stored.paymentMethod;
    this.revenueDate = stored.revenueDate || this.today;
    this.blocks.set(
      (stored.blocks ?? []).map((b) => {
        const block = this.block();
        block.id = b.id;
        block.number = b.number ?? '';
        if (b.supplierId) {
          block.supplier.set(b.supplierId, null);
        } else if (b.supplierName) {
          block.supplier.entry = b.supplierName;
        }
        block.editor.lines.set(
          b.lines.map((l) => {
            const { typed, ...line } = l as Omit<InvoiceLine, 'entry'> & { typed?: string };
            const entry =
              (line.rawMaterialId && this.catalog.materials().find((m) => m.id === line.rawMaterialId)) ||
              (line.expenseItemId && this.catalog.expenses().find((e) => e.id === line.expenseItemId)) ||
              typed;
            return { ...line, discount: line.discount ?? 0, entry };
          }),
        );
        block.editor.discount.set(b.discount ?? 0);
        block.editor.touch();
        block.credit = b.credit ?? false;
        block.handedIn = b.handedIn ? { ...b.handedIn, source: this.photoSource(b.handedIn.date, b.handedIn.invoiceId) } : null;
        return block;
      }),
    );
  }

  private async load(): Promise<void> {
    void this.businessDay.today().then((today) => {
      // Not yet chosen: the business day.
      if (this.revenueDate === this.today) {
        this.revenueDate = today;
      }
      const moved = this.invoiceDate === this.today && this.invoiceDate !== today;
      if (this.invoiceDate === this.today) {
        this.invoiceDate = today;
      }
      this.today = today;
      this.changed();
      // Loaded already on the browser's date: the business day's end of day instead.
      if (moved && !this.loading()) {
        void this.loadHandedIn();
      }
    });
    try {
      await Promise.all([this.catalog.load(), this.loadBalances(), this.loadEmployees()]);
      this.restore();
      // Opened on a day (from the end of the day): that day's batch.
      const asked = this.route.snapshot.queryParamMap.get('date');
      if (asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked !== this.invoiceDate) {
        this.invoiceDate = asked;
        this.blocks.update((blocks) => blocks.filter((b) => !b.handedIn || b.handedIn.date === asked || !this.untouched(b, true)));
      }
      void this.loadHandedIn();
    } catch (error) {
      this.error.set(errorMessage(error, 'The purchases could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }

  private static today(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }
}
