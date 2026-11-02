import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { signedOutGuard } from '../../core/auth/guards';
import { Company } from '../../core/settings/company';
import { aCompany } from '../../../testing/fixtures';
import { SignInPage } from './sign-in-page';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

describe('the sign-in', () => {
  const signIn = vi.fn();

  async function render(reason?: string) {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AuthService, useValue: { me: () => null, signIn, can: () => true } }],
    });
    TestBed.inject(Company).settings.set(aCompany({ name: 'Otantik Kitchen' }));
    const fixture = TestBed.createComponent(SignInPage);
    if (reason) {
      fixture.componentRef.setInput('reason', reason);
    }
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const field = (name: string) => el.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
    const type = async (name: string, value: string) => {
      field(name).value = value;
      field(name).dispatchEvent(new Event('input'));
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    const send = async () => {
      el.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
      await fixture.whenStable();
      fixture.detectChanges();
      // ngModel writes a field's new value on the turn after.
      await fixture.whenStable();
    };
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    return { el, field, type, send, navigate };
  }

  // A block: a function handed back from beforeEach would be called as its teardown.
  beforeEach(() => {
    signIn.mockReset().mockResolvedValue(undefined);
  });

  it('asks for an email and a password, in one form, under the company’s name', async () => {
    const { el } = await render();

    expect([...el.querySelectorAll('mat-label')].map(text)).toEqual(['Email · البريد الإلكتروني', 'Password · كلمة المرور']);
    expect(el.querySelectorAll('form')).toHaveLength(1);
    expect(el.querySelector('a')).toBeNull();
    // The company: its initials in place of a logo, its name, and the system's.
    expect(text(el.querySelector('.mark')!)).toBe('OK');
    expect(text(el.querySelector('h1')!)).toBe('Otantik Kitchen');
    expect(text(el.querySelector('.product')!)).toBe('Costing & Financials التكاليف والماليات');
  });

  it('signs a user in with their email and password, and goes to the system', async () => {
    const { type, send, navigate } = await render();

    await type('login', '  omar@example.com ');
    await type('secret', 'change-me-now');
    await send();

    expect(signIn).toHaveBeenCalledWith('omar@example.com', 'change-me-now');
    expect(navigate).toHaveBeenCalledWith(['/costing']);
  });

  it('sends nothing until both are there, and an email it can tell', async () => {
    const { el, type, send } = await render();

    await type('login', 'omar@example.com');
    await send();
    expect(text(el.querySelector('.error > span')!)).toBe('Enter your email and your password.');

    await type('login', 'omar');
    await type('secret', 'change-me-now');
    await send();
    expect(text(el.querySelector('.error > span')!)).toBe('Enter your email: it has an @ in it.');
    expect(signIn).not.toHaveBeenCalled();
  });

  it('says what the API said when refused, and clears the password', async () => {
    signIn.mockRejectedValue(new HttpErrorResponse({ status: 401, error: { title: 'Sign-in failed.', detail: 'Wrong email or password.' } }));
    const { el, field, type, send, navigate } = await render();

    await type('login', 'omar@example.com');
    await type('secret', 'wrong');
    await send();

    expect(text(el.querySelector('.error')!)).toContain('Wrong email or password.');
    expect(field('secret').value).toBe('');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('says the session has ended', async () => {
    const { el } = await render('expired');
    expect(text(el.querySelector('.notice > span')!)).toBe('Your session has ended. Sign in again. سجّل الدخول مرة أخرى');
  });
});

describe('the sign-in, for one already signed in', () => {
  function guard(user: boolean) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AuthService, useValue: { isSignedIn: () => user } }],
    });
    const result = TestBed.runInInjectionContext(() => signedOutGuard({} as never, {} as never));
    return result instanceof UrlTree ? TestBed.inject(Router).serializeUrl(result) : result;
  }

  it('sends a user on to the system', () => {
    expect(guard(true)).toBe('/costing');
    expect(guard(false)).toBe(true);
  });
});
