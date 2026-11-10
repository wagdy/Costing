import { DatePipe } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import { errorMessage } from '../../core/http/error-message';
import { PosIntegration, PosIntegrationApi, PosKey, PosSyncLog, PosSyncOutcome } from '../../core/settings/pos-integration';
import { NotifyService } from '../../core/ui/notify.service';
import { SubNav } from '../shared/sub-nav';
import { settingsTabs } from './settings-tabs';

type LogFilter = 'all' | 'problems' | 'reports';

const outcomeLabels: Record<PosSyncOutcome, { en: string; ar: string; tone: string }> = {
  Recorded: { en: 'Recorded', ar: 'سُجل', tone: 'ok' },
  Updated: { en: 'Updated', ar: 'تم التحديث', tone: 'info' },
  Unchanged: { en: 'Sent again', ar: 'مكرر', tone: 'faint' },
  Refused: { en: 'Refused', ar: 'مرفوض', tone: 'bad' },
  Unauthorized: { en: 'Wrong key', ar: 'مفتاح خاطئ', tone: 'bad' },
  Failed: { en: 'Failed', ar: 'فشل', tone: 'bad' },
  Served: { en: 'Read', ar: 'قراءة', tone: 'teal' },
};

// Settings → POS Integration (ربط نقطة البيع), a manager's. The key the restaurant's POS proves
// itself by: made here and pasted into the POS (Settings → Integrations → Costing), shown in full
// only when it is made, kept as its hash; made again, the old one stops working. And the log of
// every call the POS made: each Z report recorded, updated, sent again or refused (and why), the
// menu read, the link tested, a wrong key.
@Component({
  selector: 'app-pos-integration-page',
  imports: [DatePipe, MatButtonModule, MatIconModule, MatProgressBarModule, MatTooltipModule, SubNav],
  template: `
    <header class="head">
      <h1>POS integration <span class="inline-ar">ربط نقطة البيع</span></h1>
    </header>
    <app-sub-nav label="Settings" [tabs]="tabs" />

    <p class="note">
      <span class="note-ar" lang="ar" dir="rtl">نقطة البيع تسحب المنيو من هنا وترسل تقرير Z لكل وردية: يُسجل كملخص مبيعات اليوم (يخصم الخامات حسب الوصفات، والملغي بعد التحضير كهالك) وكإيراد اليوم في الخزنة.</span>
      The restaurant's POS reads the menu from here and sends each shift's Z report: it becomes the day's sales summary (the stock taken by the
      recipes, what was voided after the kitchen taken as waste) and the day's takings in the safe. A report sent again changes nothing; sent
      corrected, it replaces what it made. A day whose sales or takings were entered by hand is left alone, and the report refused.
    </p>

    <section class="card" aria-labelledby="key-title">
      <h2 id="key-title"><mat-icon>key</mat-icon> Integration API key <span class="inline-ar">مفتاح الربط</span></h2>
      @if (state(); as s) {
        @if (made(); as key) {
          <div class="made" role="status">
            <p><strong>Copy this key now:</strong> it is shown this once. Paste it into the POS: Settings → Integrations → Costing → API key.
              <span class="inline-ar">انسخ المفتاح الآن، لن يظهر مرة أخرى.</span></p>
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
          <p class="muted">No key yet: the POS cannot connect until one is made. · لا يوجد مفتاح بعد.</p>
        }
        <div class="actions">
          <button mat-flat-button (click)="newKey()" [disabled]="busy()">
            <mat-icon>{{ s.hasKey ? 'autorenew' : 'add' }}</mat-icon> {{ s.hasKey ? 'Regenerate key · مفتاح جديد' : 'Generate key · إنشاء مفتاح' }}
          </button>
        </div>
      }

      <h3>What the POS calls <span class="inline-ar">عناوين الربط</span></h3>
      <p class="muted">The POS's Costing URL is <code>{{ origin }}</code>; every call sends the key in <code>X-API-Key</code>.</p>
      <ul class="endpoints">
        <li><code>GET /api/integrations/pos/ping</code> the link test</li>
        <li><code>GET /api/integrations/pos/menu</code> the menu: categories, items, sizes (6101-17), prices, codes</li>
        <li><code>POST /api/integrations/pos/z-report</code> a shift's Z report</li>
        <li><code>POST /api/integrations/pos/events</code> the POS's own events (day.closed)</li>
      </ul>
    </section>

    <section class="card" aria-labelledby="log-title">
      <div class="log-head">
        <h2 id="log-title"><mat-icon>sync</mat-icon> Sync log <span class="inline-ar">سجل المزامنة</span></h2>
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
        <table class="grid">
          <thead>
            <tr><th>When<span class="ar">الوقت</span></th><th>Call<span class="ar">الطلب</span></th><th>Outcome<span class="ar">النتيجة</span></th>
              <th>Day<span class="ar">اليوم</span></th><th>What happened<span class="ar">التفاصيل</span></th></tr>
          </thead>
          <tbody>
            @for (l of shown(); track l.id) {
              <tr [class.problem]="isProblem(l)">
                <td class="when">{{ l.atUtc | date: 'd MMM, HH:mm:ss' }}</td>
                <td><code>{{ l.endpoint }}</code></td>
                <td><span class="tag" [class]="labels[l.outcome].tone">{{ labels[l.outcome].en }}<span class="ar">{{ labels[l.outcome].ar }}</span></span></td>
                <td>{{ l.businessDate ?? '' }}</td>
                <td class="message">{{ l.message }}</td>
              </tr>
            } @empty {
              <tr><td colspan="5" class="muted">Nothing yet: the POS has not called. · لا توجد عمليات بعد.</td></tr>
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
    }
    .log-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;

      h2 {
        margin: 0;
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
    tr.problem td.message {
      color: var(--tag-bad-fg, #b3261e);
    }
    .tag .ar {
      display: inline;
      margin-left: 4px;
    }
  `,
})
export class PosIntegrationPage implements OnInit, OnDestroy {
  private readonly api = inject(PosIntegrationApi);
  private readonly notify = inject(NotifyService);

  protected readonly tabs = settingsTabs;
  protected readonly labels = outcomeLabels;
  protected readonly origin = typeof location === 'undefined' ? '' : location.origin;
  protected readonly filters: { key: LogFilter; en: string }[] = [
    { key: 'all', en: 'All' },
    { key: 'reports', en: 'Z reports' },
    { key: 'problems', en: 'Problems' },
  ];

  protected readonly state = signal<PosIntegration | null>(null);
  protected readonly made = signal<PosKey | null>(null);
  protected readonly copied = signal(false);
  protected readonly busy = signal(false);
  protected readonly loading = signal(false);
  protected readonly filter = signal<LogFilter>('all');

  protected readonly shown = computed(() => (this.state()?.logs ?? []).filter((l) => this.matches(l, this.filter())));

  // The log comes in as the POS calls: looked at again every 20 seconds while the page is open.
  private readonly timer = setInterval(() => void this.load(false), 20_000);

  ngOnInit(): void {
    void this.load();
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  protected count(filter: LogFilter): number {
    return (this.state()?.logs ?? []).filter((l) => this.matches(l, filter)).length;
  }

  protected isProblem(l: PosSyncLog): boolean {
    return l.outcome === 'Refused' || l.outcome === 'Unauthorized' || l.outcome === 'Failed';
  }

  protected async newKey(): Promise<void> {
    if (this.state()?.hasKey && !confirm('Make a new key? The POS stops connecting until the new key is pasted into it. · سيتوقف المفتاح الحالي.')) {
      return;
    }
    this.busy.set(true);
    try {
      this.made.set(await firstValueFrom(this.api.newKey()));
      this.copied.set(false);
      await this.load();
    } catch (error) {
      this.notify.error(error, errorMessage(error, 'The key could not be made.'));
    } finally {
      this.busy.set(false);
    }
  }

  protected async copy(key: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(key);
      this.copied.set(true);
    } catch {
      this.notify.error(null, 'Copy it by hand: select the key and copy.');
    }
  }

  protected async load(showProgress = true): Promise<void> {
    if (showProgress) this.loading.set(true);
    try {
      this.state.set(await firstValueFrom(this.api.get()));
    } catch (error) {
      if (showProgress) this.notify.error(error, errorMessage(error, 'The POS integration could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }

  private matches(l: PosSyncLog, filter: LogFilter): boolean {
    switch (filter) {
      case 'problems':
        return this.isProblem(l);
      case 'reports':
        return l.endpoint === 'z-report' || l.endpoint === 'events';
      default:
        return true;
    }
  }
}
