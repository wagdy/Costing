import { Component, computed, input } from '@angular/core';
import { SafeEntry } from '../../core/costing/costing.api';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { entryTax } from './financials';

// A day's takings on a ledger line, as badges: the cash and the Visa before tax, the tax collected
// on them (at the till's rate, when it was worked out at it), the net sales they come to, and what
// was paid straight out of them before they went into the safe. Nothing for any other entry.
@Component({
  selector: 'app-takings-badges',
  imports: [MoneyPipe],
  template: `
    @if (figures(); as t) {
      <span class="badges">
        <span class="chip cash">Cash <span class="ar">كاش</span> <b>{{ t.cash | money }}</b></span>
        <span class="chip visa">Visa <span class="ar">فيزا</span> <b>{{ t.card | money }}</b></span>
        <span class="chip tax"
          >Tax <span class="ar">ضريبة</span> <b>{{ t.tax | money }}</b>{{ t.percent !== null ? ' at ' + t.percent + '%' : '' }}</span
        >
        <span class="chip net">Net sales <span class="ar">صافي المبيعات</span> <b>{{ t.net | money }}</b></span>
        @if (t.paidOut) {
          <span class="chip paid">Paid out of it <span class="ar">منصرف منه</span> <b>{{ t.paidOut | money }}</b></span>
        }
      </span>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .badges {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 6px;
      margin-top: 4px;
    }
    .chip {
      display: inline-flex;
      align-items: baseline;
      gap: 4px;
      padding: 1px 8px;
      border-radius: 999px;
      border: 1px solid var(--app-slate-200, #e2e8f0);
      background: var(--app-slate-50, #f8fafc);
      color: var(--app-slate-600, #475569);
      font-size: 12px;
      line-height: 20px;
      white-space: nowrap;

      b {
        color: var(--app-slate-800, #1e293b);
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }
      .ar {
        opacity: 0.75;
        font-size: 11px;
      }
    }
    .chip.net {
      border-color: color-mix(in srgb, var(--mat-sys-primary) 35%, transparent);
      background: color-mix(in srgb, var(--mat-sys-primary) 8%, transparent);
    }
    .chip.tax {
      border-color: color-mix(in srgb, var(--app-warn) 40%, transparent);
      background: color-mix(in srgb, var(--app-warn) 8%, transparent);
    }
  `,
})
export class TakingsBadges {
  readonly entry = input.required<SafeEntry>();
  protected readonly figures = computed(() => entryTax(this.entry()));
}
