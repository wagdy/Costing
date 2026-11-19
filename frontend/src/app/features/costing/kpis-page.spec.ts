import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { CostingApi, Kpi, KpiReport, PnlColumn } from '../../core/costing/costing.api';
import { NotifyService } from '../../core/ui/notify.service';
import { KpisPage } from './kpis-page';

const kpi = (key: Kpi['key'], value: number | null, status: Kpi['status'], range: [number, number] | null, highIsBad: boolean, missing: string | null = null): Kpi => ({
  key,
  value,
  healthyFrom: range?.[0] ?? null,
  healthyTo: range?.[1] ?? null,
  highIsBad,
  status,
  missing,
});

const report: KpiReport = {
  year: 2026,
  month: 10,
  from: '2026-10-01',
  to: '2026-10-31',
  beverageCategories: ['Drinks'],
  statement: {
    foodSales: 360,
    beverageSales: 60,
    deliveryFees: 0,
    revenue: 420,
    paidOrders: 2,
    foodRecipeCost: 75,
    beverageRecipeCost: 12,
    kitchenWaste: 25,
    spoilage: 10,
    countDifferences: 0,
    costOfSales: 122,
    grossProfit: 298,
    wagesAndBenefits: null,
    otherControllableCosts: null,
    occupationCost: null,
    interest: null,
    depreciation: null,
    netProfit: null,
    loggedControllableCosts: 0,
    loggedOccupationCost: 0,
    loggedOtherFixedCosts: 0,
    loggedExpenses: [],
    loggedWages: 0,
    totalExpenses: 0,
  },
  expenses: { wagesAndBenefits: null, labourHours: null, otherControllableCosts: null, occupationCost: null, interest: null, depreciation: null },
  kpis: [
    kpi('FoodCost', 30.6, 'Healthy', [28, 35], true),
    kpi('BeverageCost', 12, 'Below', [20, 25], true),
    kpi('LabourCost', null, 'Missing', [25, 35], true, "Enter the month's wages and benefits."),
    kpi('AverageCheck', 210, 'NoRange', null, false),
    kpi('GrossProfitMargin', 55, 'Below', [60, 70], false),
    kpi('NetProfitMargin', 20, 'Above', [5, 15], false),
  ],
  items: [],
  itemsWithoutRecipe: 0,
  salesWithoutRecipe: 0,
};

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

describe('the KPIs', () => {
  const kpis = vi.fn();
  const saveExpenses = vi.fn();

  async function render() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: CostingApi, useValue: { kpis, saveExpenses } },
        { provide: AuthService, useValue: { me: () => null, can: () => true } },
        { provide: NotifyService, useValue: { info: vi.fn(), error: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(KpisPage);
    await fixture.whenStable();
    fixture.detectChanges();
    const cards = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.kpi')];
    return { fixture, cards, page: fixture.componentInstance as unknown as Record<string, any> };
  }

  beforeEach(() => {
    kpis.mockReset().mockReturnValue(of(report));
    saveExpenses.mockReset().mockReturnValue(of(report.expenses));
  });

  it('colours each KPI by the side of its range that hurts', async () => {
    const { cards } = await render();

    const tones = cards.map((c) => ['ok', 'bad', 'check', 'none'].find((t) => c.classList.contains(t)));
    // Food in range; drinks suspiciously cheap; labour not entered; the check has no range;
    // gross margin too thin; net margin better than the range.
    expect(tones).toEqual(['ok', 'check', 'none', 'none', 'bad', 'ok']);
  });

  it('says what is missing rather than showing 0', async () => {
    const { cards } = await render();

    expect(cards[2].querySelector('.value')?.textContent?.trim()).toBe('—');
    expect(cards[2].textContent).toContain("Enter the month's wages and benefits.");
    expect(cards[0].textContent).toContain('Recipes 20.8% + losses 9.7%');
  });

  it("saves the month's costs whole, empty figures as not known", async () => {
    const { page } = await render();

    page['set']('wagesAndBenefits', 120);
    page['set']('labourHours', '10');
    page['set']('interest', '');
    await page['saveExpenses']();

    const [year, month] = (page['month']() as string).split('-').map(Number);
    expect(saveExpenses).toHaveBeenCalledWith(year, month, {
      wagesAndBenefits: 120,
      labourHours: 10,
      occupationCost: null,
      otherControllableCosts: null,
      interest: null,
      depreciation: null,
    }, null);
  });
  it('takes the expenses on purchase invoices off on their lines, with what is entered', async () => {
    kpis.mockReturnValue(
      of({
        ...report,
        statement: {
          ...report.statement,
          wagesAndBenefits: 100,
          otherControllableCosts: 20,
          loggedControllableCosts: 1_700,
          loggedOccupationCost: 8_000,
          loggedOtherFixedCosts: 600,
          loggedExpenses: [
            { categoryId: 'rent', category: 'Rent', categoryAr: null, expenseLine: 'Occupation', amount: 8_000 },
            { categoryId: 'utilities', category: 'Utilities', categoryAr: null, expenseLine: 'Controllable', amount: 1_700 },
            { categoryId: 'insurance', category: 'Insurance', categoryAr: null, expenseLine: 'OtherFixed', amount: 600 },
          ],
          totalExpenses: 10_420,
          operatingExpenses: 10_420,
          ebitda: -10_122,
          netProfit: -10_122,
        },
      }),
    );
    const { fixture } = await render();
    const el = fixture.nativeElement as HTMLElement;
    const row = (label: string) =>
      [...el.querySelectorAll('.statement tr')].find((r) => r.querySelector('td')!.textContent!.includes(label))!;
    const cells = (label: string) => [...row(label).querySelectorAll('td')].map((td) => td.textContent!.replace(/\s+/g, ' ').trim());

    expect(cells('Rent and occupation')).toEqual(['Rent and occupation · الإيجار 8,000.00 from invoices', 'L.E 8,000.00', '1904.8%']);
    expect(cells('Controllable costs')[0]).toContain('1,700.00 invoices + 20.00 entered');
    expect(cells('Controllable costs')[1]).toBe('L.E 1,720.00');
    expect(cells('Other fixed costs')[1]).toBe('L.E 600.00');
    expect(cells('Operating expenses')[1]).toBe('L.E 10,420.00');
    expect(cells('EBITDA')[1]).toBe('L.E -10,122.00');
    expect([...el.querySelectorAll('.logged-row')].map((r) => [...r.children].map((c) => c.textContent!.replace(/\s+/g, ' ').trim()))).toEqual([
      ['Rent · Occupation (rent)', 'L.E 8,000.00'],
      ['Utilities · Controllable costs', 'L.E 1,700.00'],
      ['Insurance · Other fixed costs', 'L.E 600.00'],
    ]);
  });

  it("sets EBITDA above the interest and the fixed assets' depreciation, then the disposals, then the net profit", async () => {
    kpis.mockReturnValue(
      of({
        ...report,
        statement: {
          ...report.statement,
          wagesAndBenefits: 100,
          interest: 10,
          operatingExpenses: 100,
          ebitda: 198,
          assetDepreciation: 50,
          depreciationExpense: 50,
          disposalGainOrLoss: -20,
          totalExpenses: 160,
          netProfit: 118,
        },
      }),
    );
    const { fixture } = await render();
    const el = fixture.nativeElement as HTMLElement;
    const labels = [...el.querySelectorAll('.statement tr')].map((r) => r.querySelector('td')!.textContent!.replace(/\s+/g, ' ').trim());
    const from = labels.findIndex((l) => l.startsWith('Operating expenses'));
    expect(labels.slice(from).map((l) => l.split(' · ')[0])).toEqual([
      'Operating expenses', 'EBITDA', 'Interest', 'Depreciation expense', 'Gain / (loss) on asset disposals', 'Net profit',
    ]);
    const cells = (label: string) =>
      [...[...el.querySelectorAll('.statement tr')].find((r) => r.querySelector('td')!.textContent!.includes(label))!.querySelectorAll('td')].map(
        (td) => td.textContent!.replace(/\s+/g, ' ').trim(),
      );
    expect(cells('Depreciation expense')).toEqual(['Depreciation expense · إهلاك الأصول الثابتة fixed assets L.E 50.00', 'L.E 50.00', '11.9%']);
    expect(cells('EBITDA')[1]).toBe('L.E 198.00');
    expect(cells('Gain / (loss)')[1]).toBe('L.E -20.00');
    expect(cells('Net profit')[1]).toBe('L.E 118.00');
    expect(el.querySelector('.statement a[href="/costing/financials/fixed-assets"]')).not.toBeNull();
  });

  it('takes revenue from the takings as net sales, the tax collected shown apart and never in it', async () => {
    kpis.mockReturnValue(
      of({
        ...report,
        statement: { ...report.statement, cashTakings: 360, cardTakings: 60, grossTakings: 478.8, taxCollected: 58.8, voids: 25, takingsDays: 1 },
      }),
    );
    const { fixture } = await render();
    const el = fixture.nativeElement as HTMLElement;
    const cells = (label: string) =>
      [...[...el.querySelectorAll('.statement tr')].find((r) => r.querySelector('td')!.textContent!.includes(label))!.querySelectorAll('td')].map(
        (td) => td.textContent!.replace(/\s+/g, ' ').trim(),
      );

    expect(cells('Gross takings').slice(0, 2)).toEqual(['Gross takings · إجمالي الإيراد cash L.E 360.00 + Visa L.E 60.00 + tax L.E 58.80', 'L.E 478.80']);
    expect(cells('Less tax collected').slice(0, 2)).toEqual(['Less tax collected · الضريبة المحصلة owed, not revenue', '(L.E 58.80)']);
    expect(cells('Revenue (net sales)')).toEqual(['Revenue (net sales) · صافي المبيعات', 'L.E 420.00', '100%']);
    expect(el.querySelector('.report-head')!.textContent!.replace(/\s+/g, ' ')).toContain('1 day of takings entered');
    expect(el.querySelector('.note.small')!.textContent).toContain('Voids and refunds on the days: L.E 25.00');
  });

  it('sets the food cost at the menu prices against what was collected after the discounts, and says why they were given', async () => {
    kpis.mockReturnValue(of({
      ...report,
      discounts: {
        discounts: 120, actualNetRevenue: 750, standardGrossRevenue: 870, discountSharePercent: 13.8, theoreticalCost: 257,
        standardFoodCostPercent: 29.5, actualFoodCostPercent: 34.3, erosionPoints: 4.8,
        reasons: [{ reason: 'Loyalty', amount: 80, count: 2 }, { reason: 'Staff', amount: 40, count: 1 }],
      },
    } satisfies KpiReport));
    const { fixture } = await render();
    const el = fixture.nativeElement as HTMLElement;
    const section = el.querySelector('.discount-impact')!;
    const tiles = [...section.querySelectorAll('.tile')];

    expect(text(section.querySelector('h3')!)).toBe('Promos & discount impact أثر الخصومات والعروض');
    expect(text(tiles[0].querySelector('strong')!)).toBe('L.E 120.00');
    expect(text(tiles[0].querySelector('.chip')!)).toBe('13.8% of standard gross L.E 870.00');
    expect([...tiles[1].querySelectorAll('.pair strong')].map(text)).toEqual(['29.5%', '34.3%']);
    expect(tiles[1].classList).toContain('amber');
    expect(text(tiles[1].querySelector('.erosion-badge')!)).toBe('warning +4.8 pts erosion · تآكل');
    expect([...tiles[2].querySelectorAll('.reason')].map(text)).toEqual(['LoyaltyL.E 80.00 · 2×', 'StaffL.E 40.00 · 1×']);
    expect(section.querySelectorAll('app-info-tip').length).toBe(5);

    // Five points or more: red.
    expect(fixture.componentInstance['erosionTone'](6.2)).toBe('red');
    expect(fixture.componentInstance['erosionTone'](0)).toBe('');
  });

  describe('with several branches', () => {
    const branches = [
      { id: 'first', name: 'Sidi Gaber', nameAr: 'سيدي جابر', type: 'Restaurant' as const, isActive: true },
      { id: 'kitchen', name: 'Central Kitchen', nameAr: 'المطبخ المركزي', type: 'CentralKitchen' as const, isActive: true },
      { id: 'tanta', name: 'Tanta', nameAr: 'طنطا', type: 'Restaurant' as const, isActive: true },
    ];
    const column = (kind: PnlColumn['kind'], name: string, revenue: number, costOfSales: number, ebitda: number | null, branchId: string | null = null): PnlColumn => ({
      kind, branchId, name, nameAr: null, revenue, costOfSales, grossProfit: revenue - costOfSales, operatingExpenses: 0, ebitda, netProfit: ebitda,
    });
    const consolidated: KpiReport = {
      ...report,
      statement: { ...report.statement, revenue: 1_000, transitLosses: 50 },
      expenses: { ...report.expenses, wagesAndBenefits: 400 },
      scope: { view: 'Consolidated', branchId: null, branch: null, branchAr: null, branchType: null, canChoose: true, branches },
      eliminations: { interBranchSales: 770, costOfGoodsSent: 700, markupInCostOfSales: 20, markupInExpenses: 0, interBranchPurchases: 720, grossProfit: -50 },
      columns: [
        column('Branch', 'Central Kitchen', 770, 700, -30, 'kitchen'),
        column('Branch', 'Tanta', 1_000, 340, null, 'tanta'),
        column('CompanyCosts', 'Company costs', 0, 0, 0),
        column('Eliminations', 'Eliminations', -770, -720, -50),
        column('Consolidated', 'Consolidated', 1_000, 320, 280),
      ],
      companyCosts: { payroll: null, assetDepreciation: 0, disposalGainOrLoss: 0 },
    };
    const kitchenReport: KpiReport = {
      ...report,
      statement: { ...report.statement, revenue: 770, foodSales: 0, beverageSales: 0, interBranchSales: 770, interBranchCostOfGoods: 700, costOfSales: 700 },
      scope: { view: 'Branch', branchId: 'kitchen', branch: 'Central Kitchen', branchAr: 'المطبخ المركزي', branchType: 'CentralKitchen', canChoose: true, branches },
      interBranch: { sales: 770, costOfGoodsSent: 700, margin: 70, shipments: 2, purchases: 0, transitLosses: 0, receipts: 0 },
      companyCosts: { payroll: 5_000, assetDepreciation: 120, disposalGainOrLoss: 0 },
    };
    const tantaReport: KpiReport = {
      ...report,
      statement: { ...report.statement, revenue: 1_000, transitLosses: 55 },
      scope: { view: 'Branch', branchId: 'tanta', branch: 'Tanta', branchAr: 'طنطا', branchType: 'Restaurant', canChoose: false, branches },
      interBranch: { sales: 0, costOfGoodsSent: 0, margin: 0, shipments: 0, purchases: 770, transitLosses: 55, receipts: 2 },
      companyCosts: { payroll: null, assetDepreciation: 0, disposalGainOrLoss: 0 },
    };
    const rows = (el: HTMLElement, selector: string) => [...el.querySelectorAll(`${selector} tr`)].map((r) => [...r.children].map((c) => text(c)));

    it('reads the company as a whole: what it took out between branches, and the table by branch that adds up to it', async () => {
      kpis.mockReturnValue(of(consolidated));
      const { fixture, page } = await render();
      const el = fixture.nativeElement as HTMLElement;

      expect(text(el.querySelector('.scope-chip')!)).toBe('The company as a whole · الشركة ككل');
      expect(el.querySelector(".scope-pick mat-select")).not.toBeNull();
      const out = rows(el, '[aria-label="Eliminations between branches"]');
      expect(out[0]).toEqual(['Inter-branch sales, out of the revenue · استبعاد المبيعات بين الفروع', '(L.E 770.00)']);
      expect(out[1]).toEqual(['Inter-branch purchases, out of the costs · استبعاد المشتريات بين الفروع', '(L.E 720.00)']);
      expect(out.at(-1)).toEqual(['On the gross profit · الأثر على مجمل الربح', 'L.E -50.00']);
      expect(out).toHaveLength(5);

      const table = rows(el, '[aria-label="By branch"]');
      expect(table[0].slice(1)).toEqual(['Central Kitchen', 'Tanta', 'Company costs', 'Eliminations', 'Consolidated']);
      expect(table.find((r) => r[0].startsWith('Gross profit'))!.slice(1)).toEqual(['L.E 70.00', 'L.E 660.00', 'L.E 0.00', 'L.E -50.00', 'L.E 680.00']);
      // Tanta's wages are not in: no EBITDA for it.
      expect(table.find((r) => r[0].startsWith('EBITDA'))![2]).toBe('—');
      // What never arrived, at what it cost the company.
      expect(text([...el.querySelectorAll('.statement tr')].find((r) => text(r).includes('Transit losses'))!)).toContain('L.E 50.00');

      // Each branch's costs are its own: the whole only adds them up.
      expect(page['canEdit']()).toBe(false);
      expect(text(el.querySelector('.scope-note')!)).toContain('Every branch\'s added up');

      // A branch named in the table opens its own P&L.
      kpis.mockReturnValue(of(kitchenReport));
      const open = [...el.querySelectorAll<HTMLButtonElement>('.open-branch')].find((b) => text(b) === 'Central Kitchen')!;
      expect(open.getAttribute('aria-label')).toBe('Open Central Kitchen’s P&L');
      open.click();
      fixture.detectChanges();
      await fixture.whenStable();
      expect(kpis).toHaveBeenLastCalledWith(expect.any(Number), expect.any(Number), 'kitchen');
    });

    it('reads a supplying branch with what it sold the others, and enters its costs as its own', async () => {
      kpis.mockReturnValue(of(kitchenReport));
      const { fixture, page } = await render();
      const el = fixture.nativeElement as HTMLElement;
      const cells = (label: string) =>
        [...[...el.querySelectorAll('.statement tr')].find((r) => r.querySelector('td')!.textContent!.includes(label))!.querySelectorAll('td')].map(text);

      expect(text(el.querySelector('.scope-chip')!)).toBe('Central Kitchen · المطبخ المركزي');
      expect(cells('Inter-branch sales').slice(1)).toEqual(['L.E 770.00', '100.0%']);
      expect(cells('Cost of goods sent to branches').slice(1)).toEqual(['L.E 700.00', '90.9%']);
      expect(el.querySelector('[aria-label="Eliminations between branches"]')).toBeNull();
      expect(el.querySelector('[aria-label="By branch"]')).toBeNull();
      // The company's own costs are said, never counted here.
      expect(text(el.querySelector('.company-costs')!)).toContain('payroll from HR L.E 5,000.00, the fixed assets\' depreciation L.E 120.00, on the consolidated P&L');
      expect(cells('Wages and benefits')[0]).toContain("The payroll from HR is the company's");

      page['set']('wagesAndBenefits', 100);
      await page['saveExpenses']();
      expect(saveExpenses).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), expect.objectContaining({ wagesAndBenefits: 100 }), 'kitchen');
    });

    it("shows a branch's user their own branch, with what it was billed and what never arrived, and nothing to choose", async () => {
      kpis.mockReturnValue(of(tantaReport));
      const { fixture } = await render();
      const el = fixture.nativeElement as HTMLElement;

      expect(el.querySelector(".scope-pick mat-select")).toBeNull();
      expect(text(el.querySelector('.scope-chip')!)).toBe('Tanta · طنطا');
      expect(text([...el.querySelectorAll('.statement tr')].find((r) => text(r).includes('Transit losses'))!)).toContain('L.E 55.00');
      expect(text(el.querySelector('.bought')!)).toContain('Bought from other branches · مشتريات من الفروع: L.E 770.00 on 2 internal purchase invoices');
      expect(el.querySelector('.company-costs')).toBeNull();
    });
  });
});
