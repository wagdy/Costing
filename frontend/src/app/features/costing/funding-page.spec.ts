import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { CostingApi, DayRevenue, DayRevenueReport, FundingReport } from '../../core/costing/costing.api';
import { FundingPage } from './funding-page';
import { Treasury } from './financials';

function day(overrides: Partial<DayRevenue>): DayRevenue {
  return { date: '2026-10-13', cash: 0, card: 0, tax: 0, netSales: 0, voids: 0, paidOut: 0, transferred: 0, entered: false, hasSales: false, ...overrides };
}

// The 13th's Z report: 10,495 cash and 2,000 by card, 1,535 of it tax, 120 voided; 1,454.07 paid
// out of the cash, the rest in the safe. The 14th: its sales entered, its takings not yet.
const revenue: DayRevenueReport = {
  from: '2026-10-01', to: '2026-10-31', cash: 10_495, card: 2_000, tax: 1_535, netSales: 10_960, voids: 120, paidOut: 1_454.07, transferred: 9_040.93,
  days: [
    day({ date: '2026-10-14', hasSales: true }),
    day({ cash: 10_495, card: 2_000, tax: 1_535, netSales: 10_960, voids: 120, paidOut: 1_454.07, transferred: 9_040.93, entered: true, hasSales: true }),
  ],
};
const funding: FundingReport = { from: '2026-10-01', to: '2026-10-31', carriedOver: 0, ownerFinancing: 0, other: 0, revenue: 9_040.93, total: 9_040.93, entries: [] };

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

describe('each day’s cash, on the funding sources', () => {
  const enter = vi.fn();

  async function render() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: CostingApi, useValue: { funding: () => of(funding), dayRevenue: () => of(revenue) } },
        { provide: Treasury, useValue: { enter } },
      ],
    });
    const fixture = TestBed.createComponent(FundingPage);
    await fixture.whenStable();
    fixture.detectChanges();
    return { el: fixture.nativeElement as HTMLElement };
  }

  beforeEach(() => enter.mockReset().mockResolvedValue(false));

  it('shows each day’s Z report, its net sales and what reached the safe; and enters the takings of a day with none', async () => {
    const { el } = await render();

    const table = [...el.querySelectorAll('table')].at(-1)!;
    const rows = [...table.querySelectorAll('tbody tr')].map((r) => [...r.querySelectorAll('td')].map(text));
    expect(rows).toEqual([
      ['Wed 14 Oct', 'No takings entered · لم يُسجل الإيراد', '—', '—', 'move_to_inbox Enter takings'],
      ['Tue 13 Oct', 'L.E 10,495.00', 'L.E 2,000.00', 'L.E 1,535.00', 'L.E 10,960.00', 'L.E 120.00', 'L.E 1,454.07', 'L.E 9,040.93', ''],
    ]);
    expect([...table.querySelectorAll('tfoot td')].map(text).slice(0, 5)).toEqual([
      'The month', 'L.E 10,495.00', 'L.E 2,000.00', 'L.E 1,535.00', 'L.E 10,960.00',
    ]);

    (table.querySelector('tbody button') as HTMLButtonElement).click();
    expect(enter).toHaveBeenCalledWith('RevenueTransfer', { revenueDate: '2026-10-14' });
  });
});
