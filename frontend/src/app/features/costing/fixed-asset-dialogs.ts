import { Component, Injectable, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { firstValueFrom } from 'rxjs';
import {
  AssetPaymentSource,
  CashFund,
  CostingApi,
  FixedAssetCategory,
  FixedAssetRow,
  fixedAssetCategoryLabels,
} from '../../core/costing/costing.api';
import { errorMessage } from '../../core/http/error-message';
import { Company } from '../../core/settings/company';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { NotifyService } from '../../core/ui/notify.service';
import { Approvals } from './approvals';
import { BusinessDay } from './financials';
import { InfoTip } from './info-tip';

// The fixed assets register's dialogs (سجل الأصول الثابتة): an asset bought (CAPEX), out of the safe
// or the bank or owned already, or its details changed; and one disposed of or sold. Each works out
// as it is filled in what the register will: straight-line, (cost − salvage value) ÷ useful life a
// month, from the month bought; sold, what it brought in against what was left of its cost.

const round = (n: number) => Math.round(n * 100) / 100;

// Months from one month to another: "2026-03-15" to "2027-01-10" is 10.
export function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

// What is left of an asset's cost when it goes on `date`: the months before it are charged, its
// month is not, never more than its life.
export function bookValueOn(asset: Pick<FixedAssetRow, 'purchaseDate' | 'purchaseCost' | 'salvageValue' | 'usefulLifeMonths'>, date: string): number {
  const depreciable = asset.purchaseCost - asset.salvageValue;
  const months = Math.min(Math.max(monthsBetween(asset.purchaseDate, date), 0), asset.usefulLifeMonths);
  const monthly = round(depreciable / asset.usefulLifeMonths);
  const accumulated = months >= asset.usefulLifeMonths ? depreciable : Math.min(depreciable, round(monthly * months));
  return round(asset.purchaseCost - accumulated);
}

// "March 2031": the month a life of `months` from `start` ends in.
export function lastMonthOf(start: string, months: number): string {
  const [y, m] = start.split('-').map(Number);
  return new Date(y, m - 1 + months - 1, 15).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

export const assetCategories = Object.keys(fixedAssetCategoryLabels) as FixedAssetCategory[];

export interface FixedAssetDialogData {
  // Null: a new one.
  asset: FixedAssetRow | null;
  canApprove: boolean;
  today: string;
  locations: string[];
}

export interface FixedAssetDialogResult {
  name: string;
  category: FixedAssetCategory;
  location: string | null;
  notes: string | null;
  purchaseDate: string;
  purchaseCost: number;
  salvageValue: number;
  usefulLifeMonths: number;
  paidFrom: AssetPaymentSource;
  reason: string | null;
}

@Component({
  selector: 'app-fixed-asset-dialog',
  imports: [FormsModule, InfoTip, MatButtonModule, MatButtonToggleModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule, MoneyPipe],
  template: `
    <h2 mat-dialog-title>
      @if (data.asset; as a) {
        {{ a.assetCode }} · {{ a.name }}
      } @else {
        Asset acquisition (CAPEX) <span class="ar">شراء أصل ثابت</span>
      }
    </h2>
    <mat-dialog-content>
      @if (!data.asset) {
        <p class="muted">
          Capital spending: what it cost leaves the safe or the bank on the day it is bought, never the operating expenses. The profit and loss takes
          its depreciation, a month at a time over its useful life. <span class="ar">إنفاق رأسمالي: يخرج من الخزنة أو البنك ولا يُحمّل على المصروفات.</span>
        </p>
        <mat-button-toggle-group class="pays" [value]="paidFrom()" (change)="paidFrom.set($event.value)" aria-label="Paid from">
          <mat-button-toggle value="Safe">The safe <span class="ar">الخزنة</span></mat-button-toggle>
          <mat-button-toggle value="Bank">The bank <span class="ar">البنك</span></mat-button-toggle>
          <mat-button-toggle value="OwnedAlready" [disabled]="!data.canApprove">Owned already <span class="ar">أصل قائم</span></mat-button-toggle>
        </mat-button-toggle-group>
        <p class="muted small">{{ paidHint() }}</p>
      }
      <div class="form">
        <mat-form-field class="wide">
          <mat-label>Name · اسم الأصل</mat-label>
          <input matInput [(ngModel)]="name" maxlength="120" aria-label="Name" placeholder="La Marzocco espresso machine" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Category · الفئة</mat-label>
          <mat-select [(ngModel)]="category" aria-label="Category">
            @for (c of categories; track c) {
              <mat-option [value]="c">{{ categoryLabels[c].en }} · {{ categoryLabels[c].ar }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Location · الموقع</mat-label>
          <input matInput [(ngModel)]="location" maxlength="80" aria-label="Location" list="asset-locations" placeholder="Kitchen, bar, dining room" />
          <datalist id="asset-locations">
            @for (l of data.locations; track l) {
              <option [value]="l"></option>
            }
          </datalist>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Purchase date · تاريخ الشراء</mat-label>
          <input matInput type="date" [ngModel]="date()" (ngModelChange)="date.set($event)" [max]="data.today" [disabled]="costFixed"
            aria-label="Purchase date" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Purchase cost · تكلفة الشراء</mat-label>
          <input matInput type="number" min="0" step="any" [ngModel]="cost()" (ngModelChange)="cost.set($event)" [disabled]="costFixed"
            aria-label="Purchase cost" />
          <span matTextSuffix>&nbsp;{{ company.currency() }}</span>
          @if (costFixed) {
            <mat-hint>Its payment's: void the purchase to change it</mat-hint>
          }
        </mat-form-field>
        <mat-form-field>
          <mat-label>Useful life (months) · العمر الإنتاجي</mat-label>
          <input matInput type="number" min="1" max="600" step="1" [ngModel]="life()" (ngModelChange)="life.set($event)" aria-label="Useful life" />
          @if ((life() ?? 0) >= 12) {
            <mat-hint>{{ years() }}</mat-hint>
          }
        </mat-form-field>
        <mat-form-field>
          <mat-label>Salvage value · القيمة التخريدية</mat-label>
          <input matInput type="number" min="0" step="any" [ngModel]="salvage()" (ngModelChange)="salvage.set($event)" aria-label="Salvage value" />
          <span matTextSuffix>&nbsp;{{ company.currency() }}</span>
          <mat-hint>What it is still worth at the end</mat-hint>
        </mat-form-field>
        <mat-form-field class="wide" subscriptSizing="dynamic">
          <mat-label>Notes · ملاحظات</mat-label>
          <input matInput [(ngModel)]="notes" maxlength="500" aria-label="Notes" placeholder="Supplier, invoice number, serial number" />
        </mat-form-field>
      </div>

      <dl class="breakdown" aria-live="polite">
        <div>
          <dt>To depreciate · القيمة القابلة للإهلاك</dt>
          <dd>{{ depreciable() | money }}</dd>
        </div>
        <div class="net">
          <dt>Monthly depreciation · قسط الإهلاك الشهري <app-info-tip tip="faRunRate" /></dt>
          <dd>{{ monthly() | money }}</dd>
        </div>
        @if (lastMonth(); as last) {
          <div>
            <dt>Charged from {{ firstMonth() }} to {{ last }}</dt>
            <dd></dd>
          </div>
        }
      </dl>

      @if (!data.canApprove && !data.asset) {
        <mat-form-field class="full" subscriptSizing="dynamic">
          <mat-label>Reason · السبب</mat-label>
          <textarea matInput [(ngModel)]="reason" maxlength="500" rows="2" placeholder="Optional: tells the manager why"></textarea>
        </mat-form-field>
        <p class="ask">A manager approves what leaves the safe or the bank: no cash moves until then. <span class="ar">يُرسل للمدير للموافقة.</span></p>
      }
      @if (problem(); as p) {
        <p class="error">{{ p }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button (click)="done()" [disabled]="!!problem()">
        {{ data.asset ? 'Save' : data.canApprove || paidFrom() === 'OwnedAlready' ? 'Add to the register' : 'Send for approval' }}
      </button>
    </mat-dialog-actions>
  `,
  styleUrl: './costing.scss',
  styles: `
    .form {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 4px 12px;
    }
    .wide,
    .full {
      grid-column: span 2;
    }
    .full {
      width: 100%;
    }
    .ar {
      direction: rtl;
      unicode-bidi: isolate;
      margin-inline-start: 6px;
      opacity: 0.75;
      font-size: 0.8em;
    }
    .pays {
      display: flex;
      margin-bottom: 4px;

      mat-button-toggle {
        flex: 1;
      }
    }
    .small {
      font-size: 0.85em;
    }
    .ask {
      padding: 8px 10px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--app-warn) 14%, transparent);
    }
    .error {
      color: var(--mat-sys-error);
    }
    .breakdown {
      display: grid;
      gap: 4px;
      margin: 8px 0 12px;
      padding: 10px 12px;
      border-radius: 8px;
      background: var(--mat-sys-surface-container);

      div {
        display: flex;
        justify-content: space-between;
        align-items: center;
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
      .net {
        padding-top: 4px;
        border-top: 1px solid var(--mat-sys-outline-variant);
        font-weight: 600;
      }
    }
    @media (max-width: 599px) {
      .form {
        grid-template-columns: minmax(0, 1fr);
      }
      .wide,
      .full {
        grid-column: auto;
      }
      .pays {
        flex-direction: column;
      }
    }
  `,
})
export class FixedAssetDialog {
  protected readonly company = inject(Company);
  protected readonly data = inject<FixedAssetDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<FixedAssetDialog, FixedAssetDialogResult>>(MatDialogRef);
  protected readonly categories = assetCategories;
  protected readonly categoryLabels = fixedAssetCategoryLabels;

  private readonly asset = this.data.asset;
  // A paid asset's cost and date are its payment's.
  protected readonly costFixed = !!this.asset && this.asset.paidFrom !== null;
  protected readonly paidFrom = signal<AssetPaymentSource>(!this.asset ? 'Safe' : this.asset.paidFrom === 'Bank' ? 'Bank' : this.asset.paidFrom ? 'Safe' : 'OwnedAlready');
  protected name = this.asset?.name ?? '';
  protected category: FixedAssetCategory = this.asset?.category ?? 'KitchenEquipment';
  protected location = this.asset?.location ?? '';
  protected notes = this.asset?.notes ?? '';
  protected reason = '';
  protected readonly date = signal(this.asset?.purchaseDate ?? this.data.today);
  protected readonly cost = signal<number | null>(this.asset?.purchaseCost ?? null);
  protected readonly salvage = signal<number | null>(this.asset?.salvageValue ?? 0);
  protected readonly life = signal<number | null>(this.asset?.usefulLifeMonths ?? 60);
  private readonly tried = signal(false);

  protected readonly depreciable = computed(() => Math.max((this.cost() ?? 0) - (this.salvage() ?? 0), 0));
  protected readonly monthly = computed(() => ((this.life() ?? 0) >= 1 ? round(this.depreciable() / this.life()!) : 0));
  protected readonly firstMonth = computed(() => lastMonthOf(this.date(), 1));
  protected readonly lastMonth = computed(() => ((this.life() ?? 0) >= 1 && this.date() ? lastMonthOf(this.date(), this.life()!) : null));
  protected readonly years = computed(() => {
    const months = this.life() ?? 0;
    const years = Math.floor(months / 12);
    const rest = months % 12;
    return `${years} ${years === 1 ? 'year' : 'years'}${rest ? ` ${rest} ${rest === 1 ? 'month' : 'months'}` : ''}`;
  });
  protected readonly paidHint = computed(
    () =>
      ({
        Safe: 'Out of the safe on the purchase date: the safe’s balance and its cash flow show it. · يُصرف من الخزنة.',
        Bank: 'Paid by the bank: the safe does not move; the register and its cash flow show it. · يُدفع من البنك.',
        OwnedAlready: 'Owned before the register started: on it for its depreciation, no cash moves now. · أصل قائم قبل السجل.',
      })[this.paidFrom()],
  );

  // A method, not a computed: the name is typed into a plain field.
  protected problem(): string | null {
    if (!this.tried()) {
      return null;
    }
    const [cost, salvage, life] = [this.cost() ?? 0, this.salvage() ?? 0, this.life() ?? 0];
    if (!this.name.trim()) {
      return 'Name the asset. · اكتب اسم الأصل.';
    }
    if (!(cost > 0)) {
      return 'Enter what the asset cost, more than nothing. · أدخل تكلفة الأصل.';
    }
    if (!Number.isInteger(life) || life < 1 || life > 600) {
      return 'The useful life is 1 to 600 months. · العمر الإنتاجي من 1 إلى 600 شهر.';
    }
    if (salvage < 0 || salvage >= cost) {
      return 'The salvage value is zero or more, and less than the cost. · القيمة التخريدية أقل من التكلفة.';
    }
    if (!this.date() || this.date() > this.data.today) {
      return 'An asset is bought today or before. · تاريخ الشراء اليوم أو قبله.';
    }
    return null;
  }

  protected done(): void {
    this.tried.set(true);
    if (this.problem()) {
      return;
    }
    this.ref.close({
      name: this.name.trim(),
      category: this.category,
      location: this.location.trim() || null,
      notes: this.notes.trim() || null,
      purchaseDate: this.date(),
      purchaseCost: round(this.cost()!),
      salvageValue: round(this.salvage() ?? 0),
      usefulLifeMonths: this.life()!,
      paidFrom: this.paidFrom(),
      reason: this.reason.trim() || null,
    });
  }
}

export interface DisposeAssetDialogData {
  asset: FixedAssetRow;
  canApprove: boolean;
  today: string;
}

export interface DisposeAssetDialogResult {
  date: string;
  saleProceeds: number | null;
  fund: CashFund | null;
  notes: string | null;
  reason: string | null;
}

@Component({
  selector: 'app-dispose-asset-dialog',
  imports: [FormsModule, InfoTip, MatButtonModule, MatButtonToggleModule, MatDialogModule, MatFormFieldModule, MatInputModule, MoneyPipe],
  template: `
    <h2 mat-dialog-title>Dispose / sell asset <span class="ar">استبعاد أو بيع الأصل</span></h2>
    <mat-dialog-content>
      <p class="muted">{{ data.asset.assetCode }} · {{ data.asset.name }}: its depreciation stops; the month it goes is not charged.</p>
      <mat-button-toggle-group class="pays" [value]="sell() ? 'sell' : 'scrap'" (change)="sell.set($event.value === 'sell')" aria-label="How it goes">
        <mat-button-toggle value="sell">Sold <span class="ar">بيع</span></mat-button-toggle>
        <mat-button-toggle value="scrap" [disabled]="!data.canApprove">Written off <span class="ar">استبعاد بلا مقابل</span></mat-button-toggle>
      </mat-button-toggle-group>
      <div class="form">
        <mat-form-field>
          <mat-label>{{ sell() ? 'Sold on · تاريخ البيع' : 'Disposed of on · تاريخ الاستبعاد' }}</mat-label>
          <input matInput type="date" [ngModel]="date()" (ngModelChange)="date.set($event)" [min]="data.asset.purchaseDate" [max]="data.today"
            aria-label="Date" />
        </mat-form-field>
        @if (sell()) {
          <mat-form-field>
            <mat-label>Sold for · قيمة البيع</mat-label>
            <input matInput type="number" min="0" step="any" [ngModel]="proceeds()" (ngModelChange)="proceeds.set($event)" aria-label="Sold for" />
            <span matTextSuffix>&nbsp;{{ company.currency() }}</span>
          </mat-form-field>
          <mat-button-toggle-group class="pays wide" [value]="fund()" (change)="fund.set($event.value)" aria-label="Paid into">
            <mat-button-toggle value="Safe">Into the safe <span class="ar">للخزنة</span></mat-button-toggle>
            <mat-button-toggle value="Bank">Into the bank <span class="ar">للبنك</span></mat-button-toggle>
          </mat-button-toggle-group>
        } @else {
          <span></span>
        }
        <mat-form-field class="wide" subscriptSizing="dynamic">
          <mat-label>Notes · ملاحظات</mat-label>
          <input matInput [(ngModel)]="notes" maxlength="500" aria-label="Notes" placeholder="Who bought it, why it was scrapped" />
        </mat-form-field>
      </div>
      <dl class="breakdown" aria-live="polite">
        <div>
          <dt>Net book value then · القيمة الدفترية</dt>
          <dd>{{ bookValue() | money }}</dd>
        </div>
        <div>
          <dt>{{ sell() ? 'Sold for · قيمة البيع' : 'Brought in · المحصل' }}</dt>
          <dd>{{ (sell() ? proceeds() ?? 0 : 0) | money }}</dd>
        </div>
        <div class="net" [class.gain]="gain() > 0" [class.loss]="gain() < 0">
          <dt>{{ gain() >= 0 ? 'Capital gain · ربح رأسمالي' : 'Capital loss · خسارة رأسمالية' }} <app-info-tip tip="faGainLoss" /></dt>
          <dd>{{ gain() | money }}</dd>
        </div>
      </dl>
      @if (!data.canApprove) {
        <mat-form-field class="full" subscriptSizing="dynamic">
          <mat-label>Reason · السبب</mat-label>
          <textarea matInput [(ngModel)]="reason" maxlength="500" rows="2" placeholder="Optional: tells the manager why"></textarea>
        </mat-form-field>
        <p class="ask">A manager approves what comes into the safe or the bank; only a manager writes an asset off. <span class="ar">يُرسل للمدير.</span></p>
      }
      @if (problem(); as p) {
        <p class="error">{{ p }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button class="danger-fill" (click)="done()" [disabled]="!!problem()">
        {{ !data.canApprove ? 'Send for approval' : sell() ? 'Record the sale' : 'Write it off' }}
      </button>
    </mat-dialog-actions>
  `,
  styleUrl: './costing.scss',
  styles: `
    .form {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 4px 12px;
    }
    .wide,
    .full {
      grid-column: span 2;
    }
    .full {
      width: 100%;
    }
    .ar {
      direction: rtl;
      unicode-bidi: isolate;
      margin-inline-start: 6px;
      opacity: 0.75;
      font-size: 0.8em;
    }
    .pays {
      display: flex;
      margin-bottom: 12px;

      mat-button-toggle {
        flex: 1;
      }
    }
    .ask {
      padding: 8px 10px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--app-warn) 14%, transparent);
    }
    .error {
      color: var(--mat-sys-error);
    }
    .breakdown {
      display: grid;
      gap: 4px;
      margin: 8px 0 12px;
      padding: 10px 12px;
      border-radius: 8px;
      background: var(--mat-sys-surface-container);

      div {
        display: flex;
        justify-content: space-between;
        align-items: center;
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
      .net {
        padding-top: 4px;
        border-top: 1px solid var(--mat-sys-outline-variant);
        font-weight: 600;
      }
      .gain dd {
        color: var(--app-good, #15803d);
      }
      .loss dd {
        color: var(--mat-sys-error);
      }
    }
    @media (max-width: 599px) {
      .form {
        grid-template-columns: minmax(0, 1fr);
      }
      .wide,
      .full {
        grid-column: auto;
      }
    }
  `,
})
export class DisposeAssetDialog {
  protected readonly company = inject(Company);
  protected readonly data = inject<DisposeAssetDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<DisposeAssetDialog, DisposeAssetDialogResult>>(MatDialogRef);
  protected readonly sell = signal(true);
  protected readonly date = signal(this.data.today);
  protected readonly proceeds = signal<number | null>(null);
  protected readonly fund = signal<CashFund>('Safe');
  protected notes = '';
  protected reason = '';
  private readonly tried = signal(false);

  protected readonly bookValue = computed(() => bookValueOn(this.data.asset, this.date() || this.data.today));
  protected readonly gain = computed(() => round((this.sell() ? this.proceeds() ?? 0 : 0) - this.bookValue()));

  protected readonly problem = computed(() => {
    if (!this.tried()) {
      return null;
    }
    if (!this.date() || this.date() > this.data.today || this.date() < this.data.asset.purchaseDate) {
      return 'It goes on the day it was bought or after, today at the latest. · التاريخ بين الشراء واليوم.';
    }
    if (this.sell() && !((this.proceeds() ?? 0) > 0)) {
      return 'Enter what it was sold for, or write it off. · أدخل قيمة البيع.';
    }
    return null;
  });

  protected done(): void {
    this.tried.set(true);
    if (this.problem()) {
      return;
    }
    this.ref.close({
      date: this.date(),
      saleProceeds: this.sell() ? round(this.proceeds()!) : null,
      fund: this.sell() ? this.fund() : null,
      notes: this.notes.trim() || null,
      reason: this.reason.trim() || null,
    });
  }
}

// Opens the dialogs and sends what they give: a manager's at once, a request for anyone else. True
// when something was saved or asked for.
@Injectable({ providedIn: 'root' })
export class FixedAssetActions {
  private readonly api = inject(CostingApi);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotifyService);
  private readonly approvals = inject(Approvals);
  private readonly businessDay = inject(BusinessDay);
  private readonly company = inject(Company);

  async acquire(locations: string[] = []): Promise<boolean> {
    const today = await this.businessDay.today();
    const answer = await firstValueFrom(
      this.dialog
        .open<FixedAssetDialog, FixedAssetDialogData, FixedAssetDialogResult>(FixedAssetDialog, {
          data: { asset: null, canApprove: this.approvals.canApprove(), today, locations },
          width: '640px',
          maxWidth: '96vw',
        })
        .afterClosed(),
    );
    if (!answer) {
      return false;
    }
    try {
      const result = await firstValueFrom(
        this.api.acquireFixedAsset({ ...answer, requestId: crypto.randomUUID(), assetId: crypto.randomUUID(), transactionId: crypto.randomUUID() }),
      );
      if (result.outcome === 'Requested' && result.request) {
        await this.approvals.requested({ outcome: result.outcome, request: result.request });
      } else {
        this.notify.info(
          `${result.assetCode ?? 'The asset'} ${answer.name} is on the register` +
            (answer.paidFrom === 'OwnedAlready' ? '.' : `: ${this.company.money(answer.purchaseCost)} out of the ${answer.paidFrom === 'Bank' ? 'bank' : 'safe'}.`),
        );
      }
      return true;
    } catch (error) {
      this.notify.error(error, 'The asset could not be saved.');
      return false;
    }
  }

  async edit(asset: FixedAssetRow, locations: string[] = []): Promise<boolean> {
    const today = await this.businessDay.today();
    const answer = await firstValueFrom(
      this.dialog
        .open<FixedAssetDialog, FixedAssetDialogData, FixedAssetDialogResult>(FixedAssetDialog, {
          data: { asset, canApprove: true, today, locations },
          width: '640px',
          maxWidth: '96vw',
        })
        .afterClosed(),
    );
    if (!answer) {
      return false;
    }
    try {
      await firstValueFrom(
        this.api.changeFixedAsset(asset.id, {
          name: answer.name,
          category: answer.category,
          location: answer.location,
          notes: answer.notes,
          salvageValue: answer.salvageValue,
          usefulLifeMonths: answer.usefulLifeMonths,
          ...(asset.paidFrom === null ? { purchaseDate: answer.purchaseDate, purchaseCost: answer.purchaseCost } : {}),
        }),
      );
      this.notify.info(`${asset.assetCode} saved.`);
      return true;
    } catch (error) {
      this.notify.error(error, errorMessage(error, 'The asset could not be saved.'));
      return false;
    }
  }

  async dispose(asset: FixedAssetRow): Promise<boolean> {
    const today = await this.businessDay.today();
    const answer = await firstValueFrom(
      this.dialog
        .open<DisposeAssetDialog, DisposeAssetDialogData, DisposeAssetDialogResult>(DisposeAssetDialog, {
          data: { asset, canApprove: this.approvals.canApprove(), today },
          width: '560px',
          maxWidth: '96vw',
        })
        .afterClosed(),
    );
    if (!answer) {
      return false;
    }
    try {
      const result = await firstValueFrom(
        this.api.disposeFixedAsset(asset.id, { ...answer, requestId: crypto.randomUUID(), transactionId: crypto.randomUUID() }),
      );
      if (result.outcome === 'Requested' && result.request) {
        await this.approvals.requested({ outcome: result.outcome, request: result.request });
      } else {
        this.notify.info(
          answer.saleProceeds
            ? `${asset.assetCode} sold: ${this.company.money(answer.saleProceeds)} into the ${answer.fund === 'Bank' ? 'bank' : 'safe'}.`
            : `${asset.assetCode} written off.`,
        );
      }
      return true;
    } catch (error) {
      this.notify.error(error, 'The asset could not be disposed of.');
      return false;
    }
  }

  // Back in use: a write-off undone here; a sale by voiding its entry, which takes what it brought in back out.
  async undoDisposal(asset: FixedAssetRow): Promise<boolean> {
    if (asset.status === 'Sold' && asset.saleTransactionId) {
      return (
        (await this.approvals.delete(
          'Treasury',
          asset.saleTransactionId,
          `the sale of ${asset.assetCode} ${asset.name}`,
          `What it brought in (${this.company.money(asset.saleProceeds ?? 0)}) goes back out of the ${asset.saleFund === 'Bank' ? 'bank' : 'safe'}, and it is in use again.`,
        )) !== null
      );
    }
    try {
      await firstValueFrom(this.api.reinstateFixedAsset(asset.id));
      this.notify.info(`${asset.assetCode} is in use again.`);
      return true;
    } catch (error) {
      this.notify.error(error, 'The write-off could not be undone.');
      return false;
    }
  }

  // Off the register: one owned already at once (a manager's); a paid one with its purchase voided.
  async remove(asset: FixedAssetRow): Promise<boolean> {
    if (asset.paidFrom && asset.purchaseTransactionId) {
      return (
        (await this.approvals.delete(
          'Treasury',
          asset.purchaseTransactionId,
          `the purchase of ${asset.assetCode} ${asset.name}`,
          `What it cost (${this.company.money(asset.purchaseCost)}) goes back into the ${asset.paidFrom === 'Bank' ? 'bank' : 'safe'}, and it leaves the register.`,
        )) !== null
      );
    }
    if (!confirm(`Take ${asset.assetCode} ${asset.name} off the register? Its depreciation leaves every month's P&L. · حذف الأصل من السجل؟`)) {
      return false;
    }
    try {
      await firstValueFrom(this.api.removeFixedAsset(asset.id));
      this.notify.info(`${asset.assetCode} is off the register.`);
      return true;
    } catch (error) {
      this.notify.error(error, 'The asset could not be removed.');
      return false;
    }
  }
}
