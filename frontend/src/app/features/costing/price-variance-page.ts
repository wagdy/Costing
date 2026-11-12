import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';
import { CostingAccess } from '../../core/costing/costing-tabs';
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
import { InfoTip } from './info-tip';
import { showInvoice } from './invoice-view-dialog';
import { StockCardButton } from './stock-card-dialog';

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
  imports: [
    DatePipe,
    DecimalPipe,
    FilterSelect,
    InfoTip,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MoneyPipe,
    PeriodBar,
    SearchField,
    SortControl,
    StockCardButton,
  ],
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
          <span class="label">Financial impact · الأثر المالي للانحراف <app-info-tip tip="ppvImpact" /></span>
          <strong [class.loss]="r.totalImpact > 0" [class.gain]="r.totalImpact < 0">{{ r.totalImpact | money }}</strong>
        </div>
        <div class="tile">
          <span class="label">Prices up · ارتفاع <app-info-tip tip="ppvRising" /></span>
          <strong class="loss">{{ r.rising }}</strong>
          <small class="chip">+{{ r.increases | money }}</small>
        </div>
        <div class="tile">
          <span class="label">Prices down · انخفاض <app-info-tip tip="ppvFalling" /></span>
          <strong class="gain">{{ r.falling }}</strong>
          <small class="chip">−{{ (r.decreases ? -r.decreases : 0) | money }}</small>
        </div>
        <div class="tile">
          <span class="label">Dishes affected · الأطباق المتأثرة <app-info-tip tip="ppvDishes" /></span>
          <strong>{{ r.affectedDishes }}</strong>
        </div>
        <div class="tile">
          <span class="label">Largest rise · أعلى ارتفاع <app-info-tip tip="ppvLargest" /></span>
          <strong>{{ r.largestRisePercent === null ? '—' : '+' + (r.largestRisePercent | number: '1.1-1') + '%' }}</strong>
          @if (r.largestRise) {
            <small class="chip">{{ r.largestRise }}</small>
          }
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
              <th class="num">Baseline avg <app-info-tip tip="baselineAvg" /><span class="ar">متوسط السعر السابق</span></th>
              <th class="num">Latest net <app-info-tip tip="latestNet" /><span class="ar">آخر سعر شراء صافي</span></th>
              <th class="num">Change <app-info-tip tip="ppvChange" /><span class="ar">فرق السعر ونسبة التغير</span></th>
              <th class="num">Bought<span class="ar">الكمية المشتراة</span></th>
              <th class="num">Impact <app-info-tip tip="ppvLineImpact" /><span class="ar">الأثر المالي</span></th>
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
                  <app-stock-card-button [id]="row.rawMaterialId" [name]="row.material" [from]="from()" [to]="to()" />
                  <div class="muted small">{{ row.code ? row.code + ' · ' : '' }}per {{ row.purchaseUnit }}{{ row.category ? ' · ' + row.category : '' }}</div>
                </td>
                <td class="num">{{ row.baselineCost === null ? '—' : (row.baselineCost | money) }}</td>
                <td class="num">
                  @if (row.latestCost !== null && row.latestInvoiceId && canOpenInvoices()) {
                    <button type="button" class="price-link" (click)="openInvoice(row); $event.stopPropagation()" (keydown.enter)="$event.stopPropagation()"
                      [attr.aria-label]="'Open the invoice of the latest price of ' + row.material">
                      {{ row.latestCost | money }}
                    </button>
                  } @else {
                    {{ row.latestCost === null ? '—' : (row.latestCost | money) }}
                  }
                </td>
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
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .price-link {
      padding: 0;
      border: 0;
      background: none;
      font: inherit;
      color: var(--mat-sys-primary);
      text-decoration: underline;
      text-underline-offset: 2px;
      cursor: pointer;
    }
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
  private readonly dialog = inject(MatDialog);
  private readonly access = inject(CostingAccess);
  // The invoices open where their tab is.
  protected readonly canOpenInvoices = computed(() => this.access.has('Purchases'));

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

  // The invoice of the latest price, its line for this material marked.
  protected openInvoice(row: PriceVarianceRow): void {
    if (row.latestInvoiceId) {
      showInvoice(this.dialog, row.latestInvoiceId, row.rawMaterialId);
    }
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
