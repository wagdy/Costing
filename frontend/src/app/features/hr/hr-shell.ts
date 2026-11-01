import { Component, computed, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HrAccess } from '../../core/hr/hr-access';
import { hrTabs } from '../../core/hr/hr-tabs';
import { SideLayout, SideSection } from '../shared/side-layout';
import { CorrectionsCount } from './corrections-count';
import { PendingLeaves } from './pending-leaves';

// HR & Payroll (الموارد البشرية والرواتب), opening on who is in now: the employees and their
// departments, their attendance and its corrections, the monthly payroll, the leaves and the
// public holidays, and the attendance devices that send their punches. The Corrections tab, and
// Leaves & Holidays, count what waits there for a manager. Each tab for whoever holds it (صلاحيات الموظفين): a manager every one, and the
// Permissions tab where they give them; an accountant, and an employee in the portal, those a
// manager gave them, their changes going to a manager.
// Advances are paid in Financials and in the daily batch, from the safe or a day's takings; the
// Advances tab says whose pay each comes off, and gives out those handed out with no one named.
//
// The tabs are a sidebar beside the page, a drawer on a phone (SideLayout); Shift Rostering, a tab of
// its own, beside Attendance.
@Component({
  selector: 'app-hr-shell',
  imports: [RouterOutlet, SideLayout],
  template: `
    <app-side-layout titleEn="HR & Payroll" titleAr="الموارد البشرية والرواتب" [sections]="sections()">
      <router-outlet />
    </app-side-layout>
  `,
})
export class HrShell {
  private readonly waiting = inject(CorrectionsCount);
  private readonly leaves = inject(PendingLeaves);
  private readonly access = inject(HrAccess);
  protected readonly sections = computed<SideSection[]>(() => [
    ...hrTabs
      .filter((t) => this.access.has(t.tab))
      .map((t) => ({
        ...t,
        ...(t.path === 'corrections' ? { count: this.waiting.count(), countLabel: `${this.waiting.count()} waiting` } : {}),
        ...(t.path === 'leaves' ? { count: this.leaves.count(), countLabel: `${this.leaves.count()} leave requests waiting` } : {}),
      })),
    ...(this.access.canGive() ? [{ path: 'permissions', en: 'Permissions', ar: 'صلاحيات الموظفين', icon: 'admin_panel_settings' }] : []),
  ]);

  constructor() {
    void this.waiting.refresh();
    void this.leaves.refresh();
  }
}
