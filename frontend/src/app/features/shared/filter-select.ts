import { Component, computed, input, model } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';

// One of a filter's choices: its value ('' for all), its name, and how many it shows.
export interface FilterOption {
  value: string;
  label: string;
  count?: number;
}

// A filter as a pill: what it filters, the choice made and how many it shows, a tick by it in
// the menu it opens. [(value)] the choice's value; '' is the first option's, all of them.
@Component({
  selector: 'app-filter-select',
  imports: [MatIconModule, MatMenuModule],
  template: `
    <button type="button" class="filter-select" [class.set]="value() !== ''" [matMenuTriggerFor]="menu" [attr.aria-label]="label() + ': ' + current().label">
      <mat-icon class="lead">{{ icon() }}</mat-icon>
      <span class="what">{{ label() }}</span>
      <span class="value" dir="auto">{{ current().label }}</span>
      @if (current().count !== undefined) {
        <span class="n">{{ current().count }}</span>
      }
      <mat-icon class="chevron">expand_more</mat-icon>
    </button>
    <mat-menu #menu="matMenu" class="filter-select-menu">
      @for (option of options(); track option.value) {
        <button mat-menu-item role="menuitemradio" [attr.aria-checked]="option.value === value()" (click)="value.set(option.value)">
          <mat-icon>{{ option.value === value() ? 'check' : '' }}</mat-icon>
          <span class="option" dir="auto">{{ option.label }}</span>
          @if (option.count !== undefined) {
            <span class="option-n">{{ option.count }}</span>
          }
        </button>
      }
    </mat-menu>
  `,
  styles: `
    :host {
      display: inline-block;
    }
    .filter-select {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      height: 40px;
      padding-inline: 12px 8px;
      border-radius: 999px;
      border: 1px solid var(--app-line-strong);
      background: var(--mat-sys-surface-container-lowest);
      color: var(--mat-sys-on-surface);
      font: var(--mat-sys-label-large);
      cursor: pointer;
      box-shadow: 0 1px 2px rgb(15 23 42 / 5%);
      transition:
        border-color 140ms ease,
        box-shadow 140ms ease;

      &:hover {
        border-color: var(--mat-sys-outline);
      }
      &:focus-visible {
        outline: 2px solid var(--mat-sys-primary);
        outline-offset: 2px;
      }
      &.set {
        border-color: color-mix(in srgb, var(--mat-sys-primary) 55%, transparent);
        background: color-mix(in srgb, var(--mat-sys-primary) 6%, var(--mat-sys-surface-container-lowest));
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
      .n {
        min-width: 22px;
        padding: 0 7px;
        border-radius: 999px;
        background: var(--mat-sys-surface-container);
        font: var(--mat-sys-label-small);
        font-weight: 700;
        line-height: 20px;
        text-align: center;
      }
    }
    // Each in its own direction: an Arabic name never runs into the number beside it.
    .option,
    .value {
      unicode-bidi: isolate;
    }
    .option-n {
      display: inline-block;
      margin-inline-start: 16px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-medium);
    }
  `,
})
export class FilterSelect {
  readonly label = input.required<string>();
  readonly icon = input('filter_list');
  readonly options = input.required<FilterOption[]>();
  readonly value = model('');

  protected readonly current = computed(() => this.options().find((o) => o.value === this.value()) ?? this.options()[0] ?? { value: '', label: '' });
}
