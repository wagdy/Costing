import { Component, DestroyRef, ElementRef, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Observable, firstValueFrom } from 'rxjs';
import { errorMessage } from '../../core/http/error-message';
import { saveBlob } from '../../core/ui/save-blob';

// How a photo is fetched, or the file chosen on this device.
export type PhotoSource = (() => Observable<Blob>) | File;

async function blobOf(source: PhotoSource): Promise<Blob> {
  return source instanceof File ? source : firstValueFrom(source());
}

const zoomSteps = [0.5, 0.75, 1, 1.5, 2, 3, 4];

// A photo handed in, shown to be read and typed from: as wide as where it is shown, zoomed in and
// out, dragged about when it is bigger, a quarter turn at a time for one taken sideways; full size
// over the page, or saved. A PDF in the browser's own viewer.
@Component({
  selector: 'app-photo-viewer',
  imports: [MatButtonModule, MatIconModule, MatProgressBarModule],
  template: `
    <div class="bar">
      <span class="name" [title]="fileName()">{{ fileName() }}</span>
      @if (image()) {
        <button mat-icon-button (click)="zoomBy(-1)" [disabled]="zoom() <= steps[0]" title="Zoom out · تصغير" aria-label="Zoom out"><mat-icon>zoom_out</mat-icon></button>
        <span class="level">{{ zoom() * 100 }}%</span>
        <button mat-icon-button (click)="zoomBy(1)" [disabled]="zoom() >= steps[steps.length - 1]" title="Zoom in · تكبير" aria-label="Zoom in"><mat-icon>zoom_in</mat-icon></button>
        <button mat-icon-button (click)="zoom.set(1)" title="Fit the width · ملء العرض" aria-label="Fit the width"><mat-icon>fit_screen</mat-icon></button>
        <button mat-icon-button (click)="turn()" title="Turn · تدوير" aria-label="Turn a quarter"><mat-icon>rotate_right</mat-icon></button>
      }
      @if (large()) {
        <button mat-icon-button (click)="openLarge()" title="Full size · عرض كامل" aria-label="Full size"><mat-icon>open_in_full</mat-icon></button>
      }
      <button mat-icon-button (click)="download()" [disabled]="!blob()" title="Download · تنزيل" aria-label="Download"><mat-icon>download</mat-icon></button>
    </div>
    @if (error()) {
      <p class="error">{{ error() }}</p>
    } @else if (image(); as src) {
      <div #stage class="stage" [class.dragging]="dragging()" (pointerdown)="grab($event)" (pointermove)="drag($event)" (pointerup)="drop($event)"
        (pointercancel)="drop($event)">
        <img [src]="src" [alt]="fileName()" [style.width.%]="zoom() * 100" draggable="false" />
      </div>
    } @else if (document(); as src) {
      <iframe class="stage" [src]="src" [title]="fileName()"></iframe>
    } @else {
      <mat-progress-bar mode="indeterminate" />
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      min-width: 0;
      border: 1px solid var(--app-line, #e2e8f0);
      border-radius: 12px;
      background: var(--mat-sys-surface-container-low);
      overflow: hidden;
    }
    .bar {
      display: flex;
      align-items: center;
      gap: 0;
      padding: 0 4px 0 12px;
      border-bottom: 1px solid var(--app-line, #e2e8f0);
      background: var(--mat-sys-surface-container-lowest);
    }
    .name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font: var(--mat-sys-label-medium);
      color: var(--mat-sys-on-surface-variant);
    }
    .level {
      min-width: 40px;
      text-align: center;
      font: var(--mat-sys-label-small);
      font-variant-numeric: tabular-nums;
    }
    /* As tall as where it is shown says: --viewer-height, 520px unless said. */
    .stage {
      display: block;
      width: 100%;
      height: var(--viewer-height, 520px);
      overflow: auto;
      border: 0;
      cursor: grab;
      touch-action: pan-x pan-y;
      background: repeating-conic-gradient(var(--mat-sys-surface-container) 0% 25%, transparent 0% 50%) 0 0 / 16px 16px;
    }
    .stage.dragging {
      cursor: grabbing;
    }
    img {
      display: block;
      max-width: none;
      margin: 0 auto;
      user-select: none;
    }
    .error {
      padding: 12px;
      color: var(--mat-sys-error);
    }
  `,
})
export class PhotoViewer {
  private readonly sanitizer = inject(DomSanitizer);
  private readonly dialog = inject(MatDialog);

  readonly source = input.required<PhotoSource>();
  readonly fileName = input.required<string>();
  // Offers to open it full size over the page; not from there.
  readonly large = input(true);

  protected readonly steps = zoomSteps;
  protected readonly zoom = signal(1);
  protected readonly image = signal<string | null>(null);
  protected readonly document = signal<SafeResourceUrl | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly blob = signal<Blob | null>(null);
  protected readonly dragging = signal(false);
  private readonly stage = viewChild<ElementRef<HTMLElement>>('stage');
  private readonly urls: string[] = [];
  private turns = 0;
  private from: { x: number; y: number; left: number; top: number } | null = null;

  constructor() {
    effect(() => {
      const source = this.source();
      untracked(() => void this.load(source));
    });
    inject(DestroyRef).onDestroy(() => this.release());
  }

  protected zoomBy(step: number): void {
    const at = zoomSteps.indexOf(this.zoom());
    this.zoom.set(zoomSteps[Math.min(zoomSteps.length - 1, Math.max(0, (at < 0 ? 2 : at) + step))]);
  }

  // A quarter turn clockwise, drawn again upright: the page around it lays it out as it now is.
  protected async turn(): Promise<void> {
    const blob = this.blob();
    if (!blob) {
      return;
    }
    this.turns = (this.turns + 1) % 4;
    try {
      this.image.set(this.turns === 0 ? this.urls[0] : await this.turned(blob, this.turns));
    } catch {
      // A browser that cannot draw it: left as it was.
    }
  }

  protected openLarge(): void {
    this.dialog.open<PhotoDialog, PhotoDialogData>(PhotoDialog, {
      data: { source: this.source(), fileName: this.fileName() },
      width: '96vw',
      maxWidth: '1200px',
    });
  }

  protected download(): void {
    const blob = this.blob();
    if (blob) {
      saveBlob(blob, this.fileName());
    }
  }

  // Dragged about with a finger or the mouse, when it is bigger than where it is shown.
  protected grab(event: PointerEvent): void {
    const stage = this.stage()?.nativeElement;
    if (!stage || event.button !== 0 || event.pointerType === 'touch') {
      return;
    }
    this.from = { x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop };
    stage.setPointerCapture?.(event.pointerId);
    this.dragging.set(true);
  }

  protected drag(event: PointerEvent): void {
    const stage = this.stage()?.nativeElement;
    if (!stage || !this.from) {
      return;
    }
    stage.scrollLeft = this.from.left - (event.clientX - this.from.x);
    stage.scrollTop = this.from.top - (event.clientY - this.from.y);
  }

  protected drop(event: PointerEvent): void {
    if (!this.from) {
      return;
    }
    this.from = null;
    this.dragging.set(false);
    const stage = this.stage()?.nativeElement;
    if (stage?.hasPointerCapture?.(event.pointerId)) {
      stage.releasePointerCapture(event.pointerId);
    }
  }

  private async load(source: PhotoSource): Promise<void> {
    this.release();
    this.image.set(null);
    this.document.set(null);
    this.error.set(null);
    this.zoom.set(1);
    this.turns = 0;
    try {
      const blob = await blobOf(source);
      this.blob.set(blob);
      const url = this.keep(URL.createObjectURL(blob));
      if (blob.type.startsWith('image/')) {
        this.image.set(url);
      } else {
        // A PDF, checked by its first bytes when it was handed in, in the browser's own viewer.
        this.document.set(this.sanitizer.bypassSecurityTrustResourceUrl(url));
      }
    } catch (error) {
      this.error.set(errorMessage(error, 'The photo could not be loaded. · تعذر تحميل الصورة.'));
    }
  }

  private async turned(blob: Blob, turns: number): Promise<string> {
    const bitmap = await createImageBitmap(blob);
    const sideways = turns % 2 === 1;
    const canvas = document.createElement('canvas');
    canvas.width = sideways ? bitmap.height : bitmap.width;
    canvas.height = sideways ? bitmap.width : bitmap.height;
    const context = canvas.getContext('2d')!;
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((turns * Math.PI) / 2);
    context.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
    bitmap.close();
    const drawn = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!drawn) {
      throw new Error('Not drawn');
    }
    return this.keep(URL.createObjectURL(drawn));
  }

  private keep(url: string): string {
    this.urls.push(url);
    return url;
  }

  private release(): void {
    this.urls.splice(0).forEach((url) => URL.revokeObjectURL(url));
  }
}

export interface PhotoDialogData {
  source: PhotoSource;
  fileName: string;
}

// The photo alone, over the page, as tall as the window lets it.
@Component({
  selector: 'app-photo-dialog',
  imports: [MatButtonModule, MatDialogModule, PhotoViewer],
  template: `
    <mat-dialog-content>
      <app-photo-viewer [source]="data.source" [fileName]="data.fileName" [large]="false" />
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-flat-button mat-dialog-close>Close · إغلاق</button>
    </mat-dialog-actions>
  `,
  styles: `
    app-photo-viewer {
      --viewer-height: calc(100vh - 190px);
    }
  `,
})
export class PhotoDialog {
  protected readonly data = inject<PhotoDialogData>(MAT_DIALOG_DATA);
}

export function viewPhoto(dialog: MatDialog, source: PhotoSource, fileName: string): void {
  dialog.open<PhotoDialog, PhotoDialogData>(PhotoDialog, { data: { source, fileName }, width: '96vw', maxWidth: '1200px' });
}

// A photo as a small square to tap: the picture itself, or a PDF's icon. Tapped, it opens full size.
@Component({
  selector: 'app-photo-thumb',
  imports: [MatIconModule],
  template: `
    <button type="button" class="thumb" (click)="open()" [title]="fileName()" [attr.aria-label]="'View ' + fileName()">
      @if (url(); as src) {
        <img [src]="src" alt="" />
      } @else {
        <mat-icon>{{ pdf() ? 'picture_as_pdf' : 'image' }}</mat-icon>
      }
    </button>
  `,
  styles: `
    :host {
      display: block;
      flex: none;
    }
    .thumb {
      display: grid;
      place-items: center;
      width: var(--thumb-size, 72px);
      height: var(--thumb-size, 72px);
      padding: 0;
      border: 1px solid var(--app-line, #e2e8f0);
      border-radius: 10px;
      background: var(--mat-sys-surface-container);
      overflow: hidden;
      cursor: zoom-in;
      color: var(--mat-sys-on-surface-variant);
    }
    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  `,
})
export class PhotoThumb {
  private readonly dialog = inject(MatDialog);

  readonly source = input.required<PhotoSource>();
  readonly fileName = input.required<string>();
  readonly contentType = input<string | null>(null);

  protected readonly url = signal<string | null>(null);
  protected readonly pdf = computed(() => (this.contentType() ?? '').includes('pdf') || this.fileName().toLowerCase().endsWith('.pdf'));
  private made: string | null = null;

  constructor() {
    effect(() => {
      const [source, pdf] = [this.source(), this.pdf()];
      untracked(() => void this.load(source, pdf));
    });
    inject(DestroyRef).onDestroy(() => this.release());
  }

  protected open(): void {
    viewPhoto(this.dialog, this.source(), this.fileName());
  }

  private async load(source: PhotoSource, pdf: boolean): Promise<void> {
    this.release();
    this.url.set(null);
    if (pdf) {
      return;
    }
    try {
      const blob = await blobOf(source);
      if (blob.type.startsWith('image/')) {
        this.made = URL.createObjectURL(blob);
        this.url.set(this.made);
      }
    } catch {
      // The icon instead.
    }
  }

  private release(): void {
    if (this.made) {
      URL.revokeObjectURL(this.made);
      this.made = null;
    }
  }
}
