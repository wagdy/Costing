import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { CostingApi, StockCountSummary } from '../../core/costing/costing.api';
import { CountsPage } from './counts-page';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

const count = (id: string, kind: StockCountSummary['kind'], status: StockCountSummary['status'] = 'Posted'): StockCountSummary => ({
  id, kind, status, startedAtUtc: '2026-11-02T07:00:00Z', startedBy: 'Omar',
  postedAtUtc: status === 'Draft' ? null : '2026-11-02T08:00:00Z', postedBy: status === 'Draft' ? null : 'Omar', materials: 12,
});

describe('the stock counts', () => {
  async function render(counts: StockCountSummary[]) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: CostingApi,
          useValue: { stockCounts: () => of(counts), approvalRequests: () => of({ pending: [], decided: [] }) },
        },
      ],
    });
    const fixture = TestBed.createComponent(CountsPage);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const buttons = () => [...el.querySelectorAll<HTMLButtonElement>('.toolbar button')];
    return { el, navigate, buttons };
  }

  it('starts with the opening stock, and says how it differs from a periodic count, in both languages', async () => {
    const { el, navigate, buttons } = await render([]);

    expect([...el.querySelectorAll('.kinds .note')].map((n) => text(n).split(':')[0])).toEqual(['Opening stockجرد افتتاحي', 'Periodic countجرد دوري']);
    expect(text(el.querySelector('.kinds')!)).toContain('no shortage or surplus and nothing in the profit');
    expect(buttons().map(text)).toEqual(['inventory Opening stock جرد افتتاحي', 'add Periodic count جرد دوري']);
    expect(buttons()[0].className).toContain('mat-mdc-unelevated-button');
    expect(text(el.querySelector('tbody')!)).toContain('Start with the opening stock');

    buttons()[0].click();
    expect(navigate).toHaveBeenCalledWith(['/costing/counts', expect.any(String)], { queryParams: { kind: 'Opening' } });
  });

  it('then counts periodically, and marks each count with its kind', async () => {
    const { el, navigate, buttons } = await render([count('w1', 'Periodic'), count('o1', 'Opening')]);

    expect(buttons().map(text)).toEqual(['add Periodic count جرد دوري', 'inventory Opening stock جرد افتتاحي']);
    expect([...el.querySelectorAll('tbody tr')].map((r) => text(r.querySelectorAll('td')[1]))).toEqual([
      'Periodic countجرد دوري',
      'Opening stockجرد افتتاحي',
    ]);
    expect(el.querySelectorAll('tbody .kind.opening')).toHaveLength(1);

    buttons()[0].click();
    expect(navigate).toHaveBeenCalledWith(['/costing/counts', expect.any(String)], { queryParams: { kind: 'Periodic' } });
  });

  it('says what kind the draft being filled in is', async () => {
    const { el } = await render([count('d1', 'Opening', 'Draft')]);

    expect(text(el.querySelector('.toolbar')!)).toContain('12 materials counted so far. Opening stockجرد افتتاحيedit_note Continue the count');
  });
});
