import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';
import { CostingApi, TreasuryAnalytics, TreasuryFlowLine } from '../../core/costing/costing.api';
import { errorMessage } from '../../core/http/error-message';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { isoDay } from './financials';
import { PieSlice, SpendingPie } from './spending-pie';

type Period = 'month' | 'last-month' | 'quarter' | 'year' | 'custom';

// Safe & treasury analytics (تحليل الخزنة والتدفقات النقدية) over any period, counted as the Safe tab's
// strip counts a month. Where the money came from (cash and Visa sales, the tax collected on them,
// the balance it opened with, funding) and where it went (suppliers, expense vouchers by category,
// the staff, the tax paid over), each a pie and a table of amounts and shares; the tax held for the
// tax authority, collected less paid over; and day by day, in, out, the net, the balance after it
// and the voids with why.
@Component({
  selector: 'app-treasury-page',
  imports: [
    DatePipe,
    FormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MoneyPipe,
    SpendingPie,
  ],
  template: `
    <div class="toolbar">
      <mat-button-toggle-group [value]="period()" (change)="choose($event.value)" aria-label="Period" class="periods">
        <mat-button-toggle value="month">This month</mat-button-toggle>
        <mat-button-toggle value="last-month">Last month</mat-button-toggle>
        <mat-button-toggle value="quarter">3 months</mat-button-toggle>
        <mat-button-toggle value="year">This year</mat-button-toggle>
      </mat-button-toggle-group>
      <mat-form-field subscriptSizing="dynamic" class="day">
        <mat-label>From · من</mat-label>
        <input matInput type="date" [ngModel]="from()" (ngModelChange)="custom('from', $event)" [max]="to()" />
      </mat-form-field>
      <mat-form-field subscriptSizing="dynamic" class="day">
        <mat-label>To · إلى</mat-label>
        <input matInput type="date" [ngModel]="to()" (ngModelChange)="custom('to', $event)" [min]="from()" />
      </mat-form-field>
      <span class="spacer"></span>
      <button mat-button (click)="exportCsv()" [disabled]="!report()"><mat-icon>download</mat-icon> CSV</button>
      <button mat-button (click)="print()" [disabled]="!report()"><mat-icon>print</mat-icon> Print</button>
    </div>
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    @if (error()) {
      <p class="error">{{ error() }}</p>
    } @else if (report(); as r) {
      <header class="report-head">
        <h2>Safe &amp; treasury analytics <span class="inline-ar">تحليل الخزنة والتدفقات النقدية</span></h2>
        <div class="muted">
          {{ r.from | date: 'd MMM y' }} – {{ r.to | date: 'd MMM y' }} · the safe's ledger, each entry on its own date; an entry voided in these days
          and its void left out
        </div>
      </header>
      <div class="tiles">
        <div class="tile">
          <span class="label">Opening balance · الرصيد الافتتاحي</span>
          <strong>{{ r.openingBalance | money }}</strong>
          <small class="muted">brought forward</small>
        </div>
        <div class="tile">
          <span class="label">Total in · إجمالي الوارد</span>
          <strong class="in">{{ r.totalIn | money }}</strong>
          <small class="muted">with the opening balance</small>
        </div>
        <div class="tile">
          <span class="label">Total out · إجمالي المنصرف</span>
          <strong class="out">{{ r.totalOut | money }}</strong>
        </div>
        <div class="tile">
          <span class="label">Net cash flow · صافي التدفق النقدي</span>
          <strong [class.negative]="r.netFlow < 0">{{ r.netFlow | money }}</strong>
          <small class="muted">in less out, in these days</small>
        </div>
        <div class="tile key">
          <span class="label">Closing balance · الرصيد الختامي</span>
          <strong [class.negative]="r.closingBalance < 0">{{ r.closingBalance | money }}</strong>
        </div>
      </div>

      <div class="pies">
        <app-spending-pie
          heading="Where it came from"
          headingAr="تحليل مصادر الوارد"
          [slices]="inflowSlices()"
          shareOf="of all that came in"
          empty="Nothing came into the safe in these days."
        />
        <app-spending-pie
          heading="Where it went"
          headingAr="تحليل أوجه الصرف"
          [slices]="outflowSlices()"
          shareOf="of all that went out"
          empty="Nothing went out of the safe in these days."
        />
      </div>

      <div class="breakdowns">
        <section aria-labelledby="inflows-title">
          <h3 id="inflows-title">Inflow breakdown <span class="inline-ar">تحليل مصادر الوارد</span></h3>
          <div class="table-wrap">
            <table class="grid flows">
              <thead>
                <tr>
                  <th>Source<span class="ar">المصدر</span></th>
                  <th class="num">Amount<span class="ar">المبلغ</span></th>
                  <th class="num">Share<span class="ar">النسبة</span></th>
                </tr>
              </thead>
              <tbody>
                @for (line of r.inflows; track line.key) {
                  <tr>
                    <td>{{ line.en }} <span class="ar">{{ line.ar }}</span></td>
                    <td class="num">{{ line.amount | money }}</td>
                    <td class="num">{{ share(line) }}</td>
                  </tr>
                  @for (item of line.items; track item.key) {
                    <tr class="item">
                      <td>{{ item.en }} <span class="ar">{{ item.ar }}</span></td>
                      <td class="num">{{ item.amount | money }}</td>
                      <td class="num">{{ share(item) }}</td>
                    </tr>
                  }
                }
              </tbody>
              <tfoot>
                <tr>
                  <td>Total in · إجمالي الوارد</td>
                  <td class="num">{{ r.totalIn | money }}</td>
                  <td class="num">{{ r.totalIn ? '100%' : '' }}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <section aria-labelledby="outflows-title">
          <h3 id="outflows-title">Outflow breakdown <span class="inline-ar">تحليل أوجه الصرف</span></h3>
          <div class="table-wrap">
            <table class="grid flows">
              <thead>
                <tr>
                  <th>Paid for<span class="ar">أوجه الصرف</span></th>
                  <th class="num">Amount<span class="ar">المبلغ</span></th>
                  <th class="num">Share<span class="ar">النسبة</span></th>
                </tr>
              </thead>
              <tbody>
                @for (line of r.outflows; track line.key) {
                  <tr>
                    <td>{{ line.en }} <span class="ar">{{ line.ar }}</span></td>
                    <td class="num">{{ line.amount | money }}</td>
                    <td class="num">{{ share(line) }}</td>
                  </tr>
                  @for (item of line.items; track item.key) {
                    @if (item.amount) {
                      <tr class="item">
                        <td>{{ item.en }} <span class="ar">{{ item.ar }}</span></td>
                        <td class="num">{{ item.amount | money }}</td>
                        <td class="num">{{ share(item) }}</td>
                      </tr>
                    }
                  }
                }
              </tbody>
              <tfoot>
                <tr>
                  <td>Total out · إجمالي المنصرف</td>
                  <td class="num">{{ r.totalOut | money }}</td>
                  <td class="num">{{ r.totalOut ? '100%' : '' }}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      </div>

      <section class="tax-card" aria-labelledby="tax-title">
        <h3 id="tax-title">Tax liability reconciliation <span class="inline-ar">موقف التسوية الضريبية</span></h3>
        <p class="muted small">To {{ r.to | date: 'd MMM y' }}: the tax every day's takings collected, less what was paid over by tax payments.</p>
        <dl class="equation">
          <div>
            <dt>Total tax collected in the safe <span class="ar">إجمالي الضريبة المحصلة بالخزنة</span></dt>
            <dd>{{ r.taxToDate.collected | money }}</dd>
          </div>
          <div>
            <dt>Less tax paid via vouchers <span class="ar">المسدد بأذون الصرف</span></dt>
            <dd>({{ r.taxToDate.paid | money }})</dd>
          </div>
          <div class="result">
            <dt>Remaining unpaid tax liability in the safe <span class="ar">رصيد الضريبة المتبقي بالخزنة</span></dt>
            <dd [class.negative]="r.taxToDate.owed < 0">{{ r.taxToDate.owed | money }}</dd>
          </div>
        </dl>
        <p class="muted small">
          In these days: {{ r.taxCollected | money }} collected, {{ r.taxPaid | money }} paid over.
          @if (r.taxToDate.owed < 0) {
            More has been paid over than the takings collected: tax from before the treasury, or a payment entered twice.
          }
        </p>
      </section>

      <section aria-labelledby="days-title">
        <h3 id="days-title">Daily cash flow &amp; voids <span class="inline-ar">حركة التدفق اليومي والفويد</span></h3>
        <div class="table-wrap">
          <table class="grid days">
            <thead>
              <tr>
                <th>Day<span class="ar">اليوم</span></th>
                <th class="num">Total in<span class="ar">إجمالي الوارد</span></th>
                <th class="num">Total out<span class="ar">إجمالي المنصرف</span></th>
                <th class="num">Net daily cash flow<span class="ar">صافي التدفق اليومي</span></th>
                <th class="num">Running safe balance<span class="ar">رصيد الخزنة</span></th>
                <th class="num">Voids<span class="ar">الفويد</span></th>
                <th>Void reasons<span class="ar">أسباب الفويد</span></th>
              </tr>
            </thead>
            <tbody>
              <tr class="opening">
                <td colspan="4">Brought forward · رصيد مرحل</td>
                <td class="num">{{ r.openingBalance | money }}</td>
                <td colspan="2"></td>
              </tr>
              @for (d of r.days; track d.date) {
                <tr>
                  <td class="nowrap">{{ d.date | date: 'EEE d MMM' }}</td>
                  <td class="num in">{{ d.in ? (d.in | money) : '' }}</td>
                  <td class="num out">{{ d.out ? (d.out | money) : '' }}</td>
                  <td class="num" [class.negative]="d.net < 0">{{ d.net | money }}</td>
                  <td class="num" [class.negative]="d.balance < 0">{{ d.balance | money }}</td>
                  <td class="num">{{ d.voids ? (d.voids | money) : '' }}</td>
                  <td class="reasons">{{ d.voidReasons.join(' · ') }}</td>
                </tr>
              } @empty {
                <tr><td colspan="7" class="muted">Nothing in or out of the safe in these days.</td></tr>
              }
            </tbody>
            <tfoot>
              <tr>
                <td>Total · الإجمالي</td>
                <td class="num">{{ dayTotals().in | money }}</td>
                <td class="num">{{ dayTotals().out | money }}</td>
                <td class="num" [class.negative]="r.netFlow < 0">{{ r.netFlow | money }}</td>
                <td class="num">{{ r.closingBalance | money }}</td>
                <td class="num">{{ r.voids | money }}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .periods {
      flex-wrap: wrap;
    }
    .day {
      width: 160px;
    }
    .report-head {
      margin-bottom: 12px;

      h2 {
        margin: 0 0 4px;
        font: var(--mat-sys-title-large);
      }
    }
    h3 {
      margin: 0 0 8px;
      font: var(--mat-sys-title-small);
    }
    section {
      margin-bottom: 16px;
    }
    .tile small {
      font-size: 12px;
    }
    .in {
      color: var(--app-ok);
    }
    .out,
    .negative {
      color: var(--mat-sys-error);
    }
    .small {
      font-size: 0.85em;
    }
    .nowrap {
      white-space: nowrap;
    }
    .pies {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 8px;
      margin-bottom: 16px;
    }
    .breakdowns {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
      gap: 0 16px;
    }
    .flows {
      .ar {
        display: inline;
        margin-inline-start: 6px;
      }
      tr.item td:first-child {
        padding-inline-start: 28px;
        color: var(--mat-sys-on-surface-variant);
      }
    }
    .tax-card {
      max-width: 640px;
      padding: 12px 16px;
      border-radius: 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface);
    }
    .equation {
      display: grid;
      gap: 6px;
      margin: 8px 0;

      div {
        display: flex;
        justify-content: space-between;
        gap: 16px;
      }
      dt,
      dd {
        margin: 0;
      }
      dt .ar {
        margin-inline-start: 6px;
        opacity: 0.75;
        font-size: 0.85em;
      }
      dd {
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .result {
        padding-top: 6px;
        border-top: 1px solid var(--mat-sys-outline-variant);
        font-weight: 600;
      }
    }
    .days {
      tr.opening td {
        background: var(--mat-sys-surface-container);
        font-weight: 500;
      }
      .reasons {
        min-width: 180px;
        color: var(--mat-sys-on-surface-variant);
      }
    }
    @media print {
      .toolbar {
        display: none;
      }
    }
  `,
})
export class TreasuryPage {
  private readonly api = inject(CostingApi);

  protected readonly period = signal<Period>('month');
  protected readonly from = signal(isoDay(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  protected readonly to = signal(isoDay(new Date()));
  protected readonly report = signal<TreasuryAnalytics | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  // The pies: each line in, and each line out, in the palette's order.
  protected readonly inflowSlices = computed<PieSlice[]>(() => (this.report()?.inflows ?? []).map(TreasuryPage.slice));
  protected readonly outflowSlices = computed<PieSlice[]>(() => (this.report()?.outflows ?? []).map(TreasuryPage.slice));

  // The days' in and out together; the net and the balance are the report's own.
  protected readonly dayTotals = computed(() => {
    const days = this.report()?.days ?? [];
    return { in: days.reduce((sum, d) => sum + d.in, 0), out: days.reduce((sum, d) => sum + d.out, 0) };
  });

  constructor() {
    effect(() => {
      const from = this.from();
      const to = this.to();
      untracked(() => void this.load(from, to));
    });
  }

  protected choose(period: Period): void {
    const today = new Date();
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    const [from, to] =
      period === 'last-month'
        ? [new Date(first.getFullYear(), first.getMonth() - 1, 1), new Date(first.getFullYear(), first.getMonth(), 0)]
        : period === 'quarter'
          ? [new Date(first.getFullYear(), first.getMonth() - 2, 1), today]
          : period === 'year'
            ? [new Date(today.getFullYear(), 0, 1), today]
            : [first, today];
    this.period.set(period);
    this.from.set(isoDay(from));
    this.to.set(isoDay(to));
  }

  // Days typed in: the period is whatever they say. Cleared or half typed, it stays as it was.
  protected custom(end: 'from' | 'to', value: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) {
      return;
    }
    this.period.set('custom');
    (end === 'from' ? this.from : this.to).set(value);
  }

  protected share(line: TreasuryFlowLine): string {
    return line.sharePercent === null ? '' : `${line.sharePercent.toFixed(1)}%`;
  }

  protected print(): void {
    window.print();
  }

  // For a spreadsheet: a byte order mark so Excel reads the Arabic as UTF-8. Where it came from and
  // went, then day by day.
  protected exportCsv(): void {
    const r = this.report();
    if (!r) {
      return;
    }
    const rows: (string | number)[][] = [['Section', 'Line · البند', 'Amount', 'Share %']];
    const flows = (section: string, lines: TreasuryFlowLine[], depth = 0): void => {
      for (const line of lines) {
        rows.push([section, `${'  '.repeat(depth)}${line.en}${line.ar ? ' · ' + line.ar : ''}`, line.amount.toFixed(2), line.sharePercent?.toFixed(1) ?? '']);
        flows(section, line.items, depth + 1);
      }
    };
    flows('In', r.inflows);
    rows.push(['In', 'Total in', r.totalIn.toFixed(2), '100.0']);
    flows('Out', r.outflows);
    rows.push(['Out', 'Total out', r.totalOut.toFixed(2), '100.0']);
    rows.push(['Tax', 'Collected to date', r.taxToDate.collected.toFixed(2), '']);
    rows.push(['Tax', 'Paid over to date', r.taxToDate.paid.toFixed(2), '']);
    rows.push(['Tax', 'Still owed', r.taxToDate.owed.toFixed(2), '']);
    rows.push([]);
    rows.push(['Day · اليوم', 'Total in', 'Total out', 'Net', 'Balance', 'Voids', 'Void reasons']);
    rows.push(['Brought forward', '', '', '', r.openingBalance.toFixed(2), '', '']);
    for (const d of r.days) {
      rows.push([d.date, d.in.toFixed(2), d.out.toFixed(2), d.net.toFixed(2), d.balance.toFixed(2), d.voids.toFixed(2), d.voidReasons.join(' · ')]);
    }
    const csv = rows.map((cells) => cells.map(TreasuryPage.cell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `treasury-analytics-${r.from}-to-${r.to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  private async load(from: string, to: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const report = await firstValueFrom(this.api.treasuryAnalytics(from, to));
      // Moved on while it loaded: what came back is for other days.
      if (this.from() === from && this.to() === to) {
        this.report.set(report);
      }
    } catch (error) {
      this.report.set(null);
      this.error.set(errorMessage(error, 'The safe’s analysis could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }

  private static slice(line: TreasuryFlowLine): PieSlice {
    return { key: line.key, en: line.en, ar: line.ar, amount: line.amount };
  }

  private static cell(value: string | number): string {
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }
}
