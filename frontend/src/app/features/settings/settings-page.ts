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
import { errorMessage } from '../../core/http/error-message';
import { Company, CompanySettings, Country, CurrencyPosition, SettingsApi, countryLabels, formatMoney } from '../../core/settings/company';
import { NotifyService } from '../../core/ui/notify.service';
import { defaultTabIcons } from '../../core/settings/tab-icon';
import { SubNav } from '../shared/sub-nav';
import { settingsTabs } from './settings-tabs';

// A logo's size, as the server takes it.
const maxLogoBytes = 2 * 1024 * 1024;

// Every time zone this browser knows, for the list; the saved one always among them.
function timeZones(saved: string): string[] {
  const known = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['Africa/Cairo', 'Asia/Riyadh', 'Asia/Dubai', 'UTC'];
  return known.includes(saved) ? known : [saved, ...known];
}

// Company Settings (إعدادات الشركة), a manager's: the company's name and logo, how money is written
// everywhere (screens, Excel sheets and the API's messages), the country, and the time zone and
// the hour the business day starts. Changing the time zone is said plainly before it is saved: it
// moves which day new sales and entries fall on.
@Component({
  selector: 'app-settings-page',
  imports: [
    SubNav,
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
    <app-sub-nav label="Settings" [tabs]="tabs" />

    <section class="card" aria-labelledby="identity-title">
      <h2 id="identity-title">The company <span class="inline-ar">الشركة</span></h2>
      <mat-form-field class="wide">
        <mat-label>Company name · اسم الشركة</mat-label>
        <input matInput name="name" [(ngModel)]="name" maxlength="200" aria-label="Company name" />
      </mat-form-field>
    </section>

    <section class="card" aria-labelledby="logo-title">
      <h2 id="logo-title">Company logo &amp; browser tab icon <span class="inline-ar">شعار الشركة وأيقونة التبويب</span></h2>
      <div class="previews">
        <figure class="preview-tab">
          <div class="browser" aria-hidden="true">
            <div class="tab">
              <img [src]="tabIcon()" alt="" />
              <span class="tab-title">{{ company.name() }}</span>
              <mat-icon>close</mat-icon>
            </div>
            <div class="address"><mat-icon>lock</mat-icon> {{ host }}</div>
          </div>
          <figcaption>Browser tab · تبويب المتصفح</figcaption>
        </figure>
        <figure class="preview-bar">
          <div class="bar" aria-hidden="true">
            @if (company.logoUrl(); as url) {
              <img class="bar-logo" [src]="url" alt="" />
            } @else {
              <span class="bar-mark"><mat-icon>calculate</mat-icon></span>
            }
            <strong>{{ company.name() }}</strong>
          </div>
          <figcaption>Top bar · الشريط العلوي</figcaption>
        </figure>
      </div>
      <p class="logo-state" role="status">
        @if (company.settings().hasCustomLogo) {
          <mat-icon>check_circle</mat-icon> The company's logo is the tab's icon and the top bar's. · شعار الشركة مستخدم.
        } @else {
          <mat-icon>info</mat-icon> The system's own icon is shown until a logo is uploaded. · الأيقونة الافتراضية للنظام.
        }
      </p>
      <div class="logo-actions">
        <button mat-flat-button type="button" (click)="picker.click()" [disabled]="busy()"><mat-icon>upload</mat-icon> Upload logo · رفع شعار</button>
        <button mat-stroked-button type="button" (click)="removeLogo()" [disabled]="busy() || !company.settings().hasCustomLogo">
          <mat-icon>restart_alt</mat-icon> Reset to default · استعادة الافتراضي
        </button>
        <span class="muted small">PNG, SVG, JPEG, WebP or ICO, two megabytes at most. A square picture suits the tab best.</span>
        <input #picker type="file" hidden [accept]="logoTypes" (change)="uploadLogo(picker)" aria-label="Logo file" />
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
      <h2 id="place-title">Country and time <span class="inline-ar">الدولة والوقت</span></h2>
      <div class="row">
        <mat-form-field>
          <mat-label>Country · الدولة</mat-label>
          <mat-select name="country" [(ngModel)]="country" aria-label="Country">
            @for (c of countries; track c) {
              <mat-option [value]="c">{{ countryLabels[c].en }} · {{ countryLabels[c].ar }}</mat-option>
            }
          </mat-select>
          <mat-hint>Where the company is</mat-hint>
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
          <mat-label>Business day starts · بداية يوم العمل</mat-label>
          <mat-select name="hour" [(ngModel)]="workdayStartsAtHour" aria-label="Business day starts">
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
              From the moment it is saved, new sales, takings and entries fall on business days by the new zone's clock, and today's business day
              may change. What is recorded already stays on its day.
            </p>
            <p class="inline-ar">تغيير المنطقة الزمنية يغيّر توزيع المبيعات والقيود الجديدة على أيام العمل، وما سُجل يبقى في يومه.</p>
            <mat-checkbox name="zoneUnderstood" [(ngModel)]="zoneUnderstood">I understand</mat-checkbox>
          </div>
        </div>
      }

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
    .previews {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      margin-bottom: 8px;

      figure {
        display: grid;
        gap: 6px;
        margin: 0;
        flex: 1 1 260px;
        max-width: 420px;
      }
      figcaption {
        font: var(--mat-sys-label-small);
        color: var(--mat-sys-on-surface-variant);
      }
    }
    // A browser's tab strip, its tab the app's, as the browser will show it.
    .browser {
      border-radius: 12px 12px 8px 8px;
      overflow: hidden;
      border: 1px solid var(--mat-sys-outline-variant);
      background: color-mix(in srgb, var(--mat-sys-on-surface) 8%, var(--mat-sys-surface));
      padding-top: 8px;

      .tab {
        display: flex;
        align-items: center;
        gap: 8px;
        width: min(240px, 80%);
        margin-inline-start: 10px;
        padding: 8px 10px;
        border-radius: 10px 10px 0 0;
        background: var(--mat-sys-surface);
        font: var(--mat-sys-body-small);

        img {
          width: 16px;
          height: 16px;
          object-fit: contain;
        }
        .tab-title {
          flex: 1;
          min-width: 0;
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
        }
        mat-icon {
          width: 14px;
          height: 14px;
          font-size: 14px;
          color: var(--mat-sys-on-surface-variant);
        }
      }
      .address {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 6px 12px;
        background: var(--mat-sys-surface);
        border-top: 1px solid var(--mat-sys-outline-variant);
        font: var(--mat-sys-body-small);
        color: var(--mat-sys-on-surface-variant);

        mat-icon {
          width: 14px;
          height: 14px;
          font-size: 14px;
        }
      }
    }
    // The app's own top bar: the logo beside the company's name.
    .bar {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 56px;
      padding: 0 14px;
      border-radius: 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface);

      .bar-logo {
        height: 36px;
        max-width: 120px;
        object-fit: contain;
      }
      .bar-mark {
        display: inline-grid;
        place-items: center;
        width: 36px;
        height: 36px;
        border-radius: 10px;
        background: var(--mat-sys-primary);
        color: var(--mat-sys-on-primary);
      }
      strong {
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
    }
    .logo-state {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--mat-sys-on-surface-variant);

      mat-icon {
        flex: none;
      }
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
  protected readonly tabs = settingsTabs;
  private readonly api = inject(SettingsApi);
  private readonly notify = inject(NotifyService);
  protected readonly company = inject(Company);
  // What the picker offers: the types the server takes, ICO and SVG by their extensions too.
  protected readonly logoTypes = 'image/png,image/svg+xml,image/jpeg,image/webp,image/x-icon,image/vnd.microsoft.icon,.png,.svg,.jpg,.jpeg,.webp,.ico';
  // The tab's icon as it is now: the company's logo, or the system's own.
  protected readonly tabIcon = computed(() => this.company.logoUrl() ?? defaultTabIcons[1].href);
  protected readonly host = location.host;

  protected readonly countries: Country[] = ['Egypt', 'SaudiArabia'];
  protected readonly countryLabels = countryLabels;
  protected readonly hours = Array.from({ length: 13 }, (_, h) => h);
  private readonly zones = timeZones(this.company.settings().timeZoneId);

  protected name = this.company.settings().name;
  protected readonly currencySymbol = signal(this.company.settings().currencySymbol);
  protected readonly currencyPosition = signal<CurrencyPosition>(this.company.settings().currencyPosition);
  protected country: Country = this.company.settings().country;
  protected readonly timeZoneId = signal(this.company.settings().timeZoneId);
  protected workdayStartsAtHour = this.company.settings().workdayStartsAtHour;
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
        }),
      );
      this.saved(saved);
      this.zoneUnderstood = false;
      this.notify.info(zoneChanged ? 'Settings saved. New entries fall on business days by the new time zone.' : 'Settings saved.');
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
    if (file.size > maxLogoBytes) {
      this.notify.error(null, 'A logo is two megabytes at most: save a smaller picture. · الشعار ٢ ميجابايت على الأكثر.');
      return;
    }
    await this.act(() => firstValueFrom(this.api.uploadLogo(file)), 'Logo saved: it is the browser tab\'s icon now.', 'The logo could not be saved.');
  }

  // Back to the system's own icon, in the tab and the top bar at once.
  protected async removeLogo(): Promise<void> {
    await this.act(() => firstValueFrom(this.api.removeLogo()), 'Back to the system\'s own icon.', 'The logo could not be taken off.');
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
