import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { HrApi } from '../hr/hr.api';

// A day as the API takes it: 2026-10-12, in the company's own time.
export function isoDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function todayIso(): string {
  return isoDay(new Date());
}

// The company's workday, as the server keeps it (Company:WorkdayStartsAtHour): between midnight
// and the hour the day starts it is still yesterday, the night a late work schedule belongs to.
// Asked once, and kept; the browser's own date until it answers.
@Injectable({ providedIn: 'root' })
export class BusinessDay {
  private readonly hr = inject(HrApi);
  private asked: Promise<string> | null = null;

  today(): Promise<string> {
    this.asked ??= (async () => {
      try {
        return (await firstValueFrom(this.hr.today())).today;
      } catch {
        // Asked again next time.
        this.asked = null;
        return todayIso();
      }
    })();
    return this.asked;
  }
}
