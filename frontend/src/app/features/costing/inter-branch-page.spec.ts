import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { Permissions } from '../../core/auth/permissions';
import { CostingApi } from '../../core/costing/costing.api';
import { InterBranchApi, InterBranchHub, Receipt, Requisition, Shipment } from '../../core/costing/inter-branch.api';
import { NotifyService } from '../../core/ui/notify.service';
import { InterBranchPage } from './inter-branch-page';
import { printShipment, requisitionWhatsApp } from './inter-branch-paper';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

const branches = [
  { id: 'kitchen', name: 'Central Kitchen', nameAr: 'المطبخ المركزي', type: 'CentralKitchen' as const, isActive: true },
  { id: 'tanta', name: 'Tanta', nameAr: 'طنطا', type: 'Restaurant' as const, isActive: true },
];

const requisition = (more: Partial<Requisition> = {}): Requisition => ({
  id: 'r1', number: 'REQ-2026-0001', requestingBranchId: 'tanta', requestingBranch: 'Tanta', supplyingBranchId: 'kitchen', supplyingBranch: 'Central Kitchen',
  requestDate: '2026-11-18', requestedDeliveryDate: '2026-11-19', status: 'Submitted', notes: 'Before noon', createdBy: 'Mona', createdAtUtc: '2026-11-18T08:00:00Z',
  cancelledAtUtc: null, cancelledBy: null,
  lines: [{ rawMaterialId: 'sauce', material: 'Tomato sauce', code: 'PR-01', unit: 'Gram', purchaseUnitSize: 1000, requestedQuantity: 4_000, dispatchedQuantity: 0,
    receivedQuantity: 0, notes: 'Weekend' }],
  ...more,
});

const shipment = (more: Partial<Shipment> = {}): Shipment => ({
  id: 's1', number: 'ISI-2026-0001', requisitionId: 'r1', requisitionNumber: 'REQ-2026-0001', supplyingBranchId: 'kitchen', supplyingBranch: 'Central Kitchen',
  receivingBranchId: 'tanta', receivingBranch: 'Tanta', fromLocationId: 'ck-store', fromLocation: 'Central Store', dispatchDate: '2026-11-18',
  pricing: 'WithMarkupOrCustomPrice', markupPercent: 10, status: 'InTransit', notes: null, createdBy: 'Hany', createdAtUtc: '2026-11-18T09:00:00Z',
  receivedAtUtc: null, receiptId: null, receiptNumber: null, voidedAtUtc: null, voidedBy: null, isInterCompany: true,
  totalTransferRevenue: 440, totalInternalCogs: 400, internalMargin: 40,
  lines: [{ rawMaterialId: 'sauce', material: 'Tomato sauce', code: 'PR-01', unit: 'Gram', purchaseUnitSize: 1000, quantity: 4_000, receivedQuantity: null,
    unitCost: 0.1, transferUnitPrice: 0.11, lineRevenue: 440, lineCogs: 400 }],
  ...more,
});

const receipt = (): Receipt => ({
  id: 'p1', number: 'IPI-2026-0001', shipmentId: 's0', shipmentNumber: 'ISI-2026-0000', requisitionId: null, requisitionNumber: null,
  supplyingBranchId: 'kitchen', supplyingBranch: 'Central Kitchen', receivingBranchId: 'tanta', receivingBranch: 'Tanta', toLocationId: 't-store',
  toLocation: 'Tanta store', receiptDate: '2026-11-17', status: 'Posted', notes: 'A tub split in the van', createdBy: 'Mona', createdAtUtc: '2026-11-17T10:00:00Z',
  voidedAtUtc: null, voidedBy: null, isInterCompany: true, totalBilled: 220, totalReceivedValue: 165, totalTransitLoss: 55,
  lines: [{ rawMaterialId: 'sauce', material: 'Tomato sauce', code: 'PR-01', unit: 'Gram', purchaseUnitSize: 1000, dispatchedQuantity: 2_000, receivedQuantity: 1_500,
    shortQuantity: 500, transferUnitPrice: 0.11, lineTotal: 220, transitLoss: 55 }],
});

const hub = (more: Partial<InterBranchHub> = {}): InterBranchHub => ({
  mode: 'MultiBranch_CentralKitchen', branchId: 'tanta', branch: 'Tanta', branchType: 'Restaurant', branches,
  summary: { openRequisitions: 1, shipmentsInTransit: 1, receiptsThisMonth: 1, billingThisMonth: 660 },
  requisitions: [requisition()], shipments: [shipment()], receipts: [receipt()],
  ...more,
});

describe('the central kitchen hub', () => {
  const api = { hub: vi.fn(), cancel: vi.fn(), voidShipment: vi.fn(), voidReceipt: vi.fn(), sheet: vi.fn() };
  const notify = { info: vi.fn(), error: vi.fn() };
  let permissions: string[];

  async function render(value: InterBranchHub) {
    api.hub.mockReturnValue(of(value));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: InterBranchApi, useValue: api },
        { provide: CostingApi, useValue: { materials: () => of([]) } },
        { provide: AuthService, useValue: { can: (p: string) => permissions.includes(p) } },
        { provide: NotifyService, useValue: notify },
        { provide: MatDialog, useValue: { open: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(InterBranchPage);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, page: fixture.componentInstance as unknown as Record<string, any> };
  }

  beforeEach(() => {
    permissions = [Permissions.InventoryManage, Permissions.CostingView, Permissions.ApprovalDecide];
    Object.values(api).forEach((f) => f.mockReset());
    notify.info.mockReset();
    notify.error.mockReset();
  });

  it('says plainly that the company is not run with a central kitchen, in any other structure', async () => {
    const { el } = await render(hub({ mode: 'MultiBranch_Independent', requisitions: [], shipments: [], receipts: [] }));
    expect(text(el.querySelector('.empty')!)).toContain('The company is not run with a central kitchen.');
    expect(el.querySelector('.cards')).toBeNull();
  });

  it('shows a restaurant its four cards, its requisitions and the shipment coming its way to receive', async () => {
    const { el, fixture, page } = await render(hub());
    expect([...el.querySelectorAll('.card .label')].map((l) => l.childNodes[0].textContent!.trim())).toEqual([
      'Open requisitions', 'Shipments in transit', 'Receipts this month', 'Inter-branch billing',
    ]);
    expect([...el.querySelectorAll('.card .value')].map((v) => text(v))).toEqual(['1', '1', '1', 'L.E 660.00']);
    const buttons = [...el.querySelectorAll('.toolbar button')].map((b) => text(b));
    expect(buttons.some((b) => b.includes('New requisition'))).toBe(true);
    expect(buttons.some((b) => b.includes('Direct dispatch'))).toBe(false);
    const row = el.querySelector('[aria-label="Requisitions"] tbody tr')!;
    expect(text(row)).toContain('Tanta → Central Kitchen');
    expect(text(row)).toContain('Tomato sauce 4 kg');
    // Tanta cancels its own while nothing is sent; it does not dispatch it.
    expect(row.querySelector('[aria-label="Cancel REQ-2026-0001"]')).not.toBeNull();
    expect(row.querySelector('[aria-label="Dispatch and bill REQ-2026-0001"]')).toBeNull();

    page['tabIndex'].set(2);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(text(el.querySelector('[aria-label="Incoming shipments"] tbody tr')!)).toContain('ISI-2026-0001');
    expect(el.querySelector('[aria-label="Receive ISI-2026-0001"]')).not.toBeNull();
    const received = text(el.querySelector('[aria-label="Receipts"] tbody tr')!);
    expect(received).toContain('Tomato sauce 1.5 kg (0.5 kg short)');
    expect(received).toContain('L.E 55.00');
  });

  it('gives the kitchen Dispatch & Bill, a direct dispatch and the void of what is still on its way', async () => {
    const { el, fixture, page } = await render(hub({ branchId: 'kitchen', branch: 'Central Kitchen', branchType: 'CentralKitchen' }));
    expect([...el.querySelectorAll('.toolbar button')].some((b) => text(b).includes('Direct dispatch'))).toBe(true);
    expect(el.querySelector('[aria-label="Dispatch and bill REQ-2026-0001"]')).not.toBeNull();

    page['tabIndex'].set(1);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('[aria-label="Void ISI-2026-0001"]')).not.toBeNull();
    expect(el.querySelector('[aria-label="Receive ISI-2026-0001"]')).toBeNull();
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    api.voidShipment.mockReturnValue(of(shipment({ status: 'Voided' })));
    api.hub.mockReturnValue(of(hub({ branchId: 'kitchen', branch: 'Central Kitchen', branchType: 'CentralKitchen' })));
    await page['voidShipment'](shipment());
    expect(api.voidShipment).toHaveBeenCalledWith('s1');
    expect(notify.info).toHaveBeenCalledWith('ISI-2026-0001 voided.');
  });

  it('hides every price and total from a storekeeper, and leaves the void of a receipt to a manager', async () => {
    permissions = [Permissions.InventoryManage];
    const { el, fixture, page } = await render(hub({
      summary: { openRequisitions: 1, shipmentsInTransit: 1, receiptsThisMonth: 1, billingThisMonth: null },
      shipments: [shipment({ totalTransferRevenue: null, totalInternalCogs: null, internalMargin: null })],
    }));
    expect(el.querySelectorAll('.card')).toHaveLength(3);
    page['tabIndex'].set(2);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(text(el.querySelector('[aria-label="Receipts"] thead')!)).not.toContain('Billed');
    expect(el.querySelector('[aria-label="Void IPI-2026-0001"]')).toBeNull();
  });

  it('copies a requisition for WhatsApp with quantities alone, and prints a delivery note without prices', () => {
    const message = requisitionWhatsApp(requisition(), 'Otantik');
    expect(message).toContain('*Otantik* · طلب بضاعة *REQ-2026-0001*');
    expect(message).toContain('1. Tomato sauce — 4 kg (Weekend)');
    expect(message).toContain('Wanted by · مطلوب يوم: 19 Nov 2026');
    expect(message).not.toMatch(/L\.E|0\.11|440/);

    let html = '';
    const paper = { document: { write: (h: string) => (html = h), close: vi.fn() }, focus: vi.fn(), print: vi.fn() } as unknown as Window;
    printShipment(paper, shipment({ totalTransferRevenue: null, lines: [{ ...shipment().lines[0], transferUnitPrice: null, lineRevenue: null }] }), 'Otantik', (n) => `L.E ${n}`);
    expect(html).toContain('Delivery note · إذن تسليم');
    expect(html).not.toContain('Price · سعر التحويل');
    printShipment(paper, shipment(), 'Otantik', (n) => `L.E ${n.toFixed(2)}`);
    expect(html).toContain('Internal sales invoice · فاتورة بيع داخلية');
    expect(html).toContain('L.E 110.00');
  });
});
