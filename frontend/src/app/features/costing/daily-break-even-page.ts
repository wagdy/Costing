import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import { CostingApi, DailyBreakEven } from '../../core/costing/costing.api';
import { errorMessage } from '../../core/http/error-message';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { isoDay } from './financials';
import { InfoTip } from './info-tip';

// The gauge's reach: the target or what was sold, whichever is more, and a margin past it.
export function gaugeScale(report: DailyBreakEven): { max: number; fill: number; marker: number | null } {
  const target = report.breakEvenSales;
  const max = Math.max(target ?? 0, report.netSales, 1) * 1.15;
  return {
    max,
    fill: Math.min(100, (report.netSales / max) * 100),
    marker: target === null ? null : (target / max) * 100,
  };
}

// The dynamic daily break-even (نقطة التعادل اليومية): what today must sell to cover its share of the
// month's fixed costs at the margin of what it sold, said in a sentence, drawn as a gauge from 0
// past the target, and its parts as cards. Another day can be looked back at.
@Component({
  selector: 'app-daily-break-even-page',
  imports: [DatePipe, DecimalPipe, FormsModule, InfoTip, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressBarModule, MatTooltipModule, MoneyPipe],
  template: `
    <div class="toolbar">
      <button mat-icon-button (click)="shift(-1)" aria-label="The day before" matTooltip="The day before · اليوم السابق"><mat-icon>chevron_left</mat-icon></button>
      <mat-form-field subscriptSizing="dynamic" class="day">
        <mat-label>Day · اليوم</mat-label>
        <input matInput type="date" [ngModel]="date()" (ngModelChange)="pick($event)" [max]="today" aria-label="Day" />
      </mat-form-field>
      <button mat-icon-button (click)="shift(1)" [disabled]="date() >= today" aria-label="The day after" matTooltip="The day after · اليوم التالي">
        <mat-icon>chevron_right</mat-icon>
      </button>
      @if (date() !== today) {
        <button mat-button (click)="date.set(today)"><mat-icon>today</mat-icon> Today · اليوم</button>
      }
      <span class="spacer"></span>
      <button mat-stroked-button (click)="refresh()" [disabled]="loading()"><mat-icon>refresh</mat-icon> Refresh · تحديث</button>
    </div>
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    @if (error()) {
      <p class="error">{{ error() }}</p>
    } @else if (report(); as r) {
      <section class="summary" [class.profit]="r.operatingResult >= 0" [class.loss]="r.operatingResult < 0" role="status" aria-label="Live status">
        <h2>Live status <span class="inline-ar">مؤشر الحالة اللحظي</span></h2>
        @if (r.breakEvenSales !== null) {
          <p class="ar-text" lang="ar" dir="rtl">
            @if (r.isToday) {
              اليوم، لكي تغطي مصاريفك، يجب أن تبيع بـ <strong>{{ r.breakEvenSales | number: '1.2-2' }}</strong> جنيه. لقد بعت بـ
              <strong>{{ r.netSales | number: '1.2-2' }}</strong> حتى الآن، أنت تحقق
              <strong class="result">{{ r.operatingResult < 0 ? 'خسارة' : 'ربح' }}</strong> تشغيلية قدرها
              <strong class="result">{{ abs(r.operatingResult) | number: '1.2-2' }}</strong> جنيه لهذا اليوم.
            } @else {
              يوم {{ r.date | date: 'd/M/yyyy' }}، لكي تغطي مصاريفك، كان يجب أن تبيع بـ <strong>{{ r.breakEvenSales | number: '1.2-2' }}</strong> جنيه. لقد بعت بـ
              <strong>{{ r.netSales | number: '1.2-2' }}</strong>، وحققت
              <strong class="result">{{ r.operatingResult < 0 ? 'خسارة' : 'ربح' }}</strong> تشغيلية قدرها
              <strong class="result">{{ abs(r.operatingResult) | number: '1.2-2' }}</strong> جنيه لهذا اليوم.
            }
          </p>
          <p class="en-text">
            {{ r.isToday ? 'Today' : (r.date | date: 'EEE d MMM') }}, to cover your costs you
            {{ r.isToday ? 'need' : 'needed' }} to sell <strong>{{ r.breakEvenSales | money }}</strong>. You have sold
            <strong>{{ r.netSales | money }}</strong>{{ r.isToday ? ' so far' : '' }}: an operating
            <strong class="result">{{ r.operatingResult < 0 ? 'loss' : 'profit' }}</strong> of
            <strong class="result">{{ abs(r.operatingResult) | money }}</strong> for the day.
          </p>
        } @else {
          <p class="ar-text" lang="ar" dir="rtl">
            لا توجد مبيعات في هذا اليوم ولا في الأيام السبعة السابقة لحساب هامش المساهمة. نصيب اليوم من المصاريف الثابتة
            <strong>{{ r.dailyFixedCosts | number: '1.2-2' }}</strong> جنيه، فأنت تحقق <strong class="result">خسارة</strong> تشغيلية قدرها
            <strong class="result">{{ abs(r.operatingResult) | number: '1.2-2' }}</strong> جنيه لهذا اليوم.
          </p>
          <p class="en-text">
            No sales on this day nor in the seven days before to work the margin out from. The day's fixed costs are
            <strong>{{ r.dailyFixedCosts | money }}</strong>: an operating <strong class="result">loss</strong> of
            <strong class="result">{{ abs(r.operatingResult) | money }}</strong> so far.
          </p>
        }
      </section>

      @if (scale(); as g) {
        <section class="gauge-block" aria-label="Sales against the break-even">
          <div class="gauge-head">
            <span class="status-chip" [class.reached]="r.breakEvenReached">
              <mat-icon aria-hidden="true">{{ r.breakEvenReached ? 'check_circle' : 'hourglass_top' }}</mat-icon>
              @if (r.breakEvenSales === null) {
                No target yet · لا يوجد هدف بعد
              } @else if (r.breakEvenReached) {
                Break-even reached · تجاوزت نقطة التعادل
              } @else {
                Below break-even · تحت نقطة التعادل: {{ r.stillToSell | money }} still to sell · متبقي
              }
            </span>
            <span class="spacer"></span>
            <span class="label">Break-even · نقطة التعادل <app-info-tip tip="dbeTarget" /></span>
            <span class="label">Result · النتيجة <app-info-tip tip="dbeResult" /></span>
          </div>
          <div
            class="gauge"
            role="meter"
            aria-valuemin="0"
            [attr.aria-valuemax]="r.breakEvenSales ?? r.netSales"
            [attr.aria-valuenow]="r.netSales"
            [attr.aria-valuetext]="gaugeText(r)"
          >
            <div class="fill" [class.reached]="r.breakEvenReached" [style.width.%]="g.fill" [matTooltip]="'Sold · المباع: ' + (r.netSales | money)"></div>
            @if (g.marker !== null) {
              <div class="marker" [style.left.%]="g.marker" [matTooltip]="'Break-even · نقطة التعادل: ' + (r.breakEvenSales | money)">
                <span class="marker-label">{{ r.breakEvenSales | money }}</span>
              </div>
            }
          </div>
          <div class="axis">
            <span>0</span>
            <span class="sold">Sold · المباع {{ r.netSales | money }}{{ r.progressPercent === null ? '' : ' · ' + (r.progressPercent | number: '1.0-0') + '%' }}</span>
          </div>
        </section>
      }

      <div class="tiles">
        <div class="tile key">
          <span class="label">Daily fixed costs · نصيب اليوم من المصاريف الثابتة <app-info-tip tip="dbeFixed" /></span>
          <strong>{{ r.dailyFixedCosts | money }}</strong>
          <small class="chip">{{ r.monthlyFixedCosts | money }} ÷ {{ r.daysInMonth }} days</small>
        </div>
        <div class="tile key">
          <span class="label">{{ r.isToday ? "Today's" : "The day's" }} WACM · هامش المساهمة <app-info-tip tip="dbeWacm" /></span>
          <strong>{{ r.wacmPercent === null ? '—' : (r.wacmPercent | number: '1.1-1') + '%' }}</strong>
          <small class="chip">
            @if (r.wacmEstimated) {
              Last 7 days · آخر 7 أيام ({{ r.historyFrom | date: 'd MMM' }} – {{ r.historyTo | date: 'd MMM' }})
            } @else {
              {{ r.contributionMargin | money }} contribution · المساهمة
            }
          </small>
        </div>
        <div class="tile">
          <span class="label">Net sales · صافي المبيعات <app-info-tip tip="dbeSales" /></span>
          <strong>{{ r.netSales | money }}</strong>
          <small class="chip">{{ r.plates | number }} {{ r.plates === 1 ? 'plate' : 'plates' }}</small>
        </div>
        <div class="tile">
          <span class="label">Variable food cost · تكلفة الخامات <app-info-tip tip="dbeFood" /></span>
          <strong>{{ r.foodCost | money }}</strong>
          <small class="chip">{{ r.foodCostPercent === null ? 'No sales · لا مبيعات' : (r.foodCostPercent | number: '1.1-1') + '% of sales' }}</small>
        </div>
      </div>

      @if (r.monthlyFixedCosts === 0) {
        <p class="note">
          No fixed costs recorded for this month: enter its wages and overheads on the KPIs, or stand-in figures in Cost settings.
          <span class="note-ar">لا مصاريف ثابتة مسجلة لهذا الشهر.</span>
        </p>
      }
      @if (r.platesWithoutRecipe > 0) {
        <p class="note">
          {{ r.platesWithoutRecipe }} {{ r.platesWithoutRecipe === 1 ? 'plate' : 'plates' }} ({{ r.salesWithoutRecipe | money }}) sold with no recipe, at no food
          cost: the margin reads high. <span class="note-ar">أطباق بدون وصفة.</span>
        </p>
      }
      @if (r.missingPrices) {
        <p class="note">Some ingredients have no price yet: the food cost is short of them. <span class="note-ar">أسعار ناقصة.</span></p>
      }

      <details class="pools">
        <summary>
          The month's fixed costs · المصاريف الثابتة للشهر: {{ r.monthlyFixedCosts | money }}
          (labor {{ r.labor.total | money }}, overheads {{ r.overhead.total | money }})
        </summary>
        <div class="pool-lists">
          @for (pool of [{ name: 'Labor · العمالة', pool: r.labor }, { name: 'Overheads · الإيجار والمرافق والإهلاك', pool: r.overhead }]; track pool.name) {
            <div>
              <h4>{{ pool.name }}</h4>
              <ul>
                @for (p of pool.pool.parts; track p.key) {
                  <li><span>{{ p.label }} · <span lang="ar">{{ p.labelAr }}</span></span><strong>{{ p.amount | money }}</strong></li>
                } @empty {
                  <li class="muted">Nothing recorded · لا شيء مسجل</li>
                }
              </ul>
              @if (pool.pool.standInMonths.length) {
                <p class="muted small">Stand-in monthly figure from Cost settings: nothing was recorded for the month yet.</p>
              }
            </div>
          }
        </div>
      </details>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .day {
      width: 170px;
    }
    .summary {
      margin: 0 0 16px;
      padding: 16px 18px;
      border-radius: 16px;
      border: 1px solid var(--app-line);
      border-inline-start: 6px solid var(--app-warn);
      background: var(--mat-sys-surface-container-lowest);
      box-shadow: var(--app-card-shadow);

      h2 {
        margin: 0 0 8px;
        font: var(--mat-sys-title-small);
        color: var(--mat-sys-on-surface-variant);
      }
      .ar-text {
        margin: 0 0 6px;
        font: var(--mat-sys-title-large);
        line-height: 1.7;
      }
      .en-text {
        margin: 0;
        font: var(--mat-sys-body-large);
        color: var(--mat-sys-on-surface-variant);
      }
      &.profit {
        border-inline-start-color: var(--app-ok);
        .result {
          color: var(--app-ok);
        }
      }
      &.loss {
        border-inline-start-color: var(--mat-sys-error);
        .result {
          color: var(--mat-sys-error);
        }
      }
    }
    .gauge-block {
      margin: 0 0 18px;
      padding: 14px 18px 10px;
      border-radius: 16px;
      border: 1px solid var(--app-line);
      background: var(--mat-sys-surface-container-lowest);
    }
    .gauge-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px 14px;
      margin-bottom: 26px;

      .label {
        display: inline-flex;
        align-items: center;
        font: var(--mat-sys-label-medium);
        color: var(--mat-sys-on-surface-variant);
      }
    }
    .status-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 2px 10px;
      border-radius: 999px;
      font: var(--mat-sys-label-large);
      background: color-mix(in srgb, var(--app-warn) 14%, transparent);
      color: var(--app-warn);

      mat-icon {
        width: 18px;
        height: 18px;
        font-size: 18px;
      }
      &.reached {
        background: color-mix(in srgb, var(--app-ok) 14%, transparent);
        color: var(--app-ok);
      }
    }
    .gauge {
      position: relative;
      height: 22px;
      border-radius: 6px;
      background: var(--mat-sys-surface-container-high);

      .fill {
        height: 100%;
        border-radius: 6px;
        background: #d97706;
        transition: width 300ms ease;
      }
      .fill.reached {
        background: #059669;
      }
      .marker {
        position: absolute;
        top: -8px;
        bottom: -8px;
        width: 3px;
        margin-left: -1.5px;
        border-radius: 2px;
        background: var(--mat-sys-on-surface);
      }
      .marker-label {
        position: absolute;
        bottom: calc(100% + 2px);
        left: 50%;
        transform: translateX(-50%);
        white-space: nowrap;
        font: var(--mat-sys-label-medium);
        font-weight: 600;
      }
    }
    .axis {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-top: 6px;
      font: var(--mat-sys-label-medium);
      color: var(--mat-sys-on-surface-variant);

      .sold {
        font-weight: 600;
        color: var(--mat-sys-on-surface);
      }
    }
    .pools {
      margin: 0 0 14px;
      padding: 10px 14px;
      border-radius: 14px;
      border: 1px solid var(--app-line);
      background: var(--mat-sys-surface-container-lowest);

      summary {
        cursor: pointer;
      }
      .pool-lists {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        gap: 12px 24px;
        margin-top: 10px;
      }
      h4 {
        margin: 0 0 6px;
        font: var(--mat-sys-title-small);
      }
      ul {
        margin: 0;
        padding: 0;
        list-style: none;
      }
      li {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        padding: 3px 0;
        border-bottom: 1px dashed var(--app-line);
      }
    }
    .small {
      font-size: 0.85em;
    }
    @media (max-width: 600px) {
      .summary .ar-text {
        font: var(--mat-sys-title-medium);
        line-height: 1.7;
      }
    }
  `,
})
export class DailyBreakEvenPage {
  private readonly api = inject(CostingApi);
  protected readonly today = isoDay(new Date());
  protected readonly date = signal(this.today);
  protected readonly report = signal<DailyBreakEven | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly scale = computed(() => {
    const report = this.report();
    return report ? gaugeScale(report) : null;
  });

  constructor() {
    effect(() => {
      const date = this.date();
      untracked(() => void this.load(date));
    });
  }

  protected abs(value: number): number {
    return Math.abs(value);
  }

  protected pick(value: string): void {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value ?? '') && value <= this.today) {
      this.date.set(value);
    }
  }

  protected shift(days: number): void {
    const [y, m, d] = this.date().split('-').map(Number);
    const next = isoDay(new Date(y, m - 1, d + days));
    if (next <= this.today) {
      this.date.set(next);
    }
  }

  protected refresh(): void {
    void this.load(this.date());
  }

  protected gaugeText(report: DailyBreakEven): string {
    const sold = report.netSales.toFixed(2);
    return report.breakEvenSales === null
      ? `Sold ${sold}; no break-even target yet`
      : `Sold ${sold} of a ${report.breakEvenSales.toFixed(2)} break-even, ${report.breakEvenReached ? 'reached' : 'not reached yet'}`;
  }

  // Today asks the server for its own business day: the till's day can start before midnight's.
  // The latest asked wins: an answer for an earlier day, arriving after, is dropped.
  private asked = 0;

  private async load(date: string): Promise<void> {
    const asked = ++this.asked;
    this.loading.set(true);
    this.error.set(null);
    try {
      const report = await firstValueFrom(this.api.dailyBreakEven(date === this.today ? null : date));
      if (asked === this.asked) {
        this.report.set(report);
      }
    } catch (error) {
      if (asked === this.asked) {
        this.error.set(errorMessage(error, 'The daily break-even could not be worked out.'));
      }
    } finally {
      if (asked === this.asked) {
        this.loading.set(false);
      }
    }
  }
}
