import { DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';
import {
  ConsumptionRow,
  IntelligenceApi,
  StationStatus,
  StationVariance,
  StationVarianceReport,
  evaluationLabels,
  stationStatusLabels,
} from '../../core/costing/intelligence.api';
import { errorMessage } from '../../core/http/error-message';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { NotifyService } from '../../core/ui/notify.service';
import { saveBlob } from '../../core/ui/save-blob';
import { FilterOption, FilterSelect } from '../shared/filter-select';
import { SearchField } from '../shared/search-field';
import { SortOption, SortState, smartMatch, sortItems } from '../shared/smart-search';
import { SortControl } from '../shared/sort-control';
import { InfoTip } from './info-tip';
import { PeriodBar, periodDays } from './period-bar';
import { showStockCard } from './stock-card-dialog';

type MaterialSort = 'cost' | 'percent' | 'material';

const sorts: SortOption<MaterialSort>[] = [
  { key: 'cost', en: 'Variance cost', ar: 'قيمة الانحراف', descending: true },
  { key: 'percent', en: 'Variance %', ar: 'نسبة الانحراف', descending: true },
  { key: 'material', en: 'Material', ar: 'الخامة' },
];

const statusIcons: Record<StationStatus, string> = { WithinTarget: 'check_circle', Watch: 'warning', HighLoss: 'error' };

// A station's key on the page: its id, or 'shared' for the shared group with no station of its own.
const keyOf = (id: string | null): string => id ?? 'shared';

// Station-level variance (تحليل الهدر والانحراف حسب أقسام المطبخ والبار): one scorecard a kitchen or
// bar station, its materials' theoretical against actual cost, the unexplained between them and its
// share, the waste held against it and its three materials losing the most, judged against its
// tolerance; a bar a station of its unexplained % against its tolerance line; and each material of
// the station chosen, its stock card a click away. As a workbook too.
@Component({
  selector: 'app-station-variance-page',
  imports: [DecimalPipe, FilterSelect, InfoTip, MatButtonModule, MatIconModule, MatProgressBarModule, MoneyPipe, PeriodBar, SearchField, SortControl],
  template: `
    <div class="toolbar">
      <app-period-bar [(from)]="from" [(to)]="to" />
      <span class="spacer"></span>
      <button mat-stroked-button (click)="download()" [disabled]="!report()">
        <mat-icon>download</mat-icon> Export station variance<span class="inline-ar">تصدير انحراف الأقسام</span>
      </button>
    </div>
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    @if (error()) {
      <p class="error">{{ error() }}</p>
    } @else if (report(); as r) {
      <p class="lead">
        Unexplained across the stations <app-info-tip tip="stationUnexplained" />:
        <strong [class.loss]="r.unexplainedValue > 0" [class.gain]="r.unexplainedValue < 0">{{ r.unexplainedValue | money }}</strong>
        of {{ r.theoreticalValue | money }} theoretical · logged waste {{ r.wasteValue | money }}
        <span class="inline-ar">إجمالي الانحراف غير المبرر للأقسام</span>
      </p>

      <div class="scorecards" role="list" aria-label="Stations">
        @for (s of r.stations; track keyOf(s.stationId)) {
          <button type="button" role="listitem" class="scorecard" [class]="s.status" [class.selected]="selected() === keyOf(s.stationId)"
            [attr.aria-pressed]="selected() === keyOf(s.stationId)" (click)="select(s)" [attr.aria-label]="s.station + ', ' + labels[s.status].en">
            <header>
              <span class="name">{{ s.station }}@if (s.stationAr) {<span class="ar">{{ s.stationAr }}</span>}</span>
              <span class="badge" [class]="s.status"><mat-icon>{{ icons[s.status] }}</mat-icon> {{ labels[s.status].en }} · {{ labels[s.status].ar }}</span>
            </header>
            <dl>
              <div><dt>Theoretical <app-info-tip tip="stationTheoretical" /></dt><dd>{{ s.theoreticalConsumptionCost | money }}</dd></div>
              <div><dt>Actual <app-info-tip tip="stationActual" /></dt><dd>{{ s.actualConsumptionCost | money }}</dd></div>
              <div class="key">
                <dt>Unexplained <app-info-tip tip="stationUnexplained" /></dt>
                <dd [class.loss]="s.unexplainedVarianceCost > 0" [class.gain]="s.unexplainedVarianceCost < 0">
                  {{ s.unexplainedVarianceCost | money }}
                  <small>{{ s.unexplainedVariancePercent === null ? '—' : (s.unexplainedVariancePercent > 0 ? '+' : '') + (s.unexplainedVariancePercent | number: '1.1-1') + '%' }}</small>
                </dd>
              </div>
              <div><dt>Logged waste <app-info-tip tip="stationWaste" /></dt><dd>{{ s.loggedSpoilageWasteCost | money }}</dd></div>
            </dl>
            <footer>
              <span class="muted small">{{ s.materials }} {{ s.materials === 1 ? 'material' : 'materials' }} · ±{{ s.tolerancePercent | number: '1.0-2' }}%</span>
              @if (s.topLossMaterials.length) {
                <span class="leaks" aria-label="Top leaking materials">
                  @for (m of s.topLossMaterials; track m.rawMaterialId) {
                    <span class="leak">{{ m.material }} {{ m.varianceCost | money }}</span>
                  }
                </span>
              }
            </footer>
          </button>
        }
      </div>

      <section class="comparison" aria-labelledby="comparison-title">
        <h3 id="comparison-title">Unexplained variance % by station <span class="inline-ar">نسبة الانحراف حسب القسم</span> <app-info-tip tip="stationComparison" /></h3>
        <div class="bars">
          @for (s of r.stations; track keyOf(s.stationId)) {
            <div class="bar-row" [attr.aria-label]="s.station + ': ' + percentText(s) + ' against ±' + s.tolerancePercent + '%'">
              <span class="bar-label">{{ s.station }}</span>
              <span class="track" (click)="select(s)">
                <span class="zero" [style.left.%]="position(0)"></span>
                @if (s.unexplainedVariancePercent !== null) {
                  <span class="fill" [class]="s.status" [style.left.%]="position(Math.min(0, s.unexplainedVariancePercent))"
                    [style.width.%]="position(Math.max(0, s.unexplainedVariancePercent)) - position(Math.min(0, s.unexplainedVariancePercent))"
                    [attr.title]="s.station + ': ' + percentText(s)"></span>
                }
                <span class="limit" [style.left.%]="position(s.tolerancePercent)" [attr.title]="'Tolerance ±' + s.tolerancePercent + '%'"></span>
              </span>
              <span class="bar-value" [class.loss]="s.status === 'HighLoss'">{{ percentText(s) }}</span>
            </div>
          }
        </div>
        <p class="muted small legend">
          <span class="key-line"></span> each station's tolerance · <span class="dot WithinTarget"></span> within target · <span class="dot Watch"></span> watch
          (past {{ r.watchSharePercent | number: '1.0-0' }}% of it) · <span class="dot HighLoss"></span> high loss
        </p>
      </section>

      <div class="toolbar smart">
        <app-search-field [(value)]="search" placeholder="Material or code · الخامة أو الكود" />
        <div class="pills">
          <app-filter-select label="Station · القسم" icon="soup_kitchen" [options]="stationFilters()" [value]="selected()" (valueChange)="selected.set($event)" />
          <app-filter-select label="Evaluation · التقييم" icon="flag" [options]="evaluationFilters()" [(value)]="evaluation" />
          <app-sort-control [options]="sorts" [(sort)]="sort" />
        </div>
      </div>
      <div class="table-wrap">
        <table class="grid detail">
          <thead>
            <tr>
              <th>Station<span class="ar">القسم</span></th>
              <th>Material<span class="ar">الخامة</span></th>
              <th class="num">Opening<span class="ar">أول المدة</span></th>
              <th class="num">Purchases<span class="ar">المشتريات</span></th>
              <th class="num">Logged waste <app-info-tip tip="recordedWaste" /><span class="ar">الهالك المسجل</span></th>
              <th class="num">Closing<span class="ar">آخر المدة</span></th>
              <th class="num">Actual <app-info-tip tip="actualUsage" /><span class="ar">الفعلي</span></th>
              <th class="num">Theoretical <app-info-tip tip="theoreticalUsage" /><span class="ar">النظري</span></th>
              <th class="num">Unexplained qty <app-info-tip tip="theoreticalVsActual" /><span class="ar">الكمية غير المبررة</span></th>
              <th class="num">Variance cost <app-info-tip tip="unexplainedVariance" /><span class="ar">قيمة الانحراف</span></th>
              <th class="num">Variance % <app-info-tip tip="stationPercent" /><span class="ar">النسبة</span></th>
              <th>Evaluation <app-info-tip tip="highLoss" /><span class="ar">التقييم</span></th>
            </tr>
          </thead>
          <tbody>
            @for (row of shown(); track row.rawMaterialId) {
              <tr [class.high-loss]="row.evaluation === 'Unfavourable'">
                <td class="muted">{{ stationName(row) }}</td>
                <td>
                  <button type="button" class="material" (click)="stockCard(row)" [attr.aria-label]="'Stock card of ' + row.material">
                    {{ row.material }} <mat-icon>receipt_long</mat-icon>
                  </button>
                  <div class="muted small">{{ row.code ? row.code + ' · ' : '' }}in {{ row.purchaseUnit }}</div>
                </td>
                <td class="num">{{ row.opening | number: '1.0-3' }}</td>
                <td class="num">{{ row.purchases | number: '1.0-3' }}</td>
                <td class="num">{{ row.waste | number: '1.0-3' }}</td>
                <td class="num">{{ row.closing | number: '1.0-3' }}</td>
                <td class="num"><strong>{{ row.actualUsage | number: '1.0-3' }}</strong></td>
                <td class="num">{{ row.theoreticalUsage | number: '1.0-3' }}</td>
                <td class="num" [class.loss]="row.unexplainedQuantity > 0" [class.gain]="row.unexplainedQuantity < 0">
                  {{ row.unexplainedQuantity > 0 ? '+' : '' }}{{ row.unexplainedQuantity | number: '1.0-3' }}
                </td>
                <td class="num" [class.loss]="(row.varianceCost ?? 0) > 0" [class.gain]="(row.varianceCost ?? 0) < 0">
                  <strong>{{ row.varianceCost === null ? '—' : (row.varianceCost | money) }}</strong>
                </td>
                <td class="num">{{ row.unexplainedPercent === null ? '—' : (row.unexplainedPercent > 0 ? '+' : '') + (row.unexplainedPercent | number: '1.1-1') + '%' }}</td>
                <td><span class="evaluation" [class]="row.evaluation">{{ evaluations[row.evaluation].en }}<span class="ar">{{ evaluations[row.evaluation].ar }}</span></span></td>
              </tr>
            } @empty {
              <tr><td colspan="12" class="muted">Nothing moved at {{ selected() ? 'this station' : 'any station' }} in these days{{ search() || evaluation() ? ' that matches' : '' }}.</td></tr>
            }
          </tbody>
          @if (selectedStation(); as s) {
            <tfoot>
              <tr>
                <td colspan="9">{{ s.station }} · unexplained variance</td>
                <td class="num">{{ s.unexplainedVarianceCost | money }}</td>
                <td class="num">{{ percentText(s) }}</td>
                <td>{{ labels[s.status].en }}</td>
              </tr>
            </tfoot>
          }
        </table>
      </div>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .lead {
      margin: 4px 0 14px;
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
    .scorecards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      gap: 12px;
      margin-bottom: 18px;
    }
    .scorecard {
      display: grid;
      gap: 8px;
      padding: 12px 14px;
      border: 1px solid var(--app-line);
      border-top: 4px solid var(--app-line-strong);
      border-radius: 14px;
      background: var(--mat-sys-surface-container-lowest);
      color: inherit;
      font: inherit;
      text-align: start;
      cursor: pointer;
      box-shadow: var(--app-card-shadow);

      &.WithinTarget {
        border-top-color: var(--app-ok);
      }
      &.Watch {
        border-top-color: var(--app-warn);
      }
      &.HighLoss {
        border-top-color: var(--mat-sys-error);
      }
      &.selected {
        outline: 2px solid var(--mat-sys-primary);
        outline-offset: 2px;
      }
      header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
      }
      .name {
        font: var(--mat-sys-title-small);

        .ar {
          display: block;
          font-size: 0.85em;
          opacity: 0.75;
        }
      }
      dl {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px 12px;
        margin: 0;

        div {
          display: grid;
          gap: 2px;
        }
        dt {
          display: flex;
          align-items: center;
          gap: 2px;
          font: var(--mat-sys-label-small);
          color: var(--mat-sys-on-surface-variant);
        }
        dd {
          margin: 0;
          font-variant-numeric: tabular-nums;
          font-weight: 600;
        }
        .key dd {
          font: var(--mat-sys-title-medium);
          font-weight: 700;

          small {
            margin-inline-start: 4px;
            font-size: 0.75em;
          }
        }
      }
      footer {
        display: grid;
        gap: 6px;
      }
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 1px 8px;
      border-radius: 999px;
      font: var(--mat-sys-label-small);
      white-space: nowrap;

      mat-icon {
        width: 16px;
        height: 16px;
        font-size: 16px;
      }
      &.WithinTarget {
        background: color-mix(in srgb, var(--app-ok) 14%, transparent);
        color: var(--app-ok);
      }
      &.Watch {
        background: color-mix(in srgb, var(--app-warn) 16%, transparent);
        color: var(--app-warn);
      }
      &.HighLoss {
        background: color-mix(in srgb, var(--mat-sys-error) 14%, transparent);
        color: var(--mat-sys-error);
      }
    }
    .leaks {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .leak {
      padding: 1px 8px;
      border-radius: 999px;
      background: var(--mat-sys-surface-container-high);
      font: var(--mat-sys-label-small);
    }
    .comparison {
      margin: 0 0 18px;
      padding: 12px 14px;
      border: 1px solid var(--app-line);
      border-radius: 14px;

      h3 {
        display: flex;
        align-items: center;
        gap: 6px;
        margin: 0 0 10px;
        font: var(--mat-sys-title-small);
      }
    }
    .bars {
      display: grid;
      gap: 6px;
    }
    .bar-row {
      display: grid;
      grid-template-columns: minmax(110px, 180px) minmax(0, 1fr) 64px;
      align-items: center;
      gap: 10px;
    }
    .bar-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font: var(--mat-sys-body-small);
    }
    .track {
      position: relative;
      height: 18px;
      border-radius: 4px;
      background: var(--mat-sys-surface-container);
      cursor: pointer;
    }
    .zero {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 1px;
      background: var(--mat-sys-outline);
    }
    .fill {
      position: absolute;
      top: 3px;
      bottom: 3px;
      border-radius: 4px;
      background: var(--app-ok);

      &.Watch {
        background: var(--app-warn);
      }
      &.HighLoss {
        background: var(--mat-sys-error);
      }
    }
    .limit {
      position: absolute;
      top: -2px;
      bottom: -2px;
      width: 2px;
      background: var(--mat-sys-on-surface);
    }
    .bar-value {
      font-variant-numeric: tabular-nums;
      text-align: end;
      font: var(--mat-sys-label-medium);
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px;
      margin: 10px 0 0;
    }
    .key-line {
      display: inline-block;
      width: 2px;
      height: 12px;
      background: var(--mat-sys-on-surface);
    }
    .dot {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 3px;
      background: var(--app-ok);

      &.Watch {
        background: var(--app-warn);
      }
      &.HighLoss {
        background: var(--mat-sys-error);
      }
    }
    button.material {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 0;
      border: 0;
      background: none;
      color: var(--mat-sys-primary);
      font: inherit;
      font-weight: 600;
      cursor: pointer;

      mat-icon {
        width: 16px;
        height: 16px;
        font-size: 16px;
      }
    }
    tr.high-loss td {
      background: color-mix(in srgb, var(--mat-sys-error) 7%, transparent);
    }
    .evaluation {
      display: inline-block;
      padding: 0 8px;
      border-radius: 999px;
      font-size: 11.5px;
      line-height: 20px;
      white-space: nowrap;
      background: var(--app-slate-100, #f1f5f9);
      color: var(--app-slate-600, #475569);

      .ar {
        margin-inline-start: 4px;
        opacity: 0.8;
      }
      &.Unfavourable {
        background: color-mix(in srgb, var(--mat-sys-error) 14%, transparent);
        color: var(--mat-sys-error);
      }
      &.Favourable {
        background: color-mix(in srgb, var(--app-ok) 14%, transparent);
        color: var(--app-ok);
      }
    }
    @media (max-width: 599.98px) {
      .bar-row {
        grid-template-columns: 90px minmax(0, 1fr) 52px;
      }
    }
  `,
})
export class StationVariancePage {
  private readonly api = inject(IntelligenceApi);
  private readonly notify = inject(NotifyService);
  private readonly dialog = inject(MatDialog);
  protected readonly labels = stationStatusLabels;
  protected readonly icons = statusIcons;
  protected readonly evaluations = evaluationLabels;
  protected readonly keyOf = keyOf;
  protected readonly Math = Math;

  protected readonly from = signal(periodDays('month').from);
  protected readonly to = signal(periodDays('month').to);
  protected readonly report = signal<StationVarianceReport | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  // The station whose materials are listed ('' all).
  protected readonly selected = signal('');
  protected readonly search = signal('');
  protected readonly evaluation = signal('');
  protected readonly sorts = sorts;
  protected readonly sort = signal<SortState<MaterialSort>>({ key: 'cost', direction: -1 });

  protected readonly selectedStation = computed(() => this.report()?.stations.find((s) => keyOf(s.stationId) === this.selected()) ?? null);

  protected readonly stationFilters = computed<FilterOption[]>(() => {
    const r = this.report();
    return [
      { value: '', label: 'All · الكل', count: r?.rows.length ?? 0 },
      ...(r?.stations ?? []).map((s) => ({
        value: keyOf(s.stationId),
        label: s.stationAr ? `${s.station} · ${s.stationAr}` : s.station,
        count: r!.rows.filter((row) => keyOf(row.kitchenStationId ?? null) === keyOf(s.stationId)).length,
      })),
    ];
  });

  protected readonly evaluationFilters = computed<FilterOption[]>(() => {
    const rows = this.inStation();
    return [
      { value: '', label: 'All · الكل', count: rows.length },
      ...(['Unfavourable', 'Favourable', 'WithinLimit', 'SharedCost'] as const)
        .map((e) => ({ value: e, label: `${evaluationLabels[e].en} · ${evaluationLabels[e].ar}`, count: rows.filter((r) => r.evaluation === e).length }))
        .filter((o) => o.count > 0),
    ];
  });

  private readonly inStation = computed(() =>
    (this.report()?.rows ?? []).filter((r) => !this.selected() || keyOf(r.kitchenStationId ?? null) === this.selected()),
  );

  protected readonly shown = computed(() =>
    sortItems(
      this.inStation().filter((r) => (!this.evaluation() || r.evaluation === this.evaluation()) && smartMatch(this.search(), r.material, r.code)),
      this.sort(),
      (r, key) => (key === 'cost' ? r.varianceCost : key === 'percent' ? r.unexplainedPercent : r.material),
      (r) => r.material,
    ),
  );

  // The comparison's scale: from the deepest surplus (or 0) to past the furthest loss or tolerance.
  private readonly scale = computed(() => {
    const stations = this.report()?.stations ?? [];
    const values = stations.flatMap((s) => [s.unexplainedVariancePercent ?? 0, s.tolerancePercent]);
    const low = Math.min(0, ...values);
    const high = Math.max(1, ...values);
    const pad = (high - low) * 0.08;
    return { low: low < 0 ? low - pad : 0, high: high + pad };
  });

  constructor() {
    effect(() => {
      const [from, to] = [this.from(), this.to()];
      untracked(() => void this.load(from, to));
    });
  }

  // Where a percentage sits on the comparison's track, 0 to 100.
  protected position(percent: number): number {
    const { low, high } = this.scale();
    return ((percent - low) / (high - low)) * 100;
  }

  protected percentText(s: StationVariance): string {
    const p = s.unexplainedVariancePercent;
    return p === null ? '—' : `${p > 0 ? '+' : ''}${p.toFixed(1)}%`;
  }

  protected stationName(row: ConsumptionRow): string {
    return this.report()?.stations.find((s) => keyOf(s.stationId) === keyOf(row.kitchenStationId ?? null))?.station ?? 'Shared / General';
  }

  // The scorecard clicked: its materials below; clicked again, every station's.
  protected select(s: StationVariance): void {
    const key = keyOf(s.stationId);
    this.selected.set(this.selected() === key ? '' : key);
  }

  protected stockCard(row: ConsumptionRow): void {
    showStockCard(this.dialog, { id: row.rawMaterialId, name: row.material }, { from: this.from(), to: this.to() });
  }

  protected async download(): Promise<void> {
    try {
      saveBlob(await firstValueFrom(this.api.stationVarianceSheet(this.from(), this.to())), `station-variance-${this.from()}-to-${this.to()}.xlsx`);
    } catch (error) {
      this.notify.error(error, 'The sheet could not be made.');
    }
  }

  private async load(from: string, to: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const report = await firstValueFrom(this.api.stationVariance(from, to));
      if (this.from() === from && this.to() === to) {
        this.report.set(report);
      }
    } catch (error) {
      this.report.set(null);
      this.error.set(errorMessage(error, 'The station variance could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }
}
