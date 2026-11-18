import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { ConsumptionRow, IntelligenceApi, StationVariance, StationVarianceReport } from '../../core/costing/intelligence.api';
import { NotifyService } from '../../core/ui/notify.service';
import { StationVariancePage } from './station-variance-page';
import { StockCardDialog } from './stock-card-dialog';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

function row(over: Partial<ConsumptionRow>): ConsumptionRow {
  return {
    rawMaterialId: 'm', code: null, material: 'M', categoryId: 'c', category: 'Meat', categoryAr: null, purchaseUnit: 'kg', opening: 0, purchases: 0,
    waste: 0, closing: 0, actualUsage: 0, theoreticalUsage: 0, heldInPrep: 0, unexplainedQuantity: 0, unexplainedPercent: null, unitCost: 10,
    varianceCost: 0, evaluation: 'WithinLimit', staffMeals: 0, kitchenStationId: null, ...over,
  };
}

function station(over: Partial<StationVariance>): StationVariance {
  return {
    stationId: 's', station: 'S', stationAr: null, code: null, isShared: false, isActive: true, tolerancePercent: 5, materials: 1,
    theoreticalConsumptionCost: 0, actualConsumptionCost: 0, loggedSpoilageWasteCost: 0, staffMealsCost: 0, unexplainedVarianceCost: 0,
    unexplainedVariancePercent: null, overTolerance: 0, status: 'WithinTarget', topLossMaterials: [], ...over,
  };
}

// The grill two patties short (20% against its 25%: watched), the bar losing milk past its 2%, the
// cold station as it should be, the hot kitchen holding the spoiled lettuce.
const report: StationVarianceReport = {
  from: '2026-11-01', to: '2026-11-18', tolerancePercent: 5, watchSharePercent: 75,
  stations: [
    station({
      stationId: 'grill', station: 'Grill', stationAr: 'المشويات', code: 'GRILL', tolerancePercent: 25, theoreticalConsumptionCost: 200, actualConsumptionCost: 240,
      unexplainedVarianceCost: 40, unexplainedVariancePercent: 20, status: 'Watch', topLossMaterials: [{ rawMaterialId: 'patty', material: 'Beef patty', varianceCost: 40, variancePercent: 20 }],
    }),
    station({ stationId: 'hot', station: 'Hot Kitchen', code: 'HOT', materials: 0, loggedSpoilageWasteCost: 30 }),
    station({
      stationId: 'bar', station: 'Bar & Barista', code: 'BAR', tolerancePercent: 2, theoreticalConsumptionCost: 100, actualConsumptionCost: 110,
      unexplainedVarianceCost: 10, unexplainedVariancePercent: 10, status: 'HighLoss', overTolerance: 1,
      topLossMaterials: [{ rawMaterialId: 'milk', material: 'Milk', varianceCost: 10, variancePercent: 10 }],
    }),
  ],
  rows: [
    row({ rawMaterialId: 'patty', material: 'Beef patty', kitchenStationId: 'grill', actualUsage: 12, theoreticalUsage: 10, unexplainedQuantity: 2, unexplainedPercent: 20,
      varianceCost: 40, evaluation: 'Unfavourable' }),
    row({ rawMaterialId: 'milk', material: 'Milk', kitchenStationId: 'bar', unexplainedQuantity: 0.25, unexplainedPercent: 10, varianceCost: 10, evaluation: 'Unfavourable' }),
    row({ rawMaterialId: 'coffee', material: 'Coffee beans', kitchenStationId: 'bar' }),
  ],
  theoreticalValue: 300, actualValue: 350, unexplainedValue: 50, wasteValue: 30,
};

describe('station-level variance', () => {
  const stationVariance = vi.fn();
  const stationVarianceSheet = vi.fn();
  const open = vi.fn();

  async function render() {
    TestBed.configureTestingModule({
      providers: [
        { provide: IntelligenceApi, useValue: { stationVariance, stationVarianceSheet } },
        { provide: NotifyService, useValue: { info: vi.fn(), error: vi.fn() } },
        { provide: MatDialog, useValue: { open } },
      ],
    });
    const fixture = TestBed.createComponent(StationVariancePage);
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, page: fixture.componentInstance as unknown as Record<string, any> };
  }

  beforeEach(() => {
    stationVariance.mockReset().mockReturnValue(of(report));
    open.mockReset();
  });

  it('shows a scorecard a station, its status, its unexplained in money and share, its waste and its leaking materials', async () => {
    const { el } = await render();
    expect(stationVariance).toHaveBeenCalled();
    const cards = [...el.querySelectorAll('.scorecard')];
    expect(cards.map((c) => text(c.querySelector('.badge')!))).toEqual([
      'warning Watch · تحت المراقبة', 'check_circle Within target · منضبط', 'error High loss · عجز مرتفع',
    ]);
    expect(cards.map((c) => [...c.classList].filter((k) => k !== 'scorecard'))).toEqual([['Watch'], ['WithinTarget'], ['HighLoss']]);
    const grill = cards[0];
    expect(text(grill.querySelector('.name')!)).toBe('Grillالمشويات');
    expect(text(grill.querySelector('.key dd')!)).toBe('L.E 40.00 +20.0%');
    expect(grill.querySelector('.key dd')!.classList).toContain('loss');
    expect([...grill.querySelectorAll('dl > div:not(.key) dd')].map(text)).toEqual(['L.E 200.00', 'L.E 240.00', 'L.E 0.00']);
    expect([...grill.querySelectorAll('.leak')].map(text)).toEqual(['Beef patty L.E 40.00']);
    expect(text(grill.querySelector('footer .muted')!)).toBe('1 material · ±25%');
    // Each figure explained by its (ⓘ), no formula under it.
    expect(grill.querySelectorAll('app-info-tip').length).toBe(4);
    expect(text(cards[1].querySelectorAll('dl dd')[3])).toBe('L.E 30.00');
  });

  it('compares each station’s share against its own tolerance line, the one past it in red', async () => {
    const { el } = await render();
    const bars = [...el.querySelectorAll('.bar-row')];
    expect(bars.map((b) => text(b.querySelector('.bar-label')!) + ' ' + text(b.querySelector('.bar-value')!))).toEqual([
      'Grill +20.0%', 'Hot Kitchen —', 'Bar & Barista +10.0%',
    ]);
    // No sales on the hot kitchen's materials: no bar, only its line.
    expect(bars[1].querySelector('.fill')).toBeNull();
    expect(bars[2].querySelector('.fill')!.classList).toContain('HighLoss');
    expect(bars[2].querySelector('.bar-value')!.classList).toContain('loss');
    const limit = (b: Element) => parseFloat((b.querySelector('.limit') as HTMLElement).style.left);
    const fillEnd = (b: Element) => parseFloat((b.querySelector('.fill') as HTMLElement).style.left) + parseFloat((b.querySelector('.fill') as HTMLElement).style.width);
    // The bar's fill past its 2% line; the grill's short of its 25%.
    expect(fillEnd(bars[2])).toBeGreaterThan(limit(bars[2]));
    expect(fillEnd(bars[0])).toBeLessThan(limit(bars[0]));
  });

  it('lists the chosen station’s materials, each opening its stock card, and exports the report', async () => {
    const { fixture, el, page } = await render();
    expect(el.querySelectorAll('table.detail tbody tr').length).toBe(3);
    (el.querySelectorAll('.scorecard')[2] as HTMLButtonElement).click();
    fixture.detectChanges();
    const rows = [...el.querySelectorAll('table.detail tbody tr')];
    expect(rows.map((r) => text(r.querySelectorAll('td')[1]).split(' receipt_long')[0])).toEqual(['Milk', 'Coffee beans']);
    expect(text(rows[0].querySelector('td')!)).toBe('Bar & Barista');
    expect(text(el.querySelector('table.detail tfoot')!)).toBe('Bar & Barista · unexplained varianceL.E 10.00+10.0%High loss');
    // Clicked again: every station's.
    (el.querySelectorAll('.scorecard')[2] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelectorAll('table.detail tbody tr').length).toBe(3);

    (el.querySelector('table.detail button.material') as HTMLButtonElement).click();
    expect(open.mock.lastCall![0]).toBe(StockCardDialog);
    expect(open.mock.lastCall![1].data).toEqual({ id: 'patty', name: 'Beef patty', from: page['from'](), to: page['to']() });

    stationVarianceSheet.mockReturnValue(of(new Blob(['x'])));
    URL.createObjectURL = vi.fn(() => 'blob:sheet');
    URL.revokeObjectURL = vi.fn();
    await page['download']();
    expect(stationVarianceSheet).toHaveBeenCalledWith(page['from'](), page['to']());
  });
});
