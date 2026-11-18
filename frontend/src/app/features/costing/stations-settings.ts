import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { Permissions } from '../../core/auth/permissions';
import { CostingApi, KitchenStation } from '../../core/costing/costing.api';
import { NotifyService } from '../../core/ui/notify.service';
import { InfoTip } from './info-tip';
import { Stations } from './stations';

interface Draft {
  id: string;
  name: string;
  nameAr: string;
  code: string;
  displayOrder: number;
  tolerance: number | null;
  isActive: boolean;
  isNew: boolean;
  materials: number;
  recipes: number;
}

// The kitchen and bar stations on Cost settings (أقسام التشغيل والمطبخ), a manager's to set: each
// named in English and Arabic, coded, in its place on the lists, with its own variance tolerance
// (blank: the settings'), in use or not. Taken away, what it kept falls to the shared station.
@Component({
  selector: 'app-stations-settings',
  imports: [FormsModule, InfoTip, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSlideToggleModule, MatTooltipModule],
  template: `
    <section class="block" aria-labelledby="stations-title">
      <h2 id="stations-title">Kitchen & bar stations <span class="inline-ar">أقسام التشغيل والمطبخ</span> <app-info-tip tip="kitchenStation" /></h2>
      <p class="note">
        Each material, prep item and dish is kept by a station, and its use and waste are held against it on Station variance. A station's own tolerance
        tightens or loosens the ±{{ tolerance() }}% above for it alone.
        <span class="note-ar" lang="ar" dir="rtl">كل خامة ومصنّع وطبق تابع لقسم، ويُحاسب القسم على استهلاكه وهالكه في انحراف الأقسام.</span>
      </p>
      <div class="table-wrap">
        <table class="grid stations">
          <thead>
            <tr>
              <th>Code<span class="ar">الكود</span></th>
              <th>Name<span class="ar">الاسم</span></th>
              <th>Arabic name<span class="ar">الاسم بالعربي</span></th>
              <th class="num">Order<span class="ar">الترتيب</span></th>
              <th class="num">Tolerance % <app-info-tip tip="stationTolerance" /><span class="ar">نسبة السماح</span></th>
              <th class="num">Kept<span class="ar">الخامات / الأطباق</span></th>
              <th>In use<span class="ar">مفعل</span></th>
              <th><span class="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (d of drafts(); track d.id; let i = $index) {
              <tr [class.inactive]="!d.isActive">
                <td><input class="cell code" [(ngModel)]="d.code" maxlength="20" [disabled]="!canEdit()" [attr.aria-label]="'Code of ' + (d.name || 'a new station')" /></td>
                <td><input class="cell" [(ngModel)]="d.name" maxlength="100" [disabled]="!canEdit()" [attr.aria-label]="'Name, row ' + (i + 1)" /></td>
                <td><input class="cell" [(ngModel)]="d.nameAr" maxlength="100" dir="rtl" [disabled]="!canEdit()" [attr.aria-label]="'Arabic name of ' + (d.name || 'a new station')" /></td>
                <td class="num"><input class="cell num" type="number" min="0" [(ngModel)]="d.displayOrder" [disabled]="!canEdit()" [attr.aria-label]="'Order of ' + (d.name || 'a new station')" /></td>
                <td class="num">
                  <input class="cell num" type="number" min="0.5" max="100" step="0.5" [(ngModel)]="d.tolerance" [placeholder]="tolerance() + ''" [disabled]="!canEdit()"
                    [attr.aria-label]="'Tolerance of ' + (d.name || 'a new station')" />
                </td>
                <td class="num muted">{{ d.materials }} · {{ d.recipes }}</td>
                <td><mat-slide-toggle [(ngModel)]="d.isActive" [disabled]="!canEdit()" [aria-label]="(d.name || 'The new station') + ' in use'" /></td>
                <td class="actions">
                  @if (canEdit()) {
                    <button mat-icon-button (click)="save(d)" [disabled]="busy() || !d.name.trim()" matTooltip="Save · حفظ" [attr.aria-label]="'Save ' + (d.name || 'the new station')">
                      <mat-icon>save</mat-icon>
                    </button>
                    @if (!d.isNew) {
                      <button mat-icon-button class="danger" (click)="remove(d)" [disabled]="busy()" matTooltip="Delete · حذف" [attr.aria-label]="'Delete ' + (d.name || 'the new station')">
                        <mat-icon>delete</mat-icon>
                      </button>
                    }
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      @if (canEdit()) {
        <button mat-stroked-button (click)="add()"><mat-icon>add</mat-icon> New station · قسم جديد</button>
      } @else {
        <p class="muted small">A manager sets the stations.</p>
      }
    </section>
  `,
  styleUrl: './costing.scss',
  styles: `
    .block h2 {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .cell {
      width: 100%;
      min-width: 70px;
      padding: 6px 8px;
      border: 1px solid var(--app-line);
      border-radius: 8px;
      background: transparent;
      color: inherit;
      font: inherit;

      &.code {
        width: 90px;
        text-transform: uppercase;
      }
      &.num {
        width: 80px;
        text-align: end;
      }
    }
    tr.inactive td {
      opacity: 0.6;
    }
    .actions {
      white-space: nowrap;
    }
    .danger {
      color: var(--mat-sys-error);
    }
    .small {
      font-size: 0.85em;
    }
  `,
})
export class StationsSettings {
  private readonly api = inject(CostingApi);
  private readonly auth = inject(AuthService);
  private readonly notify = inject(NotifyService);
  private readonly stations = inject(Stations);

  // The settings' tolerance, which a station with none is judged by.
  readonly tolerance = input(5);
  protected readonly canEdit = computed(() => this.auth.can(Permissions.ApprovalDecide));
  protected readonly busy = signal(false);
  protected readonly drafts = signal<Draft[]>([]);

  constructor() {
    void this.load();
  }

  protected add(): void {
    const order = Math.max(0, ...this.drafts().map((d) => d.displayOrder)) + 1;
    this.drafts.update((all) => [
      ...all,
      { id: crypto.randomUUID(), name: '', nameAr: '', code: '', displayOrder: order, tolerance: null, isActive: true, isNew: true, materials: 0, recipes: 0 },
    ]);
  }

  protected async save(d: Draft): Promise<void> {
    this.busy.set(true);
    try {
      const tolerance = d.tolerance === null || (d.tolerance as unknown) === '' ? null : Number(d.tolerance);
      await firstValueFrom(this.api.saveStation(d.id, {
        name: d.name.trim(), nameAr: d.nameAr.trim() || null, code: d.code.trim() || null, displayOrder: Number(d.displayOrder) || 0,
        targetVarianceTolerancePercent: tolerance, isActive: d.isActive,
      }));
      this.notify.info(`${d.name.trim()} saved. · تم حفظ القسم.`);
      await this.load(true);
    } catch (error) {
      this.notify.error(error, 'The station could not be saved.');
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(d: Draft): Promise<void> {
    if (!confirm(`Delete ${d.name}? Its ${d.materials} materials and ${d.recipes} dishes fall to the shared station.`)) {
      return;
    }
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.deleteStation(d.id));
      this.notify.info(`${d.name} deleted. · تم حذف القسم.`);
      await this.load(true);
    } catch (error) {
      this.notify.error(error, 'The station could not be deleted.');
    } finally {
      this.busy.set(false);
    }
  }

  private async load(again = false): Promise<void> {
    await this.stations.load(again);
    this.drafts.set(this.stations.list().map((s: KitchenStation) => ({
      id: s.id, name: s.name, nameAr: s.nameAr ?? '', code: s.code ?? '', displayOrder: s.displayOrder, tolerance: s.targetVarianceTolerancePercent,
      isActive: s.isActive, isNew: false, materials: s.materials, recipes: s.recipes,
    })));
  }
}
