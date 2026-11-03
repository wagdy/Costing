import { Component, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { isoDay } from './financials';

export type Period = 'month' | 'last-month' | 'quarter' | 'year' | 'custom';

// A period's first and last days, as the API takes them, counted from `today`.
export function periodDays(period: Exclude<Period, 'custom'>, today = new Date()): { from: string; to: string } {
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const [from, to] =
    period === 'last-month'
      ? [new Date(first.getFullYear(), first.getMonth() - 1, 1), new Date(first.getFullYear(), first.getMonth(), 0)]
      : period === 'quarter'
        ? [new Date(first.getFullYear(), first.getMonth() - 2, 1), today]
        : period === 'year'
          ? [new Date(today.getFullYear(), 0, 1), today]
          : [first, today];
  return { from: isoDay(from), to: isoDay(to) };
}

// The period a report covers: this month, last month, three months, this year, or any two days.
// [(from)] and [(to)] as yyyy-mm-dd.
@Component({
  selector: 'app-period-bar',
  imports: [FormsModule, MatButtonToggleModule, MatFormFieldModule, MatInputModule],
  template: `
    <mat-button-toggle-group [value]="period()" (change)="choose($event.value)" aria-label="Period" class="periods">
      <mat-button-toggle value="month">This month <span class="ar">الشهر</span></mat-button-toggle>
      <mat-button-toggle value="last-month">Last month <span class="ar">الشهر السابق</span></mat-button-toggle>
      <mat-button-toggle value="quarter">3 months <span class="ar">٣ شهور</span></mat-button-toggle>
      <mat-button-toggle value="year">This year <span class="ar">السنة</span></mat-button-toggle>
    </mat-button-toggle-group>
    <mat-form-field subscriptSizing="dynamic" class="day">
      <mat-label>From · من</mat-label>
      <input matInput type="date" [ngModel]="from()" (ngModelChange)="custom('from', $event)" [max]="to()" aria-label="From" />
    </mat-form-field>
    <mat-form-field subscriptSizing="dynamic" class="day">
      <mat-label>To · إلى</mat-label>
      <input matInput type="date" [ngModel]="to()" (ngModelChange)="custom('to', $event)" [min]="from()" aria-label="To" />
    </mat-form-field>
  `,
  styles: `
    :host {
      display: contents;
    }
    .periods {
      flex-wrap: wrap;
    }
    .ar {
      margin-inline-start: 4px;
      font-size: 0.8em;
      opacity: 0.75;
    }
    .day {
      width: 160px;
    }
  `,
})
export class PeriodBar {
  readonly from = model.required<string>();
  readonly to = model.required<string>();
  protected readonly period = signal<Period>('month');

  protected choose(period: Exclude<Period, 'custom'>): void {
    const days = periodDays(period);
    this.period.set(period);
    this.from.set(days.from);
    this.to.set(days.to);
  }

  // Days typed in: the period is whatever they say. Cleared or half typed, it stays as it was.
  protected custom(end: 'from' | 'to', value: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) {
      return;
    }
    this.period.set('custom');
    (end === 'from' ? this.from : this.to).set(value);
  }
}
