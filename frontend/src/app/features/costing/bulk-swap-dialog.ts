import { DecimalPipe } from '@angular/common';
import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialog, MatDialogActions, MatDialogContent, MatDialogRef, MatDialogTitle } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Observable, firstValueFrom } from 'rxjs';
import {
  BulkSwapResult,
  CostingApi,
  MaterialCost,
  SwapPreview,
  SwapPreviewRow,
  UnitOfMeasure,
  WhereUsedKind,
  WhereUsedReport,
  recipeCostOf,
} from '../../core/costing/costing.api';
import { errorMessage } from '../../core/http/error-message';
import { Company } from '../../core/settings/company';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { NotifyService } from '../../core/ui/notify.service';
import { InfoTip } from './info-tip';
import { MaterialPicker } from './material-picker';

// The item to start from: the stock card's, when opened from it.
export interface BulkSwapData {
  fromMaterialId?: string | null;
}

export const unitShort: Record<UnitOfMeasure, string> = { Gram: 'g', Millilitre: 'ml', Piece: 'pc' };

export const usedKindLabels: Record<WhereUsedKind, { en: string; ar: string; icon: string }> = {
  Dish: { en: 'Dish', ar: 'طبق', icon: 'restaurant' },
  OffMenuRecipe: { en: 'Off the menu', ar: 'خارج المنيو', icon: 'science' },
  PrepItem: { en: 'Prep item', ar: 'مصنّع', icon: 'soup_kitchen' },
};

const steps = [
  { en: 'Old item', ar: 'الخامة القديمة' },
  { en: 'New item', ar: 'الخامة الجديدة' },
  { en: 'Conversion', ar: 'معامل التحويل' },
  { en: 'Preview & choose', ar: 'معاينة واختيار الوصفات' },
];

// The bulk material swap (معالج الاستبدال الشامل للخامات): the old item, the new one, how much of the
// new replaces each unit of the old (1:1 unless the chef says), then every recipe and prep item
// with the old item on it, as the swap would leave it, each ticked unless it cannot be swapped now.
// Swapped together or not at all; closes with what was done.
@Component({
  selector: 'app-bulk-swap-dialog',
  imports: [
    DecimalPipe,
    FormsModule,
    InfoTip,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogActions,
    MatDialogContent,
    MatDialogTitle,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MaterialPicker,
    MoneyPipe,
  ],
  template: `
    <h2 mat-dialog-title>Bulk swap material <span class="inline-ar">استبدال خامة شامل</span></h2>
    <mat-dialog-content>
      <ol class="steps" aria-label="Steps">
        @for (s of steps; track s.en; let i = $index) {
          <li [class.current]="step() === i + 1" [class.done]="step() > i + 1" [attr.aria-current]="step() === i + 1 ? 'step' : null">
            <span class="dot">{{ step() > i + 1 ? '✓' : i + 1 }}</span>
            <span>{{ s.en }}<span class="ar">{{ s.ar }}</span></span>
          </li>
        }
      </ol>
      @if (busy()) {
        <mat-progress-bar mode="indeterminate" />
      }
      @if (error(); as e) {
        <p class="error" role="alert">{{ e }}</p>
      }

      @switch (step()) {
        @case (1) {
          <p class="lead">The item to take off the recipes · الخامة المُراد استبدالها</p>
          <app-material-picker [materials]="materials()" [value]="from()" (valueChange)="pickFrom($event)" label="Old item · الخامة القديمة" />
          @if (usage(); as u) {
            <p class="usage">
              @if (onRecipes() === 0 && onPrep() === 0) {
                <mat-icon aria-hidden="true">info</mat-icon> {{ u.material }} is on no recipe itself{{ u.rows.length ? ', only inside prep items' : '' }}: nothing to swap.
              } @else {
                <mat-icon aria-hidden="true">receipt_long</mat-icon>
                On {{ onRecipes() }} {{ onRecipes() === 1 ? 'recipe' : 'recipes' }} and {{ onPrep() }} {{ onPrep() === 1 ? 'prep item' : 'prep items' }}
                · في {{ onRecipes() }} وصفة و{{ onPrep() }} مصنّع
              }
            </p>
          }
        }
        @case (2) {
          <p class="lead">What goes on instead of {{ fromItem()?.name }} · الخامة الجديدة</p>
          <app-material-picker [materials]="candidates()" [value]="to()" (valueChange)="to.set($event)" label="New item · الخامة الجديدة" />
          @if (fromItem(); as f) {
            <div class="pair">
              <div><span class="muted small">Old · القديمة</span><strong>{{ f.name }}</strong><span class="muted small">{{ priceOf(f) }}</span></div>
              <mat-icon aria-hidden="true">arrow_forward</mat-icon>
              @if (toItem(); as t) {
                <div><span class="muted small">New · الجديدة</span><strong>{{ t.name }}</strong><span class="muted small">{{ priceOf(t) }}</span></div>
              } @else {
                <div class="muted">Choose the new item</div>
              }
            </div>
          }
        }
        @case (3) {
          @if (fromItem(); as f) {
            @if (toItem(); as t) {
              <p class="lead">How much of the new item replaces the old · معامل التحويل <app-info-tip tip="bsRatio" /></p>
              <div class="ratio">
                <span>Replace</span>
                <mat-form-field subscriptSizing="dynamic" class="qty">
                  <input matInput type="number" min="0" step="any" [ngModel]="base()" (ngModelChange)="base.set($event)" aria-label="Old quantity" />
                  <span matTextSuffix>&nbsp;{{ units[f.unit] }}</span>
                </mat-form-field>
                <span>of <strong>{{ f.name }}</strong> with</span>
                <mat-form-field subscriptSizing="dynamic" class="qty">
                  <input matInput type="number" min="0" step="any" [ngModel]="replacement()" (ngModelChange)="replacement.set($event)" aria-label="New quantity" />
                  <span matTextSuffix>&nbsp;{{ units[t.unit] }}</span>
                </mat-form-field>
                <span>of <strong>{{ t.name }}</strong></span>
              </div>
              <p class="muted">
                @if (ratio(); as r) {
                  Ratio {{ r | number: '1.0-4' }} · each {{ units[f.unit] }} of the old becomes {{ r | number: '1.0-4' }} {{ units[t.unit] }} of the new.
                } @else {
                  Both quantities are more than nothing, the ratio at most 1,000.
                }
              </p>
              @if (f.unit !== t.unit) {
                <p class="warn"><mat-icon aria-hidden="true">warning</mat-icon> {{ f.name }} is in {{ units[f.unit] }}, {{ t.name }} in {{ units[t.unit] }}: check the ratio · الوحدات مختلفة، راجع المعامل.</p>
              }
              <button mat-button type="button" (click)="resetRatio()" [disabled]="ratio() === 1"><mat-icon>restart_alt</mat-icon> 1 : 1</button>
            }
          }
        }
        @case (4) {
          @if (preview(); as p) {
            <p class="lead">
              {{ p.from.name }} → {{ p.to.name }} at {{ p.ratio | number: '1.0-4' }}
              <span class="muted">· untick what should keep {{ p.from.name }}</span>
            </p>
            <div class="table-wrap">
              <table class="grid swap">
                <thead>
                  <tr>
                    <th class="check">
                      <mat-checkbox [checked]="allChosen()" [indeterminate]="someChosen()" [disabled]="!choosable().length" (change)="chooseAll($event.checked)"
                        aria-label="Choose every recipe" />
                    </th>
                    <th>Recipe<span class="ar">الوصفة</span></th>
                    <th class="num">Current {{ units[p.from.unit] }}<span class="ar">الكمية الحالية</span></th>
                    <th class="num">New {{ units[p.to.unit] }}<span class="ar">الكمية الجديدة</span></th>
                    <th class="num">Old cost<span class="ar">التكلفة القديمة</span></th>
                    <th class="num">New cost<span class="ar">التكلفة الجديدة</span></th>
                    <th class="num">Cost delta <app-info-tip tip="bsDelta" /><span class="ar">فرق التكلفة</span></th>
                    <th class="num">Food cost %<span class="ar">نسبة التكلفة</span></th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of p.rows; track row.id) {
                    <tr [class.off]="!isChosen(row)" [class.blocked]="row.blocked">
                      <td class="check">
                        <mat-checkbox [checked]="isChosen(row)" [disabled]="!!row.blocked" (change)="choose(row, $event.checked)" [attr.aria-label]="'Swap in ' + row.name" />
                      </td>
                      <td>
                        <span class="kind" [class]="row.kind"><mat-icon aria-hidden="true">{{ kinds[row.kind].icon }}</mat-icon> {{ kinds[row.kind].en }}</span>
                        <strong>{{ row.name }}</strong>
                        <div class="muted small">
                          {{ row.itemCode ? row.itemCode + ' · ' : '' }}{{ makes(row) }}
                        </div>
                        @if (row.blocked) {
                          <div class="blocked-note"><mat-icon aria-hidden="true">lock</mat-icon> {{ row.blocked }}</div>
                        } @else if (row.fromNextBatch) {
                          <div class="muted small"><mat-icon class="tiny" aria-hidden="true">schedule</mat-icon> from the next batch · من الدفعة القادمة</div>
                        }
                      </td>
                      <td class="num">{{ row.oldQuantity | number: '1.0-3' }}</td>
                      <td class="num strong">
                        {{ row.newQuantity | number: '1.0-3' }}
                        @if (row.merged) {
                          <div class="muted small">added to what is there</div>
                        }
                      </td>
                      <td class="num">{{ row.oldCost === null ? '—' : (row.oldCost | money) }}</td>
                      <td class="num">{{ row.newCost === null ? '—' : (row.newCost | money) }}</td>
                      <td class="num delta" [class.up]="(row.costDelta ?? 0) > 0" [class.down]="(row.costDelta ?? 0) < 0">{{ signed(row.costDelta) }}</td>
                      <td class="num nowrap">{{ fc(row.oldFoodCostPercent) }} → {{ fc(row.newFoodCostPercent) }}</td>
                    </tr>
                  } @empty {
                    <tr><td colspan="8" class="muted">No recipe or prep item has {{ p.from.name }} on it.</td></tr>
                  }
                </tbody>
              </table>
            </div>
            <p class="muted small">A dish's cost is a portion's; a prep item's, a batch's.</p>

            @if (p.knockOn.length) {
              <h3>Also moving through prep items · أطباق تتأثر عبر المصنّعات <app-info-tip tip="bsKnockOn" /></h3>
              <div class="table-wrap">
                <table class="grid knock-on">
                  <thead>
                    <tr>
                      <th>Dish<span class="ar">الطبق</span></th>
                      <th>Through<span class="ar">عبر</span></th>
                      <th class="num">Old cost<span class="ar">القديمة</span></th>
                      <th class="num">New cost<span class="ar">الجديدة</span></th>
                      <th class="num">Cost delta<span class="ar">الفرق</span></th>
                      <th class="num">Food cost %<span class="ar">نسبة التكلفة</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (k of p.knockOn; track k.id) {
                      <tr>
                        <td>
                          <strong>{{ k.name }}</strong>
                          @if (k.fromNextBatch) {
                            <div class="muted small">from the next batch · من الدفعة القادمة</div>
                          }
                        </td>
                        <td>{{ k.via.join(', ') }}</td>
                        <td class="num">{{ k.oldCost === null ? '—' : (k.oldCost | money) }}</td>
                        <td class="num">{{ k.newCost === null ? '—' : (k.newCost | money) }}</td>
                        <td class="num delta" [class.up]="(k.costDelta ?? 0) > 0" [class.down]="(k.costDelta ?? 0) < 0">{{ signed(k.costDelta) }}</td>
                        <td class="num nowrap">{{ fc(k.oldFoodCostPercent) }} → {{ fc(k.newFoodCostPercent) }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          }
        }
      }
    </mat-dialog-content>
    <mat-dialog-actions>
      <span class="summary muted">
        @if (step() === 4 && preview()) {
          {{ chosenRecipes().length }} {{ chosenRecipes().length === 1 ? 'recipe' : 'recipes' }} and {{ chosenPrep().length }}
          {{ chosenPrep().length === 1 ? 'prep item' : 'prep items' }} chosen
        }
      </span>
      <button mat-button type="button" (click)="close()" [disabled]="saving()">Cancel</button>
      @if (step() > 1) {
        <button mat-stroked-button type="button" (click)="back()" [disabled]="saving()"><mat-icon>arrow_back</mat-icon> Back</button>
      }
      @if (step() < 4) {
        <button mat-flat-button type="button" class="next" (click)="next()" [disabled]="!canNext() || busy()">Next <mat-icon iconPositionEnd>arrow_forward</mat-icon></button>
      } @else {
        <button mat-flat-button type="button" class="swap" (click)="swap()" [disabled]="!canSwap()">
          <mat-icon>swap_horiz</mat-icon> Swap · استبدال
        </button>
      }
    </mat-dialog-actions>
  `,
  styleUrl: './costing.scss',
  styles: `
    .steps {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 18px;
      margin: 0 0 16px;
      padding: 0;
      list-style: none;

      li {
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--mat-sys-on-surface-variant);
        font: var(--mat-sys-label-large);
      }
      .dot {
        display: inline-grid;
        place-items: center;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background: var(--mat-sys-surface-container-high);
        font: var(--mat-sys-label-medium);
      }
      li.current {
        color: var(--mat-sys-on-surface);
        .dot {
          background: var(--mat-sys-primary);
          color: var(--mat-sys-on-primary);
        }
      }
      li.done .dot {
        background: color-mix(in srgb, var(--app-ok) 18%, transparent);
        color: var(--app-ok);
      }
      .ar {
        display: inline;
        margin-inline-start: 6px;
      }
    }
    .lead {
      margin: 0 0 12px;
      font: var(--mat-sys-title-small);
    }
    .usage,
    .warn {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 12px 0 0;
    }
    .warn {
      color: var(--app-warn);
    }
    .pair {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 16px;
      margin-top: 16px;

      div {
        display: grid;
        gap: 2px;
        min-width: 160px;
      }
    }
    .ratio {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 10px;
    }
    .qty {
      width: 130px;
    }
    .check {
      width: 40px;
    }
    tr.off td:not(.check) {
      color: var(--mat-sys-on-surface-variant);
    }
    tr.off td.delta {
      opacity: 0.6;
    }
    .kind {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-inline-end: 6px;
      padding: 0 8px;
      border-radius: 999px;
      font: var(--mat-sys-label-small);
      line-height: 20px;
      background: var(--mat-sys-surface-container-high);

      mat-icon {
        width: 14px;
        height: 14px;
        font-size: 14px;
      }
    }
    .blocked-note {
      display: flex;
      align-items: center;
      gap: 4px;
      color: var(--app-warn);
      font: var(--mat-sys-body-small);

      mat-icon {
        width: 14px;
        height: 14px;
        font-size: 14px;
      }
    }
    .tiny {
      width: 12px;
      height: 12px;
      font-size: 12px;
      vertical-align: middle;
    }
    .delta.up {
      color: var(--mat-sys-error);
      font-weight: 600;
    }
    .delta.down {
      color: var(--app-ok);
      font-weight: 600;
    }
    h3 {
      margin: 20px 0 8px;
      font: var(--mat-sys-title-small);
    }
    .summary {
      flex: 1;
      padding-inline-start: 8px;
    }
    .small {
      font-size: 0.85em;
    }
  `,
})
export class BulkSwapDialog implements OnDestroy {
  private readonly data = inject<BulkSwapData | null>(MAT_DIALOG_DATA, { optional: true });
  private readonly api = inject(CostingApi);
  private readonly company = inject(Company);
  private readonly notify = inject(NotifyService);
  private readonly ref = inject(MatDialogRef<BulkSwapDialog, BulkSwapResult | undefined>);

  protected readonly steps = steps;
  protected readonly units = unitShort;
  protected readonly kinds = usedKindLabels;
  protected readonly step = signal(1);
  protected readonly materials = signal<MaterialCost[]>([]);
  protected readonly from = signal<string | null>(null);
  protected readonly to = signal<string | null>(null);
  protected readonly usage = signal<WhereUsedReport | null>(null);
  // "Replace base of the old with replacement of the new".
  protected readonly base = signal<number | null>(100);
  protected readonly replacement = signal<number | null>(100);
  protected readonly preview = signal<SwapPreview | null>(null);
  // The rows chosen, by id; null until the first preview ticks them.
  protected readonly chosen = signal<ReadonlySet<string>>(new Set());
  protected readonly busy = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private sequence = 0;

  protected readonly fromItem = computed(() => this.materials().find((m) => m.id === this.from()) ?? null);
  protected readonly toItem = computed(() => this.materials().find((m) => m.id === this.to()) ?? null);
  // Any item but the old one.
  protected readonly candidates = computed(() => this.materials().filter((m) => m.id !== this.from()));
  protected readonly onRecipes = computed(() => (this.usage()?.rows ?? []).filter((r) => r.kind !== 'PrepItem' && r.quantity !== null).length);
  protected readonly onPrep = computed(() => (this.usage()?.rows ?? []).filter((r) => r.kind === 'PrepItem' && r.quantity !== null).length);
  protected readonly ratio = computed(() => {
    const [base, replacement] = [Number(this.base()), Number(this.replacement())];
    if (!(base > 0) || !(replacement > 0)) {
      return null;
    }
    const ratio = Math.round((replacement / base) * 1e6) / 1e6;
    return ratio > 0 && ratio <= 1000 ? ratio : null;
  });
  protected readonly choosable = computed(() => (this.preview()?.rows ?? []).filter((r) => !r.blocked));
  protected readonly chosenRecipes = computed(() => this.choosable().filter((r) => r.kind !== 'PrepItem' && this.chosen().has(r.id)).map((r) => r.id));
  protected readonly chosenPrep = computed(() => this.choosable().filter((r) => r.kind === 'PrepItem' && this.chosen().has(r.id)).map((r) => r.id));
  protected readonly allChosen = computed(() => this.choosable().length > 0 && this.choosable().every((r) => this.chosen().has(r.id)));
  protected readonly someChosen = computed(() => !this.allChosen() && this.choosable().some((r) => this.chosen().has(r.id)));
  protected readonly canNext = computed(() => {
    switch (this.step()) {
      case 1:
        return !!this.from() && this.onRecipes() + this.onPrep() > 0;
      case 2:
        return !!this.to() && this.to() !== this.from();
      default:
        return this.ratio() !== null;
    }
  });
  protected readonly canSwap = computed(() => !this.saving() && !this.busy() && this.chosenRecipes().length + this.chosenPrep().length > 0);

  constructor() {
    void this.start();
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
  }

  protected pickFrom(id: string | null): void {
    this.from.set(id);
    this.usage.set(null);
    if (this.to() === id) {
      this.to.set(null);
    }
    const item = this.materials().find((m) => m.id === id);
    if (item) {
      const each = item.unit === 'Piece' ? 1 : 100;
      this.base.set(each);
      this.replacement.set(each);
      void this.loadUsage(item.id);
    }
  }

  protected resetRatio(): void {
    this.replacement.set(this.base());
  }

  protected priceOf(item: MaterialCost): string {
    const perUnit = recipeCostOf(item);
    return perUnit === null ? 'no price yet' : `${this.company.money(perUnit * item.purchaseUnitSize)} / ${item.purchaseUnit}`;
  }

  protected isChosen(row: SwapPreviewRow): boolean {
    return !row.blocked && this.chosen().has(row.id);
  }

  protected choose(row: SwapPreviewRow, checked: boolean): void {
    const next = new Set(this.chosen());
    if (checked) {
      next.add(row.id);
    } else {
      next.delete(row.id);
    }
    this.chosen.set(next);
    this.refreshSoon();
  }

  protected chooseAll(checked: boolean): void {
    this.chosen.set(new Set(checked ? this.choosable().map((r) => r.id) : []));
    this.refreshSoon();
  }

  // What the quantities are for: a dish's portions, a prep item's batch.
  protected makes(row: SwapPreviewRow): string {
    if (row.kind !== 'PrepItem') {
      return row.portions === 1 ? 'for 1 portion' : `for ${row.portions} portions`;
    }
    const unit = this.materials().find((m) => m.id === row.id)?.unit;
    return `for a batch of ${(row.batchQuantity ?? 0).toLocaleString('en', { maximumFractionDigits: 3 })}${unit ? ' ' + unitShort[unit] : ''}`;
  }

  protected signed(value: number | null): string {
    if (value === null) {
      return '—';
    }
    const money = this.company.money(Math.abs(value));
    return value > 0 ? `+${money}` : value < 0 ? `−${money}` : money;
  }

  protected fc(value: number | null): string {
    return value === null ? '—' : `${value.toFixed(1)}%`;
  }

  protected back(): void {
    this.error.set(null);
    this.step.update((s) => Math.max(1, s - 1));
  }

  protected async next(): Promise<void> {
    if (!this.canNext()) {
      return;
    }
    this.error.set(null);
    if (this.step() < 3) {
      this.step.update((s) => s + 1);
      return;
    }
    // Every row it can be ticked to start with.
    const preview = await this.run(this.api.previewBulkSwap({ fromMaterialId: this.from()!, toMaterialId: this.to()!, ratio: this.ratio()! }));
    if (preview) {
      this.preview.set(preview);
      this.chosen.set(new Set(preview.rows.filter((r) => r.selected).map((r) => r.id)));
      this.step.set(4);
    }
  }

  protected async swap(): Promise<void> {
    if (!this.canSwap()) {
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    try {
      const done = await firstValueFrom(this.api.bulkSwap(this.request()));
      this.notify.info(
        `${this.fromItem()?.name} swapped for ${this.toItem()?.name} in ${done.recipes} ${done.recipes === 1 ? 'recipe' : 'recipes'} and ${done.prepItems} ${done.prepItems === 1 ? 'prep item' : 'prep items'}. · تم الاستبدال.`,
      );
      this.ref.close(done);
    } catch (error) {
      this.error.set(errorMessage(error, 'The swap could not be made. Nothing was changed.'));
    } finally {
      this.saving.set(false);
    }
  }

  protected close(): void {
    this.ref.close();
  }

  private request() {
    return {
      fromMaterialId: this.from()!,
      toMaterialId: this.to()!,
      ratio: this.ratio()!,
      recipeIds: this.chosenRecipes(),
      prepItemIds: this.chosenPrep(),
    };
  }

  // The costs again with the rows chosen: a prep item left out moves no dish.
  private refreshSoon(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => void this.refresh(), 300);
  }

  private async refresh(): Promise<void> {
    const sequence = ++this.sequence;
    const preview = await this.run(this.api.previewBulkSwap(this.request()));
    if (preview && sequence === this.sequence) {
      this.preview.set(preview);
    }
  }

  private async run<T>(call: Observable<T>): Promise<T | null> {
    this.busy.set(true);
    try {
      return await firstValueFrom(call);
    } catch (error) {
      this.error.set(errorMessage(error, 'The swap could not be previewed.'));
      return null;
    } finally {
      this.busy.set(false);
    }
  }

  private async start(): Promise<void> {
    try {
      this.materials.set(await firstValueFrom(this.api.materials()));
    } catch (error) {
      this.error.set(errorMessage(error, 'The items could not be loaded.'));
      return;
    }
    if (this.data?.fromMaterialId) {
      this.pickFrom(this.data.fromMaterialId);
      this.step.set(2);
    }
  }

  private async loadUsage(id: string): Promise<void> {
    try {
      const usage = await firstValueFrom(this.api.whereUsed(id));
      if (this.from() === id) {
        this.usage.set(usage);
      }
    } catch (error) {
      this.error.set(errorMessage(error, 'Where it is used could not be loaded.'));
    }
  }
}

// The wizard over the page; resolves with what was swapped, or nothing when it was left.
export function showBulkSwap(dialog: MatDialog, fromMaterialId?: string | null): Promise<BulkSwapResult | undefined> {
  return firstValueFrom(
    dialog
      .open<BulkSwapDialog, BulkSwapData, BulkSwapResult | undefined>(BulkSwapDialog, {
        data: { fromMaterialId },
        width: '1100px',
        maxWidth: '96vw',
        autoFocus: 'dialog',
      })
      .afterClosed(),
  );
}
