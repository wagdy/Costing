import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { CostingApi } from '../../core/costing/costing.api';
import { EndOfDay, EndOfDayApi, EndOfDaySequence, EndOfDayUndoPreview } from '../../core/costing/end-of-day.api';
import { NotifyService } from '../../core/ui/notify.service';
import { Approvals } from './approvals';
import { DailySummariesPage } from './daily-summaries-page';
import { EndOfDayUndo } from './end-of-day-undo';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

function closed(date: string, over: Partial<EndOfDay> = {}): EndOfDay {
  return {
    id: `day-${date}`, date, status: 'Submitted', cashAmount: 1_000, cardAmount: 500, taxAmount: 210, voidsAmount: 0, notes: null, salesPhoto: null, invoices: [],
    cashInvoices: 1, cashInvoicesTotal: 150, creditInvoices: 0, creditInvoicesTotal: 0, netSales: 1_500, totalRevenue: 1_710, cashAfterInvoices: 850,
    expectedIntoSafe: 1_560, posted: 0, takingsEntered: 1_560, createdBy: 'Hany', createdAtUtc: `${date}T18:00:00Z`, updatedBy: 'Hany',
    updatedAtUtc: `${date}T18:00:00Z`, submittedBy: 'Hany', submittedAtUtc: `${date}T21:00:00Z`, reopenedBy: null, reopenedAtUtc: null, openingFloat: 0,
    payouts: [], supplierPayments: 0, supplierPaymentsTotal: 0, advances: 0, advancesTotal: 0, cashTax: 140, cashSalesCollected: 1_140, cashPaidOut: 150,
    netCashInTill: 990, ...over,
  };
}

const preview: EndOfDayUndoPreview = {
  date: '2026-11-04', submittedBy: 'Hany', submittedAtUtc: '2026-11-04T21:00:00Z', takings: 1_560, salesItems: 4, postedInvoices: 0, postedInvoicesTotal: 0,
  payouts: 0, payoutsTotal: 0, locked: false,
};

function sequence(over: Partial<EndOfDaySequence> = {}): EndOfDaySequence {
  return {
    lastClosedDate: '2026-11-04', nextExpectedDate: '2026-11-05', today: '2026-11-05', allClosed: false, booksLockedUntil: null, warnings: [],
    lastClosed: preview, ...over,
  };
}

describe('the daily summaries', () => {
  const api = { sequence: vi.fn(), days: vi.fn() };
  const lockBooks = vi.fn();
  const undo = vi.fn();
  const notify = { info: vi.fn(), error: vi.fn() };
  let manager = true;

  async function render() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: EndOfDayApi, useValue: api },
        { provide: CostingApi, useValue: { lockBooks } },
        { provide: EndOfDayUndo, useValue: { undo } },
        { provide: Approvals, useValue: { canApprove: () => manager } },
        { provide: NotifyService, useValue: notify },
      ],
    });
    const fixture = TestBed.createComponent(DailySummariesPage);
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    lockBooks.mockReset();
    undo.mockReset();
    notify.info.mockReset();
    manager = true;
    api.sequence.mockReturnValue(of(sequence()));
    api.days.mockReturnValue(of([
      closed('2026-11-04'),
      closed('2026-11-03', { takingsEntered: null, isClosedDay: true, closedDayReason: 'Plumbing maintenance' }),
      closed('2026-11-02', { status: 'Draft', submittedBy: null, submittedAtUtc: null, reopenedBy: 'Boss', reopenReason: 'Visa typed as cash' }),
    ]));
  });

  it('lists each day handed in over the last month, latest first, with the sequence above it', async () => {
    const { el } = await render();
    expect(api.days).toHaveBeenCalledWith('2026-10-06', '2026-11-05');
    expect([...el.querySelectorAll('.fact strong')].map(text)).toEqual(['Wed 4 Nov 2026', 'Thu 5 Nov 2026', 'Not locked']);
    const rows = [...el.querySelectorAll('tbody tr')];
    expect(rows.map((r) => text(r.querySelector('td')!))).toEqual(['Wed 4 Nov 2026Last closed · آخر يوم مُقفل', 'Tue 3 Nov 2026', 'Mon 2 Nov 2026']);
    expect(text(rows[0].querySelector('td:nth-child(8)')!)).toBe('L.E 1,560.00');
    expect(text(rows[1].querySelector('td:nth-child(8)')!)).toBe('—');
    expect(text(rows[1].querySelector('td:nth-child(2)')!)).toContain('Closed dayيوم مغلقPlumbing maintenance');
    expect(text(rows[2].querySelector('td:nth-child(2)')!)).toBe('Draftمسودةundone by Boss: Visa typed as cash');
    expect(rows[0].querySelector('a')!.getAttribute('href')).toBe('/costing/end-of-day?date=2026-11-04');
  });

  it('offers a manager the undo on the last closed day only, and reloads once it is done', async () => {
    const { fixture, el } = await render();
    const actions = [...el.querySelectorAll('tbody tr')].map((r) => text(r.querySelector('td.action')!));
    expect(actions).toEqual(['undo Undo & Reopen Day · إلغاء وفتح اليوم', '', '']);

    undo.mockResolvedValue({ day: closed('2026-11-04', { status: 'Draft' }) });
    api.sequence.mockReturnValue(of(sequence({ lastClosedDate: '2026-11-03', nextExpectedDate: '2026-11-04', lastClosed: { ...preview, date: '2026-11-03' } })));
    el.querySelector<HTMLButtonElement>('button.undo')!.click();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(undo).toHaveBeenCalledWith(preview);
    expect(api.days).toHaveBeenCalledTimes(2);
    // The lock offered up to the new last closed day, never the one undone.
    expect(el.querySelector<HTMLInputElement>('input[aria-label="Lock the books until"]')!.value).toBe('2026-11-03');
    expect(text(el.querySelector('tbody tr:nth-child(2) td.action')!)).toBe('undo Undo & Reopen Day · إلغاء وفتح اليوم');
  });

  it('offers no undo to anyone but a manager, nor on a day in the books locked', async () => {
    manager = false;
    let { el } = await render();
    expect(el.querySelector('button.undo')).toBeNull();
    expect(el.querySelector('.lock')).toBeNull();
    expect(text(el.querySelector('p.muted.small')!)).toBe('A manager undoes the last closed day to correct it.');

    TestBed.resetTestingModule();
    manager = true;
    api.sequence.mockReturnValue(of(sequence({ booksLockedUntil: '2026-11-04', lastClosed: { ...preview, locked: true } })));
    ({ el } = await render());
    expect(el.querySelector('button.undo')).toBeNull();
    expect(text(el.querySelector('tbody tr td.action')!)).toBe('lock In the books locked');
    expect(text(el.querySelectorAll('.fact strong')[2])).toBe('4 Nov 2026');
  });

  it('locks the books up to a day and unlocks them, a manager’s', async () => {
    api.sequence.mockReturnValue(of(sequence({ booksLockedUntil: '2026-11-01' })));
    const { fixture, el } = await render();
    lockBooks.mockReturnValue(of({ booksLockedUntil: '2026-11-03' }));
    const page = fixture.componentInstance as unknown as { lock(until: string | null): Promise<void> };
    await page.lock('2026-11-03');
    expect(lockBooks).toHaveBeenCalledWith('2026-11-03');
    expect(notify.info).toHaveBeenCalledWith('The books are locked until 2026-11-03. · تم إقفال الدفاتر.');

    lockBooks.mockReturnValue(of({ booksLockedUntil: null }));
    fixture.detectChanges();
    [...el.querySelectorAll<HTMLButtonElement>('.lock button')].find((b) => text(b).includes('Unlock'))!.click();
    await new Promise((r) => setTimeout(r));
    expect(lockBooks).toHaveBeenLastCalledWith(null);
    expect(notify.info).toHaveBeenLastCalledWith('The books are unlocked. · تم فتح الدفاتر.');
  });
});
