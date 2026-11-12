import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';
import { IntelligenceApi, OrderPlan, OrderPlanLine, OrderSheetGrouping, PlannedDish } from '../../core/costing/intelligence.api';
import { errorMessage } from '../../core/http/error-message';
import { Company } from '../../core/settings/company';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { NotifyService } from '../../core/ui/notify.service';
import { saveBlob } from '../../core/ui/save-blob';
import { FilterOption, FilterSelect } from '../shared/filter-select';
import { SearchField } from '../shared/search-field';
import { smartMatch } from '../shared/smart-search';
import { InfoTip } from './info-tip';
import { StockCardButton } from './stock-card-dialog';

const dishKey = (d: { menuItemId: number; variantId: number | null }) => `${d.menuItemId}-${d.variantId ?? ''}`;

// The smart order planner (تخطيط وإنشاء الطلبيات الذكية): the last days' sales a day, for the days
// ahead, grown by the manager's expectation (a weekend, a holiday) or set dish by dish; broken down
// through the recipes and the prep items (those on hand used first) into what each bought material
// needs; that plus its reorder level, less the shelf, rounded up to whole purchase units, at the
// latest net price. The manager approves each quantity, and downloads the order as a sheet, by
// category or by supplier.
@Component({
  selector: 'app-order-planner-page',
  imports: [
    DatePipe,
    DecimalPipe,
    FilterSelect,
    FormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    InfoTip,
    MoneyPipe,
    SearchField,
    StockCardButton,
  ],
  template: `
    <section class="controls" aria-label="What the order is planned from">
      <div class="control">
        <span class="label">Look back <span class="ar">فترة الرجوع للمبيعات</span></span>
        <mat-button-toggle-group [value]="lookback()" (change)="lookback.set($event.value)" aria-label="Days of sales looked back">
          @for (d of [7, 14, 30]; track d) {
            <mat-button-toggle [value]="d">{{ d }} days</mat-button-toggle>
          }
        </mat-button-toggle-group>
      </div>
      <div class="control">
        <span class="label">Cover <span class="ar">أيام التغطية المطلوبة</span></span>
        <div class="row">
          <mat-button-toggle-group [value]="coverage()" (change)="coverage.set($event.value)" aria-label="Days the order covers">
            @for (d of [3, 7, 14]; track d) {
              <mat-button-toggle [value]="d">{{ d }} days</mat-button-toggle>
            }
          </mat-button-toggle-group>
          <mat-form-field subscriptSizing="dynamic" class="days">
            <mat-label>Or · أو</mat-label>
            <input matInput type="number" min="1" max="60" step="1" [ngModel]="coverage()" (ngModelChange)="setCoverage($event)" aria-label="Days covered" />
            <span matTextSuffix>&nbsp;days</span>
          </mat-form-field>
        </div>
      </div>
      <div class="control">
        <span class="label">Expected sales <span class="ar">توقعات المبيعات من المدير</span></span>
        <div class="row">
          <mat-form-field subscriptSizing="dynamic" class="growth">
            <mat-label>Growth · نسبة النمو</mat-label>
            <input matInput type="number" min="-90" max="500" step="5" [ngModel]="growth()" (ngModelChange)="setGrowth($event)" aria-label="Growth percent" />
            <span matTextSuffix>&nbsp;%</span>
          </mat-form-field>
          <button mat-stroked-button (click)="showDishes.update((v) => !v)" [attr.aria-expanded]="showDishes()">
            <mat-icon>{{ showDishes() ? 'expand_less' : 'tune' }}</mat-icon> Per dish <span class="ar">لكل طبق</span>
            @if (expectations().size) {
              <span class="count">{{ expectations().size }}</span>
            }
          </button>
        </div>
      </div>
    </section>

    @if (showDishes() && plan(); as p) {
      <section class="dishes" aria-label="Expected sales per dish">
        <p class="muted small">
          A dish's expected sales a day replace its last {{ p.lookbackDays }} days' average grown by {{ p.growthPercent }}%. Cleared, it follows
          them again.
        </p>
        <div class="table-wrap">
          <table class="grid">
            <thead>
              <tr>
                <th>Dish<span class="ar">الطبق</span></th>
                <th class="num">Sold a day<span class="ar">متوسط البيع اليومي</span></th>
                <th class="num">Expected a day<span class="ar">المتوقع يوميًا</span></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (d of p.dishes; track d.code) {
                <tr>
                  <td>
                    <span class="muted small">{{ d.code }}</span> {{ d.name }}
                    @if (!d.hasRecipe) {
                      <span class="flag">No recipe · بدون وصفة</span>
                    }
                  </td>
                  <td class="num">{{ d.averageDaily | number: '1.0-2' }}</td>
                  <td class="num">
                    <mat-form-field subscriptSizing="dynamic" class="expected">
                      <input matInput type="number" min="0" step="any" [ngModel]="expectationOf(d)" (ngModelChange)="expect(d, $event)"
                        [placeholder]="(d.averageDaily * (1 + p.growthPercent / 100) | number: '1.0-2') ?? ''" [attr.aria-label]="'Expected a day, ' + d.name" />
                    </mat-form-field>
                  </td>
                  <td>
                    @if (expectations().has(key(d))) {
                      <button mat-icon-button (click)="expect(d, null)" [attr.aria-label]="'Clear the expectation of ' + d.name"><mat-icon>close</mat-icon></button>
                    }
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="4" class="muted">No dish sells by a recipe yet.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    }

    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    @if (error()) {
      <p class="error">{{ error() }}</p>
    } @else if (plan(); as p) {
      <div class="tiles">
        <div class="tile key">
          <span class="label">Approved order · الطلبية المعتمدة <app-info-tip tip="orderApproved" /></span>
          <strong>{{ approvedTotal() | money }}</strong>
          <small class="chip">{{ approvedLines() }} {{ approvedLines() === 1 ? 'material' : 'materials' }}</small>
        </div>
        <div class="tile">
          <span class="label">Suggested · المقترح <app-info-tip tip="orderSuggested" /></span>
          <strong>{{ p.estimatedTotal | money }}</strong>
          <small class="chip">{{ p.toOrder }} to order</small>
        </div>
        <div class="tile">
          <span class="label">Below reorder level · تحت حد الطلب <app-info-tip tip="orderBelowReorder" /></span>
          <strong [class.loss]="p.belowReorder > 0">{{ p.belowReorder }}</strong>
        </div>
        <div class="tile">
          <span class="label">Planned from · مبني على <app-info-tip tip="orderPlannedFrom" /></span>
          <strong>{{ p.coverageDays }} days</strong>
          <small class="chip">{{ p.lookbackFrom | date: 'd MMM' }} – {{ p.lookbackTo | date: 'd MMM' }}</small>
        </div>
      </div>
      @if (p.noPrice.length) {
        <p class="note small">No price yet for {{ p.noPrice.join(', ') }}: their cost is left out.</p>
      }

      <div class="toolbar smart">
        <app-search-field [(value)]="search" placeholder="Material or code · الخامة أو الكود" />
        <div class="pills">
          <app-filter-select label="Show · عرض" icon="filter_list" [options]="showFilters()" [(value)]="show" />
          <app-filter-select label="Category · القسم" icon="category" [options]="categoryFilters()" [(value)]="category" />
        </div>
        <span class="spacer"></span>
        <button mat-button (click)="resetApproved()" [disabled]="!approved().size">Back to suggested</button>
        <mat-button-toggle-group [value]="groupBy()" (change)="groupBy.set($event.value)" aria-label="Group the sheet by" class="group">
          <mat-button-toggle value="Category">By category</mat-button-toggle>
          <mat-button-toggle value="Supplier">By supplier</mat-button-toggle>
        </mat-button-toggle-group>
        <button mat-flat-button (click)="download()" [disabled]="!approvedLines()"><mat-icon>download</mat-icon> Excel order sheet</button>
      </div>

      <div class="table-wrap">
        <table class="grid plan">
          <thead>
            <tr>
              <th>Material<span class="ar">الخامة</span></th>
              <th class="num">On hand<span class="ar">الرصيد المتاح</span></th>
              <th class="num">A day <app-info-tip tip="orderDaily" /><span class="ar">متوسط الاستهلاك اليومي</span></th>
              <th class="num">Expected <app-info-tip tip="orderExpected" /><span class="ar">الاستهلاك المتوقع</span></th>
              <th class="num">Reorder level<span class="ar">حد الطلب</span></th>
              <th class="num">Suggested <app-info-tip tip="orderSuggestedQty" /><span class="ar">الكمية المرشحة</span></th>
              <th class="num">Approved<span class="ar">الكمية المعتمدة</span></th>
              <th class="num">Estimated cost<span class="ar">التكلفة التقديرية</span></th>
            </tr>
          </thead>
          <tbody>
            @for (line of shown(); track line.rawMaterialId) {
              <tr [class.below]="line.belowReorder">
                <td>
                  <strong>{{ line.material }}</strong>
                  <app-stock-card-button [id]="line.rawMaterialId" [name]="line.material" />
                  <div class="muted small">
                    {{ line.code ? line.code + ' · ' : '' }}{{ line.category ?? 'Uncategorized' }}{{ line.supplier ? ' · ' + line.supplier : '' }}
                  </div>
                </td>
                <td class="num" [class.loss]="line.onHand < 0">{{ line.onHand | number: '1.0-3' }} {{ line.purchaseUnit }}</td>
                <td class="num">{{ line.averageDailyUsage | number: '1.0-3' }}</td>
                <td class="num">{{ line.expectedUsage | number: '1.0-3' }}</td>
                <td class="num">{{ line.reorderLevel | number: '1.0-3' }}</td>
                <td class="num"><strong>{{ line.suggested | number: '1.0-3' }}</strong> {{ line.purchaseUnit }}</td>
                <td class="num">
                  <mat-form-field subscriptSizing="dynamic" class="approved">
                    <input matInput type="number" min="0" step="any" [ngModel]="approvedOf(line)" (ngModelChange)="approve(line, $event)"
                      [attr.aria-label]="'Approved, ' + line.material" />
                    <span matTextSuffix>&nbsp;{{ line.purchaseUnit }}</span>
                  </mat-form-field>
                </td>
                <td class="num">{{ line.unitPrice === null ? '—' : (approvedOf(line) * line.unitPrice | money) }}</td>
              </tr>
            } @empty {
              <tr><td colspan="8" class="muted">Nothing to order{{ search() || category() || show() ? ' that matches' : '' }}.</td></tr>
            }
          </tbody>
          <tfoot>
            <tr>
              <td colspan="7">Approved order · الطلبية المعتمدة</td>
              <td class="num">{{ approvedTotal() | money }}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .controls {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: 12px 24px;
      margin-bottom: 12px;
      padding: 12px 14px;
      border-radius: 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface);
    }
    .control {
      display: grid;
      gap: 4px;

      .label {
        font: var(--mat-sys-label-medium);
        color: var(--mat-sys-on-surface-variant);
      }
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
    .ar {
      margin-inline-start: 4px;
      font-size: 0.85em;
      opacity: 0.8;
    }
    .controls .ar {
      display: inline;
    }
    .controls button {
      white-space: nowrap;
    }
    .days {
      width: 110px;
    }
    .growth {
      width: 140px;
    }
    .count {
      margin-inline-start: 6px;
      padding: 0 7px;
      border-radius: 999px;
      background: var(--mat-sys-primary);
      color: var(--mat-sys-on-primary);
      font-size: 12px;
    }
    .dishes {
      margin-bottom: 16px;
    }
    .expected {
      width: 110px;
    }
    .approved {
      width: 130px;
    }
    .flag {
      margin-inline-start: 6px;
      color: var(--app-warn);
      font-size: 0.85em;
    }
    .loss {
      color: var(--mat-sys-error);
    }
    .small {
      font-size: 0.85em;
    }
    tr.below td:first-child {
      box-shadow: inset 3px 0 0 var(--app-warn);
    }
    .group {
      flex: none;
    }
  `,
})
export class OrderPlannerPage {
  private readonly api = inject(IntelligenceApi);
  private readonly notify = inject(NotifyService);
  private readonly company = inject(Company);

  protected readonly lookback = signal(14);
  protected readonly coverage = signal(7);
  protected readonly growth = signal(0);
  // Expected sales a day, by dish, as the manager set them.
  protected readonly expectations = signal(new Map<string, { menuItemId: number; variantId: number | null; expectedDaily: number }>());
  protected readonly showDishes = signal(false);

  protected readonly plan = signal<OrderPlan | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  // Quantities the manager changed, by material; the rest are as suggested.
  protected readonly approved = signal(new Map<string, number>());

  protected readonly search = signal('');
  protected readonly category = signal('');
  protected readonly show = signal('');
  protected readonly groupBy = signal<OrderSheetGrouping>('Category');

  protected readonly showFilters = computed<FilterOption[]>(() => {
    const lines = this.plan()?.lines ?? [];
    return [
      { value: '', label: 'All · الكل', count: lines.length },
      { value: 'order', label: 'To order · للطلب', count: lines.filter((l) => this.approvedOf(l) > 0).length },
      { value: 'below', label: 'Below reorder · تحت حد الطلب', count: lines.filter((l) => l.belowReorder).length },
    ];
  });

  protected readonly categoryFilters = computed<FilterOption[]>(() => {
    const lines = this.plan()?.lines ?? [];
    const categories = [...new Map(lines.map((l) => [l.categoryId, l])).values()];
    return [
      { value: '', label: 'All · الكل', count: lines.length },
      ...categories.map((c) => ({
        value: c.categoryId,
        label: c.categoryAr ? `${c.category} · ${c.categoryAr}` : (c.category ?? 'Uncategorized'),
        count: lines.filter((l) => l.categoryId === c.categoryId).length,
      })),
    ];
  });

  protected readonly shown = computed(() =>
    (this.plan()?.lines ?? []).filter(
      (l) =>
        (!this.category() || l.categoryId === this.category()) &&
        (this.show() !== 'order' || this.approvedOf(l) > 0) &&
        (this.show() !== 'below' || l.belowReorder) &&
        smartMatch(this.search(), l.material, l.code, l.category, l.supplier),
    ),
  );

  protected readonly approvedLines = computed(() => (this.plan()?.lines ?? []).filter((l) => this.approvedOf(l) > 0).length);
  protected readonly approvedTotal = computed(() =>
    Math.round((this.plan()?.lines ?? []).reduce((sum, l) => sum + this.approvedOf(l) * (l.unitPrice ?? 0), 0) * 100) / 100,
  );

  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    // Planned again as the inputs change: at once for a choice, after a pause for what is typed.
    effect(() => {
      const request = {
        lookbackDays: this.lookback(),
        coverageDays: this.coverage(),
        growthPercent: this.growth(),
        dishes: [...this.expectations().values()],
      };
      untracked(() => {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => void this.load(request), this.plan() ? 300 : 0);
      });
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  protected key(dish: PlannedDish): string {
    return dishKey(dish);
  }

  protected expectationOf(dish: PlannedDish): number | null {
    return this.expectations().get(dishKey(dish))?.expectedDaily ?? null;
  }

  protected expect(dish: PlannedDish, value: number | string | null): void {
    const next = new Map(this.expectations());
    const number = value === null || value === '' ? null : Number(value);
    if (number === null || !Number.isFinite(number) || number < 0) {
      next.delete(dishKey(dish));
    } else {
      next.set(dishKey(dish), { menuItemId: dish.menuItemId, variantId: dish.variantId, expectedDaily: number });
    }
    this.expectations.set(next);
  }

  protected setCoverage(value: number | string | null): void {
    const days = Math.round(Number(value));
    if (Number.isFinite(days) && days >= 1 && days <= 60) {
      this.coverage.set(days);
    }
  }

  protected setGrowth(value: number | string | null): void {
    const percent = Number(value);
    if (value !== '' && value !== null && Number.isFinite(percent) && percent >= -90 && percent <= 500) {
      this.growth.set(percent);
    }
  }

  protected approvedOf(line: OrderPlanLine): number {
    return this.approved().get(line.rawMaterialId) ?? line.suggested;
  }

  protected approve(line: OrderPlanLine, value: number | string | null): void {
    const number = Number(value);
    const next = new Map(this.approved());
    if (value === '' || value === null || !Number.isFinite(number) || number < 0) {
      next.delete(line.rawMaterialId);
    } else {
      next.set(line.rawMaterialId, number);
    }
    this.approved.set(next);
  }

  protected resetApproved(): void {
    this.approved.set(new Map());
  }

  protected async download(): Promise<void> {
    const plan = this.plan();
    if (!plan) {
      return;
    }
    const lines = plan.lines.filter((l) => this.approvedOf(l) > 0).map((l) => ({ rawMaterialId: l.rawMaterialId, quantity: this.approvedOf(l) }));
    try {
      const blob = await firstValueFrom(this.api.orderSheet(lines, this.groupBy(), plan.coverageDays));
      saveBlob(blob, `order-${plan.lookbackTo}.xlsx`);
      this.notify.info(`Order sheet made: ${lines.length} ${lines.length === 1 ? 'material' : 'materials'}, ${this.company.money(this.approvedTotal())}.`);
    } catch (error) {
      this.notify.error(error, 'The order sheet could not be made.');
    }
  }

  private async load(request: { lookbackDays: number; coverageDays: number; growthPercent: number; dishes: { menuItemId: number; variantId: number | null; expectedDaily: number }[] }): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.plan.set(await firstValueFrom(this.api.plan(request)));
    } catch (error) {
      this.error.set(errorMessage(error, 'The order could not be planned.'));
    } finally {
      this.loading.set(false);
    }
  }
}
