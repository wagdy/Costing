import { Component, computed, input, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink, RouterLinkActive } from '@angular/router';

// One page of a section: its address (relative to the section's), its icon and its names.
// Fallback: the section's own page, open whenever none of the others is (Recipes' dishes, whose
// cards are under it too).
export interface SubNavTab {
  path: string;
  icon: string;
  en: string;
  ar: string;
  fallback?: boolean;
}

// A section's pages as one segmented bar of pills in a soft grey tray: the page open stands out as
// a white card lifted off it, the rest quiet slate. Wraps onto a second row on a wide screen when
// it must, and scrolls sideways on a phone rather than wrapping. Whatever is projected (a button
// for the section, such as New advance) sits at its end.
@Component({
  selector: 'app-sub-nav',
  imports: [MatIconModule, RouterLink, RouterLinkActive],
  template: `
    <nav class="sub-nav no-print" [attr.aria-label]="label()">
      <div class="tray">
        @for (tab of tabs(); track tab.path) {
          @if (tab.fallback) {
            <a class="pill" [routerLink]="tab.path" [class.active]="!othersActive()" [attr.aria-current]="othersActive() ? null : 'page'">
              <mat-icon>{{ tab.icon }}</mat-icon>
              <span class="en">{{ tab.en }}</span>
              <span class="ar" lang="ar">{{ tab.ar }}</span>
            </a>
          } @else {
            <a class="pill" [routerLink]="tab.path" routerLinkActive="active" ariaCurrentWhenActive="page" (isActiveChange)="activeChanged(tab.path, $event)">
              <mat-icon>{{ tab.icon }}</mat-icon>
              <span class="en">{{ tab.en }}</span>
              <span class="ar" lang="ar">{{ tab.ar }}</span>
            </a>
          }
        }
      </div>
      <div class="end"><ng-content /></div>
    </nav>
  `,
  styles: `
    .sub-nav {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 12px;
      margin-bottom: 16px;
    }
    .end:empty {
      display: none;
    }
    .end {
      margin-inline-start: auto;
    }
    .tray {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      padding: 4px;
      border-radius: 14px;
      background: var(--app-slate-100, #f1f5f9);
      box-shadow: inset 0 0 0 1px rgb(15 23 42 / 4%);
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 34px;
      padding: 0 12px;
      border-radius: 10px;
      color: var(--app-slate-600, #475569);
      font: var(--mat-sys-label-large);
      text-decoration: none;
      white-space: nowrap;
      transition:
        background-color 140ms ease,
        color 140ms ease,
        box-shadow 140ms ease;

      mat-icon {
        width: 18px;
        height: 18px;
        font-size: 18px;
        color: var(--app-slate-500, #64748b);
        transition: color 140ms ease;
      }
      .ar {
        unicode-bidi: isolate;
        font: var(--mat-sys-body-small);
        opacity: 0.8;
      }
      &:hover {
        color: var(--app-slate-900, #0f172a);
        background: rgb(255 255 255 / 55%);
      }
      &:focus-visible {
        outline: 2px solid var(--app-indigo-500, #6366f1);
        outline-offset: 1px;
      }
      &.active {
        background: #fff;
        color: var(--app-slate-900, #0f172a);
        font-weight: 600;
        box-shadow:
          0 1px 2px rgb(15 23 42 / 8%),
          0 1px 3px rgb(15 23 42 / 6%);

        mat-icon {
          color: var(--app-indigo-600, #4f46e5);
        }
      }
    }

    // On a phone, one row that scrolls: the pills keep their size.
    @media (max-width: 599.98px) {
      .sub-nav {
        flex-wrap: nowrap;
        flex-direction: column;
        align-items: stretch;
      }
      .tray {
        flex-wrap: nowrap;
        overflow-x: auto;
        scrollbar-width: none;
        scroll-snap-type: x proximity;

        &::-webkit-scrollbar {
          display: none;
        }
      }
      .pill {
        scroll-snap-align: start;
      }
      .end {
        margin-inline-start: 0;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .pill,
      .pill mat-icon {
        transition: none;
      }
    }
    @media print {
      .no-print {
        display: none !important;
      }
    }
  `,
})
export class SubNav {
  readonly label = input.required<string>();
  readonly tabs = input.required<readonly SubNavTab[]>();

  // The pages other than a fallback that are open now.
  private readonly active = signal(new Set<string>());
  protected readonly othersActive = computed(() => this.active().size > 0);

  protected activeChanged(path: string, isActive: boolean): void {
    this.active.update((active) => {
      const next = new Set(active);
      if (isActive) {
        next.add(path);
      } else {
        next.delete(path);
      }
      return next;
    });
  }
}
