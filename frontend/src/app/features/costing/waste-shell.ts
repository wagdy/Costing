import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SubNav, SubNavTab } from '../shared/sub-nav';

// Waste (الهالك): what was thrown away or broken, and, apart, what was taken on purpose: staff
// meals, hospitality and recipe tastings, never counted as the kitchen's loss.
@Component({
  selector: 'app-waste-shell',
  imports: [RouterOutlet, SubNav],
  template: `
    <app-sub-nav label="Waste" [tabs]="tabs" />
    <router-outlet />
  `,
  styleUrl: './costing.scss',
})
export class WasteShell {
  protected readonly tabs: SubNavTab[] = [
    { path: 'spoilage', icon: 'delete_sweep', en: 'Spoilage & breakage', ar: 'الهالك والكسر' },
    { path: 'staff-meals', icon: 'restaurant', en: 'Staff meals & hospitality', ar: 'وجبات العاملين والضيافة' },
  ];
}
