import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { Permissions } from '../../core/auth/permissions';
import { CostingApi } from '../../core/costing/costing.api';
import { NotifyService } from '../../core/ui/notify.service';
import { TaxServicePage } from './tax-service-page';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

describe('tax and service', () => {
  const financialSettings = vi.fn();
  const saveFinancialSettings = vi.fn();
  const notify = { info: vi.fn(), error: vi.fn() };

  async function render(manager: boolean) {
    TestBed.configureTestingModule({
      providers: [
        { provide: CostingApi, useValue: { financialSettings, saveFinancialSettings } },
        { provide: AuthService, useValue: { me: () => null, can: (p: string) => p !== Permissions.ApprovalDecide || manager } },
        { provide: NotifyService, useValue: notify },
      ],
    });
    const fixture = TestBed.createComponent(TaxServicePage);
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, page: fixture.componentInstance as unknown as Record<string, any> };
  }

  beforeEach(() => {
    financialSettings.mockReset().mockReturnValue(of({ taxPercent: 14, servicePercent: 0, updatedBy: null, updatedAtUtc: null }));
    saveFinancialSettings.mockReset().mockReturnValue(of({ taxPercent: 14, servicePercent: 12, updatedBy: 'Omar', updatedAtUtc: '2026-10-13T09:00:00Z' }));
    notify.info.mockReset();
  });

  it('lets a manager set the bills’ tax rate and the service charge', async () => {
    saveFinancialSettings.mockReturnValue(of({ taxPercent: 14.5, servicePercent: 12, updatedBy: 'Omar', updatedAtUtc: '2026-10-13T09:00:00Z' }));
    const { el, page, fixture } = await render(true);

    expect(el.querySelector<HTMLInputElement>('input[aria-label="Tax rate"]')!.disabled).toBe(false);
    expect(page['tax']).toBe(14);
    expect(page['changed']()).toBe(false);
    page['tax'] = 100;
    expect(page['problem']()).toBe('The tax is a percentage from 0 up to 100.');
    page['tax'] = null;
    expect(page['problem']()).toBe('Enter the tax rate: 0 for none.');
    page['tax'] = 14.5;
    page['service'] = 100;
    expect(page['problem']()).toBe('The service charge is a percentage from 0 up to 100.');
    page['service'] = 12;
    expect(page['changed']()).toBe(true);
    await page['save']();
    fixture.detectChanges();

    expect(saveFinancialSettings).toHaveBeenCalledWith(12, 14.5);
    expect(notify.info).toHaveBeenCalledWith('Tax 14.5%, service charge 12%.');
    expect(text(el)).toContain('Last set by Omar');
  });

  it('shows the accountant the settings, for a manager to change', async () => {
    financialSettings.mockReturnValue(of({ taxPercent: null, servicePercent: 12, updatedBy: 'Omar', updatedAtUtc: '2026-10-13T09:00:00Z' }));
    const { el } = await render(false);

    expect(text(el)).toContain('Not set yet: takings are entered without tax until it is.');
    expect(el.querySelector<HTMLInputElement>('input[aria-label="Tax rate"]')!.disabled).toBe(true);
    expect([...el.querySelectorAll('button')].map(text).some((t) => t.startsWith('Save'))).toBe(false);
    expect(text(el)).toContain('A manager sets the tax and the service charge.');
  });
});
