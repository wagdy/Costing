import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../../core/auth/auth.service';
import { HrAccess } from '../../core/hr/hr-access';
import { NotifyService } from '../../core/ui/notify.service';
import { accountantMe } from '../../../testing/fixtures';
import { AccountPage } from './account-page';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

describe('their own account', () => {
  const changePassword = vi.fn();
  const notify = { info: vi.fn(), error: vi.fn() };

  async function render(tabs: string[] = []) {
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { me: signal(accountantMe), changePassword } },
        { provide: HrAccess, useValue: { tabs: signal(new Set(tabs)) } },
        { provide: NotifyService, useValue: notify },
      ],
    });
    const fixture = TestBed.createComponent(AccountPage);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const type = (name: string, value: string) => {
      const input = el.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    const send = async () => {
      el.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    return { el, type, send };
  }

  beforeEach(() => {
    changePassword.mockReset().mockResolvedValue(undefined);
    notify.info.mockReset();
  });

  it('says who they are, and that a manager gives the tabs they do not hold yet', async () => {
    const { el } = await render();

    expect([...el.querySelectorAll('.who dt, .who dd')].map(text)).toEqual(['Name', 'Mona', 'Email', 'mona@example.com', 'Role', 'Accountantمحاسب']);
    expect(text(el.querySelector('.note')!)).toContain('You hold no HR tab yet.');
  });

  it('changes the password with the current one, typed twice the same', async () => {
    const { el, type, send } = await render(['Employees']);
    expect(el.querySelector('.note')).toBeNull();

    type('current', 'change-me-now');
    type('next', 'a-better-one');
    type('again', 'a-better-on');
    await send();
    expect(text(el.querySelector('.error')!)).toBe('The new password is not the same both times.');
    expect(changePassword).not.toHaveBeenCalled();

    type('again', 'a-better-one');
    await send();
    expect(changePassword).toHaveBeenCalledWith('change-me-now', 'a-better-one');
    expect(notify.info).toHaveBeenCalledWith('Password changed. You are signed out everywhere else.');
    expect(el.querySelector('.error')).toBeNull();
  });

  it('says what the API said when the current one is wrong', async () => {
    changePassword.mockRejectedValue(new HttpErrorResponse({ status: 400, error: { detail: 'Your current password is not right.' } }));
    const { el, type, send } = await render();

    type('current', 'not-it-at-all');
    type('next', 'a-better-one');
    type('again', 'a-better-one');
    await send();

    expect(text(el.querySelector('.error')!)).toBe('Your current password is not right.');
  });
});
