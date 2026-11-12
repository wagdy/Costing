import { A11yModule } from '@angular/cdk/a11y';
import { CdkConnectedOverlay, CdkOverlayOrigin, ConnectedPosition } from '@angular/cdk/overlay';
import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { firstValueFrom, merge } from 'rxjs';
import { CostingApi, MaterialCost, MaterialUnitChangeInput, MaterialUsage, SaveMaterial, UnitOfMeasure, unitLabels } from '../../core/costing/costing.api';
import { errorMessage } from '../../core/http/error-message';
import { Company } from '../../core/settings/company';
import { Approvals } from './approvals';
import { PurchaseCategoryField } from './purchase-category-field';

// What the dialog closes with: the material, and the unit it is counted in changed, when it was.
// The material's purchase unit, cost and reorder level stay as they were in it then: the unit
// change carries the new ones.
export interface MaterialDialogResult {
  material: SaveMaterial;
  unitChange: MaterialUnitChangeInput | null;
}

const one: Record<UnitOfMeasure, string> = { Gram: 'g', Millilitre: 'ml', Piece: 'piece' };
const many: Record<UnitOfMeasure, string> = { Gram: 'g', Millilitre: 'ml', Piece: 'pieces' };

// A raw material, new or to change. Cost and reorder level are entered per purchase unit (a kg, a
// carton), as they are bought. The unit it is counted in (عدّ بـ) can be changed: while nothing
// records it, it simply starts again in the new unit; once something does (stock, an invoice, a
// recipe, a count, a batch), the conversion is asked, as a kitchen says it ("1 piece is 60 g"), and
// everything recorded is restated by it, on a manager's say. A prep item keeps its unit.
@Component({
  selector: 'app-material-dialog',
  imports: [
    A11yModule,
    CdkConnectedOverlay,
    CdkOverlayOrigin,
    DecimalPipe,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    PurchaseCategoryField,
    ReactiveFormsModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ data ? 'Change ' + data.name : 'New raw material' }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" (ngSubmit)="save()" id="material-form" class="form">
        <mat-form-field class="wide">
          <mat-label>Name · الاسم</mat-label>
          <input matInput formControlName="name" cdkFocusInitial />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Code · الكود</mat-label>
          <input matInput formControlName="code" placeholder="ING-001" />
        </mat-form-field>
        <app-purchase-category-field formControlName="categoryId" kind="RawMaterials" />
        <mat-form-field>
          <mat-label>Counted in · وحدة العد</mat-label>
          <mat-select formControlName="unit" (selectionChange)="unitChanged($event.value)">
            <mat-option value="Gram">Grams (g)</mat-option>
            <mat-option value="Millilitre">Millilitres (ml)</mat-option>
            <mat-option value="Piece">Pieces (pc)</mat-option>
          </mat-select>
          @if (data?.kind === 'Prep') {
            <mat-hint>A prep item keeps its unit</mat-hint>
          } @else if (changingUnit()) {
            <mat-hint>Was {{ many[data!.unit] }}</mat-hint>
          }
        </mat-form-field>
        @if (changingUnit()) {
          <div class="wide unit-change" role="group" aria-label="Changing the unit">
            @if (usageError(); as e) {
              <p class="error">{{ e }}</p>
            } @else if (usage(); as u) {
              @if (u.pendingRequests) {
                <p class="error">A request waiting for a manager names {{ data!.name }}: its unit can be changed once that is decided.</p>
              } @else if (!u.inUse) {
                <p>Nothing records {{ data!.name }} yet: it is counted in {{ many[unit()] }} from now. Enter its price and reorder level for the new unit.</p>
              } @else {
                <p>
                  {{ data!.name }} is already recorded in {{ many[data!.unit] }}: {{ recorded(u) }}. Everything is restated in
                  {{ many[unit()] }} by the conversion, every amount of money as it was.
                </p>
                <mat-form-field class="conversion">
                  <mat-label>1 {{ one[big()] }} is how many {{ many[small()] }}? · التحويل</mat-label>
                  <input matInput type="number" min="0" step="any" formControlName="conversion" />
                  <span matTextSuffix>&nbsp;{{ many[small()] }}</span>
                </mat-form-field>
                @if (oneNewIsOld(); as r) {
                  <p class="restated">
                    On hand {{ data!.quantityOnHand | number: '1.0-3' }} {{ many[data!.unit] }} →
                    {{ data!.quantityOnHand / r | number: '1.0-3' }} {{ many[unit()] }}
                    @if (data!.costPerUnit !== null) {
                      · average cost {{ company.money(data!.costPerUnit, 2, 4) }} a {{ one[data!.unit] }} →
                      {{ company.money(data!.costPerUnit * r, 2, 4) }} a {{ one[unit()] }}
                    }
                  </p>
                } @else {
                  <p class="error">
                    Without the conversion it cannot be changed. If it cannot be said, archive {{ data!.name }} and create a new material
                    counted in {{ many[unit()] }}.
                  </p>
                }
                @if (!approvals.canApprove()) {
                  <mat-form-field class="reason" subscriptSizing="dynamic">
                    <mat-label>Reason · السبب</mat-label>
                    <textarea matInput formControlName="reason" maxlength="500" rows="2" placeholder="Optional: tells the manager why"></textarea>
                  </mat-form-field>
                }
              }
            } @else {
              <p class="muted">Checking what records {{ data!.name }}…</p>
            }
          </div>
        }
        <mat-form-field>
          <mat-label>Bought by · وحدة الشراء</mat-label>
          <input matInput formControlName="purchaseUnit" placeholder="kg, carton" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>{{ unitLabel() }} in one {{ form.value.purchaseUnit || 'unit' }}</mat-label>
          <input matInput type="number" min="0" step="any" formControlName="purchaseUnitSize" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>{{ company.currency() || 'Cost' }} per {{ form.value.purchaseUnit || 'unit' }} (AP$) · تكلفة الشراء</mat-label>
          <input matInput type="number" min="0" step="any" formControlName="cost" />
          <mat-hint>{{ restating() ? 'Restated by the conversion' : data ? 'Replaces the average cost' : 'Priced purchases update it' }}</mat-hint>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Yield % · نسبة الصافي</mat-label>
          <input matInput type="number" min="1" max="100" step="any" formControlName="yield" />
          <button
            mat-icon-button
            matSuffix
            type="button"
            cdkOverlayOrigin
            #yieldOrigin="cdkOverlayOrigin"
            (click)="calculating.set(!calculating())"
            [attr.aria-expanded]="calculating()"
            aria-label="Calculate from weight · احسب من الوزن"
            title="Calculate from weight · احسب من الوزن"
          >
            <mat-icon>calculate</mat-icon>
          </button>
          <mat-hint>{{ epHint() ?? 'Usable after trimming' }}</mat-hint>
        </mat-form-field>
        <ng-template
          cdkConnectedOverlay
          [cdkConnectedOverlayOrigin]="yieldOrigin"
          [cdkConnectedOverlayOpen]="calculating()"
          [cdkConnectedOverlayPositions]="yieldPositions"
          [cdkConnectedOverlayViewportMargin]="12"
          (overlayOutsideClick)="calculating.set(false)"
          (overlayKeydown)="$event.key === 'Escape' && calculating.set(false)"
          (detach)="calculating.set(false)"
        >
          <section class="yield-calc" role="dialog" aria-label="Calculate yield from weight · احسب نسبة الصافي من الوزن" cdkTrapFocus [cdkTrapFocusAutoCapture]="true">
            <h3>Calculate from weight · <span lang="ar">احسب من الوزن</span></h3>
            <p class="muted">Weigh it as bought, then again cleaned and ready to cook, in the same unit. · <span lang="ar">بنفس الوحدة للوزنين.</span></p>
            <mat-form-field subscriptSizing="dynamic">
              <mat-label>Gross weight · الوزن القائم</mat-label>
              <input matInput type="number" min="0" step="any" [value]="gross() ?? ''" (input)="gross.set(number($event))" aria-label="Gross weight, as bought" />
            </mat-form-field>
            <mat-form-field subscriptSizing="dynamic">
              <mat-label>Net usable weight · الوزن الصافي بعد التنظيف</mat-label>
              <input matInput type="number" min="0" step="any" [value]="net() ?? ''" (input)="net.set(number($event))" aria-label="Net usable weight, after cleaning" />
            </mat-form-field>
            @if (calculated(); as c) {
              <dl class="result">
                <div><dt>Yield % · نسبة الصافي</dt><dd>{{ c.yield | number: '1.0-2' }}%</dd></div>
                @if (c.ep !== null) {
                  <div><dt>EP$ / {{ form.value.purchaseUnit || 'unit' }} · تكلفة الصافي</dt><dd>{{ company.money(c.ep, 2, 4) }}</dd></div>
                }
              </dl>
            } @else if (gross() !== null && net() !== null) {
              <p class="error" role="alert">The net weight is more than nothing and at most the gross. · الصافي أكبر من صفر ولا يزيد عن القائم.</p>
            }
            <div class="actions">
              <button mat-button type="button" (click)="calculating.set(false)">Cancel</button>
              <button mat-flat-button type="button" [disabled]="!calculated()" (click)="useYield()">Use this yield · استخدم النسبة</button>
            </div>
          </section>
        </ng-template>
        <mat-form-field>
          <mat-label>Reorder at ({{ form.value.purchaseUnit || 'units' }}) · حد الطلب</mat-label>
          <input matInput type="number" min="0" step="any" formControlName="reorderAt" />
          @if (restating()) {
            <mat-hint>Restated by the conversion</mat-hint>
          }
        </mat-form-field>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button type="submit" form="material-form" [disabled]="form.invalid || blocked()">
        {{ restating() && !approvals.canApprove() ? 'Send for approval' : 'Save' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .form {
      display: grid;
      grid-template-columns: repeat(2, minmax(200px, 1fr));
      gap: 8px 12px;
      padding-top: 4px;
    }
    .wide {
      grid-column: 1 / -1;
    }
    .unit-change {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 8px 12px;
      border-inline-start: 3px solid var(--mat-sys-primary);
      background: var(--mat-sys-surface-container-low);
      border-radius: 4px;
    }
    .unit-change p {
      margin: 0;
    }
    .conversion {
      max-width: 320px;
    }
    .restated {
      font-weight: 500;
    }
    .error {
      color: var(--mat-sys-error);
    }
    .muted {
      color: var(--mat-sys-on-surface-variant);
    }
    .yield-calc {
      display: grid;
      gap: 8px;
      width: min(340px, calc(100vw - 32px));
      padding: 14px 16px;
      border-radius: 14px;
      border: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface-container-lowest);
      box-shadow: 0 8px 28px rgb(15 23 42 / 18%);

      h3 {
        margin: 0;
        font: var(--mat-sys-title-small);
      }
      p {
        margin: 0;
        font: var(--mat-sys-body-small);
      }
      .result {
        display: grid;
        gap: 4px;
        margin: 0;

        div {
          display: flex;
          justify-content: space-between;
          gap: 8px;
        }
        dt {
          color: var(--mat-sys-on-surface-variant);
        }
        dd {
          margin: 0;
          font-weight: 600;
        }
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }
    }
    @media (max-width: 560px) {
      .form {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class MaterialDialog {
  protected readonly company = inject(Company);

  // The yield worked out from two weighings: as bought (gross) and cleaned, ready to use (net).
  protected readonly calculating = signal(false);
  protected readonly gross = signal<number | null>(null);
  protected readonly net = signal<number | null>(null);
  protected readonly yieldPositions: ConnectedPosition[] = [
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 },
  ];
  protected readonly data = inject<MaterialCost | null>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<MaterialDialog, MaterialDialogResult>);
  private readonly api = inject(CostingApi);
  protected readonly approvals = inject(Approvals);
  protected readonly one = one;
  protected readonly many = many;

  private readonly defaults: Record<UnitOfMeasure, [string, number]> = { Gram: ['kg', 1000], Millilitre: ['L', 1000], Piece: ['piece', 1] };

  protected readonly form = new FormGroup({
    name: new FormControl(this.data?.name ?? '', { nonNullable: true, validators: [Validators.required] }),
    code: new FormControl(this.data?.code ?? '', { nonNullable: true }),
    categoryId: new FormControl<string | null>(this.data?.categoryId ?? null),
    unit: new FormControl<UnitOfMeasure>({ value: this.data?.unit ?? 'Gram', disabled: this.data?.kind === 'Prep' }, { nonNullable: true }),
    purchaseUnit: new FormControl(this.data?.purchaseUnit ?? 'kg', { nonNullable: true, validators: [Validators.required] }),
    purchaseUnitSize: new FormControl(this.data?.purchaseUnitSize ?? 1000, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(0.001)],
    }),
    cost: new FormControl<number | null>(this.data?.costPerPurchaseUnit ?? null, { validators: [Validators.min(0)] }),
    yield: new FormControl(this.data?.defaultYieldPercent ?? 100, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(0.01), Validators.max(100)],
    }),
    reorderAt: new FormControl(this.data ? this.data.reorderLevel / this.data.purchaseUnitSize : 0, {
      nonNullable: true,
      validators: [Validators.min(0)],
    }),
    // How many of the smaller unit one of the larger is: asked once something records it.
    conversion: new FormControl<number | null>(null),
    reason: new FormControl('', { nonNullable: true }),
  });

  protected readonly unit = signal<UnitOfMeasure>(this.data?.unit ?? 'Gram');

  private readonly values = toSignal(this.form.valueChanges, { initialValue: this.form.value });
  // Net ÷ gross, and what a usable purchase unit costs at it: AP$ ÷ yield.
  protected readonly calculated = computed(() => {
    const [gross, net] = [this.gross(), this.net()];
    if (gross === null || net === null || !(gross > 0) || !(net > 0) || net > gross) {
      return null;
    }
    const yieldPercent = Math.round((net / gross) * 10000) / 100;
    const cost = this.values().cost;
    return { yield: yieldPercent, ep: cost != null && cost >= 0 ? cost / (yieldPercent / 100) : null };
  });
  // The yield field's hint: the EP$ it gives the AP$ above, once both are there.
  protected readonly epHint = computed(() => {
    const v = this.values();
    if (v.cost == null || v.cost < 0 || !v.yield || v.yield <= 0 || v.yield > 100) {
      return null;
    }
    return `EP$ ${this.company.money(v.cost / (v.yield / 100), 2, 4)} / ${v.purchaseUnit || 'unit'} · تكلفة الصافي`;
  });
  protected readonly changingUnit = computed(() => !!this.data && this.unit() !== this.data.unit);
  protected readonly usage = signal<MaterialUsage | null>(null);
  protected readonly usageError = signal<string | null>(null);
  // Changed with everything recorded restated: the cost and reorder level follow the conversion.
  protected readonly restating = computed(() => this.changingUnit() && !!this.usage()?.inUse);
  // Not to be sent: what records it is not known yet, or a request waiting for a manager names it.
  protected readonly blocked = computed(
    () => this.changingUnit() && (!!this.usageError() || !this.usage() || !!this.usage()!.pendingRequests),
  );

  // The conversion is said of the larger unit: a piece against grams or millilitres, a millilitre
  // against grams.
  protected readonly big = computed<UnitOfMeasure>(() => (this.data?.unit === 'Piece' || this.unit() === 'Piece' ? 'Piece' : 'Millilitre'));
  protected readonly small = computed<UnitOfMeasure>(() => (this.big() === this.unit() ? this.data!.unit : this.unit()));

  constructor() {
    const { conversion, purchaseUnitSize } = this.form.controls;
    merge(conversion.valueChanges, purchaseUnitSize.valueChanges)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.restate());
  }

  protected unitLabel(): string {
    return unitLabels[this.form.getRawValue().unit];
  }

  // How many of the old unit one of the new is, from the conversion as it was said; null until it is.
  protected oneNewIsOld(): number | null {
    const said = this.form.controls.conversion.value;
    if (!said || said <= 0) {
      return null;
    }
    return this.unit() === this.big() ? said : 1 / said;
  }

  protected recorded(usage: MaterialUsage): string {
    const count = (n: number, what: string, plural = what + 's') => (n === 0 ? null : `${n} ${n === 1 ? what : plural}`);
    return [
      count(usage.stockMovements, 'stock movement'),
      count(usage.invoiceLines, 'invoice line'),
      count(usage.recipes, 'recipe'),
      count(usage.prepRecipes, 'prep recipe'),
      count(usage.counts, 'stock count'),
      count(usage.batches, 'batch', 'batches'),
    ]
      .filter((s) => s !== null)
      .join(', ');
  }

  protected async unitChanged(unit: UnitOfMeasure): Promise<void> {
    this.unit.set(unit);
    const [name, size] = this.defaults[unit];
    const d = this.data;
    if (!d) {
      this.form.patchValue({ purchaseUnit: name, purchaseUnitSize: size });
      return;
    }
    if (unit === d.unit) {
      // Back to the unit it has: as it was.
      this.restated(false);
      this.form.patchValue(
        { purchaseUnit: d.purchaseUnit, purchaseUnitSize: d.purchaseUnitSize, cost: d.costPerPurchaseUnit, reorderAt: d.reorderLevel / d.purchaseUnitSize, conversion: null },
        { emitEvent: false },
      );
      return;
    }
    this.form.patchValue({ purchaseUnit: name, purchaseUnitSize: size }, { emitEvent: false });
    const usage = this.usage() ?? (await this.loadUsage(d.id));
    if (!usage || this.unit() !== unit) {
      return;
    }
    this.restated(usage.inUse);
    if (usage.inUse) {
      this.restate();
    } else {
      // Its price and reorder level were in the old unit: given again for the new one.
      this.form.patchValue({ cost: null, reorderAt: 0 });
    }
  }

  protected number(event: Event): number | null {
    const value = (event.target as HTMLInputElement).value;
    return value === '' ? null : Number(value);
  }

  protected useYield(): void {
    const c = this.calculated();
    if (c) {
      this.form.controls.yield.setValue(c.yield);
      this.form.controls.yield.markAsDirty();
      this.calculating.set(false);
    }
  }

  protected save(): void {
    if (this.form.invalid || this.blocked()) {
      return;
    }
    const v = this.form.getRawValue();
    const d = this.data;
    const details = {
      name: v.name.trim(),
      code: v.code.trim() || null,
      categoryId: v.categoryId,
      defaultYieldPercent: v.yield,
    };
    if (d && v.unit !== d.unit) {
      const restating = this.restating();
      this.ref.close({
        // As it is in the unit it has now; the unit change carries the rest.
        material: { ...details, purchaseUnit: d.purchaseUnit, purchaseUnitSize: d.purchaseUnitSize, costPerPurchaseUnit: null, reorderLevel: d.reorderLevel },
        unitChange: {
          requestId: crypto.randomUUID(),
          unit: v.unit,
          oneNewIsOld: restating ? this.oneNewIsOld() : null,
          purchaseUnit: v.purchaseUnit.trim(),
          purchaseUnitSize: v.purchaseUnitSize,
          costPerPurchaseUnit: restating ? null : v.cost,
          reorderLevel: restating ? null : v.reorderAt * v.purchaseUnitSize,
          reason: v.reason.trim() || null,
        },
      });
      return;
    }
    // An unchanged cost is not sent: sending it would reset the average to the rounded figure shown.
    const costChanged = !d || v.cost !== d.costPerPurchaseUnit;
    this.ref.close({
      material: {
        ...details,
        unit: d ? undefined : v.unit,
        purchaseUnit: v.purchaseUnit.trim(),
        purchaseUnitSize: v.purchaseUnitSize,
        costPerPurchaseUnit: costChanged ? v.cost : null,
        reorderLevel: v.reorderAt * v.purchaseUnitSize,
      },
      unitChange: null,
    });
  }

  private async loadUsage(id: string): Promise<MaterialUsage | null> {
    try {
      const usage = await firstValueFrom(this.api.materialUsage(id));
      this.usage.set(usage);
      return usage;
    } catch (error) {
      this.usageError.set(errorMessage(error, 'What records it could not be read, so its unit cannot be changed now.'));
      return null;
    }
  }

  // Restated by the conversion, the cost and reorder level are worked out, not entered; and the
  // conversion is needed.
  private restated(on: boolean): void {
    const { cost, reorderAt, conversion } = this.form.controls;
    if (on) {
      cost.disable({ emitEvent: false });
      reorderAt.disable({ emitEvent: false });
      conversion.setValidators([Validators.required, Validators.min(0.000001)]);
    } else {
      cost.enable({ emitEvent: false });
      reorderAt.enable({ emitEvent: false });
      conversion.clearValidators();
    }
    conversion.updateValueAndValidity({ emitEvent: false });
  }

  // The cost of one new purchase unit and the reorder level in them, as the conversion makes them.
  private restate(): void {
    const d = this.data;
    if (!d || !this.restating()) {
      return;
    }
    const r = this.oneNewIsOld();
    const size = this.form.controls.purchaseUnitSize.value;
    this.form.patchValue(
      {
        cost: r && d.costPerUnit !== null ? Math.round(d.costPerUnit * r * size * 100) / 100 : null,
        reorderAt: r && size ? Math.round((d.reorderLevel / r / size) * 1000) / 1000 : 0,
      },
      { emitEvent: false },
    );
  }
}
