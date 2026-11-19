import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { BranchType, OperatingMode } from '../settings/company-structure';
import { UnitOfMeasure } from './costing.api';

// The central kitchen's hub (مركز عمليات المطبخ المركزي وتحويلات الفروع), as the API keeps it: a
// branch's requisitions (REQ), the kitchen's dispatches and their internal sales invoices (ISI), and
// the branches' receipts and their internal purchase invoices (IPI). Quantities in the material's
// own unit (grams, millilitres, pieces); prices per that unit. Prices and totals are null for
// whoever does not see costs.

export type RequisitionStatus = 'Submitted' | 'PartiallyDispatched' | 'Dispatched' | 'Received' | 'Cancelled';
export type TransferPricing = 'AtCost' | 'WithMarkupOrCustomPrice';
export type ShipmentStatus = 'InTransit' | 'Received' | 'Voided';
export type ReceiptStatus = 'Posted' | 'Voided';

export const requisitionStatusLabels: Record<RequisitionStatus, { en: string; ar: string }> = {
  Submitted: { en: 'Submitted', ar: 'مرسل للمركزي' },
  PartiallyDispatched: { en: 'Partly dispatched', ar: 'صرف جزئي' },
  Dispatched: { en: 'Dispatched', ar: 'تم الصرف وفي الطريق' },
  Received: { en: 'Received', ar: 'تم الاستلام بالفرع' },
  Cancelled: { en: 'Cancelled', ar: 'ملغي' },
};

export const shipmentStatusLabels: Record<ShipmentStatus, { en: string; ar: string }> = {
  InTransit: { en: 'In transit', ar: 'في الطريق' },
  Received: { en: 'Received', ar: 'تم الاستلام' },
  Voided: { en: 'Voided', ar: 'ملغي' },
};

export interface InterBranchBranch {
  id: string;
  name: string;
  nameAr: string | null;
  type: BranchType;
  isActive: boolean;
}

export interface RequisitionLine {
  rawMaterialId: string;
  material: string;
  code: string | null;
  unit: UnitOfMeasure;
  purchaseUnitSize: number;
  requestedQuantity: number;
  dispatchedQuantity: number;
  receivedQuantity: number;
  notes: string | null;
}

export interface Requisition {
  id: string;
  number: string;
  requestingBranchId: string;
  requestingBranch: string;
  supplyingBranchId: string;
  supplyingBranch: string;
  requestDate: string;
  requestedDeliveryDate: string | null;
  status: RequisitionStatus;
  notes: string | null;
  createdBy: string;
  createdAtUtc: string;
  cancelledAtUtc: string | null;
  cancelledBy: string | null;
  lines: RequisitionLine[];
}

export interface ShipmentLine {
  rawMaterialId: string;
  material: string;
  code: string | null;
  unit: UnitOfMeasure;
  purchaseUnitSize: number;
  quantity: number;
  receivedQuantity: number | null;
  unitCost: number | null;
  transferUnitPrice: number | null;
  lineRevenue: number | null;
  lineCogs: number | null;
}

export interface Shipment {
  id: string;
  number: string;
  requisitionId: string | null;
  requisitionNumber: string | null;
  supplyingBranchId: string;
  supplyingBranch: string;
  receivingBranchId: string;
  receivingBranch: string;
  fromLocationId: string;
  fromLocation: string;
  dispatchDate: string;
  pricing: TransferPricing;
  markupPercent: number | null;
  status: ShipmentStatus;
  notes: string | null;
  createdBy: string;
  createdAtUtc: string;
  receivedAtUtc: string | null;
  receiptId: string | null;
  receiptNumber: string | null;
  voidedAtUtc: string | null;
  voidedBy: string | null;
  isInterCompany: boolean;
  totalTransferRevenue: number | null;
  totalInternalCogs: number | null;
  internalMargin: number | null;
  lines: ShipmentLine[];
}

export interface ReceiptLine {
  rawMaterialId: string;
  material: string;
  code: string | null;
  unit: UnitOfMeasure;
  purchaseUnitSize: number;
  dispatchedQuantity: number;
  receivedQuantity: number;
  shortQuantity: number;
  transferUnitPrice: number | null;
  lineTotal: number | null;
  transitLoss: number | null;
}

export interface Receipt {
  id: string;
  number: string;
  shipmentId: string;
  shipmentNumber: string;
  requisitionId: string | null;
  requisitionNumber: string | null;
  supplyingBranchId: string;
  supplyingBranch: string;
  receivingBranchId: string;
  receivingBranch: string;
  toLocationId: string;
  toLocation: string;
  receiptDate: string;
  status: ReceiptStatus;
  notes: string | null;
  createdBy: string;
  createdAtUtc: string;
  voidedAtUtc: string | null;
  voidedBy: string | null;
  isInterCompany: boolean;
  totalBilled: number | null;
  totalReceivedValue: number | null;
  totalTransitLoss: number | null;
  lines: ReceiptLine[];
}

export interface InterBranchSummary {
  openRequisitions: number;
  shipmentsInTransit: number;
  receiptsThisMonth: number;
  billingThisMonth: number | null;
}

export interface InterBranchHub {
  mode: OperatingMode;
  branchId: string;
  branch: string;
  branchType: BranchType;
  branches: InterBranchBranch[];
  summary: InterBranchSummary;
  requisitions: Requisition[];
  shipments: Shipment[];
  receipts: Receipt[];
}

export interface NewRequisition {
  id: string;
  supplyingBranchId: string;
  requestedDeliveryDate: string | null;
  lines: { rawMaterialId: string; quantity: number; notes: string | null }[];
  notes: string | null;
}

export interface NewShipment {
  id: string;
  requisitionId: string | null;
  receivingBranchId: string | null;
  fromLocationId: string | null;
  pricing: TransferPricing;
  markupPercent: number | null;
  lines: { rawMaterialId: string; quantity: number; transferUnitPrice: number | null }[];
  notes: string | null;
}

export interface NewReceipt {
  id: string;
  shipmentId: string;
  toLocationId: string | null;
  lines: { rawMaterialId: string; receivedQuantity: number }[];
  notes: string | null;
}

@Injectable({ providedIn: 'root' })
export class InterBranchApi {
  private readonly http = inject(HttpClient);

  hub(from: string, to: string): Observable<InterBranchHub> {
    return this.http.get<InterBranchHub>('/api/inter-branch', { params: { from, to } });
  }

  sheet(from: string, to: string): Observable<Blob> {
    return this.http.get('/api/inter-branch/sheet', { params: { from, to }, responseType: 'blob' });
  }

  // Each made with its id here: sent again after a lost answer, it is made once.
  submit(requisition: NewRequisition): Observable<Requisition> {
    return this.http.post<Requisition>('/api/inter-branch/requisitions', requisition);
  }

  cancel(id: string): Observable<Requisition> {
    return this.http.post<Requisition>(`/api/inter-branch/requisitions/${id}/cancel`, {});
  }

  dispatch(shipment: NewShipment): Observable<Shipment> {
    return this.http.post<Shipment>('/api/inter-branch/shipments', shipment);
  }

  voidShipment(id: string): Observable<Shipment> {
    return this.http.post<Shipment>(`/api/inter-branch/shipments/${id}/void`, {});
  }

  receive(receipt: NewReceipt): Observable<Receipt> {
    return this.http.post<Receipt>('/api/inter-branch/receipts', receipt);
  }

  voidReceipt(id: string): Observable<Receipt> {
    return this.http.post<Receipt>(`/api/inter-branch/receipts/${id}/void`, {});
  }
}

// A branch that supplies the others: a central kitchen or warehouse.
export function supplies(type: BranchType | undefined): boolean {
  return type === 'CentralKitchen' || type === 'CentralWarehouse';
}
