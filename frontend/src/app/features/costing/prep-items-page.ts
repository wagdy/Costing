import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { CostingApi, PrepImportResult, PrepItem, RecipeCategory } from '../../core/costing/costing.api';
import { errorMessage } from '../../core/http/error-message';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { NotifyService } from '../../core/ui/notify.service';
import { Approvals, pendingLabel } from './approvals';
import { saveBlob } from '../../core/ui/save-blob';
import { todayIso } from './financials';
import { InfoTip } from './info-tip';
import { showStockCard } from './stock-card-dialog';
import { PrepImportDialog } from './prep-import-dialog';
import { recipeSheetRules } from './recipe-sheet-rules';
import { SheetImportData, SheetImportDialog } from './sheet-import-dialog';
import { FilterOption, FilterSelect } from '../shared/filter-select';
import { SearchField } from '../shared/search-field';
import { SortOption, SortState, smartMatch, sortItems } from '../shared/smart-search';
import { SortControl } from '../shared/sort-control';

type PrepSort = 'name' | 'category' | 'batchCost' | 'unitCost' | 'stock' | 'made';

const prepSorts: SortOption<PrepSort>[] = [
  { key: 'name', en: 'Name', ar: 'الاسم' },
  { key: 'category', en: 'Category', ar: 'القسم' },
  { key: 'batchCost', en: 'Cost per batch', ar: 'تكلفة الدفعة', descending: true },
  { key: 'unitCost', en: 'Cost per unit', ar: 'تكلفة الوحدة', descending: true },
  { key: 'stock', en: 'Stock on hand', ar: 'الرصيد', descending: true },
  { key: 'made', en: 'Last made', ar: 'آخر تشغيلة', descending: true },
];

// The prep items: made in the kitchen from their own recipes, kept in stock, used by dishes.
// Each with what it costs by its recipe at today's prices, what the batches on the shelf cost,
// and how much is on the shelf. A row opens its profile. New ones asked for by an accountant are
// listed first, waiting for a manager: they are not prep items until approved. To and from Excel:
// every prep item a row per ingredient, the ingredient chosen from a dropdown that says its unit;
// a sheet imported replaces the batch recipes it names. New ones from the kitchen's own sheet of
// batch recipes (المصنعات) too: each prep item's name on a row of its own, then its ingredients.
// Sorted under the kitchen's recipe categories, as the dishes are, and shown one category at a time.
@Component({
  selector: 'app-prep-items-page',
  imports: [
    InfoTip,
    FilterSelect,
    SearchField,
    SortControl,
    DatePipe,
    DecimalPipe,
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
    MatTooltipModule,
    MoneyPipe,
    RouterLink,
  ],
  template: `
    <p class="note">
      Made here from other materials (dough, house sauces) and kept in stock like them. A dish's recipe uses the prep item, so a sale
      takes dough, not flour; a production order turns the flour into dough.
      <span class="inline-ar">تُصنع في المطبخ وتُخزن، وتستهلكها الأطباق.</span>
    </p>
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    } @else if (error()) {
      <p class="error">{{ error() }}</p>
    } @else {
      <div class="toolbar smart">
        <app-search-field [(value)]="search" />
        <div class="pills">
          <app-filter-select label="Category · القسم" icon="category" [options]="categoryFilters()" [(value)]="category" />
          <app-sort-control [options]="sorts" [(sort)]="sort" />
        </div>
      </div>
      <div class="toolbar">
        <span class="muted shown-count">Showing {{ shown().length }} of {{ items().length }}<span class="inline-ar">المعروض</span></span>
        <span class="spacer"></span>
        <a mat-button routerLink="../production"><mat-icon>precision_manufacturing</mat-icon> Make a batch</a>
        <button mat-stroked-button (click)="exportExcel()" [disabled]="busy()">
          <mat-icon>download</mat-icon> Export Excel <span class="inline-ar">تصدير إلى إكسل</span>
        </button>
        <button mat-stroked-button (click)="importExcel()" [disabled]="busy()">
          <mat-icon>upload_file</mat-icon> Import Excel <span class="inline-ar">استيراد من إكسل</span>
        </button>
        <button mat-button class="batch-sheet" (click)="picker.click()" [disabled]="busy()"
          matTooltip="New prep items from a sheet of batch recipes: each name on a row of its own, then its ingredients">
          <mat-icon>post_add</mat-icon> Batch recipes sheet<span class="inline-ar">ملف المصنعات</span>
        </button>
        <input #picker type="file" hidden accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          (change)="importFile(picker)" aria-label="Excel sheet of batch recipes to import" />
        <a mat-flat-button routerLink="new"><mat-icon>add</mat-icon> Add prep item</a>
      </div>
      @if (busy()) {
        <mat-progress-bar mode="indeterminate" />
      }
      <div class="table-wrap">
        <table class="grid">
          <thead>
            <tr>
              <th>Prep item<span class="ar">الصنف</span></th>
              <th class="num">One batch<span class="ar">الدفعة</span></th>
              <th class="num">By its recipe <app-info-tip tip="prepStandard" /><span class="ar">التكلفة المعيارية</span></th>
              <th class="num">In stock at <app-info-tip tip="prepAverage" /><span class="ar">متوسط التكلفة</span></th>
              <th class="num">On hand<span class="ar">الرصيد</span></th>
              <th class="num">Stock value <app-info-tip tip="stockValue" /><span class="ar">قيمة المخزون</span></th>
              <th>Last made<span class="ar">آخر تصنيع</span></th>
              <th class="num"><span class="visually-hidden">Stock card</span></th>
            </tr>
          </thead>
          <tbody>
            @for (r of waiting(); track r.id) {
              <tr class="pending-deletion">
                <td colspan="8">
                  {{ r.summary }}
                  <div>
                    <span class="pending-badge">{{ pendingLabel(r).en }}<span class="ar">{{ pendingLabel(r).ar }}</span></span>
                    <span class="muted small"> asked by {{ r.requestedBy }}, {{ r.requestedAtUtc | date: 'd MMM, HH:mm' }}</span>
                  </div>
                </td>
              </tr>
            }
            @for (p of shown(); track p.id) {
              @let asked = approvals.pendingFor(p.id);
              <tr class="clickable" [class.pending-deletion]="!!asked" (click)="open(p)">
                <td>
                  @if (p.code) {
                    <span class="muted">{{ p.code }} · </span>
                  }
                  {{ p.name }}
                  @if (categoryName(p); as c) {
                    <div class="muted small">{{ c }}</div>
                  }
                  @if (asked) {
                    <div>
                      <span class="pending-badge">{{ pendingLabel(asked).en }}<span class="ar">{{ pendingLabel(asked).ar }}</span></span>
                      <span class="muted small"> by {{ asked.requestedBy }}</span>
                    </div>
                  }
                  @if (p.ingredients.length === 0) {
                    <div class="warn small">No recipe yet</div>
                  } @else if (p.missingPrices.length) {
                    <div class="warn small">No cost yet: {{ p.missingPrices.join(', ') }}</div>
                  }
                </td>
                <td class="num">{{ p.batchQuantity / p.displayUnitSize | number: '1.0-3' }} {{ p.displayUnit }}</td>
                <td class="num">{{ p.standardCostPerDisplayUnit === null ? '—' : (p.standardCostPerDisplayUnit | money) + ' / ' + p.displayUnit }}</td>
                <td class="num">{{ p.averageCostPerDisplayUnit === null ? '—' : (p.averageCostPerDisplayUnit | money) + ' / ' + p.displayUnit }}</td>
                <td class="num" [class.warn]="p.quantityOnHand < 0">{{ p.quantityOnHand / p.displayUnitSize | number: '1.0-3' }} {{ p.displayUnit }}</td>
                <td class="num">{{ p.stockValue === null ? '—' : (p.stockValue | money) }}</td>
                <td class="nowrap">{{ p.lastProducedAtUtc ? (p.lastProducedAtUtc | date: 'd MMM, HH:mm') : 'Never' }}</td>
                <td class="num" (click)="$event.stopPropagation()">
                  <button mat-icon-button (click)="stockCard(p)" matTooltip="Stock card · كارتة الصنف" [attr.aria-label]="'Stock card of ' + p.name">
                    <mat-icon>receipt_long</mat-icon>
                  </button>
                </td>
              </tr>
            } @empty {
              @if (!waiting().length) {
                <tr>
                  <td colspan="8" class="muted">
                    {{ items().length ? 'No prep item matches.' : 'No prep items yet. Add one, such as pizza dough, with its recipe for a batch.' }}
                  </td>
                </tr>
              }
            }
          </tbody>
        </table>
      </div>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .small {
      font-size: 0.85em;
    }
    .warn {
      color: var(--mat-sys-error);
    }
    .nowrap {
      white-space: nowrap;
    }
  `,
})
export class PrepItemsPage {
  private readonly api = inject(CostingApi);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotifyService);
  protected readonly approvals = inject(Approvals);
  protected readonly pendingLabel = pendingLabel;

  protected readonly items = signal<PrepItem[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly search = signal('');
  protected readonly busy = signal(false);

  // The kitchen's recipe categories; the one shown ('': all), or none for the unsorted ones.
  protected readonly categories = signal<RecipeCategory[]>([]);
  protected readonly category = signal('');
  protected readonly uncategorized = 'none';
  protected readonly sorts = prepSorts;
  protected readonly sort = signal<SortState<PrepSort>>({ key: 'name', direction: 1 });

  protected readonly categoryFilters = computed<FilterOption[]>(() => [
    { value: '', label: 'All · الكل', count: this.items().length },
    ...this.categories().map((c) => ({
      value: c.id, label: c.nameAr ? `${c.name} · ${c.nameAr}` : c.name, count: this.items().filter((p) => p.recipeCategoryId === c.id).length,
    })),
    { value: this.uncategorized, label: 'Uncategorized · بدون قسم', count: this.items().filter((p) => !p.recipeCategoryId).length },
  ]);

  // From the query: a category to show, from the recipe categories' counts.
  readonly categoryParam = input<string | undefined>(undefined, { alias: 'category' });

  protected readonly shown = computed(() => {
    const category = this.category();
    const found = this.items().filter(
      (p) =>
        smartMatch(this.search(), p.name, p.code, this.categoryName(p)) &&
        (!category || (category === this.uncategorized ? !p.recipeCategoryId : p.recipeCategoryId === category)),
    );
    return sortItems(found, this.sort(), (p, key) => {
      switch (key) {
        case 'category':
          return this.categoryName(p);
        case 'batchCost':
          return p.standardBatchCost;
        case 'unitCost':
          return p.averageCostPerDisplayUnit ?? p.standardCostPerDisplayUnit;
        case 'stock':
          return p.quantityOnHand;
        case 'made':
          return p.lastProducedAtUtc;
        default:
          return p.name;
      }
    }, (p) => p.name);
  });

  private readonly categoryNames = computed(() => new Map(this.categories().map((c) => [c.id, c.name] as const)));

  // New prep items asked for, waiting for a manager: not made yet, so not openable.
  protected readonly waiting = computed(() => this.approvals.waitingToBeMade('PrepItem'));

  constructor() {
    effect(() => {
      const category = this.categoryParam();
      untracked(() => this.category.set(category ?? ''));
    });
    void this.load();
    void this.approvals.refresh();
  }

  protected categoryName(item: PrepItem): string | null {
    return item.recipeCategoryId ? (this.categoryNames().get(item.recipeCategoryId) ?? null) : null;
  }

  // Its batches in, what the dishes took out, the counts, with the balance and average after each.
  protected stockCard(item: PrepItem): void {
    showStockCard(this.dialog, item);
  }

  protected open(item: PrepItem): void {
    void this.router.navigate(['/costing/recipes/prep', item.id]);
  }

  protected async exportExcel(): Promise<void> {
    this.busy.set(true);
    try {
      saveBlob(await firstValueFrom(this.api.exportPrepItems()), `prep-items-${todayIso()}.xlsx`);
      this.notify.info('Prep items exported to Excel. · تم تصدير الأصناف المُصنَّعة إلى إكسل.');
    } catch (error) {
      this.notify.error(error, 'The prep items could not be exported. · تعذّر تصدير الأصناف المُصنَّعة.');
    } finally {
      this.busy.set(false);
    }
  }

  // The smart sheet imported in the dialog, which says what it did and what a batch of each costs
  // now; the list read again when it changed it.
  protected async importExcel(): Promise<void> {
    const data: SheetImportData = {
      title: { en: 'Import prep items from Excel', ar: 'استيراد الأصناف المُصنَّعة من إكسل' },
      noun: { one: 'prep item', many: 'prep items', ar: 'الصنف المُصنَّع' },
      rules: [
        {
          en: 'One ingredient a row: the prep item, the ingredient from the list, and its quantity for one batch; what a batch makes on any of its rows.',
          ar: 'مكوّن في كل صف: الصنف المُصنَّع، والمكوّن من القائمة، وكميته في التشغيلة؛ وكمية التشغيلة في أي من صفوفه.',
        },
        ...recipeSheetRules,
        {
          en: 'Imported by anyone but a manager, each goes to a manager for approval.',
          ar: 'استيراد غير المدير يذهب إلى المدير للموافقة على كل صنف.',
        },
      ],
      templateName: 'prep-items-template.xlsx',
      template: () => this.api.prepItemsTemplate(),
      upload: (file) => this.api.importPrepItemsSheet(file),
    };
    const changed = await firstValueFrom(
      this.dialog.open<SheetImportDialog, SheetImportData, boolean>(SheetImportDialog, { data, width: '860px', maxWidth: '96vw' }).afterClosed(),
    );
    if (changed) {
      await this.load();
    } else {
      // Asked of a manager: the requests are listed first.
      void this.approvals.refresh();
    }
  }

  // The sheet chosen: imported, what it did shown, and the list read again. The picker is cleared,
  // so the same file can be chosen again once it is put right.
  protected async importFile(picker: HTMLInputElement): Promise<void> {
    const file = picker.files?.[0];
    picker.value = '';
    if (!file) {
      return;
    }
    this.busy.set(true);
    try {
      const result = await firstValueFrom(this.api.importPrepItems(file));
      this.dialog.open<PrepImportDialog, PrepImportResult>(PrepImportDialog, { data: result, width: '820px', maxWidth: '95vw' });
      await Promise.all([this.load(), this.approvals.refresh()]);
    } catch (error) {
      this.notify.error(error, 'The file could not be imported.');
    } finally {
      this.busy.set(false);
    }
  }

  private async load(): Promise<void> {
    try {
      const [items, categories] = await Promise.all([firstValueFrom(this.api.prepItems()), firstValueFrom(this.api.recipeCategories())]);
      this.items.set(items);
      this.categories.set(categories);
    } catch (error) {
      this.error.set(errorMessage(error, 'The prep items could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }
}
