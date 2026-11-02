import { Component, computed, effect, input, model, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { PickKind, PickRow } from './pick-row';
import { searchable, smartMatch } from './smart-search';

// How many matches the dropdown lists before asking for more to be typed.
const shownMatches = 40;

// One thing a picker offers: its id, its name and code, what it is, the unit it is kept or bought
// in, a detail (its category), what it costs now (formatted), and other words it is found by (its
// Arabic name).
export interface PickItem {
  id: string;
  name: string;
  code?: string | number | null;
  kind: PickKind;
  unit?: string | null;
  detail?: string | null;
  cost?: string | null;
  keywords?: readonly (string | null | undefined)[];
}

// The items matching what is typed, the closest first: its code exactly, then a name that starts
// with it, then the rest by name.
export function pickMatches<T extends PickItem>(items: readonly T[], text: string): T[] {
  const typed = searchable(text);
  const rank = (i: T) => (!typed ? 2 : searchable(i.code) === typed ? 0 : searchable(i.name).startsWith(typed) ? 1 : 2);
  return items
    .filter((i) => smartMatch(text, i.name, i.code, i.detail, ...(i.keywords ?? [])))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

// One thing chosen by typing: its first letters or its code find it, the dropdown shows each as a
// rich row (PickRow), and arrows and Enter choose without the mouse. [(value)] the chosen one's id.
// canCreate: offers to add one of the name typed when none is called that (create, with the name;
// the page sets value to it once it is added).
@Component({
  selector: 'app-item-picker',
  imports: [FormsModule, MatAutocompleteModule, MatFormFieldModule, MatIconModule, MatInputModule, PickRow],
  template: `
    <mat-form-field subscriptSizing="dynamic" class="picker">
      <mat-icon matPrefix class="lead">search</mat-icon>
      <input matInput [matAutocomplete]="auto" [ngModel]="text()" (ngModelChange)="typed($event)" (focus)="selectAll($event)" (blur)="settle()"
        [disabled]="disabled()"
        [placeholder]="placeholder()" [attr.aria-label]="label()" autocomplete="off" />
      <mat-autocomplete #auto="matAutocomplete" panelClass="pick-panel" [panelWidth]="460" [autoActiveFirstOption]="true" (optionSelected)="chosen($event.option.value)">
        @for (i of matches().shown; track i.id) {
          <mat-option [value]="i.id">
            <app-pick-row [name]="i.name" [code]="i.code ?? null" [kind]="i.kind" [unit]="i.unit ?? null" [detail]="i.detail ?? null" [cost]="i.cost ?? null" />
          </mat-option>
        }
        @if (matches().more) {
          <mat-option disabled class="more">{{ matches().more }} more: keep typing · اكتب للمزيد</mat-option>
        }
        @if (newName(); as name) {
          <mat-option [value]="createValue" class="add-new">
            <mat-icon>add</mat-icon> {{ createLabel() }}: “{{ name }}”
          </mat-option>
        } @else if (!matches().shown.length) {
          <mat-option disabled>No match · لا نتائج</mat-option>
        }
      </mat-autocomplete>
    </mat-form-field>
  `,
  styles: `
    :host {
      display: block;
    }
    .picker {
      width: 100%;
    }
    .lead {
      color: var(--app-slate-400, #94a3b8);
    }
  `,
})
export class ItemPicker {
  readonly items = input.required<readonly PickItem[]>();
  readonly value = model<string | null>(null);
  readonly label = input('Item');
  readonly placeholder = input('Type a name or code · اكتب الاسم أو الكود');
  readonly canCreate = input(false);
  readonly createLabel = input('Add new');
  readonly disabled = input(false);
  readonly create = output<string>();

  protected readonly createValue = '+new';
  protected readonly text = signal('');

  protected readonly matches = computed(() => {
    // The one chosen shows as itself: everything is offered until something else is typed.
    const found = pickMatches(this.items(), this.text() === this.labelOf(this.value()) ? '' : this.text());
    return { shown: found.slice(0, shownMatches), more: Math.max(0, found.length - shownMatches) };
  });

  // The name typed, when nothing is called that: it can be added.
  protected readonly newName = computed(() => {
    const name = this.text().trim();
    if (!this.canCreate() || !name || name === this.labelOf(this.value())) {
      return null;
    }
    const key = searchable(name);
    return this.items().some((i) => searchable(i.name) === key) ? null : name;
  });

  constructor() {
    // The one chosen, named in the field: when it is chosen here, or set from outside.
    effect(() => {
      const label = this.labelOf(this.value());
      untracked(() => this.text.set(label));
    });
  }

  // Focused, the name chosen is selected: typing looks for another from scratch.
  protected selectAll(event: FocusEvent): void {
    (event.target as HTMLInputElement).select();
  }

  protected typed(text: string | null): void {
    this.text.set(text ?? '');
  }

  protected chosen(id: string): void {
    if (id === this.createValue) {
      const name = this.text().trim();
      this.text.set(this.labelOf(this.value()));
      this.create.emit(name);
      return;
    }
    this.value.set(id);
    this.text.set(this.labelOf(id));
  }

  // Left without choosing: back to the one chosen, so what shows is always what counts.
  protected settle(): void {
    setTimeout(() => {
      if (this.text() !== this.labelOf(this.value())) {
        this.text.set(this.labelOf(this.value()));
      }
    }, 200);
  }

  private labelOf(id: string | null): string {
    const item = id ? this.items().find((i) => i.id === id) : undefined;
    return item ? (item.code !== null && item.code !== undefined && item.code !== '' ? `${item.code} · ${item.name}` : item.name) : '';
  }
}
