import { Component, OnInit, effect, inject, input, model } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { StockPlaces, wholeBranch } from '../../core/costing/stock.api';
import { InfoTip } from './info-tip';
import { InfoTipKey } from './info-tips';

// Where stock is put or taken (موقع المخزون), once the company keeps it in more than one place:
// the branch's locations in use, the main store chosen until another is. Nothing at all in an
// open-space shop, whose one store is every entry's. A count may take the whole branch.
@Component({
  selector: 'app-location-select',
  imports: [InfoTip, MatFormFieldModule, MatSelectModule],
  template: `
    @if (places.shown()) {
      <mat-form-field class="location-select" subscriptSizing="dynamic">
        <mat-label>{{ label() }}</mat-label>
        <mat-select [value]="value()" (selectionChange)="value.set($event.value)" [aria-label]="ariaLabel()">
          @if (wholeBranch()) {
            <mat-option [value]="whole">Whole branch · كل الفرع</mat-option>
          }
          @for (l of places.locations(); track l.id) {
            <mat-option [value]="l.id">{{ l.name }}@if (l.nameAr) { · {{ l.nameAr }}}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      @if (tip(); as key) {
        <app-info-tip [tip]="key" />
      }
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .location-select {
      min-width: 220px;
    }
  `,
})
export class LocationSelect implements OnInit {
  protected readonly places = inject(StockPlaces);
  protected readonly whole = wholeBranch;

  readonly label = input('Location · الموقع');
  readonly ariaLabel = input('Location');
  readonly wholeBranch = input(false);
  readonly tip = input<InfoTipKey | null>('stockLocation');
  // The location chosen: an id, or wholeBranch; set to the main store (or the whole branch) once
  // the locations are read, when nothing is chosen yet.
  readonly value = model<string | null>(null);

  constructor() {
    effect(() => {
      if (this.value() === null && this.places.shown()) {
        this.value.set(this.wholeBranch() ? wholeBranch : (this.places.mainStore()?.id ?? null));
      }
    });
  }

  ngOnInit(): void {
    void this.places.load();
  }
}

// The location to send: none for the whole branch, or before any is chosen.
export function locationParam(value: string | null | undefined): string | null {
  return !value || value === wholeBranch ? null : value;
}
