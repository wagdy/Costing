import { DatePipe, formatDate } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApprovalRequest, CostingApi, PurchaseInvoiceSummary, paymentMethodLabels, paymentStatusLabels } from '../../core/costing/costing.api';
import { errorMessage } from '../../core/http/error-message';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { Approvals, pendingLabel } from './approvals';
import { Treasury } from './financials';
import { viewInvoicePaper } from './invoice-paper';
import { showInvoice } from './invoice-view-dialog';
import { FilterOption, FilterSelect } from '../shared/filter-select';
import { SearchField } from '../shared/search-field';
import { SortOption, SortState, smartMatch, sortItems } from '../shared/smart-search';
import { SortControl } from '../shared/sort-control';

type InvoiceSort = 'date' | 'total' | 'supplier';

const invoiceSorts: SortOption<InvoiceSort>[] = [
  { key: 'date', en: 'Date', ar: 'التاريخ', descending: true },
  { key: 'total', en: 'Invoice total', ar: 'إجمالي الفاتورة', descending: true },
  { key: 'supplier', en: 'Supplier', ar: 'المورد' },
];

// What an invoice bought: stock, expenses, or both.
type InvoiceContents = 'stock' | 'expenses' | 'both';

// Every posted supplier invoice, newest first: what came in, from whom, for how much, who
// entered it, and whether the paper is on file. Show (or the row) opens the invoice as it was
// posted, read-only, over the list.
@Component({
  selector: 'app-invoices-page',
  imports: [
    DatePipe,
    FilterSelect,
    FormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatTooltipModule,
    MoneyPipe,
    RouterLink,
    SearchField,
    SortControl,
  ],
  template: `
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    } @else if (error()) {
      <p class="error">{{ error() }}</p>
    } @else {
      <div class="toolbar smart">
        <app-search-field [(value)]="search" placeholder="Supplier or invoice number · المورد أو رقم الفاتورة" />
        <div class="pills">
          <app-filter-select label="Supplier · المورد" icon="local_shipping" [options]="supplierFilters()" [(value)]="supplier" />
          <app-filter-select label="Bought · المشتريات" icon="category" [options]="contentsFilters()" [(value)]="contents" />
          <app-filter-select label="Paid · الدفع" icon="payments" [options]="paymentFilters()" [(value)]="payment" />
          <app-sort-control [options]="sorts" [(sort)]="sort" />
        </div>
      </div>
      <div class="toolbar">
        <mat-checkbox [ngModel]="showVoided()" (ngModelChange)="showVoided.set($event)">
          Show voided <span class="inline-ar">الملغاة</span>
        </mat-checkbox>
        <span class="spacer"></span>
        <span class="muted">{{ shown().length }} {{ shown().length === 1 ? 'invoice' : 'invoices' }} · {{ shownTotal() | money }}</span>
        <a mat-flat-button routerLink="/costing/purchases/new"><mat-icon>add</mat-icon> New invoice</a>
      </div>
      <div class="table-wrap">
        <table class="grid">
          <thead>
            <tr>
              <th>Date<span class="ar">التاريخ</span></th>
              <th>Supplier<span class="ar">المورد</span></th>
              <th>Invoice no.<span class="ar">رقم الفاتورة</span></th>
              <th class="num">Total<span class="ar">الإجمالي</span></th>
              <th>Paid<span class="ar">الدفع</span></th>
              <th>Created by<span class="ar">أنشأها</span></th>
              <th class="num">Paper<span class="ar">الصورة</span></th>
              <th class="num"><span class="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (inv of shown(); track inv.id) {
              <tr class="clickable" [class.voided]="inv.status === 'Voided'" [class.pending-deletion]="!!pendingOf(inv)" (click)="open(inv)">
                <td class="nowrap">{{ date(inv) | date: 'd MMM y' }}</td>
                <td>
                  {{ inv.supplierName ?? '—' }}
                  @if (inv.status === 'Voided') {
                    <div><span class="voided-badge">Voided<span class="ar">ملغاة</span></span>
                      <span class="muted small"> by {{ inv.voidedBy }}, {{ inv.voidedAtUtc | date: 'd MMM' }}</span></div>
                  } @else if (pendingOf(inv); as p) {
                    @if (p.action === 'Delete') {
                      <div><span class="pending-badge">{{ pendingLabel(p).en }}<span class="ar">{{ pendingLabel(p).ar }}</span></span>
                        <span class="muted small"> by {{ p.requestedBy }}</span></div>
                    }
                  }
                </td>
                <td>{{ inv.supplierInvoiceNumber ?? '—' }}</td>
                <td class="num">
                  {{ inv.total | money }}
                  @if (inv.expenseTotal > 0) {
                    <small class="muted expenses">{{ inv.expenseTotal === inv.total ? 'all expenses' : 'incl. ' + (inv.expenseTotal | money) + ' expenses' }}</small>
                  }
                </td>
                <td>
                  <span class="pay" [class]="inv.paymentStatus">{{ paymentText(inv) }}</span>
                </td>
                <td>{{ inv.createdBy || '—' }}</td>
                <td class="num">
                  @if (inv.attachmentFileName; as fileName) {
                    <button mat-icon-button (click)="$event.stopPropagation(); viewPaper(inv.id, fileName)" [attr.aria-label]="'View ' + fileName">
                      <mat-icon>attach_file</mat-icon>
                    </button>
                  } @else {
                    <span class="muted" aria-label="No paper">—</span>
                  }
                </td>
                <td class="num actions" (click)="$event.stopPropagation()">
                  <button mat-stroked-button class="show" (click)="open(inv)">
                    <mat-icon>visibility</mat-icon> Show · عرض
                  </button>
                  @if (inv.status === 'Posted' && inv.paymentStatus === 'Unpaid' && !pendingOf(inv)) {
                    <button mat-stroked-button (click)="pay(inv)"><mat-icon>payments</mat-icon> Pay</button>
                  }
                  @if (inv.status === 'Posted') {
                    @if (pendingOf(inv)) {
                      <mat-icon class="locked" matTooltip="Waiting for a manager's approval" aria-label="Locked: deletion requested">lock_clock</mat-icon>
                    } @else {
                      <button mat-icon-button class="danger" (click)="remove(inv)" matTooltip="Delete (void)" [attr.aria-label]="'Delete ' + title(inv)">
                        <mat-icon>delete</mat-icon>
                      </button>
                    }
                  }
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="8" class="muted">
                  {{ invoices().length ? 'No invoice matches.' : 'No invoices posted yet. They are entered under New invoice.' }}
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .search {
      min-width: 280px;
    }
    .show,
    .nowrap {
      white-space: nowrap;
    }
    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
    }
    .expenses {
      display: block;
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
    tr.voided td {
      color: var(--mat-sys-on-surface-variant);
    }
  `,
})
export class InvoicesPage {
  protected readonly pendingLabel = pendingLabel;
  private readonly api = inject(CostingApi);
  private readonly dialog = inject(MatDialog);

  private readonly approvals = inject(Approvals);
  private readonly treasury = inject(Treasury);

  // Posted and voided; the voided shown only when asked for.
  protected readonly invoices = signal<PurchaseInvoiceSummary[]>([]);
  protected readonly showVoided = signal(false);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly search = signal('');
  protected readonly supplier = signal('');
  protected readonly contents = signal('');
  protected readonly payment = signal('');
  protected readonly sorts = invoiceSorts;
  protected readonly sort = signal<SortState<InvoiceSort>>({ key: 'date', direction: -1 });

  // Those the filters count from: posted, and voided too when asked for.
  private readonly listed = computed(() => this.invoices().filter((i) => this.showVoided() || i.status !== 'Voided'));

  protected readonly supplierFilters = computed<FilterOption[]>(() => {
    const names = new Map<string, number>();
    for (const i of this.listed()) {
      const name = i.supplierName ?? '';
      names.set(name, (names.get(name) ?? 0) + 1);
    }
    return [
      { value: '', label: 'All · الكل', count: this.listed().length },
      ...[...names.entries()]
        .filter(([name]) => name)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, count]) => ({ value: name, label: name, count })),
      ...(names.has('') ? [{ value: '-', label: 'No supplier · بدون مورد', count: names.get('')! }] : []),
    ];
  });

  protected readonly contentsFilters = computed<FilterOption[]>(() => [
    { value: '', label: 'All · الكل', count: this.listed().length },
    { value: 'stock', label: 'Stock only · خامات', count: this.listed().filter((i) => this.contentsOf(i) === 'stock').length },
    { value: 'expenses', label: 'Expenses only · مصروفات', count: this.listed().filter((i) => this.contentsOf(i) === 'expenses').length },
    { value: 'both', label: 'Both · الاثنان', count: this.listed().filter((i) => this.contentsOf(i) === 'both').length },
  ]);

  protected readonly paymentFilters = computed<FilterOption[]>(() => [
    { value: '', label: 'All · الكل', count: this.listed().length },
    ...(['Safe', 'DayRevenue', 'Credit', 'BeforeTreasury'] as const).map((m) => ({
      value: m, label: `${paymentMethodLabels[m].en} · ${paymentMethodLabels[m].ar}`, count: this.listed().filter((i) => i.paymentMethod === m).length,
    })),
    { value: 'unpaid', label: 'Unpaid · غير مدفوعة', count: this.listed().filter((i) => i.paymentStatus === 'Unpaid').length },
  ]);

  protected readonly shown = computed(() => {
    const supplier = this.supplier();
    const payment = this.payment();
    const found = this.listed().filter(
      (i) =>
        smartMatch(this.search(), i.supplierName, i.supplierInvoiceNumber, i.createdBy) &&
        (!supplier || (supplier === '-' ? !i.supplierName : i.supplierName === supplier)) &&
        (!this.contents() || this.contentsOf(i) === this.contents()) &&
        (!payment || (payment === 'unpaid' ? i.paymentStatus === 'Unpaid' : i.paymentMethod === payment)),
    );
    return sortItems(found, this.sort(), (i, key) => {
      switch (key) {
        case 'total':
          return i.total;
        case 'supplier':
          return i.supplierName;
        default:
          return this.date(i);
      }
    }, (i) => i.supplierName ?? '');
  });

  // What was bought: voided invoices are not.
  protected readonly shownTotal = computed(() => this.shown().filter((i) => i.status !== 'Voided').reduce((sum, i) => sum + i.total, 0));

  constructor() {
    void this.load();
  }

  protected contentsOf(invoice: PurchaseInvoiceSummary): InvoiceContents {
    return invoice.inventoryTotal > 0 && invoice.expenseTotal > 0 ? 'both' : invoice.expenseTotal > 0 ? 'expenses' : 'stock';
  }

  // The date on the supplier's paper; when none was written, the day it was posted.
  protected date(invoice: PurchaseInvoiceSummary): string {
    return invoice.invoiceDate ?? invoice.postedAtUtc ?? invoice.createdAtUtc;
  }

  protected open(invoice: PurchaseInvoiceSummary): void {
    showInvoice(this.dialog, invoice.id);
  }

  // How it was paid, or where its payment stands: "From the safe", "Takings of 12 Oct", "On credit".
  protected paymentText(invoice: PurchaseInvoiceSummary): string {
    if (invoice.status === 'Voided') {
      return '—';
    }
    if (invoice.paymentStatus === 'Paid') {
      return invoice.paymentMethod === 'DayRevenue' && invoice.revenueDate
        ? `Takings of ${new Date(invoice.revenueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
        : 'From the safe';
    }
    return paymentStatusLabels[invoice.paymentStatus].en;
  }

  // An unpaid cash invoice, paid now: from the safe or a day's takings, or put on credit.
  protected async pay(invoice: PurchaseInvoiceSummary): Promise<void> {
    if (await this.treasury.payInvoice(invoice.id, { what: this.title(invoice), total: invoice.total, hasSupplier: !!invoice.supplierId })) {
      await this.load();
    }
  }

  protected pendingOf(invoice: PurchaseInvoiceSummary): ApprovalRequest | undefined {
    return this.approvals.pendingFor(invoice.id);
  }

  // What the invoice is called in the delete dialog: its number, else its date and supplier.
  protected title(invoice: PurchaseInvoiceSummary): string {
    if (invoice.supplierInvoiceNumber) {
      return `invoice ${invoice.supplierInvoiceNumber}`;
    }
    const date = formatDate(this.date(invoice), 'd MMM y', 'en-US');
    return invoice.supplierName ? `the ${date} invoice from ${invoice.supplierName}` : `the ${date} invoice`;
  }

  // Voided for a manager (its goods go back out of stock); asked of one for anyone else.
  protected async remove(invoice: PurchaseInvoiceSummary): Promise<void> {
    if ((await this.approvals.delete('PurchaseInvoice', invoice.id, this.title(invoice))) === 'Applied') {
      await this.load();
    }
  }

  protected viewPaper(invoiceId: string, fileName: string): void {
    viewInvoicePaper(this.dialog, invoiceId, fileName);
  }

  private async load(): Promise<void> {
    void this.approvals.refresh();
    try {
      const [posted, voided] = await Promise.all([
        firstValueFrom(this.api.purchaseInvoices('Posted')),
        firstValueFrom(this.api.purchaseInvoices('Voided')),
      ]);
      // Each as the till lists them, newest posted first; the voided after.
      this.invoices.set([...posted, ...voided]);
    } catch (error) {
      this.error.set(errorMessage(error, 'The invoices could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }
}
