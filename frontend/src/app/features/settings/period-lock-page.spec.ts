import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthService } from '../../core/auth/auth.service';
import { Permissions } from '../../core/auth/permissions';
import { PeriodLock, PeriodLockApi, SecurityAuditEntry } from '../../core/settings/period-lock';
import { NotifyService } from '../../core/ui/notify.service';
import { PeriodLockPage } from './period-lock-page';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

function entry(over: Partial<SecurityAuditEntry>): SecurityAuditEntry {
  return {
    id: crypto.randomUUID(), occurredAtUtc: '2026-11-02T09:00:00Z', action: 'PeriodLocked', description: 'PeriodLocked: 31-Oct-2026 by Wagdy',
    previousValue: '2026-09-30', newValue: '2026-10-31', reason: null, by: 'Wagdy', ...over,
  };
}

function state(over: Partial<PeriodLock> = {}): PeriodLock {
  return { lockedUntil: null, today: '2026-11-18', lastClosedDay: '2026-11-17', suggestedUntil: '2026-10-31', history: [], ...over };
}

describe('the period lock', () => {
  const api = { get: vi.fn(), lock: vi.fn(), unlock: vi.fn() };
  const notify = { info: vi.fn(), error: vi.fn() };
  let owner = true;

  async function render(s: PeriodLock) {
    api.get.mockReturnValue(of(s));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: PeriodLockApi, useValue: api },
        { provide: NotifyService, useValue: notify },
        { provide: AuthService, useValue: { can: (p: string) => p !== Permissions.SettingsUnlockPeriods || owner } },
      ],
    });
    const fixture = TestBed.createComponent(PeriodLockPage);
    const settle = async () => {
      await fixture.whenStable();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    await settle();
    const el = fixture.nativeElement as HTMLElement;
    const type = async (label: string, value: string) => {
      const input = el.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      await settle();
    };
    const button = (label: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => text(b).includes(label))!;
    return { fixture, el, settle, type, button };
  }

  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    notify.info.mockReset();
    notify.error.mockReset();
    owner = true;
  });

  afterEach(() => TestBed.resetTestingModule());

  it('says plainly how far the books are closed, and lists every change under it', async () => {
    const { el } = await render(state({
      lockedUntil: '2026-10-31', suggestedUntil: null,
      history: [entry({}), entry({ action: 'PeriodUnlocked', previousValue: '2026-10-31', newValue: '2026-09-30', reason: 'Auditor adjustment',
        description: 'PeriodUnlocked: rolled back to 30-Sep-2026 by Wagdy. Reason: Auditor adjustment', occurredAtUtc: '2026-11-01T09:00:00Z' })],
    }));
    expect(el.querySelector('.panel')!.classList).toContain('is-locked');
    expect(text(el.querySelector('.status')!)).toContain('All books are locked up to October 31, 2026. No changes allowed before this date.');
    expect(text(el.querySelector('.status')!)).toContain('جميع الدفاتر مقفلة حتى 31 Oct 2026');
    const rows = [...el.querySelectorAll('tbody tr')].map((r) => [...r.querySelectorAll('td')].slice(1).map(text));
    expect(rows).toEqual([
      ['lock Locked إقفال', '30 Sep 2026 → 31 Oct 2026', 'Wagdy', '—'],
      ['lock_open Unlocked فتح', '31 Oct 2026 → 30 Sep 2026', 'Wagdy', 'Auditor adjustment'],
    ]);
  });

  it('closes a month only once LOCK is typed, the month’s end suggested', async () => {
    const { el, type, button, settle } = await render(state({ lockedUntil: '2026-09-30' }));
    expect(text(el.querySelector('.status')!)).toContain('All books are locked up to September 30, 2026.');
    const date = el.querySelector<HTMLInputElement>('[aria-label="Lock the books until"]')!;
    expect([date.value, date.min, date.max]).toEqual(['2026-10-31', '2026-10-01', '2026-11-17']);
    expect(button('Lock books').disabled).toBe(true);
    await type('Type LOCK to confirm', 'lock');
    expect(button('Lock books').disabled).toBe(true);
    await type('Type LOCK to confirm', 'LOCK');
    expect(button('Lock books').disabled).toBe(false);

    api.lock.mockReturnValue(of(state({ lockedUntil: '2026-10-31', suggestedUntil: null, history: [entry({})] })));
    button('Lock books').click();
    await settle();
    expect(api.lock).toHaveBeenCalledWith('2026-10-31', 'LOCK');
    expect(notify.info).toHaveBeenCalledWith('The books are locked until 31 Oct 2026. · تم إقفال الدفاتر.');
    expect(el.querySelector<HTMLInputElement>('[aria-label="Type LOCK to confirm"]')!.value).toBe('');
    expect(text(el.querySelector('.status')!)).toContain('All books are locked up to October 31, 2026.');
  });

  it('opens a closed period only for the owner and only with why, back to a day or altogether', async () => {
    const { el, type, button, settle, fixture } = await render(state({ lockedUntil: '2026-10-31', suggestedUntil: null }));
    expect(el.querySelector<HTMLInputElement>('[aria-label="Keep the books closed until"]')!.max).toBe('2026-10-30');
    await type('Keep the books closed until', '2026-09-30');
    await type('Reason for the exceptional unlock', ' ok ');
    expect(button('Unlock · فتح الفترة').disabled).toBe(true);
    await type('Reason for the exceptional unlock', 'Auditor adjustment');
    expect(button('Unlock · فتح الفترة').disabled).toBe(false);

    api.unlock.mockReturnValue(of(state({ lockedUntil: '2026-09-30', suggestedUntil: '2026-10-31', history: [
      entry({ action: 'PeriodUnlocked', previousValue: '2026-10-31', newValue: '2026-09-30', reason: 'Auditor adjustment' })] })));
    button('Unlock · فتح الفترة').click();
    await settle();
    expect(api.unlock).toHaveBeenCalledWith('2026-09-30', 'Auditor adjustment');
    expect(notify.info).toHaveBeenCalledWith('The books are now closed until 30 Sep 2026. · تم فتح الفترة استثنائياً.');
    // The reason emptied, and not marked wrong for it.
    expect(el.querySelector('mat-form-field.reason')!.classList).not.toContain('mat-form-field-invalid');
    // Opened again: the day it was offered to close it again.
    expect(text(el.querySelector('.reopened')!)).toContain('Lock it again up to 31 Oct 2026 once the adjustment is done.');
    button('Lock again until').click();
    await settle();
    expect(el.querySelector<HTMLInputElement>('[aria-label="Lock the books until"]')!.value).toBe('2026-10-31');

    // Lifted altogether.
    await type('Reason for the exceptional unlock', 'Opening balances re-entered');
    const lift = el.querySelector<HTMLInputElement>('mat-checkbox input')!;
    lift.click();
    await settle();
    expect(el.querySelector('[aria-label="Keep the books closed until"]')).toBeNull();
    api.unlock.mockReturnValue(of(state({ lockedUntil: null })));
    button('Unlock · فتح الفترة').click();
    await settle();
    expect(api.unlock).toHaveBeenLastCalledWith(null, 'Opening balances re-entered');
    expect(notify.info).toHaveBeenLastCalledWith('The lock is lifted: every day is open. · تم فتح جميع الفترات.');
    expect(text(el.querySelector('.status')!)).toContain('No period is locked.');
    expect(fixture.nativeElement.querySelector('.panel').classList).not.toContain('is-locked');
  });

  it('offers no unlock to a manager who is not the owner', async () => {
    owner = false;
    const { el } = await render(state({ lockedUntil: '2026-10-31' }));
    expect(el.querySelector('[aria-label="Reason for the exceptional unlock"]')).toBeNull();
    expect(text(el.querySelector('[aria-labelledby="unlock-title"]')!)).toContain('Only the owner can open a closed period again.');
  });

  it('says why when the lock is refused, and when it cannot be read', async () => {
    const { type, button, settle } = await render(state());
    await type('Type LOCK to confirm', 'LOCK');
    const refused = new HttpErrorResponse({ status: 422, error: { errors: ['The last day closed is 29 Oct 2026: lock the books up to it at the latest.'] } });
    api.lock.mockReturnValue(throwError(() => refused));
    button('Lock books').click();
    await settle();
    expect(notify.error).toHaveBeenCalledWith(refused, 'The books could not be locked.');

    TestBed.resetTestingModule();
    api.get.mockReset();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: PeriodLockApi, useValue: { ...api, get: () => throwError(() => new HttpErrorResponse({ status: 0 })) } },
        { provide: NotifyService, useValue: notify },
        { provide: AuthService, useValue: { can: () => true } },
      ],
    });
    const fixture = TestBed.createComponent(PeriodLockPage);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(text(fixture.nativeElement.querySelector('[role=alert]'))).toBe('The server cannot be reached. Check this device is connected.');
  });
});
