import { DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSliderModule } from '@angular/material/slider';
import { firstValueFrom } from 'rxjs';
import { CostingApi, MaterialCost } from '../../core/costing/costing.api';
import { InflationReport, InflationScenario, IntelligenceApi, SimulatedItem, SimulatedItemKind } from '../../core/costing/intelligence.api';
import { errorMessage } from '../../core/http/error-message';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { NotifyService } from '../../core/ui/notify.service';
import { saveBlob } from '../../core/ui/save-blob';
import { SearchField } from '../shared/search-field';
import { smartMatch } from '../shared/smart-search';
import { InfoTip } from './info-tip';
import { MaterialPicker } from './material-picker';

interface CategoryRule {
  categoryId: string | null;
  percent: number | null;
}

interface MaterialRule {
  rawMaterialId: string | null;
  price: number | null;
}

const kindLabels: Record<SimulatedItemKind, { en: string; ar: string }> = {
  Dish: { en: 'Dishes', ar: 'الأطباق' },
  OffMenuRecipe: { en: 'Off the menu', ar: 'خارج المنيو' },
  PrepItem: { en: 'Prep items', ar: 'المصنعات' },
};

// The inflation & pricing simulator (محاكي التضخم والتسعير): what-if prices for the bought
// materials (a global %, a % by category, a new price for a material: the most specific wins), and
// every dish, off-menu recipe and prep item costed again at them, nested prep items included; the
// food cost % before and after, the prices that would keep the food cost % or the cash margin, and
// what a month's profit would lose at the last 30 days' sales. Nothing is saved.
@Component({
  selector: 'app-inflation-page',
  imports: [
    DecimalPipe,
    FormsModule,
    InfoTip,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
    MatSliderModule,
    MaterialPicker,
    MoneyPipe,
    SearchField,
  ],
  template: `
    <section class="controls" aria-label="What if">
      <div class="global">
        <span class="label">Every material · كل الخامات</span>
        <mat-slider min="-20" max="50" step="1" discrete class="slider">
          <input matSliderThumb [ngModel]="global() ?? 0" (ngModelChange)="global.set($event || null)" aria-label="Global change slider" />
        </mat-slider>
        <mat-form-field subscriptSizing="dynamic" class="percent">
          <input matInput type="number" step="0.5" [ngModel]="global()" (ngModelChange)="global.set(figure($event))" aria-label="Global change" placeholder="0" />
          <span matTextSuffix>%</span>
        </mat-form-field>
      </div>

      <div class="rules">
        <h3>By category · حسب القسم</h3>
        @for (rule of categoryRules(); track $index; let i = $index) {
          <div class="rule">
            <mat-form-field subscriptSizing="dynamic" class="category">
              <mat-label>Category · القسم</mat-label>
              <mat-select [ngModel]="rule.categoryId" (ngModelChange)="patchCategory(i, { categoryId: $event })" [attr.aria-label]="'Category, rule ' + (i + 1)">
                @for (c of categories(); track c.id) {
                  <mat-option [value]="c.id">{{ c.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field subscriptSizing="dynamic" class="percent">
              <input matInput type="number" step="0.5" [ngModel]="rule.percent" (ngModelChange)="patchCategory(i, { percent: figure($event) })"
                [attr.aria-label]="'Change, rule ' + (i + 1)" placeholder="0" />
              <span matTextSuffix>%</span>
            </mat-form-field>
            <button mat-icon-button (click)="removeCategory(i)" [attr.aria-label]="'Remove category rule ' + (i + 1)"><mat-icon>close</mat-icon></button>
          </div>
        }
        <button mat-button (click)="addCategory()"><mat-icon>add</mat-icon> A category · قسم</button>
      </div>

      <div class="rules">
        <h3>A material's new price · سعر خامة بعينها</h3>
        @for (rule of materialRules(); track $index; let i = $index) {
          <div class="rule">
            <app-material-picker class="material" [materials]="bought()" [value]="rule.rawMaterialId" (valueChange)="patchMaterial(i, { rawMaterialId: $event })"
              [label]="'Material, rule ' + (i + 1)" />
            <mat-form-field subscriptSizing="dynamic" class="price">
              <mat-label>New price · السعر الجديد</mat-label>
              <input matInput type="number" min="0" step="any" [ngModel]="rule.price" (ngModelChange)="patchMaterial(i, { price: figure($event) })"
                [attr.aria-label]="'New price, rule ' + (i + 1)" />
              <span matTextSuffix>&nbsp;/ {{ unitOf(rule) }}</span>
            </mat-form-field>
            <button mat-icon-button (click)="removeMaterial(i)" [attr.aria-label]="'Remove material rule ' + (i + 1)"><mat-icon>close</mat-icon></button>
          </div>
        }
        <button mat-button (click)="addMaterial()"><mat-icon>add</mat-icon> A material · خامة</button>
      </div>
      <p class="muted small">The most specific rule wins: a material's own price, then its category's %, then every material's %. Nothing is saved.</p>
    </section>

    <div class="toolbar">
      <button mat-button (click)="reset()" [disabled]="!touched()"><mat-icon>restart_alt</mat-icon> Clear · مسح</button>
      <span class="spacer"></span>
      <button mat-stroked-button (click)="download()" [disabled]="!report()"><mat-icon>download</mat-icon> Export simulation · Excel</button>
    </div>
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    @if (error()) {
      <p class="error">{{ error() }}</p>
    } @else if (report(); as r) {
      <div class="tiles">
        <div class="tile key">
          <span class="label">Monthly profit impact · أثر الربح الشهري <app-info-tip tip="inImpact" /></span>
          <strong [class.loss]="r.monthlyProfitImpact < 0">{{ r.monthlyProfitImpact | money }}</strong>
          <small class="chip">at the last 30 days' sales</small>
        </div>
        <div class="tile" [class.alert]="r.newlyAboveTarget > 0">
          <span class="label">Dishes newly above target · أطباق تجاوزت النسبة</span>
          <strong>{{ r.newlyAboveTarget }}</strong>
          <small class="chip">target {{ r.foodCostTargetPercent | number: '1.0-1' }}%</small>
        </div>
        <div class="tile">
          <span class="label">Materials repriced · خامات تغير سعرها</span>
          <strong>{{ r.materialsChanged }}</strong>
        </div>
        <div class="tile">
          <span class="label">Dishes · الأطباق</span>
          <strong>{{ r.dishes }}</strong>
        </div>
      </div>

      <div class="toolbar smart">
        <app-search-field [(value)]="search" placeholder="Dish, recipe or prep item · الطبق أو الوصفة" />
        <mat-button-toggle-group [value]="kind()" (change)="kind.set($event.value)" aria-label="Show">
          @for (k of kinds; track k) {
            <mat-button-toggle [value]="k">{{ kindLabels[k].en }} · {{ kindLabels[k].ar }}</mat-button-toggle>
          }
        </mat-button-toggle-group>
      </div>

      <div class="table-wrap">
        <table class="grid simulated">
          <thead>
            <tr>
              <th>{{ kind() === 'PrepItem' ? 'Prep item' : 'Dish / recipe' }}<span class="ar">الاسم</span></th>
              <th class="num">Selling price<span class="ar">سعر البيع</span></th>
              <th class="num">Cost now → simulated <app-info-tip tip="inSimulated" /><span class="ar">التكلفة الحالية ← المتوقعة</span></th>
              <th class="num">Change<span class="ar">التغير</span></th>
              @if (kind() !== 'PrepItem') {
                <th class="num">Food cost %<span class="ar">نسبة التكلفة</span></th>
                <th class="num">Keep food cost % <app-info-tip tip="inKeepFc" /><span class="ar">للحفاظ على النسبة</span></th>
                <th class="num">Keep cash margin <app-info-tip tip="inKeepMargin" /><span class="ar">للحفاظ على الهامش</span></th>
              }
              @if (kind() === 'Dish') {
                <th class="num">Monthly impact <app-info-tip tip="inImpact" /><span class="ar">الأثر الشهري</span></th>
              }
            </tr>
          </thead>
          <tbody>
            @for (i of shown(); track i.kind + i.itemCode + (i.recipeId ?? i.prepItemId ?? i.name)) {
              <tr [class.breach]="i.newlyAboveTarget">
                <td>
                  <strong>{{ i.name }}</strong>
                  <div class="muted small">{{ i.itemCode ? i.itemCode + ' · ' : '' }}{{ i.category ?? '' }} · per {{ i.unit }}</div>
                </td>
                <td class="num">{{ i.sellingPrice === null ? '—' : (i.sellingPrice | money) }}</td>
                <td class="num">{{ i.currentCost | money }} → <strong>{{ i.simulatedCost | money }}</strong></td>
                <td class="num" [class.up]="i.change > 0">
                  {{ i.change > 0 ? '+' : '' }}{{ i.change | money }}
                  @if (i.changePercent !== null) {
                    <div class="small">{{ i.changePercent > 0 ? '+' : '' }}{{ i.changePercent | number: '1.1-1' }}%</div>
                  }
                </td>
                @if (kind() !== 'PrepItem') {
                  <td class="num">
                    {{ i.currentFoodCostPercent === null ? '—' : (i.currentFoodCostPercent | number: '1.1-1') + '%' }} →
                    <strong [class.over]="i.aboveTarget">{{ i.simulatedFoodCostPercent === null ? '—' : (i.simulatedFoodCostPercent | number: '1.1-1') + '%' }}</strong>
                    @if (i.newlyAboveTarget) {
                      <div class="breach-badge"><mat-icon aria-hidden="true">error</mat-icon> Over target · تجاوز</div>
                    }
                  </td>
                  <td class="num">{{ i.suggestedPriceKeepFoodCost === null ? '—' : (i.suggestedPriceKeepFoodCost | money) }}</td>
                  <td class="num">{{ i.suggestedPriceKeepMargin === null ? '—' : (i.suggestedPriceKeepMargin | money) }}</td>
                }
                @if (kind() === 'Dish') {
                  <td class="num" [class.loss]="(i.monthlyProfitImpact ?? 0) < 0">
                    {{ i.monthlyProfitImpact === null ? '—' : (i.monthlyProfitImpact | money) }}
                    <div class="small muted">{{ i.quantityLast30Days | number: '1.0-0' }} sold</div>
                  </td>
                }
              </tr>
            } @empty {
              <tr><td colspan="8" class="muted">Nothing to show{{ search() ? ' that matches' : '' }}.</td></tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .controls {
      display: grid;
      gap: 12px;
      margin: 0 0 12px;
      padding: 14px 16px;
      border-radius: 16px;
      border: 1px solid var(--app-line);
      background: var(--mat-sys-surface-container-lowest);

      h3 {
        margin: 0 0 6px;
        font: var(--mat-sys-title-small);
      }
    }
    .global {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 14px;

      .label {
        font: var(--mat-sys-title-small);
      }
      .slider {
        flex: 1 1 220px;
        max-width: 420px;
      }
    }
    .rule {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;

      .category {
        width: 240px;
      }
      .material {
        flex: 1 1 240px;
        max-width: 420px;
      }
      .price {
        width: 200px;
      }
    }
    .percent {
      width: 110px;
    }
    .chip {
      justify-self: start;
      padding: 0 8px;
      border-radius: 999px;
      font: var(--mat-sys-label-small);
      background: var(--mat-sys-surface-container-high);
    }
    .tile.alert {
      border-color: color-mix(in srgb, var(--mat-sys-error) 45%, transparent);
      strong {
        color: var(--mat-sys-error);
      }
    }
    .loss,
    .over {
      color: var(--mat-sys-error);
    }
    .up {
      color: var(--app-warn);
    }
    tr.breach td {
      background: color-mix(in srgb, var(--mat-sys-error) 6%, transparent);
    }
    .breach-badge {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      font: var(--mat-sys-label-small);
      color: var(--mat-sys-error);

      mat-icon {
        width: 14px;
        height: 14px;
        font-size: 14px;
      }
    }
    .small {
      font-size: 0.85em;
    }
    @media (max-width: 600px) {
      .rule .category,
      .rule .price {
        width: 100%;
      }
    }
  `,
})
export class InflationPage {
  private readonly api = inject(IntelligenceApi);
  private readonly costing = inject(CostingApi);
  private readonly notify = inject(NotifyService);
  protected readonly kindLabels = kindLabels;
  protected readonly kinds: SimulatedItemKind[] = ['Dish', 'OffMenuRecipe', 'PrepItem'];

  protected readonly global = signal<number | null>(null);
  protected readonly categoryRules = signal<CategoryRule[]>([]);
  protected readonly materialRules = signal<MaterialRule[]>([]);
  protected readonly materials = signal<MaterialCost[]>([]);
  protected readonly bought = computed(() => this.materials().filter((m) => m.kind !== 'Prep' && !m.misplaced));
  // Every category a bought material is filed under.
  protected readonly categories = computed(() => {
    const seen = new Map<string, string>();
    for (const m of this.bought()) {
      if (!seen.has(m.categoryId)) {
        seen.set(m.categoryId, m.category ?? 'General');
      }
    }
    return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  });

  protected readonly report = signal<InflationReport | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly search = signal('');
  protected readonly kind = signal<SimulatedItemKind>('Dish');

  protected readonly scenario = computed<InflationScenario>(() => ({
    globalPercent: this.global(),
    categories: this.categoryRules()
      .filter((r) => r.categoryId && r.percent !== null)
      .map((r) => ({ categoryId: r.categoryId!, percent: r.percent! })),
    materials: this.materialRules()
      .filter((r) => r.rawMaterialId && r.price !== null && r.price >= 0)
      .map((r) => ({ rawMaterialId: r.rawMaterialId!, costPerPurchaseUnit: r.price! })),
  }));

  protected readonly touched = computed(
    () => this.global() !== null || this.categoryRules().length > 0 || this.materialRules().length > 0,
  );

  protected readonly shown = computed<SimulatedItem[]>(() =>
    (this.report()?.items ?? []).filter((i) => i.kind === this.kind() && smartMatch(this.search(), i.name, i.itemCode, i.category)),
  );

  private timer: ReturnType<typeof setTimeout> | null = null;
  private asked = 0;

  constructor() {
    effect(() => {
      const scenario = this.scenario();
      untracked(() => {
        if (this.timer) {
          clearTimeout(this.timer);
        }
        // The first answer at once; what is typed after it, after a pause.
        if (this.report() === null) {
          void this.load(scenario);
        } else {
          this.timer = setTimeout(() => void this.load(scenario), 400);
        }
      });
    });
    firstValueFrom(this.costing.materials()).then(
      (materials) => this.materials.set(materials),
      () => this.materials.set([]),
    );
  }

  // A typed figure; cleared, none.
  protected figure(value: unknown): number | null {
    return value === null || value === '' || value === undefined || Number.isNaN(Number(value)) ? null : Number(value);
  }

  protected unitOf(rule: MaterialRule): string {
    return this.materials().find((m) => m.id === rule.rawMaterialId)?.purchaseUnit ?? 'unit';
  }

  protected addCategory(): void {
    this.categoryRules.update((all) => [...all, { categoryId: null, percent: null }]);
  }

  protected patchCategory(i: number, patch: Partial<CategoryRule>): void {
    this.categoryRules.update((all) => all.map((r, at) => (at === i ? { ...r, ...patch } : r)));
  }

  protected removeCategory(i: number): void {
    this.categoryRules.update((all) => all.filter((_, at) => at !== i));
  }

  protected addMaterial(): void {
    this.materialRules.update((all) => [...all, { rawMaterialId: null, price: null }]);
  }

  protected patchMaterial(i: number, patch: Partial<MaterialRule>): void {
    this.materialRules.update((all) => all.map((r, at) => (at === i ? { ...r, ...patch } : r)));
  }

  protected removeMaterial(i: number): void {
    this.materialRules.update((all) => all.filter((_, at) => at !== i));
  }

  protected reset(): void {
    this.global.set(null);
    this.categoryRules.set([]);
    this.materialRules.set([]);
  }

  protected async download(): Promise<void> {
    try {
      saveBlob(await firstValueFrom(this.api.simulateInflationSheet(this.scenario())), 'inflation-simulation.xlsx');
    } catch (error) {
      this.notify.error(error, 'The sheet could not be downloaded.');
    }
  }

  private async load(scenario: InflationScenario): Promise<void> {
    const asked = ++this.asked;
    this.loading.set(true);
    this.error.set(null);
    try {
      const report = await firstValueFrom(this.api.simulateInflation(scenario));
      if (asked === this.asked) {
        this.report.set(report);
      }
    } catch (error) {
      if (asked === this.asked) {
        this.error.set(errorMessage(error, 'The simulation could not be worked out.'));
      }
    } finally {
      if (asked === this.asked) {
        this.loading.set(false);
      }
    }
  }
}
