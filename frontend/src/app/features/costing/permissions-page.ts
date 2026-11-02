import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';
import { CostingTab, costingTabs } from '../../core/costing/costing-tabs';
import { MenuSalesApi, UserTabs } from '../../core/costing/menu-sales.api';
import { errorMessage } from '../../core/http/error-message';
import { NotifyService } from '../../core/ui/notify.service';
import { roleLabels } from '../../core/users/users.api';

// What the dialog closes with: the sections ticked, or null for the role's own again.
export interface TabsChoice {
  tabs: CostingTab[] | null;
}

// A user's sections, each with what it lets them do: ticked, only those from now on; "Their
// role's" puts them back to what their role works.
@Component({
  selector: 'app-tabs-dialog',
  imports: [FormsModule, MatButtonModule, MatCheckboxModule, MatDialogModule],
  template: `
    <h2 mat-dialog-title>{{ data.name }}’s sections <span class="inline-ar">صلاحيات {{ data.name }}</span></h2>
    <mat-dialog-content>
      <p class="muted">{{ roleLabels[data.role].en }} · {{ roleLabels[data.role].ar }}</p>
      <div class="tabs">
        @for (t of tabs; track t.tab) {
          <mat-checkbox class="tab-option" [attr.data-tab]="t.tab" [checked]="chosen.has(t.tab)" (change)="tick(t.tab, $event.checked)">
            <span class="name">{{ t.en }} <span class="inline-ar">{{ t.ar }}</span></span>
            <span class="hint">{{ t.hint.en }} · {{ t.hint.ar }}</span>
          </mat-checkbox>
        }
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      @if (data.restricted) {
        <button mat-button class="reset" (click)="ref.close({ tabs: null })">Their role’s · حسب الدور</button>
      }
      <span class="spacer"></span>
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button (click)="save()">Save · حفظ</button>
    </mat-dialog-actions>
  `,
  styles: `
    .tabs {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 6px 16px;
    }
    .name {
      display: block;
      font: var(--mat-sys-label-large);
    }
    .hint {
      display: block;
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
    }
    .inline-ar {
      direction: rtl;
      unicode-bidi: isolate;
      opacity: 0.75;
      margin-left: 6px;
    }
    .spacer {
      flex: 1;
    }
    .muted {
      color: var(--mat-sys-on-surface-variant);
    }
  `,
})
export class TabsDialog {
  protected readonly data = inject<UserTabs>(MAT_DIALOG_DATA);
  protected readonly ref = inject(MatDialogRef<TabsDialog, TabsChoice>);
  protected readonly tabs = costingTabs;
  protected readonly roleLabels = roleLabels;
  protected readonly chosen = new Set<CostingTab>(this.data.tabs);

  protected tick(tab: CostingTab, on: boolean): void {
    if (on) {
      this.chosen.add(tab);
    } else {
      this.chosen.delete(tab);
    }
  }

  protected save(): void {
    this.ref.close({ tabs: costingTabs.map((t) => t.tab).filter((t) => this.chosen.has(t)) });
  }
}

// Permissions (الصلاحيات), a manager's: the sections each user works. A manager works every one,
// always; anyone else their role's (an accountant the purchases, the safe and the reports; a cost
// controller the recipes, the menu, the sales and the reports; a storekeeper the stock) until a
// manager ticks theirs. The server holds them to it on every request.
@Component({
  selector: 'app-permissions-page',
  imports: [MatButtonModule, MatIconModule, MatProgressBarModule],
  template: `
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    } @else if (error(); as message) {
      <p class="error">{{ message }}</p>
    } @else {
      <div class="table-wrap">
        <table class="grid access" aria-label="Permissions">
          <thead>
            <tr>
              <th>User<span class="ar">المستخدم</span></th>
              <th>Sections<span class="ar">الأقسام</span></th>
              <th><span class="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (u of users(); track u.id) {
              <tr>
                <td>
                  <strong>{{ u.name }}</strong>
                  <div class="muted small">{{ roleLabels[u.role].en }} · {{ roleLabels[u.role].ar }}</div>
                </td>
                <td>
                  <div class="chips">
                    @for (t of u.tabs; track t) {
                      <span class="tag info">{{ label(t) }}</span>
                    } @empty {
                      <span class="muted">None · لا شيء</span>
                    }
                  </div>
                  <div class="muted small">
                    @if (u.restricted) {
                      Ticked by {{ u.setBy }}
                    } @else {
                      Their role’s · حسب الدور
                    }
                  </div>
                </td>
                <td class="num">
                  <button mat-stroked-button (click)="change(u)"><mat-icon>tune</mat-icon> Change <span class="inline-ar">تعديل</span></button>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="3" class="empty">
                  No one but managers yet: add users on Users, then give them their sections here.
                  <span class="note-ar" lang="ar" dir="rtl">لا يوجد مستخدمون غير المديرين بعد: أضفهم من صفحة المستخدمين.</span>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <p class="note">
        <span class="note-ar" lang="ar" dir="rtl">المدير يعمل في كل الأقسام دائمًا. غيره يعمل في أقسام دوره حتى يحدد المدير أقسامه، فتصبح هي فقط. التعديلات التي يقررها المدير (الحذف والإلغاء والتصنيع والخزنة) تنتظر موافقته.</span>
        A manager works every section, always. Anyone else works their role’s until a manager ticks theirs; then only those. What only a manager
        decides (deletes, voids, production, the safe) waits for a manager’s approval.
      </p>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-bottom: 4px;
    }
    .small {
      font-size: 0.85em;
    }
  `,
})
export class PermissionsPage {
  private readonly api = inject(MenuSalesApi);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotifyService);
  protected readonly roleLabels = roleLabels;

  protected readonly users = signal<UserTabs[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  constructor() {
    void this.load();
  }

  protected label(tab: CostingTab): string {
    return costingTabs.find((t) => t.tab === tab)?.en ?? tab;
  }

  protected async change(user: UserTabs): Promise<void> {
    const choice = await firstValueFrom(this.dialog.open(TabsDialog, { data: user, width: '720px', maxWidth: '96vw' }).afterClosed());
    if (!choice) {
      return;
    }
    try {
      const saved = await firstValueFrom(this.api.setTabs(user.id, choice.tabs));
      this.users.update((all) => all.map((u) => (u.id === saved.id ? saved : u)));
      this.notify.info(saved.restricted ? `${saved.name} works ${saved.tabs.length} sections now.` : `${saved.name} works their role’s sections again.`);
    } catch (error) {
      this.notify.error(error, 'The sections could not be saved.');
    }
  }

  private async load(): Promise<void> {
    try {
      this.users.set(await firstValueFrom(this.api.access()));
      this.error.set(null);
    } catch (error) {
      this.error.set(errorMessage(error, 'The permissions could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }
}
