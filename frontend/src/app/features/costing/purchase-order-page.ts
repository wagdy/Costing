import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { CostingApi, PurchaseOrder, purchaseOrderStatusLabels } from '../../core/costing/costing.api';
import { errorMessage } from '../../core/http/error-message';
import { Company } from '../../core/settings/company';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { NotifyService } from '../../core/ui/notify.service';
import { Approvals, pendingLabel } from './approvals';
import { InfoTip } from './info-tip';
import { paperIcon, viewInvoicePaper } from './invoice-paper';
import { PurchaseOrderActions } from './purchase-order-actions';
import { termsLabels, whatsAppText } from './purchase-orders';

// One purchase order: its lines, what has come of each and what is left, and every invoice received
// against it (its deliveries, each opening the invoice and its paper). From here it is written and
// approved, printed for the supplier or copied for WhatsApp (quantities only, never what it costs the
// kitchen), received against an invoice (New invoice, with the order), closed or called off.
@Component({
  selector: 'app-purchase-order-page',
  imports: [DatePipe, DecimalPipe, InfoTip, MatButtonModule, MatIconModule, MatProgressBarModule, MatTooltipModule, MoneyPipe, RouterLink],
  template: `
    <div class="toolbar no-print">
      <a mat-button routerLink="/costing/purchases/orders"><mat-icon>arrow_back</mat-icon> All purchase orders</a>
    </div>
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    } @else if (error(); as e) {
      <p class="error">{{ e }}</p>
    } @else if (order(); as o) {
      <div class="no-print">
        <h2 class="title">
          {{ o.poNumber }} · {{ o.supplier }}
          <span class="po-status" [class]="o.status">{{ labels[o.status].en }}<span class="ar">{{ labels[o.status].ar }}</span></span>
        </h2>
        @if (asked(); as a) {
          <p class="ask">{{ a.requestedBy }} has asked for it to be approved: it waits for a manager, and stays a draft until then. · بانتظار موافقة المدير</p>
        }
        <div class="actions">
          @if (o.status === 'Approved' || o.status === 'PartiallyReceived') {
            <a mat-flat-button [routerLink]="['/costing/purchases/new']" [queryParams]="{ po: o.id }">
              <mat-icon>fact_check</mat-icon> Receive &amp; match invoice · استلام ومطابقة فاتورة
            </a>
          }
          @if (o.status === 'Draft' && !asked()) {
            <button mat-flat-button (click)="approve(o)">
              <mat-icon>{{ approvals.canApprove() ? 'verified' : 'send' }}</mat-icon>
              {{ approvals.canApprove() ? 'Approve · اعتماد' : 'Send for approval · إرسال للموافقة' }}
            </button>
            <button mat-stroked-button (click)="edit(o)"><mat-icon>edit</mat-icon> Edit · تعديل</button>
          }
          @if (o.status !== 'Draft' && o.status !== 'Cancelled') {
            <button mat-stroked-button (click)="print()"><mat-icon>print</mat-icon> Print PO · طباعة أمر الشراء</button>
            <button mat-stroked-button (click)="copy(o)"><mat-icon>chat</mat-icon> Copy for WhatsApp · نسخ لإرسال واتساب</button>
          }
          <span class="spacer"></span>
          @if (o.status === 'PartiallyReceived' && approvals.canApprove()) {
            <button mat-button (click)="close(o)"><mat-icon>task_alt</mat-icon> Close with what came · إغلاق بالكمية المستلمة</button>
          }
          @if (o.status === 'Draft' || (o.status === 'Approved' && approvals.canApprove())) {
            <button mat-button class="danger" (click)="cancel(o)"><mat-icon>block</mat-icon> Cancel · إلغاء</button>
          }
        </div>

        <dl class="facts">
          <div><dt>Ordered · تاريخ الطلب</dt><dd>{{ o.orderDate | date: 'd MMM y' }}</dd></div>
          <div><dt>Expected · التوريد</dt><dd>{{ o.expectedDeliveryDate ? (o.expectedDeliveryDate | date: 'EEE d MMM y') : '—' }}</dd></div>
          <div><dt>Paid · الدفع</dt><dd>{{ terms[o.paymentTerms].en }} · {{ terms[o.paymentTerms].ar }}</dd></div>
          <div><dt>Written by · بواسطة</dt><dd>{{ o.createdBy }}, {{ o.createdAtUtc | date: 'd MMM, HH:mm' }}</dd></div>
          <div><dt>Approved by · اعتمده</dt><dd>{{ o.approvedBy ? o.approvedBy + ', ' + (o.approvedAtUtc | date: 'd MMM, HH:mm') : '—' }}</dd></div>
          @if (o.closedAtUtc) {
            <div><dt>Closed · أُغلق</dt><dd>{{ o.closedBy }}, {{ o.closedAtUtc | date: 'd MMM, HH:mm' }}</dd></div>
          }
          @if (o.cancelledAtUtc) {
            <div><dt>Cancelled · أُلغي</dt><dd>{{ o.cancelledBy }}, {{ o.cancelledAtUtc | date: 'd MMM, HH:mm' }}</dd></div>
          }
          <div><dt>Received · الاستلام <app-info-tip tip="poReceived" /></dt><dd>{{ o.receivedPercent | number: '1.0-1' }}%</dd></div>
        </dl>
        @if (o.notes) {
          <p class="note">{{ o.notes }}</p>
        }

        <div class="table-wrap">
          <table class="grid lines">
            <thead>
              <tr>
                <th>Item<span class="ar">الصنف</span></th>
                <th class="num">Ordered<span class="ar">المطلوب</span></th>
                <th class="num">Received<span class="ar">المستلم</span></th>
                <th class="num">Left to come <app-info-tip tip="poRemaining" /><span class="ar">المتبقي</span></th>
                <th class="num">Expected price <app-info-tip tip="poExpectedPrice" /><span class="ar">السعر المتوقع</span></th>
                <th class="num">Line total<span class="ar">الإجمالي</span></th>
              </tr>
            </thead>
            <tbody>
              @for (l of o.lines; track l.id) {
                <tr>
                  <td>
                    {{ l.material }} <span class="muted small">{{ l.code }}</span>
                    @if (l.lineNotes) {
                      <div class="muted small">{{ l.lineNotes }}</div>
                    }
                  </td>
                  <td class="num">{{ l.orderedPurchaseQty | number: '1.0-3' }} {{ l.purchaseUnit }}</td>
                  <td class="num">{{ l.receivedPurchaseQty | number: '1.0-3' }}</td>
                  <td class="num" [class.open]="l.remainingQty > 0 && o.status !== 'Completed' && o.status !== 'Cancelled'">{{ l.remainingQty | number: '1.0-3' }}</td>
                  <td class="num">{{ l.expectedUnitCost | money }}</td>
                  <td class="num">{{ l.lineTotal | money }}</td>
                </tr>
              }
            </tbody>
            <tfoot>
              <tr>
                <td colspan="3">Expected total · الإجمالي المتوقع</td>
                <td class="num">{{ o.status === 'Completed' || o.status === 'Cancelled' ? '—' : (o.remainingValue | money) }}</td>
                <td></td>
                <td class="num">{{ o.expectedTotal | money }}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <h3 class="section">Deliveries &amp; invoices history <span class="ar">سجل التوريدات والفواتير</span></h3>
        <div class="table-wrap">
          <table class="grid deliveries">
            <thead>
              <tr>
                <th>Invoice<span class="ar">الفاتورة</span></th>
                <th>Date<span class="ar">التاريخ</span></th>
                <th class="num">Total<span class="ar">الإجمالي</span></th>
                <th>Status<span class="ar">الحالة</span></th>
                <th>Paper<span class="ar">الأصل</span></th>
              </tr>
            </thead>
            <tbody>
              @for (d of o.deliveries; track d.invoiceId) {
                <tr [class.voided]="d.status === 'Voided'">
                  <td>
                    <a [routerLink]="['/costing/purchases/invoices', d.invoiceId]">{{ d.supplierInvoiceNumber ? 'Invoice ' + d.supplierInvoiceNumber : 'The invoice' }}</a>
                    @if (d.closedTheOrder) {
                      <div class="muted small">Closed the order · أغلق أمر الشراء</div>
                    }
                  </td>
                  <td class="nowrap">{{ d.invoiceDate ? (d.invoiceDate | date: 'd MMM y') : '—' }}</td>
                  <td class="num">{{ d.total | money }}</td>
                  <td>
                    @if (d.awaitingApproval) {
                      <span class="pending-badge">Waiting for a manager · بانتظار المدير</span>
                    } @else {
                      {{ d.status === 'Posted' ? 'Posted' : d.status === 'Voided' ? 'Voided' : 'Draft' }}
                      @if (d.postedBy) {
                        <div class="muted small">by {{ d.postedBy }}, {{ d.postedAtUtc | date: 'd MMM, HH:mm' }}</div>
                      }
                    }
                  </td>
                  <td>
                    @if (d.attachmentFileName; as file) {
                      <button mat-button (click)="paper(d.invoiceId, file)"><mat-icon>{{ icon(file) }}</mat-icon> View</button>
                    } @else {
                      <span class="muted">—</span>
                    }
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="5" class="muted">Nothing received against it yet. · لم يتم استلام شيء بعد.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </div>

      <!-- What the supplier is sent: printed alone, without the kitchen's costs. -->
      <section class="po-paper print-only" aria-hidden="true">
        <header>
          @if (company.logoUrl(); as logo) {
            <img [src]="logo" alt="" />
          }
          <div>
            <h1>{{ company.name() }}</h1>
            <p>Purchase order · أمر شراء</p>
          </div>
          <div class="number">
            <strong>{{ o.poNumber }}</strong>
            <span>{{ o.orderDate | date: 'd MMM y' }}</span>
          </div>
        </header>
        <dl>
          <div><dt>Supplier · المورد</dt><dd>{{ o.supplier }}{{ o.supplierPhone ? ' · ' + o.supplierPhone : '' }}</dd></div>
          <div><dt>Expected delivery · تاريخ التوريد</dt><dd>{{ o.expectedDeliveryDate ? (o.expectedDeliveryDate | date: 'EEEE d MMMM y') : '—' }}</dd></div>
          <div><dt>Payment · الدفع</dt><dd>{{ terms[o.paymentTerms].en }} · {{ terms[o.paymentTerms].ar }}</dd></div>
        </dl>
        <table>
          <thead>
            <tr><th>#</th><th>Item · الصنف</th><th class="num">Quantity · الكمية</th><th>Unit · الوحدة</th><th>Notes · ملاحظات</th></tr>
          </thead>
          <tbody>
            @for (l of printed(); track l.id; let i = $index) {
              <tr>
                <td>{{ i + 1 }}</td>
                <td>{{ l.material }}</td>
                <td class="num">{{ (o.status === 'PartiallyReceived' ? l.remainingQty : l.orderedPurchaseQty) | number: '1.0-3' }}</td>
                <td>{{ l.purchaseUnit }}</td>
                <td>{{ l.lineNotes }}</td>
              </tr>
            }
          </tbody>
        </table>
        @if (o.status === 'PartiallyReceived') {
          <p>The rest of the order still to come · المتبقي من الطلبية</p>
        }
        @if (o.notes) {
          <p>{{ o.notes }}</p>
        }
        <footer>
          <span>Approved by · اعتمده: {{ o.approvedBy ?? '—' }}</span>
          <span>Received by · استلمه: ____________________</span>
        </footer>
      </section>
    } @else {
      <p class="error">No such purchase order. · أمر الشراء غير موجود.</p>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .title {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin: 0 0 8px;
      font: var(--mat-sys-title-large);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 12px;
    }
    .spacer {
      flex: 1;
    }
    .facts {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 8px 16px;
      margin: 0 0 12px;

      dt {
        font: var(--mat-sys-label-medium);
        color: var(--mat-sys-on-surface-variant);
      }
      dd {
        margin: 0;
      }
    }
    .ask {
      padding: 8px 10px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--app-warn) 14%, transparent);
    }
    .section {
      margin: 20px 0 8px;
      font: var(--mat-sys-title-small);
    }
    .open {
      color: var(--app-warn);
      font-weight: 600;
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
    tr.voided td {
      color: var(--mat-sys-on-surface-variant);
      text-decoration: line-through;
    }
    tfoot td {
      font-weight: 600;
    }
    .po-status {
      display: inline-block;
      padding: 1px 8px;
      border-radius: 999px;
      font: var(--mat-sys-label-medium);
      background: var(--mat-sys-surface-container-high);

      .ar {
        display: inline;
        margin-inline-start: 4px;
      }
      &.Approved {
        background: color-mix(in srgb, var(--mat-sys-primary) 14%, transparent);
        color: var(--mat-sys-primary);
      }
      &.PartiallyReceived {
        background: color-mix(in srgb, var(--app-warn) 16%, transparent);
        color: var(--app-warn);
      }
      &.Completed {
        background: color-mix(in srgb, var(--app-good, #15803d) 16%, transparent);
        color: var(--app-good, #15803d);
      }
    }
    .print-only {
      display: none;
    }
    @media print {
      .print-only {
        display: block;
      }
      .no-print {
        display: none !important;
      }
    }
    .po-paper {
      color: #000;
      font-size: 12pt;

      header {
        display: flex;
        align-items: center;
        gap: 16px;
        padding-bottom: 12px;
        border-bottom: 2px solid #000;

        img {
          max-height: 56px;
        }
        h1 {
          margin: 0;
          font-size: 18pt;
        }
        p {
          margin: 0;
        }
        .number {
          margin-inline-start: auto;
          display: grid;
          text-align: end;

          strong {
            font-size: 16pt;
          }
        }
      }
      dl {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
        margin: 12px 0;

        dt {
          font-size: 9pt;
          color: #444;
        }
        dd {
          margin: 0;
          font-weight: 600;
        }
      }
      table {
        width: 100%;
        border-collapse: collapse;

        th,
        td {
          padding: 6px 8px;
          border: 1px solid #999;
          text-align: start;
        }
        .num {
          text-align: end;
        }
      }
      footer {
        display: flex;
        justify-content: space-between;
        margin-top: 40px;
      }
    }
  `,
})
export class PurchaseOrderPage {
  private readonly api = inject(CostingApi);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotifyService);
  private readonly actions = inject(PurchaseOrderActions);
  protected readonly company = inject(Company);
  protected readonly approvals = inject(Approvals);
  protected readonly pendingLabel = pendingLabel;
  protected readonly labels = purchaseOrderStatusLabels;
  protected readonly terms = termsLabels;
  protected readonly icon = paperIcon;

  readonly id = input.required<string>();

  protected readonly order = signal<PurchaseOrder | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly asked = computed(() => {
    const order = this.order();
    return order ? this.approvals.pendingFor(order.id) : undefined;
  });
  // What the supplier is sent: what is left to come of a part-delivered order, all of a new one.
  protected readonly printed = computed(() =>
    (this.order()?.lines ?? []).filter((l) => (this.order()!.status === 'PartiallyReceived' ? l.remainingQty : l.orderedPurchaseQty) > 0),
  );

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => void this.load(id));
    });
    void this.approvals.refresh();
  }

  protected print(): void {
    window.print();
  }

  protected async copy(order: PurchaseOrder): Promise<void> {
    try {
      await navigator.clipboard.writeText(whatsAppText(order, this.company.name()));
      this.notify.info('Copied: paste it into WhatsApp. · تم النسخ.');
    } catch {
      this.notify.error(null, 'The browser would not copy it: select the text and copy it by hand.');
    }
  }

  protected paper(invoiceId: string, fileName: string): void {
    viewInvoicePaper(this.dialog, invoiceId, fileName);
  }

  protected async edit(order: PurchaseOrder): Promise<void> {
    if (await this.actions.write(order)) {
      await this.load(order.id);
    }
  }

  protected async approve(order: PurchaseOrder): Promise<void> {
    if (await this.actions.approve(order)) {
      await this.load(order.id);
    }
  }

  protected async cancel(order: PurchaseOrder): Promise<void> {
    if (await this.actions.cancel(order)) {
      await this.load(order.id);
    }
  }

  protected async close(order: PurchaseOrder): Promise<void> {
    if (await this.actions.close(order)) {
      await this.load(order.id);
    }
  }

  private async load(id: string): Promise<void> {
    this.error.set(null);
    try {
      this.order.set(await firstValueFrom(this.api.purchaseOrder(id)));
    } catch (error) {
      this.error.set(errorMessage(error, 'The purchase order could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }
}
