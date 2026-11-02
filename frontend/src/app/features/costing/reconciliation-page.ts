import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';
import { CostingApi, ReconciliationReport } from '../../core/costing/costing.api';
import { errorMessage } from '../../core/http/error-message';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { monthBounds } from './financials';

// The reconciliation (مطابقة الإيرادات): each business day's net sales against what it sold at the
// menu's prices. A is the day's takings, cash and card, less the tax collected in them. B is every
// item of the day's sales summary at its menu price, before tax. The difference shows a day short
// (discounts, staff meals, cash missing) or over (money taken for items not entered).
@Component({
  selector: 'app-reconciliation-page',
  imports: [DatePipe, MatButtonModule, MatIconModule, MatProgressBarModule, MoneyPipe, NgTemplateOutlet],
  template: `
    <div class="toolbar">
      <button mat-icon-button (click)="move(-1)" aria-label="The month before"><mat-icon>chevron_left</mat-icon></button>
      <strong class="month">{{ monthStart() | date: 'MMMM y' }}</strong>
      <button mat-icon-button (click)="move(1)" [disabled]="isThisMonth()" aria-label="The month after"><mat-icon>chevron_right</mat-icon></button>
    </div>
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    @if (error()) {
      <p class="error">{{ error() }}</p>
    } @else if (report(); as r) {
      <div class="tiles">
        <div class="tile key">
          <span class="label">Net sales (A) · صافي المبيعات</span>
          <strong>{{ r.total.netSales | money }}</strong>
        </div>
        <div class="tile">
          <span class="label">Sold at menu prices (B) · المبيعات بأسعار المنيو</span>
          <strong>{{ r.total.itemSales | money }}</strong>
        </div>
        <div class="tile difference" [class.short]="r.total.difference < 0" [class.over]="r.total.difference > 0">
          <span class="label">Difference · الفرق</span>
          <strong>{{ r.total.difference | money }}</strong>
        </div>
        <div class="tile">
          <span class="label">Tax collected · الضريبة المحصلة</span>
          <strong>{{ r.total.tax | money }}</strong>
          <small class="muted">owed, not revenue</small>
        </div>
        <div class="tile">
          <span class="label">Voids &amp; refunds · الفويد والمرتجعات</span>
          <strong>{{ r.total.voids | money }}</strong>
        </div>
      </div>
      <p class="note">
        A: each day's takings as its Z report gave them, cash and card, less the tax collected in them. B: every item of the day's sales summary
        at its menu price, before tax. Below zero, the takings fall short of what was sold (discounts, staff meals, cash missing); above it,
        money came in for items not entered.
        <span class="note-ar" lang="ar" dir="rtl">الفرق بالسالب: الإيراد أقل من المبيعات بأسعار المنيو (خصومات أو وجبات عاملين أو عجز). بالموجب: إيراد لأصناف لم تُسجل.</span>
      </p>

      <ng-template #cells let-d>
        <td class="num">{{ d.cash | money }}</td>
        <td class="num">{{ d.card ? (d.card | money) : '—' }}</td>
        <td class="num">{{ d.tax ? (d.tax | money) : '—' }}</td>
        <td class="num strong">{{ d.netSales | money }}</td>
        <td class="num strong">{{ d.itemSales | money }}</td>
        <td class="num strong" [class.negative]="d.difference < 0" [class.over]="d.difference > 0">
          {{ d.difference | money }}
          @if (d.difference < 0) {
            <div class="small">short · عجز</div>
          } @else if (d.difference > 0) {
            <div class="small">not entered · زيادة</div>
          }
        </td>
        <td class="num">{{ d.voids ? (d.voids | money) : '—' }}</td>
      </ng-template>

      <div class="table-wrap">
        <table class="grid">
          <thead>
            <tr>
              <th>Day<span class="ar">اليوم</span></th>
              <th class="num">Cash<span class="ar">الكاش</span></th>
              <th class="num">Card<span class="ar">الفيزا</span></th>
              <th class="num">Tax<span class="ar">الضريبة</span></th>
              <th class="num">Net sales (A)<span class="ar">صافي المبيعات</span></th>
              <th class="num">At menu prices (B)<span class="ar">بأسعار المنيو</span></th>
              <th class="num">Difference<span class="ar">الفرق</span></th>
              <th class="num">Voids<span class="ar">الفويد</span></th>
            </tr>
          </thead>
          <tbody>
            @for (d of r.days; track d.date) {
              <tr>
                <td class="nowrap">{{ d.date | date: 'EEE d MMM' }}</td>
                <ng-container *ngTemplateOutlet="cells; context: { $implicit: d }" />
              </tr>
            } @empty {
              <tr><td colspan="8" class="muted">Nothing sold or entered this month.</td></tr>
            }
          </tbody>
          @if (r.days.length) {
            <tfoot>
              <tr>
                <td>The month</td>
                <ng-container *ngTemplateOutlet="cells; context: { $implicit: r.total }" />
              </tr>
            </tfoot>
          }
        </table>
      </div>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .month {
      min-width: 140px;
      text-align: center;
      font: var(--mat-sys-title-medium);
    }
    .negative,
    .tile.short strong {
      color: var(--mat-sys-error);
    }
    .over,
    .tile.over strong {
      color: var(--app-warn);
    }
    .strong {
      font-weight: 600;
    }
    .small {
      font-size: 0.8em;
      font-weight: 400;
    }
    .nowrap {
      white-space: nowrap;
    }
  `,
})
export class ReconciliationPage {
  private readonly api = inject(CostingApi);

  protected readonly year = signal(new Date().getFullYear());
  protected readonly month = signal(new Date().getMonth() + 1);
  protected readonly report = signal<ReconciliationReport | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly monthStart = computed(() => new Date(this.year(), this.month() - 1, 1));
  protected readonly isThisMonth = computed(() => this.year() === new Date().getFullYear() && this.month() === new Date().getMonth() + 1);

  constructor() {
    void this.load();
  }

  protected move(by: number): void {
    const next = new Date(this.year(), this.month() - 1 + by, 1);
    this.year.set(next.getFullYear());
    this.month.set(next.getMonth() + 1);
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    const { from, to } = monthBounds(this.year(), this.month());
    try {
      this.report.set(await firstValueFrom(this.api.reconciliation(from, to)));
    } catch (error) {
      this.error.set(errorMessage(error, 'The reconciliation could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }
}
