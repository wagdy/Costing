import { Component, computed, input, model } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SortOption, SortState } from './smart-search';

// How a list is sorted, as a pill beside its filters: what it is sorted by, from a menu of what this
// list can be sorted by, and an arrow that turns it the other way. [(sort)] the state; choosing an
// option starts it the way that option reads best (the dearest first, A to Z).
@Component({
  selector: 'app-sort-control',
  imports: [MatIconModule, MatMenuModule, MatTooltipModule],
  template: `
    <span class="sort-control">
      <button type="button" class="by" [matMenuTriggerFor]="menu" [attr.aria-label]="'Sort by: ' + current().en">
        <mat-icon class="lead">sort</mat-icon>
        <span class="what">Sort</span>
        <span class="value">{{ current().en }}</span>
        <span class="value-ar" lang="ar">{{ current().ar }}</span>
        <mat-icon class="chevron">expand_more</mat-icon>
      </button>
      <button type="button" class="direction" (click)="flip()" [matTooltip]="sort().direction === 1 ? 'Ascending · تصاعدي' : 'Descending · تنازلي'"
        [attr.aria-label]="sort().direction === 1 ? 'Ascending: turn to descending' : 'Descending: turn to ascending'">
        <mat-icon>{{ sort().direction === 1 ? 'arrow_upward' : 'arrow_downward' }}</mat-icon>
      </button>
    </span>
    <mat-menu #menu="matMenu" class="sort-control-menu">
      @for (option of options(); track option.key) {
        <button mat-menu-item role="menuitemradio" [attr.aria-checked]="option.key === sort().key" (click)="choose(option)">
          <mat-icon>{{ option.key === sort().key ? 'check' : '' }}</mat-icon>
          <span>{{ option.en }}</span>
          <span class="option-ar" lang="ar">{{ option.ar }}</span>
        </button>
      }
    </mat-menu>
  `,
  styles: `
    :host {
      display: inline-block;
    }
    .sort-control {
      display: inline-flex;
      align-items: stretch;
      height: 40px;
      border-radius: 999px;
      border: 1px solid var(--app-line-strong);
      background: var(--mat-sys-surface-container-lowest);
      box-shadow: 0 1px 2px rgb(15 23 42 / 5%);
      overflow: hidden;
    }
    button {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      border: 0;
      background: none;
      color: var(--mat-sys-on-surface);
      font: var(--mat-sys-label-large);
      cursor: pointer;

      &:hover {
        background: var(--app-slate-100, #f1f5f9);
      }
      &:focus-visible {
        outline: 2px solid var(--mat-sys-primary);
        outline-offset: -2px;
      }
    }
    .by {
      padding-inline: 12px 6px;
    }
    .direction {
      padding-inline: 8px 10px;
      border-inline-start: 1px solid var(--app-line-strong);

      mat-icon {
        color: var(--app-indigo-600, #4f46e5);
      }
    }
    mat-icon {
      width: 20px;
      height: 20px;
      font-size: 20px;
      color: var(--mat-sys-on-surface-variant);
    }
    .what {
      color: var(--mat-sys-on-surface-variant);
      font-weight: 500;
    }
    .value {
      font-weight: 650;
    }
    .value-ar,
    .option-ar {
      unicode-bidi: isolate;
      opacity: 0.7;
      font: var(--mat-sys-body-small);
    }
    .option-ar {
      margin-inline-start: 12px;
    }
    @media (max-width: 599.98px) {
      .value-ar {
        display: none;
      }
    }
  `,
})
export class SortControl {
  readonly options = input.required<readonly SortOption[]>();
  readonly sort = model.required<SortState>();

  protected readonly current = computed(() => this.options().find((o) => o.key === this.sort().key) ?? this.options()[0]);

  // A new option starts its own way; the one chosen again keeps the way it is.
  protected choose(option: SortOption): void {
    if (option.key !== this.sort().key) {
      this.sort.set({ key: option.key, direction: option.descending ? -1 : 1 });
    }
  }

  protected flip(): void {
    this.sort.update((s) => ({ ...s, direction: s.direction === 1 ? -1 : 1 }));
  }
}
