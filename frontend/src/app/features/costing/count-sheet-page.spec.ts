import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { Permissions } from '../../core/auth/permissions';
import { CostingApi, CountItem, MaterialCost, StockCount, countUnit } from '../../core/costing/costing.api';
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
const all = [beef, saffron, bun, oil, dough];

// What the count sheet's list says of each: nothing of stock or cost.
const item = (m: MaterialCost): CountItem => ({
  id: m.id, code: m.code, name: m.name, categoryId: m.category ?? 'other', category: m.category ?? 'Other · أخرى', categoryAr: null, unit: m.unit,
  purchaseUnit: countUnit(m.unit, m.purchaseUnitSize).label, purchaseUnitSize: m.purchaseUnitSize, isPrepItem: m.id === 'dough', isSpotCheckItem: false,
  isArchived: false,
});

const draft = (overrides: Partial<StockCount> = {}): StockCount => ({
  id: 'count-1', status: 'Draft', startedAtUtc: '', startedBy: 'Samir', postedAtUtc: null, postedBy: null, kind: 'Periodic', lines: [], ...overrides,
});

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

describe('counting the stores', () => {
  const stockCount = vi.fn();
  const saveStockCount = vi.fn();
  const postStockCount = vi.fn();
  const submitStockCount = vi.fn();
  const requestRecount = vi.fn();
  const materials = vi.fn();
  const notify = { info: vi.fn(), error: vi.fn() };
  let permissions: string[] = [Permissions.InventoryManage, Permissions.CostingView];
  let listed = all;

  async function render(kind?: string) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: CostingApi,
          useValue: {
            stockCount, saveStockCount, postStockCount, submitStockCount, requestRecount, materials,
            countItems: () => of(listed.map(item)), settings: () => of({ foodCostTargetPercent: 30, varianceTolerancePercent: 5 }),
          },
        },
        { provide: NotifyService, useValue: notify },
        { provide: AuthService, useValue: { can: (p: string) => permissions.includes(p) } },
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
    permissions = [Permissions.InventoryManage, Permissions.CostingView];
    listed = all;
    localStorage.removeItem('costing.blindCount');
    stockCount.mockReset().mockReturnValue(of(null));
    materials.mockReset().mockReturnValue(of(all));
    saveStockCount.mockReset().mockImplementation((id: string, lines: StockCount['lines'], kind: StockCount['kind']) =>
      of({ id, status: 'Draft', startedAtUtc: '', startedBy: 'Omar', postedAtUtc: null, postedBy: null, lines, kind }),
    );
    postStockCount.mockReset().mockReturnValue(of({ id: 'count-1', status: 'Posted', lines: [], kind: 'Periodic' }));
    submitStockCount.mockReset().mockReturnValue(of(draft({ review: 'Submitted', submittedBy: 'Samir', blind: true })));
    requestRecount.mockReset();
    notify.info.mockReset();
    notify.error.mockReset();
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
    page['note']('beef', ' two trays in the freezer ');
    expect(saveStockCount).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1600);

    // One save for the burst. 0 buns is counted at none; the oil left empty is not counted.
    expect(saveStockCount).toHaveBeenCalledTimes(1);
    expect(saveStockCount).toHaveBeenCalledWith(
      'count-1',
      [
        { rawMaterialId: 'beef', countedQuantity: 14760, note: 'two trays in the freezer' },
        { rawMaterialId: 'saffron', countedQuantity: 2.5 },
        { rawMaterialId: 'bun', countedQuantity: 0 },
      ],
      'Periodic',
      undefined,
      false,
    );
    expect(page['countedCount']()).toBe(3);
  });

  it('saves what is not saved yet before posting, so nothing typed is lost', async () => {
    const { page } = await render();

    page['enter']('beef', 10);
    await page['post']();

    expect(saveStockCount).toHaveBeenCalledWith('count-1', [{ rawMaterialId: 'beef', countedQuantity: 10000 }], 'Periodic', undefined, false);
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
        // Handed in, then reconciled and posted: the review is over.
        review: 'Submitted',
        submittedBy: 'Samir',
        submittedAtUtc: '2026-10-07T07:20:00Z',
      } satisfies StockCount),
    );
    const { fixture } = await render();
    expect((fixture.nativeElement as HTMLElement).querySelector('.review-banner')).toBeNull();

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

  describe('counted blind (الجرد الأعمى)', () => {
    beforeEach(() => (permissions = [Permissions.InventoryManage]));

    it('asks for the count blind, reads no costs, shows no figure of the records, and hands the count in instead of posting it', async () => {
      stockCount.mockReturnValue(of(draft({ blind: true, lines: [{ rawMaterialId: 'beef', countedQuantity: 9400, bookQuantity: null, unitCost: null }] })));
      const { el, page, button } = await render();

      expect(stockCount).toHaveBeenCalledWith('count-1', true);
      expect(materials).not.toHaveBeenCalled();
      expect(text(el.querySelector('.blind-badge')!)).toContain('Blind count · جرد أعمى');
      expect(el.querySelector('mat-slide-toggle')).toBeNull();
      expect(el.querySelector('.book')).toBeNull();
      expect(el.querySelector('.reconcile')).toBeNull();
      expect(button('Post the count')).toBeUndefined();

      button('Hand in for review')!.click();
      await vi.waitFor(() => expect(submitStockCount).toHaveBeenCalledWith('count-1', true));
      expect(page['count']().review).toBe('Submitted');
      // A correction before the review is handed in again.
      await vi.waitFor(() => expect(button('Hand in again · إعادة الإرسال للمراجعة')).toBeDefined());
    });

    it('shows which lines to weigh again and why, never what they should be', async () => {
      stockCount.mockReturnValue(
        of(draft({
          blind: true, review: 'RecountRequested', reviewedBy: 'Karim', reviewNote: 'The scale was off',
          lines: [
            { rawMaterialId: 'beef', countedQuantity: 7000, bookQuantity: null, unitCost: null, recountRequested: true },
            { rawMaterialId: 'bun', countedQuantity: 40, bookQuantity: null, unitCost: null },
          ],
        })),
      );
      const { el } = await render();

      expect(text(el.querySelector('.review-banner')!)).toBe('replay1 line to weigh again · مطلوب إعادة جرد — asked by Karim: “The scale was off”');
      const flagged = [...el.querySelectorAll('.item.recount')];
      expect(flagged.map((i) => text(i.querySelector('.name')!))).toEqual(['beef']);
      expect(text(flagged[0])).toContain('Recount needed · مطلوب إعادة جرد');
      expect(text(flagged[0])).not.toMatch(/Book|7 kg|الدفتري/);
    });
  });

  describe('reconciled (مراجعة الفروقات)', () => {
    const handedIn = () =>
      draft({
        review: 'Submitted', submittedBy: 'Samir', submittedAtUtc: '2026-11-13T08:00:00Z',
        lines: [
          { rawMaterialId: 'beef', countedQuantity: 9000, bookQuantity: 10000, unitCost: 0.42, note: 'one tray thawing' },
          { rawMaterialId: 'bun', countedQuantity: 44, bookQuantity: 40, unitCost: 5 },
          { rawMaterialId: 'oil', countedQuantity: 4990, bookQuantity: 5000, unitCost: 0.08 },
        ],
      });

    it('sets each line against the records, the worst first, flagging what is beyond the tolerance', async () => {
      stockCount.mockReturnValue(of(handedIn()));
      const { el } = await render();

      expect(stockCount).toHaveBeenCalledWith('count-1', false);
      expect(text(el.querySelector('.review-banner')!)).toContain('Handed in by Samir');
      // The book beside each field, for who reconciles.
      const beefCard = [...el.querySelectorAll('.item')].find((i) => text(i.querySelector('.name')!) === 'beef')!;
      expect(text(beefCard.querySelector('.book')!)).toBe('Book · الدفتري 10 kg');
      const rows = [...el.querySelectorAll('.reconcile-table tbody tr')];
      expect(rows.map((r) => [...r.querySelectorAll('td')].slice(1).map(text))).toEqual([
        ['beef', '10 kg', '9 kg', '-1 kg Short · عجز', 'L.E 420.00 / kg', 'L.E -420.00', 'one tray thawing'],
        ['bun', '40 pc', '44 pc', '+4 pc Over · زيادة', 'L.E 5.00 / pc', 'L.E 20.00', ''],
        ['oil', '5 L', '4.99 L', '-0.01 L', 'L.E 80.00 / L', 'L.E -0.80', ''],
      ]);
      expect(rows.map((r) => [r.classList.contains('short'), r.classList.contains('over')])).toEqual([[true, false], [false, true], [false, false]]);
      expect(text(el.querySelector('.reconcile-table tfoot')!)).toContain('L.E -400.80');
    });

    it('sends the picked lines back to be weighed again, with a note', async () => {
      stockCount.mockReturnValue(of(handedIn()));
      requestRecount.mockReturnValue(of(draft({ review: 'RecountRequested', lines: handedIn().lines.map((l) => ({ ...l, recountRequested: l.rawMaterialId === 'beef' })) })));
      const { page, button } = await render();

      expect(button('Recount needed')!.disabled).toBe(true);
      page['pickRecount']('beef', true);
      page['recountNote'].set('Weigh the beef again');
      expect(button('Recount needed · مطلوب إعادة جرد (1)')!.disabled).toBe(false);
      await page['requestRecount']();

      expect(requestRecount).toHaveBeenCalledWith('count-1', ['beef'], 'Weigh the beef again');
      expect(page['recountPick']().size).toBe(0);
      expect(notify.info).toHaveBeenCalledWith(expect.stringContaining('1 line sent back'));
    });

    it('counts blind on this device when chosen: the records read again without their figures', async () => {
      stockCount.mockReturnValue(of(handedIn()));
      const { fixture, el, page } = await render();
      expect(el.querySelector('.reconcile')).not.toBeNull();

      stockCount.mockReturnValue(of({ ...handedIn(), blind: true, lines: handedIn().lines.map((l) => ({ ...l, bookQuantity: null, unitCost: null })) }));
      await page['chooseBlind'](true);
      fixture.detectChanges();

      expect(stockCount).toHaveBeenLastCalledWith('count-1', true);
      expect(localStorage.getItem('costing.blindCount')).toBe('1');
      expect(el.querySelector('.reconcile')).toBeNull();
      expect(el.querySelector('.book')).toBeNull();
    });
  });

  it('lists a spot count’s materials alone, and says only what is counted moves', async () => {
    stockCount.mockReturnValue(of(draft({ scope: 'Spot', scopeMaterialIds: ['beef', 'bun'], scopeLabel: 'Daily critical items' })));
    const { el } = await render();

    expect(text(el.querySelector('.scope-line')!)).toContain('Daily critical items· 2 materials; only what is counted moves');
    expect([...el.querySelectorAll('.item .name')].map((n) => text(n))).toEqual(['bun', 'beef']);
    expect(el.querySelector('.kind-choice')).toBeNull();
  });

  it('prints a blind sheet: code, material, category and unit, a box to count in, the signatures, and no figure', async () => {
    const written: string[] = [];
    const sheet = { document: { write: (h: string) => written.push(h), close: vi.fn() }, focus: vi.fn(), print: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(sheet as unknown as Window);
    // A name is written into the sheet as text, never as markup.
    listed = [...all, { ...beef, id: 'sneaky', name: '<img src=x onerror=alert(1)>' } as MaterialCost];
    stockCount.mockReturnValue(of(draft({ lines: [{ rawMaterialId: 'beef', countedQuantity: 9000, bookQuantity: 10000, unitCost: 0.42 }] })));
    const { button } = await render();

    button('Print blind sheet')!.click();

    expect(open).toHaveBeenCalledWith('', '_blank');
    expect(sheet.print).toHaveBeenCalled();
    const html = written.join('');
    expect(html).toContain('Blind count sheet · كشف جرد أعمى');
    expect(html).toContain('<td>beef</td><td>Meat</td><td>kg</td><td class="box"></td>');
    expect(html).toContain('Counted by · القائم بالجرد');
    expect(html).not.toContain('10 kg');
    expect(html).not.toContain('0.42');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img');
    open.mockRestore();
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
      expect(saveStockCount).toHaveBeenCalledWith('count-1', expect.any(Array), 'Opening', undefined, false);
      expect(postStockCount).toHaveBeenCalledWith('count-1');
    });

    it('is told it is the other kind while a draft, and saved so', async () => {
      stockCount.mockReturnValue(of(draft({ startedBy: 'Omar', lines: [{ rawMaterialId: 'bun', countedQuantity: 40, bookQuantity: null, unitCost: null }] })));
      const { page } = await render();
      expect(page['kind']()).toBe('Periodic');

      page['chooseKind']('Opening');
      await vi.waitFor(() => expect(saveStockCount).toHaveBeenCalledWith('count-1', [{ rawMaterialId: 'bun', countedQuantity: 40 }], 'Opening', undefined, false));
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
