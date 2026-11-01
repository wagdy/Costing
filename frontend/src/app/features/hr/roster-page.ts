import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { HrAccess } from '../../core/hr/hr-access';
import { Department, HrApi, Roster, RosterCell, RosterChange, RosterRow, WorkShift, weekDays } from '../../core/hr/hr.api';
import { errorMessage } from '../../core/http/error-message';
import { BusinessDay, isoDay } from '../../core/ui/business-day';
import { NotifyService } from '../../core/ui/notify.service';
import { FilterOption, FilterSelect } from '../shared/filter-select';
import { ShiftDialog, ShiftDialogData, shiftHours } from './shift-dialog';

// What a day is put on: a shift, a day off, or neither (their own schedule again).
type Choice = Pick<RosterChange, 'shiftId' | 'dayOff'>;

// A day of the grid as it shows: a rostered shift (its colour), a rostered day off, or their own
// schedule (a working day's hours, a weekly day off, flexible hours); and not employed.
interface CellView {
  kind: 'shift' | 'off' | 'usual' | 'usual-off' | 'flexible' | 'away';
  en: string;
  ar: string;
  hours: string | null;
  tone: string | null;
}

// "2026-10-24" as a Date at noon, clear of any clock change.
const noon = (date: string) => new Date(`${date}T12:00:00`);
const addDays = (date: string, days: number) => {
  const d = noon(date);
  d.setDate(d.getDate() + days);
  return isoDay(d);
};
// The Saturday the company's week of `date` starts on.
const weekOf = (date: string) => addDays(date, -((noon(date).getDay() + 1) % 7));

// Shift rostering (جداول الشفتات): a week's grid, Saturday to Friday, a row each employee employed
// in it (of a department, or all), a column each day. Each day shows what it is planned as: the
// shift the roster put them on, in its colour, or a day off; else their own schedule, faint. A
// manager, or an employee given the Shift Rostering tab, picks a day (or a row's whole week) to put it
// on a shift, give it off, or take it back to their own schedule; "Repeat last week" copies the week
// before's roster onto this one. Days of a finalized month's pay are locked. A rostered day is
// measured against its shift on the attendance and the payroll.
@Component({
  selector: 'app-roster-page',
  imports: [FilterSelect, MatButtonModule, MatIconModule, MatMenuModule, MatProgressBarModule, MatTooltipModule, NgTemplateOutlet],
  template: `
    <div class="toolbar">
      <div class="week-nav">
        <button mat-icon-button (click)="move(-7)" aria-label="The week before"><mat-icon>chevron_left</mat-icon></button>
        <button mat-stroked-button class="this-week" (click)="goTo(today())" [disabled]="week() === weekOf(today())">This week · هذا الأسبوع</button>
        <button mat-icon-button (click)="move(7)" aria-label="The week after"><mat-icon>chevron_right</mat-icon></button>
        <strong class="range">{{ rangeLabel() }}</strong>
      </div>
      @if (departments().length > 1) {
        <app-filter-select label="Department · القسم" icon="account_tree" [options]="departmentFilters()" [value]="department()" (valueChange)="pickDepartment($event)" />
      }
      <span class="spacer"></span>
      @if (canChange()) {
        <button mat-stroked-button (click)="repeatLastWeek()" [disabled]="saving() || !roster()">
          <mat-icon>event_repeat</mat-icon> Repeat last week <span class="inline-ar">تكرار الأسبوع السابق</span>
        </button>
        <button mat-flat-button (click)="manageShifts()"><mat-icon>schedule</mat-icon> Shifts <span class="inline-ar">الشفتات</span></button>
      }
    </div>

    @if (roster(); as r) {
      <div class="legend" aria-label="What the colours are">
        @for (s of r.shifts; track s.id) {
          <span class="chip" [class]="'tone-' + s.tone"><span class="dot"></span>{{ s.name }} <small>{{ hours(s) }}</small></span>
        }
        <span class="chip off"><span class="dot"></span>Day off · راحة</span>
        <span class="chip usual"><span class="dot"></span>Their own schedule · الجدول المعتاد</span>
      </div>
    }

    @if (loading() || saving()) {
      <mat-progress-bar mode="indeterminate" />
    }
    @if (error(); as e) {
      <p class="error">{{ e }}</p>
    } @else if (roster(); as r) {
      <div class="table-wrap">
        <table class="grid roster" aria-label="The week's roster">
          <thead>
            <tr>
              <th class="who-col">Employee<span class="ar">الموظف</span></th>
              @for (d of days(); track d.date) {
                <th class="day" [class.today]="d.date === today()">
                  <span class="dname">{{ d.en }} <span class="dnum">{{ d.num }}</span></span>
                  <span class="ar">{{ d.ar }}</span>
                </th>
              }
            </tr>
          </thead>
          <tbody>
            @for (row of r.rows; track row.employee.id) {
              <tr>
                <td class="who-col">
                  <div class="who">
                    <span class="avatar" aria-hidden="true">{{ initials(row.employee.name) }}</span>
                    <div class="who-text">
                      <strong>{{ row.employee.name }}</strong>
                      <span class="muted small">{{ row.employee.jobTitle }}</span>
                    </div>
                    @if (canChange()) {
                      <button mat-icon-button class="row-menu" [matMenuTriggerFor]="assign" [matMenuTriggerData]="{ row: row, date: null }"
                        matTooltip="The whole week · الأسبوع كله" [attr.aria-label]="row.employee.name + '’s whole week'">
                        <mat-icon>more_horiz</mat-icon>
                      </button>
                    }
                  </div>
                </td>
                @for (c of row.days; track c.date) {
                  @let v = view(c);
                  <td class="cell-td" [class.today]="c.date === today()">
                    @if (canChange() && c.employed && !c.locked) {
                      <button type="button" class="cell" [class]="cellClass(v, c)"
                        [matMenuTriggerFor]="assign" [matMenuTriggerData]="{ row: row, date: c.date }" [attr.aria-label]="cellLabel(row, c, v)">
                        <ng-container [ngTemplateOutlet]="content" [ngTemplateOutletContext]="{ v: v, c: c }" />
                      </button>
                    } @else {
                      <div class="cell" [class]="cellClass(v, c)" [attr.aria-label]="cellLabel(row, c, v)">
                        <ng-container [ngTemplateOutlet]="content" [ngTemplateOutletContext]="{ v: v, c: c }" />
                        @if (c.locked) {
                          <mat-icon class="lock" matTooltip="Its month's pay is finalized">lock</mat-icon>
                        }
                      </div>
                    }
                  </td>
                }
              </tr>
            } @empty {
              <tr>
                <td [attr.colspan]="8" class="empty">
                  <mat-icon>calendar_view_week</mat-icon>
                  <span class="note-ar" lang="ar" dir="rtl">لا يوجد موظفون يعملون في هذا الأسبوع@if (department()) { في هذا القسم}.</span>
                  No one is employed this week@if (department()) { in this department}.
                </td>
              </tr>
            }
          </tbody>
          @if (r.rows.length) {
            <tfoot>
              <tr>
                <td class="who-col">Working · على رأس العمل</td>
                @for (d of days(); track d.date; let i = $index) {
                  <td class="num-center">{{ working()[i] }}</td>
                }
              </tr>
            </tfoot>
          }
        </table>
      </div>
      <p class="note">
        <span class="note-ar" lang="ar" dir="rtl">
          اليوم المُسجَّل في الجدول يُحاسَب على شفته: التأخير من بدايته، والانصراف المبكر قبل نهايته، والوقت الإضافي بعد نهايته متى اكتملت ساعاته؛ ويوم الراحة في الجدول راحة لا غياب. اليوم الذي لا يذكره الجدول يتبع جدول الموظف المعتاد. أيام الشهر الذي اعتُمدت رواتبه مقفلة.
        </span>
        A rostered day is measured against its shift: late from its start, early before its end, overtime past its end once its hours are worked; a
        rostered day off is a day off, never an absence. A day the roster says nothing of follows the employee's own schedule. Days of a month whose
        pay is finalized are locked.
      </p>
    }

    <ng-template #content let-v="v" let-c="c">
      <span class="label">{{ v.en }}</span>
      @if (v.hours) {
        <span class="hours">{{ v.hours }}</span>
      } @else {
        <span class="hours ar-line">{{ v.ar }}</span>
      }
      @if (c.mark === 'Leave' || c.mark === 'UnpaidLeave') {
        <span class="mark">{{ c.mark === 'Leave' ? 'Leave · إجازة' : 'Unpaid · بدون راتب' }}</span>
      } @else if (c.holidayName) {
        <span class="mark holiday">{{ c.holidayName }}</span>
      }
    </ng-template>

    <mat-menu #assign="matMenu" class="roster-menu">
      <ng-template matMenuContent let-row="row" let-date="date">
        <div class="menu-head">{{ row.employee.name }} · {{ date ? dayLabel(date) : 'The whole week · الأسبوع كله' }}</div>
        @for (s of roster()?.shifts ?? []; track s.id) {
          <button mat-menu-item (click)="assignTo(row, date, { shiftId: s.id, dayOff: false })">
            <span class="menu-dot" [class]="'tone-' + s.tone"></span>{{ s.name }} <span class="menu-hours">{{ hours(s) }}</span>
          </button>
        } @empty {
          <div class="menu-head muted">No shifts yet: add them from Shifts · لا توجد شفتات</div>
        }
        <button mat-menu-item (click)="assignTo(row, date, { shiftId: null, dayOff: true })"><mat-icon>event_busy</mat-icon>Day off · راحة</button>
        <button mat-menu-item (click)="assignTo(row, date, { shiftId: null, dayOff: false })">
          <mat-icon>restart_alt</mat-icon>Their own schedule · الجدول المعتاد
        </button>
      </ng-template>
    </mat-menu>
  `,
  styleUrl: '../shared/pages.scss',
  styles: `
    .week-nav {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .this-week {
      border-radius: 999px;
      white-space: nowrap;
    }
    .range {
      margin-left: 8px;
      font: var(--mat-sys-title-medium);
      font-weight: 650;
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin: 0 0 12px;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 999px;
      background: var(--tone-bg, var(--mat-sys-surface-container));
      color: var(--tone-fg, var(--mat-sys-on-surface-variant));
      font: var(--mat-sys-label-medium);
      font-weight: 600;

      .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: currentColor;
      }
      small {
        font-weight: 500;
        opacity: 0.85;
      }
      &.usual {
        background: transparent;
        border: 1px dashed var(--app-line-strong);
      }
    }
    .roster {
      table-layout: fixed;
      min-width: 980px;

      th.day {
        text-align: center;
        width: calc((100% - 230px) / 7);
      }
      th.day.today {
        color: var(--mat-sys-primary);
        background: color-mix(in srgb, var(--mat-sys-primary) 8%, var(--mat-sys-surface-container-low));
      }
      .dname {
        display: block;
        font-weight: 700;
      }
      .dnum {
        font-weight: 500;
        opacity: 0.8;
      }
      th .ar {
        text-align: center;
      }
      // The employee stays in view as the days scroll by.
      .who-col {
        position: sticky;
        inset-inline-start: 0;
        z-index: 1;
        width: 230px;
        background: var(--mat-sys-surface-container-lowest);
      }
      thead .who-col,
      tfoot .who-col {
        background: var(--mat-sys-surface-container-low);
      }
      td.cell-td {
        padding: 6px;
        vertical-align: top;
      }
      td.cell-td.today {
        background: color-mix(in srgb, var(--mat-sys-primary) 4%, transparent);
      }
      tbody tr:hover > td.cell-td {
        background-color: transparent;
      }
      .num-center {
        text-align: center;
        font-variant-numeric: tabular-nums;
      }
    }
    .who {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }
    .who-text {
      display: grid;
      min-width: 0;
      flex: 1;

      strong {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }
    .avatar {
      flex: none;
      display: grid;
      place-items: center;
      width: 34px;
      height: 34px;
      border-radius: 50%;
      background: color-mix(in srgb, var(--mat-sys-primary) 12%, transparent);
      color: var(--mat-sys-primary);
      font: var(--mat-sys-label-large);
      font-weight: 700;
    }
    .small {
      font-size: 0.85em;
    }

    // A day: a rounded card, its shift's colour when rostered on one; their own schedule faint and
    // dashed; a day off grey.
    .cell {
      position: relative;
      display: grid;
      gap: 2px;
      width: 100%;
      min-height: 58px;
      padding: 8px 10px;
      box-sizing: border-box;
      border-radius: 12px;
      border: 1px solid transparent;
      background: var(--tone-bg, var(--mat-sys-surface-container-low));
      color: var(--tone-fg, var(--mat-sys-on-surface));
      font: inherit;
      text-align: start;
      align-content: start;

      .label {
        font: var(--mat-sys-label-large);
        font-weight: 700;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .hours {
        font: var(--mat-sys-label-small);
        font-variant-numeric: tabular-nums;
        opacity: 0.85;
      }
      .ar-line {
        direction: rtl;
        text-align: start;
        unicode-bidi: isolate;
      }
      .mark {
        justify-self: start;
        margin-top: 2px;
        padding: 1px 7px;
        border-radius: 999px;
        background: var(--tag-teal-bg);
        color: var(--tag-teal-fg);
        font: var(--mat-sys-label-small);
        font-weight: 600;

        &.holiday {
          background: var(--tag-accent-bg);
          color: var(--tag-accent-fg);
        }
      }
      &.usual,
      &.flexible,
      &.usual-off {
        background: transparent;
        border: 1px dashed var(--app-line-strong);
        color: var(--mat-sys-on-surface-variant);

        .label {
          font-weight: 500;
        }
      }
      &.off {
        background: var(--tag-neutral-bg);
        color: var(--tag-neutral-fg);
      }
      &.away {
        background: transparent;
        color: var(--mat-sys-outline);
        min-height: 0;
      }
      &.locked {
        opacity: 0.75;
      }
      .lock {
        position: absolute;
        top: 6px;
        inset-inline-end: 6px;
        width: 14px;
        height: 14px;
        font-size: 14px;
        opacity: 0.6;
      }
    }
    button.cell {
      cursor: pointer;
      transition:
        transform 120ms ease,
        box-shadow 120ms ease,
        border-color 120ms ease;

      &:hover {
        transform: translateY(-1px);
        box-shadow: 0 6px 14px -8px rgb(15 23 42 / 35%);
        border-color: color-mix(in srgb, currentColor 35%, transparent);
      }
      &:focus-visible {
        outline: 2px solid var(--mat-sys-primary);
        outline-offset: 2px;
      }
    }
    .row-menu {
      flex: none;
    }
    @media (max-width: 600px) {
      .roster {
        min-width: 820px;

        .who-col {
          width: 150px;
        }
      }
      .avatar {
        display: none;
      }
    }
  `,
})
export class RosterPage {
  private readonly api = inject(HrApi);
  private readonly access = inject(HrAccess);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotifyService);
  private readonly businessDay = inject(BusinessDay);
  private readonly router = inject(Router);

  // ?week=, a day of the week to show; this week's otherwise.
  readonly startWeek = input<string | undefined>(undefined, { alias: 'week' });

  protected readonly canChange = computed(() => this.access.canDecide('Roster'));
  protected readonly today = signal('');
  // The Saturday the week shown starts on.
  protected readonly week = signal<string | null>(null);
  protected readonly department = signal('');
  protected readonly departments = signal<Department[]>([]);
  protected readonly roster = signal<Roster | null>(null);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly hours = shiftHours;
  protected readonly weekOf = weekOf;

  protected readonly days = computed(() => {
    const first = this.week();
    if (!first) {
      return [];
    }
    return weekDays.map((w, i) => {
      const date = addDays(first, i);
      return { date, en: w.en, ar: w.ar, num: noon(date).getDate() };
    });
  });
  protected readonly rangeLabel = computed(() => {
    const first = this.week();
    if (!first) {
      return '';
    }
    const day = (date: string, year: boolean) =>
      noon(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) });
    return `${day(first, false)} – ${day(addDays(first, 6), true)}`;
  });
  protected readonly departmentFilters = computed<FilterOption[]>(() => [
    { value: '', label: 'All departments' },
    ...this.departments().map((d) => ({ value: d.id, label: d.name })),
  ]);
  // How many work each day: on a shift, or on their own working day; not off, on leave, on a public
  // holiday, or away.
  protected readonly working = computed(() =>
    this.days().map((_, i) =>
      (this.roster()?.rows ?? []).filter((r) => {
        const c = r.days[i];
        return c && c.employed && !c.off && !c.holidayName && c.mark !== 'Leave' && c.mark !== 'UnpaidLeave';
      }).length,
    ),
  );
  private readonly shifts = computed(() => new Map((this.roster()?.shifts ?? []).map((s) => [s.id, s])));

  constructor() {
    effect(() => {
      const asked = this.startWeek();
      untracked(() => void this.start(asked));
    });
    void firstValueFrom(this.api.departments()).then(
      (list) => this.departments.set(list),
      () => this.departments.set([]),
    );
  }

  protected view(c: RosterCell): CellView {
    const hours = c.startsAt && c.endsAt ? shiftHours({ startsAt: c.startsAt, endsAt: c.endsAt }) : null;
    if (!c.employed) {
      return { kind: 'away', en: '—', ar: '', hours: null, tone: null };
    }
    if (c.rostered && c.off) {
      return { kind: 'off', en: 'Day off', ar: 'راحة', hours: null, tone: null };
    }
    if (c.rostered && c.shiftId) {
      const shift: WorkShift | undefined = this.shifts().get(c.shiftId);
      return { kind: 'shift', en: shift?.name ?? 'Shift', ar: 'شفت', hours, tone: shift?.tone ?? null };
    }
    if (c.off) {
      return { kind: 'usual-off', en: 'Weekly off', ar: 'راحة أسبوعية', hours: null, tone: null };
    }
    return hours ? { kind: 'usual', en: 'Usual', ar: 'المعتاد', hours, tone: null } : { kind: 'flexible', en: 'Flexible', ar: 'ساعات مرنة', hours: null, tone: null };
  }

  // Its kind, its shift's colour, and locked.
  protected cellClass(v: CellView, c: RosterCell): string {
    return [v.kind, v.tone ? `tone-${v.tone}` : '', c.locked ? 'locked' : ''].filter(Boolean).join(' ');
  }

  protected cellLabel(row: RosterRow, c: RosterCell, v: CellView): string {
    return `${row.employee.name}, ${this.dayLabel(c.date)}: ${v.en}${v.hours ? ' ' + v.hours : ''}${c.locked ? ', locked' : ''}`;
  }

  protected dayLabel(date: string): string {
    return noon(date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  protected initials(name: string): string {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0].toUpperCase())
      .join('');
  }

  protected move(days: number): void {
    const first = this.week();
    if (first) {
      this.goTo(addDays(first, days));
    }
  }

  // The week of `date`, in the address too, so a reload stays on it.
  protected goTo(date: string): void {
    const first = weekOf(date);
    void this.router.navigate([], { queryParams: { week: first }, queryParamsHandling: 'merge', replaceUrl: true });
    this.week.set(first);
    void this.load();
  }

  protected pickDepartment(id: string): void {
    this.department.set(id);
    void this.load();
  }

  // A day put on a shift, off, or back to their own schedule; with no day, the row's whole week
  // (its days employed and open).
  protected async assignTo(row: RosterRow, date: string | null, choice: Choice): Promise<void> {
    const days = row.days.filter((d) => d.employed && !d.locked && (date === null || d.date === date));
    await this.save(days.map((d) => ({ employeeId: row.employee.id, date: d.date, ...choice })));
  }

  // The week before's roster onto this one: each day it rostered, the same weekday here; the days
  // it said nothing of stay as they are.
  protected async repeatLastWeek(): Promise<void> {
    const first = this.week();
    const now = this.roster();
    if (!first || !now) {
      return;
    }
    let before: Roster;
    try {
      before = await firstValueFrom(this.api.roster(addDays(first, -7), addDays(first, -1), this.department() || undefined));
    } catch (error) {
      this.notify.error(error, 'The week before could not be read.');
      return;
    }
    const changes: RosterChange[] = [];
    for (const row of now.rows) {
      const last = before.rows.find((r) => r.employee.id === row.employee.id);
      row.days.forEach((day, i) => {
        const was = last?.days[i];
        if (was?.rostered && day.employed && !day.locked) {
          changes.push({ employeeId: row.employee.id, date: day.date, shiftId: was.off ? null : was.shiftId, dayOff: was.off });
        }
      });
    }
    if (!changes.length) {
      this.notify.info('The week before has nothing rostered to repeat.');
      return;
    }
    await this.save(changes, `${changes.length} ${changes.length === 1 ? 'day' : 'days'} repeated from the week before.`);
  }

  protected async manageShifts(): Promise<void> {
    const changed = await firstValueFrom(
      this.dialog
        .open<ShiftDialog, ShiftDialogData, boolean>(ShiftDialog, { data: { shifts: this.roster()?.shifts ?? [] }, width: '560px', maxWidth: '95vw' })
        .afterClosed(),
    );
    if (changed) {
      await this.load();
    }
  }

  private async save(changes: RosterChange[], done = 'Saved · تم الحفظ'): Promise<void> {
    if (!changes.length) {
      return;
    }
    this.saving.set(true);
    try {
      await firstValueFrom(this.api.setRoster(changes));
      this.notify.info(done);
      await this.load();
    } catch (error) {
      this.notify.error(error, 'The roster could not be saved.');
    } finally {
      this.saving.set(false);
    }
  }

  private async start(asked: string | undefined): Promise<void> {
    const today = await this.businessDay.today();
    this.today.set(today);
    const first = weekOf(asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : today);
    // Moved here already (goTo), and loaded.
    if (first === this.week() && this.roster()) {
      return;
    }
    this.week.set(first);
    await this.load();
  }

  private async load(): Promise<void> {
    const first = this.week();
    if (!first) {
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      this.roster.set(await firstValueFrom(this.api.roster(first, addDays(first, 6), this.department() || undefined)));
    } catch (error) {
      this.error.set(errorMessage(error, 'The roster could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }
}
