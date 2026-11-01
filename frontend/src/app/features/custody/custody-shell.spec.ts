import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { CustodyShell } from './custody-shell';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

describe('Custody & Assets’ sections', () => {
  it('are a sidebar of its four, the consumables inventory among them, naming the one open', async () => {
    @Component({ template: '' })
    class Page {}
    TestBed.configureTestingModule({ providers: [provideRouter([{ path: 'consumables', component: Page }])] });
    const fixture = TestBed.createComponent(CustodyShell);
    const el = fixture.nativeElement as HTMLElement;
    await TestBed.inject(Router).navigateByUrl('/consumables');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(text(el.querySelector('aside h1')!)).toBe('Custody & Assets العهدة والأصول');
    expect([...el.querySelectorAll('nav a')].map((a) => [a.getAttribute('href'), text(a.querySelector('.label')!), text(a.querySelector('mat-icon')!)])).toEqual([
      ['/categories', 'Categoriesالفئات', 'category'],
      ['/assets', 'Assetsالأصول', 'inventory_2'],
      ['/vouchers', 'Vouchersالأذونات', 'receipt_long'],
      ['/consumables', 'Consumables Inventoryجرد الاستهلاكيات', 'inventory'],
    ]);
    expect(el.querySelector('nav a.active')!.getAttribute('href')).toBe('/consumables');
    // On a phone, the bar above the page says which.
    expect(text(el.querySelector('.mobile-bar .current')!)).toBe('Consumables Inventoryجرد الاستهلاكيات');
  });
});
