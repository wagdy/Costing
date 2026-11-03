import { DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';
import { ConsumptionReport, IntelligenceApi, VarianceEvaluation, evaluationLabels } from '../../core/costing/intelligence.api';
import { errorMessage } from '../../core/http/error-message';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { NotifyService } from '../../core/ui/notify.service';
import { saveBlob } from '../../core/ui/save-blob';
import { FilterOption, FilterSelect } from '../shared/filter-select';
import { SearchField } from '../shared/search-field';
import { SortOption, SortState, smartMatch, sortItems } from '../shared/smart-search';
import { SortControl } from '../shared/sort-control';
import { PeriodBar, periodDays } from './period-bar';

type ConsumptionSort = 'cost' | 'percent' | 'material';

const sorts: SortOption<ConsumptionSort>[] = [
  { key: 'cost', en: 'Variance cost', ar: 'قيمة الانحراف', descending: true },
  { key: 'percent', en: 'Variance %', ar: 'نسبة الانحراف', descending: true },
  { key: 'material', en: 'Material', ar: 'الخامة' },
];

// Theoretical against actual consumption (استهلاك الخامات: النظري مقابل الفعلي): for each bought
// material over the period, what the stores say was used (opening + purchases − logged waste −
// closing) against what the sales should have taken by the recipes, through the prep items; the
// difference no record explains, valued at the average cost now. Beyond the tolerance, in red:
// waste not recorded, over-portioning, or stock walking out.
@Component({
  selector: 'app-consumption-page',
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
        <div class="tile key">
          <span class="label">Unexplained variance · قيمة الانحراف غير المبرر</span>
          <strong [class.loss]="r.unexplainedValue > 0">{{ r.unexplainedValue | money }}</strong>
          <small class="muted">at the average cost now</small>
        </div>
        <div class="tile">
          <span class="label">High-loss materials · خامات بفاقد مرتفع</span>
          <strong [class.loss]="r.highLoss > 0">{{ r.highLoss }}</strong>
          <small class="muted">more than {{ r.tolerancePercent }}% over the recipes</small>
        </div>
        <div class="tile">
          <span class="label">Theoretical usage · الاستهلاك النظري</span>
          <strong>{{ r.theoreticalValue | money }}</strong>
          <small class="muted">what the sales should have taken</small>
        </div>
        <div class="tile">
          <span class="label">Actual usage · الاستهلاك الفعلي</span>
          <strong>{{ r.actualValue | money }}</strong>
          <small class="muted">what left the stores</small>
        </div>
      </div>
      @if (r.soldWithoutRecipe.length) {
        <p class="note small">
          Sold with no recipe, so in no theoretical usage:
          {{ withoutRecipe() }}.
          <span class="note-ar" lang="ar" dir="rtl">أصناف مباعة بدون وصفة.</span>
        </p>
      }

      <div class="toolbar smart">
        <app-search-field [(value)]="search" placeholder="Material or code · الخامة أو الكود" />
        <div class="pills">
          <app-filter-select label="Evaluation · التقييم" icon="flag" [options]="evaluationFilters()" [(value)]="evaluation" />
          <app-filter-select label="Category · القسم" icon="category" [options]="categoryFilters()" [(value)]="category" />
          <app-sort-control [options]="sorts" [(sort)]="sort" />
        </div>
      </div>

      <div class="table-wrap">
        <table class="grid consumption">
          <thead>
            <tr>
              <th>Material<span class="ar">الخامة</span></th>
              <th class="num">Opening<span class="ar">أول المدة</span></th>
              <th class="num">Purchases<span class="ar">المشتريات</span></th>
              <th class="num">Logged waste<span class="ar">الهالك المسجل</span></th>
              <th class="num">Closing<span class="ar">آخر المدة</span></th>
              <th class="num">Actual<span class="ar">الاستهلاك الفعلي</span></th>
              <th class="num">Theoretical<span class="ar">الاستهلاك النظري</span></th>
              <th class="num">Unexplained<span class="ar">الانحراف غير المبرر</span></th>
              <th class="num">Variance cost<span class="ar">قيمة الانحراف</span></th>
            </tr>
          </thead>
          <tbody>
            @for (row of shown(); track row.rawMaterialId) {
              <tr [class.high-loss]="row.evaluation === 'Unfavourable'">
                <td>
                  <strong>{{ row.material }}</strong>
                  <div class="muted small">{{ row.code ? row.code + ' · ' : '' }}in {{ row.purchaseUnit }}{{ row.category ? ' · ' + row.category : '' }}</div>
                  <span class="evaluation" [class]="row.evaluation">{{ labels[row.evaluation].en }}<span class="ar">{{ labels[row.evaluation].ar }}</span></span>
                </td>
                <td class="num">{{ row.opening | number: '1.0-3' }}</td>
                <td class="num">{{ row.purchases | number: '1.0-3' }}</td>
                <td class="num">{{ row.waste | number: '1.0-3' }}</td>
                <td class="num">{{ row.closing | number: '1.0-3' }}</td>
                <td class="num"><strong>{{ row.actualUsage | number: '1.0-3' }}</strong></td>
                <td class="num">
                  <strong>{{ row.theoreticalUsage | number: '1.0-3' }}</strong>
                  @if (row.heldInPrep) {
                    <div class="muted small">{{ row.heldInPrep | number: '1.0-3' }} in prep stock</div>
                  }
                </td>
                <td class="num" [class.loss]="row.unexplainedQuantity > 0" [class.gain]="row.unexplainedQuantity < 0">
                  {{ row.unexplainedQuantity > 0 ? '+' : '' }}{{ row.unexplainedQuantity | number: '1.0-3' }}
                  @if (row.unexplainedPercent !== null) {
                    <div class="small">{{ row.unexplainedPercent > 0 ? '+' : '' }}{{ row.unexplainedPercent | number: '1.1-1' }}%</div>
                  }
                </td>
                <td class="num" [class.loss]="(row.varianceCost ?? 0) > 0" [class.gain]="(row.varianceCost ?? 0) < 0">
                  <strong>{{ row.varianceCost === null ? '—' : (row.varianceCost | money) }}</strong>
                </td>
              </tr>
            } @empty {
              <tr><td colspan="9" class="muted">Nothing moved in these days{{ search() || category() || evaluation() ? ' that matches' : '' }}.</td></tr>
            }
          </tbody>
          <tfoot>
            <tr>
              <td colspan="8">Unexplained variance · الانحراف غير المبرر</td>
              <td class="num">{{ r.unexplainedValue | money }}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p class="note small">
        Actual = opening + purchases − logged waste − closing, the stock book either side of the period (an opening count in it is where its
        stock began). Theoretical = each dish sold × its recipe as purchased, through the prep items, plus what is still held in the prep items
        made from it. A prep item's logged waste counts as its ingredients'. Unexplained = actual − theoretical, at the average cost now.
        <span class="note-ar" lang="ar" dir="rtl">الفعلي = أول المدة + المشتريات − الهالك المسجل − آخر المدة. النظري = المبيعات × الوصفة.</span>
      </p>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .loss {
      color: var(--mat-sys-error);
    }
    .gain {
      color: var(--app-ok);
    }
    .small {
      font-size: 0.85em;
    }
    tr.high-loss td {
      background: color-mix(in srgb, var(--mat-sys-error) 7%, transparent);
    }
    tr.high-loss td:first-child {
      box-shadow: inset 3px 0 0 var(--mat-sys-error);
    }
    .evaluation {
      display: inline-block;
      margin-top: 4px;
      padding: 0 8px;
      border-radius: 999px;
      font-size: 11.5px;
      line-height: 20px;
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
  `,
})
export class ConsumptionPage {
  private readonly api = inject(IntelligenceApi);
  private readonly notify = inject(NotifyService);
  protected readonly labels = evaluationLabels;

  protected readonly from = signal(periodDays('month').from);
  protected readonly to = signal(periodDays('month').to);
  protected readonly report = signal<ConsumptionReport | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly search = signal('');
  protected readonly category = signal('');
  protected readonly evaluation = signal('');
  protected readonly sorts = sorts;
  protected readonly sort = signal<SortState<ConsumptionSort>>({ key: 'cost', direction: -1 });

  protected readonly evaluationFilters = computed<FilterOption[]>(() => {
    const rows = this.report()?.rows ?? [];
    return [
      { value: '', label: 'All · الكل', count: rows.length },
      ...(['Unfavourable', 'Favourable', 'WithinLimit', 'SharedCost'] as VarianceEvaluation[])
        .map((e) => ({ value: e, label: `${evaluationLabels[e].en} · ${evaluationLabels[e].ar}`, count: rows.filter((r) => r.evaluation === e).length }))
        .filter((o) => o.count > 0),
    ];
  });

  protected readonly categoryFilters = computed<FilterOption[]>(() => {
    const rows = this.report()?.rows ?? [];
    const categories = [...new Map(rows.map((r) => [r.categoryId, r])).values()];
    return [
      { value: '', label: 'All · الكل', count: rows.length },
      ...categories.map((c) => ({
        value: c.categoryId,
        label: c.categoryAr ? `${c.category} · ${c.categoryAr}` : (c.category ?? 'Uncategorized'),
        count: rows.filter((r) => r.categoryId === c.categoryId).length,
      })),
    ];
  });

  protected readonly shown = computed(() =>
    sortItems(
      (this.report()?.rows ?? []).filter(
        (r) =>
          (!this.category() || r.categoryId === this.category()) &&
          (!this.evaluation() || r.evaluation === this.evaluation()) &&
          smartMatch(this.search(), r.material, r.code, r.category),
      ),
      this.sort(),
      (r, key) => (key === 'cost' ? r.varianceCost : key === 'percent' ? r.unexplainedPercent : r.material),
      (r) => r.material,
    ),
  );

  protected readonly withoutRecipe = computed(() =>
    (this.report()?.soldWithoutRecipe ?? []).map((s) => `${s.itemCode} ${s.menuItem} (${s.quantity})`).join(', '),
  );

  constructor() {
    effect(() => {
      const [from, to] = [this.from(), this.to()];
      untracked(() => void this.load(from, to));
    });
  }

  protected async download(): Promise<void> {
    try {
      saveBlob(await firstValueFrom(this.api.consumptionSheet(this.from(), this.to())), `consumption-${this.from()}-to-${this.to()}.xlsx`);
    } catch (error) {
      this.notify.error(error, 'The sheet could not be made.');
    }
  }

  private async load(from: string, to: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const report = await firstValueFrom(this.api.consumption(from, to));
      if (this.from() === from && this.to() === to) {
        this.report.set(report);
      }
    } catch (error) {
      this.report.set(null);
      this.error.set(errorMessage(error, 'The consumption could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }
}
