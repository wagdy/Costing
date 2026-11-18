import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { Permissions } from '../../core/auth/permissions';
import { CostingApi, CountPresets, StockCountSummary } from '../../core/costing/costing.api';
import { NotifyService } from '../../core/ui/notify.service';
import { CountsPage } from './counts-page';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

const count = (id: string, kind: StockCountSummary['kind'], status: StockCountSummary['status'] = 'Posted', more: Partial<StockCountSummary> = {}): StockCountSummary => ({
  id, kind, status, startedAtUtc: '2026-11-02T07:00:00Z', startedBy: 'Omar',
  postedAtUtc: status === 'Draft' ? null : '2026-11-02T08:00:00Z', postedBy: status === 'Draft' ? null : 'Omar', materials: 12, ...more,
});

const presets: CountPresets = {
  from: '2026-10-15', to: '2026-11-13', tolerancePercent: 5,
  presets: [
    { key: 'critical', name: 'Daily critical items', nameAr: 'أصناف الجرد اليومي المحددة', materialIds: ['beef', 'cheese'] },
    { key: 'classA', name: 'Top class-A materials', nameAr: 'أصناف الفئة A الأعلى قيمة', materialIds: ['beef'] },
    { key: 'highVariance', name: 'High-variance materials', nameAr: 'الأصناف الأكثر انحرافًا', materialIds: [] },
  ],
  categories: [{ categoryId: 'dairy', name: 'Dairy', nameAr: 'ألبان', materialIds: ['cheese', 'milk'] }],
  stations: [{ stationId: 'bar', name: 'Bar & Barista', nameAr: 'البار والباريستا', code: 'BAR', materialIds: ['coffee', 'milk'] }],
};

describe('the stock counts', () => {
  const saveStockCount = vi.fn();
  let permissions: string[] = [Permissions.InventoryManage, Permissions.CostingView];

  async function render(counts: StockCountSummary[]) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: CostingApi,
          useValue: {
            stockCounts: () => of(counts), approvalRequests: () => of({ pending: [], decided: [] }), countPresets: () => of(presets), saveStockCount,
          },
        },
        { provide: AuthService, useValue: { can: (p: string) => permissions.includes(p) } },
        { provide: NotifyService, useValue: { info: vi.fn(), error: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(CountsPage);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const buttons = () => [...el.querySelectorAll<HTMLButtonElement>('.toolbar:not(.smart) button')];
    return { fixture, el, navigate, buttons, page: fixture.componentInstance as unknown as Record<string, any> };
  }

  beforeEach(() => {
    permissions = [Permissions.InventoryManage, Permissions.CostingView];
    saveStockCount.mockReset().mockReturnValue(of({}));
  });

  it('starts with the opening stock, and says what each kind of count is, each with its (ⓘ)', async () => {
    const { el, navigate, buttons } = await render([]);

    expect([...el.querySelectorAll('.kinds .note')].map((n) => text(n).split(':')[0])).toEqual([
      'Opening stockجرد افتتاحي', 'Full countجرد شامل', 'Daily spot countجرد يومي سريع', 'Blind countالجرد الأعمى',
    ]);
    expect([...el.querySelectorAll('.kinds app-info-tip button')].map((b) => b.getAttribute('aria-label'))).toEqual([
      'About Opening stock · جرد افتتاحي', 'About Full periodic count · جرد دوري شامل', 'About Daily spot count · جرد يومي سريع / جزئي',
      'About Blind count mode · وضع الجرد الأعمى',
    ]);
    expect(buttons().map(text)).toEqual(['inventory Opening stock جرد افتتاحي', 'add Full count جرد شامل']);
    expect(buttons()[0].className).toContain('mat-mdc-unelevated-button');
    expect(text(el.querySelector('tbody')!)).toContain('Start with the opening stock');

    buttons()[0].click();
    expect(navigate).toHaveBeenCalledWith(['/costing/counts', expect.any(String)], { queryParams: { kind: 'Opening' } });
  });

  it('then counts periodically, and marks each count with its kind and scope', async () => {
    const { el, navigate, buttons } = await render([count('w1', 'Periodic'), count('s1', 'Periodic', 'Posted', { scope: 'Spot', scopeLabel: 'Daily critical items' }), count('o1', 'Opening')]);

    expect(buttons().map(text)).toEqual(['add Full count جرد شامل', 'inventory Opening stock جرد افتتاحي']);
    expect([...el.querySelectorAll('tbody tr')].map((r) => text(r.querySelectorAll('td')[1]))).toEqual([
      'Periodic countجرد دوري',
      'Periodic countجرد دوريSpot countجرد يومي سريع',
      'Opening stockجرد افتتاحي',
    ]);
    expect(el.querySelectorAll('tbody .kind.opening')).toHaveLength(1);

    buttons()[0].click();
    expect(navigate).toHaveBeenCalledWith(['/costing/counts', expect.any(String)], { queryParams: { kind: 'Periodic' } });
  });

  it('starts a spot count in one click from a ready list, with what it covers', async () => {
    const { el, navigate } = await render([count('w1', 'Periodic')]);
    const presetButtons = [...el.querySelectorAll<HTMLButtonElement>('.spot .presets button')];
    expect(presetButtons.map((b) => [text(b), b.disabled])).toEqual([
      ['star Daily critical items · أصناف الجرد اليومي المحددة 2', false],
      ['workspace_premium Top class-A materials · أصناف الفئة A الأعلى قيمة 1', false],
      ['trending_down High-variance materials · الأصناف الأكثر انحرافًا 0', true],
    ]);

    presetButtons[0].click();
    await vi.waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(saveStockCount).toHaveBeenCalledWith(expect.any(String), [], 'Periodic', {
      scope: 'Spot', scopeMaterialIds: ['beef', 'cheese'], scopeLabel: 'Daily critical items',
    });
    expect(navigate).toHaveBeenCalledWith(['/costing/counts', saveStockCount.mock.lastCall![0]]);
  });

  it('starts a spot count of one category', async () => {
    const { page } = await render([]);
    page['startCategory']('dairy');
    await vi.waitFor(() => expect(saveStockCount).toHaveBeenCalled());
    expect(saveStockCount.mock.lastCall![3]).toEqual({ scope: 'Spot', scopeMaterialIds: ['cheese', 'milk'], scopeLabel: 'Dairy · ألبان' });
  });

  it('starts a spot count of one kitchen station, for its shift close', async () => {
    const { el, page } = await render([]);
    expect(el.querySelector('[aria-label="Spot count by station"]')).not.toBeNull();
    page['startStation']('bar');
    await vi.waitFor(() => expect(saveStockCount).toHaveBeenCalled());
    expect(saveStockCount.mock.lastCall![3]).toEqual({ scope: 'Spot', scopeMaterialIds: ['coffee', 'milk'], scopeLabel: 'Bar & Barista · البار والباريستا' });
  });

  it('says what kind the draft being filled in is, and offers a reviewer a count handed in', async () => {
    const { el } = await render([count('d1', 'Opening', 'Draft')]);
    expect(text(el.querySelector('.toolbar')!)).toContain('12 materials counted so far. Opening stockجرد افتتاحيedit_note Continue the count');
    // No spot count is started while one is open.
    expect(el.querySelector('.spot')).toBeNull();
  });

  it('marks a spot count handed in for review, for whoever reconciles it', async () => {
    const { el } = await render([count('d1', 'Periodic', 'Draft', { scope: 'Spot', scopeLabel: 'Daily critical items', scopeSize: 2, review: 'Submitted', materials: 2 })]);
    expect(text(el.querySelector('.toolbar')!)).toContain(
      '2 materials counted so far of 2. Periodic countجرد دوريDaily critical itemsجرد يومي سريعHanded in for reviewبانتظار المراجعةrate_review Review the count · مراجعة الجرد',
    );
  });
});
