import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FilterOption, FilterSelect } from './filter-select';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();
// Element by element: the template leaves no space between them.
const cell = (el: Element): string =>
  [...el.childNodes]
    .map((n) => (n.nodeType === Node.ELEMENT_NODE ? cell(n as Element) : n.nodeType === Node.TEXT_NODE ? (n.textContent ?? '').trim() : ''))
    .filter(Boolean)
    .join(' ');

@Component({
  imports: [FilterSelect],
  template: `<app-filter-select label="Category" icon="category" [options]="options" [(value)]="value" />`,
})
class Host {
  readonly options: FilterOption[] = [
    { value: '', label: 'All categories', count: 3 },
    { value: 'devices', label: 'Devices', count: 1 },
  ];
  readonly value = signal('');
}

describe('a smart filter', () => {
  it('shows the choice made and how many it shows, and sets the one picked from its menu', async () => {
    const fixture = TestBed.createComponent(Host);
    const el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    const button = el.querySelector<HTMLButtonElement>('.filter-select')!;
    expect(cell(button)).toBe('category Category All categories 3 expand_more');
    expect(button.classList.contains('set')).toBe(false);

    button.click();
    fixture.detectChanges();
    await fixture.whenStable();
    const items = [...document.querySelectorAll<HTMLButtonElement>('.mat-mdc-menu-item')];
    expect(items.map((i) => [cell(i), i.getAttribute('aria-checked')])).toEqual([
      ['check All categories 3', 'true'],
      ['Devices 1', 'false'],
    ]);
    items[1].click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.value()).toBe('devices');
    expect(cell(button)).toBe('category Category Devices 1 expand_more');
    expect(button.classList.contains('set')).toBe(true);
    expect(button.getAttribute('aria-label')).toBe('Category: Devices');
  });
});
