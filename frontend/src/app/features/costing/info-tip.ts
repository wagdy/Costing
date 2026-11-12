import { CdkConnectedOverlay, CdkOverlayOrigin, ConnectedPosition } from '@angular/cdk/overlay';
import { Component, computed, input, OnDestroy, signal } from '@angular/core';
import { InfoTipContent, InfoTipKey, infoTips } from './info-tips';

let next = 0;

// The (ⓘ) beside a figure's title or a column's heading: what the figure is (الوصف) and how it is
// worked out (طريقة الحساب), in Arabic and English, so the screen itself keeps only the figures.
// It opens on hover and on focus, and on a tap for a phone; Escape, moving away or tapping outside
// closes it. The popover is the button's description, for a screen reader too.
@Component({
  selector: 'app-info-tip',
  imports: [CdkConnectedOverlay, CdkOverlayOrigin],
  template: `
    <button
      #button
      type="button"
      class="info-tip"
      cdkOverlayOrigin
      #origin="cdkOverlayOrigin"
      [attr.aria-label]="'About ' + tip().title.en + ' · ' + tip().title.ar"
      [attr.aria-expanded]="open()"
      [attr.aria-describedby]="open() ? id : null"
      (mouseenter)="show()"
      (mouseleave)="leave()"
      (focus)="show()"
      (blur)="hide()"
      (click)="toggle($event)"
      (keydown.escape)="hide()"
    >
      <span class="glyph" aria-hidden="true"></span>
    </button>
    <ng-template
      cdkConnectedOverlay
      [cdkConnectedOverlayOrigin]="origin"
      [cdkConnectedOverlayOpen]="open()"
      [cdkConnectedOverlayPositions]="positions"
      [cdkConnectedOverlayViewportMargin]="12"
      (overlayOutsideClick)="outside($event, button)"
      (overlayKeydown)="$event.key === 'Escape' && hide()"
      (detach)="hide()"
    >
      <div class="info-pop" role="tooltip" [id]="id" (mouseenter)="stay()" (mouseleave)="leave()">
        <p class="info-pop-title">{{ tip().title.en }} · <span lang="ar">{{ tip().title.ar }}</span></p>
        <section>
          <h4><span lang="ar">الوصف</span> · What it is</h4>
          <p lang="ar" dir="rtl">{{ tip().what.ar }}</p>
          <p>{{ tip().what.en }}</p>
        </section>
        <section>
          <h4><span lang="ar">طريقة الحساب</span> · How it's calculated</h4>
          <p lang="ar" dir="rtl">{{ tip().how.ar }}</p>
          <p class="formula">{{ tip().how.en }}</p>
        </section>
      </div>
    </ng-template>
  `,
  styles: `
    :host {
      display: inline-flex;
      vertical-align: middle;
    }
    .info-tip {
      display: inline-grid;
      place-items: center;
      width: 22px;
      height: 22px;
      margin-inline-start: 2px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: var(--mat-sys-on-surface-variant);
      cursor: help;
    }
    .info-tip:hover,
    .info-tip:focus-visible,
    .info-tip[aria-expanded='true'] {
      color: var(--mat-sys-primary);
      background: color-mix(in srgb, var(--mat-sys-primary) 10%, transparent);
    }
    .info-tip:focus-visible {
      outline: 2px solid var(--mat-sys-primary);
      outline-offset: 1px;
    }
    // Drawn, not a ligature: the heading's text stays its own words.
    .glyph {
      display: inline-grid;
      place-items: center;
      width: 15px;
      height: 15px;
      border: 1.5px solid currentColor;
      border-radius: 50%;
      box-sizing: border-box;
    }
    .glyph::before {
      content: 'i';
      font: 700 10px/1 Georgia, 'Times New Roman', serif;
    }
  `,
})
export class InfoTip implements OnDestroy {
  // A tip of the dictionary by its key, or one made on the spot (a KPI's, from its own definition).
  readonly key = input.required<InfoTipKey | InfoTipContent>({ alias: 'tip' });

  protected readonly tip = computed(() => {
    const key = this.key();
    return typeof key === 'string' ? infoTips[key] : key;
  });
  protected readonly open = signal(false);
  protected readonly id = `info-tip-${++next}`;
  protected readonly positions: ConnectedPosition[] = [
    { originX: 'center', originY: 'bottom', overlayX: 'center', overlayY: 'top', offsetY: 6 },
    { originX: 'center', originY: 'top', overlayX: 'center', overlayY: 'bottom', offsetY: -6 },
    { originX: 'end', originY: 'center', overlayX: 'start', overlayY: 'center', offsetX: 6 },
    { originX: 'start', originY: 'center', overlayX: 'end', overlayY: 'center', offsetX: -6 },
  ];
  private timer: ReturnType<typeof setTimeout> | null = null;
  // Opened by a tap or a click: it stays until closed, not on the pointer leaving.
  private pinned = false;

  protected show(): void {
    this.stay();
    this.open.set(true);
  }

  protected stay(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  // A moment's grace, to move the pointer onto the popover to read it.
  protected leave(): void {
    if (this.pinned) {
      return;
    }
    this.stay();
    this.timer = setTimeout(() => this.open.set(false), 150);
  }

  protected toggle(event: Event): void {
    // In a table heading, or a clickable card: the tip is not a click on what is under it.
    event.stopPropagation();
    this.pinned = !(this.open() && this.pinned);
    this.open.set(this.pinned);
  }

  // A click outside it closes it; one on its own button is the button's to toggle.
  protected outside(event: MouseEvent, button: HTMLElement): void {
    if (!(event.target instanceof Node && button.contains(event.target))) {
      this.hide();
    }
  }

  protected hide(): void {
    this.stay();
    this.pinned = false;
    this.open.set(false);
  }

  ngOnDestroy(): void {
    this.stay();
  }
}
