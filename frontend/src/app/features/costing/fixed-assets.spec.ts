import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { CostingApi, FixedAssetRegister, FixedAssetRow } from '../../core/costing/costing.api';
import { NotifyService } from '../../core/ui/notify.service';
import { Approvals } from './approvals';
import { BusinessDay } from './financials';
import { DisposeAssetDialog, DisposeAssetDialogData, FixedAssetActions, FixedAssetDialog, FixedAssetDialogData, bookValueOn } from './fixed-asset-dialogs';
import { FixedAssetsPage } from './fixed-assets-page';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();
const cells = (row: Element) => [...row.querySelectorAll(':scope > td')].map(text);

function asset(over: Partial<FixedAssetRow>): FixedAssetRow {
  return {
    id: 'espresso', assetCode: 'FA-0001', name: 'La Marzocco espresso machine', category: 'KitchenEquipment', location: 'Bar', notes: null,
    purchaseDate: '2026-03-15', purchaseCost: 120_000, salvageValue: 12_000, usefulLifeMonths: 60, monthlyDepreciation: 1_800, monthsCharged: 9,
    monthsLeft: 51, accumulatedDepreciation: 16_200, netBookValue: 103_800, depreciationThisMonth: 1_800, lastMonth: '2031-02-01', status: 'Active',
    paidFrom: 'Bank', purchaseTransactionId: 'bought', disposalDate: null, saleProceeds: null, saleFund: null, saleTransactionId: null,
    netBookValueAtDisposal: null, gainOrLoss: null, disposalNotes: null, createdBy: 'Omar', createdAtUtc: '2026-03-15T10:00:00Z',
    ...over,
  };
}

const espresso = asset({});
const oven = asset({
  id: 'oven', assetCode: 'FA-0002', name: 'Combi oven', location: 'Kitchen', purchaseDate: '2024-11-01', purchaseCost: 36_000, salvageValue: 0,
  monthlyDepreciation: 600, monthsCharged: 24, accumulatedDepreciation: 14_400, netBookValue: 21_600, depreciationThisMonth: 600, paidFrom: null,
  purchaseTransactionId: null,
});
const stool = asset({
  id: 'stool', assetCode: 'FA-0003', name: 'Bar stool', category: 'Furniture', purchaseDate: '2026-05-02', purchaseCost: 600, salvageValue: 0,
  usefulLifeMonths: 36, monthlyDepreciation: 16.67, monthsCharged: 0, accumulatedDepreciation: 0, netBookValue: 600, depreciationThisMonth: 0,
  status: 'Sold', paidFrom: 'Safe', purchaseTransactionId: 'stool-bought', disposalDate: '2026-05-20', saleProceeds: 700, saleFund: 'Safe',
  saleTransactionId: 'stool-sold', netBookValueAtDisposal: 600, gainOrLoss: 100,
});

const register: FixedAssetRegister = {
  year: 2026, month: 11, asOf: '2026-11-30', totalCost: 156_000, accumulatedDepreciation: 30_600, netBookValue: 125_400, depreciationThisMonth: 2_400,
  activeCount: 2, fullyDepreciatedCount: 0, disposedCount: 1, boughtFromSafe: 0, boughtFromBank: 120_000, ownedAlreadyAdded: 0, saleProceeds: 0,
  disposalGainOrLoss: 0,
  categories: [{ category: 'KitchenEquipment', count: 2, cost: 156_000, accumulatedDepreciation: 30_600, netBookValue: 125_400, depreciationThisMonth: 2_400 }],
  assets: [espresso, oven, stool],
  locations: ['Bar', 'Kitchen'],
};

describe('fixed assets register (سجل الأصول الثابتة)', () => {
  const fixedAssets = vi.fn();
  const exportFixedAssets = vi.fn();
  const acquireFixedAsset = vi.fn();
  const disposeFixedAsset = vi.fn();
  const reinstateFixedAsset = vi.fn();
  const open = vi.fn();
  const requested = vi.fn();
  const remove = vi.fn();
  const info = vi.fn();
  const canApprove = signal(true);

  beforeEach(() => {
    fixedAssets.mockReset().mockReturnValue(of(register));
    exportFixedAssets.mockReset().mockReturnValue(of(new Blob()));
    acquireFixedAsset.mockReset();
    disposeFixedAsset.mockReset();
    reinstateFixedAsset.mockReset().mockReturnValue(of({ id: 'oven', assetCode: 'FA-0002' }));
    open.mockReset();
    requested.mockReset();
    remove.mockReset().mockResolvedValue('Applied');
    info.mockReset();
    canApprove.set(true);
    URL.createObjectURL = vi.fn(() => 'blob:register');
    URL.revokeObjectURL = vi.fn();
  });

  function providers() {
    return [
      provideRouter([]),
      { provide: CostingApi, useValue: { fixedAssets, exportFixedAssets, acquireFixedAsset, disposeFixedAsset, reinstateFixedAsset } },
      { provide: MatDialog, useValue: { open } },
      { provide: NotifyService, useValue: { info, error: vi.fn() } },
      { provide: BusinessDay, useValue: { today: () => Promise.resolve('2026-11-17') } },
      {
        provide: Approvals,
        useValue: { canApprove, pendingFor: () => undefined, waitingToBeMade: () => [], refresh: vi.fn(), requested, delete: remove },
      },
    ];
  }

  it('shows the four cards, every asset with its depreciation, and sorts by any column', async () => {
    TestBed.configureTestingModule({ providers: providers() });
    const fixture = TestBed.createComponent(FixedAssetsPage);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect([...el.querySelectorAll('.tiles .tile strong')].map(text)).toEqual(['L.E 156,000.00', 'L.E 30,600.00', 'L.E 125,400.00', 'L.E 2,400.00']);
    expect(el.querySelectorAll('.tiles app-info-tip').length).toBe(4);
    const rows = () => [...el.querySelectorAll('table.register tbody tr')];
    expect(cells(rows()[0]).slice(0, 10)).toEqual([
      'FA-0001', 'La Marzocco espresso machine Bar · paid by the bank', 'Kitchen equipmentمعدات المطبخ', '15 Mar 2026', 'L.E 120,000.00',
      '60 mo 9 charged', 'L.E 1,800.00', 'L.E 16,200.00', 'L.E 103,800.00', 'Activeنشط',
    ]);
    expect(rows()[0].querySelector('.badge')!.classList).toContain('Active');
    expect(cells(rows()[2])[1]).toContain('Sold 20 May 2026 for L.E 700.00 · gain L.E 100.00');

    // The dearest book value first, then the cheapest; the totals are of what is shown.
    const header = (label: string) => [...el.querySelectorAll<HTMLButtonElement>('th .sort-head')].find((b) => text(b).startsWith(label))!;
    header('Net book value').click();
    fixture.detectChanges();
    expect(rows().map((r) => cells(r)[0])).toEqual(['FA-0001', 'FA-0002', 'FA-0003']);
    header('Net book value').click();
    fixture.detectChanges();
    expect(rows().map((r) => cells(r)[0])).toEqual(['FA-0003', 'FA-0002', 'FA-0001']);
    expect(el.querySelector('th[aria-sort="ascending"]')).not.toBeNull();
    expect(cells(el.querySelector('table.register tfoot tr')!)).toContain('L.E 125,400.00');

    // The register in Excel, for the month shown.
    const page = fixture.componentInstance as unknown as Record<string, any>;
    await page['export']();
    expect(exportFixedAssets).toHaveBeenCalledWith(expect.any(Number), expect.any(Number));
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it('works out the monthly depreciation as the asset is filled in, owned already a manager’s only', async () => {
    const close = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        ...providers(),
        { provide: MatDialogRef, useValue: { close } },
        { provide: MAT_DIALOG_DATA, useValue: { asset: null, canApprove: false, today: '2026-11-17', locations: ['Bar'] } satisfies FixedAssetDialogData },
      ],
    });
    const fixture = TestBed.createComponent(FixedAssetDialog);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const page = fixture.componentInstance as unknown as Record<string, any>;

    page['name'] = 'Walk-in chiller';
    page['cost'].set(60_000);
    page['salvage'].set(6_000);
    page['life'].set(60);
    page['date'].set('2026-11-02');
    fixture.detectChanges();
    expect([...el.querySelectorAll('.breakdown dd')].map(text).slice(0, 2)).toEqual(['L.E 54,000.00', 'L.E 900.00']);
    expect(text(el.querySelector('.breakdown')!)).toContain('Charged from November 2026 to October 2031');
    const owned = [...el.querySelectorAll('mat-button-toggle')].find((t) => text(t).startsWith('Owned already'))!;
    expect(owned.classList).toContain('mat-button-toggle-disabled');

    // More salvage than cost is refused; put right, it goes as a request from the bank.
    page['salvage'].set(70_000);
    page['done']();
    expect(page['problem']()).toContain('less than the cost');
    page['salvage'].set(6_000);
    page['paidFrom'].set('Bank');
    page['done']();
    expect(close).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Walk-in chiller', purchaseCost: 60_000, salvageValue: 6_000, usefulLifeMonths: 60, paidFrom: 'Bank', purchaseDate: '2026-11-02',
    }));
  });

  it('sets what a sale brings in against what is left of the cost', async () => {
    const close = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        ...providers(),
        { provide: MatDialogRef, useValue: { close } },
        { provide: MAT_DIALOG_DATA, useValue: { asset: espresso, canApprove: true, today: '2027-01-10' } satisfies DisposeAssetDialogData },
      ],
    });
    const fixture = TestBed.createComponent(DisposeAssetDialog);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const page = fixture.componentInstance as unknown as Record<string, any>;

    // Sold in January 2027: March to December charged, 102,000 left; for 95,000, a loss of 7,000.
    expect(bookValueOn(espresso, '2027-01-10')).toBe(102_000);
    page['proceeds'].set(95_000);
    page['fund'].set('Bank');
    fixture.detectChanges();
    expect([...el.querySelectorAll('.breakdown dd')].map(text)).toEqual(['L.E 102,000.00', 'L.E 95,000.00', 'L.E -7,000.00']);
    expect(el.querySelector('.breakdown .net')!.classList).toContain('loss');
    page['done']();
    expect(close).toHaveBeenCalledWith({ date: '2027-01-10', saleProceeds: 95_000, fund: 'Bank', notes: null, reason: null });

    // Written off: nothing for it, the whole book value lost.
    page['sell'].set(false);
    fixture.detectChanges();
    expect(text(el.querySelectorAll('.breakdown dd')[2])).toBe('L.E -102,000.00');
  });

  it('asks a manager for what leaves the safe, and undoes a sale by voiding its entry', async () => {
    TestBed.configureTestingModule({ providers: providers() });
    const actions = TestBed.inject(FixedAssetActions);
    canApprove.set(false);
    open.mockReturnValue({
      afterClosed: () =>
        of({ name: 'Fryer', category: 'KitchenEquipment', location: null, notes: null, purchaseDate: '2026-11-17', purchaseCost: 24_000, salvageValue: 0,
          usefulLifeMonths: 48, paidFrom: 'Safe', reason: 'The old one died' }),
    });
    const request = { id: 'r1', summary: 'Fixed asset bought (CAPEX) · Fryer' };
    acquireFixedAsset.mockReturnValue(of({ outcome: 'Requested', assetId: 'a', assetCode: null, transaction: null, request }));
    expect(await actions.acquire(['Bar'])).toBe(true);
    expect(open.mock.lastCall![1].data).toEqual({ asset: null, canApprove: false, today: '2026-11-17', locations: ['Bar'] });
    expect(acquireFixedAsset).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Fryer', paidFrom: 'Safe', reason: 'The old one died', requestId: expect.any(String), assetId: expect.any(String), transactionId: expect.any(String),
    }));
    expect(requested).toHaveBeenCalledWith({ outcome: 'Requested', request });

    // A sale undone: its entry voided, what it brought in back out. A write-off: undone here.
    expect(await actions.undoDisposal(stool)).toBe(true);
    expect(remove).toHaveBeenCalledWith('Treasury', 'stool-sold', 'the sale of FA-0003 Bar stool', expect.stringContaining('goes back out of the safe'));
    expect(await actions.undoDisposal({ ...oven, status: 'Disposed' })).toBe(true);
    expect(reinstateFixedAsset).toHaveBeenCalledWith('oven');
    // A paid one leaves with its purchase voided.
    expect(await actions.remove(espresso)).toBe(true);
    expect(remove).toHaveBeenLastCalledWith('Treasury', 'bought', 'the purchase of FA-0001 La Marzocco espresso machine', expect.stringContaining('back into the bank'));
  });
});
