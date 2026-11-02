import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { Permissions } from '../../core/auth/permissions';
import { Menu, MenuAddOn, MenuImportResult, MenuItem, MenuItemInput, MenuSalesApi } from '../../core/costing/menu-sales.api';
import { errorMessage } from '../../core/http/error-message';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { NotifyService } from '../../core/ui/notify.service';
import { saveBlob } from '../../core/ui/save-blob';
import { FilterOption, FilterSelect } from '../shared/filter-select';

export interface MenuItemDialogData {
  item?: MenuItem;
  menu: Menu;
}

// An item's form: its number (its code on every report, given once), names, category, price, its
// sizes each at its own price, and the add-ons it is sold with. Closes with the item as saved.
@Component({
  selector: 'app-menu-item-dialog',
  imports: [FormsModule, MatButtonModule, MatCheckboxModule, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule],
  template: `
    <h2 mat-dialog-title>
      @if (data.item) {
        {{ data.item.name }} <span class="inline-ar">تعديل صنف</span>
      } @else {
        New item <span class="inline-ar">صنف جديد</span>
      }
    </h2>
    <mat-dialog-content>
      <form id="menu-item-form" class="form" (ngSubmit)="save()">
        <div class="row">
          <mat-form-field class="number">
            <mat-label>Number · رقم الصنف</mat-label>
            <input matInput type="number" min="1" step="1" name="number" [(ngModel)]="number" [disabled]="!!data.item" placeholder="Next" />
            <mat-hint>{{ data.item ? 'Its code on the reports' : 'Blank: the next one' }}</mat-hint>
          </mat-form-field>
          <mat-form-field class="wide">
            <mat-label>Name · الاسم</mat-label>
            <input matInput name="name" [(ngModel)]="name" maxlength="200" required />
          </mat-form-field>
          <mat-form-field class="wide">
            <mat-label>Arabic name · الاسم بالعربي</mat-label>
            <input matInput name="nameAr" [(ngModel)]="nameAr" maxlength="200" dir="rtl" />
          </mat-form-field>
        </div>
        <div class="row">
          <mat-form-field class="wide">
            <mat-label>Category · القسم</mat-label>
            <mat-select name="category" [(ngModel)]="category" required>
              @for (c of data.menu.categories; track c.id) {
                <mat-option [value]="c.name">{{ c.name }}@if (c.nameAr) { · {{ c.nameAr }}}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-form-field>
            <mat-label>Price · السعر</mat-label>
            <input matInput type="number" min="0" step="0.01" name="price" [(ngModel)]="price" [disabled]="byAddOns || sizes.length > 0" />
            <mat-hint>{{ sizes.length ? 'Each size has its own' : byAddOns ? 'Its add-ons make it' : '' }}</mat-hint>
          </mat-form-field>
        </div>
        <div class="row">
          <mat-checkbox name="byAddOns" [(ngModel)]="byAddOns">Priced by its add-ons · السعر بالإضافات</mat-checkbox>
          <mat-checkbox name="available" [(ngModel)]="available">On sale · متاح</mat-checkbox>
        </div>

        <h3>Sizes <span class="inline-ar">الأحجام</span></h3>
        @for (s of sizes; track $index; let i = $index) {
          <div class="row size">
            <mat-form-field subscriptSizing="dynamic">
              <mat-label>Size · الحجم</mat-label>
              <input matInput [name]="'size' + i" [(ngModel)]="s.name" maxlength="200" required />
            </mat-form-field>
            <mat-form-field subscriptSizing="dynamic">
              <mat-label>Arabic · بالعربي</mat-label>
              <input matInput [name]="'sizeAr' + i" [(ngModel)]="s.nameAr" maxlength="200" dir="rtl" />
            </mat-form-field>
            <mat-form-field subscriptSizing="dynamic" class="price">
              <mat-label>Price · السعر</mat-label>
              <input matInput type="number" min="0" step="0.01" [name]="'sizePrice' + i" [(ngModel)]="s.price" required />
            </mat-form-field>
            <button mat-icon-button type="button" (click)="sizes.splice(i, 1)" [attr.aria-label]="'Remove the size ' + s.name"><mat-icon>close</mat-icon></button>
          </div>
        }
        <button mat-button type="button" (click)="sizes.push({ name: '', nameAr: null, price: 0 })"><mat-icon>add</mat-icon> Add a size <span class="inline-ar">إضافة حجم</span></button>

        @if (data.menu.addOns.length) {
          <h3>Add-ons it is sold with <span class="inline-ar">الإضافات</span></h3>
          <mat-form-field class="full">
            <mat-label>Add-ons · الإضافات</mat-label>
            <mat-select name="addOns" [(ngModel)]="addOnIds" multiple>
              @for (a of liveAddOns; track a.id) {
                <mat-option [value]="a.id">{{ a.name }} · {{ a.price }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        }
      </form>
      @if (error(); as message) {
        <p class="error" role="alert">{{ message }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button type="submit" form="menu-item-form" [disabled]="saving()">Save · حفظ</button>
    </mat-dialog-actions>
  `,
  styles: `
    .form {
      display: grid;
      gap: 4px;
      min-width: min(640px, 80vw);
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 12px;
    }
    .wide {
      flex: 1 1 200px;
    }
    .number {
      width: 140px;
    }
    .price {
      width: 120px;
    }
    .full {
      width: 100%;
    }
    h3 {
      margin: 12px 0 4px;
      font: var(--mat-sys-title-small);
    }
    .inline-ar {
      direction: rtl;
      unicode-bidi: isolate;
      opacity: 0.75;
      margin-left: 6px;
    }
    .error {
      color: var(--mat-sys-error);
    }
  `,
})
export class MenuItemDialog {
  protected readonly data = inject<MenuItemDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<MenuItemDialog, MenuItem>);
  private readonly api = inject(MenuSalesApi);

  protected number: number | null = this.data.item?.id ?? null;
  protected name = this.data.item?.name ?? '';
  protected nameAr = this.data.item?.nameAr ?? '';
  protected category = this.data.item?.category ?? this.data.menu.categories[0]?.name ?? '';
  protected price = this.data.item?.price ?? 0;
  protected byAddOns = this.data.item?.isPriceBasedOnAddons ?? false;
  protected available = this.data.item?.isAvailable ?? true;
  protected sizes = (this.data.item?.sizes ?? []).map((s) => ({ name: s.name, nameAr: s.nameAr, price: s.price }));
  protected addOnIds = [...(this.data.item?.addOnIds ?? [])];
  protected readonly liveAddOns = this.data.menu.addOns.filter((a) => !a.isDeleted || this.addOnIds.includes(a.id));
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async save(): Promise<void> {
    this.saving.set(true);
    this.error.set(null);
    const input: MenuItemInput = {
      number: this.number ? Number(this.number) : null,
      name: this.name.trim(),
      nameAr: this.nameAr.trim() || null,
      category: this.category,
      price: Number(this.price) || 0,
      isPriceBasedOnAddons: this.byAddOns,
      isAvailable: this.available,
      sizes: this.sizes.map((s) => ({ name: s.name.trim(), nameAr: s.nameAr?.trim() || null, price: Number(s.price) || 0 })),
      addOnIds: this.addOnIds,
    };
    try {
      const saved = await firstValueFrom(this.data.item ? this.api.saveItem(this.data.item.id, input) : this.api.addItem(input));
      this.ref.close(saved);
    } catch (error) {
      this.error.set(errorMessage(error, 'The item could not be saved.'));
    } finally {
      this.saving.set(false);
    }
  }
}

// The menu (قائمة الطعام) the recipes sell by and the sales name: its categories, its items with
// their sizes, and the add-ons. An item's number is its code on every report (6101, a size of it
// 6101-2, an add-on A3). Kept here, or imported from a sheet: a point of sale's export, its columns
// named as the template's. A deleted item leaves the menu; its recipe and its sales stay.
@Component({
  selector: 'app-menu-page',
  imports: [FilterSelect, FormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressBarModule, MatTooltipModule, MoneyPipe],
  template: `
    <div class="toolbar no-print">
      <mat-form-field subscriptSizing="dynamic" class="search">
        <mat-icon matPrefix>search</mat-icon>
        <mat-label>Search · بحث</mat-label>
        <input matInput [ngModel]="query()" (ngModelChange)="query.set($event)" aria-label="Search the menu" />
      </mat-form-field>
      <app-filter-select label="Category · القسم" icon="category" [options]="categoryFilters()" [(value)]="category" />
      <span class="spacer"></span>
      @if (canChange) {
        <button mat-stroked-button (click)="template()"><mat-icon>download</mat-icon> Template <span class="inline-ar">النموذج</span></button>
        <button mat-stroked-button type="button" (click)="picker.click()" [disabled]="busy()"><mat-icon>upload_file</mat-icon> Import <span class="inline-ar">استيراد</span></button>
        <input #picker type="file" accept=".xlsx" (change)="import($event)" hidden aria-label="The menu's sheet" />
        <button mat-flat-button (click)="edit()" [disabled]="!menu()?.categories?.length"><mat-icon>add</mat-icon> New item <span class="inline-ar">صنف جديد</span></button>
      }
    </div>

    @if (imported(); as result) {
      <div class="note" role="status">
        <strong>{{ result.added }} added, {{ result.updated }} changed, {{ result.categoriesAdded }} new categories.</strong>
        @for (s of result.skipped; track s.row) {
          <div class="muted small">Row {{ s.row }}{{ s.name ? ' · ' + s.name : '' }}: {{ s.reason }}</div>
        }
      </div>
    }

    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    } @else if (error(); as message) {
      <p class="error">{{ message }}</p>
    } @else if (menu(); as m) {
      <section class="categories" aria-label="Categories">
        @for (c of m.categories; track c.id) {
          <span class="chip">
            {{ c.name }}@if (c.nameAr) {<span class="inline-ar">{{ c.nameAr }}</span>}
            <span class="count">{{ c.items }}</span>
            @if (canChange) {
              <button mat-icon-button class="mini" (click)="renameCategory(c.id, c.name, c.nameAr)" [attr.aria-label]="'Rename ' + c.name"><mat-icon>edit</mat-icon></button>
              @if (!c.items) {
                <button mat-icon-button class="mini" (click)="deleteCategory(c.id, c.name)" [attr.aria-label]="'Delete ' + c.name"><mat-icon>close</mat-icon></button>
              }
            }
          </span>
        }
        @if (canChange) {
          <button mat-button (click)="addCategory()"><mat-icon>add</mat-icon> Category <span class="inline-ar">قسم</span></button>
        }
      </section>

      <div class="table-wrap">
        <table class="grid" aria-label="Menu items">
          <thead>
            <tr>
              <th>Code<span class="ar">الكود</span></th>
              <th>Item<span class="ar">الصنف</span></th>
              <th>Category<span class="ar">القسم</span></th>
              <th class="num">Price<span class="ar">السعر</span></th>
              <th>Sizes<span class="ar">الأحجام</span></th>
              <th>Add-ons<span class="ar">الإضافات</span></th>
              <th><span class="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (item of shown(); track item.id) {
              <tr [class.voided]="item.isDeleted">
                <td class="code">{{ item.id }}</td>
                <td>
                  <strong>{{ item.name }}</strong>
                  @if (item.nameAr) {
                    <div class="muted small" dir="rtl">{{ item.nameAr }}</div>
                  }
                  @if (!item.isAvailable) {
                    <span class="tag warn">Not on sale<span class="ar">غير متاح</span></span>
                  }
                  @if (item.isDeleted) {
                    <span class="tag bad">Deleted<span class="ar">محذوف</span></span>
                  }
                </td>
                <td>{{ item.category }}</td>
                <td class="num">{{ item.isPriceBasedOnAddons ? 'By add-ons' : item.sizes.length ? '—' : (item.price | money) }}</td>
                <td>
                  @for (s of item.sizes; track s.id) {
                    <div class="small">{{ item.id }}-{{ s.id }} · {{ s.name }} · {{ s.price | money }}</div>
                  } @empty {
                    <span class="muted">—</span>
                  }
                </td>
                <td class="small">{{ addOnNames(item) }}</td>
                <td class="num actions">
                  @if (canChange) {
                    @if (item.isDeleted) {
                      <button mat-icon-button (click)="restore(item)" [attr.aria-label]="'Restore ' + item.name" matTooltip="Restore · استعادة"><mat-icon>restore</mat-icon></button>
                    } @else {
                      <button mat-icon-button (click)="edit(item)" [attr.aria-label]="'Edit ' + item.name" matTooltip="Edit · تعديل"><mat-icon>edit</mat-icon></button>
                      <button mat-icon-button (click)="remove(item)" [attr.aria-label]="'Delete ' + item.name" matTooltip="Delete · حذف"><mat-icon>delete</mat-icon></button>
                    }
                  }
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="7" class="empty">
                  No items yet. Add categories, then items, or import the menu from its sheet.
                  <span class="note-ar" lang="ar" dir="rtl">لا توجد أصناف بعد. أضف الأقسام ثم الأصناف، أو استورد القائمة من ملف Excel.</span>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <h2 class="section">Add-ons <span class="inline-ar">الإضافات</span></h2>
      <div class="table-wrap narrow">
        <table class="grid" aria-label="Add-ons">
          <thead>
            <tr>
              <th>Code<span class="ar">الكود</span></th>
              <th>Add-on<span class="ar">الإضافة</span></th>
              <th class="num">Price<span class="ar">السعر</span></th>
              <th><span class="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (a of m.addOns; track a.id) {
              <tr [class.voided]="a.isDeleted">
                <td class="code">A{{ a.id }}</td>
                <td>{{ a.name }}@if (a.nameAr) {<span class="inline-ar">{{ a.nameAr }}</span>}</td>
                <td class="num">{{ a.price | money }}</td>
                <td class="num actions">
                  @if (canChange) {
                    @if (a.isDeleted) {
                      <button mat-icon-button (click)="restoreAddOn(a)" [attr.aria-label]="'Restore ' + a.name"><mat-icon>restore</mat-icon></button>
                    } @else {
                      <button mat-icon-button (click)="editAddOn(a)" [attr.aria-label]="'Edit ' + a.name"><mat-icon>edit</mat-icon></button>
                      <button mat-icon-button (click)="deleteAddOn(a)" [attr.aria-label]="'Delete ' + a.name"><mat-icon>delete</mat-icon></button>
                    }
                  }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="4" class="empty">No add-ons. <span class="inline-ar">لا توجد إضافات.</span></td></tr>
            }
          </tbody>
        </table>
      </div>
      @if (canChange) {
        <button mat-button (click)="editAddOn()"><mat-icon>add</mat-icon> Add-on <span class="inline-ar">إضافة</span></button>
      }

      <p class="note">
        <span class="note-ar" lang="ar" dir="rtl">رقم الصنف هو كوده في كل التقارير، وحجم منه برقم الصنف ورقم الحجم. الوصفة تُربط بالصنف أو بحجمه أو بالإضافة، وكل بيع يخصم المخزون بها. الصنف المحذوف يخرج من القائمة وتبقى وصفته ومبيعاته.</span>
        An item's number is its code on every report; a size of it, the item's and the size's. A recipe sells by an item, a size of it or an
        add-on, and every sale takes its stock by it. A deleted item leaves the menu; its recipe and its sales stay.
      </p>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .search {
      width: 240px;
    }
    .categories {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      margin-bottom: 12px;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 4px 2px 12px;
      border-radius: 999px;
      border: 1px solid var(--app-line);
      background: var(--mat-sys-surface-container-lowest);
      font: var(--mat-sys-label-large);
    }
    .count {
      padding: 0 6px;
      border-radius: 999px;
      background: var(--mat-sys-surface-container-high);
      font: var(--mat-sys-label-small);
    }
    .mini {
      --mat-icon-button-state-layer-size: 28px;
      width: 28px;
      height: 28px;
      padding: 2px;
    }
    .mini mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
    .section {
      margin: 20px 0 8px;
      font: var(--mat-sys-title-medium);
    }
    .narrow {
      max-width: 640px;
    }
    tr.voided td {
      opacity: 0.6;
    }
    .small {
      font-size: 0.85em;
    }
  `,
})
export class MenuPage {
  private readonly api = inject(MenuSalesApi);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotifyService);
  protected readonly canChange = inject(AuthService).can(Permissions.InventoryManage);

  protected readonly menu = signal<Menu | null>(null);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly imported = signal<MenuImportResult | null>(null);
  protected readonly query = signal('');
  protected readonly category = signal('');

  protected readonly categoryFilters = computed<FilterOption[]>(() => [
    { value: '', label: 'All categories', count: this.menu()?.items.filter((i) => !i.isDeleted).length },
    ...(this.menu()?.categories ?? []).map((c) => ({ value: c.name, label: c.name, count: c.items })),
  ]);

  protected readonly shown = computed(() => {
    const q = this.query().trim().toLowerCase();
    return (this.menu()?.items ?? []).filter(
      (i) =>
        (!this.category() || i.category === this.category()) &&
        (!q || i.name.toLowerCase().includes(q) || (i.nameAr ?? '').includes(q) || String(i.id).includes(q)),
    );
  });

  constructor() {
    void this.load();
  }

  protected addOnNames(item: MenuItem): string {
    const names = new Map((this.menu()?.addOns ?? []).map((a) => [a.id, a.name]));
    return item.addOnIds.map((id) => names.get(id) ?? `A${id}`).join(', ') || '—';
  }

  protected async edit(item?: MenuItem): Promise<void> {
    const saved = await firstValueFrom(
      this.dialog.open(MenuItemDialog, { data: { item, menu: this.menu()! } satisfies MenuItemDialogData, autoFocus: 'first-tabbable' }).afterClosed(),
    );
    if (saved) {
      this.notify.info(`${saved.name} saved, as ${saved.id}.`);
      await this.load();
    }
  }

  protected async remove(item: MenuItem): Promise<void> {
    if (!confirm(`Delete ${item.name} from the menu? Its recipe and its sales stay.`)) {
      return;
    }
    await this.run(() => firstValueFrom(this.api.deleteItem(item.id)), `${item.name} is off the menu.`);
  }

  protected async restore(item: MenuItem): Promise<void> {
    await this.run(() => firstValueFrom(this.api.restoreItem(item.id)), `${item.name} is back on the menu.`);
  }

  protected async addCategory(): Promise<void> {
    const name = prompt('The new category’s name · اسم القسم')?.trim();
    if (name) {
      await this.run(() => firstValueFrom(this.api.addCategory(name, null)), `${name} added.`);
    }
  }

  protected async renameCategory(id: number, current: string, currentAr: string | null): Promise<void> {
    const name = prompt('The category’s name · اسم القسم', current)?.trim();
    if (!name) {
      return;
    }
    const nameAr = prompt('Its Arabic name · الاسم بالعربي', currentAr ?? '')?.trim() || null;
    await this.run(() => firstValueFrom(this.api.saveCategory(id, name, nameAr, null)), `${name} saved.`);
  }

  protected async deleteCategory(id: number, name: string): Promise<void> {
    await this.run(() => firstValueFrom(this.api.deleteCategory(id)), `${name} deleted.`);
  }

  protected async editAddOn(addOn?: MenuAddOn): Promise<void> {
    const name = prompt('The add-on’s name · اسم الإضافة', addOn?.name ?? '')?.trim();
    if (!name) {
      return;
    }
    const price = Number(prompt('Its price · السعر', String(addOn?.price ?? 0)));
    if (!Number.isFinite(price) || price < 0) {
      this.notify.error(null, 'A price is a number, 0 or more.');
      return;
    }
    await this.run(
      () => firstValueFrom(addOn ? this.api.saveAddOn(addOn.id, name, addOn.nameAr, price) : this.api.addAddOn(name, null, price)),
      `${name} saved.`,
    );
  }

  protected async deleteAddOn(addOn: MenuAddOn): Promise<void> {
    await this.run(() => firstValueFrom(this.api.deleteAddOn(addOn.id)), `${addOn.name} is off the menu.`);
  }

  protected async restoreAddOn(addOn: MenuAddOn): Promise<void> {
    await this.run(() => firstValueFrom(this.api.restoreAddOn(addOn.id)), `${addOn.name} is back.`);
  }

  protected async template(): Promise<void> {
    try {
      saveBlob(await firstValueFrom(this.api.menuTemplate()), 'menu-template.xlsx');
    } catch (error) {
      this.notify.error(error, 'The template could not be downloaded.');
    }
  }

  protected async import(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    this.busy.set(true);
    try {
      this.imported.set(await firstValueFrom(this.api.importMenu(file)));
      await this.load();
    } catch (error) {
      this.notify.error(error, 'The sheet could not be imported.');
    } finally {
      this.busy.set(false);
    }
  }

  private async run(action: () => Promise<unknown>, done: string): Promise<void> {
    try {
      await action();
      this.notify.info(done);
      await this.load();
    } catch (error) {
      this.notify.error(error, 'It could not be saved.');
    }
  }

  private async load(): Promise<void> {
    try {
      this.menu.set(await firstValueFrom(this.api.menu()));
      this.error.set(null);
    } catch (error) {
      this.error.set(errorMessage(error, 'The menu could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }
}
