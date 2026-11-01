import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SideLayout, SideSection } from '../shared/side-layout';

// Custody & Assets (العهدة والأصول): what the company owns and whose custody each thing is in.
// Its categories, the assets themselves, the vouchers that hand them out and take them back, and
// the consumables used up from the store (جرد الاستهلاكيات). Whoever holds its tab sees it; an
// accountant's changes to an asset go to a manager. The sections are a sidebar beside the page,
// a drawer on a phone (SideLayout).
@Component({
  selector: 'app-custody-shell',
  imports: [RouterOutlet, SideLayout],
  template: `
    <app-side-layout titleEn="Custody & Assets" titleAr="العهدة والأصول" [sections]="sections">
      <router-outlet />
    </app-side-layout>
  `,
})
export class CustodyShell {
  protected readonly sections: SideSection[] = [
    { path: 'categories', en: 'Categories', ar: 'الفئات', icon: 'category' },
    { path: 'assets', en: 'Assets', ar: 'الأصول', icon: 'inventory_2' },
    { path: 'vouchers', en: 'Vouchers', ar: 'الأذونات', icon: 'receipt_long' },
    { path: 'consumables', en: 'Consumables Inventory', ar: 'جرد الاستهلاكيات', icon: 'inventory' },
  ];
}
