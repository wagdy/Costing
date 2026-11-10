import { DatePipe } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import { errorMessage } from '../../core/http/error-message';
import { HrIntegration, HrIntegrationApi, HrKey, HrOutboxItem, HrSyncLog, HrSyncOutcome, HrTestResult } from '../../core/settings/hr-integration';
import { NotifyService } from '../../core/ui/notify.service';
import { SubNav } from '../shared/sub-nav';
import { settingsTabs } from './settings-tabs';

type LogFilter = 'all' | 'in' | 'out' | 'problems';

export const hrOutcomeLabels: Record<HrSyncOutcome, { en: string; ar: string; tone: string }> = {
  Read: { en: 'Read', ar: 'قراءة', tone: 'teal' },
  Recorded: { en: 'Recorded', ar: 'سُجل', tone: 'ok' },
  Updated: { en: 'Updated', ar: 'تم التحديث', tone: 'info' },
  Unchanged: { en: 'Sent again', ar: 'مكرر', tone: 'faint' },
  Sent: { en: 'Sent', ar: 'أُرسل', tone: 'ok' },
  Refused: { en: 'Refused', ar: 'مرفوض', tone: 'bad' },
  Failed: { en: 'Failed', ar: 'فشل', tone: 'bad' },
  Unauthorized: { en: 'Wrong key', ar: 'مفتاح خاطئ', tone: 'bad' },
};

const callLabels: Record<string, string> = {
  ping: 'Link test',
  employees: 'Employees',
  'employee-advance': 'Advance',
  'employee-deduction': 'Deduction',
  'payroll-settled': 'Payroll paid',
  'payroll-run': 'Payroll run',
};

// Settings → HR Integration (ربط الموارد البشرية), a manager's. The link to the HR & Payroll
// system, off until it is switched on here, and then both ways: HR's employees read into the staff,
// each advance paid out of the safe (with its signed receipt) and each deduction sent to HR, the
// month's payroll HR approves taken in (its labor cost, its net cash to pay), and HR told when it
// is paid. Off, the staff are kept here and nothing is sent or heard.
@Component({
  selector: 'app-hr-integration-page',
  imports: [
    DatePipe, FormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressBarModule, MatSlideToggleModule, MatTooltipModule,
    SubNav,
  ],
  template: `
    <header class="head">
      <h1>HR integration <span class="inline-ar">ربط الموارد البشرية</span></h1>
    </header>
    <app-sub-nav label="Settings" [tabs]="tabs" />

    <p class="note">
      <span class="note-ar" lang="ar" dir="rtl">عند التفعيل: يُقرأ الموظفون من نظام الموارد البشرية، وتُرسل كل سلفة تُصرف من الخزنة (مع صورة الإيصال) وكل خصم (عجز خزنة / خصم على الموظف) إلى مسير الرواتب، ويصل المسير المعتمد هنا كتكلفة عمالة وصافي نقدي للصرف من الخزنة. عند الإيقاف يعمل النظام وحده تماماً.</span>
      Switched on, the staff come from HR; each advance paid out of the safe (with its signed receipt) and each deduction (a till shortage, a staff
      charge) goes onto their pay there; and the payroll HR approves comes here as the month's labor cost and its net cash, to pay out of the safe,
      HR told once it is paid. Switched off, this system works on its own: the staff are kept here and nothing is sent or heard.
    </p>

    @if (state(); as s) {
      <section class="card" aria-labelledby="link-title">
        <div class="title-row">
          <h2 id="link-title"><mat-icon>hub</mat-icon> The link <span class="inline-ar">الربط</span></h2>
          <span class="status" [class.on]="s.enabled" role="status">
            <span class="dot"></span>{{ s.enabled ? 'Linked · مفعّل' : 'Not linked · غير مفعّل' }}
          </span>
        </div>
        <form class="link-form" (ngSubmit)="save()" aria-label="HR link">
          <mat-slide-toggle name="enabled" [(ngModel)]="enabled" [disabled]="busy()">Enabled · تفعيل الربط</mat-slide-toggle>
          <mat-form-field subscriptSizing="dynamic">
            <mat-label>HR's address (base URL) · عنوان نظام الموارد البشرية</mat-label>
            <input matInput name="baseUrl" [(ngModel)]="baseUrl" placeholder="https://hr.example.com" inputmode="url" autocomplete="off" />
          </mat-form-field>
          <mat-form-field subscriptSizing="dynamic">
            <mat-label>HR's key (X-API-Key) · مفتاح الموارد البشرية</mat-label>
            <input matInput name="hrKey" [(ngModel)]="hrKey" type="password" autocomplete="off"
              [placeholder]="s.hasHrKey ? 'Kept: ' + s.hrKeyHint + ' (paste a new one to replace it)' : 'Paste the key made on HR'" />
            <mat-hint>Made on HR: Settings → Costing Integration → Generate key. Kept encrypted, never shown again.</mat-hint>
          </mat-form-field>
          <div class="actions">
            <button mat-stroked-button type="button" (click)="test()" [disabled]="busy() || !s.baseUrl || !s.hasHrKey">
              <mat-icon>network_check</mat-icon> Test connection · اختبار الاتصال
            </button>
            <button mat-flat-button type="submit" [disabled]="busy()"><mat-icon>save</mat-icon> Save · حفظ</button>
          </div>
        </form>
        @if (tested(); as t) {
          <p class="result" [class.bad]="!t.ok" role="status"><mat-icon>{{ t.ok ? 'check_circle' : 'error' }}</mat-icon> {{ t.message }}</p>
        }
      </section>

      <section class="card" aria-labelledby="key-title">
        <h2 id="key-title"><mat-icon>key</mat-icon> This system's key for HR <span class="inline-ar">مفتاح الربط لنظام الموارد البشرية</span></h2>
        <p class="muted">HR sends it in <code>X-API-Key</code> when it sends a payroll here. Paste it on HR: Settings → Costing Integration → Costing's key.</p>
        @if (made(); as key) {
          <div class="made" role="status">
            <p><strong>Copy this key now:</strong> it is shown this once. <span class="inline-ar">انسخ المفتاح الآن، لن يظهر مرة أخرى.</span></p>
            <div class="key-row">
              <code class="key" data-testid="new-key">{{ key.key }}</code>
              <button mat-flat-button (click)="copy(key.key)"><mat-icon>content_copy</mat-icon> {{ copied() ? 'Copied' : 'Copy' }}</button>
            </div>
          </div>
        }
        @if (s.hasKey) {
          <dl class="facts">
            <dt>Key</dt><dd><code>{{ s.keyHint }}</code></dd>
            <dt>Made</dt><dd>{{ s.keyCreatedAtUtc | date: 'd MMM y, HH:mm' }} · {{ s.keyCreatedBy }}</dd>
          </dl>
        } @else {
          <p class="muted">No key yet: HR cannot send its payroll here until one is made. · لا يوجد مفتاح بعد.</p>
        }
        <button mat-stroked-button (click)="newKey()" [disabled]="busy()">
          <mat-icon>{{ s.hasKey ? 'autorenew' : 'add' }}</mat-icon> {{ s.hasKey ? 'Regenerate key · مفتاح جديد' : 'Generate key · إنشاء مفتاح' }}
        </button>
        <h3>What HR calls here <span class="inline-ar">عناوين الربط</span></h3>
        <ul class="endpoints">
          <li><code>GET {{ origin }}/api/integrations/hr/ping</code> the link test</li>
          <li><code>POST {{ origin }}/api/integrations/hr/payroll-run</code> a month's payroll approved on HR</li>
        </ul>
      </section>

      <section class="card" aria-labelledby="staff-title">
        <h2 id="staff-title"><mat-icon>badge</mat-icon> Employees from HR <span class="inline-ar">الموظفون من الموارد البشرية</span></h2>
        <p class="muted">
          @if (s.employeesSyncedAtUtc) {
            {{ s.employeesSynced }} employees, read {{ s.employeesSyncedAtUtc | date: 'd MMM y, HH:mm' }}. Read again every 6 hours while linked.
          } @else {
            Not read yet. · لم تتم المزامنة بعد.
          }
        </p>
        <button mat-stroked-button (click)="sync()" [disabled]="busy() || !s.enabled"><mat-icon>sync</mat-icon> Sync employees now · مزامنة الموظفين</button>
        @if (synced(); as r) {
          <p class="result" role="status"><mat-icon>check_circle</mat-icon> {{ r }}</p>
        }
      </section>

      <section class="card" aria-labelledby="outbox-title">
        <div class="log-head">
          <h2 id="outbox-title"><mat-icon>outbox</mat-icon> Waiting to be sent <span class="inline-ar">في انتظار الإرسال</span></h2>
          <span class="chip">{{ s.pending }} waiting</span>
          @if (s.failed) {
            <span class="chip bad">{{ s.failed }} refused</span>
          }
          <span class="spacer"></span>
          <button mat-stroked-button (click)="sendNow()" [disabled]="busy() || !s.enabled || !s.pending"><mat-icon>send</mat-icon> Send now · إرسال الآن</button>
        </div>
        <div class="table-wrap">
          <table class="grid" aria-label="Waiting to be sent">
            <thead>
              <tr><th>Made<span class="ar">التاريخ</span></th><th>What<span class="ar">البيان</span></th><th>Status<span class="ar">الحالة</span></th>
                <th>Tries<span class="ar">المحاولات</span></th><th><span class="visually-hidden">Actions</span></th></tr>
            </thead>
            <tbody>
              @for (i of s.outbox; track i.id) {
                <tr>
                  <td class="when">{{ i.createdAtUtc | date: 'd MMM, HH:mm' }}</td>
                  <td class="message">{{ i.summary }}
                    @if (i.lastError && i.status !== 'Sent') {
                      <div class="why">{{ i.lastError }}</div>
                    }
                  </td>
                  <td><span class="tag" [class]="outboxTone(i)">{{ i.status === 'Pending' ? 'Waiting' : i.status === 'Sent' ? 'Sent' : 'Refused' }}</span></td>
                  <td class="num">{{ i.attempts }}</td>
                  <td class="num">
                    @if (i.status === 'Failed') {
                      <button mat-button (click)="retry(i)" [disabled]="busy()"><mat-icon>replay</mat-icon> Try again</button>
                    }
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="5" class="muted">Nothing to send. · لا يوجد ما يُرسل.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    }

    <section class="card" aria-labelledby="log-title">
      <div class="log-head">
        <h2 id="log-title"><mat-icon>sync_alt</mat-icon> Sync log <span class="inline-ar">سجل المزامنة</span></h2>
        <span class="spacer"></span>
        <div class="pills" role="tablist" aria-label="Show">
          @for (f of filters; track f.key) {
            <button type="button" role="tab" class="pill" [class.on]="filter() === f.key" [attr.aria-selected]="filter() === f.key" (click)="filter.set(f.key)">
              {{ f.en }} <span class="count">{{ count(f.key) }}</span>
            </button>
          }
        </div>
        <button mat-icon-button (click)="load()" aria-label="Refresh the log" matTooltip="Refresh"><mat-icon>refresh</mat-icon></button>
      </div>
      @if (loading()) {
        <mat-progress-bar mode="indeterminate" />
      }
      <div class="table-wrap">
        <table class="grid" aria-label="Sync log">
          <thead>
            <tr><th>When<span class="ar">الوقت</span></th><th>Way<span class="ar">الاتجاه</span></th><th>Call<span class="ar">الطلب</span></th>
              <th>Outcome<span class="ar">النتيجة</span></th><th>What happened<span class="ar">التفاصيل</span></th></tr>
          </thead>
          <tbody>
            @for (l of shown(); track l.id) {
              <tr [class.problem]="isProblem(l)">
                <td class="when">{{ l.atUtc | date: 'd MMM, HH:mm:ss' }}</td>
                <td><mat-icon class="way" [attr.aria-label]="l.direction === 'Inbound' ? 'From HR' : 'To HR'">{{ l.direction === 'Inbound' ? 'south_west' : 'north_east' }}</mat-icon>
                  {{ l.direction === 'Inbound' ? 'From HR' : 'To HR' }}</td>
                <td>{{ callLabel(l.call) }}</td>
                <td><span class="tag" [class]="labels[l.outcome].tone">{{ labels[l.outcome].en }}<span class="ar">{{ labels[l.outcome].ar }}</span></span></td>
                <td class="message">{{ l.message }}</td>
              </tr>
            } @empty {
              <tr><td colspan="5" class="muted">Nothing yet. · لا توجد عمليات بعد.</td></tr>
            }
          </tbody>
        </table>
      </div>
    </section>
  `,
  styleUrl: '../shared/pages.scss',
  styles: `
    .head h1 {
      margin: 0 0 8px;
      font: var(--mat-sys-headline-small);
    }
    .card {
      margin: 0 0 16px;
      padding: 16px 20px;
      border-radius: 16px;
      border: 1px solid var(--app-line);
      background: var(--mat-sys-surface-container-lowest);
      box-shadow: var(--app-card-shadow);
    }
    h2 {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0 0 12px;
      font: var(--mat-sys-title-medium);
    }
    h3 {
      margin: 20px 0 6px;
      font: var(--mat-sys-title-small);
    }
    .muted {
      color: var(--mat-sys-on-surface-variant);
    }
    .title-row,
    .log-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;

      h2 {
        margin: 0;
      }
    }
    .title-row {
      justify-content: space-between;
      margin-bottom: 12px;
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
      padding: 4px 12px;
      border-radius: 999px;
      background: var(--mat-sys-surface-container-high);
      font: var(--mat-sys-label-large);

      .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--mat-sys-outline);
      }
      &.on {
        background: var(--tag-ok-bg, #dff5e6);
        color: var(--tag-ok-fg, #1b6b3a);

        .dot {
          background: currentColor;
        }
      }
    }
    .link-form {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 12px 16px;
      align-items: center;

      mat-slide-toggle,
      .actions {
        grid-column: 1 / -1;
      }
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 8px;
    }
    .result {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 12px 0 0;
      color: var(--tag-ok-fg, #1b6b3a);

      &.bad {
        color: var(--tag-bad-fg, #b3261e);
      }
    }
    .made {
      margin-bottom: 12px;
      padding: 12px 14px;
      border-radius: 12px;
      background: var(--tag-warn-bg, #fff3d6);
      color: var(--tag-warn-fg, #8a5300);

      p {
        margin: 0 0 8px;
      }
    }
    .key-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
    .key {
      flex: 1;
      min-width: 0;
      padding: 8px 10px;
      border-radius: 8px;
      background: var(--mat-sys-surface-container-lowest);
      color: var(--mat-sys-on-surface);
      overflow-wrap: anywhere;
      user-select: all;
    }
    .facts {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 4px 16px;
      margin: 0 0 12px;

      dt {
        color: var(--mat-sys-on-surface-variant);
      }
      dd {
        margin: 0;
      }
    }
    .endpoints {
      margin: 0;
      padding-left: 18px;
      line-height: 1.8;
      overflow-wrap: anywhere;
    }
    .chip {
      padding: 2px 10px;
      border-radius: 999px;
      background: var(--mat-sys-surface-container-high);
      font: var(--mat-sys-label-medium);

      &.bad {
        background: var(--tag-bad-bg, #fde7e7);
        color: var(--tag-bad-fg, #b3261e);
      }
    }
    .pills {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .pill {
      height: 32px;
      padding: 0 12px;
      border: 1px solid var(--app-line-strong);
      border-radius: 999px;
      background: transparent;
      color: inherit;
      font: var(--mat-sys-label-large);
      cursor: pointer;

      &.on {
        background: var(--mat-sys-primary);
        border-color: var(--mat-sys-primary);
        color: var(--mat-sys-on-primary);
      }
      .count {
        margin-left: 4px;
        opacity: 0.8;
      }
    }
    .table-wrap {
      margin-top: 10px;
    }
    td.when {
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    td.message {
      max-width: 640px;
      overflow-wrap: anywhere;
    }
    .why,
    tr.problem td.message {
      color: var(--tag-bad-fg, #b3261e);
    }
    .way {
      width: 16px;
      height: 16px;
      font-size: 16px;
      vertical-align: -3px;
    }
    .tag .ar {
      display: inline;
      margin-left: 4px;
    }
  `,
})
export class HrIntegrationPage implements OnInit, OnDestroy {
  private readonly api = inject(HrIntegrationApi);
  private readonly notify = inject(NotifyService);

  protected readonly tabs = settingsTabs;
  protected readonly labels = hrOutcomeLabels;
  protected readonly origin = typeof location === 'undefined' ? '' : location.origin;
  protected readonly filters: { key: LogFilter; en: string }[] = [
    { key: 'all', en: 'All' },
    { key: 'in', en: 'From HR' },
    { key: 'out', en: 'To HR' },
    { key: 'problems', en: 'Problems' },
  ];

  protected readonly state = signal<HrIntegration | null>(null);
  protected readonly made = signal<HrKey | null>(null);
  protected readonly tested = signal<HrTestResult | null>(null);
  protected readonly synced = signal<string | null>(null);
  protected readonly copied = signal(false);
  protected readonly busy = signal(false);
  protected readonly loading = signal(false);
  protected readonly filter = signal<LogFilter>('all');

  protected enabled = false;
  protected baseUrl = '';
  protected hrKey = '';

  protected readonly shown = computed(() => (this.state()?.logs ?? []).filter((l) => this.matches(l, this.filter())));

  // The log comes in as the two systems call each other: looked at again every 20 seconds.
  private readonly timer = setInterval(() => void this.load(false), 20_000);

  ngOnInit(): void {
    void this.load(true, true);
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  protected callLabel(call: string): string {
    return callLabels[call] ?? call;
  }

  protected count(filter: LogFilter): number {
    return (this.state()?.logs ?? []).filter((l) => this.matches(l, filter)).length;
  }

  protected isProblem(l: HrSyncLog): boolean {
    return l.outcome === 'Refused' || l.outcome === 'Unauthorized' || l.outcome === 'Failed';
  }

  protected outboxTone(i: HrOutboxItem): string {
    return i.status === 'Sent' ? 'ok' : i.status === 'Failed' ? 'bad' : 'info';
  }

  protected async save(): Promise<void> {
    await this.run(async () => {
      const saved = await firstValueFrom(this.api.save(this.enabled, this.baseUrl.trim() || null, this.hrKey.trim() || null));
      this.fill(saved);
      this.notify.info(saved.enabled ? 'The HR link is on. · تم تفعيل الربط.' : 'The HR link is off: this system works on its own. · تم إيقاف الربط.');
    }, 'The link could not be saved.');
  }

  protected async test(): Promise<void> {
    await this.run(async () => {
      this.tested.set(await firstValueFrom(this.api.test()));
      await this.load(false);
    }, 'The link could not be tested.');
  }

  protected async sync(): Promise<void> {
    await this.run(async () => {
      const r = await firstValueFrom(this.api.syncEmployees());
      this.synced.set(`${r.received} read from HR: ${r.added} added, ${r.updated} changed, ${r.left} marked as left.`);
      await this.load(false);
    }, 'HR’s employees could not be read.');
  }

  protected async sendNow(): Promise<void> {
    await this.run(async () => {
      const { sent } = await firstValueFrom(this.api.sendNow());
      this.notify.info(sent ? `${sent} sent to HR.` : 'Nothing could be sent now: see the sync log.');
      await this.load(false);
    }, 'It could not be sent now.');
  }

  protected async retry(item: HrOutboxItem): Promise<void> {
    await this.run(async () => {
      await firstValueFrom(this.api.retry(item.id));
      await firstValueFrom(this.api.sendNow());
      await this.load(false);
    }, 'It could not be tried again.');
  }

  protected async newKey(): Promise<void> {
    if (this.state()?.hasKey && !confirm('Make a new key? HR stops sending its payroll here until the new key is pasted on HR. · سيتوقف المفتاح الحالي.')) {
      return;
    }
    await this.run(async () => {
      this.made.set(await firstValueFrom(this.api.newKey()));
      this.copied.set(false);
      await this.load(false);
    }, 'The key could not be made.');
  }

  protected async copy(key: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(key);
      this.copied.set(true);
    } catch {
      this.notify.error(null, 'Copy it by hand: select the key and copy.');
    }
  }

  protected async load(showProgress = true, fillForm = false): Promise<void> {
    if (showProgress) this.loading.set(true);
    try {
      const state = await firstValueFrom(this.api.get());
      if (fillForm) {
        this.fill(state);
      } else {
        this.state.set(state);
      }
    } catch (error) {
      if (showProgress) this.notify.error(error, errorMessage(error, 'The HR integration could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }

  private fill(state: HrIntegration): void {
    this.state.set(state);
    this.enabled = state.enabled;
    this.baseUrl = state.baseUrl ?? '';
    this.hrKey = '';
  }

  private async run(work: () => Promise<void>, failed: string): Promise<void> {
    this.busy.set(true);
    try {
      await work();
    } catch (error) {
      this.notify.error(error, errorMessage(error, failed));
    } finally {
      this.busy.set(false);
    }
  }

  private matches(l: HrSyncLog, filter: LogFilter): boolean {
    switch (filter) {
      case 'problems':
        return this.isProblem(l);
      case 'in':
        return l.direction === 'Inbound';
      case 'out':
        return l.direction === 'Outbound';
      default:
        return true;
    }
  }
}
