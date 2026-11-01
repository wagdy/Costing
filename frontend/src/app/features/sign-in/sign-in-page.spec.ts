import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { signedOutGuard } from '../../core/auth/guards';
import { PortalAuth } from '../../core/portal/portal-auth';
import { Company } from '../../core/settings/company';
import { aCompany } from '../../../testing/fixtures';
import { SignInPage, signInAs } from './sign-in-page';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

describe('who is signing in, by what they typed', () => {
  it('takes an email for a user’s and a mobile number for an employee’s', () => {
    expect(signInAs('  omar@example.com ')).toBe('user');
    expect(signInAs('01012345678')).toBe('employee');
    expect(signInAs('+20 101 234-5678')).toBe('employee');
    expect(signInAs('(010) 1234 5678')).toBe('employee');
    expect(signInAs('٠١٠١٢٣٤٥٦٧٨')).toBe('employee');
    expect(signInAs('omar')).toBeNull();
    expect(signInAs('010abc')).toBeNull();
    expect(signInAs(' + ')).toBeNull();
    expect(signInAs('')).toBeNull();
  });
});

describe('the one sign-in', () => {
  const signIn = vi.fn();
  const employeeSignIn = vi.fn();

  async function render(reason?: string) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { employeeActing: () => false, me: () => null, signIn, can: () => true } },
        { provide: PortalAuth, useValue: { signIn: employeeSignIn } },
      ],
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
    employeeSignIn.mockReset().mockResolvedValue(undefined);
  });

  it('asks for an email or a mobile number and a password or PIN, in one form, and links to nothing else', async () => {
    const { el } = await render();

    expect([...el.querySelectorAll('mat-label')].map(text)).toEqual(['Email or Mobile number', 'Password or PIN']);
    expect(el.querySelectorAll('form')).toHaveLength(1);
    expect(el.querySelector('a')).toBeNull();
    // The company: its initials in place of a logo, and its name.
    expect(text(el.querySelector('.mark')!)).toBe('OK');
    expect(text(el.querySelector('h1')!)).toBe('Otantik Kitchen');
  });

  it('signs a user in with their email and password, and goes to the system', async () => {
    const { type, send, navigate } = await render();

    await type('login', '  omar@example.com ');
    await type('secret', 'change-me-now');
    await send();

    expect(signIn).toHaveBeenCalledWith('omar@example.com', 'change-me-now');
    expect(employeeSignIn).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/hr']);
  });

  it('signs an employee in with their mobile number and PIN, and goes to their portal', async () => {
    const { type, send, navigate } = await render();

    await type('login', ' 01012345678 ');
    await type('secret', ' 2468 ');
    await send();

    expect(employeeSignIn).toHaveBeenCalledWith('01012345678', '2468');
    expect(signIn).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/my-profile']);
  });

  it('says who it takes them for as they type', async () => {
    const { el, field, type } = await render();
    const hint = () => text(el.querySelector('mat-hint')!);
    const icon = () => text(el.querySelector('.field mat-icon')!);

    expect(hint()).toBe('Employees: your mobile number الموظف: رقم الموبايل');
    await type('login', 'omar@');
    expect([icon(), hint()]).toEqual(['alternate_email', 'Manager or accountant: your password below']);
    expect(field('secret').getAttribute('inputmode')).toBeNull();
    await type('login', '0101');
    expect([icon(), hint()]).toEqual(['smartphone', 'Employee: your PIN below الموظف: الرقم السري']);
    expect(field('secret').getAttribute('inputmode')).toBe('numeric');
    await type('login', 'omar');
    expect([icon(), hint()]).toEqual(['person_outline', 'An email has its @; a mobile number is its digits']);
  });

  it('sends nothing until both are there, and something it can tell', async () => {
    const { el, type, send } = await render();

    await type('login', 'omar@example.com');
    await send();
    expect(text(el.querySelector('.error > span')!)).toBe('Enter your email or mobile number, and your password or PIN.');

    await type('login', 'omar');
    await type('secret', 'change-me-now');
    await send();
    expect(text(el.querySelector('.error > span')!)).toBe('Enter your email, or your mobile number.');
    expect(signIn).not.toHaveBeenCalled();
    expect(employeeSignIn).not.toHaveBeenCalled();
  });

  it('says what the API said when refused, and clears the PIN', async () => {
    employeeSignIn.mockRejectedValue(new HttpErrorResponse({ status: 401, error: { title: 'Sign-in failed.', detail: 'Wrong mobile number or PIN.' } }));
    const { el, field, type, send, navigate } = await render();

    await type('login', '01012345678');
    await type('secret', '1111');
    await send();

    expect(text(el.querySelector('.error')!)).toContain('Wrong mobile number or PIN.');
    expect(field('secret').value).toBe('');
    expect(navigate).not.toHaveBeenCalled();
  });

  // On the portal's own port no user signs in: the API is not found there.
  it('tells a user on the office Wi-Fi where they sign in', async () => {
    signIn.mockRejectedValue(new HttpErrorResponse({ status: 404 }));
    const { el, type, send, navigate } = await render();

    await type('login', 'omar@example.com');
    await type('secret', 'change-me-now');
    await send();

    expect(text(el.querySelector('.error')!)).toContain('only employees sign in');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('says the session has ended', async () => {
    const { el } = await render('expired');
    expect(text(el.querySelector('.notice > span')!)).toBe('Your session has ended. Sign in again. سجّل الدخول مرة أخرى');
  });
});

describe('the sign-in, for one already signed in', () => {
  function guard(user: boolean, employee: boolean) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { isSignedIn: () => user } },
        { provide: PortalAuth, useValue: { isSignedIn: () => employee } },
      ],
    });
    const result = TestBed.runInInjectionContext(() => signedOutGuard({} as never, {} as never));
    return result instanceof UrlTree ? TestBed.inject(Router).serializeUrl(result) : result;
  }

  it('sends a user to the system and an employee to their portal', () => {
    expect(guard(true, false)).toBe('/hr');
    expect(guard(false, true)).toBe('/my-profile');
    expect(guard(false, false)).toBe(true);
  });
});
