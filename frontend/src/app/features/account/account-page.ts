import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { AuthService } from '../../core/auth/auth.service';
import { HrAccess } from '../../core/hr/hr-access';
import { errorMessage } from '../../core/http/error-message';
import { NotifyService } from '../../core/ui/notify.service';
import { MinPasswordLength, roleLabels } from '../../core/users/users.api';

// Their own account (حسابي): who they are signed in as, and their password, changed with the
// one they have now. Changing it signs them out everywhere else. Where a user lands who holds no
// tab yet, until a manager gives them some.
@Component({
  selector: 'app-account-page',
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule],
  template: `
    <header class="head">
      <h1>Your account <span class="inline-ar">حسابي</span></h1>
    </header>
    @if (auth.me(); as me) {
      <dl class="who">
        <dt>Name</dt>
        <dd>{{ me.fullName }}</dd>
        <dt>Email</dt>
        <dd>{{ me.email }}</dd>
        <dt>Role</dt>
        <dd>{{ labels[me.role].en }}<span class="inline-ar">{{ labels[me.role].ar }}</span></dd>
      </dl>
      @if (noTabs()) {
        <p class="note"><span class="note-ar" lang="ar" dir="rtl">ليس لديك أي تبويب في الموارد البشرية بعد. يمنحها المدير من تبويب صلاحيات الموظفين.</span> You hold no HR tab yet. A manager gives them on HR &amp; Payroll's Permissions tab.</p>
      }
    }

    <h2>Change your password <span class="inline-ar">تغيير كلمة المرور</span></h2>
    <form class="password" (ngSubmit)="change()">
      <mat-form-field>
        <mat-label>Current password</mat-label>
        <input matInput type="password" name="current" autocomplete="current-password" [(ngModel)]="current" [disabled]="busy()" />
      </mat-form-field>
      <mat-form-field>
        <mat-label>New password</mat-label>
        <input matInput type="password" name="next" autocomplete="new-password" [(ngModel)]="next" [disabled]="busy()" />
        <mat-hint>{{ minLength }} characters at least.</mat-hint>
      </mat-form-field>
      <mat-form-field>
        <mat-label>New password again</mat-label>
        <input matInput type="password" name="again" autocomplete="new-password" [(ngModel)]="again" [disabled]="busy()" />
      </mat-form-field>
      @if (error(); as message) {
        <p class="error" role="alert">{{ message }}</p>
      }
      <div>
        <button mat-flat-button type="submit" [disabled]="busy()"><mat-icon>key</mat-icon> Change the password</button>
      </div>
    </form>
  `,
  styleUrl: '../shared/pages.scss',
  styles: `
    .head h1 {
      margin: 0 0 8px;
      font: var(--mat-sys-headline-small);
    }
    h2 {
      margin: 24px 0 8px;
      font: var(--mat-sys-title-medium);
    }
    .who {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 6px 16px;
      margin: 0 0 12px;

      dt {
        color: var(--mat-sys-on-surface-variant);
      }
      dd {
        margin: 0;
      }
    }
    .password {
      display: grid;
      gap: 4px;
      max-width: 360px;
    }
  `,
})
export class AccountPage {
  protected readonly auth = inject(AuthService);
  private readonly access = inject(HrAccess);
  private readonly notify = inject(NotifyService);

  protected readonly labels = roleLabels;
  protected readonly minLength = MinPasswordLength;
  protected readonly noTabs = computed(() => this.access.tabs().size === 0);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected current = '';
  protected next = '';
  protected again = '';

  protected async change(): Promise<void> {
    if (this.busy()) {
      return;
    }
    if (!this.current || !this.next) {
      this.error.set('Enter your current password and the new one.');
      return;
    }
    if (this.next.length < MinPasswordLength) {
      this.error.set(`A password is ${MinPasswordLength} characters at least.`);
      return;
    }
    if (this.next !== this.again) {
      this.error.set('The new password is not the same both times.');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.changePassword(this.current, this.next);
      this.current = this.next = this.again = '';
      this.notify.info('Password changed. You are signed out everywhere else.');
    } catch (error) {
      this.error.set(errorMessage(error, 'The password could not be changed.'));
    } finally {
      this.busy.set(false);
    }
  }
}
