import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { firstValueFrom } from 'rxjs';
import { errorMessage } from '../../core/http/error-message';
import { BranchContext } from '../../core/settings/branch-context';
import { Company } from '../../core/settings/company';
import {
  BranchType,
  CompanyStructure,
  CompanyStructureApi,
  LocationKind,
  OperatingMode,
  branchTypeLabels,
  hasLocations,
  isMultiBranch,
  locationKindLabels,
} from '../../core/settings/company-structure';
import { NotifyService } from '../../core/ui/notify.service';
import { InfoTip } from '../costing/info-tip';
import { InfoTipKey } from '../costing/info-tips';
import { SubNav } from '../shared/sub-nav';
import { settingsTabs } from './settings-tabs';

interface ModeCard {
  mode: OperatingMode;
  icon: string;
  en: string;
  ar: string;
  tip: InfoTipKey;
  // What it shows and turns on; soon: what follows in a later release.
  does: string[];
  soon?: string;
}

const modes: readonly ModeCard[] = [
  {
    mode: 'SingleBranch_OpenSpace', icon: 'storefront', en: 'Single branch, open space', ar: 'فرع واحد بمساحة مفتوحة', tip: 'structureOpenSpace',
    does: ['One branch, one implicit Main Store', 'No locations, transfers or branch selector', 'One stock and one average cost per material'],
  },
  {
    mode: 'SingleBranch_WithSubStores', icon: 'warehouse', en: 'Single branch with sub-stores', ar: 'فرع واحد يحتوي على مخزن ومناطق تشغيل',
    tip: 'structureSubStores', does: ['One branch', 'Inventory locations: Main Store, Kitchen, Bar…'], soon: 'Stock per location and internal transfers',
  },
  {
    mode: 'MultiBranch_Independent', icon: 'store', en: 'Several independent branches', ar: 'فروع متعددة تشتري وتعمل بشكل مستقل',
    tip: 'structureIndependent', does: ['Branches, each with its own locations', 'Branch selector at the top of the screen', 'Records kept and listed by branch'],
    soon: 'Stock and cost per branch',
  },
  {
    mode: 'MultiBranch_CentralKitchen', icon: 'soup_kitchen', en: 'Branches with a central kitchen', ar: 'فروع متعددة يدعمها مطبخ مركزي',
    tip: 'structureCentralKitchen', does: ['Everything several branches have', 'A central kitchen or warehouse branch'],
    soon: 'Requisitions, Dispatch & Bill, Receive',
  },
];

interface BranchRow {
  id: string;
  name: string;
  nameAr: string;
  type: BranchType;
  isActive: boolean;
  isDefault: boolean;
  isNew: boolean;
  locations: number;
}

interface LocationRow {
  id: string;
  branchId: string;
  name: string;
  nameAr: string;
  kind: LocationKind;
  isActive: boolean;
  isDefault: boolean;
  isNew: boolean;
}

// Settings → Company structure (هيكل الشركة), a manager's. How the business is built, as four
// cards with their (!) tips: what the app shows and keeps apart follows it, so an open-space shop
// sees nothing of branches or locations. Under them, the branches (with several) and the locations
// each keeps stock in (once the structure has them).
@Component({
  selector: 'app-company-structure-page',
  imports: [FormsModule, InfoTip, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressBarModule, MatSelectModule,
    MatSlideToggleModule, SubNav],
  template: `
    <header class="head">
      <h1>Company structure <span class="inline-ar">هيكل الشركة</span></h1>
    </header>
    <app-sub-nav label="Settings" [tabs]="tabs" />

    <p class="note">
      <span class="note-ar" lang="ar" dir="rtl">اختر كيف تعمل الشركة: من محل واحد بمساحة مفتوحة حتى سلسلة فروع بمطبخ مركزي. ما يظهر في النظام يتبع اختيارك.</span>
      How the business is built, from one open-space shop to a chain with a central kitchen: what the system shows and keeps apart follows it.
    </p>

    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    @if (error(); as message) {
      <p class="error" role="alert">{{ message }}</p>
    }

    @if (structure(); as s) {
      <div class="modes" role="radiogroup" aria-label="Company structure">
        @for (m of modes; track m.mode) {
          <div class="mode" role="radio" tabindex="0" [attr.aria-label]="m.en + ' · ' + m.ar" [attr.aria-checked]="selected() === m.mode"
            [class.selected]="selected() === m.mode"
            [class.current]="s.mode === m.mode" (click)="selected.set(m.mode)" (keydown.enter)="selected.set(m.mode)"
            (keydown.space)="$event.preventDefault(); selected.set(m.mode)">
            <div class="mode-head">
              <mat-icon class="mode-icon">{{ m.icon }}</mat-icon>
              <div class="mode-title">
                <strong>{{ m.en }}</strong>
                <span lang="ar" dir="rtl">{{ m.ar }}</span>
              </div>
              <app-info-tip [tip]="m.tip" (click)="$event.stopPropagation()" />
            </div>
            <ul>
              @for (d of m.does; track d) {
                <li>{{ d }}</li>
              }
              @if (m.soon) {
                <li class="soon"><span class="tag">Soon · قريباً</span> {{ m.soon }}</li>
              }
            </ul>
            <div class="badges">
              @if (s.mode === m.mode) {
                <span class="tag current-tag"><mat-icon>check_circle</mat-icon> Current · الحالي</span>
              }
              @if (m.mode === 'SingleBranch_OpenSpace') {
                <span class="tag">Default · الافتراضي</span>
              }
            </div>
          </div>
        }
      </div>

      @if (selected() !== s.mode) {
        <div class="apply" role="status">
          <mat-icon>info</mat-icon>
          <span>Switch the company to <strong>{{ label(selected()) }}</strong>? {{ effect(selected()) }}</span>
          <span class="spacer"></span>
          <button mat-button type="button" (click)="selected.set(s.mode)">Keep it as it is</button>
          <button mat-flat-button type="button" (click)="apply()" [disabled]="busy()"><mat-icon>account_tree</mat-icon> Switch · تطبيق</button>
        </div>
      }

      <section class="card" aria-labelledby="branches-title">
        <h2 id="branches-title"><mat-icon>store</mat-icon> {{ multi() ? 'Branches' : 'Your branch' }} <span class="inline-ar">{{ multi() ? 'الفروع' : 'الفرع' }}</span></h2>
        @if (!multi()) {
          <p class="muted">One branch: every record is its. Switch to a structure with several branches to add more.</p>
        }
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name · الاسم</th>
                <th>Arabic name · الاسم بالعربي</th>
                @if (multi()) {
                  <th>Type · النوع</th>
                  <th class="num">Locations · المواقع</th>
                  <th>In use · مفعّل</th>
                }
                <th><span class="visually-hidden">Save</span></th>
              </tr>
            </thead>
            <tbody>
              @for (b of visibleBranches(); track b.id) {
                <tr>
                  <td><input class="cell" [(ngModel)]="b.name" maxlength="100" [attr.aria-label]="'Branch name, row ' + ($index + 1)" /></td>
                  <td><input class="cell" [(ngModel)]="b.nameAr" maxlength="100" dir="rtl" [attr.aria-label]="'Arabic name of ' + (b.name || 'the new branch')" /></td>
                  @if (multi()) {
                    <td>
                      <mat-select class="cell-select" [(ngModel)]="b.type" [aria-label]="'Type of ' + (b.name || 'the new branch')">
                        @for (t of branchTypes; track t) {
                          <mat-option [value]="t">{{ branchTypeLabels[t].en }} · {{ branchTypeLabels[t].ar }}</mat-option>
                        }
                      </mat-select>
                    </td>
                    <td class="num">{{ b.locations }}</td>
                    <td>
                      <mat-slide-toggle [(ngModel)]="b.isActive" [disabled]="b.isDefault" [aria-label]="(b.name || 'The new branch') + ' in use'" />
                    </td>
                  }
                  <td class="actions">
                    <button mat-icon-button type="button" (click)="saveBranch(b)" [disabled]="busy() || !b.name.trim()"
                      [attr.aria-label]="'Save ' + (b.name || 'the new branch')"><mat-icon>save</mat-icon></button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        @if (multi()) {
          <button mat-stroked-button type="button" (click)="addBranch()"><mat-icon>add</mat-icon> New branch · فرع جديد</button>
        }
      </section>

      <section class="card" aria-labelledby="locations-title">
        <h2 id="locations-title"><mat-icon>inventory_2</mat-icon> Inventory locations <span class="inline-ar">مواقع المخزون</span></h2>
        @if (!locationsShown()) {
          <p class="muted">An open-space shop keeps everything in one place, its Main Store: there is nothing to choose. · المخزن الرئيسي فقط.</p>
        } @else {
          <p class="muted">Where each branch keeps its stock: its main store, the kitchen, the bar. Stock per location follows in the next release.</p>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  @if (multi()) {
                    <th>Branch · الفرع</th>
                  }
                  <th>Name · الاسم</th>
                  <th>Arabic name · الاسم بالعربي</th>
                  <th>Kind · النوع</th>
                  <th>In use · مفعّل</th>
                  <th><span class="visually-hidden">Save</span></th>
                </tr>
              </thead>
              <tbody>
                @for (l of visibleLocations(); track l.id) {
                  <tr>
                    @if (multi()) {
                      <td>
                        @if (l.isNew) {
                          <mat-select class="cell-select" [(ngModel)]="l.branchId" aria-label="Branch of the new location">
                            @for (b of activeBranches(); track b.id) {
                              <mat-option [value]="b.id">{{ b.name }}</mat-option>
                            }
                          </mat-select>
                        } @else {
                          {{ branchName(l.branchId) }}
                        }
                      </td>
                    }
                    <td><input class="cell" [(ngModel)]="l.name" maxlength="100" [attr.aria-label]="'Location name, row ' + ($index + 1)" /></td>
                    <td><input class="cell" [(ngModel)]="l.nameAr" maxlength="100" dir="rtl" [attr.aria-label]="'Arabic name of ' + (l.name || 'the new location')" /></td>
                    <td>
                      <mat-select class="cell-select" [(ngModel)]="l.kind" [disabled]="l.isDefault" [aria-label]="'Kind of ' + (l.name || 'the new location')">
                        @for (k of locationKinds; track k) {
                          <mat-option [value]="k">{{ locationKindLabels[k].en }} · {{ locationKindLabels[k].ar }}</mat-option>
                        }
                      </mat-select>
                    </td>
                    <td><mat-slide-toggle [(ngModel)]="l.isActive" [disabled]="l.isDefault" [aria-label]="(l.name || 'The new location') + ' in use'" /></td>
                    <td class="actions">
                      <button mat-icon-button type="button" (click)="saveLocation(l)" [disabled]="busy() || !l.name.trim() || !l.branchId"
                        [attr.aria-label]="'Save ' + (l.name || 'the new location')"><mat-icon>save</mat-icon></button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <button mat-stroked-button type="button" (click)="addLocation()"><mat-icon>add</mat-icon> New location · موقع جديد</button>
        }
      </section>
    }
  `,
  styles: `
    .head h1 {
      margin: 0 0 8px;
      font: var(--mat-sys-headline-small);
    }
    h2 {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0 0 8px;
      font: var(--mat-sys-title-medium);
    }
    .muted {
      margin: 0 0 10px;
      color: var(--mat-sys-on-surface-variant);
    }
    .error {
      color: var(--app-danger);
    }
    .modes {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
      gap: 12px;
      margin: 0 0 16px;
    }
    .mode {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 14px 16px;
      border-radius: 14px;
      border: 1px solid var(--app-line);
      background: var(--mat-sys-surface-container-lowest);
      box-shadow: var(--app-card-shadow);
      cursor: pointer;
      outline: none;

      &:focus-visible {
        outline: 2px solid var(--mat-sys-primary);
        outline-offset: 2px;
      }
      &.selected {
        border: 2px solid var(--mat-sys-primary);
        padding: 13px 15px;
      }
      ul {
        margin: 0;
        padding-inline-start: 18px;
        font: var(--mat-sys-body-small);
        color: var(--mat-sys-on-surface-variant);
      }
      .soon {
        list-style: none;
        margin-inline-start: -18px;
      }
    }
    .mode-head {
      display: flex;
      align-items: flex-start;
      gap: 10px;
    }
    .mode-icon {
      flex: none;
      color: var(--mat-sys-primary);
    }
    .mode-title {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 2px;

      span {
        font: var(--mat-sys-body-small);
        color: var(--mat-sys-on-surface-variant);
        text-align: start;
      }
    }
    .badges {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: auto;
    }
    .tag {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 999px;
      background: var(--tag-neutral-bg);
      color: var(--tag-neutral-fg);
      font: var(--mat-sys-label-small);

      mat-icon {
        width: 14px;
        height: 14px;
        font-size: 14px;
      }
    }
    .current-tag {
      background: var(--tag-ok-bg);
      color: var(--tag-ok-fg);
    }
    .soon .tag {
      background: var(--tag-accent-bg);
      color: var(--tag-accent-fg);
    }
    .apply {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
      margin: 0 0 16px;
      padding: 10px 14px;
      border-radius: 12px;
      background: var(--tag-info-bg);
      color: var(--tag-info-fg);

      .spacer {
        flex: 1;
      }
    }
    .card {
      margin: 0 0 16px;
      padding: 16px 20px;
      border-radius: 16px;
      border: 1px solid var(--app-line);
      background: var(--mat-sys-surface-container-lowest);
      box-shadow: var(--app-card-shadow);
    }
    .table-wrap {
      overflow-x: auto;
      margin-bottom: 10px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th,
    td {
      padding: 6px 8px;
      text-align: start;
      border-bottom: 1px solid var(--app-line);
    }
    th {
      font: var(--mat-sys-label-medium);
      color: var(--mat-sys-on-surface-variant);
      white-space: nowrap;
    }
    .num {
      text-align: end;
    }
    .cell {
      width: 100%;
      min-width: 120px;
      padding: 6px 8px;
      border: 1px solid var(--app-line);
      border-radius: 8px;
      background: transparent;
      color: inherit;
      font: inherit;
    }
    .cell-select {
      min-width: 160px;
    }
    .actions {
      width: 48px;
    }
  `,
})
export class CompanyStructurePage implements OnInit {
  private readonly api = inject(CompanyStructureApi);
  private readonly notify = inject(NotifyService);
  private readonly company = inject(Company);
  private readonly branchContext = inject(BranchContext);

  protected readonly tabs = settingsTabs;
  protected readonly modes = modes;
  protected readonly branchTypes: BranchType[] = ['Restaurant', 'CentralKitchen', 'CentralWarehouse'];
  protected readonly branchTypeLabels = branchTypeLabels;
  protected readonly locationKinds: LocationKind[] = ['MainStore', 'Kitchen', 'Bar', 'Other'];
  protected readonly locationKindLabels = locationKindLabels;

  protected readonly structure = signal<CompanyStructure | null>(null);
  protected readonly selected = signal<OperatingMode>('SingleBranch_OpenSpace');
  protected readonly branches = signal<BranchRow[]>([]);
  protected readonly locations = signal<LocationRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  // As saved: what the tables show follows the structure the company has, not the card clicked.
  protected readonly multi = computed(() => isMultiBranch(this.structure()?.mode));
  protected readonly locationsShown = computed(() => hasLocations(this.structure()?.mode));
  protected readonly visibleBranches = computed(() => (this.multi() ? this.branches() : this.branches().filter((b) => b.isDefault)));
  protected readonly activeBranches = computed(() => this.branches().filter((b) => b.isActive && !b.isNew));
  protected readonly visibleLocations = computed(() =>
    this.multi() ? this.locations() : this.locations().filter((l) => l.isNew || l.branchId === this.branches().find((b) => b.isDefault)?.id),
  );

  ngOnInit(): void {
    void this.load();
  }

  protected label(mode: OperatingMode): string {
    const card = modes.find((m) => m.mode === mode)!;
    return `${card.en} · ${card.ar}`;
  }

  protected effect(mode: OperatingMode): string {
    if (mode === 'SingleBranch_OpenSpace') {
      return 'Locations and the branch selector are hidden; everything works as one store.';
    }
    if (mode === 'SingleBranch_WithSubStores') {
      return 'Inventory locations can be added for your one branch.';
    }
    return 'Branches can be added, and a branch selector appears at the top of the screen for whoever works every branch.';
  }

  protected branchName(id: string): string {
    return this.branches().find((b) => b.id === id)?.name ?? '';
  }

  protected async apply(): Promise<void> {
    this.busy.set(true);
    try {
      const saved = await firstValueFrom(this.api.setMode(this.selected()));
      this.show(saved);
      this.company.settings.update((s) => ({ ...s, operatingMode: saved.mode }));
      await this.branchContext.load();
      this.notify.info(`The company is now: ${this.label(saved.mode)}.`);
    } catch (error) {
      this.notify.error(error, 'The structure could not be changed.');
    } finally {
      this.busy.set(false);
    }
  }

  protected addBranch(): void {
    this.branches.update((rows) => [
      ...rows,
      { id: crypto.randomUUID(), name: '', nameAr: '', type: 'Restaurant', isActive: true, isDefault: false, isNew: true, locations: 0 },
    ]);
  }

  protected addLocation(): void {
    const first = this.branches().find((b) => b.isDefault)?.id ?? '';
    this.locations.update((rows) => [
      ...rows,
      { id: crypto.randomUUID(), branchId: first, name: '', nameAr: '', kind: 'Kitchen', isActive: true, isDefault: false, isNew: true },
    ]);
  }

  protected async saveBranch(row: BranchRow): Promise<void> {
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.saveBranch(row.id, { name: row.name.trim(), nameAr: row.nameAr.trim() || null, type: row.type, isActive: row.isActive }));
      this.notify.info(`${row.name.trim()} saved. · تم حفظ الفرع.`);
      await this.load();
      await this.branchContext.load();
    } catch (error) {
      this.notify.error(error, 'The branch could not be saved.');
    } finally {
      this.busy.set(false);
    }
  }

  protected async saveLocation(row: LocationRow): Promise<void> {
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.saveLocation(row.id, {
        branchId: row.branchId, name: row.name.trim(), nameAr: row.nameAr.trim() || null, kind: row.kind, isActive: row.isActive,
      }));
      this.notify.info(`${row.name.trim()} saved. · تم حفظ الموقع.`);
      await this.load();
    } catch (error) {
      this.notify.error(error, 'The location could not be saved.');
    } finally {
      this.busy.set(false);
    }
  }

  private show(s: CompanyStructure): void {
    this.structure.set(s);
    this.selected.set(s.mode);
    this.branches.set(s.branches.map((b) => ({ ...b, nameAr: b.nameAr ?? '', isNew: false })));
    this.locations.set(s.locations.map((l) => ({ ...l, nameAr: l.nameAr ?? '', isNew: false })));
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.show(await firstValueFrom(this.api.get()));
    } catch (error) {
      this.error.set(errorMessage(error, 'The company structure could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }
}
