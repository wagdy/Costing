import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { CostingApi, DailyBreakEven } from '../../core/costing/costing.api';
import { DailyBreakEvenPage, gaugeScale } from './daily-break-even-page';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

// 1,000 a day of fixed costs; 1,200 sold at a 62.5% margin: 1,600 to break even, 250 lost so far.
function day(overrides: Partial<DailyBreakEven> = {}): DailyBreakEven {
  return {
    date: '2026-11-16', isToday: true, daysInMonth: 30, monthlyFixedCosts: 30000, dailyFixedCosts: 1000,
    labor: { total: 18000, parts: [{ key: 'wagesEntered', label: 'Wages & benefits entered', labelAr: 'الأجور والمزايا المدخلة', amount: 18000 }], standInMonths: [] },
    overhead: { total: 12000, parts: [{ key: 'occupation', label: 'Rent & occupation', labelAr: 'الإيجار والمكان', amount: 12000 }], standInMonths: [] },
    netSales: 1200, foodCost: 450, foodCostPercent: 37.5, contributionMargin: 750, wacmPercent: 62.5, wacmEstimated: false, historyFrom: null,
    historyTo: null, breakEvenSales: 1600, stillToSell: 400, progressPercent: 75, breakEvenReached: false, operatingResult: -250, plates: 14,
    platesWithoutRecipe: 0, salesWithoutRecipe: 0, missingPrices: false, ...overrides,
  };
}

describe('the daily break-even (نقطة التعادل اليومية)', () => {
  const dailyBreakEven = vi.fn();

  async function render() {
    TestBed.configureTestingModule({ providers: [{ provide: CostingApi, useValue: { dailyBreakEven } }] });
    const fixture = TestBed.createComponent(DailyBreakEvenPage);
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, page: fixture.componentInstance as unknown as Record<string, any> };
  }

  beforeEach(() => dailyBreakEven.mockReset().mockReturnValue(of(day())));

  it("says in a sentence what today must sell, what it sold and what it is losing, in red", async () => {
    const { el } = await render();

    // Today: the server's own business day.
    expect(dailyBreakEven).toHaveBeenCalledWith(null);
    expect(text(el.querySelector('.summary .ar-text')!)).toBe(
      'اليوم، لكي تغطي مصاريفك، يجب أن تبيع بـ 1,600.00 جنيه. لقد بعت بـ 1,200.00 حتى الآن، أنت تحقق خسارة تشغيلية قدرها 250.00 جنيه لهذا اليوم.',
    );
    expect(text(el.querySelector('.summary .en-text')!)).toBe(
      'Today, to cover your costs you need to sell L.E 1,600.00. You have sold L.E 1,200.00 so far: an operating loss of L.E 250.00 for the day.',
    );
    expect(el.querySelector('.summary')!.classList).toContain('loss');
  });

  it('draws the sales from 0 against the break-even line, amber until it is crossed', async () => {
    const { el } = await render();

    // 1,600 × 1.15 = 1,840 across: sold 1,200 is 65.2% of it, the line 87%.
    const fill = el.querySelector<HTMLElement>('.gauge .fill')!;
    expect(parseFloat(fill.style.width)).toBeCloseTo((1200 / 1840) * 100, 6);
    expect(fill.classList).not.toContain('reached');
    expect(parseFloat(el.querySelector<HTMLElement>('.gauge .marker')!.style.left)).toBeCloseTo((1600 / 1840) * 100, 6);
    expect(text(el.querySelector('.gauge .marker-label')!)).toBe('L.E 1,600.00');
    expect(text(el.querySelector('.status-chip')!)).toBe('hourglass_top Below break-even · تحت نقطة التعادل: L.E 400.00 still to sell · متبقي');
    expect(el.querySelector('.gauge')!.getAttribute('aria-valuetext')).toBe('Sold 1200.00 of a 1600.00 break-even, not reached yet');
    expect(text(el.querySelector('.axis')!)).toBe('0Sold · المباع L.E 1,200.00 · 75%');
  });

  it('shows the four figures, each with its (ⓘ)', async () => {
    const { el } = await render();
    expect([...el.querySelectorAll('.tile')].map((t) => [text(t.querySelector('strong')!), text(t.querySelector('.chip')!)])).toEqual([
      ['L.E 1,000.00', 'L.E 30,000.00 ÷ 30 days'],
      ['62.5%', 'L.E 750.00 contribution · المساهمة'],
      ['L.E 1,200.00', '14 plates'],
      ['L.E 450.00', '37.5% of sales'],
    ]);
    expect([...el.querySelectorAll('.tile app-info-tip button')].map((b) => b.getAttribute('aria-label'))).toEqual([
      'About Daily fixed costs · نصيب اليوم من المصاريف الثابتة',
      'About Contribution margin % (WACM) · هامش المساهمة المرجح',
      'About Net sales · صافي المبيعات',
      'About Variable food cost · تكلفة الخامات المتغيرة',
    ]);
    expect([...el.querySelectorAll('.pools li')].map(text)).toEqual([
      'Wages & benefits entered · الأجور والمزايا المدخلةL.E 18,000.00',
      'Rent & occupation · الإيجار والمكانL.E 12,000.00',
    ]);
  });

  it('turns green with a profit once the break-even is crossed', async () => {
    dailyBreakEven.mockReturnValue(of(day({ netSales: 2000, foodCost: 750, contributionMargin: 1250, stillToSell: 0, progressPercent: 125, breakEvenReached: true, operatingResult: 250 })));
    const { el } = await render();

    expect(text(el.querySelector('.summary .ar-text')!)).toContain('أنت تحقق ربح تشغيلية قدرها 250.00 جنيه لهذا اليوم.');
    expect(el.querySelector('.summary')!.classList).toContain('profit');
    expect(el.querySelector('.gauge .fill')!.classList).toContain('reached');
    expect(text(el.querySelector('.status-chip')!)).toBe('check_circle Break-even reached · تجاوزت نقطة التعادل');
  });

  it('looks back at another day, said in the past', async () => {
    const { fixture, el, page } = await render();
    dailyBreakEven.mockReturnValue(of(day({ date: '2026-11-15', isToday: false })));
    page['shift'](-1);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(dailyBreakEven.mock.lastCall![0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(text(el.querySelector('.summary .ar-text')!)).toBe(
      'يوم 15/11/2026، لكي تغطي مصاريفك، كان يجب أن تبيع بـ 1,600.00 جنيه. لقد بعت بـ 1,200.00، وحققت خسارة تشغيلية قدرها 250.00 جنيه لهذا اليوم.',
    );
    // Not past today.
    const calls = dailyBreakEven.mock.calls.length;
    page['date'].set(page['today']);
    await fixture.whenStable();
    page['shift'](1);
    await fixture.whenStable();
    expect(dailyBreakEven.mock.calls.length).toBe(calls + 1);
  });

  it("works the target at the last seven days' margin with nothing sold yet, and says when there is none", async () => {
    dailyBreakEven.mockReturnValue(of(day({
      netSales: 0, foodCost: 0, foodCostPercent: null, contributionMargin: 0, wacmPercent: 80, wacmEstimated: true, historyFrom: '2026-11-09',
      historyTo: '2026-11-15', breakEvenSales: 1250, stillToSell: 1250, progressPercent: 0, operatingResult: -1000, plates: 0,
    })));
    const { el } = await render();
    expect(text(el.querySelectorAll('.tile .chip')[1])).toBe('Last 7 days · آخر 7 أيام (9 Nov – 15 Nov)');
    expect(text(el.querySelector('.summary .ar-text')!)).toContain('يجب أن تبيع بـ 1,250.00 جنيه');

    TestBed.resetTestingModule();
    dailyBreakEven.mockReturnValue(of(day({
      netSales: 0, foodCost: 0, foodCostPercent: null, contributionMargin: 0, wacmPercent: null, breakEvenSales: null, stillToSell: null,
      progressPercent: null, operatingResult: -1000, plates: 0,
    })));
    const none = await render();
    expect(text(none.el.querySelector('.summary .ar-text')!)).toContain('لا توجد مبيعات في هذا اليوم ولا في الأيام السبعة السابقة');
    expect(none.el.querySelector('.gauge .marker')).toBeNull();
    expect(text(none.el.querySelector('.status-chip')!)).toBe('hourglass_top No target yet · لا يوجد هدف بعد');
  });

  it('reaches past the target or the sales, whichever is more', () => {
    const g = gaugeScale(day());
    expect([g.max, g.fill, g.marker!].map((v) => Math.round(v * 1000) / 1000)).toEqual([1840, 65.217, 86.957]);
    expect(gaugeScale(day({ netSales: 3200 })).marker).toBeCloseTo((1600 / 3680) * 100, 6);
    expect(gaugeScale(day({ breakEvenSales: null })).marker).toBeNull();
  });
});
