import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import { CostingApi, ApprovalRequest, MaterialCost, SpoilageEntry, countUnit } from '../../core/costing/costing.api';
import { EmployeePicker } from '../../core/costing/employee-picker';
import { BreakageEntry, MenuSalesApi } from '../../core/costing/menu-sales.api';
import { Employee } from '../../core/costing/staff';
import { errorMessage } from '../../core/http/error-message';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { NotifyService } from '../../core/ui/notify.service';
import { Approvals } from './approvals';
import { BusinessDay } from './financials';
import { FilterOption, FilterSelect } from '../shared/filter-select';
import { SearchField } from '../shared/search-field';
import { SortOption, SortState, smartMatch, sortItems } from '../shared/smart-search';
import { SortControl } from '../shared/sort-control';
import { GridKeys } from '../shared/grid-keys';
import { MaterialPicker } from './material-picker';

type WasteSort = 'date' | 'worth';

const wasteSorts: SortOption<WasteSort>[] = [
  { key: 'date', en: 'Date', ar: 'التاريخ', descending: true },
  { key: 'worth', en: 'Worth', ar: 'القيمة', descending: true },
];

interface Line {
  rawMaterialId: string | null;
  quantity: number | null;
  reason: string;
  other: string;
}

// Raw stock thrown away: expired, spoiled, dropped. Recorded, it takes the stock off and the
// variance report sets it against the shortfall, so a loss with a reason is not mistaken for
// one without. Dishes voided after the kitchen made them are recorded by their sale's void.
// Below, the breakage (الكسر): plates, glasses and other consumables broken, at their cost, entered
// here; no stock moves. Voided, as the waste is, through a manager.
@Component({
  selector: 'app-waste-page',
  imports: [
    FilterSelect,
    GridKeys,
    MaterialPicker,
    SearchField,
    SortControl,
    DatePipe,
    DecimalPipe,
    EmployeePicker,
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
    MatTooltipModule,
    MoneyPipe,
  ],
  template: `
    <p class="note">
      Record raw stock thrown away, with why. A dish voided after the kitchen made it is recorded by the void.
      <span class="inline-ar">سجّل الخامات التالفة وسببها.</span>
    </p>
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    } @else if (error()) {
      <p class="error">{{ error() }}</p>
    } @else {
      <div class="table-wrap">
        <table class="grid" appGridKeys (appGridKeysAppend)="add()">
          <thead>
            <tr>
              <th>Material<span class="ar">الخامة</span></th>
              <th class="num">Quantity<span class="ar">الكمية</span></th>
              <th>Why<span class="ar">السبب</span></th>
              <th class="num">Worth<span class="ar">القيمة</span></th>
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
                    <input matInput type="number" min="0" step="any" [ngModel]="line.quantity" (ngModelChange)="change(i, { quantity: $event })" [attr.aria-label]="'Quantity, line ' + (i + 1)" />
                    <span matTextSuffix>&nbsp;{{ unitOf(line) }}</span>
                  </mat-form-field>
                </td>
                <td>
                  <mat-form-field subscriptSizing="dynamic" class="reason">
                    <mat-select [ngModel]="line.reason" (ngModelChange)="change(i, { reason: $event })" [aria-label]="'Why, line ' + (i + 1)">
                      @for (r of reasons; track r.en) {
                        <mat-option [value]="r.en">{{ r.en }} · {{ r.ar }}</mat-option>
                      }
                    </mat-select>
                  </mat-form-field>
                  @if (line.reason === 'Other') {
                    <mat-form-field subscriptSizing="dynamic" class="reason">
                      <input matInput maxlength="200" placeholder="What happened" [ngModel]="line.other" (ngModelChange)="change(i, { other: $event })" [attr.aria-label]="'What happened, line ' + (i + 1)" />
                    </mat-form-field>
                  }
                </td>
                <td class="num">{{ worth(line) === null ? '' : (worth(line) | money) }}</td>
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
              <td class="num">{{ total() | money }}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div class="toolbar actions">
        <span class="spacer"></span>
        <button mat-flat-button (click)="save()" [disabled]="!ready() || saving()"><mat-icon>delete_sweep</mat-icon> Record waste</button>
      </div>

      <h2 class="recent">Last 30 days <span class="inline-ar">آخر ٣٠ يومًا</span></h2>
      <div class="toolbar smart">
        <app-search-field [(value)]="historySearch" placeholder="Material or who recorded it · الخامة أو المسجل" />
        <div class="pills">
          <app-filter-select label="Why · السبب" icon="help" [options]="reasonFilters()" [(value)]="historyReason" />
          <app-sort-control [options]="wasteSorts" [(sort)]="historySort" />
        </div>
      </div>
      <div class="table-wrap">
        <table class="grid">
          <thead>
            <tr>
              <th>When<span class="ar">التاريخ</span></th>
              <th>Material<span class="ar">الخامة</span></th>
              <th class="num">Quantity<span class="ar">الكمية</span></th>
              <th>Why<span class="ar">السبب</span></th>
              <th>By<span class="ar">بواسطة</span></th>
              <th class="num">Worth<span class="ar">القيمة</span></th>
              <th class="num"><span class="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (entry of shownRecent(); track entry.spoilageId) {
              @for (l of entry.lines; track l.rawMaterialId; let first = $first) {
                <tr [class.pending-deletion]="!!pendingOf(entry)" [class.focused]="entry.spoilageId === spoilage()" [attr.id]="first ? 'spoilage-' + entry.spoilageId : null">
                  <td>
                    @if (first) {
                      {{ entry.recordedAtUtc | date: 'd MMM, HH:mm' }}
                      @if (pendingOf(entry); as p) {
                        <div><span class="pending-badge">Deletion requested<span class="ar">طلب حذف</span></span></div>
                        <div class="muted note-small">by {{ p.requestedBy }}</div>
                      }
                    }
                  </td>
                  <td>{{ l.material }}</td>
                  <td class="num">{{ l.quantity / unitFor(l).size | number: '1.0-3' }} {{ unitFor(l).label }}</td>
                  <td>{{ l.reason }}</td>
                  <td>{{ first ? entry.recordedBy : '' }}</td>
                  <td class="num">{{ l.value === null ? 'No price' : (l.value | money) }}</td>
                  <td class="num">
                    @if (first) {
                      @if (pendingOf(entry)) {
                        <mat-icon class="locked" matTooltip="Waiting for a manager's approval" aria-label="Locked: deletion requested">lock_clock</mat-icon>
                      } @else {
                        <button mat-icon-button class="danger" (click)="voidEntry(entry)" matTooltip="Delete (void)" aria-label="Delete this waste entry">
                          <mat-icon>delete</mat-icon>
                        </button>
                      }
                    }
                  </td>
                </tr>
              }
            } @empty {
              <tr><td colspan="7" class="muted">Nothing recorded.</td></tr>
            }
          </tbody>
          @if (recent().length) {
            <tfoot>
              <tr>
                <td colspan="5">Total · الإجمالي</td>
                <td class="num">{{ recentTotal() | money }}</td>
                <td></td>
              </tr>
            </tfoot>
          }
        </table>
      </div>

      <h2 class="recent">Breakage, last 30 days <span class="inline-ar">الكسر</span></h2>
      <p class="muted tiny">Plates, glasses and other consumables broken, at their cost: a cost of the day, no stock moves.</p>
      <form class="breakage-form" (ngSubmit)="recordBreakage()" aria-label="Record breakage">
        <mat-form-field subscriptSizing="dynamic" class="what">
          <mat-label>What broke · الصنف</mat-label>
          <input matInput name="bDescription" [(ngModel)]="breakageDraft.description" maxlength="150" required />
        </mat-form-field>
        <mat-form-field subscriptSizing="dynamic" class="small">
          <mat-label>How many · العدد</mat-label>
          <input matInput type="number" min="1" step="1" name="bQuantity" [(ngModel)]="breakageDraft.quantity" required />
        </mat-form-field>
        <mat-form-field subscriptSizing="dynamic" class="small">
          <mat-label>A piece's cost · تكلفة القطعة</mat-label>
          <input matInput type="number" min="0" step="0.01" name="bCost" [(ngModel)]="breakageDraft.unitCost" />
        </mat-form-field>
        <app-employee-picker [employees]="activeStaff()" [(value)]="breakageDraft.employeeId" [none]="true" noneLabel="No one · لا أحد"
          label="Whose · بواسطة من" ariaLabel="Who broke it" />
        <mat-form-field subscriptSizing="dynamic" class="reason">
          <mat-label>Notes · ملاحظات</mat-label>
          <input matInput name="bNotes" [(ngModel)]="breakageDraft.notes" maxlength="300" />
        </mat-form-field>
        <button mat-flat-button type="submit" [disabled]="savingBreakage() || !breakageDraft.description.trim() || !(breakageDraft.quantity >= 1)">
          <mat-icon>add</mat-icon> Record breakage <span class="inline-ar">تسجيل كسر</span>
        </button>
      </form>
      <div class="table-wrap">
        <table class="grid" aria-label="Breakage">
          <thead>
            <tr>
              <th>Day<span class="ar">اليوم</span></th>
              <th>What broke<span class="ar">الصنف</span></th>
              <th class="num">How many<span class="ar">العدد</span></th>
              <th>Who broke it<span class="ar">بواسطة من</span></th>
              <th class="num">Cost<span class="ar">التكلفة</span></th>
              <th>By<span class="ar">بواسطة</span></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (b of breakage(); track b.id) {
              <tr [class.voided]="b.isVoided">
                <td class="nowrap">{{ b.businessDate | date: 'd MMM' }}</td>
                <td>
                  <strong>{{ b.description }}</strong>
                  @if (b.notes) {
                    <div class="muted tiny">{{ b.notes }}</div>
                  }
                </td>
                <td class="num">{{ b.quantity }}</td>
                <td>{{ b.employeeName ?? '—' }}</td>
                <td class="num">{{ b.unitCost === null ? 'Cost not known' : (b.cost | money) }}</td>
                <td class="muted tiny">{{ b.recordedBy }}</td>
                <td class="actions">
                  @if (b.isVoided) {
                    <span class="muted tiny">Voided · ملغي</span>
                  } @else if (approvals.pendingFor(b.id); as request) {
                    <span class="pending-badge">Void requested<span class="ar">طلب إلغاء</span></span>
                  } @else {
                    <button mat-icon-button (click)="voidBreakage(b)" [attr.aria-label]="'Void the breakage of ' + b.description" matTooltip="Void · إلغاء">
                      <mat-icon>undo</mat-icon>
                    </button>
                  }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="7" class="muted">Nothing broken.</td></tr>
            }
          </tbody>
          @if (breakage().length) {
            <tfoot>
              <tr>
                <td colspan="4">Total · الإجمالي</td>
                <td class="num">{{ breakageTotal() | money }}</td>
                <td colspan="2"></td>
              </tr>
            </tfoot>
          }
        </table>
      </div>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    tr.focused td {
      background: color-mix(in srgb, var(--mat-sys-primary) 10%, transparent);
    }
    .breakage-form {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin: 8px 0 12px;
    }
    .breakage-form .what {
      min-width: 200px;
    }
    .material {
      min-width: 200px;
      width: 100%;
    }
    .small {
      width: 140px;
    }
    .reason {
      width: 220px;
    }
    .actions {
      margin-top: 12px;
    }
    .recent {
      margin: 24px 0 8px;
      font: var(--mat-sys-title-medium);
    }
    .tiny {
      font-size: 0.85em;
    }
    .nowrap {
      white-space: nowrap;
    }
    tr.voided td {
      text-decoration: line-through;
      color: var(--mat-sys-on-surface-variant);
    }
    .danger {
      color: var(--mat-sys-error);
    }
    .note-small {
      font-size: 0.85em;
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
export class WastePage {
  private readonly api = inject(CostingApi);
  private readonly notify = inject(NotifyService);
  protected readonly approvals = inject(Approvals);
  private readonly businessDay = inject(BusinessDay);

  protected readonly reasons = [
    { en: 'Expired', ar: 'منتهي الصلاحية' },
    { en: 'Spoiled', ar: 'تالف' },
    { en: 'Dropped or broken', ar: 'سقط أو انكسر' },
    { en: 'Damaged packaging', ar: 'تلف العبوة' },
    { en: 'Other', ar: 'أخرى' },
  ];

  // Opened from a stock card: the entry it names, marked, the history reaching back a year for it.
  readonly spoilage = input<string | undefined>(undefined);

  protected readonly materials = signal<MaterialCost[]>([]);
  protected readonly recent = signal<SpoilageEntry[]>([]);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly lines = signal<Line[]>([this.blank()]);

  // One entry, one id: a retry after a lost answer records it once. A new one after each save.
  private spoilageId = crypto.randomUUID();

  protected readonly total = computed(() => this.lines().reduce((sum, l) => sum + (this.worth(l) ?? 0), 0));
  protected readonly recentTotal = computed(() =>
    this.shownRecent().reduce((sum, e) => sum + e.lines.reduce((lines, l) => lines + (l.value ?? 0), 0), 0),
  );

  // The history as searched: each entry with only its lines that match, by material or who recorded
  // it, and the reason chosen; by date or by what its lines were worth.
  protected readonly historySearch = signal('');
  protected readonly historyReason = signal('');
  protected readonly wasteSorts = wasteSorts;
  protected readonly historySort = signal<SortState<WasteSort>>({ key: 'date', direction: -1 });

  protected readonly reasonFilters = computed<FilterOption[]>(() => {
    const lines = this.recent().flatMap((e) => e.lines);
    const known = new Set(this.reasons.map((r) => r.en));
    return [
      { value: '', label: 'All · الكل', count: lines.length },
      ...this.reasons.filter((r) => r.en !== 'Other').map((r) => ({ value: r.en, label: `${r.en} · ${r.ar}`, count: lines.filter((l) => l.reason === r.en).length })),
      { value: 'Other', label: 'Other · أخرى', count: lines.filter((l) => !known.has(l.reason ?? '') || l.reason === 'Other').length },
    ];
  });

  protected readonly shownRecent = computed(() => {
    const reason = this.historyReason();
    const known = new Set(this.reasons.map((r) => r.en).filter((r) => r !== 'Other'));
    const entries = this.recent()
      .map((e) => ({
        ...e,
        lines: e.lines.filter(
          (l) =>
            smartMatch(this.historySearch(), l.material, l.reason, e.recordedBy) &&
            (!reason || (reason === 'Other' ? !known.has(l.reason ?? '') : l.reason === reason)),
        ),
      }))
      .filter((e) => e.lines.length > 0);
    return sortItems(entries, this.historySort(), (e, key) =>
      key === 'worth' ? e.lines.reduce((sum, l) => sum + (l.value ?? 0), 0) : e.recordedAtUtc,
    );
  });
  private readonly menuSales = inject(MenuSalesApi);
  protected readonly breakage = signal<BreakageEntry[]>([]);
  protected readonly staff = signal<Employee[]>([]);
  protected readonly activeStaff = computed(() => this.staff().filter((e) => e.isActive));
  protected readonly savingBreakage = signal(false);
  protected breakageDraft = this.blankBreakage();
  // One entry, one id: a retry after a lost answer records it once.
  private breakageId = crypto.randomUUID();
  protected readonly breakageTotal = computed(() => this.breakage().filter((b) => !b.isVoided).reduce((sum, b) => sum + b.cost, 0));

  protected readonly ready = computed(() => {
    const lines = this.lines();
    const ids = lines.map((l) => l.rawMaterialId);
    return (
      lines.every((l) => l.rawMaterialId && (l.quantity ?? 0) > 0 && this.reasonOf(l)) && new Set(ids).size === ids.length
    );
  });

  constructor() {
    void this.load();
  }

  protected unitOf(line: Line): string {
    const material = this.material(line);
    return material ? countUnit(material.unit, material.purchaseUnitSize).label : '';
  }

  // At today's average cost, as the server will value it.
  protected worth(line: Line): number | null {
    const material = this.material(line);
    if (!material || material.costPerUnit === null || !line.quantity) {
      return null;
    }
    return line.quantity * countUnit(material.unit, material.purchaseUnitSize).size * material.costPerUnit;
  }

  protected change(index: number, patch: Partial<Line>): void {
    this.lines.update((lines) => lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  protected add(): void {
    this.lines.update((lines) => [...lines, this.blank()]);
  }

  protected remove(index: number): void {
    this.lines.update((lines) => lines.filter((_, i) => i !== index));
  }

  protected async save(): Promise<void> {
    if (!this.ready()) {
      return;
    }
    this.saving.set(true);
    try {
      const lines = this.lines().map((l) => ({
        rawMaterialId: l.rawMaterialId!,
        quantity: l.quantity! * countUnit(this.material(l)!.unit, this.material(l)!.purchaseUnitSize).size,
        reason: this.reasonOf(l),
      }));
      await firstValueFrom(this.api.recordSpoilage(this.spoilageId, lines));
      this.notify.info('Waste recorded.');
      this.lines.set([this.blank()]);
      this.spoilageId = crypto.randomUUID();
      await this.load();
    } catch (error) {
      this.notify.error(error, 'The waste could not be recorded.');
    } finally {
      this.saving.set(false);
    }
  }

  protected unitFor(line: { unit: MaterialCost['unit']; purchaseUnitSize: number }): { label: string; size: number } {
    return countUnit(line.unit, line.purchaseUnitSize);
  }

  protected async recordBreakage(): Promise<void> {
    const draft = this.breakageDraft;
    if (!draft.description.trim() || !(draft.quantity >= 1)) {
      return;
    }
    this.savingBreakage.set(true);
    try {
      await firstValueFrom(this.menuSales.recordBreakage({
        id: this.breakageId, date: await this.businessDay.today(), description: draft.description.trim(), quantity: draft.quantity,
        unitCost: draft.unitCost === null || draft.unitCost === undefined || `${draft.unitCost}` === '' ? null : Number(draft.unitCost),
        employeeId: draft.employeeId, notes: draft.notes.trim() || null,
      }));
      this.notify.info('Breakage recorded.');
      this.breakageDraft = this.blankBreakage();
      this.breakageId = crypto.randomUUID();
      await this.load();
    } catch (error) {
      this.notify.error(error, 'The breakage could not be recorded.');
    } finally {
      this.savingBreakage.set(false);
    }
  }

  // Voided for a manager; asked of one for anyone else.
  protected async voidBreakage(entry: BreakageEntry): Promise<void> {
    if ((await this.approvals.delete('Breakage', entry.id, `the breakage of ${entry.quantity} × ${entry.description}`)) === 'Applied') {
      await this.load();
    }
  }

  private blankBreakage(): { description: string; quantity: number; unitCost: number | null; employeeId: string | null; notes: string } {
    return { description: '', quantity: 1, unitCost: null, employeeId: null, notes: '' };
  }

  private reasonOf(line: Line): string {
    return line.reason === 'Other' ? line.other.trim() : line.reason;
  }

  private material(line: Line): MaterialCost | undefined {
    return this.materials().find((m) => m.id === line.rawMaterialId);
  }

  private blank(): Line {
    return { rawMaterialId: null, quantity: null, reason: 'Expired', other: '' };
  }

  protected pendingOf(entry: SpoilageEntry): ApprovalRequest | undefined {
    return this.approvals.pendingFor(entry.spoilageId);
  }

  // Voided for a manager (its stock goes back); asked of one for anyone else.
  protected async voidEntry(entry: SpoilageEntry): Promise<void> {
    const what = `the waste of ${new Date(entry.recordedAtUtc).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
    if ((await this.approvals.delete('Waste', entry.spoilageId, what)) === 'Applied') {
      await this.load();
    }
  }

  private async load(): Promise<void> {
    this.error.set(null);
    void this.approvals.refresh();
    try {
      const focus = this.spoilage();
      const [materials, recent] = await Promise.all([firstValueFrom(this.api.materials()), firstValueFrom(this.api.spoilage(focus ? 366 : 30))]);
      this.materials.set(materials);
      this.recent.set(recent);
      if (focus) {
        setTimeout(() => document.getElementById(`spoilage-${focus}`)?.scrollIntoView({ block: 'center' }));
      }
    } catch (error) {
      this.error.set(errorMessage(error, 'The waste could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
    // Apart, so the spoilage stands without it.
    try {
      const [breakage, staff] = await Promise.all([firstValueFrom(this.menuSales.breakage(30)), firstValueFrom(this.menuSales.staff())]);
      this.breakage.set(breakage);
      this.staff.set(staff);
    } catch {
      this.breakage.set([]);
    }
  }
}
