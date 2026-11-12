import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SubNav, SubNavTab } from '../shared/sub-nav';

// Material & demand intelligence (تحليلات الخامات والطلبيات): what the purchase prices did and what
// that does to the dishes; what to order for the days ahead; what was used against what the sales
// should have taken; which materials hold the money, and how long the stock lasts; and which dishes
// earn their place on the menu.
@Component({
  selector: 'app-intelligence-shell',
  imports: [RouterOutlet, SubNav],
  template: `
    <app-sub-nav label="Material & demand intelligence" [tabs]="tabs" />
    <router-outlet />
  `,
  styleUrl: './costing.scss',
})
export class IntelligenceShell {
  protected readonly tabs: SubNavTab[] = [
    { path: 'prices', icon: 'price_change', en: 'Price variance & recipe impact', ar: 'انحراف الأسعار وأثره' },
    { path: 'orders', icon: 'shopping_basket', en: 'Smart order planner', ar: 'تخطيط الطلبيات' },
    { path: 'consumption', icon: 'compare_arrows', en: 'Theoretical vs actual', ar: 'النظري مقابل الفعلي' },
    { path: 'abc', icon: 'stacked_bar_chart', en: 'ABC & days on hand', ar: 'تصنيف ABC وكفاية المخزون' },
    { path: 'menu', icon: 'grid_view', en: 'Menu engineering', ar: 'هندسة المنيو والربحية' },
  ];
}
