import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { firstValueFrom } from 'rxjs';
import { WeekDay, weekDays } from '../../core/hr/hr.api';
import { errorMessage } from '../../core/http/error-message';
import { Company, CompanySettings, Country, CurrencyPosition, SettingsApi, countryLabels, formatMoney } from '../../core/settings/company';
import { NotifyService } from '../../core/ui/notify.service';

// Every time zone this browser knows, for the list; the saved one always among them.
function timeZones(saved: string): string[] {
  const known = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['Africa/Cairo', 'Asia/Riyadh', 'Asia/Dubai', 'UTC'];
  return known.includes(saved) ? known : [saved, ...known];
}

// Company Settings (إعدادات الشركة), a manager's: the company's name and logo, how money is written
// everywhere (screens, Excel sheets and the API's messages), the country (its national IDs and the
// public holidays offered), the time zone and the hour the workday starts, and the weekends a new
// employee starts with. Changing the time zone is said plainly before it is saved: it moves how
// new punches fall into workdays, and the attendance devices take it only when restarted.
@Component({
  selector: 'app-settings-page',
  imports: [
    FormsModule,
    MatAutocompleteModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
  ],
  template: `
    <header class="head">
      <h1>Company settings <span class="inline-ar">إعدادات الشركة</span></h1>
    </header>

    <section class="card" aria-labelledby="identity-title">
      <h2 id="identity-title">The company <span class="inline-ar">الشركة</span></h2>
      <mat-form-field class="wide">
        <mat-label>Company name · اسم الشركة</mat-label>
        <input matInput name="name" [(ngModel)]="name" maxlength="200" aria-label="Company name" />
      </mat-form-field>
      <div class="logo">
        @if (company.logoUrl(); as url) {
          <img [src]="url" alt="The company's logo" />
        } @else {
          <span class="no-logo">No logo yet · لا يوجد شعار</span>
        }
        <div class="logo-actions">
          <button mat-stroked-button type="button" (click)="picker.click()" [disabled]="busy()">
            <mat-icon>upload</mat-icon> {{ company.settings().hasLogo ? 'Replace the logo' : 'Upload a logo' }}
          </button>
          @if (company.settings().hasLogo) {
            <button mat-button type="button" (click)="removeLogo()" [disabled]="busy()"><mat-icon>delete</mat-icon> Take it off</button>
          }
          <span class="muted small">PNG, JPEG or WebP, a megabyte at most. Shown on the sign-in page, the top bar, the portal and payslips.</span>
          <input #picker type="file" hidden accept="image/png,image/jpeg,image/webp" (change)="uploadLogo(picker)" aria-label="Logo file" />
        </div>
      </div>
    </section>

    <section class="card" aria-labelledby="money-title">
      <h2 id="money-title">Money <span class="inline-ar">العملة</span></h2>
      <div class="row">
        <mat-form-field>
          <mat-label>Currency symbol · رمز العملة</mat-label>
          <input matInput name="currency" [ngModel]="currencySymbol()" (ngModelChange)="currencySymbol.set($event)" maxlength="8" placeholder="L.E, $, SAR" aria-label="Currency symbol" />
        </mat-form-field>
        <mat-button-toggle-group name="position" [ngModel]="currencyPosition()" (ngModelChange)="currencyPosition.set($event)" aria-label="Where the symbol goes" hideSingleSelectionIndicator>
          <mat-button-toggle value="Before">Before the amount</mat-button-toggle>
          <mat-button-toggle value="After">After it</mat-button-toggle>
        </mat-button-toggle-group>
      </div>
      <p class="muted">Amounts read <strong class="preview">{{ preview() }}</strong> on every screen, in the Excel sheets and in the system's messages.</p>
    </section>

    <section class="card" aria-labelledby="place-title">
      <h2 id="place-title">Country, time and weekends <span class="inline-ar">الدولة والوقت والإجازة الأسبوعية</span></h2>
      <div class="row">
        <mat-form-field>
          <mat-label>Country · الدولة</mat-label>
          <mat-select name="country" [(ngModel)]="country" aria-label="Country">
            @for (c of countries; track c) {
              <mat-option [value]="c">{{ countryLabels[c].en }} · {{ countryLabels[c].ar }}</mat-option>
            }
          </mat-select>
          <mat-hint>Its national IDs, and the public holidays offered</mat-hint>
        </mat-form-field>
        <mat-form-field class="zone">
          <mat-label>Time zone · المنطقة الزمنية</mat-label>
          <input matInput name="zone" [ngModel]="timeZoneId()" (ngModelChange)="timeZoneId.set($event)" [matAutocomplete]="zones" aria-label="Time zone" />
          <mat-autocomplete #zones="matAutocomplete">
            @for (z of shownZones(); track z) {
              <mat-option [value]="z">{{ z }}</mat-option>
            }
          </mat-autocomplete>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Workday starts · بداية يوم العمل</mat-label>
          <mat-select name="hour" [(ngModel)]="workdayStartsAtHour" aria-label="Workday starts">
            @for (h of hours; track h) {
              <mat-option [value]="h">{{ h < 10 ? '0' + h : h }}:00</mat-option>
            }
          </mat-select>
          <mat-hint>A night past midnight is the evening's day until then</mat-hint>
        </mat-form-field>
      </div>

      @if (zoneChanged()) {
        <div class="zone-warning" role="alert">
          <mat-icon>warning</mat-icon>
          <div>
            <strong>Changing the time zone from {{ company.settings().timeZoneId }} to {{ timeZoneId() }}</strong>
            <p>
              From the moment it is saved, new punches fall into workdays by the new zone's clock, and today's workday may change. Days already
              worked out and finalized pay stay as they are.
            </p>
            <p><strong>You must restart every attendance device afterwards</strong>: a device takes the new time zone only when it starts again. Until then
              it keeps stamping punches by the old one.</p>
            <p class="inline-ar">تغيير المنطقة الزمنية يغيّر توزيع البصمات الجديدة على أيام العمل، ويجب إعادة تشغيل أجهزة البصمة بعد الحفظ.</p>
            <mat-checkbox name="zoneUnderstood" [(ngModel)]="zoneUnderstood">I understand, and will restart the attendance devices</mat-checkbox>
          </div>
        </div>
      }

      <div class="weekends">
        <span class="label">Weekends · الإجازة الأسبوعية</span>
        <mat-button-toggle-group multiple name="weekends" [(ngModel)]="weekends" aria-label="Weekends" hideMultipleSelectionIndicator>
          @for (d of days; track d.day) {
            <mat-button-toggle [value]="d.day">{{ d.en }}</mat-button-toggle>
          }
        </mat-button-toggle-group>
        <span class="muted small">What a new employee starts with as their days off. Nobody's days off already set change.</span>
      </div>
    </section>

    @if (error(); as message) {
      <p class="error" role="alert">{{ message }}</p>
    }
    <div class="actions">
      <button mat-flat-button (click)="save()" [disabled]="busy() || (zoneChanged() && !zoneUnderstood)"><mat-icon>save</mat-icon> Save the settings</button>
      @if (busy()) {
        <mat-progress-bar mode="indeterminate" />
      }
    </div>
  `,
  styleUrl: '../shared/pages.scss',
  styles: `
    .head h1 {
      margin: 0 0 12px;
      font: var(--mat-sys-headline-small);
    }
    .card {
      max-width: 860px;
      margin-bottom: 16px;
      padding: 16px 20px;
      border-radius: 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface);

      h2 {
        margin: 0 0 12px;
        font: var(--mat-sys-title-medium);
      }
    }
    .wide {
      width: 100%;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 16px;
    }
    .zone {
      min-width: 260px;
    }
    .logo {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 16px;

      img {
        max-height: 72px;
        max-width: 200px;
        object-fit: contain;
      }
    }
    .no-logo {
      display: inline-grid;
      place-items: center;
      width: 120px;
      height: 72px;
      border: 1px dashed var(--mat-sys-outline);
      border-radius: 8px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-small);
      text-align: center;
    }
    .logo-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
    .preview {
      font-variant-numeric: tabular-nums;
    }
    .zone-warning {
      display: flex;
      gap: 12px;
      margin: 8px 0 16px;
      padding: 12px 16px;
      border-radius: 12px;
      border: 2px solid var(--mat-sys-error);
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);

      mat-icon {
        flex: none;
        color: var(--mat-sys-error);
      }
      p {
        margin: 6px 0;
      }
    }
    .weekends {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 12px;
      margin-top: 8px;
    }
    .label {
      font: var(--mat-sys-label-large);
    }
    .actions {
      max-width: 860px;
      display: grid;
      gap: 8px;
      justify-items: start;
    }
    .small {
      font-size: 0.85em;
    }
    .muted {
      color: var(--mat-sys-on-surface-variant);
    }
  `,
})
export class SettingsPage {
  private readonly api = inject(SettingsApi);
  private readonly notify = inject(NotifyService);
  protected readonly company = inject(Company);

  protected readonly countries: Country[] = ['Egypt', 'SaudiArabia'];
  protected readonly countryLabels = countryLabels;
  protected readonly days = weekDays;
  protected readonly hours = Array.from({ length: 13 }, (_, h) => h);
  private readonly zones = timeZones(this.company.settings().timeZoneId);

  protected name = this.company.settings().name;
  protected readonly currencySymbol = signal(this.company.settings().currencySymbol);
  protected readonly currencyPosition = signal<CurrencyPosition>(this.company.settings().currencyPosition);
  protected country: Country = this.company.settings().country;
  protected readonly timeZoneId = signal(this.company.settings().timeZoneId);
  protected workdayStartsAtHour = this.company.settings().workdayStartsAtHour;
  protected weekends: WeekDay[] = [...this.company.settings().weekends];
  protected zoneUnderstood = false;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly preview = computed(() => formatMoney(1400, this.currencySymbol().trim(), this.currencyPosition()));
  protected readonly zoneChanged = computed(() => this.timeZoneId().trim() !== this.company.settings().timeZoneId);
  protected readonly shownZones = computed(() => {
    const typed = this.timeZoneId().trim().toLowerCase();
    return (typed ? this.zones.filter((z) => z.toLowerCase().includes(typed)) : this.zones).slice(0, 50);
  });

  protected async save(): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const zoneChanged = this.zoneChanged();
      const saved = await firstValueFrom(
        this.api.save({
          name: this.name.trim(),
          currencySymbol: this.currencySymbol().trim(),
          currencyPosition: this.currencyPosition(),
          country: this.country,
          timeZoneId: this.timeZoneId().trim(),
          workdayStartsAtHour: this.workdayStartsAtHour,
          weekends: this.weekends,
        }),
      );
      this.saved(saved);
      this.zoneUnderstood = false;
      this.notify.info(zoneChanged ? 'Settings saved. Restart every attendance device now, for it to take the new time zone.' : 'Settings saved.');
    } catch (error) {
      this.error.set(errorMessage(error, 'The settings could not be saved.'));
    } finally {
      this.busy.set(false);
    }
  }

  protected async uploadLogo(picker: HTMLInputElement): Promise<void> {
    const file = picker.files?.[0];
    picker.value = '';
    if (!file) {
      return;
    }
    if (file.size > 1024 * 1024) {
      this.notify.error(null, 'A logo is a megabyte at most: save a smaller picture.');
      return;
    }
    await this.act(() => firstValueFrom(this.api.uploadLogo(file)), 'Logo saved.', 'The logo could not be saved.');
  }

  protected async removeLogo(): Promise<void> {
    await this.act(() => firstValueFrom(this.api.removeLogo()), 'Logo taken off.', 'The logo could not be taken off.');
  }

  private async act(call: () => Promise<CompanySettings>, done: string, failed: string): Promise<void> {
    this.busy.set(true);
    try {
      this.saved(await call());
      this.notify.info(done);
    } catch (error) {
      this.notify.error(error, failed);
    } finally {
      this.busy.set(false);
    }
  }

  // The app's settings are the saved ones at once: the money everywhere, the logo, the name.
  private saved(settings: CompanySettings): void {
    this.company.settings.set(settings);
  }
}
