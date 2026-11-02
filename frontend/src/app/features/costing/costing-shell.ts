import { Component, computed, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { Permissions } from '../../core/auth/permissions';
import { CostingAccess, costingGroups, costingTabs } from '../../core/costing/costing-tabs';
import { SideLayout, SideSection } from '../shared/side-layout';
import { Approvals } from './approvals';

// Costing & Financials (التكاليف والماليات): the raw materials and their stock, recipes and prep
// items and their production, the menu and its sales, purchases and expense items, counts and
// waste, the safe, the cost reports and their settings. Each section for whoever works it: a
// manager every one, and Permissions, where they give them; anyone else their role's, or those a
// manager ticked. Pending approvals count what waits for a manager.
//
// The sections are a sidebar beside the page, a drawer on a phone (SideLayout); a section with
// pages of its own (Purchases, Financials, Recipes, Reports) has its own bar of them above the page.
@Component({
  selector: 'app-costing-shell',
  imports: [RouterOutlet, SideLayout],
  template: `
    <app-side-layout titleEn="Costing & Financials" titleAr="التكاليف والماليات" [sections]="sections()">
      <router-outlet />
    </app-side-layout>
  `,
})
export class CostingShell {
  private readonly access = inject(CostingAccess);
  private readonly auth = inject(AuthService);
  private readonly approvals = inject(Approvals);

  protected readonly sections = computed<SideSection[]>(() => {
    const waiting = this.approvals.pending().length;
    return [
      ...costingTabs.filter((t) => this.access.has(t.tab)),
      ...(this.auth.can(Permissions.InventoryManage)
        ? [{
            path: 'approvals', en: 'Approvals', ar: 'طلبات معلقة', icon: 'pending_actions', group: costingGroups.finance,
            ...(waiting ? { count: waiting, countLabel: `${waiting} waiting` } : {}),
          }]
        : []),
      ...(this.auth.can(Permissions.UsersManage)
        ? [{ path: 'permissions', en: 'Permissions', ar: 'الصلاحيات', icon: 'admin_panel_settings', group: costingGroups.finance }]
        : []),
    ];
  });

  constructor() {
    void this.approvals.refresh();
  }
}
