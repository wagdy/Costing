import { Pipe, PipeTransform, inject } from '@angular/core';
import { Company } from '../settings/company';

// Amounts as the company writes them (Company Settings): "L.E 153.90", "153.90 SAR". Not pure, so
// a currency saved on the Settings page shows at once; formatting a number is cheap.
@Pipe({ name: 'money', pure: false })
export class MoneyPipe implements PipeTransform {
  private readonly company = inject(Company);

  transform(value: number | null | undefined, digits = 2): string {
    return this.company.money(value ?? 0, digits);
  }
}
