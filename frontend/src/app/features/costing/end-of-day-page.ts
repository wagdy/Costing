import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { CostingApi } from '../../core/costing/costing.api';
import { CostingAccess } from '../../core/costing/costing-tabs';
import {
  EndOfDay,
  EndOfDayApi,
  EndOfDayInvoice,
  EndOfDayInvoiceKind,
  EndOfDayPhoto,
  EndOfDaySales,
  endOfDayStatusLabels,
  photoProblem,
  shrinkPhoto,
} from '../../core/costing/end-of-day.api';
import { errorMessage } from '../../core/http/error-message';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { NotifyService } from '../../core/ui/notify.service';
import { Company } from '../../core/settings/company';
import { ItemPicker, PickItem } from '../shared/item-picker';
import { Approvals } from './approvals';
import { PhotoSource, PhotoThumb, viewPhoto } from './end-of-day-photo';
import { BusinessDay, Treasury } from './financials';

const round = (n: number) => Math.round(n * 100) / 100;

const sectionLabels: Record<EndOfDayInvoiceKind, { en: string; ar: string; count: { en: string; ar: string }; total: { en: string; ar: string } }> = {
  Cash: {
    en: 'Cash purchase & expense invoices',
    ar: 'تسجيل فواتير مشتريات ومصروفات نقدية',
    count: { en: 'Cash invoices count', ar: 'عدد الفواتير النقدية' },
    total: { en: 'Total cash invoices amount', ar: 'إجمالي مبلغ الفواتير النقدية' },
  },
  Credit: {
    en: 'Credit / on-account invoices',
    ar: 'تسجيل فواتير آجل',
    count: { en: 'Credit invoices count', ar: 'عدد الفواتير الآجل' },
    total: { en: 'Total credit amount', ar: 'إجمالي مبلغ الآجل' },
  },
};

// One invoice as it is handed in, or changed: its photo (the camera, or a file), its supplier from
// the list, the total written on it, and a short note. A new one is added with an id made here once,
// so it is never added twice; then the form is empty for the next.
@Component({
  selector: 'app-eod-invoice-form',
  imports: [FormsModule, ItemPicker, MatButtonModule, MatButtonToggleModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressBarModule, PhotoThumb],
  template: `
    <div class="form" [class.editing]="!!invoice()">
      <div class="photo">
        <input #camera type="file" accept="image/*" capture="environment" hidden (change)="pick(camera)" [attr.aria-label]="label() + ', take a photo'" />
        <input #upload type="file" accept="image/jpeg,image/png,image/webp,application/pdf" hidden (change)="pick(upload)"
          [attr.aria-label]="label() + ', upload a file'" />
        @if (source(); as s) {
          <app-photo-thumb [source]="s" [fileName]="fileName()" [contentType]="file()?.type ?? invoice()?.photo?.contentType ?? null" />
          <div class="photo-actions">
            <button mat-button type="button" (click)="camera.click()" [disabled]="saving()"><mat-icon>photo_camera</mat-icon> Retake · إعادة</button>
            <button mat-button type="button" (click)="upload.click()" [disabled]="saving()"><mat-icon>upload_file</mat-icon> Replace · استبدال</button>
          </div>
        } @else {
          <button mat-stroked-button type="button" class="big" (click)="camera.click()" [disabled]="saving()">
            <mat-icon>photo_camera</mat-icon> Take photo <span class="inline-ar">تصوير الفاتورة</span>
          </button>
          <button mat-stroked-button type="button" class="big" (click)="upload.click()" [disabled]="saving()">
            <mat-icon>upload_file</mat-icon> Upload file <span class="inline-ar">رفع ملف</span>
          </button>
        }
      </div>
      <div class="fields">
        @if (invoice()) {
          <mat-button-toggle-group [value]="kind()" (change)="kind.set($event.value)" [attr.aria-label]="label() + ', paid'" hideSingleSelectionIndicator>
            <mat-button-toggle value="Cash">Cash · نقدي</mat-button-toggle>
            <mat-button-toggle value="Credit">On credit · آجل</mat-button-toggle>
          </mat-button-toggle-group>
        }
        <app-item-picker [items]="suppliers()" [(value)]="supplierId" [label]="label() + ', supplier'" placeholder="Supplier · المورد" [disabled]="saving()" />
        <mat-form-field subscriptSizing="dynamic" floatLabel="always">
          <mat-label>Reported invoice total · إجمالي قيمة الفاتورة</mat-label>
          <input matInput type="number" min="0" step="any" inputmode="decimal" [(ngModel)]="total" (ngModelChange)="touch()" placeholder="0.00"
            data-western-digits [attr.aria-label]="label() + ', total'" />
          <span matTextSuffix>&nbsp;{{ company.currency() }}</span>
        </mat-form-field>
        <mat-form-field subscriptSizing="dynamic">
          <mat-label>Note (optional) · ملاحظة</mat-label>
          <input matInput [(ngModel)]="note" (ngModelChange)="touch()" maxlength="200" [attr.aria-label]="label() + ', note'" />
        </mat-form-field>
      </div>
      <div class="actions">
        @if (invoice()) {
          <button mat-button type="button" (click)="cancelled.emit()" [disabled]="saving()">Cancel · إلغاء</button>
          <button mat-flat-button type="button" (click)="save()" [disabled]="saving()"><mat-icon>check</mat-icon> Save · حفظ</button>
        } @else {
          @if (dirty()) {
            <button mat-button type="button" (click)="clear()" [disabled]="saving()">Clear · مسح</button>
          }
          <button mat-flat-button type="button" (click)="save()" [disabled]="saving()"><mat-icon>add</mat-icon> Add invoice · إضافة الفاتورة</button>
        }
      </div>
      @if (saving()) {
        <mat-progress-bar mode="indeterminate" />
      }
      @if (problem(); as p) {
        <p class="error" role="alert">{{ p }}</p>
      }
    </div>
  `,
  styleUrl: './costing.scss',
  styles: `
    .form {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 10px 16px;
      align-items: start;
      padding: 12px;
      border: 1px dashed var(--app-line-strong, #cbd5e1);
      border-radius: 14px;
      background: var(--mat-sys-surface-container-lowest);
    }
    .form.editing {
      border-style: solid;
      border-color: var(--mat-sys-primary);
    }
    .photo {
      display: grid;
      gap: 6px;
      justify-items: start;
      --thumb-size: 96px;
    }
    .photo-actions {
      display: flex;
      flex-wrap: wrap;
    }
    .big {
      width: 100%;
      min-height: 44px;
      justify-content: flex-start;
    }
    .fields {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 8px 12px;
      align-items: center;
    }
    .actions {
      grid-column: 1 / -1;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    mat-progress-bar,
    .error {
      grid-column: 1 / -1;
    }
    @media (max-width: 599.98px) {
      .form {
        grid-template-columns: minmax(0, 1fr);
      }
      .photo {
        grid-template-columns: auto minmax(0, 1fr);
        align-items: center;
      }
      .photo .big {
        grid-column: 1 / -1;
      }
      .actions button {
        flex: 1;
      }
    }
  `,
})
export class EodInvoiceForm {
  private readonly api = inject(EndOfDayApi);
  protected readonly company = inject(Company);

  readonly date = input.required<string>();
  readonly section = input.required<EndOfDayInvoiceKind>();
  readonly suppliers = input.required<readonly PickItem[]>();
  // The invoice being changed; none for a new one.
  readonly invoice = input<EndOfDayInvoice | null>(null);
  readonly saved = output<EndOfDay>();
  readonly cancelled = output<void>();
  // Something typed or chosen on a new one, not added yet.
  readonly pendingChange = output<boolean>();

  protected readonly kind = signal<EndOfDayInvoiceKind>('Cash');
  protected readonly file = signal<File | null>(null);
  protected readonly supplierId = signal<string | null>(null);
  protected total: number | null = null;
  protected note = '';
  protected readonly saving = signal(false);
  protected readonly problem = signal<string | null>(null);
  private readonly version = signal(0);
  private id = crypto.randomUUID();

  protected readonly label = computed(() => (this.invoice() ? 'Invoice' : `New ${this.section() === 'Cash' ? 'cash' : 'credit'} invoice`));

  // The photo chosen here, else the one handed in.
  protected readonly source = computed<PhotoSource | null>(() => {
    const [file, invoice, date] = [this.file(), this.invoice(), this.date()];
    return file ?? (invoice ? () => this.api.photo(date, invoice.id) : null);
  });
  protected readonly fileName = computed(() => this.file()?.name ?? this.invoice()?.photo.fileName ?? '');

  protected readonly dirty = computed(() => {
    this.version();
    return !!this.file() || !!this.supplierId() || !!this.total || !!this.note.trim();
  });

  // Filled from the invoice being changed, once: the day saved again elsewhere leaves what is typed.
  private readonly invoiceId = computed(() => this.invoice()?.id ?? null);

  constructor() {
    effect(() => {
      const [, section] = [this.invoiceId(), this.section()];
      untracked(() => {
        const invoice = this.invoice();
        this.kind.set(invoice?.kind ?? section);
        this.supplierId.set(invoice?.supplierId ?? null);
        this.total = invoice?.reportedTotal ?? null;
        this.note = invoice?.note ?? '';
        this.file.set(null);
        this.touch();
      });
    });
    effect(() => {
      const dirty = this.dirty();
      if (!this.invoice()) {
        untracked(() => this.pendingChange.emit(dirty));
      }
    });
  }

  protected touch(): void {
    this.version.update((v) => v + 1);
    this.problem.set(null);
  }

  // The camera's photo or the file chosen: lighter to send when it is a big photo.
  protected async pick(input: HTMLInputElement): Promise<void> {
    const chosen = input.files?.[0];
    input.value = '';
    if (!chosen) {
      return;
    }
    const file = await shrinkPhoto(chosen);
    const problem = photoProblem(file);
    if (problem) {
      this.problem.set(problem);
      return;
    }
    this.file.set(file);
    this.touch();
  }

  protected clear(): void {
    this.file.set(null);
    this.supplierId.set(null);
    this.total = null;
    this.note = '';
    this.touch();
  }

  protected async save(): Promise<void> {
    const invoice = this.invoice();
    const total = Number(this.total);
    const problem = !this.file() && !invoice
      ? 'Photograph the invoice or attach its file. · صوّر الفاتورة أو أرفق ملفها.'
      : !this.supplierId()
        ? 'Choose the supplier from the list. · اختر المورد من القائمة.'
        : !(total > 0)
          ? "Enter the invoice's total. · أدخل إجمالي الفاتورة."
          : null;
    if (problem) {
      this.problem.set(problem);
      return;
    }
    this.saving.set(true);
    this.problem.set(null);
    const entry = { kind: this.kind(), supplierId: this.supplierId()!, reportedTotal: round(total), note: this.note.trim() || null };
    try {
      let day: EndOfDay;
      if (!invoice) {
        day = await firstValueFrom(this.api.addInvoice(this.date(), this.id, entry, this.file()!));
        this.id = crypto.randomUUID();
        this.clear();
      } else {
        day = await firstValueFrom(this.api.changeInvoice(this.date(), invoice.id, entry));
        const file = this.file();
        if (file) {
          day = await firstValueFrom(this.api.replaceInvoicePhoto(this.date(), invoice.id, file));
        }
      }
      this.saved.emit(day);
    } catch (error) {
      this.problem.set(errorMessage(error, 'The invoice could not be saved. · تعذر حفظ الفاتورة.'));
    } finally {
      this.saving.set(false);
    }
  }
}

export interface EndOfDaySummaryData {
  day: EndOfDay;
}

// The end of day summary report (تقرير ملخص تقفيل اليوم), before it is handed in: the cash purchases
// and those on credit, each counted and added up, the day's sales, and what should be left of its
// cash and reach the safe once the cash invoices were paid out of it. True once confirmed.
@Component({
  selector: 'app-end-of-day-summary',
  imports: [DatePipe, MatButtonModule, MatDialogModule, MatIconModule, MoneyPipe],
  template: `
    <h2 mat-dialog-title>End of day summary report <span class="inline-ar">تقرير ملخص تقفيل اليوم</span></h2>
    <mat-dialog-content>
      @let d = data.day;
      <p class="muted">{{ d.date | date: 'EEEE d MMMM y' }}</p>
      <div class="blocks">
        <div class="block">
          <span class="label">Cash purchases <span class="inline-ar">المشتريات النقدية</span></span>
          <strong>{{ d.cashInvoicesTotal | money }}</strong>
          <small>{{ d.cashInvoices }} {{ d.cashInvoices === 1 ? 'invoice' : 'invoices' }} · فاتورة</small>
        </div>
        <div class="block">
          <span class="label">Credit purchases <span class="inline-ar">مشتريات آجل</span></span>
          <strong>{{ d.creditInvoicesTotal | money }}</strong>
          <small>{{ d.creditInvoices }} {{ d.creditInvoices === 1 ? 'invoice' : 'invoices' }} · فاتورة</small>
        </div>
        <div class="block key">
          <span class="label">Sales revenue <span class="inline-ar">إيراد المبيعات</span></span>
          <strong>{{ d.totalRevenue | money }}</strong>
          <small>cash + Visa + tax</small>
        </div>
      </div>
      <dl class="breakdown">
        <div><dt>Cash <span class="inline-ar">الكاش</span></dt><dd>{{ d.cashAmount ?? 0 | money }}</dd></div>
        <div><dt>Visa / card <span class="inline-ar">الفيزا</span></dt><dd>{{ d.cardAmount ?? 0 | money }}</dd></div>
        <div><dt>Tax collected <span class="inline-ar">الضريبة المحصلة</span></dt><dd>{{ d.taxAmount ?? 0 | money }}</dd></div>
        <div class="line"><dt>Total revenue <span class="inline-ar">إجمالي الإيراد</span></dt><dd>{{ d.totalRevenue | money }}</dd></div>
        <div><dt>Voids &amp; refunds <span class="inline-ar">الفويد والمرتجعات</span></dt><dd>{{ d.voidsAmount ?? 0 | money }}</dd></div>
        <div><dt>Cash invoices paid out <span class="inline-ar">المدفوع للفواتير النقدية</span></dt><dd>({{ d.cashInvoicesTotal | money }})</dd></div>
        <div class="line"><dt>Expected net cash after cash invoices <span class="inline-ar">صافي الكاش بعد الفواتير النقدية</span></dt>
          <dd [class.negative]="d.cashAfterInvoices < 0">{{ d.cashAfterInvoices | money }}</dd></div>
        <div class="total"><dt>Expected into the safe <span class="inline-ar">المتوقع توريده للخزنة</span>
          <small class="muted">total revenue less the cash invoices</small></dt><dd>{{ d.expectedIntoSafe | money }}</dd></div>
      </dl>
      @if (d.cashAfterInvoices < 0) {
        <p class="warn small">The cash invoices are {{ -d.cashAfterInvoices | money }} more than the day's cash. · الفواتير النقدية أكبر من الكاش.</p>
      }
      @if (!d.salesPhoto) {
        <p class="muted small">No photo of the Z report: it is optional. · لا توجد صورة لتقرير Z.</p>
      }
      <p class="note">Once submitted it is locked; a manager reopens it to change it. <span class="note-ar" lang="ar" dir="rtl">بعد الإرسال يُقفل اليوم، ويعيد المدير فتحه للتعديل.</span></p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button [mat-dialog-close]="false">Back · رجوع</button>
      <button mat-flat-button [mat-dialog-close]="true"><mat-icon>task_alt</mat-icon> Confirm &amp; submit · تأكيد وإرسال التقفيل</button>
    </mat-dialog-actions>
  `,
  styleUrl: './costing.scss',
  styles: `
    .blocks {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      margin: 4px 0 12px;
    }
    .block {
      display: grid;
      gap: 2px;
      padding: 12px 14px;
      border-radius: 14px;
      border: 1px solid var(--app-line);
      background: var(--mat-sys-surface-container-lowest);

      .label {
        font: var(--mat-sys-label-medium);
        color: var(--mat-sys-on-surface-variant);
      }
      strong {
        font: var(--mat-sys-title-large);
        font-variant-numeric: tabular-nums;
      }
      &.key {
        background: var(--mat-sys-secondary-container);
        border-color: transparent;
      }
    }
    .breakdown {
      display: grid;
      gap: 4px;
      margin: 0 0 12px;
      padding: 10px 12px;
      border-radius: 10px;
      background: var(--mat-sys-surface-container);

      div {
        display: flex;
        justify-content: space-between;
        gap: 12px;
      }
      dt,
      dd {
        margin: 0;
      }
      dd {
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .line {
        padding-top: 4px;
        border-top: 1px solid var(--mat-sys-outline-variant);
        font-weight: 600;
      }
      .total {
        padding: 6px 0;
        border-top: 2px solid var(--mat-sys-outline-variant);
        font-weight: 700;

        small {
          display: block;
          font-weight: 400;
        }
      }
      .negative {
        color: var(--mat-sys-error);
      }
    }
    .warn {
      color: var(--app-warn);
    }
    .small {
      font-size: 0.85em;
    }
    @media (max-width: 599.98px) {
      .blocks {
        grid-template-columns: minmax(0, 1fr);
      }
    }
  `,
})
export class EndOfDaySummaryDialog {
  protected readonly data = inject<EndOfDaySummaryData>(MAT_DIALOG_DATA);
}

// The end of the day (تقفيل اليوم), as a branch closes it: the date, then the day's cash invoices
// and those on credit, each photographed with its supplier and total, and the day's sales report.
// Reviewed and submitted, it is locked, and the daily batch of that date opens with an invoice for
// each, its photo with it; the takings of the day come in from its sales. Everything is kept as it
// is typed: an invoice once added, the sales a moment after.
@Component({
  selector: 'app-end-of-day-page',
  imports: [DatePipe, EodInvoiceForm, FormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressBarModule, MoneyPipe, PhotoThumb, RouterLink],
  template: `
    <header class="head">
      <div>
        <h2>End of the day <span class="inline-ar">تقفيل اليوم</span></h2>
        <p class="note">
          Photograph each of the day's invoices with its supplier and total, cash and on credit, and enter the day's sales report. Reviewed and
          submitted, the daily batch of that date opens with an invoice for each, its photo with it.
          <span class="note-ar" lang="ar" dir="rtl">صوّر فواتير اليوم مع المورد والإجمالي، وسجّل ريبورت المبيعات، ثم راجع وأرسل التقفيل.</span>
        </p>
      </div>
    </header>

    <section class="card step date-step" aria-label="Date">
      <span class="step-no">1</span>
      <mat-form-field subscriptSizing="dynamic">
        <mat-label>Date · تاريخ اليوم</mat-label>
        <input matInput type="date" [ngModel]="date()" (ngModelChange)="choose($event)" [max]="today()" aria-label="Date" />
      </mat-form-field>
      @if (day(); as d) {
        <span class="tag" [class.ok]="d.status === 'Submitted'" [class.warn]="d.status === 'Draft'">
          {{ statusLabels[d.status].en }}<span class="ar">{{ statusLabels[d.status].ar }}</span>
        </span>
        @if (d.status === 'Submitted') {
          <span class="muted small">by {{ d.submittedBy }}, {{ d.submittedAtUtc | date: 'd MMM, HH:mm' }}</span>
        } @else if (d.reopenedBy) {
          <span class="muted small">reopened by {{ d.reopenedBy }}</span>
        }
      } @else if (!loading()) {
        <span class="tag">Not started<span class="ar">لم يبدأ</span></span>
      }
      <span class="spacer"></span>
      @if (day()?.status === 'Submitted') {
        @if (canBatch()) {
          <a mat-stroked-button [routerLink]="['/costing/purchases/batch']" [queryParams]="{ date: date() }">
            <mat-icon>inventory</mat-icon> Daily batch <span class="inline-ar">يومية المشتريات</span>
          </a>
        }
        @if (canTakings()) {
          @if (day()!.takingsEntered === null) {
            <button mat-stroked-button (click)="takings()"><mat-icon>savings</mat-icon> Takings in <span class="inline-ar">توريد الإيراد</span></button>
          } @else {
            <span class="tag ok">Takings in {{ day()!.takingsEntered! | money }}<span class="ar">تم التوريد</span></span>
          }
        }
        @if (canReopen()) {
          <button mat-button (click)="reopen()" [disabled]="busy()"><mat-icon>lock_open</mat-icon> Reopen · إعادة فتح</button>
        }
      }
    </section>

    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    } @else if (error()) {
      <p class="error">{{ error() }}</p>
    } @else {
      @for (kind of kinds; track kind) {
        <section class="card step" [attr.aria-label]="sections[kind].en">
          <h3><span class="step-no">{{ kind === 'Cash' ? 2 : 3 }}</span> {{ sections[kind].en }} <span class="inline-ar">{{ sections[kind].ar }}</span></h3>
          <div class="invoices">
            @for (inv of invoicesOf(kind); track inv.id; let i = $index) {
              @if (editing() === inv.id && !locked()) {
                <app-eod-invoice-form [date]="date()" [section]="kind" [suppliers]="suppliers()" [invoice]="inv" (saved)="saved($event)"
                  (cancelled)="editing.set(null)" />
              } @else {
                <article class="invoice" [attr.aria-label]="sections[kind].en + ' ' + (i + 1)">
                  <app-photo-thumb [source]="photoOf(inv.id, inv.photo)" [fileName]="inv.photo.fileName" [contentType]="inv.photo.contentType" />
                  <div class="what">
                    <strong dir="auto">{{ inv.supplier }}</strong>
                    <span class="amount">{{ inv.reportedTotal | money }}</span>
                    @if (inv.note) {
                      <span class="muted small" dir="auto">{{ inv.note }}</span>
                    }
                    @if (inv.purchaseInvoiceId) {
                      <a class="tag ok" [routerLink]="canBatch() ? ['/costing/purchases/invoices', inv.purchaseInvoiceId] : null">Posted<span class="ar">تم الترحيل</span></a>
                    }
                  </div>
                  @if (!locked() && !inv.purchaseInvoiceId) {
                    <div class="row-actions">
                      <button mat-icon-button (click)="editing.set(inv.id)" [disabled]="busy()" [attr.aria-label]="'Change ' + inv.supplier + ' ' + (i + 1)" title="Change · تعديل">
                        <mat-icon>edit</mat-icon>
                      </button>
                      <button mat-icon-button (click)="remove(inv)" [disabled]="busy()" [attr.aria-label]="'Take off ' + inv.supplier + ' ' + (i + 1)" title="Take off · حذف">
                        <mat-icon>delete</mat-icon>
                      </button>
                    </div>
                  }
                </article>
              }
            } @empty {
              @if (locked()) {
                <p class="muted">None handed in. · لا توجد فواتير.</p>
              }
            }
          </div>
          @if (!locked()) {
            <app-eod-invoice-form [date]="date()" [section]="kind" [suppliers]="suppliers()" (saved)="saved($event)" (pendingChange)="pendingIn(kind, $event)" />
          }
          <footer class="counter" aria-live="polite">
            <span>{{ sections[kind].count.en }} <span class="inline-ar">{{ sections[kind].count.ar }}</span>: <strong>{{ countOf(kind) }}</strong></span>
            <span>{{ sections[kind].total.en }} <span class="inline-ar">{{ sections[kind].total.ar }}</span>: <strong>{{ totalOf(kind) | money }}</strong></span>
          </footer>
        </section>
      }

      <section class="card step" aria-label="Daily sales report">
        <h3><span class="step-no">4</span> Daily sales report / revenue <span class="inline-ar">تسجيل ريبورت المبيعات والإيراد</span></h3>
        <div class="sales">
          <mat-form-field subscriptSizing="dynamic" floatLabel="always">
            <mat-label>Cash · إيراد الكاش</mat-label>
            <input matInput type="number" min="0" step="any" inputmode="decimal" [ngModel]="sales().cashAmount" (ngModelChange)="setSale('cashAmount', $event)"
              [disabled]="locked()" placeholder="0" data-western-digits aria-label="Cash" />
            <span matTextSuffix>&nbsp;{{ company.currency() }}</span>
          </mat-form-field>
          <mat-form-field subscriptSizing="dynamic" floatLabel="always">
            <mat-label>Visa / card · إيراد الفيزا</mat-label>
            <input matInput type="number" min="0" step="any" inputmode="decimal" [ngModel]="sales().cardAmount" (ngModelChange)="setSale('cardAmount', $event)"
              [disabled]="locked()" placeholder="0" data-western-digits aria-label="Visa" />
            <span matTextSuffix>&nbsp;{{ company.currency() }}</span>
          </mat-form-field>
          <mat-form-field subscriptSizing="dynamic" floatLabel="always">
            <mat-label>Tax collected · الضريبة المحصلة</mat-label>
            <input matInput type="number" min="0" step="any" inputmode="decimal" [ngModel]="sales().taxAmount" (ngModelChange)="setSale('taxAmount', $event)"
              [disabled]="locked()" placeholder="0" data-western-digits aria-label="Tax" />
            <span matTextSuffix>&nbsp;{{ company.currency() }}</span>
          </mat-form-field>
          <mat-form-field subscriptSizing="dynamic" floatLabel="always">
            <mat-label>Voids &amp; refunds · الفويد والمرتجعات</mat-label>
            <input matInput type="number" min="0" step="any" inputmode="decimal" [ngModel]="sales().voidsAmount" (ngModelChange)="setSale('voidsAmount', $event)"
              [disabled]="locked()" placeholder="0" data-western-digits aria-label="Voids" />
            <span matTextSuffix>&nbsp;{{ company.currency() }}</span>
          </mat-form-field>
          <div class="revenue">
            <span class="label">Total revenue · إجمالي الإيراد</span>
            <strong>{{ totalRevenue() | money }}</strong>
            <small class="muted">cash + Visa + tax</small>
          </div>
          <mat-form-field subscriptSizing="dynamic" class="wide">
            <mat-label>Notes (void reasons) · ملاحظات</mat-label>
            <input matInput [ngModel]="sales().notes" (ngModelChange)="setSale('notes', $event)" [disabled]="locked()" maxlength="500" aria-label="Sales notes" />
          </mat-form-field>
        </div>
        <div class="z-photo">
          <input #zCamera type="file" accept="image/*" capture="environment" hidden (change)="zPhoto(zCamera)" aria-label="Z report, take a photo" />
          <input #zUpload type="file" accept="image/jpeg,image/png,image/webp,application/pdf" hidden (change)="zPhoto(zUpload)" aria-label="Z report, upload a file" />
          <span class="label">Z-report photo (optional) · صورة تقرير Z</span>
          @if (day()?.salesPhoto; as p) {
            <app-photo-thumb [source]="photoOf(day()!.id, p)" [fileName]="p.fileName" [contentType]="p.contentType" />
            @if (!locked()) {
              <button mat-button (click)="dropZPhoto()" [disabled]="busy()"><mat-icon>close</mat-icon> Take off · حذف</button>
            }
          } @else if (!locked()) {
            <button mat-stroked-button (click)="zCamera.click()" [disabled]="busy()"><mat-icon>photo_camera</mat-icon> Take photo · تصوير</button>
            <button mat-stroked-button (click)="zUpload.click()" [disabled]="busy()"><mat-icon>upload_file</mat-icon> Upload · رفع</button>
          } @else {
            <span class="muted">—</span>
          }
          <span class="spacer"></span>
          @if (!locked()) {
            <span class="muted small" aria-live="polite">{{ salesState() }}</span>
          }
        </div>
        @if (salesProblem(); as p) {
          <p class="error" role="alert">{{ p }}</p>
        }
      </section>

      @if (!locked()) {
        <div class="submit-bar">
          <span class="muted small">
            {{ countOf('Cash') }} cash · {{ countOf('Credit') }} on credit · revenue {{ totalRevenue() | money }}
          </span>
          <span class="spacer"></span>
          <button mat-flat-button (click)="review()" [disabled]="busy()">
            <mat-icon>fact_check</mat-icon> Review &amp; confirm <span class="inline-ar">مراجعة وتأكيد</span>
          </button>
        </div>
        @if (reviewProblem(); as p) {
          <p class="error" role="alert">{{ p }}</p>
        }
      }

      @if (history().length) {
        <section class="card history" aria-label="Recent days">
          <h3>Recent days <span class="inline-ar">الأيام السابقة</span></h3>
          <div class="table-wrap">
            <table class="grid">
              <thead>
                <tr>
                  <th>Date<span class="ar">التاريخ</span></th>
                  <th>Status<span class="ar">الحالة</span></th>
                  <th class="num">Cash invoices<span class="ar">نقدي</span></th>
                  <th class="num">Credit<span class="ar">آجل</span></th>
                  <th class="num">Revenue<span class="ar">الإيراد</span></th>
                  <th class="num">Posted<span class="ar">المرحّل</span></th>
                </tr>
              </thead>
              <tbody>
                @for (h of history(); track h.id) {
                  <tr [class.current]="h.date === date()" (click)="choose(h.date)" class="pick">
                    <td>{{ h.date | date: 'EEE d MMM' }}</td>
                    <td><span class="tag" [class.ok]="h.status === 'Submitted'" [class.warn]="h.status === 'Draft'">{{ statusLabels[h.status].en }}</span></td>
                    <td class="num">{{ h.cashInvoices }} · {{ h.cashInvoicesTotal | money }}</td>
                    <td class="num">{{ h.creditInvoices }} · {{ h.creditInvoicesTotal | money }}</td>
                    <td class="num">{{ h.totalRevenue | money }}</td>
                    <td class="num">{{ h.posted }} / {{ h.invoices.length }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      }
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .head h2 {
      margin: 0 0 4px;
      font: var(--mat-sys-headline-small);
    }
    .card {
      margin: 0 0 14px;
      padding: 14px 16px;
      border: 1px solid var(--app-line);
      border-radius: 16px;
      background: var(--mat-sys-surface-container-lowest);
      box-shadow: var(--app-card-shadow);

      h3 {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        margin: 0 0 12px;
        font: var(--mat-sys-title-medium);
      }
    }
    .date-step {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 12px;

      .spacer {
        flex: 1;
      }
    }
    .step-no {
      display: inline-grid;
      place-items: center;
      flex: none;
      width: 26px;
      height: 26px;
      border-radius: 50%;
      background: var(--mat-sys-primary);
      color: var(--mat-sys-on-primary);
      font: var(--mat-sys-label-large);
    }
    .invoices {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 10px;
      margin-bottom: 10px;

      &:empty {
        display: none;
      }
      app-eod-invoice-form {
        grid-column: 1 / -1;
      }
    }
    .invoice {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 10px;
      border: 1px solid var(--app-line);
      border-radius: 14px;
      background: var(--mat-sys-surface);
    }
    .what {
      display: grid;
      gap: 2px;
      flex: 1;
      min-width: 0;

      strong {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .amount {
        font: var(--mat-sys-title-medium);
        font-variant-numeric: tabular-nums;
      }
      .tag {
        justify-self: start;
        text-decoration: none;
      }
    }
    .row-actions {
      display: flex;
      flex-direction: column;
    }
    .counter {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 24px;
      margin-top: 12px;
      padding: 10px 12px;
      border-radius: 10px;
      background: var(--mat-sys-surface-container);

      strong {
        font-variant-numeric: tabular-nums;
      }
    }
    .sales {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 10px 12px;
      align-items: center;

      .wide {
        grid-column: 1 / -1;
      }
    }
    .revenue {
      display: grid;
      padding: 8px 12px;
      border-radius: 12px;
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);

      .label {
        font: var(--mat-sys-label-medium);
      }
      strong {
        font: var(--mat-sys-title-large);
        font-variant-numeric: tabular-nums;
      }
    }
    .z-photo {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-top: 12px;
      --thumb-size: 56px;

      .label {
        font: var(--mat-sys-label-large);
      }
      .spacer {
        flex: 1;
      }
    }
    .submit-bar {
      position: sticky;
      bottom: 0;
      z-index: 2;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 12px;
      margin: 0 0 14px;
      padding: 10px 14px;
      border: 1px solid var(--app-line);
      border-radius: 16px;
      background: color-mix(in srgb, var(--mat-sys-surface-container-lowest) 92%, transparent);
      backdrop-filter: blur(6px);
      box-shadow: var(--app-card-shadow);

      .spacer {
        flex: 1;
      }
    }
    .history tr.pick {
      cursor: pointer;
    }
    .history tr.current td {
      background: var(--mat-sys-secondary-container);
    }
    .small {
      font-size: 0.85em;
    }
    @media (max-width: 599.98px) {
      .card {
        padding: 12px;
      }
      .invoices {
        grid-template-columns: minmax(0, 1fr);
      }
      .submit-bar button {
        width: 100%;
      }
    }
  `,
})
export class EndOfDayPage {
  private readonly api = inject(EndOfDayApi);
  protected readonly company = inject(Company);
  private readonly costing = inject(CostingApi);
  private readonly notify = inject(NotifyService);
  private readonly dialog = inject(MatDialog);
  private readonly businessDay = inject(BusinessDay);
  private readonly treasury = inject(Treasury);
  private readonly access = inject(CostingAccess);
  private readonly approvals = inject(Approvals);
  private readonly route = inject(ActivatedRoute);

  protected readonly kinds: EndOfDayInvoiceKind[] = ['Cash', 'Credit'];
  protected readonly sections = sectionLabels;
  protected readonly statusLabels = endOfDayStatusLabels;

  protected readonly today = signal(todayIso());
  protected readonly date = signal('');
  protected readonly day = signal<EndOfDay | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly suppliers = signal<PickItem[]>([]);
  protected readonly history = signal<EndOfDay[]>([]);
  protected readonly editing = signal<string | null>(null);
  protected readonly reviewProblem = signal<string | null>(null);
  // New invoices typed or chosen and not added yet, by section.
  private readonly pending = signal<Record<EndOfDayInvoiceKind, boolean>>({ Cash: false, Credit: false });

  protected readonly sales = signal<EndOfDaySales>(blankSales());
  private readonly savedSales = signal<EndOfDaySales>(blankSales());
  protected readonly savingSales = signal(false);
  protected readonly salesProblem = signal<string | null>(null);
  private salesTimer: ReturnType<typeof setTimeout> | null = null;
  // Each photo fetched once: by what it is, so a replaced one is fetched again.
  private readonly photos = new Map<string, PhotoSource>();

  protected readonly locked = computed(() => this.day()?.status === 'Submitted');
  protected readonly canBatch = computed(() => this.access.has('Purchases'));
  protected readonly canTakings = computed(() => this.access.has('Financials'));
  protected readonly canReopen = computed(() => this.approvals.canApprove());
  protected readonly salesDirty = computed(() => !sameSales(this.sales(), this.savedSales()));
  protected readonly totalRevenue = computed(() => {
    const s = this.sales();
    return round((Number(s.cashAmount) || 0) + (Number(s.cardAmount) || 0) + (Number(s.taxAmount) || 0));
  });
  protected readonly salesState = computed(() =>
    this.savingSales() ? 'Saving… · جارٍ الحفظ' : this.salesDirty() ? 'Not saved yet · لم يُحفظ' : this.day()?.netSales ? 'Saved · تم الحفظ' : '',
  );

  constructor() {
    void this.start();
  }

  protected invoicesOf(kind: EndOfDayInvoiceKind): EndOfDayInvoice[] {
    return (this.day()?.invoices ?? []).filter((i) => i.kind === kind);
  }

  protected countOf(kind: EndOfDayInvoiceKind): number {
    const day = this.day();
    return day ? (kind === 'Cash' ? day.cashInvoices : day.creditInvoices) : 0;
  }

  protected totalOf(kind: EndOfDayInvoiceKind): number {
    const day = this.day();
    return day ? (kind === 'Cash' ? day.cashInvoicesTotal : day.creditInvoicesTotal) : 0;
  }

  protected photoOf(id: string, photo: EndOfDayPhoto): PhotoSource {
    const date = this.date();
    const key = `${date}/${id}/${photo.fileName}/${photo.bytes}`;
    let source = this.photos.get(key);
    if (!source) {
      source = () => this.api.photo(date, id);
      this.photos.set(key, source);
    }
    return source;
  }

  protected pendingIn(kind: EndOfDayInvoiceKind, pending: boolean): void {
    this.pending.update((p) => ({ ...p, [kind]: pending }));
    if (!pending) {
      this.reviewProblem.set(null);
    }
  }

  protected async choose(date: string): Promise<void> {
    if (!date || date === this.date()) {
      return;
    }
    await this.flushSales();
    this.date.set(date);
    this.editing.set(null);
    this.reviewProblem.set(null);
    await this.load();
  }

  protected saved(day: EndOfDay): void {
    this.editing.set(null);
    this.show(day, false);
    void this.loadHistory();
  }

  protected async remove(invoice: EndOfDayInvoice): Promise<void> {
    await this.run(() => this.api.removeInvoice(this.date(), invoice.id), 'The invoice could not be taken off.');
  }

  // A figure typed: kept a moment later, unless another follows.
  protected setSale(field: keyof EndOfDaySales, value: number | string | null): void {
    const cleaned = field === 'notes' ? ((value as string | null) ?? '') : value === '' || value === null ? null : Number(value);
    this.sales.update((s) => ({ ...s, [field]: cleaned }));
    this.salesProblem.set(null);
    this.reviewProblem.set(null);
    if (this.salesTimer) {
      clearTimeout(this.salesTimer);
    }
    this.salesTimer = setTimeout(() => void this.flushSales(), 900);
  }

  protected async zPhoto(input: HTMLInputElement): Promise<void> {
    const chosen = input.files?.[0];
    input.value = '';
    if (!chosen) {
      return;
    }
    const file = await shrinkPhoto(chosen);
    const problem = photoProblem(file);
    if (problem) {
      this.salesProblem.set(problem);
      return;
    }
    await this.flushSales();
    await this.run(() => this.api.attachSalesPhoto(this.date(), file), 'The photo could not be attached.');
  }

  protected async dropZPhoto(): Promise<void> {
    await this.run(() => this.api.removeSalesPhoto(this.date()), 'The photo could not be taken off.');
  }

  // The summary first; confirmed there, handed in and locked.
  protected async review(): Promise<void> {
    this.reviewProblem.set(null);
    if (!(await this.flushSales())) {
      return;
    }
    const day = this.day();
    const pending = this.pending();
    const problem =
      pending.Cash || pending.Credit
        ? `An invoice is filled in ${pending.Cash ? 'under cash' : 'under credit'} but not added: add it, or clear it. · توجد فاتورة لم تُضف بعد.`
        : this.editing()
          ? 'Save or cancel the invoice being changed. · احفظ الفاتورة أو ألغِ التعديل.'
          : !day || day.netSales <= 0
            ? "Enter the day's sales report: its cash or Visa takings. · أدخل ريبورت المبيعات: إيراد الكاش أو الفيزا."
            : (day.taxAmount ?? 0) > day.netSales
              ? "The tax collected cannot be more than the day's sales. · الضريبة لا تزيد عن إجمالي المبيعات."
              : null;
    if (problem) {
      this.reviewProblem.set(problem);
      return;
    }
    const confirmed = await firstValueFrom(
      this.dialog.open<EndOfDaySummaryDialog, EndOfDaySummaryData, boolean>(EndOfDaySummaryDialog, { data: { day: day! }, width: '640px', maxWidth: '96vw' }).afterClosed(),
    );
    if (!confirmed) {
      return;
    }
    if (await this.run(() => this.api.submit(this.date()), 'The end of day could not be submitted.')) {
      this.notify.info(`The end of day of ${this.date()} is submitted. · تم إرسال التقفيل.`);
    }
  }

  protected async reopen(): Promise<void> {
    if (await this.run(() => this.api.reopen(this.date()), 'The end of day could not be reopened.')) {
      this.notify.info('Reopened: it can be changed and submitted again. · تم إعادة الفتح.');
    }
  }

  // The day's takings on Financials, filled in from its sales report.
  protected async takings(): Promise<void> {
    if (await this.treasury.enter('RevenueTransfer', { revenueDate: this.date() })) {
      await this.load();
    }
  }

  // The sales as typed, kept: true once they are, or there was nothing to keep.
  private async flushSales(): Promise<boolean> {
    if (this.salesTimer) {
      clearTimeout(this.salesTimer);
      this.salesTimer = null;
    }
    if (!this.salesDirty() || this.locked() || !this.date()) {
      return true;
    }
    const sales = this.sales();
    if ([sales.cashAmount, sales.cardAmount, sales.taxAmount, sales.voidsAmount].some((n) => n !== null && (!Number.isFinite(n) || n < 0))) {
      this.salesProblem.set('The cash, Visa, tax and voids are zero or more. · المبالغ صفر أو أكثر.');
      return false;
    }
    const date = this.date();
    this.savingSales.set(true);
    try {
      const day = await firstValueFrom(this.api.saveSales(date, { ...sales, notes: sales.notes?.trim() || null }));
      this.savedSales.set(sales);
      if (this.date() === date) {
        this.day.set(day);
      }
      void this.loadHistory();
      return true;
    } catch (error) {
      this.salesProblem.set(errorMessage(error, 'The sales report could not be saved. · تعذر حفظ الريبورت.'));
      return false;
    } finally {
      this.savingSales.set(false);
    }
  }

  private async run(call: () => ReturnType<EndOfDayApi['submit']>, failed: string): Promise<boolean> {
    this.busy.set(true);
    try {
      this.show(await firstValueFrom(call()), false);
      void this.loadHistory();
      return true;
    } catch (error) {
      this.notify.error(error, failed);
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  // The day as the server has it; its sales into the fields unless some are being typed (keep).
  private show(day: EndOfDay | null, replaceSales = true): void {
    this.day.set(day);
    const sales = day ? salesOf(day) : blankSales();
    if (replaceSales || !this.salesDirty()) {
      this.sales.set(sales);
    }
    this.savedSales.set(sales);
  }

  private async start(): Promise<void> {
    const asked = this.route.snapshot.queryParamMap.get('date');
    const today = await this.businessDay.today();
    this.today.set(today);
    this.date.set(asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked <= today ? asked : today);
    try {
      const suppliers = await firstValueFrom(this.costing.suppliers());
      this.suppliers.set(
        suppliers.map((s) => ({ id: s.id, name: s.name, kind: 'supplier' as const, detail: [s.contactPerson, s.phone].filter(Boolean).join(' · ') || null })),
      );
    } catch (error) {
      this.error.set(errorMessage(error, 'The suppliers could not be loaded.'));
    }
    await this.load();
  }

  private async load(): Promise<void> {
    const date = this.date();
    this.loading.set(true);
    try {
      const day = await firstValueFrom(this.api.day(date));
      if (this.date() === date) {
        this.show(day);
      }
    } catch (error) {
      this.error.set(errorMessage(error, 'The end of day could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
    void this.loadHistory();
  }

  private async loadHistory(): Promise<void> {
    const to = this.today();
    try {
      this.history.set(await firstValueFrom(this.api.days(addDays(to, -13), to)));
    } catch {
      this.history.set([]);
    }
  }
}

function blankSales(): EndOfDaySales {
  return { cashAmount: null, cardAmount: null, taxAmount: null, voidsAmount: null, notes: '' };
}

function salesOf(day: EndOfDay): EndOfDaySales {
  return { cashAmount: day.cashAmount, cardAmount: day.cardAmount, taxAmount: day.taxAmount, voidsAmount: day.voidsAmount, notes: day.notes ?? '' };
}

function sameSales(a: EndOfDaySales, b: EndOfDaySales): boolean {
  return a.cashAmount === b.cashAmount && a.cardAmount === b.cardAmount && a.taxAmount === b.taxAmount && a.voidsAmount === b.voidsAmount
    && (a.notes ?? '').trim() === (b.notes ?? '').trim();
}

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// The photo of a day handed in, over the page.
export function viewEndOfDayPhoto(dialog: MatDialog, api: EndOfDayApi, date: string, photoId: string, fileName: string): void {
  viewPhoto(dialog, () => api.photo(date, photoId), fileName);
}
