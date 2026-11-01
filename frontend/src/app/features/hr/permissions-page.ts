import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { errorMessage } from '../../core/http/error-message';
import { EmployeeHrAccess, HrApi, StaffHrAccess } from '../../core/hr/hr.api';
import { HrTab, HrTabInfo, allHrTabs, custodyTab, givenTabs, hrTabs, hrTabsOf } from '../../core/hr/hr-tabs';
import { NotifyService } from '../../core/ui/notify.service';

// Someone who can be given tabs: an employee, who works them in the portal on their phone, or an
// accountant, who works them here in the system. EveryTab: an accountant no manager has ticked
// yet, who has every tab until then.
export interface Holder {
  key: string;
  kind: 'employee' | 'staff';
  id: string;
  name: string;
  sub: string;
  tabs: HrTab[];
  everyTab: boolean;
  hasMobile?: boolean;
  hasPin?: boolean;
  setBy?: string | null;
  setAtUtc?: string | null;
}

export function holderOf(e: EmployeeHrAccess): Holder;
export function holderOf(s: StaffHrAccess, staff: true): Holder;
export function holderOf(x: EmployeeHrAccess | StaffHrAccess, staff = false): Holder {
  if (staff) {
    const s = x as StaffHrAccess;
    return {
      key: `staff:${s.id}`, kind: 'staff', id: s.id, name: s.name, sub: 'Accountant · محاسب', tabs: s.tabs, everyTab: !s.restricted, setBy: s.setBy,
      setAtUtc: s.setAtUtc,
    };
  }
  const e = x as EmployeeHrAccess;
  return {
    key: `employee:${e.id}`, kind: 'employee', id: e.id, name: e.name, sub: `${e.jobTitle} · ${e.department}`, tabs: e.tabs, everyTab: false,
    hasMobile: e.hasMobile, hasPin: e.hasPin,
  };
}

const hasAccess = (h: Holder) => h.everyTab || h.tabs.length > 0;

// The permissions as the dialog groups them: HR & Payroll's tabs, then Custody & Assets.
const groups: { en: string; ar: string; tabs: readonly HrTabInfo[] }[] = [
  { en: 'HR & Payroll', ar: 'الموارد البشرية والرواتب', tabs: hrTabs },
  { en: 'Custody & Assets', ar: 'العهدة والأصول', tabs: [custodyTab] },
];

export interface AccessDialogData {
  // Everyone who can be given tabs, to pick from.
  people: Holder[];
  // The one whose permissions change; none to pick someone.
  person?: Holder;
}

export interface AccessAnswer {
  person: Holder;
  tabs: HrTab[];
}

// Add permission (إضافة صلاحية): first who, from a list searched by name (an employee or an
// accountant; one with permissions already shows them, to change), then which permissions, each
// with what it lets them do. Saving with no one picked says so. Closes with who and the tabs ticked.
@Component({
  selector: 'app-access-dialog',
  imports: [FormsModule, MatAutocompleteModule, MatButtonModule, MatCheckboxModule, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>
      @if (data.person) {
        {{ data.person.name }}’s permissions <span class="inline-ar">تعديل الصلاحيات</span>
      } @else {
        Add permission <span class="inline-ar">إضافة صلاحية</span>
      }
    </h2>
    <mat-dialog-content>
      <section class="step">
        <h3><span class="step-n">1</span> Who · الشخص</h3>
        <mat-form-field class="wide" subscriptSizing="dynamic">
          <mat-label>Employee or accountant · الموظف أو المحاسب</mat-label>
          <mat-icon matPrefix>search</mat-icon>
          <input matInput [matAutocomplete]="who" [ngModel]="query()" (ngModelChange)="typed($event)" [disabled]="!!data.person" placeholder="Type a name"
            aria-label="Who" />
          <mat-autocomplete #who="matAutocomplete" autoActiveFirstOption>
            @for (p of matches(); track p.key) {
              <mat-option [value]="p.key">
                <span class="opt-name">{{ p.name }}</span> <span class="opt-sub">{{ p.sub }}</span>
                @if (hasAccess(p)) {
                  <span class="opt-has">· has permissions</span>
                }
              </mat-option>
            } @empty {
              <mat-option disabled>No one is called that · لا يوجد</mat-option>
            }
          </mat-autocomplete>
        </mat-form-field>
        @if (person(); as p) {
          @if (p.kind === 'employee' && (!p.hasMobile || !p.hasPin)) {
            <p class="warn">
              They need a mobile number and a PIN to sign in to the portal: set {{ !p.hasMobile ? 'them' : 'a PIN' }} on their profile.
              <span class="inline-ar">يحتاج رقم موبايل ورقمًا سريًا للدخول</span>
            </p>
          }
          @if (p.everyTab) {
            <p class="muted small">Every tab until now, as no one has ticked theirs. <span class="inline-ar">كل الصلاحيات حتى الآن</span></p>
          }
        }
      </section>

      <section class="step" [class.waiting]="!person()">
        <h3><span class="step-n">2</span> Permissions · الصلاحيات</h3>
        <mat-checkbox class="all" [checked]="every()" [indeterminate]="some()" [disabled]="!person()" (change)="all($event.checked)">
          Every permission <span class="inline-ar">كل الصلاحيات</span>
        </mat-checkbox>
        @for (g of groups; track g.en) {
          <h4>{{ g.en }} <span class="inline-ar">{{ g.ar }}</span></h4>
          <div class="tabs">
            @for (t of g.tabs; track t.tab) {
              <mat-checkbox class="tab-option" [class.on]="chosen().has(t.tab)" [checked]="chosen().has(t.tab)" [disabled]="!person()"
                (change)="tick(t.tab, $event.checked)" [attr.data-tab]="t.tab">
                <span class="t-name">{{ t.en }} <span class="inline-ar">{{ t.ar }}</span></span>
                <span class="t-hint">{{ t.hint.en }} · {{ t.hint.ar }}</span>
              </mat-checkbox>
            }
          </div>
        }
        <p class="muted small">
          <span class="note-ar" lang="ar" dir="rtl">يرون هذه الصلاحيات فقط. تعديل بيانات موظف أو سلفة أو أصل ينتظر موافقة المدير؛ وباقي العمل يُنفَّذ فورًا. يستخدم الموظف صلاحياته في البوابة من هاتفه، والحفظ يُخرجه منها ليدخل من جديد.</span>
          They see only these. A change to someone’s record, an advance or an asset waits for a manager; the rest is done at once. An employee uses theirs
          in the portal on their phone; saving signs them out of it, to sign in again.
        </p>
      </section>
      @if (error(); as e) {
        <p class="error" role="alert">{{ e }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button (click)="save()">Save · حفظ</button>
    </mat-dialog-actions>
  `,
  styleUrl: '../shared/pages.scss',
  styles: `
    .step {
      margin-bottom: 14px;

      &.waiting {
        opacity: 0.6;
      }
      h3 {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 4px 0 10px;
        font: var(--mat-sys-title-small);
        font-weight: 650;
      }
      h4 {
        margin: 12px 0 4px;
        color: var(--mat-sys-on-surface-variant);
        font: var(--mat-sys-label-large);
      }
    }
    .step-n {
      display: inline-grid;
      place-items: center;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: var(--mat-sys-primary);
      color: var(--mat-sys-on-primary);
      font: var(--mat-sys-label-medium);
      font-weight: 700;
    }
    .wide {
      width: 100%;
    }
    .all {
      display: block;
      font-weight: 600;
    }
    .tabs {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
      gap: 6px;
    }
    .tab-option {
      padding: 4px 8px 4px 0;
      border-radius: 12px;
      border: 1px solid var(--app-line);

      &.on {
        border-color: color-mix(in srgb, var(--mat-sys-primary) 55%, transparent);
        background: color-mix(in srgb, var(--mat-sys-primary) 6%, transparent);
      }
    }
    .t-name {
      display: block;
      font-weight: 600;
    }
    .t-hint {
      display: block;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .opt-sub,
    .opt-has {
      margin-inline-start: 6px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .opt-has {
      color: var(--tag-ok-fg);
    }
    .small {
      font-size: 0.85em;
    }
    .warn {
      padding: 8px 10px;
      border-radius: 10px;
      background: var(--tag-warn-bg);
      color: var(--tag-warn-fg);
    }
  `,
})
export class AccessDialog {
  protected readonly data = inject<AccessDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<AccessDialog, AccessAnswer>>(MatDialogRef);
  protected readonly groups = groups;
  protected readonly hasAccess = hasAccess;
  private readonly byKey = new Map(this.data.people.map((p) => [p.key, p]));

  protected readonly query = signal(this.data.person?.name ?? '');
  protected readonly person = signal<Holder | null>(this.data.person ?? null);
  protected readonly chosen = signal<ReadonlySet<HrTab>>(new Set(this.tabsOf(this.data.person)));
  protected readonly error = signal<string | null>(null);
  protected readonly matches = computed(() => {
    const q = this.query().trim().toLowerCase();
    return this.data.people.filter((p) => !q || p.name.toLowerCase().includes(q) || p.sub.toLowerCase().includes(q)).slice(0, 50);
  });
  protected readonly every = computed(() => this.chosen().size === allHrTabs.length);
  protected readonly some = computed(() => this.chosen().size > 0 && !this.every());

  // What is typed searches; a person picked from the list is chosen, with the tabs they have.
  protected typed(value: string): void {
    const picked = this.byKey.get(value);
    if (picked) {
      this.person.set(picked);
      this.query.set(picked.name);
      this.chosen.set(new Set(this.tabsOf(picked)));
      this.error.set(null);
      return;
    }
    this.query.set(value);
    if (this.person() && value !== this.person()!.name) {
      this.person.set(null);
    }
  }

  protected tick(tab: HrTab, on: boolean): void {
    this.chosen.update((now) => {
      const next = new Set(now);
      if (on) {
        next.add(tab);
      } else {
        next.delete(tab);
      }
      return next;
    });
  }

  protected all(on: boolean): void {
    this.chosen.set(new Set(on ? allHrTabs : []));
  }

  protected save(): void {
    const person = this.person();
    if (!person) {
      this.error.set('Choose who first. · اختر الشخص أولًا');
      return;
    }
    this.ref.close({ person, tabs: hrTabsOf([...this.chosen()]) });
  }

  private tabsOf(person: Holder | undefined | null): readonly HrTab[] {
    return !person ? [] : person.everyTab ? allHrTabs : person.tabs;
  }
}

// Employee permissions (صلاحيات الموظفين), a manager's: who works which tabs of HR & Payroll and
// Custody & Assets. The table lists only those with any: an employee with tabs, who works them in
// the portal on their phone, and each accountant, who has every tab until a manager ticks theirs.
// "Add permission" picks someone, from everyone, and their tabs; each row changes them, or takes
// them all off. Shift Rostering is a tab of its own.
@Component({
  selector: 'app-permissions-page',
  imports: [DatePipe, FormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressBarModule, MatTooltipModule, RouterLink],
  template: `
    <p class="note">
      <span class="note-ar" lang="ar" dir="rtl">أعطِ كل شخص الصلاحيات التي يعمل عليها من الموارد البشرية والرواتب والعهدة والأصول. يستخدم الموظف صلاحياته في البوابة من هاتفه، ويسجّل الدخول برقم الموبايل والرقم السري، وينجز عملها كما يفعل المدير، مع انتظار تعديل بيانات موظف أو سلفة أو أصل لموافقة المدير؛ ويستخدم المحاسب صلاحياته هنا في النظام. للمدير كل الصلاحيات.</span>
      Give each the permissions of HR &amp; Payroll, and Custody &amp; Assets, they work. An employee uses theirs in the portal on their phone, signing in
      with their mobile number and PIN, and does the work as a manager would, a change to someone’s record, an advance or an asset waiting for a
      manager; an accountant uses theirs here in the system. A manager has every permission.
    </p>
    <div class="toolbar">
      <mat-form-field subscriptSizing="dynamic" class="find">
        <mat-label>Find · بحث</mat-label>
        <input matInput [ngModel]="query()" (ngModelChange)="query.set($event)" aria-label="Find" />
        <mat-icon matSuffix>search</mat-icon>
      </mat-form-field>
      <span class="spacer"></span>
      <button mat-flat-button class="add" (click)="add()" [disabled]="loading()"><mat-icon>add</mat-icon> Add permission <span class="inline-ar">إضافة صلاحية</span></button>
    </div>
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    @if (error(); as e) {
      <p class="error">{{ e }}</p>
    } @else {
      <div class="table-wrap">
        <table class="grid access">
          <thead>
            <tr>
              <th>Who<span class="ar">الشخص</span></th>
              <th>Permissions<span class="ar">الصلاحيات</span></th>
              <th>Signs in<span class="ar">الدخول</span></th>
              <th class="num"><span class="visually-hidden">Change</span></th>
            </tr>
          </thead>
          <tbody>
            @for (h of shown(); track h.key) {
              <tr>
                <td>
                  <div class="who">
                    <span class="avatar" [class.staff]="h.kind === 'staff'" aria-hidden="true">{{ initials(h.name) }}</span>
                    <div>
                      @if (h.kind === 'employee') {
                        <a [routerLink]="['/hr/employees', h.id]"><strong>{{ h.name }}</strong></a>
                      } @else {
                        <strong>{{ h.name }}</strong>
                      }
                      <div class="muted small">{{ h.sub }}</div>
                    </div>
                  </div>
                </td>
                <td class="perms">
                  @if (h.everyTab) {
                    <span class="perm every">Every permission · كل الصلاحيات</span>
                    <div class="muted small">Until you tick theirs</div>
                  } @else {
                    @for (t of h.tabs; track t) {
                      <span class="perm">{{ label(t) }}</span>
                    }
                  }
                </td>
                <td class="small">
                  @if (h.kind === 'employee') {
                    @if (h.hasMobile && h.hasPin) {
                      <span class="tag ok">Portal · البوابة</span>
                    } @else {
                      <span class="tag warn">{{ !h.hasMobile ? 'No mobile number' : 'No PIN yet' }}</span>
                    }
                  } @else {
                    <span class="tag info">The system · النظام</span>
                    @if (h.setBy) {
                      <div class="muted">by {{ h.setBy }}, {{ h.setAtUtc | date: 'd MMM y' }}</div>
                    }
                  }
                </td>
                <td class="num nowrap">
                  <button mat-icon-button (click)="change(h)" matTooltip="Change · تعديل" [attr.aria-label]="'Change ' + h.name + '’s permissions'">
                    <mat-icon>edit</mat-icon>
                  </button>
                  <button mat-icon-button class="danger" (click)="remove(h)" matTooltip="Take them off · إزالة" [attr.aria-label]="'Take off ' + h.name + '’s permissions'">
                    <mat-icon>person_remove</mat-icon>
                  </button>
                </td>
              </tr>
            } @empty {
              @if (!loading()) {
                <tr>
                  <td colspan="4" class="empty">
                    <mat-icon>admin_panel_settings</mat-icon>
                    @if (query()) {
                      <span class="note-ar" lang="ar" dir="rtl">لا يوجد صاحب صلاحيات بهذا الاسم.</span>
                      No one with permissions is called that.
                    } @else {
                      <span class="note-ar" lang="ar" dir="rtl">لا يملك أحد صلاحيات بعد. اضغط «إضافة صلاحية» لتمنح موظفًا أو محاسبًا ما يعمل عليه.</span>
                      No one has permissions yet. Press Add permission to give an employee or an accountant what they work.
                    }
                  </td>
                </tr>
              }
            }
          </tbody>
        </table>
      </div>
    }
  `,
  styleUrl: '../shared/pages.scss',
  styles: `
    .find {
      min-width: 240px;
    }
    .who {
      display: flex;
      align-items: center;
      gap: 12px;
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

      &.staff {
        background: var(--tag-accent-bg);
        color: var(--tag-accent-fg);
      }
    }
    .perms {
      max-width: 520px;
    }
    .perm {
      display: inline-block;
      margin: 2px 4px 2px 0;
      padding: 2px 10px;
      border-radius: 999px;
      font: var(--mat-sys-label-medium);
      font-weight: 600;
      background: var(--mat-sys-surface-container);
      color: var(--mat-sys-on-surface);

      &.every {
        background: var(--tag-ok-bg);
        color: var(--tag-ok-fg);
      }
    }
    .muted {
      color: var(--mat-sys-on-surface-variant);
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
  `,
})
export class PermissionsPage {
  private readonly api = inject(HrApi);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotifyService);

  protected readonly query = signal('');
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  private readonly employees = signal<EmployeeHrAccess[]>([]);
  private readonly staff = signal<StaffHrAccess[]>([]);

  // Everyone who can be given tabs, by name: the employees employed, and the accountants.
  private readonly people = computed(() =>
    [...this.employees().map((e) => holderOf(e)), ...this.staff().map((s) => holderOf(s, true))].sort((a, b) => a.name.localeCompare(b.name)),
  );
  // Those with any, as the table lists them.
  protected readonly shown = computed(() => {
    const q = this.query().trim().toLowerCase();
    return this.people().filter((h) => hasAccess(h) && (!q || h.name.toLowerCase().includes(q) || h.sub.toLowerCase().includes(q)));
  });

  constructor() {
    void this.load();
  }

  protected label(tab: HrTab): string {
    return givenTabs.find((t) => t.tab === tab)?.en ?? tab;
  }

  protected initials(name: string): string {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0].toUpperCase())
      .join('');
  }

  protected async add(): Promise<void> {
    await this.ask({ people: this.people() });
  }

  protected async change(person: Holder): Promise<void> {
    await this.ask({ people: this.people(), person });
  }

  // All their tabs taken off: they keep their account, and can be given some again.
  protected async remove(person: Holder): Promise<void> {
    await this.save(person, []);
  }

  private async ask(data: AccessDialogData): Promise<void> {
    const answer = await firstValueFrom(
      this.dialog.open<AccessDialog, AccessDialogData, AccessAnswer>(AccessDialog, { data, width: '640px', maxWidth: '95vw' }).afterClosed(),
    );
    if (answer) {
      await this.save(answer.person, answer.tabs);
    }
  }

  private async save(person: Holder, tabs: HrTab[]): Promise<void> {
    try {
      if (person.kind === 'employee') {
        const saved = await firstValueFrom(this.api.setEmployeeTabs(person.id, tabs));
        this.employees.update((list) => list.map((x) => (x.id === saved.id ? saved : x)));
      } else {
        const saved = await firstValueFrom(this.api.setStaffTabs(person.id, tabs));
        this.staff.update((list) => list.map((x) => (x.id === saved.id ? saved : x)));
      }
      this.notify.info(tabs.length ? `${person.name}’s permissions: ${tabs.map((t) => this.label(t)).join(', ')}.` : `${person.name} has no permissions now.`);
    } catch (error) {
      this.notify.error(errorMessage(error, 'Their permissions could not be saved.'));
    }
  }

  private async load(): Promise<void> {
    try {
      const list = await firstValueFrom(this.api.access());
      this.employees.set(list.employees);
      this.staff.set(list.staff);
    } catch (error) {
      this.error.set(errorMessage(error, 'Who has which permission could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }
}
