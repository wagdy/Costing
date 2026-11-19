import { DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { Permissions } from '../../core/auth/permissions';
import { CostingAccess } from '../../core/costing/costing-tabs';
import {
  CostingApi,
  DiscountImpact,
  Kpi,
  KpiKey,
  KpiReport,
  MonthlyExpenses,
  PnlColumn,
  PnlScope,
  expenseLineLabels,
  kpiLabels,
} from '../../core/costing/costing.api';
import { errorMessage } from '../../core/http/error-message';
import { Company } from '../../core/settings/company';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { NotifyService } from '../../core/ui/notify.service';
import { InfoTip } from './info-tip';
import { InfoTipKey } from './info-tips';

// Each KPI's (ⓘ): what it says and how it is worked out.
const kpiTips: Record<KpiKey, InfoTipKey> = {
  FoodCost: 'kpiFoodCost',
  BeverageCost: 'kpiBeverageCost',
  LabourCost: 'kpiLabourCost',
  AverageCheck: 'kpiAverageCheck',
  SalesPerLabourHour: 'kpiSalesPerLabourHour',
  GrossProfitMargin: 'kpiGrossProfitMargin',
  NetProfitMargin: 'kpiNetProfitMargin',
};

type Tone = 'ok' | 'bad' | 'check' | 'none';

// The rows of the table by branch (consolidated): each column's figures down the P&L.
const columnRows: { key: keyof Pick<PnlColumn, 'revenue' | 'costOfSales' | 'grossProfit' | 'operatingExpenses' | 'ebitda' | 'netProfit'>; en: string; ar: string; total?: boolean }[] = [
  { key: 'revenue', en: 'Revenue', ar: 'الإيرادات', total: true },
  { key: 'costOfSales', en: 'Cost of sales', ar: 'تكلفة المبيعات' },
  { key: 'grossProfit', en: 'Gross profit', ar: 'مجمل الربح', total: true },
  { key: 'operatingExpenses', en: 'Operating expenses', ar: 'المصروفات التشغيلية' },
  { key: 'ebitda', en: 'EBITDA', ar: 'الربح التشغيلي', total: true },
  { key: 'netProfit', en: 'Net profit', ar: 'صافي الربح', total: true },
];

const expenseFields: { key: keyof MonthlyExpenses; en: string; ar: string; hours?: boolean }[] = [
  { key: 'wagesAndBenefits', en: 'Wages and benefits', ar: 'الرواتب والمزايا' },
  { key: 'labourHours', en: 'Labour hours', ar: 'ساعات العمل', hours: true },
  { key: 'occupationCost', en: 'Rent, not on invoices', ar: 'الإيجار (بدون فاتورة)' },
  { key: 'otherControllableCosts', en: 'Other controllable, not on invoices', ar: 'تكاليف أخرى (بدون فاتورة)' },
  { key: 'interest', en: 'Interest', ar: 'الفوائد' },
  { key: 'depreciation', en: 'Depreciation', ar: 'الإهلاك' },
];

// Pillar 4: the template's financial KPIs for a business month, each against its healthy range.
// Sales and recipe costs come from the till, losses from the stock ledger, expenses from the
// month's posted purchase invoices; wages, hours and what is paid without an invoice are entered
// here. A KPI missing what it needs says so, never 0. With several branches, one branch's P&L or
// the company's as a whole (consolidated), chosen by one who works every branch, with what the
// branches sold and bought each other taken out, and the table by branch.
@Component({
  selector: 'app-kpis-page',
  imports: [
    DecimalPipe,
    FormsModule,
    InfoTip,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
    MoneyPipe,
    RouterLink,
  ],
  template: `
    <div class="toolbar">
      <mat-form-field subscriptSizing="dynamic">
        <mat-label>Month · الشهر</mat-label>
        <input matInput type="month" [ngModel]="month()" (ngModelChange)="pick($event)" [max]="thisMonth" />
      </mat-form-field>
      @if (scope()?.canChoose) {
        <mat-form-field subscriptSizing="dynamic" class="scope-pick">
          <mat-label>P&amp;L for · قائمة الدخل لـ</mat-label>
          <mat-select [value]="branch() ?? ''" (selectionChange)="pickBranch($event.value || null)">
            <mat-option value="">The company as a whole · الشركة ككل</mat-option>
            @for (b of scope()!.branches; track b.id) {
              <mat-option [value]="b.id">{{ b.name }}{{ b.nameAr ? ' · ' + b.nameAr : '' }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <app-info-tip tip="pnlScope" />
      }
      <span class="spacer"></span>
      <button mat-button (click)="print()" [disabled]="!report()"><mat-icon>print</mat-icon> Print</button>
    </div>
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    @if (error()) {
      <p class="error">{{ error() }}</p>
    } @else if (report(); as r) {
      <header class="report-head">
        <h2>
          Financial KPIs <span class="inline-ar">مؤشرات الأداء المالية</span>
          @switch (r.scope?.view) {
            @case ('Branch') {
              <span class="scope-chip">{{ r.scope!.branch }}{{ r.scope!.branchAr ? ' · ' + r.scope!.branchAr : '' }}</span>
            }
            @case ('Consolidated') {
              <span class="scope-chip">The company as a whole · الشركة ككل</span>
            }
          }
        </h2>
        <div class="muted">
          From<span class="inline-ar">من</span>: <strong>{{ r.from }}</strong> &nbsp; To<span class="inline-ar">إلى</span>:
          <strong>{{ r.to }}</strong> &nbsp;·&nbsp; {{ r.statement.takingsDays ?? 0 }} {{ r.statement.takingsDays === 1 ? 'day' : 'days' }} of takings
          entered<span class="inline-ar">أيام الإيراد المسجلة</span>
        </div>
      </header>

      <div class="kpis">
        @for (k of r.kpis; track k.key) {
          <div class="kpi" [class]="tone(k)">
            <div class="name">
              {{ labels[k.key].en }} <app-info-tip [tip]="kpiTips[k.key]" />
              <span class="ar">{{ labels[k.key].ar }}</span>
            </div>
            @if (k.value !== null) {
              <strong class="value">
                {{ labels[k.key].money ? (k.value | money) : (k.value | number: '1.1-1') + '%' }}
              </strong>
            } @else {
              <strong class="value muted">—</strong>
            }
            <div class="status">
              @switch (k.status) {
                @case ('Healthy') {
                  Healthy · صحي
                }
                @case ('Above') {
                  Above the healthy range · أعلى من المعدل
                }
                @case ('Below') {
                  Below the healthy range · أقل من المعدل
                }
                @case ('NoRange') {
                  Depends on the restaurant · يختلف
                }
                @default {
                  {{ k.missing }}
                }
              }
            </div>
            @if (k.healthyFrom !== null) {
              <div class="range muted">Healthy<span class="inline-ar">المعدل الصحي</span>: {{ k.healthyFrom }}–{{ k.healthyTo }}%</div>
            }
            @if (k.key === 'FoodCost' && k.value !== null) {
              <div class="range muted">
                Recipes {{ share(r.statement.foodRecipeCost, r.statement.foodSales) | number: '1.1-1' }}% + losses
                {{ share(lossTotal(r), r.statement.foodSales) | number: '1.1-1' }}%
              </div>
            }
            @if (tone(k) === 'check') {
              <div class="range">{{ lowHint(k) }}</div>
            }
          </div>
        }
      </div>

      @if (r.discounts; as d) {
        <section class="discount-impact" aria-label="Promos and discount impact">
          <h3>Promos &amp; discount impact <span class="inline-ar">أثر الخصومات والعروض</span></h3>
          <div class="tiles">
            <div class="tile">
              <span class="label">Total discounts · إجمالي الخصومات <app-info-tip tip="deDiscounts" /></span>
              <strong>{{ d.discounts | money }}</strong>
              <small class="chip">
                {{ d.discountSharePercent === null ? 'no sales yet' : (d.discountSharePercent | number: '1.1-1') + '% of standard gross ' + (d.standardGrossRevenue | money) }}
              </small>
            </div>
            <div class="tile erosion" [class]="erosionTone(d.erosionPoints)">
              <span class="label">Standard vs actual food cost · التكلفة القياسية مقابل الفعلية <app-info-tip tip="deErosion" /></span>
              <div class="pair">
                <div>
                  <small class="muted">Standard <app-info-tip tip="deStandard" /></small>
                  <strong>{{ d.standardFoodCostPercent === null ? '—' : (d.standardFoodCostPercent | number: '1.1-1') + '%' }}</strong>
                </div>
                <mat-icon aria-hidden="true">arrow_forward</mat-icon>
                <div>
                  <small class="muted">Actual <app-info-tip tip="deActual" /></small>
                  <strong>{{ d.actualFoodCostPercent === null ? '—' : (d.actualFoodCostPercent | number: '1.1-1') + '%' }}</strong>
                </div>
              </div>
              @if (d.erosionPoints !== null && d.erosionPoints > 0) {
                <span class="erosion-badge">
                  <mat-icon aria-hidden="true">{{ d.erosionPoints >= 5 ? 'error' : 'warning' }}</mat-icon>
                  +{{ d.erosionPoints | number: '1.1-1' }} pts erosion · تآكل
                </span>
              } @else {
                <small class="muted">No erosion · لا يوجد تآكل</small>
              }
            </div>
            <div class="tile reasons">
              <span class="label">Top discount reasons · أهم الأسباب <app-info-tip tip="deReasons" /></span>
              @for (reason of d.reasons.slice(0, 5); track reason.reason) {
                <div class="reason">
                  <span class="name">{{ reason.reason }}</span>
                  <span class="bar" aria-hidden="true"><span [style.width.%]="barOf(reason.amount, d)"></span></span>
                  <span class="figure">{{ reason.amount ? (reason.amount | money) : '—' }}{{ reason.count ? ' · ' + reason.count + '×' : '' }}</span>
                </div>
              } @empty {
                <small class="muted">{{ d.discounts ? 'No reasons given · لا أسباب' : 'No discounts this month · لا خصومات' }}</small>
              }
            </div>
          </div>
        </section>
      }

      @if (r.itemsWithoutRecipe > 0) {
        <p class="note warn">
          {{ r.itemsWithoutRecipe }} {{ r.itemsWithoutRecipe === 1 ? 'dish' : 'dishes' }} sold this month {{ r.itemsWithoutRecipe === 1 ? 'has' : 'have' }} no recipe
          ({{ r.salesWithoutRecipe | money }} of sales): their ingredients are not in the costs, so the cost % reads low.
          <a routerLink="/costing/recipes">Recipes</a>
        </p>
      }
      @if (r.beverageCategories.length === 0) {
        <p class="note">Every sale counts as food until the drinks categories are marked in <a routerLink="/costing/settings">Settings</a>.</p>
      }

      <div class="columns">
        <section>
          <h3>The month <span class="inline-ar">قائمة الدخل</span> <app-info-tip tip="incomeStatement" /></h3>
          <div class="table-wrap">
            <table class="grid statement">
              <tbody>
                <tr class="takings">
                  <td>Gross takings · إجمالي الإيراد <span class="muted small">cash {{ r.statement.cashTakings ?? 0 | money }} + Visa {{ r.statement.cardTakings ?? 0 | money }} + tax {{ r.statement.taxCollected ?? 0 | money }}</span></td>
                  <td class="num">{{ r.statement.grossTakings ?? 0 | money }}</td>
                  <td></td>
                </tr>
                <tr class="takings tax">
                  <td>Less tax collected · الضريبة المحصلة <span class="muted small">owed, not revenue</span></td>
                  <td class="num">({{ r.statement.taxCollected ?? 0 | money }})</td>
                  <td></td>
                </tr>
                <tr><td>Food sales · مبيعات الطعام</td><td class="num">{{ r.statement.foodSales | money }}</td><td class="num muted"></td></tr>
                <tr><td>Beverage sales · مبيعات المشروبات</td><td class="num">{{ r.statement.beverageSales | money }}</td><td></td></tr>
                @if (r.statement.deliveryFees) {
                  <tr><td>Delivery fees · رسوم التوصيل</td><td class="num">{{ r.statement.deliveryFees | money }}</td><td></td></tr>
                }
                @if (r.statement.interBranchSales) {
                  <tr class="inter-branch">
                    <td>Inter-branch sales · مبيعات داخلية للفروع <app-info-tip tip="pnlInterBranchSales" /></td>
                    <td class="num">{{ r.statement.interBranchSales | money }}</td>
                    <td class="num muted">{{ pct(r.statement.interBranchSales, r) }}</td>
                  </tr>
                }
                <tr class="total"><td>Revenue (net sales) · صافي المبيعات</td><td class="num">{{ r.statement.revenue | money }}</td><td class="num">100%</td></tr>
                <tr><td>Food cost · تكلفة الطعام</td><td class="num">{{ r.statement.foodRecipeCost | money }}</td><td class="num muted">{{ pct(r.statement.foodRecipeCost, r) }}</td></tr>
                <tr><td>Beverage cost · تكلفة المشروبات</td><td class="num">{{ r.statement.beverageRecipeCost | money }}</td><td class="num muted">{{ pct(r.statement.beverageRecipeCost, r) }}</td></tr>
                <tr><td>Kitchen waste · هالك المطبخ</td><td class="num">{{ r.statement.kitchenWaste | money }}</td><td class="num muted">{{ pct(r.statement.kitchenWaste, r) }}</td></tr>
                <tr><td>Spoilage · الهالك المسجل</td><td class="num">{{ r.statement.spoilage | money }}</td><td class="num muted">{{ pct(r.statement.spoilage, r) }}</td></tr>
                <tr><td>Count differences · فروق الجرد</td><td class="num">{{ r.statement.countDifferences | money }}</td><td class="num muted">{{ pct(r.statement.countDifferences, r) }}</td></tr>
                @if (r.statement.interBranchCostOfGoods) {
                  <tr class="inter-branch">
                    <td>Cost of goods sent to branches · تكلفة البضاعة المحولة للفروع <app-info-tip tip="pnlCostOfGoodsSent" /></td>
                    <td class="num">{{ r.statement.interBranchCostOfGoods | money }}</td>
                    <td class="num muted">{{ pct(r.statement.interBranchCostOfGoods, r) }}</td>
                  </tr>
                }
                @if (r.statement.transitLosses) {
                  <tr class="inter-branch">
                    <td>Transit losses · عجز النقل بين الفروع <app-info-tip tip="pnlTransitLosses" /></td>
                    <td class="num">{{ r.statement.transitLosses | money }}</td>
                    <td class="num muted">{{ pct(r.statement.transitLosses, r) }}</td>
                  </tr>
                }
                <tr class="total"><td>Cost of sales · تكلفة المبيعات</td><td class="num">{{ r.statement.costOfSales | money }}</td><td class="num">{{ pct(r.statement.costOfSales, r) }}</td></tr>
                <tr class="total"><td>Gross profit · الربح الإجمالي</td><td class="num">{{ r.statement.grossProfit | money }}</td><td class="num">{{ pct(r.statement.grossProfit, r) }}</td></tr>
                <tr>
                  <td>
                    Wages and benefits · الرواتب
                    @if (r.statement.loggedWages) {
                      <small class="muted part">{{ parts(r.statement.wagesAndBenefits, r.statement.loggedWages) }}</small>
                    }
                    @if (r.scope?.view === 'Branch' && r.companyCosts?.payroll !== null && r.companyCosts?.payroll !== undefined) {
                      <small class="muted part">The payroll from HR is the company's · ضمن مسير رواتب الشركة</small>
                    }
                  </td>
                  <td class="num">{{ combined(r.statement.wagesAndBenefits, r.statement.loggedWages) }}</td>
                  <td class="num muted">{{ pct(sum(r.statement.wagesAndBenefits, r.statement.loggedWages), r) }}</td>
                </tr>
                @if (r.statement.staffMeals) {
                  <tr class="staff-meals">
                    <td>Staff meals · وجبات العاملين <small class="muted part">a staff benefit, in the labor cost</small> <app-info-tip tip="smStaff" /></td>
                    <td class="num">{{ r.statement.staffMeals | money }}</td>
                    <td class="num muted">{{ pct(r.statement.staffMeals, r) }}</td>
                  </tr>
                }
                <tr>
                  <td>
                    Rent and occupation · الإيجار
                    @if (r.statement.loggedOccupationCost) {
                      <small class="muted part">{{ parts(r.statement.occupationCost, r.statement.loggedOccupationCost) }}</small>
                    }
                  </td>
                  <td class="num">{{ combined(r.statement.occupationCost, r.statement.loggedOccupationCost) }}</td>
                  <td class="num muted">{{ pct(sum(r.statement.occupationCost, r.statement.loggedOccupationCost), r) }}</td>
                </tr>
                <tr>
                  <td>
                    Controllable costs · تكاليف قابلة للتحكم
                    @if (r.statement.loggedControllableCosts) {
                      <small class="muted part">{{ parts(r.statement.otherControllableCosts, r.statement.loggedControllableCosts) }}</small>
                    }
                  </td>
                  <td class="num">{{ combined(r.statement.otherControllableCosts, r.statement.loggedControllableCosts) }}</td>
                  <td class="num muted">{{ pct(sum(r.statement.otherControllableCosts, r.statement.loggedControllableCosts), r) }}</td>
                </tr>
                @if (r.statement.hospitality) {
                  <tr>
                    <td>Hospitality · الضيافة والإكراميات <app-info-tip tip="smHospitality" /></td>
                    <td class="num">{{ r.statement.hospitality | money }}</td>
                    <td class="num muted">{{ pct(r.statement.hospitality, r) }}</td>
                  </tr>
                }
                @if (r.statement.recipeTasting) {
                  <tr>
                    <td>Recipe tastings · تجارب الوصفات</td>
                    <td class="num">{{ r.statement.recipeTasting | money }}</td>
                    <td class="num muted">{{ pct(r.statement.recipeTasting, r) }}</td>
                  </tr>
                }
                @if (r.statement.loggedOtherFixedCosts) {
                  <tr>
                    <td>Other fixed costs · تكاليف ثابتة أخرى <small class="muted part">from invoices</small></td>
                    <td class="num">{{ r.statement.loggedOtherFixedCosts | money }}</td>
                    <td class="num muted">{{ pct(r.statement.loggedOtherFixedCosts, r) }}</td>
                  </tr>
                }
                <tr class="total">
                  <td>Operating expenses · المصروفات التشغيلية</td>
                  <td class="num">{{ operating(r) | money }}</td>
                  <td class="num">{{ pct(operating(r), r) }}</td>
                </tr>
                <tr class="total ebitda" [class.loss]="(ebitda(r) ?? 0) < 0">
                  <td>EBITDA · الربح التشغيلي قبل الفوائد والضرائب والإهلاك <app-info-tip tip="plEbitda" /></td>
                  <td class="num">{{ ebitda(r) === null ? 'Enter the wages' : (ebitda(r)! | money) }}</td>
                  <td class="num">{{ pct(ebitda(r), r) }}</td>
                </tr>
                <tr><td>Interest · الفوائد</td><td class="num">{{ entered(r.statement.interest) }}</td><td class="num muted">{{ pct(r.statement.interest, r) }}</td></tr>
                <tr class="depreciation">
                  <td>
                    Depreciation expense · إهلاك الأصول الثابتة <app-info-tip tip="plDepreciation" />
                    @if (r.statement.assetDepreciation) {
                      <small class="muted part">
                        <a routerLink="/costing/financials/fixed-assets">fixed assets</a> {{ r.statement.assetDepreciation | money }}
                        @if (r.statement.depreciation) {
                          + {{ r.statement.depreciation | money }} entered
                        }
                      </small>
                    }
                  </td>
                  <td class="num">{{ entered(depreciation(r)) }}</td>
                  <td class="num muted">{{ pct(depreciation(r), r) }}</td>
                </tr>
                @if (r.statement.disposalGainOrLoss) {
                  <tr [class.loss]="r.statement.disposalGainOrLoss < 0">
                    <td>Gain / (loss) on asset disposals · أرباح / (خسائر) استبعاد الأصول</td>
                    <td class="num">{{ r.statement.disposalGainOrLoss | money }}</td>
                    <td class="num muted">{{ pct(r.statement.disposalGainOrLoss, r) }}</td>
                  </tr>
                }
                <tr class="total" [class.loss]="(r.statement.netProfit ?? 0) < 0">
                  <td>Net profit · صافي الربح النهائي <app-info-tip tip="plNetProfit" /></td>
                  <td class="num">{{ r.statement.netProfit === null ? 'Enter the wages' : (r.statement.netProfit | money) }}</td>
                  <td class="num">{{ pct(r.statement.netProfit, r) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          @if (r.statement.voids) {
            <p class="note small">Voids and refunds on the days: {{ r.statement.voids | money }}, already out of the takings.</p>
          }
          @if (r.scope?.view === 'Branch' && r.interBranch?.purchases) {
            <p class="note small bought">
              Bought from other branches · مشتريات من الفروع: <strong>{{ r.interBranch!.purchases | money }}</strong> on
              {{ r.interBranch!.receipts }} internal purchase {{ r.interBranch!.receipts === 1 ? 'invoice' : 'invoices' }}, into the stock: their cost comes into
              the P&amp;L as the goods are used.
              <a routerLink="/costing/inter-branch" [queryParams]="{ tab: 'receipts' }">Hub →</a>
            </p>
          }
          @if (r.scope?.view === 'Branch' && companyCostsTotal(r); as total) {
            <p class="note small company-costs">
              Not in a branch's P&amp;L · خارج قائمة الفرع: the company's own costs,
              @if (r.companyCosts!.payroll !== null) {
                payroll from HR {{ r.companyCosts!.payroll! | money }},
              }
              @if (r.companyCosts!.assetDepreciation) {
                the fixed assets' depreciation {{ r.companyCosts!.assetDepreciation | money }},
              }
              on the consolidated P&amp;L. <app-info-tip tip="pnlCompanyCosts" />
            </p>
          }
          @if (r.statement.loggedExpenses?.length) {
            <div class="logged">
              <strong>From purchase invoices · من فواتير المشتريات</strong>
              @for (e of r.statement.loggedExpenses; track e.categoryId) {
                <div class="logged-row">
                  <span>{{ e.category }} <span class="muted">· {{ lineLabels[e.expenseLine].en }}</span></span>
                  <span class="num">{{ e.amount | money }}</span>
                </div>
              }
              <a routerLink="/costing/reports/spending" class="small">Spending analysis →</a>
            </div>
          }
        </section>

        <section class="no-print">
          <h3>Monthly costs <span class="inline-ar">التكاليف الشهرية</span></h3>
          <p class="note small">
            What {{ monthName() }} cost beyond its ingredients and its purchase invoices. Leave a figure empty until it is known. Expenses
            posted on purchase invoices (bills, cleaning, repairs) are added on their own: do not type them here too.
          </p>
          @switch (r.scope?.view) {
            @case ('Branch') {
              <p class="note small scope-note">{{ r.scope!.branch }}'s own · تكاليف الفرع</p>
            }
            @case ('Consolidated') {
              <p class="note small scope-note">Every branch's added up · مجموع الفروع: each branch's are entered on its own P&amp;L.</p>
            }
          }
          <div class="expenses">
            @for (f of fields; track f.key) {
              <mat-form-field subscriptSizing="dynamic" floatLabel="always">
                <mat-label>{{ f.en }} · {{ f.ar }}</mat-label>
                @if (!f.hours) {
                  <span matTextPrefix>{{ company.currency() }}&nbsp;</span>
                }
                <input matInput type="number" min="0" step="any" [ngModel]="draft()[f.key]" (ngModelChange)="set(f.key, $event)" [disabled]="!canEdit()" />
                @if (f.hours) {
                  <span matTextSuffix>&nbsp;h</span>
                }
              </mat-form-field>
            }
          </div>
          @if (canEdit()) {
            <div class="toolbar">
              <span class="muted small">
                @if (r.expenses.updatedBy) {
                  Last saved by {{ r.expenses.updatedBy }}.
                }
              </span>
              <span class="spacer"></span>
              <button mat-flat-button (click)="saveExpenses()" [disabled]="saving() || !changed()">Save the month's costs</button>
            </div>
          }
        </section>
      </div>

      @if (r.eliminations; as e) {
        <section class="eliminations" aria-label="Eliminations between branches">
          <h3>Eliminations between branches <span class="inline-ar">الاستبعادات بين الفروع</span> <app-info-tip tip="pnlEliminations" /></h3>
          <div class="table-wrap">
            <table class="grid statement">
              <tbody>
                <tr>
                  <td>Inter-branch sales, out of the revenue · استبعاد المبيعات بين الفروع</td>
                  <td class="num">({{ e.interBranchSales | money }})</td>
                </tr>
                <tr class="total">
                  <td>Inter-branch purchases, out of the costs · استبعاد المشتريات بين الفروع</td>
                  <td class="num">({{ e.interBranchPurchases | money }})</td>
                </tr>
                <tr>
                  <td class="sub">What the goods cost the sending branch · تكلفة البضاعة على الفرع المرسل</td>
                  <td class="num">({{ e.costOfGoodsSent | money }})</td>
                </tr>
                <tr>
                  <td class="sub">Markup in what the branches sold, lost or never received · الهامش الداخلي في تكلفة المبيعات</td>
                  <td class="num">({{ e.markupInCostOfSales | money }})</td>
                </tr>
                @if (e.markupInExpenses) {
                  <tr>
                    <td class="sub">Markup in staff meals and hospitality · الهامش الداخلي في المصروفات</td>
                    <td class="num">({{ e.markupInExpenses | money }})</td>
                  </tr>
                }
                <tr class="total" [class.loss]="e.grossProfit < 0">
                  <td>On the gross profit · الأثر على مجمل الربح</td>
                  <td class="num">{{ e.grossProfit | money }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      }

      @if (r.columns?.length) {
        <section class="by-branch" aria-label="By branch">
          <h3>By branch <span class="inline-ar">حسب الفرع</span> <app-info-tip tip="pnlByBranch" /></h3>
          <div class="table-wrap">
            <table class="grid">
              <thead>
                <tr>
                  <th></th>
                  @for (c of r.columns; track c.kind + (c.branchId ?? '')) {
                    <th class="num" [class]="'col-' + c.kind">
                      @if (c.kind === 'Branch' && r.scope?.canChoose) {
                        <button mat-button class="open-branch" (click)="pickBranch(c.branchId)" [attr.aria-label]="openLabel(c)">{{ c.name }}</button>
                      } @else {
                        {{ c.name }}
                      }
                      <span class="ar">{{ c.nameAr }}</span>
                    </th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (row of columnRows; track row.key) {
                  <tr [class.total]="row.total">
                    <td>{{ row.en }}<span class="ar">{{ row.ar }}</span></td>
                    @for (c of r.columns; track c.kind + (c.branchId ?? '')) {
                      <td class="num" [class]="'col-' + c.kind" [class.loss]="(c[row.key] ?? 0) < 0">{{ c[row.key] === null ? '—' : (c[row.key]! | money) }}</td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      }

      <h3 class="items-head">
        Item profitability <span class="inline-ar">ربحية العنصر</span> <app-info-tip tip="dishProfit" />
        @if (canSeeBurdened) {
          <a mat-button class="burdened-link" routerLink="/costing/intelligence/burdened">
            <mat-icon>layers</mat-icon> With labor &amp; overheads: burdened plate cost <span class="inline-ar">التكلفة الكلية للطبق</span>
          </a>
        }
      </h3>
      <div class="table-wrap">
        <table class="grid">
          <thead>
            <tr>
              <th>Item code<span class="ar">كود الصنف</span></th>
              <th>Menu item<span class="ar">صنف المنيو</span></th>
              <th class="num">Sold<span class="ar">المباع</span></th>
              <th class="num">Net sales<span class="ar">صافي المبيعات</span></th>
              <th class="num">Ingredient cost<span class="ar">تكلفة المكونات</span></th>
              <th class="num">Profit<span class="ar">الربح</span></th>
              <th class="num">Profit per item<span class="ar">ربح الوحدة</span></th>
              <th class="num">Margin <app-info-tip tip="dishProfit" /><span class="ar">الهامش</span></th>
            </tr>
          </thead>
          <tbody>
            @for (item of r.items; track item.itemCode; let i = $index) {
              <tr [class.top]="i < 3 && item.profit !== null && item.profit > 0">
                <td class="code">{{ item.itemCode }}</td>
                <td>
                  {{ item.menuItem }}
                  @if (item.beverage) {
                    <small class="muted"> · drink</small>
                  }
                  @if (item.menuItemAr) {
                    <span class="ar">{{ item.menuItemAr }}</span>
                  }
                </td>
                <td class="num">{{ item.quantitySold }}</td>
                <td class="num">{{ item.netSales | money }}</td>
                <td class="num">{{ item.cost === null ? 'No recipe' : (item.cost | money) }}</td>
                <td class="num strong">{{ item.profit === null ? '—' : (item.profit | money) }}</td>
                <td class="num">{{ item.profitPerUnit === null ? '—' : (item.profitPerUnit | money) }}</td>
                <td class="num">{{ item.marginPercent === null ? '—' : (item.marginPercent | number: '1.1-1') + '%' }}</td>
              </tr>
            } @empty {
              <tr><td colspan="8" class="muted">Nothing was sold this month.</td></tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
  styleUrl: './costing.scss',
  styles: `
    .report-head {
      margin-bottom: 12px;

      h2 {
        margin: 0 0 4px;
        font: var(--mat-sys-title-large);
      }
    }
    h3 {
      margin: 20px 0 8px;
      font: var(--mat-sys-title-medium);
    }
    .kpis {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
      gap: 10px;
    }
    .kpi {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 12px;
      border-radius: 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface);

      .name {
        font: var(--mat-sys-title-small);
      }
      .value {
        font: var(--mat-sys-headline-small);
      }
      // A sentence of what is missing wraps in its card (the old status chip is one line).
      .status {
        font: var(--mat-sys-label-large);
        white-space: normal;
      }
      .range {
        font: var(--mat-sys-body-small);
      }
      &.ok {
        border-color: var(--app-ok);
        background: color-mix(in srgb, var(--app-ok) 10%, var(--mat-sys-surface));
      }
      &.bad {
        border-color: var(--mat-sys-error);
        background: color-mix(in srgb, var(--mat-sys-error) 9%, var(--mat-sys-surface));

        .value,
        .status {
          color: var(--mat-sys-error);
        }
      }
      &.check {
        border-color: #b26a00;
        background: color-mix(in srgb, #f5a623 12%, var(--mat-sys-surface));
      }
    }
    .columns {
      display: grid;
      grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
      gap: 16px;
    }
    @media (max-width: 900px) {
      .columns {
        grid-template-columns: 1fr;
      }
    }
    .discount-impact {
      margin: 8px 0 16px;

      h3 {
        margin: 0 0 8px;
        font: var(--mat-sys-title-small);
      }
      .tiles {
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      }
      .chip {
        justify-self: start;
        padding: 0 8px;
        border-radius: 999px;
        font: var(--mat-sys-label-small);
        background: var(--mat-sys-surface-container-high);
      }
      .pair {
        display: flex;
        align-items: center;
        gap: 12px;

        div {
          display: grid;
        }
      }
      .erosion-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        justify-self: start;
        padding: 0 8px;
        border-radius: 999px;
        font: var(--mat-sys-label-medium);
        line-height: 24px;

        mat-icon {
          width: 16px;
          height: 16px;
          font-size: 16px;
        }
      }
      .tile.amber {
        border-color: color-mix(in srgb, var(--app-warn) 55%, transparent);
        .erosion-badge {
          background: color-mix(in srgb, var(--app-warn) 16%, transparent);
          color: var(--app-warn);
        }
      }
      .tile.red {
        border-color: color-mix(in srgb, var(--mat-sys-error) 55%, transparent);
        .erosion-badge {
          background: color-mix(in srgb, var(--mat-sys-error) 12%, transparent);
          color: var(--mat-sys-error);
        }
      }
      .reason {
        display: grid;
        grid-template-columns: minmax(80px, 1fr) 2fr auto;
        align-items: center;
        gap: 8px;
        font: var(--mat-sys-body-small);
      }
      .bar {
        height: 8px;
        border-radius: 4px;
        background: var(--mat-sys-surface-container-high);
        overflow: hidden;

        span {
          display: block;
          height: 100%;
          border-radius: 4px;
          background: #2563eb;
        }
      }
      .figure {
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
    }
    .statement tr.takings td {
      color: var(--mat-sys-on-surface-variant);
    }
    .statement .small {
      font-size: 0.85em;
    }
    .statement tr.total td {
      font-weight: 600;
      background: var(--mat-sys-surface-container-low);
    }
    .statement tr.loss td {
      color: var(--mat-sys-error);
    }
    .part {
      display: block;
      font-weight: 400;
    }
    .logged {
      display: grid;
      gap: 4px;
      padding: 10px 12px;
      margin-bottom: 12px;
      border-radius: 12px;
      border: 1px solid var(--mat-sys-outline-variant);
    }
    .logged-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
    }
    .expenses {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
      gap: 10px;
      margin-bottom: 8px;
      // A long label, floated small, keeps its full width's box: not the page's to scroll.
      overflow-x: clip;
    }
    tr.top td {
      background: color-mix(in srgb, var(--app-ok) 10%, var(--mat-sys-surface));
    }
    .strong {
      font-weight: 600;
    }
    .small {
      font: var(--mat-sys-body-small);
    }
    .warn {
      color: var(--mat-sys-on-surface);
    }
    .scope-pick {
      min-width: 220px;
    }
    .scope-chip {
      display: inline-block;
      margin-inline-start: 8px;
      padding: 0 10px;
      border-radius: 999px;
      font: var(--mat-sys-label-large);
      line-height: 28px;
      vertical-align: middle;
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
    }
    .statement tr.inter-branch td:first-child {
      color: var(--mat-sys-on-surface);
    }
    .statement td.sub {
      padding-inline-start: 24px;
      color: var(--mat-sys-on-surface-variant);
    }
    .eliminations,
    .by-branch {
      margin-top: 8px;
    }
    .by-branch th.col-Consolidated,
    .by-branch td.col-Consolidated {
      font-weight: 600;
      background: var(--mat-sys-surface-container-low);
    }
    .by-branch th.col-Eliminations,
    .by-branch td.col-Eliminations,
    .by-branch th.col-CompanyCosts,
    .by-branch td.col-CompanyCosts {
      color: var(--mat-sys-on-surface-variant);
    }
    .by-branch td.loss {
      color: var(--mat-sys-error);
    }
    .open-branch {
      min-width: 0;
      padding: 0 4px;
      height: auto;
      line-height: inherit;
      font: inherit;
      font-weight: 600;
    }
  `,
})
export class KpisPage {
  protected readonly company = inject(Company);
  private readonly api = inject(CostingApi);
  private readonly auth = inject(AuthService);
  // Each dish's food against its labor and overheads too: the burdened plate cost, for whoever works the intelligence tab.
  protected readonly canSeeBurdened = inject(CostingAccess).has('Intelligence');
  private readonly notify = inject(NotifyService);

  protected readonly labels = kpiLabels;
  protected readonly kpiTips = kpiTips;
  protected readonly fields = expenseFields;
  protected readonly columnRows = columnRows;
  // The company's as a whole adds up the branches' costs: they are entered on each branch's own.
  protected readonly canEdit = computed(() => this.auth.can(Permissions.InventoryManage) && this.report()?.scope?.view !== 'Consolidated');
  protected readonly thisMonth = KpisPage.monthOf(new Date());

  protected readonly month = signal(this.thisMonth);
  // The branch whose P&L is read; none: the company's (as a whole, with several).
  protected readonly branch = signal<string | null>(null);
  // Whose it is, kept while the next loads so the choice stays on screen.
  protected readonly scope = signal<PnlScope | null>(null);
  protected readonly report = signal<KpiReport | null>(null);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly draft = signal<MonthlyExpenses>(KpisPage.blank());

  protected readonly changed = computed(() => {
    const saved = this.report()?.expenses;
    const draft = this.draft();
    return !!saved && expenseFields.some((f) => (saved[f.key] ?? null) !== (draft[f.key] ?? null));
  });

  protected readonly monthName = computed(() => {
    const [year, month] = this.month().split('-').map(Number);
    return new Date(year, month - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  });

  constructor() {
    effect(() => {
      const month = this.month();
      const branch = this.branch();
      untracked(() => void this.load(month, branch));
    });
  }

  // Green in range; red on the side that hurts (a cost above, a margin below); amber on the
  // other side of a cost, which more often means a recipe or a price is missing than a windfall.
  protected tone(kpi: Kpi): Tone {
    switch (kpi.status) {
      case 'Healthy':
        return 'ok';
      case 'Above':
        return kpi.highIsBad ? 'bad' : 'ok';
      case 'Below':
        return kpi.highIsBad ? 'check' : 'bad';
      default:
        return 'none';
    }
  }

  // Under the range on a cost: more often something left out than a saving.
  protected lowHint(kpi: Kpi): string {
    return kpi.key === 'LabourCost'
      ? 'Low: check every wage and benefit is entered.'
      : 'Low: check every dish has a recipe and every material a price.';
  }

  protected lossTotal(r: KpiReport): number {
    return r.statement.kitchenWaste + r.statement.spoilage + r.statement.countDifferences;
  }

  // Below the gross profit: what it costs to run the place, every overhead but interest and
  // depreciation; and EBITDA, the gross profit less it, once the wages are in.
  protected operating(r: KpiReport): number {
    return r.statement.operatingExpenses ?? r.statement.totalExpenses - (r.statement.interest ?? 0) - (r.statement.depreciation ?? 0);
  }

  protected ebitda(r: KpiReport): number | null {
    return r.statement.ebitda !== undefined ? r.statement.ebitda : r.statement.netProfit === null ? null : r.statement.grossProfit - this.operating(r);
  }

  // The fixed assets register's and any entered: null when neither is.
  protected depreciation(r: KpiReport): number | null {
    const total = r.statement.depreciationExpense;
    if (total === undefined) {
      return r.statement.depreciation;
    }
    return total === 0 && r.statement.depreciation === null ? null : total;
  }


  protected share(part: number, whole: number): number | null {
    return whole > 0 ? (part / whole) * 100 : null;
  }

  // The erosion's badge: amber under 5 points, red from 5.
  protected erosionTone(points: number | null): string {
    return points === null || points <= 0 ? '' : points >= 5 ? 'red' : 'amber';
  }

  // A reason's bar: its share of the largest reason's amount.
  protected barOf(amount: number, impact: DiscountImpact): number {
    const largest = Math.max(...impact.reasons.map((r) => r.amount), 0);
    return largest > 0 ? Math.max(2, (amount / largest) * 100) : 0;
  }

  // As a share of revenue, for the statement's last column.
  protected pct(value: number | null, r: KpiReport): string {
    return value === null || r.statement.revenue <= 0 ? '' : `${((value / r.statement.revenue) * 100).toFixed(1)}%`;
  }

  protected readonly lineLabels = expenseLineLabels;

  protected sum(typed: number | null, logged: number): number | null {
    return typed === null && !logged ? null : (typed ?? 0) + logged;
  }

  // A line made of what was entered and what the invoices logged.
  protected combined(typed: number | null, logged: number): string {
    return this.entered(this.sum(typed, logged));
  }

  protected parts(typed: number | null, logged: number): string {
    const money = (v: number) => v.toLocaleString('en-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return typed ? `${money(logged)} invoices + ${money(typed)} entered` : `${money(logged)} from invoices`;
  }

  protected entered(value: number | null): string {
    return value === null ? 'Not entered' : this.company.money(value);
  }

  protected pick(month: string): void {
    if (/^\d{4}-\d{2}$/.test(month)) {
      this.month.set(month);
    }
  }

  protected pickBranch(id: string | null): void {
    this.branch.set(id);
  }

  protected openLabel(column: PnlColumn): string {
    return `Open ${column.name}’s P&L`;
  }

  // What the company has that a branch's P&L leaves out: HR's payroll and the fixed assets'.
  protected companyCostsTotal(r: KpiReport): number {
    return (r.companyCosts?.payroll ?? 0) + (r.companyCosts?.assetDepreciation ?? 0);
  }

  protected set(key: keyof MonthlyExpenses, value: number | string | null): void {
    const number = value === '' || value === null ? null : Number(value);
    this.draft.update((draft) => ({ ...draft, [key]: Number.isFinite(number) ? number : null }));
  }

  protected async saveExpenses(): Promise<void> {
    const [year, month] = this.month().split('-').map(Number);
    this.saving.set(true);
    try {
      const draft = this.draft();
      const scope = this.report()?.scope;
      await firstValueFrom(
        this.api.saveExpenses(
          year,
          month,
          Object.fromEntries(expenseFields.map((f) => [f.key, draft[f.key] ?? null])) as unknown as MonthlyExpenses,
          scope?.view === 'Branch' ? scope.branchId : null,
        ),
      );
      this.notify.info(`${this.monthName()}'s costs saved.`);
      await this.load(this.month(), this.branch());
    } catch (error) {
      this.notify.error(error, "The month's costs could not be saved.");
    } finally {
      this.saving.set(false);
    }
  }

  protected print(): void {
    window.print();
  }

  private async load(month: string, branch: string | null): Promise<void> {
    const [year, m] = month.split('-').map(Number);
    this.loading.set(true);
    this.error.set(null);
    try {
      const report = await firstValueFrom(this.api.kpis(year, m, branch));
      this.report.set(report);
      this.scope.set(report.scope ?? null);
      this.draft.set({ ...report.expenses });
    } catch (error) {
      this.report.set(null);
      this.error.set(errorMessage(error, 'The KPIs could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }

  private static blank(): MonthlyExpenses {
    return { wagesAndBenefits: null, labourHours: null, otherControllableCosts: null, occupationCost: null, interest: null, depreciation: null };
  }

  private static monthOf(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }
}
