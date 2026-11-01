import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import { errorMessage } from '../../core/http/error-message';
import { AttendanceTrendPoint, Department, HrAnalytics, HrApi, duration } from '../../core/hr/hr.api';
import { BusinessDay, isoDay } from '../../core/ui/business-day';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { FilterOption, FilterSelect } from '../shared/filter-select';

type Months = 1 | 3 | 12;

const noon = (day: string) => new Date(`${day}T12:00:00`);

// A scale's top and its ticks, at 1, 2 or 5 of a power of ten: four steps or so.
export function niceScale(max: number): number[] {
  if (max <= 0) {
    return [0, 1];
  }
  const raw = max / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw)!);
  const top = Math.ceil(max / step) * step;
  return Array.from({ length: top / step + 1 }, (_, i) => i * step);
}

// How long, from days: "2 y 3 mo", "5 mo", "20 days".
export function tenure(days: number): string {
  if (days < 31) {
    return `${days} ${days === 1 ? 'day' : 'days'}`;
  }
  const months = Math.round(days / 30.4375);
  const [years, rest] = [Math.floor(months / 12), months % 12];
  return years ? `${years} y${rest ? ` ${rest} mo` : ''}` : `${months} mo`;
}

// HR analytics (لوحة التحليلات): a month, or the 3 or 12 months to it, of everyone or one
// department.
// - Attendance & punctuality: the working days that have passed, each on time, late or absent, as
//   rates and totals; their trend by day, week or month; who was late or absent most.
// - Labour cost by department: contracted (the monthly salaries in full) beside actual (what the
//   payroll says the work cost), and each department's share; for whoever is shown costs.
// - Workforce stability: headcount at the start and the end, who joined and who left, the
//   turnover rate and how long those employed have been.
// The trend's colours carry a legend and a table view beside them: never colour alone.
@Component({
  selector: 'app-analytics-page',
  imports: [DatePipe, DecimalPipe, FilterSelect, MatButtonModule, MatButtonToggleModule, MatIconModule, MatProgressBarModule, MatTooltipModule, MoneyPipe],
  template: `
    <div class="toolbar">
      <div class="month-nav">
        <button mat-icon-button (click)="move(-1)" aria-label="The month before"><mat-icon>chevron_left</mat-icon></button>
        <strong class="month">{{ month() | date: 'MMMM y' }}</strong>
        <button mat-icon-button (click)="move(1)" [disabled]="month() >= thisMonth()" aria-label="The month after"><mat-icon>chevron_right</mat-icon></button>
        <button mat-stroked-button (click)="goTo(thisMonth())" [disabled]="month() === thisMonth()">This month · هذا الشهر</button>
      </div>
      <mat-button-toggle-group class="periods" hideSingleSelectionIndicator [value]="months()" (change)="pickMonths($event.value)" aria-label="Period">
        <mat-button-toggle [value]="1">Month <span class="inline-ar">شهر</span></mat-button-toggle>
        <mat-button-toggle [value]="3">3 months <span class="inline-ar">٣ أشهر</span></mat-button-toggle>
        <mat-button-toggle [value]="12">12 months <span class="inline-ar">١٢ شهرًا</span></mat-button-toggle>
      </mat-button-toggle-group>
      @if (departments().length > 1) {
        <app-filter-select label="Department · القسم" icon="account_tree" [options]="departmentFilters()" [value]="department()" (valueChange)="pickDepartment($event)" />
      }
    </div>
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    @if (error(); as problem) {
      <p class="error">{{ problem }}</p>
    } @else if (report(); as r) {
      <h2 class="period">{{ periodLabel() }} <span class="inline-ar">لوحة التحليلات</span></h2>

      <section aria-labelledby="attendance-head">
        <h3 id="attendance-head"><mat-icon>event_available</mat-icon> Attendance & punctuality <span class="inline-ar">معدلات الغياب والتأخير</span></h3>
        <div class="tiles">
          <div class="tile key">
            <span class="label">Attendance rate · نسبة الحضور</span>
            <strong>{{ r.attendance.attendanceRate | number: '1.0-1' }}%</strong>
            <small>{{ r.attendance.workedDays }} of {{ r.attendance.scheduledDays }} working days worked</small>
          </div>
          <div class="tile">
            <span class="label">Absence days · أيام الغياب</span>
            <strong>{{ r.attendance.absentDays }}</strong>
            <small class="muted">working days with no punch</small>
          </div>
          <div class="tile">
            <span class="label">Late · التأخير</span>
            <strong>{{ duration(r.attendance.lateMinutes) }}</strong>
            <small class="muted">{{ r.attendance.lateDays }} late {{ r.attendance.lateDays === 1 ? 'arrival' : 'arrivals' }} · {{ r.attendance.onTimeRate | number: '1.0-1' }}% on time</small>
          </div>
          <div class="tile">
            <span class="label">Overtime · الوقت الإضافي</span>
            <strong>{{ duration(r.attendance.overtimeMinutes) }}</strong>
            <small class="muted">after the shifts' end</small>
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <h4>On time, late and absent {{ bucketLabel() }} <span class="inline-ar">الحضور والتأخير والغياب</span></h4>
            <div class="legend" aria-hidden="true">
              <span><i class="on-time"></i>On time · في الموعد</span>
              <span><i class="late"></i>Late · متأخر</span>
              <span><i class="absent"></i>Absent · غائب</span>
            </div>
          </div>
          @if (r.attendance.scheduledDays) {
            <div class="chart" role="img" [attr.aria-label]="chartSummary()">
              <div class="y" aria-hidden="true">
                @for (t of ticks(); track t) {
                  <span [style.bottom.%]="(t / top()) * 100">{{ t }}</span>
                }
              </div>
              <div class="plot">
                @for (t of ticks(); track t) {
                  <i class="grid-line" [style.bottom.%]="(t / top()) * 100"></i>
                }
                <div class="columns" [style.grid-template-columns]="'repeat(' + r.trend.length + ', 1fr)'">
                  @for (p of r.trend; track p.from; let i = $index) {
                    <div class="column" [matTooltip]="pointTip(p)" tabindex="0" [attr.aria-label]="pointTip(p)">
                      <div class="stack">
                        @if (p.absent) {
                          <i class="absent" [style.height.%]="(p.absent / top()) * 100"></i>
                        }
                        @if (p.late) {
                          <i class="late" [style.height.%]="(p.late / top()) * 100"></i>
                        }
                        @if (p.onTime) {
                          <i class="on-time" [style.height.%]="(p.onTime / top()) * 100"></i>
                        }
                      </div>
                      <span class="x">{{ i % labelEvery() === 0 ? pointLabel(p) : '' }}</span>
                    </div>
                  }
                </div>
              </div>
            </div>
            <details class="as-table">
              <summary>Show as a table · عرض كجدول</summary>
              <div class="table-wrap">
                <table class="grid" aria-label="On time, late and absent">
                  <thead>
                    <tr>
                      <th>Period<span class="ar">الفترة</span></th>
                      <th class="num">On time<span class="ar">في الموعد</span></th>
                      <th class="num">Late<span class="ar">متأخر</span></th>
                      <th class="num">Absent<span class="ar">غائب</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (p of r.trend; track p.from) {
                      <tr>
                        <td>{{ pointName(p) }}</td>
                        <td class="num">{{ p.onTime }}</td>
                        <td class="num">{{ p.late }}</td>
                        <td class="num">{{ p.absent }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </details>
          } @else {
            <p class="muted empty-chart">No working days have passed in this period yet. · لم تمر أيام عمل في هذه الفترة بعد.</p>
          }
        </div>

        <div class="pair">
          <div class="card">
            <h4>Most late <span class="inline-ar">الأكثر تأخيرًا</span></h4>
            <table class="grid" aria-label="Most late">
              <thead>
                <tr>
                  <th>Employee<span class="ar">الموظف</span></th>
                  <th class="num">Times<span class="ar">مرات</span></th>
                  <th class="num">Late<span class="ar">مدة التأخير</span></th>
                </tr>
              </thead>
              <tbody>
                @for (e of r.mostLate; track e.employeeId) {
                  <tr>
                    <td><strong>{{ e.name }}</strong><div class="muted small">{{ e.jobTitle }} · {{ e.department }}</div></td>
                    <td class="num">{{ e.lateDays }}</td>
                    <td class="num">{{ duration(e.lateMinutes) }}</td>
                  </tr>
                } @empty {
                  <tr><td colspan="3" class="empty">No one was late. · لم يتأخر أحد.</td></tr>
                }
              </tbody>
            </table>
          </div>
          <div class="card">
            <h4>Most absent <span class="inline-ar">الأكثر غيابًا</span></h4>
            <table class="grid" aria-label="Most absent">
              <thead>
                <tr>
                  <th>Employee<span class="ar">الموظف</span></th>
                  <th class="num">Absent<span class="ar">أيام الغياب</span></th>
                  <th class="num">Of<span class="ar">من أيام العمل</span></th>
                </tr>
              </thead>
              <tbody>
                @for (e of r.mostAbsent; track e.employeeId) {
                  <tr>
                    <td><strong>{{ e.name }}</strong><div class="muted small">{{ e.jobTitle }} · {{ e.department }}</div></td>
                    <td class="num">{{ e.absentDays }}</td>
                    <td class="num">{{ e.scheduledDays }}</td>
                  </tr>
                } @empty {
                  <tr><td colspan="3" class="empty">No one was absent. · لم يغب أحد.</td></tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section aria-labelledby="cost-head">
        <h3 id="cost-head"><mat-icon>payments</mat-icon> Labour cost by department <span class="inline-ar">تحليل تكلفة العمالة لكل قسم</span></h3>
        @if (r.totalActual === null) {
          <p class="note hidden-costs">
            <span class="note-ar" lang="ar" dir="rtl">تظهر تكلفة العمالة لمن لديه صلاحية مسير الرواتب أو الموظفين أو الأقسام.</span>
            Labour costs are shown to whoever holds the Payroll, Employees or Departments permission.
          </p>
        } @else {
          <div class="tiles">
            <div class="tile">
              <span class="label">Contracted · التكلفة التعاقدية</span>
              <strong>{{ r.totalContracted | money }}</strong>
              <small class="muted">the monthly salaries in full</small>
            </div>
            <div class="tile key">
              <span class="label">Actual · التكلفة الفعلية</span>
              <strong>{{ r.totalActual | money }}</strong>
              <small>what the work cost, as the payroll has it</small>
            </div>
            <div class="tile">
              <span class="label">Difference · الفرق</span>
              <strong>{{ abs(difference()) | money }}</strong>
              <small class="muted">{{ difference() > 0 ? 'above contracted' : difference() < 0 ? 'below contracted' : 'as contracted' }}</small>
            </div>
          </div>
          <div class="card">
            <div class="card-head">
              <h4>By department <span class="inline-ar">حسب القسم</span></h4>
              <div class="legend" aria-hidden="true">
                <span><i class="actual"></i>Actual · الفعلية</span>
                <span><i class="contracted"></i>Contracted · التعاقدية</span>
              </div>
            </div>
            @for (d of r.departments; track d.departmentId) {
              <div class="bar-row">
                <div class="who">
                  <strong>{{ d.name }}</strong>
                  <small class="muted">{{ d.employed }} employed</small>
                </div>
                <div class="track" [matTooltip]="costTip(d.name, d.actualCost!, d.contractedCost!, d.share!)" tabindex="0"
                  [attr.aria-label]="costTip(d.name, d.actualCost!, d.contractedCost!, d.share!)">
                  <i class="bar" [style.width.%]="(d.actualCost! / costScale()) * 100"></i>
                  <i class="tick" [style.inset-inline-start.%]="(d.contractedCost! / costScale()) * 100"></i>
                </div>
                <div class="figure">
                  <strong>{{ d.actualCost | money }}</strong>
                  <small class="muted">{{ d.share | number: '1.0-1' }}% · of {{ d.contractedCost | money }}</small>
                </div>
              </div>
            } @empty {
              <p class="muted">No one was employed in this period. · لم يكن هناك موظفون في هذه الفترة.</p>
            }
          </div>
        }
      </section>

      <section aria-labelledby="turnover-head">
        <h3 id="turnover-head"><mat-icon>groups</mat-icon> Workforce stability & turnover <span class="inline-ar">استقرار القوى العاملة ومعدل دوران العمالة</span></h3>
        <div class="tiles">
          <div class="tile">
            <span class="label">Headcount · عدد الموظفين</span>
            <strong>{{ r.turnover.headcountStart }} → {{ r.turnover.headcountEnd }}</strong>
            <small class="muted">{{ r.turnover.startsOn | date: 'd MMM' }} to {{ r.turnover.endsOn | date: 'd MMM y' }}</small>
          </div>
          <div class="tile">
            <span class="label">Joined · تعيينات جديدة</span>
            <strong>{{ r.turnover.joined }}</strong>
            <small class="muted">hired in the period</small>
          </div>
          <div class="tile">
            <span class="label">Left · ترك العمل</span>
            <strong>{{ r.turnover.left }}</strong>
            <small class="muted">their last day in the period</small>
          </div>
          <div class="tile key">
            <span class="label">Turnover rate · معدل الدوران</span>
            <strong>{{ r.turnover.turnoverRate | number: '1.0-1' }}%</strong>
            <small>{{ r.turnover.left }} left of {{ r.turnover.averageHeadcount | number: '1.0-1' }} on average</small>
          </div>
          <div class="tile">
            <span class="label">Average tenure · متوسط مدة الخدمة</span>
            <strong>{{ tenure(r.turnover.averageTenureDays) }}</strong>
            <small class="muted">of those employed at the end</small>
          </div>
        </div>
      </section>

      <p class="note">
        <span class="note-ar" lang="ar" dir="rtl">
          أيام العمل هي الأيام التي مرت وفيها شفت للموظف حسب جدول الشفتات أو مواعيده، وليست أيام الراحة أو الإجازات أو العطلات الرسمية. نسبة الحضور هي الأيام التي عمل فيها من أيام العمل، والتأخير هو الحضور بعد بداية الشفت ومهلة السماح.
          التكلفة التعاقدية هي الرواتب الشهرية كاملة، والتكلفة الفعلية كما في مسير الرواتب: الراتب المستحق والأجور اليومية والإضافي والحوافز والبدلات، مخصومًا منها التأخير والغياب والجزاءات.
          معدل الدوران هو عدد من تركوا العمل مقسومًا على متوسط عدد الموظفين في بداية الفترة ونهايتها.
        </span>
        Working days are the days passed on which an employee had a shift, the roster's or their own: not days off, leave or public holidays. The
        attendance rate is the working days worked; late is in after the shift's start and its grace. Contracted cost is the monthly salaries in
        full; actual is as the payroll works it out: the pay earned, daily wages, overtime, incentives and allowances, less lateness, absence and
        penalties. The turnover rate is those who left over the average of the headcount at the start and the end.
      </p>
    }
  `,
  styleUrl: '../shared/pages.scss',
  styles: `
    .month-nav {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .month {
      min-width: 130px;
      text-align: center;
    }
    .period {
      margin: 4px 0 12px;
      font: var(--mat-sys-title-large);
    }
    section {
      margin-bottom: 24px;
    }
    h3 {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      margin: 0 0 12px;
      font: var(--mat-sys-title-medium);
      mat-icon {
        color: var(--mat-sys-primary);
      }
    }
    h4 {
      margin: 0 0 12px;
      font: var(--mat-sys-title-small);
    }
    .tile small {
      font: var(--mat-sys-body-small);
    }
    .card {
      padding: 16px;
      margin-bottom: 12px;
      border-radius: 16px;
      border: 1px solid var(--app-line);
      background: var(--mat-sys-surface-container-lowest);
      box-shadow: var(--app-card-shadow);
      min-width: 0;
    }
    .card-head {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 4px 16px;
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 14px;
      font: var(--mat-sys-label-medium);
      color: var(--mat-sys-on-surface-variant);
      i {
        display: inline-block;
        width: 10px;
        height: 10px;
        margin-inline-end: 6px;
        border-radius: 3px;
        vertical-align: -1px;
      }
      .contracted {
        width: 3px;
        height: 14px;
        border-radius: 0;
        vertical-align: -3px;
      }
    }
    .on-time {
      background: #2a78d6;
    }
    .late {
      background: #e08c00;
    }
    .absent {
      background: #b3261e;
    }
    .actual {
      background: #2a78d6;
    }
    .contracted {
      background: var(--mat-sys-on-surface);
    }
    .chart {
      display: grid;
      grid-template-columns: 32px 1fr;
      height: 228px;
      padding: 16px 0 24px;
    }
    .y {
      position: relative;
      span {
        position: absolute;
        inset-inline-end: 8px;
        transform: translateY(50%);
        font: var(--mat-sys-label-small);
        color: var(--mat-sys-on-surface-variant);
      }
    }
    .plot {
      position: relative;
      border-bottom: 1px solid var(--app-line-strong);
    }
    .grid-line {
      position: absolute;
      inset-inline: 0;
      border-top: 1px solid var(--app-line);
    }
    .columns {
      position: absolute;
      inset: 0;
      display: grid;
    }
    .column {
      position: relative;
      display: flex;
      justify-content: center;
      outline: none;
      &:hover,
      &:focus-visible {
        background: color-mix(in srgb, var(--mat-sys-primary) 6%, transparent);
      }
    }
    .stack {
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      gap: 2px;
      width: min(24px, 70%);
      height: 100%;
      i:first-child {
        border-radius: 4px 4px 0 0;
      }
    }
    .x {
      position: absolute;
      top: 100%;
      padding-top: 4px;
      font: var(--mat-sys-label-small);
      color: var(--mat-sys-on-surface-variant);
      white-space: nowrap;
    }
    .as-table summary {
      cursor: pointer;
      font: var(--mat-sys-label-large);
      color: var(--mat-sys-primary);
    }
    .as-table .table-wrap {
      margin-top: 8px;
      max-height: 320px;
      overflow: auto;
    }
    .empty-chart {
      margin: 24px 0;
      text-align: center;
    }
    .pair {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 12px;
      .card {
        margin: 0;
        overflow-x: auto;
      }
      table {
        width: 100%;
      }
    }
    .small {
      font-size: 0.85em;
    }
    .bar-row {
      display: grid;
      grid-template-columns: minmax(110px, 160px) 1fr minmax(120px, auto);
      align-items: center;
      gap: 12px;
      padding: 8px 0;
      & + .bar-row {
        border-top: 1px solid var(--app-line);
      }
    }
    .who,
    .figure {
      display: grid;
      min-width: 0;
    }
    .figure {
      text-align: end;
    }
    .track {
      position: relative;
      height: 24px;
      outline: none;
      &:focus-visible {
        box-shadow: 0 0 0 2px var(--mat-sys-primary);
      }
    }
    .bar {
      position: absolute;
      inset-block: 4px;
      inset-inline-start: 0;
      background: #2a78d6;
      border-start-end-radius: 4px;
      border-end-end-radius: 4px;
    }
    .tick {
      position: absolute;
      inset-block: 0;
      width: 3px;
      margin-inline-start: -1px;
      background: var(--mat-sys-on-surface);
    }
    @media (max-width: 600px) {
      .periods {
        width: 100%;
        --mat-button-toggle-label-text-size: 13px;
        mat-button-toggle {
          flex: 1;
        }
      }
      .bar-row {
        grid-template-columns: 1fr auto;
        .track {
          grid-column: 1 / -1;
          grid-row: 2;
        }
      }
      .chart {
        height: 180px;
      }
    }
  `,
})
export class AnalyticsPage {
  private readonly api = inject(HrApi);
  private readonly businessDay = inject(BusinessDay);

  protected readonly duration = duration;
  protected readonly tenure = tenure;
  protected readonly abs = Math.abs;
  protected readonly today = signal(isoDay(new Date()));
  protected readonly thisMonth = computed(() => `${this.today().slice(0, 8)}01`);
  protected readonly month = signal(`${isoDay(new Date()).slice(0, 8)}01`);
  protected readonly months = signal<Months>(1);
  protected readonly department = signal('');
  protected readonly departments = signal<Department[]>([]);
  protected readonly report = signal<HrAnalytics | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly departmentFilters = computed<FilterOption[]>(() => [
    { value: '', label: 'All departments' },
    ...this.departments().map((d) => ({ value: d.id, label: d.name })),
  ]);

  // "October 2026", or "August – October 2026", "November 2025 – October 2026".
  protected readonly periodLabel = computed(() => {
    const r = this.report();
    if (!r) {
      return '';
    }
    const [from, to] = [noon(r.from), noon(r.to)];
    const long = (d: Date, year: boolean) => d.toLocaleDateString('en-GB', { month: 'long', ...(year ? { year: 'numeric' } : {}) });
    return r.months === 1 ? long(to, true) : `${long(from, from.getFullYear() !== to.getFullYear())} – ${long(to, true)}`;
  });

  protected readonly bucketLabel = computed(() => ({ Day: 'by day', Week: 'by week', Month: 'by month' })[this.report()?.bucket ?? 'Day']);

  // The trend's scale: its ticks, from 0 to the top.
  protected readonly ticks = computed(() => niceScale(Math.max(0, ...(this.report()?.trend ?? []).map((p) => p.onTime + p.late + p.absent))));
  protected readonly top = computed(() => this.ticks()[this.ticks().length - 1]);
  // Every point named under the chart up to 12 of them; fewer, when there are more.
  protected readonly labelEvery = computed(() => {
    const n = this.report()?.trend.length ?? 0;
    return n <= 12 ? 1 : n <= 20 ? 2 : 5;
  });

  protected readonly chartSummary = computed(() => {
    const a = this.report()?.attendance;
    return a ? `${a.onTimeDays} days on time, ${a.lateDays} late and ${a.absentDays} absent, ${this.bucketLabel()}. The table under the chart has each.` : '';
  });

  protected readonly difference = computed(() => (this.report()?.totalActual ?? 0) - (this.report()?.totalContracted ?? 0));
  // The departments' bars on one scale: the largest of their contracted and actual costs.
  protected readonly costScale = computed(() =>
    Math.max(1, ...(this.report()?.departments ?? []).flatMap((d) => [d.contractedCost ?? 0, d.actualCost ?? 0])),
  );

  constructor() {
    void (async () => {
      const today = await this.businessDay.today();
      this.today.set(today);
      this.month.set(`${today.slice(0, 8)}01`);
      await this.load();
    })();
    void firstValueFrom(this.api.departments()).then(
      (list) => this.departments.set(list),
      () => this.departments.set([]),
    );
  }

  // Under a column: the day's number, the week's first day, the month's name.
  protected pointLabel(p: AttendanceTrendPoint): string {
    const from = noon(p.from);
    switch (this.report()?.bucket) {
      case 'Week':
        return from.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      case 'Month':
        return from.toLocaleDateString('en-GB', { month: 'short' });
      default:
        return String(from.getDate());
    }
  }

  // In full: "Sat, 4 Oct 2026", "4 – 10 Oct 2026", "October 2026".
  protected pointName(p: AttendanceTrendPoint): string {
    const [from, to] = [noon(p.from), noon(p.to)];
    switch (this.report()?.bucket) {
      case 'Week':
        return `${from.toLocaleDateString('en-GB', { day: 'numeric', ...(from.getMonth() !== to.getMonth() ? { month: 'short' } : {}) })} – ${to.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
      case 'Month':
        return from.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
      default:
        return from.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    }
  }

  protected pointTip(p: AttendanceTrendPoint): string {
    return p.onTime + p.late + p.absent
      ? `${this.pointName(p)}: on time ${p.onTime} · late ${p.late} · absent ${p.absent}`
      : `${this.pointName(p)}: no working days`;
  }

  protected costTip(name: string, actual: number, contracted: number, share: number): string {
    const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${name}: actual ${money(actual)} of ${money(contracted)} contracted · ${share}% of the cost`;
  }

  protected move(by: number): void {
    const start = noon(this.month());
    this.goTo(isoDay(new Date(start.getFullYear(), start.getMonth() + by, 1)));
  }

  protected goTo(month: string): void {
    if (month <= this.thisMonth() && month !== this.month()) {
      this.month.set(month);
      void this.load();
    }
  }

  protected pickMonths(months: Months): void {
    this.months.set(months);
    void this.load();
  }

  protected pickDepartment(id: string): void {
    this.department.set(id);
    void this.load();
  }

  private async load(): Promise<void> {
    const asked = [this.month(), this.months(), this.department()] as const;
    this.loading.set(true);
    this.error.set(null);
    try {
      const report = await firstValueFrom(this.api.analytics(asked[0], asked[1], asked[2] || undefined));
      // What was asked while it was read is read in its turn.
      if (asked.every((a, i) => a === [this.month(), this.months(), this.department()][i])) {
        this.report.set(report);
      }
    } catch (e) {
      this.error.set(errorMessage(e, 'The analytics could not be read.'));
    } finally {
      this.loading.set(false);
    }
  }
}
