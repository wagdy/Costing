import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

// Material & demand intelligence (تحليلات الخامات والطلبيات): every quantity in the material's
// purchase unit (kg, L, a carton), every price per it.

export interface NamedId {
  id: string;
  name: string;
  nameAr: string | null;
}

export type PriceImpactKind = 'Dish' | 'PrepItem';

// What a material's price change does to a dish (per portion; points of its food cost) or a prep
// item (per its purchase unit; share of its cost): quantity is how much of the material goes in.
export interface PriceImpactLine {
  kind: PriceImpactKind;
  id: string;
  name: string;
  nameAr: string | null;
  per: string;
  quantity: number;
  costChange: number;
  against: number | null;
  points: number | null;
}

// One material over the period: the moving average it came in with, the latest net price paid, the
// change and its share, what was bought, and its impact: (latest − baseline) × bought.
export interface PriceVarianceRow {
  rawMaterialId: string;
  code: string | null;
  material: string;
  categoryId: string;
  category: string | null;
  categoryAr: string | null;
  purchaseUnit: string;
  baselineCost: number | null;
  latestCost: number | null;
  unitVariance: number | null;
  changePercent: number | null;
  quantityPurchased: number;
  impact: number | null;
  invoices: number;
  latestPurchasedOn: string | null;
  latestSupplierId: string | null;
  latestSupplier: string | null;
  supplierIds: string[];
  affected: PriceImpactLine[];
}

export interface PriceVarianceReport {
  from: string;
  to: string;
  totalImpact: number;
  increases: number;
  decreases: number;
  rising: number;
  falling: number;
  affectedDishes: number;
  largestRise: string | null;
  largestRisePercent: number | null;
  rows: PriceVarianceRow[];
  categories: NamedId[];
  suppliers: NamedId[];
}

// What a dish (a size, when it has sizes) is expected to sell a day.
export interface DishExpectation {
  menuItemId: number;
  variantId: number | null;
  expectedDaily: number;
}

export interface OrderPlanRequest {
  lookbackDays: number;
  coverageDays: number;
  growthPercent: number;
  dishes: DishExpectation[];
}

export interface PlannedDish {
  menuItemId: number;
  variantId: number | null;
  code: string;
  name: string;
  nameAr: string | null;
  hasRecipe: boolean;
  averageDaily: number;
  expectedDaily: number;
  // Expected as the manager set it, not by the sales and the growth.
  expected: boolean;
}

// One bought material: what to order for the days ahead, the prep items on hand netted first.
// recommended: the need less the shelf; suggested: rounded up to whole purchase units.
export interface OrderPlanLine {
  rawMaterialId: string;
  code: string | null;
  material: string;
  categoryId: string;
  category: string | null;
  categoryAr: string | null;
  purchaseUnit: string;
  onHand: number;
  averageDailyUsage: number;
  expectedUsage: number;
  reorderLevel: number;
  recommended: number;
  suggested: number;
  unitPrice: number | null;
  estimatedCost: number | null;
  supplierId: string | null;
  supplier: string | null;
  belowReorder: boolean;
}

export interface OrderPlan {
  lookbackFrom: string;
  lookbackTo: string;
  lookbackDays: number;
  coverageDays: number;
  growthPercent: number;
  dishes: PlannedDish[];
  lines: OrderPlanLine[];
  toOrder: number;
  estimatedTotal: number;
  belowReorder: number;
  noPrice: string[];
}

export type OrderSheetGrouping = 'Category' | 'Supplier';

export type VarianceEvaluation = 'WithinLimit' | 'Unfavourable' | 'Favourable' | 'SharedCost';

// One bought material: actual usage (opening + purchases − logged waste − closing) against what the
// sales should have taken by the recipes, through the prep items, with what is held in the prep
// items' stock (heldInPrep, part of the theoretical).
export interface ConsumptionRow {
  rawMaterialId: string;
  code: string | null;
  material: string;
  categoryId: string;
  category: string | null;
  categoryAr: string | null;
  purchaseUnit: string;
  opening: number;
  purchases: number;
  waste: number;
  closing: number;
  actualUsage: number;
  theoreticalUsage: number;
  heldInPrep: number;
  unexplainedQuantity: number;
  unexplainedPercent: number | null;
  unitCost: number | null;
  varianceCost: number | null;
  evaluation: VarianceEvaluation;
}

export interface SoldWithoutRecipe {
  itemCode: string;
  menuItem: string;
  quantity: number;
}

export interface ConsumptionReport {
  from: string;
  to: string;
  tolerancePercent: number;
  theoreticalValue: number;
  actualValue: number;
  unexplainedValue: number;
  highLoss: number;
  rows: ConsumptionRow[];
  soldWithoutRecipe: SoldWithoutRecipe[];
}

export type AbcClass = 'A' | 'B' | 'C';

export interface AbcRow {
  rawMaterialId: string;
  code: string | null;
  material: string;
  categoryId: string;
  category: string | null;
  categoryAr: string | null;
  purchaseUnit: string;
  consumption: number;
  consumptionValue: number;
  sharePercent: number;
  cumulativePercent: number;
  class: AbcClass;
  onHand: number;
  stockValue: number | null;
  averageDaily: number;
  daysOnHand: number | null;
  stockoutRisk: boolean;
  deadStock: boolean;
}

export interface AbcClassSummary {
  class: AbcClass;
  materials: number;
  value: number;
  sharePercent: number;
}

export interface AbcReport {
  from: string;
  to: string;
  days: number;
  consumptionValue: number;
  classes: AbcClassSummary[];
  stockoutRisks: number;
  deadStock: number;
  deadStockValue: number;
  stockValue: number;
  rows: AbcRow[];
}

export const evaluationLabels: Record<VarianceEvaluation, { en: string; ar: string }> = {
  WithinLimit: { en: 'Within limit', ar: 'ضمن الحد' },
  Unfavourable: { en: 'High loss', ar: 'فاقد مرتفع' },
  Favourable: { en: 'Under use', ar: 'استهلاك أقل' },
  SharedCost: { en: 'Shared cost', ar: 'تكلفة مشتركة' },
};

// Filtering a sheet as the screen does: one category, one supplier, the words typed.
export interface PriceSheetFilter {
  categoryId?: string | null;
  supplierId?: string | null;
  search?: string | null;
}

@Injectable({ providedIn: 'root' })
export class IntelligenceApi {
  private readonly http = inject(HttpClient);

  prices(from: string, to: string): Observable<PriceVarianceReport> {
    return this.http.get<PriceVarianceReport>('/api/costing/intelligence/prices', { params: { from, to } });
  }

  pricesSheet(from: string, to: string, filter: PriceSheetFilter = {}): Observable<Blob> {
    const params: Record<string, string> = { from, to };
    if (filter.categoryId) params['categoryId'] = filter.categoryId;
    if (filter.supplierId) params['supplierId'] = filter.supplierId;
    if (filter.search?.trim()) params['search'] = filter.search.trim();
    return this.http.get('/api/costing/intelligence/prices/sheet', { params, responseType: 'blob' });
  }

  plan(request: OrderPlanRequest): Observable<OrderPlan> {
    return this.http.post<OrderPlan>('/api/costing/intelligence/orders', request);
  }

  // The order as approved: each material's quantity in its purchase unit.
  orderSheet(lines: { rawMaterialId: string; quantity: number }[], groupBy: OrderSheetGrouping, coverageDays: number): Observable<Blob> {
    return this.http.post('/api/costing/intelligence/orders/sheet', { lines, groupBy, coverageDays }, { responseType: 'blob' });
  }

  consumption(from: string, to: string): Observable<ConsumptionReport> {
    return this.http.get<ConsumptionReport>('/api/costing/intelligence/consumption', { params: { from, to } });
  }

  consumptionSheet(from: string, to: string): Observable<Blob> {
    return this.http.get('/api/costing/intelligence/consumption/sheet', { params: { from, to }, responseType: 'blob' });
  }

  abc(from: string, to: string): Observable<AbcReport> {
    return this.http.get<AbcReport>('/api/costing/intelligence/abc', { params: { from, to } });
  }

  abcSheet(from: string, to: string): Observable<Blob> {
    return this.http.get('/api/costing/intelligence/abc/sheet', { params: { from, to }, responseType: 'blob' });
  }
}
