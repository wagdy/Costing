import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { CostingApi, PurchaseOrderStatus, PurchaseOrderSummary, purchaseOrderStatusLabels } from '../../core/costing/costing.api';
import { errorMessage } from '../../core/http/error-message';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { FilterOption, FilterSelect } from '../shared/filter-select';
import { SearchField } from '../shared/search-field';
import { smartMatch } from '../shared/smart-search';
import { Approvals, pendingLabel } from './approvals';
import { InfoTip } from './info-tip';
import { PurchaseOrderActions } from './purchase-order-actions';
import { statusPills, termsLabels } from './purchase-orders';

// Purchase orders (أوامر الشراء) on Purchases: every order newest first, found by number, supplier or
// who wrote it, filtered by where it stands and by supplier; each opens on its own page, where it is
// printed, copied for the supplier and received against an invoice.
@Component({
  selector: 'app-purchase-orders-page',
  imports: [DatePipe, DecimalPipe, FilterSelect, InfoTip, MatButtonModule, MatIconModule, MatProgressBarModule, MoneyPipe, RouterLink, SearchField],
  template: `
    <div class="toolbar smart">
      <app-search-field [(value)]="search" placeholder="PO number, supplier or who wrote it · رقم الأمر أو المورد" />
      <div class="pills">
        <app-filter-select label="Supplier · المورد" icon="local_shipping" [options]="supplierOptions()" [(value)]="supplier" />
      </div>
      <span class="spacer"></span>
      <button mat-flat-button (click)="create()"><mat-icon>add</mat-icon> New purchase order · أمر شراء جديد</button>
    </div>
    <div class="status-pills" role="group" aria-label="Status">
      @for (p of pills; track p.value) {
        <button type="button" class="status-pill" [class.on]="status() === p.value" [attr.aria-pressed]="status() === p.value" (click)="status.set(p.value)">
          {{ p.en }} <span class="ar">{{ p.ar }}</span> <span class="count">{{ countOf(p.value) }}</span>
        </button>
      }
    </div>
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    @if (error(); as e) {
      <p class="error">{{ e }}</p>
    } @else {
      <div class="table-wrap">
        <table class="grid orders">
          <thead>
            <tr>
              <th>PO number<span class="ar">رقم الأمر</span></th>
              <th>Supplier<span class="ar">المورد</span></th>
              <th>Ordered<span class="ar">تاريخ الطلب</span></th>
              <th>Expected<span class="ar">التوريد</span></th>
              <th>Paid<span class="ar">الدفع</span></th>
              <th class="num">Expected total<span class="ar">الإجمالي المتوقع</span></th>
              <th class="num">Received <app-info-tip tip="poReceived" /><span class="ar">نسبة الاستلام</span></th>
              <th class="num">Left to come <app-info-tip tip="poRemaining" /><span class="ar">المتبقي</span></th>
              <th>Status<span class="ar">الحالة</span></th>
            </tr>
          </thead>
          <tbody>
            @for (o of shown(); track o.id) {
              @let asked = approvals.pendingFor(o.id);
              <tr class="clickable" (click)="open(o)" [class.cancelled]="o.status === 'Cancelled'">
                <td class="code"><a [routerLink]="['/costing/purchases/orders', o.id]" (click)="$event.stopPropagation()">{{ o.poNumber }}</a></td>
                <td>
                  {{ o.supplier }}
                  <div class="muted small">{{ o.lines }} {{ o.lines === 1 ? 'item' : 'items' }} · by {{ o.createdBy }}</div>
                </td>
                <td class="nowrap">{{ o.orderDate | date: 'd MMM y' }}</td>
                <td class="nowrap" [class.late]="o.overdue">
                  {{ o.expectedDeliveryDate ? (o.expectedDeliveryDate | date: 'd MMM') : '—' }}
                  @if (o.overdue) {
                    <div class="small">Late · متأخر</div>
                  }
                </td>
                <td>{{ terms[o.paymentTerms].en }}</td>
                <td class="num">{{ o.expectedTotal | money }}</td>
                <td class="num">
                  {{ o.receivedPercent | number: '1.0-1' }}%
                  <div class="bar" aria-hidden="true"><span [style.width.%]="o.receivedPercent"></span></div>
                </td>
                <td class="num">{{ o.status === 'Cancelled' || o.status === 'Completed' ? '—' : (o.remainingValue | money) }}</td>
                <td>
                  <span class="po-status" [class]="o.status">{{ labels[o.status].en }}<span class="ar">{{ labels[o.status].ar }}</span></span>
                  @if (asked) {
                    <div><span class="pending-badge">{{ pendingLabel(asked).en }}</span></div>
                  }
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="9" class="muted">
                  {{ orders().length ? 'Nothing matches.' : 'No purchase orders yet: write one here, or create them from the order planner.' }}
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <p class="muted small">
        Received against the supplier’s invoices on New invoice or the Daily batch: each item matched to the order (<a routerLink="/costing/intelligence/orders">order planner</a>).
      </p>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .spacer {
      flex: 1;
    }
    .status-pills {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin: 0 0 12px;
    }
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 6px 12px;
      border-radius: 999px;
      border: 1px solid var(--app-line-strong);
      background: var(--mat-sys-surface-container-lowest);
      color: var(--mat-sys-on-surface);
      font: var(--mat-sys-label-large);
      cursor: pointer;

      &.on {
        background: var(--mat-sys-secondary-container);
        color: var(--mat-sys-on-secondary-container);
        border-color: transparent;
      }
      .ar {
        opacity: 0.75;
        font-size: 0.85em;
      }
      .count {
        min-width: 18px;
        padding: 0 6px;
        border-radius: 999px;
        background: var(--mat-sys-surface-container-high);
        font: var(--mat-sys-label-small);
      }
    }
    .code {
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .nowrap {
      white-space: nowrap;
    }
    .small {
      font-size: 0.85em;
    }
    .late {
      color: var(--mat-sys-error);
    }
    tr.clickable {
      cursor: pointer;
    }
    tr.cancelled td {
      color: var(--mat-sys-on-surface-variant);
    }
    .bar {
      height: 4px;
      margin-top: 4px;
      border-radius: 2px;
      background: var(--mat-sys-surface-container-high);
      overflow: hidden;

      span {
        display: block;
        height: 100%;
        background: var(--mat-sys-primary);
      }
    }
    .po-status {
      display: inline-block;
      padding: 1px 8px;
      border-radius: 999px;
      font: var(--mat-sys-label-small);
      white-space: nowrap;
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
      &.Cancelled {
        text-decoration: line-through;
      }
    }
  `,
})
export class PurchaseOrdersPage {
  private readonly api = inject(CostingApi);
  private readonly router = inject(Router);
  private readonly actions = inject(PurchaseOrderActions);
  protected readonly approvals = inject(Approvals);
  protected readonly pendingLabel = pendingLabel;
  protected readonly labels = purchaseOrderStatusLabels;
  protected readonly terms = termsLabels;
  protected readonly pills = statusPills;

  protected readonly orders = signal<PurchaseOrderSummary[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly search = signal('');
  protected readonly status = signal<'' | PurchaseOrderStatus>('');
  protected readonly supplier = signal('');

  // By supplier and search first: the pills count what the other filters leave.
  private readonly matching = computed(() =>
    this.orders().filter((o) => (!this.supplier() || o.supplierId === this.supplier()) && smartMatch(this.search(), o.poNumber, o.supplier, o.createdBy)),
  );
  protected readonly shown = computed(() => this.matching().filter((o) => !this.status() || o.status === this.status()));

  protected readonly supplierOptions = computed<FilterOption[]>(() => {
    const by = new Map<string, { name: string; count: number }>();
    for (const o of this.orders()) {
      by.set(o.supplierId, { name: o.supplier, count: (by.get(o.supplierId)?.count ?? 0) + 1 });
    }
    return [
      { value: '', label: 'All · الكل', count: this.orders().length },
      ...[...by.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([value, s]) => ({ value, label: s.name, count: s.count })),
    ];
  });

  constructor() {
    void this.load();
    void this.approvals.refresh();
  }

  protected countOf(status: '' | PurchaseOrderStatus): number {
    return status ? this.matching().filter((o) => o.status === status).length : this.matching().length;
  }

  protected open(order: PurchaseOrderSummary): void {
    void this.router.navigate(['/costing/purchases/orders', order.id]);
  }

  protected async create(): Promise<void> {
    const id = await this.actions.write(null);
    if (id) {
      await this.router.navigate(['/costing/purchases/orders', id]);
    }
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.orders.set(await firstValueFrom(this.api.purchaseOrders()));
    } catch (error) {
      this.error.set(errorMessage(error, 'The purchase orders could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }
}
