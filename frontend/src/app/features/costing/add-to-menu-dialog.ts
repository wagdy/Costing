import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';
import { RecipeCostCard } from '../../core/costing/costing.api';
import { MenuItem, MenuSalesApi, RecipesToMenuResult } from '../../core/costing/menu-sales.api';
import { errorMessage } from '../../core/http/error-message';
import { Company } from '../../core/settings/company';
import { MoneyPipe } from '../../core/ui/money.pipe';

export interface AddToMenuData {
  // The recipes off the menu to offer; all ticked to begin with.
  recipes: RecipeCostCard[];
}

interface Row {
  id: string;
  name: string;
  costPerPortion: number;
  chosen: boolean;
  category: string;
  price: number | null;
  // A menu item of its name already there: linked to it, as it is.
  existing: MenuItem | null;
}

const key = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

// Recipes put on the menu (إضافة للمنيو): each a menu item of its name, at the price and in the menu
// category given here, linked to it, so that selling it on Sales takes its stock by the recipe and
// counts in the reports. Its planned price and its kitchen category to start from; one of a name
// on the menu already is linked to that item as it is. Then what was done: each recipe's item by
// its code, and any that could not go on, and why.
@Component({
  selector: 'app-add-to-menu-dialog',
  imports: [FormsModule, MatButtonModule, MatCheckboxModule, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressBarModule, MoneyPipe],
  template: `
    <h2 mat-dialog-title>Add to the menu <span class="inline-ar">إضافة للمنيو</span></h2>
    <mat-dialog-content>
      @if (result(); as r) {
        <div class="counts">
          <span class="count added"><strong>{{ r.linked.length }}</strong> on the menu <span class="ar">أُضيفت للمنيو</span></span>
          <span class="count" [class.bad]="r.skipped.length"><strong>{{ r.skipped.length }}</strong> not added <span class="ar">لم تُضف</span></span>
        </div>
        @if (r.linked.length) {
          <p class="note">
            Now on Sales: choose them on a new sale, or import them by name or code. Each sold takes its stock by its recipe.
            <span class="note-ar" lang="ar" dir="rtl">متاحة الآن في المبيعات: اخترها في فاتورة جديدة أو استوردها بالاسم أو الكود، وكل بيع يخصم المخزون بالوصفة.</span>
          </p>
          @if (r.categoriesAdded.length) {
            <p class="muted">New menu categories · أقسام جديدة في المنيو: {{ r.categoriesAdded.join(', ') }}</p>
          }
          <div class="table-wrap">
            <table class="grid linked">
              <thead>
                <tr>
                  <th>Code<span class="ar">الكود</span></th>
                  <th>Item<span class="ar">الصنف</span></th>
                  <th>Category<span class="ar">القسم</span></th>
                  <th class="num">Price<span class="ar">السعر</span></th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (l of r.linked; track l.recipeId) {
                  <tr>
                    <td class="code">{{ l.menuItemId }}</td>
                    <td>{{ l.recipe }}</td>
                    <td>{{ l.category }}</td>
                    <td class="num">{{ l.price | money }}</td>
                    <td class="muted small">{{ l.created ? 'New item · صنف جديد' : 'Linked to the item there · رُبطت بالصنف الموجود' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
        @if (r.skipped.length) {
          <h3>Not added <span class="inline-ar">لم تُضف</span></h3>
          <ul class="skipped">
            @for (s of r.skipped; track s.recipeId) {
              <li>
                <strong>{{ s.recipe ?? '—' }}</strong>: {{ s.reason }}
                <div class="reason-ar" lang="ar" dir="rtl">{{ s.reasonAr }}</div>
              </li>
            }
          </ul>
        }
      } @else {
        <p class="note">
          Each recipe becomes a menu item of its name, linked to it: sold on Sales from then on, it takes its stock by the recipe. A name on
          the menu already is linked to that item as it is.
          <span class="note-ar" lang="ar" dir="rtl">كل وصفة تصبح صنفًا في المنيو باسمها ومرتبطًا بها، فيخصم بيعها المخزون بالوصفة. والاسم الموجود في المنيو يُربط بصنفه كما هو.</span>
        </p>
        @if (loading()) {
          <mat-progress-bar mode="indeterminate" />
        } @else {
          @if (rows().length > 1) {
            <div class="toolbar">
              <mat-form-field subscriptSizing="dynamic">
                <mat-icon matPrefix>search</mat-icon>
                <mat-label>Find · بحث</mat-label>
                <input matInput [ngModel]="query()" (ngModelChange)="query.set($event)" />
              </mat-form-field>
              <mat-form-field subscriptSizing="dynamic" class="fill">
                <mat-label>Category for the rest · قسم للباقي</mat-label>
                <input matInput [(ngModel)]="allCategory" list="menu-categories" aria-label="Category for those with none" />
              </mat-form-field>
              <button mat-stroked-button type="button" (click)="fillCategory()" [disabled]="!allCategory.trim()">Apply <span class="inline-ar">تطبيق</span></button>
            </div>
          }
          <datalist id="menu-categories">
            @for (c of categories(); track c) {
              <option [value]="c"></option>
            }
          </datalist>
          <div class="table-wrap">
            <table class="grid rows">
              <thead>
                <tr>
                  <th>
                    <mat-checkbox [checked]="allChosen()" [indeterminate]="someChosen()" (change)="chooseAll($event.checked)" aria-label="Choose all"></mat-checkbox>
                  </th>
                  <th>Recipe<span class="ar">الوصفة</span></th>
                  <th class="num">Cost a portion<span class="ar">تكلفة الحصة</span></th>
                  <th>Menu category<span class="ar">القسم في المنيو</span></th>
                  <th class="num">Selling price<span class="ar">سعر البيع</span></th>
                  <th class="num">Food cost<span class="ar">نسبة التكلفة</span></th>
                </tr>
              </thead>
              <tbody>
                @for (r of shown(); track r.id) {
                  <tr [class.off]="!r.chosen">
                    <td><mat-checkbox [(ngModel)]="r.chosen" (ngModelChange)="touch()" [aria-label]="'Add ' + r.name"></mat-checkbox></td>
                    <td><strong>{{ r.name }}</strong></td>
                    <td class="num">{{ r.costPerPortion | money }}</td>
                    @if (r.existing; as item) {
                      <td colspan="3" class="muted small">
                        On the menu as {{ item.id }} at {{ item.price | money }}: linked to it.
                        <div lang="ar" dir="rtl">موجود في المنيو بكود {{ item.id }}: يُربط به.</div>
                      </td>
                    } @else {
                      <td>
                        <input class="cell" [(ngModel)]="r.category" (ngModelChange)="touch()" list="menu-categories" [class.missing]="r.chosen && !r.category.trim()"
                          [attr.aria-label]="r.name + ', menu category'" placeholder="Category · القسم" />
                      </td>
                      <td class="num">
                        <input class="cell price" type="number" min="0" step="any" [(ngModel)]="r.price" (ngModelChange)="touch()"
                          [class.missing]="r.chosen && !((r.price ?? 0) > 0)" [attr.aria-label]="r.name + ', selling price'" />
                        <span class="muted small">&nbsp;{{ company.currency() }}</span>
                      </td>
                      <td class="num">{{ foodCost(r) === null ? '—' : foodCost(r) + '%' }}</td>
                    }
                  </tr>
                } @empty {
                  <tr><td colspan="6" class="empty">No recipe off the menu. · لا توجد وصفات خارج المنيو.</td></tr>
                }
              </tbody>
            </table>
          </div>
          @if (incomplete(); as n) {
            <p class="warn">
              {{ n === 1 ? '1 chosen recipe has' : n + ' chosen recipes have' }} no category or price yet: each new item needs both.
              <span class="inline-ar">أكمل القسم والسعر لكل وصفة مختارة.</span>
            </p>
          }
        }
        @if (error(); as message) {
          <p class="error" role="alert">{{ message }}</p>
        }
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      @if (result()) {
        <button mat-flat-button type="button" (click)="close()">Done <span class="inline-ar">تم</span></button>
      } @else {
        <span class="muted chosen-count">{{ chosen().length }} chosen · مختارة</span>
        <span class="spacer"></span>
        <button mat-button type="button" (click)="close()" [disabled]="saving()">Cancel <span class="inline-ar">إلغاء</span></button>
        <button mat-flat-button type="button" (click)="add()" [disabled]="saving() || loading() || chosen().length === 0 || incomplete() > 0">
          <mat-icon>restaurant_menu</mat-icon> Add {{ chosen().length }} to the menu <span class="inline-ar">إضافة للمنيو</span>
        </button>
      }
    </mat-dialog-actions>
  `,
  styleUrl: './costing.scss',
  styles: `
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .fill {
      min-width: 260px;
    }
    .cell {
      width: 100%;
      min-width: 120px;
      padding: 6px 8px;
      border: 1px solid var(--app-line);
      border-radius: 8px;
      background: var(--mat-sys-surface);
      color: inherit;
      font: inherit;
    }
    .cell.price {
      width: 96px;
      min-width: 0;
      text-align: end;
    }
    .cell.missing {
      border-color: var(--mat-sys-error);
    }
    tr.off td {
      opacity: 0.55;
    }
    .counts {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 8px;
    }
    .count {
      padding: 6px 12px;
      border-radius: 999px;
      background: var(--mat-sys-surface-container-high);
      font: var(--mat-sys-label-large);

      .ar {
        display: inline;
        margin-inline-start: 4px;
        opacity: 0.75;
      }
    }
    .count.bad {
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
    }
    .skipped li {
      margin-bottom: 6px;
    }
    .reason-ar {
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.92em;
    }
    .small {
      font-size: 0.85em;
    }
    .spacer {
      flex: 1;
    }
    h3 {
      margin: 16px 0 8px;
      font: var(--mat-sys-title-small);
    }
  `,
})
export class AddToMenuDialog {
  private readonly data = inject<AddToMenuData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<AddToMenuDialog, boolean>>(MatDialogRef);
  private readonly api = inject(MenuSalesApi);
  protected readonly company = inject(Company);

  protected readonly rows = signal<Row[]>([]);
  protected readonly categories = signal<string[]>([]);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly result = signal<RecipesToMenuResult | null>(null);
  protected readonly query = signal('');
  protected allCategory = '';
  // Bumped as a row is typed into: what is chosen and complete is read again.
  private readonly version = signal(0);

  protected readonly shown = computed(() => {
    const q = key(this.query());
    return this.rows().filter((r) => !q || key(r.name).includes(q));
  });

  protected readonly chosen = computed(() => {
    this.version();
    return this.rows().filter((r) => r.chosen);
  });

  protected readonly allChosen = computed(() => this.chosen().length === this.rows().length && this.rows().length > 0);
  protected readonly someChosen = computed(() => this.chosen().length > 0 && !this.allChosen());

  // Chosen, new, and short of a category or a price.
  protected readonly incomplete = computed(() => this.chosen().filter((r) => !r.existing && (!r.category.trim() || !((r.price ?? 0) > 0))).length);

  constructor() {
    void this.load();
  }

  protected touch(): void {
    this.version.update((v) => v + 1);
  }

  protected chooseAll(on: boolean): void {
    this.rows().forEach((r) => (r.chosen = on));
    this.touch();
  }

  // The category typed above, for each chosen one with none.
  protected fillCategory(): void {
    const category = this.allCategory.trim();
    this.rows().filter((r) => r.chosen && !r.existing && !r.category.trim()).forEach((r) => (r.category = category));
    this.touch();
  }

  protected foodCost(r: Row): number | null {
    return r.price && r.price > 0 ? Math.round((r.costPerPortion / r.price) * 1000) / 10 : null;
  }

  protected async add(): Promise<void> {
    if (this.incomplete() > 0 || this.chosen().length === 0) {
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    try {
      this.result.set(
        await firstValueFrom(
          this.api.addRecipesToMenu(this.chosen().map((r) => ({ recipeId: r.id, category: r.category.trim() || null, price: r.price }))),
        ),
      );
    } catch (error) {
      this.error.set(errorMessage(error, 'They could not be added to the menu. · تعذّرت الإضافة للمنيو.'));
    } finally {
      this.saving.set(false);
    }
  }

  protected close(): void {
    this.ref.close((this.result()?.linked.length ?? 0) > 0);
  }

  // The menu's categories to choose from, and its items by name: a recipe of one's name is linked to it.
  private async load(): Promise<void> {
    try {
      const menu = await firstValueFrom(this.api.menu());
      this.categories.set(menu.categories.map((c) => c.name));
      const byName = new Map(menu.items.filter((i) => !i.isDeleted).map((i) => [key(i.name), i]));
      this.rows.set(
        this.data.recipes
          .filter((c) => c.recipeId && c.isStandalone && !c.isDeleted)
          .map((c) => ({
            id: c.recipeId!,
            name: c.recipeName ?? c.recipe,
            costPerPortion: c.costPerPortion,
            chosen: true,
            category: c.recipeCategory ?? '',
            price: c.plannedPrice,
            existing: byName.get(key(c.recipeName ?? c.recipe)) ?? null,
          })),
      );
    } catch (error) {
      this.error.set(errorMessage(error, 'The menu could not be loaded. · تعذّر تحميل المنيو.'));
    } finally {
      this.loading.set(false);
    }
  }
}
