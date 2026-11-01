import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApprovalResult } from '../approvals/approvals.api';

// Custody & Assets (عهدة وأصول): the categories, the assets and whose custody each is in, and the
// vouchers that move them. Seen by whoever holds its tab; categories are a manager's; assets and
// vouchers are whoever manages HR's, an accountant's asked of a manager. What breaks or is lost
// only changes the asset's status and how many are left.

export type AssetStatus = 'InStore' | 'InCustody' | 'Maintenance' | 'Broken' | 'Discarded';
export type AssetTransactionType = 'CheckIn' | 'CheckOut';
export type AssetMovementReason = 'Returned' | 'Maintenance' | 'Breakage' | 'Lost' | 'Discarded';

export interface AssetCategory {
  id: string;
  name: string;
  isConsumable: boolean;
  // Not gone, and of those, in someone's custody.
  assets: number;
  inCustody: number;
}

export interface AssetItem {
  id: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  isConsumable: boolean;
  // A piece's; none when not known.
  unitCost: number | null;
  quantity: number;
  totalCost: number | null;
  employeeId: string | null;
  employeeName: string | null;
  status: AssetStatus;
  notes: string | null;
  createdBy: string;
  createdAtUtc: string;
}

export interface AssetVoucher {
  id: string;
  assetItemId: string;
  assetName: string;
  type: AssetTransactionType;
  date: string;
  employeeId: string | null;
  employeeName: string | null;
  quantity: number;
  reason: AssetMovementReason | null;
  notes: string | null;
  unitCost: number | null;
  cost: number | null;
  recordedBy: string;
  recordedAtUtc: string;
}

export interface AssetDetail {
  asset: AssetItem;
  vouchers: AssetVoucher[];
}

export interface CustodyItem {
  asset: AssetItem;
  // When it came into their custody.
  since: string | null;
}

// What a manager's change answers: applied, with the asset and the voucher it made.
export interface CustodyResult {
  outcome: 'Applied';
  asset: AssetItem | null;
  voucher: AssetVoucher | null;
}

export interface AssetInput {
  requestId: string;
  name: string;
  categoryId: string | null;
  unitCost: number | null;
  quantity: number;
  notes: string | null;
  requestReason: string | null;
}

export interface CheckInInput {
  requestId: string;
  transactionId: string;
  employeeId: string;
  date: string;
  notes: string | null;
  requestReason: string | null;
}

export interface CheckOutInput {
  requestId: string;
  transactionId: string;
  reason: AssetMovementReason;
  quantity: number;
  date: string;
  notes: string | null;
  requestReason: string | null;
}

export const statusLabels: Record<AssetStatus, { en: string; ar: string }> = {
  InStore: { en: 'In the store', ar: 'بالمخزن' },
  InCustody: { en: 'In custody', ar: 'في العهدة' },
  Maintenance: { en: 'At maintenance', ar: 'في الصيانة' },
  Broken: { en: 'Broken', ar: 'كسر هالك' },
  Discarded: { en: 'Discarded', ar: 'مستبعد' },
};

export const reasonLabels: Record<AssetMovementReason, { en: string; ar: string }> = {
  Returned: { en: 'Handed back', ar: 'مرتجع' },
  Maintenance: { en: 'To maintenance', ar: 'صيانة' },
  Breakage: { en: 'Broken', ar: 'كسر' },
  Lost: { en: 'Lost', ar: 'فقد' },
  Discarded: { en: 'Thrown away', ar: 'استبعاد' },
};

// Handed back and to maintenance take all of it; the rest, some of it.
export const takesAll = (reason: AssetMovementReason): boolean => reason === 'Returned' || reason === 'Maintenance';

export function isGone(asset: AssetItem): boolean {
  return asset.status === 'Broken' || asset.status === 'Discarded';
}

// Consumables inventory (جرد الاستهلاكيات): supplies kept in the store and used up. Their stock
// changes by movements: received (at a unit cost, moving the average), used up, or counted (the
// stock set to what was counted, the difference kept). An employee is sent no cost: null.
export type ConsumableMovementType = 'Received' | 'Consumed' | 'Counted';

export interface ConsumableItem {
  id: string;
  name: string;
  unit: string;
  quantity: number;
  // The average a unit cost, and what the stock is worth.
  unitCost: number | null;
  totalCost: number | null;
  reorderLevel: number | null;
  isLow: boolean;
  notes: string | null;
  lastMovedOn: string | null;
  createdBy: string;
  createdAtUtc: string;
}

// Quantity: what came in or went out; a count's, the difference it found (negative when short).
export interface ConsumableMovement {
  id: string;
  consumableItemId: string;
  type: ConsumableMovementType;
  date: string;
  quantity: number;
  unitCost: number | null;
  cost: number | null;
  stockAfter: number;
  notes: string | null;
  recordedBy: string;
  recordedAtUtc: string;
}

export interface ConsumableDetail {
  item: ConsumableItem;
  movements: ConsumableMovement[];
}

export interface ConsumableInput {
  name: string;
  unit: string;
  reorderLevel: number | null;
  notes: string | null;
}

// Counted: quantity is what was counted. unitCost: a receipt's, or none (the average).
export interface ConsumableMovementInput {
  movementId: string;
  type: ConsumableMovementType;
  quantity: number;
  unitCost: number | null;
  date: string;
  notes: string | null;
}

export const movementLabels: Record<ConsumableMovementType, { en: string; ar: string }> = {
  Received: { en: 'Received', ar: 'وارد' },
  Consumed: { en: 'Used up', ar: 'منصرف' },
  Counted: { en: 'Counted', ar: 'جرد' },
};

@Injectable({ providedIn: 'root' })
export class CustodyApi {
  private readonly http = inject(HttpClient);

  categories(): Observable<AssetCategory[]> {
    return this.http.get<AssetCategory[]>('/api/custody/categories');
  }

  saveCategory(id: string, name: string, isConsumable: boolean): Observable<AssetCategory> {
    return this.http.put<AssetCategory>(`/api/custody/categories/${id}`, { name, isConsumable });
  }

  deleteCategory(id: string): Observable<void> {
    return this.http.delete<void>(`/api/custody/categories/${id}`);
  }

  assets(): Observable<AssetItem[]> {
    return this.http.get<AssetItem[]>('/api/custody/assets');
  }

  asset(id: string): Observable<AssetDetail> {
    return this.http.get<AssetDetail>(`/api/custody/assets/${id}`);
  }

  saveAsset(id: string, input: AssetInput): Observable<CustodyResult | ApprovalResult> {
    return this.http.put<CustodyResult | ApprovalResult>(`/api/custody/assets/${id}`, input);
  }

  checkIn(assetId: string, input: CheckInInput): Observable<CustodyResult | ApprovalResult> {
    return this.http.post<CustodyResult | ApprovalResult>(`/api/custody/assets/${assetId}/check-in`, input);
  }

  checkOut(assetId: string, input: CheckOutInput): Observable<CustodyResult | ApprovalResult> {
    return this.http.post<CustodyResult | ApprovalResult>(`/api/custody/assets/${assetId}/check-out`, input);
  }

  vouchers(from: string, to: string): Observable<AssetVoucher[]> {
    return this.http.get<AssetVoucher[]>('/api/custody/vouchers', { params: { from, to } });
  }

  employeeCustody(employeeId: string): Observable<CustodyItem[]> {
    return this.http.get<CustodyItem[]>(`/api/hr/employees/${employeeId}/custody`);
  }

  consumables(): Observable<ConsumableItem[]> {
    return this.http.get<ConsumableItem[]>('/api/custody/consumables');
  }

  consumable(id: string): Observable<ConsumableDetail> {
    return this.http.get<ConsumableDetail>(`/api/custody/consumables/${id}`);
  }

  saveConsumable(id: string, input: ConsumableInput): Observable<ConsumableItem> {
    return this.http.put<ConsumableItem>(`/api/custody/consumables/${id}`, input);
  }

  deleteConsumable(id: string): Observable<void> {
    return this.http.delete<void>(`/api/custody/consumables/${id}`);
  }

  recordMovement(itemId: string, input: ConsumableMovementInput): Observable<{ item: ConsumableItem; movement: ConsumableMovement }> {
    return this.http.post<{ item: ConsumableItem; movement: ConsumableMovement }>(`/api/custody/consumables/${itemId}/movements`, input);
  }
}
