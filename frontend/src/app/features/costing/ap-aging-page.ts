import { DatePipe } from '@angular/common';
import { Component, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';
import { ApAgingReport, ApAgingRow, CostingApi } from '../../core/costing/costing.api';
import { errorMessage } from '../../core/http/error-message';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { isoDay } from './financials';
import { InfoTip } from './info-tip';
import { showSupplierStatement } from './supplier-statement-dialog';

type Bucket = 'current' | 'days1To30' | 'days31To60' | 'days61To90' | 'over90';

const buckets: { key: Bucket; en: string; ar: string }[] = [
  { key: 'current', en: 'Current (not due)', ar: 'غير مستحق' },
  { key: 'days1To30', en: '1–30 days', ar: '1–30 يوم' },
  { key: 'days31To60', en: '31–60 days', ar: '31–60 يوم' },
  { key: 'days61To90', en: '61–90 days', ar: '61–90 يوم' },
  { key: 'over90', en: '90+ days', ar: 'أكثر من 90 يوم' },
];

// Accounts payable aging (تقرير أعمار ديون الموردين وتخطيط السيولة): what is owed to each supplier
// on a day, by how long past its due date (its payment terms after the invoice), the total split
// the same way, to plan the week's cash and pay the oldest first. A supplier opens its statement.
@Component({
  selector: 'app-ap-aging-page',
  imports: [DatePipe, FormsModule, InfoTip, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressBarModule, MoneyPipe],
  template: `
    <div class="toolbar">
      <mat-form-field subscriptSizing="dynamic" class="day">
        <mat-label>Owed on · في يوم</mat-label>
        <input matInput type="date" [ngModel]="asOf()" (ngModelChange)="pick($event)" [max]="today" aria-label="Owed on" />
      </mat-form-field>
      <span class="spacer"></span>
    </div>
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    @if (error()) {
      <p class="error">{{ error() }}</p>
    } @else if (report(); as r) {
      <div class="tiles">
        <div class="tile key">
          <span class="label">Total AP liability · إجمالي المديونيات <app-info-tip tip="apTotal" /></span>
          <strong>{{ r.totalOwed | money }}</strong>
          <small class="chip">{{ r.rows.length }} {{ r.rows.length === 1 ? 'supplier' : 'suppliers' }}</small>
        </div>
        @for (b of buckets; track b.key) {
          <div class="tile" [class.late]="b.key !== 'current' && r[b.key] > 0" [class.oldest]="b.key === 'over90' && r.over90 > 0">
            <span class="label">
              {{ b.en }} · {{ b.ar }}
              <app-info-tip [tip]="b.key === 'current' ? 'apCurrent' : 'apPastDue'" />
            </span>
            <strong>{{ r[b.key] | money }}</strong>
            <small class="chip">{{ share(r[b.key], r.totalOwed) }}</small>
          </div>
        }
      </div>
      <div class="aging-bar" role="img" [attr.aria-label]="barLabel(r)">
        @for (b of buckets; track b.key) {
          @if (r[b.key] > 0) {
            <span [class]="b.key" [style.flex-grow]="r[b.key]" [title]="b.en + ': ' + (r[b.key] | money)"></span>
          }
        }
      </div>

      <div class="table-wrap">
        <table class="grid aging">
          <thead>
            <tr>
              <th>Supplier<span class="ar">المورد</span></th>
              <th class="num">Total owed<span class="ar">إجمالي المستحق</span></th>
              @for (b of buckets; track b.key) {
                <th class="num">{{ b.en }}<span class="ar">{{ b.ar }}</span></th>
              }
              <th>Oldest due<span class="ar">أقدم استحقاق</span></th>
            </tr>
          </thead>
          <tbody>
            @for (row of r.rows; track row.supplierId) {
              <tr class="clickable" (click)="statement(row)" tabindex="0" (keydown.enter)="statement(row)">
                <td>
                  <strong>{{ row.supplier }}</strong>
                  <div class="muted small">pays in {{ row.paymentTermsDays }} {{ row.paymentTermsDays === 1 ? 'day' : 'days' }} · {{ row.openInvoices }} open</div>
                </td>
                <td class="num strong">{{ row.totalOwed | money }}</td>
                @for (b of buckets; track b.key) {
                  <td class="num" [class.late]="b.key !== 'current' && row[b.key] > 0">{{ row[b.key] ? (row[b.key] | money) : '—' }}</td>
                }
                <td class="nowrap">{{ row.oldestDueDate ? (row.oldestDueDate | date: 'd MMM y') : '—' }}</td>
              </tr>
            } @empty {
              <tr><td colspan="8" class="muted">Nothing is owed to any supplier on this day.</td></tr>
            }
          </tbody>
          @if (r.rows.length) {
            <tfoot>
              <tr>
                <td>Total · الإجمالي</td>
                <td class="num">{{ r.totalOwed | money }}</td>
                @for (b of buckets; track b.key) {
                  <td class="num">{{ r[b.key] | money }}</td>
                }
                <td></td>
              </tr>
            </tfoot>
          }
        </table>
      </div>
      <p class="muted small">A supplier opens its statement of account. Payments settle what was owed before the treasury first, then the oldest invoices.</p>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .day {
      width: 170px;
    }
    .tiles {
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    }
    .chip {
      justify-self: start;
      padding: 0 8px;
      border-radius: 999px;
      font: var(--mat-sys-label-small);
      background: var(--mat-sys-surface-container-high);
    }
    .tile.late strong {
      color: var(--app-warn);
    }
    .tile.oldest {
      border-color: color-mix(in srgb, var(--mat-sys-error) 45%, transparent);
      strong {
        color: var(--mat-sys-error);
      }
    }
    td.late {
      color: var(--app-warn);
      font-weight: 600;
    }
    .aging-bar {
      display: flex;
      gap: 2px;
      height: 12px;
      margin: -6px 0 16px;

      span {
        height: 100%;
        min-width: 3px;
      }
      span:first-child {
        border-radius: 4px 0 0 4px;
      }
      span:last-child {
        border-radius: 0 4px 4px 0;
      }
      .current {
        background: #94a3b8;
      }
      .days1To30 {
        background: #fbbf24;
      }
      .days31To60 {
        background: #f59e0b;
      }
      .days61To90 {
        background: #ea580c;
      }
      .over90 {
        background: #dc2626;
      }
    }
    tr.clickable {
      cursor: pointer;
    }
    tfoot td {
      font-weight: 600;
    }
    .small {
      font-size: 0.85em;
    }
  `,
})
export class ApAgingPage {
  private readonly api = inject(CostingApi);
  private readonly dialog = inject(MatDialog);
  protected readonly buckets = buckets;
  protected readonly today = isoDay(new Date());
  protected readonly asOf = signal(this.today);
  protected readonly report = signal<ApAgingReport | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    effect(() => {
      const asOf = this.asOf();
      untracked(() => void this.load(asOf));
    });
  }

  protected pick(value: string): void {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value ?? '') && value <= this.today) {
      this.asOf.set(value);
    }
  }

  protected share(part: number, whole: number): string {
    return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—';
  }

  protected barLabel(report: ApAgingReport): string {
    return buckets.map((b) => `${b.en} ${report[b.key].toFixed(2)}`).join(', ');
  }

  protected statement(row: ApAgingRow): void {
    showSupplierStatement(this.dialog, row.supplierId, row.supplier);
  }

  // Today asks the server for its own business day.
  private async load(asOf: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.report.set(await firstValueFrom(this.api.apAging(asOf === this.today ? null : asOf)));
    } catch (error) {
      this.error.set(errorMessage(error, 'The AP aging could not be worked out.'));
    } finally {
      this.loading.set(false);
    }
  }
}
