import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { BurdenedCostReport, BurdenedPlateRow, IntelligenceApi } from '../../core/costing/intelligence.api';
import { NotifyService } from '../../core/ui/notify.service';
import { BurdenedCostPage, priceSegments } from './burdened-cost-page';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

function plate(overrides: Partial<BurdenedPlateRow>): BurdenedPlateRow {
  return {
    itemCode: '1', menuItemId: 1, variantId: null, recipeId: 'r1', dish: 'Dish', dishAr: null, category: 'Mains', onMenu: true, quantitySold: 0,
    estimated: false, sellingPrice: null, prepTimeMinutes: 10, complexityWeight: 1, weightedMinutes: 10, prepTimeAssumed: false,
    directFoodCost: null, foodCostPercent: null, allocatedLaborCost: null, laborCostPercent: null, primeCost: null, primeCostPercent: null,
    allocatedOverheadCost: null, overheadCostPercent: null, fullyBurdenedCost: null, fullyBurdenedCostPercent: null, trueNetProfitPerPlate: null,
    trueNetMarginPercent: null, totalPeriodNetProfit: null, suggestedPriceForTargetNetMargin: null, bleedingAfterOverhead: false,
    missingPrices: false, status: 'Healthy', ...overrides,
  };
}

// 100 burgers and 50 steaks, 12,000 of labor and 6,000 of overheads, equal per plate: 80 and 40.
const burger = plate({
  dish: 'Burger', quantitySold: 100, sellingPrice: 120, directFoodCost: 23, foodCostPercent: 19.2, allocatedLaborCost: 80, laborCostPercent: 66.7,
  primeCost: 103, primeCostPercent: 85.8, allocatedOverheadCost: 40, overheadCostPercent: 33.3, fullyBurdenedCost: 143, fullyBurdenedCostPercent: 119.2,
  trueNetProfitPerPlate: -23, trueNetMarginPercent: -19.2, totalPeriodNetProfit: -2300, suggestedPriceForTargetNetMargin: 168.24,
  bleedingAfterOverhead: true, status: 'Losing',
});
const steak = plate({
  itemCode: '30', menuItemId: 30, recipeId: 'r2', dish: 'Steak', quantitySold: 50, sellingPrice: 300, directFoodCost: 150, foodCostPercent: 50,
  allocatedLaborCost: 80, laborCostPercent: 26.7, primeCost: 230, primeCostPercent: 76.7, allocatedOverheadCost: 40, overheadCostPercent: 13.3,
  fullyBurdenedCost: 270, fullyBurdenedCostPercent: 90, trueNetProfitPerPlate: 30, trueNetMarginPercent: 10, totalPeriodNetProfit: 1500,
  suggestedPriceForTargetNetMargin: 317.65, status: 'Thin',
});
const lemonade = plate({
  itemCode: '20', menuItemId: 20, recipeId: null, dish: 'Lemonade', category: 'Drinks', estimated: true, sellingPrice: 30, allocatedLaborCost: 80,
  allocatedOverheadCost: 40, prepTimeAssumed: true, status: 'NoRecipe',
});
const alfredo = plate({
  itemCode: '', menuItemId: null, recipeId: 'r3', dish: 'Alfredo pasta', onMenu: false, estimated: true, sellingPrice: 250, directFoodCost: 45,
  allocatedLaborCost: 80, allocatedOverheadCost: 40, fullyBurdenedCost: 165, fullyBurdenedCostPercent: 66, trueNetProfitPerPlate: 85,
  trueNetMarginPercent: 34, suggestedPriceForTargetNetMargin: 194.12, status: 'Healthy',
});

function report(overrides: Partial<BurdenedCostReport> = {}): BurdenedCostReport {
  return {
    from: '2026-11-01', to: '2026-11-30', days: 30, method: 'ActivityBasedPrepTime', source: 'Actual', targetNetMarginPercent: 15,
    labor: { total: 12000, parts: [{ key: 'wagesEntered', label: 'Wages & benefits entered', labelAr: 'الأجور والمزايا المدخلة', amount: 12000 }], standInMonths: [] },
    overhead: {
      total: 6000,
      parts: [
        { key: 'occupation', label: 'Rent & occupation', labelAr: 'الإيجار والمكان', amount: 4000 },
        { key: 'depreciation', label: 'Depreciation', labelAr: 'الإهلاك', amount: 2000 },
      ],
      standInMonths: [],
    },
    platesSold: 150, sales: 27000, laborPerPlate: 80, laborPerRevenue: 0.444444, laborPerWeightedMinute: 6, overheadPerPlate: 40, overheadPerRevenue: 0.222222,
    laborAllocated: 12000, averageLaborPerPlate: 80, overheadAllocated: 6000, averageOverheadPerPlate: 40, averageFullyBurdenedCostPercent: 103,
    averageTrueNetMarginPercent: -3, totalPeriodNetProfit: -800, dishesBleeding: 1, rows: [burger, steak, lemonade, alfredo], categories: ['Drinks', 'Mains'],
    ...overrides,
  };
}

describe('the fully burdened plate cost (التكلفة الكلية للطبق)', () => {
  const burdenedCosts = vi.fn();
  const burdenedCostsSheet = vi.fn();

  async function render() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: IntelligenceApi, useValue: { burdenedCosts, burdenedCostsSheet } },
        { provide: NotifyService, useValue: { info: vi.fn(), error: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(BurdenedCostPage);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const rows = () => [...el.querySelectorAll('.plate-table tbody tr')];
    return { fixture, el, rows, page: fixture.componentInstance as unknown as Record<string, any> };
  }

  beforeEach(() => {
    burdenedCosts.mockReset().mockImplementation((query: { method: string | null; source: string }) =>
      of(report({ method: (query.method ?? 'ActivityBasedPrepTime') as BurdenedCostReport['method'], source: query.source as BurdenedCostReport['source'] })),
    );
    burdenedCostsSheet.mockReset().mockReturnValue(of(new Blob()));
    URL.createObjectURL = vi.fn(() => 'blob:sheet');
    URL.revokeObjectURL = vi.fn();
  });

  it("starts on this month's actual pools, as the cost settings share them, and sums them up", async () => {
    const { el } = await render();

    expect(burdenedCosts.mock.lastCall![0]).toMatchObject({ method: null, source: 'Actual' });
    expect(burdenedCosts.mock.lastCall![0].from).toMatch(/^\d{4}-\d{2}-01$/);
    expect(burdenedCosts).toHaveBeenCalledTimes(1);
    // The settings' method is the one shown chosen, with its (ⓘ).
    expect(text(el.querySelector('.methods .mat-button-toggle-checked')!)).toBe('timer Activity-based (prep time) حسب وقت التحضير');
    expect(el.querySelector('.methods app-info-tip button')!.getAttribute('aria-label')).toBe('About Activity-based (prep time) · حسب وقت التحضير (ABC)');

    expect([...el.querySelectorAll('.tile')].map((t) => [text(t.querySelector('strong')!), text(t.querySelector('.chip, .show-bleeding')!)])).toEqual([
      ['L.E 12,000.00', 'L.E 80.00 a plate'],
      ['L.E 6,000.00', 'L.E 40.00 a plate'],
      ['103.0%', 'vs net margin · صافي الربح -3.0%'],
      ['1', 'Show them · عرضها'],
    ]);
    expect([...el.querySelectorAll('.tile app-info-tip button')].map((b) => b.getAttribute('aria-label'))).toEqual([
      'About Labor pool allocated · إجمالي العمالة المحملة',
      'About Overhead pool allocated · إجمالي الإيجار والمرافق والإهلاك',
      'About Average fully burdened cost % · متوسط التكلفة الكلية %',
      'About Dishes bleeding after overhead · أطباق خاسرة بعد تحميل المصاريف',
    ]);
    expect([...el.querySelectorAll('.pools li')].map(text)).toEqual([
      'Wages & benefits entered · الأجور والمزايا المدخلةL.E 12,000.00',
      'Rent & occupation · الإيجار والمكانL.E 4,000.00',
      'Depreciation · الإهلاكL.E 2,000.00',
    ]);
  });

  it('lists each dish worst margin first, with food, labor, overheads, the burdened cost and what is left', async () => {
    const { rows } = await render();
    const cells = (r: Element) => [...r.querySelectorAll(':scope > td')].map(text);

    expect(rows().map((r) => r.querySelector('td')!.querySelector('a, strong')!.textContent!.trim())).toEqual(['Burger', 'Steak', 'Alfredo pasta', 'Lemonade']);
    expect(cells(rows()[0]).slice(2)).toEqual([
      '100', 'L.E 120.00', 'L.E 23.00 19.2%', 'L.E 80.00 66.7%', 'L.E 40.00 33.3%', 'L.E 143.00119.2%',
      'L.E -23.00-19.2%L.E -2,300.00 for the period', 'L.E 168.24+L.E 48.24', 'trending_down Losing after overhead خاسر بعد التحميلProfitable on food alone · رابح على الخامات فقط',
    ]);
    expect(rows()[0].classList).toContain('losing');
    expect(text(rows()[2].querySelector('td')!)).toContain('Off the menu: estimated · تقديري');
    expect(text(rows()[3].querySelector('td')!)).toContain('20 · Drinks · 10 min (default)');
    expect(cells(rows()[3])[10]).toBe('help No recipe بدون وصفة');
    // Each column's (ⓘ).
    expect(rows()[0].closest('table')!.querySelectorAll('thead app-info-tip')).toHaveLength(6);
  });

  it("draws what a plate's price is made of, a loss past the price hatched red", async () => {
    const { rows } = await render();

    const kinds = (bar: Element) => [...bar.querySelectorAll('.seg')].map((s) => ['food', 'labor', 'overhead', 'profit'].find((k) => s.classList.contains(k)));
    const burgerBar = rows()[0].querySelector('.stack')!;
    expect(kinds(burgerBar)).toEqual(['food', 'labor', 'overhead']);
    expect(burgerBar.querySelector('.loss-band')).not.toBeNull();
    expect(burgerBar.getAttribute('aria-label')).toBe('Burger at 120.00: food 23.00, labor 80.00, overhead 40.00, loss 23.00');
    const steakBar = rows()[1].querySelector('.stack')!;
    expect(kinds(steakBar)).toEqual(['food', 'labor', 'overhead', 'profit']);
    expect(steakBar.querySelector('.loss-band')).toBeNull();
    // No recipe: nothing to draw.
    expect(rows()[3].querySelector('.stack')).toBeNull();
  });

  it('works out the bar from the price, or from the burdened cost when that is more', () => {
    const profit = priceSegments(steak)!;
    expect(profit.segments.map((s) => [s.key, Math.round(s.share * 10) / 10])).toEqual([['food', 50], ['labor', 26.7], ['overhead', 13.3], ['profit', 10]]);
    expect(profit.lossFrom).toBeNull();
    const loss = priceSegments(burger)!;
    // 143 of costs on a 120 price: the price ends 83.9% along.
    expect(loss.segments.map((s) => Math.round(s.share * 10) / 10)).toEqual([16.1, 55.9, 28]);
    expect(Math.round(loss.lossFrom! * 10) / 10).toBe(83.9);
    // Each part of the price, as the columns say it: labor 66.7% of the 120.
    expect(Math.round(loss.segments[1].ofPrice * 10) / 10).toBe(66.7);
    expect(priceSegments(lemonade)).toBeNull();
  });

  it('shares the pools another way, or by monthly figures typed in, and downloads the sheet as shown', async () => {
    {
      const { fixture, el, page } = await render();
      [...el.querySelectorAll<HTMLButtonElement>('.methods button')].find((b) => text(b).includes('By revenue %'))!.click();
      await fixture.whenStable();
      expect(burdenedCosts.mock.lastCall![0]).toMatchObject({ method: 'ByRevenueShare', source: 'Actual' });

      page['source'].set('Simulated');
      await fixture.whenStable();
      fixture.detectChanges();
      expect(burdenedCosts.mock.lastCall![0]).toMatchObject({ source: 'Simulated', monthlyLabor: null, monthlyOverhead: null });
      expect([...el.querySelectorAll<HTMLInputElement>('.source input')].map((i) => i.getAttribute('aria-label'))).toEqual(['Monthly labor', 'Monthly overhead']);

      // Typed figures wait for a pause.
      const calls = burdenedCosts.mock.calls.length;
      page['monthlyLabor'].set(page['figure']('90000'));
      page['monthlyOverhead'].set(page['figure']('75000'));
      await fixture.whenStable();
      expect(burdenedCosts.mock.calls.length).toBe(calls);
      await new Promise((resolve) => setTimeout(resolve, 450));
      expect(burdenedCosts.mock.lastCall![0]).toMatchObject({ source: 'Simulated', monthlyLabor: 90000, monthlyOverhead: 75000 });

      await page['download']();
      expect(burdenedCostsSheet).toHaveBeenCalledWith(expect.objectContaining({ method: 'ByRevenueShare', source: 'Simulated', monthlyLabor: 90000 }));
      expect(URL.createObjectURL).toHaveBeenCalled();
    }
  });

  it('shows the dishes bleeding after overhead, and the off-menu ones apart', async () => {
    const { fixture, el, rows } = await render();
    el.querySelector<HTMLButtonElement>('.show-bleeding')!.click();
    fixture.detectChanges();
    expect(rows().map((r) => r.querySelector('td a, td strong')!.textContent!.trim())).toEqual(['Burger']);

    const page = fixture.componentInstance as unknown as Record<string, any>;
    page['status'].set('');
    page['menu'].set('off');
    fixture.detectChanges();
    expect(rows().map((r) => r.querySelector('td a, td strong')!.textContent!.trim())).toEqual(['Alfredo pasta']);
  });
});
