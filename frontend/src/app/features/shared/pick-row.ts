import { Component, computed, input } from '@angular/core';

// What a picked thing is, as its badge says it.
export type PickKind = 'material' | 'prep' | 'expense' | 'supplier' | 'menu';

const kinds: Record<PickKind, { en: string; ar: string; tone: string }> = {
  material: { en: 'Raw material', ar: 'خامة', tone: 'info' },
  prep: { en: 'Prep item', ar: 'مُصنّع', tone: 'teal' },
  expense: { en: 'Expense', ar: 'مصروف', tone: 'warn' },
  supplier: { en: 'Supplier', ar: 'مورد', tone: 'accent' },
  menu: { en: 'Menu item', ar: 'صنف منيو', tone: 'ok' },
};

// One choice in a picker's dropdown, rich enough to choose by sight: its name and code, a badge of
// what it is, the unit it is kept or bought in, a detail (its category), and what it costs now at
// the end. The cost comes formatted ("L.E 30.00 / kg").
@Component({
  selector: 'app-pick-row',
  template: `
    <span class="pick-row">
      <span class="top">
        <span class="name" dir="auto">{{ name() }}</span>
        @if (code()) {
          <span class="code">{{ code() }}</span>
        }
      </span>
      @if (cost() || priced()) {
        <span class="cost" [class.none]="!cost()">{{ cost() || 'No price' }}</span>
      }
      <span class="meta">
        <span class="tag" [class]="badge().tone">{{ badge().en }}<span class="ar" lang="ar">{{ badge().ar }}</span></span>
        @if (unit()) {
          <span class="unit">{{ unit() }}</span>
        }
        @if (detail()) {
          <span class="detail" dir="auto">{{ detail() }}</span>
        }
      </span>
    </span>
  `,
  styles: `
    :host {
      display: block;
      width: 100%;
    }
    .pick-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas:
        'top cost'
        'meta meta';
      gap: 2px 12px;
      padding: 6px 0;
      line-height: 1.3;
    }
    .top {
      grid-area: top;
      display: flex;
      align-items: baseline;
      gap: 8px;
      min-width: 0;
    }
    .name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 600;
      color: var(--mat-sys-on-surface);
    }
    .code {
      flex: none;
      color: var(--app-slate-500, #64748b);
      font: var(--mat-sys-label-small);
      font-variant-numeric: tabular-nums;
    }
    .cost {
      grid-area: cost;
      align-self: center;
      color: var(--app-slate-700, #334155);
      font: var(--mat-sys-label-large);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;

      &.none {
        color: var(--app-slate-400, #94a3b8);
      }
    }
    .meta {
      grid-area: meta;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px 8px;
      color: var(--app-slate-500, #64748b);
      font: var(--mat-sys-body-small);
    }
    .tag {
      padding: 0 8px;
      font-size: 11px;
      line-height: 18px;

      &::before {
        display: none;
      }
    }
    .unit {
      padding: 0 6px;
      border-radius: 6px;
      background: var(--app-slate-100, #f1f5f9);
      color: var(--app-slate-600, #475569);
      font-weight: 600;
    }
    .detail {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `,
})
export class PickRow {
  readonly name = input.required<string>();
  readonly code = input<string | number | null>(null);
  readonly kind = input<PickKind>('material');
  readonly unit = input<string | null>(null);
  readonly detail = input<string | null>(null);
  readonly cost = input<string | null>(null);

  protected readonly badge = computed(() => kinds[this.kind()]);
  // Stock has a price to show, or the want of one: a supplier or an expense has none to miss.
  protected readonly priced = computed(() => this.kind() === 'material' || this.kind() === 'prep');
}
