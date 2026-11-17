import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { PlannedOrderLine, PurchaseOrderInput, PurchaseOrderPlan, PurchaseOrderTerms, Supplier } from '../../core/costing/costing.api';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { InfoTip } from './info-tip';
import { dayAfter } from './purchase-orders';

// The order planner's approved quantities as purchase orders, one a supplier (إنشاء أوامر شراء من
// الطلبية): who sold each last, or cheapest, at that price; a material no one has sold yet waits for a
// supplier to be chosen here, or is left out. Each order's delivery day and terms are set here too.
// Sent together: all are written, or none.

export interface PoGenerationData {
  plan: PurchaseOrderPlan;
  suppliers: Supplier[];
  canApprove: boolean;
  today: string;
}

export interface PoGenerationResult {
  orders: { id: string; order: PurchaseOrderInput }[];
}

interface Group {
  supplierId: string;
  supplier: string;
  lines: PlannedOrderLine[];
  total: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

@Component({
  selector: 'app-po-generation-dialog',
  imports: [
    DecimalPipe, FormsModule, InfoTip, MatButtonModule, MatButtonToggleModule, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule,
    MatSelectModule, MoneyPipe,
  ],
  template: `
    <h2 mat-dialog-title>Create purchase orders <span class="ar">إنشاء أوامر شراء من الطلبية</span></h2>
    <mat-dialog-content>
      <p class="muted">
        One purchase order a supplier, {{ data.plan.groupBy === 'CheapestSupplier' ? 'each item to the supplier with the lowest last net price' : 'each item to who sold it last' }},
        at that price <app-info-tip tip="poExpectedPrice" />.
        {{ data.canApprove ? 'Approved at once: ready to send.' : 'Sent to a manager for approval: drafts until then.' }}
      </p>

      @if (unassigned().length) {
        <section class="choose">
          <h3>No supplier yet · بدون مورد</h3>
          <p class="muted small">No one has sold these yet: choose who to order each from, or leave it out.</p>
          @for (l of unassigned(); track l.rawMaterialId) {
            <div class="pick">
              <span class="what">{{ l.material }} · {{ l.quantity | number: '1.0-3' }} {{ l.purchaseUnit }}</span>
              <mat-form-field subscriptSizing="dynamic">
                <mat-label>Order from · المورد</mat-label>
                <mat-select [ngModel]="assigned().get(l.rawMaterialId) ?? ''" (ngModelChange)="assign(l.rawMaterialId, $event)" [attr.aria-label]="'Supplier for ' + l.material">
                  <mat-option value="">Leave it out · استبعاد</mat-option>
                  @for (s of suppliers; track s.id) {
                    <mat-option [value]="s.id">{{ s.name }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            </div>
          }
        </section>
      }

      @for (g of groups(); track g.supplierId) {
        <section class="order" [attr.aria-label]="'Purchase order for ' + g.supplier">
          <header>
            <h3>{{ g.supplier }}</h3>
            <span class="spacer"></span>
            <mat-form-field subscriptSizing="dynamic" class="day">
              <mat-label>Expected · التوريد</mat-label>
              <input matInput type="date" [ngModel]="expectedOf(g.supplierId)" (ngModelChange)="setExpected(g.supplierId, $event)" [min]="data.today"
                [attr.aria-label]="'Expected delivery from ' + g.supplier" />
            </mat-form-field>
            <mat-button-toggle-group [ngModel]="termsOf(g.supplierId)" (ngModelChange)="setTerms(g.supplierId, $event)" hideSingleSelectionIndicator
              [attr.aria-label]="'Paid to ' + g.supplier">
              <mat-button-toggle value="Cash">Cash · نقدي</mat-button-toggle>
              <mat-button-toggle value="Credit">Credit · آجل</mat-button-toggle>
            </mat-button-toggle-group>
          </header>
          <table class="grid">
            <thead>
              <tr>
                <th>Item<span class="ar">الصنف</span></th>
                <th class="num">Quantity<span class="ar">الكمية</span></th>
                <th class="num">Expected price<span class="ar">السعر المتوقع</span></th>
                <th class="num">Line total<span class="ar">الإجمالي</span></th>
              </tr>
            </thead>
            <tbody>
              @for (l of g.lines; track l.rawMaterialId) {
                <tr>
                  <td>{{ l.material }} @if (!l.priceKnown) {<span class="muted small">· its average, never bought</span>}</td>
                  <td class="num">{{ l.quantity | number: '1.0-3' }} {{ l.purchaseUnit }}</td>
                  <td class="num">{{ l.unitPrice | money }}</td>
                  <td class="num">{{ l.cost | money }}</td>
                </tr>
              }
            </tbody>
            <tfoot>
              <tr><td colspan="3">{{ g.lines.length }} {{ g.lines.length === 1 ? 'item' : 'items' }}</td><td class="num">{{ g.total | money }}</td></tr>
            </tfoot>
          </table>
        </section>
      } @empty {
        <p class="muted">Choose a supplier for an item to make an order.</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <span class="summary muted">
        {{ groups().length }} {{ groups().length === 1 ? 'order' : 'orders' }} · {{ total() | money }}
        @if (leftOut()) {
          · {{ leftOut() }} left out
        }
      </span>
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button (click)="done()" [disabled]="!groups().length">
        <mat-icon>{{ data.canApprove ? 'verified' : 'send' }}</mat-icon>
        {{ data.canApprove ? 'Create & approve' : 'Create & send for approval' }} ({{ groups().length }})
      </button>
    </mat-dialog-actions>
  `,
  styleUrl: './costing.scss',
  styles: `
    .ar {
      direction: rtl;
      unicode-bidi: isolate;
      margin-inline-start: 6px;
      opacity: 0.75;
      font-size: 0.8em;
    }
    .small {
      font-size: 0.85em;
    }
    .choose,
    .order {
      margin: 0 0 16px;
      padding: 12px;
      border: 1px solid var(--app-line);
      border-radius: 12px;
    }
    .choose {
      background: color-mix(in srgb, var(--app-warn) 8%, transparent);
    }
    h3 {
      margin: 0;
      font: var(--mat-sys-title-small);
    }
    .pick {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 12px;
      margin-top: 8px;

      .what {
        flex: 1;
        min-width: 180px;
      }
    }
    header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .spacer {
      flex: 1;
    }
    .day {
      width: 170px;
    }
    table {
      width: 100%;
    }
    tfoot td {
      font-weight: 600;
    }
    .summary {
      margin-inline-end: auto;
    }
  `,
})
export class PoGenerationDialog {
  protected readonly data = inject<PoGenerationData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<PoGenerationDialog, PoGenerationResult>>(MatDialogRef);
  protected readonly suppliers = this.data.suppliers.filter((s) => !s.isArchived);

  // Each material no one has sold yet, and who it is ordered from here ('' left out).
  protected readonly unassigned = computed(() => this.data.plan.orders.filter((o) => o.supplierId === null).flatMap((o) => o.lines));
  protected readonly assigned = signal(new Map<string, string>());
  private readonly expected = signal(new Map<string, string>());
  private readonly terms = signal(new Map<string, PurchaseOrderTerms>());

  // A purchase order a supplier: the planner's, with what was given to it here.
  protected readonly groups = computed<Group[]>(() => {
    const by = new Map<string, Group>();
    const name = (id: string) => this.suppliers.find((s) => s.id === id)?.name ?? this.data.plan.orders.find((o) => o.supplierId === id)?.supplier ?? 'A supplier';
    const put = (supplierId: string, line: PlannedOrderLine) => {
      const group = by.get(supplierId) ?? { supplierId, supplier: name(supplierId), lines: [], total: 0 };
      group.lines.push(line);
      group.total = round(group.total + line.cost);
      by.set(supplierId, group);
    };
    for (const order of this.data.plan.orders) {
      for (const line of order.lines) {
        const to = order.supplierId ?? this.assigned().get(line.rawMaterialId);
        if (to) {
          put(to, line);
        }
      }
    }
    return [...by.values()].sort((a, b) => a.supplier.localeCompare(b.supplier));
  });

  protected readonly total = computed(() => round(this.groups().reduce((sum, g) => sum + g.total, 0)));
  protected readonly leftOut = computed(() => this.unassigned().filter((l) => !this.assigned().get(l.rawMaterialId)).length);

  protected assign(materialId: string, supplierId: string): void {
    const next = new Map(this.assigned());
    next.set(materialId, supplierId);
    this.assigned.set(next);
  }

  protected expectedOf(supplierId: string): string {
    return this.expected().get(supplierId) ?? dayAfter(this.data.today);
  }

  protected setExpected(supplierId: string, day: string): void {
    this.expected.set(new Map(this.expected()).set(supplierId, day));
  }

  // On credit when the supplier gives days to pay, unless chosen here.
  protected termsOf(supplierId: string): PurchaseOrderTerms {
    return this.terms().get(supplierId)
      ?? ((this.data.plan.orders.find((o) => o.supplierId === supplierId)?.paymentTermsDays ?? this.suppliers.find((s) => s.id === supplierId)?.paymentTermsDays ?? 0) > 0
        ? 'Credit'
        : 'Cash');
  }

  protected setTerms(supplierId: string, terms: PurchaseOrderTerms): void {
    this.terms.set(new Map(this.terms()).set(supplierId, terms));
  }

  protected done(): void {
    this.ref.close({
      orders: this.groups().map((g) => ({
        id: crypto.randomUUID(),
        order: {
          supplierId: g.supplierId,
          orderDate: this.data.today,
          expectedDeliveryDate: this.expectedOf(g.supplierId) || null,
          paymentTerms: this.termsOf(g.supplierId),
          notes: null,
          lines: g.lines.map((l) => ({ rawMaterialId: l.rawMaterialId, orderedPurchaseQty: l.quantity, expectedUnitCost: l.unitPrice })),
        },
      })),
    });
  }
}
