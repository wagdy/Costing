import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import { AssetCategory, CustodyApi } from '../../core/custody/custody.api';
import { errorMessage } from '../../core/http/error-message';
import { NotifyService } from '../../core/ui/notify.service';
import { HrAccess } from '../../core/hr/hr-access';

export interface CategoryDialogData {
  category?: AssetCategory;
}

export interface CategoryAnswer {
  name: string;
  isConsumable: boolean;
}

// A category's name, and whether it is consumable: the fragile and worn whose breakage is a cost
// of the day, in Costing → Waste.
@Component({
  selector: 'app-asset-category-dialog',
  imports: [FormsModule, MatButtonModule, MatCheckboxModule, MatDialogModule, MatFormFieldModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>
      {{ data.category ? 'Rename ' + data.category.name : 'Add a category' }} <span class="inline-ar">{{ data.category ? 'تعديل الفئة' : 'إضافة فئة' }}</span>
    </h2>
    <mat-dialog-content>
      <mat-form-field class="wide">
        <mat-label>Name · الاسم</mat-label>
        <input matInput [(ngModel)]="name" maxlength="100" placeholder="Laptops, tools, uniforms" aria-label="Name" />
      </mat-form-field>
      <mat-checkbox [(ngModel)]="isConsumable">Consumable <span class="inline-ar">مستهلك</span></mat-checkbox>
      <p class="muted small">
        <span class="note-ar" lang="ar" dir="rtl">مستهلك: الأطباق والأكواب وما شابهها. عند إخراج قطعة منه على أنها مكسورة، تُشطب بتكلفتها في إذن الخروج. اتركه غير مفعّل للأصول الثابتة، مثل القلاية أو اللابتوب.</span>
        Consumable: plates, glasses and the like. When one is checked out as broken, it is written off at its cost, on its voucher. Leave it off for fixed
        assets, a fryer or a laptop.
      </p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button [disabled]="!name.trim()" [mat-dialog-close]="{ name: name.trim(), isConsumable }">Save</button>
    </mat-dialog-actions>
  `,
  styleUrl: '../shared/pages.scss',
  styles: `
    .wide {
      width: 100%;
    }
    .small {
      font-size: 0.85em;
    }
  `,
})
export class CategoryDialog {
  protected readonly data = inject<CategoryDialogData>(MAT_DIALOG_DATA);
  protected name = this.data.category?.name ?? '';
  protected isConsumable = this.data.category?.isConsumable ?? false;
}

// The categories (الفئات): each with how many assets are in it and how many of those are in
// someone's custody. A manager's to add, rename and delete; one with assets in it, or bought as an
// expense, stays.
@Component({
  selector: 'app-asset-categories-page',
  imports: [MatButtonModule, MatIconModule, MatProgressBarModule, MatTooltipModule],
  template: `
    <div class="toolbar">
      <span class="muted"><span class="note-ar" lang="ar" dir="rtl">الفئات التي تُصنَّف بها الأصول. المستهلك الذي ينكسر يُشطب بتكلفته في إذن خروجه.</span>What the assets are kept by. A consumable that breaks is written off at its cost, on its voucher.</span>
      <span class="spacer"></span>
      @if (canChange()) {
        <button mat-flat-button (click)="add()"><mat-icon>add</mat-icon> Add a category <span class="inline-ar">إضافة فئة</span></button>
      }
    </div>
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    @if (error(); as problem) {
      <p class="error">{{ problem }}</p>
    } @else {
      <div class="table-wrap narrow">
        <table class="grid">
          <thead>
            <tr>
              <th>Category<span class="ar">الفئة</span></th>
              <th>Kind<span class="ar">النوع</span></th>
              <th class="num">Assets<span class="ar">الأصول</span></th>
              <th class="num">In custody<span class="ar">في العهدة</span></th>
              @if (canChange()) {
                <th class="num"><span class="visually-hidden">Change</span></th>
              }
            </tr>
          </thead>
          <tbody>
            @for (c of categories(); track c.id) {
              <tr>
                <td><strong>{{ c.name }}</strong></td>
                <td>
                  @if (c.isConsumable) {
                    <span class="tag accent">Consumable<span class="ar">مستهلك</span></span>
                  } @else {
                    <span class="tag info">Fixed asset<span class="ar">أصل ثابت</span></span>
                  }
                </td>
                <td class="num">{{ c.assets }}</td>
                <td class="num">{{ c.inCustody }}</td>
                @if (canChange()) {
                  <td class="num nowrap">
                    <button mat-icon-button (click)="edit(c)" matTooltip="Rename" [attr.aria-label]="'Rename ' + c.name"><mat-icon>edit</mat-icon></button>
                    <button mat-icon-button class="danger" (click)="remove(c)" matTooltip="Delete" [attr.aria-label]="'Delete ' + c.name"><mat-icon>delete</mat-icon></button>
                  </td>
                }
              </tr>
            } @empty {
              <tr>
                <td [attr.colspan]="canChange() ? 5 : 4" class="empty">
                  <mat-icon>category</mat-icon>
                  <span class="note-ar" lang="ar" dir="rtl">لا توجد فئات بعد. أضف فئة مثل أدوات المائدة (مستهلك) أو الأجهزة.</span>
                  No categories yet. Add one, such as Tableware (consumable) or Devices.
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
  styleUrl: '../shared/pages.scss',
  styles: `
    .narrow {
      max-width: 820px;
    }
    .nowrap {
      white-space: nowrap;
    }
    .danger {
      color: var(--mat-sys-error);
    }
  `,
})
export class CategoriesPage {
  private readonly api = inject(CustodyApi);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotifyService);
  private readonly access = inject(HrAccess);
  // A manager's, or an employee's holding the tab in the portal.
  protected readonly canChange = computed(() => this.access.canDecide('Custody'));

  protected readonly categories = signal<AssetCategory[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    void this.load();
  }

  protected async add(): Promise<void> {
    const answer = await this.ask({});
    if (answer) {
      await this.act(() => firstValueFrom(this.api.saveCategory(crypto.randomUUID(), answer.name, answer.isConsumable)), `${answer.name} added.`);
    }
  }

  protected async edit(category: AssetCategory): Promise<void> {
    const answer = await this.ask({ category });
    if (answer) {
      await this.act(() => firstValueFrom(this.api.saveCategory(category.id, answer.name, answer.isConsumable)), `${answer.name} saved.`);
    }
  }

  protected async remove(category: AssetCategory): Promise<void> {
    await this.act(() => firstValueFrom(this.api.deleteCategory(category.id)), `${category.name} deleted.`);
  }

  private ask(data: CategoryDialogData): Promise<CategoryAnswer | undefined> {
    return firstValueFrom(this.dialog.open<CategoryDialog, CategoryDialogData, CategoryAnswer>(CategoryDialog, { data, width: '440px' }).afterClosed());
  }

  private async act(call: () => Promise<unknown>, done: string): Promise<void> {
    try {
      await call();
      this.notify.info(done);
      await this.load();
    } catch (error) {
      this.notify.error(error, 'It could not be saved.');
    }
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.categories.set(await firstValueFrom(this.api.categories()));
    } catch (error) {
      this.error.set(errorMessage(error, 'The categories could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }
}
