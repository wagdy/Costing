import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';
import {
  ConsumableDetail,
  ConsumableItem,
  ConsumableMovement,
  ConsumableMovementType,
  CustodyApi,
  movementLabels,
} from '../../core/custody/custody.api';
import { errorMessage } from '../../core/http/error-message';
import { MoneyPipe } from '../../core/ui/money.pipe';

// The units offered as an item's is typed: any other may be typed.
const units = ['piece', 'pack', 'box', 'carton', 'roll', 'bottle', 'kg', 'litre'];

export interface ConsumableDialogData {
  // The one changed; none for a new one.
  item?: ConsumableItem;
}

// An item added to the inventory, or changed: its name, the unit it is counted in, the level at
// which it is low, and notes. Its stock changes only by movements.
@Component({
  selector: 'app-consumable-dialog',
  imports: [FormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatProgressBarModule],
  template: `
    <h2 mat-dialog-title>
      @if (data.item) {
        Edit {{ data.item.name }} <span class="inline-ar">تعديل الصنف</span>
      } @else {
        Add an item <span class="inline-ar">إضافة صنف</span>
      }
    </h2>
    <mat-dialog-content>
      <div class="form">
        <mat-form-field class="wide">
          <mat-label>Name · الاسم</mat-label>
          <input matInput [(ngModel)]="name" maxlength="150" placeholder="Napkins, detergent, takeaway cups" aria-label="Name" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Counted in · وحدة القياس</mat-label>
          <input matInput [(ngModel)]="unit" maxlength="20" list="consumable-units" aria-label="Counted in" />
          <datalist id="consumable-units">
            @for (u of units; track u) {
              <option [value]="u"></option>
            }
          </datalist>
          <mat-hint>A piece, a box, a kilo</mat-hint>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Low at · حد إعادة الطلب</mat-label>
          <input matInput type="number" min="0" step="any" [(ngModel)]="reorderLevel" aria-label="Low at" />
          <mat-hint>Empty: never marked low</mat-hint>
        </mat-form-field>
        <mat-form-field class="wide">
          <mat-label>Notes · ملاحظات</mat-label>
          <input matInput [(ngModel)]="notes" maxlength="300" aria-label="Notes" />
        </mat-form-field>
      </div>
      @if (saving()) {
        <mat-progress-bar mode="indeterminate" />
      }
      @if (error(); as e) {
        <p class="error" role="alert">{{ e }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button (click)="save()" [disabled]="!name.trim() || !unit.trim() || saving()">Save</button>
    </mat-dialog-actions>
  `,
  styleUrl: '../shared/pages.scss',
  styles: `
    .form {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px 12px;
    }
    .wide {
      grid-column: span 2;
    }
    @media (max-width: 600px) {
      .form {
        grid-template-columns: minmax(0, 1fr);
      }
      .wide {
        grid-column: auto;
      }
    }
  `,
})
export class ConsumableDialog {
  protected readonly data = inject<ConsumableDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<ConsumableDialog, ConsumableItem>>(MatDialogRef);
  private readonly api = inject(CustodyApi);
  protected readonly units = units;
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly id = this.data.item?.id ?? crypto.randomUUID();

  protected name = this.data.item?.name ?? '';
  protected unit = this.data.item?.unit ?? 'piece';
  protected reorderLevel: number | null = this.data.item?.reorderLevel ?? null;
  protected notes = this.data.item?.notes ?? '';

  protected async save(): Promise<void> {
    this.saving.set(true);
    this.error.set(null);
    try {
      const level = this.reorderLevel === null || (this.reorderLevel as unknown) === '' ? null : Number(this.reorderLevel);
      this.ref.close(
        await firstValueFrom(this.api.saveConsumable(this.id, { name: this.name.trim(), unit: this.unit.trim(), reorderLevel: level, notes: this.notes.trim() || null })),
      );
    } catch (error) {
      this.error.set(errorMessage(error, 'The item could not be saved.'));
    } finally {
      this.saving.set(false);
    }
  }
}

export interface MovementDialogData {
  item: ConsumableItem;
  type: ConsumableMovementType;
  today: string;
  // What things cost is not shown here (an employee in the portal): a receipt goes at the average.
  costHidden: boolean;
}

// Stock received (وارد) at what a unit cost, used up (منصرف), or counted (جرد): how much, on which
// day, and the stock it leaves. Its id is made once, so sending it again records it once.
@Component({
  selector: 'app-movement-dialog',
  imports: [DecimalPipe, FormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressBarModule, MoneyPipe],
  template: `
    <h2 mat-dialog-title>{{ titles[data.type].en }} · {{ data.item.name }} <span class="inline-ar">{{ titles[data.type].ar }}</span></h2>
    <mat-dialog-content>
      <p class="stock">
        <mat-icon>inventory</mat-icon>
        <span>{{ data.item.quantity | number: '1.0-3' }} {{ data.item.unit }} in stock now <span class="inline-ar">الرصيد الحالي</span></span>
      </p>
      <div class="form">
        <mat-form-field>
          <mat-label>{{ quantityLabels[data.type] }}</mat-label>
          <input matInput type="number" min="0" step="any" [(ngModel)]="quantity" aria-label="Quantity" />
          <span matTextSuffix>{{ data.item.unit }}</span>
        </mat-form-field>
        @if (data.type === 'Received' && !data.costHidden) {
          <mat-form-field>
            <mat-label>A unit's cost · تكلفة الوحدة</mat-label>
            <input matInput type="number" min="0" step="any" [(ngModel)]="unitCost" aria-label="A unit's cost" />
            <mat-hint>Empty: at the average, {{ data.item.unitCost ?? 0 | money }}</mat-hint>
          </mat-form-field>
        }
        <mat-form-field>
          <mat-label>Day · اليوم</mat-label>
          <input matInput type="date" [(ngModel)]="date" [max]="data.today" aria-label="Day" />
        </mat-form-field>
        <mat-form-field class="wide">
          <mat-label>Notes · ملاحظات</mat-label>
          <input matInput [(ngModel)]="notes" maxlength="300" [placeholder]="notePlaceholders[data.type]" aria-label="Notes" />
        </mat-form-field>
      </div>
      @if (after(); as left) {
        <p class="after" [class.short]="left.value < 0">
          @if (left.value < 0) {
            Only {{ data.item.quantity | number: '1.0-3' }} {{ data.item.unit }} in stock.
          } @else {
            Leaves {{ left.value | number: '1.0-3' }} {{ data.item.unit }}@if (left.difference !== null) { · {{ left.difference > 0 ? '+' : '' }}{{ left.difference | number: '1.0-3' }} on what was recorded}
            <span class="inline-ar">الرصيد بعد الحركة</span>
          }
        </p>
      }
      @if (saving()) {
        <mat-progress-bar mode="indeterminate" />
      }
      @if (error(); as e) {
        <p class="error" role="alert">{{ e }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button (click)="save()" [disabled]="!after() || after()!.value < 0 || saving()">Record</button>
    </mat-dialog-actions>
  `,
  styleUrl: '../shared/pages.scss',
  styles: `
    .stock {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0 0 12px;
      color: var(--mat-sys-on-surface-variant);
    }
    .form {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px 12px;
    }
    .wide {
      grid-column: span 2;
    }
    .after {
      margin: 4px 0 0;
      padding: 10px 12px;
      border-radius: 12px;
      background: var(--tag-info-bg);
      color: var(--tag-info-fg);
      font-weight: 600;

      &.short {
        background: var(--tag-bad-bg);
        color: var(--tag-bad-fg);
      }
    }
    @media (max-width: 600px) {
      .form {
        grid-template-columns: minmax(0, 1fr);
      }
      .wide {
        grid-column: auto;
      }
    }
  `,
})
export class MovementDialog {
  protected readonly data = inject<MovementDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<MovementDialog, ConsumableItem>>(MatDialogRef);
  private readonly api = inject(CustodyApi);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly movementId = crypto.randomUUID();

  protected readonly titles: Record<ConsumableMovementType, { en: string; ar: string }> = {
    Received: { en: 'Stock received', ar: 'إذن وارد' },
    Consumed: { en: 'Used up', ar: 'إذن صرف' },
    Counted: { en: 'Count', ar: 'جرد' },
  };
  protected readonly quantityLabels: Record<ConsumableMovementType, string> = {
    Received: 'How much came in · الكمية الواردة',
    Consumed: 'How much was used · الكمية المنصرفة',
    Counted: 'What was counted · الكمية الفعلية',
  };
  protected readonly notePlaceholders: Record<ConsumableMovementType, string> = {
    Received: 'Supplier, invoice',
    Consumed: 'Where it went: the kitchen, the hall',
    Counted: 'Monthly count',
  };

  protected readonly quantity = signal<number | null>(null);
  protected unitCost: number | null = null;
  protected date = this.data.today;
  protected notes = '';

  // The stock it leaves, and a count's difference; none until a quantity is typed.
  protected readonly after = computed(() => {
    const q = Number(this.quantity());
    if (this.quantity() === null || (this.quantity() as unknown) === '' || !Number.isFinite(q) || q < 0 || (q === 0 && this.data.type !== 'Counted')) {
      return null;
    }
    const now = this.data.item.quantity;
    return this.data.type === 'Received'
      ? { value: now + q, difference: null }
      : this.data.type === 'Consumed'
        ? { value: now - q, difference: null }
        : { value: q, difference: q - now };
  });

  protected async save(): Promise<void> {
    this.saving.set(true);
    this.error.set(null);
    const cost = this.unitCost === null || (this.unitCost as unknown) === '' ? null : Number(this.unitCost);
    try {
      const answer = await firstValueFrom(
        this.api.recordMovement(this.data.item.id, {
          movementId: this.movementId,
          type: this.data.type,
          quantity: Number(this.quantity()),
          unitCost: this.data.type === 'Received' ? cost : null,
          date: this.date,
          notes: this.notes.trim() || null,
        }),
      );
      this.ref.close(answer.item);
    } catch (error) {
      this.error.set(errorMessage(error, 'It could not be recorded.'));
    } finally {
      this.saving.set(false);
    }
  }
}

// An item's movements, the latest first: what came in, went out or was counted, and the stock left.
@Component({
  selector: 'app-consumable-history-dialog',
  imports: [DatePipe, DecimalPipe, MatButtonModule, MatDialogModule, MatIconModule, MatProgressBarModule, MoneyPipe],
  template: `
    <h2 mat-dialog-title>{{ detail()?.item?.name ?? 'Item' }} <span class="inline-ar">حركة الصنف</span></h2>
    <mat-dialog-content>
      @if (error(); as e) {
        <p class="error">{{ e }}</p>
      } @else if (detail(); as d) {
        <p class="muted">{{ d.item.quantity | number: '1.0-3' }} {{ d.item.unit }} in stock@if (d.item.totalCost !== null) { · {{ d.item.totalCost | money }}}</p>
        <div class="table-wrap">
          <table class="grid">
            <thead>
              <tr>
                <th>Date<span class="ar">التاريخ</span></th>
                <th>Movement<span class="ar">الحركة</span></th>
                <th class="num">Quantity<span class="ar">الكمية</span></th>
                @if (d.item.unitCost !== null) {
                  <th class="num">Cost<span class="ar">التكلفة</span></th>
                }
                <th class="num">Left<span class="ar">الرصيد</span></th>
                <th>By<span class="ar">بواسطة</span></th>
              </tr>
            </thead>
            <tbody>
              @for (m of d.movements; track m.id) {
                <tr>
                  <td class="nowrap">{{ m.date | date: 'd MMM y' }}</td>
                  <td>
                    <span class="tag" [class]="tones[m.type]">{{ labels[m.type].en }}<span class="ar">{{ labels[m.type].ar }}</span></span>
                    @if (m.notes) {
                      <div class="muted small">{{ m.notes }}</div>
                    }
                  </td>
                  <td class="num" [class.minus]="sign(m) < 0" [class.plus]="sign(m) > 0">{{ sign(m) > 0 ? '+' : sign(m) < 0 ? '−' : '' }}{{ abs(m.quantity) | number: '1.0-3' }}</td>
                  @if (d.item.unitCost !== null) {
                    <td class="num">
                      {{ m.cost ?? 0 | money }}
                      <div class="muted small">{{ m.unitCost ?? 0 | money }} each</div>
                    </td>
                  }
                  <td class="num">{{ m.stockAfter | number: '1.0-3' }}</td>
                  <td class="muted small">{{ m.recordedBy }}</td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="6" class="empty">
                    <mat-icon>history</mat-icon>
                    <span class="note-ar" lang="ar" dir="rtl">لم تُسجَّل أي حركة لهذا الصنف بعد.</span>
                    Nothing recorded of it yet.
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <mat-progress-bar mode="indeterminate" />
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-flat-button mat-dialog-close>Close</button>
    </mat-dialog-actions>
  `,
  styleUrl: '../shared/pages.scss',
  styles: `
    .small {
      font-size: 0.85em;
    }
    .nowrap {
      white-space: nowrap;
    }
    td.plus {
      color: var(--tag-ok-fg);
    }
    td.minus {
      color: var(--tag-bad-fg);
    }
  `,
})
export class ConsumableHistoryDialog {
  private readonly api = inject(CustodyApi);
  protected readonly labels = movementLabels;
  protected readonly tones: Record<ConsumableMovementType, string> = { Received: 'ok', Consumed: 'info', Counted: 'accent' };
  protected readonly detail = signal<ConsumableDetail | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly abs = Math.abs;

  constructor() {
    const { itemId } = inject<{ itemId: string }>(MAT_DIALOG_DATA);
    firstValueFrom(this.api.consumable(itemId)).then(
      (detail) => this.detail.set(detail),
      (error: unknown) => this.error.set(errorMessage(error, 'Its movements could not be loaded.')),
    );
  }

  // In (+), out (−), or a count's difference either way.
  protected sign(m: ConsumableMovement): number {
    return m.type === 'Consumed' ? -1 : Math.sign(m.quantity);
  }
}
