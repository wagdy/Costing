import { DOCUMENT } from '@angular/common';
import { Injectable, effect, inject } from '@angular/core';
import { Company } from './company';

// The system's own icons (public/), when the company has no logo. Versioned: static files are kept a
// year, and index.html, which names them, never is.
export const defaultTabIcons: readonly { rel: string; href: string; type?: string; sizes?: string }[] = [
  { rel: 'icon', href: 'favicon.ico?v=2', sizes: '32x32' },
  { rel: 'icon', href: 'favicon.svg?v=2', type: 'image/svg+xml' },
  { rel: 'apple-touch-icon', href: 'apple-touch-icon.png?v=2' },
];

// The browser tab's icon (أيقونة المتصفح): the company's logo once it has one, the system's own
// otherwise. Set at start-up and again the moment a logo is uploaded or taken off, with no reload:
// the head's icon links are replaced, not edited, since a browser may not notice an href changing.
@Injectable({ providedIn: 'root' })
export class TabIcon {
  private readonly document = inject(DOCUMENT);
  private readonly company = inject(Company);

  constructor() {
    effect(() => this.show(this.company.logoUrl()));
  }

  private show(logo: string | null): void {
    const head = this.document.head;
    head.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]').forEach((link) => link.remove());
    const links = logo ? [{ rel: 'icon', href: logo }, { rel: 'apple-touch-icon', href: logo }] : defaultTabIcons;
    for (const icon of links) {
      const link = this.document.createElement('link');
      link.rel = icon.rel;
      link.href = icon.href;
      if ('type' in icon && icon.type) {
        link.type = icon.type;
      }
      if ('sizes' in icon && icon.sizes) {
        link.setAttribute('sizes', icon.sizes);
      }
      head.appendChild(link);
    }
  }
}
