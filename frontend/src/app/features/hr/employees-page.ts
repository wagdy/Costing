import { DatePipe } from '@angular/common';
import { Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { Permissions } from '../../core/auth/permissions';
import { ApprovalResult, isRequested } from '../../core/approvals/approvals.api';
import { addressOf, DeviceLink, savedDeviceLink, ZkPort } from '../../core/hr/device-link';
import { errorMessage } from '../../core/http/error-message';
import { Department, DeviceUser, Employee, EmployeeImportResult, EmployeeInput, HrApi, weekDays } from '../../core/hr/hr.api';
import { HrAccess } from '../../core/hr/hr-access';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { NotifyService } from '../../core/ui/notify.service';
import { saveBlob } from '../../core/ui/save-blob';
import { Approvals, pendingLabel } from '../approvals/approvals';
import { BusinessDay } from '../../core/ui/business-day';
import { EmployeeDialog, EmployeeDialogData } from './employee-dialog';
import { EmployeeImportDialog } from './employee-import-dialog';
import { EmploymentDialog, EmploymentDialogData } from './employment-dialog';

// Who in the system gets a device user's number: an employee without one yet.
@Component({
  selector: 'app-link-device-user-dialog',
  imports: [FormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatSelectModule],
  template: `
    <h2 mat-dialog-title>Link no. {{ data.user.deviceUserId }}, {{ data.user.name || 'no name' }} <span class="ar">ربط رقم البصمة</span></h2>
    <mat-dialog-content>
      <p class="muted">The employee gets the number, and the punches made under it are theirs from then.</p>
      <mat-form-field class="wide">
        <mat-label>Employee · الموظف</mat-label>
        <mat-select [(ngModel)]="employeeId" aria-label="Employee">
          @for (e of data.employees; track e.id) {
            <mat-option [value]="e.id">{{ e.name }} · {{ e.jobTitle }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button [disabled]="!employeeId" [mat-dialog-close]="employeeId">Link</button>
    </mat-dialog-actions>
  `,
  styles: `
    .wide {
      width: 100%;
    }
    .muted {
      color: var(--mat-sys-on-surface-variant);
    }
    .ar {
      direction: rtl;
      unicode-bidi: isolate;
      margin-left: 6px;
      opacity: 0.75;
      font-size: 0.8em;
    }
  `,
})
export class LinkDeviceUserDialog {
  protected readonly data = inject<{ user: DeviceUser; employees: Employee[] }>(MAT_DIALOG_DATA);
  protected employeeId = '';
}

// The employees (الموظفين), in two lists, one shown at a time (?view=device for the second):
// - System employees (الموظفين العاملين): who is on the payroll and in which department, their
//   pay (a monthly salary or a daily wage), their nine-hour work schedule (or flexible hours) and days
//   off, and their number on the attendance device; a row opens the employee's profile. Added,
//   changed, leaving and coming back by whoever manages HR: a manager's at once, anyone else's
//   waiting for a manager, listed above the table until then (a new one) or locking its row (a
//   change).
// - Device users (مسجلين على جهاز البصمة): the users the device has listed that nobody in the system
//   has the number of yet, to add as employees or link to one; each leaves the list once added.
// Sync device, Excel and Add employee are above both.
@Component({
  selector: 'app-employees-page',
  imports: [
    DatePipe,
    FormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatMenuModule,
    MatProgressBarModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatTooltipModule,
    MoneyPipe,
    RouterLink,
  ],
  template: `
    <mat-button-toggle-group class="lists" [value]="list()" (change)="showList($event.value)" aria-label="Which list" hideSingleSelectionIndicator>
      <mat-button-toggle value="employees">
        System employees <span class="inline-ar">الموظفين العاملين</span> <span class="count">{{ active().length }}</span>
      </mat-button-toggle>
      <mat-button-toggle value="device">
        Device users <span class="inline-ar">مسجلين على جهاز البصمة</span> <span class="count" [class.waiting-count]="unknown().length > 0">{{ unknown().length }}</span>
      </mat-button-toggle>
    </mat-button-toggle-group>
    <div class="toolbar">
      @if (list() === 'employees') {
        <mat-slide-toggle [ngModel]="showLeft()" (ngModelChange)="showLeft.set($event)">Show who has left · عرض من ترك العمل</mat-slide-toggle>
      }
      <span class="spacer"></span>
      @if (list() === 'employees') {
        <span class="muted">{{ active().length }} employed · {{ payroll() | money }} a month@if (daily()) { · {{ daily() }} on daily wages}</span>
      }
      <button mat-stroked-button [matMenuTriggerFor]="excel" [disabled]="excelBusy()" aria-label="Excel">
        <mat-icon>table_view</mat-icon> Excel <span class="inline-ar">إكسيل</span>
      </button>
      <mat-menu #excel="matMenu">
        @if (canManage()) {
          <button mat-menu-item (click)="downloadTemplate()"><mat-icon>download</mat-icon> Download template · تحميل القالب</button>
          <button mat-menu-item (click)="picker.click()"><mat-icon>upload_file</mat-icon> Import Excel · رفع إكسيل</button>
        }
        <button mat-menu-item (click)="exportEmployees()"><mat-icon>file_download</mat-icon> Export employees · تصدير الموظفين</button>
      </mat-menu>
      <input #picker type="file" hidden accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        (change)="importFile(picker)" aria-label="Excel file to import" />
      @if (access.canDecide('Employees')) {
        <button mat-stroked-button (click)="sync()" [disabled]="syncing()">
          <mat-icon>sync</mat-icon> {{ syncing() ? 'Syncing…' : 'Sync device' }} <span class="inline-ar">مزامنة الجهاز</span>
        </button>
      }
      @if (canManage()) {
        <button mat-flat-button (click)="add()"><mat-icon>person_add</mat-icon> Add employee <span class="inline-ar">إضافة موظف</span></button>
      }
    </div>
    @if (list() === 'employees' && departments().length > 1) {
      <!-- The department shown: a pill each, with how many are in it, as the list stands. -->
      <div class="segments" role="group" aria-label="Department · القسم">
        <button type="button" class="segment" [class.on]="!department()" [attr.aria-pressed]="!department()" (click)="department.set('')">
          All departments <span class="inline-ar">كل الأقسام</span> <span class="n">{{ inDepartment().get('') ?? 0 }}</span>
        </button>
        @for (d of departments(); track d.id) {
          <button type="button" class="segment" [class.on]="department() === d.id" [attr.aria-pressed]="department() === d.id" (click)="department.set(d.id)">
            {{ d.name }} <span class="n">{{ inDepartment().get(d.id) ?? 0 }}</span>
          </button>
        }
      </div>
    }
    @if (loading() || excelBusy()) {
      <mat-progress-bar mode="indeterminate" />
    }
    @if (error()) {
      <p class="error">{{ error() }}</p>
    } @else if (list() === 'employees') {
      @if (waiting().length) {
        <ul class="waiting">
          @for (w of waiting(); track w.id) {
            <li>
              <span class="pending-badge">{{ pendingLabel(w).en }}<span class="ar">{{ pendingLabel(w).ar }}</span></span>
              {{ w.summary }} <span class="muted small">· asked by {{ w.requestedBy }}</span>
            </li>
          }
        </ul>
      }
      <div class="table-wrap">
        <table class="grid">
          <thead>
            <tr>
              <th>Employee<span class="ar">الموظف</span></th>
              <th class="num">Pay<span class="ar">الأجر</span></th>
              <th>Work schedule<span class="ar">الدوام</span></th>
              <th>Days off<span class="ar">أيام الراحة</span></th>
              <th>Device no.<span class="ar">رقم البصمة</span></th>
              <th>Status<span class="ar">الحالة</span></th>
              <th class="num"><span class="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (e of shown(); track e.id) {
              @let asked = approvals.pendingFor(e.id);
              <tr class="opens" [class.left]="!e.isActive" [class.pending-deletion]="!!asked" (click)="profile(e)">
                <td>
                  <div class="who">
                    <span class="avatar" aria-hidden="true">{{ initials(e.name) }}</span>
                    <div>
                      <a class="name" [routerLink]="[e.id]" (click)="$event.stopPropagation()"><strong>{{ e.name }}</strong></a>
                      <div class="muted small">{{ e.jobTitle }} · {{ departmentName(e) }}</div>
                      @if (asked) {
                        <div><span class="pending-badge">{{ pendingLabel(asked).en }}<span class="ar">{{ pendingLabel(asked).ar }}</span></span></div>
                      }
                    </div>
                  </div>
                </td>
                <td class="num">
                  @if (e.employmentType === 'Daily') {
                    <span class="salary">{{ e.dailyWage | money }} a day</span>
                    <div class="muted small">Daily wage · {{ e.hourlyRate | money }} an hour</div>
                  } @else {
                    <span class="salary">{{ e.monthlySalary | money }}</span>
                    <div class="muted small">{{ e.dailyRate | money }} a day · {{ e.hourlyRate | money }} an hour</div>
                  }
                </td>
                <td class="nowrap">
                  @if (e.shiftStartsAt && e.shiftEndsAt) {
                    {{ e.shiftStartsAt.slice(0, 5) }}–{{ e.shiftEndsAt.slice(0, 5) }}
                  } @else {
                    Flexible<span class="ar">ساعات مرنة</span>
                  }
                </td>
                <td>{{ daysOff(e) }}</td>
                <td>{{ e.deviceUserId ?? '—' }}</td>
                <td>
                  @if (e.isActive) {
                    <span class="status tag ok">Employed<span class="ar">على رأس العمل</span></span>
                    <div class="muted small">since {{ e.hiredOn | date: 'd MMM y' }}</div>
                  } @else {
                    <span class="status tag">Left<span class="ar">ترك العمل</span></span>
                    <div class="muted small">last day {{ e.leftOn | date: 'd MMM y' }}</div>
                  }
                </td>
                <td class="num nowrap" (click)="$event.stopPropagation()">
                  @if (canManage()) {
                    @if (asked) {
                      <mat-icon class="locked" matTooltip="Waiting for a manager's approval">lock_clock</mat-icon>
                    } @else {
                      <button mat-icon-button (click)="edit(e)" matTooltip="Edit" [attr.aria-label]="'Edit ' + e.name"><mat-icon>edit</mat-icon></button>
                      @if (e.isActive) {
                        <button mat-icon-button class="danger" (click)="leave(e)" matTooltip="Leaves" [attr.aria-label]="e.name + ' leaves'">
                          <mat-icon>person_off</mat-icon>
                        </button>
                      } @else {
                        <button mat-icon-button (click)="comeBack(e)" matTooltip="Comes back" [attr.aria-label]="e.name + ' comes back'">
                          <mat-icon>person_add_alt</mat-icon>
                        </button>
                      }
                    }
                  }
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="7" class="muted">
                  @if (employees().length) {
                    Everyone on the list has left. Turn on “Show who has left” to see them.
                  } @else {
                    No employees yet. Add them to count their attendance and pay.
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    } @else {
      <section class="on-device" aria-labelledby="on-device-title">
        <h3 id="on-device-title">On the attendance device, not in the system yet <span class="inline-ar">على جهاز البصمة وليسوا في النظام</span></h3>
        @if (unknown().length) {
          <p class="muted small"><span class="note-ar" lang="ar" dir="rtl">كما سجّلهم الجهاز. أضف كلًّا منهم موظفًا، أو أعطِ رقمه لموظف موجود: تُحتسب بصماته من وقتها.</span> As the device listed them. Add each as an employee, or give their number to one already here: their punches count from then.</p>
          <div class="table-wrap">
            <table class="grid">
              <thead>
                <tr>
                  <th>Device no.<span class="ar">رقم البصمة</span></th>
                  <th>Name on the device<span class="ar">الاسم على الجهاز</span></th>
                  <th>Device<span class="ar">الجهاز</span></th>
                  <th class="num">Punches waiting<span class="ar">بصمات بانتظار</span></th>
                  @if (canManage()) {
                    <th class="num"><span class="visually-hidden">Add or link</span></th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (u of unknown(); track u.id) {
                  <tr>
                    <td><strong>{{ u.deviceUserId }}</strong></td>
                    <td>{{ u.name || '—' }}</td>
                    <td class="muted">{{ u.deviceName ?? u.deviceSerialNumber }}</td>
                    <td class="num">{{ u.waitingPunches }}</td>
                    @if (canManage()) {
                      <td class="num nowrap">
                        <button mat-stroked-button (click)="addFromDevice(u)"><mat-icon>person_add</mat-icon> Add as employee</button>
                        <button mat-button (click)="link(u)" [disabled]="!unnumbered().length">Link to…</button>
                      </td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else if (deviceUsers().length) {
          <p class="muted"><span class="note-ar" lang="ar" dir="rtl">كل من سجّله الجهاز موظف هنا. «مزامنة الجهاز» تقرؤه من جديد بحثًا عن أي شخص جديد.</span> Everyone the device has listed is an employee here. Sync device reads it again for anyone new.</p>
        } @else {
          <p class="muted">
            <span class="note-ar" lang="ar" dir="rtl">لم يُقرأ أي مستخدم من جهاز البصمة بعد. «مزامنة الجهاز» تقرؤهم، وكذلك «قراءة المستخدمين» لأي جهاز في تبويب أجهزة البصمة.</span>
            No users read from the attendance device yet. Sync device reads them, as does a device’s “Read its users” on
            the @if (access.has('Devices')) { <a routerLink="/hr/devices">Attendance devices</a> } @else { Attendance devices } tab.
          </p>
        }
      </section>
    }
  `,
  styleUrl: '../shared/pages.scss',
  styles: `
    .lists {
      margin: 0 0 12px;
      flex-wrap: wrap;

      .count {
        display: inline-block;
        min-width: 20px;
        margin-left: 6px;
        padding: 0 6px;
        border-radius: 999px;
        font: var(--mat-sys-label-small);
        line-height: 20px;
        background: var(--mat-sys-surface-container-high);
      }
      .waiting-count {
        background: color-mix(in srgb, var(--app-warn) 30%, transparent);
      }
    }
    /* On a phone, one under the other, each as wide as the page. */
    @media (max-width: 600px) {
      .lists {
        display: flex;
        flex-direction: column;

        mat-button-toggle + mat-button-toggle {
          border-left: none;
          border-top: solid 1px var(--mat-sys-outline);
        }
      }
    }
    .waiting {
      margin: 0 0 12px;
      padding: 0;
      list-style: none;
      display: grid;
      gap: 4px;
    }
    tr.left td {
      color: var(--mat-sys-on-surface-variant);
    }
    tr.opens {
      cursor: pointer;
    }
    // The employee: their initials in a circle, their name over their role and department.
    .who {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }
    .avatar {
      flex: none;
      display: grid;
      place-items: center;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: color-mix(in srgb, var(--mat-sys-primary) 12%, transparent);
      color: var(--mat-sys-primary);
      font: var(--mat-sys-label-large);
      font-weight: 700;
    }
    tr.left .avatar {
      background: var(--mat-sys-surface-container-high);
      color: var(--mat-sys-on-surface-variant);
    }
    a.name {
      color: inherit;
      text-decoration: none;
      font-size: 15px;

      &:hover,
      &:focus-visible {
        color: var(--mat-sys-primary);
      }
    }
    .salary {
      font-weight: 600;
      font-size: 15px;
      color: var(--mat-sys-on-surface);
    }
    // The departments to show, as pills: the one shown filled.
    .segments {
      display: flex;
      gap: 6px;
      margin: 0 0 14px;
      padding-bottom: 2px;
      overflow-x: auto;
      scrollbar-width: thin;
    }
    .segment {
      flex: none;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 36px;
      padding: 0 14px;
      border-radius: 999px;
      border: 1px solid var(--app-line-strong);
      background: var(--mat-sys-surface-container-lowest);
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-large);
      cursor: pointer;
      transition:
        background-color 140ms ease,
        color 140ms ease,
        border-color 140ms ease;

      .n {
        min-width: 22px;
        padding: 0 7px;
        border-radius: 999px;
        background: var(--mat-sys-surface-container);
        font: var(--mat-sys-label-small);
        font-weight: 700;
        line-height: 20px;
        text-align: center;
      }
      &:hover {
        background: var(--mat-sys-surface-container-low);
        color: var(--mat-sys-on-surface);
      }
      &:focus-visible {
        outline: 2px solid var(--mat-sys-primary);
        outline-offset: 2px;
      }
      &.on {
        background: var(--mat-sys-primary);
        border-color: var(--mat-sys-primary);
        color: var(--mat-sys-on-primary);

        .n {
          background: color-mix(in srgb, var(--mat-sys-on-primary) 22%, transparent);
        }
      }
    }
    .small {
      font-size: 0.85em;
    }
    .nowrap {
      white-space: nowrap;
    }
    .danger {
      color: var(--mat-sys-error);
    }
    .on-device {

      h3 {
        margin: 0;
        font: var(--mat-sys-title-small);
      }
      td.num button {
        margin-left: 4px;
      }
    }
  `,
})
export class EmployeesPage {
  private readonly api = inject(HrApi);
  private readonly auth = inject(AuthService);
  protected readonly access = inject(HrAccess);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotifyService);
  private readonly businessDay = inject(BusinessDay);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private destroyed = false;
  protected readonly approvals = inject(Approvals);
  protected readonly syncing = signal(false);
  protected readonly excelBusy = signal(false);
  protected readonly pendingLabel = pendingLabel;

  protected readonly employees = signal<Employee[]>([]);
  protected readonly deviceUsers = signal<DeviceUser[]>([]);
  protected readonly departments = signal<Department[]>([]);
  // The department shown; all of them when empty.
  protected readonly department = signal('');
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly canManage = computed(() => this.auth.can(Permissions.HrManage));
  protected readonly showLeft = signal(false);
  // The list shown: the employees, or the device's users not in the system yet (?view=device).
  readonly startList = input<string | undefined>(undefined, { alias: 'view' });
  protected readonly list = signal<EmployeeList>('employees');

  protected readonly active = computed(() => this.employees().filter((e) => e.isActive));
  protected readonly shown = computed(() =>
    (this.showLeft() ? this.employees() : this.active()).filter((e) => !this.department() || e.departmentId === this.department()),
  );
  protected readonly payroll = computed(() => this.active().reduce((sum, e) => sum + e.monthlySalary, 0));
  // How many each department has, as the list stands (those who left too, when shown); '' all.
  protected readonly inDepartment = computed(() => {
    const counts = new Map<string, number>();
    for (const e of this.showLeft() ? this.employees() : this.active()) {
      counts.set(e.departmentId, (counts.get(e.departmentId) ?? 0) + 1);
      counts.set('', (counts.get('') ?? 0) + 1);
    }
    return counts;
  });
  protected readonly daily = computed(() => this.active().filter((e) => e.employmentType === 'Daily').length);
  protected readonly waiting = computed(() => this.approvals.waitingToBeMade('Employee'));
  // The device's users whose number no employee has.
  protected readonly unknown = computed(() => this.deviceUsers().filter((u) => !u.employeeId));
  // Who a device number can go to: those employed without one.
  protected readonly unnumbered = computed(() => this.active().filter((e) => !e.deviceUserId));

  constructor() {
    effect(() => {
      const asked = this.startList();
      untracked(() => this.list.set(asked === 'device' ? 'device' : 'employees'));
    });
    this.destroyRef.onDestroy(() => (this.destroyed = true));
    void this.load();
    void this.approvals.refresh();
  }

  // Every device read now, a manager's: directly, on its own port, at the address last used here
  // (with its port and comm key) and at the address each approved device last called from; its
  // users listed below and its new punches kept. An approved one not read that way (its port
  // closed while it uses ADMS, or no address known) is asked for its users over ADMS instead,
  // and the list read again until it answers, for a minute at most.
  protected async sync(): Promise<void> {
    this.syncing.set(true);
    try {
      const approved = (await firstValueFrom(this.api.devices())).filter((d) => d.isApproved);
      const targets = new Map<string, DeviceLink>();
      const saved = savedDeviceLink();
      if (saved) {
        targets.set(saved.address, saved);
      }
      for (const d of approved) {
        const address = addressOf(d);
        if (address && !targets.has(address)) {
          targets.set(address, { address, port: ZkPort, commKey: 0 });
        }
      }
      if (!targets.size && !approved.length) {
        this.notify.info('No attendance device yet: give its IP address under Connection settings on the Attendance devices tab first.');
        return;
      }

      const read: string[] = [];
      const reached = new Set<string>();
      const unreached: string[] = [];
      for (const link of targets.values()) {
        try {
          const r = await firstValueFrom(this.api.syncDevice(link.address, link.port, link.commKey));
          reached.add(r.serialNumber);
          read.push(`${r.deviceName}: ${plural(r.users, 'user')}, ${plural(r.newPunches, 'new punch', 'new punches')}`);
        } catch (error) {
          unreached.push(errorMessage(error, `${link.address} could not be read.`));
        }
      }
      const overAdms = approved.filter((d) => !reached.has(d.serialNumber));
      const asked = await Promise.all(overAdms.map((d) => firstValueFrom(this.api.readDeviceUsers(d.id))));
      this.deviceUsers.set(await firstValueFrom(this.api.deviceUsers()));

      const said = [
        ...(read.length ? [`Synced ${read.join('; ')}.`] : []),
        ...unreached,
        ...(overAdms.length
          ? [`Asked ${overAdms.map((d) => d.name ?? d.serialNumber).join(', ')} for ${overAdms.length === 1 ? 'its' : 'their'} users over ADMS: they appear under Device users within seconds.`]
          : []),
      ].join(' ');
      if (!unreached.length) {
        this.notify.info(said);
      } else if (read.length || overAdms.length) {
        this.notify.attention(said);
      } else {
        this.notify.error(null, said);
      }

      for (let round = 0; asked.length && round < 12 && !this.destroyed; round++) {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        const devices = await firstValueFrom(this.api.devices());
        this.deviceUsers.set(await firstValueFrom(this.api.deviceUsers()));
        const answered = asked.every((c) => devices.some((d) => d.commands.some((x) => x.id === c.id && x.answeredAtUtc !== null)));
        if (answered) {
          break;
        }
      }
    } catch (error) {
      this.notify.error(error, 'The device could not be synced.');
    } finally {
      this.syncing.set(false);
    }
  }

  // Excel (a manager's or an accountant's, as entering employees is): the template to fill in, and
  // a filled-in one imported, what it did shown and the list read again; the picker cleared, so
  // the same file can be chosen again once it is put right. Anyone who sees HR exports the list.
  protected async downloadTemplate(): Promise<void> {
    await this.excel(async () => saveBlob(await firstValueFrom(this.api.employeesTemplate()), 'employees-template.xlsx'), 'The template could not be downloaded.');
  }

  protected async importFile(picker: HTMLInputElement): Promise<void> {
    const file = picker.files?.[0];
    picker.value = '';
    if (!file) {
      return;
    }
    await this.excel(async () => {
      const result = await firstValueFrom(this.api.importEmployees(file));
      this.dialog.open<EmployeeImportDialog, EmployeeImportResult>(EmployeeImportDialog, { data: result, width: '640px', maxWidth: '95vw' });
      if (result.imported.length) {
        void this.approvals.refresh();
        await this.load();
      }
    }, 'The file could not be imported.');
  }

  protected async exportEmployees(): Promise<void> {
    await this.excel(
      async () => saveBlob(await firstValueFrom(this.api.exportEmployees()), `employees-${await this.businessDay.today()}.xlsx`),
      'The employees could not be exported.',
    );
  }

  private async excel(work: () => Promise<void>, failed: string): Promise<void> {
    this.excelBusy.set(true);
    try {
      await work();
    } catch (error) {
      this.notify.error(error, failed);
    } finally {
      this.excelBusy.set(false);
    }
  }

  // Kept in the address, so a reload or coming Back shows the same list.
  protected showList(list: EmployeeList): void {
    this.list.set(list);
    void this.router.navigate([], { queryParams: { view: list === 'device' ? 'device' : null }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  protected profile(e: Employee): void {
    void this.router.navigate(['/hr/employees', e.id]);
  }

  protected departmentName(e: Employee): string {
    return this.departments().find((d) => d.id === e.departmentId)?.name ?? '—';
  }

  // Their name's first letters, for the circle beside it: "Hassan Ali" HA, "منى" م.
  protected initials(name: string): string {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0].toUpperCase())
      .join('');
  }

  // "Fri" or "Fri, Sat", in the company's week order; "None".
  protected daysOff(e: Employee): string {
    const off = weekDays.filter((d) => e.daysOff.includes(d.day)).map((d) => d.en);
    return off.length ? off.join(', ') : 'None';
  }

  protected async add(): Promise<void> {
    await this.open({ departments: this.departments(), canApprove: this.approvals.canApprove(), today: await this.businessDay.today() });
  }

  protected async edit(employee: Employee): Promise<void> {
    await this.open({ employee, departments: this.departments(), canApprove: this.approvals.canApprove(), today: await this.businessDay.today() });
  }

  // Added from the device: the list stays on its users, the one added leaving it.
  protected async addFromDevice(user: DeviceUser): Promise<void> {
    await this.open({
      fromDevice: { name: user.name, deviceUserId: user.deviceUserId },
      departments: this.departments(),
      canApprove: this.approvals.canApprove(),
      today: await this.businessDay.today(),
    });
  }

  // The employee chosen gets the number: saved as they are, with it.
  protected async link(user: DeviceUser): Promise<void> {
    const id = await firstValueFrom(
      this.dialog
        .open<LinkDeviceUserDialog, { user: DeviceUser; employees: Employee[] }, string>(LinkDeviceUserDialog, {
          data: { user, employees: this.unnumbered() },
          width: '440px',
        })
        .afterClosed(),
    );
    const employee = this.employees().find((e) => e.id === id);
    if (!employee) {
      return;
    }
    const input: EmployeeInput = {
      requestId: crypto.randomUUID(),
      name: employee.name,
      jobTitle: employee.jobTitle,
      jobRoleId: employee.jobRoleId,
      employmentType: employee.employmentType,
      monthlySalary: employee.monthlySalary,
      dailyWage: employee.dailyWage,
      departmentId: employee.departmentId,
      shiftStartsAt: employee.shiftStartsAt,
      daysOff: employee.daysOff,
      hiredOn: employee.hiredOn,
      deviceUserId: user.deviceUserId,
      nationalId: employee.nationalId,
      mobileNumber: employee.mobileNumber,
      reason: `Their number on the attendance device: ${user.deviceUserId}`,
    };
    try {
      await this.saved(await firstValueFrom(this.api.saveEmployee(employee.id, input)), `${employee.name} has number ${user.deviceUserId}: their punches count.`);
    } catch (error) {
      this.notify.error(error, 'The number could not be given.');
    }
  }

  protected async leave(employee: Employee): Promise<void> {
    await this.employment({ employee, mode: 'leave', canApprove: this.approvals.canApprove(), today: await this.businessDay.today() });
  }

  protected async comeBack(employee: Employee): Promise<void> {
    await this.employment({ employee, mode: 'return', canApprove: this.approvals.canApprove(), today: await this.businessDay.today() });
  }

  private async open(data: EmployeeDialogData): Promise<void> {
    const result = await firstValueFrom(
      this.dialog.open<EmployeeDialog, EmployeeDialogData, Employee | ApprovalResult>(EmployeeDialog, { data, width: '620px', maxWidth: '95vw' }).afterClosed(),
    );
    const name = result && !isRequested(result) ? result.name : 'The employee';
    await this.saved(
      result,
      data.employee ? `${name} saved.` : data.fromDevice ? `${name} added, with number ${data.fromDevice.deviceUserId} on the device.` : 'Employee added.',
    );
  }

  private async employment(data: EmploymentDialogData): Promise<void> {
    const result = await firstValueFrom(
      this.dialog.open<EmploymentDialog, EmploymentDialogData, Employee | ApprovalResult>(EmploymentDialog, { data, width: '440px' }).afterClosed(),
    );
    await this.saved(result, data.mode === 'leave' ? `${data.employee.name} has left.` : `${data.employee.name} is back.`);
  }

  private async saved(result: Employee | ApprovalResult | undefined, done: string): Promise<void> {
    if (!result) {
      return;
    }
    if (isRequested(result)) {
      await this.approvals.requested(result);
    } else {
      this.notify.info(done);
    }
    await this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [employees, departments] = await Promise.all([firstValueFrom(this.api.employees()), firstValueFrom(this.api.departments())]);
      this.employees.set(employees);
      this.departments.set(departments);
    } catch (error) {
      this.error.set(errorMessage(error, 'The employees could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
    try {
      this.deviceUsers.set(await firstValueFrom(this.api.deviceUsers()));
    } catch {
      // Only a help: the employees stand without it.
      this.deviceUsers.set([]);
    }
  }
}

type EmployeeList = 'employees' | 'device';

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
