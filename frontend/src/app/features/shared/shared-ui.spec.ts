import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { provideRouter } from '@angular/router';
import { GridKeys } from './grid-keys';
import { ItemPicker, PickItem, pickMatches } from './item-picker';
import { SideLayout, SideSection } from './side-layout';
import { SortOption, SortState } from './smart-search';
import { SortControl } from './sort-control';
import { SubNav, SubNavTab } from './sub-nav';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

describe('sorting a list by its pill', () => {
  const options: SortOption[] = [
    { key: 'name', en: 'Name', ar: 'الاسم' },
    { key: 'cost', en: 'Cost', ar: 'التكلفة', descending: true },
  ];

  async function render() {
    const fixture = TestBed.createComponent(SortControl);
    fixture.componentRef.setInput('options', options);
    fixture.componentRef.setInput('sort', { key: 'name', direction: 1 } satisfies SortState);
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, page: fixture.componentInstance as unknown as Record<string, any> };
  }

  it('says what it sorts by, starts an option its own way, and turns it the other way', async () => {
    const { fixture, el, page } = await render();

    expect(text(el.querySelector('.by')!)).toBe('sortSortNameالاسمexpand_more');
    expect(el.querySelector('.direction')!.getAttribute('aria-label')).toBe('Ascending: turn to descending');

    page['choose'](options[1]);
    expect(page['sort']()).toEqual({ key: 'cost', direction: -1 });
    // Chosen again: kept as it is.
    page['choose'](options[1]);
    expect(page['sort']()).toEqual({ key: 'cost', direction: -1 });

    (el.querySelector('.direction') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(page['sort']()).toEqual({ key: 'cost', direction: 1 });
    expect(text(el.querySelector('.direction')!)).toBe('arrow_upward');
  });
});

describe('a section’s pages as a pill bar', () => {
  const tabs: SubNavTab[] = [
    { path: '.', icon: 'restaurant_menu', en: 'Dishes', ar: 'الأطباق', fallback: true },
    { path: 'prep', icon: 'blender', en: 'Prep items', ar: 'الأصناف نصف المصنعة' },
  ];

  it('names each page in both languages, the fallback open while no other page is', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(SubNav);
    fixture.componentRef.setInput('label', 'Recipes');
    fixture.componentRef.setInput('tabs', tabs);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('nav')!.getAttribute('aria-label')).toBe('Recipes');
    expect([...el.querySelectorAll('a.pill')].map(text)).toEqual(['restaurant_menuDishesالأطباق', 'blenderPrep itemsالأصناف نصف المصنعة']);
    expect([...el.querySelectorAll('a.pill.active')].map(text)).toEqual(['restaurant_menuDishesالأطباق']);

    (fixture.componentInstance as unknown as Record<string, any>)['activeChanged']('prep', true);
    fixture.detectChanges();
    expect(el.querySelector('a.pill')!.classList).not.toContain('active');
  });
});

describe('the sidebar in groups', () => {
  it('names each group above its first section, a section on one line with its Arabic at the end', async () => {
    const catalog = { key: 'catalog', en: 'Catalog & production', ar: 'الأصناف والإنتاج' };
    const finance = { key: 'finance', en: 'Financials & admin', ar: 'الماليات والإدارة' };
    const sections: SideSection[] = [
      { path: 'materials', en: 'Raw materials', ar: 'الخامات', icon: 'inventory', group: catalog },
      { path: 'recipes', en: 'Recipes', ar: 'الوصفات', icon: 'menu_book', group: catalog },
      { path: 'financials', en: 'Financials', ar: 'الماليات', icon: 'account_balance_wallet', group: finance },
    ];
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(SideLayout);
    fixture.componentRef.setInput('titleEn', 'Costing & Financials');
    fixture.componentRef.setInput('titleAr', 'التكاليف والماليات');
    fixture.componentRef.setInput('sections', sections);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    const nav = [...el.querySelector('nav')!.children].map((c) => (c.classList.contains('group') ? `[${text(c)}]` : text(c.querySelector('.en')!)));
    expect(nav).toEqual(['[Catalog & productionالأصناف والإنتاج]', 'Raw materials', 'Recipes', '[Financials & adminالماليات والإدارة]', 'Financials']);
    expect(el.querySelector('.group')!.classList).toContain('first');
    expect(text(el.querySelector('.side-link .sub')!)).toBe('الخامات');
  });
});

describe('picking an item by typing', () => {
  const items: PickItem[] = [
    { id: 'f', name: 'Flour', code: 'ING-7', kind: 'material', unit: 'kg', cost: 'L.E 30.00 / kg' },
    { id: 'c', name: 'Cheddar', code: 'ING-12', kind: 'material', unit: 'kg', keywords: ['جبنة شيدر'] },
    { id: 'd', name: 'Pizza dough', code: 'PREP-1', kind: 'prep', unit: 'kg' },
    { id: 'h', name: 'Cheese sauce', code: null, kind: 'prep', unit: 'L' },
  ];

  it('finds by name, code or Arabic word, its code first, then names that start with it', () => {
    expect(pickMatches(items, 'ing-12').map((i) => i.id)).toEqual(['c']);
    expect(pickMatches(items, 'che').map((i) => i.id)).toEqual(['c', 'h']);
    expect(pickMatches(items, 'جبنه').map((i) => i.id)).toEqual(['c']);
    expect(pickMatches(items, 'sauce chee').map((i) => i.id)).toEqual(['h']);
    expect(pickMatches(items, '')).toHaveLength(4);
  });

  it('shows the one chosen by its code and name, and goes back to it when left without choosing', async () => {
    vi.useFakeTimers();
    const fixture = TestBed.createComponent(ItemPicker);
    fixture.componentRef.setInput('items', items);
    fixture.componentRef.setInput('value', 'f');
    fixture.componentRef.setInput('canCreate', true);
    fixture.detectChanges();
    const page = fixture.componentInstance as unknown as Record<string, any>;

    expect(page['text']()).toBe('ING-7 · Flour');
    // Everything is offered while it shows the one chosen.
    expect(page['matches']().shown).toHaveLength(4);

    page['typed']('Saffron');
    expect(page['newName']()).toBe('Saffron');
    const created: string[] = [];
    fixture.componentInstance.create.subscribe((name) => created.push(name));
    page['chosen']('+new');
    expect(created).toEqual(['Saffron']);
    expect(page['text']()).toBe('ING-7 · Flour');

    page['chosen']('d');
    expect(fixture.componentInstance.value()).toBe('d');
    expect(page['text']()).toBe('PREP-1 · Pizza dough');

    page['typed']('zzz');
    page['settle']();
    vi.advanceTimersByTime(250);
    expect(page['text']()).toBe('PREP-1 · Pizza dough');
    vi.useRealTimers();
  });
});

@Component({
  imports: [FormsModule, GridKeys],
  template: `
    <table appGridKeys (appGridKeysAppend)="add()">
      <tbody>
        @for (row of rows(); track $index; let i = $index) {
          <tr>
            <td><input [attr.aria-label]="'Item ' + i" /></td>
            <td><input type="number" [attr.aria-label]="'Quantity ' + i" /></td>
            <td><input type="checkbox" [attr.aria-label]="'Done ' + i" /></td>
            <td><input type="number" [attr.aria-label]="'Price ' + i" /></td>
          </tr>
        }
      </tbody>
    </table>
  `,
})
class Grid {
  readonly rows = signal([0]);
  add(): void {
    this.rows.update((rows) => [...rows, rows.length]);
  }
}

describe('entering lines by keyboard', () => {
  it('moves from the item to its quantity to its price, then to a new line', async () => {
    const fixture = TestBed.createComponent(Grid);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    document.body.appendChild(el);
    const field = (label: string) => el.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
    const enter = (target: HTMLElement) => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

    field('Item 0').focus();
    enter(field('Item 0'));
    expect(document.activeElement).toBe(field('Quantity 0'));
    enter(field('Quantity 0'));
    // The checkbox is passed over.
    expect(document.activeElement).toBe(field('Price 0'));

    enter(field('Price 0'));
    await fixture.whenStable();
    fixture.detectChanges();
    await vi.waitFor(() => expect(document.activeElement).toBe(field('Item 1')));
    expect(fixture.componentInstance.rows()).toEqual([0, 1]);

    // From a line with one after it: to that line, no new one.
    field('Price 0').focus();
    enter(field('Price 0'));
    expect(document.activeElement).toBe(field('Item 1'));
    expect(fixture.componentInstance.rows()).toHaveLength(2);
    el.remove();
  });
});
