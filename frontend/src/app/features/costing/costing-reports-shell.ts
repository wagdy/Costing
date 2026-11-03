import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SubNav, SubNavTab } from '../shared/sub-nav';

// Reports (التقارير): where the money went, stock and expenses; the safe's money in and out; then the
// food cost reports, the month's KPIs and the break-even worksheet.
@Component({
  selector: 'app-costing-reports-shell',
  imports: [RouterOutlet, SubNav],
  template: `
    <app-sub-nav label="Reports" [tabs]="tabs" />
    <router-outlet />
  `,
  styleUrl: './costing.scss',
})
export class CostingReportsShell {
  protected readonly tabs: SubNavTab[] = [
    { path: 'spending', icon: 'pie_chart', en: 'Spending analysis', ar: 'تحليل الإنفاق' },
    { path: 'treasury', icon: 'account_balance', en: 'Safe & treasury', ar: 'تحليل الخزنة والتدفقات النقدية' },
    { path: 'theoretical', icon: 'calculate', en: 'Theoretical cost', ar: 'التكلفة النظرية' },
    { path: 'variance', icon: 'compare_arrows', en: 'Variance', ar: 'الانحراف' },
    { path: 'kpis', icon: 'insights', en: 'KPIs', ar: 'المؤشرات' },
    { path: 'break-even', icon: 'balance', en: 'Break-even', ar: 'نقطة التعادل' },
  ];
}
