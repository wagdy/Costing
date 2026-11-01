import { Component, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Observable, firstValueFrom } from 'rxjs';
import { errorMessage } from '../http/error-message';
import { saveBlob } from './save-blob';

// A file the API keeps, such as an employee's ID card, fetched with the sign-in (a plain link
// would carry none) and shown in the page: a photo as it is, a PDF in the browser's own viewer.
// Given how to fetch it.
@Component({
  selector: 'app-paper-preview',
  imports: [MatButtonModule, MatIconModule, MatProgressBarModule],
  template: `
    @if (error()) {
      <p class="error">{{ error() }}</p>
    } @else if (image(); as src) {
      <img [src]="src" [alt]="fileName()" />
    } @else if (document(); as src) {
      <iframe [src]="src" [title]="fileName()"></iframe>
    } @else {
      <mat-progress-bar mode="indeterminate" />
    }
    <div class="actions">
      <span class="name">{{ fileName() }}</span>
      <button mat-button (click)="download()" [disabled]="!blob()"><mat-icon>download</mat-icon> Download</button>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    /* As tall as where it is shown lets it: --paper-height, 70vh unless said. */
    img {
      display: block;
      max-width: 100%;
      max-height: var(--paper-height, 70vh);
      margin: 0 auto;
    }
    iframe {
      display: block;
      width: 100%;
      min-width: var(--paper-min-width, min(80vw, 640px));
      height: var(--paper-height, 70vh);
      border: 0;
    }
    .actions {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 4px;
    }
    .name {
      flex: 1;
      color: var(--mat-sys-on-surface-variant);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .error {
      color: var(--mat-sys-error);
    }
  `,
})
export class PaperPreview {
  private readonly sanitizer = inject(DomSanitizer);

  readonly fetch = input.required<() => Observable<Blob>>();
  readonly fileName = input.required<string>();

  protected readonly image = signal<string | null>(null);
  protected readonly document = signal<SafeResourceUrl | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly blob = signal<Blob | null>(null);
  private url: string | null = null;

  constructor() {
    effect(() => {
      const fetch = this.fetch();
      untracked(() => void this.load(fetch));
    });
    inject(DestroyRef).onDestroy(() => this.release());
  }

  protected download(): void {
    const blob = this.blob();
    if (blob) {
      saveBlob(blob, this.fileName());
    }
  }

  private async load(fetch: () => Observable<Blob>): Promise<void> {
    this.release();
    this.image.set(null);
    this.document.set(null);
    this.error.set(null);
    try {
      const blob = await firstValueFrom(fetch());
      this.blob.set(blob);
      this.url = URL.createObjectURL(blob);
      if (blob.type.startsWith('image/')) {
        this.image.set(this.url);
      } else {
        // A PDF, in the browser's own viewer. The URL is one made here, of a file the API checked
        // was a PDF by its first bytes when it was uploaded.
        this.document.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.url));
      }
    } catch (error) {
      this.error.set(errorMessage(error, 'The file could not be loaded.'));
    }
  }

  private release(): void {
    if (this.url) {
      URL.revokeObjectURL(this.url);
      this.url = null;
    }
  }
}
