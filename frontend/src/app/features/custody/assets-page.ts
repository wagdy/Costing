import { ComponentType } from '@angular/cdk/portal';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { Permissions } from '../../core/auth/permissions';
import { AssetCategory, AssetItem, CustodyApi, isGone, statusLabels } from '../../core/custody/custody.api';
import { Employee, HrApi } from '../../core/hr/hr.api';
import { errorMessage } from '../../core/http/error-message';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { NotifyService } from '../../core/ui/notify.service';
import { Approvals, pendingLabel } from '../approvals/approvals';
import { BusinessDay } from '../../core/ui/business-day';
import { FilterOption, FilterSelect } from '../shared/filter-select';
import {
  AssetDialog,
  AssetDialogData,
  AssetHistoryDialog,
  CheckInDialog,
  CheckInDialogData,
  CheckOutDialog,
  CheckOutDialogData,
  CustodyAnswer,
  wasAsked,
} from './custody-dialogs';

// The assets (الأصول): what there is of each, a piece's cost and the whole's, whose custody it is
// in or where it is, and its vouchers. What is gone (all broken or discarded) is shown when
// asked. Whoever manages HR adds, checks in and out, an accountant's going to a manager, its row
// locked until then.
@Component({
  selector: 'app-assets-page',
  imports: [FilterSelect, FormsModule, MatButtonModule, MatIconModule, MatProgressBarModule, MatSlideToggleModule, MatTooltipModule, MoneyPipe],
  template: `
    <div class="toolbar">
      <app-filter-select label="Category · الفئة" icon="category" [options]="categoryFilters()" [(value)]="category" />
      <mat-slide-toggle [ngModel]="showGone()" (ngModelChange)="showGone.set($event)">Show what is gone · عرض المستبعد</mat-slide-toggle>
      <span class="spacer"></span>
      <span class="muted">{{ shown().length }} {{ shown().length === 1 ? 'asset' : 'assets' }}@if (costsShown()) { · {{ worth() | money }}}</span>
      @if (canManage()) {
        <button mat-flat-button (click)="add()"><mat-icon>add</mat-icon> Add an asset <span class="inline-ar">إضافة أصل</span></button>
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
              <th>Asset<span class="ar">الأصل</span></th>
              <th class="num">How many<span class="ar">العدد</span></th>
              @if (costsShown()) {
                <th class="num">Cost a piece<span class="ar">تكلفة القطعة</span></th>
                <th class="num">Total<span class="ar">الإجمالي</span></th>
              }
              <th>Custody<span class="ar">العهدة</span></th>
              <th class="num"><span class="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (a of shown(); track a.id) {
              @let asked = approvals.pendingFor(a.id);
              <tr [class.gone]="gone(a)" [class.pending-deletion]="!!asked">
                <td>
                  <strong>{{ a.name }}</strong>
                  <div class="muted small">
                    {{ a.categoryName ?? 'No category' }}@if (a.isConsumable) { · consumable }@if (a.notes) { · {{ a.notes }} }
                  </div>
                  @if (asked) {
                    <div><span class="pending-badge">{{ pendingLabel(asked).en }}<span class="ar">{{ pendingLabel(asked).ar }}</span></span></div>
                  }
                </td>
                <td class="num">{{ a.quantity }}</td>
                @if (costsShown()) {
                  <td class="num">{{ a.unitCost === null ? '—' : (a.unitCost | money) }}</td>
                  <td class="num">{{ a.totalCost === null ? '—' : (a.totalCost | money) }}</td>
                }
                <td>
                  @if (a.employeeName) {
                    <strong>{{ a.employeeName }}</strong>
                  }
                  <div><span class="status tag" [class]="a.status">{{ statusLabels[a.status].en }}<span class="ar">{{ statusLabels[a.status].ar }}</span></span></div>
                </td>
                <td class="num nowrap">
                  <button mat-icon-button (click)="history(a)" matTooltip="Its vouchers" [attr.aria-label]="a.name + '’s vouchers'"><mat-icon>history</mat-icon></button>
                  @if (canManage()) {
                    @if (asked) {
                      <mat-icon class="locked" matTooltip="Waiting for a manager's approval">lock_clock</mat-icon>
                    } @else if (!gone(a)) {
                      @if (a.status !== 'InCustody') {
                        <button mat-stroked-button (click)="checkIn(a)" [attr.aria-label]="'Check in ' + a.name"><mat-icon>login</mat-icon> In</button>
                      }
                      <button mat-stroked-button (click)="checkOut(a)" [attr.aria-label]="'Check out ' + a.name"><mat-icon>logout</mat-icon> Out</button>
                      <button mat-icon-button (click)="edit(a)" matTooltip="Edit" [attr.aria-label]="'Edit ' + a.name"><mat-icon>edit</mat-icon></button>
                    }
                  }
                </td>
              </tr>
            } @empty {
              <tr>
                <td [attr.colspan]="costsShown() ? 6 : 4" class="empty">
                  @if (assets().length) {
                    <mat-icon>search_off</mat-icon>
                    <span class="note-ar" lang="ar" dir="rtl">لا يوجد ما يُعرض هنا: جرّب فئة أخرى، أو اعرض المستبعد.</span>
                    Nothing to show here: try another category, or show what is gone.
                  } @else {
                    <mat-icon>inventory_2</mat-icon>
                    <span class="note-ar" lang="ar" dir="rtl">لا توجد أصول بعد. أضف الأطباق والأدوات والأجهزة، ثم قم بتسجيلها كعهدة للموظفين.</span>
                    No assets yet. Add the plates, the tools and the devices, then check each into someone's custody.
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
  styleUrl: '../shared/pages.scss',
  styles: `
    .small {
      font-size: 0.85em;
    }
    .nowrap {
      white-space: nowrap;

      button {
        margin-left: 4px;
      }
    }
    tr.gone td {
      color: var(--mat-sys-on-surface-variant);
    }
    // Where an asset is, as a tag (styles.scss): in custody green, the store blue, maintenance
    // amber, broken red, thrown away grey.
    .status.tag {
      &.InCustody {
        --tag-bg: var(--tag-ok-bg);
        --tag-fg: var(--tag-ok-fg);
      }
      &.InStore {
        --tag-bg: var(--tag-info-bg);
        --tag-fg: var(--tag-info-fg);
      }
      &.Maintenance {
        --tag-bg: var(--tag-warn-bg);
        --tag-fg: var(--tag-warn-fg);
      }
      &.Broken {
        --tag-bg: var(--tag-bad-bg);
        --tag-fg: var(--tag-bad-fg);
      }
    }
  `,
})
export class AssetsPage {
  private readonly api = inject(CustodyApi);
  private readonly hr = inject(HrApi);
  private readonly auth = inject(AuthService);
  // An employee working the tab in the portal is never sent what an asset cost.
  protected readonly costsShown = computed(() => !this.auth.employeeActing());
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotifyService);
  private readonly businessDay = inject(BusinessDay);
  protected readonly approvals = inject(Approvals);
  protected readonly pendingLabel = pendingLabel;
  protected readonly statusLabels = statusLabels;
  protected readonly gone = isGone;

  protected readonly assets = signal<AssetItem[]>([]);
  protected readonly categories = signal<AssetCategory[]>([]);
  protected readonly category = signal('');
  protected readonly showGone = signal(false);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly canManage = computed(() => this.auth.can(Permissions.HrManage));

  protected readonly shown = computed(() =>
    this.assets().filter((a) => (this.showGone() || !isGone(a)) && (!this.category() || a.categoryId === this.category())),
  );
  protected readonly worth = computed(() => this.shown().reduce((sum, a) => sum + (a.totalCost ?? 0), 0));
  // The categories to pick from, each with how many of its assets show (what is gone too, when shown).
  protected readonly categoryFilters = computed<FilterOption[]>(() => {
    const listed = this.assets().filter((a) => this.showGone() || !isGone(a));
    return [
      { value: '', label: 'All categories', count: listed.length },
      ...this.categories().map((c) => ({ value: c.id, label: c.name, count: listed.filter((a) => a.categoryId === c.id).length })),
    ];
  });

  constructor() {
    void this.load();
    void this.approvals.refresh();
  }

  protected async add(): Promise<void> {
    await this.open(AssetDialog, { categories: this.categories(), canApprove: this.approvals.canApprove() } satisfies AssetDialogData, 'Asset added.');
  }

  protected async edit(asset: AssetItem): Promise<void> {
    await this.open(
      AssetDialog,
      { asset, categories: this.categories(), canApprove: this.approvals.canApprove(), costHidden: !this.costsShown() } satisfies AssetDialogData,
      `${asset.name} saved.`,
    );
  }

  protected async checkIn(asset: AssetItem): Promise<void> {
    let employees: Employee[];
    try {
      employees = (await firstValueFrom(this.hr.employees())).filter((e) => e.isActive);
    } catch (error) {
      this.notify.error(error, 'The employees could not be loaded.');
      return;
    }
    const data: CheckInDialogData = { asset, employees, today: await this.businessDay.today(), canApprove: this.approvals.canApprove() };
    await this.open(CheckInDialog, data, `${asset.name} checked in.`);
  }

  protected async checkOut(asset: AssetItem): Promise<void> {
    const data: CheckOutDialogData = { asset, today: await this.businessDay.today(), canApprove: this.approvals.canApprove() };
    await this.open(CheckOutDialog, data, `${asset.name} checked out.`);
  }

  protected history(asset: AssetItem): void {
    this.dialog.open(AssetHistoryDialog, { data: { assetId: asset.id }, width: '720px', maxWidth: '95vw' });
  }

  private async open<D>(component: ComponentType<unknown>, data: D, done: string): Promise<void> {
    const result = await firstValueFrom(
      this.dialog.open<unknown, D, CustodyAnswer>(component, { data, width: '620px', maxWidth: '95vw' }).afterClosed(),
    );
    if (!result) {
      return;
    }
    if (wasAsked(result)) {
      await this.approvals.requested(result);
    } else {
      this.notify.info(done);
    }
    await this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [assets, categories] = await Promise.all([firstValueFrom(this.api.assets()), firstValueFrom(this.api.categories())]);
      this.assets.set(assets);
      this.categories.set(categories);
    } catch (error) {
      this.error.set(errorMessage(error, 'The assets could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }
}
