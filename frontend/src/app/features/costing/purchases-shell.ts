import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterOutlet } from '@angular/router';
import { SubNav, SubNavTab } from '../shared/sub-nav';
import { AuthService } from '../../core/auth/auth.service';
import { CostingAccess } from '../../core/costing/costing-tabs';
import { Permissions } from '../../core/auth/permissions';
import { Treasury } from './financials';

// Purchases: entering a supplier's invoice, the invoices entered, the suppliers they are from, and
// the categories everything is filed under. What was spent is under Reports. An employee's advance
// is paid from here too, as in Financials: out of the safe or a day's takings, and off their pay
// (or, naming no one, a lump sum shared among the staff).
@Component({
  selector: 'app-purchases-shell',
  imports: [MatButtonModule, MatIconModule, RouterOutlet, SubNav],
  template: `
    <app-sub-nav label="Purchases" [tabs]="tabs">
      @if (canAdvance()) {
        <button mat-stroked-button (click)="advance()"><mat-icon>request_quote</mat-icon> New advance <span class="inline-ar">سلفة جديدة</span></button>
      }
    </app-sub-nav>
    <router-outlet />
  `,
  styleUrl: './costing.scss',
})
export class PurchasesShell {
  private readonly auth = inject(AuthService);
  private readonly treasury = inject(Treasury);
  // Who may pay an advance: whoever works Financials, as in the daily batch.
  protected readonly canAdvance = computed(() => this.access.has('Financials'));
  private readonly access = inject(CostingAccess);

  protected async advance(): Promise<void> {
    await this.treasury.enter('EmployeeAdvance');
  }

  protected readonly tabs: SubNavTab[] = [
    { path: 'new', icon: 'add_shopping_cart', en: 'New invoice', ar: 'فاتورة جديدة' },
    { path: 'batch', icon: 'library_add', en: 'Daily batch', ar: 'يومية المشتريات' },
    { path: 'invoices', icon: 'history', en: 'Invoices', ar: 'أرشيف الفواتير' },
    { path: 'suppliers', icon: 'local_shipping', en: 'Suppliers', ar: 'إدارة الموردين' },
    { path: 'categories', icon: 'category', en: 'Categories', ar: 'الأقسام' },
  ];
}
