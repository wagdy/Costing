import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { aCompany } from '../../../testing/fixtures';
import { Company, SettingsApi, formatMoney, loadCompany } from './company';

describe('the company’s settings in the app', () => {
  it('writes money before or after the amount, or as the number alone', () => {
    expect(formatMoney(1400, 'L.E', 'Before')).toBe('L.E 1,400.00');
    expect(formatMoney(1400.5, 'SAR', 'After')).toBe('1,400.50 SAR');
    expect(formatMoney(100000, '$', 'Before', 0)).toBe('$ 100,000');
    expect(formatMoney(1400, '', 'Before')).toBe('1,400.00');
  });

  it('is read at start-up, and the app starts without it when the server cannot be reached', async () => {
    const get = vi.fn().mockReturnValue(of(aCompany({ currencySymbol: 'SAR', currencyPosition: 'After', hasLogo: true, logoVersion: 42 })));
    TestBed.configureTestingModule({ providers: [{ provide: SettingsApi, useValue: { get } }] });
    const company = TestBed.inject(Company);
    expect([company.name(), company.money(10)]).toEqual(['HR & Payroll', '10.00']);

    await TestBed.runInInjectionContext(() => loadCompany());
    expect([company.name(), company.money(10), company.logoUrl()]).toEqual(['Acme', '10.00 SAR', '/api/settings/logo?v=42']);

    get.mockReturnValue(throwError(() => new Error('down')));
    await TestBed.runInInjectionContext(() => loadCompany());
    expect(company.name()).toBe('Acme');
  });
});
