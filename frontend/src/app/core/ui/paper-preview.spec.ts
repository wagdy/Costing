import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';
import { PaperPreview } from './paper-preview';

@Component({
  imports: [PaperPreview],
  template: `<app-paper-preview [fetch]="fetch()" [fileName]="fileName()" />`,
})
class Host {
  readonly fetch = signal<() => Observable<Blob>>(() => of(new Blob()));
  readonly fileName = signal('card.jpg');
}

describe('a file shown in the page', () => {
  async function render(fileName: string, fetch: () => Observable<Blob>) {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.fileName.set(fileName);
    fixture.componentInstance.fetch.set(fetch);
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:paper');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it('shows a photo on the page, fetched as it was given', async () => {
    const fetch = vi.fn(() => of(new Blob(['\xff\xd8\xff'], { type: 'image/jpeg' })));
    const el = await render('card.jpg', fetch);

    expect(fetch).toHaveBeenCalled();
    expect(el.querySelector('img')?.getAttribute('src')).toBe('blob:paper');
    expect(el.querySelector('iframe')).toBeNull();
  });

  it('shows a PDF in the browsers own viewer', async () => {
    const el = await render('scan.pdf', () => of(new Blob(['%PDF-1.7'], { type: 'application/pdf' })));

    expect(el.querySelector('iframe')?.getAttribute('src')).toBe('blob:paper');
    expect(el.querySelector('img')).toBeNull();
  });

  it('downloads it under its own name', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const el = await render('scan.pdf', () => of(new Blob(['%PDF-1.7'], { type: 'application/pdf' })));

    [...el.querySelectorAll('button')].find((b) => b.textContent!.includes('Download'))!.click();

    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('scan.pdf');
  });

  it('says so when it cannot be fetched', async () => {
    const el = await render('card.jpg', () => throwError(() => new Error('gone')));

    expect(el.querySelector('.error')?.textContent).toContain('could not be loaded');
    expect(el.querySelector('img')).toBeNull();
  });
});
