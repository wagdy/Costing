import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { Permissions } from '../../core/auth/permissions';
import {
  CostingApi,
  MaterialCost,
  RecipeCostCard,
  StaffMealEntry,
  StaffMealKind,
  StaffMealReport,
  countUnit,
  staffMealKindLabels,
} from '../../core/costing/costing.api';
import { errorMessage } from '../../core/http/error-message';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { NotifyService } from '../../core/ui/notify.service';
import { ItemPicker, PickItem } from '../shared/item-picker';
import { Approvals } from './approvals';
import { InfoTip } from './info-tip';
import { MaterialPicker } from './material-picker';
import { PeriodBar, periodDays } from './period-bar';

// A line being written: a dish (its recipe, in plates) or a material (in the unit it is counted in).
interface Line {
  by: 'dish' | 'material';
  recipeId: string | null;
  rawMaterialId: string | null;
  quantity: number | null;
}

const kinds: StaffMealKind[] = ['StaffMeal', 'Hospitality', 'RecipeTasting'];

// Staff meals & hospitality (وجبات العاملين والضيافة): what is taken from stock on purpose, logged by
// dish (its recipe's ingredients come off as a sale's do) or by material, apart from spoilage, so the
// kitchen is never charged with them as loss. Each day's staff meals are set against the daily
// budget in Cost settings, and flagged over it. An entry is voided as a waste entry is.
@Component({
  selector: 'app-staff-meals-page',
  imports: [
    DatePipe,
    FormsModule,
    InfoTip,
    ItemPicker,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MaterialPicker,
    MoneyPipe,
    PeriodBar,
  ],
  template: `
    @if (canRecord()) {
      <section class="record" aria-label="Log staff meals and hospitality">
        <h2>Log what was taken · تسجيل <span class="inline-ar">وجبات العاملين والضيافة</span></h2>
        <mat-button-toggle-group [value]="kind()" (change)="kind.set($event.value)" aria-label="What it was">
          @for (k of kinds; track k) {
            <mat-button-toggle [value]="k"><mat-icon aria-hidden="true">{{ labels[k].icon }}</mat-icon> {{ labels[k].en }} <span class="ar">{{ labels[k].ar }}</span></mat-button-toggle>
          }
        </mat-button-toggle-group>
        <div class="lines">
          @for (line of lines(); track $index; let i = $index) {
            <div class="line">
              <mat-button-toggle-group [value]="line.by" (change)="change(i, { by: $event.value, recipeId: null, rawMaterialId: null })" class="by"
                [attr.aria-label]="'By dish or material, line ' + (i + 1)">
                <mat-button-toggle value="dish">Dish · طبق</mat-button-toggle>
                <mat-button-toggle value="material">Material · خامة</mat-button-toggle>
              </mat-button-toggle-group>
              @if (line.by === 'dish') {
                <app-item-picker class="item" [items]="dishes()" [value]="line.recipeId" (valueChange)="change(i, { recipeId: $event })"
                  [label]="'Dish, line ' + (i + 1)" placeholder="A dish or recipe · طبق أو وصفة" />
              } @else {
                <app-material-picker class="item" [materials]="materials()" [value]="line.rawMaterialId"
                  (valueChange)="change(i, { rawMaterialId: $event })" [label]="'Material, line ' + (i + 1)" />
              }
              <mat-form-field subscriptSizing="dynamic" class="qty">
                <input matInput type="number" min="0" [step]="line.by === 'dish' ? 1 : 'any'" [ngModel]="line.quantity"
                  (ngModelChange)="change(i, { quantity: $event })" [attr.aria-label]="'Quantity, line ' + (i + 1)" />
                <span matTextSuffix>&nbsp;{{ unitOf(line) }}</span>
              </mat-form-field>
              <button mat-icon-button (click)="remove(i)" [disabled]="lines().length === 1" [attr.aria-label]="'Remove line ' + (i + 1)"><mat-icon>close</mat-icon></button>
            </div>
          }
        </div>
        <div class="toolbar">
          <button mat-button (click)="add()"><mat-icon>add</mat-icon> Another item · صنف آخر</button>
          <mat-form-field subscriptSizing="dynamic" class="note">
            <mat-label>Note · ملاحظة</mat-label>
            <input matInput maxlength="120" [ngModel]="note()" (ngModelChange)="note.set($event)" aria-label="Note" placeholder="Lunch, the owner's guests…" />
          </mat-form-field>
          <span class="spacer"></span>
          <button mat-flat-button (click)="record()" [disabled]="!valid() || saving()"><mat-icon>save</mat-icon> Log {{ labels[kind()].en.toLowerCase() }}</button>
        </div>
      </section>
    }

    <div class="toolbar">
      <app-period-bar [(from)]="from" [(to)]="to" />
    </div>
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    @if (error()) {
      <p class="error">{{ error() }}</p>
    } @else if (report(); as r) {
      <div class="tiles">
        <div class="tile key">
          <span class="label">Staff meals · وجبات العاملين <app-info-tip tip="smStaff" /></span>
          <strong>{{ r.staffMeals | money }}</strong>
          <small class="chip">{{ r.dailyBudget === null ? 'No daily budget set' : (r.dailyBudget | money) + ' a day budget' }}</small>
        </div>
        <div class="tile">
          <span class="label">Hospitality · ضيافة وإكراميات <app-info-tip tip="smHospitality" /></span>
          <strong>{{ r.hospitality | money }}</strong>
        </div>
        <div class="tile">
          <span class="label">Recipe tastings · تجارب الوصفات</span>
          <strong>{{ r.recipeTasting | money }}</strong>
        </div>
        <div class="tile" [class.over]="r.daysOverBudget > 0">
          <span class="label">Days over budget · أيام تجاوزت الحد</span>
          <strong>{{ r.daysOverBudget }}</strong>
        </div>
      </div>

      <h3>By day <span class="inline-ar">حسب اليوم</span></h3>
      <div class="table-wrap">
        <table class="grid days">
          <thead>
            <tr>
              <th>Day<span class="ar">اليوم</span></th>
              <th class="num">Staff meals<span class="ar">وجبات العاملين</span></th>
              <th class="num">Hospitality<span class="ar">ضيافة</span></th>
              <th class="num">Tastings<span class="ar">تجارب</span></th>
              <th>Budget<span class="ar">الحد اليومي</span></th>
            </tr>
          </thead>
          <tbody>
            @for (d of r.days; track d.date) {
              <tr>
                <td class="nowrap">{{ d.date | date: 'EEE d MMM' }}</td>
                <td class="num strong">{{ d.staffMeals | money }}</td>
                <td class="num">{{ d.hospitality | money }}</td>
                <td class="num">{{ d.recipeTasting | money }}</td>
                <td>
                  @if (d.overBudget) {
                    <span class="over-badge"><mat-icon aria-hidden="true">warning</mat-icon> Over budget · تجاوز الحد (+{{ d.staffMeals - (r.dailyBudget ?? 0) | money }})</span>
                  } @else if (r.dailyBudget !== null) {
                    <span class="muted small">Within · ضمن الحد</span>
                  }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="5" class="muted">Nothing logged in these days.</td></tr>
            }
          </tbody>
        </table>
      </div>

      <h3>Entries <span class="inline-ar">السجلات</span></h3>
      <div class="table-wrap">
        <table class="grid entries">
          <thead>
            <tr>
              <th>When<span class="ar">الوقت</span></th>
              <th>What<span class="ar">النوع</span></th>
              <th>Items<span class="ar">الأصناف</span></th>
              <th class="num">Cost<span class="ar">التكلفة</span></th>
              <th>By<span class="ar">بواسطة</span></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (e of r.entries; track e.entryId) {
              <tr [class.highlight]="e.entryId === entry()">
                <td class="nowrap">{{ e.recordedAtUtc | date: 'd MMM, HH:mm' }}</td>
                <td><span class="kind-tag" [class]="e.kind"><mat-icon aria-hidden="true">{{ labels[e.kind].icon }}</mat-icon> {{ labels[e.kind].en }}</span></td>
                <td>
                  @if (e.note) {
                    <strong>{{ e.note }}</strong>
                  }
                  <div class="muted small">{{ itemsOf(e) }}</div>
                </td>
                <td class="num strong">{{ e.value | money }}</td>
                <td>{{ e.recordedBy ?? '—' }}</td>
                <td class="num">
                  @if (approvals.pendingFor(e.entryId)) {
                    <span class="muted small">Void asked · بانتظار الإلغاء</span>
                  } @else if (canRecord()) {
                    <button mat-icon-button (click)="voidEntry(e)" [attr.aria-label]="'Void the entry of ' + (e.recordedAtUtc | date: 'd MMM, HH:mm')"><mat-icon>undo</mat-icon></button>
                  }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="6" class="muted">Nothing logged in these days.</td></tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .record {
      margin: 0 0 18px;
      padding: 14px 16px;
      border-radius: 16px;
      border: 1px solid var(--app-line);
      background: var(--mat-sys-surface-container-lowest);

      h2 {
        margin: 0 0 10px;
        font: var(--mat-sys-title-small);
      }
      mat-button-toggle-group {
        flex-wrap: wrap;
      }
    }
    .lines {
      display: grid;
      gap: 8px;
      margin: 12px 0;
    }
    .line {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;

      .item {
        flex: 1 1 260px;
      }
      .qty {
        width: 140px;
      }
    }
    .note {
      width: 260px;
    }
    .tile.over {
      border-color: color-mix(in srgb, var(--app-warn) 50%, transparent);
      strong {
        color: var(--app-warn);
      }
    }
    .chip {
      justify-self: start;
      padding: 0 8px;
      border-radius: 999px;
      font: var(--mat-sys-label-small);
      background: var(--mat-sys-surface-container-high);
    }
    .over-badge,
    .kind-tag {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 0 8px;
      border-radius: 999px;
      font: var(--mat-sys-label-small);
      line-height: 22px;
      white-space: nowrap;

      mat-icon {
        width: 14px;
        height: 14px;
        font-size: 14px;
      }
    }
    .over-badge {
      background: color-mix(in srgb, var(--app-warn) 16%, transparent);
      color: var(--app-warn);
    }
    .kind-tag {
      background: var(--mat-sys-surface-container-high);
    }
    tr.highlight td {
      background: color-mix(in srgb, var(--mat-sys-primary) 8%, transparent);
    }
    h3 {
      margin: 18px 0 8px;
      font: var(--mat-sys-title-small);
    }
    .small {
      font-size: 0.85em;
    }
    @media (max-width: 600px) {
      .note,
      .line .qty {
        width: 100%;
      }
    }
  `,
})
export class StaffMealsPage {
  private readonly api = inject(CostingApi);
  private readonly notify = inject(NotifyService);
  private readonly auth = inject(AuthService);
  protected readonly approvals = inject(Approvals);
  protected readonly labels = staffMealKindLabels;
  protected readonly kinds = kinds;
  // ?entry= from a stock card: the entry it opened, marked.
  readonly entry = input<string>();

  protected readonly canRecord = computed(() => this.auth.can(Permissions.InventoryManage));
  protected readonly from = signal(periodDays('month').from);
  protected readonly to = signal(periodDays('month').to);
  protected readonly report = signal<StaffMealReport | null>(null);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly kind = signal<StaffMealKind>('StaffMeal');
  protected readonly note = signal('');
  protected readonly lines = signal<Line[]>([this.blank()]);
  protected readonly materials = signal<MaterialCost[]>([]);
  private readonly recipes = signal<RecipeCostCard[]>([]);
  private entryId = crypto.randomUUID();

  // Each recipe, by its name and the menu item it sells as.
  protected readonly dishes = computed<PickItem[]>(() =>
    this.recipes()
      .filter((r) => r.recipeId && !r.isDeleted)
      .map((r) => ({ id: r.recipeId!, name: r.recipe, code: r.itemCode || null, kind: 'menu' as const, unit: 'plate', detail: r.category }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );

  protected readonly valid = computed(() =>
    this.lines().every(
      (l) =>
        (l.by === 'dish' ? !!l.recipeId : !!l.rawMaterialId) &&
        (l.quantity ?? 0) > 0 &&
        (l.by === 'material' || Number.isInteger(Number(l.quantity))),
    ),
  );

  constructor() {
    effect(() => {
      const [from, to] = [this.from(), this.to()];
      untracked(() => void this.load(from, to));
    });
    void this.loadPickers();
  }

  protected unitOf(line: Line): string {
    if (line.by === 'dish') {
      return 'plates';
    }
    const material = this.materials().find((m) => m.id === line.rawMaterialId);
    return material ? countUnit(material.unit, material.purchaseUnitSize).label : '';
  }

  protected change(i: number, patch: Partial<Line>): void {
    this.lines.update((all) => all.map((l, at) => (at === i ? { ...l, ...patch } : l)));
  }

  protected add(): void {
    this.lines.update((all) => [...all, this.blank()]);
  }

  protected remove(i: number): void {
    this.lines.update((all) => all.filter((_, at) => at !== i));
  }

  protected itemsOf(entry: StaffMealEntry): string {
    return entry.lines.map((l) => `${l.material} ${l.quantity} ${l.purchaseUnit}`).join(', ');
  }

  protected async record(): Promise<void> {
    if (!this.valid()) {
      return;
    }
    this.saving.set(true);
    try {
      const materials = this.materials();
      await firstValueFrom(
        this.api.recordStaffMeal({
          entryId: this.entryId,
          kind: this.kind(),
          note: this.note().trim() || null,
          lines: this.lines().map((l) => {
            if (l.by === 'dish') {
              return { rawMaterialId: null, recipeId: l.recipeId, quantity: Number(l.quantity) };
            }
            const material = materials.find((m) => m.id === l.rawMaterialId)!;
            return { rawMaterialId: l.rawMaterialId, recipeId: null, quantity: Number(l.quantity) * countUnit(material.unit, material.purchaseUnitSize).size };
          }),
        }),
      );
      this.notify.info(`${this.labels[this.kind()].en} logged. · تم التسجيل.`);
      this.entryId = crypto.randomUUID();
      this.lines.set([this.blank()]);
      this.note.set('');
      await this.load(this.from(), this.to());
    } catch (error) {
      this.notify.error(error, 'It could not be logged.');
    } finally {
      this.saving.set(false);
    }
  }

  // Voided for a manager (its stock goes back); asked of one for anyone else.
  protected async voidEntry(entry: StaffMealEntry): Promise<void> {
    const what = `the ${this.labels[entry.kind].en.toLowerCase()} of ${new Date(entry.recordedAtUtc).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
    if ((await this.approvals.delete('Waste', entry.entryId, what)) === 'Applied') {
      await this.load(this.from(), this.to());
    }
  }

  private blank(): Line {
    return { by: 'dish', recipeId: null, rawMaterialId: null, quantity: 1 };
  }

  private async loadPickers(): Promise<void> {
    try {
      const [materials, recipes] = await Promise.all([firstValueFrom(this.api.materials()), firstValueFrom(this.api.recipes())]);
      this.materials.set(materials.filter((m) => !m.misplaced));
      this.recipes.set(recipes);
    } catch {
      // The report stands without the pickers; logging waits for them.
    }
  }

  private async load(from: string, to: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    void this.approvals.refresh();
    try {
      this.report.set(await firstValueFrom(this.api.staffMeals(from, to)));
    } catch (error) {
      this.error.set(errorMessage(error, 'The staff meals could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }
}
