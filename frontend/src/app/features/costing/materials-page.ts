import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import { CostingApi, ApprovalRequest, MaterialCost, UnitOfMeasure, unitLabels } from '../../core/costing/costing.api';
import { errorMessage } from '../../core/http/error-message';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { NotifyService } from '../../core/ui/notify.service';
import { Approvals, pendingLabel } from './approvals';
import { saveBlob } from '../../core/ui/save-blob';
import { MaterialDialog, MaterialDialogResult } from './material-dialog';
import { MaterialHistoryDialog } from './material-history-dialog';
import { SheetImportData, SheetImportDialog } from './sheet-import-dialog';
import { todayIso } from './financials';
import { FilterOption, FilterSelect } from '../shared/filter-select';
import { SearchField } from '../shared/search-field';
import { SortOption, SortState, smartMatch, sortItems } from '../shared/smart-search';
import { SortControl } from '../shared/sort-control';

type MaterialSort = 'name' | 'category' | 'cost' | 'stock' | 'value' | 'reorder';

const materialSorts: SortOption<MaterialSort>[] = [
  { key: 'name', en: 'Name', ar: 'الاسم' },
  { key: 'category', en: 'Category', ar: 'القسم' },
  { key: 'cost', en: 'Cost per unit', ar: 'تكلفة الوحدة', descending: true },
  { key: 'stock', en: 'Stock on hand', ar: 'الرصيد', descending: true },
  { key: 'value', en: 'Stock value', ar: 'قيمة المخزون', descending: true },
  { key: 'reorder', en: 'Reorder status', ar: 'حالة إعادة الطلب' },
];

const unitGroups: Record<UnitOfMeasure, string> = { Gram: 'Weight · وزن', Millilitre: 'Volume · حجم', Piece: 'Pieces · قطع' };

// Raw materials and what they cost: AP$ per purchase unit (the weighted average of what was paid),
// the default yield, and EP$ after it. Stock on hand and its value too. To and from Excel: the list
// exported, and a sheet imported (the template filled in, or an export edited or brought from
// another installation), each row a material added or changed. Shown one stock category at a time
// when the list is long.
@Component({
  selector: 'app-materials-page',
  imports: [
    DatePipe,
    DecimalPipe,
    FilterSelect,
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
    MatTooltipModule,
    MoneyPipe,
    SearchField,
    SortControl,
  ],
  template: `
    <div class="toolbar smart">
      <app-search-field [(value)]="search" />
      <div class="pills">
        <app-filter-select label="Category · القسم" icon="category" [options]="categoryFilters()" [(value)]="category" />
        <app-filter-select label="Unit · الوحدة" icon="straighten" [options]="unitFilters()" [(value)]="unitFilter" />
        <app-sort-control [options]="sorts" [(sort)]="sort" />
      </div>
    </div>
    <div class="toolbar">
      <span class="muted shown-count">Showing {{ shown().length }} of {{ materials().length }}<span class="inline-ar">المعروض</span></span>
      <span class="spacer"></span>
      <span class="muted">Stock value · قيمة المخزون: <strong>{{ stockValue() | money }}</strong></span>
      <button mat-stroked-button (click)="exportExcel()" [disabled]="busy()">
        <mat-icon>download</mat-icon> Export Excel<span class="inline-ar">تصدير إلى إكسل</span>
      </button>
      <button mat-stroked-button (click)="importExcel()" [disabled]="busy()">
        <mat-icon>upload_file</mat-icon> Import Excel<span class="inline-ar">استيراد من إكسل</span>
      </button>
      <button mat-flat-button (click)="edit(null)"><mat-icon>add</mat-icon> New material</button>
    </div>
    @if (busy()) {
      <mat-progress-bar mode="indeterminate" />
    }
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    } @else if (error()) {
      <p class="error">{{ error() }}</p>
    } @else if (materials().length === 0) {
      <p class="note">No raw materials yet. Add each ingredient you buy, with its price, then give the dishes their recipes.</p>
    } @else {
      <div class="table-wrap">
        <table class="grid">
          <thead>
            <tr>
              <th>Code<span class="ar">الكود</span></th>
              <th>Material<span class="ar">الخامة</span></th>
              <th>Category<span class="ar">الفئة</span></th>
              <th>Bought by<span class="ar">وحدة الشراء</span></th>
              <th class="num">AP$ / unit<span class="ar">تكلفة الشراء</span></th>
              <th class="num">Yield %<span class="ar">نسبة الصافي</span></th>
              <th class="num">EP$ / unit<span class="ar">تكلفة الصافي</span></th>
              <th class="num">On hand<span class="ar">الرصيد</span></th>
              <th class="num">Stock value<span class="ar">قيمة المخزون</span></th>
              <th class="num">Last price paid<span class="ar">آخر سعر</span></th>
              <th class="num"><span class="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (m of shown(); track m.id) {
              <tr class="clickable" [class.pending-deletion]="!!pendingOf(m)" (click)="edit(m)">
                <td class="code">{{ m.code ?? '' }}</td>
                <td>
                  {{ m.name }}
                  @if (m.kind === 'Prep') {
                    <span class="badge" title="Made in the kitchen: its cost comes from its batches">Prep · نصف مصنع</span>
                  }
                  @if (pendingOf(m); as p) {
                    <div><span class="pending-badge">{{ pendingLabel(p).en }}<span class="ar">{{ pendingLabel(p).ar }}</span></span>
                      <span class="muted small"> by {{ p.requestedBy }}, {{ p.requestedAtUtc | date: 'd MMM' }}</span></div>
                  }
                </td>
                <td>
                  {{ m.category ?? '' }}
                  @if (m.misplaced) {
                    <div class="misplaced" title="Filed in a general expenses category before the kinds were kept apart">In an expenses category: move it</div>
                  }
                </td>
                <td>{{ m.purchaseUnit }} <span class="muted">({{ m.purchaseUnitSize | number: '1.0-3' }} {{ unit(m) }})</span></td>
                <td class="num">
                  @if (m.costPerPurchaseUnit !== null) {
                    {{ m.costPerPurchaseUnit | money }}
                  } @else {
                    <span class="error">No price</span>
                  }
                </td>
                <td class="num">{{ m.defaultYieldPercent | number: '1.0-2' }}%</td>
                <td class="num">{{ m.costPerPurchaseUnit === null ? '' : (ep(m) | money) }}</td>
                <td class="num" [class.error]="m.quantityOnHand < 0">
                  {{ m.quantityOnHand / m.purchaseUnitSize | number: '1.0-3' }} {{ m.purchaseUnit }}
                </td>
                <td class="num">{{ m.stockValue === null ? '' : (m.stockValue | money) }}</td>
                <td class="num">{{ m.lastPurchaseCostPerPurchaseUnit === null ? '' : (m.lastPurchaseCostPerPurchaseUnit | money) }}</td>
                <td class="num actions" (click)="$event.stopPropagation()">
                  @if (m.kind !== 'Prep') {
                    <button mat-icon-button (click)="history(m)" matTooltip="Purchase history · كارت الصنف" [attr.aria-label]="'Purchase history of ' + m.name">
                      <mat-icon>history</mat-icon>
                    </button>
                  }
                  @if (pendingOf(m)) {
                    <mat-icon class="locked" matTooltip="Waiting for a manager's approval: locked until decided" aria-label="Locked: waiting for a manager">lock_clock</mat-icon>
                  } @else {
                    <button mat-icon-button class="danger" (click)="remove(m)" matTooltip="Delete" [attr.aria-label]="'Delete ' + m.name">
                      <mat-icon>delete</mat-icon>
                    </button>
                  }
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
    .danger {
      color: var(--mat-sys-error);
    }
    .small {
      font-size: 0.85em;
    }
    .actions {
      white-space: nowrap;
    }
    .misplaced {
      font-size: 0.85em;
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
export class MaterialsPage {
  protected readonly pendingLabel = pendingLabel;
  private readonly api = inject(CostingApi);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotifyService);
  private readonly approvals = inject(Approvals);

  protected readonly materials = signal<MaterialCost[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly search = signal('');
  protected readonly busy = signal(false);

  // The stock categories the materials are in, by name, with how many each holds; the one shown
  // ('': all). The units they are counted in, the same way.
  protected readonly category = signal('');
  protected readonly unitFilter = signal('');
  protected readonly sorts = materialSorts;
  protected readonly sort = signal<SortState<MaterialSort>>({ key: 'name', direction: 1 });
  protected readonly categories = computed(() => {
    const byId = new Map<string, { id: string; name: string; count: number }>();
    for (const m of this.materials()) {
      const entry = byId.get(m.categoryId) ?? { id: m.categoryId, name: m.category ?? 'General', count: 0 };
      entry.count++;
      byId.set(m.categoryId, entry);
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  });

  protected readonly categoryFilters = computed<FilterOption[]>(() => [
    { value: '', label: 'All · الكل', count: this.materials().length },
    ...this.categories().map((c) => ({ value: c.id, label: c.name, count: c.count })),
  ]);

  protected readonly unitFilters = computed<FilterOption[]>(() => [
    { value: '', label: 'All · الكل', count: this.materials().length },
    ...(Object.keys(unitGroups) as UnitOfMeasure[])
      .map((u) => ({ value: u, label: unitGroups[u], count: this.materials().filter((m) => m.unit === u).length }))
      .filter((o) => o.count > 0),
  ]);

  protected readonly shown = computed(() => {
    const category = this.category();
    const unit = this.unitFilter();
    const found = this.materials().filter(
      (m) =>
        (!category || m.categoryId === category) &&
        (!unit || m.unit === unit) &&
        smartMatch(this.search(), m.name, m.code, m.category),
    );
    return sortItems(found, this.sort(), (m, key) => {
      switch (key) {
        case 'category':
          return m.category ?? 'General';
        case 'cost':
          return m.costPerPurchaseUnit;
        case 'stock':
          return m.quantityOnHand;
        case 'value':
          return m.stockValue;
        // Those to order first: at or under their reorder level.
        case 'reorder':
          return m.quantityOnHand <= m.reorderLevel ? 0 : 1;
        default:
          return m.name;
      }
    }, (m) => m.name);
  });

  protected readonly stockValue = computed(() => this.materials().reduce((sum, m) => sum + (m.stockValue ?? 0), 0));

  constructor() {
    void this.load();
  }

  protected unit(m: MaterialCost): string {
    return unitLabels[m.unit];
  }

  // EP$: what a usable purchase unit costs once trimming is lost.
  protected ep(m: MaterialCost): number {
    return ((m.costPerPurchaseUnit ?? 0) * 100) / m.defaultYieldPercent;
  }

  protected pendingOf(material: MaterialCost): ApprovalRequest | undefined {
    return this.approvals.pendingFor(material.id);
  }

  // Every invoice line that bought it, to hold against the paper invoices.
  protected history(material: MaterialCost): void {
    this.dialog.open<MaterialHistoryDialog, MaterialCost>(MaterialHistoryDialog, { data: material, width: '960px', maxWidth: '95vw' });
  }

  // Archived for a manager; asked of one for anyone else. Only one in no recipe and with nothing
  // on the shelf can go: the till says why otherwise.
  protected async remove(material: MaterialCost): Promise<void> {
    if ((await this.approvals.delete('RawMaterial', material.id, material.name)) === 'Applied') {
      await this.load();
    }
  }

  // Saved, then its unit changed when it was: at once, or asked of a manager. Its other changes
  // stay saved when the unit cannot be.
  protected async edit(material: MaterialCost | null): Promise<void> {
    // Locked while a request about it waits for a manager.
    const pending = material && this.pendingOf(material);
    if (pending) {
      this.notify.info(`${material.name}: ${pendingLabel(pending).en.toLowerCase()}, waiting for a manager. It can be changed once that is decided.`);
      return;
    }
    const saved = await firstValueFrom(
      this.dialog
        .open<MaterialDialog, MaterialCost | null, MaterialDialogResult>(MaterialDialog, { data: material, width: '640px', maxWidth: '95vw' })
        .afterClosed(),
    );
    if (!saved) {
      return;
    }
    const { material: details, unitChange } = saved;
    try {
      await firstValueFrom(this.api.saveMaterial(material?.id ?? null, details));
    } catch (error) {
      this.notify.error(error, 'The material could not be saved.');
      return;
    }
    if (material && unitChange) {
      try {
        const result = await firstValueFrom(this.api.changeMaterialUnit(material.id, unitChange));
        if (result.outcome === 'Requested' && result.request) {
          await this.approvals.requested({ outcome: result.outcome, request: result.request });
        } else {
          this.notify.info(`${details.name} saved, counted in ${{ Gram: 'grams', Millilitre: 'millilitres', Piece: 'pieces' }[unitChange.unit]} now.`);
        }
      } catch (error) {
        this.notify.error(null, `${details.name} was saved, but its unit was not changed: ${errorMessage(error, 'please try again.')}`);
      }
    } else {
      this.notify.info(`${details.name} saved.`);
    }
    await this.load();
  }

  // The list as it is, under the template's columns: edited and imported back, or imported into
  // another installation.
  protected async exportExcel(): Promise<void> {
    this.busy.set(true);
    try {
      saveBlob(await firstValueFrom(this.api.exportRawMaterials()), `raw-materials-${todayIso()}.xlsx`);
      this.notify.info('Raw materials exported to Excel. · تم تصدير الخامات إلى إكسل.');
    } catch (error) {
      this.notify.error(error, 'The raw materials could not be exported. · تعذّر تصدير الخامات.');
    } finally {
      this.busy.set(false);
    }
  }

  // A sheet imported in the dialog, which says what it did; the list read again when it changed it.
  protected async importExcel(): Promise<void> {
    const data: SheetImportData = {
      title: { en: 'Import raw materials from Excel', ar: 'استيراد الخامات من إكسل' },
      noun: { one: 'material', many: 'materials', ar: 'الخامة' },
      rules: [
        {
          en: 'A row is the material of its code, else of its name: it is changed as the row says. A new name adds a material.',
          ar: 'الصف يخص الخامة صاحبة الكود، وإلا صاحبة الاسم، فتُعدّل كما في الصف. والاسم الجديد يضيف خامة.',
        },
        { en: 'A blank cell leaves that detail as it is. A unit is Kg, Liter or Piece.', ar: 'الخلية الفارغة تترك البيان كما هو. الوحدة: كيلو أو لتر أو قطعة.' },
        { en: 'Stock on hand is not imported: it comes by purchases and stock counts.', ar: 'الرصيد لا يُستورد: يأتي من المشتريات والجرد.' },
      ],
      templateName: 'raw-materials-template.xlsx',
      template: () => this.api.rawMaterialsTemplate(),
      upload: (file) => this.api.importRawMaterials(file),
    };
    const changed = await firstValueFrom(
      this.dialog.open<SheetImportDialog, SheetImportData, boolean>(SheetImportDialog, { data, width: '760px', maxWidth: '96vw' }).afterClosed(),
    );
    if (changed) {
      await this.load();
    }
  }

  private async load(): Promise<void> {
    this.error.set(null);
    void this.approvals.refresh();
    try {
      this.materials.set(await firstValueFrom(this.api.materials()));
    } catch (error) {
      this.error.set(errorMessage(error, 'The raw materials could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }
}
