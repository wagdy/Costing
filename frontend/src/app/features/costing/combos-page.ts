import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { Permissions } from '../../core/auth/permissions';
import { ComboOffer, ComboOffersReport, CostingApi, RecipeCostCard, statusLabels } from '../../core/costing/costing.api';
import { errorMessage } from '../../core/http/error-message';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { NotifyService } from '../../core/ui/notify.service';
import { SearchField } from '../shared/search-field';
import { smartMatch } from '../shared/smart-search';
import { showComboDialog } from './combo-dialog';
import { InfoTip } from './info-tip';

// Combos & offers (العروض والوجبات المجمعة): dishes the kitchen already makes, sold together at a
// price of their own. Each is its dishes' recipes and how many of each, so nothing is entered twice;
// what it costs, what the dishes would sell for apart and its food cost % are worked out from them.
// Sold under its code, on the menu in the Combos & offers category.
@Component({
  selector: 'app-combos-page',
  imports: [DecimalPipe, InfoTip, MatButtonModule, MatIconModule, MatProgressBarModule, MatTooltipModule, MoneyPipe, SearchField],
  template: `
    <div class="toolbar smart">
      <app-search-field [(value)]="search" placeholder="Combo, code or dish · العرض أو الكود أو الصنف" />
      <span class="spacer"></span>
      @if (canManage()) {
        <button mat-flat-button (click)="edit(null)" [disabled]="!report()"><mat-icon>add</mat-icon> New combo · عرض جديد</button>
      }
    </div>
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    @if (error(); as e) {
      <p class="error">{{ e }}</p>
    } @else if (report(); as r) {
      <div class="table-wrap">
        <table class="grid combos">
          <thead>
            <tr>
              <th>Code<span class="ar">الكود</span></th>
              <th>Combo<span class="ar">العرض</span></th>
              <th>Dishes<span class="ar">الأصناف</span></th>
              <th class="num">Price<span class="ar">السعر</span></th>
              <th class="num">Total cost <app-info-tip tip="coTotalCost" /><span class="ar">التكلفة</span></th>
              <th class="num">Apart <app-info-tip tip="coOriginal" /><span class="ar">منفصلًا</span></th>
              <th class="num">Food cost % <app-info-tip tip="coFoodCost" /><span class="ar">نسبة التكلفة</span></th>
              <th class="num"><span class="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (c of shown(); track c.id) {
              <tr [class.off]="!c.isActive">
                <td class="code">{{ c.code }}</td>
                <td>
                  <strong>{{ c.name }}</strong>
                  @if (c.nameAr) {
                    <span class="ar">{{ c.nameAr }}</span>
                  }
                  @if (!c.isActive) {
                    <div class="muted small">Not on sale · غير متاح</div>
                  }
                </td>
                <td class="dishes">{{ dishes(c) }}</td>
                <td class="num">{{ c.sellingPrice | money }}</td>
                <td class="num">{{ c.totalCost | money }}</td>
                <td class="num">
                  {{ c.originalPrice === null ? '—' : (c.originalPrice | money) }}
                  @if (c.savingsPercent !== null) {
                    <div class="muted small">saves {{ c.savingsPercent | number: '1.0-1' }}%</div>
                  }
                </td>
                <td class="num">
                  <span class="status" [class]="c.status">{{ c.foodCostPercent === null ? '—' : (c.foodCostPercent | number: '1.1-1') + '%' }}</span>
                  <div class="muted small">{{ statusLabels[c.status].en }}</div>
                </td>
                <td class="num actions">
                  @if (canManage()) {
                    <button mat-icon-button (click)="edit(c)" matTooltip="Edit" [attr.aria-label]="'Edit ' + c.name"><mat-icon>edit</mat-icon></button>
                    <button mat-icon-button class="danger" (click)="remove(c)" matTooltip="Delete" [attr.aria-label]="'Delete ' + c.name"><mat-icon>delete</mat-icon></button>
                  }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="8" class="muted">{{ r.combos.length ? 'Nothing matches.' : 'No combo offers yet: build one from the recipes you have.' }}</td></tr>
            }
          </tbody>
        </table>
      </div>
      <p class="muted small">Food cost target {{ r.foodCostTargetPercent | number: '1.0-1' }}%. A combo sold takes each dish's stock by its own recipe.</p>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .code {
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    td.dishes {
      max-width: 320px;
    }
    tr.off td {
      color: var(--mat-sys-on-surface-variant);
    }
    .actions {
      white-space: nowrap;
    }
    .danger {
      color: var(--mat-sys-error);
    }
    .small {
      font-size: 0.85em;
    }
    .spacer {
      flex: 1;
    }
    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
    }
  `,
})
export class CombosPage {
  private readonly api = inject(CostingApi);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotifyService);
  private readonly auth = inject(AuthService);
  protected readonly statusLabels = statusLabels;
  protected readonly report = signal<ComboOffersReport | null>(null);
  private readonly recipes = signal<RecipeCostCard[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly search = signal('');
  protected readonly canManage = computed(() => this.auth.can(Permissions.InventoryManage));
  protected readonly shown = computed(() =>
    (this.report()?.combos ?? []).filter((c) => smartMatch(this.search(), c.name, c.nameAr, String(c.code), ...c.items.map((i) => i.dish))),
  );

  constructor() {
    void this.load();
  }

  protected dishes(combo: ComboOffer): string {
    return combo.items.map((i) => `${i.quantity}× ${i.dish}`).join(' + ');
  }

  protected async edit(combo: ComboOffer | null): Promise<void> {
    const report = this.report();
    if (!report) {
      return;
    }
    const saved = await showComboDialog(this.dialog, {
      combo, nextCode: report.nextCode, foodCostTargetPercent: report.foodCostTargetPercent, recipes: this.recipes(),
    });
    if (saved) {
      await this.load();
    }
  }

  protected async remove(combo: ComboOffer): Promise<void> {
    if (!confirm(`Delete ${combo.name}? It leaves the menu; its sales keep it. · حذف العرض؟`)) {
      return;
    }
    try {
      await firstValueFrom(this.api.deleteCombo(combo.id));
      this.notify.info(`${combo.name} deleted. · تم حذف العرض.`);
      await this.load();
    } catch (error) {
      this.notify.error(error, 'The combo could not be deleted.');
    }
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [report, recipes] = await Promise.all([firstValueFrom(this.api.combos()), firstValueFrom(this.api.recipes())]);
      this.report.set(report);
      this.recipes.set(recipes);
    } catch (error) {
      this.error.set(errorMessage(error, 'The combos could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }
}
