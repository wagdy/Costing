import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { CostingApi, ReconciliationDay, ReconciliationReport } from '../../core/costing/costing.api';
import { ReconciliationPage } from './reconciliation-page';

function day(overrides: Partial<ReconciliationDay>): ReconciliationDay {
  return { date: '2026-10-12', cash: 0, card: 0, tax: 0, netSales: 0, voids: 0, itemSales: 0, difference: 0, ...overrides };
}

// The 12th: 1,140 taken, 900 cash and 240 by card, 140 of it tax: 1,000 of net sales for 1,010 sold
// at the menu's prices, 10 short. The 11th: money in for nothing entered.
const short = day({ cash: 900, card: 240, tax: 140, netSales: 1_000, voids: 35, itemSales: 1_010, difference: -10 });
const over = day({ date: '2026-10-11', cash: 228, tax: 28, netSales: 200, difference: 200 });
const report: ReconciliationReport = {
  from: '2026-10-01', to: '2026-10-31', taxPercent: 14, days: [short, over],
  total: day({ date: null, cash: 1_128, card: 240, tax: 168, netSales: 1_200, voids: 35, itemSales: 1_010, difference: 190 }),
};

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

describe('the reconciliation', () => {
  const reconciliation = vi.fn();

  async function render() {
    TestBed.configureTestingModule({ providers: [{ provide: CostingApi, useValue: { reconciliation } }] });
    const fixture = TestBed.createComponent(ReconciliationPage);
    await fixture.whenStable();
    fixture.detectChanges();
    return { el: fixture.nativeElement as HTMLElement, page: fixture.componentInstance as unknown as Record<string, any> };
  }

  beforeEach(() => reconciliation.mockReset().mockReturnValue(of(report)));

  it('sets each day’s net sales, its takings less the tax in them, against what it sold at the menu’s prices', async () => {
    const { el } = await render();

    const now = new Date();
    const [from] = reconciliation.mock.lastCall!;
    expect(from).toBe(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`);
    expect([...el.querySelectorAll('.tile')].map((t) => [text(t.querySelector('.label')!), text(t.querySelector('strong')!)])).toEqual([
      ['Net sales (A) · صافي المبيعات', 'L.E 1,200.00'],
      ['Sold at menu prices (B) · المبيعات بأسعار المنيو', 'L.E 1,010.00'],
      ['Difference · الفرق', 'L.E 190.00'],
      ['Tax collected · الضريبة المحصلة', 'L.E 168.00'],
      ['Voids & refunds · الفويد والمرتجعات', 'L.E 35.00'],
    ]);
    expect(text(el.querySelector('.note')!)).toContain('A: each day’s takings as its Z report gave them'.replace('’', "'"));

    const rows = [...el.querySelectorAll('tbody tr')].map((r) => [...r.querySelectorAll('td')].map(text));
    expect(rows[0]).toEqual([
      'Mon 12 Oct', 'L.E 900.00', 'L.E 240.00', 'L.E 140.00', 'L.E 1,000.00', 'L.E 1,010.00', 'L.E -10.00 short · عجز', 'L.E 35.00',
    ]);
    expect(rows[1][6]).toBe('L.E 200.00 not entered · زيادة');
    expect(el.querySelectorAll('tbody tr')[0].querySelectorAll('td')[6].classList).toContain('negative');
    const total = [...el.querySelectorAll('tfoot td')].map(text);
    expect([total[0], total[4], total[6]]).toEqual(['The month', 'L.E 1,200.00', 'L.E 190.00 not entered · زيادة']);
  });

  it('moves a month back', async () => {
    const { page } = await render();

    page['move'](-1);
    const before = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
    expect(reconciliation.mock.lastCall![0]).toBe(`${before.getFullYear()}-${String(before.getMonth() + 1).padStart(2, '0')}-01`);
  });
});
