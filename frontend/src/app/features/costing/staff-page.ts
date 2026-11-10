import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { Permissions } from '../../core/auth/permissions';
import { HrStaffApi } from '../../core/costing/hr-staff.api';
import { MenuSalesApi } from '../../core/costing/menu-sales.api';
import { Employee } from '../../core/costing/staff';
import { errorMessage } from '../../core/http/error-message';
import { NotifyService } from '../../core/ui/notify.service';
import { Treasury } from './financials';

// Staff (الموظفين): who the safe pays advances and salaries to, by name and job, and their salaries
// paid. Only that: their attendance and their payroll are an HR system's. While HR is linked they
// come from it (its code and department beside them), changed there and read again here. One who
// leaves is kept, as the safe's entries name them, and is off the lists for new ones.
@Component({
  selector: 'app-staff-page',
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressBarModule, MatSlideToggleModule],
  template: `
    @if (linked()) {
      <p class="hr-note" role="status">
        <mat-icon>link</mat-icon>
        The staff come from HR while it is linked: change them on HR, and they are read again here (every 6 hours, or on Settings → HR Integration).
        <span class="note-ar" lang="ar" dir="rtl">بيانات الموظفين من نظام الموارد البشرية أثناء الربط.</span>
      </p>
    }
    @if (canChange && !linked()) {
      <form class="toolbar add no-print" (ngSubmit)="add()" aria-label="Add someone">
        <mat-form-field subscriptSizing="dynamic">
          <mat-label>Name · الاسم</mat-label>
          <input matInput name="name" [(ngModel)]="name" maxlength="200" required />
        </mat-form-field>
        <mat-form-field subscriptSizing="dynamic">
          <mat-label>Job · الوظيفة</mat-label>
          <input matInput name="job" [(ngModel)]="job" maxlength="100" />
        </mat-form-field>
        <button mat-flat-button type="submit" [disabled]="saving() || !name.trim()"><mat-icon>person_add</mat-icon> Add <span class="inline-ar">إضافة</span></button>
      </form>
    }
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    } @else if (error(); as message) {
      <p class="error">{{ message }}</p>
    } @else {
      <div class="table-wrap narrow">
        <table class="grid" aria-label="Staff">
          <thead>
            <tr>
              <th>Name<span class="ar">الاسم</span></th>
              @if (anyFromHr()) {
                <th>Code<span class="ar">الكود</span></th>
                <th>Department<span class="ar">القسم</span></th>
              }
              <th>Job<span class="ar">الوظيفة</span></th>
              <th>Working<span class="ar">يعمل</span></th>
              <th><span class="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (e of sorted(); track e.id) {
              <tr [class.left]="!e.isActive">
                <td>
                  @if (editable(e)) {
                    <input class="inline" [ngModel]="e.name" (change)="rename(e, $any($event.target).value)" [attr.aria-label]="e.name + '’s name'" />
                  } @else {
                    <strong>{{ e.name }}</strong>
                    @if (e.hrEmployeeId) {<span class="hr-badge" title="From HR">HR</span>}
                  }
                </td>
                @if (anyFromHr()) {
                  <td class="num-code">{{ e.code ?? '' }}</td>
                  <td>{{ e.department ?? '' }}</td>
                }
                <td>
                  @if (editable(e)) {
                    <input class="inline" [ngModel]="e.jobTitle ?? ''" (change)="retitle(e, $any($event.target).value)" [attr.aria-label]="e.name + '’s job'" />
                  } @else {
                    {{ e.jobTitle ?? '—' }}
                  }
                </td>
                <td>
                  <mat-slide-toggle [checked]="e.isActive" (change)="setActive(e, $event.checked)" [disabled]="!editable(e)" [attr.aria-label]="e.name + ' working'">
                    {{ e.isActive ? 'Working · يعمل' : 'Left · ترك العمل' }}
                  </mat-slide-toggle>
                </td>
                <td class="num">
                  <button mat-stroked-button (click)="paySalary(e)"><mat-icon>payments</mat-icon> Pay salary <span class="inline-ar">صرف راتب</span></button>
                </td>
              </tr>
            } @empty {
              <tr>
                <td [attr.colspan]="anyFromHr() ? 6 : 4" class="empty">
                  No one yet. Add whoever the safe pays advances or salaries to.
                  <span class="note-ar" lang="ar" dir="rtl">لا يوجد موظفون بعد. أضف من تصرف لهم الخزنة سلفًا أو رواتب.</span>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <p class="note">
        <span class="note-ar" lang="ar" dir="rtl">الأسماء والوظائف فقط لصرف السلف والرواتب من الخزنة. الراتب المصروف يُحسب في تكلفة العمالة لشهره، وتُرى السلف في صفحة السلفيات.</span>
        Names and jobs only, for the advances and salaries the safe pays. A salary paid counts in its month’s labour cost; the advances are on
        Advances. Attendance and payroll are an HR system’s.
      </p>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .narrow {
      max-width: 900px;
    }
    .inline {
      width: 100%;
      padding: 4px 6px;
      border: 1px solid transparent;
      border-radius: 6px;
      background: transparent;
      font: inherit;
      color: inherit;
    }
    .inline:hover,
    .inline:focus {
      border-color: var(--app-line-strong);
      outline: none;
      background: var(--mat-sys-surface);
    }
    tr.left td {
      opacity: 0.65;
    }
    .hr-note {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin: 0 0 10px;
      padding: 8px 12px;
      border-radius: 12px;
      background: var(--tag-ok-bg, #dff5e6);
      color: var(--tag-ok-fg, #1b6b3a);
    }
    .hr-badge {
      margin-left: 6px;
      padding: 0 6px;
      border-radius: 6px;
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
      font: var(--mat-sys-label-small);
    }
    .num-code {
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class StaffPage {
  private readonly api = inject(MenuSalesApi);
  private readonly notify = inject(NotifyService);
  private readonly treasury = inject(Treasury);
  protected readonly canChange = inject(AuthService).can(Permissions.InventoryManage);

  private readonly hr = inject(HrStaffApi);
  protected readonly staff = signal<Employee[]>([]);
  // HR linked: its staff are changed on HR, and none is added here.
  protected readonly linked = signal(false);
  protected readonly anyFromHr = computed(() => this.staff().some((e) => !!e.hrEmployeeId));
  protected readonly sorted = computed(() => [...this.staff()].sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name)));
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected name = '';
  protected job = '';

  constructor() {
    void this.load();
  }

  protected async add(): Promise<void> {
    if (!this.name.trim()) {
      return;
    }
    this.saving.set(true);
    try {
      const saved = await firstValueFrom(this.api.saveStaff(crypto.randomUUID(), this.name.trim(), this.job.trim() || null, true));
      this.notify.info(`${saved.name} added.`);
      this.name = '';
      this.job = '';
      await this.load();
    } catch (error) {
      this.notify.error(error, 'They could not be added.');
    } finally {
      this.saving.set(false);
    }
  }

  protected editable(e: Employee): boolean {
    return this.canChange && !(this.linked() && e.hrEmployeeId);
  }

  protected rename(e: Employee, name: string): Promise<void> {
    return name.trim() && name.trim() !== e.name ? this.save(e, name.trim(), e.jobTitle, e.isActive) : Promise.resolve();
  }

  protected retitle(e: Employee, job: string): Promise<void> {
    return (job.trim() || null) !== e.jobTitle ? this.save(e, e.name, job.trim() || null, e.isActive) : Promise.resolve();
  }

  // A month's salary, from the safe or a day's takings: one who has left is paid what they are owed too.
  protected async paySalary(e: Employee): Promise<void> {
    await this.treasury.enter('SalaryPayment', { employeeId: e.id });
  }

  protected setActive(e: Employee, active: boolean): Promise<void> {
    return this.save(e, e.name, e.jobTitle, active);
  }

  private async save(e: Employee, name: string, job: string | null, active: boolean): Promise<void> {
    try {
      const saved = await firstValueFrom(this.api.saveStaff(e.id, name, job, active));
      this.staff.update((all) => all.map((x) => (x.id === saved.id ? saved : x)));
    } catch (error) {
      this.notify.error(error, 'It could not be saved.');
      await this.load();
    }
  }

  private async load(): Promise<void> {
    try {
      const [staff, hr] = await Promise.all([
        firstValueFrom(this.api.staff()),
        firstValueFrom(this.hr.status()).catch(() => ({ linked: false, employeesSyncedAtUtc: null })),
      ]);
      this.staff.set(staff);
      this.linked.set(hr.linked);
      this.error.set(null);
    } catch (error) {
      this.error.set(errorMessage(error, 'The staff could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }
}
