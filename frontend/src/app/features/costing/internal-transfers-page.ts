import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { Permissions } from '../../core/auth/permissions';
import { CostingApi, MaterialCost, UnitOfMeasure, countUnit } from '../../core/costing/costing.api';
import { InternalTransfer, LocationStock, StockApi, StockPlaces } from '../../core/costing/stock.api';
import { errorMessage } from '../../core/http/error-message';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { NotifyService } from '../../core/ui/notify.service';
import { saveBlob } from '../../core/ui/save-blob';
import { Company } from '../../core/settings/company';
import { FilterOption, FilterSelect } from '../shared/filter-select';
import { GridKeys } from '../shared/grid-keys';
import { SearchField } from '../shared/search-field';
import { smartMatch } from '../shared/smart-search';
import { isoDay } from './financials';
import { InfoTip } from './info-tip';
import { MaterialPicker } from './material-picker';

interface Line {
  rawMaterialId: string | null;
  // In the unit it is counted in (kg, L, pc), as a count takes it.
  quantity: number | null;
}

// Internal transfers (التحويلات الداخلية): stock moved between two locations of the branch, the main
// store to the kitchen or the bar, at the branch's average cost; nothing bought, used or lost. Made by
// whoever keeps the stock, posted as made and voided whole; each printed as a slip for the two to
// sign, and all of a period sent as a workbook. Below, what each location holds. Only once the
// company keeps stock in more than one place.
@Component({
  selector: 'app-internal-transfers-page',
  imports: [
    DatePipe,
    DecimalPipe,
    FilterSelect,
    FormsModule,
    GridKeys,
    InfoTip,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
    MatTooltipModule,
    MaterialPicker,
    MoneyPipe,
    SearchField,
  ],
  template: `
    <p class="note">
      <app-info-tip tip="internalTransfer" />
      Move stock from one location of the branch to another: the main store to the kitchen or the bar. Only where it is changes.
      <span class="inline-ar">انقل المخزون من موقع لآخر داخل الفرع؛ يتغير المكان فقط.</span>
    </p>
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    } @else if (error()) {
      <p class="error">{{ error() }}</p>
    } @else if (!places.shown()) {
      <p class="muted">
        The company keeps its stock in one place: there is nowhere to move it. Add a location in Settings, Company structure, once it keeps sub-stores.
        <span class="inline-ar">المخزون في مكان واحد؛ أضف المواقع من إعدادات هيكل الشركة.</span>
      </p>
    } @else {
      @if (canMove()) {
        <section class="new-transfer" aria-label="New transfer">
          <h2 class="section-title">New transfer <span class="inline-ar">تحويل جديد</span></h2>
          <div class="toolbar">
            <mat-form-field subscriptSizing="dynamic" class="place">
              <mat-label>From · من</mat-label>
              <mat-select [ngModel]="from()" (ngModelChange)="from.set($event)" aria-label="From location">
                @for (l of places.locations(); track l.id) {
                  <mat-option [value]="l.id">{{ l.name }}@if (l.nameAr) { · {{ l.nameAr }}}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <button mat-icon-button (click)="swap()" matTooltip="Swap · تبديل" aria-label="Swap from and to"><mat-icon>swap_horiz</mat-icon></button>
            <mat-form-field subscriptSizing="dynamic" class="place">
              <mat-label>To · إلى</mat-label>
              <mat-select [ngModel]="to()" (ngModelChange)="to.set($event)" aria-label="To location">
                @for (l of places.locations(); track l.id) {
                  <mat-option [value]="l.id">{{ l.name }}@if (l.nameAr) { · {{ l.nameAr }}}</mat-option>
                }
              </mat-select>
            </mat-form-field>
          </div>
          @if (from() && from() === to()) {
            <p class="error" role="alert">Choose two different locations. · اختر موقعين مختلفين.</p>
          }
          <div class="table-wrap">
            <table class="grid" appGridKeys (appGridKeysAppend)="add()" aria-label="Transfer lines">
              <thead>
                <tr>
                  <th>Material<span class="ar">الخامة</span></th>
                  <th class="num">Quantity<span class="ar">الكمية</span></th>
                  <th class="num">At {{ places.name(from()) }}<span class="ar">الرصيد بالمصدر</span></th>
                  @if (seesCosts()) {
                    <th class="num">Worth<span class="ar">القيمة</span></th>
                  }
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (line of lines(); track $index; let i = $index) {
                  <tr>
                    <td>
                      <app-material-picker class="material" [materials]="materials()" [value]="line.rawMaterialId"
                        (valueChange)="change(i, { rawMaterialId: $event })" [label]="'Material, line ' + (i + 1)" />
                    </td>
                    <td class="num">
                      <mat-form-field subscriptSizing="dynamic" class="small">
                        <input matInput type="number" min="0" step="any" [ngModel]="line.quantity" (ngModelChange)="change(i, { quantity: $event })"
                          [attr.aria-label]="'Quantity, line ' + (i + 1)" />
                        <span matTextSuffix>&nbsp;{{ unitOf(line) }}</span>
                      </mat-form-field>
                    </td>
                    <td class="num" [class.short]="isShort(line)">
                      @if (line.rawMaterialId) {
                        {{ available(line) | number: '1.0-3' }} {{ unitOf(line) }}
                      }
                    </td>
                    @if (seesCosts()) {
                      <td class="num">{{ worth(line) === null ? '' : (worth(line) | money) }}</td>
                    }
                    <td>
                      <button mat-icon-button (click)="remove(i)" [disabled]="lines().length === 1" aria-label="Remove line"><mat-icon>delete</mat-icon></button>
                    </td>
                  </tr>
                }
              </tbody>
              <tfoot>
                <tr>
                  <td><button mat-button (click)="add()"><mat-icon>add</mat-icon> Add line</button></td>
                  <td colspan="2"></td>
                  @if (seesCosts()) {
                    <td class="num">{{ total() | money }}</td>
                  }
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div class="toolbar actions">
            <mat-form-field subscriptSizing="dynamic" class="notes">
              <mat-label>Notes · ملاحظات</mat-label>
              <input matInput maxlength="500" [ngModel]="notes()" (ngModelChange)="notes.set($event)" aria-label="Notes" />
            </mat-form-field>
            <span class="spacer"></span>
            <button mat-flat-button (click)="post()" [disabled]="!ready() || saving()">
              <mat-icon>move_down</mat-icon> Move stock <span class="inline-ar">تحويل</span>
            </button>
          </div>
        </section>
      }

      <h2 class="section-title">Transfers <span class="inline-ar">التحويلات</span></h2>
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
        <button mat-stroked-button (click)="downloadSheet()" [disabled]="downloading()">
          <mat-icon>download</mat-icon> Excel <span class="inline-ar">إكسل</span>
        </button>
      </div>
      <div class="toolbar smart">
        <app-search-field [(value)]="search" placeholder="Number, material or who made it · الرقم أو الخامة أو المسجل" />
        <div class="pills">
          <app-filter-select label="From · من" icon="logout" [options]="fromFilters()" [(value)]="fromFilter" />
          <app-filter-select label="To · إلى" icon="login" [options]="toFilters()" [(value)]="toFilter" />
          <app-filter-select label="Status · الحالة" icon="flag" [options]="statusFilters()" [(value)]="statusFilter" />
        </div>
      </div>
      <div class="table-wrap">
        <table class="grid" aria-label="Transfers">
          <thead>
            <tr>
              <th>Number<span class="ar">الرقم</span></th>
              <th>Day<span class="ar">اليوم</span></th>
              <th>From → To<span class="ar">من ← إلى</span></th>
              <th>Materials<span class="ar">الخامات</span></th>
              <th>By<span class="ar">بواسطة</span></th>
              @if (seesCosts()) {
                <th class="num">Worth<span class="ar">القيمة</span></th>
              }
              <th class="num"><span class="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (t of shown(); track t.id) {
              <tr [class.voided]="t.status === 'Voided'">
                <td class="nowrap"><strong>{{ t.number }}</strong>
                  @if (t.status === 'Voided') {
                    <div><span class="void-badge">Voided · ملغي</span></div>
                  }
                </td>
                <td class="nowrap struck">{{ t.transferDate | date: 'd MMM yyyy' }}</td>
                <td class="route struck">{{ t.fromLocation }} → {{ t.toLocation }}</td>
                <td class="struck">
                  @for (l of t.lines; track l.rawMaterialId; let last = $last) {
                    <span class="nowrap">{{ l.material }} {{ shownQuantity(l.rawMaterialId, l.quantity, l.unit) }}</span>@if (!last) {, }
                  }
                  @if (t.notes) {
                    <div class="muted tiny">{{ t.notes }}</div>
                  }
                </td>
                <td class="muted tiny who">
                  {{ t.createdBy }}
                  @if (t.voidedBy) {
                    <div>Voided by {{ t.voidedBy }} · ألغاه</div>
                  }
                </td>
                @if (seesCosts()) {
                  <td class="num struck">{{ t.totalCost === null ? '' : (t.totalCost | money) }}</td>
                }
                <td class="num nowrap">
                  <button mat-icon-button (click)="printSlip(t)" matTooltip="Print slip · طباعة إذن التحويل" [attr.aria-label]="'Print the slip of ' + t.number">
                    <mat-icon>print</mat-icon>
                  </button>
                  @if (canMove() && t.status === 'Posted') {
                    <button mat-icon-button class="danger" (click)="voidTransfer(t)" matTooltip="Void · إلغاء" [attr.aria-label]="'Void ' + t.number">
                      <mat-icon>undo</mat-icon>
                    </button>
                  }
                </td>
              </tr>
            } @empty {
              <tr><td [attr.colspan]="seesCosts() ? 7 : 6" class="muted">No transfers. · لا توجد تحويلات.</td></tr>
            }
          </tbody>
        </table>
      </div>

      <h2 class="section-title">Stock by location <span class="inline-ar">الرصيد حسب الموقع</span> <app-info-tip tip="locationStock" /></h2>
      <div class="toolbar smart">
        <app-search-field [(value)]="stockSearch" placeholder="Material or code · الخامة أو الكود" />
      </div>
      @if (stock(); as s) {
        <div class="table-wrap">
          <table class="grid" aria-label="Stock by location">
            <thead>
              <tr>
                <th>Material<span class="ar">الخامة</span></th>
                @for (c of s.locations; track c.id) {
                  <th class="num">{{ c.name }}@if (c.nameAr) {<span class="ar">{{ c.nameAr }}</span>}</th>
                }
                <th class="num">Total<span class="ar">الإجمالي</span></th>
                @if (seesCosts()) {
                  <th class="num">Value<span class="ar">القيمة</span></th>
                }
              </tr>
            </thead>
            <tbody>
              @for (r of stockRows(); track r.rawMaterialId) {
                <tr>
                  <td>
                    @if (r.code) {
                      <span class="muted tiny">{{ r.code }}</span>
                    }
                    {{ r.material }}
                  </td>
                  @for (c of s.locations; track c.id) {
                    <td class="num" [class.short]="r.byLocation[c.id] < 0">
                      {{ r.byLocation[c.id] === undefined ? '—' : shownQuantity(r.rawMaterialId, r.byLocation[c.id], r.unit) }}
                    </td>
                  }
                  <td class="num"><strong>{{ shownQuantity(r.rawMaterialId, r.total, r.unit) }}</strong></td>
                  @if (seesCosts()) {
                    <td class="num">{{ r.value === null ? '' : (r.value | money) }}</td>
                  }
                </tr>
              } @empty {
                <tr><td [attr.colspan]="s.locations.length + (seesCosts() ? 3 : 2)" class="muted">Nothing in stock. · لا يوجد رصيد.</td></tr>
              }
            </tbody>
          </table>
        </div>
      }
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .section-title {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 24px 0 8px;
      font: var(--mat-sys-title-medium);
    }
    .place {
      min-width: 220px;
    }
    .material {
      min-width: 220px;
      width: 100%;
    }
    .small {
      width: 140px;
    }
    .notes {
      min-width: 280px;
      flex: 1 1 280px;
    }
    .day {
      width: 170px;
    }
    .actions {
      margin-top: 12px;
    }
    .tiny {
      font-size: 0.85em;
    }
    .nowrap {
      white-space: nowrap;
    }
    .route {
      min-width: 180px;
    }
    .who {
      min-width: 150px;
    }
    .short {
      color: var(--mat-sys-error);
      font-weight: 600;
    }
    tr.voided td {
      color: var(--mat-sys-on-surface-variant);
    }
    tr.voided td.struck {
      text-decoration: line-through;
    }
    .void-badge {
      display: inline-block;
      margin-top: 2px;
      padding: 0 6px;
      border-radius: 999px;
      font-size: 0.8em;
      color: var(--mat-sys-error);
      background: color-mix(in srgb, var(--mat-sys-error) 10%, transparent);
    }
    .danger {
      color: var(--mat-sys-error);
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
export class InternalTransfersPage {
  private readonly api = inject(CostingApi);
  private readonly stockApi = inject(StockApi);
  private readonly notify = inject(NotifyService);
  private readonly auth = inject(AuthService);
  private readonly company = inject(Company);
  protected readonly places = inject(StockPlaces);

  protected readonly canMove = computed(() => this.auth.can(Permissions.InventoryManage));
  // Costs for whoever sees them: a storekeeper moves the stock without its value.
  protected readonly seesCosts = computed(() => this.auth.can(Permissions.CostingView));

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly downloading = signal(false);
  protected readonly materials = signal<MaterialCost[]>([]);
  protected readonly transfers = signal<InternalTransfer[]>([]);
  protected readonly stock = signal<LocationStock | null>(null);

  // The new transfer: the main store to the first other location until chosen.
  protected readonly from = signal<string | null>(null);
  protected readonly to = signal<string | null>(null);
  protected readonly notes = signal('');
  protected readonly lines = signal<Line[]>([blank()]);
  // One transfer, one id: sent again after a lost answer, it is made once. A new one after each.
  private transferId = crypto.randomUUID();

  // The list: the last 30 days until other days are chosen.
  protected readonly toDay = signal(isoDay(new Date()));
  protected readonly fromDay = signal(isoDay(new Date(Date.now() - 29 * 86_400_000)));
  protected readonly search = signal('');
  protected readonly fromFilter = signal('');
  protected readonly toFilter = signal('');
  protected readonly statusFilter = signal('');
  protected readonly stockSearch = signal('');

  protected readonly fromFilters = computed<FilterOption[]>(() => this.placeFilters((t) => t.fromLocationId));
  protected readonly toFilters = computed<FilterOption[]>(() => this.placeFilters((t) => t.toLocationId));
  protected readonly statusFilters = computed<FilterOption[]>(() => {
    const all = this.transfers();
    return [
      { value: '', label: 'All · الكل', count: all.length },
      { value: 'Posted', label: 'Posted · مرحل', count: all.filter((t) => t.status === 'Posted').length },
      { value: 'Voided', label: 'Voided · ملغي', count: all.filter((t) => t.status === 'Voided').length },
    ];
  });

  protected readonly shown = computed(() =>
    this.transfers().filter(
      (t) =>
        (!this.fromFilter() || t.fromLocationId === this.fromFilter()) &&
        (!this.toFilter() || t.toLocationId === this.toFilter()) &&
        (!this.statusFilter() || t.status === this.statusFilter()) &&
        smartMatch(this.search(), t.number, t.createdBy, t.notes ?? '', t.fromLocation, t.toLocation, ...t.lines.flatMap((l) => [l.material, l.code ?? ''])),
    ),
  );

  protected readonly stockRows = computed(() =>
    (this.stock()?.rows ?? []).filter((r) => smartMatch(this.stockSearch(), r.material, r.code ?? '')),
  );

  protected readonly total = computed(() => this.lines().reduce((sum, l) => sum + (this.worth(l) ?? 0), 0));

  protected readonly ready = computed(() => {
    const lines = this.lines();
    const ids = lines.map((l) => l.rawMaterialId);
    return (
      !!this.from() && !!this.to() && this.from() !== this.to() &&
      lines.every((l) => l.rawMaterialId && (l.quantity ?? 0) > 0 && !this.isShort(l)) && new Set(ids).size === ids.length
    );
  });

  constructor() {
    void this.load();
  }

  protected unitOf(line: Line): string {
    const material = this.material(line.rawMaterialId);
    return material ? countUnit(material.unit, material.purchaseUnitSize).label : '';
  }

  // What the location it leaves has of it, in the unit it is entered in.
  protected available(line: Line): number {
    const material = this.material(line.rawMaterialId);
    const row = this.stock()?.rows.find((r) => r.rawMaterialId === line.rawMaterialId);
    const held = row?.byLocation[this.from() ?? ''] ?? 0;
    return material ? held / countUnit(material.unit, material.purchaseUnitSize).size : held;
  }

  protected isShort(line: Line): boolean {
    return !!line.rawMaterialId && (line.quantity ?? 0) > 0 && (line.quantity ?? 0) > this.available(line) + 1e-9;
  }

  // At the branch's average cost, as the server will value it.
  protected worth(line: Line): number | null {
    const material = this.material(line.rawMaterialId);
    if (!material || material.costPerUnit === null || !line.quantity) {
      return null;
    }
    return line.quantity * countUnit(material.unit, material.purchaseUnitSize).size * material.costPerUnit;
  }

  // A quantity kept in grams, millilitres or pieces, as the material is counted: 4 kg, 250 ml.
  protected shownQuantity(materialId: string, quantity: number, unit: UnitOfMeasure | string): string {
    const material = this.material(materialId);
    const counted = countUnit((material?.unit ?? unit) as UnitOfMeasure, material?.purchaseUnitSize ?? 1);
    return `${(quantity / counted.size).toLocaleString('en-US', { maximumFractionDigits: 3 })} ${counted.label}`;
  }

  protected change(index: number, patch: Partial<Line>): void {
    this.lines.update((lines) => lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  protected add(): void {
    this.lines.update((lines) => [...lines, blank()]);
  }

  protected remove(index: number): void {
    this.lines.update((lines) => lines.filter((_, i) => i !== index));
  }

  protected swap(): void {
    const from = this.from();
    this.from.set(this.to());
    this.to.set(from);
  }

  protected setDays(from: string, to: string): void {
    if (!from || !to || from > to) {
      return;
    }
    this.fromDay.set(from);
    this.toDay.set(to);
    void this.loadTransfers();
  }

  protected async post(): Promise<void> {
    if (!this.ready()) {
      return;
    }
    this.saving.set(true);
    try {
      const moved = await firstValueFrom(
        this.stockApi.post({
          id: this.transferId,
          fromLocationId: this.from()!,
          toLocationId: this.to()!,
          lines: this.lines().map((l) => {
            const material = this.material(l.rawMaterialId)!;
            return { rawMaterialId: l.rawMaterialId!, quantity: l.quantity! * countUnit(material.unit, material.purchaseUnitSize).size };
          }),
          notes: this.notes().trim() || null,
        }),
      );
      this.notify.info(`${moved.number} posted: stock moved to ${moved.toLocation}.`);
      this.lines.set([blank()]);
      this.notes.set('');
      this.transferId = crypto.randomUUID();
      await Promise.all([this.loadTransfers(), this.loadStock()]);
    } catch (error) {
      this.notify.error(error, 'The stock could not be moved.');
    } finally {
      this.saving.set(false);
    }
  }

  protected async voidTransfer(transfer: InternalTransfer): Promise<void> {
    if (!confirm(`Void ${transfer.number}? Its stock goes back to ${transfer.fromLocation}. · إلغاء التحويل؟`)) {
      return;
    }
    try {
      await firstValueFrom(this.stockApi.void(transfer.id));
      this.notify.info(`${transfer.number} voided.`);
      await Promise.all([this.loadTransfers(), this.loadStock()]);
    } catch (error) {
      this.notify.error(error, 'The transfer could not be voided.');
    }
  }

  protected async downloadSheet(): Promise<void> {
    this.downloading.set(true);
    try {
      saveBlob(await firstValueFrom(this.stockApi.sheet(this.fromDay(), this.toDay())), `internal-transfers-${this.fromDay()}-to-${this.toDay()}.xlsx`);
    } catch (error) {
      this.notify.error(error, 'The workbook could not be made.');
    } finally {
      this.downloading.set(false);
    }
  }

  // A transfer slip (إذن تحويل): what was moved, from where and to where, for the one handing it over
  // and the one receiving it to sign. In its own window, so it prints as a slip and not as the screen.
  protected printSlip(transfer: InternalTransfer): void {
    const slip = window.open('', '_blank');
    if (!slip) {
      this.notify.error(null, 'The browser stopped the slip opening: allow pop-ups for this site, then print again.');
      return;
    }
    const costs = this.seesCosts() && transfer.totalCost !== null;
    const money = (n: number | null) => (n === null ? '' : this.company.money(n));
    const rows = transfer.lines
      .map((l) => {
        const material = this.material(l.rawMaterialId);
        const unit = countUnit((material?.unit ?? l.unit) as UnitOfMeasure, material?.purchaseUnitSize ?? 1);
        return (
          `<tr><td>${escape(l.code ?? '')}</td><td>${escape(l.material)}</td>` +
          `<td class="num">${(l.quantity / unit.size).toLocaleString('en-US', { maximumFractionDigits: 3 })}</td><td>${escape(unit.label)}</td>` +
          (costs ? `<td class="num">${escape(money(l.unitCost === null ? null : l.unitCost * unit.size))}</td><td class="num">${escape(money(l.lineTotal))}</td>` : '') +
          `</tr>`
        );
      })
      .join('');
    const day = new Date(`${transfer.transferDate}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    slip.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escape(transfer.number)} · إذن تحويل</title><style>
      body { font: 12px/1.4 system-ui, sans-serif; margin: 24px; color: #111; }
      h1 { font-size: 18px; margin: 0 0 4px; } p { margin: 0 0 8px; color: #333; }
      .void { color: #b00020; font-weight: 700; }
      .head { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px 24px; margin: 12px 0 16px; }
      table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #999; padding: 6px 8px; text-align: start; }
      th { background: #eee; } td.num, th.num { text-align: end; }
      tfoot td { font-weight: 600; }
      .signatures { display: grid; grid-template-columns: repeat(2, 1fr); gap: 48px; margin-top: 48px; }
      .signatures div { border-top: 1px solid #111; padding-top: 4px; }
      @page { margin: 14mm; }
    </style></head><body>
      <h1>${escape(this.company.name())} — Transfer slip · إذن تحويل داخلي</h1>
      ${transfer.status === 'Voided' ? `<p class="void">VOIDED · ملغي${transfer.voidedBy ? ' — ' + escape(transfer.voidedBy) : ''}</p>` : ''}
      <div class="head">
        <div><strong>Number · الرقم:</strong> ${escape(transfer.number)}</div>
        <div><strong>Day · التاريخ:</strong> ${escape(day)}</div>
        <div><strong>From · من:</strong> ${escape(transfer.fromLocation)}${transfer.fromLocationAr ? ' · ' + escape(transfer.fromLocationAr) : ''}</div>
        <div><strong>To · إلى:</strong> ${escape(transfer.toLocation)}${transfer.toLocationAr ? ' · ' + escape(transfer.toLocationAr) : ''}</div>
        <div><strong>Made by · بواسطة:</strong> ${escape(transfer.createdBy)}</div>
        ${transfer.notes ? `<div><strong>Notes · ملاحظات:</strong> ${escape(transfer.notes)}</div>` : ''}
      </div>
      <table><thead><tr><th>Code · الكود</th><th>Material · الخامة</th><th class="num">Quantity · الكمية</th><th>Unit · الوحدة</th>
        ${costs ? '<th class="num">Unit cost · تكلفة الوحدة</th><th class="num">Total · الإجمالي</th>' : ''}</tr></thead>
        <tbody>${rows}</tbody>
        ${costs ? `<tfoot><tr><td colspan="5">Total · الإجمالي</td><td class="num">${escape(money(transfer.totalCost))}</td></tr></tfoot>` : ''}
      </table>
      <div class="signatures"><div>Handed over by · المسلِّم</div><div>Received by · المستلِم</div></div>
    </body></html>`);
    slip.document.close();
    slip.focus();
    slip.print();
  }

  private placeFilters(of: (t: InternalTransfer) => string): FilterOption[] {
    const all = this.transfers();
    return [
      { value: '', label: 'All · الكل', count: all.length },
      ...this.places.locations().map((l) => ({ value: l.id, label: l.nameAr ? `${l.name} · ${l.nameAr}` : l.name, count: all.filter((t) => of(t) === l.id).length })),
    ];
  }

  private material(id: string | null): MaterialCost | undefined {
    return this.materials().find((m) => m.id === id);
  }

  private async load(): Promise<void> {
    this.error.set(null);
    try {
      await this.places.load(true);
      if (!this.places.shown()) {
        return;
      }
      const main = this.places.mainStore();
      this.from.set(main?.id ?? null);
      this.to.set(this.places.locations().find((l) => l.id !== main?.id)?.id ?? null);
      const [materials] = await Promise.all([firstValueFrom(this.api.materials()), this.loadTransfers(), this.loadStock()]);
      this.materials.set(materials);
    } catch (error) {
      this.error.set(errorMessage(error, 'The transfers could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }

  private async loadTransfers(): Promise<void> {
    try {
      this.transfers.set(await firstValueFrom(this.stockApi.transfers(this.fromDay(), this.toDay())));
    } catch (error) {
      this.notify.error(error, 'The transfers could not be loaded.');
    }
  }

  private async loadStock(): Promise<void> {
    try {
      this.stock.set(await firstValueFrom(this.stockApi.locationStock()));
    } catch {
      this.stock.set(null);
    }
  }
}

function blank(): Line {
  return { rawMaterialId: null, quantity: null };
}

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
