import { Component, computed, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { Company } from '../../core/settings/company';
import { hasLocations } from '../../core/settings/company-structure';
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
  private readonly company = inject(Company);

  protected readonly sections = computed<SideSection[]>(() => {
    const waiting = this.approvals.pending().length;
    const tabs: SideSection[] = costingTabs.filter((t) => this.access.has(t.tab));
    // Internal transfers, once the company keeps stock in more than one place: after the counts, for
    // whoever counts or keeps the raw materials.
    if (hasLocations(this.company.mode()) && (this.access.has('Counts') || this.access.has('Materials'))) {
      const after = tabs.findIndex((t) => t.path === (this.access.has('Counts') ? 'counts' : 'waste'));
      tabs.splice(after < 0 ? tabs.length : after + 1, 0, {
        path: 'internal-transfers', en: 'Internal transfers', ar: 'التحويلات الداخلية', icon: 'move_down', group: costingGroups.operations,
      });
    }
    // The central kitchen's hub, once the company runs one: after the transfers, for whoever counts,
    // keeps or buys the stock.
    if (this.company.mode() === 'MultiBranch_CentralKitchen' && (this.access.has('Counts') || this.access.has('Materials') || this.access.has('Purchases'))) {
      const after = Math.max(tabs.findIndex((t) => t.path === 'internal-transfers'), tabs.findIndex((t) => t.path === 'counts'), tabs.findIndex((t) => t.path === 'purchases'));
      tabs.splice(after < 0 ? tabs.length : after + 1, 0, {
        path: 'inter-branch', en: 'Inter-branch hub', ar: 'المطبخ المركزي وتحويلات الفروع', icon: 'soup_kitchen', group: costingGroups.operations,
      });
    }
    return [
      ...tabs,
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
