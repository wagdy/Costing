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
