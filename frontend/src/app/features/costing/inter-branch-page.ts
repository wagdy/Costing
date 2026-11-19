import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Observable, firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { Permissions } from '../../core/auth/permissions';
import { CostingApi, MaterialCost } from '../../core/costing/costing.api';
import {
  InterBranchApi,
  InterBranchHub,
  Receipt,
  Requisition,
  Shipment,
  requisitionStatusLabels,
  shipmentStatusLabels,
  supplies,
} from '../../core/costing/inter-branch.api';
import { errorMessage } from '../../core/http/error-message';
import { Company } from '../../core/settings/company';
import { branchTypeLabels } from '../../core/settings/company-structure';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { NotifyService } from '../../core/ui/notify.service';
import { saveBlob } from '../../core/ui/save-blob';
import { FilterOption, FilterSelect } from '../shared/filter-select';
import { SearchField } from '../shared/search-field';
import { smartMatch } from '../shared/smart-search';
import { isoDay } from './financials';
import { InfoTip } from './info-tip';
import { openDispatchDialog, openReceiveDialog, openRequisitionDialog } from './inter-branch-dialogs';
import { printReceipt, printRequisition, printShipment, requisitionWhatsApp, shownQuantity } from './inter-branch-paper';

export type HubTab = 'requisitions' | 'dispatches' | 'receipts';
const hubTabs: HubTab[] = ['requisitions', 'dispatches', 'receipts'];

// The central kitchen's hub (المطبخ المركزي وتحويلات الفروع), for the branch chosen at the top of
// the screen: a restaurant asks the kitchen for goods and receives what it sends; the kitchen sends
// and bills them. Its cards count what is open, on its way and received this month, and what was
// billed (for whoever sees costs); its three tabs hold the requisitions, the kitchen's dispatches
// and the branches' receipts, each printed, the requisitions copied for WhatsApp, all of a period
// as a workbook. Only in a company run with a central kitchen.
@Component({
  selector: 'app-inter-branch-page',
  imports: [
    DatePipe, FilterSelect, FormsModule, InfoTip, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressBarModule, MatTabsModule,
    MatTooltipModule, MoneyPipe, SearchField,
  ],
  template: `
    @if (loading() && !hub()) {
      <mat-progress-bar mode="indeterminate" />
    } @else if (error()) {
      <p class="error">{{ error() }}</p>
    } @else if (hub(); as h) {
      @if (h.mode !== 'MultiBranch_CentralKitchen') {
        <div class="empty" role="status">
          <mat-icon>soup_kitchen</mat-icon>
          <p><strong>The company is not run with a central kitchen.</strong></p>
          <p class="muted">
            Requisitions, dispatches and receipts between branches need the structure Branches with a central kitchen, on Settings, Company structure.
            <span class="inline-ar">الشركة ليست بنظام المطبخ المركزي؛ اختر "فروع متعددة يدعمها مطبخ مركزي" من إعدادات هيكل الشركة.</span>
          </p>
        </div>
      } @else {
        <p class="note">
          <app-info-tip tip="interBranchHub" />
          Working in <strong>{{ h.branch }}</strong> ({{ typeLabel() }}).
          @if (isSupplier()) {
            Fill the branches' requisitions and send them their goods, billed on an internal sales invoice.
          } @else {
            Ask the central kitchen for goods and receive what it sends, on an internal purchase invoice.
          }
          <span class="inline-ar">اختر الفرع من أعلى الشاشة.</span>
        </p>

        <div class="cards">
          <div class="card">
            <span class="label">Open requisitions <app-info-tip tip="openRequisitions" /><span class="ar">طلبات فروع قيد الانتظار</span></span>
            <span class="value">{{ h.summary.openRequisitions }}</span>
          </div>
          <div class="card">
            <span class="label">Shipments in transit <app-info-tip tip="shipmentsInTransit" /><span class="ar">شحنات في الطريق للفروع</span></span>
            <span class="value">{{ h.summary.shipmentsInTransit }}</span>
          </div>
          <div class="card">
            <span class="label">Receipts this month <app-info-tip tip="receiptsThisMonth" /><span class="ar">شحنات مستلمة هذا الشهر</span></span>
            <span class="value">{{ h.summary.receiptsThisMonth }}</span>
          </div>
          @if (seesCosts() && h.summary.billingThisMonth !== null) {
            <div class="card">
              <span class="label">Inter-branch billing <app-info-tip tip="interBranchBilling" /><span class="ar">إجمالي فوترة المطبخ المركزي</span></span>
              <span class="value">{{ h.summary.billingThisMonth | money }}</span>
            </div>
          }
        </div>

        <div class="toolbar">
          <mat-form-field subscriptSizing="dynamic" class="day">
            <mat-label>From day · من يوم</mat-label>
            <input matInput type="date" [ngModel]="fromDay()" (ngModelChange)="setDays($event, toDay())" [max]="toDay()" aria-label="From day" />
          </mat-form-field>
          <mat-form-field subscriptSizing="dynamic" class="day">
            <mat-label>To day · إلى يوم</mat-label>
            <input matInput type="date" [ngModel]="toDay()" (ngModelChange)="setDays(fromDay(), $event)" [min]="fromDay()" aria-label="To day" />
          </mat-form-field>
          <span class="spacer"></span>
          <button mat-stroked-button (click)="downloadSheet()" [disabled]="downloading()"><mat-icon>download</mat-icon> Excel <span class="inline-ar">إكسل</span></button>
          @if (canAsk()) {
            <button mat-flat-button (click)="newRequisition()"><mat-icon>add_shopping_cart</mat-icon> New requisition <span class="inline-ar">طلب بضاعة</span></button>
          }
          @if (canDispatch()) {
            <button mat-flat-button (click)="dispatch(null)"><mat-icon>local_shipping</mat-icon> Direct dispatch <span class="inline-ar">صرف مباشر لفرع</span></button>
          }
        </div>

        <mat-tab-group [selectedIndex]="tabIndex()" (selectedIndexChange)="tabIndex.set($event)" animationDuration="0ms" mat-stretch-tabs="false">
          <mat-tab label="Requisitions · طلبات الفروع">
            <div class="toolbar smart">
              <app-search-field [(value)]="search" placeholder="Number, branch or material · الرقم أو الفرع أو الخامة" />
              <div class="pills">
                <app-filter-select label="Status · الحالة" icon="flag" [options]="requisitionFilters()" [(value)]="requisitionStatus" />
              </div>
            </div>
            <div class="table-wrap">
              <table class="grid" aria-label="Requisitions">
                <thead>
                  <tr>
                    <th>Number<span class="ar">الرقم</span></th>
                    <th>Day<span class="ar">اليوم</span></th>
                    <th>Branch → Kitchen<span class="ar">الفرع ← المركزي</span></th>
                    <th>Asked for<span class="ar">المطلوب</span></th>
                    <th>Status<span class="ar">الحالة</span></th>
                    <th class="num"><span class="visually-hidden">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  @for (r of shownRequisitions(); track r.id) {
                    <tr [class.focused]="r.id === focus()" [class.voided]="r.status === 'Cancelled'">
                      <td class="nowrap"><strong>{{ r.number }}</strong></td>
                      <td class="nowrap">
                        {{ r.requestDate | date: 'd MMM' }}
                        @if (r.requestedDeliveryDate) {
                          <div class="muted tiny">Wanted {{ r.requestedDeliveryDate | date: 'd MMM' }}</div>
                        }
                      </td>
                      <td class="route">{{ r.requestingBranch }} → {{ r.supplyingBranch }}</td>
                      <td>
                        @for (l of r.lines; track l.rawMaterialId; let last = $last) {
                          <span class="nowrap">{{ l.material }} {{ qty(l.requestedQuantity, l.unit, l.purchaseUnitSize) }}</span>@if (!last) {, }
                        }
                        @if (r.notes) {
                          <div class="muted tiny">{{ r.notes }}</div>
                        }
                      </td>
                      <td><span class="status" [attr.data-status]="r.status">{{ requisitionLabel(r) }}</span></td>
                      <td class="num nowrap">
                        <button mat-icon-button (click)="printRequisition(r)" matTooltip="Print slip · طباعة" [attr.aria-label]="'Print ' + r.number"><mat-icon>print</mat-icon></button>
                        <button mat-icon-button (click)="copyWhatsApp(r)" matTooltip="Copy for WhatsApp · نسخ لواتساب" [attr.aria-label]="'Copy ' + r.number + ' for WhatsApp'"><mat-icon>content_copy</mat-icon></button>
                        @if (canFill(r)) {
                          <button mat-flat-button (click)="dispatch(r)" [attr.aria-label]="'Dispatch and bill ' + r.number"><mat-icon>local_shipping</mat-icon> Dispatch & Bill</button>
                        }
                        @if (canManage() && r.status === 'Submitted') {
                          <button mat-icon-button class="danger" (click)="cancel(r)" matTooltip="Cancel · إلغاء" [attr.aria-label]="'Cancel ' + r.number"><mat-icon>block</mat-icon></button>
                        }
                      </td>
                    </tr>
                  } @empty {
                    <tr><td colspan="6" class="muted">No requisitions. · لا توجد طلبات.</td></tr>
                  }
                </tbody>
              </table>
            </div>
          </mat-tab>

          <mat-tab label="Central kitchen dispatches (ISI) · صرف وفواتير بيع المركزي">
            <div class="toolbar smart">
              <app-search-field [(value)]="search" placeholder="Number, branch or material · الرقم أو الفرع أو الخامة" />
              <div class="pills">
                <app-filter-select label="Status · الحالة" icon="flag" [options]="shipmentFilters()" [(value)]="shipmentStatus" />
              </div>
            </div>
            <div class="table-wrap">
              <table class="grid" aria-label="Dispatches">
                <thead>
                  <tr>
                    <th>Number<span class="ar">الرقم</span></th>
                    <th>Day<span class="ar">اليوم</span></th>
                    <th>Kitchen → Branch<span class="ar">المركزي ← الفرع</span></th>
                    <th>Sent<span class="ar">المرسل</span></th>
                    <th>Status<span class="ar">الحالة</span></th>
                    @if (seesCosts()) {
                      <th class="num">Billed<span class="ar">الإيراد الداخلي</span></th>
                      <th class="num">Margin<span class="ar">الهامش</span></th>
                    }
                    <th class="num"><span class="visually-hidden">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  @for (s of shownShipments(); track s.id) {
                    <tr [class.focused]="s.id === focus()" [class.voided]="s.status === 'Voided'">
                      <td class="nowrap">
                        <strong>{{ s.number }}</strong>
                        <div class="muted tiny">{{ s.requisitionNumber ?? 'Direct · مباشر' }}</div>
                      </td>
                      <td class="nowrap">{{ s.dispatchDate | date: 'd MMM' }}</td>
                      <td class="route">{{ s.supplyingBranch }} → {{ s.receivingBranch }}<div class="muted tiny">from {{ s.fromLocation }}</div></td>
                      <td>
                        @for (l of s.lines; track l.rawMaterialId; let last = $last) {
                          <span class="nowrap">{{ l.material }} {{ qty(l.quantity, l.unit, l.purchaseUnitSize) }}</span>@if (!last) {, }
                        }
                      </td>
                      <td>
                        <span class="status" [attr.data-status]="s.status">{{ shipmentLabel(s) }}</span>
                        @if (s.receiptNumber) {
                          <div class="muted tiny">{{ s.receiptNumber }}</div>
                        }
                      </td>
                      @if (seesCosts()) {
                        <td class="num">{{ s.totalTransferRevenue === null ? '' : (s.totalTransferRevenue | money) }}</td>
                        <td class="num muted">{{ s.internalMargin === null ? '' : (s.internalMargin | money) }}</td>
                      }
                      <td class="num nowrap">
                        <button mat-icon-button (click)="printShipment(s)" [matTooltip]="seesCosts() ? 'Print the internal invoice · طباعة الفاتورة' : 'Print the delivery note · طباعة إذن التسليم'"
                          [attr.aria-label]="'Print ' + s.number"><mat-icon>print</mat-icon></button>
                        @if (canReceive(s)) {
                          <button mat-flat-button (click)="receive(s)" [attr.aria-label]="'Receive ' + s.number"><mat-icon>inventory</mat-icon> Receive</button>
                        }
                        @if (canVoidShipment(s)) {
                          <button mat-icon-button class="danger" (click)="voidShipment(s)" matTooltip="Void · إلغاء" [attr.aria-label]="'Void ' + s.number"><mat-icon>undo</mat-icon></button>
                        }
                      </td>
                    </tr>
                  } @empty {
                    <tr><td [attr.colspan]="seesCosts() ? 8 : 6" class="muted">No dispatches. · لا يوجد صرف.</td></tr>
                  }
                </tbody>
              </table>
            </div>
          </mat-tab>

          <mat-tab label="Branch receipts (IPI) · استلامات وفواتير شراء الفروع">
            <h2 class="section-title">Incoming shipments <span class="inline-ar">شحنات واردة من المركزي</span></h2>
            <div class="table-wrap">
              <table class="grid" aria-label="Incoming shipments">
                <thead>
                  <tr>
                    <th>Shipment<span class="ar">الشحنة</span></th>
                    <th>Day<span class="ar">اليوم</span></th>
                    <th>From<span class="ar">من</span></th>
                    <th>Sent<span class="ar">المرسل</span></th>
                    <th class="num"><span class="visually-hidden">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  @for (s of incoming(); track s.id) {
                    <tr>
                      <td class="nowrap"><strong>{{ s.number }}</strong><div class="muted tiny">{{ s.requisitionNumber ?? 'Direct · مباشر' }}</div></td>
                      <td class="nowrap">{{ s.dispatchDate | date: 'd MMM' }}</td>
                      <td>{{ s.supplyingBranch }}</td>
                      <td>
                        @for (l of s.lines; track l.rawMaterialId; let last = $last) {
                          <span class="nowrap">{{ l.material }} {{ qty(l.quantity, l.unit, l.purchaseUnitSize) }}</span>@if (!last) {, }
                        }
                      </td>
                      <td class="num">
                        @if (canManage()) {
                          <button mat-flat-button (click)="receive(s)" [attr.aria-label]="'Receive ' + s.number"><mat-icon>inventory</mat-icon> Receive shipment · تأكيد الاستلام</button>
                        }
                      </td>
                    </tr>
                  } @empty {
                    <tr><td colspan="5" class="muted">Nothing on its way here. · لا توجد شحنات واردة.</td></tr>
                  }
                </tbody>
              </table>
            </div>

            <h2 class="section-title">Receipts <span class="inline-ar">الاستلامات</span></h2>
            <div class="table-wrap">
              <table class="grid" aria-label="Receipts">
                <thead>
                  <tr>
                    <th>Number<span class="ar">الرقم</span></th>
                    <th>Day<span class="ar">اليوم</span></th>
                    <th>Kitchen → Branch<span class="ar">المركزي ← الفرع</span></th>
                    <th>Received<span class="ar">المستلم</span></th>
                    @if (seesCosts()) {
                      <th class="num">Billed<span class="ar">المفوتر</span></th>
                      <th class="num">Transit loss<span class="ar">عجز النقل</span></th>
                    }
                    <th class="num"><span class="visually-hidden">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  @for (p of shownReceipts(); track p.id) {
                    <tr [class.focused]="p.id === focus()" [class.voided]="p.status === 'Voided'">
                      <td class="nowrap">
                        <strong>{{ p.number }}</strong>
                        <div class="muted tiny">{{ p.shipmentNumber }}</div>
                        @if (p.status === 'Voided') {
                          <div><span class="void-badge">Voided · ملغي</span></div>
                        }
                      </td>
                      <td class="nowrap">{{ p.receiptDate | date: 'd MMM' }}</td>
                      <td class="route">{{ p.supplyingBranch }} → {{ p.receivingBranch }}<div class="muted tiny">into {{ p.toLocation }}</div></td>
                      <td>
                        @for (l of p.lines; track l.rawMaterialId; let last = $last) {
                          <span class="nowrap">{{ l.material }} {{ qty(l.receivedQuantity, l.unit, l.purchaseUnitSize) }}</span>
                          @if (l.shortQuantity > 0) {
                            <span class="short"> ({{ qty(l.shortQuantity, l.unit, l.purchaseUnitSize) }} short)</span>
                          }
                          @if (!last) {, }
                        }
                        @if (p.notes) {
                          <div class="muted tiny">{{ p.notes }}</div>
                        }
                      </td>
                      @if (seesCosts()) {
                        <td class="num">{{ p.totalBilled === null ? '' : (p.totalBilled | money) }}</td>
                        <td class="num" [class.short]="(p.totalTransitLoss ?? 0) > 0">{{ p.totalTransitLoss ? (p.totalTransitLoss | money) : '—' }}</td>
                      }
                      <td class="num nowrap">
                        <button mat-icon-button (click)="printReceipt(p)" matTooltip="View the internal purchase invoice · عرض الفاتورة" [attr.aria-label]="'Print ' + p.number">
                          <mat-icon>receipt_long</mat-icon>
                        </button>
                        @if (isManager() && p.status === 'Posted') {
                          <button mat-icon-button class="danger" (click)="voidReceipt(p)" matTooltip="Void both invoices · إلغاء الاستلام والفاتورة" [attr.aria-label]="'Void ' + p.number">
                            <mat-icon>undo</mat-icon>
                          </button>
                        }
                      </td>
                    </tr>
                  } @empty {
                    <tr><td [attr.colspan]="seesCosts() ? 7 : 5" class="muted">No receipts. · لا توجد استلامات.</td></tr>
                  }
                </tbody>
              </table>
            </div>
          </mat-tab>
        </mat-tab-group>
      }
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .empty { display: grid; justify-items: center; gap: 4px; padding: 32px 16px; text-align: center; }
    .empty mat-icon { font-size: 40px; width: 40px; height: 40px; color: var(--mat-sys-on-surface-variant); }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 12px 0; }
    .card {
      display: grid; gap: 6px; padding: 14px 16px; border-radius: 12px; border: 1px solid var(--app-line-strong, var(--mat-sys-outline-variant));
      background: var(--mat-sys-surface-container-lowest);
    }
    .card .label { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; font: var(--mat-sys-label-large); color: var(--mat-sys-on-surface-variant); }
    .card .label .ar { flex-basis: 100%; font-size: 0.85em; }
    .card .value { font: var(--mat-sys-headline-small); }
    .day { width: 170px; }
    .section-title { margin: 16px 0 8px; font: var(--mat-sys-title-medium); }
    .tiny { font-size: 0.85em; }
    .nowrap { white-space: nowrap; }
    .route { min-width: 170px; }
    .short { color: var(--mat-sys-error); font-weight: 600; }
    .danger { color: var(--mat-sys-error); }
    tr.focused td { background: color-mix(in srgb, var(--mat-sys-primary) 10%, transparent); }
    tr.voided td { color: var(--mat-sys-on-surface-variant); }
    .status { display: inline-block; padding: 0 8px; border-radius: 999px; font-size: 0.85em; white-space: nowrap;
      background: color-mix(in srgb, var(--mat-sys-primary) 10%, transparent); }
    .status[data-status='Cancelled'], .status[data-status='Voided'] { color: var(--mat-sys-error); background: color-mix(in srgb, var(--mat-sys-error) 10%, transparent); }
    .status[data-status='Received'] { color: var(--mat-sys-tertiary); }
    .void-badge { display: inline-block; padding: 0 6px; border-radius: 999px; font-size: 0.8em; color: var(--mat-sys-error);
      background: color-mix(in srgb, var(--mat-sys-error) 10%, transparent); }
    .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  `,
})
export class InterBranchPage {
  private readonly api = inject(InterBranchApi);
  private readonly costing = inject(CostingApi);
  private readonly auth = inject(AuthService);
  private readonly notify = inject(NotifyService);
  private readonly dialog = inject(MatDialog);
  private readonly company = inject(Company);

  // Opened from a stock card: its tab, the record marked, its day in the period.
  readonly tab = input<string | undefined>(undefined);
  readonly focus = input<string | undefined>(undefined);
  readonly day = input<string | undefined>(undefined);

  protected readonly canManage = computed(() => this.auth.can(Permissions.InventoryManage));
  // Costs, prices and totals for whoever sees costs: a storekeeper moves the goods without them.
  protected readonly seesCosts = computed(() => this.auth.can(Permissions.CostingView));
  protected readonly isManager = computed(() => this.auth.can(Permissions.ApprovalDecide));

  protected readonly hub = signal<InterBranchHub | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly downloading = signal(false);
  protected readonly tabIndex = signal(0);
  protected readonly toDay = signal(isoDay(new Date()));
  protected readonly fromDay = signal(isoDay(new Date(Date.now() - 29 * 86_400_000)));
  protected readonly search = signal('');
  protected readonly requisitionStatus = signal('');
  protected readonly shipmentStatus = signal('');
  private materials: MaterialCost[] | null = null;

  protected readonly isSupplier = computed(() => supplies(this.hub()?.branchType));
  protected readonly typeLabel = computed(() => {
    const type = this.hub()?.branchType;
    return type ? `${branchTypeLabels[type].en} · ${branchTypeLabels[type].ar}` : '';
  });
  // The central kitchens and warehouses this branch may ask.
  protected readonly suppliers = computed(() => (this.hub()?.branches ?? []).filter((b) => b.isActive && supplies(b.type) && b.id !== this.hub()?.branchId));
  protected readonly canAsk = computed(() => this.canManage() && this.suppliers().length > 0);
  protected readonly canDispatch = computed(() => this.canManage() && this.isSupplier());
  protected readonly incoming = computed(() =>
    (this.hub()?.shipments ?? []).filter((s) => s.status === 'InTransit' && s.receivingBranchId === this.hub()?.branchId),
  );

  protected readonly requisitionFilters = computed<FilterOption[]>(() => {
    const all = this.hub()?.requisitions ?? [];
    return [
      { value: '', label: 'All · الكل', count: all.length },
      ...(Object.keys(requisitionStatusLabels) as (keyof typeof requisitionStatusLabels)[]).map((s) => ({
        value: s, label: `${requisitionStatusLabels[s].en} · ${requisitionStatusLabels[s].ar}`, count: all.filter((r) => r.status === s).length,
      })),
    ];
  });
  protected readonly shipmentFilters = computed<FilterOption[]>(() => {
    const all = this.hub()?.shipments ?? [];
    return [
      { value: '', label: 'All · الكل', count: all.length },
      ...(Object.keys(shipmentStatusLabels) as (keyof typeof shipmentStatusLabels)[]).map((s) => ({
        value: s, label: `${shipmentStatusLabels[s].en} · ${shipmentStatusLabels[s].ar}`, count: all.filter((x) => x.status === s).length,
      })),
    ];
  });

  protected readonly shownRequisitions = computed(() =>
    (this.hub()?.requisitions ?? []).filter(
      (r) => (!this.requisitionStatus() || r.status === this.requisitionStatus())
        && smartMatch(this.search(), r.number, r.requestingBranch, r.supplyingBranch, r.notes ?? '', ...r.lines.map((l) => l.material)),
    ),
  );
  protected readonly shownShipments = computed(() =>
    (this.hub()?.shipments ?? []).filter(
      (s) => (!this.shipmentStatus() || s.status === this.shipmentStatus())
        && smartMatch(this.search(), s.number, s.requisitionNumber ?? '', s.supplyingBranch, s.receivingBranch, ...s.lines.map((l) => l.material)),
    ),
  );
  protected readonly shownReceipts = computed(() =>
    (this.hub()?.receipts ?? []).filter((p) =>
      smartMatch(this.search(), p.number, p.shipmentNumber, p.requisitionNumber ?? '', p.supplyingBranch, p.notes ?? '', ...p.lines.map((l) => l.material)),
    ),
  );

  constructor() {
    // Opened on a tab, a day brought into the period: once, as the page opens.
    effect(() => {
      const [tab, day] = [this.tab(), this.day()];
      untracked(() => {
        const index = hubTabs.indexOf(tab as HubTab);
        if (index >= 0) {
          this.tabIndex.set(index);
        }
        if (day && day < this.fromDay()) {
          this.fromDay.set(day);
        }
        void this.load();
      });
    });
  }

  protected qty(quantity: number, unit: string, purchaseUnitSize: number): string {
    return shownQuantity(quantity, unit, purchaseUnitSize);
  }

  protected requisitionLabel(r: Requisition): string {
    const l = requisitionStatusLabels[r.status];
    return `${l.en} · ${l.ar}`;
  }

  protected shipmentLabel(s: Shipment): string {
    const l = shipmentStatusLabels[s.status];
    return `${l.en} · ${l.ar}`;
  }

  // The kitchen asked fills it: while nothing, or part of it, is sent.
  protected canFill(r: Requisition): boolean {
    return this.canDispatch() && r.supplyingBranchId === this.hub()?.branchId && (r.status === 'Submitted' || r.status === 'PartiallyDispatched');
  }

  protected canReceive(s: Shipment): boolean {
    return this.canManage() && s.status === 'InTransit' && s.receivingBranchId === this.hub()?.branchId;
  }

  protected canVoidShipment(s: Shipment): boolean {
    return this.canManage() && s.status === 'InTransit' && s.supplyingBranchId === this.hub()?.branchId;
  }

  protected setDays(from: string, to: string): void {
    if (!from || !to || from > to) {
      return;
    }
    this.fromDay.set(from);
    this.toDay.set(to);
    void this.load();
  }

  protected async newRequisition(): Promise<void> {
    const made = await openRequisitionDialog(this.dialog, { suppliers: this.suppliers(), materials: await this.materialList() });
    if (made) {
      this.notify.info(`${made.number} sent to ${made.supplyingBranch}.`);
      this.tabIndex.set(0);
      await this.load();
    }
  }

  protected async dispatch(requisition: Requisition | null): Promise<void> {
    const h = this.hub();
    if (!h) {
      return;
    }
    const receivers = h.branches.filter((b) => b.isActive && b.id !== h.branchId);
    const sent = await openDispatchDialog(this.dialog, { requisition, receivers, materials: await this.materialList(), seesCosts: this.seesCosts() });
    if (sent) {
      this.notify.info(`${sent.number} dispatched to ${sent.receivingBranch}.`);
      this.tabIndex.set(1);
      await this.load();
    }
  }

  protected async receive(shipment: Shipment): Promise<void> {
    const made = await openReceiveDialog(this.dialog, { shipment, seesCosts: this.seesCosts() });
    if (made) {
      this.notify.info(`${made.number} received into ${made.toLocation}.`);
      this.tabIndex.set(2);
      await this.load();
    }
  }

  protected async cancel(r: Requisition): Promise<void> {
    if (!confirm(`Cancel ${r.number}? Nothing has been sent for it. · إلغاء الطلب؟`)) {
      return;
    }
    await this.act(() => this.api.cancel(r.id), `${r.number} cancelled.`, 'The requisition could not be cancelled.');
  }

  protected async voidShipment(s: Shipment): Promise<void> {
    if (!confirm(`Void ${s.number}? Its goods go back to ${s.fromLocation} and its internal invoice is voided. · إلغاء الصرف؟`)) {
      return;
    }
    await this.act(() => this.api.voidShipment(s.id), `${s.number} voided.`, 'The dispatch could not be voided.');
  }

  protected async voidReceipt(p: Receipt): Promise<void> {
    if (!confirm(`Void ${p.number} and ${p.shipmentNumber}? Both invoices are voided: the goods leave ${p.receivingBranch} and go back to ${p.supplyingBranch}. · إلغاء الاستلام والفاتورتين؟`)) {
      return;
    }
    await this.act(() => this.api.voidReceipt(p.id), `${p.number} and ${p.shipmentNumber} voided.`, 'The receipt could not be voided.');
  }

  protected printRequisition(r: Requisition): void {
    const target = this.paper();
    if (target) {
      printRequisition(target, r, this.company.name());
    }
  }

  protected printShipment(s: Shipment): void {
    const target = this.paper();
    if (target) {
      printShipment(target, s, this.company.name(), (n) => this.company.money(n));
    }
  }

  protected printReceipt(p: Receipt): void {
    const target = this.paper();
    if (target) {
      printReceipt(target, p, this.company.name(), (n) => this.company.money(n));
    }
  }

  // Quantities and units only: never a price.
  protected async copyWhatsApp(r: Requisition): Promise<void> {
    try {
      await navigator.clipboard.writeText(requisitionWhatsApp(r, this.company.name()));
      this.notify.info(`${r.number} copied: paste it in WhatsApp.`);
    } catch (error) {
      this.notify.error(error, 'It could not be copied.');
    }
  }

  protected async downloadSheet(): Promise<void> {
    this.downloading.set(true);
    try {
      saveBlob(await firstValueFrom(this.api.sheet(this.fromDay(), this.toDay())), `inter-branch-${this.fromDay()}-to-${this.toDay()}.xlsx`);
    } catch (error) {
      this.notify.error(error, 'The workbook could not be made.');
    } finally {
      this.downloading.set(false);
    }
  }

  private paper(): Window | null {
    const target = window.open('', '_blank');
    if (!target) {
      this.notify.error(null, 'The browser stopped the paper opening: allow pop-ups for this site, then print again.');
    }
    return target;
  }

  private async act(run: () => Observable<unknown>, done: string, failed: string): Promise<void> {
    try {
      await firstValueFrom(run());
      this.notify.info(done);
      await this.load();
    } catch (error) {
      this.notify.error(error, failed);
    }
  }

  private async materialList(): Promise<MaterialCost[]> {
    this.materials ??= (await firstValueFrom(this.costing.materials())).filter((m) => !m.misplaced);
    return this.materials;
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.hub.set(await firstValueFrom(this.api.hub(this.fromDay(), this.toDay())));
    } catch (error) {
      this.error.set(errorMessage(error, 'The central kitchen hub could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }
}
