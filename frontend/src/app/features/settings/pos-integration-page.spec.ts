import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { PosIntegration, PosIntegrationApi, PosSyncLog } from '../../core/settings/pos-integration';
import { NotifyService } from '../../core/ui/notify.service';
import { PosIntegrationPage } from './pos-integration-page';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

function aLog(overrides: Partial<PosSyncLog>): PosSyncLog {
  return { id: crypto.randomUUID(), atUtc: '2026-11-09T20:00:00Z', endpoint: 'z-report', outcome: 'Recorded', message: 'Z report of 9 Nov 2026 recorded.',
    zReportId: null, businessDate: '2026-11-09', detail: null, ...overrides };
}

describe('the POS integration settings', () => {
  const get = vi.fn();
  const newKey = vi.fn();

  async function render(state: PosIntegration) {
    get.mockReturnValue(of(state));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: PosIntegrationApi, useValue: { get, newKey } },
        { provide: NotifyService, useValue: { info: vi.fn(), error: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(PosIntegrationPage);
    const settle = async () => {
      await fixture.whenStable();
      fixture.detectChanges();
    };
    await settle();
    return { el: fixture.nativeElement as HTMLElement, settle, fixture };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('makes the first key and shows it in full this once, for the POS', async () => {
    newKey.mockReturnValue(of({ key: 'cpk_secret-1234', keyHint: '••••1234', createdAtUtc: '2026-11-10T09:00:00Z', createdBy: 'Boss' }));
    const { el, settle } = await render({ hasKey: false, keyHint: null, keyCreatedAtUtc: null, keyCreatedBy: null, logs: [] });
    expect(text(el.querySelector('section')!)).toContain('No key yet');
    get.mockReturnValue(of({ hasKey: true, keyHint: '••••1234', keyCreatedAtUtc: '2026-11-10T09:00:00Z', keyCreatedBy: 'Boss', logs: [] }));

    [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => text(b).includes('Generate key'))!.click();
    await settle();

    expect(newKey).toHaveBeenCalled();
    expect(text(el.querySelector('[data-testid=new-key]')!)).toBe('cpk_secret-1234');
    expect(text(el.querySelector('.facts')!)).toContain('••••1234');
    expect([...el.querySelectorAll('button')].map(text).some((t) => t.includes('Regenerate key'))).toBe(true);
  });

  it('lists every call the POS made, the problems apart', async () => {
    const { el, settle } = await render({
      hasKey: true, keyHint: '••••1234', keyCreatedAtUtc: '2026-11-10T09:00:00Z', keyCreatedBy: 'Boss',
      logs: [
        aLog({ outcome: 'Refused', message: '9999 is not on the menu.' }),
        aLog({ endpoint: 'ping', outcome: 'Unauthorized', message: 'Refused: no X-API-Key.', businessDate: null }),
        aLog({}),
        aLog({ endpoint: 'menu', outcome: 'Served', message: 'Menu read by the POS: 18 items.', businessDate: null }),
      ],
    });
    const rows = () => [...el.querySelectorAll('tbody tr')].map((r) => text(r.querySelectorAll('td')[2]));

    expect(rows()).toEqual(['Refusedمرفوض', 'Wrong keyمفتاح خاطئ', 'Recordedسُجل', 'Readقراءة']);
    expect(el.querySelectorAll('tbody tr.problem')).toHaveLength(2);

    [...el.querySelectorAll<HTMLButtonElement>('.pill')].find((b) => text(b).startsWith('Problems'))!.click();
    await settle();
    expect(rows()).toEqual(['Refusedمرفوض', 'Wrong keyمفتاح خاطئ']);
    [...el.querySelectorAll<HTMLButtonElement>('.pill')].find((b) => text(b).startsWith('Z reports'))!.click();
    await settle();
    expect(rows()).toEqual(['Refusedمرفوض', 'Recordedسُجل']);
  });
});
