import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import type { WeekDay } from '../hr/hr.api';

// Company Settings (إعدادات الشركة), as the API keeps them (/api/settings): read by anyone, the
// sign-in page and the portal too; changed by a manager.
export type Country = 'Egypt' | 'SaudiArabia';
export type CurrencyPosition = 'Before' | 'After';

export interface CompanySettings {
  name: string;
  currencySymbol: string;
  currencyPosition: CurrencyPosition;
  country: Country;
  // IANA id: "Africa/Cairo".
  timeZoneId: string;
  // The hour the workday starts: before it, a night past midnight is still the evening's day.
  workdayStartsAtHour: number;
  // What a new employee starts with as their days off; nobody's change with them.
  weekends: WeekDay[];
  hasLogo: boolean;
  // Changes with the logo: its address asks for the new one.
  logoVersion: number;
}

export type CompanySettingsInput = Omit<CompanySettings, 'hasLogo' | 'logoVersion'>;

export const countryLabels: Record<Country, { en: string; ar: string }> = {
  Egypt: { en: 'Egypt', ar: 'مصر' },
  SaudiArabia: { en: 'Saudi Arabia', ar: 'المملكة العربية السعودية' },
};

const numbers = new Map<number, Intl.NumberFormat>();

// An amount as the company writes it: "L.E 1,400.00", "1,400.00 SAR", or the number alone.
export function formatMoney(amount: number, symbol: string, position: CurrencyPosition, digits = 2): string {
  let format = numbers.get(digits);
  if (!format) {
    format = new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    numbers.set(digits, format);
  }
  const number = format.format(amount ?? 0);
  if (!symbol) {
    return number;
  }
  return position === 'Before' ? `${symbol} ${number}` : `${number} ${symbol}`;
}

// The company's settings as the app holds them, read once at start-up and replaced as a manager
// saves them. Nothing but signals, so the money pipe and any screen read it without asking the
// server; with nothing read yet, amounts are numbers alone.
@Injectable({ providedIn: 'root' })
export class Company {
  readonly settings = signal<CompanySettings>({
    name: '',
    currencySymbol: '',
    currencyPosition: 'Before',
    country: 'Egypt',
    timeZoneId: 'Africa/Cairo',
    workdayStartsAtHour: 4,
    weekends: [],
    hasLogo: false,
    logoVersion: 0,
  });

  // The company's name, or the system's own until it has one.
  readonly name = computed(() => this.settings().name || 'HR & Payroll');
  readonly logoUrl = computed(() => (this.settings().hasLogo ? `/api/settings/logo?v=${this.settings().logoVersion}` : null));

  money(amount: number, digits = 2): string {
    const s = this.settings();
    return formatMoney(amount, s.currencySymbol, s.currencyPosition, digits);
  }
}

@Injectable({ providedIn: 'root' })
export class SettingsApi {
  private readonly http = inject(HttpClient);

  get(): Observable<CompanySettings> {
    return this.http.get<CompanySettings>('/api/settings');
  }

  save(settings: CompanySettingsInput): Observable<CompanySettings> {
    return this.http.put<CompanySettings>('/api/settings', settings);
  }

  uploadLogo(file: File): Observable<CompanySettings> {
    const form = new FormData();
    form.append('file', file, file.name);
    return this.http.put<CompanySettings>('/api/settings/logo', form);
  }

  removeLogo(): Observable<CompanySettings> {
    return this.http.delete<CompanySettings>('/api/settings/logo');
  }
}

// At start-up, before the first screen: the company's settings read. Unreachable, the app starts
// with numbers alone and the system's name, and reads them again next time.
export async function loadCompany(api = inject(SettingsApi), company = inject(Company)): Promise<void> {
  try {
    company.settings.set(await firstValueFrom(api.get()));
  } catch {
    // Started without them.
  }
}
