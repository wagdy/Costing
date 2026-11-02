import { Component, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';

// A list's instant search, as a pill at the start of its toolbar: what is typed filters the list as
// it is typed (by name, Arabic name or code, as the page says), Escape or the cross clears it.
@Component({
  selector: 'app-search-field',
  imports: [FormsModule, MatIconModule],
  template: `
    <label class="search-field" [class.set]="!!value()">
      <mat-icon class="lead">search</mat-icon>
      <input type="search" [ngModel]="value()" (ngModelChange)="value.set($event ?? '')" (keydown.escape)="value.set('')"
        [placeholder]="placeholder()" [attr.aria-label]="label()" autocomplete="off" spellcheck="false" />
      @if (value()) {
        <button type="button" class="clear" (click)="value.set('')" aria-label="Clear the search"><mat-icon>close</mat-icon></button>
      }
    </label>
  `,
  styles: `
    :host {
      display: inline-block;
      flex: 1 1 260px;
      max-width: 420px;
      min-width: 200px;
    }
    .search-field {
      display: flex;
      align-items: center;
      gap: 8px;
      height: 40px;
      padding-inline: 12px 6px;
      box-sizing: border-box;
      border-radius: 999px;
      border: 1px solid var(--app-line-strong);
      background: var(--mat-sys-surface-container-lowest);
      box-shadow: 0 1px 2px rgb(15 23 42 / 5%);
      cursor: text;
      transition:
        border-color 140ms ease,
        box-shadow 140ms ease;

      &:hover {
        border-color: var(--mat-sys-outline);
      }
      &:focus-within {
        border-color: var(--app-indigo-500, #6366f1);
        box-shadow: 0 0 0 3px rgb(99 102 241 / 18%);
      }
    }
    input {
      flex: 1;
      min-width: 0;
      height: 100%;
      border: 0;
      outline: 0;
      background: none;
      color: var(--mat-sys-on-surface);
      font: var(--mat-sys-body-large);
      font-size: 15px;

      &::-webkit-search-cancel-button {
        display: none;
      }
      &::placeholder {
        color: var(--app-slate-400, #94a3b8);
      }
    }
    mat-icon {
      width: 20px;
      height: 20px;
      font-size: 20px;
      color: var(--mat-sys-on-surface-variant);
    }
    .clear {
      display: inline-flex;
      padding: 4px;
      border: 0;
      border-radius: 50%;
      background: none;
      cursor: pointer;

      &:hover {
        background: var(--app-slate-100, #f1f5f9);
      }
      mat-icon {
        width: 18px;
        height: 18px;
        font-size: 18px;
      }
    }
    @media (max-width: 599.98px) {
      :host {
        max-width: none;
        flex-basis: 100%;
      }
    }
  `,
})
export class SearchField {
  readonly value = model('');
  readonly placeholder = input('Name, Arabic name or code · الاسم أو الكود');
  readonly label = input('Search');
}
