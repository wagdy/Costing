import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { Permissions } from '../../core/auth/permissions';
import { CostingApi, FinancialSettings } from '../../core/costing/costing.api';
import { errorMessage } from '../../core/http/error-message';
import { NotifyService } from '../../core/ui/notify.service';

// Tax and service (إعدادات الضريبة والخدمة), a manager's to set. The tax rate is the one every bill is
// charged: a day's takings entered with the tax in them have it taken off at this rate, and the sales
// entered have it on their bills. The service charge is kept for when bills carry one; nothing is
// calculated from it yet.
@Component({
  selector: 'app-tax-service-page',
  imports: [DatePipe, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatProgressBarModule],
  template: `
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    } @else if (error()) {
      <p class="error">{{ error() }}</p>
    } @else if (settings(); as s) {
      <section class="block">
        <h2>Tax <span class="inline-ar">الضريبة</span></h2>
        <p class="note">The rate every bill is charged. A day's takings entered with the tax in them have it taken off at this rate.</p>
        <mat-form-field subscriptSizing="dynamic" class="percent">
          <mat-label>Tax rate · نسبة الضريبة</mat-label>
          <input matInput type="number" min="0" max="99.99" step="0.5" [(ngModel)]="tax" [disabled]="!canEdit()" aria-label="Tax rate" />
          <span matTextSuffix>%</span>
        </mat-form-field>
        @if (s.taxPercent === null) {
          <p class="muted small">Not set yet: takings are entered without tax until it is.</p>
        }
      </section>

      <section class="block">
        <h2>Service <span class="inline-ar">الخدمة</span></h2>
        <p class="note">The service charge, kept for when bills carry one. Nothing is calculated from it yet.</p>
        <div class="toolbar">
          <mat-form-field subscriptSizing="dynamic" class="percent">
            <mat-label>Service · نسبة الخدمة</mat-label>
            <input matInput type="number" min="0" max="99.99" step="0.5" [(ngModel)]="service" [disabled]="!canEdit()" aria-label="Service" />
            <span matTextSuffix>%</span>
          </mat-form-field>
          @if (canEdit()) {
            <button mat-flat-button (click)="save()" [disabled]="!!problem() || !changed() || busy()">Save <span class="inline-ar">حفظ</span></button>
          }
        </div>
        @if (problem(); as p) {
          <p class="error">{{ p }}</p>
        }
        @if (!canEdit()) {
          <p class="muted small">A manager sets the tax and the service charge.</p>
        }
        @if (s.updatedBy) {
          <p class="muted small">Last set by {{ s.updatedBy }}, {{ s.updatedAtUtc | date: 'd MMM y, HH:mm' }}</p>
        }
      </section>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .block {
      margin-bottom: 28px;

      h2 {
        margin: 0 0 4px;
        font: var(--mat-sys-title-medium);
      }
    }
    .percent {
      width: 200px;
    }
    .small {
      font-size: 0.85em;
    }
  `,
})
export class TaxServicePage {
  private readonly api = inject(CostingApi);
  private readonly auth = inject(AuthService);
  private readonly notify = inject(NotifyService);

  protected readonly settings = signal<FinancialSettings | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly canEdit = computed(() => this.auth.can(Permissions.ApprovalDecide));

  protected tax: number | null = null;
  protected service: number | null = null;

  constructor() {
    void this.load();
  }

  protected problem(): string | null {
    if (this.tax !== null && (this.tax < 0 || this.tax >= 100)) {
      return 'The tax is a percentage from 0 up to 100.';
    }
    if (this.tax === null && this.settings()?.taxPercent != null) {
      return 'Enter the tax rate: 0 for none.';
    }
    return this.service === null || this.service < 0 || this.service >= 100 ? 'The service charge is a percentage from 0 up to 100.' : null;
  }

  protected changed(): boolean {
    const s = this.settings();
    return !!s && (this.service !== s.servicePercent || this.tax !== s.taxPercent);
  }

  protected async save(): Promise<void> {
    if (this.problem() || this.service === null) {
      return;
    }
    this.busy.set(true);
    try {
      const saved = await firstValueFrom(this.api.saveFinancialSettings(this.service, this.tax ?? undefined));
      this.settings.set(saved);
      this.tax = saved.taxPercent;
      this.service = saved.servicePercent;
      this.notify.info(`Tax ${saved.taxPercent ?? 0}%, service charge ${saved.servicePercent}%.`);
    } catch (error) {
      this.notify.error(error, 'The tax and service could not be saved.');
    } finally {
      this.busy.set(false);
    }
  }

  private async load(): Promise<void> {
    try {
      const settings = await firstValueFrom(this.api.financialSettings());
      this.settings.set(settings);
      this.tax = settings.taxPercent;
      this.service = settings.servicePercent;
    } catch (error) {
      this.error.set(errorMessage(error, 'The tax and service settings could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }
}
