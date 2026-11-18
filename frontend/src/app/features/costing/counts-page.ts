import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { Permissions } from '../../core/auth/permissions';
import {
  CostingApi,
  ApprovalRequest,
  CountPreset,
  CountPresets,
  StockCountKind,
  StockCountSummary,
  countKindLabels,
  countReviewLabels,
  countScopeLabels,
} from '../../core/costing/costing.api';
import { NotifyService } from '../../core/ui/notify.service';
import { InfoTip } from './info-tip';
import { errorMessage } from '../../core/http/error-message';
import { Approvals, pendingLabel } from './approvals';
import { FilterOption, FilterSelect } from '../shared/filter-select';
import { SearchField } from '../shared/search-field';
import { SortOption, SortState, smartMatch, sortItems } from '../shared/smart-search';
import { SortControl } from '../shared/sort-control';
import { LocationSelect, locationParam } from './location-select';

type CountSort = 'date' | 'materials';

const countSorts: SortOption<CountSort>[] = [
  { key: 'date', en: 'Date', ar: 'التاريخ', descending: true },
  { key: 'materials', en: 'Materials counted', ar: 'عدد الخامات', descending: true },
];

// Physical counts of the stores: the one being filled in, if any, and the posted ones. The
// variance report measures between two posted counts, so the stores are counted at the same
// point each week, with the kitchen closed. The first, when costing starts, is the opening stock
// (جرد افتتاحي): where stock begins, with no shortage or surplus; every one after is periodic
// (جرد دوري), what it finds against the records a shortage or a surplus: a full count of every
// material, or a spot count (جرد يومي سريع) started here from a ready list (the daily critical
// items starred, class A, the high variance, a category), which moves only what it counts. A
// count handed in by a counter who counts blind waits here for a manager or cost controller.
@Component({
  selector: 'app-counts-page',
  imports: [
    LocationSelect,
    DatePipe,
    FilterSelect,
    InfoTip,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatProgressBarModule,
    MatSelectModule,
    MatTooltipModule,
    RouterLink,
    SearchField,
    SortControl,
  ],
  template: `
    <div class="kinds">
      <p class="note">
        <strong>Opening stock</strong><span class="inline-ar">جرد افتتاحي</span> <app-info-tip tip="countOpening" />: once, when you start: where each
        material's stock begins.
      </p>
      <p class="note">
        <strong>Full count</strong><span class="inline-ar">جرد شامل</span> <app-info-tip tip="countFull" />: every material, weekly, with the kitchen closed.
      </p>
      <p class="note">
        <strong>Daily spot count</strong><span class="inline-ar">جرد يومي سريع</span> <app-info-tip tip="countSpot" />: a few critical materials, every day;
        nothing else moves.
      </p>
      <p class="note">
        <strong>Blind count</strong><span class="inline-ar">الجرد الأعمى</span> <app-info-tip tip="countBlind" />: the counter never sees the book; a
        manager or cost controller reconciles.
      </p>
    </div>
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    } @else if (error()) {
      <p class="error">{{ error() }}</p>
    } @else {
      <div class="toolbar">
        @if (draft(); as d) {
          <span>
            <strong>{{ d.startedBy || 'Someone' }}</strong> started a count at {{ d.startedAtUtc | date: 'd MMM, HH:mm' }}:
            {{ d.materials }} {{ d.materials === 1 ? 'material' : 'materials' }} counted so far{{ d.scope === 'Spot' ? ' of ' + d.scopeSize : '' }}.
          </span>
          <span class="kind" [class.opening]="d.kind === 'Opening'">{{ kindLabels[d.kind].en }}<span class="ar">{{ kindLabels[d.kind].ar }}</span></span>
          @if (d.scope === 'Spot') {
            <span class="kind spot">{{ d.scopeLabel ?? scopeLabels.Spot.en }}<span class="ar">{{ scopeLabels.Spot.ar }}</span></span>
          }
          @if (d.review && d.review !== 'Counting') {
            <span class="review" [class]="d.review">{{ reviewLabels[d.review].en }}<span class="ar">{{ reviewLabels[d.review].ar }}</span></span>
          }
          <a mat-flat-button [routerLink]="['/costing/counts', d.id]">
            <mat-icon>{{ d.review === 'Submitted' && canReconcile ? 'rate_review' : 'edit_note' }}</mat-icon>
            {{ d.review === 'Submitted' && canReconcile ? 'Review the count · مراجعة الجرد' : 'Continue the count' }}
          </a>
        } @else if (posted().length === 0) {
          <app-location-select [(value)]="countAt" [wholeBranch]="true" label="Count where · مكان الجرد" ariaLabel="Count where" />
          <button mat-flat-button (click)="start('Opening')"><mat-icon>inventory</mat-icon> Opening stock <span class="inline-ar">جرد افتتاحي</span></button>
          <button mat-stroked-button (click)="start('Periodic')"><mat-icon>add</mat-icon> Full count <span class="inline-ar">جرد شامل</span></button>
        } @else {
          <app-location-select [(value)]="countAt" [wholeBranch]="true" label="Count where · مكان الجرد" ariaLabel="Count where" />
          <button mat-flat-button (click)="start('Periodic')"><mat-icon>add</mat-icon> Full count <span class="inline-ar">جرد شامل</span></button>
          <button mat-stroked-button (click)="start('Opening')" matTooltip="For materials never counted yet: a material is opened once">
            <mat-icon>inventory</mat-icon> Opening stock <span class="inline-ar">جرد افتتاحي</span>
          </button>
        }
        <span class="spacer"></span>
        @if (posted().length >= 2 && hasPeriodic()) {
          <a mat-button routerLink="/costing/reports/variance"><mat-icon>compare_arrows</mat-icon> Variance since the last count</a>
        }
      </div>
      @if (!draft()) {
        <section class="spot" aria-labelledby="spot-title">
          <h3 id="spot-title"><mat-icon>bolt</mat-icon> Start a spot count · جرد يومي سريع / جزئي <app-info-tip tip="countSpot" /></h3>
          @if (presets(); as p) {
            <div class="presets">
              @for (preset of p.presets; track preset.key) {
                <button mat-stroked-button (click)="startSpot(preset.materialIds, preset.name)" [disabled]="!preset.materialIds.length || starting()"
                  [attr.aria-label]="preset.name + ', ' + preset.materialIds.length + ' materials'">
                  <mat-icon>{{ presetIcons[preset.key] }}</mat-icon> {{ preset.name }} · {{ preset.nameAr }}
                  <span class="n">{{ preset.materialIds.length }}</span>
                </button>
              }
              <mat-form-field subscriptSizing="dynamic" class="category">
                <mat-label>By category · حسب قسم محدد</mat-label>
                <mat-select (selectionChange)="startCategory($event.value)" [disabled]="starting()" aria-label="Spot count by category">
                  @for (c of p.categories; track c.categoryId) {
                    <mat-option [value]="c.categoryId">{{ c.name }}{{ c.nameAr ? ' · ' + c.nameAr : '' }} ({{ c.materialIds.length }})</mat-option>
                  }
                </mat-select>
              </mat-form-field>
              @if (p.stations?.length) {
                <mat-form-field subscriptSizing="dynamic" class="category">
                  <mat-label>By station · حسب قسم المطبخ</mat-label>
                  <mat-select (selectionChange)="startStation($event.value)" [disabled]="starting()" aria-label="Spot count by station">
                    @for (s of p.stations; track s.stationId) {
                      <mat-option [value]="s.stationId">{{ s.name }}{{ s.nameAr ? ' · ' + s.nameAr : '' }} ({{ s.materialIds.length }})</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
              }
            </div>
            @if (!p.presets[0].materialIds.length) {
              <p class="muted small">
                No daily critical items yet: star them (☆) on Raw materials or Prep items. · حدد أصناف الجرد اليومي بالنجمة.
              </p>
            }
          } @else if (presetsError()) {
            <p class="error small">{{ presetsError() }}</p>
          } @else {
            <mat-progress-bar mode="indeterminate" />
          }
        </section>
      }
      @if (done().length > 1) {
        <div class="toolbar smart">
          <app-search-field [(value)]="search" placeholder="Who started or posted it · بواسطة" />
          <div class="pills">
            <app-filter-select label="Type · النوع" icon="inventory" [options]="kindFilters()" [(value)]="kind" />
            <app-filter-select label="Status · الحالة" icon="flag" [options]="statusFilters()" [(value)]="status" />
            <app-sort-control [options]="sorts" [(sort)]="sort" />
          </div>
        </div>
      }
      <div class="table-wrap">
        <table class="grid">
          <thead>
            <tr>
              <th>Posted<span class="ar">تاريخ الترحيل</span></th>
              <th>Type<span class="ar">نوع الجرد</span></th>
              <th>By<span class="ar">بواسطة</span></th>
              <th class="num">Materials counted<span class="ar">الخامات المجرودة</span></th>
              <th class="num"><span class="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (count of shownDone(); track count.id) {
              <tr class="clickable" [class.voided]="count.status === 'Voided'" [class.pending-deletion]="!!pendingOf(count)" (click)="open(count)">
                <td>
                  {{ count.postedAtUtc | date: 'EEE d MMM y, HH:mm' }}
                  @if (count.status === 'Voided') {
                    <div><span class="voided-badge">Voided<span class="ar">ملغى</span></span>
                      <span class="muted small"> by {{ count.voidedBy }}, {{ count.voidedAtUtc | date: 'd MMM' }}</span></div>
                  } @else if (pendingOf(count); as p) {
                    <div><span class="pending-badge">{{ pendingLabel(p).en }}<span class="ar">{{ pendingLabel(p).ar }}</span></span>
                      <span class="muted small"> by {{ p.requestedBy }}</span></div>
                  }
                </td>
                <td>
                  <span class="kind" [class.opening]="count.kind === 'Opening'">{{ kindLabels[count.kind].en }}<span class="ar">{{ kindLabels[count.kind].ar }}</span></span>
                  @if (count.scope === 'Spot') {
                    <span class="kind spot" [title]="count.scopeLabel ?? ''">{{ scopeLabels.Spot.en }}<span class="ar">{{ scopeLabels.Spot.ar }}</span></span>
                  }
                </td>
                <td>{{ count.postedBy }}</td>
                <td class="num">{{ count.materials }}</td>
                <td class="num" (click)="$event.stopPropagation()">
                  @if (count.status === 'Posted') {
                    @if (pendingOf(count)) {
                      <mat-icon class="locked" matTooltip="Waiting for a manager's approval" aria-label="Locked: deletion requested">lock_clock</mat-icon>
                    } @else {
                      <button mat-icon-button class="danger" (click)="remove(count)" matTooltip="Delete (void)" aria-label="Delete this count">
                        <mat-icon>delete</mat-icon>
                      </button>
                    }
                  }
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="5" class="muted">
                  No counts posted yet. Start with the opening stock: what is on the shelves now, where the next count is measured from.
                  <span class="inline-ar">ابدأ بالجرد الافتتاحي.</span>
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
    .kinds {
      display: grid;
      // Four kinds: one column on a phone, two on a tablet, four on a wide screen; never three and one.
      grid-template-columns: 1fr;
      gap: 8px;

      @media (min-width: 600px) {
        grid-template-columns: repeat(2, 1fr);
      }

      @media (min-width: 1280px) {
        grid-template-columns: repeat(4, 1fr);
      }

      .note {
        margin: 0;
      }
    }
    .kind {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 12px;
      background: var(--mat-sys-surface-container-high);
      font: var(--mat-sys-label-medium);
      white-space: nowrap;

      .ar {
        display: inline;
        margin-left: 6px;
      }
      &.opening {
        background: var(--mat-sys-tertiary-container);
        color: var(--mat-sys-on-tertiary-container);
      }
    }
    .kind.spot {
      margin-inline-start: 4px;
      background: color-mix(in srgb, var(--mat-sys-primary) 12%, transparent);
      color: var(--mat-sys-primary);
    }
    .review {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 12px;
      font: var(--mat-sys-label-medium);
      white-space: nowrap;

      .ar {
        display: inline;
        margin-left: 6px;
      }
      &.Submitted {
        background: color-mix(in srgb, var(--mat-sys-primary) 12%, transparent);
      }
      &.RecountRequested {
        background: color-mix(in srgb, var(--app-warn) 18%, transparent);
        color: var(--app-warn);
      }
    }
    .spot {
      margin: 4px 0 12px;
      padding: 12px 14px;
      border-radius: 14px;
      border: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface-container-lowest);

      h3 {
        display: flex;
        align-items: center;
        gap: 6px;
        margin: 0 0 8px;
        font: var(--mat-sys-title-small);
      }
      .presets {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
      }
      .n {
        margin-inline-start: 6px;
        padding: 0 7px;
        border-radius: 999px;
        font: var(--mat-sys-label-small);
        background: var(--mat-sys-surface-container-high);
      }
      .category {
        width: 240px;
      }

      // On a phone: one list a row, its name free to wrap, and the category across.
      @media (max-width: 599px) {
        .presets {
          flex-direction: column;
          align-items: stretch;
        }
        .presets button {
          height: auto;
          min-height: 40px;
          padding-block: 8px;
          border-radius: 12px;
          justify-content: flex-start;
          text-align: start;
          white-space: normal;
          line-height: 1.35;
        }
        .category {
          width: 100%;
        }
      }
    }
    .danger {
      color: var(--mat-sys-error);
    }
    .small {
      font-size: 0.85em;
    }
    tr.voided td {
      color: var(--mat-sys-on-surface-variant);
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
export class CountsPage {
  protected readonly pendingLabel = pendingLabel;
  protected readonly kindLabels = countKindLabels;
  protected readonly scopeLabels = countScopeLabels;
  protected readonly reviewLabels = countReviewLabels;
  protected readonly presetIcons: Record<CountPreset['key'], string> = { critical: 'star', classA: 'workspace_premium', highVariance: 'trending_down' };
  private readonly api = inject(CostingApi);
  private readonly router = inject(Router);
  private readonly approvals = inject(Approvals);
  private readonly notify = inject(NotifyService);
  // Who reconciles a count handed in: who sees the costs.
  protected readonly canReconcile = inject(AuthService).can(Permissions.CostingView);

  // A spot count's ready lists, read once there is no draft open.
  protected readonly presets = signal<CountPresets | null>(null);
  protected readonly presetsError = signal<string | null>(null);
  protected readonly starting = signal(false);

  protected readonly counts = signal<StockCountSummary[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly draft = computed(() => this.counts().find((c) => c.status === 'Draft') ?? null);
  protected readonly posted = computed(() => this.counts().filter((c) => c.status === 'Posted'));
  // The variance report ends at a periodic count.
  protected readonly hasPeriodic = computed(() => this.posted().some((c) => c.kind === 'Periodic'));
  // Posted, and voided since: kept, marked so.
  protected readonly done = computed(() => this.counts().filter((c) => c.status !== 'Draft'));

  protected readonly search = signal('');
  protected readonly kind = signal('');
  protected readonly status = signal('');
  protected readonly sorts = countSorts;
  protected readonly sort = signal<SortState<CountSort>>({ key: 'date', direction: -1 });

  protected readonly kindFilters = computed<FilterOption[]>(() => [
    { value: '', label: 'All · الكل', count: this.done().length },
    ...(['Periodic', 'Opening'] as const).map((k) => ({
      value: k, label: `${countKindLabels[k].en} · ${countKindLabels[k].ar}`, count: this.done().filter((c) => c.kind === k).length,
    })),
  ]);

  protected readonly statusFilters = computed<FilterOption[]>(() => [
    { value: '', label: 'All · الكل', count: this.done().length },
    { value: 'Posted', label: 'Posted · مُرحّل', count: this.done().filter((c) => c.status === 'Posted').length },
    { value: 'Voided', label: 'Voided · ملغى', count: this.done().filter((c) => c.status === 'Voided').length },
  ]);

  protected readonly shownDone = computed(() =>
    sortItems(
      this.done().filter(
        (c) => (!this.kind() || c.kind === this.kind()) && (!this.status() || c.status === this.status()) && smartMatch(this.search(), c.startedBy, c.postedBy),
      ),
      this.sort(),
      (c, key) => (key === 'materials' ? c.materials : c.postedAtUtc),
    ),
  );

  constructor() {
    void this.load();
  }

  // Where the next count is counted: a location of the branch, or the whole branch (with locations only).
  protected readonly countAt = signal<string | null>(null);

  // A new count's id is made here; it is saved, of its kind, on its first entry.
  protected start(kind: StockCountKind): void {
    const location = locationParam(this.countAt());
    void this.router.navigate(['/costing/counts', crypto.randomUUID()], { queryParams: { kind, ...(location ? { location } : {}) } });
  }

  // A spot count started here, with what it covers, then counted on its sheet.
  protected async startSpot(materialIds: string[], label: string): Promise<void> {
    if (!materialIds.length) {
      return;
    }
    this.starting.set(true);
    const id = crypto.randomUUID();
    try {
      await firstValueFrom(
        this.api.saveStockCount(id, [], 'Periodic', { scope: 'Spot', scopeMaterialIds: materialIds, scopeLabel: label }, false, locationParam(this.countAt())),
      );
      void this.router.navigate(['/costing/counts', id]);
    } catch (error) {
      this.notify.error(error, 'The spot count could not be started.');
    } finally {
      this.starting.set(false);
    }
  }

  protected startCategory(categoryId: string): void {
    const category = this.presets()?.categories.find((c) => c.categoryId === categoryId);
    if (category) {
      void this.startSpot(category.materialIds, category.nameAr ? `${category.name} · ${category.nameAr}` : category.name);
    }
  }

  // A station's materials and prep items, for a count at its shift's close; printed blind from the sheet.
  protected startStation(stationId: string): void {
    const station = this.presets()?.stations?.find((s) => s.stationId === stationId);
    if (station) {
      void this.startSpot(station.materialIds, station.nameAr ? `${station.name} · ${station.nameAr}` : station.name);
    }
  }

  protected open(count: StockCountSummary): void {
    void this.router.navigate(['/costing/counts', count.id]);
  }

  protected pendingOf(count: StockCountSummary): ApprovalRequest | undefined {
    return this.approvals.pendingFor(count.id);
  }

  // Voided for a manager (its adjustments undone); asked of one for anyone else.
  protected async remove(count: StockCountSummary): Promise<void> {
    const day = new Date(count.postedAtUtc!).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const what = count.kind === 'Opening' ? `the opening stock of ${day}` : `the count of ${day}`;
    if ((await this.approvals.delete('StockCount', count.id, what)) === 'Applied') {
      await this.load();
    }
  }

  private async load(): Promise<void> {
    void this.approvals.refresh();
    try {
      this.counts.set(await firstValueFrom(this.api.stockCounts()));
      if (!this.draft()) {
        void this.loadPresets();
      }
    } catch (error) {
      this.error.set(errorMessage(error, 'The stock counts could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }

  private async loadPresets(): Promise<void> {
    try {
      this.presets.set(await firstValueFrom(this.api.countPresets()));
    } catch (error) {
      this.presetsError.set(errorMessage(error, 'The spot count lists could not be loaded.'));
    }
  }
}
