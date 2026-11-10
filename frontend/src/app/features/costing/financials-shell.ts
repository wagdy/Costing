import { Component, computed, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SubNav, SubNavTab } from '../shared/sub-nav';
import { AuthService } from '../../core/auth/auth.service';
import { Permissions } from '../../core/auth/permissions';

// Financials (الماليات): the safe, where its money comes from, each day's cash reconciled with its
// sales, the expense vouchers paid out of the safe, what is owed to suppliers and the payments made
// to them, the staff the safe pays and their advances, and the tax and service settings.
@Component({
  selector: 'app-financials-shell',
  imports: [RouterOutlet, SubNav],
  template: `
    <app-sub-nav label="Financials" [tabs]="tabs()" />
    <router-outlet />
  `,
  styleUrl: './costing.scss',
})
export class FinancialsShell {
  private readonly auth = inject(AuthService);

  private readonly allTabs: SubNavTab[] = [
    { path: 'safe', icon: 'account_balance_wallet', en: 'Safe', ar: 'الخزنة' },
    { path: 'funding', icon: 'savings', en: 'Funding sources', ar: 'مصادر التمويل' },
    { path: 'reconciliation', icon: 'rule', en: 'Reconciliation', ar: 'مطابقة الإيرادات' },
    { path: 'daily-cash', icon: 'calendar_view_day', en: 'Daily cash', ar: 'يومية الإيراد' },
    { path: 'expenses', icon: 'receipt', en: 'Expense vouchers', ar: 'إذن صرف مصروفات' },
    { path: 'suppliers', icon: 'account_balance', en: 'Supplier debts', ar: 'مديونيات الموردين' },
    { path: 'payments', icon: 'payments', en: 'Supplier payments', ar: 'أذونات صرف الموردين' },
    { path: 'advances', icon: 'request_quote', en: 'Advances', ar: 'السلفيات' },
    { path: 'staff', icon: 'badge', en: 'Staff', ar: 'الموظفين' },
    { path: 'payroll', icon: 'request_page', en: 'Payroll & deductions', ar: 'الرواتب والخصومات' },
    { path: 'tax-service', icon: 'percent', en: 'Tax & service', ar: 'الضريبة والخدمة' },
  ];

  protected readonly tabs = computed(() => this.allTabs);
}
