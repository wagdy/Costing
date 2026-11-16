import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';
import { IntelligenceApi, VendorPriceReport, VendorPriceRow } from '../../core/costing/intelligence.api';
import { errorMessage } from '../../core/http/error-message';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { NotifyService } from '../../core/ui/notify.service';
import { saveBlob } from '../../core/ui/save-blob';
import { FilterOption, FilterSelect } from '../shared/filter-select';
import { SearchField } from '../shared/search-field';
import { smartMatch } from '../shared/smart-search';
import { InfoTip } from './info-tip';
import { PeriodBar, periodDays } from './period-bar';

// The vendor price matrix (مصفوفة مقارنة أسعار الموردين): each material bought in the period and every
// supplier who sold it, cheapest first, net of every discount: the last price and when, the lowest
// and highest, the weighted average and what was bought. The cheapest marked Best price, where
// there is a choice (one supplier is no comparison). On
// Purchases and on Material & demand intelligence alike.
@Component({
  selector: 'app-vendor-prices-page',
  imports: [DatePipe, DecimalPipe, FilterSelect, InfoTip, MatButtonModule, MatIconModule, MatProgressBarModule, MoneyPipe, PeriodBar, SearchField],
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
          <span class="label">Materials bought · الخامات المشتراة</span>
          <strong>{{ r.materials }}</strong>
        </div>
        <div class="tile">
          <span class="label">With a choice of supplier · لها أكثر من مورد <app-info-tip tip="vpSpread" /></span>
          <strong>{{ r.withChoice }}</strong>
        </div>
      </div>

      <div class="toolbar smart">
        <app-search-field [(value)]="search" placeholder="Material, code or supplier · الخامة أو المورد" />
        <div class="pills">
          <app-filter-select label="Show · عرض" icon="filter_list" [options]="filters()" [(value)]="show" />
        </div>
      </div>

      <div class="table-wrap">
        <table class="grid vendors">
          <thead>
            <tr>
              <th>Material<span class="ar">الخامة</span></th>
              <th>Supplier<span class="ar">المورد</span></th>
              <th class="num">Last net price<span class="ar">آخر سعر صافي</span></th>
              <th>Last bought<span class="ar">آخر شراء</span></th>
              <th class="num">Lowest<span class="ar">الأقل</span></th>
              <th class="num">Highest<span class="ar">الأعلى</span></th>
              <th class="num">Weighted avg <app-info-tip tip="vpAverage" /><span class="ar">المتوسط المرجح</span></th>
              <th class="num">Quantity<span class="ar">الكمية</span></th>
              <th>Best <app-info-tip tip="vpBest" /><span class="ar">الأفضل</span></th>
            </tr>
          </thead>
          <tbody>
            @for (row of shown(); track row.rawMaterialId) {
              @for (v of row.suppliers; track v.supplierId ?? v.supplier; let first = $first) {
                <tr [class.first]="first" [class.best]="v.bestPrice && row.suppliers.length > 1">
                  @if (first) {
                    <td [attr.rowspan]="row.suppliers.length" class="material">
                      <strong>{{ row.material }}</strong>
                      <div class="muted small">
                        {{ row.code ? row.code + ' · ' : '' }}{{ row.category ?? '' }} · per {{ row.purchaseUnit }}
                      </div>
                      @if (row.spreadPercent !== null) {
                        <span class="chip">+{{ row.spreadPercent | number: '1.0-1' }}% spread</span>
                      }
                    </td>
                  }
                  <td>{{ v.supplier }}</td>
                  <td class="num strong">{{ v.lastPrice === null ? '—' : (v.lastPrice | money) }}</td>
                  <td class="nowrap">{{ v.lastDate | date: 'd MMM y' }}</td>
                  <td class="num">{{ v.lowestPrice === null ? '—' : (v.lowestPrice | money) }}</td>
                  <td class="num">{{ v.highestPrice === null ? '—' : (v.highestPrice | money) }}</td>
                  <td class="num">{{ v.averagePrice === null ? '—' : (v.averagePrice | money) }}</td>
                  <td class="num">{{ v.quantity | number: '1.0-3' }} <span class="muted small">· {{ v.purchases }}×</span></td>
                  <td>
                    @if (v.bestPrice && row.suppliers.length > 1) {
                      <span class="best-badge"><mat-icon aria-hidden="true">verified</mat-icon> Best price · الأقل سعراً</span>
                    }
                  </td>
                </tr>
              }
            } @empty {
              <tr><td colspan="9" class="muted">No material bought in these days{{ search() || show() ? ' matches' : '' }}.</td></tr>
            }
          </tbody>
        </table>
      </div>
      <p class="muted small">Net prices per purchase unit, after the line's discount and its share of the invoice's. The order planner can send each material to its cheapest supplier.</p>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .tiles {
      grid-template-columns: repeat(auto-fit, minmax(200px, 260px));
    }
    tr.first td {
      border-top: 2px solid var(--app-line-strong);
    }
    td.material {
      vertical-align: top;
      background: var(--mat-sys-surface-container-lowest);
    }
    tr.best td:not(.material) {
      background: color-mix(in srgb, var(--app-ok) 7%, transparent);
    }
    .chip {
      display: inline-block;
      margin-top: 4px;
      padding: 0 8px;
      border-radius: 999px;
      font: var(--mat-sys-label-small);
      background: var(--mat-sys-surface-container-high);
    }
    .best-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 0 8px;
      border-radius: 999px;
      font: var(--mat-sys-label-small);
      line-height: 22px;
      white-space: nowrap;
      background: color-mix(in srgb, var(--app-ok) 14%, transparent);
      color: var(--app-ok);

      mat-icon {
        width: 14px;
        height: 14px;
        font-size: 14px;
      }
    }
    .small {
      font-size: 0.85em;
    }
  `,
})
export class VendorPricesPage {
  private readonly api = inject(IntelligenceApi);
  private readonly notify = inject(NotifyService);
  protected readonly from = signal(periodDays('quarter').from);
  protected readonly to = signal(periodDays('quarter').to);
  protected readonly report = signal<VendorPriceReport | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly search = signal('');
  protected readonly show = signal('');

  protected readonly filters = computed<FilterOption[]>(() => {
    const rows = this.report()?.rows ?? [];
    return [
      { value: '', label: 'All · الكل', count: rows.length },
      { value: 'choice', label: 'More than one supplier · أكثر من مورد', count: rows.filter((r) => r.suppliers.length > 1).length },
    ];
  });

  protected readonly shown = computed<VendorPriceRow[]>(() =>
    (this.report()?.rows ?? []).filter(
      (r) =>
        (this.show() !== 'choice' || r.suppliers.length > 1) &&
        smartMatch(this.search(), r.material, r.code, r.category, ...r.suppliers.map((v) => v.supplier)),
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
      saveBlob(await firstValueFrom(this.api.vendorPricesSheet(this.from(), this.to())), `vendor-prices-${this.from()}-to-${this.to()}.xlsx`);
    } catch (error) {
      this.notify.error(error, 'The sheet could not be downloaded.');
    }
  }

  private async load(from: string, to: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.report.set(await firstValueFrom(this.api.vendorPrices(from, to)));
    } catch (error) {
      this.error.set(errorMessage(error, 'The vendor prices could not be compared.'));
    } finally {
      this.loading.set(false);
    }
  }
}
