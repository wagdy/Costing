import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { UserRole } from '../api/models';
import { CostingTab } from './costing-tabs';
import { Employee } from './staff';

// The menu (قائمة الطعام) the recipes sell by: categories, items numbered as their codes, their
// sizes, and the add-ons. Kept here, or imported from a sheet.
export interface MenuCategory {
  id: number;
  name: string;
  nameAr: string | null;
  displayOrder: number;
  // Items in it, deleted ones left out.
  items: number;
}

export interface MenuSize {
  id: number;
  name: string;
  nameAr: string | null;
  price: number;
}

export interface MenuItem {
  id: number;
  name: string;
  nameAr: string | null;
  category: string;
  price: number;
  isPriceBasedOnAddons: boolean;
  isAvailable: boolean;
  isDeleted: boolean;
  sizes: MenuSize[];
  addOnIds: number[];
}

export interface MenuAddOn {
  id: number;
  name: string;
  nameAr: string | null;
  price: number;
  isDeleted: boolean;
}

export interface Menu {
  categories: MenuCategory[];
  items: MenuItem[];
  addOns: MenuAddOn[];
}

export interface MenuItemInput {
  // A new item's code: left out, the next one after the highest.
  number?: number | null;
  name: string;
  nameAr: string | null;
  category: string;
  price: number;
  isPriceBasedOnAddons: boolean;
  isAvailable: boolean;
  sizes: { name: string; nameAr: string | null; price: number }[];
  addOnIds: number[];
}

// A row of a sheet left out, and why.
export interface SkippedRow {
  row: number;
  name: string | null;
  reason: string;
}

export interface MenuImportResult {
  added: number;
  updated: number;
  categoriesAdded: number;
  skipped: SkippedRow[];
}

// Sales (المبيعات): bills entered or imported, each taking its stock by recipe.
export type SalesChannel = 'DineIn' | 'Takeaway' | 'Delivery' | 'Online';
export type PaymentMethod = 'Cash' | 'Visa' | 'Instapay';
export type SalesSource = 'Entered' | 'Imported';
// A line taken off the bill, and when: before the kitchen (no stock), after it (waste), or after
// payment (refunded, its stock back).
export type LineVoid = 'None' | 'BeforeKitchen' | 'AfterKitchen' | 'AfterPayment';

export const channelLabels: Record<SalesChannel, { en: string; ar: string }> = {
  DineIn: { en: 'Dine in', ar: 'صالة' },
  Takeaway: { en: 'Takeaway', ar: 'تيك أواي' },
  Delivery: { en: 'Delivery', ar: 'توصيل' },
  Online: { en: 'Online', ar: 'أونلاين' },
};

export const paymentLabels: Record<PaymentMethod, { en: string; ar: string }> = {
  Cash: { en: 'Cash', ar: 'نقدي' },
  Visa: { en: 'Visa', ar: 'فيزا' },
  Instapay: { en: 'Instapay', ar: 'إنستاباي' },
};

export const voidLabels: Record<LineVoid, { en: string; ar: string }> = {
  None: { en: 'On the bill', ar: 'في الفاتورة' },
  BeforeKitchen: { en: 'Voided before the kitchen', ar: 'ملغي قبل المطبخ' },
  AfterKitchen: { en: 'Voided after the kitchen (waste)', ar: 'ملغي بعد المطبخ (هالك)' },
  AfterPayment: { en: 'Refunded', ar: 'مرتجع' },
};

export interface SalesLine {
  publicId: string;
  menuItemId: number;
  variantId: number | null;
  menuItemName: string;
  variantName: string | null;
  quantity: number;
  lineTotal: number;
  addOnIds: number[];
  onBill: boolean;
  voided: LineVoid;
}

export interface SalesReceipt {
  id: string;
  reference: string | null;
  soldAtUtc: string;
  businessDate: string;
  channel: SalesChannel;
  paymentMethod: PaymentMethod;
  lines: SalesLine[];
  subtotal: number;
  discountAmount: number;
  deliveryFee: number;
  taxAmount: number;
  pointsAmount: number;
  totalAmount: number;
  refundedAmount: number;
  notes: string | null;
  source: SalesSource;
  enteredBy: string;
  enteredAtUtc: string;
  voidedAtUtc: string | null;
  voidedBy: string | null;
}

export interface SalesTotals {
  receipts: number;
  items: number;
  subtotal: number;
  discounts: number;
  deliveryFees: number;
  tax: number;
  points: number;
  total: number;
  refunded: number;
  byPayment: Record<PaymentMethod, number>;
}

export interface SalesReport {
  from: string;
  to: string;
  receipts: SalesReceipt[];
  totals: SalesTotals;
}

export interface SaleLineInput {
  menuItemId: number;
  variantId: number | null;
  quantity: number;
  // Left out: the menu's price and its add-ons', times how many.
  lineTotal?: number | null;
  addOnIds?: number[];
  voided?: LineVoid;
}

export interface SaleInput {
  id: string;
  reference: string | null;
  date: string;
  // "13:40:00"; none, the day's middle.
  time: string | null;
  channel: SalesChannel;
  paymentMethod: PaymentMethod;
  lines: SaleLineInput[];
  discountAmount: number;
  deliveryFee: number;
  taxAmount: number;
  pointsAmount: number;
  refundedAmount: number;
  notes: string | null;
}

export interface SalesImportResult {
  receipts: number;
  lines: number;
  alreadyRecorded: number;
  skipped: SkippedRow[];
}

// Breakage (كسر) entered on Waste.
export interface BreakageEntry {
  id: string;
  businessDate: string;
  assetItemId: string | null;
  assetTransactionId: string | null;
  description: string;
  quantity: number;
  unitCost: number | null;
  cost: number;
  employeeId: string | null;
  employeeName: string | null;
  notes: string | null;
  recordedBy: string;
  recordedAtUtc: string;
  isVoided: boolean;
}

export interface BreakageInput {
  id: string;
  date: string;
  description: string;
  quantity: number;
  unitCost: number | null;
  employeeId: string | null;
  notes: string | null;
}

// Who works which section (الصلاحيات): every user but the managers, their role's until ticked.
export interface UserTabs {
  id: string;
  name: string;
  role: UserRole;
  restricted: boolean;
  tabs: CostingTab[];
  setBy: string | null;
  setAtUtc: string | null;
}

@Injectable({ providedIn: 'root' })
export class MenuSalesApi {
  private readonly http = inject(HttpClient);

  menu(): Observable<Menu> {
    return this.http.get<Menu>('/api/menu');
  }

  addCategory(name: string, nameAr: string | null): Observable<Menu> {
    return this.http.post<Menu>('/api/menu/categories', { name, nameAr });
  }

  saveCategory(id: number, name: string, nameAr: string | null, displayOrder: number | null): Observable<Menu> {
    return this.http.put<Menu>(`/api/menu/categories/${id}`, { name, nameAr, displayOrder });
  }

  deleteCategory(id: number): Observable<Menu> {
    return this.http.delete<Menu>(`/api/menu/categories/${id}`);
  }

  addItem(item: MenuItemInput): Observable<MenuItem> {
    return this.http.post<MenuItem>('/api/menu/items', item);
  }

  saveItem(id: number, item: MenuItemInput): Observable<MenuItem> {
    return this.http.put<MenuItem>(`/api/menu/items/${id}`, item);
  }

  deleteItem(id: number): Observable<MenuItem> {
    return this.http.delete<MenuItem>(`/api/menu/items/${id}`);
  }

  restoreItem(id: number): Observable<MenuItem> {
    return this.http.post<MenuItem>(`/api/menu/items/${id}/restore`, {});
  }

  addAddOn(name: string, nameAr: string | null, price: number): Observable<MenuAddOn> {
    return this.http.post<MenuAddOn>('/api/menu/add-ons', { name, nameAr, price });
  }

  saveAddOn(id: number, name: string, nameAr: string | null, price: number): Observable<MenuAddOn> {
    return this.http.put<MenuAddOn>(`/api/menu/add-ons/${id}`, { name, nameAr, price });
  }

  deleteAddOn(id: number): Observable<MenuAddOn> {
    return this.http.delete<MenuAddOn>(`/api/menu/add-ons/${id}`);
  }

  restoreAddOn(id: number): Observable<MenuAddOn> {
    return this.http.post<MenuAddOn>(`/api/menu/add-ons/${id}/restore`, {});
  }

  menuTemplate(): Observable<Blob> {
    return this.http.get('/api/menu/template', { responseType: 'blob' });
  }

  importMenu(file: File): Observable<MenuImportResult> {
    const form = new FormData();
    form.append('file', file, file.name);
    return this.http.post<MenuImportResult>('/api/menu/import', form);
  }

  sales(from: string, to: string): Observable<SalesReport> {
    return this.http.get<SalesReport>('/api/sales', { params: { from, to } });
  }

  recordSale(sale: SaleInput): Observable<SalesReceipt> {
    return this.http.post<SalesReceipt>('/api/sales', sale);
  }

  // A line's quantity handed back, or the whole sale with no line named.
  refund(saleId: string, linePublicId: string | null, quantity: number | null): Observable<SalesReceipt> {
    return this.http.post<SalesReceipt>(`/api/sales/${saleId}/refund`, { linePublicId, quantity });
  }

  salesTemplate(): Observable<Blob> {
    return this.http.get('/api/sales/template', { responseType: 'blob' });
  }

  importSales(file: File): Observable<SalesImportResult> {
    const form = new FormData();
    form.append('file', file, file.name);
    return this.http.post<SalesImportResult>('/api/sales/import', form);
  }

  staff(): Observable<Employee[]> {
    return this.http.get<Employee[]>('/api/staff');
  }

  saveStaff(id: string, name: string, jobTitle: string | null, isActive: boolean): Observable<Employee> {
    return this.http.put<Employee>(`/api/staff/${id}`, { name, jobTitle, isActive });
  }

  breakage(days: number): Observable<BreakageEntry[]> {
    return this.http.get<BreakageEntry[]>('/api/costing/breakage', { params: { days } });
  }

  recordBreakage(entry: BreakageInput): Observable<BreakageEntry> {
    return this.http.post<BreakageEntry>('/api/costing/breakage', entry);
  }

  access(): Observable<UserTabs[]> {
    return this.http.get<UserTabs[]>('/api/access');
  }

  // Null: back to the role's own.
  setTabs(userId: string, tabs: CostingTab[] | null): Observable<UserTabs> {
    return this.http.put<UserTabs>(`/api/access/${userId}`, { tabs });
  }
}
