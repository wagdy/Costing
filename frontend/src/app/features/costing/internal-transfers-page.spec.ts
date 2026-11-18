import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { Permissions } from '../../core/auth/permissions';
import { CostingApi, MaterialCost } from '../../core/costing/costing.api';
import { InternalTransfer, LocationStock, StockApi, StockPlaces } from '../../core/costing/stock.api';
import { Company } from '../../core/settings/company';
import { InventoryLocation, OperatingMode } from '../../core/settings/company-structure';
import { NotifyService } from '../../core/ui/notify.service';
import { InternalTransfersPage } from './internal-transfers-page';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

const store: InventoryLocation = { id: 'main', branchId: 'b1', name: 'Main Store', nameAr: 'المخزن الرئيسي', kind: 'MainStore', isActive: true, isDefault: true };
const kitchen: InventoryLocation = { id: 'kitchen', branchId: 'b1', name: 'Hot Kitchen', nameAr: 'المطبخ الساخن', kind: 'Kitchen', isActive: true, isDefault: false };

const flour: MaterialCost = {
  id: 'flour', code: 'RM-001', name: 'Flour', category: 'Dry', categoryId: 'dry', unit: 'Gram', purchaseUnit: 'kg', purchaseUnitSize: 1000,
  costPerPurchaseUnit: 30, defaultYieldPercent: 100, quantityOnHand: 10_000, reorderLevel: 0, stockValue: 300, lastPurchaseCostPerPurchaseUnit: 30,
  lastPurchasedAtUtc: null, costPerUnit: 0.03, kind: 'Purchased',
};

const transfer = (more: Partial<InternalTransfer> = {}): InternalTransfer => ({
  id: 't1', number: 'TR-2026-0001', transferDate: '2026-11-18', fromLocationId: 'main', fromLocation: 'Main Store', fromLocationAr: 'المخزن الرئيسي',
  toLocationId: 'kitchen', toLocation: 'Hot Kitchen', toLocationAr: 'المطبخ الساخن', status: 'Posted', notes: 'Evening prep', createdBy: 'Samir',
  createdAtUtc: '2026-11-18T15:00:00Z', voidedAtUtc: null, voidedBy: null, totalCost: 120,
  lines: [{ rawMaterialId: 'flour', material: 'Flour', code: 'RM-001', quantity: 4_000, unit: 'Gram', unitCost: 0.03, lineTotal: 120 }],
  ...more,
});

const stock: LocationStock = {
  branchId: 'b1',
  locations: [
    { id: 'main', name: 'Main Store', nameAr: 'المخزن الرئيسي', kind: 'MainStore', isActive: true },
    { id: 'kitchen', name: 'Hot Kitchen', nameAr: 'المطبخ الساخن', kind: 'Kitchen', isActive: true },
  ],
  rows: [{ rawMaterialId: 'flour', material: 'Flour', code: 'RM-001', unit: 'Gram', isPrepItem: false, byLocation: { main: 6_000, kitchen: 4_000 }, total: 10_000, averageCost: 0.03, value: 300 }],
};

describe('the internal transfers', () => {
  const post = vi.fn();
  const voidTransfer = vi.fn();
  const sheet = vi.fn();
  const locations = vi.fn();
  const notify = { info: vi.fn(), error: vi.fn() };
  let permissions: string[];

  async function render(mode: OperatingMode, transfers: InternalTransfer[] = [transfer()]) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: CostingApi, useValue: { materials: () => of([flour]) } },
        {
          provide: StockApi,
          useValue: { locations, locationStock: () => of(stock), transfers: () => of(transfers), post, void: voidTransfer, sheet },
        },
        { provide: AuthService, useValue: { can: (p: string) => permissions.includes(p) } },
        { provide: NotifyService, useValue: notify },
      ],
    });
    TestBed.inject(Company).settings.update((s) => ({ ...s, operatingMode: mode }));
    const fixture = TestBed.createComponent(InternalTransfersPage);
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, page: fixture.componentInstance as unknown as Record<string, any> };
  }

  beforeEach(() => {
    permissions = [Permissions.InventoryManage, Permissions.CostingView];
    locations.mockReset().mockReturnValue(of({ mode: 'SingleBranch_WithSubStores', branchId: 'b1', locations: [store, kitchen] }));
    post.mockReset().mockReturnValue(of(transfer()));
    voidTransfer.mockReset().mockReturnValue(of(transfer({ status: 'Voided' })));
    sheet.mockReset().mockReturnValue(of(new Blob(['xlsx'])));
    notify.info.mockReset();
    notify.error.mockReset();
  });

  it('asks for nothing in an open-space shop: there is nowhere to move stock', async () => {
    const { el } = await render('SingleBranch_OpenSpace');
    expect(text(el)).toContain('The company keeps its stock in one place');
    expect(el.querySelector('[aria-label="New transfer"]')).toBeNull();
    expect(locations).not.toHaveBeenCalled();
    expect(TestBed.inject(StockPlaces).shown()).toBe(false);
  });

  it('moves stock from the main store to the kitchen, entered as it is counted and sent in its own unit', async () => {
    const { fixture, el, page } = await render('SingleBranch_WithSubStores');
    expect((page['from'] as () => string)()).toBe('main');
    expect((page['to'] as () => string)()).toBe('kitchen');

    page['change'](0, { rawMaterialId: 'flour', quantity: 4 });
    fixture.detectChanges();
    const line = el.querySelector('[aria-label="Transfer lines"] tbody tr')!;
    expect(text(line)).toContain('6 kg');
    expect((page['ready'] as () => boolean)()).toBe(true);

    await page['post']();
    expect(post).toHaveBeenCalledWith({
      id: expect.any(String), fromLocationId: 'main', toLocationId: 'kitchen', lines: [{ rawMaterialId: 'flour', quantity: 4_000 }], notes: null,
    });
    expect(notify.info).toHaveBeenCalledWith('TR-2026-0001 posted: stock moved to Hot Kitchen.');
    // A new transfer, a new id: the one sent is not sent again.
    page['change'](0, { rawMaterialId: 'flour', quantity: 1 });
    await page['post']();
    expect(post.mock.calls[1][0].id).not.toBe(post.mock.calls[0][0].id);
  });

  it('refuses more than the location it leaves has, and the same location twice', async () => {
    const { fixture, el, page } = await render('SingleBranch_WithSubStores');
    page['change'](0, { rawMaterialId: 'flour', quantity: 7 });
    fixture.detectChanges();
    expect(el.querySelector('[aria-label="Transfer lines"] tbody td.short')).not.toBeNull();
    expect((page['ready'] as () => boolean)()).toBe(false);

    page['change'](0, { quantity: 2 });
    (page['to'] as { set: (v: string) => void }).set('main');
    fixture.detectChanges();
    expect(text(el.querySelector('[role="alert"]')!)).toContain('Choose two different locations');
    expect((page['ready'] as () => boolean)()).toBe(false);
  });

  it('lists the transfers, filtered by where they left and went, and what each location holds', async () => {
    const { fixture, el, page } = await render('SingleBranch_WithSubStores', [
      transfer(),
      transfer({ id: 't2', number: 'TR-2026-0002', fromLocationId: 'kitchen', fromLocation: 'Hot Kitchen', toLocationId: 'main', toLocation: 'Main Store', notes: null }),
    ]);
    const rows = () => [...el.querySelectorAll('[aria-label="Transfers"] tbody tr')].map((r) => text(r));
    expect(rows()).toHaveLength(2);
    expect(rows()[0]).toContain('TR-2026-0001');
    expect(rows()[0]).toContain('Main Store → Hot Kitchen');
    expect(rows()[0]).toContain('Flour 4 kg');

    (page['fromFilter'] as { set: (v: string) => void }).set('kitchen');
    fixture.detectChanges();
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toContain('TR-2026-0002');

    const byLocation = el.querySelector('[aria-label="Stock by location"]')!;
    expect([...byLocation.querySelectorAll('thead th')].map((h) => text(h))).toEqual([
      'Materialالخامة', 'Main Storeالمخزن الرئيسي', 'Hot Kitchenالمطبخ الساخن', 'Totalالإجمالي', 'Valueالقيمة',
    ]);
    expect(text(byLocation.querySelector('tbody tr')!)).toContain('6 kg 4 kg 10 kg');
  });

  it('shows a storekeeper no costs, voids a transfer once confirmed, prints its slip and sends the workbook', async () => {
    permissions = [Permissions.InventoryManage];
    const { el, page } = await render('SingleBranch_WithSubStores', [transfer({ totalCost: null, lines: [{ ...transfer().lines[0], unitCost: null, lineTotal: null }] })]);
    expect(text(el.querySelector('[aria-label="Transfers"] thead')!)).not.toContain('Worth');
    expect(text(el.querySelector('[aria-label="Stock by location"] thead')!)).not.toContain('Value');

    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    await page['voidTransfer'](transfer());
    expect(voidTransfer).not.toHaveBeenCalled();
    await page['voidTransfer'](transfer());
    expect(voidTransfer).toHaveBeenCalledWith('t1');
    expect(confirm.mock.calls[0][0]).toContain('Its stock goes back to Main Store');

    let written = '';
    const slip = { document: { write: (html: string) => (written = html), close: vi.fn() }, focus: vi.fn(), print: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(slip as unknown as Window);
    page['printSlip'](transfer({ totalCost: null }));
    expect(written).toContain('TR-2026-0001');
    expect(written).toContain('Hot Kitchen · المطبخ الساخن');
    expect(written).toContain('Received by · المستلِم');
    expect(written).not.toContain('Unit cost');
    expect(slip.print).toHaveBeenCalled();

    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:transfers');
    await page['downloadSheet']();
    expect(sheet).toHaveBeenCalledWith(page['fromDay'](), page['toDay']());
  });
});
