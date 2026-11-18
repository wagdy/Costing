import { Component, computed, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CostingAccess, CostingTab } from '../../core/costing/costing-tabs';
import { SubNav, SubNavTab } from '../shared/sub-nav';

// Reports (التقارير): where the money went, stock and expenses; the safe's money in and out; then the
// food cost reports, the month's KPIs and the break-even worksheet; and each day's end of day, for
// whoever reads it (the manager's undo of the last closed day is there).
@Component({
  selector: 'app-costing-reports-shell',
  imports: [RouterOutlet, SubNav],
  template: `
    <app-sub-nav label="Reports" [tabs]="tabs()" />
    <router-outlet />
  `,
  styleUrl: './costing.scss',
})
export class CostingReportsShell {
  private readonly access = inject(CostingAccess);
  private readonly all: SubNavTab[] = [
    { path: 'spending', icon: 'pie_chart', en: 'Spending analysis', ar: 'تحليل الإنفاق' },
    { path: 'treasury', icon: 'account_balance', en: 'Safe & treasury', ar: 'تحليل الخزنة والتدفقات النقدية' },
    { path: 'theoretical', icon: 'calculate', en: 'Theoretical cost', ar: 'التكلفة النظرية' },
    { path: 'variance', icon: 'compare_arrows', en: 'Variance', ar: 'الانحراف' },
    { path: 'daily-break-even', icon: 'speed', en: 'Daily break-even', ar: 'نقطة التعادل اليومية' },
    { path: 'kpis', icon: 'insights', en: 'KPIs', ar: 'المؤشرات' },
    { path: 'break-even', icon: 'balance', en: 'Break-even', ar: 'نقطة التعادل' },
    { path: 'station-variance', icon: 'soup_kitchen', en: 'Station variance', ar: 'انحراف الأقسام' },
    { path: 'daily-summaries', icon: 'event_note', en: 'Daily summaries', ar: 'ملخصات تقفيل الأيام' },
  ];
  private static readonly endOfDayReaders: CostingTab[] = ['EndOfDay', 'Purchases', 'Financials'];
  protected readonly tabs = computed(() =>
    this.all.filter((t) => t.path !== 'daily-summaries' || CostingReportsShell.endOfDayReaders.some((tab) => this.access.has(tab))),
  );
}
