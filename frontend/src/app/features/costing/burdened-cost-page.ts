import { DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import {
  BurdenedCostQuery,
  BurdenedCostReport,
  BurdenedPlateRow,
  IntelligenceApi,
  OverheadAllocationMethod,
  PlateStatus,
  PoolSource,
  allocationMethodLabels,
  plateStatusLabels,
} from '../../core/costing/intelligence.api';
import { Company } from '../../core/settings/company';
import { errorMessage } from '../../core/http/error-message';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { NotifyService } from '../../core/ui/notify.service';
import { saveBlob } from '../../core/ui/save-blob';
import { FilterOption, FilterSelect } from '../shared/filter-select';
import { SearchField } from '../shared/search-field';
import { SortOption, SortState, smartMatch, sortItems } from '../shared/smart-search';
import { SortControl } from '../shared/sort-control';
import { InfoTip } from './info-tip';
import { InfoTipKey } from './info-tips';
import { PeriodBar, periodDays } from './period-bar';

type PlateSort = 'margin' | 'profit' | 'periodProfit' | 'burdened' | 'sold' | 'dish';

const sorts: SortOption<PlateSort>[] = [
  { key: 'margin', en: 'Net margin %', ar: 'نسبة صافي الربح' },
  { key: 'profit', en: 'Net profit a plate', ar: 'صافي ربح الطبق' },
  { key: 'periodProfit', en: 'Net profit for the period', ar: 'صافي ربح الفترة', descending: true },
  { key: 'burdened', en: 'Fully burdened %', ar: 'التكلفة الكلية %', descending: true },
  { key: 'sold', en: 'Sold', ar: 'المباع', descending: true },
  { key: 'dish', en: 'Dish', ar: 'الصنف' },
];

// The pills, Activity-based first: the method this screen is for.
const methods: { method: OverheadAllocationMethod; tip: InfoTipKey }[] = [
  { method: 'ActivityBasedPrepTime', tip: 'bcActivity' },
  { method: 'ByQuantitySold', tip: 'bcEqual' },
  { method: 'ByRevenueShare', tip: 'bcRevenue' },
];

// One part of a plate's price, for the stacked bar: food, labor, overheads and what is left.
export interface PriceSegment {
  key: 'food' | 'labor' | 'overhead' | 'profit';
  label: string;
  amount: number;
  // Its share of the bar: of the price, or of the burdened cost when that is more.
  share: number;
  // Of the selling price, as the columns say it.
  ofPrice: number;
}

// A plate's price as the bar draws it: the costs in order, then the profit; a loss is the part of
// the costs beyond the price (lossFrom: where the price ends along the bar, 0 to 100).
export function priceSegments(row: BurdenedPlateRow): { segments: PriceSegment[]; lossFrom: number | null } | null {
  const [price, food, labor, overhead] = [row.sellingPrice, row.directFoodCost, row.allocatedLaborCost, row.allocatedOverheadCost];
  if (price === null || price <= 0 || food === null || labor === null || overhead === null) {
    return null;
  }
  const burdened = food + labor + overhead;
  const scale = Math.max(price, burdened);
  const part = (key: PriceSegment['key'], label: string, amount: number): PriceSegment => ({
    key,
    label,
    amount,
    share: (amount / scale) * 100,
    ofPrice: (amount / price) * 100,
  });
  const segments = [part('food', 'Food · الخامات', food), part('labor', 'Labor · العمالة', labor), part('overhead', 'Overhead · التشغيل', overhead)];
  if (price >= burdened) {
    segments.push(part('profit', 'Net profit · صافي الربح', price - burdened));
    return { segments: segments.filter((s) => s.amount > 0), lossFrom: null };
  }
  return { segments: segments.filter((s) => s.amount > 0), lossFrom: (price / scale) * 100 };
}

const statusIcons: Record<PlateStatus, string> = {
  Healthy: 'check_circle',
  Thin: 'warning',
  Losing: 'trending_down',
  NoRecipe: 'help',
  NoPrice: 'help',
  NotAllocated: 'hourglass_empty',
};

// The fully burdened plate cost (التكلفة الكلية للطبق): each dish's food, its share of the period's
// labor and overheads by the method chosen, and the true net profit left of its price, with a bar
// for what its price is made of. The pools are the period's own, or monthly figures typed to try.
@Component({
  selector: 'app-burdened-cost-page',
  imports: [
    DecimalPipe,
    FilterSelect,
    FormsModule,
    InfoTip,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatTooltipModule,
    MoneyPipe,
    PeriodBar,
    RouterLink,
    SearchField,
    SortControl,
  ],
  template: `
    <div class="toolbar">
      <app-period-bar [(from)]="from" [(to)]="to" />
      <span class="spacer"></span>
      <button mat-stroked-button (click)="download()" [disabled]="!report()"><mat-icon>download</mat-icon> Export burdened cost sheet · Excel</button>
    </div>

    <div class="controls">
      <div class="methods" role="group" aria-label="Allocation method">
        <span class="label">Share labor &amp; overheads · طريقة التحميل</span>
        <mat-button-toggle-group [value]="chosenMethod()" (change)="method.set($event.value)" aria-label="Allocation method">
          @for (m of methods; track m.method) {
            <mat-button-toggle [value]="m.method">
              <mat-icon aria-hidden="true">{{ methodLabels[m.method].icon }}</mat-icon>
              {{ methodLabels[m.method].en }} <span class="ar">{{ methodLabels[m.method].ar }}</span>
            </mat-button-toggle>
          }
        </mat-button-toggle-group>
        @if (chosenMethod(); as chosen) {
          <app-info-tip [tip]="tipOf(chosen)" />
        }
      </div>
      <div class="source" role="group" aria-label="Cost pools">
        <mat-button-toggle-group [value]="source()" (change)="source.set($event.value)" aria-label="Cost pools">
          <mat-button-toggle value="Actual">Use actual period pools <span class="ar">المصاريف الفعلية للفترة</span></mat-button-toggle>
          <mat-button-toggle value="Simulated">Simulate monthly labor &amp; overhead <span class="ar">محاكاة بمصاريف تقديرية</span></mat-button-toggle>
        </mat-button-toggle-group>
        <app-info-tip tip="bcSource" />
        @if (source() === 'Simulated') {
          <mat-form-field subscriptSizing="dynamic" class="amount">
            <mat-label>Labor a month, {{ company.currency() }} · العمالة الشهرية</mat-label>
            <input matInput type="number" min="0" step="any" [ngModel]="monthlyLabor()" (ngModelChange)="monthlyLabor.set(figure($event))"
              placeholder="Cost settings' stand-in" aria-label="Monthly labor" />
          </mat-form-field>
          <mat-form-field subscriptSizing="dynamic" class="amount">
            <mat-label>Rent &amp; overhead a month, {{ company.currency() }} · الإيجار والتشغيل</mat-label>
            <input matInput type="number" min="0" step="any" [ngModel]="monthlyOverhead()" (ngModelChange)="monthlyOverhead.set(figure($event))"
              placeholder="Cost settings' stand-in" aria-label="Monthly overhead" />
          </mat-form-field>
          @if (report()?.source === 'Simulated' && report()?.labor?.total === 0 && report()?.overhead?.total === 0) {
            <span class="muted hint">Type a month's labor and overheads, or set stand-in figures in Cost settings. · اكتب أرقامًا شهرية.</span>
          }
        }
      </div>
    </div>

    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    @if (error()) {
      <p class="error">{{ error() }}</p>
    } @else if (report(); as r) {
      <div class="tiles">
        <div class="tile key">
          <span class="label">Total labor pool allocated · إجمالي العمالة المحملة <app-info-tip tip="bcLaborPool" /></span>
          <strong>{{ r.laborAllocated | money }}</strong>
          <small class="chip">{{ r.averageLaborPerPlate === null ? 'No plates sold' : (r.averageLaborPerPlate | money) + ' a plate' }}</small>
        </div>
        <div class="tile key">
          <span class="label">Total overhead pool allocated · إجمالي الإيجار والمرافق والإهلاك <app-info-tip tip="bcOverheadPool" /></span>
          <strong>{{ r.overheadAllocated | money }}</strong>
          <small class="chip">{{ r.averageOverheadPerPlate === null ? 'No plates sold' : (r.averageOverheadPerPlate | money) + ' a plate' }}</small>
        </div>
        <div class="tile">
          <span class="label">Avg fully burdened cost % · متوسط التكلفة الكلية <app-info-tip tip="bcAverageBurdened" /></span>
          <strong [class.loss]="(r.averageFullyBurdenedCostPercent ?? 0) > 100">{{ percent(r.averageFullyBurdenedCostPercent) }}</strong>
          <small class="chip" [class.loss]="(r.averageTrueNetMarginPercent ?? 0) < 0">
            vs net margin · صافي الربح {{ percent(r.averageTrueNetMarginPercent) }}
          </small>
        </div>
        <div class="tile" [class.alert]="r.dishesBleeding > 0">
          <span class="label">Dishes bleeding after overhead · أطباق خاسرة بعد تحميل المصاريف <app-info-tip tip="bcBleeding" /></span>
          <strong>{{ r.dishesBleeding }}</strong>
          @if (r.dishesBleeding > 0) {
            <button mat-button class="show-bleeding" (click)="status.set('bleeding')">Show them · عرضها</button>
          } @else {
            <small class="chip">None · لا يوجد</small>
          }
        </div>
      </div>

      <details class="pools">
        <summary>
          What is in the pools · مكونات الأوعية: labor {{ r.labor.total | money }}, overheads {{ r.overhead.total | money }} over {{ r.days }}
          {{ r.days === 1 ? 'day' : 'days' }}, {{ r.platesSold | number: '1.0-3' }} plates, {{ r.sales | money }} of sales before VAT
        </summary>
        <div class="pool-lists">
          @for (pool of [{ name: 'Labor · العمالة', pool: r.labor }, { name: 'Overheads · الإيجار والمرافق والإهلاك', pool: r.overhead }]; track pool.name) {
            <div>
              <h4>{{ pool.name }}</h4>
              <ul>
                @for (p of pool.pool.parts; track p.key) {
                  <li><span>{{ p.label }} · <span lang="ar">{{ p.labelAr }}</span></span><strong>{{ p.amount | money }}</strong></li>
                } @empty {
                  <li class="muted">Nothing recorded for these days · لا شيء مسجل</li>
                }
              </ul>
              @if (pool.pool.standInMonths.length) {
                <p class="muted small">Stand-in monthly figure from Cost settings for {{ pool.pool.standInMonths.join(', ') }}: nothing was recorded then.</p>
              }
            </div>
          }
        </div>
      </details>

      <div class="toolbar smart">
        <app-search-field [(value)]="search" placeholder="Dish, code or category · الصنف أو الكود" />
        <div class="pills">
          <app-filter-select label="Status · الحالة" icon="flag" [options]="statusFilters()" [(value)]="status" />
          <app-filter-select label="Menu · المنيو" icon="restaurant_menu" [options]="menuFilters()" [(value)]="menu" />
          <app-sort-control [options]="sorts" [(sort)]="sort" />
        </div>
      </div>

      <div class="legend" aria-label="What a plate's price is made of">
        <span><i class="swatch food"></i>Food · الخامات</span>
        <span><i class="swatch labor"></i>Labor · العمالة</span>
        <span><i class="swatch overhead"></i>Overhead · الإيجار والمرافق</span>
        <span><i class="swatch profit"></i>Net profit · صافي الربح</span>
        <span><i class="swatch loss"></i>Loss beyond the price · خسارة</span>
      </div>

      <div class="table-wrap">
        <table class="grid plate-table">
          <thead>
            <tr>
              <th>Dish<span class="ar">الصنف</span></th>
              <th class="bar-col">What the price is made of<span class="ar">تركيب سعر البيع</span></th>
              <th class="num">Qty sold<span class="ar">المباع</span></th>
              <th class="num">Selling price<span class="ar">سعر البيع</span></th>
              <th class="num">Food cost <app-info-tip tip="bcFood" /><span class="ar">الخامات</span></th>
              <th class="num">+ Labor <app-info-tip tip="bcLabor" /><span class="ar">العمالة</span></th>
              <th class="num">+ Overhead <app-info-tip tip="bcOverhead" /><span class="ar">التشغيل</span></th>
              <th class="num">= Fully burdened <app-info-tip tip="bcBurdened" /><span class="ar">التكلفة الكلية</span></th>
              <th class="num">True net profit <app-info-tip tip="bcNetProfit" /><span class="ar">صافي الربح</span></th>
              <th class="num">Suggested price <app-info-tip tip="bcSuggested" /><span class="ar">السعر المقترح</span></th>
              <th>Status<span class="ar">الحالة</span></th>
            </tr>
          </thead>
          <tbody>
            @for (v of view(); track v.row.itemCode + (v.row.recipeId ?? '')) {
              @let row = v.row;
              <tr [class.estimated]="row.estimated" [class.losing]="row.status === 'Losing'">
                <td>
                  @if (row.recipeId) {
                    <a class="dish" [routerLink]="['/costing/recipes/recipe', row.recipeId]">{{ row.dish }}</a>
                  } @else {
                    <strong>{{ row.dish }}</strong>
                  }
                  @if (row.dishAr) {
                    <span class="ar">{{ row.dishAr }}</span>
                  }
                  <div class="muted small">
                    {{ row.itemCode }}{{ row.itemCode && row.category ? ' · ' : '' }}{{ row.category ?? '' }}
                    · {{ row.weightedMinutes | number: '1.0-2' }} min{{ row.prepTimeAssumed ? ' (default)' : '' }}
                  </div>
                  @if (row.estimated) {
                    <span class="chip">{{ row.onMenu ? 'Not sold: estimated' : 'Off the menu: estimated' }} · تقديري</span>
                  }
                  @if (row.missingPrices) {
                    <span class="chip warn">Ingredient prices missing · أسعار ناقصة</span>
                  }
                </td>
                <td class="bar-col">
                  @if (v.bar; as bar) {
                    <div class="stack" role="img" [attr.aria-label]="barLabel(row)">
                      @for (s of bar.segments; track s.key) {
                        <span class="seg" [class]="s.key" [style.flex-grow]="s.share" [matTooltip]="s.label + ': ' + (s.amount | money) + ' · ' + (s.ofPrice | number: '1.0-1') + '% of the price'"></span>
                      }
                      @if (bar.lossFrom !== null) {
                        <span class="loss-band" [style.left.%]="bar.lossFrom" [matTooltip]="'Loss · خسارة: ' + (-(row.trueNetProfitPerPlate ?? 0) | money)"></span>
                        <span class="price-mark" [style.left.%]="bar.lossFrom" aria-hidden="true"></span>
                      }
                    </div>
                  } @else {
                    <span class="muted small">—</span>
                  }
                </td>
                <td class="num">{{ row.quantitySold | number: '1.0-3' }}</td>
                <td class="num">{{ row.sellingPrice === null ? '—' : (row.sellingPrice | money) }}</td>
                <td class="num">
                  {{ row.directFoodCost === null ? '—' : (row.directFoodCost | money) }}
                  <div class="small muted">{{ percent(row.foodCostPercent) }}</div>
                </td>
                <td class="num">
                  {{ row.allocatedLaborCost === null ? '—' : (row.allocatedLaborCost | money) }}
                  <div class="small muted">{{ percent(row.laborCostPercent) }}</div>
                </td>
                <td class="num">
                  {{ row.allocatedOverheadCost === null ? '—' : (row.allocatedOverheadCost | money) }}
                  <div class="small muted">{{ percent(row.overheadCostPercent) }}</div>
                </td>
                <td class="num">
                  <strong>{{ row.fullyBurdenedCost === null ? '—' : (row.fullyBurdenedCost | money) }}</strong>
                  <div class="small" [class.loss]="(row.fullyBurdenedCostPercent ?? 0) > 100">{{ percent(row.fullyBurdenedCostPercent) }}</div>
                </td>
                <td class="num" [class.loss]="(row.trueNetProfitPerPlate ?? 0) < 0">
                  <strong>{{ row.trueNetProfitPerPlate === null ? '—' : (row.trueNetProfitPerPlate | money) }}</strong>
                  <div class="small">{{ percent(row.trueNetMarginPercent) }}</div>
                  @if (row.quantitySold > 0 && row.totalPeriodNetProfit !== null) {
                    <div class="small muted">{{ row.totalPeriodNetProfit | money }} for the period</div>
                  }
                </td>
                <td class="num">
                  @if (row.suggestedPriceForTargetNetMargin === null) {
                    —
                  } @else {
                    <span [class.raise]="row.sellingPrice !== null && row.suggestedPriceForTargetNetMargin > row.sellingPrice">{{ row.suggestedPriceForTargetNetMargin | money }}</span>
                    @if (row.sellingPrice !== null && row.suggestedPriceForTargetNetMargin > row.sellingPrice) {
                      <div class="small raise">+{{ row.suggestedPriceForTargetNetMargin - row.sellingPrice | money }}</div>
                    }
                  }
                </td>
                <td>
                  <span class="status-badge" [class]="row.status">
                    <mat-icon aria-hidden="true">{{ statusIcons[row.status] }}</mat-icon>
                    {{ statusLabels[row.status].en }} <span class="ar">{{ statusLabels[row.status].ar }}</span>
                  </span>
                  @if (row.bleedingAfterOverhead) {
                    <div class="small loss">Profitable on food alone · رابح على الخامات فقط</div>
                  }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="11" class="muted">No dish{{ search() || status() || menu() ? ' matches' : ' on the menu yet' }}.</td></tr>
            }
          </tbody>
        </table>
      </div>
      <p class="muted small foot">
        Selling prices are the menu's, before VAT. Suggested prices leave a {{ r.targetNetMarginPercent | number: '1.0-1' }}% net margin (Cost settings).
        A dish not sold in these days carries what a plate of it would have.
      </p>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .controls {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px 20px;
      margin: 0 0 14px;
    }
    .methods,
    .source {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;

      .label {
        font: var(--mat-sys-label-medium);
        color: var(--mat-sys-on-surface-variant);
      }
      mat-button-toggle-group {
        flex-wrap: wrap;
      }
      mat-icon {
        width: 18px;
        height: 18px;
        font-size: 18px;
        vertical-align: -4px;
      }
    }
    .amount {
      width: 220px;
    }
    .hint {
      font: var(--mat-sys-body-small);
    }
    .loss {
      color: var(--mat-sys-error);
    }
    .raise {
      color: var(--app-warn);
    }
    .small {
      font-size: 0.85em;
    }
    .tile.alert {
      border-color: color-mix(in srgb, var(--mat-sys-error) 45%, transparent);
      strong {
        color: var(--mat-sys-error);
      }
    }
    .show-bleeding {
      justify-self: start;
    }
    .pools {
      margin: 0 0 14px;
      padding: 10px 14px;
      border-radius: 14px;
      border: 1px solid var(--app-line);
      background: var(--mat-sys-surface-container-lowest);

      summary {
        cursor: pointer;
        font: var(--mat-sys-body-medium);
      }
      .pool-lists {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        gap: 12px 24px;
        margin-top: 10px;
      }
      h4 {
        margin: 0 0 6px;
        font: var(--mat-sys-title-small);
      }
      ul {
        margin: 0;
        padding: 0;
        list-style: none;
      }
      li {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        padding: 3px 0;
        border-bottom: 1px dashed var(--app-line);
      }
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 16px;
      margin: 4px 0 8px;
      font: var(--mat-sys-label-medium);
      color: var(--mat-sys-on-surface-variant);

      span {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
    }
    .swatch {
      display: inline-block;
      width: 14px;
      height: 10px;
      border-radius: 3px;
    }
    .food {
      background: #2563eb;
    }
    .labor {
      background: #d97706;
    }
    .overhead {
      background: #7c3aed;
    }
    .profit {
      background: #059669;
    }
    .loss-pattern,
    .swatch.loss,
    .loss-band {
      background: repeating-linear-gradient(135deg, #dc2626 0 3px, color-mix(in srgb, #dc2626 25%, transparent) 3px 6px);
    }
    .bar-col {
      min-width: 170px;
    }
    .stack {
      position: relative;
      display: flex;
      gap: 2px;
      height: 14px;
      min-width: 160px;

      .seg {
        min-width: 2px;
        height: 100%;
      }
      .seg:first-child {
        border-radius: 4px 0 0 4px;
      }
      .seg:last-of-type {
        border-radius: 0 4px 4px 0;
      }
      .loss-band {
        position: absolute;
        inset-block: -2px;
        right: 0;
        border-radius: 0 4px 4px 0;
        opacity: 0.85;
      }
      .price-mark {
        position: absolute;
        inset-block: -4px;
        width: 2px;
        margin-left: -1px;
        background: var(--mat-sys-on-surface);
      }
    }
    .dish {
      font-weight: 600;
    }
    .plate-table td:first-child {
      min-width: 210px;
    }
    .chip {
      display: inline-block;
      margin-top: 2px;
      padding: 1px 8px;
      border-radius: 8px;
      font: var(--mat-sys-label-small);
      line-height: 18px;
      background: var(--mat-sys-surface-container-high);
      &.warn {
        color: var(--app-warn);
      }
    }
    tr.estimated td {
      color: var(--mat-sys-on-surface-variant);
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 0 8px;
      border-radius: 999px;
      font: var(--mat-sys-label-small);
      line-height: 22px;
      white-space: nowrap;
      background: var(--mat-sys-surface-container-high);
      color: var(--mat-sys-on-surface-variant);

      mat-icon {
        width: 14px;
        height: 14px;
        font-size: 14px;
      }
      .ar {
        display: inline;
        margin-inline-start: 4px;
      }
      &.Healthy {
        background: color-mix(in srgb, var(--app-ok) 14%, transparent);
        color: var(--app-ok);
      }
      &.Thin {
        background: color-mix(in srgb, var(--app-warn) 16%, transparent);
        color: var(--app-warn);
      }
      &.Losing {
        background: color-mix(in srgb, var(--mat-sys-error) 14%, transparent);
        color: var(--mat-sys-error);
      }
    }
    .foot {
      margin-top: 8px;
    }
    @media (max-width: 720px) {
      .amount {
        width: 100%;
      }
      .methods mat-button-toggle-group,
      .source mat-button-toggle-group {
        width: 100%;
      }
    }
  `,
})
export class BurdenedCostPage {
  private readonly api = inject(IntelligenceApi);
  private readonly notify = inject(NotifyService);
  protected readonly company = inject(Company);
  protected readonly methods = methods;
  protected readonly methodLabels = allocationMethodLabels;
  protected readonly statusLabels = plateStatusLabels;
  protected readonly statusIcons = statusIcons;
  protected readonly sorts = sorts;

  protected readonly from = signal(periodDays('month').from);
  protected readonly to = signal(periodDays('month').to);
  // None: the cost settings' method, which the report then says.
  protected readonly method = signal<OverheadAllocationMethod | null>(null);
  protected readonly chosenMethod = computed(() => this.method() ?? this.report()?.method ?? null);
  protected readonly source = signal<PoolSource>('Actual');
  protected readonly monthlyLabor = signal<number | null>(null);
  protected readonly monthlyOverhead = signal<number | null>(null);

  protected readonly report = signal<BurdenedCostReport | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly search = signal('');
  protected readonly status = signal('');
  protected readonly menu = signal('');
  protected readonly sort = signal<SortState<PlateSort>>({ key: 'margin', direction: 1 });

  protected readonly statusFilters = computed<FilterOption[]>(() => {
    const rows = this.report()?.rows ?? [];
    const of = (status: PlateStatus) => rows.filter((r) => r.status === status).length;
    return [
      { value: '', label: 'All · الكل', count: rows.length },
      { value: 'bleeding', label: 'Bleeding after overhead · خاسرة بعد التحميل', count: rows.filter((r) => r.bleedingAfterOverhead).length },
      ...(['Healthy', 'Thin', 'Losing', 'NoRecipe', 'NoPrice', 'NotAllocated'] as PlateStatus[])
        .filter((s) => of(s) > 0)
        .map((s) => ({ value: s, label: `${plateStatusLabels[s].en} · ${plateStatusLabels[s].ar}`, count: of(s) })),
    ];
  });

  protected readonly menuFilters = computed<FilterOption[]>(() => {
    const rows = this.report()?.rows ?? [];
    return [
      { value: '', label: 'All · الكل', count: rows.length },
      { value: 'sold', label: 'Sold in these days · المباع', count: rows.filter((r) => r.quantitySold > 0).length },
      { value: 'on', label: 'On the menu · على المنيو', count: rows.filter((r) => r.onMenu).length },
      { value: 'off', label: 'Off the menu (R&D) · خارج المنيو', count: rows.filter((r) => !r.onMenu).length },
    ];
  });

  private readonly shown = computed(() =>
    sortItems(
      (this.report()?.rows ?? []).filter(
        (r) =>
          (!this.status() || (this.status() === 'bleeding' ? r.bleedingAfterOverhead : r.status === this.status())) &&
          (!this.menu() || (this.menu() === 'sold' ? r.quantitySold > 0 : this.menu() === 'on' ? r.onMenu : !r.onMenu)) &&
          smartMatch(this.search(), r.dish, r.dishAr, r.itemCode, r.category),
      ),
      this.sort(),
      (r, key) =>
        key === 'margin'
          ? r.trueNetMarginPercent
          : key === 'profit'
            ? r.trueNetProfitPerPlate
            : key === 'periodProfit'
              ? r.totalPeriodNetProfit
              : key === 'burdened'
                ? r.fullyBurdenedCostPercent
                : key === 'sold'
                  ? r.quantitySold
                  : r.dish,
      (r) => r.dish,
    ),
  );

  // Each row with its bar, worked out once a load.
  protected readonly view = computed(() => this.shown().map((row) => ({ row, bar: priceSegments(row) })));

  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const query: BurdenedCostQuery = {
        from: this.from(),
        to: this.to(),
        method: this.method(),
        source: this.source(),
        monthlyLabor: this.monthlyLabor(),
        monthlyOverhead: this.monthlyOverhead(),
      };
      // Typed figures wait for a pause; anything else loads at once.
      untracked(() => {
        if (this.timer) {
          clearTimeout(this.timer);
        }
        if (query.source === 'Simulated' && this.report()?.source === 'Simulated') {
          this.timer = setTimeout(() => void this.load(query), 400);
        } else {
          void this.load(query);
        }
      });
    });
  }

  protected tipOf(method: OverheadAllocationMethod): InfoTipKey {
    return methods.find((m) => m.method === method)!.tip;
  }

  // A typed figure; cleared, none (the cost settings' stand-in).
  protected figure(value: unknown): number | null {
    return value === null || value === '' || value === undefined || Number.isNaN(Number(value)) ? null : Number(value);
  }

  protected percent(value: number | null): string {
    return value === null ? '—' : `${value.toFixed(1)}%`;
  }

  protected barLabel(row: BurdenedPlateRow): string {
    const part = (label: string, value: number | null) => (value === null ? '' : `${label} ${value.toFixed(2)}`);
    const parts = [
      part('food', row.directFoodCost),
      part('labor', row.allocatedLaborCost),
      part('overhead', row.allocatedOverheadCost),
      part((row.trueNetProfitPerPlate ?? 0) < 0 ? 'loss' : 'net profit', row.trueNetProfitPerPlate === null ? null : Math.abs(row.trueNetProfitPerPlate)),
    ].filter((p) => p);
    return `${row.dish} at ${row.sellingPrice?.toFixed(2) ?? 'no price'}: ${parts.join(', ')}`;
  }

  protected async download(): Promise<void> {
    try {
      saveBlob(await firstValueFrom(this.api.burdenedCostsSheet(this.query())), `burdened-plate-cost-${this.from()}-to-${this.to()}.xlsx`);
    } catch (error) {
      this.notify.error(error, 'The sheet could not be downloaded.');
    }
  }

  private query(): BurdenedCostQuery {
    return {
      from: this.from(),
      to: this.to(),
      method: this.method(),
      source: this.source(),
      monthlyLabor: this.monthlyLabor(),
      monthlyOverhead: this.monthlyOverhead(),
    };
  }

  // The latest asked wins: an answer to an earlier question, arriving after, is dropped.
  private asked = 0;

  private async load(query: BurdenedCostQuery): Promise<void> {
    const asked = ++this.asked;
    this.loading.set(true);
    this.error.set(null);
    try {
      const report = await firstValueFrom(this.api.burdenedCosts(query));
      if (asked === this.asked) {
        this.report.set(report);
      }
    } catch (error) {
      if (asked === this.asked) {
        this.error.set(errorMessage(error, 'The burdened plate cost could not be worked out.'));
      }
    } finally {
      if (asked === this.asked) {
        this.loading.set(false);
      }
    }
  }
}
