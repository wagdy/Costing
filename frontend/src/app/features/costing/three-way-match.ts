import { DecimalPipe } from '@angular/common';
import { Component, computed, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MaterialCost, PurchaseOrder, matchStatusLabels } from '../../core/costing/costing.api';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { InfoTip } from './info-tip';
import { InvoiceLine, InvoiceLines } from './invoice-lines';
import { Delivered, LiveMatch, matchAgainst } from './purchase-orders';

// An invoice's lines put against the purchase order it delivers: what was left to come of each line,
// at what price, and what the invoice brings, as a line of the invoice; the order's lines come onto it
// at what was left, at the expected price, to be typed over as the paper and the door say.
export function fillFromOrder(editor: InvoiceLines, order: PurchaseOrder, materials: readonly MaterialCost[]): void {
  const open = order.lines.filter((l) => l.remainingQty > 0);
  editor.lines.set(
    (open.length ? open : order.lines).map((l): InvoiceLine => {
      const material = materials.find((m) => m.id === l.rawMaterialId);
      return {
        entry: material ?? l.material,
        itemType: 'Inventory',
        rawMaterialId: l.rawMaterialId,
        expenseItemId: null,
        quantity: l.remainingQty || l.orderedPurchaseQty,
        unitSize: material?.purchaseUnitSize ?? l.purchaseUnitSize,
        unitLabel: '',
        cost: Math.round((l.remainingQty || l.orderedPurchaseQty) * l.expectedUnitCost * 100) / 100,
        discount: 0,
      };
    }),
  );
  editor.discount.set(0);
  editor.touch();
}

// What the invoice's stock lines bring, in purchase units, at what each cost net.
export function deliveredBy(editor: InvoiceLines): Delivered[] {
  editor.version();
  return editor.lines().flatMap((line) => {
    const material = editor.material(line);
    const base = editor.baseQuantity(line);
    return material && base ? [{ rawMaterialId: material.id, purchaseQty: base / material.purchaseUnitSize, netCost: editor.netCost(line) }] : [];
  });
}

export function liveMatch(editor: InvoiceLines, order: PurchaseOrder) {
  return matchAgainst(order, deliveredBy(editor), (id) => {
    const material = editor.catalog.materials().find((m) => m.id === id);
    return { name: material?.name ?? 'An item', unit: material?.purchaseUnit ?? 'unit' };
  });
}

// The side-by-side grid (المطابقة الثلاثية): the order's line, what came, at what net price, and how it
// stands, received quantity, line total and discount typed here or on the invoice's own lines; with
// the backorder choice when something is short, and the word that a manager signs off what is over.
@Component({
  selector: 'app-three-way-match',
  imports: [DecimalPipe, FormsModule, InfoTip, MatButtonModule, MatButtonToggleModule, MatIconModule, MoneyPipe],
  template: `
    @let m = match();
    <section class="match" [attr.aria-label]="label() + '3-way match against ' + order().poNumber">
      <header>
        <h3>3-way match · المطابقة الثلاثية <app-info-tip tip="poMatch" /></h3>
        <span class="muted">against {{ order().poNumber }} · {{ order().supplier }}</span>
        <span class="spacer"></span>
        @if (m.overcharge > 0) {
          <span class="chip bad">Overcharge {{ m.overcharge | money }} <app-info-tip tip="poOvercharge" /></span>
        }
        @if (overLines() > 0) {
          <span class="chip bad">{{ overLines() }} over the order</span>
        }
        @if (!m.needsApproval && !m.hasShort) {
          <span class="chip good">All matched · مطابق</span>
        }
      </header>
      <div class="table-wrap">
        <table class="grid">
          <thead>
            <tr>
              <th>Material<span class="ar">الصنف</span></th>
              <th class="num">PO ordered / left<span class="ar">المطلوب / المتبقي</span></th>
              <th class="num">Received<span class="ar">المستلم فعليًا</span></th>
              <th class="num">PO price<span class="ar">السعر المتوقع</span></th>
              <th class="num">Invoice line total<span class="ar">إجمالي البند</span></th>
              <th class="num">Line discount<span class="ar">الخصم</span></th>
              <th class="num">Net unit price <app-info-tip tip="poNetUnitPrice" /><span class="ar">صافي السعر</span></th>
              <th>Match<span class="ar">المطابقة</span></th>
            </tr>
          </thead>
          <tbody>
            @for (row of m.lines; track row.rawMaterialId) {
              @let line = lineOf(row.rawMaterialId);
              <tr [class]="'st-' + row.status">
                <td>{{ row.material }} <span class="muted small">· {{ row.purchaseUnit }}</span></td>
                <td class="num">{{ row.status === 'NotOrdered' ? '—' : (row.ordered | number: '1.0-3') + ' / ' + (row.remaining | number: '1.0-3') }}</td>
                <td class="num">
                  @if (line) {
                    <input class="cell" type="number" min="0" step="any" [ngModel]="received(row)" (ngModelChange)="setReceived(line, $event)"
                      [attr.aria-label]="label() + 'Received, ' + row.material" />
                    @if (row.qtyOver > 0) {
                      <div class="over">+{{ row.qtyOver | number: '1.0-3' }} over</div>
                    }
                  } @else {
                    <button mat-button type="button" (click)="addLine(row)">Add · إضافة</button>
                  }
                </td>
                <td class="num">{{ row.status === 'NotOrdered' ? '—' : (row.expectedUnitCost | money) }}</td>
                <td class="num">
                  @if (line) {
                    <input class="cell" type="number" min="0" step="any" [(ngModel)]="line.cost" (ngModelChange)="editor().touch()"
                      [attr.aria-label]="label() + 'Line total, ' + row.material" />
                  }
                </td>
                <td class="num">
                  @if (line) {
                    <input class="cell" type="number" min="0" step="any" [(ngModel)]="line.discount" (ngModelChange)="editor().touch()"
                      [attr.aria-label]="label() + 'Line discount, ' + row.material" />
                  }
                </td>
                <td class="num">
                  {{ row.netUnitPrice === null ? '—' : (row.netUnitPrice | money) }}
                  @if (row.priceOver) {
                    <div class="over">+{{ row.unitOvercharge | money }} each · {{ row.overcharge | money }}</div>
                  }
                </td>
                <td>
                  <span class="badge" [class]="row.status">{{ labels[row.status].en }} · {{ labels[row.status].ar }}</span>
                  @if (row.priceOver && row.status !== 'PriceOvercharge') {
                    <span class="badge PriceOvercharge">{{ labels.PriceOvercharge.en }}</span>
                  }
                  @if (row.shortBy > 0) {
                    <div class="muted small">{{ row.shortBy | number: '1.0-3' }} {{ row.purchaseUnit }} short</div>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      @if (m.hasShort) {
        <div class="backorder">
          <span>Something is short · استلام جزئي <app-info-tip tip="poBackorder" /></span>
          <mat-button-toggle-group [ngModel]="closes() ? 'close' : 'keep'" (ngModelChange)="closes.set($event === 'close')" hideSingleSelectionIndicator
            [attr.aria-label]="label() + 'What is short'">
            <mat-button-toggle value="keep">Keep remaining balance open (Backorder) · إبقاء المتبقي كأمر شراء مفتوح</mat-button-toggle>
            <mat-button-toggle value="close">Close PO with received qty · إغلاق أمر الشراء بالكمية المستلمة</mat-button-toggle>
          </mat-button-toggle-group>
        </div>
      }
      @if (m.needsApproval) {
        <p class="gate" role="status">
          <mat-icon>gpp_maybe</mat-icon>
          @if (canApprove()) {
            Over the order's price or quantity: posted as you confirm, since you approve. · تتجاوز أمر الشراء.
          } @else {
            Over the order's price or quantity: a manager signs it off before its stock goes in and the average costs move. · تحتاج موافقة المدير.
          }
        </p>
      }
    </section>
  `,
  styles: `
    .match {
      margin: 12px 0;
      padding: 12px;
      border: 1px solid var(--app-line);
      border-radius: 12px;
      background: var(--mat-sys-surface-container-lowest);
    }
    header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;

      h3 {
        margin: 0;
        font: var(--mat-sys-title-small);
      }
    }
    .spacer {
      flex: 1;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 2px 10px;
      border-radius: 999px;
      font: var(--mat-sys-label-medium);

      &.bad {
        background: color-mix(in srgb, var(--mat-sys-error) 12%, transparent);
        color: var(--mat-sys-error);
      }
      &.good {
        background: color-mix(in srgb, var(--app-good, #15803d) 14%, transparent);
        color: var(--app-good, #15803d);
      }
    }
    .ar {
      display: block;
      font-size: 0.8em;
      opacity: 0.75;
    }
    .small {
      font-size: 0.85em;
    }
    .cell {
      width: 92px;
      padding: 5px 8px;
      border: 1px solid var(--app-line-strong);
      border-radius: 8px;
      font: inherit;
      text-align: end;
      background: var(--mat-sys-surface-container-lowest);
      color: inherit;
    }
    .over {
      color: var(--mat-sys-error);
      font: var(--mat-sys-label-small);
    }
    tr.st-PriceOvercharge td,
    tr.st-QtyOver td,
    tr.st-NotOrdered td {
      background: color-mix(in srgb, var(--mat-sys-error) 6%, transparent);
    }
    tr.st-Short td {
      background: color-mix(in srgb, var(--app-warn) 8%, transparent);
    }
    .badge {
      display: inline-block;
      margin: 0 4px 2px 0;
      padding: 1px 8px;
      border-radius: 999px;
      font: var(--mat-sys-label-small);
      white-space: nowrap;

      &.Matched {
        background: color-mix(in srgb, var(--app-good, #15803d) 16%, transparent);
        color: var(--app-good, #15803d);
      }
      &.PriceOvercharge,
      &.QtyOver,
      &.NotOrdered {
        background: color-mix(in srgb, var(--mat-sys-error) 14%, transparent);
        color: var(--mat-sys-error);
      }
      &.Short {
        background: color-mix(in srgb, var(--app-warn) 18%, transparent);
        color: var(--app-warn);
      }
    }
    .backorder {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 12px;
      margin-top: 8px;
    }
    .gate {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 8px 0 0;
      padding: 8px 10px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--app-warn) 14%, transparent);
    }
    @media (max-width: 599px) {
      .backorder mat-button-toggle-group {
        flex-direction: column;
      }
    }
  `,
})
export class ThreeWayMatchPanel {
  readonly order = input.required<PurchaseOrder>();
  readonly editor = input.required<InvoiceLines>();
  readonly canApprove = input(false);
  // Before each field's accessible name, to tell one invoice's from another's: "Invoice 2, ".
  readonly label = input('');
  // What did not come is not expected any more: the order closed with what was received.
  readonly closes = model(false);

  protected readonly labels = matchStatusLabels;
  protected readonly match = computed(() => liveMatch(this.editor(), this.order()));
  protected readonly overLines = computed(() => this.match().lines.filter((l) => l.qtyOver > 0).length);

  protected lineOf(materialId: string): InvoiceLine | undefined {
    return this.editor().lines().find((l) => l.rawMaterialId === materialId);
  }

  protected received(row: LiveMatch): number {
    return row.received;
  }

  // Received, in the order's purchase unit: the invoice line keeps the unit it is in.
  protected setReceived(line: InvoiceLine, value: number | null): void {
    const material = this.editor().material(line);
    if (!material) {
      return;
    }
    const size = line.unitSize ?? material.purchaseUnitSize;
    line.quantity = value === null ? null : Math.round(((value * material.purchaseUnitSize) / size) * 1000) / 1000;
    this.editor().touch();
  }

  // A line of the order missing from the invoice, put back at nothing received: typed in as it came.
  protected addLine(row: LiveMatch): void {
    const material = this.editor().catalog.materials().find((m) => m.id === row.rawMaterialId);
    this.editor().lines.update((lines) => [
      ...lines.filter((l) => l.rawMaterialId || l.expenseItemId || l.quantity),
      {
        entry: material ?? row.material, itemType: 'Inventory', rawMaterialId: row.rawMaterialId, expenseItemId: null, quantity: row.remaining,
        unitSize: material?.purchaseUnitSize ?? 1, unitLabel: '', cost: Math.round(row.remaining * row.expectedUnitCost * 100) / 100, discount: 0,
      },
    ]);
    this.editor().touch();
  }
}
