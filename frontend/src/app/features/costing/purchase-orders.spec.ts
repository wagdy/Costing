import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { CostingApi, MaterialCost, PurchaseOrder, PurchaseOrderPlan, PurchaseOrderSummary, Supplier } from '../../core/costing/costing.api';
import { CostingAccess } from '../../core/costing/costing-tabs';
import { IntelligenceApi, OrderPlan } from '../../core/costing/intelligence.api';
import { NotifyService } from '../../core/ui/notify.service';
import { Approvals } from './approvals';
import { BusinessDay } from './financials';
import { InvoiceLines, PurchaseCatalog } from './invoice-lines';
import { OrderPlannerPage } from './order-planner-page';
import { PoGenerationData, PoGenerationDialog } from './po-generation-dialog';
import { PurchaseOrderPage } from './purchase-order-page';
import { PurchaseOrdersPage } from './purchase-orders-page';
import { matchAgainst, whatsAppText } from './purchase-orders';
import { ThreeWayMatchPanel, fillFromOrder } from './three-way-match';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();
const cells = (row: Element) => [...row.querySelectorAll(':scope > td')].map(text);

function material(id: string, name: string, over: Partial<MaterialCost> = {}): MaterialCost {
  return {
    id, code: null, name, unit: 'Gram', purchaseUnit: 'kg', purchaseUnitSize: 1000, costPerPurchaseUnit: 20, lastPurchaseCostPerPurchaseUnit: 20,
    lastPurchasedAtUtc: null, kind: 'Bought', ...over,
  } as MaterialCost;
}

const tomatoes = material('tomatoes', 'Tomatoes');
const onions = material('onions', 'Onions', { costPerPurchaseUnit: 12, lastPurchaseCostPerPurchaseUnit: 12 });

// 10 kg of tomatoes at 20 and 5 kg of onions at 12 from Nile Farms; 6 kg of tomatoes came already.
const order: PurchaseOrder = {
  id: 'po-1', poNumber: 'PO-2026-0001', supplierId: 'nile', supplier: 'Nile Farms', supplierPhone: '0100', orderDate: '2026-11-16',
  expectedDeliveryDate: '2026-11-17', paymentTerms: 'Credit', notes: 'Before 10 am', status: 'PartiallyReceived', createdBy: 'Mona',
  createdAtUtc: '2026-11-16T08:00:00Z', approvedBy: 'Boss', approvedAtUtc: '2026-11-16T09:00:00Z', cancelledBy: null, cancelledAtUtc: null, closedBy: null,
  closedAtUtc: null, expectedTotal: 260, remainingValue: 140, receivedPercent: 46.2,
  lines: [
    { id: 'l1', rawMaterialId: 'tomatoes', code: 'T1', material: 'Tomatoes', purchaseUnit: 'kg', purchaseUnitSize: 1000, unit: 'Gram', orderedPurchaseQty: 10,
      receivedPurchaseQty: 6, remainingQty: 4, expectedUnitCost: 20, lineTotal: 200, lineNotes: null },
    { id: 'l2', rawMaterialId: 'onions', code: null, material: 'Onions', purchaseUnit: 'kg', purchaseUnitSize: 1000, unit: 'Gram', orderedPurchaseQty: 5,
      receivedPurchaseQty: 0, remainingQty: 5, expectedUnitCost: 12, lineTotal: 60, lineNotes: 'Red' },
  ],
  deliveries: [
    { invoiceId: 'inv-1', supplierInvoiceNumber: 'N-1', invoiceDate: '2026-11-16', status: 'Posted', total: 132, postedAtUtc: '2026-11-16T10:00:00Z',
      postedBy: 'Boss', attachmentFileName: 'n1.jpg', closedTheOrder: false, awaitingApproval: false },
  ],
};

describe('purchase orders (أوامر الشراء)', () => {
  it('matches a delivery against what was left to come, at the price ordered, as the server does', () => {
    const names = (id: string) => ({ name: id === 'garlic' ? 'Garlic' : id, unit: 'kg' });
    // 4 kg of tomatoes at 22 (over by 2, 8 in all), 3 of the 5 kg of onions, and garlic never ordered.
    const m = matchAgainst(order, [
      { rawMaterialId: 'tomatoes', purchaseQty: 4, netCost: 88 },
      { rawMaterialId: 'onions', purchaseQty: 3, netCost: 36 },
      { rawMaterialId: 'garlic', purchaseQty: 1, netCost: 80 },
    ], names);
    expect(m.lines.map((l) => [l.material, l.status, l.overcharge, l.shortBy, l.qtyOver])).toEqual([
      ['Tomatoes', 'PriceOvercharge', 8, 0, 0], ['Onions', 'Short', 0, 2, 0], ['Garlic', 'NotOrdered', 0, 0, 1],
    ]);
    expect([m.overcharge, m.hasShort, m.needsApproval]).toEqual([8, true, true]);
    // Within half a percent: matched.
    expect(matchAgainst(order, [{ rawMaterialId: 'tomatoes', purchaseQty: 4, netCost: 80.3 }, { rawMaterialId: 'onions', purchaseQty: 5, netCost: 60 }], names)
      .lines.map((l) => l.status)).toEqual(['Matched', 'Matched']);
  });

  it('writes the supplier a message of what is left to come, never what it costs the kitchen', () => {
    const message = whatsAppText(order, 'Otantik');
    expect(message).toContain('*PO-2026-0001*');
    expect(message).toContain('1. Tomatoes — 4 kg');
    expect(message).toContain('2. Onions — 5 kg (Red)');
    expect(message).toContain('On credit · آجل');
    expect(message).not.toMatch(/L\.E|20\.00|12\.00|260/);
  });

  describe('the screens', () => {
    const summaries: PurchaseOrderSummary[] = [
      { id: 'po-1', poNumber: 'PO-2026-0001', supplierId: 'nile', supplier: 'Nile Farms', orderDate: '2026-11-16', expectedDeliveryDate: '2026-11-15',
        paymentTerms: 'Credit', status: 'PartiallyReceived', lines: 2, expectedTotal: 260, remainingValue: 140, receivedPercent: 46.2, deliveries: 1,
        createdBy: 'Mona', approvedBy: 'Boss', overdue: true },
      { id: 'po-2', poNumber: 'PO-2026-0002', supplierId: 'delta', supplier: 'Delta Oils', orderDate: '2026-11-16', expectedDeliveryDate: null,
        paymentTerms: 'Cash', status: 'Draft', lines: 1, expectedTotal: 90, remainingValue: 90, receivedPercent: 0, deliveries: 0, createdBy: 'Mona',
        approvedBy: null, overdue: false },
    ];
    const canApprove = signal(true);
    const info = vi.fn();
    const writeText = vi.fn(() => Promise.resolve());

    function providers(api: Record<string, unknown> = {}) {
      return [
        provideRouter([]),
        { provide: CostingApi, useValue: { purchaseOrders: () => of(summaries), purchaseOrder: () => of(order), ...api } },
        { provide: NotifyService, useValue: { info, error: vi.fn() } },
        { provide: Approvals, useValue: { canApprove, pendingFor: () => undefined, refresh: vi.fn(), requested: vi.fn() } },
        { provide: MatDialog, useValue: { open: vi.fn() } },
      ];
    }

    beforeEach(() => {
      canApprove.set(true);
      info.mockReset();
      writeText.mockClear();
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    });

    it('lists the orders, filtered by status pills and supplier, late ones said', async () => {
      TestBed.configureTestingModule({ providers: providers() });
      const fixture = TestBed.createComponent(PurchaseOrdersPage);
      await fixture.whenStable();
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;

      const rows = () => [...el.querySelectorAll('table.orders tbody tr')];
      expect(cells(rows()[0]).slice(0, 4)).toEqual(['PO-2026-0001', 'Nile Farms 2 items · by Mona', '16 Nov 2026', '15 Nov Late · متأخر']);
      expect([...el.querySelectorAll('.status-pill')].map((p) => text(p.querySelector('.count')!))).toEqual(['2', '1', '0', '1', '0', '0']);
      [...el.querySelectorAll<HTMLButtonElement>('.status-pill')].find((p) => text(p).startsWith('Draft'))!.click();
      fixture.detectChanges();
      expect(rows().map((r) => cells(r)[0])).toEqual(['PO-2026-0002']);
      const page = fixture.componentInstance as unknown as Record<string, any>;
      page['status'].set('');
      page['supplier'].set('nile');
      fixture.detectChanges();
      expect(rows().map((r) => cells(r)[0])).toEqual(['PO-2026-0001']);
      expect(el.querySelectorAll('thead app-info-tip').length).toBe(2);
    });

    it('shows an order, what has come of it and its deliveries, receives it, and copies it for WhatsApp', async () => {
      TestBed.configureTestingModule({ providers: providers() });
      const fixture = TestBed.createComponent(PurchaseOrderPage);
      fixture.componentRef.setInput('id', 'po-1');
      await fixture.whenStable();
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;

      expect(cells(el.querySelector('table.lines tbody tr')!)).toEqual(['Tomatoes T1', '10 kg', '6', '4', 'L.E 20.00', 'L.E 200.00']);
      expect(cells(el.querySelector('table.deliveries tbody tr')!).slice(0, 3)).toEqual(['Invoice N-1', '16 Nov 2026', 'L.E 132.00']);
      const receive = el.querySelector<HTMLAnchorElement>('a[href*="/costing/purchases/new"]')!;
      expect(receive.getAttribute('href')).toBe('/costing/purchases/new?po=po-1');
      // The printed order: what is left, never a price.
      expect([...el.querySelectorAll('.po-paper tbody tr')].map(cells)).toEqual([['1', 'Tomatoes', '4', 'kg', ''], ['2', 'Onions', '5', 'kg', 'Red']]);
      expect(text(el.querySelector('.po-paper')!)).not.toContain('L.E');

      [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => text(b).includes('Copy for WhatsApp'))!.click();
      await fixture.whenStable();
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('PO-2026-0001'));
      // A manager closes what is left; no one else is offered it.
      expect([...el.querySelectorAll('button')].some((b) => text(b).includes('Close with what came'))).toBe(true);
      canApprove.set(false);
      fixture.detectChanges();
      expect([...el.querySelectorAll('button')].some((b) => text(b).includes('Close with what came'))).toBe(false);
    });

    it('sets the invoice lines against the order: badges, the backorder choice, and a manager for what is over', async () => {
      const catalog = { materials: signal([tomatoes, onions]), expenses: signal([]) } as unknown as PurchaseCatalog;
      const editor = new InvoiceLines(catalog);
      fillFromOrder(editor, order, [tomatoes, onions]);
      expect(editor.lines().map((l) => [l.rawMaterialId, l.quantity, l.cost])).toEqual([['tomatoes', 4, 80], ['onions', 5, 60]]);

      TestBed.configureTestingModule({});
      const fixture = TestBed.createComponent(ThreeWayMatchPanel);
      fixture.componentRef.setInput('order', order);
      fixture.componentRef.setInput('editor', editor);
      fixture.componentRef.setInput('canApprove', false);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      const badges = () => [...el.querySelectorAll('tbody tr')].map((r) => text(r.querySelector('.badge')!));
      expect(badges()).toEqual(['Matched · مطابق', 'Matched · مطابق']);
      expect(el.querySelector('.backorder')).toBeNull();

      // Only 3 kg of tomatoes, billed 66 (22 a kg); onions as ordered.
      const panel = fixture.componentInstance as unknown as Record<string, any>;
      panel['setReceived'](editor.lines()[0], 3);
      editor.lines()[0].cost = 66;
      editor.touch();
      fixture.detectChanges();
      expect(editor.lines()[0].quantity).toBe(3);
      expect(badges()).toEqual(['Price overcharge · زيادة سعر', 'Matched · مطابق']);
      expect(text(el.querySelector('tbody tr')!)).toContain('+L.E 2.00 each · L.E 6.00');
      expect(text(el.querySelector('header')!)).toContain('Overcharge L.E 6.00');
      expect(el.querySelector('.backorder')).not.toBeNull();
      expect(text(el.querySelector('.gate')!)).toContain('a manager signs it off');
      el.querySelectorAll<HTMLButtonElement>('.backorder mat-button-toggle button')[1].click();
      expect(fixture.componentInstance.closes()).toBe(true);
    });

    it('makes a purchase order a supplier, a material with none given one here, and writes them all', async () => {
      const plan: PurchaseOrderPlan = {
        groupBy: 'Supplier', today: '2026-11-16', total: 260,
        orders: [
          { supplierId: 'nile', supplier: 'Nile Farms', paymentTermsDays: 30, total: 200,
            lines: [{ rawMaterialId: 'tomatoes', code: null, material: 'Tomatoes', purchaseUnit: 'kg', quantity: 10, unitPrice: 20, cost: 200, priceKnown: true }] },
          { supplierId: null, supplier: null, paymentTermsDays: 0, total: 60,
            lines: [{ rawMaterialId: 'onions', code: null, material: 'Onions', purchaseUnit: 'kg', quantity: 5, unitPrice: 12, cost: 60, priceKnown: false }] },
        ],
      };
      const suppliers = [{ id: 'nile', name: 'Nile Farms', isArchived: false }, { id: 'delta', name: 'Delta Oils', isArchived: false }] as Supplier[];
      const close = vi.fn();
      TestBed.configureTestingModule({
        providers: [
          { provide: MatDialogRef, useValue: { close } },
          { provide: MAT_DIALOG_DATA, useValue: { plan, suppliers, canApprove: false, today: '2026-11-16' } satisfies PoGenerationData },
        ],
      });
      const fixture = TestBed.createComponent(PoGenerationDialog);
      fixture.detectChanges();
      const dialog = fixture.componentInstance as unknown as Record<string, any>;
      expect(dialog['groups']().map((g: { supplier: string }) => g.supplier)).toEqual(['Nile Farms']);
      expect(dialog['leftOut']()).toBe(1);

      dialog['assign']('onions', 'delta');
      fixture.detectChanges();
      expect(dialog['groups']().map((g: { supplier: string; total: number }) => [g.supplier, g.total])).toEqual([['Delta Oils', 60], ['Nile Farms', 200]]);
      dialog['done']();
      const sent = close.mock.lastCall![0].orders;
      expect(sent.map((o: { order: { supplierId: string; paymentTerms: string; expectedDeliveryDate: string } }) =>
        [o.order.supplierId, o.order.paymentTerms, o.order.expectedDeliveryDate])).toEqual([['delta', 'Cash', '2026-11-17'], ['nile', 'Credit', '2026-11-17']]);
      expect(sent[1].order.lines).toEqual([{ rawMaterialId: 'tomatoes', orderedPurchaseQty: 10, expectedUnitCost: 20 }]);
    });

    it('turns the planner’s approved quantities into purchase orders in one click', async () => {
      const planned: OrderPlan = {
        lookbackFrom: '2026-11-02', lookbackTo: '2026-11-15', lookbackDays: 14, coverageDays: 7, growthPercent: 0, dishes: [], toOrder: 1, estimatedTotal: 200,
        belowReorder: 0, noPrice: [],
        lines: [{ rawMaterialId: 'tomatoes', code: null, material: 'Tomatoes', categoryId: 'veg', category: 'Vegetables', categoryAr: null, purchaseUnit: 'kg',
          onHand: 0, averageDailyUsage: 1, expectedUsage: 7, reorderLevel: 3, recommended: 10, suggested: 10, unitPrice: 20, estimatedCost: 200, supplierId: 'nile',
          supplier: 'Nile Farms', belowReorder: true }],
      } as OrderPlan;
      const preview = { groupBy: 'CheapestSupplier', today: '2026-11-16', total: 200, orders: [] } as PurchaseOrderPlan;
      const purchaseOrderPlan = vi.fn(() => of(preview));
      const createPurchaseOrders = vi.fn(() => of([{ id: 'po-9', poNumber: 'PO-2026-0009', status: 'Approved', outcome: 'Applied', request: null }]));
      const open = vi.fn(() => ({ afterClosed: () => of({ orders: [{ id: 'po-9', order: {} }] }) }));
      const navigate = vi.fn(() => Promise.resolve(true));
      TestBed.configureTestingModule({
        providers: [
          { provide: IntelligenceApi, useValue: { plan: () => of(planned), purchaseOrderPlan } },
          { provide: CostingApi, useValue: { suppliers: () => of([]), createPurchaseOrders } },
          { provide: MatDialog, useValue: { open } },
          { provide: Router, useValue: { navigate } },
          { provide: NotifyService, useValue: { info, error: vi.fn() } },
          { provide: Approvals, useValue: { canApprove, refresh: vi.fn() } },
          { provide: BusinessDay, useValue: { today: () => Promise.resolve('2026-11-16') } },
          { provide: CostingAccess, useValue: { has: () => true } },
        ],
      });
      const fixture = TestBed.createComponent(OrderPlannerPage);
      await fixture.whenStable();
      fixture.detectChanges();
      const page = fixture.componentInstance as unknown as Record<string, any>;
      await vi.waitFor(() => expect(page['plan']()).not.toBeNull());
      fixture.detectChanges();
      const button = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find((b) => text(b).includes('Create Purchase Orders'))!;
      expect(button).toBeTruthy();

      page['groupBy'].set('CheapestSupplier');
      await page['createOrders']();
      expect(purchaseOrderPlan).toHaveBeenCalledWith([{ rawMaterialId: 'tomatoes', quantity: 10 }], 'CheapestSupplier');
      expect((open.mock.lastCall as unknown as [unknown, { data: PoGenerationData }])[1].data.plan).toBe(preview);
      expect(createPurchaseOrders).toHaveBeenCalledWith([{ id: 'po-9', order: {} }]);
      expect(info).toHaveBeenCalledWith('1 purchase order approved: PO-2026-0009.');
      expect(navigate).toHaveBeenCalledWith(['/costing/purchases/orders', 'po-9']);
    });
  });
});
