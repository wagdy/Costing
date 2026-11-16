import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogActions, MatDialogContent, MatDialogRef, MatDialogTitle } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { firstValueFrom } from 'rxjs';
import { ComboOffer, CostingApi, RecipeCostCard } from '../../core/costing/costing.api';
import { errorMessage } from '../../core/http/error-message';
import { Company } from '../../core/settings/company';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { NotifyService } from '../../core/ui/notify.service';
import { ItemPicker, PickItem } from '../shared/item-picker';
import { InfoTip } from './info-tip';

export interface ComboDialogData {
  // The combo to change; none for a new one, numbered nextCode.
  combo: ComboOffer | null;
  nextCode: number;
  foodCostTargetPercent: number;
  // The recipes a combo may hold: every one not deleted, on the menu or off it.
  recipes: RecipeCostCard[];
}

interface Line {
  recipeId: string | null;
  quantity: number | null;
}

// The combo builder (عرض مجمع): existing recipes and how many of each, a price of the combo's own,
// and as it is built, what the dishes cost together, what they would sell for apart, and the
// combo's food cost %, against the target. No bill of materials is entered: the dishes' recipes are
// the combo's.
@Component({
  selector: 'app-combo-dialog',
  imports: [
    DecimalPipe,
    FormsModule,
    InfoTip,
    ItemPicker,
    MatButtonModule,
    MatDialogActions,
    MatDialogContent,
    MatDialogTitle,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSlideToggleModule,
    MoneyPipe,
  ],
  template: `
    <h2 mat-dialog-title>{{ data.combo ? 'Change the combo' : 'New combo' }} <span class="inline-ar">{{ data.combo ? 'تعديل العرض' : 'عرض مجمع جديد' }}</span></h2>
    <mat-dialog-content>
      <div class="head">
        <mat-form-field subscriptSizing="dynamic" class="code">
          <mat-label>Code · الكود</mat-label>
          <input matInput type="number" min="1" [ngModel]="code()" (ngModelChange)="code.set($event)" [disabled]="!!data.combo" aria-label="Code" />
        </mat-form-field>
        <mat-form-field subscriptSizing="dynamic" class="name">
          <mat-label>Name · الاسم</mat-label>
          <input matInput maxlength="200" [ngModel]="name()" (ngModelChange)="name.set($event)" aria-label="Name" />
        </mat-form-field>
        <mat-form-field subscriptSizing="dynamic" class="name">
          <mat-label>Arabic name · الاسم بالعربي</mat-label>
          <input matInput maxlength="200" dir="rtl" [ngModel]="nameAr()" (ngModelChange)="nameAr.set($event)" aria-label="Arabic name" />
        </mat-form-field>
        <mat-form-field subscriptSizing="dynamic" class="price">
          <mat-label>Combo price · سعر العرض</mat-label>
          <input matInput type="number" min="0" step="any" [ngModel]="price()" (ngModelChange)="price.set($event)" aria-label="Combo price" />
        </mat-form-field>
        <mat-slide-toggle [checked]="active()" (change)="active.set($event.checked)">On sale · متاح للبيع</mat-slide-toggle>
      </div>
      <p class="muted small">Sold under its code like any menu item: the menu, the sales and the POS read it in the Combos &amp; offers category.</p>

      <div class="table-wrap">
        <table class="grid dishes">
          <thead>
            <tr>
              <th>Dish<span class="ar">الصنف</span></th>
              <th class="num">How many<span class="ar">العدد</span></th>
              <th class="num">Cost a portion<span class="ar">تكلفة الحصة</span></th>
              <th class="num">Line cost<span class="ar">تكلفة السطر</span></th>
              <th class="num">Price apart<span class="ar">السعر منفصلًا</span></th>
              <th><span class="visually-hidden">Remove</span></th>
            </tr>
          </thead>
          <tbody>
            @for (line of lines(); track $index; let i = $index) {
              <tr>
                <td class="dish">
                  <app-item-picker [items]="pickItems()" [value]="line.recipeId" (valueChange)="change(i, { recipeId: $event })"
                    [label]="'Dish, line ' + (i + 1)" placeholder="A recipe · وصفة" />
                </td>
                <td class="num">
                  <mat-form-field subscriptSizing="dynamic" class="qty">
                    <input matInput type="number" min="1" max="99" step="1" [ngModel]="line.quantity" (ngModelChange)="change(i, { quantity: $event })"
                      [attr.aria-label]="'How many, line ' + (i + 1)" />
                  </mat-form-field>
                </td>
                @if (cardOf(line); as c) {
                  <td class="num">{{ c.costPerPortion | money }}</td>
                  <td class="num">{{ c.costPerPortion * (line.quantity ?? 0) | money }}</td>
                  <td class="num">{{ c.menuPrice === null ? '—' : (c.menuPrice * (line.quantity ?? 0) | money) }}</td>
                } @else {
                  <td class="num muted">—</td>
                  <td class="num muted">—</td>
                  <td class="num muted">—</td>
                }
                <td class="num">
                  <button mat-icon-button type="button" (click)="remove(i)" [disabled]="lines().length === 1" [attr.aria-label]="'Remove line ' + (i + 1)">
                    <mat-icon>close</mat-icon>
                  </button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <button mat-button type="button" (click)="add()"><mat-icon>add</mat-icon> Another dish · صنف آخر</button>

      <div class="tiles summary">
        <div class="tile">
          <span class="label">Total combo cost · إجمالي التكلفة <app-info-tip tip="coTotalCost" /></span>
          <strong>{{ totals().cost | money }}</strong>
        </div>
        <div class="tile">
          <span class="label">Original separate price · السعر منفصلًا <app-info-tip tip="coOriginal" /></span>
          <strong>{{ totals().original === null ? '—' : (totals().original! | money) }}</strong>
          @if (totals().savings !== null) {
            <small class="chip">saves {{ totals().savings! | money }}{{ totals().savingsPercent === null ? '' : ' · ' + (totals().savingsPercent! | number: '1.0-1') + '%' }}</small>
          }
        </div>
        <div class="tile key" [class.over]="totals().foodCost !== null && totals().foodCost! > data.foodCostTargetPercent">
          <span class="label">Combo food cost % · نسبة تكلفة العرض <app-info-tip tip="coFoodCost" /></span>
          <strong>{{ totals().foodCost === null ? '—' : (totals().foodCost! | number: '1.1-1') + '%' }}</strong>
          <small class="chip">target {{ data.foodCostTargetPercent | number: '1.0-1' }}%</small>
        </div>
      </div>
      @if (problem(); as p) {
        <p class="error" role="alert">{{ p }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" (click)="ref.close()" [disabled]="saving()">Cancel</button>
      <button mat-flat-button type="button" (click)="save()" [disabled]="saving()"><mat-icon>save</mat-icon> Save · حفظ</button>
    </mat-dialog-actions>
  `,
  styleUrl: './costing.scss',
  styles: `
    .head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 12px;
    }
    .code {
      width: 120px;
    }
    .name {
      flex: 1 1 220px;
    }
    .price {
      width: 170px;
    }
    td.dish {
      min-width: 240px;
    }
    .qty {
      width: 90px;
    }
    .summary {
      margin-top: 12px;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    }
    .chip {
      justify-self: start;
      padding: 0 8px;
      border-radius: 999px;
      font: var(--mat-sys-label-small);
      background: var(--mat-sys-surface-container-high);
    }
    .tile.over {
      border-color: color-mix(in srgb, var(--app-warn) 55%, transparent);
      strong {
        color: var(--app-warn);
      }
    }
    .small {
      font-size: 0.85em;
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
export class ComboDialog {
  protected readonly data = inject<ComboDialogData>(MAT_DIALOG_DATA);
  protected readonly ref = inject(MatDialogRef<ComboDialog, boolean>);
  private readonly api = inject(CostingApi);
  private readonly company = inject(Company);
  private readonly notify = inject(NotifyService);

  protected readonly code = signal<number | null>(this.data.combo?.code ?? this.data.nextCode);
  protected readonly name = signal(this.data.combo?.name ?? '');
  protected readonly nameAr = signal(this.data.combo?.nameAr ?? '');
  protected readonly price = signal<number | null>(this.data.combo?.sellingPrice ?? null);
  protected readonly active = signal(this.data.combo?.isActive ?? true);
  protected readonly lines = signal<Line[]>(
    this.data.combo?.items.map((i) => ({ recipeId: i.recipeId, quantity: i.quantity })) ?? [{ recipeId: null, quantity: 1 }, { recipeId: null, quantity: 1 }],
  );
  protected readonly saving = signal(false);
  protected readonly problem = signal<string | null>(null);

  private readonly byId = computed(() => new Map(this.data.recipes.filter((r) => r.recipeId).map((r) => [r.recipeId!, r])));
  protected readonly pickItems = computed<PickItem[]>(() =>
    this.data.recipes
      .filter((r) => r.recipeId && !r.isDeleted)
      .map((r) => ({
        id: r.recipeId!, name: r.recipe, code: r.itemCode || null, kind: 'menu' as const, unit: 'portion', detail: r.category,
        cost: `${this.company.money(r.costPerPortion)} a portion`,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );

  // Worked out as the screen is filled in, as the server will: Σ cost × quantity, Σ price × quantity.
  protected readonly totals = computed(() => {
    const chosen = this.lines()
      .map((l) => ({ card: l.recipeId ? this.byId().get(l.recipeId) : undefined, quantity: Number(l.quantity) || 0 }))
      .filter((l) => l.card && l.quantity > 0);
    const cost = round(chosen.reduce((sum, l) => sum + l.card!.costPerPortion * l.quantity, 0));
    const original = chosen.length > 0 && chosen.every((l) => l.card!.menuPrice !== null)
      ? round(chosen.reduce((sum, l) => sum + l.card!.menuPrice! * l.quantity, 0))
      : null;
    const price = Number(this.price()) || 0;
    const savings = original !== null && price > 0 ? round(original - price) : null;
    return {
      cost,
      original,
      savings,
      savingsPercent: savings !== null && original! > 0 ? (savings / original!) * 100 : null,
      foodCost: price > 0 && chosen.length > 0 ? Math.round((cost / price) * 1000) / 10 : null,
    };
  });

  protected cardOf(line: Line): RecipeCostCard | null {
    return (line.recipeId && this.byId().get(line.recipeId)) || null;
  }

  protected change(index: number, patch: Partial<Line>): void {
    this.lines.update((lines) => lines.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  protected add(): void {
    this.lines.update((lines) => [...lines, { recipeId: null, quantity: 1 }]);
  }

  protected remove(index: number): void {
    this.lines.update((lines) => lines.filter((_, i) => i !== index));
  }

  protected async save(): Promise<void> {
    const items = this.lines().filter((l) => l.recipeId).map((l) => ({ recipeId: l.recipeId!, quantity: Number(l.quantity) }));
    const code = Number(this.code());
    const price = Number(this.price());
    if (!this.name().trim()) {
      this.problem.set('Name the combo. · اكتب اسم العرض.');
      return;
    }
    if (!Number.isInteger(code) || code < 1) {
      this.problem.set('The code is a menu number, 1 or more. · الكود رقم 1 أو أكثر.');
      return;
    }
    if (!(price > 0)) {
      this.problem.set('Set the combo\'s price. · حدد سعر العرض.');
      return;
    }
    if (items.length === 0 || items.some((i) => !Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > 99)) {
      this.problem.set('Choose each dish and how many of it, 1 to 99. · اختر الأصناف وعددها.');
      return;
    }
    this.saving.set(true);
    this.problem.set(null);
    try {
      await firstValueFrom(
        this.api.saveCombo(this.data.combo?.id ?? crypto.randomUUID(), {
          code, name: this.name().trim(), nameAr: this.nameAr().trim() || null, sellingPrice: price, isActive: this.active(), items,
        }),
      );
      this.notify.info(`${this.name().trim()} saved. · تم حفظ العرض.`);
      this.ref.close(true);
    } catch (error) {
      this.problem.set(errorMessage(error, 'The combo could not be saved.'));
    } finally {
      this.saving.set(false);
    }
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function showComboDialog(dialog: MatDialog, data: ComboDialogData): Promise<boolean | undefined> {
  return firstValueFrom(
    dialog.open<ComboDialog, ComboDialogData, boolean>(ComboDialog, { data, width: '980px', maxWidth: '96vw', autoFocus: 'dialog' }).afterClosed(),
  );
}
