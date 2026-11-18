import { HttpClient } from '@angular/common/http';
import { Injectable, Injector, computed, inject, signal } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import { Company } from '../settings/company';
import { InventoryLocation, LocationKind, OperatingMode, hasLocations } from '../settings/company-structure';

// Stock by location (المخزون حسب الموقع) and the internal transfers between a branch's locations
// (التحويلات الداخلية), as the API keeps them: only once the company keeps stock in more than one place.

export type InternalTransferStatus = 'Posted' | 'Voided';

export interface InternalTransferLine {
  rawMaterialId: string;
  material: string;
  code: string | null;
  quantity: number;
  unit: string;
  // Null for whoever does not see the costs.
  unitCost: number | null;
  lineTotal: number | null;
}

export interface InternalTransfer {
  id: string;
  number: string;
  transferDate: string;
  fromLocationId: string;
  fromLocation: string;
  fromLocationAr: string | null;
  toLocationId: string;
  toLocation: string;
  toLocationAr: string | null;
  status: InternalTransferStatus;
  notes: string | null;
  createdBy: string;
  createdAtUtc: string;
  voidedAtUtc: string | null;
  voidedBy: string | null;
  totalCost: number | null;
  lines: InternalTransferLine[];
}

export interface NewTransfer {
  id: string;
  fromLocationId: string;
  toLocationId: string;
  lines: { rawMaterialId: string; quantity: number }[];
  notes: string | null;
}

export interface StockLocations {
  mode: OperatingMode;
  branchId: string;
  locations: InventoryLocation[];
}

export interface LocationColumn {
  id: string;
  name: string;
  nameAr: string | null;
  kind: LocationKind;
  isActive: boolean;
}

export interface LocationStockRow {
  rawMaterialId: string;
  material: string;
  code: string | null;
  unit: string;
  isPrepItem: boolean;
  // By location id; a location with none is not there.
  byLocation: Record<string, number>;
  total: number;
  averageCost: number | null;
  value: number | null;
}

export interface LocationStock {
  branchId: string;
  locations: LocationColumn[];
  rows: LocationStockRow[];
}

@Injectable({ providedIn: 'root' })
export class StockApi {
  private readonly http = inject(HttpClient);

  locations(): Observable<StockLocations> {
    return this.http.get<StockLocations>('/api/inventory/stock-locations');
  }

  locationStock(): Observable<LocationStock> {
    return this.http.get<LocationStock>('/api/inventory/location-stock');
  }

  transfers(from: string, to: string): Observable<InternalTransfer[]> {
    return this.http.get<InternalTransfer[]>('/api/inventory/internal-transfers', { params: { from, to } });
  }

  transfer(id: string): Observable<InternalTransfer> {
    return this.http.get<InternalTransfer>(`/api/inventory/internal-transfers/${id}`);
  }

  // Posted as it is made; its id made here, so sent again it comes back as it is.
  post(transfer: NewTransfer): Observable<InternalTransfer> {
    return this.http.post<InternalTransfer>('/api/inventory/internal-transfers', transfer);
  }

  void(id: string): Observable<InternalTransfer> {
    return this.http.post<InternalTransfer>(`/api/inventory/internal-transfers/${id}/void`, {});
  }

  sheet(from: string, to: string): Observable<Blob> {
    return this.http.get('/api/inventory/internal-transfers/sheet', { params: { from, to }, responseType: 'blob' });
  }
}

// The branch's locations, once the company has them: what the screens that take or put stock
// somewhere offer; nothing, and no list shown, for an open-space shop.
@Injectable({ providedIn: 'root' })
export class StockPlaces {
  // The API reached only once there are locations to read: an open-space shop asks for nothing.
  private readonly injector = inject(Injector);
  private readonly company = inject(Company);

  readonly locations = signal<InventoryLocation[]>([]);
  readonly shown = computed(() => hasLocations(this.company.mode()) && this.locations().length > 0);
  // The branch's main store: where what names no location goes.
  readonly mainStore = computed(() => this.locations().find((l) => l.kind === 'MainStore') ?? this.locations()[0] ?? null);
  private loaded = false;

  async load(again = false): Promise<void> {
    if (!hasLocations(this.company.mode())) {
      this.locations.set([]);
      return;
    }
    if (this.loaded && !again) {
      return;
    }
    try {
      this.locations.set((await firstValueFrom(this.injector.get(StockApi).locations())).locations);
      this.loaded = true;
    } catch {
      this.locations.set([]);
    }
  }

  name(id: string | null | undefined): string {
    const found = this.locations().find((l) => l.id === id);
    return found ? found.name : '';
  }
}

// "Whole branch" in a count's location list: none for the API.
export const wholeBranch = '(whole-branch)';
