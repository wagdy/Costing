import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { UserRole } from '../../core/api/models';
import { MinPasswordLength, NewUser, User, UserChange, roleLabels } from '../../core/users/users.api';

const dialogStyles = `
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
`;

export interface UserDialogData {
  // The user changed; none for someone new.
  user?: User;
  // Their own account: they keep their manager's rights, which another manager takes away.
  self?: boolean;
}

// A user added (with the password they first sign in with) or changed. Closes with what to send.
@Component({
  selector: 'app-user-dialog',
  imports: [FormsModule, MatButtonModule, MatCheckboxModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <h2 mat-dialog-title>{{ data.user ? 'Change ' + data.user.fullName : 'Add a user' }} <span class="ar">{{ data.user ? 'تعديل مستخدم' : 'مستخدم جديد' }}</span></h2>
    <mat-dialog-content>
      <mat-form-field class="wide">
        <mat-label>Full name · الاسم</mat-label>
        <input matInput [(ngModel)]="fullName" maxlength="200" aria-label="Full name" />
      </mat-form-field>
      <mat-form-field class="wide">
        <mat-label>Email · البريد الإلكتروني</mat-label>
        <input matInput type="email" [(ngModel)]="email" maxlength="256" autocomplete="off" aria-label="Email" />
      </mat-form-field>
      <mat-form-field class="wide">
        <mat-label>Role · الدور</mat-label>
        <mat-select [(ngModel)]="role" [disabled]="!!data.self" aria-label="Role">
          @for (r of roles; track r) {
            <mat-option [value]="r">{{ labels[r].en }} · {{ labels[r].ar }}</mat-option>
          }
        </mat-select>
        <mat-hint>{{ role === 'Manager' ? 'Does everything, and approves what accountants ask.' : 'Works the HR tabs a manager gives them; their changes wait for a manager.' }}</mat-hint>
      </mat-form-field>
      @if (data.user) {
        <mat-checkbox [(ngModel)]="isActive" [disabled]="!!data.self">Active: can sign in · نشط</mat-checkbox>
        @if (data.self) {
          <p class="muted">Your own role and access are another manager's to change.</p>
        }
      } @else {
        <mat-form-field class="wide">
          <mat-label>Password · كلمة المرور</mat-label>
          <input matInput type="text" [(ngModel)]="password" autocomplete="new-password" aria-label="Password" />
          <mat-hint>{{ minLength }} characters at least. Give it to them; they can change it on their account.</mat-hint>
        </mat-form-field>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button [disabled]="!ready()" [mat-dialog-close]="result()">Save</button>
    </mat-dialog-actions>
  `,
  styles: dialogStyles,
})
export class UserDialog {
  protected readonly data = inject<UserDialogData>(MAT_DIALOG_DATA);
  protected readonly roles: UserRole[] = ['Manager', 'Accountant'];
  protected readonly labels = roleLabels;
  protected readonly minLength = MinPasswordLength;
  protected fullName = this.data.user?.fullName ?? '';
  protected email = this.data.user?.email ?? '';
  protected role: UserRole = this.data.user?.role ?? 'Accountant';
  protected isActive = this.data.user?.isActive ?? true;
  protected password = '';

  protected ready(): boolean {
    return !!this.fullName.trim() && this.email.includes('@') && (!!this.data.user || this.password.length >= MinPasswordLength);
  }

  protected result(): NewUser | UserChange {
    const common = { email: this.email.trim(), fullName: this.fullName.trim(), role: this.role };
    return this.data.user ? { ...common, isActive: this.isActive } : { ...common, password: this.password };
  }
}

// A new password for someone who forgot theirs, or is locked out. Closes with it.
@Component({
  selector: 'app-reset-password-dialog',
  imports: [FormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>A new password for {{ data.fullName }} <span class="ar">كلمة مرور جديدة</span></h2>
    <mat-dialog-content>
      <p class="muted">They are signed out wherever they are signed in, and sign in again with this one.</p>
      <mat-form-field class="wide">
        <mat-label>New password · كلمة المرور</mat-label>
        <input matInput type="text" [(ngModel)]="password" autocomplete="new-password" aria-label="New password" />
        <mat-hint>{{ minLength }} characters at least.</mat-hint>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button [disabled]="password.length < minLength" [mat-dialog-close]="password">Set the password</button>
    </mat-dialog-actions>
  `,
  styles: dialogStyles,
})
export class ResetPasswordDialog {
  protected readonly data = inject<User>(MAT_DIALOG_DATA);
  protected readonly minLength = MinPasswordLength;
  protected password = '';
}
