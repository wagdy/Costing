import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { CostingApi, ApprovalRequest, StockCountKind, StockCountSummary, countKindLabels } from '../../core/costing/costing.api';
import { errorMessage } from '../../core/http/error-message';
import { Approvals, pendingLabel } from './approvals';

// Physical counts of the stores: the one being filled in, if any, and the posted ones. The
// variance report measures between two posted counts, so the stores are counted at the same
// point each week, with the kitchen closed. The first, when costing starts, is the opening stock
// (جرد افتتاحي): where stock begins, with no shortage or surplus; every one after is periodic
// (جرد دوري), what it finds against the records a shortage or a surplus.
@Component({
  selector: 'app-counts-page',
  imports: [DatePipe, MatButtonModule, MatIconModule, MatProgressBarModule, MatTooltipModule, RouterLink],
  template: `
    <div class="kinds">
      <p class="note">
        <strong>Opening stock</strong><span class="inline-ar">جرد افتتاحي</span>: once, when you start. It sets where each material's stock begins, at the cost it has, with
        no shortage or surplus and nothing in the profit.
        <span class="note-ar" lang="ar" dir="rtl">مرة واحدة عند البدء: يحدد رصيد البداية لكل خامة بتكلفتها، بلا عجز أو زيادة ولا أثر على الأرباح.</span>
      </p>
      <p class="note">
        <strong>Periodic count</strong><span class="inline-ar">جرد دوري</span>: every week, at the same point, with the kitchen closed. What it finds against the records
        is a shortage or a surplus, and the variance report measures between counts.
        <span class="note-ar" lang="ar" dir="rtl">أسبوعيًا في نفس التوقيت والمطبخ مغلق: الفرق عن الرصيد الدفتري عجز أو زيادة، ويقيس تقرير الانحراف بين جردين.</span>
      </p>
    </div>
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    } @else if (error()) {
      <p class="error">{{ error() }}</p>
    } @else {
      <div class="toolbar">
        @if (draft(); as d) {
          <span>
            <strong>{{ d.startedBy || 'Someone' }}</strong> started a count at {{ d.startedAtUtc | date: 'd MMM, HH:mm' }}:
            {{ d.materials }} {{ d.materials === 1 ? 'material' : 'materials' }} counted so far.
          </span>
          <span class="kind" [class.opening]="d.kind === 'Opening'">{{ kindLabels[d.kind].en }}<span class="ar">{{ kindLabels[d.kind].ar }}</span></span>
          <a mat-flat-button [routerLink]="['/costing/counts', d.id]"><mat-icon>edit_note</mat-icon> Continue the count</a>
        } @else if (posted().length === 0) {
          <button mat-flat-button (click)="start('Opening')"><mat-icon>inventory</mat-icon> Opening stock <span class="inline-ar">جرد افتتاحي</span></button>
          <button mat-stroked-button (click)="start('Periodic')"><mat-icon>add</mat-icon> Periodic count <span class="inline-ar">جرد دوري</span></button>
        } @else {
          <button mat-flat-button (click)="start('Periodic')"><mat-icon>add</mat-icon> Periodic count <span class="inline-ar">جرد دوري</span></button>
          <button mat-stroked-button (click)="start('Opening')" matTooltip="For materials never counted yet: a material is opened once">
            <mat-icon>inventory</mat-icon> Opening stock <span class="inline-ar">جرد افتتاحي</span>
          </button>
        }
        <span class="spacer"></span>
        @if (posted().length >= 2 && hasPeriodic()) {
          <a mat-button routerLink="/costing/reports/variance"><mat-icon>compare_arrows</mat-icon> Variance since the last count</a>
        }
      </div>
      <div class="table-wrap">
        <table class="grid">
          <thead>
            <tr>
              <th>Posted<span class="ar">تاريخ الترحيل</span></th>
              <th>Type<span class="ar">نوع الجرد</span></th>
              <th>By<span class="ar">بواسطة</span></th>
              <th class="num">Materials counted<span class="ar">الخامات المجرودة</span></th>
              <th class="num"><span class="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (count of done(); track count.id) {
              <tr class="clickable" [class.voided]="count.status === 'Voided'" [class.pending-deletion]="!!pendingOf(count)" (click)="open(count)">
                <td>
                  {{ count.postedAtUtc | date: 'EEE d MMM y, HH:mm' }}
                  @if (count.status === 'Voided') {
                    <div><span class="voided-badge">Voided<span class="ar">ملغى</span></span>
                      <span class="muted small"> by {{ count.voidedBy }}, {{ count.voidedAtUtc | date: 'd MMM' }}</span></div>
                  } @else if (pendingOf(count); as p) {
                    <div><span class="pending-badge">{{ pendingLabel(p).en }}<span class="ar">{{ pendingLabel(p).ar }}</span></span>
                      <span class="muted small"> by {{ p.requestedBy }}</span></div>
                  }
                </td>
                <td>
                  <span class="kind" [class.opening]="count.kind === 'Opening'">{{ kindLabels[count.kind].en }}<span class="ar">{{ kindLabels[count.kind].ar }}</span></span>
                </td>
                <td>{{ count.postedBy }}</td>
                <td class="num">{{ count.materials }}</td>
                <td class="num" (click)="$event.stopPropagation()">
                  @if (count.status === 'Posted') {
                    @if (pendingOf(count)) {
                      <mat-icon class="locked" matTooltip="Waiting for a manager's approval" aria-label="Locked: deletion requested">lock_clock</mat-icon>
                    } @else {
                      <button mat-icon-button class="danger" (click)="remove(count)" matTooltip="Delete (void)" aria-label="Delete this count">
                        <mat-icon>delete</mat-icon>
                      </button>
                    }
                  }
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="5" class="muted">
                  No counts posted yet. Start with the opening stock: what is on the shelves now, where the next count is measured from.
                  <span class="inline-ar">ابدأ بالجرد الافتتاحي.</span>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .kinds {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 8px;

      .note {
        margin: 0;
      }
    }
    .kind {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 12px;
      background: var(--mat-sys-surface-container-high);
      font: var(--mat-sys-label-medium);
      white-space: nowrap;

      .ar {
        display: inline;
        margin-left: 6px;
      }
      &.opening {
        background: var(--mat-sys-tertiary-container);
        color: var(--mat-sys-on-tertiary-container);
      }
    }
    .danger {
      color: var(--mat-sys-error);
    }
    .small {
      font-size: 0.85em;
    }
    tr.voided td {
      color: var(--mat-sys-on-surface-variant);
    }
    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
    }
  `,
})
export class CountsPage {
  protected readonly pendingLabel = pendingLabel;
  protected readonly kindLabels = countKindLabels;
  private readonly api = inject(CostingApi);
  private readonly router = inject(Router);
  private readonly approvals = inject(Approvals);

  protected readonly counts = signal<StockCountSummary[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly draft = computed(() => this.counts().find((c) => c.status === 'Draft') ?? null);
  protected readonly posted = computed(() => this.counts().filter((c) => c.status === 'Posted'));
  // The variance report ends at a periodic count.
  protected readonly hasPeriodic = computed(() => this.posted().some((c) => c.kind === 'Periodic'));
  // Posted, and voided since: kept, marked so.
  protected readonly done = computed(() => this.counts().filter((c) => c.status !== 'Draft'));

  constructor() {
    void this.load();
  }

  // A new count's id is made here; it is saved, of its kind, on its first entry.
  protected start(kind: StockCountKind): void {
    void this.router.navigate(['/costing/counts', crypto.randomUUID()], { queryParams: { kind } });
  }

  protected open(count: StockCountSummary): void {
    void this.router.navigate(['/costing/counts', count.id]);
  }

  protected pendingOf(count: StockCountSummary): ApprovalRequest | undefined {
    return this.approvals.pendingFor(count.id);
  }

  // Voided for a manager (its adjustments undone); asked of one for anyone else.
  protected async remove(count: StockCountSummary): Promise<void> {
    const day = new Date(count.postedAtUtc!).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const what = count.kind === 'Opening' ? `the opening stock of ${day}` : `the count of ${day}`;
    if ((await this.approvals.delete('StockCount', count.id, what)) === 'Applied') {
      await this.load();
    }
  }

  private async load(): Promise<void> {
    void this.approvals.refresh();
    try {
      this.counts.set(await firstValueFrom(this.api.stockCounts()));
    } catch (error) {
      this.error.set(errorMessage(error, 'The stock counts could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }
}
