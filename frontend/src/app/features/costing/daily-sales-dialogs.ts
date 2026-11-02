import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';
import { DailySalesImportResult, Menu, MenuSalesApi, SalesReceipt } from '../../core/costing/menu-sales.api';
import { errorMessage } from '../../core/http/error-message';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { NotifyService } from '../../core/ui/notify.service';
import { saveBlob } from '../../core/ui/save-blob';

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
  text: string;
  quantity: number | null;
}

// The day's sales summary (ملخص المبيعات اليومية), entered by hand: the day, and each item sold and
// how many, the item found as it is typed from the menu's list. No bills, times or money: the
// day's money is its takings, on Financials. Closes with the summary recorded, its stock taken.
@Component({
  selector: 'app-daily-sales-dialog',
  imports: [FormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule, MoneyPipe],
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
      <datalist id="sale-items">
        @for (o of options; track o.code) {
          <option [value]="o.label"></option>
        }
      </datalist>
      <div class="table-wrap">
        <table class="grid rows">
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
                <td>
                  <input class="cell" [(ngModel)]="row.text" (ngModelChange)="touch()" list="sale-items" [attr.aria-label]="'Item ' + (i + 1)"
                    placeholder="Code or name · الكود أو الاسم" [class.missing]="row.text.trim() && !optionOf(row)" />
                </td>
                <td class="num">
                  <input class="cell qty" type="number" min="1" step="1" [(ngModel)]="row.quantity" (ngModelChange)="touch()"
                    [attr.aria-label]="'Quantity sold ' + (i + 1)" [class.missing]="row.text.trim() && !validQuantity(row)" />
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

  protected readonly options = saleOptions(this.data.menu);
  // A retry after a lost answer reaches the same summary.
  private readonly id = crypto.randomUUID();
  protected date = this.data.today;
  protected readonly rows = signal<Row[]>([{ text: '', quantity: null }]);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  // Bumped as a row is typed into.
  private readonly version = signal(0);

  // The rows filled in, each found on the menu with how many.
  private readonly filled = computed(() => {
    this.version();
    return this.rows().filter((r) => r.text.trim() || r.quantity !== null);
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
    const unknown = rows.find((r) => !this.optionOf(r));
    if (unknown) {
      return unknown.text.trim()
        ? `${unknown.text.trim()} is not on the menu: choose the item from the list. · اختر الصنف من القائمة.`
        : 'Choose the item for each quantity. · اختر الصنف لكل كمية.';
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
    return findOption(this.options, row.text);
  }

  protected validQuantity(row: Row): boolean {
    return row.quantity !== null && Number.isInteger(Number(row.quantity)) && Number(row.quantity) >= 1;
  }

  protected add(): void {
    this.rows.update((rows) => [...rows, { text: '', quantity: null }]);
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

// The day's sheet imported (استيراد مبيعات اليوم): the day chosen here, the sheet two columns, an
// item from the menu's list and how many sold. Says what was recorded and each row left out and
// why; closes with true when the day was recorded.
@Component({
  selector: 'app-daily-sales-import-dialog',
  imports: [FormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressBarModule, MoneyPipe],
  template: `
    <h2 mat-dialog-title>Import a day's sales <span class="inline-ar">استيراد مبيعات يوم</span></h2>
    <mat-dialog-content>
      @if (result(); as r) {
        @if (r.saleId) {
          <p class="note" role="status">
            <strong>{{ r.items }} items, {{ r.quantity }} sold, {{ r.value | money }} at menu prices</strong>, recorded for {{ r.date }}: each took its
            stock by its recipe.
            <span class="note-ar" lang="ar" dir="rtl">تم تسجيل مبيعات اليوم وخصم المخزون بالوصفات.</span>
          </p>
        } @else {
          <p class="warn" role="status">Nothing on the sheet could be read: nothing was recorded. · لم يُسجل شيء.</p>
        }
        @if (r.skipped.length) {
          <h3>{{ r.skipped.length }} {{ r.skipped.length === 1 ? 'row' : 'rows' }} left out <span class="inline-ar">صفوف لم تُستورد</span></h3>
          <ul class="skipped">
            @for (s of r.skipped; track s.row) {
              <li>
                <strong>Row {{ s.row }}{{ s.name ? ' · ' + s.name : '' }}</strong>: {{ s.reason }}
                @if (s.reasonAr) {
                  <div class="reason-ar" lang="ar" dir="rtl">{{ s.reasonAr }}</div>
                }
              </li>
            }
          </ul>
        }
      } @else {
        <p class="note">
          Two columns: the item, chosen from the menu's list, and how many sold. One sheet for each day, chosen here.
          <span class="note-ar" lang="ar" dir="rtl">عمودان: الصنف من قائمة المنيو والكمية المباعة. ملف لكل يوم، ويُختار التاريخ هنا.</span>
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
        <input #picker type="file" accept=".xlsx" (change)="chosen($event)" hidden aria-label="The day's sheet" />
        @if (busy()) {
          <mat-progress-bar mode="indeterminate" />
        }
      }
      @if (error(); as message) {
        <p class="error" role="alert">{{ message }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      @if (result()) {
        <button mat-flat-button type="button" (click)="close()">Done <span class="inline-ar">تم</span></button>
      } @else {
        <button mat-button type="button" mat-dialog-close>Cancel <span class="inline-ar">إلغاء</span></button>
      }
    </mat-dialog-actions>
  `,
  styleUrl: './costing.scss',
  styles: `
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
    }
    .day {
      width: 220px;
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
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly result = signal<DailySalesImportResult | null>(null);

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
    if (file) {
      await this.import(file);
    }
  }

  protected async import(file: File): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      this.result.set(await firstValueFrom(this.api.importDailySales(this.date, file)));
    } catch (error) {
      this.error.set(errorMessage(error, 'The sheet could not be imported. · تعذّر استيراد الملف.'));
    } finally {
      this.busy.set(false);
    }
  }

  protected close(): void {
    this.ref.close(!!this.result()?.saleId);
  }
}
