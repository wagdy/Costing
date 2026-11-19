import { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { MaterialCost } from '../../core/costing/costing.api';
import { InterBranchApi, Requisition, Shipment } from '../../core/costing/inter-branch.api';
import { LocationStock, StockApi } from '../../core/costing/stock.api';
import { Company } from '../../core/settings/company';
import { DispatchDialog, ReceiveDialog, RequisitionDialog } from './inter-branch-dialogs';

const sauce: MaterialCost = {
  id: 'sauce', code: 'PR-01', name: 'Tomato sauce', category: 'Sauces', categoryId: 'sauces', unit: 'Gram', purchaseUnit: 'kg', purchaseUnitSize: 1000,
  costPerPurchaseUnit: 100, defaultYieldPercent: 100, quantityOnHand: 10_000, reorderLevel: 0, stockValue: 1000, lastPurchaseCostPerPurchaseUnit: 100,
  lastPurchasedAtUtc: null, costPerUnit: 0.1, kind: 'Prep',
};

const asked: Requisition = {
  id: 'r1', number: 'REQ-2026-0001', requestingBranchId: 'tanta', requestingBranch: 'Tanta', supplyingBranchId: 'kitchen', supplyingBranch: 'Central Kitchen',
  requestDate: '2026-11-18', requestedDeliveryDate: null, status: 'PartiallyDispatched', notes: null, createdBy: 'Mona', createdAtUtc: '', cancelledAtUtc: null,
  cancelledBy: null,
  lines: [{ rawMaterialId: 'sauce', material: 'Tomato sauce', code: 'PR-01', unit: 'Gram', purchaseUnitSize: 1000, requestedQuantity: 6_000, dispatchedQuantity: 2_000,
    receivedQuantity: 2_000, notes: null }],
};

const stock = (held: number, averageCost: number | null = 0.1): LocationStock => ({
  branchId: 'kitchen',
  locations: [{ id: 'ck-store', name: 'Central Store', nameAr: null, kind: 'MainStore', isActive: true }],
  rows: [{ rawMaterialId: 'sauce', material: 'Tomato sauce', code: 'PR-01', unit: 'Gram', isPrepItem: true, byLocation: { 'ck-store': held }, total: held,
    averageCost, value: null }],
});

const sent: Shipment = {
  id: 's1', number: 'ISI-2026-0001', requisitionId: null, requisitionNumber: null, supplyingBranchId: 'kitchen', supplyingBranch: 'Central Kitchen',
  receivingBranchId: 'tanta', receivingBranch: 'Tanta', fromLocationId: 'ck-store', fromLocation: 'Central Store', dispatchDate: '2026-11-18', pricing: 'AtCost',
  markupPercent: null, status: 'InTransit', notes: null, createdBy: 'Hany', createdAtUtc: '', receivedAtUtc: null, receiptId: null, receiptNumber: null,
  voidedAtUtc: null, voidedBy: null, isInterCompany: true, totalTransferRevenue: 220, totalInternalCogs: 220, internalMargin: 0,
  lines: [{ rawMaterialId: 'sauce', material: 'Tomato sauce', code: 'PR-01', unit: 'Gram', purchaseUnitSize: 1000, quantity: 2_000, receivedQuantity: null,
    unitCost: 0.11, transferUnitPrice: 0.11, lineRevenue: 220, lineCogs: 220 }],
};

describe('the central kitchen hub forms', () => {
  const api = { submit: vi.fn(), dispatch: vi.fn(), receive: vi.fn() };
  const close = vi.fn();

  async function render<T>(component: Type<T>, data: unknown, held = 5_000, averageCost: number | null = 0.1) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close } },
        { provide: InterBranchApi, useValue: api },
        {
          provide: StockApi,
          useValue: {
            locations: () => of({ mode: 'MultiBranch_CentralKitchen', branchId: 'kitchen', locations: [
              { id: 'ck-store', branchId: 'kitchen', name: 'Central Store', nameAr: null, kind: 'MainStore', isActive: true, isDefault: false },
            ] }),
            locationStock: () => of(stock(held, averageCost)),
          },
        },
      ],
    });
    TestBed.inject(Company).settings.update((s) => ({ ...s, operatingMode: 'MultiBranch_CentralKitchen' }));
    const fixture = TestBed.createComponent(component);
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, form: fixture.componentInstance as unknown as Record<string, any> };
  }

  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    close.mockReset();
  });

  it('asks for what is typed, in kilos, sent in grams', async () => {
    api.submit.mockReturnValue(of({ number: 'REQ-2026-0002' }));
    const { form } = await render(RequisitionDialog, { suppliers: [{ id: 'kitchen', name: 'Central Kitchen', nameAr: null, type: 'CentralKitchen', isActive: true }], materials: [sauce] });
    expect(form['ready']()).toBe(false);
    form['change'](0, { rawMaterialId: 'sauce', quantity: 2.5, notes: ' Weekend ' });
    form['deliveryBy'].set('2026-11-20');
    await form['submit']();
    expect(api.submit).toHaveBeenCalledWith({
      id: expect.any(String), supplyingBranchId: 'kitchen', requestedDeliveryDate: '2026-11-20',
      lines: [{ rawMaterialId: 'sauce', quantity: 2_500, notes: 'Weekend' }], notes: null,
    });
    expect(close).toHaveBeenCalledWith({ number: 'REQ-2026-0002' });
  });

  it('fills what is still asked, refuses more than the store holds, and bills at cost plus the markup', async () => {
    const { el, fixture, form } = await render(DispatchDialog, { requisition: asked, receivers: [], materials: [sauce], seesCosts: true }, 3_000);
    // Four kilos still asked; the store holds three: red, and nothing sent.
    expect(form['lines']()[0].quantity).toBe(4);
    expect(form['ready']()).toBe(false);
    expect(el.querySelector('[aria-label="Dispatch lines"] td.short')).not.toBeNull();
    expect(el.querySelector('[role="alert"]')!.textContent).toContain('More than Central Store holds');

    form['change'](0, { quantity: 3 });
    form['pricing'].set('WithMarkupOrCustomPrice');
    form['markup'].set(10);
    fixture.detectChanges();
    expect(form['ready']()).toBe(true);
    expect(form['priceOf'](form['lines']()[0])).toBeCloseTo(110);
    expect(form['revenue']()).toBeCloseTo(330);
    expect(form['cogs']()).toBeCloseTo(300);

    // A price typed for the line: sent per gram.
    form['change'](0, { price: 120 });
    api.dispatch.mockReturnValue(of({ number: 'ISI-2026-0002' }));
    await form['submit']();
    expect(api.dispatch).toHaveBeenCalledWith({
      id: expect.any(String), requisitionId: 'r1', receivingBranchId: null, fromLocationId: 'ck-store', pricing: 'WithMarkupOrCustomPrice', markupPercent: 10,
      lines: [{ rawMaterialId: 'sauce', quantity: 3_000, transferUnitPrice: 0.12 }], notes: null,
    });
  });

  it('sends a storekeeper’s dispatch without a price of their own, and shows them none', async () => {
    const { el, form } = await render(DispatchDialog, {
      requisition: null, receivers: [{ id: 'tanta', name: 'Tanta', nameAr: null, type: 'Restaurant', isActive: true }], materials: [sauce], seesCosts: false,
    }, 5_000, null);
    expect(el.querySelector('[aria-label="Dispatch lines"] thead')!.textContent).not.toContain('Price');
    form['pick'](0, 'sauce');
    form['change'](0, { quantity: 2, price: 999 });
    form['pricing'].set('WithMarkupOrCustomPrice');
    api.dispatch.mockReturnValue(of({ number: 'ISI-2026-0003' }));
    await form['submit']();
    expect(api.dispatch.mock.lastCall![0]).toMatchObject({
      requisitionId: null, receivingBranchId: 'tanta', lines: [{ rawMaterialId: 'sauce', quantity: 2_000, transferUnitPrice: null }],
    });
  });

  it('receives all of it by default, and asks what happened to what did not arrive', async () => {
    const { el, fixture, form } = await render(ReceiveDialog, { shipment: sent, seesCosts: true });
    expect(form['received']()).toEqual([2]);
    expect(form['to']()).toBe('ck-store');
    expect(form['ready']()).toBe(true);

    form['set'](0, 1.5);
    fixture.detectChanges();
    expect(form['ready']()).toBe(false);
    expect(el.querySelector('[role="alert"]')!.textContent).toContain('say what happened');
    expect(form['loss'](0)).toBeCloseTo(55);
    form['notes'].set('A tub split in the van');
    expect(form['ready']()).toBe(true);
    api.receive.mockReturnValue(of({ number: 'IPI-2026-0001' }));
    await form['submit']();
    expect(api.receive).toHaveBeenCalledWith({
      id: expect.any(String), shipmentId: 's1', toLocationId: 'ck-store', lines: [{ rawMaterialId: 'sauce', receivedQuantity: 1_500 }], notes: 'A tub split in the van',
    });

    form['set'](0, 3);
    expect(form['tooMuch']()).toBe(true);
  });
});
