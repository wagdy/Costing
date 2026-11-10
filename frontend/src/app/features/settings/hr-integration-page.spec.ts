import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { HrIntegration, HrIntegrationApi, HrSyncLog } from '../../core/settings/hr-integration';
import { NotifyService } from '../../core/ui/notify.service';
import { HrIntegrationPage } from './hr-integration-page';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

function aLog(overrides: Partial<HrSyncLog>): HrSyncLog {
  return { id: crypto.randomUUID(), atUtc: '2026-11-10T20:00:00Z', direction: 'Outbound', call: 'employee-advance', outcome: 'Sent',
    message: 'Advance · Mona Adel · L.E 250.00', reference: null, detail: null, ...overrides };
}

function aState(overrides: Partial<HrIntegration> = {}): HrIntegration {
  return {
    enabled: false, baseUrl: null, hasHrKey: false, hrKeyHint: null, hasKey: false, keyHint: null, keyCreatedAtUtc: null, keyCreatedBy: null,
    employeesSyncedAtUtc: null, employeesSynced: 0, pending: 0, failed: 0, logs: [], outbox: [], ...overrides,
  };
}

describe('the HR integration settings', () => {
  const api = { get: vi.fn(), save: vi.fn(), newKey: vi.fn(), test: vi.fn(), syncEmployees: vi.fn(), sendNow: vi.fn(), retry: vi.fn() };
  const notify = { info: vi.fn(), error: vi.fn() };

  async function render(state: HrIntegration) {
    api.get.mockReturnValue(of(state));
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: HrIntegrationApi, useValue: api }, { provide: NotifyService, useValue: notify }],
    });
    const fixture = TestBed.createComponent(HrIntegrationPage);
    const settle = async () => {
      await fixture.whenStable();
      fixture.detectChanges();
    };
    await settle();
    return { el: fixture.nativeElement as HTMLElement, settle, page: fixture.componentInstance as unknown as Record<string, any> };
  }

  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    notify.info.mockReset();
  });
  afterEach(() => TestBed.resetTestingModule());

  it('starts unlinked, and switches the link on with HR’s address and key, never showing the key again', async () => {
    const { el, settle, page } = await render(aState());
    expect(text(el.querySelector('.status')!)).toBe('Not linked · غير مفعّل');
    api.save.mockReturnValue(of(aState({ enabled: true, baseUrl: 'https://hr.example.com', hasHrKey: true, hrKeyHint: '••••cdef' })));

    Object.assign(page, { enabled: true, baseUrl: ' https://hr.example.com ', hrKey: ' hck_secret-cdef ' });
    await page['save']();
    await settle();

    expect(api.save).toHaveBeenCalledWith(true, 'https://hr.example.com', 'hck_secret-cdef');
    expect(text(el.querySelector('.status')!)).toBe('Linked · مفعّل');
    expect(page['hrKey']).toBe('');
    expect(el.querySelector<HTMLInputElement>('input[name=hrKey]')!.placeholder).toContain('••••cdef');
    expect(notify.info).toHaveBeenCalledWith('The HR link is on. · تم تفعيل الربط.');
  });

  it('tests the link and reads HR’s employees, saying what came of each', async () => {
    const linked = aState({ enabled: true, baseUrl: 'https://hr.example.com', hasHrKey: true, hrKeyHint: '••••cdef' });
    const { el, settle } = await render(linked);
    api.test.mockReturnValue(of({ ok: false, message: 'HR could not be reached at https://hr.example.com.' }));
    api.syncEmployees.mockReturnValue(of({ received: 12, added: 3, updated: 9, left: 1, atUtc: '2026-11-10T20:00:00Z' }));

    [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => text(b).includes('Test connection'))!.click();
    await settle();
    expect(text(el.querySelector('.result.bad')!)).toContain('HR could not be reached');

    [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => text(b).includes('Sync employees now'))!.click();
    await settle();
    expect(text(el.querySelector('#staff-title')!.parentElement!)).toContain('12 read from HR: 3 added, 9 changed, 1 marked as left.');
  });

  it('makes this system’s key for HR and shows it this once', async () => {
    const { el, settle } = await render(aState());
    api.newKey.mockReturnValue(of({ key: 'chr_secret-9876', keyHint: '••••9876', createdAtUtc: '2026-11-10T09:00:00Z' }));

    [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => text(b).includes('Generate key'))!.click();
    await settle();

    expect(text(el.querySelector('[data-testid=new-key]')!)).toBe('chr_secret-9876');
  });

  it('lists what waits for HR, tries a refused one again, and shows the log both ways, the problems apart', async () => {
    const { el, settle, page } = await render(aState({
      enabled: true, baseUrl: 'https://hr.example.com', hasHrKey: true, pending: 1, failed: 1,
      outbox: [
        { id: 'o1', kind: 'employee-advance', action: 'create', idempotencyKey: 'a1', summary: 'Advance · Mona Adel · L.E 250.00', status: 'Failed', attempts: 1,
          nextAttemptAtUtc: '2026-11-10T20:00:00Z', lastError: 'Mona Adel is not one of this system’s employees.', createdAtUtc: '2026-11-10T20:00:00Z', sentAtUtc: null },
      ],
      logs: [
        aLog({}),
        aLog({ direction: 'Inbound', call: 'payroll-run', outcome: 'Recorded', message: 'Payroll of October 2026 recorded.' }),
        aLog({ direction: 'Inbound', call: 'ping', outcome: 'Unauthorized', message: 'Refused: no X-API-Key.' }),
      ],
    }));
    expect(text(el.querySelector('table[aria-label="Waiting to be sent"] tbody')!)).toContain('not one of this system’s employees');
    expect(page['count']('in')).toBe(2);
    expect(page['count']('out')).toBe(1);
    expect(page['count']('problems')).toBe(1);

    api.retry.mockReturnValue(of({}));
    api.sendNow.mockReturnValue(of({ sent: 1 }));
    [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => text(b).includes('Try again'))!.click();
    await settle();
    expect(api.retry).toHaveBeenCalledWith('o1');
    expect(api.sendNow).toHaveBeenCalled();
  });
});
