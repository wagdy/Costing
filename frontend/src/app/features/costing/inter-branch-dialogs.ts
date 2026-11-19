import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { firstValueFrom } from 'rxjs';
import { MaterialCost, UnitOfMeasure, countUnit } from '../../core/costing/costing.api';
import { InterBranchApi, InterBranchBranch, Receipt, Requisition, Shipment, TransferPricing } from '../../core/costing/inter-branch.api';
import { LocationStock, StockApi, StockPlaces } from '../../core/costing/stock.api';
import { errorMessage } from '../../core/http/error-message';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { InfoTip } from './info-tip';
import { MaterialPicker } from './material-picker';

// The central kitchen hub's three forms: a branch's requisition, the kitchen's Dispatch & Bill, and
// the branch's receipt of a shipment. Each posts itself, under an id made when it opens, and closes
// with what it made. Quantities are entered as they are counted (kg, L, pieces); prices per that unit.

function unitOf(unit: UnitOfMeasure | string, purchaseUnitSize: number): { label: string; size: number } {
  return countUnit(unit as UnitOfMeasure, purchaseUnitSize);
}

// ---- A branch's requisition (أمر طلب بضاعة من الفرع) ----

export interface RequisitionDialogData {
  // The central kitchens and warehouses it may ask.
  suppliers: InterBranchBranch[];
  materials: MaterialCost[];
}

interface AskedLine {
  rawMaterialId: string | null;
  quantity: number | null;
  notes: string;
}

@Component({
  selector: 'app-requisition-dialog',
  imports: [FormsModule, InfoTip, MatButtonModule, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule, MaterialPicker],
  template: `
    <h2 mat-dialog-title>New requisition <span class="inline-ar">أمر طلب بضاعة</span> <app-info-tip tip="requisition" /></h2>
    <mat-dialog-content>
      <div class="toolbar">
        <mat-form-field subscriptSizing="dynamic" class="wide">
          <mat-label>Ask of · المورد الداخلي</mat-label>
          <mat-select [ngModel]="supplying()" (ngModelChange)="supplying.set($event)" aria-label="Ask of">
            @for (b of data.suppliers; track b.id) {
              <mat-option [value]="b.id">{{ b.name }}@if (b.nameAr) { · {{ b.nameAr }}}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field subscriptSizing="dynamic" class="day">
          <mat-label>Wanted by · مطلوب يوم</mat-label>
          <input matInput type="date" [ngModel]="deliveryBy()" (ngModelChange)="deliveryBy.set($event)" aria-label="Wanted by" />
        </mat-form-field>
      </div>
      <div class="table-wrap">
        <table class="grid" aria-label="Requisition lines">
          <thead>
            <tr>
              <th>Material<span class="ar">الخامة</span></th>
              <th class="num">Quantity<span class="ar">الكمية</span></th>
              <th>Note<span class="ar">ملاحظة</span></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (line of lines(); track $index; let i = $index) {
              <tr>
                <td>
                  <app-material-picker class="material" [materials]="data.materials" [value]="line.rawMaterialId"
                    (valueChange)="change(i, { rawMaterialId: $event })" [label]="'Material, line ' + (i + 1)" />
                </td>
                <td class="num">
                  <mat-form-field subscriptSizing="dynamic" class="small">
                    <input matInput type="number" min="0" step="any" [ngModel]="line.quantity" (ngModelChange)="change(i, { quantity: $event })"
                      [attr.aria-label]="'Quantity, line ' + (i + 1)" />
                    <span matTextSuffix>&nbsp;{{ unitLabel(line.rawMaterialId) }}</span>
                  </mat-form-field>
                </td>
                <td>
                  <mat-form-field subscriptSizing="dynamic" class="note">
                    <input matInput maxlength="200" [ngModel]="line.notes" (ngModelChange)="change(i, { notes: $event })" [attr.aria-label]="'Note, line ' + (i + 1)" />
                  </mat-form-field>
                </td>
                <td><button mat-icon-button (click)="remove(i)" [disabled]="lines().length === 1" aria-label="Remove line"><mat-icon>delete</mat-icon></button></td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <button mat-button (click)="add()"><mat-icon>add</mat-icon> Add line</button>
      <mat-form-field subscriptSizing="dynamic" class="full">
        <mat-label>Notes · ملاحظات</mat-label>
        <input matInput maxlength="500" [ngModel]="notes()" (ngModelChange)="notes.set($event)" aria-label="Notes" />
      </mat-form-field>
      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button (click)="submit()" [disabled]="!ready() || saving()"><mat-icon>send</mat-icon> Send to the kitchen · إرسال</button>
    </mat-dialog-actions>
  `,
  styleUrl: './costing.scss',
  styles: `
    .wide { min-width: 240px; }
    .day { width: 170px; }
    .material { min-width: 220px; width: 100%; }
    .small { width: 140px; }
    .note { min-width: 160px; }
    .full { width: 100%; margin-top: 8px; }
  `,
})
export class RequisitionDialog {
  protected readonly data = inject<RequisitionDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<RequisitionDialog, Requisition>);
  private readonly api = inject(InterBranchApi);
  private readonly id = crypto.randomUUID();

  protected readonly supplying = signal<string | null>(this.data.suppliers[0]?.id ?? null);
  protected readonly deliveryBy = signal('');
  protected readonly notes = signal('');
  protected readonly lines = signal<AskedLine[]>([{ rawMaterialId: null, quantity: null, notes: '' }]);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly ready = computed(() => {
    const lines = this.lines();
    const ids = lines.map((l) => l.rawMaterialId);
    return !!this.supplying() && lines.every((l) => l.rawMaterialId && (l.quantity ?? 0) > 0) && new Set(ids).size === ids.length;
  });

  protected unitLabel(id: string | null): string {
    const m = this.data.materials.find((x) => x.id === id);
    return m ? unitOf(m.unit, m.purchaseUnitSize).label : '';
  }

  protected change(index: number, patch: Partial<AskedLine>): void {
    this.lines.update((lines) => lines.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  protected add(): void {
    this.lines.update((lines) => [...lines, { rawMaterialId: null, quantity: null, notes: '' }]);
  }

  protected remove(index: number): void {
    this.lines.update((lines) => lines.filter((_, i) => i !== index));
  }

  protected async submit(): Promise<void> {
    if (!this.ready()) {
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    try {
      const made = await firstValueFrom(
        this.api.submit({
          id: this.id,
          supplyingBranchId: this.supplying()!,
          requestedDeliveryDate: this.deliveryBy() || null,
          lines: this.lines().map((l) => {
            const m = this.data.materials.find((x) => x.id === l.rawMaterialId)!;
            return { rawMaterialId: m.id, quantity: l.quantity! * unitOf(m.unit, m.purchaseUnitSize).size, notes: l.notes.trim() || null };
          }),
          notes: this.notes().trim() || null,
        }),
      );
      this.ref.close(made);
    } catch (error) {
      this.error.set(errorMessage(error, 'The requisition could not be sent.'));
    } finally {
      this.saving.set(false);
    }
  }
}

// ---- The kitchen's Dispatch & Bill (صرف وإصدار فاتورة داخلية) ----

export interface DispatchDialogData {
  // The requisition it fills; none: a direct dispatch to a branch chosen here.
  requisition: Requisition | null;
  // The branches it may go to (a direct dispatch).
  receivers: InterBranchBranch[];
  materials: MaterialCost[];
  seesCosts: boolean;
}

interface SentLine {
  rawMaterialId: string | null;
  // Fixed: a requisition's line.
  fixed: boolean;
  material: string;
  unit: UnitOfMeasure | string;
  purchaseUnitSize: number;
  quantity: number | null;
  asked: number | null;
  // A price per counted unit typed for the line (a transfer price); none: cost plus the markup.
  price: number | null;
}

@Component({
  selector: 'app-dispatch-dialog',
  imports: [
    DecimalPipe, FormsModule, InfoTip, MatButtonModule, MatButtonToggleModule, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule,
    MatSelectModule, MaterialPicker, MoneyPipe,
  ],
  template: `
    <h2 mat-dialog-title>
      Dispatch & Bill <span class="inline-ar">صرف وإصدار فاتورة داخلية</span> <app-info-tip tip="internalSalesInvoice" />
    </h2>
    <mat-dialog-content>
      <p class="muted">
        @if (data.requisition; as r) {
          {{ r.number }}: {{ r.requestingBranch }} asked for {{ r.lines.length }} material{{ r.lines.length === 1 ? '' : 's' }}.
        } @else {
          A direct dispatch to a branch, with no requisition. · صرف مباشر لفرع.
        }
      </p>
      <div class="toolbar">
        @if (!data.requisition) {
          <mat-form-field subscriptSizing="dynamic" class="wide">
            <mat-label>To · إلى فرع</mat-label>
            <mat-select [ngModel]="to()" (ngModelChange)="to.set($event)" aria-label="To branch">
              @for (b of data.receivers; track b.id) {
                <mat-option [value]="b.id">{{ b.name }}@if (b.nameAr) { · {{ b.nameAr }}}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        }
        <mat-form-field subscriptSizing="dynamic" class="wide">
          <mat-label>From · من موقع</mat-label>
          <mat-select [ngModel]="from()" (ngModelChange)="from.set($event)" aria-label="From location">
            @for (l of places.locations(); track l.id) {
              <mat-option [value]="l.id">{{ l.name }}@if (l.nameAr) { · {{ l.nameAr }}}</mat-option>
            }
          </mat-select>
        </mat-form-field>
      </div>
      <div class="toolbar pricing">
        <mat-button-toggle-group [value]="pricing()" (change)="pricing.set($event.value)" aria-label="Transfer pricing">
          <mat-button-toggle value="AtCost">At cost <span class="ar">بالتكلفة</span></mat-button-toggle>
          <mat-button-toggle value="WithMarkupOrCustomPrice">Transfer price <span class="ar">سعر تحويل</span></mat-button-toggle>
        </mat-button-toggle-group>
        <app-info-tip tip="transferPricing" />
        @if (pricing() === 'WithMarkupOrCustomPrice') {
          <mat-form-field subscriptSizing="dynamic" class="small">
            <mat-label>Markup · الهامش</mat-label>
            <input matInput type="number" min="0" max="1000" step="any" [ngModel]="markup()" (ngModelChange)="markup.set($event)" aria-label="Markup percent" />
            <span matTextSuffix>%</span>
          </mat-form-field>
        }
      </div>
      <div class="table-wrap">
        <table class="grid" aria-label="Dispatch lines">
          <thead>
            <tr>
              <th>Material<span class="ar">الخامة</span></th>
              @if (data.requisition) {
                <th class="num">Still asked<span class="ar">المتبقي</span></th>
              }
              <th class="num">Send<span class="ar">المرسل</span></th>
              <th class="num">At {{ places.name(from()) || 'the store' }}<span class="ar">الرصيد</span></th>
              @if (data.seesCosts) {
                <th class="num">Cost<span class="ar">التكلفة</span></th>
                <th class="num">Price<span class="ar">سعر التحويل</span></th>
                <th class="num">Billed<span class="ar">الإجمالي</span></th>
              }
              @if (!data.requisition) {
                <th></th>
              }
            </tr>
          </thead>
          <tbody>
            @for (line of lines(); track $index; let i = $index) {
              <tr>
                <td>
                  @if (line.fixed) {
                    {{ line.material }}
                  } @else {
                    <app-material-picker class="material" [materials]="data.materials" [value]="line.rawMaterialId"
                      (valueChange)="pick(i, $event)" [label]="'Material, line ' + (i + 1)" />
                  }
                </td>
                @if (data.requisition) {
                  <td class="num muted">{{ line.asked | number: '1.0-3' }} {{ label(line) }}</td>
                }
                <td class="num">
                  <mat-form-field subscriptSizing="dynamic" class="small">
                    <input matInput type="number" min="0" step="any" [ngModel]="line.quantity" (ngModelChange)="change(i, { quantity: $event })"
                      [attr.aria-label]="'Send, line ' + (i + 1)" />
                    <span matTextSuffix>&nbsp;{{ label(line) }}</span>
                  </mat-form-field>
                </td>
                <td class="num" [class.short]="isShort(line)">
                  @if (line.rawMaterialId) {
                    {{ available(line) | number: '1.0-3' }} {{ label(line) }}
                  }
                </td>
                @if (data.seesCosts) {
                  <td class="num muted">{{ cost(line) === null ? '—' : (cost(line)! | money) }}</td>
                  <td class="num">
                    @if (pricing() === 'WithMarkupOrCustomPrice') {
                      <mat-form-field subscriptSizing="dynamic" class="small">
                        <input matInput type="number" min="0" step="any" [placeholder]="(priceOf(line) ?? 0).toFixed(2)" [ngModel]="line.price"
                          (ngModelChange)="change(i, { price: $event === '' ? null : $event })" [attr.aria-label]="'Price, line ' + (i + 1)" />
                      </mat-form-field>
                    } @else {
                      {{ priceOf(line) === null ? '—' : (priceOf(line)! | money) }}
                    }
                  </td>
                  <td class="num">{{ billed(line) === null ? '' : (billed(line)! | money) }}</td>
                }
                @if (!data.requisition) {
                  <td><button mat-icon-button (click)="remove(i)" [disabled]="lines().length === 1" aria-label="Remove line"><mat-icon>delete</mat-icon></button></td>
                }
              </tr>
            }
          </tbody>
          @if (data.seesCosts) {
            <tfoot>
              <tr>
                <td [attr.colspan]="data.requisition ? 6 : 5">
                  Billed · الإيراد الداخلي {{ revenue() | money }} · Cost · التكلفة {{ cogs() | money }} · Margin · الهامش {{ revenue() - cogs() | money }}
                </td>
                <td class="num"><strong>{{ revenue() | money }}</strong></td>
                @if (!data.requisition) {
                  <td></td>
                }
              </tr>
            </tfoot>
          }
        </table>
      </div>
      @if (!data.requisition) {
        <button mat-button (click)="add()"><mat-icon>add</mat-icon> Add line</button>
      }
      <mat-form-field subscriptSizing="dynamic" class="full">
        <mat-label>Notes · ملاحظات</mat-label>
        <input matInput maxlength="500" [ngModel]="notes()" (ngModelChange)="notes.set($event)" aria-label="Notes" />
      </mat-form-field>
      @if (anyShort()) {
        <p class="error" role="alert">More than {{ places.name(from()) || 'the location' }} holds: send less, or from another location. · الرصيد لا يكفي.</p>
      }
      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button (click)="submit()" [disabled]="!ready() || saving()"><mat-icon>local_shipping</mat-icon> Dispatch & Bill · صرف</button>
    </mat-dialog-actions>
  `,
  styleUrl: './costing.scss',
  styles: `
    .wide { min-width: 220px; }
    .material { min-width: 220px; width: 100%; }
    .small { width: 130px; }
    .full { width: 100%; margin-top: 8px; }
    .pricing { align-items: center; }
    .short { color: var(--mat-sys-error); font-weight: 600; }
  `,
})
export class DispatchDialog {
  protected readonly data = inject<DispatchDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<DispatchDialog, Shipment>);
  private readonly api = inject(InterBranchApi);
  private readonly stockApi = inject(StockApi);
  protected readonly places = inject(StockPlaces);
  private readonly id = crypto.randomUUID();

  protected readonly to = signal<string | null>(this.data.requisition?.requestingBranchId ?? this.data.receivers[0]?.id ?? null);
  protected readonly from = signal<string | null>(null);
  protected readonly pricing = signal<TransferPricing>('AtCost');
  protected readonly markup = signal<number | null>(10);
  protected readonly notes = signal('');
  protected readonly stock = signal<LocationStock | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly lines = signal<SentLine[]>(
    this.data.requisition
      ? this.data.requisition.lines.map((l) => {
          const size = unitOf(l.unit, l.purchaseUnitSize).size;
          const left = Math.max(l.requestedQuantity - l.dispatchedQuantity, 0) / size;
          return {
            rawMaterialId: l.rawMaterialId, fixed: true, material: l.material, unit: l.unit, purchaseUnitSize: l.purchaseUnitSize,
            quantity: left, asked: left, price: null,
          };
        })
      : [this.blank()],
  );

  protected readonly anyShort = computed(() => this.lines().some((l) => this.isShort(l)));
  protected readonly revenue = computed(() => this.lines().reduce((sum, l) => sum + (this.billed(l) ?? 0), 0));
  protected readonly cogs = computed(() =>
    this.lines().reduce((sum, l) => sum + (this.cost(l) !== null && l.quantity ? this.cost(l)! * l.quantity : 0), 0),
  );
  protected readonly ready = computed(() => {
    const sending = this.lines().filter((l) => l.rawMaterialId && (l.quantity ?? 0) > 0);
    const ids = this.lines().map((l) => l.rawMaterialId).filter(Boolean);
    return !!this.to() && !!this.from() && sending.length > 0 && !this.anyShort() && new Set(ids).size === ids.length
      && this.lines().every((l) => (l.quantity ?? 0) >= 0) && (this.pricing() === 'AtCost' || ((this.markup() ?? 0) >= 0 && (this.markup() ?? 0) <= 1000));
  });

  constructor() {
    void this.load();
  }

  protected label(line: SentLine): string {
    return line.rawMaterialId ? unitOf(line.unit, line.purchaseUnitSize).label : '';
  }

  // What the location it leaves has, in the unit it is entered in.
  protected available(line: SentLine): number {
    const row = this.stock()?.rows.find((r) => r.rawMaterialId === line.rawMaterialId);
    return (row?.byLocation[this.from() ?? ''] ?? 0) / unitOf(line.unit, line.purchaseUnitSize).size;
  }

  protected isShort(line: SentLine): boolean {
    return !!line.rawMaterialId && (line.quantity ?? 0) > 0 && (line.quantity ?? 0) > this.available(line) + 1e-9;
  }

  // The kitchen's average cost a counted unit; none for whoever does not see costs.
  protected cost(line: SentLine): number | null {
    const row = this.stock()?.rows.find((r) => r.rawMaterialId === line.rawMaterialId);
    return row?.averageCost == null ? null : row.averageCost * unitOf(line.unit, line.purchaseUnitSize).size;
  }

  // The price billed a counted unit: the cost; or the price typed, or the cost plus the markup.
  protected priceOf(line: SentLine): number | null {
    const cost = this.cost(line);
    if (this.pricing() === 'AtCost') {
      return cost;
    }
    if (line.price !== null && `${line.price}` !== '') {
      return Number(line.price);
    }
    return cost === null ? null : cost * (1 + (Number(this.markup()) || 0) / 100);
  }

  protected billed(line: SentLine): number | null {
    const price = this.priceOf(line);
    return price === null || !line.quantity ? null : price * line.quantity;
  }

  protected pick(index: number, id: string | null): void {
    const m = this.data.materials.find((x) => x.id === id);
    this.change(index, { rawMaterialId: id, material: m?.name ?? '', unit: m?.unit ?? 'Gram', purchaseUnitSize: m?.purchaseUnitSize ?? 1 });
  }

  protected change(index: number, patch: Partial<SentLine>): void {
    this.lines.update((lines) => lines.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  protected add(): void {
    this.lines.update((lines) => [...lines, this.blank()]);
  }

  protected remove(index: number): void {
    this.lines.update((lines) => lines.filter((_, i) => i !== index));
  }

  protected async submit(): Promise<void> {
    if (!this.ready()) {
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    const custom = this.pricing() === 'WithMarkupOrCustomPrice' && this.data.seesCosts;
    try {
      const sent = await firstValueFrom(
        this.api.dispatch({
          id: this.id,
          requisitionId: this.data.requisition?.id ?? null,
          receivingBranchId: this.data.requisition ? null : this.to(),
          fromLocationId: this.from(),
          pricing: this.pricing(),
          markupPercent: this.pricing() === 'WithMarkupOrCustomPrice' ? Number(this.markup()) || 0 : null,
          lines: this.lines()
            .filter((l) => l.rawMaterialId && (l.quantity ?? 0) > 0)
            .map((l) => {
              const size = unitOf(l.unit, l.purchaseUnitSize).size;
              const typed = custom && l.price !== null && `${l.price}` !== '' ? Number(l.price) / size : null;
              return { rawMaterialId: l.rawMaterialId!, quantity: l.quantity! * size, transferUnitPrice: typed };
            }),
          notes: this.notes().trim() || null,
        }),
      );
      this.ref.close(sent);
    } catch (error) {
      this.error.set(errorMessage(error, 'The shipment could not be dispatched.'));
    } finally {
      this.saving.set(false);
    }
  }

  private blank(): SentLine {
    return { rawMaterialId: null, fixed: false, material: '', unit: 'Gram', purchaseUnitSize: 1, quantity: null, asked: null, price: null };
  }

  private async load(): Promise<void> {
    await this.places.load(true);
    this.from.set(this.places.mainStore()?.id ?? null);
    try {
      this.stock.set(await firstValueFrom(this.stockApi.locationStock()));
    } catch (error) {
      this.error.set(errorMessage(error, 'What the kitchen holds could not be read.'));
    }
  }
}

// ---- The branch's receipt (استلام الفرع وفاتورة مشتريات داخلية) ----

export interface ReceiveDialogData {
  shipment: Shipment;
  seesCosts: boolean;
}

@Component({
  selector: 'app-receive-dialog',
  imports: [DecimalPipe, FormsModule, InfoTip, MatButtonModule, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule, MoneyPipe],
  template: `
    @let s = data.shipment;
    <h2 mat-dialog-title>Receive shipment <span class="inline-ar">تأكيد استلام الشحنة</span> <app-info-tip tip="internalPurchaseInvoice" /></h2>
    <mat-dialog-content>
      <p class="muted">{{ s.number }} from {{ s.supplyingBranch }}{{ s.requisitionNumber ? ', for ' + s.requisitionNumber : '' }}. Count what came, as it came.</p>
      <mat-form-field subscriptSizing="dynamic" class="wide">
        <mat-label>Into · موقع الاستلام</mat-label>
        <mat-select [ngModel]="to()" (ngModelChange)="to.set($event)" aria-label="Into location">
          @for (l of places.locations(); track l.id) {
            <mat-option [value]="l.id">{{ l.name }}@if (l.nameAr) { · {{ l.nameAr }}}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      <div class="table-wrap">
        <table class="grid" aria-label="Receipt lines">
          <thead>
            <tr>
              <th>Material<span class="ar">الخامة</span></th>
              <th class="num">Sent<span class="ar">المرسل</span></th>
              <th class="num">Received<span class="ar">المستلم</span></th>
              <th class="num">Short<span class="ar">العجز</span></th>
              @if (data.seesCosts) {
                <th class="num">Transit loss<span class="ar">عجز النقل</span></th>
              }
            </tr>
          </thead>
          <tbody>
            @for (l of s.lines; track l.rawMaterialId; let i = $index) {
              <tr>
                <td>{{ l.material }}</td>
                <td class="num">{{ sent(i) | number: '1.0-3' }} {{ label(i) }}</td>
                <td class="num">
                  <mat-form-field subscriptSizing="dynamic" class="small">
                    <input matInput type="number" min="0" step="any" [ngModel]="received()[i]" (ngModelChange)="set(i, $event)"
                      [attr.aria-label]="'Received, line ' + (i + 1)" />
                    <span matTextSuffix>&nbsp;{{ label(i) }}</span>
                  </mat-form-field>
                </td>
                <td class="num" [class.short]="short(i) > 0">{{ short(i) > 0 ? (short(i) | number: '1.0-3') + ' ' + label(i) : '—' }}</td>
                @if (data.seesCosts) {
                  <td class="num">{{ loss(i) > 0 ? (loss(i) | money) : '' }}</td>
                }
              </tr>
            }
          </tbody>
        </table>
      </div>
      <mat-form-field subscriptSizing="dynamic" class="full">
        <mat-label>{{ anyShort() ? 'What happened (required) · سبب العجز' : 'Notes · ملاحظات' }}</mat-label>
        <input matInput maxlength="500" [ngModel]="notes()" (ngModelChange)="notes.set($event)" aria-label="Receipt notes" [required]="anyShort()" />
      </mat-form-field>
      @if (anyShort() && !notes().trim()) {
        <p class="error" role="alert">Some of it did not arrive: say what happened, short or damaged on the way. · اذكر سبب العجز.</p>
      }
      @if (tooMuch()) {
        <p class="error" role="alert">More received than was sent: count again. · المستلم أكثر من المرسل.</p>
      }
      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button (click)="submit()" [disabled]="!ready() || saving()"><mat-icon>inventory</mat-icon> Receive · تأكيد الاستلام</button>
    </mat-dialog-actions>
  `,
  styleUrl: './costing.scss',
  styles: `
    .wide { min-width: 220px; }
    .small { width: 130px; }
    .full { width: 100%; margin-top: 8px; }
    .short { color: var(--mat-sys-error); font-weight: 600; }
  `,
})
export class ReceiveDialog {
  protected readonly data = inject<ReceiveDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<ReceiveDialog, Receipt>);
  private readonly api = inject(InterBranchApi);
  protected readonly places = inject(StockPlaces);
  private readonly id = crypto.randomUUID();
  private readonly sizes = this.data.shipment.lines.map((l) => unitOf(l.unit, l.purchaseUnitSize));

  protected readonly to = signal<string | null>(null);
  protected readonly notes = signal('');
  protected readonly received = signal<(number | null)[]>(this.data.shipment.lines.map((l, i) => l.quantity / this.sizes[i].size));
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly anyShort = computed(() => this.data.shipment.lines.some((_, i) => this.short(i) > 1e-9));
  protected readonly tooMuch = computed(() => this.received().some((r, i) => (Number(r) || 0) > this.sent(i) + 1e-9));
  protected readonly ready = computed(
    () => !!this.to() && !this.tooMuch() && this.received().every((r) => r !== null && `${r}` !== '' && Number(r) >= 0)
      && (!this.anyShort() || !!this.notes().trim()),
  );

  constructor() {
    void this.places.load(true).then(() => this.to.set(this.places.mainStore()?.id ?? null));
  }

  protected label(i: number): string {
    return this.sizes[i].label;
  }

  protected sent(i: number): number {
    return this.data.shipment.lines[i].quantity / this.sizes[i].size;
  }

  protected short(i: number): number {
    return Math.max(this.sent(i) - (Number(this.received()[i]) || 0), 0);
  }

  // At the price billed for it, as the branch's invoice keeps it.
  protected loss(i: number): number {
    const price = this.data.shipment.lines[i].transferUnitPrice;
    return price === null ? 0 : this.short(i) * this.sizes[i].size * price;
  }

  protected set(i: number, value: number | null): void {
    this.received.update((all) => all.map((r, j) => (j === i ? value : r)));
  }

  protected async submit(): Promise<void> {
    if (!this.ready()) {
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    try {
      const made = await firstValueFrom(
        this.api.receive({
          id: this.id,
          shipmentId: this.data.shipment.id,
          toLocationId: this.to(),
          lines: this.data.shipment.lines.map((l, i) => ({ rawMaterialId: l.rawMaterialId, receivedQuantity: Number(this.received()[i]) * this.sizes[i].size })),
          notes: this.notes().trim() || null,
        }),
      );
      this.ref.close(made);
    } catch (error) {
      this.error.set(errorMessage(error, 'The shipment could not be received.'));
    } finally {
      this.saving.set(false);
    }
  }
}

export function openRequisitionDialog(dialog: MatDialog, data: RequisitionDialogData): Promise<Requisition | undefined> {
  return firstValueFrom(
    dialog.open<RequisitionDialog, RequisitionDialogData, Requisition>(RequisitionDialog, { data, width: '820px', maxWidth: '95vw', autoFocus: 'dialog' }).afterClosed(),
  );
}

export function openDispatchDialog(dialog: MatDialog, data: DispatchDialogData): Promise<Shipment | undefined> {
  return firstValueFrom(
    dialog.open<DispatchDialog, DispatchDialogData, Shipment>(DispatchDialog, { data, width: '960px', maxWidth: '95vw', autoFocus: 'dialog' }).afterClosed(),
  );
}

export function openReceiveDialog(dialog: MatDialog, data: ReceiveDialogData): Promise<Receipt | undefined> {
  return firstValueFrom(
    dialog.open<ReceiveDialog, ReceiveDialogData, Receipt>(ReceiveDialog, { data, width: '760px', maxWidth: '95vw', autoFocus: 'dialog' }).afterClosed(),
  );
}
