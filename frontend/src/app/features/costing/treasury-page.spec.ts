import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { CostingApi, TreasuryAnalytics, TreasuryFlowLine } from '../../core/costing/costing.api';
import { TreasuryPage } from './treasury-page';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

function line(key: string, en: string, ar: string, amount: number, sharePercent: number | null, items: TreasuryFlowLine[] = []): TreasuryFlowLine {
  return { key, en, ar, amount, sharePercent, items };
}

// A month: 1,000 brought forward; 3,000 cash, 1,000 Visa and 560 of tax taken, 500 put in by the
// owners; 200 advanced, a 300 electricity bill and 400 of tax paid over.
const report: TreasuryAnalytics = {
  from: '2026-10-01',
  to: '2026-10-31',
  openingBalance: 1_000,
  totalIn: 6_060,
  totalOut: 900,
  netFlow: 4_160,
  closingBalance: 5_160,
  inflows: [
    line('cash', 'Cash sales', 'مبيعات الكاش', 3_000, 49.5),
    line('card', 'Visa sales', 'مبيعات الفيزا', 1_000, 16.5),
    line('tax', 'Tax collected', 'الضريبة المحصلة', 560, 9.2),
    line('opening', 'Opening balance', 'الرصيد الافتتاحي', 1_000, 16.5),
    line('funding', 'External funding', 'التمويل الخارجي', 500, 8.3, [line('funding-owners', "Owners' financing", 'تمويل الشركاء', 500, 8.3)]),
  ],
  outflows: [
    line('suppliers', 'Supplier payments & cash purchases', 'مدفوعات الموردين والمشتريات النقدية', 0, 0, [
      line('supplier-payments', 'Supplier payments', 'سداد موردين', 0, 0),
      line('invoice-payments', 'Invoices paid in cash', 'فواتير نقدية', 0, 0),
    ]),
    line('expenses', 'Operating expense vouchers', 'أذون صرف المصروفات', 300, 33.3, [line('expense-u', 'Utilities', 'مرافق', 300, 33.3)]),
    line('staff', 'Staff advances & wages', 'سلف وأجور الموظفين', 200, 22.2, [
      line('advances', 'Advances', 'سلف', 200, 22.2),
      line('salaries', 'Salaries', 'رواتب', 0, 0),
    ]),
    line('tax', 'Tax paid over', 'سداد الضرائب', 400, 44.4),
  ],
  taxCollected: 560,
  taxPaid: 400,
  taxToDate: { collected: 560, paid: 400, owed: 160 },
  voids: 40,
  days: [
    { date: '2026-10-02', in: 1_500, out: 0, net: 1_500, balance: 2_500, voids: 0, voidReasons: [] },
    { date: '2026-10-03', in: 4_560, out: 900, net: 3_660, balance: 6_160, voids: 40, voidReasons: ['1 void: wrong table'] },
  ],
};

describe('the safe’s analysis', () => {
  const treasuryAnalytics = vi.fn();

  async function render() {
    TestBed.configureTestingModule({ providers: [{ provide: CostingApi, useValue: { treasuryAnalytics } }] });
    const fixture = TestBed.createComponent(TreasuryPage);
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, page: fixture.componentInstance as unknown as Record<string, any> };
  }

  beforeEach(() => {
    treasuryAnalytics.mockReset().mockReturnValue(of(report));
  });

  it('shows where the money came from and went, with each line’s share, and what each is made of', async () => {
    const { el } = await render();

    const now = new Date();
    const first = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    expect(treasuryAnalytics.mock.lastCall![0]).toBe(first);
    expect([...el.querySelectorAll('.tile strong')].map(text)).toEqual(['L.E 1,000.00', 'L.E 6,060.00', 'L.E 900.00', 'L.E 4,160.00', 'L.E 5,160.00']);
    expect([...el.querySelectorAll('app-spending-pie h3')].map(text)).toEqual(['Where it came from تحليل مصادر الوارد', 'Where it went تحليل أوجه الصرف']);

    const rows = (title: string) =>
      [...el.querySelector(`section[aria-labelledby="${title}"]`)!.querySelectorAll('tbody tr, tfoot tr')].map((r) =>
        [...r.querySelectorAll('td')].map(text).join(' | '),
      );
    expect(rows('inflows-title')).toEqual([
      'Cash sales مبيعات الكاش | L.E 3,000.00 | 49.5%',
      'Visa sales مبيعات الفيزا | L.E 1,000.00 | 16.5%',
      'Tax collected الضريبة المحصلة | L.E 560.00 | 9.2%',
      'Opening balance الرصيد الافتتاحي | L.E 1,000.00 | 16.5%',
      'External funding التمويل الخارجي | L.E 500.00 | 8.3%',
      "Owners' financing تمويل الشركاء | L.E 500.00 | 8.3%",
      'Total in · إجمالي الوارد | L.E 6,060.00 | 100%',
    ]);
    // A line of nothing within a group is left out; the group stays, at nothing.
    expect(rows('outflows-title')).toEqual([
      'Supplier payments & cash purchases مدفوعات الموردين والمشتريات النقدية | L.E 0.00 | 0.0%',
      'Operating expense vouchers أذون صرف المصروفات | L.E 300.00 | 33.3%',
      'Utilities مرافق | L.E 300.00 | 33.3%',
      'Staff advances & wages سلف وأجور الموظفين | L.E 200.00 | 22.2%',
      'Advances سلف | L.E 200.00 | 22.2%',
      'Tax paid over سداد الضرائب | L.E 400.00 | 44.4%',
      'Total out · إجمالي المنصرف | L.E 900.00 | 100%',
    ]);
  });

  it('reconciles the tax held in the safe, and goes day by day with the balance and the voids', async () => {
    const { el } = await render();

    expect([...el.querySelectorAll('.tax-card .equation dd')].map(text)).toEqual(['L.E 560.00', '(L.E 400.00)', 'L.E 160.00']);
    expect(text(el.querySelector('.tax-card .result dt')!)).toBe('Remaining unpaid tax liability in the safe رصيد الضريبة المتبقي بالخزنة');

    const days = [...el.querySelectorAll('table.days tbody tr, table.days tfoot tr')].map((r) => [...r.querySelectorAll('td')].map(text));
    expect(days).toEqual([
      ['Brought forward · رصيد مرحل', 'L.E 1,000.00', ''],
      ['Fri 2 Oct', 'L.E 1,500.00', '', 'L.E 1,500.00', 'L.E 2,500.00', '', ''],
      ['Sat 3 Oct', 'L.E 4,560.00', 'L.E 900.00', 'L.E 3,660.00', 'L.E 6,160.00', 'L.E 40.00', '1 void: wrong table'],
      ['Total · الإجمالي', 'L.E 6,060.00', 'L.E 900.00', 'L.E 4,160.00', 'L.E 5,160.00', 'L.E 40.00', ''],
    ]);
  });

  it('asks again for another period', async () => {
    const { page } = await render();

    page['choose']('year');
    await vi.waitFor(() => expect(treasuryAnalytics.mock.lastCall![0]).toBe(`${new Date().getFullYear()}-01-01`));
    page['custom']('from', '2026-09-01');
    await vi.waitFor(() => expect(treasuryAnalytics.mock.lastCall![0]).toBe('2026-09-01'));
    expect(page['period']()).toBe('custom');
  });
});
