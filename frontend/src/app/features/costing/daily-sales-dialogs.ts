import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';
import { BulkSalesImport, DailySalesImportResult, Menu, MenuSalesApi, SalesReceipt } from '../../core/costing/menu-sales.api';
import { Company } from '../../core/settings/company';
import { GridKeys } from '../shared/grid-keys';
import { ItemPicker, PickItem } from '../shared/item-picker';
import { errorMessage } from '../../core/http/error-message';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { NotifyService } from '../../core/ui/notify.service';
import { saveBlob } from '../../core/ui/save-blob';
import { InfoTip } from './info-tip';

// What a day's sales are entered against: each item, and each size of one sold by size, by its
// code as the day's sheet lists it ("6101-2 · Margherita (Large)"), at the menu's price.
export interface SaleOption {
  label: string;
  menuItemId: number;
  variantId: number | null;
  price: number;
  // Its code ("6101", "6101-2") and its names, as they may be typed.
  code: string;
  names: string[];
}

const key = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase();

export function saleOptions(menu: Menu): SaleOption[] {
  return menu.items
    .filter((i) => !i.isDeleted)
    .sort((a, b) => a.id - b.id)
    .flatMap((item): SaleOption[] =>
      item.sizes.length
        ? item.sizes.map((s) => ({
            label: `${item.id}-${s.id} · ${item.name} (${s.name})`,
            menuItemId: item.id,
            variantId: s.id,
            price: s.price,
            code: `${item.id}-${s.id}`,
            names: [`${item.name} (${s.name})`, ...(item.nameAr ? [`${item.nameAr} (${s.nameAr ?? s.name})`] : [])],
          }))
        : [{ label: `${item.id} · ${item.name}`, menuItemId: item.id, variantId: null, price: item.price, code: `${item.id}`, names: [item.name, ...(item.nameAr ? [item.nameAr] : [])] }],
    );
}

// The option typed: by its label as the list offers it, its code, or a name only one has.
export function findOption(options: SaleOption[], text: string): SaleOption | null {
  const typed = key(text);
  if (!typed) {
    return null;
  }
  const exact = options.find((o) => key(o.label) === typed || o.code === typed);
  if (exact) {
    return exact;
  }
  const named = options.filter((o) => o.names.some((n) => key(n) === typed));
  return named.length === 1 ? named[0] : null;
}

export interface DailySalesDialogData {
  menu: Menu;
  // The business day: the latest a day's sales can be of.
  today: string;
}

interface Row {
  // The option chosen, by its code ("6101-2").
  key: string | null;
  quantity: number | null;
}

// The day's sales summary (ملخص المبيعات اليومية), entered by hand: the day, and each item sold and
// how many, the item found as it is typed from the menu's list. No bills, times or money: the
// day's money is its takings, on Financials. Closes with the summary recorded, its stock taken.
@Component({
  selector: 'app-daily-sales-dialog',
  imports: [FormsModule, GridKeys, ItemPicker, MatButtonModule, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule, MoneyPipe],
  template: `
    <h2 mat-dialog-title>Daily sales summary <span class="inline-ar">ملخص المبيعات اليومية</span></h2>
    <mat-dialog-content>
      <p class="note">
        Each item sold that day and how many: each takes its stock by its recipe. No bills or money here: the day's cash, card and tax are its
        takings, on Financials.
        <span class="note-ar" lang="ar" dir="rtl">كل صنف مباع في اليوم وكميته، ويخصم المخزون بوصفته. لا فواتير ولا مبالغ هنا: الكاش والفيزا والضريبة تُسجل في توريد الإيراد بالماليات.</span>
      </p>
      <mat-form-field class="day">
        <mat-label>Date · التاريخ</mat-label>
        <input matInput type="date" [(ngModel)]="date" (ngModelChange)="touch()" [max]="data.today" required aria-label="Date" />
      </mat-form-field>
      <div class="table-wrap">
        <table class="grid rows" appGridKeys (appGridKeysAppend)="add()">
          <thead>
            <tr>
              <th>Item<span class="ar">الصنف</span></th>
              <th class="num">Quantity sold<span class="ar">الكمية المباعة</span></th>
              <th class="num">At menu price<span class="ar">بسعر المنيو</span></th>
              <th><span class="visually-hidden">Remove</span></th>
            </tr>
          </thead>
          <tbody>
            @for (row of rows(); track $index; let i = $index) {
              <tr>
                <td class="item">
                  <app-item-picker [items]="pickItems" [value]="row.key" (valueChange)="row.key = $event; touch()" [label]="'Item ' + (i + 1)"
                    placeholder="Code or name · الكود أو الاسم" />
                </td>
                <td class="num">
                  <input class="cell qty" type="number" min="1" step="1" [(ngModel)]="row.quantity" (ngModelChange)="touch()"
                    [attr.aria-label]="'Quantity sold ' + (i + 1)" [class.missing]="row.key && !validQuantity(row)" />
                </td>
                <td class="num">{{ optionOf(row) && validQuantity(row) ? (optionOf(row)!.price * row.quantity! | money) : '—' }}</td>
                <td class="num">
                  <button mat-icon-button type="button" (click)="remove(i)" [disabled]="rows().length === 1" [attr.aria-label]="'Remove item ' + (i + 1)">
                    <mat-icon>close</mat-icon>
                  </button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <button mat-button type="button" (click)="add()"><mat-icon>add</mat-icon> Add an item <span class="inline-ar">إضافة صنف</span></button>
      @if (problem(); as p) {
        <p class="warn">{{ p }}</p>
      }
      @if (error(); as message) {
        <p class="error" role="alert">{{ message }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <span class="muted totals">{{ totals().items }} items · {{ totals().sold }} sold · {{ totals().value | money }} at menu prices</span>
      <span class="spacer"></span>
      <button mat-button type="button" mat-dialog-close [disabled]="saving()">Cancel <span class="inline-ar">إلغاء</span></button>
      <button mat-flat-button type="button" (click)="save()" [disabled]="saving() || !!problem()">
        <mat-icon>save</mat-icon> Save the day <span class="inline-ar">حفظ</span>
      </button>
    </mat-dialog-actions>
  `,
  styleUrl: './costing.scss',
  styles: `
    .day {
      width: 220px;
    }
    .item {
      min-width: 260px;
    }
    .cell {
      width: 100%;
      min-width: 200px;
      padding: 6px 8px;
      border: 1px solid var(--app-line);
      border-radius: 8px;
      background: var(--mat-sys-surface);
      color: inherit;
      font: inherit;
    }
    .cell.qty {
      width: 96px;
      min-width: 0;
      text-align: end;
    }
    .cell.missing {
      border-color: var(--mat-sys-error);
    }
    .spacer {
      flex: 1;
    }
    .totals {
      font-size: 0.9em;
    }
  `,
})
export class DailySalesDialog {
  protected readonly data = inject<DailySalesDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<DailySalesDialog, SalesReceipt>>(MatDialogRef);
  private readonly api = inject(MenuSalesApi);

  private readonly company = inject(Company);
  protected readonly options = saleOptions(this.data.menu);
  // As the picker offers them: by code, with the category and the menu's price.
  protected readonly pickItems: PickItem[] = this.options.map((o) => ({
    id: o.code, name: o.names[0], code: o.code, kind: 'menu', detail: this.data.menu.items.find((i) => i.id === o.menuItemId)?.category ?? null,
    cost: this.company.money(o.price), keywords: o.names,
  }));
  // A retry after a lost answer reaches the same summary.
  private readonly id = crypto.randomUUID();
  protected date = this.data.today;
  protected readonly rows = signal<Row[]>([{ key: null, quantity: null }]);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  // Bumped as a row is typed into.
  private readonly version = signal(0);

  // The rows filled in, each found on the menu with how many.
  private readonly filled = computed(() => {
    this.version();
    return this.rows().filter((r) => r.key || r.quantity !== null);
  });

  protected readonly totals = computed(() => {
    const good = this.filled().filter((r) => this.optionOf(r) && this.validQuantity(r));
    return {
      items: new Set(good.map((r) => this.optionOf(r)!.code)).size,
      sold: good.reduce((sum, r) => sum + r.quantity!, 0),
      value: good.reduce((sum, r) => sum + this.optionOf(r)!.price * r.quantity!, 0),
    };
  });

  // What stops it being saved, said plainly in both languages.
  protected readonly problem = computed(() => {
    const rows = this.filled();
    if (!this.date) {
      return 'Choose the date. · اختر التاريخ.';
    }
    if (this.date > this.data.today) {
      return 'That day has not come yet. · هذا اليوم لم يأتِ بعد.';
    }
    if (rows.length === 0) {
      return 'Add at least one item sold. · أضف صنفًا مباعًا واحدًا على الأقل.';
    }
    if (rows.some((r) => !this.optionOf(r))) {
      return 'Choose the item for each quantity from the list. · اختر الصنف لكل كمية من القائمة.';
    }
    if (rows.some((r) => !this.validQuantity(r))) {
      return 'Each quantity sold is a whole number, 1 or more. · الكمية رقم صحيح 1 أو أكثر.';
    }
    return null;
  });

  protected touch(): void {
    this.version.update((v) => v + 1);
  }

  protected optionOf(row: Row): SaleOption | null {
    return row.key ? (this.options.find((o) => o.code === row.key) ?? null) : null;
  }

  protected validQuantity(row: Row): boolean {
    return row.quantity !== null && Number.isInteger(Number(row.quantity)) && Number(row.quantity) >= 1;
  }

  protected add(): void {
    this.rows.update((rows) => [...rows, { key: null, quantity: null }]);
  }

  protected remove(index: number): void {
    this.rows.update((rows) => rows.filter((_, i) => i !== index));
  }

  protected async save(): Promise<void> {
    if (this.problem()) {
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    try {
      const lines = this.filled().map((r) => {
        const option = this.optionOf(r)!;
        return { menuItemId: option.menuItemId, variantId: option.variantId, quantity: Number(r.quantity) };
      });
      this.ref.close(await firstValueFrom(this.api.recordDailySales(this.id, this.date, lines)));
    } catch (error) {
      this.error.set(errorMessage(error, 'The day could not be saved. · تعذّر حفظ اليوم.'));
    } finally {
      this.saving.set(false);
    }
  }
}

// The sales sheet imported (استيراد المبيعات): one day's, for the day chosen here, or several days'
// in one sheet (Multi-day Excel upload), each row with its Date. A multi-day sheet is previewed
// first: its days oldest first, what each holds, and whether they follow the end of day's order,
// with what stops them in red; proceeding records every day or none. Says what was recorded and each
// row left out and why; closes with true when anything was recorded.
type ImportMode = 'day' | 'days';

@Component({
  selector: 'app-daily-sales-import-dialog',
  imports: [
    FormsModule, InfoTip, MatButtonModule, MatButtonToggleModule, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressBarModule,
    MoneyPipe, NgTemplateOutlet,
  ],
  template: `
    <h2 mat-dialog-title>Import sales <span class="inline-ar">استيراد المبيعات</span></h2>
    <mat-dialog-content>
      @if (result(); as r) {
        @if (r.saleId) {
          <p class="note" role="status">
            <strong>{{ r.items }} items, {{ r.quantity }} sold, {{ r.value | money }} at menu prices</strong>, recorded for {{ r.date }}: each took its
            stock by its recipe{{ r.discounts ? ', less ' + (r.discounts | money) + ' of discounts' : '' }}.
            <span class="note-ar" lang="ar" dir="rtl">تم تسجيل مبيعات اليوم وخصم المخزون بالوصفات.</span>
          </p>
        } @else {
          <p class="warn" role="status">Nothing on the sheet could be read: nothing was recorded. · لم يُسجل شيء.</p>
        }
        <ng-container *ngTemplateOutlet="left; context: { $implicit: r.skipped }" />
      } @else if (recorded(); as b) {
        <p class="note" role="status">
          <strong>{{ b.days.length }} {{ b.days.length === 1 ? 'day' : 'days' }} recorded</strong>, oldest first ({{ span(b) }}): each item took its stock by its
          recipe. {{ b.draftsCreated }} {{ b.draftsCreated === 1 ? 'day waits' : 'days wait' }} on End of the day as a draft, to be closed in turn.
          <span class="note-ar" lang="ar" dir="rtl">تم تسجيل مبيعات الأيام بالترتيب، وكل يوم ينتظر تقفيله.</span>
        </p>
        <ng-container *ngTemplateOutlet="days; context: { $implicit: b }" />
        <ng-container *ngTemplateOutlet="left; context: { $implicit: b.skipped }" />
      } @else {
        <div class="modes">
          <mat-button-toggle-group [value]="mode()" (change)="setMode($event.value)" hideSingleSelectionIndicator aria-label="How many days">
            <mat-button-toggle value="day">One day · يوم واحد</mat-button-toggle>
            <mat-button-toggle value="days">Multi-day Excel upload · عدة أيام</mat-button-toggle>
          </mat-button-toggle-group>
          <app-info-tip tip="bulkSalesImport" />
        </div>
        @if (mode() === 'day') {
          <p class="note">
            The item, chosen from the menu's list, and how many sold. One sheet for the day chosen here (its Date column left blank or that day).
            <span class="note-ar" lang="ar" dir="rtl">الصنف من قائمة المنيو والكمية المباعة. ملف لليوم المختار هنا.</span>
          </p>
          <div class="row">
            <mat-form-field class="day">
              <mat-label>Date · التاريخ</mat-label>
              <input matInput type="date" [(ngModel)]="date" [max]="data.today" required aria-label="Date" />
            </mat-form-field>
            <button mat-stroked-button type="button" (click)="template()"><mat-icon>download</mat-icon> Template <span class="inline-ar">النموذج</span></button>
          </div>
          <button mat-flat-button type="button" (click)="picker.click()" [disabled]="busy() || !date || date > data.today">
            <mat-icon>upload_file</mat-icon> Choose the sheet <span class="inline-ar">اختر الملف</span>
          </button>
        } @else {
          <p class="note">
            One sheet, several days: the Date (dd/MM/yyyy) on every row, the days one after another from the next day to close, none skipped.
            <span class="note-ar" lang="ar" dir="rtl">ملف واحد لعدة أيام: التاريخ في كل صف، والأيام متتالية من اليوم التالي للتقفيل بدون تخطي.</span>
          </p>
          <div class="row">
            <button mat-flat-button type="button" (click)="picker.click()" [disabled]="busy()">
              <mat-icon>upload_file</mat-icon> {{ file() ? 'Choose another sheet' : 'Choose the sheet' }} <span class="inline-ar">اختر الملف</span>
            </button>
            <button mat-stroked-button type="button" (click)="template()"><mat-icon>download</mat-icon> Template <span class="inline-ar">النموذج</span></button>
          </div>
          @if (preview(); as p) {
            @if (p.ok) {
              <p class="ok-line" role="status">
                Found {{ p.days.length }} {{ p.days.length === 1 ? 'day' : 'days' }} in file: {{ found(p) }}. This matches your next expected sequence. Proceed?
                <span class="note-ar" lang="ar" dir="rtl">تم العثور على {{ p.days.length }} أيام، وهي مطابقة لتسلسل النظام. هل تود الاستمرار؟</span>
              </p>
            } @else {
              <ul class="problems" role="alert">
                @for (problem of p.problems; track problem) {
                  <li>{{ problem }}</li>
                }
              </ul>
            }
            <ng-container *ngTemplateOutlet="days; context: { $implicit: p }" />
            <ng-container *ngTemplateOutlet="left; context: { $implicit: p.skipped }" />
          }
        }
        <input #picker type="file" accept=".xlsx" (change)="chosen($event)" hidden aria-label="The sales sheet" />
        @if (busy()) {
          <mat-progress-bar mode="indeterminate" />
        }
      }
      @if (error(); as message) {
        <p class="error" role="alert">{{ message }}</p>
      }

      <ng-template #days let-p>
        <table class="grid days" aria-label="Days in the sheet">
          <thead>
            <tr>
              <th>Date<span class="ar">التاريخ</span></th>
              <th class="num">Items<span class="ar">الأصناف</span></th>
              <th class="num">Sold<span class="ar">المباع</span></th>
              <th class="num">At menu prices<span class="ar">بأسعار المنيو</span></th>
              <th class="num">Discounts<span class="ar">الخصومات</span></th>
              <th class="num">Left out<span class="ar">صفوف مستبعدة</span></th>
            </tr>
          </thead>
          <tbody>
            @for (d of p.days; track d.date) {
              <tr>
                <td>{{ ddmm(d.date) }}</td>
                <td class="num">{{ d.items }}</td>
                <td class="num">{{ d.quantity }}</td>
                <td class="num">{{ d.value | money }}</td>
                <td class="num">{{ d.discounts | money }}</td>
                <td class="num">{{ d.skipped }}</td>
              </tr>
            }
          </tbody>
        </table>
      </ng-template>

      <ng-template #left let-skipped>
        @if (skipped.length) {
          <h3>{{ skipped.length }} {{ skipped.length === 1 ? 'row' : 'rows' }} left out <span class="inline-ar">صفوف لم تُستورد</span></h3>
          <ul class="skipped">
            @for (s of skipped; track s.row) {
              <li>
                <strong>Row {{ s.row }}{{ s.name ? ' · ' + s.name : '' }}</strong>: {{ s.reason }}
                @if (s.reasonAr) {
                  <div class="reason-ar" lang="ar" dir="rtl">{{ s.reasonAr }}</div>
                }
              </li>
            }
          </ul>
        }
      </ng-template>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      @if (result() || recorded()) {
        <button mat-flat-button type="button" (click)="close()">Done <span class="inline-ar">تم</span></button>
      } @else {
        <button mat-button type="button" mat-dialog-close>Cancel <span class="inline-ar">إلغاء</span></button>
        @if (mode() === 'days' && preview()?.ok) {
          <button mat-flat-button type="button" (click)="proceed()" [disabled]="busy()">
            <mat-icon>playlist_add_check</mat-icon> Proceed · استمرار ({{ preview()!.days.length }})
          </button>
        }
      }
    </mat-dialog-actions>
  `,
  styleUrl: './costing.scss',
  styles: `
    .modes {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
      margin-bottom: 8px;
    }
    .day {
      width: 220px;
    }
    .ok-line {
      margin: 12px 0 8px;
      padding: 10px 12px;
      border-radius: 10px;
      background: color-mix(in srgb, var(--app-ok, #2e7d32) 12%, transparent);

      .note-ar {
        display: block;
        margin-top: 4px;
      }
    }
    .problems {
      margin: 12px 0 8px;
      padding: 10px 12px 10px 28px;
      border-radius: 10px;
      background: color-mix(in srgb, var(--mat-sys-error) 10%, transparent);
      color: var(--mat-sys-error);

      li + li {
        margin-top: 4px;
      }
    }
    table.days {
      width: 100%;
      margin: 8px 0;
    }
    .skipped li {
      margin-bottom: 6px;
    }
    .reason-ar {
      color: var(--mat-sys-on-surface-variant);
    }
    h3 {
      margin: 12px 0 6px;
      font: var(--mat-sys-title-small);
    }
  `,
})
export class DailySalesImportDialog {
  protected readonly data = inject<{ today: string }>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<DailySalesImportDialog, boolean>>(MatDialogRef);
  private readonly api = inject(MenuSalesApi);
  private readonly notify = inject(NotifyService);

  protected date = this.data.today;
  protected readonly mode = signal<ImportMode>('day');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly result = signal<DailySalesImportResult | null>(null);
  // The multi-day sheet chosen, as previewed, and once recorded.
  protected readonly file = signal<File | null>(null);
  protected readonly preview = signal<BulkSalesImport | null>(null);
  protected readonly recorded = signal<BulkSalesImport | null>(null);

  protected setMode(mode: ImportMode): void {
    this.mode.set(mode);
    this.error.set(null);
  }

  protected ddmm(iso: string): string {
    return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  }

  // "15/11 (4 items, 45 sold), 16/11 (…)".
  protected found(p: BulkSalesImport): string {
    return p.days.map((d) => `${this.ddmm(d.date)} (${d.items} ${d.items === 1 ? 'item' : 'items'}, ${d.quantity} sold)`).join(', ');
  }

  protected span(p: BulkSalesImport): string {
    return p.days.length ? `${this.ddmm(p.days[0].date)} to ${this.ddmm(p.days[p.days.length - 1].date)}` : '';
  }

  protected async template(): Promise<void> {
    try {
      saveBlob(await firstValueFrom(this.api.dailySalesTemplate()), 'daily-sales-template.xlsx');
    } catch (error) {
      this.notify.error(error, 'The template could not be downloaded. · تعذّر تنزيل النموذج.');
    }
  }

  protected async chosen(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    await (this.mode() === 'day' ? this.import(file) : this.check(file));
  }

  protected async import(file: File): Promise<void> {
    await this.run(async () => this.result.set(await firstValueFrom(this.api.importDailySales(this.date, file))), 'The sheet could not be imported. · تعذّر استيراد الملف.');
  }

  // The multi-day sheet read and checked: nothing recorded yet.
  protected async check(file: File): Promise<void> {
    this.file.set(file);
    this.preview.set(null);
    await this.run(async () => this.preview.set(await firstValueFrom(this.api.previewBulkSales(file))), 'The sheet could not be read. · تعذّرت قراءة الملف.');
  }

  protected async proceed(): Promise<void> {
    const file = this.file();
    if (!file || !this.preview()?.ok) {
      return;
    }
    await this.run(async () => this.recorded.set(await firstValueFrom(this.api.bulkImportSales(file))), 'The days could not be imported. · تعذّر استيراد الأيام.');
  }

  private async run(call: () => Promise<void>, failed: string): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await call();
    } catch (error) {
      this.error.set(errorMessage(error, failed));
    } finally {
      this.busy.set(false);
    }
  }

  protected close(): void {
    this.ref.close(!!this.result()?.saleId || !!this.recorded()?.recorded);
  }
}
