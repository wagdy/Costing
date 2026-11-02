import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { CostingApi, MaterialCost, StockCount, countUnit } from '../../core/costing/costing.api';
import { NotifyService } from '../../core/ui/notify.service';
import { CountSheetPage } from './count-sheet-page';

const material = (id: string, unit: MaterialCost['unit'], purchaseUnitSize: number, category: string | null = null, costPerUnit: number | null = null) =>
  ({ id, name: id, code: null, category, unit, purchaseUnitSize, costPerUnit }) as MaterialCost;

const beef = material('beef', 'Gram', 1000, 'Meat', 0.42);
const saffron = material('saffron', 'Gram', 1, 'Spices');
const bun = material('bun', 'Piece', 1, 'Bakery', 5);
const oil = material('oil', 'Millilitre', 1000);
// A prep item never made: priced by its recipe.
const dough = { ...material('dough', 'Gram', 1000, 'Prep'), recipeCostPerUnit: 0.018, costedByRecipe: true } as MaterialCost;

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

describe('counting the stores', () => {
  const stockCount = vi.fn();
  const saveStockCount = vi.fn();
  const postStockCount = vi.fn();

  async function render(kind?: string) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: CostingApi, useValue: { stockCount, saveStockCount, postStockCount, materials: () => of([beef, saffron, bun, oil, dough]) } },
        { provide: NotifyService, useValue: { info: vi.fn(), error: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(CountSheetPage);
    fixture.componentRef.setInput('id', 'count-1');
    if (kind) {
      fixture.componentRef.setInput('kind', kind);
    }
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const button = (label: string) => {
      fixture.detectChanges();
      return [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => text(b).includes(label));
    };
    return { fixture, el, button, page: fixture.componentInstance as unknown as Record<string, any> };
  }

  beforeEach(() => {
    stockCount.mockReset().mockReturnValue(of(null));
    saveStockCount.mockReset().mockImplementation((id: string, lines: StockCount['lines'], kind: StockCount['kind']) =>
      of({ id, status: 'Draft', startedAtUtc: '', startedBy: 'Omar', postedAtUtc: null, postedBy: null, lines, kind }),
    );
    postStockCount.mockReset().mockReturnValue(of({ id: 'count-1', status: 'Posted', lines: [], kind: 'Periodic' }));
  });

  afterEach(() => vi.useRealTimers());

  it('counts weights in kg, but what is bought by the gram in grams', () => {
    expect(countUnit('Gram', 1000)).toEqual({ label: 'kg', size: 1000 });
    expect(countUnit('Gram', 1)).toEqual({ label: 'g', size: 1 });
    expect(countUnit('Millilitre', 1000)).toEqual({ label: 'L', size: 1000 });
    expect(countUnit('Piece', 30)).toEqual({ label: 'pc', size: 1 });
  });

  it('saves itself a moment after the last entry, in the ledger units, leaving empty fields out', async () => {
    const { page } = await render();
    // From here on: the page has rendered, and the autosave waits on a timer.
    vi.useFakeTimers();

    page['enter']('beef', 14.76);
    page['enter']('saffron', 2.5);
    page['enter']('bun', 0);
    page['enter']('oil', '');
    expect(saveStockCount).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1600);

    // One save for the burst. 0 buns is counted at none; the oil left empty is not counted.
    expect(saveStockCount).toHaveBeenCalledTimes(1);
    expect(saveStockCount).toHaveBeenCalledWith(
      'count-1',
      [
        { rawMaterialId: 'beef', countedQuantity: 14760 },
        { rawMaterialId: 'saffron', countedQuantity: 2.5 },
        { rawMaterialId: 'bun', countedQuantity: 0 },
      ],
      'Periodic',
    );
    expect(page['countedCount']()).toBe(3);
  });

  it('saves what is not saved yet before posting, so nothing typed is lost', async () => {
    const { page } = await render();

    page['enter']('beef', 10);
    await page['post']();

    expect(saveStockCount).toHaveBeenCalledWith('count-1', [{ rawMaterialId: 'beef', countedQuantity: 10000 }], 'Periodic');
    expect(postStockCount).toHaveBeenCalledWith('count-1');
    expect(saveStockCount.mock.invocationCallOrder[0]).toBeLessThan(postStockCount.mock.invocationCallOrder[0]);
  });

  it('shows a posted count against what the records said, and what the difference was worth', async () => {
    stockCount.mockReturnValue(
      of({
        id: 'count-1',
        status: 'Posted',
        startedAtUtc: '2026-10-07T07:00:00Z',
        startedBy: 'Omar',
        postedAtUtc: '2026-10-07T07:30:00Z',
        postedBy: 'Omar',
        lines: [{ rawMaterialId: 'beef', countedQuantity: 18900, bookQuantity: 19280, unitCost: 0.42 }],
        kind: 'Periodic',
      } satisfies StockCount),
    );
    const { fixture } = await render();

    const row = (fixture.nativeElement as HTMLElement).querySelector('tbody tr')!;
    expect(row.classList).toContain('deficit');
    expect([...row.querySelectorAll('td')].map((td) => td.textContent?.trim())).toEqual([
      '',
      'beef',
      '18.9 kg',
      '19.28 kg',
      '-0.38 kg',
      'L.E -159.60',
    ]);
    expect((fixture.nativeElement as HTMLElement).querySelector('input')).toBeNull();
    expect(text((fixture.nativeElement as HTMLElement).querySelector('h2')!)).toContain('Periodic count, posted');
  });

  describe('the opening stock', () => {
    it('starts as one when asked, says what it does, and shows what is counted is worth at today’s costs', async () => {
      const { fixture, el, page, button } = await render('Opening');

      expect(page['kind']()).toBe('Opening');
      expect(text(el.querySelector('.kind-note')!)).toContain('no shortage or surplus is recorded, and nothing goes into the profit');
      page['enter']('beef', 10);
      page['enter']('dough', 2);
      page['enter']('oil', 5);
      expect(page['draftValue']()).toEqual({ value: 4200 + 36, unpriced: 1 });
      fixture.detectChanges();
      expect(text(el.querySelector('.worth')!)).toBe("· worth L.E 4,236.00 at today's costs (1 with no price)القيمة بتكلفة اليوم");

      button('Post the opening stock')!.click();
      fixture.detectChanges();
      expect(text(el.querySelector('.sticky')!)).toContain('Open the stock of 3 materials at what was counted, with no shortage or surplus?');
      await page['post']();
      expect(saveStockCount).toHaveBeenCalledWith('count-1', expect.any(Array), 'Opening');
      expect(postStockCount).toHaveBeenCalledWith('count-1');
    });

    it('is told it is the other kind while a draft, and saved so', async () => {
      stockCount.mockReturnValue(
        of({ id: 'count-1', status: 'Draft', startedAtUtc: '', startedBy: 'Omar', postedAtUtc: null, postedBy: null, kind: 'Periodic',
          lines: [{ rawMaterialId: 'bun', countedQuantity: 40, bookQuantity: null, unitCost: null }] } satisfies StockCount),
      );
      const { page } = await render();
      expect(page['kind']()).toBe('Periodic');

      page['chooseKind']('Opening');
      await vi.waitFor(() => expect(saveStockCount).toHaveBeenCalledWith('count-1', [{ rawMaterialId: 'bun', countedQuantity: 40 }], 'Opening'));
    });

    it('posted, shows what each material opened at and its worth, with no difference beside it', async () => {
      stockCount.mockReturnValue(
        of({
          id: 'count-1', status: 'Posted', startedAtUtc: '2026-11-02T07:00:00Z', startedBy: 'Omar', postedAtUtc: '2026-11-02T07:30:00Z',
          postedBy: 'Omar', kind: 'Opening',
          lines: [
            { rawMaterialId: 'beef', countedQuantity: 10000, bookQuantity: 0, unitCost: 0.42 },
            { rawMaterialId: 'bun', countedQuantity: 40, bookQuantity: 0, unitCost: 5 },
            { rawMaterialId: 'oil', countedQuantity: 5000, bookQuantity: 0, unitCost: null },
          ],
        } satisfies StockCount),
      );
      const { el } = await render();

      expect(text(el.querySelector('h2')!)).toContain('Opening stock, posted');
      expect([...el.querySelectorAll('thead th')].map(text)).toEqual(['Codeالكود', 'Materialالخامة', 'Opened atرصيد البداية', 'Costالتكلفة', 'Worthالقيمة']);
      expect([...el.querySelectorAll('tbody tr')].map((r) => [...r.querySelectorAll('td')].slice(1).map(text))).toEqual([
        ['beef', '10 kg', 'L.E 420.00 / kg', 'L.E 4,200.00'],
        ['bun', '40 pc', 'L.E 5.00 / pc', 'L.E 200.00'],
        ['oil', '5 L', '—', 'No price'],
      ]);
      expect(text(el.querySelector('tfoot tr')!)).toBe('Opening stock value · قيمة المخزون الافتتاحيL.E 4,400.00');
      expect(text(el.querySelector('.warn')!)).toContain('1 material has no price');
      expect(el.querySelector('tr.deficit, tr.surplus')).toBeNull();
    });
  });
});
