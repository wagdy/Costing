import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { PurchaseInvoice, PurchaseInvoiceLine, UnitOfMeasure, paymentMethodLabels, paymentStatusLabels } from '../../core/costing/costing.api';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { PaperPreview } from './invoice-paper';

const baseLabels: Record<UnitOfMeasure, string> = { Gram: 'g', Millilitre: 'ml', Piece: 'pc' };

// One invoice, read-only: who it is from and when, each line as billed (quantity, unit, unit
// price, line total) and what it put into stock, or that it is an expense and under which
// category, the total split into stock and expenses, and the paper itself. With discounts, each
// line's (its own and its share of the invoice's) and what it came to after them, and the
// subtotal, less the discounts, as what is paid. Shown for review before posting, from the
// history's Show, and on the invoice's own page; from a stock card, its material's line marked.
@Component({
  selector: 'app-invoice-view',
  imports: [DatePipe, DecimalPipe, MoneyPipe, PaperPreview],
  template: `
    @let inv = invoice();
    <dl class="details">
      <div><dt>Supplier · المورد</dt><dd>{{ inv.supplierName ?? '—' }}</dd></div>
      <div><dt>Invoice no. · رقم الفاتورة</dt><dd>{{ inv.supplierInvoiceNumber ?? '—' }}</dd></div>
      <div><dt>Date · التاريخ</dt><dd>{{ date() | date: 'd MMM y' }}</dd></div>
      @if (discounted()) {
        <div><dt>Net payable · الصافي المستحق</dt><dd class="total">{{ inv.total | money }}</dd></div>
      } @else {
        <div><dt>Total · الإجمالي</dt><dd class="total">{{ inv.total | money }}</dd></div>
      }
      <div>
        <dt>Paid · طريقة الدفع</dt>
        <dd>
          @if (inv.paymentMethod; as m) {
            {{ methods[m].en }}{{ m === 'DayRevenue' && inv.revenueDate ? ' of ' + (inv.revenueDate | date: 'd MMM') : '' }}
            @if (inv.status === 'Posted' && (inv.paymentStatus === 'Pending' || inv.paymentStatus === 'Unpaid')) {
              <span class="pay-status" [class]="inv.paymentStatus">{{ statuses[inv.paymentStatus].en }}</span>
            }
          } @else {
            Not chosen yet
          }
        </dd>
      </div>
    </dl>
    <p class="muted status">
      @if (inv.status === 'Voided') {
        <span class="voided-badge">Voided<span class="ar">ملغاة</span></span>
        {{ inv.voidedAtUtc | date: 'EEE d MMM y, HH:mm' }} by {{ inv.voidedBy || 'a manager' }}: its goods were taken back out of stock and its
        expenses left the reports. Posted {{ inv.postedAtUtc | date: 'd MMM y' }} by {{ inv.postedBy || 'someone' }}.
      } @else if (inv.status === 'Posted') {
        Posted {{ inv.postedAtUtc | date: 'EEE d MMM y, HH:mm' }} by {{ inv.postedBy || 'someone' }}; entered by {{ inv.createdBy || 'someone' }}.
      } @else {
        A draft, not posted: nothing on it is in stock or in the expenses yet.
      }
    </p>
    <div class="table-wrap">
      <table class="grid">
        <thead>
          <tr>
            <th>Item<span class="ar">الصنف</span></th>
            <th>Category<span class="ar">الفئة</span></th>
            <th class="num">Quantity<span class="ar">الكمية</span></th>
            <th>Unit<span class="ar">الوحدة</span></th>
            <th class="num">Unit price<span class="ar">سعر الوحدة</span></th>
            <th class="num">Line total<span class="ar">إجمالي السطر</span></th>
            @if (discounted()) {
              <th class="num">Discount<span class="ar">الخصم</span></th>
              <th class="num">Net<span class="ar">الصافي</span></th>
            }
            <th class="num">Into stock<span class="ar">إلى المخزون</span></th>
          </tr>
        </thead>
        <tbody>
          @for (l of inv.lines; track l.rawMaterialId ?? l.expenseItemId) {
            <tr [class.marked]="!!highlight() && l.rawMaterialId === highlight()" [attr.aria-current]="highlight() && l.rawMaterialId === highlight() ? 'true' : null">
              <td>
                {{ l.material }}
                @if (highlight() && l.rawMaterialId === highlight()) {
                  <span class="badge marked-tag">This material · هذه الخامة</span>
                }
                @if (l.itemType === 'Expense') {
                  <span class="badge expense">Expense · مصروف</span>
                }
              </td>
              <td>{{ l.category ?? '—' }}</td>
              <td class="num">{{ l.enteredQuantity | number: '1.0-3' }}</td>
              <td>{{ l.unitLabel }}</td>
              <td class="num">{{ written(l) === null ? '' : (written(l)! / l.enteredQuantity | money) }}</td>
              <td class="num">{{ written(l) === null ? 'No price' : (written(l) | money) }}</td>
              @if (discounted()) {
                <td class="num">
                  {{ off(l) > 0 ? (off(l) | money) : '' }}
                  @if (l.discountShare) {
                    <small class="muted share">{{ l.discountShare | money }} of the invoice's</small>
                  }
                </td>
                <td class="num">{{ l.cost === null ? '' : (l.cost | money) }}</td>
              }
              <td class="num muted">{{ l.itemType === 'Expense' ? 'Not stock' : (l.quantity | number: '1.0-3') + ' ' + base(l) }}</td>
            </tr>
          } @empty {
            <tr><td [attr.colspan]="discounted() ? 9 : 7" class="muted">No lines.</td></tr>
          }
        </tbody>
        <tfoot>
          @if (discounted()) {
            <!-- Subtotal, less every discount, as what is paid: each under its column. -->
            <tr class="split">
              <td colspan="5">{{ inv.lines.length }} {{ inv.lines.length === 1 ? 'line' : 'lines' }} · Subtotal · الإجمالي قبل الخصم</td>
              <td class="num">{{ inv.subtotal ?? 0 | money }}</td>
              <td class="num">− {{ (inv.lineDiscounts ?? 0) + (inv.discount ?? 0) | money }}</td>
              <td colspan="2"></td>
            </tr>
            @if ((inv.discount ?? 0) > 0) {
              <tr class="split">
                <td colspan="6">Of which the invoice discount · منها خصم الفاتورة</td>
                <td class="num">{{ inv.discount | money }}</td>
                <td colspan="2"></td>
              </tr>
            }
            @if (inv.expenseTotal > 0) {
              <tr class="split">
                <td colspan="7">Into stock · إلى المخزون</td>
                <td class="num">{{ inv.inventoryTotal | money }}</td>
                <td></td>
              </tr>
              <tr class="split">
                <td colspan="7">Expenses · مصروفات</td>
                <td class="num">{{ inv.expenseTotal | money }}</td>
                <td></td>
              </tr>
            }
            <tr>
              <td colspan="7">Net payable · الصافي المستحق</td>
              <td class="num">{{ inv.total | money }}</td>
              <td></td>
            </tr>
          } @else {
            @if (inv.expenseTotal > 0) {
              <tr class="split">
                <td colspan="5">Into stock · إلى المخزون</td>
                <td class="num">{{ inv.inventoryTotal | money }}</td>
                <td></td>
              </tr>
              <tr class="split">
                <td colspan="5">Expenses · مصروفات</td>
                <td class="num">{{ inv.expenseTotal | money }}</td>
                <td></td>
              </tr>
            }
            <tr>
              <td colspan="5">{{ inv.lines.length }} {{ inv.lines.length === 1 ? 'line' : 'lines' }}</td>
              <td class="num">{{ inv.total | money }}</td>
              <td></td>
            </tr>
          }
        </tfoot>
      </table>
    </div>
    <section class="paper">
      <h3>Paper <span class="inline-ar">صورة الفاتورة</span></h3>
      @if (inv.attachment; as paper) {
        <app-paper-preview [invoiceId]="inv.id" [fileName]="paper.fileName" />
      } @else {
        <p class="muted">No photo or scan attached.</p>
      }
    </section>
  `,
  styleUrl: './costing.scss',
  styles: `
    .details {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 8px 16px;
      margin: 0 0 4px;

      dt {
        font: var(--mat-sys-label-medium);
        color: var(--mat-sys-on-surface-variant);
      }
      dd {
        margin: 2px 0 0;
        font: var(--mat-sys-body-large);
      }
      .total {
        font-weight: 600;
      }
    }
    .status {
      margin: 0 0 12px;
    }
    .badge.expense {
      background: color-mix(in srgb, var(--app-warn) 16%, transparent);
      color: var(--app-warn);
    }
    tfoot tr.split td {
      font-weight: 400;
    }
    .share {
      display: block;
      white-space: nowrap;
    }
    .paper {
      margin-top: 16px;

      h3 {
        margin: 0 0 8px;
        font: var(--mat-sys-title-medium);
      }
    }
    tr.marked td {
      background: color-mix(in srgb, var(--mat-sys-primary) 10%, transparent);
    }
    tr.marked td:first-child {
      box-shadow: inset 3px 0 0 var(--mat-sys-primary);
    }
    .marked-tag {
      margin-inline-start: 6px;
      background: var(--mat-sys-primary);
      color: var(--mat-sys-on-primary);
    }
  `,
})
export class InvoiceView {
  protected readonly methods = paymentMethodLabels;
  protected readonly statuses = paymentStatusLabels;
  readonly invoice = input.required<PurchaseInvoice>();
  // A material whose line is marked: the one its stock card opened the invoice for.
  readonly highlight = input<string | null>(null);

  // Anything taken off it, by a line or on the whole invoice.
  protected readonly discounted = computed(() => {
    const inv = this.invoice();
    return (inv.lineDiscounts ?? 0) > 0 || (inv.discount ?? 0) > 0;
  });

  // A line as written on the paper, before its discounts.
  protected written(line: PurchaseInvoiceLine): number | null {
    return line.lineTotal ?? line.cost;
  }

  // What was taken off a line: its own discount and its share of the invoice's.
  protected off(line: PurchaseInvoiceLine): number {
    return (line.discount ?? 0) + (line.discountShare ?? 0);
  }

  // The date on the supplier's paper; when none was written, the day it was posted or entered.
  protected date(): string {
    const inv = this.invoice();
    return inv.invoiceDate ?? inv.postedAtUtc ?? inv.createdAtUtc;
  }

  protected base(line: PurchaseInvoiceLine): string {
    return line.unit ? baseLabels[line.unit] : '';
  }
}
