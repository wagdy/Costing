import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MaterialCost, PurchaseOrder, PurchaseOrderInput, PurchaseOrderTerms, Supplier } from '../../core/costing/costing.api';
import { Company } from '../../core/settings/company';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { GridKeys } from '../shared/grid-keys';
import { InfoTip } from './info-tip';
import { MaterialPicker } from './material-picker';
import { dayAfter } from './purchase-orders';

// A purchase order written or rewritten as a draft (أمر شراء): the supplier, when it is ordered and
// expected, cash or credit, and each item in its purchase unit at the price expected, the latest net
// price paid to begin with. Keyboard first: Enter moves along a line and, on the last, adds one.

export interface PurchaseOrderDialogData {
  order: PurchaseOrder | null;
  canApprove: boolean;
  today: string;
  suppliers: Supplier[];
  materials: MaterialCost[];
}

export interface PurchaseOrderDialogResult {
  input: PurchaseOrderInput;
  // Approved (a manager's) or sent for approval, besides saved.
  approve: boolean;
  reason: string | null;
}

interface DraftLine {
  rawMaterialId: string | null;
  quantity: number | null;
  expectedUnitCost: number | null;
  lineNotes: string;
}

const round = (n: number) => Math.round(n * 100) / 100;

@Component({
  selector: 'app-purchase-order-dialog',
  imports: [
    FormsModule, GridKeys, InfoTip, MatButtonModule, MatButtonToggleModule, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule,
    MatSelectModule, MaterialPicker, MoneyPipe,
  ],
  template: `
    <h2 mat-dialog-title>
      {{ data.order ? data.order.poNumber + ' · draft' : 'New purchase order' }} <span class="ar">{{ data.order ? 'تعديل أمر شراء' : 'أمر شراء جديد' }}</span>
    </h2>
    <mat-dialog-content>
      <div class="head">
        <mat-form-field class="supplier">
          <mat-label>Supplier · المورد</mat-label>
          <mat-select [(ngModel)]="supplierId" (ngModelChange)="supplierChosen()" aria-label="Supplier">
            @for (s of suppliers; track s.id) {
              <mat-option [value]="s.id">{{ s.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Order date · تاريخ الطلب</mat-label>
          <input matInput type="date" [(ngModel)]="orderDate" aria-label="Order date" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Expected delivery · تاريخ التوريد</mat-label>
          <input matInput type="date" [(ngModel)]="expected" [min]="orderDate" aria-label="Expected delivery" />
        </mat-form-field>
        <mat-button-toggle-group [(ngModel)]="terms" aria-label="Paid" hideSingleSelectionIndicator>
          <mat-button-toggle value="Cash">Cash · نقدي</mat-button-toggle>
          <mat-button-toggle value="Credit">On credit · آجل</mat-button-toggle>
        </mat-button-toggle-group>
      </div>
      <div class="table-wrap">
        <table class="grid lines" appGridKeys (appGridKeysAppend)="add()">
          <thead>
            <tr>
              <th>Item<span class="ar">الصنف</span></th>
              <th class="num">Quantity<span class="ar">الكمية</span></th>
              <th>Unit<span class="ar">الوحدة</span></th>
              <th class="num">Expected price <app-info-tip tip="poExpectedPrice" /><span class="ar">السعر المتوقع</span></th>
              <th class="num">Line total<span class="ar">الإجمالي</span></th>
              <th>Notes<span class="ar">ملاحظات</span></th>
              <th><span class="visually-hidden">Remove</span></th>
            </tr>
          </thead>
          <tbody>
            @for (line of lines(); track $index; let i = $index) {
              <tr>
                <td class="item">
                  <app-material-picker [materials]="materials" [value]="line.rawMaterialId" (valueChange)="choose(i, $event)" [label]="'Item ' + (i + 1)" />
                </td>
                <td class="num">
                  <input class="cell" type="number" min="0" step="any" [(ngModel)]="line.quantity" (ngModelChange)="touch()" [attr.aria-label]="'Quantity, line ' + (i + 1)" />
                </td>
                <td class="unit">{{ unitOf(line) }}</td>
                <td class="num">
                  <input class="cell" type="number" min="0" step="any" [(ngModel)]="line.expectedUnitCost" (ngModelChange)="touch()"
                    [attr.aria-label]="'Expected price, line ' + (i + 1)" />
                </td>
                <td class="num">{{ lineTotal(line) | money }}</td>
                <td><input class="cell notes" [(ngModel)]="line.lineNotes" maxlength="200" [attr.aria-label]="'Notes, line ' + (i + 1)" /></td>
                <td>
                  <button mat-icon-button type="button" (click)="remove(i)" [disabled]="lines().length === 1" [attr.aria-label]="'Remove line ' + (i + 1)">
                    <mat-icon>close</mat-icon>
                  </button>
                </td>
              </tr>
            }
          </tbody>
          <tfoot>
            <tr>
              <td colspan="4">
                <button mat-button type="button" (click)="add()"><mat-icon>add</mat-icon> Add a line · إضافة صنف</button>
              </td>
              <td class="num"><strong>{{ total() | money }}</strong></td>
              <td colspan="2"></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <mat-form-field class="full" subscriptSizing="dynamic">
        <mat-label>Notes for the supplier · ملاحظات للمورد</mat-label>
        <input matInput [(ngModel)]="notes" maxlength="500" aria-label="Notes" placeholder="Deliver before 10 am" />
      </mat-form-field>
      @if (!data.canApprove) {
        <mat-form-field class="full" subscriptSizing="dynamic">
          <mat-label>Reason · السبب</mat-label>
          <input matInput [(ngModel)]="reason" maxlength="500" aria-label="Reason" placeholder="Optional: tells the manager why" />
        </mat-form-field>
      }
      @if (problem(); as p) {
        <p class="error" role="alert">{{ p }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-stroked-button (click)="done(false)">Save draft · حفظ كمسودة</button>
      <button mat-flat-button (click)="done(true)">
        <mat-icon>{{ data.canApprove ? 'verified' : 'send' }}</mat-icon>
        {{ data.canApprove ? 'Save & approve · حفظ واعتماد' : 'Save & send for approval · إرسال للموافقة' }}
      </button>
    </mat-dialog-actions>
  `,
  styleUrl: './costing.scss',
  styles: `
    .head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px 12px;
      margin-bottom: 8px;
    }
    .supplier {
      min-width: 240px;
      flex: 1;
    }
    .item {
      min-width: 240px;
    }
    .cell {
      width: 96px;
      padding: 6px 8px;
      border: 1px solid var(--app-line-strong);
      border-radius: 8px;
      font: inherit;
      text-align: end;
      background: var(--mat-sys-surface-container-lowest);
      color: inherit;
    }
    .cell.notes {
      width: 140px;
      text-align: start;
    }
    .unit {
      white-space: nowrap;
      color: var(--mat-sys-on-surface-variant);
    }
    .full {
      width: 100%;
      margin-top: 8px;
    }
    .ar {
      direction: rtl;
      unicode-bidi: isolate;
      margin-inline-start: 6px;
      opacity: 0.75;
      font-size: 0.8em;
    }
    .error {
      color: var(--mat-sys-error);
      white-space: pre-line;
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
export class PurchaseOrderDialog {
  protected readonly company = inject(Company);
  protected readonly data = inject<PurchaseOrderDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<PurchaseOrderDialog, PurchaseOrderDialogResult>>(MatDialogRef);

  private readonly order = this.data.order;
  // Archived ones are not offered, unless the draft already has it.
  protected readonly suppliers = this.data.suppliers.filter((s) => !s.isArchived || s.id === this.order?.supplierId);
  protected readonly materials = this.data.materials.filter((m) => m.kind !== 'Prep');
  protected supplierId: string | null = this.order?.supplierId ?? null;
  protected orderDate = this.order?.orderDate ?? this.data.today;
  protected expected: string = this.order?.expectedDeliveryDate ?? dayAfter(this.data.today);
  protected terms: PurchaseOrderTerms = this.order?.paymentTerms ?? 'Cash';
  protected notes = this.order?.notes ?? '';
  protected reason = '';
  protected readonly lines = signal<DraftLine[]>(
    this.order?.lines.map((l) => ({ rawMaterialId: l.rawMaterialId, quantity: l.orderedPurchaseQty, expectedUnitCost: l.expectedUnitCost, lineNotes: l.lineNotes ?? '' }))
      ?? [{ rawMaterialId: null, quantity: null, expectedUnitCost: null, lineNotes: '' }],
  );
  private readonly version = signal(0);
  private readonly tried = signal(false);

  protected readonly total = computed(() => {
    this.version();
    return round(this.lines().reduce((sum, l) => sum + this.lineTotal(l), 0));
  });

  protected readonly problem = computed(() => {
    this.version();
    return this.tried() ? this.problems()[0] ?? null : null;
  });

  protected touch(): void {
    this.version.update((v) => v + 1);
  }

  // A supplier's terms: on credit when it gives days to pay.
  protected supplierChosen(): void {
    const supplier = this.suppliers.find((s) => s.id === this.supplierId);
    if (supplier && !this.order) {
      this.terms = (supplier.paymentTermsDays ?? 0) > 0 ? 'Credit' : 'Cash';
    }
    this.touch();
  }

  protected add(): void {
    this.lines.update((lines) => [...lines, { rawMaterialId: null, quantity: null, expectedUnitCost: null, lineNotes: '' }]);
  }

  protected remove(index: number): void {
    this.lines.update((lines) => lines.filter((_, i) => i !== index));
  }

  // The item chosen: priced at the latest net price paid for it, or its average.
  protected choose(index: number, id: string | null): void {
    const line = this.lines()[index];
    line.rawMaterialId = id;
    const material = this.materials.find((m) => m.id === id);
    if (material && line.expectedUnitCost === null) {
      line.expectedUnitCost = round(material.lastPurchaseCostPerPurchaseUnit ?? material.costPerPurchaseUnit ?? 0);
    }
    this.touch();
  }

  protected unitOf(line: DraftLine): string {
    return this.materials.find((m) => m.id === line.rawMaterialId)?.purchaseUnit ?? '—';
  }

  protected lineTotal(line: DraftLine): number {
    return round((line.quantity ?? 0) * (line.expectedUnitCost ?? 0));
  }

  private problems(): string[] {
    const found: string[] = [];
    if (!this.supplierId) {
      found.push('Choose the supplier. · اختر المورد.');
    }
    if (!this.orderDate) {
      found.push('Choose the order date. · تاريخ الطلب.');
    } else if (this.expected && this.expected < this.orderDate) {
      found.push('It is expected on the day it is ordered or after. · تاريخ التوريد بعد تاريخ الطلب.');
    }
    const lines = this.lines();
    lines.forEach((l, i) => {
      if (!l.rawMaterialId) {
        found.push(`Line ${i + 1}: choose the item. · اختر الصنف.`);
      } else if (lines.findIndex((o) => o.rawMaterialId === l.rawMaterialId) < i) {
        found.push(`Line ${i + 1}: it is on the order twice, put it on one line. · الصنف مكرر.`);
      }
      if (!((l.quantity ?? 0) > 0)) {
        found.push(`Line ${i + 1}: enter the quantity. · أدخل الكمية.`);
      }
      if ((l.expectedUnitCost ?? 0) < 0) {
        found.push(`Line ${i + 1}: the price is zero or more. · السعر صفر أو أكثر.`);
      }
    });
    return found;
  }

  protected done(approve: boolean): void {
    this.tried.set(true);
    this.touch();
    if (this.problems().length) {
      return;
    }
    this.ref.close({
      input: {
        supplierId: this.supplierId!,
        orderDate: this.orderDate,
        expectedDeliveryDate: this.expected || null,
        paymentTerms: this.terms,
        notes: this.notes.trim() || null,
        lines: this.lines().map((l) => ({
          rawMaterialId: l.rawMaterialId!, orderedPurchaseQty: l.quantity!, expectedUnitCost: l.expectedUnitCost ?? 0, lineNotes: l.lineNotes.trim() || null,
        })),
      },
      approve,
      reason: this.reason.trim() || null,
    });
  }
}
