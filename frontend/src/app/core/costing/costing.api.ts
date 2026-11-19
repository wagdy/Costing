import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, of, throwError } from 'rxjs';

// The manager's costing, as the till server's api/costing and api/inventory speak it.

export type UnitOfMeasure = 'Gram' | 'Millilitre' | 'Piece';
export type RecipeTargetKind = 'MenuItem' | 'AddOn';
export type CostStatus = 'WithinTarget' | 'AboveTarget' | 'NoRecipe' | 'MissingPrices' | 'NoPrice';
// Bought from a supplier, or made in the kitchen (a prep item: dough, a house sauce).
export type MaterialKind = 'Purchased' | 'Prep';

// A raw material with its costs. Quantities are in its unit (grams, millilitres, pieces); costs
// are per purchase unit (a kg, a carton), as prices are written.
export interface MaterialCost {
  id: string;
  code: string | null;
  name: string;
  // Its purchase category's name, and the category.
  category: string | null;
  categoryId: string;
  unit: UnitOfMeasure;
  purchaseUnit: string;
  purchaseUnitSize: number;
  costPerPurchaseUnit: number | null;
  defaultYieldPercent: number;
  quantityOnHand: number;
  reorderLevel: number;
  stockValue: number | null;
  lastPurchaseCostPerPurchaseUnit: number | null;
  lastPurchasedAtUtc: string | null;
  // Per gram, millilitre or piece, unrounded: what recipe costs are worked out from.
  costPerUnit: number | null;
  kind: MaterialKind;
  // In a general expenses category: filed there before the kinds were kept apart.
  misplaced?: boolean;
  // What a recipe is costed from, per unit, unrounded: costPerUnit, or for a prep item never made
  // yet its cost by its own recipe today (costedByRecipe), with what has no price inside it.
  recipeCostPerUnit?: number | null;
  costedByRecipe?: boolean;
  recipeCostMissing?: string[];
  // Counted every day: in the daily critical items' spot count (جرد يومي سريع).
  isSpotCheckItem?: boolean;
  // The kitchen or bar station that keeps it (null: the shared station's).
  kitchenStationId?: string | null;
}

// A kitchen or bar station (قسم التشغيل): each material, prep item and dish is kept by one, and its
// variance judged by its own tolerance (null: the costing settings'). The shared station takes what
// has none.
export interface KitchenStation {
  id: string;
  name: string;
  nameAr: string | null;
  code: string | null;
  displayOrder: number;
  targetVarianceTolerancePercent: number | null;
  isActive: boolean;
  isShared: boolean;
  materials: number;
  recipes: number;
}

export interface SaveKitchenStation {
  name: string;
  nameAr: string | null;
  code: string | null;
  displayOrder: number;
  targetVarianceTolerancePercent: number | null;
  isActive: boolean;
}

// What a recipe line is costed from, per unit: the material's average, or for a prep item never
// made yet its own recipe's cost today.
export function recipeCostOf(material: MaterialCost): number | null {
  return material.recipeCostPerUnit === undefined ? material.costPerUnit : material.recipeCostPerUnit;
}

// One invoice line that bought a material, as its paper has it: quantity in the unit billed (5 kg),
// baseQuantity in the material's own (5,000 g), unitPrice per unit billed. A voided one no longer
// stands; replacedBy names the invoice that corrected it, revisionOf the one it corrected.
export interface MaterialPurchase {
  invoiceId: string;
  date: string;
  supplier: string | null;
  invoiceNumber: string | null;
  quantity: number;
  unit: string;
  baseQuantity: number;
  unitPrice: number | null;
  total: number | null;
  voided: boolean;
  replacedBy: string | null;
  revisionOf: string | null;
}

// A material's purchase history card (كارت الصنف), newest first. The totals are the standing
// invoices' only; the average is per purchase unit, over the priced lines.
export interface MaterialPurchaseHistory {
  materialId: string;
  material: string;
  unit: UnitOfMeasure;
  purchaseUnit: string;
  purchaseUnitSize: number;
  lines: MaterialPurchase[];
  baseQuantity: number;
  total: number;
  averagePerPurchaseUnit: number | null;
  unpricedLines: number;
}

// ---- The item's stock card (كارتة الصنف / حركة الصنف) ----

export type StockCardMovementType = 'Opening' | 'Purchases' | 'Production' | 'Sales' | 'Waste' | 'CountAdjustment' | 'InterBranch';
export type StockCardSourceKind = 'PurchaseInvoice' | 'ProductionOrder' | 'StockCount' | 'SalesReceipt' | 'Spoilage' | 'InterBranchShipment';
export type StockMovementReason =
  | 'Sale'
  | 'Waste'
  | 'VoidReturn'
  | 'Purchase'
  | 'CountAdjustment'
  | 'Spoilage'
  | 'ProductionInput'
  | 'ProductionOutput'
  | 'OpeningStock'
  | 'StaffMeal'
  | 'Hospitality'
  | 'RecipeTasting'
  | 'TransferOut'
  | 'TransferIn'
  | 'InterBranchDispatchOut'
  | 'InterBranchReceiptIn';

export const stockCardTypes: { type: StockCardMovementType; en: string; ar: string }[] = [
  { type: 'Opening', en: 'Opening', ar: 'افتتاحي' },
  { type: 'Purchases', en: 'Purchases', ar: 'مشتريات' },
  { type: 'Production', en: 'Production', ar: 'إنتاج' },
  { type: 'Sales', en: 'Sales', ar: 'مبيعات' },
  { type: 'Waste', en: 'Waste', ar: 'هالك' },
  { type: 'CountAdjustment', en: 'Count adjustment', ar: 'تسوية جرد' },
  { type: 'InterBranch', en: 'Between branches', ar: 'بين الفروع' },
];

// One movement, oldest first: in or out in the purchase unit, the balance after it, its price and the
// moving average it left, per purchase unit. sourceId opens its record (the receipt, not its line).
export interface StockCardLine {
  movementId: string;
  date: string;
  occurredAtUtc: string;
  reason: StockMovementReason;
  type: StockCardMovementType;
  isReversal: boolean;
  sourceKind: StockCardSourceKind;
  sourceId: string;
  hasSource: boolean;
  sourceDate: string | null;
  reference: string;
  details: string | null;
  quantityIn: number;
  quantityOut: number;
  balance: number;
  unitCost: number | null;
  value: number | null;
  averageCostAfter: number | null;
  recordedBy: string | null;
}

export interface StockCard {
  rawMaterialId: string;
  code: string | null;
  material: string;
  isPrepItem: boolean;
  unit: UnitOfMeasure;
  purchaseUnit: string;
  purchaseUnitSize: number;
  from: string;
  to: string;
  type: StockCardMovementType | null;
  openingBalance: number;
  openingAverageCost: number | null;
  totalIn: number;
  totalOut: number;
  closingBalance: number;
  closingAverageCost: number | null;
  closingValue: number | null;
  onHand: number;
  averageCost: number | null;
  lines: StockCardLine[];
}

export interface RecipeCostLine {
  rawMaterialId: string;
  code: string | null;
  ingredient: string;
  quantity: number;
  unit: UnitOfMeasure;
  purchaseUnit: string;
  purchaseUnitSize: number;
  apsPerUnit: number | null;
  yieldPercent: number;
  epsPerUnit: number | null;
  recipeCost: number | null;
  // A prep item never made yet, costed by its own recipe today.
  costedByRecipe?: boolean;
}

// The Recipe Costing Template for one dish, size or add-on.
// One recipe's costing card, or a menu item's by the recipe it sells by. recipe is the name it
// goes by (its own, or its menu item's); menuPrice what it is costed against (the menu's, or an
// off-menu recipe's planned price). No target: an off-menu (R&D) recipe.
export interface RecipeCostCard {
  targetKind: RecipeTargetKind | null;
  catalogItemId: number | null;
  variantId: number | null;
  itemCode: string;
  recipe: string;
  recipeAr: string | null;
  category: string | null;
  hasRecipe: boolean;
  portions: number;
  menuPrice: number | null;
  foodCostTargetPercent: number;
  lines: RecipeCostLine[];
  costPerRecipe: number;
  ingredientCostPerPortion: number;
  sharedCostPerPortion: number;
  costPerPortion: number;
  marginPerPortion: number | null;
  foodCostPercentActual: number | null;
  idealSellingPrice: number;
  missingPrices: string[];
  status: CostStatus;
  recipeId: string | null;
  // Its own name, when it has one.
  recipeName: string | null;
  // The menu item it is linked to, by name.
  linkedTo: string | null;
  isStandalone: boolean;
  plannedPrice: number | null;
  // A size with no recipe of its own, costed by the dish's.
  usesBaseRecipe: boolean;
  isDeleted: boolean;
  deletedAtUtc: string | null;
  deletedBy: string | null;
  // The kitchen's own category for it, apart from the menu's; null until it is sorted.
  recipeCategoryId: string | null;
  recipeCategory: string | null;
  recipeCategoryAr: string | null;
  // The kitchen's minutes for one plate (null: the ordinary 10) and how hard they are: what the
  // burdened plate cost shares the labor by.
  prepTimeMinutes?: number | null;
  complexityWeight?: number;
  // A combo offer sold under this number: costed by its dishes.
  comboOfferId?: string | null;
  // The kitchen or bar station that makes it.
  kitchenStationId?: string | null;
}

// The kitchen's own grouping of its recipes: Sauces, Staff meals, Catering orders.
export interface RecipeCategory {
  id: string;
  name: string;
  nameAr: string | null;
  // Active recipes in it, and prep items still in use.
  recipes: number;
  prepItems: number;
}

// A recipe as written: name and link optional on the menu, the name required off it; the
// category always.
export interface SaveRecipe {
  name: string | null;
  recipeCategoryId: string | null;
  plannedPrice: number | null;
  targetKind: RecipeTargetKind | null;
  catalogItemId: number | null;
  variantId: number | null;
  portions: number;
  ingredients: RecipeLine[];
  // Sent together; without the complexity, neither changes.
  prepTimeMinutes?: number | null;
  complexityWeight?: number;
}

export interface TheoreticalCostRow {
  itemCode: string;
  menuItemId: number;
  variantId: number | null;
  menuItem: string;
  menuItemAr: string | null;
  category: string;
  quantitySold: number;
  netSales: number;
  recipeCostPerUnit: number;
  theoreticalCost: number;
  sharedCost: number;
  foodCostPercent: number | null;
  status: CostStatus;
  // Sold before the dish had a recipe: costed by today's recipe at today's prices.
  quantityCostedNow: number;
  // Entered by hand: a prep item's unit (kg, L), its quantity being in it rather than portions;
  // and which recipe or prep item the row is, for one off the menu (menuItemId 0).
  unit?: string | null;
  recipeId?: string | null;
  prepItemId?: string | null;
}

export interface TheoreticalCostReport {
  year: number;
  month: number;
  from: string;
  to: string;
  foodCostTargetPercent: number;
  rows: TheoreticalCostRow[];
  quantitySold: number;
  netSales: number;
  theoreticalCost: number;
  foodCostPercent: number | null;
  // Pos: the till's sales. Manual: the quantities typed in for the month, by whom and when.
  source: TheoreticalSource;
  enteredBy: string | null;
  enteredAtUtc: string | null;
}

export type TheoreticalSource = 'Pos' | 'Manual';

export type ManualSalesItemKind = 'Recipe' | 'PrepItem';

// A row of the month's sales sheet: an active recipe, in portions, or a prep item, in its unit.
// costPerUnit is null when it cannot be costed; price is null off the menu with no planned price,
// and for prep items. quantity is what was saved for the month.
export interface ManualSalesItem {
  kind: ManualSalesItemKind;
  itemId: string;
  code: string | null;
  name: string;
  nameAr: string | null;
  group: string;
  unit: string;
  costPerUnit: number | null;
  price: number | null;
  quantity: number | null;
}

export interface ManualSalesSheet {
  year: number;
  month: number;
  items: ManualSalesItem[];
  enteredBy: string | null;
  enteredAtUtc: string | null;
}

export interface ManualSalesLine {
  kind: ManualSalesItemKind;
  itemId: string;
  quantity: number;
}

export interface CostingSettings {
  foodCostTargetPercent: number;
  // Left out of a save, these stay as they are.
  varianceTolerancePercent?: number | null;
  // Menu categories that are drinks: the beverage cost %. None, everything is food.
  beverageCategories?: string[] | null;
  // The fully burdened plate cost's, saved together.
  plateCost?: PlateCostSettings | null;
  // The staff meals' daily budget; none clears it.
  staffMeals?: { dailyBudget: number | null } | null;
}

export interface PlateCostSettings {
  defaultOverheadAllocationMethod: 'ActivityBasedPrepTime' | 'ByQuantitySold' | 'ByRevenueShare';
  targetNetMarginPercent: number;
  // A month's stand-in labor and overheads before its payroll and bills are in; null: none.
  fallbackMonthlyLaborCost: number | null;
  fallbackMonthlyOverheadCost: number | null;
}

export type KpiKey =
  | 'FoodCost'
  | 'BeverageCost'
  | 'LabourCost'
  | 'AverageCheck'
  | 'SalesPerLabourHour'
  | 'GrossProfitMargin'
  | 'NetProfitMargin';

export type KpiStatus = 'Healthy' | 'Above' | 'Below' | 'NoRange' | 'Missing';

// Value is a % for the ratios, money for the average check and sales per labour hour. Missing
// says what is needed when there is no value.
export interface Kpi {
  key: KpiKey;
  value: number | null;
  healthyFrom: number | null;
  healthyTo: number | null;
  highIsBad: boolean;
  status: KpiStatus;
  missing: string | null;
}

// The month as an income statement: revenue before VAT, after promo discounts.
export interface MonthStatement {
  foodSales: number;
  beverageSales: number;
  deliveryFees: number;
  revenue: number;
  paidOrders: number;
  foodRecipeCost: number;
  beverageRecipeCost: number;
  kitchenWaste: number;
  spoilage: number;
  countDifferences: number;
  costOfSales: number;
  grossProfit: number;
  wagesAndBenefits: number | null;
  otherControllableCosts: number | null;
  occupationCost: number | null;
  interest: number | null;
  depreciation: number | null;
  netProfit: number | null;
  // Expense items on the month's posted purchase invoices, on each category's line, on top of
  // what is entered by hand; and each category's part. totalExpenses: every overhead together.
  loggedControllableCosts: number;
  loggedOccupationCost: number;
  loggedOtherFixedCosts: number;
  loggedExpenses: LoggedExpense[] | null;
  // Wages paid as expenses (vouchers, invoices under a Wages category), added to the wages entered.
  loggedWages: number;
  totalExpenses: number;
  // The month's takings, as each day's Z report gave them: cash and card, their total, the tax
  // collected in it (owed, not revenue: revenue is the total less it), the voids, and how many
  // days' takings are in. salesAtMenuPrices: the month's sales summaries at the menu's prices.
  cashTakings?: number;
  cardTakings?: number;
  grossTakings?: number;
  taxCollected?: number;
  voids?: number;
  takingsDays?: number;
  salesAtMenuPrices?: number;
  // Taken from stock on purpose: staff meals (in the wages and benefits), hospitality and recipe
  // tastings (costs of their own). None is food cost or a loss.
  staffMeals?: number;
  hospitality?: number;
  recipeTasting?: number;
  // Below the gross profit: every overhead but interest and depreciation (operatingExpenses), and what
  // is left, EBITDA (null until the wages are in). The depreciation: the fixed assets register's
  // (assetDepreciation) and any entered, together (depreciationExpense); and the gains less the
  // losses on the assets disposed of or sold in the month. netProfit is after all of them.
  operatingExpenses?: number;
  ebitda?: number | null;
  assetDepreciation?: number;
  depreciationExpense?: number;
  disposalGainOrLoss?: number;
  // With several branches: what a supplying branch sold the others (in its revenue) and what those
  // goods cost it (in its cost of sales); what a receiving branch was billed for that never came.
  interBranchSales?: number;
  interBranchCostOfGoods?: number;
  transitLosses?: number;
}

// Whose P&L: the company's while it has one branch; with several, a branch's or the company's as
// a whole, consolidated. canChoose: the one asking works every branch.
export type PnlView = 'Company' | 'Branch' | 'Consolidated';

export interface PnlBranch {
  id: string;
  name: string;
  nameAr: string | null;
  type: 'Restaurant' | 'CentralKitchen' | 'CentralWarehouse';
  isActive: boolean;
}

export interface PnlScope {
  view: PnlView;
  branchId: string | null;
  branch: string | null;
  branchAr: string | null;
  branchType: PnlBranch['type'] | null;
  canChoose: boolean;
  branches: PnlBranch[];
}

// A branch's month with the others: sent (sales at the transfer prices, their cost, the margin) and
// received (billed, into stock, but for what never arrived).
export interface InterBranchFigures {
  sales: number;
  costOfGoodsSent: number;
  margin: number;
  shipments: number;
  purchases: number;
  transitLosses: number;
  receipts: number;
}

// What the consolidated P&L takes out of its branches' added up.
export interface Eliminations {
  interBranchSales: number;
  costOfGoodsSent: number;
  markupInCostOfSales: number;
  markupInExpenses: number;
  interBranchPurchases: number;
  grossProfit: number;
}

// What no branch keeps: HR's payroll (null without one), the fixed assets register's month.
export interface CompanyCosts {
  payroll: number | null;
  assetDepreciation: number;
  disposalGainOrLoss: number;
}

export type PnlColumnKind = 'Branch' | 'CompanyCosts' | 'Eliminations' | 'Consolidated';

export interface PnlColumn {
  kind: PnlColumnKind;
  branchId: string | null;
  name: string;
  nameAr: string | null;
  revenue: number;
  costOfSales: number;
  grossProfit: number;
  operatingExpenses: number;
  ebitda: number | null;
  netProfit: number | null;
}

export interface LoggedExpense {
  categoryId: string;
  category: string;
  categoryAr: string | null;
  expenseLine: ExpenseLine;
  amount: number;
}

// What a month cost beyond its ingredients, as entered; null is not known yet.
export interface MonthlyExpenses {
  wagesAndBenefits: number | null;
  labourHours: number | null;
  otherControllableCosts: number | null;
  occupationCost: number | null;
  interest: number | null;
  depreciation: number | null;
  updatedAtUtc?: string | null;
  updatedBy?: string | null;
}

export interface ItemProfit {
  itemCode: string;
  menuItem: string;
  menuItemAr: string | null;
  category: string;
  beverage: boolean;
  quantitySold: number;
  netSales: number;
  cost: number | null;
  profit: number | null;
  profitPerUnit: number | null;
  marginPercent: number | null;
}

// The break-even worksheet's Income Statement column: the chosen months at a year's pace.
// A part of a pool of costs, as the burdened plate cost and the daily break-even list them.
export interface CostPoolPartView {
  key: string;
  label: string;
  labelAr: string;
  amount: number;
}

export interface CostPoolView {
  total: number;
  parts: CostPoolPartView[];
  // Months with nothing recorded, that took Cost settings' stand-in figure.
  standInMonths: string[];
}

// The dynamic daily break-even (نقطة التعادل اليومية): a day's share of the month's fixed costs
// against the contribution margin of what it sold.
export interface DailyBreakEven {
  date: string;
  isToday: boolean;
  daysInMonth: number;
  monthlyFixedCosts: number;
  dailyFixedCosts: number;
  labor: CostPoolView;
  overhead: CostPoolView;
  netSales: number;
  foodCost: number;
  foodCostPercent: number | null;
  contributionMargin: number;
  // Today's, or the seven days before's (wacmEstimated) when nothing sold yet.
  wacmPercent: number | null;
  wacmEstimated: boolean;
  historyFrom: string | null;
  historyTo: string | null;
  breakEvenSales: number | null;
  stillToSell: number | null;
  progressPercent: number | null;
  breakEvenReached: boolean;
  operatingResult: number;
  plates: number;
  platesWithoutRecipe: number;
  salesWithoutRecipe: number;
  missingPrices: boolean;
}

export interface BreakEvenWorksheet {
  from: string;
  to: string;
  days: number;
  weeklySales: number;
  grossSales: number;
  costOfSales: number;
  costOfSalesRatio: number;
  grossProfit: number;
  controllableCosts: number;
  occupationCost: number;
  interest: number;
  depreciation: number;
  // Logged expenses whose category counts them as other fixed costs.
  otherFixedCosts: number;
  totalFixedCosts: number;
  restaurantProfit: number;
  breakEvenYearlySales: number | null;
  breakEvenWeeklySales: number | null;
  monthsWithoutCosts: string[];
  scenarios: number[];
  // Of controllableCosts and occupationCost, what came from expense invoices rather than typed in.
  controllableFromInvoices: number;
  occupationFromInvoices: number;
}

// One column of the worksheet: weekly sales tried against the year's costs.
export interface BreakEvenColumn {
  weeklySales: number;
  grossSales: number;
  costOfSales: number;
  grossProfit: number;
  profitMarginPercent: number | null;
  controllableCosts: number;
  occupationCost: number;
  interest: number;
  depreciation: number;
  otherFixedCosts: number;
  totalFixedCosts: number;
  restaurantProfit: number;
}

// The template's arithmetic for an option: gross sales = weekly × 52, cost of sales at the
// income statement's ratio, the same fixed costs.
export function breakEvenColumn(sheet: BreakEvenWorksheet, weeklySales: number): BreakEvenColumn {
  const grossSales = weeklySales * 52;
  const costOfSales = grossSales * sheet.costOfSalesRatio;
  const grossProfit = grossSales - costOfSales;
  return {
    weeklySales,
    grossSales,
    costOfSales,
    grossProfit,
    profitMarginPercent: grossSales > 0 ? (grossProfit / grossSales) * 100 : null,
    controllableCosts: sheet.controllableCosts,
    occupationCost: sheet.occupationCost,
    interest: sheet.interest,
    depreciation: sheet.depreciation,
    otherFixedCosts: sheet.otherFixedCosts,
    totalFixedCosts: sheet.totalFixedCosts,
    restaurantProfit: grossProfit - sheet.totalFixedCosts,
  };
}

export interface KpiReport {
  year: number;
  month: number;
  from: string;
  to: string;
  beverageCategories: string[];
  statement: MonthStatement;
  expenses: MonthlyExpenses;
  kpis: Kpi[];
  items: ItemProfit[];
  itemsWithoutRecipe: number;
  salesWithoutRecipe: number;
  // What the month's discounts and promos did to the margin.
  discounts?: DiscountImpact | null;
  // Whose P&L, and with several branches what it is made of.
  scope?: PnlScope | null;
  interBranch?: InterBranchFigures | null;
  eliminations?: Eliminations | null;
  columns?: PnlColumn[] | null;
  companyCosts?: CompanyCosts | null;
}

// Why a day's discounts were given (أسباب الخصومات), with what each took off (0 when only its reason
// is known) and on how many bills.
export interface DiscountReason {
  reason: string;
  amount: number;
  count: number;
}

// Promos and discounts against the margin (أثر الخصومات وتآكل الهامش), from the month's takings:
// standard gross = net sales + discounts; standard FC% = theoretical cost ÷ standard gross; actual
// FC% = theoretical cost ÷ net sales; erosion = actual − standard, in points.
export interface DiscountImpact {
  discounts: number;
  actualNetRevenue: number;
  standardGrossRevenue: number;
  discountSharePercent: number | null;
  theoreticalCost: number;
  standardFoodCostPercent: number | null;
  actualFoodCostPercent: number | null;
  erosionPoints: number | null;
  reasons: DiscountReason[];
}

// Voided: posted, then deleted with a manager's approval, its adjustments reversed.
export type StockCountStatus = 'Draft' | 'Posted' | 'Voided';

// Periodic (جرد دوري): what is found against the records is a shortage or a surplus. Opening
// (جرد افتتاحي): where each material's stock begins when costing starts, valued at its cost, with
// no shortage or surplus and nothing in the profit. A material is opened once.
export type StockCountKind = 'Periodic' | 'Opening';

export const countKindLabels: Record<StockCountKind, { en: string; ar: string }> = {
  Periodic: { en: 'Periodic count', ar: 'جرد دوري' },
  Opening: { en: 'Opening stock', ar: 'جرد افتتاحي' },
};

// Full (جرد شامل): every material. Spot (جرد يومي سريع / جزئي): a chosen few, and posting it
// moves only what was counted in it.
export type StockCountScope = 'Full' | 'Spot';

// Where a draft stands between who counts and who reconciles: being counted, handed in for
// review, or sent back with lines to weigh again.
export type StockCountReview = 'Counting' | 'Submitted' | 'RecountRequested';

export const countScopeLabels: Record<StockCountScope, { en: string; ar: string }> = {
  Full: { en: 'Full count', ar: 'جرد شامل' },
  Spot: { en: 'Spot count', ar: 'جرد يومي سريع' },
};

export const countReviewLabels: Record<StockCountReview, { en: string; ar: string }> = {
  Counting: { en: 'Being counted', ar: 'جارٍ الجرد' },
  Submitted: { en: 'Handed in for review', ar: 'بانتظار المراجعة' },
  RecountRequested: { en: 'Recount needed', ar: 'مطلوب إعادة جرد' },
};

// What a count sheet lists of a material or prep item: nothing of its stock or its cost.
export interface CountItem {
  id: string;
  code: string | null;
  name: string;
  categoryId: string;
  category: string;
  categoryAr: string | null;
  unit: UnitOfMeasure;
  purchaseUnit: string;
  purchaseUnitSize: number;
  isPrepItem: boolean;
  isSpotCheckItem: boolean;
  isArchived: boolean;
  // The kitchen or bar station that keeps it, for a count of one station.
  kitchenStationId?: string | null;
}

// A spot count's ready lists, by material id alone.
export interface CountPreset {
  key: 'critical' | 'classA' | 'highVariance';
  name: string;
  nameAr: string;
  materialIds: string[];
}

export interface CountCategoryPreset {
  categoryId: string;
  name: string;
  nameAr: string | null;
  materialIds: string[];
}

// A station's materials and prep items, for a count at its shift's close (حسب قسم المطبخ).
export interface CountStationPreset {
  stationId: string;
  name: string;
  nameAr: string | null;
  code: string | null;
  materialIds: string[];
}

export interface CountPresets {
  from: string;
  to: string;
  tolerancePercent: number;
  presets: CountPreset[];
  categories: CountCategoryPreset[];
  stations?: CountStationPreset[];
}

export interface StockCountSummary {
  id: string;
  status: StockCountStatus;
  startedAtUtc: string;
  startedBy: string;
  postedAtUtc: string | null;
  postedBy: string | null;
  materials: number;
  voidedAtUtc?: string | null;
  voidedBy?: string | null;
  kind: StockCountKind;
  scope?: StockCountScope;
  scopeLabel?: string | null;
  scopeSize?: number;
  review?: StockCountReview;
  submittedBy?: string | null;
  submittedAtUtc?: string | null;
}

// Quantities in the material's unit (grams, millilitres, pieces). Book quantity and cost are what
// the records say: on a posted count as at posting, on a draft as they stand now; null for whoever
// counts blind. The counter's note, and whether the line is sent back to be weighed again.
export interface StockCountLine {
  rawMaterialId: string;
  countedQuantity: number;
  bookQuantity: number | null;
  unitCost: number | null;
  note?: string | null;
  recountRequested?: boolean;
}

export interface StockCount {
  // The location counted; none: the whole branch.
  locationId?: string | null;
  id: string;
  status: StockCountStatus;
  startedAtUtc: string;
  startedBy: string;
  postedAtUtc: string | null;
  postedBy: string | null;
  lines: StockCountLine[];
  voidedAtUtc?: string | null;
  voidedBy?: string | null;
  kind: StockCountKind;
  scope?: StockCountScope;
  scopeMaterialIds?: string[];
  scopeLabel?: string | null;
  review?: StockCountReview;
  submittedBy?: string | null;
  submittedAtUtc?: string | null;
  reviewedBy?: string | null;
  reviewedAtUtc?: string | null;
  reviewNote?: string | null;
  // Sent blind: the records' figures and the costs left out.
  blind?: boolean;
}

// A spot count started: what it covers and what it was chosen as.
export interface CountScopeInput {
  scope: StockCountScope;
  scopeMaterialIds: string[];
  scopeLabel: string | null;
}

export interface SpoilageLine {
  rawMaterialId: string;
  quantity: number;
  reason: string;
  // The station held to account for it (القسم المسؤول): the material's own unless another is named.
  responsibleStationId?: string | null;
}

export interface SpoilageEntry {
  spoilageId: string;
  recordedAtUtc: string;
  recordedBy: string | null;
  lines: {
    rawMaterialId: string;
    material: string;
    unit: UnitOfMeasure;
    purchaseUnitSize: number;
    quantity: number;
    reason: string | null;
    value: number | null;
    responsibleStationId?: string | null;
  }[];
  value: number | null;
}

export type VarianceEvaluation = 'WithinLimit' | 'Unfavourable' | 'Favourable' | 'SharedCost';

// One material between two counts, in its unit. Variance = actual − standard: above zero, more
// left the stores than the recipes account for.
export interface VarianceRow {
  rawMaterialId: string;
  code: string | null;
  material: string;
  category: string | null;
  unit: UnitOfMeasure;
  purchaseUnitSize: number;
  opening: number;
  received: number;
  rawWaste: number;
  productWaste: number;
  standardUsage: number;
  expectedClosing: number;
  closing: number;
  actualUsage: number;
  varianceQuantity: number;
  variancePercent: number | null;
  unexplainedQuantity: number;
  unitCost: number | null;
  varianceValue: number | null;
  unexplainedValue: number | null;
  evaluation: VarianceEvaluation;
  // Staff meals, hospitality and tastings: taken on purpose, out of the unexplained.
  staffMeals?: number;
}

export interface VarianceReport {
  // From may be the opening stock; to is always a periodic count.
  from: { id: string; postedAtUtc: string; postedBy: string | null; opening?: boolean };
  to: { id: string; postedAtUtc: string; postedBy: string | null; opening?: boolean };
  tolerancePercent: number;
  rows: VarianceRow[];
  unfavourableCount: number;
  netVarianceValue: number;
  recordedWasteValue: number;
  unexplainedValue: number;
  largestRelativeMaterial: string | null;
  largestRelativePercent: number | null;
  notInBothCounts: string[];
  soldWithoutStock: { itemCode: string; menuItem: string; quantity: number }[];
  missingPrices: string[];
  staffMealsValue?: number;
}

export interface SharedCost {
  id: string;
  name: string;
  rawMaterialId: string | null;
  rawMaterialName: string | null;
  monthlyAmount: number | null;
  category: string | null;
}

export interface SaveSharedCost {
  name: string;
  rawMaterialId: string | null;
  monthlyAmount: number | null;
  category: string | null;
}

// Creating or changing a material. The unit is set once, when it is created: every recipe and
// ledger entry for it is in that unit.
export interface SaveMaterial {
  name: string;
  unit?: UnitOfMeasure;
  reorderLevel: number;
  code: string | null;
  // None: General.
  categoryId: string | null;
  purchaseUnit: string;
  purchaseUnitSize: number;
  defaultYieldPercent: number;
  costPerPurchaseUnit: number | null;
}

// What records a material, in the unit it is counted in: a change of that unit restates them all,
// and needs the conversion to. pendingRequests: requests waiting for a manager that name it.
export interface MaterialUsage {
  stockMovements: number;
  invoiceLines: number;
  recipes: number;
  prepRecipes: number;
  counts: number;
  batches: number;
  pendingRequests: number;
  inUse: boolean;
}

// A material counted in another unit (عدّ بـ). oneNewIsOld: how many of the old unit one of the new
// is, needed once anything records it, when its stock and cost are restated by it; the cost and
// reorder level are only given while nothing does. requestId is made here: a retry asks once.
export interface MaterialUnitChangeInput {
  requestId: string;
  unit: UnitOfMeasure;
  oneNewIsOld: number | null;
  purchaseUnit: string;
  purchaseUnitSize: number;
  costPerPurchaseUnit: number | null;
  reorderLevel: number | null;
  reason: string | null;
}

// Applied, or Requested of a manager (the request); a change made at once by a manager is kept
// with the decisions too.
export interface MaterialUnitChangeResult {
  outcome: ApprovalOutcome;
  request: ApprovalRequest | null;
}

export interface RecipeLine {
  rawMaterialId: string;
  quantity: number;
  yieldPercent: number | null;
}

// Voided: posted, then deleted with a manager's approval, its goods taken back out of stock.
export type PurchaseInvoiceStatus = 'Draft' | 'Posted' | 'Voided';

export type PurchaseItemType = 'Inventory' | 'Expense';

// A line as written on the invoice (5, in kg of 1000 g) and what it comes to in the material's
// own unit (5,000 g). An expense line names its expense item instead, has no unit of stock, and
// is only its cost. material: the line's name, the material's or the expense's.
export interface PurchaseInvoiceLine {
  rawMaterialId: string | null;
  material: string;
  unit: UnitOfMeasure | null;
  enteredQuantity: number;
  unitLabel: string;
  unitSize: number;
  quantity: number;
  // After every discount: what the line really cost. As written (lineTotal), less its own
  // discount and its share of the invoice's.
  cost: number | null;
  itemType: PurchaseItemType;
  expenseItemId: string | null;
  categoryId: string | null;
  category: string | null;
  categoryAr: string | null;
  lineTotal?: number | null;
  discount?: number;
  discountShare?: number;
}

export interface PurchaseAttachment {
  fileName: string;
  contentType: string;
  bytes: number;
  attachedAtUtc: string;
  attachedBy: string | null;
}

export interface PurchaseInvoice {
  // Where it is put away; none: the main store.
  locationId?: string | null;
  id: string;
  status: PurchaseInvoiceStatus;
  supplierId: string | null;
  // The supplier's name now, archived or not.
  supplierName: string | null;
  supplierInvoiceNumber: string | null;
  invoiceDate: string | null;
  createdAtUtc: string;
  createdBy: string;
  postedAtUtc: string | null;
  postedBy: string | null;
  total: number;
  attachment: PurchaseAttachment | null;
  lines: PurchaseInvoiceLine[];
  // total, split: what went into stock, and what was expenses.
  inventoryTotal: number;
  expenseTotal: number;
  voidedAtUtc?: string | null;
  voidedBy?: string | null;
  paymentMethod: PurchasePaymentMethod | null;
  revenueDate: string | null;
  paymentStatus: InvoicePaymentStatus;
  // A correction (تعديل فاتورة): the invoice it corrects; and on that one, the invoice that corrected it.
  revisionOf?: string | null;
  replacedBy?: string | null;
  // total is what is paid (الصافي المستحق): the lines as written (subtotal), less their own
  // discounts (lineDiscounts) and the invoice's (discount).
  subtotal?: number;
  lineDiscounts?: number;
  discount?: number;
  // The purchase order it delivers: a draft's matched against it item by item (3-way match), a posted
  // one's named. awaitingApproval: its posting waits for a manager to sign off what is over the order.
  purchaseOrder?: PurchaseOrderMatch | null;
  awaitingApproval?: boolean;
}

// A posted invoice as it should have been: a new invoice (newInvoiceId, made here) that replaces
// it. requestId is made here too: a retry finds what was done.
export interface InvoiceCorrectionInput {
  requestId: string;
  newInvoiceId: string;
  supplierId: string | null;
  supplierInvoiceNumber: string | null;
  invoiceDate: string | null;
  lines: SavePurchaseLine[];
  paymentMethod: PurchasePaymentMethod | null;
  revenueDate: string | null;
  reason: string | null;
  discount: number;
}

// What a correction would change, line by line: what the manager sees on the request.
export interface InvoiceCorrectionPreview {
  summary: string;
  changes: ApprovalChange[];
}

export interface PurchaseInvoiceSummary {
  id: string;
  status: PurchaseInvoiceStatus;
  supplierId: string | null;
  // The supplier's name now, archived or not.
  supplierName: string | null;
  supplierInvoiceNumber: string | null;
  invoiceDate: string | null;
  createdAtUtc: string;
  createdBy: string;
  postedAtUtc: string | null;
  postedBy: string | null;
  total: number;
  lines: number;
  // Null while no paper is attached.
  attachmentFileName: string | null;
  inventoryTotal: number;
  expenseTotal: number;
  voidedAtUtc?: string | null;
  voidedBy?: string | null;
  paymentMethod: PurchasePaymentMethod | null;
  revenueDate: string | null;
  paymentStatus: InvoicePaymentStatus;
  purchaseOrderId?: string | null;
}

// Maker-checker: what a manager decides. Deletions in every costing module; new and changed prep
// items and production orders too.
export type ApprovalModule =
  | 'Recipe'
  | 'PurchaseInvoice'
  | 'Waste'
  | 'StockCount'
  | 'RawMaterial'
  | 'PrepItem'
  | 'ProductionOrder'
  | 'Treasury'
  | 'PurchaseCategory'
  | 'Sale'
  | 'Breakage'
  // A purchase order approved; with PurchaseInvoice Create, an invoice over its order posted once signed off.
  | 'PurchaseOrder';
export type ApprovalAction = 'Create' | 'Update' | 'Delete';
export type ApprovalStatus = 'Pending' | 'Approved' | 'Rejected';
export type ApprovalOutcome = 'Requested' | 'Applied';

export const moduleLabels: Record<ApprovalModule, { en: string; ar: string }> = {
  Recipe: { en: 'Recipe', ar: 'الوصفات' },
  PurchaseInvoice: { en: 'Purchases', ar: 'المشتريات' },
  Waste: { en: 'Waste', ar: 'الهالك' },
  StockCount: { en: 'Stock count', ar: 'الجرد' },
  RawMaterial: { en: 'Raw material', ar: 'الخامات' },
  PrepItem: { en: 'Prep item', ar: 'الأصناف نصف المصنعة' },
  ProductionOrder: { en: 'Production', ar: 'أذونات التصنيع' },
  Treasury: { en: 'Safe', ar: 'الخزنة' },
  PurchaseCategory: { en: 'Purchase category', ar: 'أقسام المشتريات' },
  Sale: { en: 'Sale', ar: 'المبيعات' },
  Breakage: { en: 'Breakage', ar: 'الكسر' },
  PurchaseOrder: { en: 'Purchase order', ar: 'أوامر الشراء' },
};

export const actionLabels: Record<ApprovalAction, { en: string; ar: string }> = {
  Create: { en: 'New', ar: 'جديد' },
  Update: { en: 'Change', ar: 'تعديل' },
  Delete: { en: 'Delete', ar: 'حذف' },
};

// One line of what a request changes: "Quantity to produce: 10 kg → 12 kg". before is null for
// something new, after for something taken away.
export interface ApprovalChange {
  label: string;
  before: string | null;
  after: string | null;
}

// summary: the record as it was when asked about (for a new one, what it would be). recordId:
// the record's, or for a new one the id it is given when approved. decidedBy, decidedAtUtc and
// decisionNote are set once a manager has decided.
export interface ApprovalRequest {
  id: string;
  module: ApprovalModule;
  action: ApprovalAction;
  recordId: string;
  summary: string;
  changes: ApprovalChange[];
  reason: string | null;
  requestedBy: string;
  requestedAtUtc: string;
  status: ApprovalStatus;
  decidedBy: string | null;
  decidedAtUtc: string | null;
  decisionNote: string | null;
}

export interface ApprovalRequests {
  pending: ApprovalRequest[];
  decided: ApprovalRequest[];
}

export interface ApprovalResult {
  outcome: ApprovalOutcome;
  request: ApprovalRequest;
}

// What approving a batch would do now: the batch made at today's averages, and for a correction
// the batch it replaces, whose entries go back first.
export interface ApprovalPreview {
  batch: ProductionPreview;
  replaces: ProductionOrder | null;
}

// A save answered with a request (someone who may not approve) rather than the record itself.
export function isRequested<T extends object>(result: T | ApprovalResult): result is ApprovalResult {
  return 'outcome' in result && 'request' in result;
}

// One ingredient of a prep item's batch, costed at its average now: what it adds to a batch, and
// its share of the batch's cost.
export interface PrepIngredientCost {
  rawMaterialId: string;
  code: string | null;
  name: string;
  isPrepItem: boolean;
  unit: UnitOfMeasure;
  purchaseUnit: string;
  purchaseUnitSize: number;
  // The Edible Portion for one batch, in the ingredient's unit; and what that takes off stock.
  quantity: number;
  yieldPercent: number;
  asPurchasedQuantity: number;
  costPerPurchaseUnit: number | null;
  batchCost: number | null;
  sharePercent: number | null;
  // A prep item never made yet, costed by its own recipe today.
  costedByRecipe?: boolean;
}

// A prep item: made from a recipe for one batch, kept in stock. Quantities in its unit (grams,
// millilitres); costs per its display unit (a kg, a litre). The standard cost is the recipe's at
// today's prices; the average is what the batches on the shelf cost.
export interface PrepItem {
  id: string;
  code: string | null;
  name: string;
  category: string | null;
  categoryId: string;
  unit: UnitOfMeasure;
  displayUnit: string;
  displayUnitSize: number;
  reorderLevel: number;
  batchQuantity: number;
  ingredients: PrepIngredientCost[];
  standardBatchCost: number | null;
  standardCostPerDisplayUnit: number | null;
  missingPrices: string[];
  quantityOnHand: number;
  averageCostPerDisplayUnit: number | null;
  stockValue: number | null;
  lastProducedAtUtc: string | null;
  lastBatchCostPerDisplayUnit: number | null;
  recent: ProductionOrder[];
  // The kitchen's recipe category it is sorted under, as dishes are; null for none.
  recipeCategoryId: string | null;
  // Counted every day: in the daily critical items' spot count (جرد يومي سريع).
  isSpotCheckItem?: boolean;
  // A batch's prep time (null: the ordinary 10 minutes) and how hard it is.
  prepTimeMinutes?: number | null;
  complexityWeight?: number;
  // The kitchen or bar station that makes and keeps it.
  kitchenStationId?: string | null;
}

export interface SavePrepItem {
  name: string;
  unit: UnitOfMeasure;
  batchQuantity: number;
  ingredients: { rawMaterialId: string; quantity: number; yieldPercent: number | null }[];
  code: string | null;
  categoryId: string | null;
  recipeCategoryId: string | null;
  displayUnit: string;
  displayUnitSize: number;
  reorderLevel: number;
  // A batch's prep time and complexity, sent together; without the complexity, neither changes.
  prepTimeMinutes?: number | null;
  complexityWeight?: number;
  // For a request: made here, so a retry is recorded once; and why, for the manager.
  requestId?: string;
  reason?: string | null;
}

// An ingredient of a batch. onHand and short on a preview only.
export interface ProductionLine {
  rawMaterialId: string;
  code: string | null;
  material: string;
  isPrepItem: boolean;
  unit: UnitOfMeasure;
  purchaseUnit: string;
  purchaseUnitSize: number;
  quantity: number;
  onHand: number | null;
  short: number | null;
  costPerPurchaseUnit: number | null;
  cost: number | null;
}

// A batch made: planned (which set the ingredients), produced (what came out), and what it cost.
export interface ProductionOrder {
  id: string;
  prepItemId: string;
  prepItem: string;
  unit: UnitOfMeasure;
  displayUnit: string;
  displayUnitSize: number;
  plannedQuantity: number;
  producedQuantity: number;
  yieldPercent: number;
  totalCost: number;
  unitCostPerDisplayUnit: number;
  producedAtUtc: string;
  producedBy: string;
  notes: string | null;
  lines: ProductionLine[];
  // Voided: its entries reversed, deleted or corrected. A correction names the batch it replaced
  // (revisionOf), and the replaced one names it (replacedBy).
  status: 'Made' | 'Voided';
  voidedAtUtc: string | null;
  voidedBy: string | null;
  revisionOf: string | null;
  replacedBy: string | null;
  // The manager who approved it, when it was asked of one.
  approvedBy: string | null;
}

// A batch as it would be made now: the review before posting.
export interface ProductionPreview {
  prepItemId: string;
  prepItem: string;
  unit: UnitOfMeasure;
  displayUnit: string;
  displayUnitSize: number;
  plannedQuantity: number;
  producedQuantity: number;
  lines: ProductionLine[];
  totalCost: number | null;
  unitCostPerDisplayUnit: number | null;
  missingPrices: string[];
  shortages: string[];
}

export interface MakeProductionOrder {
  // Where it is made; none: the prep item's station's location, or the main store.
  locationId?: string | null;
  prepItemId: string;
  plannedQuantity: number;
  producedQuantity: number;
  notes: string | null;
  requestId?: string;
  reason?: string | null;
}

// A batch corrected: made again as newOrderId with these quantities, the old one reversed.
export interface ReviseProductionOrder {
  requestId: string;
  newOrderId: string;
  plannedQuantity: number;
  producedQuantity: number;
  notes: string | null;
  reason: string | null;
}

// Who the restaurant buys from. Invoices, drafts included, decide what deleting it does: on
// none it goes, on any it is archived.
export interface Supplier {
  id: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  isArchived: boolean;
  invoices: number;
  postedTotal: number;
  lastPostedAtUtc: string | null;
  // Days it gives to pay a credit invoice (مدة السداد).
  paymentTermsDays?: number;
}

export interface SaveSupplier {
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  // Left out, kept as it is.
  paymentTermsDays?: number;
}

export type SupplierRemoval = 'Deleted' | 'Archived';

export interface SavePurchaseInvoice {
  // Where it is put away; none: the main store.
  locationId?: string | null;
  supplierId: string | null;
  supplierInvoiceNumber: string | null;
  invoiceDate: string | null;
  lines: SavePurchaseLine[];
  // Required to post: from the safe, from a day's takings (revenueDate), or on credit (a supplier).
  paymentMethod: PurchasePaymentMethod | null;
  revenueDate: string | null;
  // The invoice's own discount (خصم الفاتورة), off what the lines come to after theirs.
  discount: number;
  // The purchase order it delivers, and whether it closes it with what came (no backorder).
  purchaseOrderId?: string | null;
  closesPurchaseOrder?: boolean;
}

// ---- Purchase orders (أوامر الشراء) and the 3-way match ----

export type PurchaseOrderStatus = 'Draft' | 'Approved' | 'PartiallyReceived' | 'Completed' | 'Cancelled';
export type PurchaseOrderTerms = 'Cash' | 'Credit';
export type MatchStatus = 'Matched' | 'PriceOvercharge' | 'QtyOver' | 'Short' | 'NotOrdered';

export const purchaseOrderStatusLabels: Record<PurchaseOrderStatus, { en: string; ar: string }> = {
  Draft: { en: 'Draft', ar: 'مسودة' },
  Approved: { en: 'Approved / Open', ar: 'معتمد / مفتوح' },
  PartiallyReceived: { en: 'Partially received', ar: 'استلام جزئي' },
  Completed: { en: 'Completed', ar: 'مكتمل' },
  Cancelled: { en: 'Cancelled', ar: 'ملغى' },
};

export const matchStatusLabels: Record<MatchStatus, { en: string; ar: string }> = {
  Matched: { en: 'Matched', ar: 'مطابق' },
  PriceOvercharge: { en: 'Price overcharge', ar: 'زيادة سعر' },
  QtyOver: { en: 'Qty over', ar: 'كمية زائدة' },
  Short: { en: 'Partial / short', ar: 'استلام جزئي' },
  NotOrdered: { en: 'Not ordered', ar: 'غير مطلوب' },
};

export interface PurchaseOrderLine {
  id: string;
  rawMaterialId: string;
  code: string | null;
  material: string;
  purchaseUnit: string;
  purchaseUnitSize: number;
  unit: UnitOfMeasure;
  orderedPurchaseQty: number;
  receivedPurchaseQty: number;
  remainingQty: number;
  expectedUnitCost: number;
  lineTotal: number;
  lineNotes: string | null;
}

// An invoice received against the order, posted (or voided since) or waiting for a manager.
export interface PurchaseOrderDelivery {
  invoiceId: string;
  supplierInvoiceNumber: string | null;
  invoiceDate: string | null;
  status: PurchaseInvoiceStatus;
  total: number;
  postedAtUtc: string | null;
  postedBy: string | null;
  attachmentFileName: string | null;
  closedTheOrder: boolean;
  awaitingApproval: boolean;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplierId: string;
  supplier: string;
  supplierPhone: string | null;
  orderDate: string;
  expectedDeliveryDate: string | null;
  paymentTerms: PurchaseOrderTerms;
  notes: string | null;
  status: PurchaseOrderStatus;
  createdBy: string;
  createdAtUtc: string;
  approvedBy: string | null;
  approvedAtUtc: string | null;
  cancelledBy: string | null;
  cancelledAtUtc: string | null;
  closedBy: string | null;
  closedAtUtc: string | null;
  expectedTotal: number;
  remainingValue: number;
  receivedPercent: number;
  lines: PurchaseOrderLine[];
  deliveries: PurchaseOrderDelivery[];
}

export interface PurchaseOrderSummary {
  id: string;
  poNumber: string;
  supplierId: string;
  supplier: string;
  orderDate: string;
  expectedDeliveryDate: string | null;
  paymentTerms: PurchaseOrderTerms;
  status: PurchaseOrderStatus;
  lines: number;
  expectedTotal: number;
  remainingValue: number;
  receivedPercent: number;
  deliveries: number;
  createdBy: string;
  approvedBy: string | null;
  overdue: boolean;
}

export interface PurchaseOrderInput {
  supplierId: string;
  orderDate: string;
  expectedDeliveryDate: string | null;
  paymentTerms: PurchaseOrderTerms;
  notes: string | null;
  lines: { rawMaterialId: string; orderedPurchaseQty: number; expectedUnitCost: number; lineNotes?: string | null }[];
}

export interface PurchaseOrderSaved {
  id: string;
  poNumber: string;
  status: PurchaseOrderStatus;
  outcome: ApprovalOutcome;
  request: ApprovalRequest | null;
}

// One item of a delivery against its order, as the server matched it.
export interface MatchLine {
  rawMaterialId: string;
  material: string;
  purchaseUnit: string;
  ordered: number;
  remaining: number;
  received: number;
  expectedUnitCost: number;
  netUnitPrice: number | null;
  unitOvercharge: number | null;
  overcharge: number;
  qtyOver: number;
  shortBy: number;
  priceOver: boolean;
  status: MatchStatus;
}

export interface PurchaseOrderMatch {
  purchaseOrderId: string;
  poNumber: string;
  status: PurchaseOrderStatus;
  closes: boolean;
  lines: MatchLine[] | null;
  overcharge: number;
  hasShort: boolean;
  needsApproval: boolean;
}

// The order planner's approved quantities as a purchase order per supplier.
export interface PlannedOrderLine {
  rawMaterialId: string;
  code: string | null;
  material: string;
  purchaseUnit: string;
  quantity: number;
  unitPrice: number;
  cost: number;
  priceKnown: boolean;
}

export interface PlannedOrder {
  supplierId: string | null;
  supplier: string | null;
  paymentTermsDays: number;
  lines: PlannedOrderLine[];
  total: number;
}

export interface PurchaseOrderPlan {
  groupBy: 'Category' | 'Supplier' | 'CheapestSupplier';
  today: string;
  orders: PlannedOrder[];
  total: number;
}

// A stock line names its material; an expense line its expense item, in units of 1, with its cost.
// A day's purchases entered together (يومية المشتريات المجمعة): the date and how they were paid,
// chosen once, and an invoice for each supplier, each its own invoice. InvoiceId is made here.
// A day's purchases sent together: an invoice for each supplier, suppliers paid against what they
// are owed (سداد مورد), no invoice and no stock, and employees' advances (سلفة). A payment's or an
// advance's transactionId is made here, once.
export interface PurchaseBatch {
  // Where the day's deliveries are put away; none: the main store.
  locationId?: string | null;
  invoiceDate: string;
  paymentMethod: PurchasePaymentMethod;
  revenueDate: string | null;
  // An invoice on credit in a batch paid in cash (onCredit); one handed in at the end of the day names it.
  invoices: {
    invoiceId: string;
    supplierId: string | null;
    supplierInvoiceNumber: string | null;
    lines: SavePurchaseLine[];
    discount: number;
    onCredit?: boolean;
    endOfDayInvoiceId?: string | null;
    purchaseOrderId?: string | null;
    closesPurchaseOrder?: boolean;
  }[];
  payments: { transactionId: string; supplierId: string; amount: number; notes: string | null }[];
  // No employee: advances handed out with no one named, shared among the staff.
  advances?: { transactionId: string; employeeId: string | null; amount: number; notes: string | null }[];
}

// A supplier paid in a batch: at once (Applied), or asked of a manager (Requested).
export interface BatchPaymentMade {
  transactionId: string;
  supplierId: string;
  supplier: string;
  amount: number;
  notes: string | null;
  outcome: ApprovalOutcome;
}

// An employee's advance paid in a batch: at once (Applied), or asked of a manager (Requested).
export interface BatchAdvanceMade {
  transactionId: string;
  employeeId: string | null;
  employee: string;
  amount: number;
  notes: string | null;
  outcome: ApprovalOutcome;
}

export interface PurchaseBatchResult {
  invoices: PurchaseInvoice[];
  payments: BatchPaymentMade[];
  advances?: BatchAdvanceMade[];
}

export interface SavePurchaseLine {
  itemType: PurchaseItemType;
  rawMaterialId: string | null;
  expenseItemId: string | null;
  enteredQuantity: number;
  unitLabel: string | null;
  unitSize: number;
  // As written, and what was taken off it (الخصم).
  cost: number | null;
  discount: number;
}

// Where an expense filed under a category counts in the profit and loss.
export type ExpenseLine = 'Controllable' | 'Occupation' | 'OtherFixed' | 'Wages';

export const expenseLineLabels: Record<ExpenseLine, { en: string; ar: string; hint: string }> = {
  Controllable: { en: 'Controllable costs', ar: 'تكاليف قابلة للتحكم', hint: 'Utilities, cleaning, maintenance, marketing' },
  Occupation: { en: 'Occupation (rent)', ar: 'الإشغال (الإيجار)', hint: 'Rent and what comes with the premises' },
  OtherFixed: { en: 'Other fixed costs', ar: 'تكاليف ثابتة أخرى', hint: 'Insurance, licences, subscriptions' },
  Wages: { en: 'Wages and benefits', ar: 'الأجور والمزايا', hint: 'Salaries paid by voucher: added to the month’s wages' },
};

// What the restaurant buys, grouped: raw materials and expense items are each in one. General is
// always there and cannot be deleted.
// What a category files: raw materials (stock) or general expenses. A raw material goes in one of
// the first, an expense item in one of the second.
export type CategoryKind = 'RawMaterials' | 'Expenses';

export const categoryKindLabels: Record<CategoryKind, { en: string; ar: string }> = {
  RawMaterials: { en: 'Raw materials', ar: 'خامات ومشتريات' },
  Expenses: { en: 'General expenses', ar: 'مصروفات عمومية' },
};

// isGeneral: the General of its kind, where anything not yet sorted goes. misplaced: items in use
// of the other kind, filed there before the kinds were kept apart.
export interface PurchaseCategory {
  id: string;
  name: string;
  nameAr: string | null;
  expenseLine: ExpenseLine;
  isGeneral: boolean;
  materials: number;
  expenseItems: number;
  kind: CategoryKind;
  misplaced: number;
}

export interface StockUnit {
  expenseItemId: string;
  unit: UnitOfMeasure;
  purchaseUnit: string;
  purchaseUnitSize: number;
}

// Where its raw materials go, and where its expense items go: to a category of the other kind,
// they are converted on the way (raw materials made expense items, their past purchases restated
// as expenses; expense items made raw materials, each counted and bought as units says).
// requestId is made here: a retry asks once.
export interface DeleteCategoryInput {
  requestId: string;
  materialsTo: string | null;
  expenseItemsTo: string | null;
  units: StockUnit[];
  reason: string | null;
}

// What a deletion would do, line by line as the manager reads it; converts: a manager's to decide.
export interface CategoryDeletionPreview {
  summary: string;
  changes: ApprovalChange[];
  converts: boolean;
}

export interface CategoryDeletionResult {
  outcome: ApprovalOutcome;
  request: ApprovalRequest | null;
}

export interface SavePurchaseCategory {
  name: string;
  nameAr: string | null;
  expenseLine: ExpenseLine;
  kind: CategoryKind;
}

// Bought but never stock: only a cost, under its category.
export interface ExpenseItem {
  id: string;
  name: string;
  nameAr: string | null;
  categoryId: string;
  category: string;
  categoryAr: string | null;
  unit: string | null;
  isArchived: boolean;
  invoices: number;
  postedTotal: number;
  lastPostedAtUtc: string | null;
  // In a raw materials category: filed there before the kinds were kept apart.
  misplaced?: boolean;
}

export interface SaveExpenseItem {
  name: string;
  nameAr: string | null;
  categoryId: string | null;
  unit: string | null;
}

export type ExpenseItemRemoval = 'Deleted' | 'Archived';

export interface ItemSpending {
  itemType: PurchaseItemType;
  itemId: string;
  name: string;
  quantity: number;
  unit: string;
  total: number;
  lines: number;
}

export interface CategorySpending {
  categoryId: string;
  category: string;
  categoryAr: string | null;
  expenseLine: ExpenseLine;
  inventory: number;
  expenses: number;
  total: number;
  sharePercent: number | null;
  items: ItemSpending[];
}

// Purchases by category over a period, from the posted invoices, each on its invoice date.
export interface SpendingReport {
  from: string;
  to: string;
  total: number;
  inventory: number;
  expenses: number;
  invoices: number;
  unpricedLines: number;
  categories: CategorySpending[];
}

@Injectable({ providedIn: 'root' })
export class CostingApi {
  private readonly http = inject(HttpClient);

  materials(): Observable<MaterialCost[]> {
    return this.http.get<MaterialCost[]>('/api/costing/materials');
  }

  recipeCategories(): Observable<RecipeCategory[]> {
    return this.http.get<RecipeCategory[]>('/api/inventory/recipe-categories');
  }

  // Adds it on the first save, under the id made here; renames it after.
  saveRecipeCategory(id: string, category: { name: string; nameAr: string | null }): Observable<RecipeCategory> {
    return this.http.put<RecipeCategory>(`/api/inventory/recipe-categories/${id}`, category);
  }

  // moveTo: where its recipes go; required while it has any.
  deleteRecipeCategory(id: string, moveTo: string | null): Observable<void> {
    return this.http.delete<void>(`/api/inventory/recipe-categories/${id}`, { params: moveTo ? { moveTo } : {} });
  }

  // Every recipe, on the menu or off it; the deleted ones too when asked for.
  recipes(includeDeleted = false): Observable<RecipeCostCard[]> {
    return this.http.get<RecipeCostCard[]>('/api/costing/recipes', { params: { includeDeleted } });
  }

  recipeCardById(recipeId: string): Observable<RecipeCostCard> {
    return this.http.get<RecipeCostCard>(`/api/costing/recipes/${recipeId}`);
  }

  // Adds it without an id, changes it with one.
  writeRecipe(recipeId: string | null, recipe: SaveRecipe): Observable<{ id: string }> {
    return recipeId
      ? this.http.put<{ id: string }>(`/api/inventory/recipes/${recipeId}`, recipe)
      : this.http.post<{ id: string }>('/api/inventory/recipes', recipe);
  }

  // Marked deleted, kept for the record.
  deleteRecipe(recipeId: string): Observable<void> {
    return this.http.delete<void>(`/api/inventory/recipes/${recipeId}`);
  }

  // Deleted at once for someone who may approve; asked of a manager otherwise. The
  // id is made here: a retry after a lost answer is recorded once.
  requestDeletion(requestId: string, module: ApprovalModule, recordId: string, reason: string | null): Observable<ApprovalResult> {
    return this.http.post<ApprovalResult>('/api/inventory/deletion-requests', { requestId, module, recordId, reason });
  }

  // What waits for a manager; with decided, the last decisions too (for whoever decides them).
  approvalRequests(decided = 0): Observable<ApprovalRequests> {
    return this.http.get<ApprovalRequests>('/api/inventory/approval-requests', { params: { decided } });
  }

  approveRequest(requestId: string): Observable<ApprovalRequest> {
    return this.http.post<ApprovalRequest>(`/api/inventory/approval-requests/${requestId}/approve`, {});
  }

  rejectRequest(requestId: string, note: string | null): Observable<ApprovalRequest> {
    return this.http.post<ApprovalRequest>(`/api/inventory/approval-requests/${requestId}/reject`, { note });
  }

  // What approving a batch waiting for it would move now, at today's averages; for a correction,
  // with the batch it replaces.
  approvalPreview(requestId: string): Observable<ApprovalPreview> {
    return this.http.get<ApprovalPreview>(`/api/inventory/approval-requests/${requestId}/preview`);
  }

  // name: what to call it if it comes back off the menu, its menu item having another recipe now.
  restoreRecipe(recipeId: string, name: string | null): Observable<{ id: string; catalogItemId: number | null }> {
    return this.http.post<{ id: string; catalogItemId: number | null }>(`/api/inventory/recipes/${recipeId}/restore`, { name });
  }

  menu(): Observable<RecipeCostCard[]> {
    return this.http.get<RecipeCostCard[]>('/api/costing/menu');
  }

  recipeCard(kind: RecipeTargetKind, catalogItemId: number, variantId: number | null): Observable<RecipeCostCard> {
    return this.http.get<RecipeCostCard>('/api/costing/recipe-card', { params: this.target(kind, catalogItemId, variantId) });
  }

  theoretical(year: number, month: number, source: TheoreticalSource = 'Pos'): Observable<TheoreticalCostReport> {
    return this.http.get<TheoreticalCostReport>('/api/costing/theoretical', { params: { year, month, source } });
  }

  manualSales(year: number, month: number): Observable<ManualSalesSheet> {
    return this.http.get<ManualSalesSheet>(`/api/costing/manual-sales/${year}/${month}`);
  }

  // The whole sheet: what is left out is cleared. Answers with the report from it.
  saveManualSales(year: number, month: number, lines: ManualSalesLine[]): Observable<TheoreticalCostReport> {
    return this.http.put<TheoreticalCostReport>(`/api/costing/manual-sales/${year}/${month}`, { lines });
  }

  settings(): Observable<CostingSettings> {
    return this.http.get<CostingSettings>('/api/costing/settings');
  }

  saveSettings(settings: CostingSettings): Observable<CostingSettings> {
    return this.http.put<CostingSettings>('/api/costing/settings', settings);
  }

  sharedCosts(): Observable<SharedCost[]> {
    return this.http.get<SharedCost[]>('/api/costing/shared-costs');
  }

  saveSharedCost(id: string | null, cost: SaveSharedCost): Observable<SharedCost> {
    return id
      ? this.http.put<SharedCost>(`/api/costing/shared-costs/${id}`, cost)
      : this.http.post<SharedCost>('/api/costing/shared-costs', cost);
  }

  deleteSharedCost(id: string): Observable<void> {
    return this.http.delete<void>(`/api/costing/shared-costs/${id}`);
  }

  purchaseCategories(): Observable<PurchaseCategory[]> {
    return this.http.get<PurchaseCategory[]>('/api/inventory/purchase-categories');
  }

  // Adds it on the first save, under the id made here; changes it after.
  savePurchaseCategory(id: string, category: SavePurchaseCategory): Observable<PurchaseCategory> {
    return this.http.put<PurchaseCategory>(`/api/inventory/purchase-categories/${id}`, category);
  }

  previewCategoryDeletion(id: string, deletion: DeleteCategoryInput): Observable<CategoryDeletionPreview> {
    return this.http.post<CategoryDeletionPreview>(`/api/inventory/purchase-categories/${id}/delete/preview`, deletion);
  }

  // Each kind moved as it is, deleted at once (Applied); converting any, at once for a manager
  // (Applied) and asked of one for anyone else (Requested).
  deletePurchaseCategory(id: string, deletion: DeleteCategoryInput): Observable<CategoryDeletionResult> {
    return this.http.post<CategoryDeletionResult>(`/api/inventory/purchase-categories/${id}/delete`, deletion);
  }

  expenseItems(includeArchived = false): Observable<ExpenseItem[]> {
    return this.http.get<ExpenseItem[]>('/api/inventory/expense-items', { params: { includeArchived } });
  }

  saveExpenseItem(id: string, item: SaveExpenseItem): Observable<ExpenseItem> {
    return this.http.put<ExpenseItem>(`/api/inventory/expense-items/${id}`, item);
  }

  // Deleted if it is on no invoice, archived if it is.
  deleteExpenseItem(id: string): Observable<{ outcome: ExpenseItemRemoval }> {
    return this.http.delete<{ outcome: ExpenseItemRemoval }>(`/api/inventory/expense-items/${id}`);
  }

  restoreExpenseItem(id: string): Observable<ExpenseItem> {
    return this.http.post<ExpenseItem>(`/api/inventory/expense-items/${id}/restore`, {});
  }

  // Both days included, as yyyy-mm-dd.
  spending(from: string, to: string): Observable<SpendingReport> {
    return this.http.get<SpendingReport>('/api/costing/purchases/spending', { params: { from, to } });
  }

  // The safe's analysis between two days, both included, as yyyy-mm-dd.
  treasuryAnalytics(from: string, to: string): Observable<TreasuryAnalytics> {
    return this.http.get<TreasuryAnalytics>('/api/costing/treasury', { params: { from, to } });
  }

  // The Excel template to fill in: the columns, and the unit and category lists.
  rawMaterialsTemplate(): Observable<Blob> {
    return this.http.get('/api/inventory/raw-materials/template', { responseType: 'blob' });
  }

  importRawMaterials(file: File): Observable<RawMaterialImportResult> {
    const form = new FormData();
    form.append('file', file, file.name);
    return this.http.post<RawMaterialImportResult>('/api/inventory/raw-materials/import', form);
  }

  // The raw materials as they are, under the template's columns: imported back as they are.
  exportRawMaterials(): Observable<Blob> {
    return this.http.get('/api/inventory/raw-materials/export', { responseType: 'blob' });
  }

  expenseItemsTemplate(): Observable<Blob> {
    return this.http.get('/api/inventory/expense-items/template', { responseType: 'blob' });
  }

  exportExpenseItems(): Observable<Blob> {
    return this.http.get('/api/inventory/expense-items/export', { responseType: 'blob' });
  }

  importExpenseItems(file: File): Observable<ExpenseItemImportResult> {
    const form = new FormData();
    form.append('file', file, file.name);
    return this.http.post<ExpenseItemImportResult>('/api/inventory/expense-items/import', form);
  }

  materialPurchases(id: string): Observable<MaterialPurchaseHistory> {
    return this.http.get<MaterialPurchaseHistory>(`/api/costing/materials/${id}/purchases`);
  }

  stockCard(id: string, from: string, to: string, type: StockCardMovementType | null = null): Observable<StockCard> {
    const params: Record<string, string> = { from, to };
    if (type) params['type'] = type;
    return this.http.get<StockCard>(`/api/costing/materials/${id}/stock-card`, { params });
  }

  stockCardSheet(id: string, from: string, to: string, type: StockCardMovementType | null = null): Observable<Blob> {
    const params: Record<string, string> = { from, to };
    if (type) params['type'] = type;
    return this.http.get(`/api/costing/materials/${id}/stock-card/sheet`, { params, responseType: 'blob' });
  }

  materialUsage(id: string): Observable<MaterialUsage> {
    return this.http.get<MaterialUsage>(`/api/inventory/raw-materials/${id}/usage`);
  }

  // At once while nothing records it, or for a manager; asked of one for anyone else.
  changeMaterialUnit(id: string, change: MaterialUnitChangeInput): Observable<MaterialUnitChangeResult> {
    return this.http.post<MaterialUnitChangeResult>(`/api/inventory/raw-materials/${id}/unit`, change);
  }

  saveMaterial(id: string | null, material: SaveMaterial): Observable<unknown> {
    return id
      ? this.http.put(`/api/inventory/raw-materials/${id}`, material)
      : this.http.post('/api/inventory/raw-materials', material);
  }

  // A branch's, or (none) the company's, consolidated once it has several.
  kpis(year: number, month: number, branchId: string | null = null): Observable<KpiReport> {
    return this.http.get<KpiReport>('/api/costing/kpis', { params: branchId ? { year, month, branchId } : { year, month } });
  }

  profitAndLoss(year: number, month: number, branchId: string | null = null): Observable<ProfitAndLoss> {
    return this.http.get<ProfitAndLoss>('/api/costing/reports/pnl', { params: branchId ? { year, month, branchId } : { year, month } });
  }

  // The fixed assets register at the end of a month (this one when none).
  fixedAssets(year?: number, month?: number): Observable<FixedAssetRegister> {
    return this.http.get<FixedAssetRegister>('/api/financials/fixed-assets', { params: year && month ? { year, month } : {} });
  }

  exportFixedAssets(year: number, month: number): Observable<Blob> {
    return this.http.get('/api/financials/fixed-assets/export', { params: { year, month }, responseType: 'blob' });
  }

  // Paid out of the safe or the bank: made at once for a manager (200), a request for anyone else (202).
  acquireFixedAsset(asset: AcquireFixedAsset): Observable<FixedAssetResult> {
    return this.http.post<FixedAssetResult>('/api/financials/fixed-assets', asset);
  }

  changeFixedAsset(id: string, asset: ChangeFixedAsset): Observable<{ id: string; assetCode: string }> {
    return this.http.put<{ id: string; assetCode: string }>(`/api/financials/fixed-assets/${id}`, asset);
  }

  disposeFixedAsset(id: string, disposal: DisposeFixedAsset): Observable<FixedAssetResult> {
    return this.http.post<FixedAssetResult>(`/api/financials/fixed-assets/${id}/dispose`, disposal);
  }

  reinstateFixedAsset(id: string): Observable<{ id: string; assetCode: string }> {
    return this.http.post<{ id: string; assetCode: string }>(`/api/financials/fixed-assets/${id}/reinstate`, null);
  }

  removeFixedAsset(id: string): Observable<void> {
    return this.http.delete<void>(`/api/financials/fixed-assets/${id}`);
  }

  // The whole month each time: a figure left empty is not known yet.
  // A branch's, with several.
  saveExpenses(year: number, month: number, expenses: MonthlyExpenses, branchId: string | null = null): Observable<MonthlyExpenses> {
    return this.http.put<MonthlyExpenses>(`/api/costing/expenses/${year}/${month}`, expenses, { params: branchId ? { branchId } : {} });
  }

  // A run of months, inclusive; one month is from = to. Months are 'YYYY-MM'.
  // Today's unless another day is asked for.
  dailyBreakEven(date: string | null = null): Observable<DailyBreakEven> {
    return this.http.get<DailyBreakEven>('/api/costing/reports/daily-break-even', { params: date ? { date } : {} });
  }

  breakEven(from: string, to: string): Observable<BreakEvenWorksheet> {
    const [fromYear, fromMonth] = from.split('-').map(Number);
    const [toYear, toMonth] = to.split('-').map(Number);
    return this.http.get<BreakEvenWorksheet>('/api/costing/break-even', { params: { fromYear, fromMonth, toYear, toMonth } });
  }

  saveBreakEvenScenarios(scenarios: number[]): Observable<number[]> {
    return this.http.put<number[]>('/api/costing/break-even/scenarios', scenarios);
  }

  stockCounts(): Observable<StockCountSummary[]> {
    return this.http.get<StockCountSummary[]>('/api/inventory/stock-counts');
  }

  // Posted invoices for the history, newest first, or the drafts.
  purchaseOrders(filter: { status?: PurchaseOrderStatus; open?: boolean; supplierId?: string } = {}): Observable<PurchaseOrderSummary[]> {
    const params: Record<string, string | boolean> = {};
    if (filter.status) params['status'] = filter.status;
    if (filter.open) params['open'] = true;
    if (filter.supplierId) params['supplierId'] = filter.supplierId;
    return this.http.get<PurchaseOrderSummary[]>('/api/inventory/purchase-orders', { params });
  }

  // The open ones in full, what is left of each line, for a delivery to be received against.
  openPurchaseOrders(supplierId?: string | null): Observable<PurchaseOrder[]> {
    return this.http.get<PurchaseOrder[]>('/api/inventory/purchase-orders/open', { params: supplierId ? { supplierId } : {} });
  }

  purchaseOrder(id: string): Observable<PurchaseOrder | null> {
    return this.http.get<PurchaseOrder>(`/api/inventory/purchase-orders/${id}`).pipe(
      catchError((error: HttpErrorResponse) => (error.status === 404 ? of(null) : throwError(() => error))),
    );
  }

  savePurchaseOrder(id: string, order: PurchaseOrderInput): Observable<PurchaseOrder> {
    return this.http.put<PurchaseOrder>(`/api/inventory/purchase-orders/${id}`, order);
  }

  // Approved at once for a manager; asked of one for anyone else (outcome Requested).
  approvePurchaseOrder(id: string, requestId: string, reason: string | null = null): Observable<PurchaseOrderSaved> {
    return this.http.post<PurchaseOrderSaved>(`/api/inventory/purchase-orders/${id}/approve`, { requestId, reason });
  }

  cancelPurchaseOrder(id: string): Observable<PurchaseOrder> {
    return this.http.post<PurchaseOrder>(`/api/inventory/purchase-orders/${id}/cancel`, null);
  }

  closePurchaseOrder(id: string): Observable<PurchaseOrder> {
    return this.http.post<PurchaseOrder>(`/api/inventory/purchase-orders/${id}/close`, null);
  }

  // Several at once, a supplier each: all or none.
  createPurchaseOrders(orders: { id: string; order: PurchaseOrderInput }[]): Observable<PurchaseOrderSaved[]> {
    return this.http.post<PurchaseOrderSaved[]>('/api/inventory/purchase-orders/batch', { orders });
  }

  purchaseInvoices(status: PurchaseInvoiceStatus): Observable<PurchaseInvoiceSummary[]> {
    return this.http.get<PurchaseInvoiceSummary[]>('/api/inventory/purchase-invoices', { params: { status } });
  }

  // Null for an invoice not saved yet (404, and only 404).
  previewInvoiceCorrection(id: string, correction: InvoiceCorrectionInput): Observable<InvoiceCorrectionPreview> {
    return this.http.post<InvoiceCorrectionPreview>(`/api/inventory/purchase-invoices/${id}/correct/preview`, correction);
  }

  // Done at once for a manager (Applied); asked of one for anyone else (Requested).
  correctPurchaseInvoice(id: string, correction: InvoiceCorrectionInput): Observable<ApprovalResult> {
    return this.http.post<ApprovalResult>(`/api/inventory/purchase-invoices/${id}/correct`, correction);
  }

  purchaseInvoice(id: string): Observable<PurchaseInvoice | null> {
    return this.http.get<PurchaseInvoice>(`/api/inventory/purchase-invoices/${id}`).pipe(
      catchError((error: unknown) => (error instanceof HttpErrorResponse && error.status === 404 ? of(null) : throwError(() => error))),
    );
  }

  // Step one: kept as a draft. The id is made here, once per invoice.
  // A day's purchases entered together: each invoice made, posted and paid as chosen, or none.
  postPurchaseBatch(batch: PurchaseBatch): Observable<PurchaseBatchResult> {
    return this.http.post<PurchaseBatchResult>('/api/inventory/purchase-invoices/batch', batch);
  }

  savePurchaseInvoice(id: string, invoice: SavePurchaseInvoice): Observable<PurchaseInvoice> {
    return this.http.put<PurchaseInvoice>(`/api/inventory/purchase-invoices/${id}`, invoice);
  }

  // Step two, after the review: the stock goes in, and it is paid as chosen. paymentStatus says
  // whether a cash payment waits for a manager.
  postPurchaseInvoice(id: string): Observable<PurchaseInvoice> {
    return this.http.post<PurchaseInvoice>(`/api/inventory/purchase-invoices/${id}/post`, {});
  }

  // Pays a posted cash invoice that is not paid (its payment rejected or voided), or puts it on credit.
  payPurchaseInvoice(id: string, requestId: string, method: PurchasePaymentMethod, revenueDate: string | null): Observable<{ paymentStatus: InvoicePaymentStatus }> {
    return this.http.post<{ paymentStatus: InvoicePaymentStatus }>(`/api/inventory/purchase-invoices/${id}/pay`, { requestId, method, revenueDate });
  }

  // ---- Financials (الماليات): the safe and what is owed to suppliers ----

  // The till's business day (2026-10-12): after midnight, yesterday's until the day starts.
  businessToday(): Observable<{ today: string }> {
    return this.http.get<{ today: string }>('/api/financials/today');
  }

  safe(year: number, month: number): Observable<SafeMonth> {
    return this.http.get<SafeMonth>('/api/financials/safe', { params: { year, month } });
  }

  funding(from: string, to: string): Observable<FundingReport> {
    return this.http.get<FundingReport>('/api/financials/funding', { params: { from, to } });
  }

  dayRevenue(from: string, to: string): Observable<DayRevenueReport> {
    return this.http.get<DayRevenueReport>('/api/financials/revenue', { params: { from, to } });
  }

  // The tax held in the safe: collected, paid over, still owed.
  taxPosition(): Observable<TaxPosition> {
    return this.http.get<TaxPosition>('/api/financials/tax');
  }

  takingsPreview(day: string): Observable<TakingsPreview> {
    return this.http.get<TakingsPreview>('/api/financials/takings', { params: { day } });
  }

  reconciliation(from: string, to: string): Observable<ReconciliationReport> {
    return this.http.get<ReconciliationReport>('/api/financials/reconciliation', { params: { from, to } });
  }

  dailyCash(from: string, to: string): Observable<DailyCashReport> {
    return this.http.get<DailyCashReport>('/api/financials/daily-cash', { params: { from, to } });
  }

  financialSettings(): Observable<FinancialSettings> {
    return this.http.get<FinancialSettings>('/api/financials/settings');
  }

  // A manager's only. The tax rate left out stays as it is.
  saveFinancialSettings(servicePercent: number, taxPercent?: number | null): Observable<FinancialSettings> {
    return this.http.put<FinancialSettings>('/api/financials/settings', taxPercent === undefined ? { servicePercent } : { servicePercent, taxPercent });
  }

  expenseVouchers(from: string, to: string): Observable<ExpenseVoucherReport> {
    return this.http.get<ExpenseVoucherReport>('/api/financials/expense-vouchers', { params: { from, to } });
  }

  supplierBalances(): Observable<SupplierBalance[]> {
    return this.http.get<SupplierBalance[]>('/api/financials/suppliers');
  }

  supplierStatement(supplierId: string): Observable<SupplierStatement> {
    return this.http.get<SupplierStatement>(`/api/financials/suppliers/${supplierId}`);
  }

  // A supplier's account over a period (كشف حساب مورد تفصيلي).
  supplierAccount(supplierId: string, from: string, to: string): Observable<SupplierAccount> {
    return this.http.get<SupplierAccount>(`/api/suppliers/${supplierId}/statement`, { params: { from, to } });
  }

  supplierAccountSheet(supplierId: string, from: string, to: string): Observable<Blob> {
    return this.http.get(`/api/suppliers/${supplierId}/statement/sheet`, { params: { from, to }, responseType: 'blob' });
  }

  // What is owed to suppliers by how long it has been due (أعمار ديون الموردين).
  apAging(asOf: string | null = null): Observable<ApAgingReport> {
    return this.http.get<ApAgingReport>('/api/financials/ap-aging', { params: asOf ? { asOf } : {} });
  }

  // Staff meals, hospitality and recipe tastings (وجبات العاملين والضيافة).
  combos(includeDeleted = false): Observable<ComboOffersReport> {
    return this.http.get<ComboOffersReport>('/api/costing/combos', { params: { includeDeleted } });
  }

  saveCombo(id: string, combo: SaveComboOffer): Observable<{ id: string; code: number }> {
    return this.http.put<{ id: string; code: number }>(`/api/inventory/combos/${id}`, combo);
  }

  deleteCombo(id: string): Observable<void> {
    return this.http.delete<void>(`/api/inventory/combos/${id}`);
  }

  whereUsed(materialId: string): Observable<WhereUsedReport> {
    return this.http.get<WhereUsedReport>(`/api/costing/intelligence/where-used/${materialId}`);
  }

  previewBulkSwap(request: SwapRequest): Observable<SwapPreview> {
    return this.http.post<SwapPreview>('/api/costing/recipes/bulk-swap/preview', request);
  }

  bulkSwap(request: SwapRequest): Observable<BulkSwapResult> {
    return this.http.post<BulkSwapResult>('/api/costing/recipes/bulk-swap', request);
  }

  staffMeals(from: string, to: string): Observable<StaffMealReport> {
    return this.http.get<StaffMealReport>('/api/costing/staff-meals', { params: { from, to } });
  }

  recordStaffMeal(entry: RecordStaffMeal): Observable<{ entryId: string }> {
    return this.http.post<{ entryId: string }>('/api/inventory/staff-meals', entry);
  }

  supplierPayments(from: string, to: string): Observable<SupplierPaymentRow[]> {
    return this.http.get<SupplierPaymentRow[]>('/api/financials/supplier-payments', { params: { from, to } });
  }

  // Employees' advances paid in a period: for whoever works Financials, as it shows who is paid what.
  advances(from: string, to: string): Observable<AdvanceRow[]> {
    return this.http.get<AdvanceRow[]>('/api/financials/advances', { params: { from, to } });
  }

  // What a supplier was owed before the treasury: no cash moves, so it is entered at once.
  supplierOpeningBalance(supplierId: string, entryId: string, owed: number, date: string | null): Observable<void> {
    return this.http.post<void>(`/api/financials/suppliers/${supplierId}/opening-balance`, { entryId, owed, date });
  }

  // A safe entry: made at once for a manager; a request for anyone else.
  recordVoucher(voucher: SafeVoucherInput): Observable<SafeTransaction | ApprovalResult> {
    return this.http.post<SafeTransaction | ApprovalResult>('/api/financials/vouchers', voucher);
  }

  discardPurchaseInvoice(id: string): Observable<void> {
    return this.http.delete<void>(`/api/inventory/purchase-invoices/${id}`);
  }

  attachPurchaseInvoiceFile(id: string, file: File): Observable<PurchaseInvoice> {
    const form = new FormData();
    form.append('file', file, file.name);
    return this.http.put<PurchaseInvoice>(`/api/inventory/purchase-invoices/${id}/attachment`, form);
  }

  // The paper itself, fetched with the manager's sign-in, to show or save.
  purchaseInvoiceFile(id: string): Observable<Blob> {
    return this.http.get(`/api/inventory/purchase-invoices/${id}/attachment`, { responseType: 'blob' });
  }

  importPrepItems(file: File): Observable<PrepImportResult> {
    const form = new FormData();
    form.append('file', file, file.name);
    return this.http.post<PrepImportResult>('/api/inventory/prep-items/import', form);
  }

  // Recipes and prep items to and from their smart sheets: a row per ingredient, chosen from a
  // dropdown of the materials and prep items with their units. The template is the export, empty.
  recipesTemplate(): Observable<Blob> {
    return this.http.get('/api/inventory/recipes/sheet/template', { responseType: 'blob' });
  }

  exportRecipes(): Observable<Blob> {
    return this.http.get('/api/inventory/recipes/sheet/export', { responseType: 'blob' });
  }

  importRecipes(file: File): Observable<RecipeImportResult> {
    const form = new FormData();
    form.append('file', file, file.name);
    return this.http.post<RecipeImportResult>('/api/inventory/recipes/sheet/import', form);
  }

  prepItemsTemplate(): Observable<Blob> {
    return this.http.get('/api/inventory/prep-items/sheet/template', { responseType: 'blob' });
  }

  exportPrepItems(): Observable<Blob> {
    return this.http.get('/api/inventory/prep-items/sheet/export', { responseType: 'blob' });
  }

  importPrepItemsSheet(file: File): Observable<RecipeImportResult> {
    const form = new FormData();
    form.append('file', file, file.name);
    return this.http.post<RecipeImportResult>('/api/inventory/prep-items/sheet/import', form);
  }

  prepItems(): Observable<PrepItem[]> {
    return this.http.get<PrepItem[]>('/api/inventory/prep-items');
  }

  // Null for one that is not there (404, and only 404).
  prepItem(id: string): Observable<PrepItem | null> {
    return this.http.get<PrepItem>(`/api/inventory/prep-items/${id}`).pipe(
      catchError((error: unknown) => (error instanceof HttpErrorResponse && error.status === 404 ? of(null) : throwError(() => error))),
    );
  }

  // Adds it without an id; changes it with one. A request, for someone who may not approve.
  savePrepItem(id: string | null, item: SavePrepItem): Observable<PrepItem | ApprovalResult> {
    return id
      ? this.http.put<PrepItem | ApprovalResult>(`/api/inventory/prep-items/${id}`, item)
      : this.http.post<PrepItem | ApprovalResult>('/api/inventory/prep-items', item);
  }

  previewProduction(prepItemId: string, planned: number, produced: number): Observable<ProductionPreview> {
    return this.http.get<ProductionPreview>('/api/inventory/production-orders/preview', { params: { prepItemId, planned, produced } });
  }

  productionOrders(prepItemId?: string): Observable<ProductionOrder[]> {
    return this.http.get<ProductionOrder[]>('/api/inventory/production-orders', { params: prepItemId ? { prepItemId } : {} });
  }

  productionOrder(id: string): Observable<ProductionOrder | null> {
    return this.http.get<ProductionOrder>(`/api/inventory/production-orders/${id}`).pipe(
      catchError((error: unknown) => (error instanceof HttpErrorResponse && error.status === 404 ? of(null) : throwError(() => error))),
    );
  }

  // Makes the batch under the id made here: a retry after a lost answer makes it once. A
  // request, moving nothing yet, for someone who may not approve.
  makeProductionOrder(id: string, order: MakeProductionOrder): Observable<ProductionOrder | ApprovalResult> {
    return this.http.put<ProductionOrder | ApprovalResult>(`/api/inventory/production-orders/${id}`, order);
  }

  reviseProductionOrder(id: string, revision: ReviseProductionOrder): Observable<ApprovalResult> {
    return this.http.post<ApprovalResult>(`/api/inventory/production-orders/${id}/revision`, revision);
  }

  suppliers(includeArchived = false): Observable<Supplier[]> {
    return this.http.get<Supplier[]>('/api/inventory/suppliers', { params: { includeArchived } });
  }

  // Adds it on the first save, under the id made here; changes it after.
  saveSupplier(id: string, supplier: SaveSupplier): Observable<Supplier> {
    return this.http.put<Supplier>(`/api/inventory/suppliers/${id}`, supplier);
  }

  deleteSupplier(id: string): Observable<{ outcome: SupplierRemoval }> {
    return this.http.delete<{ outcome: SupplierRemoval }>(`/api/inventory/suppliers/${id}`);
  }

  restoreSupplier(id: string): Observable<Supplier> {
    return this.http.post<Supplier>(`/api/inventory/suppliers/${id}/restore`, {});
  }

  // Null for a count not saved yet (404, and only 404). Blind: the records' figures and the costs
  // left out (a storekeeper's are, whatever is asked).
  stockCount(id: string, blind = false): Observable<StockCount | null> {
    return this.http.get<StockCount>(`/api/inventory/stock-counts/${id}`, { params: blind ? { blind: 'true' } : {} }).pipe(
      catchError((error: unknown) => (error instanceof HttpErrorResponse && error.status === 404 ? of(null) : throwError(() => error))),
    );
  }

  // The whole list each time: a material left out is not counted; each line with its note.
  // Kind: periodic or opening stock, as it starts or changed while a draft. Scope: a spot count's,
  // as it starts.
  saveStockCount(
    id: string,
    lines: { rawMaterialId: string; countedQuantity: number; note?: string | null }[],
    kind?: StockCountKind,
    scope?: CountScopeInput,
    blind = false,
    // The location counted, as the count starts; none: the whole branch.
    locationId: string | null = null,
  ): Observable<StockCount> {
    return this.http.put<StockCount>(`/api/inventory/stock-counts/${id}`, { lines, ...(kind ? { kind } : {}), ...(scope ?? {}), ...(locationId ? { locationId } : {}) }, {
      params: blind ? { blind: 'true' } : {},
    });
  }

  // Handed in for a manager or cost controller to reconcile and post.
  submitStockCount(id: string, blind = false): Observable<StockCount> {
    return this.http.post<StockCount>(`/api/inventory/stock-counts/${id}/submit`, {}, { params: blind ? { blind: 'true' } : {} });
  }

  // Lines sent back to be weighed again (مطلوب إعادة جرد), with a note.
  requestRecount(id: string, rawMaterialIds: string[], note: string | null): Observable<StockCount> {
    return this.http.post<StockCount>(`/api/inventory/stock-counts/${id}/recount`, { rawMaterialIds, note });
  }

  // Every material and prep item a count sheet lists, with nothing of its stock or cost.
  countItems(): Observable<CountItem[]> {
    return this.http.get<CountItem[]>('/api/inventory/stock-counts/items');
  }

  // A spot count's ready lists: daily critical, class A, high variance, each category.
  countPresets(): Observable<CountPresets> {
    return this.http.get<CountPresets>('/api/costing/count-presets');
  }

  // Starred, or not, as a daily critical item.
  // The kitchen and bar stations; a manager's to set.
  stations(): Observable<KitchenStation[]> {
    return this.http.get<KitchenStation[]>('/api/costing/stations');
  }

  saveStation(id: string, station: SaveKitchenStation): Observable<KitchenStation> {
    return this.http.put<KitchenStation>(`/api/costing/stations/${id}`, station);
  }

  deleteStation(id: string): Observable<void> {
    return this.http.delete<void>(`/api/costing/stations/${id}`);
  }

  // Materials and prep items given a station (null: none, the shared station's), one or many.
  assignMaterialsStation(rawMaterialIds: string[], stationId: string | null): Observable<{ assigned: number; stationId: string | null }> {
    return this.http.put<{ assigned: number; stationId: string | null }>('/api/inventory/raw-materials/station', { rawMaterialIds, stationId });
  }

  assignRecipeStation(recipeId: string, stationId: string | null): Observable<{ assigned: number; stationId: string | null }> {
    return this.http.put<{ assigned: number; stationId: string | null }>(`/api/inventory/recipes/${recipeId}/station`, { stationId });
  }

  setSpotCheck(id: string, isSpotCheckItem: boolean): Observable<{ isSpotCheckItem: boolean }> {
    return this.http.put<{ isSpotCheckItem: boolean }>(`/api/inventory/raw-materials/${id}/spot-check`, { isSpotCheckItem });
  }

  postStockCount(id: string): Observable<StockCount> {
    return this.http.post<StockCount>(`/api/inventory/stock-counts/${id}/post`, {});
  }

  discardStockCount(id: string): Observable<void> {
    return this.http.delete<void>(`/api/inventory/stock-counts/${id}`);
  }

  // spoilageId is made here, once per entry, as purchaseId is.
  // locationId: where it was thrown away; none: the location serving its station, or the main store.
  recordSpoilage(spoilageId: string, lines: SpoilageLine[], locationId: string | null = null): Observable<unknown> {
    return this.http.post('/api/inventory/spoilage', { spoilageId, lines, ...(locationId ? { locationId } : {}) });
  }

  spoilage(days = 30): Observable<SpoilageEntry[]> {
    return this.http.get<SpoilageEntry[]>('/api/costing/spoilage', { params: { days } });
  }

  // No ids: the last two posted counts.
  variance(fromCountId: string | null, toCountId: string | null): Observable<VarianceReport> {
    const params: Record<string, string> = {};
    if (fromCountId) {
      params['fromCountId'] = fromCountId;
    }
    if (toCountId) {
      params['toCountId'] = toCountId;
    }
    return this.http.get<VarianceReport>('/api/costing/variance', { params });
  }

  private target(kind: RecipeTargetKind, catalogItemId: number, variantId: number | null): Record<string, string | number> {
    return variantId === null ? { targetKind: kind, catalogItemId } : { targetKind: kind, catalogItemId, variantId };
  }
}

// Labels, in English and Arabic, as the reports carry both.
export const statusLabels: Record<CostStatus, { en: string; ar: string }> = {
  WithinTarget: { en: 'Within target', ar: 'ضمن الهدف' },
  AboveTarget: { en: 'Above target', ar: 'فوق الهدف' },
  NoRecipe: { en: 'No recipe', ar: 'لا توجد وصفة' },
  MissingPrices: { en: 'Missing prices', ar: 'أسعار ناقصة' },
  NoPrice: { en: 'No price', ar: 'بلا سعر' },
};

export const unitLabels: Record<UnitOfMeasure, string> = { Gram: 'g', Millilitre: 'ml', Piece: 'pc' };

// Raw materials brought in from the Excel template: each made a purchased stock item, or skipped
// and said why, by its row on the sheet; and the categories added for them.
export interface ImportedRawMaterial {
  row: number;
  id: string;
  name: string;
  category: string;
  unit: UnitOfMeasure;
  purchaseUnit: string;
  costPerPurchaseUnit: number | null;
}

// A row left out, and why; in Arabic too where the import says it.
export interface SkippedSheetRow {
  row: number;
  name: string | null;
  reason: string;
  reasonAr?: string | null;
}

// One already there, changed by its row: what changed, by the sheet's column.
export type SheetChange =
  | 'Name'
  | 'Code'
  | 'Category'
  | 'PurchaseUnit'
  | 'Cost'
  | 'ReorderLevel'
  | 'Yield'
  | 'NameAr'
  | 'Unit'
  | 'Ingredients'
  | 'Portions'
  | 'Batch';

export interface UpdatedSheetItem {
  row: number;
  id: string;
  name: string;
  changes: SheetChange[];
}

// What importing a sheet of raw materials or expense items did: those added, those changed, how
// many were as the sheet has them already, the rows skipped and why, and the categories added.
export interface SheetImportResult {
  created: { row: number; id: string; name: string }[];
  updated: UpdatedSheetItem[];
  unchanged: number;
  skipped: SkippedSheetRow[];
  categoriesAdded: string[];
  // Recipes and prep items: what each imported costs now, by its ingredients' prices.
  costed?: CostedSheetItem[];
  // Prep items asked of a manager rather than saved: nothing changes until approved.
  requested?: number;
}

// A recipe or a prep item imported, costed: its whole recipe or batch, and one portion or one
// kg, litre or piece of it (per: "portion", "Kg"). An ingredient with no price yet is named;
// notes say what to check, such as a quantity that reads as grams written as kilos.
export interface CostedSheetItem {
  row: number;
  name: string;
  ingredients: number;
  cost: number | null;
  costPer: number | null;
  per: string;
  missingPrices: string[];
  notes: string[];
  requested: boolean;
}

export interface RecipeImportResult extends SheetImportResult {
  costed: CostedSheetItem[];
  requested: number;
}

export interface RawMaterialImportResult extends SheetImportResult {
  created: ImportedRawMaterial[];
}

export interface ExpenseItemImportResult extends SheetImportResult {
  created: { row: number; id: string; name: string; category: string }[];
}

// Prep items brought in from a sheet of batch recipes (المصنعات): each made, or asked of a manager
// (requested), its batch in grams and what to check on it; the rows skipped and why; the raw
// materials added for the recipes, and the category added for the prep items.
export interface ImportedPrepItem {
  row: number;
  id: string;
  name: string;
  batchQuantity: number;
  ingredients: number;
  requested: boolean;
  notes: string[];
}

export interface PrepImportResult {
  imported: ImportedPrepItem[];
  skipped: SkippedSheetRow[];
  materialsAdded: { id: string; name: string; unit: UnitOfMeasure }[];
  categoryAdded: string | null;
}

// Stock is counted and reported in kg, litres and pieces, whatever it is bought in: a count of
// 3.25 kg of cheese, not 0.13 of a 25 kg sack. What is bought by the gram or millilitre, such as
// saffron, is counted so. The ledger keeps grams, millilitres and pieces.
export function countUnit(unit: UnitOfMeasure, purchaseUnitSize: number): { label: string; size: number } {
  switch (unit) {
    case 'Gram':
      return purchaseUnitSize < 1000 ? { label: 'g', size: 1 } : { label: 'kg', size: 1000 };
    case 'Millilitre':
      return purchaseUnitSize < 1000 ? { label: 'ml', size: 1 } : { label: 'L', size: 1000 };
    default:
      return { label: 'pc', size: 1 };
  }
}

// The units a delivery of this material can be entered in, each with how many of its own units
// (grams, millilitres, pieces) one holds: what it is bought by first, then the kilogram or litre,
// then the gram, millilitre or piece itself. 5 kg is 5,000 g whichever is chosen.
export function purchaseUnits(material: MaterialCost): { label: string; size: number }[] {
  const units = [
    { label: material.purchaseUnit, size: material.purchaseUnitSize },
    ...(material.unit === 'Gram' ? [{ label: 'kg', size: 1000 }, { label: 'g', size: 1 }] : []),
    ...(material.unit === 'Millilitre' ? [{ label: 'L', size: 1000 }, { label: 'ml', size: 1 }] : []),
    ...(material.unit === 'Piece' ? [{ label: 'pc', size: 1 }] : []),
  ];
  return units.filter((u, i) => units.findIndex((other) => other.size === u.size) === i);
}

export const evaluationLabels: Record<VarianceEvaluation, { en: string; ar: string }> = {
  Unfavourable: { en: 'Unfavourable', ar: 'غير مواتٍ' },
  Favourable: { en: 'Favourable', ar: 'مواتٍ' },
  WithinLimit: { en: 'Within limit', ar: 'ضمن الحد' },
  SharedCost: { en: 'Shared cost', ar: 'تكلفة مشتركة' },
};

// The template's indicators: name, formula and purpose in English and Arabic, as it writes them.
export const kpiLabels: Record<KpiKey, { en: string; ar: string; formula: string; formulaAr: string; purpose: string; money: boolean }> = {
  FoodCost: {
    en: 'Food cost %',
    ar: 'نسبة تكلفة الطعام',
    formula: 'Cost of raw materials consumed ÷ food sales × 100',
    formulaAr: '(تكلفة المواد الخام المستهلكة ÷ إجمالي مبيعات الطعام) × 100',
    purpose: 'How well food is bought and prepared',
    money: false,
  },
  BeverageCost: {
    en: 'Beverage cost %',
    ar: 'نسبة تكلفة المشروبات',
    formula: 'Cost of beverages sold ÷ beverage revenue × 100',
    formulaAr: '(تكلفة المشروبات المباعة ÷ إيرادات المشروبات) × 100',
    purpose: 'How well drinks are managed',
    money: false,
  },
  LabourCost: {
    en: 'Labour cost %',
    ar: 'نسبة تكلفة العمالة',
    formula: 'Wages and benefits ÷ revenue × 100',
    formulaAr: '(إجمالي الرواتب والمزايا ÷ إجمالي الإيرادات) × 100',
    purpose: 'Staffing against revenue',
    money: false,
  },
  AverageCheck: {
    en: 'Average check',
    ar: 'متوسط قيمة الفاتورة',
    formula: 'Revenue ÷ paid orders',
    formulaAr: 'إجمالي الإيرادات ÷ عدد الفواتير',
    purpose: 'What a customer spends on average',
    money: true,
  },
  SalesPerLabourHour: {
    en: 'Sales per labour hour',
    ar: 'الإيراد لكل ساعة عمل',
    formula: 'Revenue ÷ labour hours',
    formulaAr: 'إجمالي المبيعات ÷ إجمالي ساعات العمل',
    purpose: 'How productive the staff are',
    money: true,
  },
  GrossProfitMargin: {
    en: 'Gross profit margin',
    ar: 'هامش الربح الإجمالي',
    formula: 'Gross profit ÷ revenue × 100',
    formulaAr: '(إجمالي الربح ÷ إجمالي الإيرادات) × 100',
    purpose: 'Profit after the cost of sales',
    money: false,
  },
  NetProfitMargin: {
    en: 'Net profit margin',
    ar: 'هامش الربح الصافي',
    formula: 'Net profit ÷ revenue × 100',
    formulaAr: '(صافي الربح ÷ إجمالي الإيرادات) × 100',
    purpose: 'Profit after everything',
    money: false,
  },
};

// ---- Financials (الماليات) ----

// How an invoice is paid: from the safe, from one day's cash takings, or on credit (owed to its
// supplier). BeforeTreasury: posted before the treasury was kept.
export type PurchasePaymentMethod = 'Safe' | 'DayRevenue' | 'Credit' | 'BeforeTreasury';
export type InvoicePaymentStatus = 'NotPosted' | 'Paid' | 'Pending' | 'Unpaid' | 'OnCredit' | 'BeforeTreasury';

export const paymentMethodLabels: Record<PurchasePaymentMethod, { en: string; ar: string }> = {
  Safe: { en: 'Paid from the safe', ar: 'خصم من الخزنة' },
  DayRevenue: { en: 'Paid from a day’s takings', ar: 'خصم من إيراد يوم' },
  Credit: { en: 'On credit', ar: 'آجل' },
  BeforeTreasury: { en: 'Before the treasury', ar: 'قبل الخزنة' },
};

export const paymentStatusLabels: Record<InvoicePaymentStatus, { en: string; ar: string }> = {
  NotPosted: { en: 'Draft', ar: 'مسودة' },
  Paid: { en: 'Paid', ar: 'مدفوعة' },
  Pending: { en: 'Payment waiting for approval', ar: 'الدفع بانتظار الموافقة' },
  Unpaid: { en: 'Unpaid', ar: 'غير مدفوعة' },
  OnCredit: { en: 'On credit', ar: 'آجل' },
  BeforeTreasury: { en: 'Before the treasury', ar: 'قبل الخزنة' },
};

export type SafeTransactionKind =
  | 'OpeningBalance'
  | 'Funding'
  | 'RevenueTransfer'
  | 'ExpenseVoucher'
  | 'SupplierPayment'
  | 'InvoicePayment'
  | 'EmployeeAdvance'
  | 'SalaryPayment'
  // The tax collected paid over to the tax authority (سداد ضرائب): out of the safe, not an expense.
  | 'TaxPayment'
  // A month's payroll approved on HR, paid out of the safe (صرف مسير رواتب): its net cash, once.
  | 'PayrollPayment'
  // A fixed asset bought (CAPEX), out of the safe or the bank: never an expense.
  | 'AssetPurchase'
  // A fixed asset sold, into the safe or the bank: never revenue.
  | 'AssetSale';
// Bank: what a fixed asset is paid from or sold into when it is not cash; the safe never counts it.
export type CashFund = 'Safe' | 'DayRevenue' | 'Bank';
// Where money put into the safe came from (مصدر التمويل).
export type FundingSource = 'CarriedOver' | 'OwnerFinancing' | 'Other';

export const fundingSourceLabels: Record<FundingSource, { en: string; ar: string }> = {
  CarriedOver: { en: 'Carried over', ar: 'رصيد مرحل' },
  OwnerFinancing: { en: 'Owners’ financing', ar: 'تمويل جاري / جاري الشركاء' },
  Other: { en: 'Other source', ar: 'مصدر آخر' },
};

export const safeKindLabels: Record<SafeTransactionKind, { en: string; ar: string }> = {
  OpeningBalance: { en: 'Opening balance', ar: 'رصيد افتتاحي' },
  Funding: { en: 'Funding', ar: 'تمويل' },
  RevenueTransfer: { en: 'Takings in', ar: 'توريد إيراد' },
  ExpenseVoucher: { en: 'Expense voucher', ar: 'إذن صرف مصروفات' },
  SupplierPayment: { en: 'Supplier payment', ar: 'إذن صرف لمورد' },
  InvoicePayment: { en: 'Invoice paid', ar: 'سداد فاتورة' },
  EmployeeAdvance: { en: 'Employee advance', ar: 'سلفة موظف' },
  SalaryPayment: { en: 'Salary paid', ar: 'صرف راتب' },
  TaxPayment: { en: 'Tax payment', ar: 'سداد ضرائب' },
  PayrollPayment: { en: 'Payroll paid', ar: 'صرف مسير رواتب' },
  AssetPurchase: { en: 'Asset acquisition (CAPEX)', ar: 'شراء أصل ثابت' },
  AssetSale: { en: 'Asset sold', ar: 'بيع أصل ثابت' },
};

// One line of the safe's ledger: in or out, and the balance after it (null where not running).
// A reversal names what it undid (reversalOf); what it undid is marked voided.
export interface SafeEntry {
  id: string;
  kind: SafeTransactionKind;
  fund: CashFund;
  date: string;
  description: string;
  in: number;
  out: number;
  balance: number | null;
  source: FundingSource | null;
  revenueDate: string | null;
  supplierId: string | null;
  purchaseInvoiceId: string | null;
  expenseItemId: string | null;
  notes: string | null;
  recordedBy: string;
  recordedAtUtc: string;
  approvedBy: string | null;
  reversalOf: string | null;
  voidedAtUtc: string | null;
  voidedBy: string | null;
  // A day's takings: the tax collected on them (signed as in and out are), and the till's rate when
  // it was worked out at it.
  includesTax: boolean;
  taxPercent: number | null;
  tax: number;
  // A day's takings: their cash and card sales before tax, as entered (in is what of all of it,
  // tax too, reached the safe); and the day's voids and refunds.
  gross: number | null;
  card?: number;
  voids?: number;
}

// How a month's opening balance came about: carried over from the month before, the treasury's
// own opening entry made this month, or none yet.
export type SafeOpening = 'None' | 'CarriedOver' | 'OpeningEntry';

export interface SafeMonth {
  year: number;
  month: number;
  from: string;
  to: string;
  openingBalance: number;
  openingKind: SafeOpening;
  openingSource: FundingSource | null;
  // What stands: an entry voided this month, and its void, are in neither.
  in: number;
  out: number;
  // The entries voided this month, left out of in and out with their voids.
  voidedIn: number;
  voidedOut: number;
  closingBalance: number;
  balanceNow: number;
  hasOpeningBalance: boolean;
  entries: SafeEntry[];
  // The summary strip, in order: the month's cash, Visa and tax taken (and the net sales, cash and
  // Visa); all that came in (totalIn), the balance it opened with and the funding put in (fundingIn)
  // too; all that went out (totalOut), what the takings paid straight out of them too. closingBalance
  // is totalIn − totalOut. taxOwedNow: the tax held in the safe for the tax authority now.
  cashTakings?: number;
  cardTakings?: number;
  taxCollected?: number;
  netSales?: number;
  fundingIn?: number;
  totalIn?: number;
  totalOut?: number;
  taxOwedNow?: number;
  // Fixed assets sold for cash into the safe this month (in totalIn), and bought out of it (in totalOut).
  assetSales?: number;
  assetPurchases?: number;
}

// The tax the takings collected and what was paid over: what is still owed, held in the safe.
export interface TaxPosition {
  collected: number;
  paid: number;
  owed: number;
}

// One line of the safe's analysis: where money came from or went, its share of all of it, and what
// it is made of (the expense vouchers by category, say).
export interface TreasuryFlowLine {
  key: string;
  en: string;
  ar: string | null;
  amount: number;
  sharePercent: number | null;
  items: TreasuryFlowLine[];
}

// One business day of the safe: in, out, the net, the balance it ended with, and its voids with why.
export interface TreasuryDay {
  date: string;
  in: number;
  out: number;
  net: number;
  balance: number;
  voids: number;
  voidReasons: string[];
}

// The safe over a period (تحليل الخزنة والتدفقات النقدية): totalIn has the balance it opened with;
// netFlow is what came in during it less what went out; the tax collected and paid over in it, and
// still owed to its last day.
export interface TreasuryAnalytics {
  from: string;
  to: string;
  openingBalance: number;
  totalIn: number;
  totalOut: number;
  netFlow: number;
  closingBalance: number;
  inflows: TreasuryFlowLine[];
  outflows: TreasuryFlowLine[];
  taxCollected: number;
  taxPaid: number;
  taxToDate: TaxPosition;
  voids: number;
  days: TreasuryDay[];
}

export interface FundingReport {
  from: string;
  to: string;
  carriedOver: number;
  ownerFinancing: number;
  other: number;
  revenue: number;
  total: number;
  entries: SafeEntry[];
}

// One business day's takings as its Z report gave them: cash and card before tax, the tax collected
// on them, the net sales (cash + card), the voids; what was paid straight out of them, and what of
// them is in the safe. entered: the takings are; hasSales: the day's sales are.
export interface DayRevenue {
  date: string;
  cash: number;
  card: number;
  tax: number;
  netSales: number;
  voids: number;
  paidOut: number;
  transferred: number;
  entered: boolean;
  hasSales: boolean;
}

export interface DayRevenueReport {
  from: string;
  to: string;
  cash: number;
  card: number;
  tax: number;
  netSales: number;
  voids: number;
  paidOut: number;
  transferred: number;
  days: DayRevenue[];
}

// A day's takings before they are entered: the gross already entered (null when not), and what was
// paid straight out of them, which entering them takes off.
export interface TakingsPreview {
  date: string;
  entered: number | null;
  paidOut: number;
  invoices: number;
  supplierPayments: number;
  // Employees' advances and salaries.
  employeePayments?: number;
}

// A tax payment (isTaxPayment) is listed with the vouchers, with no expense item: not an expense.
export interface ExpenseVoucherRow {
  id: string;
  date: string;
  expenseItemId: string | null;
  expenseItem: string;
  category: string | null;
  amount: number;
  notes: string | null;
  recordedBy: string;
  approvedBy: string | null;
  voidedAtUtc: string | null;
  voidedBy: string | null;
  isTaxPayment?: boolean;
}

// total: the expenses; taxPaid: the tax paid over, apart.
export interface ExpenseVoucherReport {
  from: string;
  to: string;
  total: number;
  vouchers: ExpenseVoucherRow[];
  taxPaid?: number;
}

// What is owed to one supplier, and how it came about.
export interface SupplierBalance {
  supplierId: string;
  supplier: string;
  isArchived: boolean;
  openingDebt: number;
  creditPurchases: number;
  payments: number;
  balance: number;
  lastPaidOn: string | null;
  openInvoices: number;
}

export type SupplierLedgerKind = 'OpeningBalance' | 'CreditInvoice' | 'Payment';

// A line of a supplier's statement (كشف حساب): owed adds to the debt, paid takes from it.
export interface SupplierStatementLine {
  id: string;
  date: string;
  kind: SupplierLedgerKind;
  description: string;
  owed: number;
  paid: number;
  balance: number;
  sourceId: string;
  isReversal: boolean;
}

// A credit invoice not fully paid: payments go to the opening debt first, then the oldest invoice.
export interface OpenInvoice {
  invoiceId: string;
  supplierInvoiceNumber: string | null;
  date: string;
  total: number;
  paid: number;
  remaining: number;
  status: 'Unpaid' | 'PartlyPaid';
}

export interface SupplierStatement {
  supplierId: string;
  supplier: string;
  openingDebt: number;
  creditPurchases: number;
  payments: number;
  balance: number;
  lines: SupplierStatementLine[];
  openInvoices: OpenInvoice[];
}

export interface SupplierPaymentRow {
  id: string;
  date: string;
  supplierId: string;
  supplier: string;
  amount: number;
  notes: string | null;
  recordedBy: string;
  approvedBy: string | null;
  voidedAtUtc: string | null;
  voidedBy: string | null;
  // Paid straight out of that day's takings, not the safe.
  fromTakingsOf: string | null;
}

// An employee's advance (سلفة): when and from where it was paid, and the payroll month whose slip
// deducts it (its first day).
// No employee and no payroll month: advances handed out with no one named, shared among the staff
// and deducted from no one's pay.
export interface AdvanceRow {
  id: string;
  date: string;
  employeeId: string | null;
  employee: string;
  amount: number;
  payrollMonth: string | null;
  fromTakingsOf: string | null;
  notes: string | null;
  recordedBy: string;
  approvedBy: string | null;
  voidedAtUtc: string | null;
  voidedBy: string | null;
}

// A safe entry as entered. requestId and transactionId are made here, once per entry.
export interface SafeVoucherInput {
  requestId: string;
  transactionId: string;
  kind: SafeTransactionKind;
  amount: number;
  date: string | null;
  source: FundingSource | null;
  revenueDate: string | null;
  supplierId: string | null;
  expenseItemId: string | null;
  notes: string | null;
  reason: string | null;
  // A day's takings with the tax in them: the server takes it off at the till's rate.
  includesTax: boolean;
  // An advance's or a salary's employee; a salary's payroll month (its first day).
  employeeId?: string | null;
  payrollMonth?: string | null;
  // A day's takings from its Z report: amount is the cash; these, the card takings, the tax
  // collected in both, and the day's voids and refunds (why, in the notes).
  cardAmount?: number | null;
  taxAmount?: number | null;
  voidsAmount?: number | null;
  // Its discounts and promos, and why: said, never collected.
  discountsAmount?: number | null;
  discountReasons?: DiscountReason[] | null;
}

export interface SafeTransaction {
  id: string;
  kind: SafeTransactionKind;
  fund: CashFund;
  amount: number;
  businessDate: string;
  recordedBy: string;
  approvedBy: string | null;
  includesTax: boolean;
  taxPercent: number | null;
  taxAmount: number;
  grossAmount: number | null;
  cardAmount?: number;
  voidsAmount?: number;
  // A day's takings: cash + card − tax.
  netAmount?: number;
  discountsAmount?: number;
  discountReasons?: DiscountReason[] | null;
  // An asset purchase's or sale's: the fixed asset.
  fixedAssetId?: string | null;
}

// ---- Fixed assets (سجل الأصول الثابتة) ----

export type FixedAssetCategory = 'KitchenEquipment' | 'Furniture' | 'Vehicles' | 'ItAndPos' | 'FitOut' | 'Other';
// Active and FullyDepreciated: as of the month; Disposed and Sold: what was done with it.
export type FixedAssetStatus = 'Active' | 'FullyDepreciated' | 'Disposed' | 'Sold';
// Where an asset bought was paid from: a safe entry out of the safe or the bank, or owned already.
export type AssetPaymentSource = 'Safe' | 'Bank' | 'OwnedAlready';

export const fixedAssetCategoryLabels: Record<FixedAssetCategory, { en: string; ar: string }> = {
  KitchenEquipment: { en: 'Kitchen equipment', ar: 'معدات المطبخ' },
  Furniture: { en: 'Furniture', ar: 'الأثاث' },
  Vehicles: { en: 'Vehicles', ar: 'السيارات' },
  ItAndPos: { en: 'IT & POS', ar: 'أجهزة الحاسب ونقاط البيع' },
  FitOut: { en: 'Fit-out & decoration', ar: 'تجهيزات وديكورات' },
  Other: { en: 'Other', ar: 'أخرى' },
};

export const fixedAssetStatusLabels: Record<FixedAssetStatus, { en: string; ar: string }> = {
  Active: { en: 'Active', ar: 'نشط' },
  FullyDepreciated: { en: 'Fully depreciated', ar: 'مهلك بالكامل' },
  Disposed: { en: 'Disposed', ar: 'مستبعد' },
  Sold: { en: 'Sold', ar: 'مباع' },
};

// One asset as it stood at the end of the month: straight-line, (cost − salvage) ÷ life a month.
export interface FixedAssetRow {
  id: string;
  assetCode: string;
  name: string;
  category: FixedAssetCategory;
  location: string | null;
  notes: string | null;
  purchaseDate: string;
  purchaseCost: number;
  salvageValue: number;
  usefulLifeMonths: number;
  monthlyDepreciation: number;
  monthsCharged: number;
  monthsLeft: number;
  accumulatedDepreciation: number;
  netBookValue: number;
  depreciationThisMonth: number;
  lastMonth: string;
  status: FixedAssetStatus;
  // Null: owned already, paid through no entry here.
  paidFrom: CashFund | null;
  purchaseTransactionId: string | null;
  disposalDate: string | null;
  saleProceeds: number | null;
  saleFund: CashFund | null;
  saleTransactionId: string | null;
  netBookValueAtDisposal: number | null;
  gainOrLoss: number | null;
  disposalNotes: string | null;
  createdBy: string;
  createdAtUtc: string;
}

export interface FixedAssetCategoryTotal {
  category: FixedAssetCategory;
  count: number;
  cost: number;
  accumulatedDepreciation: number;
  netBookValue: number;
  depreciationThisMonth: number;
}

// The register at the end of a month: the cards count what was still held then. The month's
// investing cash: bought out of the safe and the bank, owned already added, what sales brought in.
export interface FixedAssetRegister {
  year: number;
  month: number;
  asOf: string;
  totalCost: number;
  accumulatedDepreciation: number;
  netBookValue: number;
  depreciationThisMonth: number;
  activeCount: number;
  fullyDepreciatedCount: number;
  disposedCount: number;
  boughtFromSafe: number;
  boughtFromBank: number;
  ownedAlreadyAdded: number;
  saleProceeds: number;
  disposalGainOrLoss: number;
  categories: FixedAssetCategoryTotal[];
  assets: FixedAssetRow[];
  locations: string[];
}

export interface AcquireFixedAsset {
  requestId: string;
  assetId: string;
  transactionId: string;
  name: string;
  category: FixedAssetCategory;
  purchaseDate: string;
  purchaseCost: number;
  usefulLifeMonths: number;
  salvageValue: number;
  location: string | null;
  notes: string | null;
  paidFrom: AssetPaymentSource;
  reason?: string | null;
}

// Cost and purchase date: an asset owned already's only.
export interface ChangeFixedAsset {
  name: string;
  category: FixedAssetCategory;
  usefulLifeMonths: number;
  salvageValue: number;
  location: string | null;
  notes: string | null;
  purchaseDate?: string | null;
  purchaseCost?: number | null;
}

// saleProceeds more than nothing: sold into the safe or the bank (fund); otherwise written off.
export interface DisposeFixedAsset {
  requestId: string;
  transactionId: string;
  date: string;
  saleProceeds: number | null;
  fund: CashFund | null;
  notes: string | null;
  reason?: string | null;
}

// Applied: on the register (assetCode), paid (transaction); Requested: waits for a manager (request).
export interface FixedAssetResult {
  outcome: ApprovalOutcome;
  assetId: string;
  assetCode: string | null;
  transaction: SafeTransaction | null;
  request: ApprovalRequest | null;
}

// ---- The profit and loss (قائمة الدخل) ----

export interface PnlLine {
  key: string;
  en: string;
  ar: string;
  amount: number | null;
  percentOfRevenue: number | null;
  level: number;
  isTotal: boolean;
}

// Gross profit − operating expenses = EBITDA; − interest − depreciation ± disposals = net profit.
export interface ProfitAndLoss {
  year: number;
  month: number;
  from: string;
  to: string;
  revenue: number;
  costOfSales: number;
  grossProfit: number;
  operatingExpenses: number;
  ebitda: number | null;
  interest: number;
  assetDepreciation: number;
  enteredDepreciation: number;
  depreciation: number;
  disposalGainOrLoss: number;
  netProfit: number | null;
  grossMarginPercent: number | null;
  ebitdaMarginPercent: number | null;
  netMarginPercent: number | null;
  lines: PnlLine[];
  missing: string | null;
  // Whose, and for the company's as a whole what it took out between branches.
  scope?: PnlScope | null;
  eliminations?: Eliminations | null;
}

// Tax and service (إعدادات الضريبة والخدمة): the till's tax rate, as the delivery system set it
// (null until it has synced), and the service charge, a manager's to set.
export interface FinancialSettings {
  taxPercent: number | null;
  servicePercent: number;
  updatedBy: string | null;
  updatedAtUtc: string | null;
  // The books closed until this day (Settings → Period lock): nothing on or before it is entered,
  // changed or voided.
  booksLockedUntil?: string | null;
}

// One business day of the reconciliation (مطابقة الإيرادات), or the period's total (date null). Its
// net sales (A): the takings, cash and card, less the tax collected in them; against its sales at
// the menu's prices, before tax (B). Difference: A less B; below zero the takings fall short of
// what was sold (discounts, staff meals, cash missing), above it money came in for items not entered.
export interface ReconciliationDay {
  date: string | null;
  cash: number;
  card: number;
  tax: number;
  netSales: number;
  voids: number;
  itemSales: number;
  difference: number;
}

export interface ReconciliationReport {
  from: string;
  to: string;
  taxPercent: number | null;
  total: ReconciliationDay;
  days: ReconciliationDay[];
}

// Each day's takings as they were spent (يومية الإيراد): the gross entered for them, the invoices
// paid straight out of them (deductions), and what is left of them in the safe (netToSafe). A line
// is one invoice paid, with what it bought, the dearest first; or the takings entered, at their gross.
export interface DailyCashLine {
  id: string;
  kind: SafeTransactionKind;
  date: string;
  description: string;
  amount: number;
  purchaseInvoiceId: string | null;
  items: string[];
  recordedBy: string;
  approvedBy: string | null;
}

export interface DailyCashDay {
  date: string;
  gross: number;
  deductions: number;
  netToSafe: number;
  paid: DailyCashLine[];
  entered: DailyCashLine[];
}

export interface DailyCashReport {
  from: string;
  to: string;
  gross: number;
  deductions: number;
  netToSafe: number;
  days: DailyCashDay[];
}

// ---- Supplier accounts: AP aging and the period statement ----

export interface ApAgingRow {
  supplierId: string;
  supplier: string;
  paymentTermsDays: number;
  totalOwed: number;
  current: number;
  days1To30: number;
  days31To60: number;
  days61To90: number;
  over90: number;
  openInvoices: number;
  oldestDueDate: string | null;
}

export interface ApAgingReport {
  asOf: string;
  totalOwed: number;
  current: number;
  days1To30: number;
  days31To60: number;
  days61To90: number;
  over90: number;
  rows: ApAgingRow[];
}

export type SupplierAccountEntryKind = 'OpeningBalance' | 'CreditInvoice' | 'CashInvoice' | 'Payment';

export interface SupplierAccountLine {
  id: string;
  date: string;
  kind: SupplierAccountEntryKind;
  reference: string;
  description: string;
  paid: number;
  owed: number;
  balance: number;
  sourceId: string;
  isReversal: boolean;
  recordedBy: string | null;
  approvedBy: string | null;
  fromTakingsOf: string | null;
  notes: string | null;
}

export interface SupplierAccount {
  supplierId: string;
  supplier: string;
  paymentTermsDays: number;
  from: string;
  to: string;
  openingBalance: number;
  creditInvoices: number;
  cashInvoices: number;
  payments: number;
  closingBalance: number;
  // Entered in the period as owed before the treasury: added like an invoice.
  owedBefore: number;
  lines: SupplierAccountLine[];
  openInvoices: { invoiceId: string; supplierInvoiceNumber: string | null; date: string; total: number; paid: number; remaining: number; status: 'Unpaid' | 'PartlyPaid' }[];
}

// ---- Combo offers (العروض والوجبات المجمعة) ----

// A dish in a combo, as its recipe costs it today, and how many of it the combo holds.
export interface ComboDish {
  recipeId: string;
  dish: string;
  itemCode: string | null;
  quantity: number;
  costPerPortion: number;
  lineCost: number;
  price: number | null;
  linePrice: number | null;
  isDeleted: boolean;
  missingPrices: string[];
}

// A combo and its roll-up: total cost = Σ dish cost × quantity; original price = Σ dish price ×
// quantity (none when a dish has no price); food cost % = total cost ÷ the combo's price.
export interface ComboOffer {
  id: string;
  code: number;
  name: string;
  nameAr: string | null;
  sellingPrice: number;
  isActive: boolean;
  isDeleted: boolean;
  items: ComboDish[];
  totalCost: number;
  originalPrice: number | null;
  savings: number | null;
  savingsPercent: number | null;
  foodCostPercent: number | null;
  foodCostTargetPercent: number;
  status: CostStatus;
  missingPrices: string[];
}

export interface ComboOffersReport {
  nextCode: number;
  foodCostTargetPercent: number;
  combos: ComboOffer[];
}

export interface SaveComboOffer {
  code: number;
  name: string;
  nameAr: string | null;
  sellingPrice: number;
  isActive: boolean;
  items: { recipeId: string; quantity: number }[];
}

// ---- Where an item is used, and the bulk material swap ----

export type WhereUsedKind = 'Dish' | 'OffMenuRecipe' | 'PrepItem';

// One recipe or prep item using the item (أين تُستخدم الخامة): a dish per portion, a prep item per
// batch (batchQuantity of batchUnit). quantity: on it as written (edible portion); throughPrepItems:
// what its prep items take of it, as purchased, via naming them. itemCost: what the item costs in it.
// cost: the portion's (a prep item's: the batch's); price: the menu's, or a planned price.
export interface WhereUsedRow {
  kind: WhereUsedKind;
  id: string;
  name: string;
  itemCode: string | null;
  category: string | null;
  portions: number | null;
  batchQuantity: number | null;
  batchUnit: UnitOfMeasure | null;
  price: number | null;
  cost: number | null;
  foodCostPercent: number | null;
  quantity: number | null;
  throughPrepItems: number | null;
  via: string[];
  itemCost: number | null;
}

export interface WhereUsedReport {
  materialId: string;
  material: string;
  code: string | null;
  isPrepItem: boolean;
  unit: UnitOfMeasure;
  purchaseUnit: string;
  purchaseUnitSize: number;
  dishes: number;
  prepItems: number;
  rows: WhereUsedRow[];
}

// What the swap would do (null ids: every recipe and prep item it can).
export interface SwapRequest {
  fromMaterialId: string;
  toMaterialId: string;
  ratio: number;
  recipeIds?: string[] | null;
  prepItemIds?: string[] | null;
}

export interface SwapItem {
  id: string;
  name: string;
  code: string | null;
  isPrepItem: boolean;
  unit: UnitOfMeasure;
  purchaseUnit: string;
  purchaseUnitSize: number;
  costPerUnit: number | null;
}

// A recipe or prep item with the old item on it, as the swap would leave it: quantities as written
// (a dish's for all its portions, a prep item's a batch), cost a portion (a batch). blocked: why it
// cannot be swapped now. fromNextBatch: a prep item made already moves with its next batches.
export interface SwapPreviewRow {
  kind: WhereUsedKind;
  id: string;
  name: string;
  itemCode: string | null;
  category: string | null;
  portions: number | null;
  batchQuantity: number | null;
  oldQuantity: number;
  newQuantity: number;
  merged: boolean;
  oldCost: number | null;
  newCost: number | null;
  costDelta: number | null;
  price: number | null;
  oldFoodCostPercent: number | null;
  newFoodCostPercent: number | null;
  selected: boolean;
  blocked: string | null;
  fromNextBatch: boolean;
}

// A dish without the old item on it, whose cost moves through a prep item swapped.
export interface SwapKnockOn {
  kind: WhereUsedKind;
  id: string;
  name: string;
  itemCode: string | null;
  via: string[];
  oldCost: number | null;
  newCost: number | null;
  costDelta: number | null;
  price: number | null;
  oldFoodCostPercent: number | null;
  newFoodCostPercent: number | null;
  fromNextBatch: boolean;
}

export interface SwapPreview {
  from: SwapItem;
  to: SwapItem;
  ratio: number;
  unitsDiffer: boolean;
  rows: SwapPreviewRow[];
  knockOn: SwapKnockOn[];
}

export interface BulkSwapResult {
  recipes: number;
  prepItems: number;
}

// ---- Staff meals, hospitality and recipe tastings ----

export type StaffMealKind = 'StaffMeal' | 'Hospitality' | 'RecipeTasting';

export const staffMealKindLabels: Record<StaffMealKind, { en: string; ar: string; icon: string }> = {
  StaffMeal: { en: 'Staff meal', ar: 'وجبات العاملين', icon: 'restaurant' },
  Hospitality: { en: 'Hospitality', ar: 'ضيافة وإكراميات', icon: 'volunteer_activism' },
  RecipeTasting: { en: 'Recipe tasting', ar: 'تجارب واختبار وصفات', icon: 'science' },
};

// A line: a material or prep item (quantity in its own unit: g, ml, pieces) or a recipe (whole plates).
export interface RecordStaffMeal {
  // Where it was taken from; none: the location serving its station, or the main store.
  locationId?: string | null;
  entryId: string;
  kind: StaffMealKind;
  lines: { rawMaterialId: string | null; recipeId: string | null; quantity: number }[];
  note: string | null;
}

export interface StaffMealEntry {
  entryId: string;
  kind: StaffMealKind;
  date: string;
  recordedAtUtc: string;
  recordedBy: string | null;
  note: string | null;
  lines: { rawMaterialId: string; material: string; purchaseUnit: string; quantity: number; value: number | null; note: string | null }[];
  value: number;
}

export interface StaffMealReport {
  from: string;
  to: string;
  dailyBudget: number | null;
  staffMeals: number;
  hospitality: number;
  recipeTasting: number;
  daysOverBudget: number;
  days: { date: string; staffMeals: number; hospitality: number; recipeTasting: number; overBudget: boolean }[];
  entries: StaffMealEntry[];
}
