import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import {
  CostingApi,
  FixedAssetCategory,
  FixedAssetRegister,
  FixedAssetRow,
  fixedAssetCategoryLabels,
  fixedAssetStatusLabels,
} from '../../core/costing/costing.api';
import { errorMessage } from '../../core/http/error-message';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { NotifyService } from '../../core/ui/notify.service';
import { saveBlob } from '../../core/ui/save-blob';
import { FilterSelect, FilterOption } from '../shared/filter-select';
import { SearchField } from '../shared/search-field';
import { SortOption, SortState, smartMatch, sortItems } from '../shared/smart-search';
import { SortControl } from '../shared/sort-control';
import { Approvals, pendingLabel } from './approvals';
import { FixedAssetActions, assetCategories } from './fixed-asset-dialogs';
import { InfoTip } from './info-tip';

type AssetSort = 'code' | 'name' | 'category' | 'date' | 'cost' | 'life' | 'monthly' | 'accumulated' | 'bookValue' | 'status';

const sorts: SortOption<AssetSort>[] = [
  { key: 'code', en: 'Asset code', ar: 'كود الأصل' },
  { key: 'name', en: 'Name', ar: 'الاسم' },
  { key: 'category', en: 'Category', ar: 'الفئة' },
  { key: 'date', en: 'Purchase date', ar: 'تاريخ الشراء', descending: true },
  { key: 'cost', en: 'Cost', ar: 'التكلفة', descending: true },
  { key: 'life', en: 'Useful life', ar: 'العمر الإنتاجي', descending: true },
  { key: 'monthly', en: 'Monthly depr.', ar: 'القسط الشهري', descending: true },
  { key: 'accumulated', en: 'Accumulated depr.', ar: 'مجمع الإهلاك', descending: true },
  { key: 'bookValue', en: 'Net book value', ar: 'القيمة الدفترية', descending: true },
  { key: 'status', en: 'Status', ar: 'الحالة' },
];

const statusOrder = { Active: 1, FullyDepreciated: 2, Disposed: 3, Sold: 4 } as const;

// Fixed assets (الأصول الثابتة) on Financials: the register at the end of a month. Capital spending
// (CAPEX) leaves the safe or the bank the day an asset is bought and never touches the operating
// expenses; the profit and loss takes its straight-line depreciation a month at a time, below EBITDA.
// The cards count what was held at the month's end; the table every asset bought by then, the ones
// disposed of or sold too; each column sorts.
@Component({
  selector: 'app-fixed-assets-page',
  imports: [
    DatePipe,
    DecimalPipe,
    FilterSelect,
    InfoTip,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatProgressBarModule,
    MatTooltipModule,
    MoneyPipe,
    SearchField,
    SortControl,
  ],
  template: `
    <div class="toolbar">
      <button mat-icon-button (click)="move(-1)" aria-label="The month before"><mat-icon>chevron_left</mat-icon></button>
      <strong class="month">{{ monthStart() | date: 'MMMM y' }}</strong>
      <button mat-icon-button (click)="move(1)" [disabled]="isThisMonth()" aria-label="The month after"><mat-icon>chevron_right</mat-icon></button>
      <span class="spacer"></span>
      <button mat-stroked-button (click)="export()" [disabled]="!report() || exporting()"><mat-icon>download</mat-icon> Export register to Excel</button>
      <button mat-flat-button (click)="acquire()"><mat-icon>add</mat-icon> Asset acquisition (CAPEX) · شراء أصل</button>
    </div>
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    @if (error(); as e) {
      <p class="error">{{ e }}</p>
    } @else if (report(); as r) {
      <div class="tiles">
        <div class="tile">
          <span class="label">Total assets cost · إجمالي تكلفة الأصول <app-info-tip tip="faTotalCost" /></span>
          <strong>{{ r.totalCost | money }}</strong>
          <small class="chip">{{ r.activeCount + r.fullyDepreciatedCount }} held · {{ r.fullyDepreciatedCount }} fully depreciated</small>
        </div>
        <div class="tile">
          <span class="label">Accumulated depreciation · مجمع الإهلاك <app-info-tip tip="faAccumulated" /></span>
          <strong>{{ r.accumulatedDepreciation | money }}</strong>
          <small class="chip">{{ share(r.accumulatedDepreciation, r.totalCost) }} of the cost</small>
        </div>
        <div class="tile key">
          <span class="label">Net book value · القيمة الدفترية الحالية <app-info-tip tip="faNetBookValue" /></span>
          <strong>{{ r.netBookValue | money }}</strong>
          <small class="chip">at {{ r.asOf | date: 'd MMM y' }}</small>
        </div>
        <div class="tile">
          <span class="label">Monthly depreciation run rate · قسط الإهلاك الشهري <app-info-tip tip="faRunRate" /></span>
          <strong>{{ r.depreciationThisMonth | money }}</strong>
          <small class="chip">on this month's P&L, below EBITDA</small>
        </div>
      </div>

      <p class="investing" aria-label="This month's investing cash">
        <mat-icon>swap_vert</mat-icon>
        <span>
          <strong>CAPEX this month · الإنفاق الرأسمالي:</strong>
          {{ r.boughtFromSafe | money }} out of the safe · {{ r.boughtFromBank | money }} by the bank
          @if (r.ownedAlreadyAdded) {
            · {{ r.ownedAlreadyAdded | money }} owned already, added
          }
          @if (r.saleProceeds || r.disposalGainOrLoss) {
            · sales brought in {{ r.saleProceeds | money }},
            <span [class.gain]="r.disposalGainOrLoss > 0" [class.loss]="r.disposalGainOrLoss < 0">
              {{ r.disposalGainOrLoss >= 0 ? 'a gain of' : 'a loss of' }} {{ abs(r.disposalGainOrLoss) | money }}
            </span>
          }
          <span class="muted"> · never in the operating expenses</span>
        </span>
      </p>

      @if (waiting().length) {
        <ul class="waiting">
          @for (w of waiting(); track w.id) {
            <li>
              <span class="pending-badge">{{ pendingLabel(w).en }}<span class="ar">{{ pendingLabel(w).ar }}</span></span>
              {{ w.summary }} <span class="muted small">· asked by {{ w.requestedBy }}: no cash has moved</span>
            </li>
          }
        </ul>
      }

      <div class="toolbar smart">
        <app-search-field [(value)]="search" placeholder="Code, name or location · الكود أو الاسم أو الموقع" />
        <app-filter-select label="Category · الفئة" icon="category" [options]="categoryOptions()" [(value)]="category" />
        <app-filter-select label="Status · الحالة" icon="flag" [options]="statusOptions()" [(value)]="status" />
        <span class="spacer"></span>
        <app-sort-control [options]="sorts" [(sort)]="sort" />
      </div>

      <div class="table-wrap">
        <table class="grid register">
          <thead>
            <tr>
              @for (c of columns; track c.key) {
                <th [class.num]="c.num" [attr.aria-sort]="sort().key === c.key ? (sort().direction === 1 ? 'ascending' : 'descending') : 'none'">
                  <button type="button" class="sort-head" (click)="sortBy(c.key)">
                    {{ c.en }}
                    @if (sort().key === c.key) {
                      <mat-icon>{{ sort().direction === 1 ? 'arrow_upward' : 'arrow_downward' }}</mat-icon>
                    }
                  </button>
                  @if (c.tip) {
                    <app-info-tip [tip]="c.tip" />
                  }
                  <span class="ar">{{ c.ar }}</span>
                </th>
              }
              <th class="num"><span class="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (a of shown(); track a.id) {
              @let asked = approvals.pendingFor(a.purchaseTransactionId ?? '') ?? approvals.pendingFor(a.saleTransactionId ?? '');
              <tr [class.gone]="a.status === 'Disposed' || a.status === 'Sold'" [class.pending-deletion]="!!asked">
                <td class="code">{{ a.assetCode }}</td>
                <td>
                  <strong>{{ a.name }}</strong>
                  <div class="muted small">
                    {{ a.location ?? 'No location' }} · {{ a.paidFrom === 'Bank' ? 'paid by the bank' : a.paidFrom === 'Safe' ? 'paid from the safe' : 'owned already' }}
                  </div>
                  @if (a.disposalDate) {
                    <div class="muted small">
                      {{ a.status === 'Sold' ? 'Sold' : 'Written off' }} {{ a.disposalDate | date: 'd MMM y' }}
                      @if (a.saleProceeds) {
                        for {{ a.saleProceeds | money }}
                      }
                      · <span [class.gain]="(a.gainOrLoss ?? 0) > 0" [class.loss]="(a.gainOrLoss ?? 0) < 0">
                        {{ (a.gainOrLoss ?? 0) >= 0 ? 'gain' : 'loss' }} {{ abs(a.gainOrLoss ?? 0) | money }}</span>
                    </div>
                  }
                </td>
                <td>{{ categoryLabels[a.category].en }}<span class="ar">{{ categoryLabels[a.category].ar }}</span></td>
                <td class="nowrap">{{ a.purchaseDate | date: 'd MMM y' }}</td>
                <td class="num">{{ a.purchaseCost | money }}</td>
                <td class="num nowrap">
                  {{ a.usefulLifeMonths }} mo
                  <div class="muted small">{{ a.monthsCharged }} charged</div>
                </td>
                <td class="num">{{ a.monthlyDepreciation | money }}</td>
                <td class="num">{{ a.accumulatedDepreciation | money }}</td>
                <td class="num"><strong>{{ a.netBookValue | money }}</strong></td>
                <td>
                  <span class="badge" [class]="a.status">{{ statusLabels[a.status].en }}<span class="ar">{{ statusLabels[a.status].ar }}</span></span>
                  @if (asked) {
                    <div><span class="pending-badge">{{ pendingLabel(asked).en }}</span></div>
                  }
                </td>
                <td class="num actions">
                  @if (asked) {
                    <mat-icon class="locked" matTooltip="Waiting for a manager's approval">lock_clock</mat-icon>
                  } @else {
                    <button mat-icon-button [matMenuTriggerFor]="menu" [attr.aria-label]="'Actions for ' + a.assetCode"><mat-icon>more_vert</mat-icon></button>
                    <mat-menu #menu="matMenu">
                      @if (a.status === 'Active' || a.status === 'FullyDepreciated') {
                        <button mat-menu-item (click)="dispose(a)"><mat-icon>sell</mat-icon> Dispose / sell asset · استبعاد أو بيع الأصل</button>
                        @if (approvals.canApprove()) {
                          <button mat-menu-item (click)="edit(a)"><mat-icon>edit</mat-icon> Edit · تعديل</button>
                        }
                      } @else if (approvals.canApprove() || a.status === 'Sold') {
                        <button mat-menu-item (click)="undo(a)"><mat-icon>undo</mat-icon> {{ a.status === 'Sold' ? 'Void the sale · إلغاء البيع' : 'Undo the write-off · تراجع' }}</button>
                      }
                      @if (a.paidFrom ? a.status !== 'Sold' : approvals.canApprove() && a.status !== 'Sold') {
                        <button mat-menu-item class="danger" (click)="remove(a)">
                          <mat-icon>delete</mat-icon> {{ a.paidFrom ? 'Void the purchase · إلغاء الشراء' : 'Remove from the register · حذف' }}
                        </button>
                      }
                    </mat-menu>
                  }
                </td>
              </tr>
            } @empty {
              <tr>
                <td [attr.colspan]="columns.length + 1" class="muted">
                  {{ r.assets.length ? 'Nothing matches.' : 'No fixed assets yet: add the equipment, furniture and fit-out the restaurant owns.' }}
                </td>
              </tr>
            }
          </tbody>
          @if (shown().length) {
            <tfoot>
              <tr>
                <td colspan="4">Held, of those shown · القائم من المعروض ({{ held().length }})</td>
                <td class="num">{{ sum('purchaseCost') | money }}</td>
                <td></td>
                <td class="num">{{ sum('monthlyDepreciation') | money }}</td>
                <td class="num">{{ sum('accumulatedDepreciation') | money }}</td>
                <td class="num">{{ sum('netBookValue') | money }}</td>
                <td colspan="2"></td>
              </tr>
            </tfoot>
          }
        </table>
      </div>

      @if (r.categories.length) {
        <h3 class="section">By category · حسب الفئة</h3>
        <div class="table-wrap">
          <table class="grid categories">
            <thead>
              <tr>
                <th>Category<span class="ar">الفئة</span></th>
                <th class="num">Assets<span class="ar">العدد</span></th>
                <th class="num">Cost<span class="ar">التكلفة</span></th>
                <th class="num">Accumulated<span class="ar">مجمع الإهلاك</span></th>
                <th class="num">Net book value<span class="ar">القيمة الدفترية</span></th>
                <th class="num">This month<span class="ar">إهلاك الشهر</span></th>
              </tr>
            </thead>
            <tbody>
              @for (c of r.categories; track c.category) {
                <tr>
                  <td>{{ categoryLabels[c.category].en }}<span class="ar">{{ categoryLabels[c.category].ar }}</span></td>
                  <td class="num">{{ c.count | number }}</td>
                  <td class="num">{{ c.cost | money }}</td>
                  <td class="num">{{ c.accumulatedDepreciation | money }}</td>
                  <td class="num">{{ c.netBookValue | money }}</td>
                  <td class="num">{{ c.depreciationThisMonth | money }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
      <p class="muted small">
        Straight-line: (cost − salvage value) ÷ useful life, a full month from the month bought; the month an asset goes is not charged, and the last month of
        its life takes what the rounding left.
      </p>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .month {
      min-width: 140px;
      text-align: center;
      font: var(--mat-sys-title-medium);
    }
    .spacer {
      flex: 1;
    }
    .toolbar {
      flex-wrap: wrap;
      gap: 8px;
    }
    .investing {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin: -4px 0 16px;
      padding: 10px 14px;
      border-radius: 12px;
      background: var(--mat-sys-surface-container);

      mat-icon {
        flex: none;
        color: var(--mat-sys-primary);
      }
    }
    .gain {
      color: var(--app-good, #15803d);
    }
    .loss {
      color: var(--mat-sys-error);
    }
    .waiting {
      margin: 0 0 12px;
      padding: 0;
      list-style: none;
      display: grid;
      gap: 4px;
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
    .sort-head {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 0;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      cursor: pointer;

      mat-icon {
        width: 16px;
        height: 16px;
        font-size: 16px;
      }
      &:focus-visible {
        outline: 2px solid var(--mat-sys-primary);
        outline-offset: 2px;
      }
    }
    th.num .sort-head {
      flex-direction: row-reverse;
    }
    .badge {
      display: inline-block;
      padding: 1px 8px;
      border-radius: 999px;
      font: var(--mat-sys-label-small);
      white-space: nowrap;

      &.Active {
        background: color-mix(in srgb, var(--app-good, #15803d) 16%, transparent);
        color: var(--app-good, #15803d);
      }
      &.FullyDepreciated {
        background: var(--mat-sys-surface-container-high);
        color: var(--mat-sys-on-surface-variant);
      }
      &.Disposed,
      &.Sold {
        background: color-mix(in srgb, var(--mat-sys-on-surface) 8%, transparent);
        color: var(--mat-sys-on-surface-variant);
      }
      .ar {
        margin-inline-start: 4px;
      }
    }
    tr.gone td {
      color: var(--mat-sys-on-surface-variant);
    }
    tfoot td {
      font-weight: 600;
      border-top: 2px solid var(--app-line-strong);
    }
    .section {
      margin: 20px 0 8px;
      font: var(--mat-sys-title-small);
    }
    .danger {
      color: var(--mat-sys-error);
    }
    .actions {
      white-space: nowrap;
    }
    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
    }
  `,
})
export class FixedAssetsPage {
  private readonly api = inject(CostingApi);
  private readonly actions = inject(FixedAssetActions);
  private readonly notify = inject(NotifyService);
  protected readonly approvals = inject(Approvals);
  protected readonly pendingLabel = pendingLabel;
  protected readonly categoryLabels = fixedAssetCategoryLabels;
  protected readonly statusLabels = fixedAssetStatusLabels;
  protected readonly sorts = sorts;

  protected readonly columns: { key: AssetSort; en: string; ar: string; num?: boolean; tip?: 'faAccumulated' | 'faNetBookValue' | 'faRunRate' }[] = [
    { key: 'code', en: 'Asset code', ar: 'كود الأصل' },
    { key: 'name', en: 'Name', ar: 'الاسم' },
    { key: 'category', en: 'Category', ar: 'الفئة' },
    { key: 'date', en: 'Purchase date', ar: 'تاريخ الشراء' },
    { key: 'cost', en: 'Cost', ar: 'التكلفة', num: true },
    { key: 'life', en: 'Useful life', ar: 'العمر الإنتاجي', num: true },
    { key: 'monthly', en: 'Monthly depr.', ar: 'القسط الشهري', num: true, tip: 'faRunRate' },
    { key: 'accumulated', en: 'Accumulated depr.', ar: 'مجمع الإهلاك', num: true, tip: 'faAccumulated' },
    { key: 'bookValue', en: 'Net book value', ar: 'القيمة الدفترية', num: true, tip: 'faNetBookValue' },
    { key: 'status', en: 'Status', ar: 'الحالة' },
  ];

  private readonly now = new Date();
  protected readonly year = signal(this.now.getFullYear());
  protected readonly month = signal(this.now.getMonth() + 1);
  protected readonly report = signal<FixedAssetRegister | null>(null);
  protected readonly loading = signal(true);
  protected readonly exporting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly search = signal('');
  protected readonly category = signal<string>('');
  protected readonly status = signal<string>('');
  protected readonly sort = signal<SortState<AssetSort>>({ key: 'code', direction: 1 });

  protected readonly monthStart = computed(() => new Date(this.year(), this.month() - 1, 1));
  protected readonly isThisMonth = computed(() => this.year() === this.now.getFullYear() && this.month() === this.now.getMonth() + 1);
  // Asset purchases asked of a manager, not made yet.
  protected readonly waiting = computed(() =>
    this.approvals.waitingToBeMade('Treasury').filter((r) => r.summary.startsWith('Fixed asset bought')),
  );

  protected readonly categoryOptions = computed<FilterOption[]>(() => {
    const rows = this.report()?.assets ?? [];
    return [
      { value: '', label: 'All · الكل', count: rows.length },
      ...assetCategories
        .filter((c) => rows.some((a) => a.category === c))
        .map((c) => ({ value: c, label: `${fixedAssetCategoryLabels[c].en} · ${fixedAssetCategoryLabels[c].ar}`, count: rows.filter((a) => a.category === c).length })),
    ];
  });

  protected readonly statusOptions = computed<FilterOption[]>(() => {
    const rows = this.report()?.assets ?? [];
    return [
      { value: '', label: 'All · الكل', count: rows.length },
      ...(['Active', 'FullyDepreciated', 'Disposed', 'Sold'] as const)
        .filter((s) => rows.some((a) => a.status === s))
        .map((s) => ({ value: s, label: `${fixedAssetStatusLabels[s].en} · ${fixedAssetStatusLabels[s].ar}`, count: rows.filter((a) => a.status === s).length })),
    ];
  });

  protected readonly shown = computed(() =>
    sortItems(
      (this.report()?.assets ?? []).filter(
        (a) =>
          (!this.category() || a.category === (this.category() as FixedAssetCategory)) &&
          (!this.status() || a.status === this.status()) &&
          smartMatch(this.search(), a.assetCode, a.name, a.location, a.notes, fixedAssetCategoryLabels[a.category].en, fixedAssetCategoryLabels[a.category].ar),
      ),
      this.sort(),
      (a, key) =>
        ({
          code: a.assetCode,
          name: a.name,
          category: fixedAssetCategoryLabels[a.category].en,
          date: a.purchaseDate,
          cost: a.purchaseCost,
          life: a.usefulLifeMonths,
          monthly: a.monthlyDepreciation,
          accumulated: a.accumulatedDepreciation,
          bookValue: a.netBookValue,
          status: statusOrder[a.status],
        })[key],
      (a) => a.assetCode,
    ),
  );

  constructor() {
    void this.load();
    void this.approvals.refresh();
  }

  protected sortBy(key: AssetSort): void {
    const current = this.sort();
    const option = sorts.find((s) => s.key === key)!;
    this.sort.set(current.key === key ? { key, direction: current.direction === 1 ? -1 : 1 } : { key, direction: option.descending ? -1 : 1 });
  }

  // What the shown rows still held come to: the disposed of and sold left out, as the cards do.
  protected readonly held = computed(() => this.shown().filter((a) => a.status === 'Active' || a.status === 'FullyDepreciated'));

  protected sum(field: 'purchaseCost' | 'monthlyDepreciation' | 'accumulatedDepreciation' | 'netBookValue'): number {
    return Math.round(this.held().reduce((total, a) => total + a[field], 0) * 100) / 100;
  }

  protected share(part: number, whole: number): string {
    return whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '—';
  }

  protected abs(n: number): number {
    return Math.abs(n);
  }

  protected move(by: number): void {
    const next = new Date(this.year(), this.month() - 1 + by, 1);
    this.year.set(next.getFullYear());
    this.month.set(next.getMonth() + 1);
    void this.load();
  }

  protected async acquire(): Promise<void> {
    if (await this.actions.acquire(this.report()?.locations ?? [])) {
      await this.load();
    }
  }

  protected async edit(asset: FixedAssetRow): Promise<void> {
    if (await this.actions.edit(asset, this.report()?.locations ?? [])) {
      await this.load();
    }
  }

  protected async dispose(asset: FixedAssetRow): Promise<void> {
    if (await this.actions.dispose(asset)) {
      await this.load();
    }
  }

  protected async undo(asset: FixedAssetRow): Promise<void> {
    if (await this.actions.undoDisposal(asset)) {
      await this.load();
    }
  }

  protected async remove(asset: FixedAssetRow): Promise<void> {
    if (await this.actions.remove(asset)) {
      await this.load();
    }
  }

  protected async export(): Promise<void> {
    this.exporting.set(true);
    try {
      const blob = await firstValueFrom(this.api.exportFixedAssets(this.year(), this.month()));
      saveBlob(blob, `fixed-assets-${this.year()}-${String(this.month()).padStart(2, '0')}.xlsx`);
    } catch (error) {
      this.notify.error(error, 'The register could not be exported.');
    } finally {
      this.exporting.set(false);
    }
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.report.set(await firstValueFrom(this.api.fixedAssets(this.year(), this.month())));
    } catch (error) {
      this.error.set(errorMessage(error, 'The fixed assets register could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }
}
