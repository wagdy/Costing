import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogRef, MatDialogTitle } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { CostingAccess } from '../../core/costing/costing-tabs';
import { CostingApi, StockCard, StockCardLine, StockCardMovementType, stockCardTypes } from '../../core/costing/costing.api';
import { errorMessage } from '../../core/http/error-message';
import { Company } from '../../core/settings/company';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { NotifyService } from '../../core/ui/notify.service';
import { saveBlob } from '../../core/ui/save-blob';
import { InfoTip } from './info-tip';
import { showInvoice } from './invoice-view-dialog';
import { PeriodBar, periodDays } from './period-bar';
import { showProductionOrder } from './production-order-dialog';

// Which material's card, and the period to open it on (this month when not given).
export interface StockCardData {
  id: string;
  name: string;
  from?: string;
  to?: string;
}

// The item's stock card (كارتة الصنف / حركة الصنف): every movement of one material or prep item over
// the period, oldest first, as a store ledger is kept: in, out, the running balance, the price it
// moved at and the moving average it left, with the balance it opened and closed the period on. A
// filter shows one kind of movement; the balance stays the ledger's. Each line's reference opens the
// record that made it: the invoice (its line for this material marked, to correct it), the batch,
// the count, the day's sales, the spoilage. To Excel as filtered.
@Component({
  selector: 'app-stock-card-dialog',
  imports: [
    DatePipe,
    DecimalPipe,
    FormsModule,
    InfoTip,
    MatButtonModule,
    // The dialog's parts alone: MatDialogModule would bring its own MatDialog, and the records it
    // opens over itself are the app's dialogs.
    MatDialogActions,
    MatDialogClose,
    MatDialogContent,
    MatDialogTitle,
    MatFormFieldModule,
    MatIconModule,
    MatProgressBarModule,
    MatSelectModule,
    MatTooltipModule,
    MoneyPipe,
    PeriodBar,
  ],
  template: `
    <h2 mat-dialog-title>
      {{ card()?.material ?? data.name }} · Stock card <span class="inline-ar">كارتة الصنف</span>
      @if (card(); as c) {
        <span class="title-sub">{{ c.code ? c.code + ' · ' : '' }}in {{ c.purchaseUnit }}{{ c.isPrepItem ? ' · prep item' : '' }}</span>
      }
    </h2>
    <mat-dialog-content>
      <div class="toolbar filters">
        <app-period-bar [(from)]="from" [(to)]="to" />
        <mat-form-field subscriptSizing="dynamic" class="type">
          <mat-label>Movement · نوع الحركة</mat-label>
          <mat-select [ngModel]="type()" (ngModelChange)="type.set($event)" aria-label="Movement type">
            <mat-option [value]="null">All · الكل</mat-option>
            @for (t of types; track t.type) {
              <mat-option [value]="t.type">{{ t.en }} · {{ t.ar }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <span class="spacer"></span>
        <button mat-stroked-button (click)="download()" [disabled]="!card() || downloading()"><mat-icon>download</mat-icon> Excel</button>
      </div>
      @if (loading()) {
        <mat-progress-bar mode="indeterminate" />
      }
      @if (error(); as e) {
        <p class="error" role="alert">{{ e }}</p>
      } @else if (card(); as c) {
        <div class="tiles strip">
          <div class="tile">
            <span class="label">Opening balance · رصيد أول المدة <app-info-tip tip="scOpening" /></span>
            <strong>{{ c.openingBalance | number: '1.0-3' }}</strong>
            <small class="chip">{{ c.purchaseUnit }}</small>
          </div>
          <div class="tile">
            <span class="label">Total in (+) · إجمالي الوارد <app-info-tip tip="scIn" /></span>
            <strong class="in">+{{ c.totalIn | number: '1.0-3' }}</strong>
          </div>
          <div class="tile">
            <span class="label">Total out (−) · إجمالي المنصرف <app-info-tip tip="scOut" /></span>
            <strong class="out">−{{ c.totalOut | number: '1.0-3' }}</strong>
          </div>
          <div class="tile key">
            <span class="label">Closing on hand · رصيد آخر المدة <app-info-tip tip="scClosing" /></span>
            <strong>{{ c.closingBalance | number: '1.0-3' }}</strong>
            @if (c.closingValue !== null) {
              <small class="chip">{{ c.closingValue | money }}</small>
            }
          </div>
          <div class="tile">
            <span class="label">Moving avg cost (AP$) · متوسط التكلفة <app-info-tip tip="scAverage" /></span>
            <strong>{{ c.averageCost === null ? '—' : price(c.averageCost) }}</strong>
            <small class="chip">per {{ c.purchaseUnit }}</small>
          </div>
        </div>

        <div class="table-wrap">
          <table class="grid ledger">
            <thead>
              <tr>
                <th>Date<span class="ar">التاريخ</span></th>
                <th>Movement & reference<span class="ar">الحركة والمرجع</span></th>
                <th>Supplier / details<span class="ar">المورد / البيان</span></th>
                <th class="num">Qty in<span class="ar">وارد</span></th>
                <th class="num">Qty out<span class="ar">منصرف</span></th>
                <th class="num">Balance <app-info-tip tip="scBalance" /><span class="ar">الرصيد</span></th>
                <th class="num">Unit price <app-info-tip tip="scUnitPrice" /><span class="ar">سعر الحركة</span></th>
                <th class="num">Moving avg after <app-info-tip tip="scAverageAfter" /><span class="ar">المتوسط بعد الحركة</span></th>
              </tr>
            </thead>
            <tbody>
              <tr class="edge">
                <td class="date">{{ c.from | date: 'd MMM y' }}</td>
                <td colspan="4">Opening balance · رصيد أول المدة</td>
                <td class="num"><strong>{{ c.openingBalance | number: '1.0-3' }}</strong></td>
                <td></td>
                <td class="num">{{ c.openingAverageCost === null ? '—' : price(c.openingAverageCost) }}</td>
              </tr>
              @for (l of c.lines; track l.movementId) {
                <tr [class.reversal]="l.isReversal">
                  <td class="date">
                    {{ l.date | date: 'd MMM y' }}
                    <div class="muted small">{{ l.occurredAtUtc | date: 'HH:mm' }}</div>
                  </td>
                  <td>
                    <span class="move" [class]="l.type">{{ typeLabel(l.type) }}</span>
                    @if (canOpen(l)) {
                      <button type="button" class="ref" (click)="openSource(l)" [matTooltip]="openHint(l)">
                        {{ l.reference }} <mat-icon aria-hidden="true">open_in_new</mat-icon>
                      </button>
                    } @else {
                      <div class="ref plain">{{ l.reference }}</div>
                    }
                    @if (l.sourceDate && l.sourceDate !== l.date) {
                      <div class="muted small">dated {{ l.sourceDate | date: 'd MMM y' }} · بتاريخ</div>
                    }
                  </td>
                  <td>
                    {{ l.details ?? '—' }}
                    @if (l.recordedBy) {
                      <div class="muted small">by {{ l.recordedBy }}</div>
                    }
                  </td>
                  <td class="num in">{{ l.quantityIn ? '+' + (l.quantityIn | number: '1.0-3') : '' }}</td>
                  <td class="num out">{{ l.quantityOut ? '−' + (l.quantityOut | number: '1.0-3') : '' }}</td>
                  <td class="num" [class.negative]="l.balance < 0"><strong>{{ l.balance | number: '1.0-3' }}</strong></td>
                  <td class="num">{{ l.unitCost === null ? '—' : price(l.unitCost) }}</td>
                  <td class="num">{{ l.averageCostAfter === null ? '—' : price(l.averageCostAfter) }}</td>
                </tr>
              } @empty {
                <tr><td colspan="8" class="muted">No {{ type() ? typeLabel(type()!).toLowerCase() + ' ' : '' }}movement in these days.</td></tr>
              }
            </tbody>
            <tfoot>
              <tr>
                <td class="date">{{ c.to | date: 'd MMM y' }}</td>
                <td colspan="2">Closing balance · رصيد آخر المدة</td>
                <td class="num in">+{{ c.totalIn | number: '1.0-3' }}</td>
                <td class="num out">−{{ c.totalOut | number: '1.0-3' }}</td>
                <td class="num">{{ c.closingBalance | number: '1.0-3' }}</td>
                <td class="num">{{ c.closingValue === null ? '' : (c.closingValue | money) }}</td>
                <td class="num">{{ c.closingAverageCost === null ? '—' : price(c.closingAverageCost) }}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-flat-button mat-dialog-close>Close</button>
    </mat-dialog-actions>
  `,
  styleUrl: './costing.scss',
  styles: `
    .title-sub {
      display: block;
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
    }
    .filters {
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .type {
      width: 210px;
    }
    .strip {
      margin: 8px 0 12px;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    }
    .in {
      color: var(--app-ok);
    }
    .out {
      color: var(--mat-sys-error);
    }
    .negative {
      color: var(--mat-sys-error);
    }
    .date {
      white-space: nowrap;
    }
    .small {
      font-size: 0.85em;
    }
    .move {
      display: inline-block;
      padding: 0 8px;
      border-radius: 999px;
      font: var(--mat-sys-label-small);
      line-height: 20px;
      white-space: nowrap;
      background: var(--mat-sys-surface-container-high);

      &.Purchases {
        background: color-mix(in srgb, var(--app-ok) 16%, transparent);
      }
      &.Sales {
        background: color-mix(in srgb, var(--mat-sys-primary) 12%, transparent);
      }
      &.Waste {
        background: color-mix(in srgb, var(--mat-sys-error) 12%, transparent);
      }
      &.Production {
        background: color-mix(in srgb, var(--app-warn) 16%, transparent);
      }
    }
    .ref {
      display: flex;
      align-items: center;
      gap: 2px;
      margin-top: 2px;
      padding: 0;
      border: 0;
      background: none;
      font: inherit;
      text-align: start;
    }
    button.ref {
      color: var(--mat-sys-primary);
      cursor: pointer;
      text-decoration: underline;
      text-underline-offset: 2px;

      mat-icon {
        width: 14px;
        height: 14px;
        font-size: 14px;
      }
    }
    tr.reversal td {
      color: var(--mat-sys-on-surface-variant);
    }
    tr.edge td,
    tfoot td {
      font-weight: 500;
      background: var(--mat-sys-surface-container-low);
    }
  `,
})
export class StockCardDialog {
  protected readonly data = inject<StockCardData>(MAT_DIALOG_DATA);
  private readonly api = inject(CostingApi);
  private readonly company = inject(Company);
  private readonly dialog = inject(MatDialog);
  private readonly ref = inject(MatDialogRef<StockCardDialog>);
  private readonly router = inject(Router);
  private readonly notify = inject(NotifyService);
  private readonly access = inject(CostingAccess);

  protected readonly types = stockCardTypes;
  protected readonly from = signal(this.data.from ?? periodDays('month').from);
  protected readonly to = signal(this.data.to ?? periodDays('month').to);
  protected readonly type = signal<StockCardMovementType | null>(null);
  protected readonly card = signal<StockCard | null>(null);
  protected readonly loading = signal(false);
  protected readonly downloading = signal(false);
  protected readonly error = signal<string | null>(null);

  // Which records this user may open: each where its own tab is.
  private readonly opens = computed(() => ({
    PurchaseInvoice: this.access.has('Purchases'),
    ProductionOrder: this.access.has('Production'),
    StockCount: this.access.has('Counts'),
    SalesReceipt: this.access.has('Sales'),
    Spoilage: this.access.has('Waste'),
  }));

  constructor() {
    effect(() => {
      const [from, to, type] = [this.from(), this.to(), this.type()];
      untracked(() => void this.load(from, to, type));
    });
  }

  protected typeLabel(type: StockCardMovementType): string {
    const t = this.types.find((x) => x.type === type);
    return t ? `${t.en} · ${t.ar}` : type;
  }

  // A price per purchase unit: to the cent, or to four places when the cents would lose it.
  protected price(value: number): string {
    return this.company.money(value, 2, 4);
  }

  protected canOpen(line: StockCardLine): boolean {
    return line.hasSource && this.opens()[line.sourceKind];
  }

  protected openHint(line: StockCardLine): string {
    switch (line.sourceKind) {
      case 'PurchaseInvoice':
        return 'Open the invoice, this material marked, to check or correct it · فتح الفاتورة';
      case 'ProductionOrder':
        return 'Open the production batch · فتح التشغيلة';
      case 'StockCount':
        return 'Open the stock count · فتح الجرد';
      case 'SalesReceipt':
        return "Open the day's sales · فتح مبيعات اليوم";
      default:
        return 'Open the waste log of the day · فتح سجل الهالك';
    }
  }

  protected async openSource(line: StockCardLine): Promise<void> {
    switch (line.sourceKind) {
      case 'PurchaseInvoice':
        showInvoice(this.dialog, line.sourceId, this.data.id);
        return;
      case 'ProductionOrder': {
        try {
          const order = await firstValueFrom(this.api.productionOrder(line.sourceId));
          if (order) {
            showProductionOrder(this.dialog, order);
          } else {
            this.notify.error(null, 'That production batch is no longer there. · التشغيلة غير موجودة.');
          }
        } catch (error) {
          this.notify.error(error, 'The production batch could not be loaded.');
        }
        return;
      }
      case 'StockCount':
        this.leaveFor(['/costing/counts', line.sourceId]);
        return;
      case 'SalesReceipt':
        this.leaveFor(['/costing/sales'], { day: line.sourceDate ?? line.date, receipt: line.sourceId });
        return;
      default:
        this.leaveFor(['/costing/waste'], { spoilage: line.sourceId });
    }
  }

  protected async download(): Promise<void> {
    const c = this.card();
    if (!c) {
      return;
    }
    this.downloading.set(true);
    try {
      const name = (c.code ?? c.material).replace(/[^\p{L}\p{N}]+/gu, '-');
      saveBlob(await firstValueFrom(this.api.stockCardSheet(this.data.id, this.from(), this.to(), this.type())), `stock-card-${name}-${this.from()}-to-${this.to()}.xlsx`);
    } catch (error) {
      this.notify.error(error, 'The stock card could not be downloaded.');
    } finally {
      this.downloading.set(false);
    }
  }

  // A record on its own page: the card closes, the page opens on it.
  private leaveFor(commands: unknown[], queryParams?: Record<string, string>): void {
    this.ref.close();
    void this.router.navigate(commands, { queryParams });
  }

  private async load(from: string, to: string, type: StockCardMovementType | null): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.card.set(await firstValueFrom(this.api.stockCard(this.data.id, from, to, type)));
    } catch (error) {
      this.error.set(errorMessage(error, 'The stock card could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }
}

// A material's stock card over the list it was opened from.
export function showStockCard(dialog: MatDialog, material: { id: string; name: string }, period?: { from: string; to: string }): void {
  dialog.open<StockCardDialog, StockCardData>(StockCardDialog, {
    data: { id: material.id, name: material.name, ...period },
    width: '1180px',
    maxWidth: '96vw',
    autoFocus: 'dialog',
  });
}

// The (receipt) beside a material's name in a report's table: its stock card, over the report's
// period when given. A click on it is not a click on the row it is in.
@Component({
  selector: 'app-stock-card-button',
  imports: [MatTooltipModule],
  template: `
    <button type="button" class="stock-card-button" (click)="open($event)" matTooltip="Stock card · كارتة الصنف" [attr.aria-label]="'Stock card of ' + name()">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
        <path
          fill="currentColor"
          d="M19.5 3.5 18 2l-1.5 1.5L15 2l-1.5 1.5L12 2l-1.5 1.5L9 2 7.5 3.5 6 2v14H3v3c0 1.66 1.34 3 3 3h12c1.66 0 3-1.34 3-3V2l-1.5 1.5zM15 20H6c-.55 0-1-.45-1-1v-1h10v2zm4-1c0 .55-.45 1-1 1s-1-.45-1-1v-3H8V5h11v14zM9 7h6v2H9zm7 0h2v2h-2zm-7 3h6v2H9zm7 0h2v2h-2z"
        />
      </svg>
    </button>
  `,
  styles: `
    :host {
      display: inline-flex;
      vertical-align: middle;
    }
    .stock-card-button {
      display: inline-grid;
      place-items: center;
      width: 26px;
      height: 26px;
      margin-inline-start: 4px;
      padding: 0;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: var(--mat-sys-primary);
      cursor: pointer;
    }
    .stock-card-button:hover,
    .stock-card-button:focus-visible {
      background: color-mix(in srgb, var(--mat-sys-primary) 10%, transparent);
    }
  `,
})
export class StockCardButton {
  private readonly dialog = inject(MatDialog);
  readonly id = input.required<string>();
  readonly name = input.required<string>();
  readonly from = input<string | undefined>(undefined);
  readonly to = input<string | undefined>(undefined);

  protected open(event: Event): void {
    event.stopPropagation();
    const [from, to] = [this.from(), this.to()];
    showStockCard(this.dialog, { id: this.id(), name: this.name() }, from && to ? { from, to } : undefined);
  }
}
