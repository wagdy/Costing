import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

// Company structure (هيكل الشركة), as the API keeps it: how the business is built, its branches,
// and the locations each keeps stock in. A manager's (Settings → Company structure).

export type OperatingMode = 'SingleBranch_OpenSpace' | 'SingleBranch_WithSubStores' | 'MultiBranch_Independent' | 'MultiBranch_CentralKitchen';
export type BranchType = 'Restaurant' | 'CentralKitchen' | 'CentralWarehouse';
export type LocationKind = 'MainStore' | 'Kitchen' | 'Bar' | 'Other';

export interface Branch {
  id: string;
  name: string;
  nameAr: string | null;
  type: BranchType;
  isActive: boolean;
  // The company's first branch: every record's until there are others; always in use.
  isDefault: boolean;
  locations: number;
}

export interface InventoryLocation {
  id: string;
  branchId: string;
  name: string;
  nameAr: string | null;
  kind: LocationKind;
  isActive: boolean;
  // The first branch's main store: an open-space shop's one implicit store.
  isDefault: boolean;
}

export interface CompanyStructure {
  mode: OperatingMode;
  branches: Branch[];
  locations: InventoryLocation[];
}

// The branches in use, for the branch selector.
export interface BranchChoices {
  mode: OperatingMode;
  branches: Branch[];
}

export interface BranchInput {
  name: string;
  nameAr: string | null;
  type: BranchType;
  isActive: boolean;
}

export interface LocationInput {
  branchId: string;
  name: string;
  nameAr: string | null;
  kind: LocationKind;
  isActive: boolean;
}

export function isMultiBranch(mode: OperatingMode | undefined): boolean {
  return mode === 'MultiBranch_Independent' || mode === 'MultiBranch_CentralKitchen';
}

// Inventory locations beyond the one implicit store.
export function hasLocations(mode: OperatingMode | undefined): boolean {
  return !!mode && mode !== 'SingleBranch_OpenSpace';
}

export const branchTypeLabels: Record<BranchType, { en: string; ar: string }> = {
  Restaurant: { en: 'Restaurant', ar: 'مطعم' },
  CentralKitchen: { en: 'Central kitchen', ar: 'مطبخ مركزي' },
  CentralWarehouse: { en: 'Central warehouse', ar: 'مخزن رئيسي' },
};

export const locationKindLabels: Record<LocationKind, { en: string; ar: string }> = {
  MainStore: { en: 'Main store', ar: 'المخزن الرئيسي' },
  Kitchen: { en: 'Kitchen', ar: 'المطبخ' },
  Bar: { en: 'Bar', ar: 'البار' },
  Other: { en: 'Other', ar: 'أخرى' },
};

@Injectable({ providedIn: 'root' })
export class CompanyStructureApi {
  private readonly http = inject(HttpClient);

  get(): Observable<CompanyStructure> {
    return this.http.get<CompanyStructure>('/api/settings/company-structure');
  }

  setMode(mode: OperatingMode): Observable<CompanyStructure> {
    return this.http.put<CompanyStructure>('/api/settings/company-structure/mode', { mode });
  }

  // Its id made here: added, or changed.
  saveBranch(id: string, branch: BranchInput): Observable<Branch> {
    return this.http.put<Branch>(`/api/settings/branches/${id}`, branch);
  }

  saveLocation(id: string, location: LocationInput): Observable<InventoryLocation> {
    return this.http.put<InventoryLocation>(`/api/settings/locations/${id}`, location);
  }

  choices(): Observable<BranchChoices> {
    return this.http.get<BranchChoices>('/api/branches');
  }
}
