import { DatePipe, DecimalPipe } from '@angular/common';
import { ComponentType } from '@angular/cdk/portal';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { Permissions } from '../../core/auth/permissions';
import { ConsumableItem, ConsumableMovementType, CustodyApi } from '../../core/custody/custody.api';
import { HrAccess } from '../../core/hr/hr-access';
import { errorMessage } from '../../core/http/error-message';
import { BusinessDay } from '../../core/ui/business-day';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { NotifyService } from '../../core/ui/notify.service';
import { FilterOption, FilterSelect } from '../shared/filter-select';
import { ConsumableDialog, ConsumableDialogData, ConsumableHistoryDialog, MovementDialog, MovementDialogData } from './consumable-dialogs';

// Consumables inventory (جرد الاستهلاكيات): the supplies kept in the store and used up, what is
// in stock of each and what it is worth, and those low (at or under their level) or out. Stock
// comes in (وارد), is used up (منصرف) and is counted (جرد), each recorded at once by whoever manages
// on the tab; an item is deleted only before anything was recorded of it. An employee working
// the tab in the portal is never sent what anything cost.
@Component({
  selector: 'app-consumables-page',
  imports: [DatePipe, DecimalPipe, FilterSelect, MatButtonModule, MatIconModule, MatProgressBarModule, MatTooltipModule, MoneyPipe],
  template: `
    <div class="tiles">
      <div class="tile">
        <span class="label">Items · الأصناف</span>
        <strong>{{ items().length }}</strong>
      </div>
      @if (costsShown()) {
        <div class="tile main">
          <span class="label">Stock value · قيمة المخزون</span>
          <strong>{{ worth() | money }}</strong>
          <small class="muted">at what each cost on average</small>
        </div>
      }
      <div class="tile" [class.warn]="low().length > 0">
        <span class="label">Low or out · ناقص أو نافد</span>
        <strong>{{ low().length }}</strong>
        <small class="muted">to buy again</small>
      </div>
    </div>

    <div class="toolbar">
      <app-filter-select label="Stock · المخزون" icon="inventory" [options]="filters()" [(value)]="filter" />
      <span class="spacer"></span>
      @if (canManage()) {
        <button mat-flat-button (click)="add()"><mat-icon>add</mat-icon> Add an item <span class="inline-ar">إضافة صنف</span></button>
      }
    </div>
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    @if (error(); as problem) {
      <p class="error">{{ problem }}</p>
    } @else {
      <div class="table-wrap">
        <table class="grid">
          <thead>
            <tr>
              <th>Item<span class="ar">الصنف</span></th>
              <th class="num">In stock<span class="ar">الرصيد</span></th>
              <th class="num">Low at<span class="ar">حد الطلب</span></th>
              @if (costsShown()) {
                <th class="num">Average cost<span class="ar">متوسط التكلفة</span></th>
                <th class="num">Value<span class="ar">القيمة</span></th>
              }
              <th>Last moved<span class="ar">آخر حركة</span></th>
              <th class="num"><span class="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (c of shown(); track c.id) {
              <tr [class.out]="c.quantity === 0">
                <td>
                  <strong>{{ c.name }}</strong>
                  <div class="muted small">Counted in {{ c.unit }}@if (c.notes) { · {{ c.notes }}}</div>
                </td>
                <td class="num">
                  <span class="stock">{{ c.quantity | number: '1.0-3' }}</span> <span class="muted small">{{ c.unit }}</span>
                  @if (c.quantity === 0) {
                    <div><span class="tag bad">Out<span class="ar">نافد</span></span></div>
                  } @else if (c.isLow) {
                    <div><span class="tag warn">Low<span class="ar">ناقص</span></span></div>
                  }
                </td>
                <td class="num">{{ c.reorderLevel === null ? '—' : (c.reorderLevel | number: '1.0-3') }}</td>
                @if (costsShown()) {
                  <td class="num">{{ c.unitCost ?? 0 | money }}</td>
                  <td class="num">{{ c.totalCost ?? 0 | money }}</td>
                }
                <td class="nowrap">{{ c.lastMovedOn ? (c.lastMovedOn | date: 'd MMM y') : '—' }}</td>
                <td class="num nowrap actions">
                  @if (canManage()) {
                    <button mat-stroked-button (click)="move(c, 'Received')" [attr.aria-label]="'Stock received of ' + c.name"><mat-icon>add</mat-icon> In</button>
                    <button mat-stroked-button (click)="move(c, 'Consumed')" [disabled]="c.quantity === 0" [attr.aria-label]="'Used up of ' + c.name">
                      <mat-icon>remove</mat-icon> Use
                    </button>
                    <button mat-icon-button (click)="move(c, 'Counted')" matTooltip="Count · جرد" [attr.aria-label]="'Count ' + c.name"><mat-icon>fact_check</mat-icon></button>
                  }
                  <button mat-icon-button (click)="history(c)" matTooltip="Its movements" [attr.aria-label]="c.name + '’s movements'"><mat-icon>history</mat-icon></button>
                  @if (canManage()) {
                    <button mat-icon-button (click)="edit(c)" matTooltip="Edit" [attr.aria-label]="'Edit ' + c.name"><mat-icon>edit</mat-icon></button>
                  }
                  @if (canDelete() && !c.lastMovedOn) {
                    <button mat-icon-button class="danger" (click)="remove(c)" matTooltip="Delete" [attr.aria-label]="'Delete ' + c.name"><mat-icon>delete</mat-icon></button>
                  }
                </td>
              </tr>
            } @empty {
              <tr>
                <td [attr.colspan]="costsShown() ? 7 : 5" class="empty">
                  <mat-icon>inventory</mat-icon>
                  @if (items().length) {
                    <span class="note-ar" lang="ar" dir="rtl">لا توجد أصناف بهذه الحالة الآن.</span>
                    None is {{ filter() === 'out' ? 'out of stock' : 'low' }} now.
                  } @else {
                    <span class="note-ar" lang="ar" dir="rtl">لا توجد أصناف بعد. أضف المناديل والمنظفات والأكواب وما يُستهلك، ثم سجّل ما يرد منها وما يُصرف.</span>
                    No items yet. Add the napkins, the detergent, the cups and whatever is used up, then record what comes in and what is used.
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <p class="note">
        <span class="note-ar" lang="ar" dir="rtl">
          الوارد يُسجَّل بتكلفة الوحدة، ومنه يُحسب متوسط تكلفة المخزون؛ والمنصرف وما ينقص في الجرد يُحسبان بهذا المتوسط. الجرد يضبط الرصيد على الكمية الفعلية ويحفظ الفرق. يظهر الصنف ناقصًا عند حد إعادة الطلب أو دونه.
        </span>
        Stock received is entered at what a unit cost, and moves the average; what is used up, or found short on a count, goes at the average. A count
        sets the stock to what was counted and keeps the difference. An item is low at or under its level.
      </p>
    }
  `,
  styleUrl: '../shared/pages.scss',
  styles: `
    .tile.main {
      background: color-mix(in srgb, var(--mat-sys-primary) 6%, var(--mat-sys-surface-container-lowest));
    }
    .tile.warn strong {
      color: var(--tag-warn-fg);
    }
    .small {
      font-size: 0.85em;
    }
    .nowrap {
      white-space: nowrap;
    }
    .stock {
      font-weight: 650;
      font-size: 15px;

      + .muted {
        margin-left: 4px;
      }
    }
    .actions button {
      margin-left: 4px;
    }
    .danger {
      color: var(--mat-sys-error);
    }
    tr.out td {
      background: color-mix(in srgb, var(--tag-bad-bg) 45%, transparent);
    }
  `,
})
export class ConsumablesPage {
  private readonly api = inject(CustodyApi);
  private readonly auth = inject(AuthService);
  private readonly access = inject(HrAccess);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotifyService);
  private readonly businessDay = inject(BusinessDay);

  // An employee working the tab in the portal is never sent what anything cost.
  protected readonly costsShown = computed(() => !this.auth.employeeActing());
  protected readonly canManage = computed(() => this.auth.can(Permissions.HrManage));
  protected readonly canDelete = computed(() => this.access.canDecide('Custody'));

  protected readonly items = signal<ConsumableItem[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  // '' all, 'low' low or out, 'out' none left.
  protected readonly filter = signal('');

  protected readonly low = computed(() => this.items().filter((c) => c.isLow || c.quantity === 0));
  protected readonly out = computed(() => this.items().filter((c) => c.quantity === 0));
  protected readonly filters = computed<FilterOption[]>(() => [
    { value: '', label: 'All items', count: this.items().length },
    { value: 'low', label: 'Low or out', count: this.low().length },
    { value: 'out', label: 'Out of stock', count: this.out().length },
  ]);
  protected readonly shown = computed(() => (this.filter() === 'low' ? this.low() : this.filter() === 'out' ? this.out() : this.items()));
  protected readonly worth = computed(() => this.items().reduce((sum, c) => sum + (c.totalCost ?? 0), 0));

  constructor() {
    void this.load();
  }

  protected async add(): Promise<void> {
    await this.open(ConsumableDialog, {} satisfies ConsumableDialogData, (c) => `${c.name} added.`);
  }

  protected async edit(item: ConsumableItem): Promise<void> {
    await this.open(ConsumableDialog, { item } satisfies ConsumableDialogData, (c) => `${c.name} saved.`);
  }

  protected async move(item: ConsumableItem, type: ConsumableMovementType): Promise<void> {
    const data: MovementDialogData = { item, type, today: await this.businessDay.today(), costHidden: !this.costsShown() };
    await this.open(MovementDialog, data, (c) => `Recorded: ${c.name} now ${c.quantity} ${c.unit}.`);
  }

  protected history(item: ConsumableItem): void {
    this.dialog.open(ConsumableHistoryDialog, { data: { itemId: item.id }, width: '760px', maxWidth: '95vw' });
  }

  // Only one nothing was recorded of: there is nothing to lose.
  protected async remove(item: ConsumableItem): Promise<void> {
    try {
      await firstValueFrom(this.api.deleteConsumable(item.id));
      this.notify.info(`${item.name} deleted.`);
      await this.load();
    } catch (error) {
      this.notify.error(error, 'It could not be deleted.');
    }
  }

  private async open<D>(component: ComponentType<unknown>, data: D, done: (item: ConsumableItem) => string): Promise<void> {
    const saved = await firstValueFrom(
      this.dialog.open<unknown, D, ConsumableItem>(component, { data, width: '560px', maxWidth: '95vw' }).afterClosed(),
    );
    if (!saved) {
      return;
    }
    this.notify.info(done(saved));
    await this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.items.set(await firstValueFrom(this.api.consumables()));
    } catch (error) {
      this.error.set(errorMessage(error, 'The inventory could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }
}
