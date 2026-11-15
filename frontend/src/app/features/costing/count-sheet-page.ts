import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { Permissions } from '../../core/auth/permissions';
import {
  CostingApi,
  CountItem,
  MaterialCost,
  StockCount,
  StockCountKind,
  countKindLabels,
  countReviewLabels,
  countScopeLabels,
  countUnit,
  recipeCostOf,
} from '../../core/costing/costing.api';
import { errorMessage } from '../../core/http/error-message';
import { Company } from '../../core/settings/company';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { NotifyService } from '../../core/ui/notify.service';
import { InfoTip } from './info-tip';

interface Section {
  category: string;
  materials: MaterialCost[];
}

// A counted line set against the records, for whoever reconciles it.
interface ReconcileRow {
  id: string;
  code: string | null;
  name: string;
  category: string | null;
  unit: string;
  counted: number;
  book: number | null;
  difference: number | null;
  unitCost: number | null;
  value: number | null;
  // Beyond the tolerance: short (red) or over (amber).
  flag: 'short' | 'over' | null;
  note: string | null;
  recountRequested: boolean;
}

// How long after the last entry the draft is saved: long enough to type a number, short enough
// that a tablet put down loses nothing.
const autosaveAfterMs = 1500;

// Where a manager's or cost controller's choice to count blind is kept, on this device.
const blindKey = 'costing.blindCount';

// One count sheet. A draft is filled in shelf by shelf, in kg, litres and pieces, and saves itself
// as it goes; an empty field is not counted, which is not the same as 0. Each line may carry a note.
//
// Blind (الجرد الأعمى): the counter does not see what the records expect, so they weigh rather than
// copy. A storekeeper always counts blind (the API sends them no figure) and hands the count in; a
// manager, cost controller or accountant may count blind too (a toggle), and otherwise sees each
// line's book quantity and reconciles the count: book, counted, difference, cost and value, the
// lines beyond the tolerance in red (short) or amber (over), and sends lines back to be weighed
// again (مطلوب إعادة جرد) without saying what they should be. A blind sheet prints for counting on paper.
//
// Full (جرد شامل) or spot (جرد يومي سريع): a spot count lists only the materials it covers, and
// posting it moves only those counted. Periodic (جرد دوري) or the opening stock (جرد افتتاحي),
// chosen as it starts; posted, it shows what was counted against what the records said.
@Component({
  selector: 'app-count-sheet-page',
  imports: [
    DatePipe,
    DecimalPipe,
    FormsModule,
    InfoTip,
    MatButtonModule,
    MatButtonToggleModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatSlideToggleModule,
    MoneyPipe,
    RouterLink,
  ],
  template: `
    <div class="toolbar no-print">
      <a mat-button routerLink="/costing/counts"><mat-icon>arrow_back</mat-icon> All counts</a>
      <span class="spacer"></span>
      @if (posted()) {
        <button mat-button (click)="print()"><mat-icon>print</mat-icon> Print</button>
      }
    </div>
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    } @else if (error()) {
      <p class="error">{{ error() }}</p>
    } @else if (posted(); as count) {
      <h2 class="title">
        {{ kindLabels[count.kind].en }}{{ count.scope === 'Spot' ? ' · ' + scopeLabels.Spot.en : '' }}, posted
        {{ count.postedAtUtc | date: 'EEE d MMM y, HH:mm' }}
        <span class="inline-ar">{{ kindLabels[count.kind].ar }} مُرحّل</span>
      </h2>
      <p class="muted">
        Started by {{ count.startedBy }}, posted by {{ count.postedBy }}.
        @if (count.scope === 'Spot') {
          {{ count.scopeLabel ?? 'Spot count' }}: only the materials counted moved.
        }
      </p>
      @if (count.status === 'Voided') {
        <p class="note">
          <span class="voided-badge">Voided<span class="ar">ملغى</span></span>
          {{ count.voidedAtUtc | date: 'd MMM y, HH:mm' }} by {{ count.voidedBy }}: its adjustments were undone, and the variance report no
          longer measures from it.
        </p>
      }
      @if (count.blind) {
        <!-- Counted blind: what was counted, and nothing of the records. -->
        <div class="table-wrap">
          <table class="grid blind-posted">
            <thead>
              <tr>
                <th>Code<span class="ar">الكود</span></th>
                <th>Material<span class="ar">الخامة</span></th>
                <th class="num">Counted<span class="ar">المجرود</span></th>
              </tr>
            </thead>
            <tbody>
              @for (row of blindRows(); track row.id) {
                <tr>
                  <td class="code">{{ row.code ?? '' }}</td>
                  <td>{{ row.name }}</td>
                  <td class="num">{{ row.counted | number: '1.0-3' }} {{ row.unit }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else if (count.kind === 'Opening') {
        <div class="table-wrap">
          <table class="grid opening">
            <thead>
              <tr>
                <th>Code<span class="ar">الكود</span></th>
                <th>Material<span class="ar">الخامة</span></th>
                <th class="num">Opened at<span class="ar">رصيد البداية</span></th>
                <th class="num">Cost<span class="ar">التكلفة</span></th>
                <th class="num">Worth<span class="ar">القيمة</span></th>
              </tr>
            </thead>
            <tbody>
              @for (row of openingRows(); track row.id) {
                <tr>
                  <td class="code">{{ row.code ?? '' }}</td>
                  <td>{{ row.name }}</td>
                  <td class="num">{{ row.counted | number: '1.0-3' }} {{ row.unit }}</td>
                  <td class="num">{{ row.cost === null ? '—' : (row.cost | money) + ' / ' + row.unit }}</td>
                  <td class="num">{{ row.worth === null ? 'No price' : (row.worth | money) }}</td>
                </tr>
              }
            </tbody>
            <tfoot>
              <tr>
                <td colspan="4">Opening stock value · قيمة المخزون الافتتاحي</td>
                <td class="num">{{ openingTotal() | money }}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        @if (openingUnpriced(); as n) {
          <p class="warn">
            {{ n === 1 ? '1 material has' : n + ' materials have' }} no price: its stock is set, its worth unknown until it is priced.
            <span class="note-ar" lang="ar" dir="rtl">خامات بلا سعر: رصيدها مُسجل وقيمتها غير معروفة حتى تُسعّر.</span>
          </p>
        }
        <p class="note">
          This is where stock begins, at the cost each has: no shortage or surplus was recorded, and nothing went into the profit. The first
          periodic count is measured from it.
          <span class="note-ar" lang="ar" dir="rtl">هذا رصيد البداية بتكلفة كل خامة: لا عجز ولا زيادة ولا أثر على الأرباح، ويُقاس أول جرد دوري منه.</span>
        </p>
      } @else {
        <div class="table-wrap">
          <table class="grid">
            <thead>
              <tr>
                <th>Code<span class="ar">الكود</span></th>
                <th>Material<span class="ar">الخامة</span></th>
                <th class="num">Counted<span class="ar">المجرود</span></th>
                <th class="num">Records said<span class="ar">الرصيد الدفتري</span></th>
                <th class="num">Difference<span class="ar">الفرق</span></th>
                <th class="num">Worth<span class="ar">القيمة</span></th>
              </tr>
            </thead>
            <tbody>
              @for (row of postedRows(); track row.id) {
                <tr [class.deficit]="row.difference < 0" [class.surplus]="row.difference > 0">
                  <td class="code">{{ row.code ?? '' }}</td>
                  <td>{{ row.name }}</td>
                  <td class="num">{{ row.counted | number: '1.0-3' }} {{ row.unit }}</td>
                  <td class="num">{{ row.book | number: '1.0-3' }} {{ row.unit }}</td>
                  <td class="num">{{ row.difference > 0 ? '+' : '' }}{{ row.difference | number: '1.0-3' }} {{ row.unit }}</td>
                  <td class="num">{{ row.value === null ? 'No price' : (row.value | money) }}</td>
                </tr>
              }
            </tbody>
            <tfoot>
              <tr>
                <td colspan="5">Net difference · صافي الفرق</td>
                <td class="num">{{ postedTotal() | money }}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p class="note">
          Stock was set to what was counted. Why the records were out is in the
          <a routerLink="/costing/reports/variance">variance report</a>, which sets it against sales, deliveries and waste.
        </p>
      }
    } @else {
      @if (isSpot()) {
        <p class="scope-line">
          <span class="scope-badge"><mat-icon>bolt</mat-icon> {{ scopeLabels.Spot.en }} · {{ scopeLabels.Spot.ar }}</span>
          <strong>{{ count()?.scopeLabel ?? 'Chosen materials' }}</strong>
          <span class="muted">· {{ materials().length }} {{ materials().length === 1 ? 'material' : 'materials' }}; only what is counted moves</span>
          <app-info-tip tip="countSpot" />
        </p>
      } @else {
        <div class="kind-choice">
          <mat-button-toggle-group [value]="kind()" (change)="chooseKind($event.value)" aria-label="Kind of count" hideSingleSelectionIndicator>
            <mat-button-toggle value="Opening">Opening stock <span class="inline-ar">جرد افتتاحي</span></mat-button-toggle>
            <mat-button-toggle value="Periodic">Periodic count <span class="inline-ar">جرد دوري</span></mat-button-toggle>
          </mat-button-toggle-group>
          @if (kind() === 'Opening') {
            <p class="note kind-note">
              Where each material's stock begins, at the cost it has: no shortage or surplus is recorded, and nothing goes into the profit. A
              material is opened once; a prep item never made is valued by its recipe.
              <span class="note-ar" lang="ar" dir="rtl">رصيد البداية لكل خامة بتكلفتها: لا يُسجل عجز أو زيادة ولا أثر على الأرباح. تُجرد الخامة افتتاحيًا مرة واحدة، والمصنّع الذي لم يُصنع بعد يُقيّم بوصفته.</span>
            </p>
          } @else {
            <p class="note kind-note">
              What you count is set against the records: the difference is a shortage or a surplus, in the variance report and the month's cost.
              <span class="note-ar" lang="ar" dir="rtl">يُقارن المجرود بالرصيد الدفتري: الفرق عجز أو زيادة يظهر في تقرير الانحراف وتكلفة الشهر.</span>
            </p>
          }
        </div>
      }

      @if (count(); as c) {
        @if (c.status !== 'Draft') {
          <!-- Posted: the review is over; who handed it in stays on the count. -->
        } @else if (c.review === 'RecountRequested') {
          <p class="review-banner recount" role="status">
            <mat-icon>replay</mat-icon>
            <span>
              <strong>{{ recountCount() }} {{ recountCount() === 1 ? 'line' : 'lines' }} to weigh again · مطلوب إعادة جرد</strong>
              @if (c.reviewedBy) {
                — asked by {{ c.reviewedBy }}{{ c.reviewNote ? ': “' + c.reviewNote + '”' : '' }}
              }
            </span>
          </p>
        } @else if (c.review === 'Submitted') {
          <p class="review-banner submitted" role="status">
            <mat-icon>{{ forcedBlind() ? 'hourglass_top' : 'rate_review' }}</mat-icon>
            <span>
              @if (forcedBlind()) {
                Handed in for review {{ c.submittedAtUtc | date: 'd MMM, HH:mm' }}: a manager or cost controller reconciles it and posts it.
                <span class="inline-ar">{{ reviewLabels.Submitted.ar }}</span>
              } @else {
                Handed in by <strong>{{ c.submittedBy }}</strong> {{ c.submittedAtUtc | date: 'd MMM, HH:mm' }}: reconcile it below, then post it or
                send lines back. <span class="inline-ar">راجع الفروقات ثم رحّل أو اطلب إعادة الجرد</span>
              }
            </span>
          </p>
        }
      }

      <div class="toolbar sticky">
        <mat-form-field subscriptSizing="dynamic" class="find">
          <mat-label>Find · بحث</mat-label>
          <input matInput [ngModel]="search()" (ngModelChange)="search.set($event)" />
        </mat-form-field>
        <span class="progress">
          {{ countedCount() }} of {{ materials().length }} counted<span class="muted"> (empty is not counted, 0 is none left)</span>
          @if (kind() === 'Opening' && !blind()) {
            <span class="worth">
              · worth {{ draftValue().value | money }} at today's costs
              @if (draftValue().unpriced) {
                <span class="muted">({{ draftValue().unpriced }} with no price)</span>
              }
              <span class="inline-ar">القيمة بتكلفة اليوم</span>
            </span>
          }
          <span class="muted save-state">· {{ saveState() }}</span>
        </span>
        <span class="blind-mode">
          @if (forcedBlind()) {
            <span class="blind-badge"><mat-icon>visibility_off</mat-icon> Blind count · جرد أعمى</span>
          } @else {
            <mat-slide-toggle [checked]="blindChoice()" (change)="chooseBlind($event.checked)">
              Blind entry mode · وضع الجرد الأعمى <span class="muted small">(إخفاء الرصيد الدفتري أثناء الإدخال)</span>
            </mat-slide-toggle>
          }
          <app-info-tip tip="countBlind" />
        </span>
        <span class="spacer"></span>
        <button mat-button (click)="printBlindSheet()"><mat-icon>print</mat-icon> Print blind sheet · طباعة كشف جرد أعمى</button>
        @if (confirming() === 'post') {
          <span>
            @if (kind() === 'Opening') {
              Open the stock of {{ countedCount() }} {{ countedCount() === 1 ? 'material' : 'materials' }} at what was counted, with no shortage or
              surplus?
            } @else {
              Set stock to what was counted for {{ countedCount() }} {{ countedCount() === 1 ? 'material' : 'materials' }}?
            }
            @if (materials().length - countedCount() > 0) {
              {{ materials().length - countedCount() }} not counted keep their stock.
            }
            @if (recountCount()) {
              <strong class="warn-text">{{ recountCount() }} still to weigh again.</strong>
            }
          </span>
          <button mat-button (click)="confirming.set(null)">Keep counting</button>
          <button mat-flat-button (click)="post()" [disabled]="busy()">{{ kind() === 'Opening' ? 'Post the opening stock' : 'Post the count' }}</button>
        } @else if (confirming() === 'discard') {
          <span>Throw this count away?</span>
          <button mat-button (click)="confirming.set(null)">Keep it</button>
          <button mat-flat-button class="danger" (click)="discard()" [disabled]="busy()">Discard</button>
        } @else {
          @if (saved()) {
            <button mat-button (click)="confirming.set('discard')"><mat-icon>delete</mat-icon> Discard</button>
          }
          @if (forcedBlind()) {
            <button mat-flat-button (click)="submit()" [disabled]="countedCount() === 0 || busy()">
              <mat-icon>send</mat-icon>
              {{ count()?.review === 'Submitted' ? 'Hand in again · إعادة الإرسال للمراجعة' : 'Hand in for review · إرسال للمراجعة' }}
            </button>
          } @else {
            <button mat-flat-button (click)="confirming.set('post')" [disabled]="countedCount() === 0 || busy()">
              <mat-icon>fact_check</mat-icon> {{ kind() === 'Opening' ? 'Post the opening stock' : 'Post the count' }}
            </button>
          }
        }
      </div>
      @if (problem(); as p) {
        <p class="error">{{ p }}</p>
      }

      @if (!blind() && reconcileRows().length) {
        <section class="reconcile" aria-labelledby="reconcile-title">
          <h3 id="reconcile-title">
            Reconciliation · مراجعة الفروقات
            <span class="muted small">tolerance ±{{ tolerance() | number: '1.0-1' }}%</span>
          </h3>
          <div class="table-wrap">
            <table class="grid reconcile-table">
              <thead>
                <tr>
                  <th><span class="visually-hidden">Recount</span></th>
                  <th>Material<span class="ar">الخامة</span></th>
                  <th class="num">Book<span class="ar">الرصيد الدفتري</span></th>
                  <th class="num">Counted<span class="ar">الكمية الفعلية</span></th>
                  <th class="num">Variance<span class="ar">الفرق / العجز والزيادة</span></th>
                  <th class="num">Unit cost<span class="ar">تكلفة الوحدة</span></th>
                  <th class="num">Variance value <app-info-tip tip="countVarianceValue" /><span class="ar">قيمة الفرق</span></th>
                  <th>Note<span class="ar">ملاحظة</span></th>
                </tr>
              </thead>
              <tbody>
                @for (row of reconcileRows(); track row.id) {
                  <tr [class.short]="row.flag === 'short'" [class.over]="row.flag === 'over'">
                    <td>
                      <mat-checkbox [checked]="recountPick().has(row.id)" (change)="pickRecount(row.id, $event.checked)"
                        [attr.aria-label]="'Recount ' + row.name" />
                    </td>
                    <td>
                      {{ row.name }}
                      @if (row.code) {
                        <small class="muted">{{ row.code }}</small>
                      }
                      @if (row.recountRequested) {
                        <span class="recount-badge">Recount needed · مطلوب إعادة جرد</span>
                      }
                    </td>
                    <td class="num">{{ row.book === null ? '—' : (row.book | number: '1.0-3') + ' ' + row.unit }}</td>
                    <td class="num">{{ row.counted | number: '1.0-3' }} {{ row.unit }}</td>
                    <td class="num">
                      @if (row.difference === null) {
                        —
                      } @else {
                        {{ row.difference > 0 ? '+' : '' }}{{ row.difference | number: '1.0-3' }} {{ row.unit }}
                        @if (row.flag === 'short') {
                          <span class="flag short">Short · عجز</span>
                        } @else if (row.flag === 'over') {
                          <span class="flag over">Over · زيادة</span>
                        }
                      }
                    </td>
                    <td class="num">{{ row.unitCost === null ? '—' : (row.unitCost | money) + ' / ' + row.unit }}</td>
                    <td class="num">{{ row.value === null ? '—' : (row.value | money) }}</td>
                    <td class="note-cell">{{ row.note ?? '' }}</td>
                  </tr>
                }
              </tbody>
              <tfoot>
                <tr>
                  <td colspan="6">Net variance · صافي الفرق</td>
                  <td class="num">{{ reconcileTotal() | money }}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div class="recount-actions">
            <mat-form-field subscriptSizing="dynamic" class="recount-note">
              <mat-label>Note to the counter · ملاحظة للقائم بالجرد</mat-label>
              <input matInput maxlength="300" [ngModel]="recountNote()" (ngModelChange)="recountNote.set($event)" placeholder="Weigh the beef again: the scale was off" />
            </mat-form-field>
            <button mat-stroked-button (click)="requestRecount()" [disabled]="!recountPick().size || busy()">
              <mat-icon>replay</mat-icon> Recount needed · مطلوب إعادة جرد ({{ recountPick().size }})
            </button>
          </div>
        </section>
      }

      @for (section of sections(); track section.category) {
        <h3 class="category">{{ section.category }}</h3>
        <div class="sheet">
          @for (m of section.materials; track m.id) {
            <div class="item" [class.done]="isCounted(m.id)" [class.recount]="recountAsked(m.id)">
              <div class="item-head">
                <span class="name">
                  {{ m.name }}
                  @if (m.code) {
                    <small class="muted">{{ m.code }}</small>
                  }
                </span>
                @if (recountAsked(m.id)) {
                  <span class="recount-badge">Recount needed · مطلوب إعادة جرد</span>
                }
                @if (!blind() && bookOf(m.id); as book) {
                  <small class="book">Book · الدفتري {{ book }}</small>
                }
              </div>
              <mat-form-field subscriptSizing="dynamic" class="qty">
                <input matInput type="number" min="0" step="any" inputmode="decimal" placeholder="—"
                  [ngModel]="counted()[m.id]" (ngModelChange)="enter(m.id, $event)" [attr.aria-label]="m.name + ', counted in ' + unitOf(m)" />
                <span matTextSuffix>&nbsp;{{ unitOf(m) }}</span>
              </mat-form-field>
              <input class="line-note" maxlength="200" placeholder="Note · ملاحظة" [ngModel]="notes()[m.id] ?? ''" (ngModelChange)="note(m.id, $event)"
                [attr.aria-label]="m.name + ', note'" />
            </div>
          }
        </div>
      } @empty {
        <p class="note">No raw materials match.</p>
      }
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .kind-choice {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
      margin-bottom: 8px;

      .kind-note {
        flex: 1 1 320px;
        margin: 0;
      }
    }
    .scope-line {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      margin: 0 0 8px;
    }
    .scope-badge,
    .blind-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 10px;
      border-radius: 999px;
      font: var(--mat-sys-label-medium);
      background: color-mix(in srgb, var(--mat-sys-primary) 12%, transparent);
      color: var(--mat-sys-primary);

      mat-icon {
        width: 16px;
        height: 16px;
        font-size: 16px;
      }
    }
    .review-banner {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin: 0 0 8px;
      padding: 10px 14px;
      border-radius: 12px;
      font: var(--mat-sys-body-medium);

      mat-icon {
        flex: none;
      }
      &.recount {
        background: color-mix(in srgb, var(--app-warn) 16%, transparent);
        color: var(--app-warn);
      }
      &.submitted {
        background: color-mix(in srgb, var(--mat-sys-primary) 10%, transparent);
      }
    }
    .worth {
      margin-inline-start: 4px;
    }
    .title {
      margin: 0 0 4px;
      font: var(--mat-sys-title-large);
    }
    .sticky {
      position: sticky;
      top: 64px;
      z-index: 2;
      flex-wrap: wrap;
      padding: 8px 0;
      background: var(--mat-sys-surface);
    }
    .find {
      width: 180px;
    }
    .blind-mode {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .progress {
      font: var(--mat-sys-title-small);
    }
    .small {
      font-size: 0.8em;
    }
    .warn-text {
      color: var(--app-warn);
    }
    .category {
      margin: 16px 0 8px;
      font: var(--mat-sys-title-small);
      color: var(--mat-sys-on-surface-variant);
    }
    .sheet {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 8px;
    }
    .item {
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: center;
      gap: 4px 8px;
      padding: 6px 6px 6px 12px;
      border-radius: 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface);

      &.done {
        border-color: var(--mat-sys-primary);
      }
      &.recount {
        border-color: var(--app-warn);
        box-shadow: inset 3px 0 0 var(--app-warn);
      }
      .item-head {
        display: grid;
        gap: 2px;
        min-width: 0;
      }
      .name {
        display: grid;
      }
      .book {
        color: var(--mat-sys-on-surface-variant);
      }
      .line-note {
        grid-column: 1 / -1;
        min-width: 0;
        padding: 4px 8px;
        border: 1px dashed var(--mat-sys-outline-variant);
        border-radius: 8px;
        background: transparent;
        font: var(--mat-sys-body-small);
        color: inherit;
      }
    }
    .recount-badge {
      justify-self: start;
      padding: 1px 8px;
      border-radius: 999px;
      font: var(--mat-sys-label-small);
      background: color-mix(in srgb, var(--app-warn) 18%, transparent);
      color: var(--app-warn);
      white-space: nowrap;
    }
    .qty {
      width: 150px;
      flex: none;
    }
    .reconcile {
      margin: 8px 0 16px;

      h3 {
        margin: 0 0 6px;
        font: var(--mat-sys-title-small);
      }
      tr.short td:first-child {
        box-shadow: inset 3px 0 0 var(--mat-sys-error);
      }
      tr.over td:first-child {
        box-shadow: inset 3px 0 0 var(--app-warn);
      }
      .flag {
        display: inline-block;
        margin-inline-start: 6px;
        padding: 0 8px;
        border-radius: 999px;
        font: var(--mat-sys-label-small);

        &.short {
          background: color-mix(in srgb, var(--mat-sys-error) 14%, transparent);
          color: var(--mat-sys-error);
        }
        &.over {
          background: color-mix(in srgb, var(--app-warn) 18%, transparent);
          color: var(--app-warn);
        }
      }
      .note-cell {
        max-width: 220px;
        color: var(--mat-sys-on-surface-variant);
      }
    }
    .recount-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-top: 8px;
    }
    .recount-note {
      flex: 1 1 280px;
      max-width: 480px;
    }
    .danger {
      --mat-button-filled-container-color: var(--mat-sys-error);
      --mat-button-filled-label-text-color: var(--mat-sys-on-error);
    }
    @media (max-width: 600px) {
      .sheet {
        grid-template-columns: 1fr;
      }
      .qty {
        width: 130px;
      }
    }
  `,
})
export class CountSheetPage {
  private readonly api = inject(CostingApi);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly company = inject(Company);
  protected readonly kindLabels = countKindLabels;
  protected readonly scopeLabels = countScopeLabels;
  protected readonly reviewLabels = countReviewLabels;

  // From the route: /costing/counts/:id. A new count's id, before its first save, finds nothing.
  readonly id = input.required<string>();
  // From the query: the kind a new count starts as (?kind=Opening).
  readonly kindParam = input<string | undefined>(undefined, { alias: 'kind' });
  protected readonly kind = signal<StockCountKind>('Periodic');

  // Who does not see the costs counts blind, always; anyone else when they choose to.
  protected readonly forcedBlind = computed(() => !this.auth.can(Permissions.CostingView));
  protected readonly blindChoice = signal(readBlindChoice());
  protected readonly blind = computed(() => this.forcedBlind() || this.blindChoice());

  // What the sheet lists, each with its costs when the user may see them.
  protected readonly materials = signal<MaterialCost[]>([]);
  protected readonly count = signal<StockCount | null>(null);
  protected readonly tolerance = signal(5);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly problem = signal<string | null>(null);
  protected readonly confirming = signal<'post' | 'discard' | null>(null);
  protected readonly search = signal('');

  // By material id, in kg, litres or pieces; null or absent is not counted.
  protected readonly counted = signal<Record<string, number | null>>({});
  protected readonly notes = signal<Record<string, string | undefined>>({});
  // Whether the draft exists on the server yet.
  protected readonly saved = signal(false);
  protected readonly saveState = signal('Nothing entered yet');

  // The reviewer's picks to weigh again, and their word to the counter.
  protected readonly recountPick = signal(new Set<string>());
  protected readonly recountNote = signal('');

  // Posted, or voided since: either way read-only.
  protected readonly posted = computed(() => (this.count() && this.count()!.status !== 'Draft' ? this.count() : null));
  protected readonly isSpot = computed(() => this.count()?.scope === 'Spot');

  protected readonly countedCount = computed(() => Object.values(this.counted()).filter((v) => this.valid(v)).length);
  protected readonly recountCount = computed(() => (this.count()?.lines ?? []).filter((l) => l.recountRequested).length);

  protected readonly sections = computed<Section[]>(() => {
    const needle = this.search().trim().toLowerCase();
    const shown = this.materials().filter((m) => !needle || [m.name, m.code, m.category].some((v) => v?.toLowerCase().includes(needle)));
    const byCategory = new Map<string, MaterialCost[]>();
    for (const m of shown) {
      const category = m.category ?? 'Other · أخرى';
      byCategory.set(category, [...(byCategory.get(category) ?? []), m]);
    }
    return [...byCategory.entries()]
      .sort(([a], [b]) => (a.startsWith('Other') ? 1 : b.startsWith('Other') ? -1 : a.localeCompare(b)))
      .map(([category, materials]) => ({ category, materials }));
  });

  // Each counted line against the records, the furthest out (by worth, then share) first.
  protected readonly reconcileRows = computed<ReconcileRow[]>(() => {
    const lines = new Map((this.count()?.lines ?? []).map((l) => [l.rawMaterialId, l]));
    const tolerance = this.tolerance();
    return this.materials()
      .filter((m) => this.valid(this.counted()[m.id]))
      .map((m) => {
        const size = this.sizeOf(m);
        const line = lines.get(m.id);
        const counted = this.counted()[m.id]!;
        const book = line?.bookQuantity ?? null;
        const difference = book === null ? null : counted - book / size;
        const share = book === null || difference === null ? 0 : book > 0 ? (Math.abs(difference * size) / book) * 100 : difference !== 0 ? Infinity : 0;
        return {
          id: m.id,
          code: m.code,
          name: m.name,
          category: m.category,
          unit: this.unitOf(m),
          counted,
          book: book === null ? null : book / size,
          difference,
          unitCost: line?.unitCost == null ? null : line.unitCost * size,
          value: difference === null || line?.unitCost == null ? null : difference * size * line.unitCost,
          flag: difference !== null && share > tolerance ? (difference < 0 ? ('short' as const) : ('over' as const)) : null,
          note: this.notes()[m.id] || null,
          recountRequested: !!line?.recountRequested,
        };
      })
      .sort((a, b) => Math.abs(b.value ?? 0) - Math.abs(a.value ?? 0) || a.name.localeCompare(b.name));
  });

  protected readonly reconcileTotal = computed(() => this.reconcileRows().reduce((sum, r) => sum + (r.value ?? 0), 0));

  protected readonly postedRows = computed(() => {
    const count = this.posted();
    if (!count) {
      return [];
    }
    return count.lines
      .map((line) => {
        const m = this.materials().find((x) => x.id === line.rawMaterialId);
        const unit = m ? countUnit(m.unit, m.purchaseUnitSize) : { label: '', size: 1 };
        const difference = line.countedQuantity - (line.bookQuantity ?? 0);
        return {
          id: line.rawMaterialId,
          code: m?.code ?? null,
          name: m?.name ?? 'A removed material',
          unit: unit.label,
          counted: line.countedQuantity / unit.size,
          book: (line.bookQuantity ?? 0) / unit.size,
          difference: difference / unit.size,
          value: line.unitCost === null ? null : difference * line.unitCost,
        };
      })
      .sort((a, b) => Math.abs(b.value ?? 0) - Math.abs(a.value ?? 0));
  });

  protected readonly postedTotal = computed(() => this.postedRows().reduce((sum, r) => sum + (r.value ?? 0), 0));

  // A count posted, seen blind: what was counted, nothing more.
  protected readonly blindRows = computed(() =>
    (this.posted()?.lines ?? [])
      .map((line) => {
        const m = this.materials().find((x) => x.id === line.rawMaterialId);
        const unit = m ? countUnit(m.unit, m.purchaseUnitSize) : { label: '', size: 1 };
        return { id: line.rawMaterialId, code: m?.code ?? null, name: m?.name ?? 'A removed material', unit: unit.label, counted: line.countedQuantity / unit.size };
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
  );

  // The opening stock posted: each material at what it was counted at, and the cost it opened at.
  protected readonly openingRows = computed(() => {
    const count = this.posted();
    if (!count) {
      return [];
    }
    return count.lines
      .map((line) => {
        const m = this.materials().find((x) => x.id === line.rawMaterialId);
        const unit = m ? countUnit(m.unit, m.purchaseUnitSize) : { label: '', size: 1 };
        return {
          id: line.rawMaterialId,
          code: m?.code ?? null,
          name: m?.name ?? 'A removed material',
          unit: unit.label,
          counted: line.countedQuantity / unit.size,
          cost: line.unitCost === null ? null : line.unitCost * unit.size,
          worth: line.unitCost === null ? null : line.countedQuantity * line.unitCost,
        };
      })
      .sort((a, b) => (b.worth ?? -1) - (a.worth ?? -1) || a.name.localeCompare(b.name));
  });

  protected readonly openingTotal = computed(() => this.openingRows().reduce((sum, r) => sum + (r.worth ?? 0), 0));
  protected readonly openingUnpriced = computed(() => this.openingRows().filter((r) => r.worth === null).length);

  // An opening stock being filled in, at today's costs: a prep item never made at its recipe's.
  protected readonly draftValue = computed(() => {
    const byId = new Map(this.materials().map((m) => [m.id, m]));
    let value = 0;
    let unpriced = 0;
    for (const [id, quantity] of Object.entries(this.counted())) {
      const m = byId.get(id);
      if (!m || !this.valid(quantity)) {
        continue;
      }
      const cost = recipeCostOf(m);
      if (cost === null) {
        unpriced++;
      } else {
        value += quantity * this.sizeOf(m) * cost;
      }
    }
    return { value, unpriced };
  });

  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<void> | null = null;
  private dirty = false;
  // Every material, before a spot count narrows the sheet to what it covers.
  private allMaterials: MaterialCost[] = [];

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => void this.load(id));
    });
    // Leaving with entries not yet saved: saved on the way out.
    inject(DestroyRef).onDestroy(() => {
      if (this.dirty) {
        void this.saveNow();
      }
    });
  }

  protected unitOf(material: MaterialCost): string {
    return countUnit(material.unit, material.purchaseUnitSize).label;
  }

  protected isCounted(id: string): boolean {
    return this.valid(this.counted()[id]);
  }

  protected recountAsked(id: string): boolean {
    return !!this.count()?.lines.find((l) => l.rawMaterialId === id)?.recountRequested;
  }

  // What the records say now, as the reviewer sees it beside the field: "12.5 kg".
  protected bookOf(id: string): string | null {
    const line = this.count()?.lines.find((l) => l.rawMaterialId === id);
    const m = this.materials().find((x) => x.id === id);
    if (line?.bookQuantity == null || !m) {
      return null;
    }
    return `${(line.bookQuantity / this.sizeOf(m)).toLocaleString('en-US', { maximumFractionDigits: 3 })} ${this.unitOf(m)}`;
  }

  protected enter(id: string, value: number | null | string): void {
    const quantity = value === '' || value === null ? null : Number(value);
    this.counted.update((counted) => ({ ...counted, [id]: quantity }));
    this.changed();
  }

  protected note(id: string, value: string): void {
    this.notes.update((notes) => ({ ...notes, [id]: value }));
    if (this.isCounted(id)) {
      this.changed();
    }
  }

  // Blind, or not, on this device: the count read again with the records' figures, or without.
  protected async chooseBlind(blind: boolean): Promise<void> {
    this.blindChoice.set(blind);
    try {
      localStorage.setItem(blindKey, blind ? '1' : '0');
    } catch {
      // Kept for this visit only.
    }
    if (this.saved()) {
      try {
        const count = await firstValueFrom(this.api.stockCount(this.id(), this.blind()));
        if (count) {
          this.count.set(count);
        }
      } catch (error) {
        this.problem.set(errorMessage(error, 'The count could not be read again.'));
      }
    }
  }

  protected pickRecount(id: string, picked: boolean): void {
    this.recountPick.update((pick) => {
      const next = new Set(pick);
      if (picked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  // Told it is the other kind: saved so, if it is saved already; else its first save says it.
  protected chooseKind(kind: StockCountKind): void {
    if (kind === this.kind()) {
      return;
    }
    this.kind.set(kind);
    this.problem.set(null);
    if (this.saved() || this.countedCount() > 0) {
      this.dirty = true;
      this.saveState.set('Not saved yet');
      void this.saveNow();
    }
  }

  protected async post(): Promise<void> {
    this.busy.set(true);
    this.problem.set(null);
    try {
      await this.saveNow();
      if (this.problem()) {
        return;
      }
      const count = await firstValueFrom(this.api.postStockCount(this.id()));
      this.count.set(count);
      this.confirming.set(null);
      this.notify.info(
        count.kind === 'Opening'
          ? 'Opening stock posted: stock starts from what was counted. · تم ترحيل الجرد الافتتاحي.'
          : count.scope === 'Spot'
            ? 'Spot count posted: only the materials counted moved. · تم ترحيل الجرد السريع.'
            : 'Count posted: stock is set to what was counted.',
      );
    } catch (error) {
      this.problem.set(errorMessage(error, 'The count could not be posted.'));
    } finally {
      this.busy.set(false);
    }
  }

  // Handed in for a manager or cost controller to reconcile and post.
  protected async submit(): Promise<void> {
    this.busy.set(true);
    this.problem.set(null);
    try {
      await this.saveNow();
      if (this.problem()) {
        return;
      }
      this.count.set(await firstValueFrom(this.api.submitStockCount(this.id(), this.blind())));
      this.notify.info('Handed in for review: a manager or cost controller reconciles and posts it. · تم الإرسال للمراجعة.');
    } catch (error) {
      this.problem.set(errorMessage(error, 'The count could not be handed in.'));
    } finally {
      this.busy.set(false);
    }
  }

  // The picked lines sent back to be weighed again, with the note; never with the figure.
  protected async requestRecount(): Promise<void> {
    const ids = [...this.recountPick()];
    if (!ids.length) {
      return;
    }
    this.busy.set(true);
    this.problem.set(null);
    try {
      await this.saveNow();
      this.count.set(await firstValueFrom(this.api.requestRecount(this.id(), ids, this.recountNote().trim() || null)));
      this.recountPick.set(new Set());
      this.recountNote.set('');
      this.notify.info(`${ids.length === 1 ? '1 line' : ids.length + ' lines'} sent back to be weighed again. · تم طلب إعادة الجرد.`);
    } catch (error) {
      this.problem.set(errorMessage(error, 'The recount could not be asked for.'));
    } finally {
      this.busy.set(false);
    }
  }

  protected async discard(): Promise<void> {
    this.busy.set(true);
    try {
      this.cancelAutosave();
      await firstValueFrom(this.api.discardStockCount(this.id()));
      this.notify.info('Count discarded.');
      void this.router.navigate(['/costing/counts']);
    } catch (error) {
      this.problem.set(errorMessage(error, 'The count could not be discarded.'));
    } finally {
      this.busy.set(false);
    }
  }

  protected print(): void {
    window.print();
  }

  // A blind sheet for counting on paper (كشف جرد أعمى): code, material, category and unit, a box
  // for the count and a line for a note, and the signatures; nothing of the records. In its own
  // window, so it prints as a sheet and not as the screen.
  protected printBlindSheet(): void {
    const sheet = window.open('', '_blank');
    if (!sheet) {
      this.notify.error(null, 'The browser stopped the sheet opening: allow pop-ups for this site, then print again.');
      return;
    }
    const count = this.count();
    const title = `${this.isSpot() ? 'Spot count · جرد يومي سريع' : this.kind() === 'Opening' ? 'Opening stock · جرد افتتاحي' : 'Periodic count · جرد دوري'}`;
    const rows = this.sections()
      .map(
        (s) =>
          `<tr class="group"><td colspan="6">${escape(s.category)}</td></tr>` +
          s.materials
            .map(
              (m) =>
                `<tr><td>${escape(m.code ?? '')}</td><td>${escape(m.name)}</td><td>${escape(m.category ?? '')}</td><td>${escape(this.unitOf(m))}</td>` +
                `<td class="box"></td><td class="box wide"></td></tr>`,
            )
            .join(''),
      )
      .join('');
    sheet.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Blind count sheet · كشف جرد أعمى</title><style>
      body { font: 12px/1.4 system-ui, sans-serif; margin: 24px; color: #111; }
      h1 { font-size: 18px; margin: 0 0 4px; } p { margin: 0 0 12px; color: #444; }
      table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #999; padding: 6px 8px; text-align: start; }
      th { background: #eee; } tr.group td { background: #f5f5f5; font-weight: 600; }
      td.box { width: 90px; height: 22px; } td.box.wide { width: 180px; }
      .signatures { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin-top: 32px; }
      .signatures div { border-top: 1px solid #111; padding-top: 4px; }
      @page { margin: 14mm; }
    </style></head><body>
      <h1>${escape(this.company.name())} — Blind count sheet · كشف جرد أعمى</h1>
      <p>${escape(title)}${count?.scopeLabel ? ' — ' + escape(count.scopeLabel) : ''} · ${escape(new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }))}
        · Count what is on the shelf; write the quantity in the unit shown. · اكتب الكمية الفعلية بالوحدة الموضحة.</p>
      <table><thead><tr><th>Code · الكود</th><th>Material · الخامة</th><th>Category · القسم</th><th>Unit · الوحدة</th>
        <th>Counted · الكمية الفعلية</th><th>Note · ملاحظة</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="signatures"><div>Counted by · القائم بالجرد</div><div>Signature · التوقيع</div><div>Reviewed by · المراجع</div></div>
    </body></html>`);
    sheet.document.close();
    sheet.focus();
    sheet.print();
  }

  private changed(): void {
    this.problem.set(null);
    this.dirty = true;
    this.saveState.set('Not saved yet');
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => void this.saveNow(), autosaveAfterMs);
  }

  // Saves the sheet as it stands. One save at a time; entries made during it are saved after.
  private async saveNow(): Promise<void> {
    this.cancelAutosave();
    if (this.saving) {
      await this.saving;
      if (!this.dirty) {
        return;
      }
    }
    if (!this.dirty && this.saved()) {
      return;
    }
    this.saving = this.send();
    try {
      await this.saving;
    } finally {
      this.saving = null;
    }
  }

  private async send(): Promise<void> {
    const materials = new Map(this.materials().map((m) => [m.id, m]));
    const lines = Object.entries(this.counted())
      .filter(([id, v]) => this.valid(v) && materials.has(id))
      .map(([id, v]) => {
        const line: { rawMaterialId: string; countedQuantity: number; note?: string } = {
          rawMaterialId: id,
          countedQuantity: Math.round(v! * this.sizeOf(materials.get(id)!) * 1000) / 1000,
        };
        const note = this.notes()[id]?.trim();
        if (note) {
          line.note = note;
        }
        return line;
      });
    this.dirty = false;
    this.saveState.set('Saving…');
    try {
      const saved = await firstValueFrom(this.api.saveStockCount(this.id(), lines, this.kind(), undefined, this.blind()));
      // The records' figures as they stand now, for the reviewer; the review as it stands.
      if (saved) {
        this.count.set(saved);
      }
      this.saved.set(true);
      this.saveState.set(`Saved ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
    } catch (error) {
      this.dirty = true;
      this.saveState.set('Not saved');
      this.problem.set(errorMessage(error, 'The count could not be saved. Your entries are still here; they are saved with the next one.'));
    }
  }

  private cancelAutosave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }

  private sizeOf(material: MaterialCost): number {
    return countUnit(material.unit, material.purchaseUnitSize).size;
  }

  private valid(value: number | null | undefined): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
  }

  // What a sheet lists: every material and prep item (nothing of its stock or cost), each with its
  // costs when the user may see them (the opening stock's worth); a spot count's alone.
  private async load(id: string): Promise<void> {
    this.error.set(null);
    try {
      const seesCosts = !this.forcedBlind();
      const [items, costs, read, settings] = await Promise.all([
        firstValueFrom(this.api.countItems()),
        seesCosts ? firstValueFrom(this.api.materials()) : Promise.resolve([] as MaterialCost[]),
        firstValueFrom(this.api.stockCount(id, this.blind())),
        seesCosts ? firstValueFrom(this.api.settings()).catch(() => null) : Promise.resolve(null),
      ]);
      // Blind is for counting: a posted count, for whoever may see the records, with them.
      const count = read && read.status !== 'Draft' && read.blind && seesCosts ? await firstValueFrom(this.api.stockCount(id, false)) : read;
      const priced = new Map(costs.map((m) => [m.id, m]));
      const counted = new Set((count?.lines ?? []).map((l) => l.rawMaterialId));
      this.allMaterials = items
        .filter((i) => !i.isArchived || counted.has(i.id))
        .map((i) => ({ ...fromItem(i), ...(priced.get(i.id) ?? {}), category: i.category, isSpotCheckItem: i.isSpotCheckItem }));
      const scope = count?.scope === 'Spot' ? new Set(count.scopeMaterialIds ?? []) : null;
      this.materials.set(scope ? this.allMaterials.filter((m) => scope.has(m.id)) : this.allMaterials);
      this.count.set(count);
      this.tolerance.set(settings?.varianceTolerancePercent ?? 5);
      this.saved.set(count !== null);
      this.kind.set(count?.kind ?? (this.kindParam() === 'Opening' ? 'Opening' : 'Periodic'));
      const units = new Map(this.allMaterials.map((m) => [m.id, this.sizeOf(m)]));
      this.counted.set(Object.fromEntries((count?.lines ?? []).map((l) => [l.rawMaterialId, l.countedQuantity / (units.get(l.rawMaterialId) ?? 1)])));
      this.notes.set(Object.fromEntries((count?.lines ?? []).filter((l) => l.note).map((l) => [l.rawMaterialId, l.note!])));
      if (count) {
        this.saveState.set('Saved');
      }
    } catch (error) {
      this.error.set(errorMessage(error, 'The count could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }
}

function readBlindChoice(): boolean {
  try {
    return localStorage.getItem(blindKey) === '1';
  } catch {
    return false;
  }
}

// A count sheet's material as the rest of the page reads one: no cost, no stock.
function fromItem(item: CountItem): MaterialCost {
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    category: item.category,
    categoryId: item.categoryId,
    unit: item.unit,
    purchaseUnit: item.purchaseUnit,
    purchaseUnitSize: item.purchaseUnitSize,
    costPerPurchaseUnit: null,
    defaultYieldPercent: 100,
    quantityOnHand: 0,
    reorderLevel: 0,
    stockValue: null,
    lastPurchaseCostPerPurchaseUnit: null,
    lastPurchasedAtUtc: null,
    costPerUnit: null,
    kind: item.isPrepItem ? 'Prep' : 'Purchased',
    isSpotCheckItem: item.isSpotCheckItem,
  } as MaterialCost;
}

// Text written into the printed sheet, as text.
function escape(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
