import { DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { firstValueFrom } from 'rxjs';
import { IntelligenceApi, MenuClass, MenuEngineeringReport, MenuEngineeringRow, menuClassLabels } from '../../core/costing/intelligence.api';
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

type MenuSort = 'contribution' | 'sold' | 'margin' | 'foodCost' | 'dish';

const sorts: SortOption<MenuSort>[] = [
  { key: 'contribution', en: 'Total contribution', ar: 'إجمالي المساهمة', descending: true },
  { key: 'sold', en: 'Sold', ar: 'المباع', descending: true },
  { key: 'margin', en: 'Margin a portion', ar: 'هامش الحصة', descending: true },
  { key: 'foodCost', en: 'Food cost %', ar: 'نسبة التكلفة', descending: true },
  { key: 'dish', en: 'Dish', ar: 'الصنف' },
];

// The quadrants as the matrix lays them out: popular on top, profitable on the left.
const quadrants: { class: MenuClass; tip: InfoTipKey }[] = [
  { class: 'Star', tip: 'meStar' },
  { class: 'Plowhorse', tip: 'mePlowhorse' },
  { class: 'Puzzle', tip: 'mePuzzle' },
  { class: 'Dog', tip: 'meDog' },
];

// How many dishes a quadrant names before "+ n more".
const named = 6;

// Menu engineering & profitability (هندسة المنيو والربحية): each dish the period sold, by how popular
// it was (its menu mix against 70% of an even share) and how much it left after its food cost (its
// contribution margin against the average): Stars, Plowhorses, Puzzles and Dogs, as a matrix and a
// table, with the price that would bring each to the food cost target. One menu category at a time
// compares like with like; dishes with no recipe or no price are listed, not placed.
@Component({
  selector: 'app-menu-engineering-page',
  imports: [
    DecimalPipe,
    FilterSelect,
    FormsModule,
    InfoTip,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatProgressBarModule,
    MatSelectModule,
    MoneyPipe,
    PeriodBar,
    SearchField,
    SortControl,
  ],
  template: `
    <div class="toolbar">
      <app-period-bar [(from)]="from" [(to)]="to" />
      <mat-form-field subscriptSizing="dynamic" class="category">
        <mat-label>Menu category · قسم المنيو</mat-label>
        <mat-select [ngModel]="category()" (ngModelChange)="category.set($event)" aria-label="Menu category">
          <mat-option [value]="null">The whole menu · المنيو كله</mat-option>
          @for (c of categories(); track c) {
            <mat-option [value]="c">{{ c }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
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
          <span class="label">Total contribution · إجمالي المساهمة <app-info-tip tip="totalContribution" /></span>
          <strong>{{ r.totalContribution | money }}</strong>
          <small class="chip">{{ r.items }} {{ r.items === 1 ? 'dish' : 'dishes' }}</small>
        </div>
        <div class="tile">
          <span class="label">Average margin · متوسط الهامش <app-info-tip tip="averageContribution" /></span>
          <strong>{{ r.averageContribution === null ? '—' : (r.averageContribution | money) }}</strong>
        </div>
        <div class="tile">
          <span class="label">Popularity threshold · حد الشعبية <app-info-tip tip="popularityThreshold" /></span>
          <strong>{{ r.popularityThresholdPercent === null ? '—' : (r.popularityThresholdPercent | number: '1.0-2') + '%' }}</strong>
        </div>
        <div class="tile">
          <span class="label">Food cost % · نسبة التكلفة <app-info-tip tip="meFoodCost" /></span>
          <strong [class.loss]="(r.foodCostPercent ?? 0) > r.foodCostTargetPercent">
            {{ r.foodCostPercent === null ? '—' : (r.foodCostPercent | number: '1.1-1') + '%' }}
          </strong>
          <small class="chip">target {{ r.foodCostTargetPercent | number: '1.0-1' }}%</small>
        </div>
      </div>

      <section class="matrix" aria-label="Menu engineering matrix">
        <div class="axis y" aria-hidden="true">Popularity · الشعبية ↑</div>
        <div class="axis x" aria-hidden="true">← Higher margin · هامش أعلى</div>
        @for (q of quadrants; track q.class) {
          @let summary = classSummary(r, q.class);
          @let dishes = dishesOf(q.class);
          <article class="quadrant" [class]="q.class" [class.chosen]="klass() === q.class">
            <header>
              <mat-icon aria-hidden="true">{{ labels[q.class].icon }}</mat-icon>
              <h3>{{ labels[q.class].en }} · <span lang="ar">{{ labels[q.class].ar }}</span></h3>
              <app-info-tip [tip]="q.tip" />
              <span class="spacer"></span>
              <strong class="count">{{ summary?.items ?? 0 }}</strong>
            </header>
            @if (summary && summary.items) {
              <small class="chip">{{ summary.contribution | money }}{{ summary.contributionSharePercent === null ? '' : ' · ' + (summary.contributionSharePercent | number: '1.0-1') + '%' }}</small>
            }
            <ul class="names">
              @for (d of dishes.slice(0, named); track d.itemCode) {
                <li>{{ d.menuItem }}</li>
              }
              @if (dishes.length > named) {
                <li class="more">+ {{ dishes.length - named }} more</li>
              }
              @if (!dishes.length) {
                <li class="none">None · لا يوجد</li>
              }
            </ul>
            <button mat-button class="show" (click)="klass.set(klass() === q.class ? '' : q.class)" [attr.aria-pressed]="klass() === q.class">
              {{ klass() === q.class ? 'Show all · الكل' : 'Show these · عرضها' }}
            </button>
          </article>
        }
      </section>

      <div class="toolbar smart">
        <app-search-field [(value)]="search" placeholder="Dish or code · الصنف أو الكود" />
        <div class="pills">
          <app-filter-select label="Class · التصنيف" icon="grid_view" [options]="classFilters()" [(value)]="klass" />
          <app-sort-control [options]="sorts" [(sort)]="sort" />
        </div>
      </div>

      <div class="table-wrap">
        <table class="grid menu-table">
          <thead>
            <tr>
              <th>Class<span class="ar">التصنيف</span></th>
              <th>Dish<span class="ar">الصنف</span></th>
              <th class="num">Sold<span class="ar">المباع</span></th>
              <th class="num">Menu mix <app-info-tip tip="menuMix" /><span class="ar">نسبة المبيعات</span></th>
              <th class="num">Avg price<span class="ar">متوسط السعر</span></th>
              <th class="num">Food cost <app-info-tip tip="meFoodCost" /><span class="ar">التكلفة · النسبة</span></th>
              <th class="num">Margin <app-info-tip tip="contributionMargin" /><span class="ar">هامش المساهمة</span></th>
              <th class="num">Total <app-info-tip tip="totalContribution" /><span class="ar">إجمالي المساهمة</span></th>
              <th class="num">Suggested price <app-info-tip tip="suggestedPrice" /><span class="ar">السعر المقترح</span></th>
            </tr>
          </thead>
          <tbody>
            @for (row of shown(); track row.itemCode) {
              <tr [class]="row.class ?? 'unplaced'">
                <td>
                  @if (row.class) {
                    <span class="class-tag" [class]="row.class">
                      <mat-icon aria-hidden="true">{{ labels[row.class].icon }}</mat-icon> {{ labels[row.class].en }} <span class="ar">{{ labels[row.class].ar }}</span>
                    </span>
                  } @else {
                    <span class="class-tag unplaced">{{ row.status === 'NoRecipe' ? 'No recipe · بدون وصفة' : 'No price · بدون سعر' }}</span>
                  }
                </td>
                <td>
                  <strong>{{ row.menuItem }}</strong>
                  @if (row.menuItemAr) {
                    <span class="ar">{{ row.menuItemAr }}</span>
                  }
                  <div class="muted small">{{ row.itemCode }}{{ row.category ? ' · ' + row.category : '' }}</div>
                </td>
                <td class="num">{{ row.quantitySold | number: '1.0-3' }}</td>
                <td class="num" [class.strong]="row.popular">{{ row.menuMixPercent === null ? '—' : (row.menuMixPercent | number: '1.1-2') + '%' }}</td>
                <td class="num">{{ row.averagePrice === null ? '—' : (row.averagePrice | money) }}</td>
                <td class="num">
                  {{ row.foodCostPerPortion === null ? '—' : (row.foodCostPerPortion | money) }}
                  @if (row.foodCostPercent !== null) {
                    <div class="small" [class.loss]="row.foodCostPercent > r.foodCostTargetPercent">{{ row.foodCostPercent | number: '1.1-1' }}%</div>
                  }
                </td>
                <td class="num" [class.strong]="row.profitable">{{ row.contributionMargin === null ? '—' : (row.contributionMargin | money) }}</td>
                <td class="num"><strong>{{ row.totalContribution === null ? '—' : (row.totalContribution | money) }}</strong></td>
                <td class="num">
                  @if (row.suggestedPrice === null) {
                    —
                  } @else {
                    <span [class.raise]="row.averagePrice !== null && row.suggestedPrice > row.averagePrice">{{ row.suggestedPrice | money }}</span>
                    @if (row.averagePrice !== null && row.suggestedPrice > row.averagePrice) {
                      <div class="small raise">+{{ row.suggestedPrice - row.averagePrice | money }}</div>
                    }
                  }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="9" class="muted">No dish sold in these days{{ search() || klass() ? ' matches' : '' }}.</td></tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .category {
      width: 230px;
    }
    .loss {
      color: var(--mat-sys-error);
    }
    .small {
      font-size: 0.85em;
    }
    td.strong {
      font-weight: 600;
    }
    .raise {
      color: var(--app-warn);
    }
    .matrix {
      display: grid;
      grid-template-columns: auto 1fr 1fr;
      grid-template-rows: auto auto auto;
      gap: 10px;
      margin: 4px 0 16px;
    }
    .axis {
      font: var(--mat-sys-label-small);
      color: var(--mat-sys-on-surface-variant);
    }
    .axis.y {
      grid-row: 1 / span 2;
      grid-column: 1;
      writing-mode: vertical-rl;
      transform: rotate(180deg);
      text-align: center;
    }
    .axis.x {
      grid-row: 3;
      grid-column: 2 / span 2;
      text-align: center;
    }
    .quadrant {
      display: grid;
      align-content: start;
      gap: 6px;
      padding: 12px 14px;
      border-radius: 16px;
      border: 1px solid var(--app-line);
      background: var(--mat-sys-surface-container-lowest);
      box-shadow: var(--app-card-shadow);

      header {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      h3 {
        margin: 0;
        font: var(--mat-sys-title-small);
      }
      .count {
        font: var(--mat-sys-headline-small);
      }
      .chip {
        justify-self: start;
        padding: 1px 8px;
        border-radius: 999px;
        font: var(--mat-sys-label-small);
        background: color-mix(in srgb, var(--mat-sys-on-surface) 7%, transparent);
      }
      .names {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin: 0;
        padding: 0;
        list-style: none;

        li {
          padding: 1px 8px;
          border-radius: 8px;
          font: var(--mat-sys-body-small);
          background: var(--mat-sys-surface-container-high);
        }
        .more,
        .none {
          background: none;
          color: var(--mat-sys-on-surface-variant);
        }
      }
      .show {
        justify-self: start;
      }
      &.chosen {
        outline: 2px solid var(--mat-sys-primary);
      }
      &.Star {
        grid-row: 1;
        grid-column: 2;
        border-top: 4px solid #4f46e5;
      }
      &.Plowhorse {
        grid-row: 1;
        grid-column: 3;
        border-top: 4px solid #0d9488;
      }
      &.Puzzle {
        grid-row: 2;
        grid-column: 2;
        border-top: 4px solid #d97706;
      }
      &.Dog {
        grid-row: 2;
        grid-column: 3;
        border-top: 4px solid #94a3b8;
      }
    }
    .class-tag {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 0 8px;
      border-radius: 999px;
      font: var(--mat-sys-label-small);
      line-height: 22px;
      white-space: nowrap;
      background: var(--mat-sys-surface-container-high);

      mat-icon {
        width: 14px;
        height: 14px;
        font-size: 14px;
      }
      .ar {
        display: inline;
        margin-inline-start: 4px;
      }
      &.Star {
        background: color-mix(in srgb, #4f46e5 14%, transparent);
        color: #4338ca;
      }
      &.Plowhorse {
        background: color-mix(in srgb, #0d9488 14%, transparent);
        color: #0f766e;
      }
      &.Puzzle {
        background: color-mix(in srgb, #d97706 16%, transparent);
        color: #b45309;
      }
      &.Dog {
        background: color-mix(in srgb, #64748b 16%, transparent);
        color: #475569;
      }
      &.unplaced {
        color: var(--mat-sys-on-surface-variant);
      }
    }
    @media (max-width: 720px) {
      .matrix {
        grid-template-columns: 1fr;
      }
      .axis {
        display: none;
      }
      .quadrant.Star,
      .quadrant.Plowhorse,
      .quadrant.Puzzle,
      .quadrant.Dog {
        grid-row: auto;
        grid-column: auto;
      }
    }
  `,
})
export class MenuEngineeringPage {
  private readonly api = inject(IntelligenceApi);
  private readonly notify = inject(NotifyService);
  protected readonly labels = menuClassLabels;
  protected readonly quadrants = quadrants;
  protected readonly named = named;

  protected readonly from = signal(periodDays('month').from);
  protected readonly to = signal(periodDays('month').to);
  protected readonly category = signal<string | null>(null);
  protected readonly report = signal<MenuEngineeringReport | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  // Every category sold in the period, whichever is chosen.
  protected readonly categories = signal<string[]>([]);

  protected readonly search = signal('');
  protected readonly klass = signal('');
  protected readonly sorts = sorts;
  protected readonly sort = signal<SortState<MenuSort>>({ key: 'contribution', direction: -1 });

  protected readonly classFilters = computed<FilterOption[]>(() => {
    const rows = this.report()?.rows ?? [];
    return [
      { value: '', label: 'All · الكل', count: rows.length },
      ...quadrants.map((q) => ({
        value: q.class,
        label: `${menuClassLabels[q.class].en} · ${menuClassLabels[q.class].ar}`,
        count: rows.filter((r) => r.class === q.class).length,
      })),
      { value: 'none', label: 'Not placed · غير مصنف', count: rows.filter((r) => r.class === null).length },
    ];
  });

  protected readonly shown = computed(() =>
    sortItems(
      (this.report()?.rows ?? []).filter(
        (r) =>
          (!this.klass() || (this.klass() === 'none' ? r.class === null : r.class === this.klass())) &&
          smartMatch(this.search(), r.menuItem, r.menuItemAr, r.itemCode, r.category),
      ),
      this.sort(),
      (r, key) =>
        key === 'contribution'
          ? r.totalContribution
          : key === 'sold'
            ? r.quantitySold
            : key === 'margin'
              ? r.contributionMargin
              : key === 'foodCost'
                ? r.foodCostPercent
                : r.menuItem,
      (r) => r.menuItem,
    ),
  );

  constructor() {
    effect(() => {
      const [from, to, category] = [this.from(), this.to(), this.category()];
      untracked(() => void this.load(from, to, category));
    });
  }

  protected classSummary(report: MenuEngineeringReport, menuClass: MenuClass) {
    return report.classes.find((c) => c.class === menuClass) ?? null;
  }

  // A quadrant's dishes, the most contributing first.
  protected dishesOf(menuClass: MenuClass): MenuEngineeringRow[] {
    return (this.report()?.rows ?? [])
      .filter((r) => r.class === menuClass)
      .sort((a, b) => (b.totalContribution ?? 0) - (a.totalContribution ?? 0));
  }

  protected async download(): Promise<void> {
    try {
      saveBlob(
        await firstValueFrom(this.api.menuEngineeringSheet(this.from(), this.to(), this.category())),
        `menu-engineering-${this.from()}-to-${this.to()}.xlsx`,
      );
    } catch (error) {
      this.notify.error(error, 'The sheet could not be downloaded.');
    }
  }

  private async load(from: string, to: string, category: string | null): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const report = await firstValueFrom(this.api.menuEngineering(from, to, category));
      this.report.set(report);
      this.categories.set(report.categories);
    } catch (error) {
      this.error.set(errorMessage(error, 'Menu engineering could not be worked out.'));
    } finally {
      this.loading.set(false);
    }
  }
}
