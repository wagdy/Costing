import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { Permissions } from '../../core/auth/permissions';
import { MenuSalesApi, SalesReceipt, SalesReport } from '../../core/costing/menu-sales.api';
import { errorMessage } from '../../core/http/error-message';
import { Company } from '../../core/settings/company';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { NotifyService } from '../../core/ui/notify.service';
import { Approvals } from './approvals';
import { DailySalesDialog, DailySalesDialogData, DailySalesImportDialog } from './daily-sales-dialogs';
import { BusinessDay } from './financials';

// How many of a day's items show before "more".
const shownLines = 6;

// Sales (المبيعات): what each day sold, for its stock and its food cost only. A day's sales summary,
// each item and how many, entered by hand or imported from the day's sheet; each item takes its
// stock by its recipe as it is recorded, and the theoretical cost and the variance read it at the
// menu's prices. The day's money is its takings, on Financials. A day entered by mistake is voided,
// by a manager or on their approval, its stock all put back, and entered again.
@Component({
  selector: 'app-sales-page',
  imports: [DatePipe, FormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressBarModule, MatTooltipModule, MoneyPipe],
  template: `
    <div class="toolbar no-print">
      <mat-form-field subscriptSizing="dynamic" class="day">
        <mat-label>From · من</mat-label>
        <input matInput type="date" [ngModel]="from()" (ngModelChange)="pick($event, to())" aria-label="From" />
      </mat-form-field>
      <mat-form-field subscriptSizing="dynamic" class="day">
        <mat-label>To · إلى</mat-label>
        <input matInput type="date" [ngModel]="to()" (ngModelChange)="pick(from(), $event)" aria-label="To" />
      </mat-form-field>
      <span class="spacer"></span>
      @if (canChange) {
        <button mat-stroked-button (click)="importDay()"><mat-icon>upload_file</mat-icon> Import a day <span class="inline-ar">استيراد يوم</span></button>
        <button mat-flat-button (click)="enterDay()"><mat-icon>add</mat-icon> Daily sales summary <span class="inline-ar">ملخص المبيعات اليومية</span></button>
      }
    </div>

    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    } @else if (error(); as message) {
      <p class="error">{{ message }}</p>
    } @else if (report(); as r) {
      <div class="tiles">
        <div class="tile key">
          <span class="label">Days entered · الأيام المسجلة</span>
          <strong>{{ days() }}</strong>
        </div>
        <div class="tile">
          <span class="label">Items sold · الكميات المباعة</span>
          <strong>{{ r.totals.items }}</strong>
        </div>
        <div class="tile">
          <span class="label">At menu prices · بأسعار المنيو</span>
          <strong>{{ r.totals.subtotal | money }}</strong>
          <small class="muted">before tax: for the food cost</small>
        </div>
      </div>

      <div class="table-wrap">
        <table class="grid" aria-label="Sales">
          <thead>
            <tr>
              <th>Day<span class="ar">اليوم</span></th>
              <th>Items sold<span class="ar">الأصناف المباعة</span></th>
              <th class="num">Quantity<span class="ar">الكمية</span></th>
              <th class="num">At menu prices<span class="ar">بأسعار المنيو</span></th>
              <th><span class="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (s of r.receipts; track s.id) {
              <tr [class.voided]="s.voidedAtUtc">
                <td class="nowrap">
                  <strong>{{ s.businessDate | date: 'EEE d MMM' }}</strong>
                  <div class="muted small">
                    {{ s.source === 'DailySummary' ? 'Daily summary' : s.reference ? 'Bill ' + s.reference : 'Bill' }} · {{ s.enteredBy }}
                  </div>
                  @if (s.voidedAtUtc) {
                    <span class="tag bad">Voided<span class="ar">ملغاة</span></span>
                  } @else if (approvals.pendingFor(s.id)) {
                    <span class="pending-badge">Void requested<span class="ar">طلب إلغاء</span></span>
                  }
                </td>
                <td>
                  @for (l of linesOf(s); track l.publicId) {
                    <div class="small line" [class.off]="!l.onBill">
                      {{ l.quantity }} × {{ l.menuItemName }}{{ l.variantName ? ' (' + l.variantName + ')' : '' }}
                    </div>
                  }
                  @if (s.lines.length > shownLines) {
                    <button mat-button class="more" (click)="toggle(s.id)">
                      {{ open().has(s.id) ? 'Fewer' : '+' + (s.lines.length - shownLines) + ' more' }}
                    </button>
                  }
                </td>
                <td class="num">{{ quantityOf(s) }}</td>
                <td class="num">{{ s.subtotal | money }}</td>
                <td class="num actions">
                  @if (canChange && !s.voidedAtUtc && !approvals.pendingFor(s.id)) {
                    <button mat-icon-button (click)="voidSale(s)" [attr.aria-label]="'Void the sales of ' + s.businessDate" matTooltip="Void · إلغاء">
                      <mat-icon>undo</mat-icon>
                    </button>
                  }
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="5" class="empty">
                  No sales in these days. Enter a day's sales summary, or import the day's sheet.
                  <span class="note-ar" lang="ar" dir="rtl">لا توجد مبيعات في هذه الأيام. أدخل ملخص مبيعات اليوم أو استورد ملف اليوم.</span>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <p class="note">
        Sales are for stock and food cost only: each item sold takes its stock by its recipe, and the food cost reads it at the menu's prices.
        The day's money (cash, card, tax and voids) is its takings, on Financials. A day entered by mistake is voided, on a manager's say, its
        stock put back, and entered again.
        <span class="note-ar" lang="ar" dir="rtl">المبيعات لخصم المخزون وحساب التكلفة فقط: كل صنف مباع يخصم المخزون بوصفته. أما الكاش والفيزا والضريبة والفويد فتُسجل في توريد الإيراد بالماليات. اليوم المسجل بالخطأ يُلغى بموافقة المدير ويعود مخزونه ثم يُسجل من جديد.</span>
      </p>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .day {
      width: 170px;
    }
    tr.voided td {
      opacity: 0.6;
    }
    .line.off {
      opacity: 0.7;
    }
    .more {
      --mat-text-button-container-height: 28px;
      padding: 0 4px;
      font-size: 0.85em;
    }
    .small {
      font-size: 0.85em;
    }
    .bad {
      color: var(--mat-sys-error);
    }
  `,
})
export class SalesPage {
  private readonly company = inject(Company);
  private readonly api = inject(MenuSalesApi);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotifyService);
  private readonly businessDay = inject(BusinessDay);
  protected readonly approvals = inject(Approvals);
  protected readonly canChange = inject(AuthService).can(Permissions.InventoryManage);
  protected readonly shownLines = shownLines;

  protected readonly from = signal('');
  protected readonly to = signal('');
  protected readonly report = signal<SalesReport | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  // The days whose every item is shown.
  protected readonly open = signal(new Set<string>());

  // Days with sales standing, voided ones left out.
  protected readonly days = computed(() => new Set((this.report()?.receipts ?? []).filter((r) => !r.voidedAtUtc).map((r) => r.businessDate)).size);

  constructor() {
    void (async () => {
      const today = await this.businessDay.today();
      const weekAgo = new Date(`${today}T12:00:00`);
      weekAgo.setDate(weekAgo.getDate() - 6);
      this.to.set(today);
      this.from.set(weekAgo.toISOString().slice(0, 10));
      await this.load();
    })();
    void this.approvals.refresh();
  }

  protected pick(from: string, to: string): void {
    if (/^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to) {
      this.from.set(from);
      this.to.set(to);
      void this.load();
    }
  }

  protected linesOf(sale: SalesReceipt) {
    return this.open().has(sale.id) ? sale.lines : sale.lines.slice(0, shownLines);
  }

  protected quantityOf(sale: SalesReceipt): number {
    return sale.lines.filter((l) => l.onBill).reduce((sum, l) => sum + l.quantity, 0);
  }

  protected toggle(id: string): void {
    this.open.update((open) => {
      const next = new Set(open);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  }

  protected async enterDay(): Promise<void> {
    const menu = await firstValueFrom(this.api.menu());
    if (!menu.items.some((i) => !i.isDeleted)) {
      this.notify.error(null, 'The menu has no items yet: add them on Menu, or put recipes on it from Recipes. · أضف أصنافًا للمنيو أولًا.');
      return;
    }
    const sale = await firstValueFrom(
      this.dialog
        .open<DailySalesDialog, DailySalesDialogData, SalesReceipt>(DailySalesDialog, {
          data: { menu, today: await this.businessDay.today() },
          width: '760px',
          maxWidth: '96vw',
          // A day's items take a while to type: only Cancel or Save closes it.
          disableClose: true,
        })
        .afterClosed(),
    );
    if (sale) {
      this.notify.info(
        `Sales of ${sale.businessDate} saved: ${this.quantityOf(sale)} sold, ${this.company.money(sale.subtotal)} at menu prices, their stock taken.`,
      );
      await this.load();
    }
  }

  protected async importDay(): Promise<void> {
    const imported = await firstValueFrom(
      this.dialog
        .open<DailySalesImportDialog, { today: string }, boolean>(DailySalesImportDialog, {
          data: { today: await this.businessDay.today() },
          width: '640px',
          maxWidth: '96vw',
        })
        .afterClosed(),
    );
    if (imported) {
      await this.load();
    }
  }

  protected async voidSale(sale: SalesReceipt): Promise<void> {
    const what = sale.source === 'DailySummary' || !sale.reference ? `the sales of ${sale.businessDate}` : `sale ${sale.reference}`;
    if ((await this.approvals.delete('Sale', sale.id, what)) === 'Applied') {
      await this.load();
    }
  }

  private async load(): Promise<void> {
    try {
      this.report.set(await firstValueFrom(this.api.sales(this.from(), this.to())));
      this.error.set(null);
    } catch (error) {
      this.error.set(errorMessage(error, 'The sales could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }
}
