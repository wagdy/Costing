import { HttpErrorResponse } from '@angular/common/http';
import { Component, ViewEncapsulation, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { homePath } from '../../core/auth/guards';
import { errorMessage } from '../../core/http/error-message';
import { PortalAuth } from '../../core/portal/portal-auth';
import { Company } from '../../core/settings/company';

// Who is signing in, by what they typed: an email (it has an @) is a user's, a manager's or an
// accountant's, with their password; a mobile number (its digits, Arabic ones too, with any
// spaces, dashes or brackets, and + from abroad) is an employee's, with their PIN.
export type SignInAs = 'user' | 'employee';

export function signInAs(typed: string): SignInAs | null {
  const login = typed.trim();
  if (login.includes('@')) {
    return 'user';
  }
  return /^[+\d٠-٩\s()-]+$/.test(login) && /[\d٠-٩]/.test(login) ? 'employee' : null;
}

// The one sign-in, for everyone (/sign-in; /portal, the employees' address, opens it too). A user
// goes on to the system (homePath: their first HR tab, or Custody, or their account); an employee
// to their own portal (/my-profile), where the HR tabs a manager gave them are. The two sessions
// stay apart (AuthService, PortalAuth), each with its own API.
//
// On the portal's own port (the office Wi-Fi) no user signs in: the API is not found there.
//
// Unencapsulated, to style the Material fields inside; every rule is under .sign-in.
@Component({
  selector: 'app-sign-in-page',
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressSpinnerModule],
  templateUrl: './sign-in-page.html',
  styleUrl: './sign-in-page.scss',
  encapsulation: ViewEncapsulation.None,
})
export class SignInPage {
  protected readonly company = inject(Company);
  private readonly auth = inject(AuthService);
  private readonly portal = inject(PortalAuth);
  private readonly router = inject(Router);

  // ?reason=expired, when the API stopped accepting the last session.
  readonly reason = input<string>();

  protected readonly login = signal('');
  protected readonly secret = signal('');
  protected readonly who = computed(() => signInAs(this.login()));
  protected readonly showSecret = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  // The company's mark when it has no logo: its name's first letters.
  protected readonly initials = computed(() =>
    this.company
      .name()
      .split(/[\s&·-]+/)
      .filter((word) => /^\p{L}/u.test(word))
      .slice(0, 2)
      .map((word) => word[0].toUpperCase())
      .join(''),
  );

  protected async submit(): Promise<void> {
    if (this.busy()) {
      return;
    }
    const login = this.login().trim();
    const as = signInAs(login);
    if (!login || !this.secret()) {
      this.error.set('Enter your email or mobile number, and your password or PIN.');
      return;
    }
    if (!as) {
      this.error.set('Enter your email, or your mobile number.');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      if (as === 'user') {
        await this.auth.signIn(login, this.secret());
        await this.router.navigate([homePath]);
      } else {
        await this.portal.signIn(login, this.secret().trim());
        await this.router.navigate(['/my-profile']);
      }
    } catch (error) {
      this.error.set(
        as === 'user' && error instanceof HttpErrorResponse && error.status === 404
          ? 'Here, on the office Wi-Fi, only employees sign in, with their mobile number. Managers and accountants sign in at the system’s own address.'
          : errorMessage(error, 'Sign-in failed.'),
      );
      this.secret.set('');
    } finally {
      this.busy.set(false);
    }
  }
}
