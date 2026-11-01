import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { errorMessage } from '../../core/http/error-message';
import { NotifyService } from '../../core/ui/notify.service';
import { NewUser, User, UserChange, UsersApi, roleLabels } from '../../core/users/users.api';
import { ResetPasswordDialog, UserDialog, UserDialogData } from './user-dialogs';

const rank = (user: User) => (user.role === 'Manager' ? 0 : 1);

// Users (المستخدمون): who signs in to the system, a manager's to keep. Each is a manager or an
// accountant, signs in with their email and a password, and is deactivated rather than deleted.
// There is always one active manager. Employees are not here: they sign in to their portal with
// the mobile number and PIN set on their profile.
@Component({
  selector: 'app-users-page',
  imports: [DatePipe, MatButtonModule, MatIconModule, MatProgressBarModule],
  template: `
    <header class="head">
      <h1>Users <span class="inline-ar">المستخدمون</span></h1>
    </header>
    <div class="toolbar">
      <p class="note"><span class="note-ar" lang="ar" dir="rtl">من يسجّل الدخول إلى النظام: المديرون، والمحاسبون الذين يعملون على تبويبات الموارد البشرية التي يمنحها لهم المدير.</span> Who signs in to the system: managers, and accountants who work the HR tabs a manager gives them.</p>
      <span class="spacer"></span>
      <button mat-flat-button (click)="add()"><mat-icon>person_add</mat-icon> Add a user</button>
    </div>
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    } @else if (error()) {
      <p class="error">{{ error() }}</p>
    } @else {
      <div class="table-wrap">
        <table class="grid">
          <thead>
            <tr>
              <th>Name<span class="ar">الاسم</span></th>
              <th>Email<span class="ar">البريد الإلكتروني</span></th>
              <th>Role<span class="ar">الدور</span></th>
              <th>Last signed in<span class="ar">آخر دخول</span></th>
              <th class="num"><span class="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (u of sorted(); track u.id) {
              <tr [class.inactive]="!u.isActive">
                <td>
                  {{ u.fullName }}
                  @if (u.id === auth.me()?.id) {
                    <span class="tag">You</span>
                  }
                  @if (!u.isActive) {
                    <span class="tag">Deactivated</span>
                  } @else if (u.isLocked) {
                    <span class="tag warn">Locked: too many wrong passwords</span>
                  }
                </td>
                <td>{{ u.email }}</td>
                <td>{{ labels[u.role].en }}<span class="ar">{{ labels[u.role].ar }}</span></td>
                <td class="muted">{{ u.lastSignInAtUtc ? (u.lastSignInAtUtc | date: 'd MMM y, HH:mm') : 'Never' }}</td>
                <td class="num actions">
                  <button mat-stroked-button (click)="change(u)"><mat-icon>edit</mat-icon> Change</button>
                  <button mat-stroked-button (click)="resetPassword(u)"><mat-icon>key</mat-icon> New password</button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
  styleUrl: '../shared/pages.scss',
  styles: `
    .head h1 {
      margin: 0 0 8px;
      font: var(--mat-sys-headline-small);
    }
    .toolbar .note {
      margin: 0;
    }
    .actions {
      white-space: nowrap;

      button + button {
        margin-left: 6px;
      }
    }
    tr.inactive td {
      color: var(--mat-sys-on-surface-variant);
    }
    .tag {
      margin-inline-start: 6px;
    }
    .muted {
      color: var(--mat-sys-on-surface-variant);
    }
  `,
})
export class UsersPage {
  private readonly api = inject(UsersApi);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotifyService);
  protected readonly auth = inject(AuthService);

  protected readonly labels = roleLabels;
  protected readonly users = signal<User[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  // The active first, managers before accountants, then by name.
  protected readonly sorted = computed(() =>
    [...this.users()].sort(
      (a, b) => Number(b.isActive) - Number(a.isActive) || rank(a) - rank(b) || a.fullName.localeCompare(b.fullName),
    ),
  );

  constructor() {
    void this.load();
  }

  protected async add(): Promise<void> {
    const user = await firstValueFrom(this.dialog.open<UserDialog, UserDialogData, NewUser>(UserDialog, { data: {}, width: '460px' }).afterClosed());
    if (!user) {
      return;
    }
    try {
      const made = await firstValueFrom(this.api.create(user));
      this.users.update((all) => [...all, made]);
      this.notify.info(`${made.fullName} can sign in with ${made.email} and the password you gave.`);
    } catch (error) {
      this.notify.error(error, 'The user could not be added.');
    }
  }

  protected async change(user: User): Promise<void> {
    const change = await firstValueFrom(
      this.dialog
        .open<UserDialog, UserDialogData, UserChange>(UserDialog, { data: { user, self: user.id === this.auth.me()?.id }, width: '460px' })
        .afterClosed(),
    );
    if (!change) {
      return;
    }
    try {
      const saved = await firstValueFrom(this.api.update(user.id, change));
      this.users.update((all) => all.map((u) => (u.id === saved.id ? saved : u)));
      this.notify.info(saved.isActive ? `${saved.fullName} saved.` : `${saved.fullName} is deactivated and signed out.`);
    } catch (error) {
      this.notify.error(error, 'The user could not be saved.');
    }
  }

  protected async resetPassword(user: User): Promise<void> {
    const password = await firstValueFrom(this.dialog.open<ResetPasswordDialog, User, string>(ResetPasswordDialog, { data: user, width: '420px' }).afterClosed());
    if (!password) {
      return;
    }
    try {
      await firstValueFrom(this.api.resetPassword(user.id, password));
      this.users.update((all) => all.map((u) => (u.id === user.id ? { ...u, isLocked: false } : u)));
      this.notify.info(`${user.fullName} signs in with the new password.`);
    } catch (error) {
      this.notify.error(error, 'The password could not be set.');
    }
  }

  private async load(): Promise<void> {
    try {
      this.users.set(await firstValueFrom(this.api.all()));
    } catch (error) {
      this.error.set(errorMessage(error, 'The users could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }
}
